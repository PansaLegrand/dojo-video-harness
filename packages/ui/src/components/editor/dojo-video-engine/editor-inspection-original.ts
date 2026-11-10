import { readLocalVideoSource } from "@/lib/video-project/local-assets";
import { browserInspectionSourceIsCurrent } from "@/lib/video-project/browser-host-requests-client";
import type { BrowserInspectionRequest } from "@/lib/video-project/browser-host-requests";
import type { VideoProjectSnapshot } from "@/lib/video-project/types";

/** Called only after the exact source-frame grant. The host returns ORIGINAL
 * bytes from IndexedDB or its owned canonical locator, never a preview proxy. */
export async function readEditorInspectionOriginal(request: BrowserInspectionRequest,
  snapshot: Pick<VideoProjectSnapshot, "projectId" | "document" | "sources">, signal: AbortSignal,
  ports: { local?: (projectId: string, sourceId: string) => Promise<Blob | null>; fetch?: typeof fetch } = {}): Promise<Blob | null> {
  signal.throwIfAborted();
  if (snapshot.projectId !== request.projectId || !browserInspectionSourceIsCurrent(request, snapshot.document)) throw Object.assign(new Error("The original source changed."), { code: "SOURCE_CHANGED" });
  const local = await (ports.local ?? (async (projectId, sourceId) => (await readLocalVideoSource(projectId, sourceId))?.file ?? null))(snapshot.projectId, request.source.sourceId);
  signal.throwIfAborted();
  if (local) {
    if (local.size !== request.source.byteLength) throw Object.assign(new Error("The original source size changed."), { code: "SOURCE_CHANGED" });
    return local;
  }
  const registered = snapshot.sources.find(source => source.sourceId === request.source.sourceId);
  if (!registered?.assetId || registered.status !== "available" || !registered.url) return null;
  if (registered.fingerprint !== request.source.contentHash || registered.byteLength !== request.source.byteLength) throw Object.assign(new Error("The original source registration changed."), { code: "SOURCE_CHANGED" });
  const url = new URL(registered.url, typeof location !== "undefined" ? location.origin : undefined);
  if (url.username || url.password || url.protocol !== "https:" && !(url.protocol === "http:" && ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname))) throw new Error("The original source locator is unavailable.");
  const response = await (ports.fetch ?? fetch)(url, { signal, redirect: "error", credentials: "omit", cache: "no-store" });
  if (!response.ok || !response.body) throw new Error("The original source could not be loaded.");
  const length = response.headers.get("content-length");
  if (length !== null && Number(length) !== request.source.byteLength) { await response.body.cancel(); throw Object.assign(new Error("The original source size changed."), { code: "SOURCE_CHANGED" }); }
  const reader = response.body.getReader(), chunks: Uint8Array<ArrayBuffer>[] = []; let count = 0;
  try {
    for (;;) {
      signal.throwIfAborted(); const next = await reader.read(); if (next.done) break;
      count += next.value.byteLength;
      if (count > request.source.byteLength) { await reader.cancel(); throw Object.assign(new Error("The original source exceeds its registered byte size."), { code: "SOURCE_CHANGED" }); }
      chunks.push(new Uint8Array(next.value));
    }
  } finally { reader.releaseLock(); }
  signal.throwIfAborted();
  if (count !== request.source.byteLength) throw Object.assign(new Error("The original source size changed."), { code: "SOURCE_CHANGED" });
  return new Blob(chunks, { type: response.headers.get("content-type") ?? "application/octet-stream" });
}
