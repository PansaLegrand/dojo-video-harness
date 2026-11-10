import type {
  Scene,
  SceneAsset,
  SceneNodeInput,
} from "@dojo-video-engine/schema";
import {
  EDITOR_MEDIA_ADMISSION,
  isHighResolutionVideo,
  localVideoProxyDimensions,
} from "./media-admission";

export const PREVIEW_PROXY_VERSION = 3;
export const PREVIEW_PROXY_LIMITS = Object.freeze({
  inputBytes: EDITOR_MEDIA_ADMISSION.maxFileBytes,
  outputBytes: 32 * 1024 * 1024,
  cacheBytes: 96 * 1024 * 1024,
  cacheEntries: 4,
  pendingEntries: 8,
  durationSeconds: EDITOR_MEDIA_ADMISSION.highResolutionSeconds,
  videoFrames: EDITOR_MEDIA_ADMISSION.highResolutionFrames,
  audioPackets: EDITOR_MEDIA_ADMISSION.audioPackets,
  sourceEdge: EDITOR_MEDIA_ADMISSION.maxEdge,
  targetEdge: EDITOR_MEDIA_ADMISSION.previewEdge,
  bitrate: 2_500_000,
});
export type PreviewProxyRequest = {
  assetId: string;
  sourceHash: string;
  src: string;
  sourceBytes: number;
};
type PreviewProxyManifestFields = {
  sourceHash: string;
  sourceBytes: number;
  proxyHash: string;
  proxyBytes: number;
  width: number;
  height: number;
  sourceWidth: number;
  sourceHeight: number;
  duration: number;
  videoDuration: number;
  audioFromOriginal: boolean;
  videoFrames: number;
  videoTimingHash: string;
  audioHash: string | null;
  audioPackets: number;
  createdAt: number;
};
export type PreviewProxyManifest = PreviewProxyManifestFields &
  ({ version: 2 } | { version: 3; audioFirstTimestamp: number | null });
export type PreviewProxyResult = {
  file: Blob;
  manifest: PreviewProxyManifest;
  cached: boolean;
};
export const previewProxyEntryName = (hash: string) =>
  `v${PREVIEW_PROXY_VERSION}-${hash}`;
export const previewProxyLockName = (entry: string) =>
  `dojo-video-engine-preview-proxy:${entry}`;
export const PREVIEW_PROXY_CREATION_LOCK =
  "dojo-video-engine-preview-proxy-creation";

export const previewProxyDimensions = localVideoProxyDimensions;
/** Keep packet priming in the original input; browser remuxing may drop it. */
export const previewProxyUsesOriginalAudio = (
  width: number,
  height: number,
  firstAudioTimestamp: number | null,
) =>
  isHighResolutionVideo(width, height) ||
  (firstAudioTimestamp !== null && firstAudioTimestamp < 0);

export function requiresLocalVideoProxy(asset: {
  id: string;
  type: string;
  width?: number;
  height?: number;
  metadata?: SceneAsset["metadata"];
}): boolean {
  return (
    asset.type === "video" &&
    /^local:(?:sha256:)?[a-f0-9]{64}$/.test(asset.id) &&
    isHighResolutionVideo(
      asset.width ?? asset.metadata?.width ?? 0,
      asset.height ?? asset.metadata?.height ?? 0,
    )
  );
}

export function requiredPreviewProxyAssets(scene: Scene): SceneAsset[] {
  const referenced = new Set<string>();
  const visit = (nodes: SceneNodeInput[]) => {
    for (const node of nodes) {
      if (node.type === "video" && node.assetId) referenced.add(node.assetId);
      visit(node.children ?? []);
    }
  };
  visit(scene.nodes);
  return Object.values(scene.assets).filter(
    (asset) => referenced.has(asset.id) && requiresLocalVideoProxy(asset),
  );
}

/** Call before inserting a new source; repeated uses of one original share a
 * single proxy and do not consume another high-resolution preview slot. */
export function highResolutionInsertionIssue(
  document: {
    assets: Record<string, Parameters<typeof requiresLocalVideoProxy>[0]>;
    items: readonly { node: SceneNodeInput }[];
  },
  incoming: Parameters<typeof requiresLocalVideoProxy>[0],
): string | null {
  if (!requiresLocalVideoProxy(incoming)) return null;
  const used = new Set<string>();
  const visit = (nodes: SceneNodeInput[]) => {
    for (const node of nodes) {
      if (
        node.type === "video" &&
        node.assetId &&
        document.assets[node.assetId] &&
        requiresLocalVideoProxy(document.assets[node.assetId]!)
      )
        used.add(node.assetId);
      visit(node.children ?? []);
    }
  };
  visit(document.items.map((item) => item.node));
  return !used.has(incoming.id) &&
    used.size >= PREVIEW_PROXY_LIMITS.cacheEntries
    ? "This preview supports up to four 4K sources. Use 1080p copies for additional clips."
    : null;
}

function fixedVideoBox(node: SceneNodeInput): boolean {
  const fixed = (value: unknown) => value !== undefined && value !== "auto";
  return (
    fixed(node.style?.width) &&
    fixed(node.style?.height) &&
    !["none", "scale-down"].includes(node.style?.objectFit ?? "contain") &&
    node.style?.imageRendering !== "pixelated" &&
    node.style?.pixelSize === undefined &&
    !(node.animations ?? []).some(
      (animation) =>
        ["objectFit", "imageRendering", "pixelSize"].includes(
          animation.property,
        ) ||
        (["width", "height"].includes(animation.property) &&
          animation.frames.some((frame) => frame.value === "auto")),
    )
  );
}

/** Only hash-addressed original browser blobs with layout-independent scaling. */
export function previewProxyCandidates(scene: Scene): PreviewProxyRequest[] {
  // Source proxies preserve fixed video geometry independently of backing-canvas
  // scale. Caption shadows and other unrelated overlays must not disable them.
  const references = new Map<string, SceneNodeInput[]>();
  const visit = (nodes: SceneNodeInput[]) => {
    for (const node of nodes) {
      if (node.type === "video" && node.assetId)
        references.set(node.assetId, [
          ...(references.get(node.assetId) ?? []),
          node,
        ]);
      visit(node.children ?? []);
    }
  };
  visit(scene.nodes);
  return Object.values(scene.assets)
    .flatMap((asset) => {
      const match = /^local:(?:sha256:)?([a-f0-9]{64})$/.exec(asset.id);
      const bytes = asset.metadata?.byteLength;
      if (
        !match ||
        asset.type !== "video" ||
        !asset.src.startsWith("blob:") ||
        asset.proxy ||
        !bytes ||
        bytes > PREVIEW_PROXY_LIMITS.inputBytes ||
        !previewProxyDimensions(
          asset.metadata?.width ?? 0,
          asset.metadata?.height ?? 0,
        ) ||
        !references.get(asset.id)?.every(fixedVideoBox)
      )
        return [];
      if (
        asset.metadata?.contentHash &&
        asset.metadata.contentHash !== match[1]
      )
        return [];
      return [
        {
          assetId: asset.id,
          sourceHash: match[1]!,
          src: asset.src,
          sourceBytes: bytes,
        },
      ];
    })
    .slice(0, PREVIEW_PROXY_LIMITS.cacheEntries);
}

export function applyPreviewProxies(
  scene: Scene,
  proxies: ReadonlyMap<
    string,
    { originalSrc: string; proxy: NonNullable<SceneAsset["proxy"]> }
  >,
): Scene {
  let changed = false;
  const assets = Object.fromEntries(
    Object.entries(scene.assets).map(([id, asset]) => {
      const replacement = proxies.get(id);
      if (!replacement || replacement.originalSrc !== asset.src || asset.proxy)
        return [id, asset];
      changed = true;
      return [id, { ...asset, proxy: replacement.proxy }];
    }),
  );
  return changed ? { ...scene, assets } : scene;
}

export async function previewProxyDigest(bytes: ArrayBuffer): Promise<string> {
  return [...new Uint8Array(await crypto.subtle.digest("SHA-256", bytes))]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

export function validatePreviewProxyManifest(
  value: unknown,
  request: PreviewProxyRequest,
): PreviewProxyManifest {
  const manifest = value as PreviewProxyManifest;
  if (
    !manifest ||
    ![2, 3].includes(manifest.version) ||
    manifest.sourceHash !== request.sourceHash ||
    manifest.sourceBytes !== request.sourceBytes ||
    !/^[a-f0-9]{64}$/.test(manifest.proxyHash) ||
    !/^[a-f0-9]{64}$/.test(manifest.videoTimingHash) ||
    (manifest.audioHash !== null &&
      !/^[a-f0-9]{64}$/.test(manifest.audioHash)) ||
    !Number.isInteger(manifest.proxyBytes) ||
    manifest.proxyBytes < 1 ||
    manifest.proxyBytes > PREVIEW_PROXY_LIMITS.outputBytes ||
    !Number.isFinite(manifest.duration) ||
    manifest.duration <= 0 ||
    manifest.duration > PREVIEW_PROXY_LIMITS.durationSeconds ||
    !Number.isFinite(manifest.videoDuration) ||
    manifest.videoDuration <= 0 ||
    manifest.videoDuration > manifest.duration + 0.00001 ||
    typeof manifest.audioFromOriginal !== "boolean" ||
    (manifest.version === 2
      ? manifest.audioFromOriginal !==
        isHighResolutionVideo(manifest.sourceWidth, manifest.sourceHeight)
      : (manifest.audioFirstTimestamp === null) !==
          (manifest.audioPackets === 0) ||
        (manifest.audioFirstTimestamp !== null &&
          (!Number.isFinite(manifest.audioFirstTimestamp) ||
            manifest.audioFirstTimestamp <
              -EDITOR_MEDIA_ADMISSION.audioPrerollSeconds ||
            manifest.audioFirstTimestamp > manifest.duration)) ||
        manifest.audioFromOriginal !==
          previewProxyUsesOriginalAudio(
            manifest.sourceWidth,
            manifest.sourceHeight,
            manifest.audioFirstTimestamp,
          )) ||
    !Number.isInteger(manifest.videoFrames) ||
    manifest.videoFrames < 1 ||
    manifest.videoFrames > PREVIEW_PROXY_LIMITS.videoFrames ||
    !Number.isInteger(manifest.audioPackets) ||
    manifest.audioPackets < 0 ||
    manifest.audioPackets > PREVIEW_PROXY_LIMITS.audioPackets ||
    (manifest.audioHash === null) !== (manifest.audioPackets === 0) ||
    !Number.isFinite(manifest.createdAt)
  )
    throw new Error("Invalid preview proxy cache manifest.");
  const dimensions = previewProxyDimensions(
    manifest.sourceWidth,
    manifest.sourceHeight,
  );
  if (
    !dimensions ||
    dimensions.width !== manifest.width ||
    dimensions.height !== manifest.height
  )
    throw new Error("Preview proxy aspect ratio is not exact.");
  return manifest;
}
