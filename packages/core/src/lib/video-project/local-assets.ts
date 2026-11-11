import type { EditorAsset } from "@/lib/editor/document";
import { probeEditorMedia } from "@/lib/editor/media";
import { videoProjectRequest } from "./client-controller";
import { fingerprintLocalFile } from "./local-file-fingerprint";

const DATABASE = "dojoclip-video-local-media";
const STORE = "sources";
export type LocalVideoSource = {
  projectId: string;
  sourceId: string;
  fingerprint: string;
  scheme: "sha256";
  byteLength: number;
  mimeType: string;
  fileName: string;
  file: Blob;
  asset: EditorAsset;
};
export type RegisteredVideoSource = Omit<
  LocalVideoSource,
  "projectId" | "file" | "asset"
> & {
  status: "local" | "uploading" | "available" | "missing";
  assetId: string | null;
  url: string | null;
};
function database(signal?: AbortSignal): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(signal.reason);
      return;
    }
    const request = indexedDB.open(DATABASE, 1);
    let cancelled = false;
    const abort = () => {
      cancelled = true;
      signal?.removeEventListener("abort", abort);
      reject(
        signal?.reason ?? new DOMException("Import cancelled.", "AbortError"),
      );
    };
    signal?.addEventListener("abort", abort, { once: true });
    request.onupgradeneeded = () =>
      request.result.createObjectStore(STORE, {
        keyPath: ["projectId", "sourceId"],
      });
    request.onsuccess = () => {
      signal?.removeEventListener("abort", abort);
      if (cancelled) request.result.close();
      else resolve(request.result);
    };
    request.onerror = () => {
      signal?.removeEventListener("abort", abort);
      reject(new Error("This browser could not open local media storage."));
    };
  });
}
export async function saveLocalVideoSource(
  source: LocalVideoSource,
  signal?: AbortSignal,
) {
  const db = await database(signal);
  try {
    signal?.throwIfAborted();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE, "readwrite");
      tx.objectStore(STORE).put(source);
      const abort = () => {
        try {
          tx.abort();
        } catch {
          cleanup();
          reject(signal?.reason);
        }
      };
      const cleanup = () => signal?.removeEventListener("abort", abort);
      signal?.addEventListener("abort", abort, { once: true });
      tx.oncomplete = () => {
        cleanup();
        resolve();
      };
      tx.onerror = tx.onabort = () => {
        cleanup();
        reject(
          signal?.aborted
            ? signal.reason
            : new Error(
                "There is not enough browser storage for this file. Free space and retry importing it.",
              ),
        );
      };
    });
  } finally {
    db.close();
  }
}
export async function readLocalVideoSource(
  projectId: string,
  sourceId: string,
): Promise<LocalVideoSource | null> {
  return (
    (await readLocalVideoSources(projectId, [sourceId])).get(sourceId) ?? null
  );
}

/** One connection, at most eight live reads, and one final map for callers. */
export async function readLocalVideoSources(
  projectId: string,
  sourceIds: readonly string[],
  signal?: AbortSignal,
): Promise<Map<string, LocalVideoSource>> {
  signal?.throwIfAborted();
  const ids = [...new Set(sourceIds)],
    sources = new Map<string, LocalVideoSource>();
  if (!ids.length) return sources;
  const db = await database(signal);
  try {
    for (let offset = 0; offset < ids.length; offset += 8) {
      signal?.throwIfAborted();
      await new Promise<void>((resolve, reject) => {
        const tx = db.transaction(STORE),
          store = tx.objectStore(STORE);
        const abort = () => {
          try {
            tx.abort();
          } catch {
            cleanup();
            reject(signal?.reason);
          }
        };
        const cleanup = () => signal?.removeEventListener("abort", abort);
        signal?.addEventListener("abort", abort, { once: true });
        for (const id of ids.slice(offset, offset + 8)) {
          const request = store.get([projectId, id]);
          request.onsuccess = () => {
            if (request.result) sources.set(id, request.result);
          };
        }
        tx.oncomplete = () => {
          cleanup();
          resolve();
        };
        tx.onerror = tx.onabort = () => {
          cleanup();
          reject(
            signal?.aborted
              ? signal.reason
              : new Error("This browser could not read local media storage."),
          );
        };
      });
    }
    signal?.throwIfAborted();
    return sources;
  } finally {
    db.close();
  }
}
export function videoSourceFingerprint(
  file: Blob,
  signal?: AbortSignal,
  onProgress?: (fraction: number) => void,
): Promise<string> {
  return fingerprintLocalFile(file, { signal, onProgress });
}
/** Import persists original bytes only in this browser; registration uploads metadata, never media. */
export async function importLocalVideoSource(
  projectId: string,
  file: File,
  signal?: AbortSignal,
  onProgress?: (fraction: number) => void,
) {
  signal?.throwIfAborted();
  onProgress?.(0);
  const metadata = await probeEditorMedia(file, signal);
  const fingerprint = await videoSourceFingerprint(file, signal, (fraction) =>
    onProgress?.(0.05 + fraction * 0.85),
  );
  if (signal?.aborted)
    throw new DOMException("Import cancelled.", "AbortError");
  const sourceId = `local:${fingerprint}`;
  const asset: EditorAsset = {
    id: sourceId,
    source: "local",
    name: file.name,
    type: metadata.type,
    byteLength: file.size,
    mimeType: file.type,
    ...(metadata.duration ? { durationSeconds: metadata.duration } : {}),
    ...(metadata.width
      ? { width: metadata.width, height: metadata.height }
      : {}),
    ...(metadata.mediaMetadata
      ? {
          mediaMetadata: {
            ...metadata.mediaMetadata,
            contentHash: fingerprint,
          },
        }
      : {}),
  };
  const source: LocalVideoSource = {
    projectId,
    sourceId,
    fingerprint,
    scheme: "sha256",
    byteLength: file.size,
    mimeType: file.type,
    fileName: file.name,
    file,
    asset,
  };
  await saveLocalVideoSource(source, signal);
  signal?.throwIfAborted();
  const registered = await videoProjectRequest<RegisteredVideoSource>(
    `/api/projects/${encodeURIComponent(projectId)}/sources/register`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      signal,
      body: JSON.stringify({
        sourceId,
        fingerprint,
        scheme: source.scheme,
        byteLength: file.size,
        mimeType: file.type,
        fileName: file.name,
      }),
    },
  );
  signal?.throwIfAborted();
  onProgress?.(1);
  signal?.throwIfAborted();
  return { source, registered, asset, sourceUrl: URL.createObjectURL(file) };
}
export async function relinkLocalVideoSource(
  projectId: string,
  sourceId: string,
  file: File,
  expectedFingerprint: string,
  asset: EditorAsset,
  signal?: AbortSignal,
  onProgress?: (fraction: number) => void,
) {
  const fingerprint = await videoSourceFingerprint(file, signal, onProgress);
  if (fingerprint !== expectedFingerprint)
    throw new Error(
      "This is a different file. Relink using the original media; import new footage separately.",
    );
  const metadata = await probeEditorMedia(file, signal);
  if (
    asset.mediaMetadata?.contentHash === fingerprint &&
    typeof asset.mediaMetadata.hasAudio === "boolean" &&
    typeof metadata.mediaMetadata?.hasAudio === "boolean" &&
    asset.mediaMetadata.hasAudio !== metadata.mediaMetadata.hasAudio
  )
    throw new Error(
      "The original audio-track metadata does not match this file. Import the media again.",
    );
  await saveLocalVideoSource(
    {
      projectId,
      sourceId,
      fingerprint,
      scheme: "sha256",
      byteLength: file.size,
      mimeType: file.type,
      fileName: file.name,
      file,
      asset,
    },
    signal,
  );
  signal?.throwIfAborted();
  return URL.createObjectURL(file);
}
/** Only call from an explicit cloud-ASR/analysis authorization, never during import or preview. */
export async function uploadLocalVideoSource(
  projectId: string,
  sourceId: string,
  onProgress: (progress: number) => void,
  signal?: AbortSignal,
) {
  const endpoint = `/api/projects/${encodeURIComponent(projectId)}/sources/${encodeURIComponent(sourceId)}/upload`;
  const prepared = await videoProjectRequest<{
    source: RegisteredVideoSource;
    uploadUrl: string;
    headers?: Record<string, string>;
  }>(`${endpoint}/prepare`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: "{}",
    signal,
  });
  if (prepared.source.status === "available") return prepared.source;
  const local = await readLocalVideoSource(projectId, sourceId);
  if (!local)
    throw new Error(
      "Relink the original media on this device before uploading it.",
    );
  await new Promise<void>((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    const abort = () => xhr.abort();
    const cleanup = () => signal?.removeEventListener("abort", abort);
    xhr.open("PUT", prepared.uploadUrl);
    xhr.timeout = 600000;
    for (const [name, value] of Object.entries(
      prepared.headers ?? { "Content-Type": local.mimeType },
    ))
      xhr.setRequestHeader(name, value);
    xhr.upload.onprogress = (event) => {
      if (event.lengthComputable) onProgress(event.loaded / event.total);
    };
    xhr.onload = () => {
      cleanup();
      (xhr.status >= 200 && xhr.status < 300) || xhr.status === 412
        ? resolve()
        : reject(
            new Error(
              `Upload failed (${xhr.status}). Retry reuses the same source.`,
            ),
          );
    };
    xhr.onerror = xhr.ontimeout = () => {
      cleanup();
      reject(new Error("Upload interrupted. Retry reuses the same source."));
    };
    xhr.onabort = () => {
      cleanup();
      reject(new DOMException("Upload cancelled.", "AbortError"));
    };
    if (signal?.aborted) {
      reject(new DOMException("Upload cancelled.", "AbortError"));
      return;
    }
    signal?.addEventListener("abort", abort, { once: true });
    xhr.send(local.file);
  });
  return videoProjectRequest<RegisteredVideoSource>(`${endpoint}/complete`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: "{}",
    signal,
  });
}
