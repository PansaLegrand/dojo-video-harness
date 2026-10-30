import { Hash } from "fast-sha256";
import {
  abortableLocalRead,
  LOCAL_NATIVE_HASH_MAX_BYTES,
} from "./local-file-hash-utils";
export { throttledHashProgress } from "./local-file-hash-utils";

// fast-sha256 1.3.0, Dmitry Chestnykh, Unlicense/public domain. The pinned
// package and integrity are recorded in package-lock.json; this is its existing
// incremental implementation, not a custom digest or a claimed security audit.
export const LOCAL_HASH_CHUNK_BYTES = LOCAL_NATIVE_HASH_MAX_BYTES;
export const LOCAL_HASH_FALLBACK_CHUNK_BYTES = 256 * 1024;

/** Reads one bounded slice at a time. The yielding fallback keeps the same digest. */
export async function hashLocalFileChunks(
  file: Blob,
  options: {
    signal?: AbortSignal;
    onProgress?: (fraction: number) => void;
    yieldBetweenChunks?: boolean;
  } = {},
): Promise<string> {
  const { signal, onProgress } = options;
  signal?.throwIfAborted();
  const hash = new Hash();
  const chunkBytes = options.yieldBetweenChunks
    ? LOCAL_HASH_FALLBACK_CHUNK_BYTES
    : LOCAL_HASH_CHUNK_BYTES;
  try {
    onProgress?.(0);
    for (let offset = 0; offset < file.size; offset += chunkBytes) {
      signal?.throwIfAborted();
      const end = Math.min(file.size, offset + chunkBytes);
      const bytes = new Uint8Array(
        await abortableLocalRead(file.slice(offset, end).arrayBuffer(), signal),
      );
      signal?.throwIfAborted();
      if (bytes.byteLength !== end - offset)
        throw new Error(
          "The local file changed or could not be read completely.",
        );
      hash.update(bytes);
      onProgress?.(end / file.size);
      if (options.yieldBetweenChunks && end < file.size)
        await abortableLocalRead(
          new Promise<void>((resolve) => setTimeout(resolve, 0)),
          signal,
        );
    }
    signal?.throwIfAborted();
    const result = [...hash.digest()]
      .map((byte) => byte.toString(16).padStart(2, "0"))
      .join("");
    onProgress?.(1);
    signal?.throwIfAborted();
    return result;
  } finally {
    hash.clean();
  }
}
