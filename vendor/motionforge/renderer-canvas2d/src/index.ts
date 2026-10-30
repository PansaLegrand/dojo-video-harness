import { fontAssetIdsForFamily, fontFamilyNames } from "@motionforge/schema";
import {
  audioReactiveSourceTime,
  collectAudioReactiveSourceRanges,
  audioReactiveAnalysisWindow,
} from "./audio-reactive";
export {
  audioReactiveSourceTime,
  collectAudioReactiveSourceRanges,
  audioReactiveAnalysisWindow,
  type AudioReactiveSourceRange,
} from "./audio-reactive";
import {
  compileDisplayList,
  createBoundedTextMetricsProvider,
  evaluateScene,
  identityAffineMatrix,
  layoutScene,
  multiplyAffineMatrices,
  normalizeLayoutCornerRadii,
  prepareTextLayout,
  resolveObjectFitRect,
  resolveLayoutCornerRadii,
  resolveStyleTransformMatrix,
  transformLayoutRect,
  wrapTextLines,
  type AffineMatrix2D,
  type DisplayExtensionCompilationInput,
  type DisplayExtensionOperation,
  type DisplayGroup,
  type DisplayList,
  type DisplayListCompilerBudgets,
  type DisplayTextOperation,
  type LayoutCornerRadii,
  type LayoutBox,
  type LayoutRect,
  type MediaMetricsProvider,
  type MeasureTextLine,
  type TextMetricsProvider,
  type ResolvedNode,
  type ResolvedScene,
} from "@motionforge/core";
import {
  inspectScene,
  parseScene,
  isAudioReactiveEffect,
  type Scene,
  type SceneAsset,
  type SceneNode,
  type SceneShapeGeometry,
  type SceneStyle,
  type SceneTextRun,
} from "@motionforge/schema";
import {
  parseBorderValue,
  parseConicGradientValue,
  parseFilterValue,
  parseLinearGradientValue,
  parseRadialGradientValue,
  parseShadowListValue,
  parseShadowValue,
  parseTransformOriginValue,
  parseTransformValue,
  resolveGradientStopOffsets,
  type TransformOriginComponent,
} from "@motionforge/schema/values";
import {
  createExtensionRegistry,
  extensionResourceReuseKey,
  legacyExtensionRendererCapability,
  preflightExtensions,
  type ExtensionDisplayTarget,
  type ExtensionRegistry,
  type ExtensionPreflightIssue,
  type ExtensionSceneNode,
  type ResolvedExtensionNode,
} from "@motionforge/extensions";
import {
  AssetPolicyError,
  AudioAnalysisCache as BoundedAudioAnalysisCache,
  FontAssetCache,
  assetDeclarationKey,
  createBoundedAssetFetch,
  fetchAssetBounded,
  prepareAssetRequest,
  readResponseBytes,
  type AssetPolicy,
  type AssetSourceKind,
  type PreparedAssetRequest,
} from "./media-lifecycle";
import {
  compileResolvedCanvas2DDisplayExtension,
  executeCanvas2DDisplayExtension,
  type Canvas2DExtensionPreparedImage,
  type Canvas2DOpaqueExtensionRegistry,
} from "./extension-display";
import {
  Canvas2DStaticDisplayCache,
  isStaticDisplayGroup,
  type StaticDisplayResourceReference,
} from "./display-cache";
import { ScratchSurfacePool, checkedRgbaBytes } from "./surface-pool";
import {
  BoundedTextMeasureCache,
  type TextMeasureCache,
} from "./text-measure-cache";

export {
  Canvas2DStaticDisplayCache,
  StaticDisplayCache,
  fingerprintStaticDisplayGroup,
  isStaticDisplayGroup,
  type Canvas2DStaticDisplayBounds,
  type Canvas2DStaticDisplayCacheOptions,
  type Canvas2DStaticDisplayCacheStats,
  type Canvas2DStaticDisplaySurface,
  type StaticDisplayCacheDisposalReason,
  type StaticDisplayCacheOptions,
  type StaticDisplayCacheStats,
  type StaticDisplayFingerprint,
  type StaticDisplayFingerprintOptions,
  type StaticDisplayResourceIdentity,
  type StaticDisplayResourceReference,
} from "./display-cache";
export {
  BoundedTextMeasureCache,
  type TextMeasureCache,
  type TextMeasureCacheOptions,
  type TextMeasureCacheStats,
} from "./text-measure-cache";
export {
  AssetPolicyError,
  AudioAnalysisCache as BoundedAudioAnalysisCache,
  FontAssetCache,
  assetDeclarationKey,
  createAudioAnalysisCache as createBoundedAudioAnalysisCache,
  type AssetPolicy,
  type AssetPolicyContext,
  type AssetSourceKind,
  type CacheStats,
  type FontCacheStats,
  type FontLease,
  type PreparedAssetRequest,
} from "./media-lifecycle";
export {
  compileResolvedCanvas2DDisplayExtension,
  createCanvas2DOpaqueExtensionRegistry,
  executeCanvas2DDisplayExtension,
  type Canvas2DExtensionDisplayContext,
  type Canvas2DExtensionPreparedImage,
  type Canvas2DLegacyExtensionDrawContext,
  type Canvas2DOpaqueExtensionDrawContext,
  type Canvas2DOpaqueExtensionHandler,
  type Canvas2DOpaqueExtensionOperation,
  type Canvas2DOpaqueExtensionRegistry,
  type CompileResolvedCanvas2DDisplayExtensionOptions,
  type ExecuteCanvas2DDisplayExtensionOptions,
  type ResolvedCanvas2DDisplayExtension,
} from "./extension-display";
export {
  SCRATCH_SURFACE_BUCKET_SIZE,
  ScratchSurfacePool,
  ScratchSurfacePoolError,
  checkedRgbaBytes,
  type Canvas2DSurface,
  type Canvas2DSurfaceContext,
  type DetachedScratchSurface,
  type ScratchSurfaceBounds,
  type ScratchSurfaceFactory,
  type ScratchSurfaceLease,
  type ScratchSurfacePoolErrorCode,
  type ScratchSurfacePoolOptions,
  type ScratchSurfacePoolStats,
  type ScratchSurfaceReleaseOptions,
} from "./surface-pool";

// Re-exported so existing imports keep working; the implementation moved to
// @motionforge/core where layout uses it for intrinsic text sizing.
export { wrapTextLines };
import {
  ALL_FORMATS,
  AudioSampleSink,
  BlobSource,
  CanvasSink,
  Input,
  UrlSource,
  type AudioSample,
  type InputVideoTrack,
  type WrappedCanvas,
} from "mediabunny";

export type RenderOptions = {
  clear?: boolean;
  /** Result of resolveAssets(). Required when the scene draws img/video nodes. */
  assets?: ResolvedAssets;
  /** A scene frame already resolved by prepareFrame(). */
  resolvedScene?: ResolvedScene;
  /** Reused across frames to avoid repeated canvas text measurement. */
  textMeasureCache?: TextMeasureCache;
  /**
   * Session-owned bounded scratch storage for isolated groups and soft masks.
   * Omit it for a render-call-scoped pool that is always disposed before
   * renderStill() returns.
   */
  scratchSurfacePool?: ScratchSurfacePool;
  /** Exact opaque extension handlers for the execution realm. */
  opaqueExtensionRegistry?: Canvas2DOpaqueExtensionRegistry;
  /** Caller-owned bounded cache for already-isolated static subtrees. */
  staticDisplayCache?: Canvas2DStaticDisplayCache;
};

export type ResolveAssetsOptions = {
  /** Trusted definitions available to extension nodes in this scene. */
  extensions?: ExtensionRegistry;
  /** Reject definitions that cannot execute in a worker host. */
  worker?: boolean;
  /** Exact opaque extension handlers advertised during display preflight. */
  opaqueExtensionRegistry?: Canvas2DOpaqueExtensionRegistry;
  signal?: AbortSignal;
  /** Use declared proxy sources (normally true for preview, false for export). */
  preferProxy?: boolean;
  /** Opt-in picture proxies may omit audio. Resolve their soundtrack from the
   * primary asset without opening a primary video decoder. Default: proxy. */
  videoProxyAudio?: "proxy" | "original";
  budget?: Partial<MediaResourceBudget>;
  analysisCache?: AudioAnalysisCache;
  /** Host-owned URL, credential, proxy, MIME, and byte policy. */
  assetPolicy?: AssetPolicy;
  /** Optional host-owned bounded font cache. */
  fontCache?: FontAssetCache<FontFace>;
  /** Precompute cached editor waveforms for reachable audio assets. */
  analyzeWaveforms?: boolean;
  /**
   * A live lease from an earlier Scene revision. Matching reachable resources
   * are retained by stable content identity instead of fetched/decoded again.
   * The old and new leases remain independently disposable.
   */
  reuseFrom?: { scene: unknown; assets: ResolvedAssets };
};

export type MediaResourceBudget = {
  maxSourceCacheBytes: number;
  maxDecodedImageBytes: number;
  maxVideoDecoders: number;
  /** Maximum bytes for any one buffered/direct asset. Optional for 1.0 compatibility. */
  maxAssetBytes?: number;
  /** Process-owned analysis cache ceiling; host-owned caches set their own policy. */
  maxAudioAnalysisCacheBytes?: number;
  /** Reachable fonts allowed in one resolution. Inject fontCache to own a different resident ceiling. */
  maxFontCacheEntries?: number;
  /** Maximum wait for a Lottie document to become ready. */
  maxLottieWaitMs?: number;
};

export const defaultMediaResourceBudget: MediaResourceBudget = {
  maxSourceCacheBytes: 64 * 1024 * 1024,
  maxDecodedImageBytes: 256 * 1024 * 1024,
  maxVideoDecoders: 8,
  maxAssetBytes: 512 * 1024 * 1024,
  maxAudioAnalysisCacheBytes: 64 * 1024 * 1024,
  maxFontCacheEntries: 32,
  maxLottieWaitMs: 15_000,
};

export function resolveMediaResourceBudget(
  overrides: Partial<MediaResourceBudget> = {},
): MediaResourceBudget {
  const budget = { ...defaultMediaResourceBudget, ...overrides };
  const finiteNonnegative = [
    "maxSourceCacheBytes",
    "maxDecodedImageBytes",
    "maxAssetBytes",
    "maxAudioAnalysisCacheBytes",
    "maxLottieWaitMs",
  ] as const;
  for (const key of finiteNonnegative) {
    const value = budget[key];
    if (value === undefined || !Number.isFinite(value) || value < 0) {
      throw new Error(`${key} must be a finite non-negative number.`);
    }
  }
  if (
    !Number.isInteger(budget.maxVideoDecoders) ||
    budget.maxVideoDecoders < 1
  ) {
    throw new Error("maxVideoDecoders must be a positive integer.");
  }
  if (
    budget.maxFontCacheEntries === undefined ||
    !Number.isInteger(budget.maxFontCacheEntries) ||
    budget.maxFontCacheEntries < 1
  ) {
    throw new Error("maxFontCacheEntries must be a positive integer.");
  }
  return budget;
}

export type Canvas2DExtensionDrawContext<
  P = unknown,
  ExtensionAssets = unknown,
  ExtensionFrame = unknown,
> = {
  context: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;
  scene: Scene;
  node: ResolvedNode & ExtensionSceneNode;
  box: LayoutBox;
  params: P;
  resolvedAssets: ExtensionAssets;
  preparedFrame: ExtensionFrame;
  sceneFrame: number;
  localFrame: number;
  sceneFps: number;
};

export type Canvas2DExtensionAdapter<
  P = unknown,
  ExtensionAssets = unknown,
  ExtensionFrame = unknown,
> = {
  draw(
    context: Canvas2DExtensionDrawContext<P, ExtensionAssets, ExtensionFrame>,
  ): void;
};

export type ResolvedCanvas2DExtensionNode = Omit<
  ResolvedExtensionNode,
  "rendererAdapter"
> & {
  /** Present only for the explicit legacy-opaque compatibility path. */
  adapter?: Canvas2DExtensionAdapter;
  resolvedAssets: unknown;
};

export type PreparedExtensionFrame = {
  sceneFrame: number;
  value: unknown;
};

export type Canvas2DPreflightIssue = {
  severity: "error" | "warning";
  code:
    | "audio_decoder_unavailable"
    | "canvas_unavailable"
    | "font_loading_unavailable"
    | "filter_unavailable"
    | "letter_spacing_unavailable"
    | "image_decoder_unavailable"
    | "lottie_requires_dom"
    | "extension_adapter_invalid"
    | "extension_registry_realm_mismatch"
    | "dom_matrix_unavailable"
    | "path2d_unavailable"
    | "conic_gradient_unavailable"
    | "video_decoder_budget_exceeded"
    | "decoded_image_budget_estimate_exceeded"
    | "asset_byte_budget_exceeded"
    | "video_decoder_unavailable";
  message: string;
};

export type Canvas2DPreflightResult = {
  ok: boolean;
  renderer: "canvas2d";
  requirements: {
    canvas: boolean;
    imageDecoder: boolean;
    videoDecoder: boolean;
    audioDecoder: boolean;
    fontLoading: boolean;
    domLottie: boolean;
    extensions: boolean;
    path2d: boolean;
    domMatrix: boolean;
    filter: boolean;
    conicGradient: boolean;
    letterSpacing: boolean;
  };
  issues: Array<Canvas2DPreflightIssue | ExtensionPreflightIssue>;
  resourceEstimate: MediaResourceEstimate;
};

export type Canvas2DPreflightOptions = Pick<
  ResolveAssetsOptions,
  "extensions" | "worker" | "budget" | "opaqueExtensionRegistry"
>;

export type MediaResourceEstimate = {
  declaredAssets: number;
  reachableAssets: number;
  proxyAssets: number;
  estimatedDecodedImageBytes: number;
  maxSimultaneousVideoDecoders: number;
};

function createCanvas2DDisplayTarget(
  worker: boolean | undefined,
  opaqueRegistry: Canvas2DOpaqueExtensionRegistry | undefined,
): ExtensionDisplayTarget {
  const realm = worker === true ? "worker" : "main";
  if (opaqueRegistry && opaqueRegistry.realm !== realm) {
    throw new Error(
      `Canvas2D opaque extension registry targets the ${opaqueRegistry.realm} realm, but this render targets ${realm}.`,
    );
  }
  return Object.freeze({
    version: "1",
    backendId: "canvas2d",
    realm,
    capabilities: Object.freeze([
      Object.freeze({
        ...legacyExtensionRendererCapability,
        realms: Object.freeze(["main", "worker"] as const),
      }),
      ...(opaqueRegistry?.capabilities ?? []),
    ]),
  });
}

/**
 * Checks environment capabilities before asset loading or frame preparation.
 * This is intentionally synchronous: codec-specific negotiation remains the
 * exporter's job, while obvious unsupported runtime combinations fail early.
 */
export function preflightCanvas2D(
  sceneInput: unknown,
  globalObject: Partial<typeof globalThis> = globalThis,
  options: Canvas2DPreflightOptions = {},
): Canvas2DPreflightResult {
  const scene = parseScene(sceneInput);
  const budget = resolveMediaResourceBudget(options.budget);
  const inspection = inspectScene(scene);
  const expectedRealm = options.worker === true ? "worker" : "main";
  const registryRealmMismatch =
    options.opaqueExtensionRegistry !== undefined &&
    options.opaqueExtensionRegistry.realm !== expectedRealm;
  const extensionPreflight = preflightExtensions(
    scene,
    options.extensions ?? createExtensionRegistry(),
    {
      worker: options.worker,
      displayTarget: createCanvas2DDisplayTarget(
        options.worker,
        registryRealmMismatch ? undefined : options.opaqueExtensionRegistry,
      ),
    },
  );
  const reachableAssetIds = collectReachableAssetIds(
    scene,
    extensionPreflight.nodes,
  );
  const reachableAssets = Array.from(reachableAssetIds)
    .map((id) => scene.assets[id])
    .filter((asset): asset is NonNullable<typeof asset> => Boolean(asset));
  const reachableByType = (type: (typeof reachableAssets)[number]["type"]) =>
    reachableAssets.filter((asset) => asset.type === type);
  const reachableImages = reachableByType("image");
  const reachableVideos = reachableByType("video");
  const reachableAudio = reachableByType("audio");
  const reachableFonts = reachableByType("font");
  const reachableLotties = reachableByType("lottie");
  const needsAudioDecoder =
    reachableAudio.length > 0 ||
    reachableVideos.some((asset) => asset.metadata?.hasAudio === true);
  const resourceEstimate = estimateMediaResources(
    scene,
    extensionPreflight.nodes,
  );
  const documentObject = globalObject.document;
  const hasDomCanvas = Boolean(documentObject?.createElement);
  const hasOffscreenCanvas = typeof globalObject.OffscreenCanvas === "function";
  const hasCanvas = hasDomCanvas || hasOffscreenCanvas;
  const hasImageDecoder = typeof globalObject.createImageBitmap === "function";
  const hasVideoDecoder = typeof globalObject.VideoDecoder === "function";
  const hasAudioDecoder = typeof globalObject.AudioDecoder === "function";
  const hasPath2D = typeof globalObject.Path2D === "function";
  const hasDomMatrix = typeof globalObject.DOMMatrix === "function";
  const hasFontLoading = Boolean(
    typeof globalObject.FontFace === "function" &&
    (documentObject?.fonts ||
      (globalObject as Partial<typeof globalThis> & { fonts?: FontFaceSet })
        .fonts),
  );
  const visualRequirements = inspectVisualRuntimeRequirements(scene.nodes);
  const canvasContext = probeCanvas2DContext(
    globalObject,
    documentObject,
    options.worker === true,
  );
  const hasCanvasFilter = Boolean(canvasContext && "filter" in canvasContext);
  const hasLetterSpacing = Boolean(
    canvasContext && "letterSpacing" in canvasContext,
  );
  const hasConicGradient = Boolean(
    canvasContext && typeof canvasContext.createConicGradient === "function",
  );
  const issues: Array<Canvas2DPreflightIssue | ExtensionPreflightIssue> = [];

  if (registryRealmMismatch) {
    issues.push({
      severity: "error",
      code: "extension_registry_realm_mismatch",
      message: `Canvas2D opaque extension registry targets the ${options.opaqueExtensionRegistry?.realm} realm, but this render targets ${expectedRealm}.`,
    });
  }

  if (!hasCanvas || !canvasContext) {
    issues.push({
      severity: "error",
      code: "canvas_unavailable",
      message:
        "Canvas2D rendering needs OffscreenCanvas or a DOM canvas element.",
    });
  }
  if (reachableImages.length > 0 && !hasImageDecoder) {
    issues.push({
      severity: "error",
      code: "image_decoder_unavailable",
      message: "Image assets need createImageBitmap in this renderer.",
    });
  }
  if (reachableVideos.length > 0 && !hasVideoDecoder) {
    issues.push({
      severity: "error",
      code: "video_decoder_unavailable",
      message: "Video assets need the WebCodecs VideoDecoder API.",
    });
  }
  if (needsAudioDecoder && !hasAudioDecoder) {
    issues.push({
      severity: "error",
      code: "audio_decoder_unavailable",
      message: "Audio assets need the WebCodecs AudioDecoder API.",
    });
  }
  if (reachableFonts.length > 0 && !hasFontLoading) {
    issues.push({
      severity: "error",
      code: "font_loading_unavailable",
      message:
        "Font assets need FontFace plus document.fonts or a worker FontFaceSet.",
    });
  }
  if (reachableLotties.length > 0 && !hasDomCanvas) {
    issues.push({
      severity: "error",
      code: "lottie_requires_dom",
      message:
        "The current Lottie adapter requires a DOM canvas; render this scene on the main thread or omit Lottie assets.",
    });
  }
  const needsPath2D =
    inspection.capabilities.hasShapes ||
    inspection.capabilities.hasClipping ||
    inspection.capabilities.hasMasks;
  if (needsPath2D && !hasPath2D) {
    issues.push({
      severity: "error",
      code: "path2d_unavailable",
      message:
        "Shape, clip, and mask nodes need the Canvas Path2D API in this renderer.",
    });
  }
  if (inspection.capabilities.hasVectorPaths && !hasDomMatrix) {
    issues.push({
      severity: "error",
      code: "dom_matrix_unavailable",
      message:
        "SVG path geometry needs DOMMatrix to map its viewBox into the node box.",
    });
  }
  if (visualRequirements.filter && !hasCanvasFilter) {
    issues.push({
      severity: "error",
      code: "filter_unavailable",
      message:
        "This scene uses Canvas2D filters, but the selected canvas runtime has no context.filter support.",
    });
  }
  if (visualRequirements.conicGradient && !hasConicGradient) {
    issues.push({
      severity: "error",
      code: "conic_gradient_unavailable",
      message:
        "This scene uses a conic gradient, but the selected canvas runtime has no createConicGradient() support.",
    });
  }
  if (visualRequirements.letterSpacing && !hasLetterSpacing) {
    issues.push({
      severity: "error",
      code: "letter_spacing_unavailable",
      message:
        "This scene uses text letter spacing, but the selected canvas runtime has no context.letterSpacing support.",
    });
  }
  if (resourceEstimate.maxSimultaneousVideoDecoders > budget.maxVideoDecoders) {
    issues.push({
      severity: "error",
      code: "video_decoder_budget_exceeded",
      message: `Scene may need ${resourceEstimate.maxSimultaneousVideoDecoders} simultaneous video decoders, above the budget of ${budget.maxVideoDecoders}.`,
    });
  }
  if (
    resourceEstimate.estimatedDecodedImageBytes > budget.maxDecodedImageBytes
  ) {
    issues.push({
      severity: "error",
      code: "decoded_image_budget_estimate_exceeded",
      message: `Declared image dimensions estimate ${resourceEstimate.estimatedDecodedImageBytes} decoded bytes, above the budget of ${budget.maxDecodedImageBytes}.`,
    });
  }
  const maxAssetBytes =
    budget.maxAssetBytes ??
    defaultMediaResourceBudget.maxAssetBytes ??
    Infinity;
  for (const asset of reachableAssets) {
    if (
      asset.metadata?.byteLength !== undefined &&
      asset.metadata.byteLength > maxAssetBytes
    ) {
      issues.push({
        severity: "error",
        code: "asset_byte_budget_exceeded",
        message: `Asset "${asset.id}" declares ${asset.metadata.byteLength} bytes, above the per-asset budget of ${maxAssetBytes}. Use a proxy or raise maxAssetBytes.`,
      });
    }
  }
  issues.push(...extensionPreflight.issues);
  for (const resolvedNode of extensionPreflight.nodes) {
    if (
      resolvedNode.displayDecision.kind === "legacy-opaque" &&
      !isCanvas2DExtensionAdapter(resolvedNode.rendererAdapter)
    ) {
      issues.push({
        severity: "error",
        code: "extension_adapter_invalid",
        message: `Extension ${resolvedNode.node.extension.name}@${resolvedNode.definition.version} declares canvas2d support but its adapter has no draw(context) function.`,
      });
    }
  }

  return {
    ok: !issues.some((issue) => issue.severity === "error"),
    renderer: "canvas2d",
    requirements: {
      canvas: true,
      imageDecoder: reachableImages.length > 0,
      videoDecoder: reachableVideos.length > 0,
      audioDecoder: needsAudioDecoder,
      fontLoading: reachableFonts.length > 0,
      domLottie: reachableLotties.length > 0,
      extensions: inspection.capabilities.hasExtensions,
      path2d: needsPath2D,
      domMatrix: inspection.capabilities.hasVectorPaths,
      filter: visualRequirements.filter,
      conicGradient: visualRequirements.conicGradient,
      letterSpacing: visualRequirements.letterSpacing,
    },
    issues,
    resourceEstimate,
  };
}

function inspectVisualRuntimeRequirements(nodes: readonly SceneNode[]): {
  filter: boolean;
  conicGradient: boolean;
  letterSpacing: boolean;
} {
  let filter = false;
  let conicGradient = false;
  let letterSpacing = false;
  const stack = [...nodes];
  while (stack.length > 0) {
    const node = stack.pop();
    if (!node) continue;
    if (node.style?.filter && node.style.filter !== "none") filter = true;
    if ((node.mask?.feather ?? 0) > 0) filter = true;
    if (isNonzeroLength(node.style?.letterSpacing)) letterSpacing = true;
    for (const paint of [
      node.style?.background,
      node.style?.fill,
      node.style?.stroke,
    ]) {
      if (paint && parseConicGradientValue(paint)) conicGradient = true;
    }
    for (const animation of node.animations ?? []) {
      if (
        animation.property === "filter" &&
        animation.frames.some(
          (frame) => typeof frame.value === "string" && frame.value !== "none",
        )
      ) {
        filter = true;
      }
      if (
        (animation.property === "background" ||
          animation.property === "fill" ||
          animation.property === "stroke") &&
        animation.frames.some(
          (frame) =>
            typeof frame.value === "string" &&
            parseConicGradientValue(frame.value) !== null,
        )
      ) {
        conicGradient = true;
      }
      if (
        animation.property === "letterSpacing" &&
        animation.frames.some((frame) => isNonzeroLength(frame.value))
      ) {
        letterSpacing = true;
      }
    }
    stack.push(...(node.children ?? []));
  }
  return { filter, conicGradient, letterSpacing };
}

function isNonzeroLength(value: unknown): boolean {
  if (typeof value === "number") return value !== 0;
  if (typeof value !== "string") return false;
  const amount = Number.parseFloat(value);
  return Number.isFinite(amount) && amount !== 0;
}

function probeCanvas2DContext(
  globalObject: Partial<typeof globalThis>,
  documentObject: Document | undefined,
  preferOffscreen: boolean,
): CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D | null {
  const offscreen = () => {
    const Constructor = globalObject.OffscreenCanvas;
    if (typeof Constructor === "function") {
      return new Constructor(1, 1).getContext("2d");
    }
    return null;
  };
  try {
    if (preferOffscreen) return offscreen();
    const canvas = documentObject?.createElement?.("canvas");
    const context = canvas?.getContext?.("2d");
    if (context) return context;
    return offscreen();
  } catch {
    try {
      return offscreen();
    } catch {
      // Capability remains unavailable.
    }
  }
  return null;
}

/** A decodable video clip opened by resolveAssets(). */
export type VideoClip = {
  /** Clip duration in seconds. */
  duration: number;
  /** Natural display size of the video track. */
  width: number;
  height: number;
  /** The demuxed video track; cursors open decoders on it. Internal. */
  track: InputVideoTrack;
  /** Underlying input; closed by disposeAssets(). */
  input: Input;
  /** Separately owned primary soundtrack input when videoProxyAudio is original. */
  audioInput?: Input;
  /** The clip's own audio track, when it has one (mixed into exports). */
  audio?: {
    duration: number;
    sampleRate: number;
    numberOfChannels: number;
    sink: AudioSampleSink;
  };
};

/** A decodable audio clip opened by resolveAssets(). */
export type AudioClip = {
  /** Clip duration in seconds. */
  duration: number;
  sampleRate: number;
  numberOfChannels: number;
  /** Decoded PCM access; consumed by the export mixer. */
  sink: AudioSampleSink;
  /** Underlying input; closed by disposeAssets(). */
  input: Input;
};

type MediabunnyInputInternals = {
  _demuxerPromise?: Promise<{ dispose(): void }> | null;
};

/**
 * Disposes pinned Mediabunny Inputs without its 1.46 rejected-demuxer `.then()`
 * creating an unhandled child promise. Remove this shim after the dependency
 * handles the rejection internally.
 */
export function disposeMediaInputSafely(input: Input): void {
  if (input.disposed) return;
  const internals = input as Input & MediabunnyInputInternals;
  const demuxer = internals._demuxerPromise ?? null;
  if (demuxer) internals._demuxerPromise = null;
  try {
    input.dispose();
  } finally {
    if (demuxer) {
      void demuxer
        .then(
          (resolved) => {
            try {
              resolved.dispose();
            } catch {
              // Built-in cleanup aggregates resources it owns; this late
              // dependency continuation has no synchronous caller.
            }
          },
          () => undefined,
        )
        .catch(() => undefined);
    }
  }
}

/** Copies decoded PCM without constructing a Web Audio AudioBuffer. */
function copyAudioSampleChannels(sample: AudioSample): Float32Array[] {
  return Array.from({ length: sample.numberOfChannels }, (_, planeIndex) => {
    const channel = new Float32Array(sample.numberOfFrames);
    sample.copyTo(channel, { planeIndex, format: "f32-planar" });
    return channel;
  });
}

export type AudioSpectrum = {
  /** Absolute source time covered by the first analysis frame (legacy default 0). */
  startTime?: number;
  /** Seconds covered by the analysis; samples beyond it are silent. */
  duration?: number;
  fps: number;
  barCount: number;
  frameCount: number;
  values: Uint8Array;
};

export type AudioWaveform = {
  /** Absolute source offset of this waveform window (legacy default 0). */
  startTime?: number;
  duration: number;
  values: Float32Array;
};

export type AudioAnalysis = {
  spectrum?: AudioSpectrum;
  waveform: AudioWaveform;
};

export type AudioAnalysisCache = Map<string, AudioAnalysis> & {
  getOrCreate?(
    key: string,
    loader: () => AudioAnalysis | Promise<AudioAnalysis>,
  ): Promise<AudioAnalysis>;
};

export function createAudioAnalysisCache(
  maxBytes = defaultMediaResourceBudget.maxAudioAnalysisCacheBytes ??
    64 * 1024 * 1024,
): AudioAnalysisCache {
  return new BoundedAudioAnalysisCache<AudioAnalysis>(maxBytes);
}

const sharedAudioAnalysisCache = createAudioAnalysisCache();

/** A loaded Lottie animation opened by resolveAssets(). */
export type LottieClip = {
  /** Lottie frame rate (independent of scene fps). */
  fr: number;
  /** First/last animation frames (op is exclusive, per the Lottie format). */
  ip: number;
  op: number;
  /** Natural size of the animation document. */
  width: number;
  height: number;
  /** The lottie-web player, seeked by prepareFrame(); destroyed on dispose. */
  animation: {
    goToAndStop(value: number, isFrame?: boolean): void;
    destroy(): void;
  };
  /** The canvas the player renders into; copied into per-node staging. */
  canvas: HTMLCanvasElement;
};

type LottieReadyAnimation = LottieClip["animation"] & {
  addEventListener(name: string, handler: (...args: unknown[]) => void): void;
  removeEventListener(
    name: string,
    handler: (...args: unknown[]) => void,
  ): void;
};

/** @internal Cancellable readiness gate shared by DOM Lottie loading tests. */
export async function waitForLottieReady(
  animation: LottieReadyAnimation,
  signal?: AbortSignal,
  timeoutMs = 15_000,
): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    let settled = false;
    const finish = (error?: unknown) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      signal?.removeEventListener("abort", onAbort);
      animation.removeEventListener("DOMLoaded", onReady);
      animation.removeEventListener("data_failed", onFailed);
      if (error) reject(error);
      else resolve();
    };
    const onReady = () => finish();
    const onFailed = (error?: unknown) =>
      finish(
        error instanceof Error
          ? error
          : new Error("lottie-web reported data_failed."),
      );
    const onAbort = () => {
      try {
        assertNotAborted(signal);
      } catch (error) {
        finish(error);
      }
    };
    const timeout = setTimeout(
      () =>
        finish(new Error(`Lottie readiness timed out after ${timeoutMs}ms.`)),
      timeoutMs,
    );
    animation.addEventListener("DOMLoaded", onReady);
    animation.addEventListener("data_failed", onFailed);
    signal?.addEventListener("abort", onAbort, { once: true });
    if (signal?.aborted) onAbort();
  });
}

/** A decoded video frame staged for one scene frame by prepareFrame(). */
export type PreparedVideoFrame = {
  image: HTMLCanvasElement | OffscreenCanvas;
  width: number;
  height: number;
  /** The scene frame this image was prepared for; renderStill rejects stale frames. */
  sceneFrame: number;
};

export type ResolvedAssetSource = {
  assetId: string;
  declaredSource: string;
  resolvedSource: string;
  contentKey: string;
  usingProxy: boolean;
  sourceKind: AssetSourceKind;
  declarationKey: string;
  /** Decode/lifetime compatibility, stronger than content identity alone. */
  resourceKey?: string;
  assetType?: SceneAsset["type"];
  sourceMode?: NonNullable<SceneAsset["sourceMode"]>;
};

/**
 * Decoded media for a scene, produced by resolveAssets(). Asset loading is
 * the only async phase: given the same scene, frame, and resolved assets,
 * rendering is pure and deterministic.
 */
export type ResolvedAssets = {
  images: Map<string, ImageBitmap>;
  /** Loaded font faces, keyed by asset id (which is the font-family name). */
  fonts: Map<string, FontFace>;
  /** Opened video clips, keyed by asset id. */
  videos: Map<string, VideoClip>;
  /** Frames staged by prepareFrame(), keyed by video node id. */
  videoFrames: Map<string, PreparedVideoFrame>;
  /** Opened audio clips, keyed by asset id. */
  audio: Map<string, AudioClip>;
  /** Compact, deterministic per-frame spectra for audio-reactive effects. */
  audioSpectra?: Map<string, AudioSpectrum>;
  audioWaveforms?: Map<string, AudioWaveform>;
  /** Loaded Lottie animations, keyed by asset id. */
  lotties: Map<string, LottieClip>;
  /** Lottie frames staged by prepareFrame(), keyed by lottie node id. */
  lottieFrames: Map<string, PreparedVideoFrame>;
  /**
   * Sequential decode cursors created lazily by prepareFrame(), keyed by
   * video node id + asset id. Disposed by disposeAssets(); pruned to the
   * nodes active in the frame so idle nodes never hold a decoder.
   */
  videoCursors?: Map<string, VideoPlaybackCursor>;
  /** Validated definitions and node-scoped resources for extension nodes. */
  extensionNodes?: Map<string, ResolvedCanvas2DExtensionNode>;
  /** Node-local values staged by extension prepareFrame hooks. */
  extensionFrames?: Map<string, PreparedExtensionFrame>;
  /** Exact opaque handlers selected for this resolved execution realm. */
  opaqueExtensionRegistry?: Canvas2DOpaqueExtensionRegistry;
  budget?: MediaResourceBudget;
  resourceUsage?: {
    decodedImageBytes: number;
    reachableAssets: number;
    declaredAssets: number;
  };
  /** Source identity used to reject stale reuse after Scene asset changes. */
  resolvedSources?: Map<string, ResolvedAssetSource>;
};

type ResolvedAssetsLifecycle = {
  controller: AbortController;
  disposed: boolean;
  disposal?: Promise<void>;
  abortCleanups: Set<() => void>;
  fontLeases: Map<string, { release(): void }>;
  assetResources: Map<string, SharedAssetResource>;
  extensionResources: Map<string, SharedExtensionResource>;
};

type SharedAssetResourceValue =
  ImageBitmap | FontFace | VideoClip | AudioClip | LottieClip;

type SharedAssetResource = {
  readonly type: SceneAsset["type"];
  readonly resourceKey: string;
  readonly value: SharedAssetResourceValue;
  retain(): void;
  release(): Promise<void>;
  runExclusive<T>(operation: () => T | Promise<T>): Promise<T>;
};

type SharedExtensionResource = {
  readonly definition: ResolvedExtensionNode["definition"];
  readonly adapter: Canvas2DExtensionAdapter | undefined;
  readonly displayKey: string;
  readonly descriptorVersion: string;
  readonly worker: boolean;
  readonly reuseKey: string | null;
  readonly requirementsKey: string;
  readonly value: unknown;
  retain(): void;
  release(): Promise<void>;
  runExclusive<T>(operation: () => T | Promise<T>): Promise<T>;
};

const resolvedAssetsLifecycles = new WeakMap<
  ResolvedAssets,
  ResolvedAssetsLifecycle
>();
const framePreparationQueues = new WeakMap<ResolvedAssets, Promise<void>>();
const reuseObjectIdentities = new WeakMap<object, number>();
let nextReuseObjectIdentity = 1;

function reuseObjectIdentity(
  value: object | undefined,
  prefix: string,
): string {
  if (!value) return `${prefix}:default`;
  let identity = reuseObjectIdentities.get(value);
  if (!identity) {
    identity = nextReuseObjectIdentity;
    nextReuseObjectIdentity += 1;
    reuseObjectIdentities.set(value, identity);
  }
  return `${prefix}:${identity}`;
}

function getResolvedAssetsLifecycle(
  assets: ResolvedAssets,
): ResolvedAssetsLifecycle {
  let lifecycle = resolvedAssetsLifecycles.get(assets);
  if (!lifecycle) {
    lifecycle = {
      controller: new AbortController(),
      disposed: false,
      abortCleanups: new Set(),
      fontLeases: new Map(),
      assetResources: new Map(),
      extensionResources: new Map(),
    };
    resolvedAssetsLifecycles.set(assets, lifecycle);
  }
  return lifecycle;
}

function assertAssetsAlive(assets: ResolvedAssets): void {
  if (getResolvedAssetsLifecycle(assets).disposed) {
    throw new Error(
      "Resolved assets are disposed; call resolveAssets(scene) for a new lease.",
    );
  }
}

function resolvedAssetResourceKey(
  asset: SceneAsset,
  request: PreparedAssetRequest,
  options: {
    assetPolicy?: AssetPolicy;
    fontCache?: FontAssetCache<FontFace>;
    maxSourceCacheBytes: number;
    proxyAudio?: VideoProxyAudioRequest;
  },
): string {
  const policyIdentity = options.assetPolicy?.reuseKey
    ? `policy-key:${options.assetPolicy.reuseKey}`
    : reuseObjectIdentity(options.assetPolicy, "policy-object");
  const fontCacheIdentity =
    asset.type === "font"
      ? reuseObjectIdentity(options.fontCache, "font-cache")
      : "font-cache:n/a";
  return JSON.stringify([
    asset.id,
    asset.type,
    asset.sourceMode ?? "auto",
    request.sourceKind,
    request.contentKey,
    request.maxBytes ?? null,
    options.maxSourceCacheBytes,
    policyIdentity,
    fontCacheIdentity,
    asset.type === "font" ? fontDescriptors(asset) : null,
    options.proxyAudio?.kind === "primary"
      ? ["primary-audio", request.source, request.declarationKey, options.proxyAudio.request.source, options.proxyAudio.request.contentKey, options.proxyAudio.request.declarationKey, options.proxyAudio.request.maxBytes ?? null]
      : options.proxyAudio?.kind ? [options.proxyAudio.kind, request.source, request.declarationKey] : null,
  ]);
}

function createSharedAssetResource(
  type: SceneAsset["type"],
  resourceKey: string,
  value: SharedAssetResourceValue,
  dispose: () => void | Promise<void>,
): SharedAssetResource {
  let references = 1;
  let disposal: Promise<void> | undefined;
  let operationTail = Promise.resolve();
  return {
    type,
    resourceKey,
    value,
    retain() {
      if (references <= 0 || disposal) {
        throw new Error("Cannot retain a disposed MotionForge asset resource.");
      }
      references += 1;
    },
    release() {
      if (references <= 0) return disposal ?? Promise.resolve();
      references -= 1;
      if (references > 0) return Promise.resolve();
      disposal ??= operationTail.catch(() => undefined).then(() => dispose());
      return disposal;
    },
    runExclusive<T>(operation: () => T | Promise<T>): Promise<T> {
      const result = operationTail.catch(() => undefined).then(operation);
      operationTail = result.then(
        () => undefined,
        () => undefined,
      );
      return result;
    },
  };
}

function createSharedExtensionResource(
  resolvedNode: ResolvedExtensionNode,
  adapter: Canvas2DExtensionAdapter | undefined,
  reuseKey: string | null,
  requirementsKey: string,
  worker: boolean,
  value: unknown,
): SharedExtensionResource {
  let references = 1;
  let disposal: Promise<void> | undefined;
  let operationTail = Promise.resolve();
  return {
    definition: resolvedNode.definition,
    adapter,
    displayKey: extensionDisplayDecisionKey(resolvedNode.displayDecision),
    descriptorVersion: resolvedNode.node.extension.version,
    worker,
    reuseKey,
    requirementsKey,
    value,
    retain() {
      if (references <= 0 || disposal) {
        throw new Error(
          "Cannot retain a disposed MotionForge extension resource.",
        );
      }
      references += 1;
    },
    release() {
      if (references <= 0) return disposal ?? Promise.resolve();
      references -= 1;
      if (references > 0) return Promise.resolve();
      disposal ??= operationTail
        .catch(() => undefined)
        .then(() => resolvedNode.definition.disposeAssets?.(value));
      return disposal;
    },
    runExclusive<T>(operation: () => T | Promise<T>): Promise<T> {
      const result = operationTail.catch(() => undefined).then(operation);
      operationTail = result.then(
        () => undefined,
        () => undefined,
      );
      return result;
    },
  };
}

function extensionDisplayDecisionKey(
  decision: ResolvedExtensionNode["displayDecision"],
): string {
  switch (decision.kind) {
    case "standard":
      return `standard:${decision.version}`;
    case "opaque":
      return `opaque:${decision.capability.id}@${decision.capability.version}:${decision.realm}`;
    case "legacy-opaque":
      return `legacy:${decision.renderer}:${decision.capability.id}@${decision.capability.version}:${decision.realm}`;
  }
}

function extensionRequirementsKey(
  requirements: ResolvedExtensionNode["requirements"],
  assets: ReadonlyMap<string, SceneAsset>,
  resolvedSources: ReadonlyMap<string, ResolvedAssetSource>,
): string {
  return JSON.stringify(
    requirements.map((requirement) => {
      const asset = assets.get(requirement.assetId);
      const source = resolvedSources.get(requirement.assetId);
      const identity = source?.resourceKey
        ? source.resourceKey
        : source
          ? JSON.stringify([
              source.assetType ?? asset?.type ?? null,
              source.sourceKind,
              source.contentKey,
            ])
          : asset
            ? JSON.stringify([
                asset.type,
                asset.metadata?.contentHash ?? assetDeclarationKey(asset),
              ])
            : null;
      return [
        requirement.assetId,
        requirement.type ?? null,
        requirement.optional,
        requirement.purpose ?? null,
        identity,
      ];
    }),
  );
}

function retainReusableExtensionResource(
  reuseFrom: ResolveAssetsOptions["reuseFrom"],
  resolvedNode: ResolvedExtensionNode,
  adapter: Canvas2DExtensionAdapter | undefined,
  reuseKey: string | null,
  requirementsKey: string,
  worker: boolean,
): SharedExtensionResource | undefined {
  if (!reuseFrom || reuseKey === null) return undefined;
  const previousLifecycle = getResolvedAssetsLifecycle(reuseFrom.assets);
  if (previousLifecycle.disposed) return undefined;
  const previous = previousLifecycle.extensionResources.get(
    resolvedNode.node.id,
  );
  const previousRuntime = reuseFrom.assets.extensionNodes?.get(
    resolvedNode.node.id,
  );
  if (
    !previous ||
    !previousRuntime ||
    previousRuntime.resolvedAssets !== previous.value ||
    previousRuntime.definition !== previous.definition ||
    previousRuntime.adapter !== previous.adapter ||
    extensionDisplayDecisionKey(previousRuntime.displayDecision) !==
      previous.displayKey ||
    previous.definition !== resolvedNode.definition ||
    previous.adapter !== adapter ||
    previous.displayKey !==
      extensionDisplayDecisionKey(resolvedNode.displayDecision) ||
    previous.descriptorVersion !== resolvedNode.node.extension.version ||
    previous.worker !== worker ||
    previous.reuseKey !== reuseKey ||
    previous.requirementsKey !== requirementsKey
  ) {
    return undefined;
  }
  try {
    previous.retain();
  } catch {
    return undefined;
  }
  return previous;
}

function bindSharedAssetResource(
  assets: ResolvedAssets,
  lifecycle: ResolvedAssetsLifecycle,
  assetId: string,
  resource: SharedAssetResource,
): void {
  lifecycle.assetResources.set(assetId, resource);
  switch (resource.type) {
    case "image":
      assets.images.set(assetId, resource.value as ImageBitmap);
      break;
    case "font":
      assets.fonts.set(assetId, resource.value as FontFace);
      break;
    case "video":
      assets.videos.set(assetId, resource.value as VideoClip);
      break;
    case "audio":
      assets.audio.set(assetId, resource.value as AudioClip);
      break;
    case "lottie":
      assets.lotties.set(assetId, resource.value as LottieClip);
      break;
  }
}

function retainReusableAssetResource(
  reuseFrom: ResolveAssetsOptions["reuseFrom"],
  asset: SceneAsset,
  resourceKey: string,
): SharedAssetResource | undefined {
  if (!reuseFrom) return undefined;
  const previousLifecycle = getResolvedAssetsLifecycle(reuseFrom.assets);
  if (previousLifecycle.disposed) return undefined;
  const previous = previousLifecycle.assetResources.get(asset.id);
  if (
    !previous ||
    previous.type !== asset.type ||
    previous.resourceKey !== resourceKey
  ) {
    return undefined;
  }
  const mappedValue =
    asset.type === "image"
      ? reuseFrom.assets.images.get(asset.id)
      : asset.type === "font"
        ? reuseFrom.assets.fonts.get(asset.id)
        : asset.type === "video"
          ? reuseFrom.assets.videos.get(asset.id)
          : asset.type === "audio"
            ? reuseFrom.assets.audio.get(asset.id)
            : reuseFrom.assets.lotties.get(asset.id);
  if (mappedValue !== previous.value) return undefined;
  try {
    previous.retain();
  } catch {
    return undefined;
  }
  return previous;
}

function assertNotAborted(signal: AbortSignal | undefined): void {
  if (signal?.aborted) {
    throw signal.reason instanceof Error
      ? signal.reason
      : new Error("MotionForge asset resolution was aborted.");
  }
}

function combineAbortSignals(signals: Array<AbortSignal | undefined>): {
  signal: AbortSignal;
  dispose(): void;
} {
  const controller = new AbortController();
  const cleanups: Array<() => void> = [];
  const abortFrom = (signal: AbortSignal) => {
    if (!controller.signal.aborted) controller.abort(signal.reason);
  };
  for (const signal of signals) {
    if (!signal) continue;
    if (signal.aborted) {
      abortFrom(signal);
      break;
    }
    const listener = () => abortFrom(signal);
    signal.addEventListener("abort", listener, { once: true });
    cleanups.push(() => signal.removeEventListener("abort", listener));
  }
  return {
    signal: controller.signal,
    dispose: () => cleanups.splice(0).forEach((cleanup) => cleanup()),
  };
}

async function awaitWithAbort<T>(
  promise: Promise<T>,
  signal: AbortSignal | undefined,
  onAbort?: () => void | Promise<void>,
): Promise<T> {
  assertNotAborted(signal);
  if (!signal) return promise;
  let listener: (() => void) | undefined;
  const aborted = new Promise<never>((_resolve, reject) => {
    listener = () => {
      void Promise.resolve(onAbort?.()).finally(() => {
        try {
          assertNotAborted(signal);
        } catch (error) {
          reject(error);
        }
      });
    };
    signal.addEventListener("abort", listener, { once: true });
  });
  try {
    return await Promise.race([promise, aborted]);
  } finally {
    if (listener) signal.removeEventListener("abort", listener);
  }
}

function parseCanvas2DExtensionAdapter(
  value: unknown,
  resolvedNode: ResolvedExtensionNode,
): Canvas2DExtensionAdapter {
  if (!isCanvas2DExtensionAdapter(value)) {
    throw new Error(
      `Extension ${resolvedNode.node.extension.name}@${resolvedNode.definition.version} declares canvas2d support but its adapter has no draw(context) function.`,
    );
  }
  return value as Canvas2DExtensionAdapter;
}

function isCanvas2DExtensionAdapter(
  value: unknown,
): value is Canvas2DExtensionAdapter {
  return (
    typeof value === "object" &&
    value !== null &&
    "draw" in value &&
    typeof value.draw === "function"
  );
}

/**
 * Yields decoded frames in presentation order starting at a timestamp; the
 * first yielded frame is the one covering the start timestamp. CanvasSink
 * satisfies this; tests substitute a scripted source.
 */
export type SequentialFrameSource = {
  canvases(
    startTimestamp?: number,
  ): AsyncGenerator<WrappedCanvas, void, unknown>;
};

/**
 * Forward jumps larger than this (seconds) re-seek from a keyframe instead
 * of decoding every intermediate frame. Below it, sequential advance wins:
 * a re-seek decodes from the previous keyframe anyway.
 */
const CURSOR_RESEEK_AHEAD_SECONDS = 1;

/**
 * Reused canvases per cursor: the staged frame, the peeked next frame, and
 * headroom for multi-frame advances within one prepareFrame() call.
 * CanvasSink writes a pool slot only when a frame is pulled, so the slot a
 * staged frame lives in is not touched again until this many pulls later —
 * by which time the frame has been drawn and replaced.
 */
const CURSOR_CANVAS_POOL_SIZE = 4;

/**
 * Sequential access to one video node's decoded frames. Playback and export
 * request monotonically increasing timestamps, so frames come from a single
 * canvases() iterator that decodes each packet exactly once — random-access
 * getCanvas() per frame re-decodes from the previous keyframe and cannot
 * keep up with real media. Backward seeks and far-forward jumps re-seek.
 */
export class VideoPlaybackCursor {
  private iterator: AsyncGenerator<WrappedCanvas, void, unknown> | null = null;
  private current: WrappedCanvas | null = null;
  private next: WrappedCanvas | null = null;
  private lastRequested = Number.NEGATIVE_INFINITY;

  constructor(private readonly source: SequentialFrameSource) {}

  /**
   * The frame covering `timestamp` (last frame starting at or before it), or
   * the clip's first frame for timestamps before it. Not reentrant: one
   * request at a time per cursor, which prepareFrame() guarantees by using
   * one cursor per video node.
   */
  async frameAt(timestamp: number): Promise<WrappedCanvas | null> {
    // A request between current and next needs no decoding at all — the
    // common case whenever the scene fps exceeds the clip fps.
    if (
      this.current &&
      timestamp >= this.current.timestamp &&
      (this.next === null || timestamp < this.next.timestamp)
    ) {
      this.lastRequested = timestamp;
      return this.current;
    }

    // `timestamp < current.timestamp` alone is not a backward seek: requests
    // before the clip's first frame resolve to that first frame, and
    // re-seeking for each of them would decode the head of the clip per
    // request. Only a decrease in requested time is a real seek.
    const seekedBackward =
      timestamp < this.lastRequested &&
      this.current !== null &&
      timestamp < this.current.timestamp;
    const jumpedFar =
      this.next !== null &&
      timestamp - this.next.timestamp > CURSOR_RESEEK_AHEAD_SECONDS;

    this.lastRequested = timestamp;

    if (this.iterator === null || seekedBackward || jumpedFar) {
      await this.reseek(timestamp);
    }

    while (this.next !== null && this.next.timestamp <= timestamp) {
      this.current = this.next;
      this.next = await this.pull();
    }

    return this.current;
  }

  private async reseek(timestamp: number): Promise<void> {
    await this.closeIterator();
    this.iterator = this.source.canvases(Math.max(0, timestamp));
    this.current = await this.pull();
    this.next = await this.pull();
  }

  private async pull(): Promise<WrappedCanvas | null> {
    if (!this.iterator) {
      return null;
    }

    const result = await this.iterator.next();
    return result.done ? null : result.value;
  }

  /** Terminates the decode pipeline. The cursor must not be used afterwards. */
  async dispose(): Promise<void> {
    await this.closeIterator();
  }

  private async closeIterator(): Promise<void> {
    const iterator = this.iterator;
    this.iterator = null;
    this.current = null;
    this.next = null;

    if (iterator) {
      await iterator.return(undefined);
    }
  }
}

const sharedFontCaches = new WeakMap<object, FontAssetCache<FontFace>>();

function getSharedFontCache(fontSet: FontFaceSet): FontAssetCache<FontFace> {
  let cache = sharedFontCaches.get(fontSet);
  if (!cache) {
    cache = new FontAssetCache<FontFace>({
      maxEntries: defaultMediaResourceBudget.maxFontCacheEntries ?? 32,
      maxBytes: 64 * 1024 * 1024,
      fontSet,
    });
    sharedFontCaches.set(fontSet, cache);
  }
  return cache;
}

/**
 * Fetches and decodes every asset the scene references. Call once per scene
 * (or whenever scene.assets changes) and pass the result to renderStill via
 * options.assets. Throws with the failing asset id and src on any failure;
 * a scene never renders with silently missing media.
 */
export async function resolveAssets(
  scene: Scene,
  options: ResolveAssetsOptions = {},
): Promise<ResolvedAssets> {
  const parsed = parseScene(scene);
  if (options.reuseFrom) {
    assertAssetsAlive(options.reuseFrom.assets);
    assertResolvedAssetsCompatible(
      parseScene(options.reuseFrom.scene),
      options.reuseFrom.assets,
    );
  }
  const budget = resolveMediaResourceBudget(options.budget);
  assertNotAborted(options.signal);
  const displayTarget = createCanvas2DDisplayTarget(
    options.worker,
    options.opaqueExtensionRegistry,
  );
  const extensionPreflight = preflightExtensions(
    parsed,
    options.extensions ?? createExtensionRegistry(),
    { displayTarget, worker: options.worker },
  );
  if (!extensionPreflight.ok) {
    throw new Error(
      `Canvas2D extension preflight failed:\n${extensionPreflight.issues
        .map((issue) => `- [${issue.code}] ${issue.message}`)
        .join("\n")}`,
    );
  }
  const extensionAdapters = new Map(
    extensionPreflight.nodes.map((resolvedNode) => [
      resolvedNode.node.id,
      resolvedNode.displayDecision.kind === "legacy-opaque"
        ? parseCanvas2DExtensionAdapter(
            resolvedNode.rendererAdapter,
            resolvedNode,
          )
        : undefined,
    ]),
  );
  const reachableAssetIds = collectReachableAssetIds(
    parsed,
    extensionPreflight.nodes,
  );
  const reachableFontCount = Array.from(reachableAssetIds).filter(
    (id) => parsed.assets[id]?.type === "font",
  ).length;
  const effectiveFontLimit = options.fontCache
    ? (budget.maxFontCacheEntries ?? 32)
    : Math.min(
        budget.maxFontCacheEntries ?? 32,
        defaultMediaResourceBudget.maxFontCacheEntries ?? 32,
      );
  if (reachableFontCount > effectiveFontLimit) {
    throw new Error(
      `Reachable font count ${reachableFontCount} exceeds maxFontCacheEntries. Supply a larger host-owned cache or reduce fonts.`,
    );
  }
  const images = new Map<string, ImageBitmap>();
  const fonts = new Map<string, FontFace>();
  const videos = new Map<string, VideoClip>();
  const audio = new Map<string, AudioClip>();
  const lotties = new Map<string, LottieClip>();
  const resolvedSources = new Map<string, ResolvedAssetSource>();
  let decodedImageBytes = 0;
  const resolvedAssets: ResolvedAssets = {
    images,
    fonts,
    videos,
    videoFrames: new Map(),
    audio,
    audioSpectra: new Map(),
    audioWaveforms: new Map(),
    lotties,
    lottieFrames: new Map(),
    extensionNodes: new Map(),
    extensionFrames: new Map(),
    opaqueExtensionRegistry: options.opaqueExtensionRegistry,
    budget,
    resourceUsage: {
      decodedImageBytes: 0,
      reachableAssets: reachableAssetIds.size,
      declaredAssets: Object.keys(parsed.assets).length,
    },
    resolvedSources,
  };
  const lifecycle = getResolvedAssetsLifecycle(resolvedAssets);
  const failureController = new AbortController();
  const combined = combineAbortSignals([
    options.signal,
    failureController.signal,
    lifecycle.controller.signal,
  ]);
  const signal = combined.signal;
  const preparation = new AssetPreparationQueue(signal);
  const assetPolicy = withAssetByteBudget(
    options.assetPolicy,
    budget.maxAssetBytes ??
      defaultMediaResourceBudget.maxAssetBytes ??
      512 * 1024 * 1024,
  );

  try {
    await runResolutionTasks(
      Object.values(parsed.assets)
        .filter((asset) => reachableAssetIds.has(asset.id))
        .map((asset) => async () => {
          assertNotAborted(signal);
          const preferAssetProxy =
            (options.preferProxy ?? false) && asset.type !== "font";
          const request = await prepareAssetRequest(asset, {
            policy: assetPolicy,
            signal,
            preferProxy: preferAssetProxy,
          });
          const src = request.source;
          const proxyAudio: VideoProxyAudioRequest | undefined = asset.type === "video" && options.videoProxyAudio === "original" &&
            (request.sourceKind === "declared-proxy" || request.sourceKind === "derived-proxy")
            ? asset.metadata?.hasAudio === false
              ? { kind: "silent" }
              : { kind: "primary", request: await prepareAssetRequest(asset, { policy: assetPolicy, signal, preferProxy: false }) }
            : undefined;
          const resourceKey = resolvedAssetResourceKey(asset, request, {
            assetPolicy: options.assetPolicy,
            fontCache: options.fontCache,
            maxSourceCacheBytes: budget.maxSourceCacheBytes,
            proxyAudio,
          });
          const declaredSource =
            request.sourceKind === "declared-proxy"
              ? (asset.proxy?.src ?? request.source)
              : request.sourceKind === "primary"
                ? asset.src
                : request.source;
          resolvedSources.set(asset.id, {
            assetId: asset.id,
            declaredSource,
            resolvedSource: src,
            contentKey: request.contentKey,
            usingProxy:
              request.sourceKind === "declared-proxy" ||
              request.sourceKind === "derived-proxy",
            sourceKind: request.sourceKind,
            declarationKey: request.declarationKey,
            resourceKey,
            assetType: asset.type,
            sourceMode: asset.sourceMode ?? "auto",
          });
          try {
            const reused = retainReusableAssetResource(
              options.reuseFrom,
              asset,
              resourceKey,
            );
            if (reused) {
              bindSharedAssetResource(
                resolvedAssets,
                lifecycle,
                asset.id,
                reused,
              );
              if (asset.type === "image") {
                const image = reused.value as ImageBitmap;
                decodedImageBytes += image.width * image.height * 4;
                if (decodedImageBytes > budget.maxDecodedImageBytes) {
                  throw new Error(
                    `Decoded image budget exceeded (${decodedImageBytes} > ${budget.maxDecodedImageBytes} bytes). Use proxy assets or raise resolveAssets().budget.maxDecodedImageBytes.`,
                  );
                }
              }
              return;
            }
            if (asset.type === "image") {
              const image = await preparation.run(async () => {
                const image = await decodeImageBlob(
                  await readPreparedAssetBlob(asset, request, signal),
                );
                if (signal.aborted) {
                  image.close();
                  assertNotAborted(signal);
                }
                decodedImageBytes += image.width * image.height * 4;
                if (decodedImageBytes > budget.maxDecodedImageBytes) {
                  image.close();
                  throw new Error(
                    `Decoded image budget exceeded (${decodedImageBytes} > ${budget.maxDecodedImageBytes} bytes). Use proxy assets or raise resolveAssets().budget.maxDecodedImageBytes.`,
                  );
                }
                return image;
              });
              bindSharedAssetResource(
                resolvedAssets,
                lifecycle,
                asset.id,
                createSharedAssetResource("image", resourceKey, image, () =>
                  image.close(),
                ),
              );
            } else if (asset.type === "font") {
              const lease = await loadFont(
                asset.id,
                asset,
                request,
                options.fontCache,
                signal,
                preparation,
              );
              bindSharedAssetResource(
                resolvedAssets,
                lifecycle,
                asset.id,
                createSharedAssetResource("font", resourceKey, lease.face, () =>
                  lease.release(),
                ),
              );
            } else if (asset.type === "video") {
              const clip = await preparation.run(() =>
                openVideoClip(
                  asset,
                  request,
                  asset.sourceMode ?? "auto",
                  budget,
                  signal,
                  lifecycle.abortCleanups,
                  proxyAudio,
                ),
              );
              bindSharedAssetResource(
                resolvedAssets,
                lifecycle,
                asset.id,
                createSharedAssetResource("video", resourceKey, clip, () =>
                  disposeVideoClipInputs(clip),
                ),
              );
            } else if (asset.type === "audio") {
              const clip = await preparation.run(() =>
                openAudioClip(
                  asset,
                  request,
                  asset.sourceMode ?? "auto",
                  budget,
                  signal,
                  lifecycle.abortCleanups,
                ),
              );
              bindSharedAssetResource(
                resolvedAssets,
                lifecycle,
                asset.id,
                createSharedAssetResource("audio", resourceKey, clip, () =>
                  disposeMediaInputSafely(clip.input),
                ),
              );
            } else if (asset.type === "lottie") {
              const clip = await preparation.run(() =>
                openLottieClip(
                  asset,
                  request,
                  signal,
                  budget.maxLottieWaitMs ??
                    defaultMediaResourceBudget.maxLottieWaitMs ??
                    15_000,
                ),
              );
              bindSharedAssetResource(
                resolvedAssets,
                lifecycle,
                asset.id,
                createSharedAssetResource("lottie", resourceKey, clip, () =>
                  clip.animation.destroy(),
                ),
              );
            }
          } catch (cause) {
            throw new Error(
              `Failed to load ${asset.type} asset "${asset.id}" from ${truncateSrc(src)}: ${cause instanceof Error ? cause.message : String(cause)}`,
              { cause },
            );
          }
        }),
      failureController,
    );

    const assetDefinitions = new Map(Object.entries(parsed.assets));
    const extensionNodes = resolvedAssets.extensionNodes ?? new Map();
    await runResolutionTasks(
      extensionPreflight.nodes.map((resolvedNode) => async () => {
        assertNotAborted(signal);
        const adapter = extensionAdapters.get(resolvedNode.node.id);
        if (resolvedNode.displayDecision.kind === "legacy-opaque" && !adapter) {
          throw new Error(
            `Canvas2D extension adapter for node "${resolvedNode.node.id}" disappeared after preflight.`,
          );
        }
        const reuseContext = {
          scene: parsed,
          node: resolvedNode.node,
          params: resolvedNode.params,
          requirements: resolvedNode.requirements,
          assets: assetDefinitions,
        };
        let reuseKey: string | null;
        try {
          reuseKey = extensionResourceReuseKey(
            resolvedNode.definition,
            reuseContext,
          );
        } catch (cause) {
          throw new Error(
            `Failed to compute extension reuse key for ${resolvedNode.node.extension.name}@${resolvedNode.definition.version} at node "${resolvedNode.node.id}": ${cause instanceof Error ? cause.message : String(cause)}`,
            { cause },
          );
        }
        const requirementsKey = extensionRequirementsKey(
          resolvedNode.requirements,
          assetDefinitions,
          resolvedSources,
        );
        const reused = retainReusableExtensionResource(
          options.reuseFrom,
          resolvedNode,
          adapter,
          reuseKey,
          requirementsKey,
          options.worker === true,
        );
        const extensionAssets = reused
          ? reused.value
          : resolvedNode.definition.resolveAssets
            ? await preparation.run(() =>
                Promise.resolve(
                  resolvedNode.definition.resolveAssets!({
                    ...reuseContext,
                    signal,
                  }),
                ).catch((cause: unknown) => {
                  throw new Error(
                    `Failed to resolve extension ${resolvedNode.node.extension.name}@${resolvedNode.definition.version} for node "${resolvedNode.node.id}": ${cause instanceof Error ? cause.message : String(cause)}`,
                    { cause },
                  );
                }),
              )
            : undefined;
        const shared =
          reused ??
          createSharedExtensionResource(
            resolvedNode,
            adapter,
            reuseKey,
            requirementsKey,
            options.worker === true,
            extensionAssets,
          );
        lifecycle.extensionResources.set(resolvedNode.node.id, shared);
        extensionNodes.set(resolvedNode.node.id, {
          node: resolvedNode.node,
          definition: resolvedNode.definition,
          params: resolvedNode.params,
          requirements: resolvedNode.requirements,
          adapter,
          displayDecision: resolvedNode.displayDecision,
          resolvedAssets: extensionAssets,
        });
      }),
      failureController,
    );

    const spectrumRanges = collectAudioReactiveSourceRanges(parsed);
    const spectrumAssetIds = new Set(spectrumRanges.keys());
    const analysisAssetIds = new Set([
      ...(options.analyzeWaveforms ? audio.keys() : []),
      ...spectrumAssetIds,
    ]);
    const audioSpectra = resolvedAssets.audioSpectra ?? new Map();
    const audioWaveforms = resolvedAssets.audioWaveforms ?? new Map();
    const configuredAnalysisBytes =
      budget.maxAudioAnalysisCacheBytes ??
      defaultMediaResourceBudget.maxAudioAnalysisCacheBytes ??
      64 * 1024 * 1024;
    const analysisCache =
      options.analysisCache ??
      (configuredAnalysisBytes ===
      defaultMediaResourceBudget.maxAudioAnalysisCacheBytes
        ? sharedAudioAnalysisCache
        : createAudioAnalysisCache(configuredAnalysisBytes));
    const retainedAnalyses = new Set<AudioAnalysis>();
    let retainedAnalysisBytes = 0;
    await runResolutionTasksSequential(
      Array.from(analysisAssetIds).map((assetId) => async () => {
        assertNotAborted(signal);
        const clip = audio.get(assetId);

        if (!clip) {
          throw new Error(
            `Audio-reactive effect references audio asset "${assetId}", but that asset could not be resolved.`,
          );
        }

        const needsSpectrum = spectrumAssetIds.has(assetId);
        const resourceIdentity =
          resolvedSources.get(assetId)?.resourceKey ??
          resolvedSources.get(assetId)?.contentKey ??
          `asset:${assetId}`;
        const spectrumFps = Math.min(SPECTRUM_MAX_FPS, parsed.fps);
        const requestedRange = needsSpectrum
          ? spectrumRanges.get(assetId)!
          : { start: 0, end: parsed.duration / parsed.fps };
        const analysisWindow = needsSpectrum
          ? audioReactiveAnalysisWindow(
              requestedRange,
              clip.duration,
              spectrumFps,
            )
          : { start: 0, end: Math.min(clip.duration, requestedRange.end) };
        const analysisDuration = analysisWindow.end - analysisWindow.start;
        // Include transient mono PCM as well as the retained spectrum in the
        // resource ceiling, before allocating either for a long source window.
        const estimatedAnalysisBytes = needsSpectrum
          ? Math.ceil(analysisDuration * SPECTRUM_SAMPLE_RATE) * 4 +
            Math.ceil(analysisDuration * spectrumFps) * SPECTRUM_BAR_COUNT +
            2048 * 4
          : 2048 * 4;
        if (estimatedAnalysisBytes > configuredAnalysisBytes) {
          throw new Error(
            `Audio-reactive analysis needs approximately ${estimatedAnalysisBytes} bytes, above the ${configuredAnalysisBytes}-byte budget. Shorten the source window or raise maxAudioAnalysisCacheBytes.`,
          );
        }
        const analysisKey = `${resourceIdentity}\u0000audio-analysis-v2\u0000${needsSpectrum ? "spectrum" : "waveform"}\u0000${parsed.fps}\u0000${analysisWindow.start}\u0000${analysisDuration}`;
        const createAnalysis = async (): Promise<AudioAnalysis> => {
          const analysis = needsSpectrum
            ? await analyzeAudio(
                clip,
                analysisDuration,
                parsed.fps,
                signal,
                analysisWindow.start,
              )
            : {
                waveform: await analyzeAudioWaveform(
                  clip,
                  analysisDuration,
                  2048,
                  signal,
                ),
              };
          assertNotAborted(signal);
          return analysis;
        };
        let analysis: AudioAnalysis;
        if (analysisCache.getOrCreate) {
          analysis = await analysisCache.getOrCreate(
            analysisKey,
            createAnalysis,
          );
        } else {
          analysis = analysisCache.get(analysisKey) ?? (await createAnalysis());
          analysisCache.set(analysisKey, analysis);
        }
        if (!retainedAnalyses.has(analysis)) {
          retainedAnalyses.add(analysis);
          retainedAnalysisBytes +=
            analysis.waveform.values.byteLength +
            (analysis.spectrum?.values.byteLength ?? 0);
          if (retainedAnalysisBytes > configuredAnalysisBytes) {
            throw new Error(
              `Resolved audio analysis exceeds the ${configuredAnalysisBytes}-byte budget. Analyze fewer assets or raise maxAudioAnalysisCacheBytes.`,
            );
          }
        }
        if (needsSpectrum && analysis.spectrum) {
          audioSpectra.set(assetId, analysis.spectrum);
        }
        audioWaveforms.set(assetId, analysis.waveform);
      }),
      failureController,
    );

    if (resolvedAssets.resourceUsage) {
      resolvedAssets.resourceUsage.decodedImageBytes = decodedImageBytes;
    }
    assertNotAborted(signal);
    lifecycle.abortCleanups.forEach((cleanup) => cleanup());
    lifecycle.abortCleanups.clear();
    return resolvedAssets;
  } catch (cause) {
    if (!failureController.signal.aborted) failureController.abort(cause);
    try {
      await disposeAssetsAsync(resolvedAssets);
    } catch (cleanupError) {
      throw new AggregateError(
        [cause, cleanupError],
        "MotionForge asset resolution failed and rollback reported errors.",
        { cause },
      );
    }
    throw cause;
  } finally {
    preparation.dispose();
    combined.dispose();
  }
}

/** Bound actual creators; cache-hit/alias waiters must not occupy a slot. */
class AssetPreparationQueue {
  private active = 0;
  private failed = false;
  private pending: Array<{ start(): void; reject(reason: unknown): void }> = [];

  constructor(private readonly signal: AbortSignal) {
    signal.addEventListener("abort", this.abort, { once: true });
  }

  private abort = () => {
    for (const entry of this.pending.splice(0))
      entry.reject(this.signal.reason);
  };

  dispose(): void {
    this.signal.removeEventListener("abort", this.abort);
  }

  run<T>(operation: () => Promise<T>): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      if (this.signal.aborted) {
        reject(this.signal.reason);
        return;
      }
      const entry = {
        reject,
        start: () => {
          this.active += 1;
          void Promise.resolve()
            .then(() => {
              assertNotAborted(this.signal);
              return operation();
            })
            .then(resolve, (error) => {
              // Let the caller add asset-specific context before the shared
              // failure controller rejects waiting work. Start no more creators.
              this.failed = true;
              reject(error);
            })
            .finally(() => {
              this.active -= 1;
              this.pump();
            });
        },
      };
      this.pending.push(entry);
      this.pump();
    });
  }

  private pump(): void {
    while (
      !this.failed &&
      !this.signal.aborted &&
      this.active < 4 &&
      this.pending.length
    )
      this.pending.shift()!.start();
  }
}

async function runResolutionTasks(
  tasks: Array<() => Promise<void>>,
  failureController: AbortController,
): Promise<void> {
  const results = await Promise.allSettled(
    tasks.map(async (task) => {
      try {
        await task();
      } catch (error) {
        if (!failureController.signal.aborted) failureController.abort(error);
        throw error;
      }
    }),
  );
  const failed = results.find(
    (result): result is PromiseRejectedResult => result.status === "rejected",
  );
  if (failed) {
    throw failureController.signal.aborted
      ? failureController.signal.reason
      : failed.reason;
  }
}

async function runResolutionTasksSequential(
  tasks: Array<() => Promise<void>>,
  failureController: AbortController,
): Promise<void> {
  for (const task of tasks) {
    try {
      await task();
    } catch (error) {
      if (!failureController.signal.aborted) failureController.abort(error);
      throw error;
    }
  }
}

/**
 * Starts best-effort disposal for backwards compatibility. New lifecycle
 * owners should await disposeAssetsAsync() so decoder shutdown completes
 * before the underlying Inputs are closed.
 */
export function disposeAssets(assets: ResolvedAssets): void {
  void disposeAssetsAsync(assets).catch(() => {
    // The legacy void API has nowhere to deliver asynchronous teardown errors.
  });
}

/** Transactional, idempotent teardown for every built-in and extension resource. */
export function disposeAssetsAsync(assets: ResolvedAssets): Promise<void> {
  const lifecycle = getResolvedAssetsLifecycle(assets);
  if (lifecycle.disposal) return lifecycle.disposal;
  lifecycle.disposed = true;
  lifecycle.controller.abort(
    createAbortError("Resolved assets were disposed."),
  );

  lifecycle.disposal = (async () => {
    const preparation = framePreparationQueues.get(assets);
    if (preparation) await preparation.catch(() => undefined);

    const disposalErrors: unknown[] = [];
    const extensionDisposals: Array<Promise<void>> = [];
    const cursorDisposals: Array<Promise<void>> = [];
    const sharedExtensionResources = Array.from(
      new Set(lifecycle.extensionResources.values()),
    );
    const sharedResources = Array.from(
      new Set(lifecycle.assetResources.values()),
    );
    const sharedValues = new Set(
      sharedResources.map((resource) => resource.value),
    );
    const unmanagedImages = Array.from(assets.images.values()).filter(
      (image) => !sharedValues.has(image),
    );
    const unmanagedLotties = Array.from(assets.lotties.values()).filter(
      (clip) => !sharedValues.has(clip),
    );
    const unmanagedVideos = Array.from(assets.videos.values()).filter(
      (clip) => !sharedValues.has(clip),
    );
    const unmanagedAudio = Array.from(assets.audio.values()).filter(
      (clip) => !sharedValues.has(clip),
    );

    lifecycle.abortCleanups.forEach((cleanup) => {
      try {
        cleanup();
      } catch (error) {
        disposalErrors.push(error);
      }
    });
    lifecycle.abortCleanups.clear();

    Array.from(assets.extensionNodes?.entries() ?? []).forEach(
      ([nodeId, runtime]) => {
        const shared = lifecycle.extensionResources.get(nodeId);
        if (
          shared &&
          shared.value === runtime.resolvedAssets &&
          shared.definition === runtime.definition &&
          shared.adapter === runtime.adapter &&
          shared.displayKey ===
            extensionDisplayDecisionKey(runtime.displayDecision)
        ) {
          return;
        }
        try {
          extensionDisposals.push(
            Promise.resolve(
              runtime.definition.disposeAssets?.(runtime.resolvedAssets),
            ),
          );
        } catch (error) {
          disposalErrors.push(error);
        }
      },
    );
    sharedExtensionResources.forEach((resource) => {
      try {
        extensionDisposals.push(resource.release());
      } catch (error) {
        disposalErrors.push(error);
      }
    });
    Array.from(assets.videoCursors?.values() ?? []).forEach((cursor) => {
      try {
        cursorDisposals.push(cursor.dispose());
      } catch (error) {
        disposalErrors.push(error);
      }
    });
    assets.extensionNodes?.clear();
    assets.extensionFrames?.clear();
    assets.images.clear();
    assets.fonts.clear();
    assets.videoCursors?.clear();
    assets.videos.clear();
    assets.videoFrames.clear();
    assets.audio.clear();
    assets.audioSpectra?.clear();
    assets.audioWaveforms?.clear();
    assets.lotties.clear();
    assets.lottieFrames.clear();
    assets.resolvedSources?.clear();
    lifecycle.assetResources.clear();
    lifecycle.extensionResources.clear();

    for (const result of await Promise.allSettled([
      ...extensionDisposals,
      ...cursorDisposals,
    ])) {
      if (result.status === "rejected") disposalErrors.push(result.reason);
    }

    // Extension hooks and cursors settle before any built-in resource they may
    // reference is released. Shared inputs close only after the final lease.
    for (const result of await Promise.allSettled(
      sharedResources.map((resource) => resource.release()),
    )) {
      if (result.status === "rejected") disposalErrors.push(result.reason);
    }
    unmanagedImages.forEach((image) => {
      try {
        image.close();
      } catch (error) {
        disposalErrors.push(error);
      }
    });
    lifecycle.fontLeases.forEach((lease) => {
      try {
        lease.release();
      } catch (error) {
        disposalErrors.push(error);
      }
    });
    lifecycle.fontLeases.clear();
    unmanagedLotties.forEach((clip) => {
      try {
        clip.animation.destroy();
      } catch (error) {
        disposalErrors.push(error);
      }
    });
    [...unmanagedVideos, ...unmanagedAudio].forEach((clip) => {
      try {
        disposeMediaInputSafely(clip.input);
      } catch (error) {
        disposalErrors.push(error);
      }
    });

    if (disposalErrors.length > 0) {
      throw new AggregateError(
        disposalErrors,
        "One or more MotionForge media resources failed to dispose.",
      );
    }
  })();

  return lifecycle.disposal;
}

function createAbortError(message: string): Error {
  if (typeof DOMException === "function") {
    return new DOMException(message, "AbortError");
  }
  const error = new Error(message);
  error.name = "AbortError";
  return error;
}

export function collectReachableAssetIds(
  scene: Scene,
  extensionNodes: readonly ResolvedExtensionNode[] = [],
): Set<string> {
  const ids = new Set<string>();
  const visit = (nodes: Scene["nodes"]): void => {
    for (const node of nodes) {
      if (node.assetId) ids.add(node.assetId);
      if (node.params?.audioAssetId) ids.add(node.params.audioAssetId);
      if (node.params?.coverAssetId) ids.add(node.params.coverAssetId);
      if (node.style?.fontFamily)
        fontAssetIdsForFamily(scene.assets, node.style.fontFamily).forEach(
          (id) => ids.add(id),
        );
      visit(node.children ?? []);
    }
  };
  visit(scene.nodes);
  extensionNodes.forEach((node) =>
    node.requirements.forEach((requirement) => {
      if (scene.assets[requirement.assetId]) ids.add(requirement.assetId);
    }),
  );
  return ids;
}

/** Rejects reuse when a Scene asset id now points at different source content. */
export function assertResolvedAssetsCompatible(
  sceneInput: unknown,
  assets: ResolvedAssets,
): void {
  const scene = parseScene(sceneInput);
  assets.resolvedSources?.forEach((resolved, assetId) => {
    const current = scene.assets[assetId];
    if (!current) {
      throw new Error(
        `Resolved asset "${assetId}" is absent from the current Scene. Resolve a new asset lease.`,
      );
    }
    if (resolved.assetType && current.type !== resolved.assetType) {
      throw new Error(
        `Scene asset "${assetId}" changed type from ${resolved.assetType} to ${current.type}. Resolve assets again; content identity cannot make decoder types interchangeable.`,
      );
    }
    if (
      resolved.sourceMode &&
      (current.sourceMode ?? "auto") !== resolved.sourceMode
    ) {
      throw new Error(
        `Scene asset "${assetId}" changed sourceMode from ${resolved.sourceMode} to ${current.sourceMode ?? "auto"}. Resolve assets again.`,
      );
    }
    if (
      current.metadata?.contentHash &&
      current.metadata.contentHash === resolved.contentKey
    ) {
      return;
    }
    if (assetDeclarationKey(current) !== resolved.declarationKey) {
      throw new Error(
        `Scene asset "${assetId}" changed source after resolution. Resolve assets again or provide a stable metadata.contentHash through the host policy.`,
      );
    }
  });
}

export function estimateMediaResources(
  sceneInput: unknown,
  extensionNodes: readonly ResolvedExtensionNode[] = [],
): MediaResourceEstimate {
  const scene = parseScene(sceneInput);
  const reachable = collectReachableAssetIds(scene, extensionNodes);
  const events: Array<{ frame: number; delta: number }> = [];
  const visit = (
    nodes: Scene["nodes"],
    origin: number,
    parentStart: number,
    parentEnd: number,
    parentDuration: number,
  ): void => {
    for (const node of nodes) {
      const start = origin + (node.from ?? 0);
      const duration = node.duration ?? parentDuration;
      const activeStart = Math.max(start, parentStart);
      const activeEnd = Math.min(start + duration, parentEnd);
      if (activeStart >= activeEnd) continue;
      if (node.type === "video" && activeStart < activeEnd) {
        events.push({ frame: activeStart, delta: 1 });
        events.push({ frame: activeEnd, delta: -1 });
      }
      visit(node.children ?? [], start, activeStart, activeEnd, duration);
    }
  };
  visit(scene.nodes, 0, 0, scene.duration, scene.duration);
  events.sort(
    (left, right) => left.frame - right.frame || left.delta - right.delta,
  );
  let active = 0;
  let maxSimultaneousVideoDecoders = 0;
  events.forEach((event) => {
    active += event.delta;
    maxSimultaneousVideoDecoders = Math.max(
      maxSimultaneousVideoDecoders,
      active,
    );
  });
  let estimatedDecodedImageBytes = 0;
  let proxyAssets = 0;
  reachable.forEach((id) => {
    const asset = scene.assets[id];
    if (!asset) return;
    if (asset.proxy) proxyAssets += 1;
    if (asset.type === "image") {
      const width = asset.metadata?.width ?? asset.proxy?.width ?? 0;
      const height = asset.metadata?.height ?? asset.proxy?.height ?? 0;
      estimatedDecodedImageBytes += width * height * 4;
    }
  });
  return {
    declaredAssets: Object.keys(scene.assets).length,
    reachableAssets: reachable.size,
    proxyAssets,
    estimatedDecodedImageBytes,
    maxSimultaneousVideoDecoders,
  };
}

function withAssetByteBudget(
  policy: AssetPolicy | undefined,
  maximum: number,
): AssetPolicy {
  const base = policy ?? {};
  return {
    ...base,
    maxBytes: (asset, context) => {
      const configured =
        typeof base.maxBytes === "function"
          ? base.maxBytes(asset, context)
          : base.maxBytes;
      return Math.min(maximum, configured ?? Number.POSITIVE_INFINITY);
    },
  };
}

function withoutSignal(init: RequestInit): Omit<RequestInit, "signal"> {
  const { signal: _signal, ...rest } = init;
  return rest;
}

async function readPreparedAssetBytes(
  asset: SceneAsset,
  request: PreparedAssetRequest,
  signal?: AbortSignal,
): Promise<Uint8Array> {
  const response = await fetchPreparedAssetResponse(asset, request, signal);
  return readResponseBytes(response, {
    maxBytes: request.maxBytes,
    signal,
  });
}

async function fetchPreparedAssetResponse(
  asset: SceneAsset,
  request: PreparedAssetRequest,
  signal?: AbortSignal,
): Promise<Response> {
  return fetchAssetBounded(asset, {
    policy: request.policy,
    signal,
    source: request.source,
    requestInit: withoutSignal(request.init),
  });
}

async function readPreparedAssetBlob(
  asset: SceneAsset,
  request: PreparedAssetRequest,
  signal?: AbortSignal,
): Promise<Blob> {
  const response = await fetchPreparedAssetResponse(asset, request, signal);
  // fetchAssetBounded enforces headers, streamed bytes, redirects, MIME and
  // cancellation. Native Blob consumption avoids joining all bytes into a
  // JS Uint8Array and copying that entire array again for Blob ownership.
  const blob = await response.blob();
  assertNotAborted(signal);
  if (request.maxBytes !== undefined && blob.size > request.maxBytes) {
    throw new AssetPolicyError(
      `Response exceeds the ${request.maxBytes}-byte media limit.`,
    );
  }
  const type =
    asset.metadata?.mimeType ??
    response.headers.get("content-type")?.split(";", 1)[0] ??
    "";
  return blob.type === type ? blob : blob.slice(0, blob.size, type);
}

function ownedArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  return copy.buffer;
}

const SPECTRUM_SAMPLE_RATE = 8192;
const SPECTRUM_FFT_SIZE = 512;
const SPECTRUM_BAR_COUNT = 128;
const SPECTRUM_MAX_FPS = 15;

async function analyzeAudio(
  clip: AudioClip,
  durationSeconds: number,
  sceneFps: number,
  signal?: AbortSignal,
  sourceStartTime = 0,
): Promise<AudioAnalysis> {
  assertNotAborted(signal);
  const sampleCount = Math.max(
    1,
    Math.ceil(durationSeconds * SPECTRUM_SAMPLE_RATE),
  );
  const mono = new Float32Array(sampleCount);

  for await (const sample of clip.sink.samples(
    sourceStartTime,
    sourceStartTime + durationSeconds,
  )) {
    try {
      assertNotAborted(signal);
      const sourceRate = sample.sampleRate;
      const channels = copyAudioSampleChannels(sample);
      const startIndex = Math.max(
        0,
        Math.floor((sample.timestamp - sourceStartTime) * SPECTRUM_SAMPLE_RATE),
      );
      const endIndex = Math.min(
        sampleCount,
        Math.ceil(
          (sample.timestamp + sample.duration - sourceStartTime) *
            SPECTRUM_SAMPLE_RATE,
        ),
      );

      for (
        let targetIndex = startIndex;
        targetIndex < endIndex;
        targetIndex += 1
      ) {
        const sourceIndex = Math.min(
          sample.numberOfFrames - 1,
          Math.max(
            0,
            Math.floor(
              (sourceStartTime +
                targetIndex / SPECTRUM_SAMPLE_RATE -
                sample.timestamp) *
                sourceRate,
            ),
          ),
        );
        let value = 0;
        for (const channel of channels) {
          value += channel[sourceIndex] ?? 0;
        }
        mono[targetIndex] = value / Math.max(1, channels.length);
      }
    } finally {
      sample.close();
    }
  }

  const fps = Math.min(SPECTRUM_MAX_FPS, sceneFps);
  const frameCount = Math.max(1, Math.ceil(durationSeconds * fps));
  const values = new Uint8Array(frameCount * SPECTRUM_BAR_COUNT);
  const real = new Float64Array(SPECTRUM_FFT_SIZE);
  const imag = new Float64Array(SPECTRUM_FFT_SIZE);
  const magnitudes = new Float64Array(SPECTRUM_FFT_SIZE / 2);

  for (let frame = 0; frame < frameCount; frame += 1) {
    if (frame % 8 === 0) assertNotAborted(signal);
    const center = Math.round((frame / fps) * SPECTRUM_SAMPLE_RATE);
    const start = center - Math.floor(SPECTRUM_FFT_SIZE / 2);

    for (let index = 0; index < SPECTRUM_FFT_SIZE; index += 1) {
      const sampleIndex = start + index;
      const window =
        0.5 - 0.5 * Math.cos((2 * Math.PI * index) / (SPECTRUM_FFT_SIZE - 1));
      real[index] = (mono[sampleIndex] ?? 0) * window;
      imag[index] = 0;
    }

    fftInPlace(real, imag);
    let framePeak = 0;
    for (let index = 1; index < magnitudes.length; index += 1) {
      const magnitude =
        Math.hypot(real[index] ?? 0, imag[index] ?? 0) / SPECTRUM_FFT_SIZE;
      magnitudes[index] = magnitude;
      framePeak = Math.max(framePeak, magnitude);
    }

    for (let bar = 0; bar < SPECTRUM_BAR_COUNT; bar += 1) {
      const frequency =
        45 * Math.pow(4000 / 45, bar / Math.max(1, SPECTRUM_BAR_COUNT - 1));
      const bin = Math.min(
        magnitudes.length - 1,
        Math.max(
          1,
          Math.round((frequency * SPECTRUM_FFT_SIZE) / SPECTRUM_SAMPLE_RATE),
        ),
      );
      const magnitude =
        ((magnitudes[bin - 1] ?? 0) +
          (magnitudes[bin] ?? 0) * 2 +
          (magnitudes[bin + 1] ?? 0)) /
        4;
      const absolute = Math.log1p(magnitude * 220) / Math.log(221);
      const relative = framePeak > 0 ? magnitude / framePeak : 0;
      const normalized = clamp01(
        Math.pow(absolute * 0.78 + relative * 0.34, 0.7),
      );
      values[frame * SPECTRUM_BAR_COUNT + bar] = Math.round(normalized * 255);
    }
  }

  return {
    spectrum: {
      fps,
      barCount: SPECTRUM_BAR_COUNT,
      frameCount,
      values,
      startTime: sourceStartTime,
      duration: durationSeconds,
    },
    waveform: {
      startTime: sourceStartTime,
      duration: durationSeconds,
      values: waveformFromSamples(mono),
    },
  };
}

export function waveformFromSamples(
  samples: Float32Array,
  pointCount = 2048,
): Float32Array {
  const count = Math.max(1, Math.min(pointCount, samples.length || 1));
  const values = new Float32Array(count);
  for (let point = 0; point < count; point += 1) {
    const start = Math.floor((point / count) * samples.length);
    const end = Math.max(
      start + 1,
      Math.floor(((point + 1) / count) * samples.length),
    );
    let peak = 0;
    for (let index = start; index < end && index < samples.length; index += 1) {
      peak = Math.max(peak, Math.abs(samples[index] ?? 0));
    }
    values[point] = peak;
  }
  return values;
}

async function analyzeAudioWaveform(
  clip: AudioClip,
  duration: number,
  pointCount = 2048,
  signal?: AbortSignal,
): Promise<AudioWaveform> {
  assertNotAborted(signal);
  const values = new Float32Array(Math.max(1, pointCount));
  for await (const sample of clip.sink.samples(0, duration)) {
    try {
      assertNotAborted(signal);
      const channels = copyAudioSampleChannels(sample);
      for (
        let sampleIndex = 0;
        sampleIndex < sample.numberOfFrames;
        sampleIndex += 1
      ) {
        if (sampleIndex % 4096 === 0) assertNotAborted(signal);
        const at = sample.timestamp + sampleIndex / sample.sampleRate;
        if (at < 0 || at >= duration) continue;
        const point = Math.min(
          values.length - 1,
          Math.floor((at / Math.max(duration, 0.001)) * values.length),
        );
        let peak = 0;
        for (const channel of channels) {
          peak = Math.max(peak, Math.abs(channel[sampleIndex] ?? 0));
        }
        values[point] = Math.max(values[point] ?? 0, peak);
      }
    } finally {
      sample.close();
    }
  }
  return { duration, values };
}

function fftInPlace(real: Float64Array, imag: Float64Array): void {
  const length = real.length;
  for (let index = 1, reversed = 0; index < length; index += 1) {
    let bit = length >> 1;
    for (; reversed & bit; bit >>= 1) reversed ^= bit;
    reversed ^= bit;
    if (index < reversed) {
      [real[index], real[reversed]] = [real[reversed] ?? 0, real[index] ?? 0];
      [imag[index], imag[reversed]] = [imag[reversed] ?? 0, imag[index] ?? 0];
    }
  }

  for (let size = 2; size <= length; size <<= 1) {
    const angle = (-2 * Math.PI) / size;
    const half = size >> 1;
    for (let offset = 0; offset < length; offset += size) {
      for (let index = 0; index < half; index += 1) {
        const cos = Math.cos(angle * index);
        const sin = Math.sin(angle * index);
        const even = offset + index;
        const odd = even + half;
        const oddReal = (real[odd] ?? 0) * cos - (imag[odd] ?? 0) * sin;
        const oddImag = (real[odd] ?? 0) * sin + (imag[odd] ?? 0) * cos;
        const evenReal = real[even] ?? 0;
        const evenImag = imag[even] ?? 0;
        real[even] = evenReal + oddReal;
        imag[even] = evenImag + oddImag;
        real[odd] = evenReal - oddReal;
        imag[odd] = evenImag - oddImag;
      }
    }
  }
}

async function openAudioClip(
  asset: SceneAsset,
  request: PreparedAssetRequest,
  sourceMode: "auto" | "stream" | "buffer",
  budget: MediaResourceBudget,
  signal?: AbortSignal,
  abortCleanups?: Set<() => void>,
): Promise<AudioClip> {
  const input = new Input({
    formats: ALL_FORMATS,
    source: await createMediaSource(asset, request, sourceMode, budget, signal),
  });
  const unlinkAbort = disposeInputOnAbort(input, signal);
  try {
    const track = await input.getPrimaryAudioTrack();
    assertNotAborted(signal);
    if (!track) {
      throw new Error("the file has no audio track");
    }

    const duration = await input.computeDuration([track]);
    assertNotAborted(signal);
    if (abortCleanups) abortCleanups.add(unlinkAbort);
    else unlinkAbort();
    return {
      duration,
      sampleRate: track.sampleRate,
      numberOfChannels: track.numberOfChannels,
      sink: new AudioSampleSink(track),
      input,
    };
  } catch (error) {
    unlinkAbort();
    disposeMediaInputSafely(input);
    throw error;
  }
}

type VideoProxyAudioRequest = { kind: "primary"; request: PreparedAssetRequest } | { kind: "silent" };

function disposeVideoClipInputs(clip: Pick<VideoClip, "input" | "audioInput">): void {
  try { disposeMediaInputSafely(clip.input); }
  finally { if (clip.audioInput && clip.audioInput !== clip.input) disposeMediaInputSafely(clip.audioInput); }
}

async function openVideoClip(
  asset: SceneAsset,
  request: PreparedAssetRequest,
  sourceMode: "auto" | "stream" | "buffer",
  budget: MediaResourceBudget,
  signal?: AbortSignal,
  abortCleanups?: Set<() => void>,
  proxyAudio?: VideoProxyAudioRequest,
): Promise<VideoClip> {
  const input = new Input({
    formats: ALL_FORMATS,
    source: await createMediaSource(asset, request, sourceMode, budget, signal),
  });
  const unlinkAbort = disposeInputOnAbort(input, signal);
  let audioInput: Input | undefined;
  let unlinkAudioAbort: (() => void) | undefined;
  try {
    const track = await input.getPrimaryVideoTrack();
    assertNotAborted(signal);
    if (!track) {
      throw new Error("the file has no video track");
    }

    const duration = await input.computeDuration([track]);

    // Original audio keeps codec priming and its source clock; the primary
    // Input is only queried for sound and never opens a video decoder.
    if (proxyAudio?.kind === "primary") {
      audioInput = new Input({ formats: ALL_FORMATS, source: await createMediaSource(asset, proxyAudio.request, sourceMode, budget, signal) });
      unlinkAudioAbort = disposeInputOnAbort(audioInput, signal);
    }
    const soundInput = audioInput ?? input;
    const audioTrack = proxyAudio?.kind === "silent" ? null : await soundInput.getPrimaryAudioTrack();
    assertNotAborted(signal);
    const audio = audioTrack
      ? {
          duration: await soundInput.computeDuration([audioTrack]),
          sampleRate: audioTrack.sampleRate,
          numberOfChannels: audioTrack.numberOfChannels,
          sink: new AudioSampleSink(audioTrack),
        }
      : undefined;
    assertNotAborted(signal);
    if (!audioTrack && audioInput) { unlinkAudioAbort?.(); disposeMediaInputSafely(audioInput); audioInput = undefined; unlinkAudioAbort = undefined; }
    if (abortCleanups) abortCleanups.add(unlinkAbort);
    else unlinkAbort();
    if (unlinkAudioAbort) { if (abortCleanups) abortCleanups.add(unlinkAudioAbort); else unlinkAudioAbort(); }
    return {
      duration,
      width: track.displayWidth,
      height: track.displayHeight,
      track,
      input,
      ...(audioInput ? { audioInput } : {}),
      ...(audio ? { audio } : {}),
    };
  } catch (error) {
    unlinkAbort();
    unlinkAudioAbort?.();
    disposeVideoClipInputs({ input, audioInput });
    throw error;
  }
}

async function createMediaSource(
  asset: SceneAsset,
  request: PreparedAssetRequest,
  sourceMode: "auto" | "stream" | "buffer",
  budget: MediaResourceBudget,
  signal?: AbortSignal,
): Promise<BlobSource | UrlSource> {
  assertNotAborted(signal);
  const src = request.source;
  const shouldBuffer =
    sourceMode === "buffer" ||
    (sourceMode === "auto" &&
      (src.startsWith("data:") || src.startsWith("blob:")));
  if (shouldBuffer) {
    return new BlobSource(await readPreparedAssetBlob(asset, request, signal));
  }
  return new UrlSource(src, {
    maxCacheSize: budget.maxSourceCacheBytes,
    requestInit: withoutSignal(request.init),
    fetchFn: createBoundedAssetFetch(asset, {
      policy: request.policy,
      source: request.source,
      sourceKind: request.sourceKind,
      declarationKey: request.declarationKey,
      requestInit: withoutSignal(request.init),
      signal,
    }),
  });
}

function disposeInputOnAbort(input: Input, signal?: AbortSignal): () => void {
  if (!signal) return () => undefined;
  const dispose = () => disposeMediaInputSafely(input);
  signal.addEventListener("abort", dispose, { once: true });
  return () => signal.removeEventListener("abort", dispose);
}

/**
 * Maps a video node's local frame to a source timestamp in seconds:
 * videoStartTime + (localFrame / fps) * playbackRate, clamped to the clip so
 * scenes outlasting their footage hold the last frame.
 */
export function videoSourceTime(
  localFrame: number,
  fps: number,
  videoStartTime: number,
  playbackRate: number,
  clipDuration: number,
  endBehavior: "hold" | "loop" = "hold",
): number {
  const raw = videoStartTime + (localFrame / fps) * playbackRate;
  const lastFrameTime = Math.max(0, clipDuration - 0.001);
  if (endBehavior === "loop" && clipDuration > 0) {
    const looped = ((raw % clipDuration) + clipDuration) % clipDuration;
    return Math.min(looped, lastFrameTime);
  }
  return Math.min(Math.max(0, raw), lastFrameTime);
}

/**
 * Decodes the source frames every active video node needs at the given scene
 * frame and stages them in assets.videoFrames. Must be awaited before
 * renderStill() for scenes containing video nodes; a no-op otherwise.
 */
export type PrepareFrameOptions = { signal?: AbortSignal };

export async function prepareFrame(
  scene: Scene,
  frame: number,
  assets: ResolvedAssets,
  options: PrepareFrameOptions = {},
): Promise<ResolvedScene> {
  assertAssetsAlive(assets);
  const lifecycle = getResolvedAssetsLifecycle(assets);
  const combined = combineAbortSignals([
    options.signal,
    lifecycle.controller.signal,
  ]);
  const previous = framePreparationQueues.get(assets) ?? Promise.resolve();
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const queued = previous.catch(() => undefined).then(() => gate);
  framePreparationQueues.set(assets, queued);
  void queued.then(() => {
    if (framePreparationQueues.get(assets) === queued) {
      framePreparationQueues.delete(assets);
    }
  });
  try {
    await awaitWithAbort(
      previous.catch(() => undefined),
      combined.signal,
    );
    assertAssetsAlive(assets);
    return await prepareFrameExclusive(scene, frame, assets, combined.signal);
  } finally {
    release();
    combined.dispose();
  }
}

async function prepareFrameExclusive(
  scene: Scene,
  frame: number,
  assets: ResolvedAssets,
  signal: AbortSignal,
): Promise<ResolvedScene> {
  assertNotAborted(signal);
  const parsed = parseScene(scene);
  assertResolvedAssetsCompatible(parsed, assets);
  const resolved = evaluateScene(parsed, frame);
  preparedSceneOwners.set(resolved, parsed);

  if (
    assets.videos.size === 0 &&
    assets.lotties.size === 0 &&
    (assets.extensionNodes?.size ?? 0) === 0
  ) {
    return resolved;
  }

  const failureController = new AbortController();
  const frameAbort = combineAbortSignals([signal, failureController.signal]);
  const frameSignal = frameAbort.signal;

  const tasks: Array<Promise<void>> = [];
  const nextVideoFrames = new Map<string, PreparedVideoFrame>();
  const nextLottieFrames = new Map<string, PreparedVideoFrame>();
  const nextExtensionFrames = new Map<string, PreparedExtensionFrame>();
  const cursors = (assets.videoCursors ??= new Map<
    string,
    VideoPlaybackCursor
  >());
  const activeCursorKeys = new Set<string>();

  const visit = (node: ResolvedNode): void => {
    assertNotAborted(frameSignal);
    if (node.type === "extension" && node.extension) {
      const runtime = assets.extensionNodes?.get(node.id);
      if (!runtime) {
        throw new Error(
          `Scene draws extension node "${node.id}" but it was not resolved. Call resolveAssets(scene, { extensions }) first.`,
        );
      }

      if (runtime.definition.prepareFrame) {
        const prepareExtension = () => {
          assertNotAborted(frameSignal);
          return Promise.resolve(
            runtime.definition.prepareFrame?.({
              scene: parsed,
              node: node as ResolvedNode & ExtensionSceneNode,
              params: runtime.params,
              resolvedAssets: runtime.resolvedAssets,
              frame: resolved.frame,
              localFrame: node.localFrame,
              signal: frameSignal,
            }),
          )
            .then((value) => {
              assertNotAborted(frameSignal);
              nextExtensionFrames.set(node.id, {
                sceneFrame: resolved.frame,
                value,
              });
            })
            .catch((cause: unknown) => {
              throw new Error(
                `Failed to prepare extension ${node.extension?.name}@${runtime.definition.version} for node "${node.id}" at frame ${resolved.frame}: ${cause instanceof Error ? cause.message : String(cause)}`,
                { cause },
              );
            });
        };
        const shared = getResolvedAssetsLifecycle(
          assets,
        ).extensionResources.get(node.id);
        tasks.push(
          shared &&
            shared.reuseKey !== null &&
            shared.value === runtime.resolvedAssets
            ? shared.runExclusive(prepareExtension)
            : prepareExtension(),
        );
      }
    }

    if (node.type === "video" && node.assetId) {
      const assetId = node.assetId;
      const clip = assets.videos.get(assetId);

      if (!clip) {
        throw new Error(
          `Video node "${node.id}" references asset "${assetId}" which is not in the resolved assets. Call resolveAssets(scene) first.`,
        );
      }

      const timestamp = videoSourceTime(
        node.localFrame,
        parsed.fps,
        node.videoStartTime ?? 0,
        node.playbackRate ?? 1,
        clip.duration,
        node.videoEndBehavior ?? "hold",
      );

      // Keyed by node AND asset: reused assets can outlive one scene
      // revision, and a node id may point at a different clip afterwards.
      const cursorKey = `${node.id} ${assetId}`;
      activeCursorKeys.add(cursorKey);
      let cursor = cursors.get(cursorKey);

      if (!cursor) {
        const maxVideoDecoders =
          assets.budget?.maxVideoDecoders ??
          defaultMediaResourceBudget.maxVideoDecoders;
        if (activeCursorKeys.size > maxVideoDecoders) {
          throw new Error(
            `Active video decoder budget exceeded (${activeCursorKeys.size} > ${maxVideoDecoders}). Reduce simultaneous video nodes, use proxies, or raise maxVideoDecoders.`,
          );
        }
        // One sink (and thus one decoder + canvas pool) per node, even when
        // nodes share an asset — cursors advance independently.
        cursor = new VideoPlaybackCursor(
          new CanvasSink(clip.track, { poolSize: CURSOR_CANVAS_POOL_SIZE }),
        );
        cursors.set(cursorKey, cursor);
      }
      const activeCursor = cursor;

      tasks.push(
        awaitWithAbort(
          activeCursor.frameAt(timestamp),
          frameSignal,
          async () => {
            cursors.delete(cursorKey);
            await activeCursor.dispose();
          },
        )
          .then((wrapped) => {
            assertNotAborted(frameSignal);
            if (!wrapped) {
              throw new Error(
                `Video asset "${assetId}" produced no frame at ${timestamp.toFixed(3)}s for node "${node.id}".`,
              );
            }

            nextVideoFrames.set(node.id, {
              image: wrapped.canvas,
              width: wrapped.canvas.width,
              height: wrapped.canvas.height,
              sceneFrame: resolved.frame,
            });
          })
          .catch(async (cause: unknown) => {
            cursors.delete(cursorKey);
            try {
              await activeCursor.dispose();
            } catch {
              // Preserve the decode/abort error; final disposal retries cleanup.
            }
            throw cause;
          }),
      );
    }

    if (node.type === "lottie" && node.assetId) {
      const assetId = node.assetId;
      const clip = assets.lotties.get(assetId);

      if (!clip) {
        throw new Error(
          `Lottie node "${node.id}" references asset "${assetId}" which is not in the resolved assets. Call resolveAssets(scene) first.`,
        );
      }
      const stageLottie = () => {
        assertNotAborted(frameSignal);
        clip.animation.goToAndStop(
          lottieSourceFrame(
            node.localFrame,
            parsed.fps,
            node.playbackRate ?? 1,
            clip,
          ),
          true,
        );

        // The staged canvas is lease-local. Shared Lottie players serialize
        // seek+copy through their resource owner, so two live revisions cannot
        // copy each other's mutable animation state.
        const previous = assets.lottieFrames.get(node.id)?.image;
        const staged =
          previous &&
          previous.width === clip.width &&
          previous.height === clip.height
            ? previous
            : createStagingCanvas(clip.width, clip.height);
        const stagedContext = staged.getContext("2d") as
          CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D | null;

        if (!stagedContext) {
          throw new Error("Canvas2D unavailable for lottie staging.");
        }

        stagedContext.clearRect(0, 0, clip.width, clip.height);
        stagedContext.drawImage(clip.canvas, 0, 0);
        nextLottieFrames.set(node.id, {
          image: staged,
          width: clip.width,
          height: clip.height,
          sceneFrame: resolved.frame,
        });
      };
      const shared =
        getResolvedAssetsLifecycle(assets).assetResources.get(assetId);
      tasks.push(
        shared?.type === "lottie"
          ? shared.runExclusive(stageLottie)
          : Promise.resolve().then(stageLottie),
      );
    }

    for (const child of node.children) {
      visit(child);
    }
  };

  let traversalError: unknown;
  try {
    for (const node of resolved.nodes) visit(node);
  } catch (error) {
    traversalError = error;
    failureController.abort(error);
  }

  // Decoders are a scarce resource (hardware decode sessions are capped):
  // release cursors for nodes not active at this frame. Reactivation costs
  // one keyframe seek, which the node was paying anyway.
  const disposeTasks: Array<Promise<void>> = [];
  if (traversalError === undefined) {
    cursors.forEach((cursor, key) => {
      if (!activeCursorKeys.has(key)) {
        disposeTasks.push(cursor.dispose());
        cursors.delete(key);
      }
    });
  }

  try {
    const results = await Promise.allSettled(
      [...tasks, ...disposeTasks].map(async (task) => {
        try {
          await task;
        } catch (error) {
          if (!failureController.signal.aborted) {
            failureController.abort(error);
          }
          throw error;
        }
      }),
    );
    const rejected = results.find(
      (result): result is PromiseRejectedResult => result.status === "rejected",
    );
    const failure =
      traversalError ??
      (failureController.signal.aborted
        ? failureController.signal.reason
        : rejected?.reason);
    if (failure !== undefined) throw failure;
    assertNotAborted(frameSignal);
    replaceMapContents(assets.videoFrames, nextVideoFrames);
    replaceMapContents(assets.lottieFrames, nextLottieFrames);
    replaceMapContents(
      (assets.extensionFrames ??= new Map()),
      nextExtensionFrames,
    );
    return resolved;
  } finally {
    frameAbort.dispose();
  }
}

function replaceMapContents<K, V>(target: Map<K, V>, source: Map<K, V>): void {
  target.clear();
  source.forEach((value, key) => target.set(key, value));
}

function createStagingCanvas(
  width: number,
  height: number,
): HTMLCanvasElement | OffscreenCanvas {
  if (typeof document !== "undefined") {
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    return canvas;
  }

  return new OffscreenCanvas(width, height);
}

/**
 * Maps a lottie node's local frame to an animation frame offset (relative to
 * the document's in-point): (localFrame / fps) x playbackRate x lottie.fr,
 * clamped so scenes outlasting the animation hold its last frame —
 * lottie-web does NOT clamp out-of-range seeks itself (verified in the
 * spike). Fractional frames are fine; lottie interpolates deterministically.
 */
export function lottieSourceFrame(
  localFrame: number,
  fps: number,
  playbackRate: number,
  clip: Pick<LottieClip, "fr" | "ip" | "op">,
): number {
  const raw = (localFrame / fps) * playbackRate * clip.fr;
  const lastFrame = Math.max(0, clip.op - clip.ip - 0.001);
  return Math.min(Math.max(0, raw), lastFrame);
}

/**
 * Determinism and self-containment guards for a Lottie document. Returns
 * problem strings (empty = acceptable). Rejection beats nondeterministic
 * rendering:
 * - expressions are JavaScript and may call Date/random;
 * - image layers reference external bitmaps (v0 accepts vectors only).
 */
export function validateLottieDocument(document: unknown): string[] {
  const problems: string[] = [];

  if (typeof document !== "object" || document === null) {
    return ["not a JSON object"];
  }

  const doc = document as {
    layers?: unknown[];
    assets?: Array<{ p?: unknown; u?: unknown; layers?: unknown[] }>;
    fr?: unknown;
    op?: unknown;
  };

  if (typeof doc.fr !== "number" || typeof doc.op !== "number") {
    problems.push("missing fr/op — not a Lottie animation document");
    return problems;
  }

  for (const asset of doc.assets ?? []) {
    if (typeof asset?.p === "string" && asset.p.length > 0) {
      problems.push(
        `references external image "${asset.p}" — v0 supports self-contained vector documents only`,
      );
    }
  }

  const layerLists = [
    doc.layers ?? [],
    ...(doc.assets ?? []).map((asset) => asset?.layers ?? []),
  ];

  for (const layers of layerLists) {
    for (const layer of layers as Array<{ ty?: unknown }>) {
      if (layer?.ty === 2) {
        problems.push("contains an image layer (ty 2) — vectors only in v0");
      }
    }
  }

  if (containsExpression(document)) {
    problems.push(
      'contains expressions (string-valued "x") — expressions are JavaScript and may break determinism',
    );
  }

  return problems;
}

function containsExpression(value: unknown): boolean {
  if (Array.isArray(value)) {
    return value.some(containsExpression);
  }

  if (typeof value === "object" && value !== null) {
    for (const [key, child] of Object.entries(value)) {
      if (key === "x" && typeof child === "string") {
        return true;
      }

      if (containsExpression(child)) {
        return true;
      }
    }
  }

  return false;
}

async function openLottieClip(
  asset: SceneAsset,
  request: PreparedAssetRequest,
  signal?: AbortSignal,
  timeoutMs = 15_000,
): Promise<LottieClip> {
  const bytes = await readPreparedAssetBytes(asset, request, signal);
  let data: {
    fr: number;
    ip?: number;
    op: number;
    w?: number;
    h?: number;
  };
  try {
    data = JSON.parse(new TextDecoder().decode(bytes)) as typeof data;
  } catch (cause) {
    throw new Error("Lottie asset is not valid UTF-8 JSON.", { cause });
  }

  const problems = validateLottieDocument(data);

  if (problems.length > 0) {
    throw new Error(problems.join("; "));
  }

  let imported: unknown;

  try {
    imported = await import("lottie-web");
  } catch {
    throw new Error(
      "the scene uses a lottie asset but lottie-web is not installed. Add the optional peer dependency: npm install lottie-web",
    );
  }

  const lottie = ((imported as { default?: unknown }).default ?? imported) as {
    loadAnimation(options: unknown): unknown;
  };
  const width = data.w ?? 512;
  const height = data.h ?? 512;
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d");

  if (!context) {
    throw new Error("Canvas2D unavailable for the lottie player.");
  }

  let animation: LottieReadyAnimation | undefined;
  try {
    animation = lottie.loadAnimation({
      renderer: "canvas",
      loop: false,
      autoplay: false,
      animationData: data,
      rendererSettings: { context, clearCanvas: true },
    } as never) as typeof animation;
    if (!animation) throw new Error("lottie-web returned no animation.");

    await waitForLottieReady(animation, signal, timeoutMs);
    assertNotAborted(signal);
    return {
      fr: data.fr,
      ip: data.ip ?? 0,
      op: data.op,
      width,
      height,
      animation,
      canvas,
    };
  } catch (error) {
    animation?.destroy();
    throw error;
  }
}

/**
 * Loads a font asset and registers it with the environment's FontFaceSet
 * under the asset id, so styles reference it as fontFamily: "<asset id>".
 * Registration is idempotent per (id, src) pair.
 */
async function loadFont(
  id: string,
  asset: SceneAsset,
  request: PreparedAssetRequest,
  configuredCache: FontAssetCache<FontFace> | undefined,
  signal?: AbortSignal,
  preparation?: AssetPreparationQueue,
): Promise<{ readonly face: FontFace; release(): void }> {
  // Windows expose the set as document.fonts, workers as self.fonts.
  const fontSet =
    typeof document !== "undefined"
      ? document.fonts
      : (globalThis as { fonts?: FontFaceSet }).fonts;

  if (!fontSet) {
    throw new Error(
      "this environment has no FontFaceSet (document.fonts or self.fonts); font assets need a browser or worker context",
    );
  }

  const cache = configuredCache ?? getSharedFontCache(fontSet);
  const lease = await cache.acquire(
    `${id}\u0000${request.contentKey}\u0000${JSON.stringify(fontDescriptors(asset))}`,
    async () => {
      const create = async () => {
        const bytes = await readPreparedAssetBytes(asset, request, signal);
        const descriptor = fontDescriptors(asset);
        const face = new FontFace(descriptor.family, ownedArrayBuffer(bytes), {
          weight: descriptor.weight,
          style: descriptor.style,
        });
        await face.load();
        assertNotAborted(signal);
        return face;
      };
      return preparation ? preparation.run(create) : create();
    },
    asset.metadata?.byteLength,
  );
  fontSet.add(lease.face);
  return lease;
}

function fontDescriptors(asset: SceneAsset) {
  return {
    family: asset.metadata?.fontFamily ?? asset.id,
    weight: String(asset.metadata?.fontWeight ?? "normal"),
    style: asset.metadata?.fontStyle ?? "normal",
  };
}

function truncateSrc(src: string): string {
  if (src.startsWith("data:")) return "data:[redacted]";
  let redacted = src;
  try {
    const parsed = new URL(src, "https://motionforge.invalid");
    parsed.username = "";
    parsed.password = "";
    parsed.search = "";
    parsed.hash = "";
    redacted = src.startsWith("/")
      ? `${parsed.pathname}`
      : parsed.origin === "https://motionforge.invalid"
        ? parsed.pathname
        : parsed.toString();
  } catch {
    redacted = src.split(/[?#]/, 1)[0] ?? "[invalid source]";
  }
  return redacted.length > 96 ? `${redacted.slice(0, 96)}…` : redacted;
}

/**
 * createImageBitmap(blob) cannot decode SVG in Chromium; fall back to an
 * HTMLImageElement (already rasterized at its intrinsic size) when available.
 */
async function decodeImageBlob(blob: Blob): Promise<ImageBitmap> {
  try {
    return await createImageBitmap(blob);
  } catch (error) {
    if (typeof document === "undefined") {
      throw error;
    }

    const url = URL.createObjectURL(blob);

    try {
      const image = new Image();
      image.src = url;
      await image.decode();
      return await createImageBitmap(image);
    } finally {
      URL.revokeObjectURL(url);
    }
  }
}

export type CompileCanvas2DDisplayListOptions = Pick<
  RenderOptions,
  "assets" | "resolvedScene" | "textMeasureCache"
> & {
  /** Optional compiler ceilings; core defaults remain authoritative. */
  budgets?: Partial<DisplayListCompilerBudgets>;
};

// Prepared frames share the immutable Scene contract. Only results created by
// this renderer may bypass authoritative re-evaluation in the private facade.
const preparedSceneOwners = new WeakMap<ResolvedScene, Scene>();

type CompiledCanvasFrame = {
  scene: Scene;
  resolved: ResolvedScene;
  displayList: DisplayList;
  trusted: boolean;
  textMeasureCache?: TextMeasureCache;
};

/**
 * Evaluates, lays out, and compiles one frame with one exact Canvas measurer.
 * Prepared/native resources are consulted only by the extension compilation
 * bridge and never become part of the returned JSON artifact.
 */
export function compileCanvas2DDisplayList(
  context: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D,
  sceneInput: Scene,
  frame: number,
  options: CompileCanvas2DDisplayListOptions = {},
): DisplayList {
  return compileCanvasFrame(context, sceneInput, frame, options).displayList;
}

function compileCanvasFrame(
  context: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D,
  sceneInput: Scene,
  frame: number,
  options: CompileCanvas2DDisplayListOptions,
): CompiledCanvasFrame {
  const scene = parseScene(sceneInput);
  if (options.assets) assertResolvedAssetsCompatible(scene, options.assets);
  const resolved = options.resolvedScene ?? evaluateScene(scene, frame);
  const evaluatedFrame = Math.max(0, Math.min(frame, scene.duration - 1));
  if (resolved.frame !== evaluatedFrame) {
    throw new Error(
      `Resolved scene targets frame ${resolved.frame}, but Canvas2D display compilation requested evaluated frame ${evaluatedFrame}.`,
    );
  }
  let text: ReturnType<typeof canvasFrameTextResources> | undefined;
  const textResources = () =>
    (text ??= canvasFrameTextResources(
      context,
      scene,
      options.assets,
      options.textMeasureCache,
    ));
  // Graphics-only frames do not need to enumerate fonts or allocate text caches.
  const measureLine: MeasureTextLine = (line, style, fontSize) =>
    measureTextLine(context, line, style, fontSize, textResources().widths);
  const layout = layoutScene(resolved, { measureTextLine: measureLine });
  const extensionCompilations = compileCanvas2DExtensions(
    scene,
    layout.boxes,
    layout.frame,
    options.assets,
  );
  const displayList = compileDisplayList(layout, {
    measureTextLine: measureLine,
    textMetrics: {
      measureLine: (input) => textResources().metrics.measureLine(input),
    },
    mediaMetrics: options.assets
      ? createDisplayMediaMetricsProvider(options.assets)
      : undefined,
    extensionCompilations,
    budgets: options.budgets,
  });
  return {
    scene,
    resolved,
    displayList,
    trusted:
      !options.resolvedScene || preparedSceneOwners.get(resolved) === scene,
    textMeasureCache: text?.widths ?? options.textMeasureCache,
  };
}

function createDisplayMediaMetricsProvider(
  assets: ResolvedAssets,
): MediaMetricsProvider {
  return {
    measure(asset) {
      const source = assets.resolvedSources?.get(asset.id);
      const reason = source
        ? `prepared Canvas2D ${source.usingProxy ? "proxy" : "primary"} resource`
        : "prepared Canvas2D resource";
      const image = assets.images?.get(asset.id);
      if (image) {
        return {
          width: image.width,
          height: image.height,
          fieldMeasurements: {
            width: { measurement: "exact", reason },
            height: { measurement: "exact", reason },
          },
        };
      }
      const video = assets.videos?.get(asset.id);
      if (video) {
        return {
          width: video.width,
          height: video.height,
          durationSeconds: video.duration,
          fieldMeasurements: {
            width: { measurement: "exact", reason },
            height: { measurement: "exact", reason },
            durationSeconds: { measurement: "exact", reason },
          },
        };
      }
      const lottie = assets.lotties?.get(asset.id);
      if (lottie) {
        return {
          width: lottie.width,
          height: lottie.height,
          durationSeconds: (lottie.op - lottie.ip) / lottie.fr,
          fieldMeasurements: {
            width: { measurement: "exact", reason },
            height: { measurement: "exact", reason },
            durationSeconds: { measurement: "exact", reason },
          },
        };
      }
      const audio = assets.audio?.get(asset.id);
      return audio
        ? {
            durationSeconds: audio.duration,
            fieldMeasurements: {
              durationSeconds: { measurement: "exact", reason },
            },
          }
        : undefined;
    },
  };
}

export type ExecuteCanvas2DDisplayListOptions = Omit<
  RenderOptions,
  "resolvedScene"
> & {
  /** Canonical Scene is retained only for resources and legacy callbacks. */
  scene: Scene;
};

type Canvas2DDisplayExecutionState = {
  extensionOperations: ReadonlyMap<string, DisplayExtensionOperation>;
  displayGroups: ReadonlyMap<string, DisplayGroup>;
  opaqueExtensionRegistry?: Canvas2DOpaqueExtensionRegistry;
  staticDisplayCache?: Canvas2DStaticDisplayCache;
  staticResourceIdentity: (reference: StaticDisplayResourceReference) => string;
};

/** Executes one validated display-list frame against separately prepared data. */
export function executeCanvas2DDisplayList(
  context: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D,
  displayList: DisplayList,
  options: ExecuteCanvas2DDisplayListOptions,
): void {
  const scene = parseScene(options.scene);
  if (options.assets) assertResolvedAssetsCompatible(scene, options.assets);
  assertCanvas2DDisplayComposition(displayList, scene);
  const evaluated = evaluateScene(scene, displayList.composition.frame);
  const text = canvasFrameTextResources(
    context,
    scene,
    options.assets,
    options.textMeasureCache,
  );
  executeCanvasFrame(
    context,
    displayList,
    { ...options, textMeasureCache: text.widths },
    scene,
    evaluated,
  );
}

/** Internal-only: the resolved nodes came from this exact compilation. */
function executeCanvasFrame(
  context: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D,
  displayList: DisplayList,
  options: ExecuteCanvas2DDisplayListOptions,
  scene: Scene,
  evaluated: ResolvedScene,
): void {
  const reconstructed = reconstructDisplayGroups(
    displayList.groups,
    evaluated.nodes,
    displayList.composition,
  );
  const opaqueExtensionRegistry =
    options.opaqueExtensionRegistry ?? options.assets?.opaqueExtensionRegistry;
  const execution: Canvas2DDisplayExecutionState = {
    extensionOperations: reconstructed.extensionOperations,
    displayGroups: reconstructed.displayGroups,
    opaqueExtensionRegistry,
    staticDisplayCache: options.staticDisplayCache,
    staticResourceIdentity: createStaticDisplayResourceIdentity(
      options.assets,
      context,
    ),
  };
  assertCanvas2DDisplayCapabilities(
    context,
    displayList,
    execution,
    options.assets,
  );

  if (options.clear ?? true) {
    context.clearRect(
      0,
      0,
      displayList.composition.width,
      displayList.composition.height,
    );
  }

  const transientScratchPool = options.scratchSurfacePool
    ? undefined
    : createTransientScratchSurfacePool(scene);
  const scratchSurfacePool =
    options.scratchSurfacePool ?? transientScratchPool!;
  try {
    for (const box of reconstructed.boxes) {
      drawBox(
        context,
        box,
        scene,
        options.assets,
        displayList.composition.frame,
        displayList.composition.fps,
        options.textMeasureCache,
        scratchSurfacePool,
        execution,
      );
    }
  } finally {
    transientScratchPool?.dispose();
  }
}

/** Compatibility facade: evaluate → layout → display list → Canvas execute. */
export function renderStill(
  context: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D,
  scene: Scene,
  frame: number,
  options: RenderOptions = {},
): void {
  const compiled = compileCanvasFrame(context, scene, frame, {
    assets: options.assets,
    resolvedScene: options.resolvedScene,
    textMeasureCache: options.textMeasureCache,
  });
  const executionOptions: ExecuteCanvas2DDisplayListOptions = {
    scene: compiled.scene,
    clear: options.clear,
    assets: options.assets,
    textMeasureCache: compiled.textMeasureCache,
    scratchSurfacePool: options.scratchSurfacePool,
    opaqueExtensionRegistry: options.opaqueExtensionRegistry,
    staticDisplayCache: options.staticDisplayCache,
  };
  if (compiled.trusted) {
    executeCanvasFrame(
      context,
      compiled.displayList,
      executionOptions,
      compiled.scene,
      compiled.resolved,
    );
  } else {
    executeCanvas2DDisplayList(context, compiled.displayList, executionOptions);
  }
}

function compileCanvas2DExtensions(
  scene: Scene,
  boxes: readonly LayoutBox[],
  frame: number,
  assets: ResolvedAssets | undefined,
): Readonly<Record<string, DisplayExtensionCompilationInput>> {
  const compilations: Record<string, DisplayExtensionCompilationInput> = {};
  const visit = (box: LayoutBox): void => {
    if (box.node.type === "extension" && box.node.extension) {
      const runtime = assets?.extensionNodes?.get(box.node.id);
      if (!runtime) {
        throw new Error(
          `Scene draws extension node "${box.node.id}" but it is not in the resolved assets. Call resolveAssets(scene, { extensions }) and pass the result to renderStill.`,
        );
      }
      const prepared = assertPreparedExtensionFrame(
        runtime,
        assets,
        box.node.id,
        frame,
      );
      const displayDecision = runtime.displayDecision;
      if (displayDecision?.kind !== "legacy-opaque") {
        if (!displayDecision) {
          if (runtime.adapter) {
            // 1.0 callers may have constructed a legacy runtime fixture. Its
            // absence from this map deliberately compiles legacy-opaque.
          } else {
            throw new Error(
              `Extension node "${box.node.id}" has no resolved display decision. Resolve assets through Canvas2D display-target preflight.`,
            );
          }
        } else {
          compilations[box.node.id] = compileResolvedCanvas2DDisplayExtension({
            scene,
            node: box.node as ResolvedNode & ExtensionSceneNode,
            box: {
              x: box.x,
              y: box.y,
              width: box.width,
              height: box.height,
            },
            runtime,
            preparedFrame: prepared?.value,
            frame,
            localFrame: box.node.localFrame,
            sceneFps: scene.fps,
          });
        }
      }
    }
    box.children.forEach(visit);
  };
  boxes.forEach(visit);
  return compilations;
}

function assertPreparedExtensionFrame(
  runtime: ResolvedCanvas2DExtensionNode,
  assets: ResolvedAssets | undefined,
  nodeId: string,
  sceneFrame: number,
): PreparedExtensionFrame | undefined {
  const prepared = assets?.extensionFrames?.get(nodeId);
  if (runtime.definition.prepareFrame && !prepared) {
    throw new Error(
      `Extension node "${nodeId}" has no prepared frame. Await prepareFrame(scene, frame, assets) before renderStill.`,
    );
  }
  if (prepared && prepared.sceneFrame !== sceneFrame) {
    throw new Error(
      `Extension node "${nodeId}" has data prepared for scene frame ${prepared.sceneFrame}, but frame ${sceneFrame} is being rendered. Await prepareFrame(scene, ${sceneFrame}, assets) first.`,
    );
  }
  return prepared;
}

function assertCanvas2DDisplayComposition(
  displayList: DisplayList,
  scene: Scene,
): void {
  if (
    displayList.kind !== "motionforge.display-list" ||
    displayList.version !== 1 ||
    displayList.ephemeral !== true
  ) {
    throw new Error(
      "Canvas2D requires an ephemeral MotionForge display-list v1.",
    );
  }
  const expected = {
    schemaVersion: scene.schemaVersion,
    width: scene.width,
    height: scene.height,
    fps: scene.fps,
    duration: scene.duration,
  };
  for (const key of Object.keys(expected) as Array<keyof typeof expected>) {
    if (displayList.composition[key] !== expected[key]) {
      throw new Error(
        `Canvas2D display-list composition ${key} does not match the supplied Scene.`,
      );
    }
  }
  if (
    !Number.isFinite(displayList.composition.frame) ||
    displayList.composition.frame < 0 ||
    displayList.composition.frame >= displayList.composition.duration
  ) {
    throw new Error("Canvas2D display-list frame is outside the composition.");
  }
}

function reconstructDisplayGroups(
  groups: readonly DisplayGroup[],
  evaluatedNodes: readonly ResolvedNode[],
  composition: DisplayList["composition"],
): {
  boxes: LayoutBox[];
  extensionOperations: ReadonlyMap<string, DisplayExtensionOperation>;
  displayGroups: ReadonlyMap<string, DisplayGroup>;
} {
  const nodeIds = new Set<string>();
  const evaluatedById = new Map<string, ResolvedNode>();
  const collectEvaluated = (node: ResolvedNode): void => {
    evaluatedById.set(node.id, node);
    node.children.forEach(collectEvaluated);
  };
  evaluatedNodes.forEach(collectEvaluated);
  const extensionOperations = new Map<string, DisplayExtensionOperation>();
  const displayGroups = new Map<string, DisplayGroup>();
  const visit = (
    group: DisplayGroup,
    depth: number,
    parentWorld: AffineMatrix2D,
  ): LayoutBox => {
    if (
      group.kind !== "group" ||
      group.depth !== depth ||
      group.nodeId !== group.node.id ||
      group.nodeType !== group.node.type ||
      nodeIds.has(group.nodeId)
    ) {
      throw new Error(
        `Canvas2D received an invalid display group for node ${JSON.stringify(group.nodeId)}.`,
      );
    }
    nodeIds.add(group.nodeId);
    displayGroups.set(group.nodeId, group);
    const evaluatedNode = evaluatedById.get(group.nodeId);
    if (
      !evaluatedNode ||
      stableJsonStringify({ ...evaluatedNode, children: [] }) !==
        stableJsonStringify(group.node)
    ) {
      throw new Error(
        `Canvas2D display group ${JSON.stringify(group.nodeId)} does not match the evaluated Scene node snapshot.`,
      );
    }
    for (const [label, rect] of [
      ["box", group.box],
      ["contentBox", group.contentBox],
    ] as const) {
      if (
        !rect ||
        ![rect.x, rect.y, rect.width, rect.height].every(Number.isFinite) ||
        rect.width < 0 ||
        rect.height < 0
      ) {
        throw new Error(
          `Canvas2D display group ${JSON.stringify(group.nodeId)} has an invalid ${label}.`,
        );
      }
    }
    assertDisplayGroupSemantics(group, composition, parentWorld);
    if (group.node.type === "extension") {
      if (group.content?.kind !== "extension") {
        throw new Error(
          `Canvas2D extension group ${JSON.stringify(group.nodeId)} has no explicit extension operation.`,
        );
      }
      extensionOperations.set(group.nodeId, group.content);
    }
    const children = group.children.map((child) =>
      visit(child, depth + 1, group.worldTransform),
    );
    return {
      id: group.nodeId,
      node: { ...group.node, children: children.map((child) => child.node) },
      x: group.box.x,
      y: group.box.y,
      width: group.box.width,
      height: group.box.height,
      content: { ...group.contentBox },
      children,
    };
  };
  const boxes = groups.map((group) => visit(group, 0, identityAffineMatrix()));
  if (nodeIds.size !== evaluatedById.size) {
    throw new Error(
      "Canvas2D display-list groups do not match the active evaluated Scene nodes.",
    );
  }
  return { boxes, extensionOperations, displayGroups };
}

function assertDisplayGroupSemantics(
  group: DisplayGroup,
  composition: DisplayList["composition"],
  parentWorld: AffineMatrix2D,
): void {
  const node = group.node;
  const style = node.style;
  const softMask =
    node.mask !== undefined &&
    ((node.mask.feather ?? 0) > 0 || (node.mask.opacity ?? 1) < 1);
  const expectedTransform = resolveStyleTransformMatrix(style, group.box);
  const expectedWorld = multiplyAffineMatrices(parentWorld, expectedTransform);
  const expectedBounds = transformLayoutRect(expectedWorld, group.box);
  if (
    group.engineId !== `mf:node:${node.id.length}:${node.id}` ||
    !sameMatrix(group.transform, expectedTransform) ||
    !sameMatrix(group.worldTransform, expectedWorld) ||
    !sameRect(group.transformedBounds, expectedBounds) ||
    group.composite.opacity !== (style.opacity ?? 1) ||
    group.composite.blendMode !== (style.blendMode ?? "source-over") ||
    group.composite.filter !==
      (style.filter !== undefined && style.filter !== "none"
        ? style.filter
        : null) ||
    group.composite.isolation !== (style.isolation ?? false) ||
    group.composite.strategy !==
      (style.isolation || softMask ? "isolated" : "direct") ||
    Boolean(group.clip) !== Boolean(node.clip) ||
    Boolean(group.mask) !== Boolean(node.mask) ||
    Boolean(group.overflowClip) !== (style.overflow === "hidden")
  ) {
    throw new Error(
      `Canvas2D display group ${JSON.stringify(node.id)} has tampered transform/composite semantics.`,
    );
  }

  const backgroundSource = style.background ?? style.backgroundColor;
  if (
    Boolean(group.background) !== Boolean(backgroundSource) ||
    (group.background &&
      (group.background.nodeId !== node.id ||
        group.background.paint.source !== backgroundSource ||
        !sameRect(group.background.bounds, group.box)))
  ) {
    throw new Error(
      `Canvas2D display group ${JSON.stringify(node.id)} has tampered background paint semantics.`,
    );
  }
  const border = style.border ? parseBorderValue(style.border) : null;
  const hasBorder = Boolean(border && border.width > 0);
  if (
    Boolean(group.border) !== hasBorder ||
    (group.border &&
      border &&
      (group.border.nodeId !== node.id ||
        group.border.width !== border.width ||
        group.border.paint.source !== border.color.source ||
        !sameRect(group.border.bounds, group.box)))
  ) {
    throw new Error(
      `Canvas2D display group ${JSON.stringify(node.id)} has tampered border paint semantics.`,
    );
  }

  const content = group.content;
  const expectedValue =
    node.text ?? node.runs?.map((run) => run.text).join("") ?? "";
  if (node.type === "text" && (node.text !== undefined || node.runs)) {
    const reference = Math.min(group.box.width, group.box.height);
    const padding = readLength(style.padding, reference, 0);
    const left = readLength(style.paddingLeft, reference, padding);
    const right = readLength(style.paddingRight, reference, padding);
    const top = readLength(style.paddingTop, reference, padding);
    const bottom = readLength(style.paddingBottom, reference, padding);
    const expectedContent = {
      x: group.box.x + left,
      y: group.box.y + top,
      width: Math.max(0, group.box.width - left - right),
      height: Math.max(0, group.box.height - top - bottom),
    };
    if (
      content?.kind !== "text" ||
      content.nodeId !== node.id ||
      content.value !== expectedValue ||
      content.fill !== (style.color ?? "#ffffff") ||
      !sameRect(content.bounds, expectedContent) ||
      !sameRect(group.contentBox, expectedContent)
    ) {
      throw new Error(
        `Canvas2D display group ${JSON.stringify(node.id)} has tampered text paint semantics.`,
      );
    }
    return;
  }
  if (node.type === "shape" && node.shape) {
    const open = node.shape.kind === "line" || node.shape.kind === "polyline";
    const fillSource = style.fill ?? (open ? undefined : "#000000");
    const strokeSource = style.stroke ?? (open ? "#000000" : undefined);
    if (
      content?.kind !== "shape" ||
      content.nodeId !== node.id ||
      content.fill?.source !== fillSource ||
      content.stroke?.paint.source !== strokeSource ||
      !sameRect(content.bounds, group.box)
    ) {
      throw new Error(
        `Canvas2D display group ${JSON.stringify(node.id)} has tampered shape paint semantics.`,
      );
    }
    return;
  }
  if (
    (node.type === "img" || node.type === "video" || node.type === "lottie") &&
    node.assetId
  ) {
    const expectedKind =
      node.type === "img"
        ? "image"
        : node.type === "video"
          ? "prepared-video"
          : "prepared-lottie";
    if (
      content?.kind !== "media" ||
      content.nodeId !== node.id ||
      content.resource.kind !== expectedKind ||
      content.resource.assetId !== node.assetId ||
      (content.resource.kind !== "image" &&
        (content.resource.nodeId !== node.id ||
          content.resource.sceneFrame !== composition.frame)) ||
      !sameRect(content.bounds, group.box)
    ) {
      throw new Error(
        `Canvas2D display group ${JSON.stringify(node.id)} has tampered media paint semantics.`,
      );
    }
    return;
  }
  if (node.type === "effect" && node.effect) {
    if (
      content?.kind !== "effect" ||
      content.nodeId !== node.id ||
      content.effect !== node.effect ||
      content.localFrame !== node.localFrame ||
      content.sceneFps !== composition.fps ||
      stableJsonStringify(content.params) !==
        stableJsonStringify(node.params ?? {})
    ) {
      throw new Error(
        `Canvas2D display group ${JSON.stringify(node.id)} has tampered effect semantics.`,
      );
    }
    return;
  }
  if (node.type === "extension" && node.extension) {
    if (
      content?.kind !== "extension" ||
      content.nodeId !== node.id ||
      content.extension.name !== node.extension.name ||
      content.extension.version !== node.extension.version ||
      stableJsonStringify(content.extension.params) !==
        stableJsonStringify(node.extension.params)
    ) {
      throw new Error(
        `Canvas2D display group ${JSON.stringify(node.id)} has tampered extension semantics.`,
      );
    }
    return;
  }
  if (content !== null) {
    throw new Error(
      `Canvas2D display group ${JSON.stringify(node.id)} has unexpected content paint semantics.`,
    );
  }
}

function sameRect(
  left: { x: number; y: number; width: number; height: number },
  right: { x: number; y: number; width: number; height: number },
): boolean {
  return (
    left.x === right.x &&
    left.y === right.y &&
    left.width === right.width &&
    left.height === right.height
  );
}

function sameMatrix(left: AffineMatrix2D, right: AffineMatrix2D): boolean {
  return (
    left.a === right.a &&
    left.b === right.b &&
    left.c === right.c &&
    left.d === right.d &&
    left.e === right.e &&
    left.f === right.f
  );
}

function stableJsonStringify(value: unknown): string {
  const normalize = (entry: unknown): unknown => {
    if (Array.isArray(entry)) return entry.map(normalize);
    if (typeof entry !== "object" || entry === null) return entry;
    return Object.fromEntries(
      Object.keys(entry as Record<string, unknown>)
        .sort()
        .map((key) => [
          key,
          normalize((entry as Record<string, unknown>)[key]),
        ]),
    );
  };
  return JSON.stringify(normalize(value));
}

const preparedStaticResourceIdentities = new WeakMap<object, number>();
let nextPreparedStaticResourceIdentity = 1;

function createStaticDisplayResourceIdentity(
  assets: ResolvedAssets | undefined,
  context: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D,
): (reference: StaticDisplayResourceReference) => string {
  let fontGeneration: string | undefined;
  return (reference) => {
    if (reference.kind === "image") {
      const image = assets?.images?.get(reference.assetId);
      if (!image) {
        throw new Error(
          `Static image resource ${JSON.stringify(reference.assetId)} is not prepared.`,
        );
      }
      return staticPreparedResourceIdentity(
        image,
        assets?.resolvedSources?.get(reference.assetId),
      );
    }
    const families = new Set(fontFamilyNames(reference.family));
    const fonts = [...(assets?.fonts ?? [])].filter(
      ([id, font]) =>
        families.has(id) ||
        fontFamilyNames(font.family ?? id).some((family) =>
          families.has(family),
        ),
    );
    fontGeneration ??= canvasFontGeneration(context, assets);
    if (!fonts.length)
      return `${fontGeneration}\u0000system-font:${reference.family}:${reference.weight}:${reference.style}`;
    return `${fontGeneration}\u0000${fonts
      .map(([id, font]) =>
        staticPreparedResourceIdentity(font, assets?.resolvedSources?.get(id)),
      )
      .sort()
      .join("\u0000")}`;
  };
}

function staticPreparedResourceIdentity(
  resource: object,
  source: ResolvedAssetSource | undefined,
): string {
  let objectIdentity = preparedStaticResourceIdentities.get(resource);
  if (!objectIdentity) {
    objectIdentity = nextPreparedStaticResourceIdentity;
    nextPreparedStaticResourceIdentity += 1;
    preparedStaticResourceIdentities.set(resource, objectIdentity);
  }
  return JSON.stringify([
    source?.resourceKey ?? source?.contentKey ?? source?.declarationKey ?? null,
    objectIdentity,
  ]);
}

function assertCanvas2DDisplayCapabilities(
  context: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D,
  displayList: DisplayList,
  execution: Canvas2DDisplayExecutionState,
  assets: ResolvedAssets | undefined,
): void {
  for (const requirement of displayList.requirements) {
    const capability = `${requirement.id}@${requirement.version}`;
    if (capability === "motionforge.effect@1") continue;
    if (capability === "motionforge.mask.soft@1") {
      const needsFeatherFilter = requirement.nodeIds.some(
        (nodeId) =>
          (execution.displayGroups.get(nodeId)?.mask?.feather ?? 0) > 0,
      );
      if (needsFeatherFilter && !("filter" in context)) {
        throw new Error(
          "Canvas2D feathered masks require context.filter support.",
        );
      }
      continue;
    }
    if (capability === "motionforge.filter@1") {
      if (!("filter" in context)) {
        throw new Error(
          "Canvas2D display list requires context.filter support.",
        );
      }
      continue;
    }
    if (capability === "motionforge.paint.conic@1") {
      if (typeof context.createConicGradient !== "function") {
        throw new Error(
          "Canvas2D display list requires createConicGradient() support.",
        );
      }
      continue;
    }
    if (
      capability ===
      `${legacyExtensionRendererCapability.id}@${legacyExtensionRendererCapability.version}`
    ) {
      for (const nodeId of requirement.nodeIds) {
        const operation = execution.extensionOperations.get(nodeId);
        const runtime = assets?.extensionNodes?.get(nodeId);
        if (
          operation?.mode !== "legacy-opaque" ||
          !runtime?.adapter ||
          (runtime.displayDecision !== undefined &&
            runtime.displayDecision.kind !== "legacy-opaque")
        ) {
          throw new Error(
            `Canvas2D display list requires a resolved legacy adapter for extension node ${JSON.stringify(nodeId)}.`,
          );
        }
      }
      continue;
    }
    const registry = execution.opaqueExtensionRegistry;
    if (!registry) {
      throw new Error(
        `Canvas2D display list requires opaque capability ${capability}, but no registry was supplied.`,
      );
    }
    registry.resolveExact({ id: requirement.id, version: requirement.version });
    for (const nodeId of requirement.nodeIds) {
      const operation = execution.extensionOperations.get(nodeId);
      const runtime = assets?.extensionNodes?.get(nodeId);
      if (
        operation?.mode !== "opaque" ||
        operation.capability.id !== requirement.id ||
        operation.capability.version !== requirement.version ||
        runtime?.displayDecision.kind !== "opaque" ||
        runtime.displayDecision.capability.id !== requirement.id ||
        runtime.displayDecision.capability.version !== requirement.version ||
        runtime.displayDecision.realm !== registry.realm
      ) {
        throw new Error(
          `Canvas2D opaque capability ${capability} does not match extension node ${JSON.stringify(nodeId)} runtime state.`,
        );
      }
    }
  }
}

const DEFAULT_TRANSIENT_SCRATCH_BYTES = 64 * 1024 * 1024;
const MAX_TRANSIENT_SCRATCH_BYTES = 512 * 1024 * 1024;

function createTransientScratchSurfacePool(scene: Scene): ScratchSurfacePool {
  const sceneBytes = checkedRgbaBytes(scene.width, scene.height);
  return new ScratchSurfacePool({
    createCanvas: createStagingCanvas,
    // Four scene-sized surfaces cover the common nested-isolation + mask
    // case, while the hard cap keeps an accidental deep tree from turning a
    // one-shot render into unbounded browser memory growth. Hosts rendering
    // unusually large/deep scenes can inject a session-owned policy instead.
    maxBytes: Math.min(
      MAX_TRANSIENT_SCRATCH_BYTES,
      Math.max(DEFAULT_TRANSIENT_SCRATCH_BYTES, sceneBytes * 4),
    ),
    maxSurfaces: 32,
    // Shadows and object-fit:none pixelation can legitimately stage beyond a
    // composition edge. The byte ceiling remains the authoritative memory
    // guard; the host canvas factory still rejects unsupported dimensions.
    maxDimension: Number.MAX_SAFE_INTEGER,
  });
}

/**
 * Canvas keeps drawing state on an implicit stack. Every internal save must
 * be paired even when a browser API, extension, or test double throws midway
 * through a draw; otherwise the caller's next frame inherits poisoned state.
 */
function withSavedContext<T>(
  context: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D,
  draw: () => T,
): T {
  context.save();
  try {
    return draw();
  } finally {
    context.restore();
  }
}

export type CanvasTextMetricsProviderOptions = {
  maxEntries?: number;
  /** Include prepared font/content identity so replacements cannot hit old metrics. */
  generationKey?: string;
};

type CanvasFrameTextResources = {
  scene: Scene;
  assets: ResolvedAssets | undefined;
  fonts: string;
  measure: CanvasRenderingContext2D["measureText"];
  metrics: TextMetricsProvider;
  widths: TextMeasureCache;
  generation: number;
  callerWidths: WeakMap<TextMeasureCache, TextMeasureCache>;
};
const canvasTextResources = new WeakMap<object, CanvasFrameTextResources>();
let nextCanvasTextGeneration = 1;

/** Namespacing preserves caller-owned Maps and their existing LRU ceilings. */
class GenerationTextMeasureCache extends Map<string, number> {
  constructor(
    private readonly source: TextMeasureCache,
    private readonly generation: number,
  ) {
    super();
  }
  override get(key: string): number | undefined {
    return this.source.get(`${this.generation}\u0000${key}`);
  }
  override set(key: string, value: number): this {
    this.source.set(`${this.generation}\u0000${key}`, value);
    return this;
  }
}

function canvasFrameTextResources(
  context: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D,
  scene: Scene,
  assets: ResolvedAssets | undefined,
  callerWidths?: TextMeasureCache,
): { metrics: TextMetricsProvider; widths: TextMeasureCache } {
  const fonts = canvasFontGeneration(context, assets);
  let entry = canvasTextResources.get(context);
  if (
    !entry ||
    entry.scene !== scene ||
    entry.assets !== assets ||
    entry.fonts !== fonts ||
    entry.measure !== context.measureText
  ) {
    entry = {
      scene,
      assets,
      fonts,
      measure: context.measureText,
      metrics: createCanvasTextMetricsProvider(context),
      widths: new BoundedTextMeasureCache(),
      generation: nextCanvasTextGeneration++,
      callerWidths: new WeakMap(),
    };
    canvasTextResources.set(context, entry);
  }
  if (!callerWidths) return { metrics: entry.metrics, widths: entry.widths };
  let widths = entry.callerWidths.get(callerWidths);
  if (!widths) {
    widths = new GenerationTextMeasureCache(callerWidths, entry.generation);
    entry.callerWidths.set(callerWidths, widths);
  }
  return { metrics: entry.metrics, widths };
}

function canvasFontGeneration(
  context: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D,
  assets: ResolvedAssets | undefined,
): string {
  const fontSet =
    (context.canvas as HTMLCanvasElement | undefined)?.ownerDocument?.fonts ??
    (typeof document !== "undefined"
      ? document.fonts
      : (globalThis as { fonts?: FontFaceSet }).fonts);
  const fontIdentity = (font: FontFace, source?: ResolvedAssetSource) => {
    const descriptor = font as unknown as Record<string, unknown>;
    return [
      staticPreparedResourceIdentity(font, source),
      ...[
        "family",
        "style",
        "weight",
        "stretch",
        "unicodeRange",
        "featureSettings",
        "variationSettings",
        "ascentOverride",
        "descentOverride",
        "lineGapOverride",
        "status",
      ].map((key) => descriptor[key] ?? null),
    ];
  };
  // Checking membership as well as load status covers replacing an already
  // loaded face with another face of the same family (no loading event).
  const nativeFonts =
    fontSet && typeof fontSet[Symbol.iterator] === "function"
      ? Array.from(fontSet, (font) => fontIdentity(font))
      : [];
  return JSON.stringify([
    fontSet ? staticPreparedResourceIdentity(fontSet, undefined) : null,
    fontSet?.status ?? null,
    nativeFonts,
    [...(assets?.fonts ?? [])].map(([id, font]) => [
      id,
      fontIdentity(font, assets?.resolvedSources?.get(id)),
    ]),
  ]);
}

/** Exact synchronous metrics over an already-prepared Canvas/font context. */
export function createCanvasTextMetricsProvider(
  context: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D,
  options: CanvasTextMetricsProviderOptions = {},
): TextMetricsProvider {
  const generationKey = options.generationKey ?? "canvas-fonts-v1";
  return createBoundedTextMetricsProvider(
    {
      measureLine(input) {
        const previousFont = context.font;
        const previousDirection = context.direction;
        const previousTextBaseline = context.textBaseline;
        const supportsLetterSpacing = "letterSpacing" in context;
        const previousLetterSpacing = supportsLetterSpacing
          ? context.letterSpacing
          : undefined;
        try {
          context.font = canvasFont(input.style, input.fontSize);
          context.direction = input.style.direction ?? "inherit";
          // TextMetrics vertical fields are relative to textBaseline. Display
          // lists paint text on the middle baseline, so compile-time ink bounds
          // must measure against that same baseline regardless of caller state.
          context.textBaseline = "middle";
          if (supportsLetterSpacing) {
            const spacing = readLength(
              input.style.letterSpacing,
              input.fontSize,
              0,
            );
            context.letterSpacing = `${spacing}px`;
          }
          const measured = context.measureText(input.text);
          const reason = `Canvas2D TextMetrics (${generationKey})`;
          const ascent = measured.actualBoundingBoxAscent;
          const descent = measured.actualBoundingBoxDescent;
          return {
            width: measured.width,
            ...(Number.isFinite(ascent) && ascent >= 0 ? { ascent } : {}),
            ...(Number.isFinite(descent) && descent >= 0 ? { descent } : {}),
            fieldMeasurements: {
              width: { measurement: "exact", reason },
              ...(Number.isFinite(ascent) && ascent >= 0
                ? { ascent: { measurement: "exact" as const, reason } }
                : {}),
              ...(Number.isFinite(descent) && descent >= 0
                ? { descent: { measurement: "exact" as const, reason } }
                : {}),
            },
          };
        } finally {
          context.font = previousFont;
          context.direction = previousDirection;
          context.textBaseline = previousTextBaseline;
          if (supportsLetterSpacing) {
            context.letterSpacing = previousLetterSpacing ?? "0px";
          }
        }
      },
    },
    { maxEntries: options.maxEntries ?? 2_048 },
  );
}

function canvasFont(style: SceneStyle, fontSize: number): string {
  const fontFamily = style.fontFamily ?? "system-ui, sans-serif";
  const fontWeight = style.fontWeight ?? 400;
  const fontStyle = style.fontStyle ?? "normal";
  return `${fontStyle} ${fontWeight} ${fontSize}px ${fontFamily}`;
}

function measureTextLine(
  context: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D,
  line: string,
  style: SceneStyle,
  fontSize: number,
  textMeasureCache?: TextMeasureCache,
): number {
  const font = canvasFont(style, fontSize);
  const letterSpacing = readLength(style.letterSpacing, fontSize, 0);
  const cacheKey = textMeasureCache
    ? `${font}\u0000${style.direction ?? "inherit"}\u0000${letterSpacing}\u0000${line}`
    : null;
  const cached = cacheKey ? textMeasureCache?.get(cacheKey) : undefined;

  if (cached !== undefined) {
    return cached;
  }

  context.font = font;
  context.direction = style.direction ?? "inherit";
  const spaced = letterSpacing !== 0 && "letterSpacing" in context;
  const previousLetterSpacing = spaced ? context.letterSpacing : undefined;

  if (spaced) {
    context.letterSpacing = `${letterSpacing}px`;
  }

  const width = context.measureText(line).width;

  if (spaced) {
    context.letterSpacing = previousLetterSpacing ?? "0px";
  }

  if (cacheKey) {
    textMeasureCache?.set(cacheKey, width);
  }

  return width;
}

/**
 * Paint order among siblings: ascending zIndex (default 0), stable for equal
 * values so document order keeps deciding ties. zIndex never affects layout.
 */
function sortByZIndex(boxes: LayoutBox[]): LayoutBox[] {
  return boxes
    .map((box, index) => ({ box, index }))
    .sort((a, b) => {
      const za = a.box.node.style.zIndex ?? 0;
      const zb = b.box.node.style.zIndex ?? 0;
      return za === zb ? a.index - b.index : za - zb;
    })
    .map((entry) => entry.box);
}

function drawBox(
  context: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D,
  box: LayoutBox,
  scene: Scene,
  assets: ResolvedAssets | undefined,
  sceneFrame: number,
  sceneFps: number,
  textMeasureCache: TextMeasureCache | undefined,
  scratchSurfacePool: ScratchSurfacePool,
  execution: Canvas2DDisplayExecutionState,
): void {
  const softMask =
    box.node.mask !== undefined &&
    ((box.node.mask.feather ?? 0) > 0 || (box.node.mask.opacity ?? 1) < 1);
  if (box.node.style.isolation || softMask) {
    drawIsolatedBox(
      context,
      box,
      scene,
      assets,
      sceneFrame,
      sceneFps,
      textMeasureCache,
      softMask,
      scratchSurfacePool,
      execution,
    );
    return;
  }
  drawBoxDirect(
    context,
    box,
    scene,
    assets,
    sceneFrame,
    sceneFps,
    textMeasureCache,
    scratchSurfacePool,
    execution,
  );
}

function drawBoxDirect(
  context: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D,
  box: LayoutBox,
  scene: Scene,
  assets: ResolvedAssets | undefined,
  sceneFrame: number,
  sceneFps: number,
  textMeasureCache: TextMeasureCache | undefined,
  scratchSurfacePool: ScratchSurfacePool,
  execution: Canvas2DDisplayExecutionState,
  options: {
    suppressRootComposite?: boolean;
    suppressRootMask?: boolean;
  } = {},
): void {
  const { node } = box;
  const style = node.style;

  context.save();
  try {
    if (!options.suppressRootComposite) {
      context.globalAlpha *= style.opacity ?? 1;
    }
    applyTransform(context, box, style);

    if (style.blendMode && !options.suppressRootComposite) {
      context.globalCompositeOperation = style.blendMode;
    }

    if (style.filter && style.filter !== "none") {
      // Canvas2D applies the filter per draw call, not to the composited
      // subtree, and a child's own filter replaces (not stacks with) this one.
      // Identical to CSS for leaf media/text nodes — the dominant use. Safari
      // has no context.filter; the assignment is a silent no-op there.
      context.filter = style.filter;
    }

    applyVectorConstraints(
      context,
      box,
      node.clip,
      options.suppressRootMask ? undefined : node.mask,
    );

    drawBackground(context, box, style, scratchSurfacePool);

    if (style.overflow === "hidden") {
      // Clip own content and the subtree to the border box, following
      // borderRadius — CSS overflow:hidden semantics. The clip lives inside
      // this box's save/restore, so siblings are unaffected.
      const radius = resolveCornerRadii(style, box);

      if (hasCornerRadius(radius)) {
        roundedRect(context, box.x, box.y, box.width, box.height, radius);
      } else {
        context.beginPath();
        context.rect(box.x, box.y, box.width, box.height);
      }

      context.clip();
    }

    if (node.type === "text" && (node.text !== undefined || node.runs)) {
      const operation = execution.displayGroups.get(node.id)?.content;
      if (operation?.kind !== "text") {
        throw new Error(
          `Canvas2D display list has no compiled text operation for node ${JSON.stringify(node.id)}.`,
        );
      }
      drawCompiledText(context, operation);
    }

    if (node.type === "img" && node.assetId) {
      drawImage(context, box, node.assetId, style, assets, scratchSurfacePool);
    }

    if (node.type === "video" && node.assetId) {
      drawVideo(
        context,
        box,
        node,
        style,
        assets,
        sceneFrame,
        scratchSurfacePool,
      );
    }

    if (node.type === "lottie" && node.assetId) {
      drawLottie(
        context,
        box,
        node,
        style,
        assets,
        sceneFrame,
        scratchSurfacePool,
      );
    }

    if (node.type === "effect" && node.effect) {
      drawEffect(context, box, node, assets, sceneFps);
    }

    if (node.type === "extension" && node.extension) {
      drawExtension(
        context,
        box,
        scene,
        node,
        assets,
        sceneFrame,
        sceneFps,
        execution,
      );
    }

    if (node.type === "shape" && node.shape) {
      drawShape(context, box, node.shape, style);
    }

    drawBorder(context, box, style);

    for (const child of sortByZIndex(box.children)) {
      drawBox(
        context,
        child,
        scene,
        assets,
        sceneFrame,
        sceneFps,
        textMeasureCache,
        scratchSurfacePool,
        execution,
      );
    }
  } finally {
    context.restore();
  }
}

function drawIsolatedBox(
  context: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D,
  box: LayoutBox,
  scene: Scene,
  assets: ResolvedAssets | undefined,
  sceneFrame: number,
  sceneFps: number,
  textMeasureCache: TextMeasureCache | undefined,
  softMask: boolean,
  scratchSurfacePool: ScratchSurfacePool,
  execution: Canvas2DDisplayExecutionState,
): void {
  const bounds = resolveIsolationBounds(box, scene, execution.displayGroups);
  if (!bounds) return;
  const displayGroup = execution.displayGroups.get(box.id);
  const staticDisplayCache = execution.staticDisplayCache;
  const cacheEligible = Boolean(
    staticDisplayCache &&
    displayGroup?.composite.strategy === "isolated" &&
    isStaticDisplayGroup(displayGroup),
  );
  if (cacheEligible && displayGroup && staticDisplayCache) {
    const cached = staticDisplayCache.get(displayGroup, bounds, {
      resourceIdentity: execution.staticResourceIdentity,
    });
    if (cached) {
      compositeIsolatedRaster(context, cached, bounds, box.node.style);
      return;
    }
  }
  const lease = scratchSurfacePool.acquire({
    width: bounds.width,
    height: bounds.height,
    purpose: `isolation:${box.id}`,
  });
  const adoptionEligible = Boolean(
    cacheEligible &&
    displayGroup &&
    staticDisplayCache?.canAdopt(displayGroup, bounds, lease.bucket, {
      resourceIdentity: execution.staticResourceIdentity,
    }),
  );
  let poisoned = true;
  try {
    const isolatedContext = lease.context;
    isolatedContext.clearRect(0, 0, bounds.width, bounds.height);
    withSavedContext(isolatedContext, () => {
      isolatedContext.translate(-bounds.x, -bounds.y);
      drawBoxDirect(
        isolatedContext,
        box,
        scene,
        assets,
        sceneFrame,
        sceneFps,
        textMeasureCache,
        scratchSurfacePool,
        execution,
        { suppressRootComposite: true, suppressRootMask: softMask },
      );
    });

    if (softMask && box.node.mask) {
      applySoftMask(
        isolatedContext,
        box,
        box.node.mask,
        bounds,
        scratchSurfacePool,
      );
    }

    compositeIsolatedRaster(context, lease.surface, bounds, box.node.style);
    poisoned = false;
    if (adoptionEligible && displayGroup && staticDisplayCache) {
      const detached = lease.detach();
      if (detached) {
        staticDisplayCache.adopt(displayGroup, bounds, detached, {
          resourceIdentity: execution.staticResourceIdentity,
        });
      }
    }
  } finally {
    lease.release({ poisoned });
  }
}

function compositeIsolatedRaster(
  context: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D,
  surface: CanvasImageSource,
  bounds: IsolationBounds,
  style: SceneStyle,
): void {
  withSavedContext(context, () => {
    context.globalAlpha *= style.opacity ?? 1;
    if (style.blendMode) {
      context.globalCompositeOperation = style.blendMode;
    }
    // A pooled backing store may be larger than the requested crop. Never
    // composite stale pixels from the unused bucket remainder.
    context.drawImage(
      surface,
      0,
      0,
      bounds.width,
      bounds.height,
      bounds.x,
      bounds.y,
      bounds.width,
      bounds.height,
    );
  });
}

type IsolationBounds = LayoutRect;
type CollectedInkBounds = {
  bounds: LayoutRect | null;
  fullScene: boolean;
};

/**
 * Computes a conservative pixel crop in the isolated node's parent
 * coordinate space. Opaque host extensions and procedural effects retain the
 * legacy full-scene staging contract because their painter can emit pixels
 * outside its declared box.
 */
function resolveIsolationBounds(
  box: LayoutBox,
  scene: Pick<Scene, "width" | "height">,
  displayGroups: ReadonlyMap<string, DisplayGroup>,
): IsolationBounds | null {
  const sceneRect: LayoutRect = {
    x: 0,
    y: 0,
    width: scene.width,
    height: scene.height,
  };
  const collected = collectSubtreeInkBounds(
    box,
    identityAffineMatrix(),
    displayGroups,
  );
  if (collected.fullScene) return sceneRect;
  const raw = collected.bounds;
  if (!raw) return null;
  if (![raw.x, raw.y, raw.width, raw.height].every(Number.isFinite)) {
    return sceneRect;
  }
  const left = Math.max(0, Math.floor(snapNearInteger(raw.x)));
  const top = Math.max(0, Math.floor(snapNearInteger(raw.y)));
  const right = Math.min(
    scene.width,
    Math.ceil(snapNearInteger(raw.x + raw.width)),
  );
  const bottom = Math.min(
    scene.height,
    Math.ceil(snapNearInteger(raw.y + raw.height)),
  );
  if (right <= left || bottom <= top) return null;
  return { x: left, y: top, width: right - left, height: bottom - top };
}

function snapNearInteger(value: number): number {
  const rounded = Math.round(value);
  return Math.abs(value - rounded) <= 1e-9 * Math.max(1, Math.abs(value))
    ? rounded
    : value;
}

function collectSubtreeInkBounds(
  box: LayoutBox,
  parentTransform: AffineMatrix2D,
  displayGroups: ReadonlyMap<string, DisplayGroup>,
): CollectedInkBounds {
  if (box.node.type === "extension" || box.node.type === "effect") {
    return { bounds: null, fullScene: true };
  }

  const transform = multiplyAffineMatrices(
    parentTransform,
    resolveStyleTransformMatrix(box.node.style, box),
  );
  let bounds: LayoutRect | null = null;
  const ownBounds = resolveOwnInkBounds(box, displayGroups.get(box.id));
  if (ownBounds) {
    bounds = transformLayoutRect(transform, ownBounds);
  }
  for (const child of box.children) {
    const childBounds = collectSubtreeInkBounds(
      child,
      transform,
      displayGroups,
    );
    if (childBounds.fullScene) return childBounds;
    bounds = unionLayoutRects(bounds, childBounds.bounds);
  }

  const filterMargin = resolveFilterMargin(box.node.style.filter);
  if (bounds && filterMargin > 0) {
    bounds = expandLayoutRect(bounds, filterMargin);
  }
  const feather = box.node.mask?.feather ?? 0;
  if (bounds && feather > 0) {
    // Canvas blur kernels are truncated by implementations. Three radii is a
    // deliberately conservative device-pixel envelope for mask feathering.
    bounds = expandLayoutRect(bounds, feather * 3);
  }
  return { bounds, fullScene: false };
}

function resolveOwnInkBounds(
  box: LayoutBox,
  displayGroup: DisplayGroup | undefined,
): LayoutRect | null {
  const { node } = box;
  const style = node.style;
  let bounds: LayoutRect | null = null;
  const boxRect: LayoutRect = {
    x: box.x,
    y: box.y,
    width: box.width,
    height: box.height,
  };

  if (style.background ?? style.backgroundColor) {
    bounds = boxRect;
    for (const shadow of style.boxShadow
      ? parseBoxShadows(style.boxShadow)
      : []) {
      bounds = unionLayoutRects(
        bounds,
        shadowLayoutRect(boxRect, shadow.offsetX, shadow.offsetY, shadow.blur),
      );
    }
  }

  const border = style.border ? parseBorder(style.border) : null;
  if (border) {
    bounds = unionLayoutRects(
      bounds,
      expandLayoutRect(boxRect, border.width / 2),
    );
  }

  if (node.type === "shape" && node.shape) {
    const strokeWidth = style.strokeWidth ?? 1;
    const hasStroke =
      style.stroke !== undefined ||
      node.shape.kind === "line" ||
      node.shape.kind === "polyline";
    // Canvas's default miter limit is 10, hence five stroke widths from the
    // path centerline. Round/bevel joins need only half a stroke.
    const strokeMargin = hasStroke
      ? style.strokeLineJoin === "round" || style.strokeLineJoin === "bevel"
        ? strokeWidth / 2
        : strokeWidth * 5
      : 0;
    bounds = unionLayoutRects(bounds, expandLayoutRect(boxRect, strokeMargin));
  } else if (
    node.type === "img" ||
    node.type === "video" ||
    node.type === "lottie"
  ) {
    bounds = unionLayoutRects(bounds, boxRect);
  } else if (
    node.type === "text" &&
    (node.text !== undefined || node.runs !== undefined)
  ) {
    const compiled = displayGroup?.content;
    if (compiled?.kind === "text") {
      bounds = unionLayoutRects(bounds, compiledTextInkBounds(compiled));
      return bounds;
    }
    // A detached/malformed list must not crop unknown glyph extents.
    return {
      x: Number.NEGATIVE_INFINITY,
      y: Number.NEGATIVE_INFINITY,
      width: Number.POSITIVE_INFINITY,
      height: Number.POSITIVE_INFINITY,
    };
  }
  return bounds;
}

function compiledTextInkBounds(operation: DisplayTextOperation): LayoutRect {
  let result: LayoutRect | null = null;
  for (const line of operation.lines) {
    if (line.text === "") continue;
    const startX =
      line.runs.length > 0
        ? line.x
        : operation.align === "center"
          ? line.x - line.width / 2
          : operation.align === "right"
            ? line.x - line.width
            : line.x;
    let lineBounds: LayoutRect = {
      x: startX,
      y: line.y - line.metrics.ascent,
      width: line.width,
      height: line.metrics.ascent + line.metrics.descent,
    };
    for (const run of line.runs) {
      lineBounds = unionLayoutRects(lineBounds, {
        x: run.x,
        y: line.y - line.metrics.ascent,
        width: run.width,
        height: line.metrics.ascent + line.metrics.descent,
      })!;
    }
    const strokeWidth = Math.max(
      operation.stroke?.width ?? 0,
      ...line.runs.map((run) => run.stroke?.width ?? 0),
    );
    lineBounds = expandLayoutRect(lineBounds, strokeWidth + 1);
    if (operation.shadow) {
      lineBounds = unionLayoutRects(
        lineBounds,
        shadowLayoutRect(
          lineBounds,
          operation.shadow.offsetX,
          operation.shadow.offsetY,
          operation.shadow.blur,
        ),
      )!;
    }
    if (line.background) {
      lineBounds = unionLayoutRects(lineBounds, {
        x: startX - line.background.paddingX,
        y: line.y - operation.lineHeight / 2 - line.background.paddingY,
        width: line.width + line.background.paddingX * 2,
        height: operation.lineHeight + line.background.paddingY * 2,
      })!;
    }
    for (const run of line.runs) {
      const color = run.background?.color ?? run.backgroundColor;
      if (!color) continue;
      const paddingX = run.background?.paddingX ?? 0;
      const paddingY = run.background?.paddingY ?? 0;
      lineBounds = unionLayoutRects(lineBounds, {
        x: run.x - paddingX,
        y: line.y - operation.lineHeight / 2 - paddingY,
        width: run.width + paddingX * 2,
        height: operation.lineHeight + paddingY * 2,
      })!;
    }
    result = unionLayoutRects(result, lineBounds);
  }
  return result ?? operation.bounds;
}

function resolveFilterMargin(filter: string | undefined): number {
  if (!filter || filter === "none") return 0;
  const parsed = parseFilterValue(filter);
  if (!parsed || parsed.kind === "none") return 0;
  return parsed.functions.reduce(
    (margin, fn) => margin + (fn.kind === "blur" ? fn.value * 3 : 0),
    0,
  );
}

function shadowLayoutRect(
  source: LayoutRect,
  offsetX: number,
  offsetY: number,
  blur: number,
): LayoutRect {
  const spread = blur * 2;
  return {
    x: source.x + offsetX - spread,
    y: source.y + offsetY - spread,
    width: source.width + spread * 2,
    height: source.height + spread * 2,
  };
}

function expandLayoutRect(rect: LayoutRect, amount: number): LayoutRect {
  const margin = Math.max(0, amount);
  return {
    x: rect.x - margin,
    y: rect.y - margin,
    width: rect.width + margin * 2,
    height: rect.height + margin * 2,
  };
}

function unionLayoutRects(
  left: LayoutRect | null,
  right: LayoutRect | null,
): LayoutRect | null {
  if (!left) return right ? { ...right } : null;
  if (!right) return { ...left };
  const x = Math.min(left.x, right.x);
  const y = Math.min(left.y, right.y);
  const rightEdge = Math.max(left.x + left.width, right.x + right.width);
  const bottomEdge = Math.max(left.y + left.height, right.y + right.height);
  return { x, y, width: rightEdge - x, height: bottomEdge - y };
}

function drawExtension(
  context: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D,
  box: LayoutBox,
  scene: Scene,
  node: LayoutBox["node"],
  assets: ResolvedAssets | undefined,
  sceneFrame: number,
  sceneFps: number,
  execution: Canvas2DDisplayExecutionState,
): void {
  const runtime = assets?.extensionNodes?.get(node.id);
  if (!runtime) {
    throw new Error(
      `Scene draws extension node "${node.id}" but it is not in the resolved assets. Call resolveAssets(scene, { extensions }) and pass the result to renderStill.`,
    );
  }

  const prepared = assertPreparedExtensionFrame(
    runtime,
    assets,
    node.id,
    sceneFrame,
  );
  const operation = execution.extensionOperations.get(node.id);
  if (!operation) {
    throw new Error(
      `Canvas2D display list has no extension operation for node ${JSON.stringify(node.id)}.`,
    );
  }
  const adapter = runtime.adapter;
  executeCanvas2DDisplayExtension({
    context,
    operation,
    box: { x: box.x, y: box.y, width: box.width, height: box.height },
    preparedImages: collectPreparedExtensionImages(runtime, assets),
    resolvedAssets: runtime.resolvedAssets,
    preparedFrame: prepared?.value,
    opaqueRegistry: execution.opaqueExtensionRegistry,
    legacyDraw:
      operation.mode === "legacy-opaque" && adapter
        ? ({ context: target }) => {
            return adapter.draw({
              context: target,
              scene,
              node: node as ResolvedNode & ExtensionSceneNode,
              box,
              params: runtime.params,
              resolvedAssets: runtime.resolvedAssets,
              preparedFrame: prepared?.value,
              sceneFrame,
              localFrame: node.localFrame,
              sceneFps,
            });
          }
        : undefined,
  });
}

function collectPreparedExtensionImages(
  runtime: ResolvedCanvas2DExtensionNode,
  assets: ResolvedAssets | undefined,
): ReadonlyMap<string, Canvas2DExtensionPreparedImage> {
  const prepared = new Map<string, Canvas2DExtensionPreparedImage>();
  for (const requirement of runtime.requirements) {
    if (requirement.type !== undefined && requirement.type !== "image")
      continue;
    const image = assets?.images.get(requirement.assetId);
    if (image) {
      prepared.set(
        requirement.assetId,
        image as Canvas2DExtensionPreparedImage,
      );
    }
  }
  return prepared;
}

type ShapePath = {
  path: Path2D;
  fillRule: CanvasFillRule;
  open: boolean;
};

type CornerRadii = LayoutCornerRadii;

export function shapePointInBox(
  point: { x: number; y: number },
  box: Pick<LayoutBox, "x" | "y" | "width" | "height">,
): { x: number; y: number } {
  return {
    x: box.x + point.x * box.width,
    y: box.y + point.y * box.height,
  };
}

function createShapePath(
  box: Pick<LayoutBox, "x" | "y" | "width" | "height">,
  geometry: SceneShapeGeometry,
  radius: number | CornerRadii = 0,
): ShapePath {
  if (typeof Path2D === "undefined") {
    throw new Error(
      "Shape rendering needs Path2D. Call preflightCanvas2D() before rendering in this environment.",
    );
  }

  const path = new Path2D();

  if (geometry.kind === "rect") {
    addRoundedRectPath(
      path,
      box,
      geometry.radius === undefined
        ? radius
        : readLength(geometry.radius, Math.min(box.width, box.height), 0),
    );
    return { path, fillRule: "nonzero", open: false };
  }

  if (geometry.kind === "ellipse") {
    path.ellipse(
      box.x + box.width / 2,
      box.y + box.height / 2,
      Math.abs(box.width / 2),
      Math.abs(box.height / 2),
      0,
      0,
      Math.PI * 2,
    );
    return { path, fillRule: "nonzero", open: false };
  }

  if (
    geometry.kind === "line" ||
    geometry.kind === "polyline" ||
    geometry.kind === "polygon"
  ) {
    const first = geometry.points[0];
    if (first) {
      const start = shapePointInBox(first, box);
      path.moveTo(start.x, start.y);
      for (const point of geometry.points.slice(1)) {
        const next = shapePointInBox(point, box);
        path.lineTo(next.x, next.y);
      }
      if (geometry.kind === "polygon") path.closePath();
    }
    return {
      path,
      fillRule: "nonzero",
      open: geometry.kind !== "polygon",
    };
  }

  if (typeof DOMMatrix === "undefined") {
    throw new Error(
      "SVG path rendering needs DOMMatrix. Call preflightCanvas2D() before rendering in this environment.",
    );
  }
  const source = new Path2D(geometry.d);
  const scaleX = box.width / geometry.viewBox.width;
  const scaleY = box.height / geometry.viewBox.height;
  path.addPath(
    source,
    new DOMMatrix([
      scaleX,
      0,
      0,
      scaleY,
      box.x - geometry.viewBox.x * scaleX,
      box.y - geometry.viewBox.y * scaleY,
    ]),
  );
  return {
    path,
    fillRule: geometry.fillRule ?? "nonzero",
    open: false,
  };
}

function addRoundedRectPath(
  path: Path2D,
  box: Pick<LayoutBox, "x" | "y" | "width" | "height">,
  radius: number | CornerRadii,
): void {
  const radii = normalizeCornerRadii(radius, box.width, box.height);
  if (!hasCornerRadius(radii)) {
    path.rect(box.x, box.y, box.width, box.height);
    return;
  }

  path.moveTo(box.x + radii.topLeft, box.y);
  path.lineTo(box.x + box.width - radii.topRight, box.y);
  path.quadraticCurveTo(
    box.x + box.width,
    box.y,
    box.x + box.width,
    box.y + radii.topRight,
  );
  path.lineTo(box.x + box.width, box.y + box.height - radii.bottomRight);
  path.quadraticCurveTo(
    box.x + box.width,
    box.y + box.height,
    box.x + box.width - radii.bottomRight,
    box.y + box.height,
  );
  path.lineTo(box.x + radii.bottomLeft, box.y + box.height);
  path.quadraticCurveTo(
    box.x,
    box.y + box.height,
    box.x,
    box.y + box.height - radii.bottomLeft,
  );
  path.lineTo(box.x, box.y + radii.topLeft);
  path.quadraticCurveTo(box.x, box.y, box.x + radii.topLeft, box.y);
  path.closePath();
}

function applyVectorConstraints(
  context: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D,
  box: LayoutBox,
  clip: LayoutBox["node"]["clip"],
  mask: LayoutBox["node"]["mask"],
): void {
  if (clip) {
    const clipPath = createShapePath(box, clip);
    if (clipPath.open) {
      throw new Error(`Node "${box.id}" uses open geometry as a clip.`);
    }
    context.clip(clipPath.path, clipPath.fillRule);
  }

  if (mask) {
    const maskPath = createShapePath(box, mask.shape);
    if (maskPath.open) {
      throw new Error(`Node "${box.id}" uses open geometry as a mask.`);
    }
    if (mask.inverted) {
      const inverse = new Path2D();
      inverse.rect(box.x, box.y, box.width, box.height);
      inverse.addPath(maskPath.path);
      context.clip(inverse, "evenodd");
    } else {
      context.clip(maskPath.path, maskPath.fillRule);
    }
  }
}

function applySoftMask(
  isolatedContext: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D,
  box: LayoutBox,
  mask: NonNullable<LayoutBox["node"]["mask"]>,
  bounds: IsolationBounds,
  scratchSurfacePool: ScratchSurfacePool,
): void {
  const lease = scratchSurfacePool.acquire({
    width: bounds.width,
    height: bounds.height,
    purpose: `soft-mask:${box.id}`,
  });
  let poisoned = true;
  try {
    const maskContext = lease.context;
    maskContext.clearRect(0, 0, bounds.width, bounds.height);
    const maskPath = createShapePath(box, mask.shape);
    if (maskPath.open) {
      throw new Error(`Node "${box.id}" uses open geometry as a mask.`);
    }
    const opacity = mask.opacity ?? 1;
    const feather = mask.feather ?? 0;
    if (feather > 0 && !("filter" in maskContext)) {
      throw new Error(
        "Canvas2D feathered masks require context.filter support.",
      );
    }

    if (mask.inverted) {
      maskContext.fillStyle = "#ffffff";
      maskContext.fillRect(0, 0, bounds.width, bounds.height);
      maskContext.globalCompositeOperation = "destination-out";
    }
    withSavedContext(maskContext, () => {
      maskContext.translate(-bounds.x, -bounds.y);
      applyTransform(maskContext, box, box.node.style);
      maskContext.globalAlpha = opacity;
      if (feather > 0) {
        maskContext.filter = `blur(${feather}px)`;
      }
      maskContext.fillStyle = "#ffffff";
      maskContext.fill(maskPath.path, maskPath.fillRule);
    });

    withSavedContext(isolatedContext, () => {
      isolatedContext.globalCompositeOperation = "destination-in";
      isolatedContext.drawImage(
        lease.surface,
        0,
        0,
        bounds.width,
        bounds.height,
        0,
        0,
        bounds.width,
        bounds.height,
      );
    });
    poisoned = false;
  } finally {
    lease.release({ poisoned });
  }
}

function drawShape(
  context: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D,
  box: LayoutBox,
  geometry: SceneShapeGeometry,
  style: SceneStyle,
): void {
  const shapePath = createShapePath(
    box,
    geometry,
    resolveCornerRadii(style, box),
  );
  const fill = style.fill ?? (shapePath.open ? undefined : "#000000");
  const stroke = style.stroke ?? (shapePath.open ? "#000000" : undefined);

  if (fill) {
    context.fillStyle = parseFill(context, box, fill);
    context.fill(shapePath.path, shapePath.fillRule);
  }

  if (stroke && (style.strokeWidth ?? 1) > 0) {
    context.strokeStyle = parseFill(context, box, stroke);
    context.lineWidth = style.strokeWidth ?? 1;
    context.lineCap = style.strokeLineCap ?? "butt";
    context.lineJoin = style.strokeLineJoin ?? "miter";
    context.setLineDash(style.strokeDash ?? []);
    context.stroke(shapePath.path);
  }
}

/**
 * Geometry for drawing media into a box under objectFit/objectPosition.
 * Exported for tests; coordinates are relative to the box origin.
 */
export function computeObjectFit(
  fit: SceneStyle["objectFit"],
  position: string | undefined,
  box: { width: number; height: number },
  natural: { width: number; height: number },
): { x: number; y: number; width: number; height: number } {
  return resolveObjectFitRect(fit, position, box, natural);
}

function drawImage(
  context: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D,
  box: LayoutBox,
  assetId: string,
  style: SceneStyle,
  assets: ResolvedAssets | undefined,
  scratchSurfacePool: ScratchSurfacePool,
): void {
  const image = assets?.images.get(assetId);

  if (!image) {
    throw new Error(
      `Scene draws image asset "${assetId}" but it is not in the resolved assets. Call resolveAssets(scene) and pass the result to renderStill via options.assets.`,
    );
  }

  drawMedia(context, box, style, image, image, scratchSurfacePool);
}

function drawVideo(
  context: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D,
  box: LayoutBox,
  node: LayoutBox["node"],
  style: SceneStyle,
  assets: ResolvedAssets | undefined,
  sceneFrame: number,
  scratchSurfacePool: ScratchSurfacePool,
): void {
  const prepared = assets?.videoFrames.get(node.id);

  if (!prepared) {
    throw new Error(
      `Scene draws video node "${node.id}" but no frame was staged for it. Await prepareFrame(scene, frame, assets) before renderStill.`,
    );
  }

  if (prepared.sceneFrame !== sceneFrame) {
    throw new Error(
      `Video node "${node.id}" has a frame staged for scene frame ${prepared.sceneFrame}, but frame ${sceneFrame} is being rendered. Await prepareFrame(scene, ${sceneFrame}, assets) first.`,
    );
  }

  drawMedia(context, box, style, prepared.image, prepared, scratchSurfacePool);
}

function drawLottie(
  context: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D,
  box: LayoutBox,
  node: LayoutBox["node"],
  style: SceneStyle,
  assets: ResolvedAssets | undefined,
  sceneFrame: number,
  scratchSurfacePool: ScratchSurfacePool,
): void {
  const prepared = assets?.lottieFrames.get(node.id);

  if (!prepared) {
    throw new Error(
      `Scene draws lottie node "${node.id}" but no frame was staged for it. Await prepareFrame(scene, frame, assets) before renderStill.`,
    );
  }

  if (prepared.sceneFrame !== sceneFrame) {
    throw new Error(
      `Lottie node "${node.id}" has a frame staged for scene frame ${prepared.sceneFrame}, but frame ${sceneFrame} is being rendered. Await prepareFrame(scene, ${sceneFrame}, assets) first.`,
    );
  }

  drawMedia(context, box, style, prepared.image, prepared, scratchSurfacePool);
}

function drawEffect(
  context: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D,
  box: LayoutBox,
  node: LayoutBox["node"],
  assets: ResolvedAssets | undefined,
  sceneFps: number,
): void {
  const params = node.params ?? {};
  const duration = node.duration ?? 30;

  switch (node.effect) {
    case "cartoonBurst":
      drawCartoonBurst(context, box, node.localFrame, duration, params);
      break;
    case "confettiBurst":
      drawConfettiBurst(context, box, node.localFrame, duration, params);
      break;
    case "cloudPop":
      drawCloudPop(context, box, node.localFrame, duration, params);
      break;
    case "speedLines":
      drawSpeedLines(context, box, node.localFrame, duration, params);
      break;
    case "neonAura":
      drawNeonAura(context, box, node.localFrame, duration, params);
      break;
    case "scribbleCircle":
      drawScribbleCircle(context, box, node.localFrame, duration, params);
      break;
    case "spectrumBars":
      drawSpectrumBars(context, box, node.localFrame, sceneFps, params, assets);
      break;
    case "cassetteVuMeter":
      drawCassetteVuMeter(
        context,
        box,
        node.localFrame,
        sceneFps,
        params,
        assets,
      );
      break;
    case "waveformLine":
      drawWaveformLine(context, box, node.localFrame, sceneFps, params, assets);
      break;
    case "mirrorBars":
      drawMirrorBars(context, box, node.localFrame, sceneFps, params, assets);
      break;
    case "circularSpectrum":
      drawCircularSpectrum(
        context,
        box,
        node.localFrame,
        sceneFps,
        params,
        assets,
      );
      break;
    case "neonWaveform":
      drawNeonWaveform(context, box, node.localFrame, sceneFps, params, assets);
      break;
    case "pulseRings":
      drawPulseRings(context, box, node.localFrame, sceneFps, params, assets);
      break;
    case "particleGalaxy":
      drawParticleGalaxy(
        context,
        box,
        node.localFrame,
        sceneFps,
        params,
        assets,
      );
      break;
    case "albumCoverPulse":
      drawAlbumCoverPulse(
        context,
        box,
        node.localFrame,
        sceneFps,
        params,
        assets,
      );
      break;
    case "audioBlob":
      drawAudioBlob(context, box, node.localFrame, sceneFps, params, assets);
      break;
    case "starfieldTunnel":
      drawStarfieldTunnel(
        context,
        box,
        node.localFrame,
        sceneFps,
        params,
        assets,
      );
      break;
    case "equalizerGrid":
      drawEqualizerGrid(
        context,
        box,
        node.localFrame,
        sceneFps,
        params,
        assets,
      );
      break;
    case "liquidGradient":
      drawLiquidGradient(
        context,
        box,
        node.localFrame,
        sceneFps,
        params,
        assets,
      );
      break;
    case "kaleidoscope":
      drawKaleidoscope(context, box, node.localFrame, sceneFps, params, assets);
      break;
    case "vinylRecord":
      drawVinylRecord(context, box, node.localFrame, sceneFps, params, assets);
      break;
    case "audioTerrain":
      drawAudioTerrain(context, box, node.localFrame, sceneFps, params, assets);
      break;
    case "lightningArc":
      drawLightningArc(context, box, node.localFrame, sceneFps, params, assets);
      break;
    case "minimalLineArt":
      drawMinimalLineArt(
        context,
        box,
        node.localFrame,
        sceneFps,
        params,
        assets,
      );
      break;
  }
}

type EffectParams = NonNullable<LayoutBox["node"]["params"]>;

function spectrumValues(
  assets: ResolvedAssets | undefined,
  params: EffectParams,
  localFrame: number,
  sceneFps: number,
): number[] {
  const spectrum = params.audioAssetId
    ? assets?.audioSpectra?.get(params.audioAssetId)
    : undefined;

  if (!spectrum) {
    throw new Error(
      `Audio-reactive effect references spectrum asset "${params.audioAssetId ?? ""}", but no analysis was resolved. Call resolveAssets(scene) and pass the result to preview/export.`,
    );
  }

  const requestedCount = Math.max(
    8,
    Math.min(128, Math.round(params.barCount ?? 64)),
  );
  const sourceTime = audioReactiveSourceTime(params, localFrame, sceneFps);
  const analysisStart = spectrum.startTime ?? 0;
  if (
    sourceTime < analysisStart ||
    (spectrum.duration !== undefined &&
      sourceTime >= analysisStart + spectrum.duration)
  ) {
    return new Array(requestedCount).fill(0);
  }
  const frame = Math.min(
    spectrum.frameCount - 1,
    Math.max(0, Math.floor((sourceTime - analysisStart) * spectrum.fps + 1e-9)),
  );
  const sensitivity = params.sensitivity ?? 1;
  const values = Array.from({ length: requestedCount }, (_, index) => {
    const sourceStart = Math.floor(
      (index / requestedCount) * spectrum.barCount,
    );
    const sourceEnd = Math.max(
      sourceStart + 1,
      Math.floor(((index + 1) / requestedCount) * spectrum.barCount),
    );
    let total = 0;
    for (let source = sourceStart; source < sourceEnd; source += 1) {
      total += spectrum.values[frame * spectrum.barCount + source] ?? 0;
    }
    return clamp01(
      (total / Math.max(1, sourceEnd - sourceStart) / 255) * sensitivity,
    );
  });

  if (params.smoothing) {
    return values.map(
      (value, index) =>
        ((values[index - 1] ?? value) +
          value * 2 +
          (values[index + 1] ?? value)) /
        4,
    );
  }

  return values;
}

function drawSpectrumBars(
  context: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D,
  box: LayoutBox,
  localFrame: number,
  sceneFps: number,
  params: EffectParams,
  assets: ResolvedAssets | undefined,
): void {
  const values = spectrumValues(assets, params, localFrame, sceneFps);
  const colors = effectColors(params, ["#00e676", "#7c3aed", "#f8fbff"]);
  const gap = Math.max(1, box.width * (values.length >= 96 ? 0.0015 : 0.0035));
  const barWidth = Math.max(
    1,
    (box.width - gap * (values.length - 1)) / values.length,
  );
  const baseline = box.y + box.height;

  withSavedContext(context, () => {
    context.globalCompositeOperation = "lighter";
    values.forEach((value, index) => {
      const response = clamp01(Math.pow(value * 0.88 + 0.04, 0.62));
      const height = Math.max(2, box.height * response);
      const x = box.x + index * (barWidth + gap);
      const gradient = context.createLinearGradient(
        x,
        baseline,
        x,
        baseline - height,
      );
      gradient.addColorStop(0, colors[1] ?? "#7c3aed");
      gradient.addColorStop(0.55, colors[0] ?? "#00e676");
      gradient.addColorStop(1, colors[2] ?? "#f8fbff");
      context.fillStyle = gradient;
      context.shadowColor = colors[0] ?? "#00e676";
      context.shadowBlur = Math.max(4, barWidth * 1.8);
      roundedRect(
        context,
        x,
        baseline - height,
        barWidth,
        height,
        Math.min(barWidth / 2, 8),
      );
      context.fill();
    });
  });
}

function drawMirrorBars(
  context: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D,
  box: LayoutBox,
  localFrame: number,
  sceneFps: number,
  params: EffectParams,
  assets: ResolvedAssets | undefined,
): void {
  const values = spectrumValues(assets, params, localFrame, sceneFps);
  const colors = effectColors(params, ["#22d3ee", "#f472b6", "#f8fbff"]);
  const gap = Math.max(1, box.width * (values.length >= 96 ? 0.0015 : 0.0035));
  const barWidth = Math.max(
    1,
    (box.width - gap * (values.length - 1)) / values.length,
  );
  const centerY = box.y + box.height / 2;
  const centerGap = Math.min(
    box.height * 0.12,
    Math.max(2, box.height * 0.035),
  );
  const maxHalf = Math.max(1, (box.height - centerGap) / 2);

  withSavedContext(context, () => {
    context.globalCompositeOperation = "lighter";
    values.forEach((value, index) => {
      const response = clamp01(Math.pow(value * 0.88 + 0.04, 0.62));
      const half = Math.max(1, maxHalf * response);
      const x = box.x + index * (barWidth + gap);
      const topY = centerY - centerGap / 2 - half;
      const bottomY = centerY + centerGap / 2;
      const gradient = context.createLinearGradient(x, topY, x, bottomY + half);
      gradient.addColorStop(0, colors[2] ?? "#f8fbff");
      gradient.addColorStop(0.5, colors[0] ?? "#22d3ee");
      gradient.addColorStop(1, colors[1] ?? "#f472b6");
      context.fillStyle = gradient;
      context.shadowColor = colors[0] ?? "#22d3ee";
      context.shadowBlur = Math.max(4, barWidth * 1.6);
      roundedRect(context, x, topY, barWidth, half, Math.min(barWidth / 2, 8));
      context.fill();
      roundedRect(
        context,
        x,
        bottomY,
        barWidth,
        half,
        Math.min(barWidth / 2, 8),
      );
      context.fill();
    });
  });
}

function drawWaveformLine(
  context: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D,
  box: LayoutBox,
  localFrame: number,
  sceneFps: number,
  params: EffectParams,
  assets: ResolvedAssets | undefined,
): void {
  const values = spectrumValues(assets, params, localFrame, sceneFps);
  if (values.length < 2) return;
  const colors = effectColors(params, ["#22d3ee", "#7c3aed", "#f8fbff"]);
  const centerY = box.y + box.height / 2;
  const maxHalf = (box.height / 2) * 0.92;
  const count = values.length;
  const xAt = (index: number) => box.x + (index / (count - 1)) * box.width;
  const ampAt = (index: number) =>
    Math.max(
      1,
      maxHalf * clamp01(Math.pow((values[index] ?? 0) * 0.9 + 0.03, 0.6)),
    );

  withSavedContext(context, () => {
    context.globalCompositeOperation = "lighter";

    // Filled ribbon between the upper wave and its mirror below the center line.
    context.beginPath();
    context.moveTo(xAt(0), centerY - ampAt(0));
    for (let i = 1; i < count; i += 1)
      context.lineTo(xAt(i), centerY - ampAt(i));
    for (let i = count - 1; i >= 0; i -= 1)
      context.lineTo(xAt(i), centerY + ampAt(i));
    context.closePath();
    const fill = context.createLinearGradient(
      box.x,
      centerY - maxHalf,
      box.x,
      centerY + maxHalf,
    );
    fill.addColorStop(0, colors[0] ?? "#22d3ee");
    fill.addColorStop(1, colors[1] ?? "#7c3aed");
    context.globalAlpha = 0.5;
    context.fillStyle = fill;
    context.fill();
    context.globalAlpha = 1;

    // Bright mirrored strokes for the oscilloscope edge.
    context.lineJoin = "round";
    context.lineCap = "round";
    context.lineWidth = Math.max(2, box.height * 0.012);
    context.strokeStyle = colors[2] ?? "#f8fbff";
    context.shadowColor = colors[0] ?? "#22d3ee";
    context.shadowBlur = Math.max(6, box.height * 0.03);
    for (const sign of [-1, 1]) {
      context.beginPath();
      context.moveTo(xAt(0), centerY + sign * ampAt(0));
      for (let i = 1; i < count; i += 1) {
        context.lineTo(xAt(i), centerY + sign * ampAt(i));
      }
      context.stroke();
    }
  });
}

function spectrumBands(values: number[]): {
  energy: number;
  bass: number;
  mid: number;
  high: number;
} {
  const averageRange = (start: number, end: number) => {
    const slice = values.slice(start, Math.max(start + 1, end));
    return (
      slice.reduce((sum, value) => sum + value, 0) / Math.max(1, slice.length)
    );
  };

  return {
    energy: averageRange(0, values.length),
    bass: averageRange(0, Math.ceil(values.length * 0.2)),
    mid: averageRange(
      Math.floor(values.length * 0.28),
      Math.ceil(values.length * 0.65),
    ),
    high: averageRange(Math.floor(values.length * 0.72), values.length),
  };
}

function drawCircularSpectrum(
  context: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D,
  box: LayoutBox,
  localFrame: number,
  sceneFps: number,
  params: EffectParams,
  assets: ResolvedAssets | undefined,
): void {
  const values = spectrumValues(
    assets,
    { ...params, barCount: 64 },
    localFrame,
    sceneFps,
  );
  const bands = spectrumBands(values);
  const colors = effectColors(params, ["#14f195", "#7c3aed", "#f8fbff"]);
  const cx = box.x + box.width / 2;
  const cy = box.y + box.height / 2;
  const base = Math.min(box.width, box.height);
  const inner = base * (0.23 + bands.bass * 0.025);
  const maxLength = base * 0.19;
  const rotation = (localFrame / sceneFps) * 0.18;

  withSavedContext(context, () => {
    context.globalCompositeOperation = "lighter";
    values.forEach((value, index) => {
      const angle =
        (index / values.length) * Math.PI * 2 - Math.PI / 2 + rotation;
      const response = clamp01(Math.pow(value * 0.9 + 0.05, 0.58));
      const outer = inner + base * 0.025 + response * maxLength;
      const x1 = cx + Math.cos(angle) * inner;
      const y1 = cy + Math.sin(angle) * inner;
      const x2 = cx + Math.cos(angle) * outer;
      const y2 = cy + Math.sin(angle) * outer;
      context.strokeStyle = colors[index % 5 === 0 ? 1 : 0] ?? "#14f195";
      context.lineWidth = Math.max(2, base * (0.003 + response * 0.006));
      context.lineCap = "round";
      context.shadowColor = context.strokeStyle as string;
      context.shadowBlur = Math.max(5, base * 0.018);
      context.globalAlpha = 0.5 + response * 0.5;
      context.beginPath();
      context.moveTo(x1, y1);
      context.lineTo(x2, y2);
      context.stroke();
    });

    const orb = context.createRadialGradient(
      cx,
      cy,
      base * 0.025,
      cx,
      cy,
      inner * 0.94,
    );
    orb.addColorStop(0, colors[2] ?? "#f8fbff");
    orb.addColorStop(0.28, colors[0] ?? "#14f195");
    orb.addColorStop(1, colors[1] ?? "#7c3aed");
    context.globalAlpha = 0.28 + bands.energy * 0.38;
    context.fillStyle = orb;
    context.beginPath();
    context.arc(cx, cy, inner * (0.83 + bands.bass * 0.12), 0, Math.PI * 2);
    context.fill();

    context.globalAlpha = 0.4;
    context.strokeStyle = colors[2] ?? "#f8fbff";
    context.lineWidth = Math.max(1, base * 0.003);
    for (let ring = 0; ring < 3; ring += 1) {
      context.setLineDash([
        base * (0.012 + ring * 0.006),
        base * (0.014 + ring * 0.007),
      ]);
      context.lineDashOffset = -localFrame * (0.8 + ring * 0.35);
      context.beginPath();
      context.arc(cx, cy, inner + base * (0.08 + ring * 0.055), 0, Math.PI * 2);
      context.stroke();
    }
  });
}

function drawNeonWaveform(
  context: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D,
  box: LayoutBox,
  localFrame: number,
  sceneFps: number,
  params: EffectParams,
  assets: ResolvedAssets | undefined,
): void {
  const values = spectrumValues(
    assets,
    { ...params, barCount: 64 },
    localFrame,
    sceneFps,
  );
  const bands = spectrumBands(values);
  const colors = effectColors(params, ["#ff4d6d", "#ffb703", "#fff7ed"]);
  const centerY = box.y + box.height / 2;
  const phase = (localFrame / sceneFps) * Math.PI * 2.2;

  withSavedContext(context, () => {
    context.globalCompositeOperation = "lighter";
    [0, 1, 2].forEach((ribbon) => {
      context.beginPath();
      values.forEach((value, index) => {
        const x = box.x + (index / Math.max(1, values.length - 1)) * box.width;
        const response = clamp01(value * 0.92 + bands.energy * 0.18);
        const wave = Math.sin(index * 0.58 + phase + ribbon * 1.7);
        const y =
          centerY +
          wave * box.height * (0.08 + response * (0.28 - ribbon * 0.04));
        if (index === 0) context.moveTo(x, y);
        else context.lineTo(x, y);
      });
      context.strokeStyle = colors[ribbon === 0 ? 2 : ribbon - 1] ?? "#fff7ed";
      context.lineWidth = Math.max(
        2,
        box.height * (ribbon === 0 ? 0.025 : 0.012),
      );
      context.lineCap = "round";
      context.lineJoin = "round";
      context.shadowColor = colors[ribbon % 2] ?? "#ff4d6d";
      context.shadowBlur = Math.max(8, box.height * (0.06 + bands.high * 0.05));
      context.globalAlpha = ribbon === 0 ? 0.96 : 0.4;
      context.stroke();
    });
  });
}

function drawPulseRings(
  context: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D,
  box: LayoutBox,
  localFrame: number,
  sceneFps: number,
  params: EffectParams,
  assets: ResolvedAssets | undefined,
): void {
  const values = spectrumValues(
    assets,
    { ...params, barCount: 32 },
    localFrame,
    sceneFps,
  );
  const bands = spectrumBands(values);
  const colors = effectColors(params, ["#22d3ee", "#f472b6", "#f7f7ff"]);
  const cx = box.x + box.width / 2;
  const cy = box.y + box.height / 2;
  const base = Math.min(box.width, box.height);

  withSavedContext(context, () => {
    context.globalCompositeOperation = "lighter";
    for (let ring = 0; ring < 7; ring += 1) {
      const phase = ((localFrame / sceneFps) * 0.54 + ring / 7) % 1;
      const radius = base * (0.11 + phase * 0.39 + bands.bass * 0.025);
      context.globalAlpha = (1 - phase) * (0.2 + bands.energy * 0.72);
      context.strokeStyle = colors[ring % 2] ?? "#22d3ee";
      context.lineWidth = Math.max(
        2,
        base * (0.004 + (1 - phase) * 0.014 + bands.bass * 0.008),
      );
      context.shadowColor = context.strokeStyle as string;
      context.shadowBlur = Math.max(6, base * 0.025);
      context.beginPath();
      context.arc(cx, cy, radius, 0, Math.PI * 2);
      context.stroke();
    }

    const core = context.createRadialGradient(cx, cy, 0, cx, cy, base * 0.13);
    core.addColorStop(0, colors[2] ?? "#f7f7ff");
    core.addColorStop(0.35, colors[0] ?? "#22d3ee");
    core.addColorStop(1, "rgba(0,0,0,0)");
    context.globalAlpha = 0.52 + bands.energy * 0.4;
    context.fillStyle = core;
    context.beginPath();
    context.arc(cx, cy, base * (0.1 + bands.bass * 0.035), 0, Math.PI * 2);
    context.fill();
  });
}

function drawParticleGalaxy(
  context: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D,
  box: LayoutBox,
  localFrame: number,
  sceneFps: number,
  params: EffectParams,
  assets: ResolvedAssets | undefined,
): void {
  const values = spectrumValues(
    assets,
    { ...params, barCount: 64 },
    localFrame,
    sceneFps,
  );
  const bands = spectrumBands(values);
  const colors = effectColors(params, ["#14f195", "#7c3aed", "#f8fbff"]);
  const cx = box.x + box.width / 2;
  const cy = box.y + box.height / 2;
  const base = Math.min(box.width, box.height);
  const count = Math.max(32, Math.min(160, params.particleCount ?? 96));
  const time = localFrame / sceneFps;

  withSavedContext(context, () => {
    context.globalCompositeOperation = "lighter";
    for (let index = 0; index < count; index += 1) {
      const lane = index % 9;
      const random = seededRandom(9137 + index * 73);
      const angle = index * 2.399 + time * (0.2 + lane * 0.018);
      const radius =
        base *
        (0.07 +
          lane * 0.042 +
          random * 0.045 +
          bands.bass * (0.018 + lane * 0.002));
      const x = cx + Math.cos(angle) * radius;
      const y = cy + Math.sin(angle) * radius * (0.38 + (index % 5) * 0.035);
      const size =
        base *
        (0.0025 + (index % 6) * 0.0009 + bands.high * (index % 4) * 0.0008);
      const color = colors[index % 5 === 0 ? 2 : index % 2] ?? "#ffffff";
      context.globalAlpha = 0.35 + random * 0.42 + bands.high * 0.2;
      context.fillStyle = color;
      context.shadowColor = color;
      context.shadowBlur = Math.max(3, size * 3);
      context.beginPath();
      context.arc(x, y, Math.max(1, size), 0, Math.PI * 2);
      context.fill();
    }

    const core = context.createRadialGradient(cx, cy, 0, cx, cy, base * 0.13);
    core.addColorStop(0, colors[2] ?? "#f8fbff");
    core.addColorStop(0.28, colors[0] ?? "#14f195");
    core.addColorStop(1, "rgba(0,0,0,0)");
    context.globalAlpha = 0.72;
    context.fillStyle = core;
    context.beginPath();
    context.arc(cx, cy, base * (0.1 + bands.bass * 0.025), 0, Math.PI * 2);
    context.fill();
  });
}

function drawAlbumCoverPulse(
  context: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D,
  box: LayoutBox,
  localFrame: number,
  sceneFps: number,
  params: EffectParams,
  assets: ResolvedAssets | undefined,
): void {
  const values = spectrumValues(
    assets,
    { ...params, barCount: 32 },
    localFrame,
    sceneFps,
  );
  const bands = spectrumBands(values);
  const colors = effectColors(params, ["#f59e0b", "#ec4899", "#fff7ed"]);
  const cx = box.x + box.width / 2;
  const cy = box.y + box.height / 2;
  const base = Math.min(box.width, box.height);
  const coverSize = base * 0.48 * (1 + bands.bass * 0.075);
  const coverX = cx - coverSize / 2;
  const coverY = cy - coverSize / 2;
  const cover = params.coverAssetId
    ? assets?.images.get(params.coverAssetId)
    : undefined;

  withSavedContext(context, () => {
    context.globalCompositeOperation = "lighter";
    for (let ring = 0; ring < 3; ring += 1) {
      context.globalAlpha = 0.18 + bands.energy * (0.28 - ring * 0.045);
      context.strokeStyle = colors[ring % 2] ?? "#f59e0b";
      context.lineWidth = Math.max(2, base * (0.004 + bands.bass * 0.008));
      context.shadowColor = context.strokeStyle as string;
      context.shadowBlur = Math.max(8, base * 0.028);
      context.beginPath();
      context.arc(cx, cy, coverSize * (0.56 + ring * 0.15), 0, Math.PI * 2);
      context.stroke();
    }
  });

  withSavedContext(context, () => {
    context.shadowColor = colors[0] ?? "#f59e0b";
    context.shadowBlur = Math.max(12, base * (0.035 + bands.bass * 0.06));
    roundedRect(
      context,
      coverX,
      coverY,
      coverSize,
      coverSize,
      coverSize * 0.075,
    );
    context.clip();
    if (cover) {
      context.drawImage(cover, coverX, coverY, coverSize, coverSize);
    } else {
      const fallback = context.createLinearGradient(
        coverX,
        coverY,
        coverX + coverSize,
        coverY + coverSize,
      );
      fallback.addColorStop(0, colors[1] ?? "#ec4899");
      fallback.addColorStop(0.58, colors[0] ?? "#f59e0b");
      fallback.addColorStop(1, "#020617");
      context.fillStyle = fallback;
      context.fillRect(coverX, coverY, coverSize, coverSize);
      context.fillStyle = "#09090b";
      context.beginPath();
      context.arc(cx, cy, coverSize * 0.23, 0, Math.PI * 2);
      context.fill();
      context.strokeStyle = colors[2] ?? "#fff7ed";
      context.lineWidth = Math.max(2, coverSize * 0.015);
      context.beginPath();
      context.arc(cx, cy, coverSize * 0.065, 0, Math.PI * 2);
      context.stroke();
    }
  });

  withSavedContext(context, () => {
    context.strokeStyle = "rgba(255,255,255,0.42)";
    context.lineWidth = Math.max(1, base * 0.002);
    roundedRect(
      context,
      coverX,
      coverY,
      coverSize,
      coverSize,
      coverSize * 0.075,
    );
    context.stroke();
  });
}

function drawAudioBlob(
  context: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D,
  box: LayoutBox,
  localFrame: number,
  sceneFps: number,
  params: EffectParams,
  assets: ResolvedAssets | undefined,
): void {
  const values = spectrumValues(
    assets,
    { ...params, barCount: 32 },
    localFrame,
    sceneFps,
  );
  const bands = spectrumBands(values);
  const colors = effectColors(params, ["#22d3ee", "#f472b6", "#f7f7ff"]);
  const cx = box.x + box.width / 2;
  const cy = box.y + box.height / 2;
  const base = Math.min(box.width, box.height);
  const time = localFrame / sceneFps;
  withSavedContext(context, () => {
    context.globalCompositeOperation = "lighter";
    for (let layer = 3; layer >= 0; layer -= 1) {
      const radius = base * (0.18 + layer * 0.055 + bands.bass * 0.045);
      const gradient = context.createRadialGradient(
        cx - radius * 0.24,
        cy - radius * 0.2,
        radius * 0.04,
        cx,
        cy,
        radius,
      );
      gradient.addColorStop(0, colors[2] ?? "#f7f7ff");
      gradient.addColorStop(0.36, colors[layer % 2] ?? "#22d3ee");
      gradient.addColorStop(
        1,
        layer === 0 ? (colors[1] ?? "#f472b6") : "rgba(0,0,0,0)",
      );
      context.fillStyle = gradient;
      context.strokeStyle = colors[layer % 2] ?? "#22d3ee";
      context.lineWidth = Math.max(1, base * (0.002 + (3 - layer) * 0.0015));
      context.globalAlpha = layer === 0 ? 0.76 : 0.18 + bands.energy * 0.13;
      context.shadowColor = context.strokeStyle as string;
      context.shadowBlur = base * (0.025 + bands.bass * 0.05);
      context.beginPath();
      context.ellipse(
        cx,
        cy,
        radius * (1 + Math.sin(time * 1.3 + layer) * 0.12),
        radius * (0.82 + Math.cos(time * 1.1 + layer) * 0.13),
        time * (layer % 2 ? -0.18 : 0.15) + layer,
        0,
        Math.PI * 2,
      );
      context.fill();
      context.stroke();
    }
  });
}

function drawStarfieldTunnel(
  context: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D,
  box: LayoutBox,
  localFrame: number,
  sceneFps: number,
  params: EffectParams,
  assets: ResolvedAssets | undefined,
): void {
  const values = spectrumValues(
    assets,
    { ...params, barCount: 32 },
    localFrame,
    sceneFps,
  );
  const bands = spectrumBands(values);
  const colors = effectColors(params, ["#14f195", "#7c3aed", "#f8fbff"]);
  const cx = box.x + box.width / 2;
  const cy = box.y + box.height / 2;
  const count = Math.max(48, Math.min(160, params.particleCount ?? 96));
  withSavedContext(context, () => {
    context.globalCompositeOperation = "lighter";
    for (let index = 0; index < count; index += 1) {
      const speed = 0.7 + (index % 7) * 0.13 + bands.energy * 1.2;
      const phase =
        ((((localFrame / sceneFps) * speed + index * 0.17) % 1) + 1) % 1;
      const angle = index * 2.399 + (index % 5) * 0.17;
      const radius =
        Math.pow(phase, 1.65) * Math.min(box.width * 0.56, box.height * 0.84);
      const x = cx + Math.cos(angle) * radius;
      const y = cy + Math.sin(angle) * radius * 0.58;
      const tail = box.width * (0.002 + phase * (0.025 + bands.bass * 0.025));
      const color =
        colors[index % 6 === 0 ? 1 : index % 3 === 0 ? 0 : 2] ?? "#fff";
      context.strokeStyle = color;
      context.lineWidth = Math.max(1, phase * 3.5);
      context.globalAlpha = 0.15 + phase * 0.85;
      context.shadowColor = color;
      context.shadowBlur = 4 + phase * 10;
      context.beginPath();
      context.moveTo(x, y);
      context.lineTo(
        x + Math.cos(angle) * tail,
        y + Math.sin(angle) * tail * 0.58,
      );
      context.stroke();
    }
  });
}

function drawEqualizerGrid(
  context: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D,
  box: LayoutBox,
  localFrame: number,
  sceneFps: number,
  params: EffectParams,
  assets: ResolvedAssets | undefined,
): void {
  const values = spectrumValues(
    assets,
    { ...params, barCount: 32 },
    localFrame,
    sceneFps,
  );
  const colors = effectColors(params, ["#00e676", "#7c3aed", "#f8fbff"]);
  const columns = 16;
  const rows = 9;
  const gap = Math.max(2, Math.min(box.width, box.height) * 0.012);
  const cellWidth = (box.width - gap * (columns - 1)) / columns;
  const cellHeight = (box.height - gap * (rows - 1)) / rows;
  withSavedContext(context, () => {
    context.globalCompositeOperation = "lighter";
    for (let column = 0; column < columns; column += 1) {
      const source = Math.floor((column / columns) * values.length);
      const response = clamp01((values[source] ?? 0) * 0.92 + 0.05);
      const active = Math.max(1, Math.round(response * rows));
      for (let row = 0; row < rows; row += 1) {
        const lit = rows - row <= active;
        const color = row < 2 ? colors[1] : row < 5 ? colors[2] : colors[0];
        context.globalAlpha = lit ? 0.48 + response * 0.48 : 0.06;
        context.fillStyle = color ?? "#00e676";
        context.shadowColor = context.fillStyle as string;
        context.shadowBlur = lit ? 6 + response * 12 : 0;
        roundedRect(
          context,
          box.x + column * (cellWidth + gap),
          box.y + row * (cellHeight + gap),
          cellWidth,
          cellHeight,
          Math.min(cellWidth, cellHeight) * 0.22,
        );
        context.fill();
      }
    }
  });
}

function drawLiquidGradient(
  context: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D,
  box: LayoutBox,
  localFrame: number,
  sceneFps: number,
  params: EffectParams,
  assets: ResolvedAssets | undefined,
): void {
  const values = spectrumValues(
    assets,
    { ...params, barCount: 64 },
    localFrame,
    sceneFps,
  );
  const bands = spectrumBands(values);
  const colors = effectColors(params, ["#22d3ee", "#f472b6", "#f7f7ff"]);
  const time = localFrame / sceneFps;
  withSavedContext(context, () => {
    context.globalCompositeOperation = "lighter";
    for (let blob = 0; blob < 6; blob += 1) {
      const x =
        box.x +
        box.width *
          (0.12 +
            ((blob * 0.23 + Math.sin(time * (0.24 + blob * 0.03))) % 0.82));
      const y =
        box.y +
        box.height *
          (0.16 + ((blob * 0.31 + Math.cos(time * (0.2 + blob * 0.02))) % 0.7));
      const radius =
        Math.min(box.width, box.height) *
        (0.16 + (blob % 3) * 0.05 + bands.bass * 0.06);
      const gradient = context.createRadialGradient(x, y, 0, x, y, radius);
      gradient.addColorStop(0, colors[blob % 2] ?? "#22d3ee");
      gradient.addColorStop(1, "rgba(0,0,0,0)");
      context.fillStyle = gradient;
      context.globalAlpha = 0.24 + bands.energy * 0.2;
      context.beginPath();
      context.arc(x, y, radius, 0, Math.PI * 2);
      context.fill();
    }
    context.globalAlpha = 0.86;
    context.strokeStyle = colors[2] ?? "#f7f7ff";
    context.lineWidth = Math.max(2, box.height * 0.01);
    context.shadowColor = colors[0] ?? "#22d3ee";
    context.shadowBlur = box.height * 0.04;
    context.beginPath();
    values.forEach((value, index) => {
      const x = box.x + (index / Math.max(1, values.length - 1)) * box.width;
      const y =
        box.y +
        box.height *
          (0.5 + Math.sin(index * 0.42 + time * 1.6) * (0.06 + value * 0.22));
      if (index === 0) context.moveTo(x, y);
      else context.lineTo(x, y);
    });
    context.stroke();
  });
}

function drawKaleidoscope(
  context: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D,
  box: LayoutBox,
  localFrame: number,
  sceneFps: number,
  params: EffectParams,
  assets: ResolvedAssets | undefined,
): void {
  const values = spectrumValues(
    assets,
    { ...params, barCount: 32 },
    localFrame,
    sceneFps,
  );
  const bands = spectrumBands(values);
  const colors = effectColors(params, ["#22d3ee", "#f472b6", "#f7f7ff"]);
  const cx = box.x + box.width / 2;
  const cy = box.y + box.height / 2;
  const base = Math.min(box.width, box.height);
  const time = localFrame / sceneFps;
  withSavedContext(context, () => {
    context.globalCompositeOperation = "lighter";
    for (let layer = 0; layer < 4; layer += 1) {
      const radius = base * (0.16 + layer * 0.09 + bands.bass * 0.035);
      const segments = 16;
      withSavedContext(context, () => {
        context.translate(cx, cy);
        context.rotate(time * (layer % 2 ? -0.22 : 0.28) + layer * 0.35);
        for (let segment = 0; segment < segments; segment += 1) {
          context.rotate((Math.PI * 2) / segments);
          context.globalAlpha =
            0.18 + bands.energy * 0.25 + (segment % 2) * 0.08;
          context.fillStyle =
            colors[(segment + layer) % colors.length] ?? "#22d3ee";
          context.beginPath();
          context.moveTo(0, 0);
          context.lineTo(radius * 0.32, -radius * 0.14);
          context.lineTo(radius, 0);
          context.lineTo(radius * 0.32, radius * 0.14);
          context.closePath();
          context.fill();
        }
      });
    }
  });
}

function drawVinylRecord(
  context: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D,
  box: LayoutBox,
  localFrame: number,
  sceneFps: number,
  params: EffectParams,
  assets: ResolvedAssets | undefined,
): void {
  const values = spectrumValues(
    assets,
    { ...params, barCount: 32 },
    localFrame,
    sceneFps,
  );
  const bands = spectrumBands(values);
  const colors = effectColors(params, ["#f59e0b", "#ec4899", "#fff7ed"]);
  const cx = box.x + box.width * 0.46;
  const cy = box.y + box.height * 0.55;
  const radius = Math.min(box.width, box.height) * (0.32 + bands.bass * 0.018);
  withSavedContext(context, () => {
    context.fillStyle = "#070707";
    context.shadowColor = colors[0] ?? "#f59e0b";
    context.shadowBlur = 18 + bands.bass * 50;
    context.beginPath();
    context.arc(cx, cy, radius, 0, Math.PI * 2);
    context.fill();
    context.strokeStyle = "rgba(255,255,255,.13)";
    context.lineWidth = Math.max(1, radius * 0.006);
    for (let groove = 1; groove < 13; groove += 1) {
      context.beginPath();
      context.arc(cx, cy, radius * (0.2 + groove * 0.062), 0, Math.PI * 2);
      context.stroke();
    }
    const label = context.createRadialGradient(
      cx,
      cy,
      0,
      cx,
      cy,
      radius * 0.25,
    );
    label.addColorStop(0, colors[2] ?? "#fff7ed");
    label.addColorStop(0.28, colors[0] ?? "#f59e0b");
    label.addColorStop(1, colors[1] ?? "#ec4899");
    context.fillStyle = label;
    context.beginPath();
    context.arc(cx, cy, radius * 0.24, 0, Math.PI * 2);
    context.fill();
    context.fillStyle = "#09090b";
    context.beginPath();
    context.arc(cx, cy, radius * 0.035, 0, Math.PI * 2);
    context.fill();
    context.translate(box.x + box.width * 0.82, box.y + box.height * 0.24);
    context.rotate(0.48 + bands.mid * 0.18);
    context.fillStyle = colors[2] ?? "#fff7ed";
    roundedRect(
      context,
      0,
      -radius * 0.035,
      radius * 0.88,
      radius * 0.07,
      radius * 0.03,
    );
    context.fill();
  });
}

function drawAudioTerrain(
  context: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D,
  box: LayoutBox,
  localFrame: number,
  sceneFps: number,
  params: EffectParams,
  assets: ResolvedAssets | undefined,
): void {
  const values = spectrumValues(
    assets,
    { ...params, barCount: 32 },
    localFrame,
    sceneFps,
  );
  const colors = effectColors(params, ["#14f195", "#7c3aed", "#f8fbff"]);
  const time = localFrame / sceneFps;
  withSavedContext(context, () => {
    context.globalCompositeOperation = "lighter";
    for (let row = 0; row < 15; row += 1) {
      const depth = row / 14;
      const horizonY = box.y + box.height * (0.28 + depth * 0.68);
      const inset = box.width * (0.04 + (1 - depth) * 0.22);
      context.beginPath();
      values.forEach((value, column) => {
        const x =
          box.x +
          inset +
          (column / Math.max(1, values.length - 1)) * (box.width - inset * 2);
        const history =
          Math.sin(column * 0.52 + row * 0.7 - time * 1.35) * 0.16;
        const y =
          horizonY -
          box.height *
            (0.025 + value * 0.12 + history * 0.08) *
            (0.35 + depth * 0.65);
        if (column === 0) context.moveTo(x, y);
        else context.lineTo(x, y);
      });
      context.strokeStyle = colors[row % 4 === 0 ? 1 : 0] ?? "#14f195";
      context.lineWidth = Math.max(1, 1 + depth * 2.2);
      context.globalAlpha = 0.18 + depth * 0.72;
      context.shadowColor = context.strokeStyle as string;
      context.shadowBlur = depth * 8;
      context.stroke();
    }
  });
}

function drawLightningArc(
  context: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D,
  box: LayoutBox,
  localFrame: number,
  sceneFps: number,
  params: EffectParams,
  assets: ResolvedAssets | undefined,
): void {
  const values = spectrumValues(
    assets,
    { ...params, barCount: 32 },
    localFrame,
    sceneFps,
  );
  const bands = spectrumBands(values);
  const colors = effectColors(params, ["#22d3ee", "#f472b6", "#f7f7ff"]);
  const cx = box.x + box.width / 2;
  const cy = box.y + box.height / 2;
  const time = localFrame / sceneFps;
  withSavedContext(context, () => {
    context.globalCompositeOperation = "lighter";
    for (let bolt = 0; bolt < 7; bolt += 1) {
      const angle =
        bolt * ((Math.PI * 2) / 7) + time * (bolt % 2 ? -0.08 : 0.11);
      const distance =
        Math.min(box.width, box.height) * (0.28 + bands.high * 0.18);
      context.beginPath();
      context.moveTo(cx, cy);
      for (let segment = 1; segment <= 10; segment += 1) {
        const progress = segment / 10;
        const jitter =
          Math.sin(localFrame * 0.37 + bolt * 17 + segment * 11) *
          distance *
          0.045;
        const x =
          cx +
          Math.cos(angle) * distance * progress +
          Math.cos(angle + Math.PI / 2) * jitter;
        const y =
          cy +
          Math.sin(angle) * distance * progress +
          Math.sin(angle + Math.PI / 2) * jitter;
        context.lineTo(x, y);
      }
      context.strokeStyle = colors[bolt % 3] ?? "#f7f7ff";
      context.lineWidth = Math.max(1, 1.5 + bands.high * 4);
      context.globalAlpha = 0.26 + bands.high * 0.7;
      context.shadowColor = context.strokeStyle as string;
      context.shadowBlur = 9 + bands.high * 24;
      context.stroke();
    }
  });
}

function drawMinimalLineArt(
  context: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D,
  box: LayoutBox,
  localFrame: number,
  sceneFps: number,
  params: EffectParams,
  assets: ResolvedAssets | undefined,
): void {
  const values = spectrumValues(
    assets,
    { ...params, barCount: 64 },
    localFrame,
    sceneFps,
  );
  const bands = spectrumBands(values);
  const colors = effectColors(params, ["#ffffff", "#a3a3a3", "#ffffff"]);
  const time = localFrame / sceneFps;
  withSavedContext(context, () => {
    context.globalCompositeOperation = "lighter";
    for (let line = 0; line < 5; line += 1) {
      context.beginPath();
      values.forEach((value, index) => {
        const x = box.x + (index / Math.max(1, values.length - 1)) * box.width;
        const y =
          box.y +
          box.height *
            (0.5 +
              (line - 2) * 0.1 +
              Math.sin(index * 0.55 + time * (0.75 + line * 0.08) + line) *
                (0.03 + value * 0.1));
        if (index === 0) context.moveTo(x, y);
        else context.lineTo(x, y);
      });
      context.strokeStyle = colors[line === 2 ? 2 : line % 2] ?? "#ffffff";
      context.lineWidth = line === 2 ? 2.2 : 1;
      context.globalAlpha = line === 2 ? 0.82 : 0.24 + bands.high * 0.2;
      context.shadowColor = colors[0] ?? "#ffffff";
      context.shadowBlur = line === 2 ? 8 + bands.energy * 10 : 0;
      context.stroke();
    }
  });
}

function drawCassetteVuMeter(
  context: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D,
  box: LayoutBox,
  localFrame: number,
  sceneFps: number,
  params: EffectParams,
  assets: ResolvedAssets | undefined,
): void {
  const values = spectrumValues(
    assets,
    { ...params, barCount: 24 },
    localFrame,
    sceneFps,
  );
  const colors = effectColors(params, ["#fb7185", "#facc15", "#f8fafc"]);
  const energy = values.reduce((sum, value) => sum + value, 0) / values.length;
  const bass = values.slice(0, 6).reduce((sum, value) => sum + value, 0) / 6;
  const radius = Math.min(box.width, box.height) * 0.06;

  withSavedContext(context, () => {
    context.fillStyle = "#111827";
    roundedRect(context, box.x, box.y, box.width, box.height, radius);
    context.fill();
    context.strokeStyle = "rgba(255,255,255,0.18)";
    context.lineWidth = Math.max(2, box.width * 0.006);
    context.stroke();

    const panelX = box.x + box.width * 0.08;
    const panelY = box.y + box.height * 0.1;
    const panelWidth = box.width * 0.84;
    const panelHeight = box.height * 0.48;
    const panelGradient = context.createLinearGradient(
      panelX,
      panelY,
      panelX,
      panelY + panelHeight,
    );
    panelGradient.addColorStop(0, "#e5e7eb");
    panelGradient.addColorStop(1, "#94a3b8");
    context.fillStyle = panelGradient;
    roundedRect(
      context,
      panelX,
      panelY,
      panelWidth,
      panelHeight,
      radius * 0.55,
    );
    context.fill();

    const reelRadius = Math.min(panelWidth, panelHeight) * 0.24;
    [0.3, 0.7].forEach((position, index) => {
      const cx = panelX + panelWidth * position;
      const cy = panelY + panelHeight * 0.5;
      withSavedContext(context, () => {
        context.translate(cx, cy);
        context.rotate(
          (localFrame / sceneFps) * Math.PI * (index === 0 ? 1.8 : -1.8),
        );
        context.fillStyle = "#020617";
        context.beginPath();
        context.arc(0, 0, reelRadius * (1 + bass * 0.05), 0, Math.PI * 2);
        context.fill();
        context.strokeStyle = "rgba(255,255,255,0.72)";
        context.lineWidth = reelRadius * 0.08;
        for (let spoke = 0; spoke < 6; spoke += 1) {
          context.rotate(Math.PI / 3);
          context.beginPath();
          context.moveTo(reelRadius * 0.22, 0);
          context.lineTo(reelRadius * 0.78, 0);
          context.stroke();
        }
      });
    });

    const meterY = box.y + box.height * 0.66;
    const meterHeight = box.height * 0.18;
    [0.1, 0.54].forEach((left, index) => {
      const x = box.x + box.width * left;
      const width = box.width * 0.36;
      context.fillStyle = "#020617";
      roundedRect(context, x, meterY, width, meterHeight, radius * 0.35);
      context.fill();
      const needle =
        -0.72 + clamp01(energy * (index === 0 ? 1.05 : 0.92)) * 1.44;
      withSavedContext(context, () => {
        context.translate(x + width / 2, meterY + meterHeight * 0.82);
        context.rotate(needle);
        context.strokeStyle = colors[index] ?? colors[0] ?? "#fb7185";
        context.shadowColor = context.strokeStyle as string;
        context.shadowBlur = 12;
        context.lineWidth = Math.max(2, width * 0.012);
        context.beginPath();
        context.moveTo(0, 0);
        context.lineTo(0, -meterHeight * 0.62);
        context.stroke();
      });
    });

    const ledY = box.y + box.height * 0.9;
    const ledGap = box.width * 0.008;
    const ledWidth =
      (box.width * 0.8 - ledGap * (values.length - 1)) / values.length;
    values.forEach((value, index) => {
      const height = box.height * 0.1 * clamp01(value + 0.08);
      context.fillStyle =
        index > 18 ? (colors[1] ?? "#facc15") : (colors[0] ?? "#fb7185");
      context.shadowColor = context.fillStyle as string;
      context.shadowBlur = 8;
      roundedRect(
        context,
        box.x + box.width * 0.1 + index * (ledWidth + ledGap),
        ledY - height,
        ledWidth,
        height,
        ledWidth / 2,
      );
      context.fill();
    });
  });
}

function drawCartoonBurst(
  context: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D,
  box: LayoutBox,
  localFrame: number,
  duration: number,
  params: EffectParams,
): void {
  const progress = clamp01(localFrame / Math.max(1, duration - 1));
  const easedOut = 1 - Math.pow(1 - progress, 3);
  const fade = clamp01(1 - progress);
  const intensity = effectLevel(params.intensity, "medium");
  const intensityScale = levelScale(intensity);
  const scale = params.scale ?? 1;
  const spread = 0.82 + (params.spread ?? 0.5) * 0.48;
  const colors = effectColors(params, [
    "#fff3a3",
    "#ff7a18",
    "#ef233c",
    "#7dd3fc",
  ]);
  const particleCount = Math.round(
    params.particleCount ??
      (intensity === "high" ? 108 : intensity === "low" ? 44 : 72),
  );
  const seed =
    params.seed ??
    hashString(`${nodeSafeId(box.node.id)}:${box.width}x${box.height}`);
  const centerX = box.x + box.width / 2;
  const centerY = box.y + box.height / 2;
  const radiusBase = Math.min(box.width, box.height);
  const burstRadius =
    radiusBase * 0.08 +
    radiusBase * 0.48 * easedOut * intensityScale * scale * spread;

  withSavedContext(context, () => {
    context.globalCompositeOperation = "lighter";

    if (params.shockwave ?? true) {
      const ringRadius = radiusBase * (0.14 + easedOut * 0.56 * scale * spread);
      context.globalAlpha *= 0.7 * fade;
      context.strokeStyle = colors[0] ?? "#fff3a3";
      context.lineWidth = Math.max(3, radiusBase * 0.025 * (1 - progress));
      context.beginPath();
      context.arc(centerX, centerY, ringRadius, 0, Math.PI * 2);
      context.stroke();
    }

    for (let index = 0; index < particleCount; index += 1) {
      const particleSeed = seededRandom(seed + index * 97);
      const angle = particleSeed * Math.PI * 2;
      const speed = 0.36 + seededRandom(seed + index * 131) * 0.76;
      const distance = burstRadius * speed;
      const wobble =
        Math.sin(progress * Math.PI * 2 + index) * radiusBase * 0.025;
      const x =
        centerX +
        Math.cos(angle) * distance +
        Math.cos(angle + Math.PI / 2) * wobble;
      const y =
        centerY +
        Math.sin(angle) * distance +
        Math.sin(angle + Math.PI / 2) * wobble;
      const size =
        radiusBase *
        (0.012 + seededRandom(seed + index * 193) * 0.025) *
        intensityScale *
        (0.55 + fade) *
        Math.sqrt(scale);
      const color = colors[index % colors.length] ?? "#ffffff";

      context.globalAlpha = Math.max(
        0,
        Math.min(1, fade * (0.7 + particleSeed * 0.3)),
      );
      context.fillStyle = color;

      if (index % 4 === 0) {
        drawSpark(context, x, y, size * 1.8, angle + progress * Math.PI);
      } else {
        context.beginPath();
        context.arc(x, y, size, 0, Math.PI * 2);
        context.fill();
      }
    }

    const corePulse = Math.sin(progress * Math.PI);
    context.globalAlpha = 0.8 * corePulse;
    context.fillStyle = colors[1] ?? "#ff7a18";
    context.beginPath();
    context.arc(
      centerX,
      centerY,
      radiusBase * (0.05 + corePulse * 0.16 * scale),
      0,
      Math.PI * 2,
    );
    context.fill();

    if (params.emoji) {
      const fontSize = Math.max(18, radiusBase * (0.22 + corePulse * 0.06));
      context.globalAlpha = clamp01(Math.sin(progress * Math.PI) * 1.2);
      context.font = `${Math.round(fontSize)}px system-ui, sans-serif`;
      context.textAlign = "center";
      context.textBaseline = "middle";
      context.fillText(params.emoji, centerX, centerY, box.width);
    }
  });
}

function drawConfettiBurst(
  context: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D,
  box: LayoutBox,
  localFrame: number,
  duration: number,
  params: EffectParams,
): void {
  const progress = clamp01(localFrame / Math.max(1, duration - 1));
  const fadeIn = clamp01(progress * 6);
  const fadeOut = clamp01((1 - progress) * 1.7);
  const intensity = effectLevel(params.intensity ?? params.density, "medium");
  const colors = effectColors(params, [
    "#facc15",
    "#fb7185",
    "#38bdf8",
    "#a78bfa",
    "#34d399",
  ]);
  const count = Math.round(
    params.particleCount ??
      (intensity === "high" ? 140 : intensity === "low" ? 50 : 90),
  );
  const seed = params.seed ?? hashString(`${nodeSafeId(box.node.id)}:confetti`);
  const spreadAmount = 0.78 + (params.spread ?? 0.5) * 0.68;
  const scale = params.scale ?? 1;
  const gravity = box.height * 0.32 * progress * progress;
  const centerX = box.x + box.width / 2;
  const startY = box.y + box.height * 0.18;
  const spread = box.width * (0.16 + progress * 0.52) * spreadAmount * scale;

  withSavedContext(context, () => {
    for (let index = 0; index < count; index += 1) {
      const rnd = seededRandom(seed + index * 109);
      const angle = -Math.PI / 2 + (rnd - 0.5) * Math.PI * 1.45;
      const speed = 0.35 + seededRandom(seed + index * 173) * 0.95;
      const drift =
        Math.sin(progress * Math.PI * 2 + index) * box.width * 0.018;
      const x = centerX + Math.cos(angle) * spread * speed + drift;
      const y =
        startY +
        Math.sin(angle) * box.height * 0.28 * progress * speed +
        gravity * (0.86 + scale * 0.14) +
        seededRandom(seed + index * 211) * box.height * 0.08;
      const w = box.width * (0.01 + seededRandom(seed + index * 251) * 0.018);
      const h = w * (0.45 + seededRandom(seed + index * 283) * 0.75);

      withSavedContext(context, () => {
        context.globalAlpha *= fadeIn * fadeOut * (0.72 + rnd * 0.28);
        context.fillStyle = colors[index % colors.length] ?? "#ffffff";
        context.translate(x, y);
        context.rotate(progress * Math.PI * 5 + rnd * Math.PI);
        context.fillRect(-w / 2, -h / 2, w, h);
      });
    }

    if (params.emoji) {
      const pop = Math.sin(Math.min(1, progress * 1.25) * Math.PI);
      context.globalAlpha *= fadeIn * fadeOut;
      context.font = `${Math.round(Math.max(18, Math.min(box.width, box.height) * (0.14 + pop * 0.04)))}px system-ui, sans-serif`;
      context.textAlign = "center";
      context.textBaseline = "middle";
      context.fillText(
        params.emoji,
        centerX,
        box.y + box.height * 0.46,
        box.width,
      );
    }
  });
}

function drawCloudPop(
  context: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D,
  box: LayoutBox,
  localFrame: number,
  duration: number,
  params: EffectParams,
): void {
  const progress = clamp01(localFrame / Math.max(1, duration - 1));
  const appear = clamp01(progress * 4);
  const fade = clamp01((1 - progress) * 1.45);
  const intensity = effectLevel(params.intensity ?? params.density, "medium");
  const colors = effectColors(params, ["#ffffff", "#e0f2fe", "#fef3c7"]);
  const seed = params.seed ?? hashString(`${nodeSafeId(box.node.id)}:cloud`);
  const puffCount = intensity === "high" ? 18 : intensity === "low" ? 9 : 13;
  const textScope = params.scope === "text";
  const scale = params.scale ?? 1;
  const spread = (textScope ? 0.62 : 0.78) + (params.spread ?? 0.5) * 0.55;
  const softness = params.softness ?? 0.35;
  const centerX = box.x + box.width / 2;
  const centerY = box.y + box.height / 2;
  const base = Math.min(box.width, box.height);

  withSavedContext(context, () => {
    for (let index = 0; index < puffCount + (textScope ? 4 : 0); index += 1) {
      const rnd = seededRandom(seed + index * 137);
      const totalPuffs = puffCount + (textScope ? 4 : 0);
      const angle = (Math.PI * 2 * index) / totalPuffs + rnd * 0.55;
      const orbit =
        base *
        ((textScope ? 0.18 : 0.22) + seededRandom(seed + index * 191) * 0.18) *
        (0.62 + progress * 0.42) *
        spread *
        scale;
      const x =
        centerX +
        Math.cos(angle) *
          orbit *
          (box.width / Math.max(1, base)) *
          (textScope ? 1.08 : 1);
      const y =
        centerY +
        Math.sin(angle) *
          orbit *
          (box.height / Math.max(1, base)) *
          (textScope ? 0.58 : 1);
      const radius =
        base *
        ((textScope ? 0.072 : 0.095) +
          seededRandom(seed + index * 223) * 0.075) *
        (0.7 + appear * 0.45) *
        (0.9 + scale * 0.18 + softness * 0.28);

      context.globalAlpha =
        (0.42 + softness * 0.2) * fade * appear * (0.72 + rnd * 0.28);
      context.fillStyle = colors[index % colors.length] ?? "#ffffff";
      context.beginPath();
      context.arc(x, y, radius, 0, Math.PI * 2);
      context.fill();
    }

    context.globalAlpha = (0.2 + softness * 0.22) * fade * appear;
    context.strokeStyle = colors[1] ?? "#e0f2fe";
    context.lineWidth = Math.max(2, base * (0.014 + softness * 0.018));
    context.beginPath();
    context.ellipse(
      centerX,
      centerY,
      box.width * (textScope ? 0.42 : 0.38) * scale,
      box.height * (textScope ? 0.16 : 0.25) * scale,
      0,
      0,
      Math.PI * 2,
    );
    context.stroke();
  });
}

function drawSpeedLines(
  context: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D,
  box: LayoutBox,
  localFrame: number,
  duration: number,
  params: EffectParams,
): void {
  const progress = clamp01(localFrame / Math.max(1, duration - 1));
  const intensity = effectLevel(params.intensity ?? params.density, "medium");
  const colors = effectColors(params, ["#ffffff", "#facc15"]);
  const lineCount = intensity === "high" ? 34 : intensity === "low" ? 14 : 24;
  const seed = params.seed ?? hashString(`${nodeSafeId(box.node.id)}:speed`);
  const direction = params.direction ?? "in";
  const textScope = params.scope === "text";
  const spread = (textScope ? 0.58 : 0.78) + (params.spread ?? 0.5) * 0.58;
  const centerX = box.x + box.width / 2;
  const centerY = box.y + box.height / 2;
  const maxRadius =
    Math.hypot(box.width, box.height) * (textScope ? 0.44 : 0.58) * spread;
  const minRadius =
    Math.min(box.width, box.height) *
    (textScope ? 0.2 : 0.14) *
    (0.9 + spread * 0.1);

  withSavedContext(context, () => {
    context.globalCompositeOperation = "lighter";
    context.lineCap = "round";

    for (let index = 0; index < lineCount; index += 1) {
      const rnd = seededRandom(seed + index * 157);
      let angle = rnd * Math.PI * 2;

      if (direction === "left") angle = Math.PI + (rnd - 0.5) * 0.75;
      if (direction === "right") angle = (rnd - 0.5) * 0.75;
      if (direction === "up") angle = -Math.PI / 2 + (rnd - 0.5) * 0.75;
      if (direction === "down") angle = Math.PI / 2 + (rnd - 0.5) * 0.75;
      if (direction === "diagonal") {
        angle =
          (index % 2 === 0 ? Math.PI / 4 : (Math.PI * 3) / 4) +
          (rnd - 0.5) * 0.55;
      }

      const phase = (progress + rnd) % 1;
      const outer = maxRadius * (0.74 + phase * 0.36);
      const inner =
        direction === "out"
          ? minRadius + outer * (0.42 + phase * 0.22)
          : minRadius + outer * (0.12 + (1 - phase) * 0.18);
      const alpha = Math.sin(phase * Math.PI) * 0.7;

      context.globalAlpha = alpha;
      context.strokeStyle = colors[index % colors.length] ?? "#ffffff";
      context.lineWidth = Math.max(
        2,
        Math.min(box.width, box.height) * (0.006 + rnd * 0.006),
      );
      context.beginPath();
      context.moveTo(
        centerX + Math.cos(angle) * inner,
        centerY + Math.sin(angle) * inner,
      );
      context.lineTo(
        centerX + Math.cos(angle) * outer,
        centerY + Math.sin(angle) * outer,
      );
      context.stroke();
    }
  });
}

function drawNeonAura(
  context: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D,
  box: LayoutBox,
  localFrame: number,
  duration: number,
  params: EffectParams,
): void {
  const progress = clamp01(localFrame / Math.max(1, duration - 1));
  const pulseAmount = params.pulse ?? 0.65;
  const pulse =
    pulseAmount *
    (0.5 + Math.sin(progress * Math.PI * 2 * (params.loops ?? 2)) * 0.5);
  const intensity = effectLevel(params.intensity, "medium");
  const colors = effectColors(params, ["#22d3ee", "#a78bfa", "#f0abfc"]);
  const base = Math.min(box.width, box.height);
  const scale = params.scale ?? 1;
  const glow = params.glow ?? params.softness ?? 0.55;
  const textScope = params.scope === "text";
  const radius = readEffectRadius(params, textScope ? base * 0.5 : base * 0.11);
  const lineWidth =
    params.strokeWidth ??
    base *
      (textScope ? 0.014 + pulse * 0.014 : 0.025 + pulse * 0.024) *
      levelScale(intensity) *
      scale;
  const insetX = textScope ? box.width * 0.08 : lineWidth * 0.4;
  const insetY = textScope ? box.height * 0.18 : lineWidth * 0.4;

  withSavedContext(context, () => {
    context.globalCompositeOperation = "lighter";

    for (let index = colors.length - 1; index >= 0; index -= 1) {
      context.globalAlpha =
        (0.1 + glow * 0.1 + pulse * 0.18) * (1 - index * 0.12);
      context.strokeStyle = colors[index] ?? "#22d3ee";
      context.lineWidth = lineWidth * (1 + index * (1.2 + glow * 0.8));
      if (textScope) {
        context.beginPath();
        context.ellipse(
          box.x + box.width / 2,
          box.y + box.height / 2,
          Math.max(1, box.width / 2 - insetX + index * lineWidth * 0.36),
          Math.max(1, box.height / 2 - insetY + index * lineWidth * 0.28),
          0,
          0,
          Math.PI * 2,
        );
      } else {
        roundedRect(
          context,
          box.x + insetX,
          box.y + insetY,
          Math.max(1, box.width - insetX * 2),
          Math.max(1, box.height - insetY * 2),
          radius,
        );
      }
      context.stroke();
    }

    context.globalAlpha = 0.42 + glow * 0.2 + pulse * 0.35;
    context.strokeStyle = colors[0] ?? "#22d3ee";
    context.lineWidth = Math.max(2, lineWidth * 0.45);
    if (textScope) {
      context.beginPath();
      context.ellipse(
        box.x + box.width / 2,
        box.y + box.height / 2,
        Math.max(1, box.width / 2 - insetX * 1.15),
        Math.max(1, box.height / 2 - insetY * 1.15),
        0,
        0,
        Math.PI * 2,
      );
    } else {
      roundedRect(
        context,
        box.x + lineWidth * 0.65,
        box.y + lineWidth * 0.65,
        Math.max(1, box.width - lineWidth * 1.3),
        Math.max(1, box.height - lineWidth * 1.3),
        radius,
      );
    }
    context.stroke();
  });
}

function drawScribbleCircle(
  context: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D,
  box: LayoutBox,
  localFrame: number,
  duration: number,
  params: EffectParams,
): void {
  const progress = clamp01(localFrame / Math.max(1, duration - 1));
  const drawProgress = clamp01(progress * 1.35);
  const colors = effectColors(params, ["#facc15", "#ffffff"]);
  const seed = params.seed ?? hashString(`${nodeSafeId(box.node.id)}:scribble`);
  const loops = params.loops ?? 2;
  const wobble = params.wobble ?? 0.35;
  const scale = params.scale ?? 1;
  const textScope = params.scope === "text";
  const strokeWidth =
    params.strokeWidth ??
    Math.max(3, Math.min(box.width, box.height) * (textScope ? 0.018 : 0.025));
  const centerX = box.x + box.width / 2;
  const centerY = box.y + box.height / 2;
  const radiusX = box.width * (textScope ? 0.44 : 0.42) * scale;
  const radiusY = box.height * (textScope ? 0.24 : 0.34) * scale;
  const steps = Math.max(18, Math.round(96 * drawProgress));

  withSavedContext(context, () => {
    context.lineCap = "round";
    context.lineJoin = "round";

    for (let loop = 0; loop < loops; loop += 1) {
      context.globalAlpha = 0.72 - loop * 0.1;
      context.strokeStyle = colors[loop % colors.length] ?? "#facc15";
      context.lineWidth = Math.max(1, strokeWidth * (1 - loop * 0.12));
      context.beginPath();

      for (let step = 0; step <= steps; step += 1) {
        const t = (step / Math.max(1, steps)) * Math.PI * 2;
        const noise = seededRandom(seed + loop * 503 + step * 19) - 0.5;
        const wobbleOffset =
          Math.sin(t * 3 + loop + progress * Math.PI * 2) * wobble +
          noise * wobble;
        const x = centerX + Math.cos(t) * radiusX * (1 + wobbleOffset * 0.08);
        const y = centerY + Math.sin(t) * radiusY * (1 + wobbleOffset * 0.1);

        if (step === 0) {
          context.moveTo(x, y);
        } else {
          context.lineTo(x, y);
        }
      }

      context.stroke();
    }
  });
}

function nodeSafeId(value: string): string {
  return value || "effect";
}

function drawSpark(
  context: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D,
  x: number,
  y: number,
  radius: number,
  angle: number,
): void {
  withSavedContext(context, () => {
    context.translate(x, y);
    context.rotate(angle);
    context.beginPath();
    context.moveTo(0, -radius);
    context.lineTo(radius * 0.28, -radius * 0.28);
    context.lineTo(radius, 0);
    context.lineTo(radius * 0.28, radius * 0.28);
    context.lineTo(0, radius);
    context.lineTo(-radius * 0.28, radius * 0.28);
    context.lineTo(-radius, 0);
    context.lineTo(-radius * 0.28, -radius * 0.28);
    context.closePath();
    context.fill();
  });
}

function hashString(value: string): number {
  let hash = 2166136261;

  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }

  return hash >>> 0;
}

function seededRandom(seed: number): number {
  let value = seed >>> 0;
  value += 0x6d2b79f5;
  value = Math.imul(value ^ (value >>> 15), value | 1);
  value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
  return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
}

function effectColors(params: EffectParams, fallback: string[]): string[] {
  return params.colors && params.colors.length > 0 ? params.colors : fallback;
}

function effectLevel(
  value: EffectParams["intensity"] | EffectParams["density"],
  fallback: "low" | "medium" | "high",
): "low" | "medium" | "high" {
  return value ?? fallback;
}

function levelScale(value: "low" | "medium" | "high"): number {
  return value === "high" ? 1.3 : value === "low" ? 0.72 : 1;
}

function readEffectRadius(params: EffectParams, fallback: number): number {
  return params.radius && Number.isFinite(params.radius)
    ? params.radius
    : fallback;
}

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}

function drawMedia(
  context: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D,
  box: LayoutBox,
  style: SceneStyle,
  source: ImageBitmap | HTMLCanvasElement | OffscreenCanvas,
  natural: { width: number; height: number },
  scratchSurfacePool: ScratchSurfacePool,
): void {
  const fitted = computeObjectFit(
    style.objectFit,
    style.objectPosition,
    box,
    natural,
  );

  withSavedContext(context, () => {
    // Explicit smoothing settings so scaled pixels are deliberate, not
    // browser-default-dependent.
    const pixelated = style.imageRendering === "pixelated";
    context.imageSmoothingEnabled = !pixelated;
    if (!pixelated) {
      context.imageSmoothingQuality = "high";
    }

    const radius = resolveCornerRadii(style, box);

    if (hasCornerRadius(radius)) {
      roundedRect(context, box.x, box.y, box.width, box.height, radius);
    } else {
      context.beginPath();
      context.rect(box.x, box.y, box.width, box.height);
    }

    context.clip();
    if (pixelated) {
      drawPixelatedMedia(
        context,
        source,
        natural,
        {
          x: box.x + fitted.x,
          y: box.y + fitted.y,
          width: fitted.width,
          height: fitted.height,
          pixelSize: Math.max(1, Math.round(style.pixelSize ?? 12)),
        },
        scratchSurfacePool,
      );
    } else {
      context.drawImage(
        source,
        box.x + fitted.x,
        box.y + fitted.y,
        fitted.width,
        fitted.height,
      );
    }
  });
}

function drawPixelatedMedia(
  context: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D,
  source: ImageBitmap | HTMLCanvasElement | OffscreenCanvas,
  natural: { width: number; height: number },
  fitted: {
    x: number;
    y: number;
    width: number;
    height: number;
    pixelSize: number;
  },
  scratchSurfacePool: ScratchSurfacePool,
): void {
  const lowWidth = Math.max(1, Math.ceil(fitted.width / fitted.pixelSize));
  const lowHeight = Math.max(1, Math.ceil(fitted.height / fitted.pixelSize));
  const lease = scratchSurfacePool.acquire({
    width: lowWidth,
    height: lowHeight,
    purpose: "pixelated-media",
  });
  let poisoned = true;
  try {
    const lowContext = lease.context;
    lowContext.clearRect(0, 0, lowWidth, lowHeight);
    lowContext.imageSmoothingEnabled = true;
    lowContext.imageSmoothingQuality = "high";
    lowContext.drawImage(
      source,
      0,
      0,
      natural.width,
      natural.height,
      0,
      0,
      lowWidth,
      lowHeight,
    );

    context.imageSmoothingEnabled = false;
    context.drawImage(
      lease.surface,
      0,
      0,
      lowWidth,
      lowHeight,
      fitted.x,
      fitted.y,
      fitted.width,
      fitted.height,
    );
    poisoned = false;
  } finally {
    lease.release({ poisoned });
  }
}

function drawBackground(
  context: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D,
  box: LayoutBox,
  style: SceneStyle,
  scratchSurfacePool: ScratchSurfacePool,
): void {
  const background = style.background ?? style.backgroundColor;

  if (!background) {
    return;
  }

  const shadows = style.boxShadow ? parseBoxShadows(style.boxShadow) : [];
  if (shadows.length > 1) {
    shadows.forEach((shadow) =>
      drawBoxShadowLayer(context, box, style, shadow, scratchSurfacePool),
    );
  }
  const shadow = shadows.length === 1 ? shadows[0] : null;

  const drawFill = () => {
    context.fillStyle = parseFill(context, box, background);
    const radius = resolveCornerRadii(style, box);

    if (hasCornerRadius(radius)) {
      roundedRect(context, box.x, box.y, box.width, box.height, radius);
      context.fill();
    } else {
      context.fillRect(box.x, box.y, box.width, box.height);
    }
  };

  if (!shadow) {
    drawFill();
    return;
  }

  withSavedContext(context, () => {
    // Canvas shadows emit from painted pixels, so the shadow rides the
    // background fill. A node with boxShadow but no background paints no
    // shadow — documented in scene-format.
    context.shadowColor = shadow.color;
    context.shadowOffsetX = shadow.offsetX;
    context.shadowOffsetY = shadow.offsetY;
    context.shadowBlur = shadow.blur;
    drawFill();
  });
}

export type ParsedBoxShadow = {
  offsetX: number;
  offsetY: number;
  blur: number;
  color: string;
};

export function parseBoxShadows(value: string): ParsedBoxShadow[] {
  return (parseShadowListValue(value) ?? []).map((shadow) => ({
    offsetX: shadow.offsetX,
    offsetY: shadow.offsetY,
    blur: shadow.blur,
    color: shadow.color.source,
  }));
}

function drawBoxShadowLayer(
  context: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D,
  box: LayoutBox,
  style: SceneStyle,
  shadow: ParsedBoxShadow,
  scratchSurfacePool: ScratchSurfacePool,
): void {
  const padding = Math.ceil(
    Math.max(
      2,
      shadow.blur * 2 + Math.abs(shadow.offsetX) + Math.abs(shadow.offsetY),
    ),
  );
  const width = Math.max(1, Math.ceil(box.width + padding * 2));
  const height = Math.max(1, Math.ceil(box.height + padding * 2));
  const lease = scratchSurfacePool.acquire({
    width,
    height,
    purpose: `box-shadow:${box.id}`,
  });
  let poisoned = true;
  try {
    const shadowContext = lease.context;
    shadowContext.clearRect(0, 0, width, height);
    const stagedBox = {
      width: box.width,
      height: box.height,
    };
    const radii = resolveCornerRadii(style, stagedBox);
    shadowContext.fillStyle = "#000000";
    shadowContext.shadowColor = shadow.color;
    shadowContext.shadowOffsetX = shadow.offsetX;
    shadowContext.shadowOffsetY = shadow.offsetY;
    shadowContext.shadowBlur = shadow.blur;
    roundedRect(shadowContext, padding, padding, box.width, box.height, radii);
    shadowContext.fill();

    // Remove the staging source while keeping its emitted shadow.
    shadowContext.globalCompositeOperation = "destination-out";
    shadowContext.shadowColor = "transparent";
    shadowContext.shadowOffsetX = 0;
    shadowContext.shadowOffsetY = 0;
    shadowContext.shadowBlur = 0;
    roundedRect(shadowContext, padding, padding, box.width, box.height, radii);
    shadowContext.fill();
    context.drawImage(
      lease.surface,
      0,
      0,
      width,
      height,
      box.x - padding,
      box.y - padding,
      width,
      height,
    );
    poisoned = false;
  } finally {
    lease.release({ poisoned });
  }
}

/**
 * Parses `<offset-x> <offset-y> [blur] <color>` box shadows (px lengths;
 * color last, rgb()/rgba() allowed). Inset and spread are not supported and
 * make the whole value null (no shadow), so unsupported shadows are loud in
 * review rather than subtly wrong.
 */
export function parseBoxShadow(value: string): ParsedBoxShadow | null {
  const shadow = parseShadowValue(value);
  return shadow
    ? {
        offsetX: shadow.offsetX,
        offsetY: shadow.offsetY,
        blur: shadow.blur,
        color: shadow.color.source,
      }
    : null;
}

export type ParsedBorder = { width: number; color: string };

/**
 * Parses `<width> [solid] <color>` borders. Only solid is supported; other
 * line styles make the value null.
 */
export function parseBorder(value: string): ParsedBorder | null {
  const border = parseBorderValue(value);
  return border && border.width > 0
    ? { width: border.width, color: border.color.source }
    : null;
}

/**
 * Strokes the border inside the border box (CSS border-box sizing), following
 * borderRadius. Painted after the node's own content, before children.
 */
function drawBorder(
  context: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D,
  box: LayoutBox,
  style: SceneStyle,
): void {
  const border = style.border ? parseBorder(style.border) : null;

  if (!border) {
    return;
  }

  const radius = resolveCornerRadii(style, box);
  const inset = border.width / 2;

  withSavedContext(context, () => {
    context.strokeStyle = border.color;
    context.lineWidth = border.width;

    if (hasCornerRadius(radius)) {
      roundedRect(
        context,
        box.x + inset,
        box.y + inset,
        box.width - border.width,
        box.height - border.width,
        insetCornerRadii(radius, inset),
      );
      context.stroke();
    } else {
      context.strokeRect(
        box.x + inset,
        box.y + inset,
        box.width - border.width,
        box.height - border.width,
      );
    }
  });
}

function resolveLineHeight(
  value: number | string | undefined,
  fontSize: number,
): number {
  // CSS semantics: a unitless number is a multiplier of the font size.
  if (typeof value === "number") {
    return fontSize * value;
  }

  return readLength(value, fontSize, fontSize * 1.25);
}

/** Paints the compiler-owned line/run layout without target-context reflow. */
function drawCompiledText(
  context: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D,
  operation: DisplayTextOperation,
): void {
  context.font = `${operation.font.style} ${operation.font.weight} ${operation.font.size}px ${operation.font.family}`;
  context.fillStyle = operation.fill;
  context.textAlign = operation.align;
  context.direction = operation.direction;
  context.textBaseline = operation.baseline;
  if ("letterSpacing" in context) {
    context.letterSpacing = `${operation.letterSpacing}px`;
  }
  if (operation.shadow) {
    context.shadowOffsetX = operation.shadow.offsetX;
    context.shadowOffsetY = operation.shadow.offsetY;
    context.shadowBlur = operation.shadow.blur;
    context.shadowColor = operation.shadow.color;
  }
  if (operation.stroke) {
    context.lineWidth = operation.stroke.width;
    context.strokeStyle = operation.stroke.color;
    context.lineJoin = "round";
    context.miterLimit = 2;
  }

  for (const line of operation.lines) {
    if (line.text === "") continue;
    const rich = line.runs.length > 0;
    if (line.background) {
      const startX = rich
        ? line.x
        : operation.align === "center"
          ? line.x - line.width / 2
          : operation.align === "right"
            ? line.x - line.width
            : line.x;
      drawTextBackground(context, {
        x: startX - line.background.paddingX,
        y: line.y - operation.lineHeight / 2 - line.background.paddingY,
        width: line.width + line.background.paddingX * 2,
        height: operation.lineHeight + line.background.paddingY * 2,
        radius: line.background.radius,
        color: line.background.color,
      });
    }

    if (!rich) {
      if (operation.stroke) {
        if (line.maxWidth === null)
          context.strokeText(line.text, line.x, line.y);
        else context.strokeText(line.text, line.x, line.y, line.maxWidth);
      }
      if (line.maxWidth === null) context.fillText(line.text, line.x, line.y);
      else context.fillText(line.text, line.x, line.y, line.maxWidth);
      continue;
    }

    // Paint the complete shaped line under each color/opacity span. Rendering
    // fragments independently breaks Arabic joining and Latin ligatures.
    const spans: typeof line.runs = [];
    for (const run of line.runs) {
      const previous = spans[spans.length - 1];
      const equivalent =
        previous &&
        (Math.abs(previous.x + previous.width - run.x) < 1e-6 ||
          Math.abs(run.x + run.width - previous.x) < 1e-6) &&
        previous.fill === run.fill &&
        previous.opacity === run.opacity &&
        JSON.stringify(previous.stroke) === JSON.stringify(run.stroke) &&
        previous.backgroundColor === run.backgroundColor &&
        JSON.stringify(previous.background) === JSON.stringify(run.background);
      if (equivalent) {
        const right = Math.max(previous.x + previous.width, run.x + run.width);
        previous.x = Math.min(previous.x, run.x);
        previous.width = right - previous.x;
        previous.text += run.text;
      } else spans.push({ ...run });
    }
    // Plates are painted before any glyph spans: a padded active plate must
    // not cover a neighboring word that happened to be painted first.
    for (const run of spans) {
      const color = run.background?.color ?? run.backgroundColor;
      if (!color) continue;
      const paddingX = run.background?.paddingX ?? 0;
      const paddingY = run.background?.paddingY ?? 0;
      drawTextBackground(context, {
        x: run.x - paddingX,
        y: line.y - operation.lineHeight / 2 - paddingY,
        width: run.width + paddingX * 2,
        height: operation.lineHeight + paddingY * 2,
        radius: run.background?.radius ?? 0,
        color,
      });
    }
    for (const run of spans) {
      withSavedContext(context, () => {
        context.globalAlpha *= run.opacity;
        context.textAlign = "left";
        context.fillStyle = run.fill;
        if (spans.length > 1) {
          const margin =
            operation.font.size * 2 +
            (run.stroke?.width ?? 0) * 2 +
            (operation.shadow?.blur ?? 0) * 4;
          const left = run.x <= line.x + 1e-6 ? run.x - margin : run.x;
          const right =
            run.x + run.width >= line.x + line.width - 1e-6
              ? run.x + run.width + margin
              : run.x + run.width;
          context.beginPath();
          context.rect(
            left,
            operation.bounds.y - margin,
            Math.max(0, right - left),
            operation.bounds.height + margin * 2,
          );
          context.clip();
        }
        if (run.stroke) {
          context.lineWidth = run.stroke.width;
          context.strokeStyle = run.stroke.color;
          context.lineJoin = "round";
          context.miterLimit = 2;
          if (line.maxWidth === null)
            context.strokeText(line.text, line.x, line.y);
          else context.strokeText(line.text, line.x, line.y, line.maxWidth);
        }
        if (line.maxWidth === null) context.fillText(line.text, line.x, line.y);
        else context.fillText(line.text, line.x, line.y, line.maxWidth);
      });
    }
  }
}

function drawText(
  context: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D,
  box: LayoutBox,
  value: string,
  style: SceneStyle,
  textMeasureCache: TextMeasureCache | undefined,
  runs?: SceneTextRun[],
): void {
  const fontSize = readLength(style.fontSize, box.height, 24);
  context.font = canvasFont(style, fontSize);
  context.fillStyle = style.color ?? "#ffffff";
  context.textAlign = style.textAlign ?? "left";
  context.direction = style.direction ?? "inherit";
  context.textBaseline = "middle";

  const letterSpacing = readLength(style.letterSpacing, fontSize, 0);
  if (letterSpacing !== 0 && "letterSpacing" in context) {
    context.letterSpacing = `${letterSpacing}px`;
  }

  const shadow = parseTextShadow(style.textShadow);
  if (shadow) {
    context.shadowOffsetX = shadow.x;
    context.shadowOffsetY = shadow.y;
    context.shadowBlur = shadow.blur;
    context.shadowColor = shadow.color;
  }

  const stroke = parseTextStroke(style.textStroke, fontSize);
  if (stroke) {
    context.lineWidth = stroke.width;
    context.strokeStyle = stroke.color;
    context.lineJoin = "round";
    context.miterLimit = 2;
  }

  const x =
    style.textAlign === "center"
      ? box.x + box.width / 2
      : style.textAlign === "right"
        ? box.x + box.width
        : box.x;

  const textLayout = prepareTextLayout(
    value,
    box.width,
    fontSize,
    (line, size) =>
      measureTextLine(context, line, style, size, textMeasureCache),
    {
      maxLines: style.maxLines,
      minFontSize: readLength(style.minFontSize, box.height, 12),
      textFit: style.textFit,
      textOverflow: style.textOverflow,
      height: box.height,
      lineHeight: style.lineHeight,
    },
  );
  context.font = canvasFont(style, textLayout.fontSize);
  const lineHeight = textLayout.lineHeight;
  const lines = textLayout.lines;
  // The line block is centered vertically in the box, matching the previous
  // single-line behavior when there is exactly one line.
  const firstLineY =
    box.y + box.height / 2 - ((lines.length - 1) * lineHeight) / 2;
  const background = parseTextBackground(style, fontSize);

  if (runs) {
    drawRichTextLines(
      context,
      box,
      runs,
      style,
      textLayout,
      firstLineY,
      background,
      stroke,
      textMeasureCache,
    );
    return;
  }

  lines.forEach((line, index) => {
    if (line !== "") {
      const y = firstLineY + index * lineHeight;
      const measuredWidth = Math.min(
        measureTextLine(
          context,
          line,
          style,
          textLayout.fontSize,
          textMeasureCache,
        ),
        box.width,
      );

      if (background) {
        drawTextBackground(context, {
          x: textLineX(
            style.textAlign,
            box,
            x,
            measuredWidth,
            background.paddingX,
          ),
          y: y - lineHeight / 2 - background.paddingY,
          width: measuredWidth + background.paddingX * 2,
          height: lineHeight + background.paddingY * 2,
          radius: background.radius,
          color: background.color,
        });
      }

      if (stroke) {
        context.strokeText(line, x, y, box.width);
      }

      context.fillText(line, x, y, box.width);
    }
  });
}

type RichTextSegment = { text: string; run: SceneTextRun };

function drawRichTextLines(
  context: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D,
  box: LayoutBox,
  runs: SceneTextRun[],
  style: SceneStyle,
  textLayout: ReturnType<typeof prepareTextLayout>,
  firstLineY: number,
  background: TextBackground | null,
  nodeStroke: ReturnType<typeof parseTextStroke>,
  textMeasureCache: TextMeasureCache | undefined,
): void {
  const styledLines = richSegmentsByLine(runs, textLayout.lines);
  styledLines.forEach((segments, lineIndex) => {
    const line = textLayout.lines[lineIndex] ?? "";
    if (line === "") return;
    const y = firstLineY + lineIndex * textLayout.lineHeight;
    const lineWidth = Math.min(
      measureTextLine(
        context,
        line,
        style,
        textLayout.fontSize,
        textMeasureCache,
      ),
      box.width,
    );
    const anchorX =
      style.textAlign === "center"
        ? box.x + box.width / 2
        : style.textAlign === "right"
          ? box.x + box.width
          : box.x;
    let cursorX = textLineX(style.textAlign, box, anchorX, lineWidth, 0);

    if (background) {
      drawTextBackground(context, {
        x: cursorX - background.paddingX,
        y: y - textLayout.lineHeight / 2 - background.paddingY,
        width: lineWidth + background.paddingX * 2,
        height: textLayout.lineHeight + background.paddingY * 2,
        radius: background.radius,
        color: background.color,
      });
    }

    let plateX = cursorX;
    for (const segment of segments) {
      const width = measureTextLine(
        context,
        segment.text,
        style,
        textLayout.fontSize,
        textMeasureCache,
      );
      const runStyle = segment.run.style ?? {};
      const plate = runStyle.textBackgroundColor
        ? parseTextBackground({ ...style, ...runStyle }, textLayout.fontSize)
        : null;
      if (plate)
        drawTextBackground(context, {
          x: plateX - plate.paddingX,
          y: y - textLayout.lineHeight / 2 - plate.paddingY,
          width: width + plate.paddingX * 2,
          height: textLayout.lineHeight + plate.paddingY * 2,
          radius: plate.radius,
          color: plate.color,
        });
      plateX += width;
    }
    for (const segment of segments) {
      const segmentWidth = measureTextLine(
        context,
        segment.text,
        style,
        textLayout.fontSize,
        textMeasureCache,
      );
      const runStyle = segment.run.style ?? {};
      withSavedContext(context, () => {
        context.globalAlpha *= runStyle.opacity ?? 1;
        context.textAlign = "left";
        context.fillStyle = runStyle.color ?? style.color ?? "#ffffff";
        const runStroke = runStyle.textStroke
          ? parseTextStroke(runStyle.textStroke, textLayout.fontSize)
          : nodeStroke;
        if (runStroke) {
          context.lineWidth = runStroke.width;
          context.strokeStyle = runStroke.color;
          context.lineJoin = "round";
          context.miterLimit = 2;
          context.strokeText(segment.text, cursorX, y);
        }
        context.fillText(segment.text, cursorX, y);
      });
      cursorX += segmentWidth;
    }
  });
}

function richSegmentsByLine(
  runs: SceneTextRun[],
  lines: string[],
): RichTextSegment[][] {
  const source = runs.flatMap((run) =>
    Array.from(run.text).map((character) => ({ character, run })),
  );
  let sourceIndex = 0;
  const fallbackRun = runs[runs.length - 1] ?? { text: "", style: {} };

  return lines.map((line) => {
    const segments: RichTextSegment[] = [];
    for (const character of Array.from(line)) {
      let matchedIndex = sourceIndex;
      while (
        matchedIndex < source.length &&
        source[matchedIndex]?.character !== character
      ) {
        matchedIndex += 1;
      }
      const matched = source[matchedIndex];
      const run = matched?.run ?? fallbackRun;
      if (matched) sourceIndex = matchedIndex + 1;
      const previous = segments[segments.length - 1];
      if (previous?.run === run) {
        previous.text += character;
      } else {
        segments.push({ text: character, run });
      }
    }
    return segments;
  });
}

function textLineX(
  align: SceneStyle["textAlign"],
  box: LayoutBox,
  textX: number,
  textWidth: number,
  paddingX: number,
): number {
  if (align === "center") {
    return textX - textWidth / 2 - paddingX;
  }

  if (align === "right") {
    return textX - textWidth - paddingX;
  }

  return box.x - paddingX;
}

function resolveTransformOrigin(
  value: string | undefined,
  box: LayoutBox,
): { x: number; y: number } {
  const parsed = value ? parseTransformOriginValue(value) : null;

  return {
    x: box.x + resolveOriginComponent(parsed?.x, box.width),
    y: box.y + resolveOriginComponent(parsed?.y, box.height),
  };
}

function resolveOriginComponent(
  part: TransformOriginComponent | undefined,
  size: number,
): number {
  if (!part) return size / 2;
  if (part.kind === "length") {
    return part.value.unit === "%"
      ? (part.value.value / 100) * size
      : part.value.value;
  }
  if (part.value === "left" || part.value === "top") {
    return 0;
  }

  if (part.value === "right" || part.value === "bottom") {
    return size;
  }
  return size / 2;
}

function applyTransform(
  context: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D,
  box: LayoutBox,
  style: SceneStyle,
): void {
  if (!style.transform) {
    return;
  }

  if (typeof style.transform !== "string") {
    return;
  }

  const origin = resolveTransformOrigin(style.transformOrigin, box);
  context.translate(origin.x, origin.y);

  const transform = parseTransformValue(style.transform);
  if (transform?.kind === "transform-list") {
    for (const fn of transform.functions) {
      if (fn.kind === "translate") {
        context.translate(
          fn.x.unit === "%" ? (fn.x.value / 100) * box.width : fn.x.value,
          fn.y.unit === "%" ? (fn.y.value / 100) * box.height : fn.y.value,
        );
      } else if (fn.kind === "scale") {
        context.scale(fn.x, fn.y);
      } else {
        context.rotate((fn.degrees * Math.PI) / 180);
      }
    }
  }

  context.translate(-origin.x, -origin.y);
}

export type ParsedLinearGradient = {
  /** CSS angle in degrees: 0 = to top, 90 = to right, 180 = to bottom. */
  angleDeg: number;
  stops: Array<{ color: string; offset: number }>;
};

/**
 * Parses `linear-gradient(...)` with any number of stops. The direction is a
 * `<deg>` angle or a `to <side>` keyword (default 180deg = to bottom). Stop
 * positions are `%` and may be omitted; omitted positions distribute evenly
 * between their neighbors, like CSS. Returns null for non-gradient values.
 */
export function parseLinearGradient(
  value: string,
): ParsedLinearGradient | null {
  const parsed = parseLinearGradientValue(value);
  return parsed
    ? {
        angleDeg: parsed.angleDeg,
        stops: resolveGradientStopOffsets(parsed.stops),
      }
    : null;
}

export type ParsedRadialGradient = {
  centerX: number;
  centerY: number;
  stops: Array<{ color: string; offset: number }>;
};

export function parseRadialGradient(
  value: string,
): ParsedRadialGradient | null {
  const parsed = parseRadialGradientValue(value);
  return parsed
    ? {
        centerX: parsed.centerX,
        centerY: parsed.centerY,
        stops: resolveGradientStopOffsets(parsed.stops),
      }
    : null;
}

export type ParsedConicGradient = {
  angleDeg: number;
  centerX: number;
  centerY: number;
  stops: Array<{ color: string; offset: number }>;
};

export function parseConicGradient(value: string): ParsedConicGradient | null {
  const parsed = parseConicGradientValue(value);
  return parsed
    ? {
        angleDeg: parsed.angleDeg,
        centerX: parsed.centerX,
        centerY: parsed.centerY,
        stops: resolveGradientStopOffsets(parsed.stops),
      }
    : null;
}

function parseFill(
  context: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D,
  box: LayoutBox,
  value: string,
): string | CanvasGradient {
  const parsed = parseLinearGradient(value);

  if (!parsed) {
    const radial = parseRadialGradient(value);
    if (radial) {
      const centerX = box.x + box.width * radial.centerX;
      const centerY = box.y + box.height * radial.centerY;
      const radius = Math.max(
        Math.hypot(centerX - box.x, centerY - box.y),
        Math.hypot(centerX - (box.x + box.width), centerY - box.y),
        Math.hypot(centerX - box.x, centerY - (box.y + box.height)),
        Math.hypot(
          centerX - (box.x + box.width),
          centerY - (box.y + box.height),
        ),
      );
      const gradient = context.createRadialGradient(
        centerX,
        centerY,
        0,
        centerX,
        centerY,
        radius,
      );
      radial.stops.forEach((stop) =>
        gradient.addColorStop(stop.offset, stop.color),
      );
      return gradient;
    }

    const conic = parseConicGradient(value);
    if (conic) {
      if (!("createConicGradient" in context)) {
        throw new Error(
          "Conic gradients need CanvasRenderingContext2D.createConicGradient().",
        );
      }
      const gradient = context.createConicGradient(
        ((conic.angleDeg - 90) * Math.PI) / 180,
        box.x + box.width * conic.centerX,
        box.y + box.height * conic.centerY,
      );
      conic.stops.forEach((stop) =>
        gradient.addColorStop(stop.offset, stop.color),
      );
      return gradient;
    }

    return value;
  }

  // CSS gradient line: passes through the box center; its length is the
  // projection of the box onto the gradient direction.
  const radians = (parsed.angleDeg * Math.PI) / 180;
  const dirX = Math.sin(radians);
  const dirY = -Math.cos(radians); // canvas y grows downward
  const length =
    Math.abs(box.width * Math.sin(radians)) +
    Math.abs(box.height * Math.cos(radians));
  const centerX = box.x + box.width / 2;
  const centerY = box.y + box.height / 2;
  const gradient = context.createLinearGradient(
    centerX - (dirX * length) / 2,
    centerY - (dirY * length) / 2,
    centerX + (dirX * length) / 2,
    centerY + (dirY * length) / 2,
  );

  for (const stop of parsed.stops) {
    gradient.addColorStop(stop.offset, stop.color);
  }

  return gradient;
}

function parseTextShadow(
  value: string | undefined,
): { x: number; y: number; blur: number; color: string } | null {
  const shadow = value ? parseShadowValue(value) : null;
  return shadow
    ? {
        x: shadow.offsetX,
        y: shadow.offsetY,
        blur: shadow.blur,
        color: shadow.color.source,
      }
    : null;
}

export function parseTextStroke(
  value: string | undefined,
  fontSize = 24,
): { width: number; color: string } | null {
  if (!value) {
    return null;
  }

  const match = value.trim().match(/^(\S+)\s+(.+)$/);

  if (!match) {
    return null;
  }

  const width = readLength(match[1], fontSize, Number.NaN);

  if (!Number.isFinite(width) || width <= 0) {
    return null;
  }

  return {
    width,
    color: match[2]?.trim() || "#000000",
  };
}

export type TextBackground = {
  color: string;
  paddingX: number;
  paddingY: number;
  radius: number;
};

export function parseTextBackground(
  style: SceneStyle,
  fontSize = 24,
): TextBackground | null {
  if (!style.textBackgroundColor) {
    return null;
  }

  const padding = readLength(style.textBackgroundPadding, fontSize, 0);
  const paddingX = readLength(style.textBackgroundPaddingX, fontSize, padding);
  const paddingY = readLength(style.textBackgroundPaddingY, fontSize, padding);
  const radius = readLength(style.textBackgroundRadius, fontSize, 0);

  return {
    color: style.textBackgroundColor,
    paddingX: Math.max(0, paddingX),
    paddingY: Math.max(0, paddingY),
    radius: Math.max(0, radius),
  };
}

function drawTextBackground(
  context: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D,
  background: {
    x: number;
    y: number;
    width: number;
    height: number;
    radius: number;
    color: string;
  },
): void {
  withSavedContext(context, () => {
    context.shadowColor = "transparent";
    context.shadowBlur = 0;
    context.shadowOffsetX = 0;
    context.shadowOffsetY = 0;
    context.fillStyle = background.color;

    if (background.radius > 0) {
      roundedRect(
        context,
        background.x,
        background.y,
        background.width,
        background.height,
        background.radius,
      );
      context.fill();
    } else {
      context.fillRect(
        background.x,
        background.y,
        background.width,
        background.height,
      );
    }
  });
}

function resolveCornerRadii(
  style: SceneStyle,
  box: Pick<LayoutBox, "width" | "height">,
): CornerRadii {
  return resolveLayoutCornerRadii(style, box);
}

function insetCornerRadii(radii: CornerRadii, inset: number): CornerRadii {
  return {
    topLeft: Math.max(0, radii.topLeft - inset),
    topRight: Math.max(0, radii.topRight - inset),
    bottomRight: Math.max(0, radii.bottomRight - inset),
    bottomLeft: Math.max(0, radii.bottomLeft - inset),
  };
}

function normalizeCornerRadii(
  radius: number | CornerRadii,
  width: number,
  height: number,
): CornerRadii {
  return normalizeLayoutCornerRadii(radius, width, height);
}

function hasCornerRadius(radii: CornerRadii): boolean {
  return (
    radii.topLeft > 0 ||
    radii.topRight > 0 ||
    radii.bottomRight > 0 ||
    radii.bottomLeft > 0
  );
}

function roundedRect(
  context: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D,
  x: number,
  y: number,
  width: number,
  height: number,
  radius: number | CornerRadii,
): void {
  const radii = normalizeCornerRadii(radius, width, height);
  if (
    radii.topLeft === radii.topRight &&
    radii.topLeft === radii.bottomRight &&
    radii.topLeft === radii.bottomLeft
  ) {
    const uniform = radii.topLeft;
    context.beginPath();
    context.moveTo(x + uniform, y);
    context.arcTo(x + width, y, x + width, y + height, uniform);
    context.arcTo(x + width, y + height, x, y + height, uniform);
    context.arcTo(x, y + height, x, y, uniform);
    context.arcTo(x, y, x + width, y, uniform);
    context.closePath();
    return;
  }
  context.beginPath();
  context.moveTo(x + radii.topLeft, y);
  context.lineTo(x + width - radii.topRight, y);
  context.quadraticCurveTo(x + width, y, x + width, y + radii.topRight);
  context.lineTo(x + width, y + height - radii.bottomRight);
  context.quadraticCurveTo(
    x + width,
    y + height,
    x + width - radii.bottomRight,
    y + height,
  );
  context.lineTo(x + radii.bottomLeft, y + height);
  context.quadraticCurveTo(x, y + height, x, y + height - radii.bottomLeft);
  context.lineTo(x, y + radii.topLeft);
  context.quadraticCurveTo(x, y, x + radii.topLeft, y);
  context.closePath();
}

function readLength(
  value: string | number | undefined,
  parent: number,
  fallback: number,
): number {
  if (typeof value === "number") {
    return value;
  }

  if (typeof value !== "string") {
    return fallback;
  }

  if (value.endsWith("%")) {
    return (Number.parseFloat(value) / 100) * parent;
  }

  if (value.endsWith("px")) {
    return Number.parseFloat(value);
  }

  const parsed = Number.parseFloat(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}
