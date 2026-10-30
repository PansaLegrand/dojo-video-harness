import type { EditorAsset } from "@/lib/editor/document";
import { readLocalVideoSources, type LocalVideoSource } from "./local-assets";
import { requiresLocalVideoProxy } from "@/lib/dojo-video-engine-browser/preview-proxy-policy";

type RegisteredSource = {
  sourceId: string;
  assetId?: string | null;
  url?: string | null;
};

/** Resolves the complete batch before exposing URLs. The caller either adopts
 * the lease into its project lifetime or disposes every newly created URL. */
export async function restoreLocalVideoSources(
  projectId: string,
  assets: Record<string, EditorAsset>,
  registered: readonly RegisteredSource[],
  existing: Record<string, string>,
  signal: AbortSignal,
) {
  signal.throwIfAborted();
  const resolved: Record<string, string> = {},
    ids: string[] = [];
  const bySource = new Map<
    string,
    { source: RegisteredSource; index: number }
  >();
  const byAsset = new Map<
    string,
    { source: RegisteredSource; index: number }
  >();
  registered.forEach((source, index) => {
    if (!bySource.has(source.sourceId))
      bySource.set(source.sourceId, { source, index });
    if (source.assetId && !byAsset.has(source.assetId))
      byAsset.set(source.assetId, { source, index });
  });
  for (const asset of Object.values(assets)) {
    if (existing[asset.id]) continue;
    const candidates = [
      bySource.get(asset.id),
      byAsset.get(asset.assetId ?? asset.id),
    ].filter((value) => value !== undefined);
    const cloud = candidates.sort((a, b) => a.index - b.index)[0]?.source;
    // A cloud transcription receipt keeps the original local source identity.
    // Prefer retained browser bytes for required 4K previews after reopening.
    if (cloud?.url) resolved[asset.id] = cloud.url;
    if (
      requiresLocalVideoProxy(asset) &&
      (asset.source === "local" || asset.source === "project")
    )
      ids.push(asset.id);
    else if (
      !cloud?.url &&
      (asset.source === "local" || asset.source === "project")
    )
      ids.push(asset.id);
  }
  const local = await readLocalVideoSources(projectId, ids, signal).catch(
    () => {
      signal.throwIfAborted();
      return new Map<string, LocalVideoSource>();
    },
  );
  signal.throwIfAborted();
  const owned = new Set<string>();
  let disposed = false;
  const dispose = () => {
    disposed = true;
    owned.forEach((url) => URL.revokeObjectURL(url));
    owned.clear();
  };
  try {
    for (const id of ids) {
      signal.throwIfAborted();
      const source = local.get(id);
      if (source) {
        const url = URL.createObjectURL(source.file);
        owned.add(url);
        resolved[id] = url;
      }
    }
    signal.throwIfAborted();
    return {
      sources: resolved,
      dispose,
      adopt(
        current: Record<string, string>,
        retain: (url: string) => void,
      ): Record<string, string> {
        signal.throwIfAborted();
        if (disposed)
          throw new Error("Local source URLs were already released.");
        const additions = Object.entries(resolved).filter(
          ([id]) => !current[id],
        );
        const used = new Set(additions.map(([, url]) => url));
        owned.forEach((url) => {
          if (used.has(url)) retain(url);
          else URL.revokeObjectURL(url);
        });
        owned.clear();
        return additions.length
          ? { ...current, ...Object.fromEntries(additions) }
          : current;
      },
    };
  } catch (error) {
    dispose();
    throw error;
  }
}
