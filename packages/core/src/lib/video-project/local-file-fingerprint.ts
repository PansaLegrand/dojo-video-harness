import {
  abortableLocalRead,
  LOCAL_NATIVE_HASH_MAX_BYTES,
  throttledHashProgress,
} from "./local-file-hash-utils";

const fingerprints = new WeakMap<Blob, string>();
export interface LocalHashWorker extends EventTarget {
  postMessage(message: { id: string; file: Blob }): void;
  terminate(): void;
}
type HashOptions = {
  signal?: AbortSignal;
  onProgress?: (fraction: number) => void;
  preferWorker?: boolean;
  createWorker?: () => LocalHashWorker;
  watchdogMs?: number;
};
class HashWorkerUnavailable extends Error {}

function hashInWorker(
  file: Blob,
  options: HashOptions,
  onProgress: (fraction: number) => void,
): Promise<string> {
  return new Promise((resolve, reject) => {
    let worker: LocalHashWorker;
    try {
      worker =
        options.createWorker?.() ??
        new Worker(new URL("./local-file-hash.worker.ts", import.meta.url), {
          type: "module",
          name: "video-import-fingerprint",
        });
    } catch (error) {
      reject(
        new HashWorkerUnavailable(
          error instanceof Error ? error.message : "Hash worker unavailable.",
        ),
      );
      return;
    }
    const id = crypto.randomUUID();
    let timer: ReturnType<typeof setTimeout>,
      settled = false,
      progress = -1;
    const cleanup = () => {
      clearTimeout(timer);
      worker.terminate();
      worker.removeEventListener("message", message);
      worker.removeEventListener("error", failed);
      worker.removeEventListener("messageerror", failed);
      options.signal?.removeEventListener("abort", abort);
    };
    const fail = (error: unknown) => {
      if (!settled) {
        settled = true;
        cleanup();
        reject(error);
      }
    };
    const reset = () => {
      clearTimeout(timer);
      timer = setTimeout(
        () =>
          fail(
            new HashWorkerUnavailable("Local hash worker stopped responding."),
          ),
        options.watchdogMs ?? 30_000,
      );
    };
    const abort = () =>
      fail(
        options.signal?.reason ??
          new DOMException("Import cancelled.", "AbortError"),
      );
    const failed = () =>
      fail(new HashWorkerUnavailable("Local hash worker failed."));
    const message: EventListener = (event) => {
      const data = (event as MessageEvent).data;
      if (settled || data?.id !== id) return;
      if (
        data.type === "progress" &&
        Number.isFinite(data.fraction) &&
        data.fraction >= progress &&
        data.fraction >= 0 &&
        data.fraction <= 1
      ) {
        progress = data.fraction;
        reset();
        try {
          onProgress(progress);
        } catch (error) {
          fail(error);
        }
      } else if (
        data.type === "complete" &&
        typeof data.fingerprint === "string" &&
        /^[a-f0-9]{64}$/.test(data.fingerprint)
      ) {
        settled = true;
        cleanup();
        resolve(data.fingerprint);
      } else if (data.type === "error")
        fail(
          new Error(
            typeof data.message === "string"
              ? data.message
              : "Could not read local file.",
          ),
        );
    };
    worker.addEventListener("message", message);
    worker.addEventListener("error", failed);
    worker.addEventListener("messageerror", failed);
    if (options.signal?.aborted) {
      abort();
      return;
    }
    options.signal?.addEventListener("abort", abort, { once: true });
    reset();
    try {
      worker.postMessage({ id, file });
    } catch {
      failed();
    }
  });
}

export async function fingerprintLocalFile(
  file: Blob,
  options: HashOptions = {},
): Promise<string> {
  options.signal?.throwIfAborted();
  const onProgress = throttledHashProgress(options.onProgress);
  const cached = fingerprints.get(file);
  if (cached) {
    onProgress(1);
    options.signal?.throwIfAborted();
    return cached;
  }
  let fingerprint: string | undefined;
  if (file.size <= LOCAL_NATIVE_HASH_MAX_BYTES && globalThis.crypto?.subtle) {
    // Native hashing avoids worker startup for small images and clips while
    // keeping the same hard 1 MiB allocation ceiling as a worker read.
    onProgress(0);
    options.signal?.throwIfAborted();
    const bytes = await abortableLocalRead(file.arrayBuffer(), options.signal);
    options.signal?.throwIfAborted();
    if (bytes.byteLength !== file.size)
      throw new Error(
        "The local file changed or could not be read completely.",
      );
    const digest = await abortableLocalRead(
      crypto.subtle.digest("SHA-256", bytes),
      options.signal,
    );
    options.signal?.throwIfAborted();
    fingerprint = [...new Uint8Array(digest)]
      .map((byte) => byte.toString(16).padStart(2, "0"))
      .join("");
  } else if (
    options.preferWorker !== false &&
    (options.createWorker || typeof Worker === "function")
  ) {
    try {
      fingerprint = await hashInWorker(file, options, onProgress);
    } catch (error) {
      options.signal?.throwIfAborted();
      if (!(error instanceof HashWorkerUnavailable)) throw error;
    }
  }
  if (!fingerprint) {
    const { hashLocalFileChunks } = await import("./local-file-hash");
    fingerprint = await hashLocalFileChunks(file, {
      signal: options.signal,
      onProgress,
      yieldBetweenChunks: true,
    });
  }
  options.signal?.throwIfAborted();
  onProgress(1);
  options.signal?.throwIfAborted();
  fingerprints.set(file, fingerprint);
  return fingerprint;
}
