import { z } from "zod/v3";
import { fingerprintLocalFile } from "./local-file-fingerprint";
import { abortableLocalRead } from "./local-file-hash-utils";
import {
  projectExportReceiptSchema,
  OUTPUT_EXPORT_MAX_BYTES,
  OutputHostError,
  type ProjectExportReceipt,
} from "./browser-output-requests";

export const BROWSER_EXPORT_CACHE_LIMITS = Object.freeze({
  entries: 3,
  bytes: OUTPUT_EXPORT_MAX_BYTES,
  manifestBytes: 16 * 1024,
});
const DIRECTORY = "dojoclip-agent-export-cache-v1",
  PREFIX = "dojoclip-agent-export-cache:",
  digest = z.string().regex(/^[a-f0-9]{64}$/);
const manifestSchema = z
  .object({
    version: z.literal(1),
    requestHash: digest,
    fileHash: digest,
    byteLength: z.number().int().positive().max(OUTPUT_EXPORT_MAX_BYTES),
    createdAt: z.number().int().nonnegative(),
    receipt: projectExportReceiptSchema,
  })
  .strict();
type Manifest = z.infer<typeof manifestSchema>;
type DirectoryEntries = FileSystemDirectoryHandle & {
  entries(): AsyncIterableIterator<[string, FileSystemHandle]>;
};
export type BrowserExportCacheKey = { requestHash: string; fileHash: string };
export class BrowserExportCacheError extends Error {
  constructor(
    readonly code: "CACHE_UNAVAILABLE" | "CACHE_FULL" | "CACHE_CORRUPT",
    message: string,
  ) {
    super(message);
    this.name = "BrowserExportCacheError";
  }
}
const entryName = (key: BrowserExportCacheKey) =>
  `e1-${digest.parse(key.requestHash)}-${digest.parse(key.fileHash)}`;
export const browserExportRequestLockName = (requestHash: string) =>
  PREFIX + "request:" + digest.parse(requestHash);
const absent = (error: unknown) =>
  error instanceof DOMException && error.name === "NotFoundError";
const interrupted = (signal?: AbortSignal) => signal?.throwIfAborted();
async function readManifest(
  directory: FileSystemDirectoryHandle,
): Promise<Manifest | null> {
  try {
    const file = await (
      await directory.getFileHandle("manifest.json")
    ).getFile();
    if (file.size > BROWSER_EXPORT_CACHE_LIMITS.manifestBytes) return null;
    const parsed = manifestSchema.safeParse(JSON.parse(await file.text()));
    if (!parsed.success) return null;
    const m = parsed.data;
    if (
      m.receipt.requestHash !== m.requestHash ||
      m.receipt.file.sha256 !== m.fileHash ||
      m.receipt.file.byteLength !== m.byteLength
    )
      return null;
    return m;
  } catch (error) {
    if (absent(error) || error instanceof SyntaxError) return null;
    throw error;
  }
}
async function writeJson(
  directory: FileSystemDirectoryHandle,
  value: Manifest,
  signal?: AbortSignal,
) {
  const text = JSON.stringify(value);
  if (
    new TextEncoder().encode(text).byteLength >
    BROWSER_EXPORT_CACHE_LIMITS.manifestBytes
  )
    throw new BrowserExportCacheError(
      "CACHE_CORRUPT",
      "The verified export receipt exceeds the local manifest allowance.",
    );
  const writer = await (
    await directory.getFileHandle("manifest.json", { create: true })
  ).createWritable();
  try {
    interrupted(signal);
    await writer.write(text);
    interrupted(signal);
    await writer.close();
  } catch (error) {
    await writer.abort().catch(() => undefined);
    throw error;
  }
}

/** Isolated output cache. It never opens source-asset IndexedDB or a user folder.
 * Local manifests are pending evidence; the server remains receipt authority. */
export function createBrowserExportCache(
  options: {
    root?: FileSystemDirectoryHandle;
    maxEntries?: number;
    maxBytes?: number;
    now?: () => number;
  } = {},
) {
  const maxEntries = options.maxEntries ?? BROWSER_EXPORT_CACHE_LIMITS.entries,
    maxBytes = options.maxBytes ?? BROWSER_EXPORT_CACHE_LIMITS.bytes;
  if (
    !Number.isSafeInteger(maxEntries) ||
    maxEntries < 1 ||
    maxEntries > BROWSER_EXPORT_CACHE_LIMITS.entries ||
    !Number.isSafeInteger(maxBytes) ||
    maxBytes < 1 ||
    maxBytes > BROWSER_EXPORT_CACHE_LIMITS.bytes
  )
    throw new BrowserExportCacheError(
      "CACHE_FULL",
      "Cache options may only tighten the established export allowance.",
    );
  const root = async () => {
    if (
      !globalThis.navigator?.locks?.request ||
      (!options.root && !globalThis.navigator?.storage?.getDirectory)
    )
      throw new BrowserExportCacheError(
        "CACHE_UNAVAILABLE",
        "This browser cannot keep a pinned local export cache.",
      );
    if (options.root) return options.root;
    try {
      return await (
        await navigator.storage.getDirectory()
      ).getDirectoryHandle(DIRECTORY, {
        create: true,
      });
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError")
        throw error;
      throw new BrowserExportCacheError(
        "CACHE_UNAVAILABLE",
        "This browser did not allow local export storage. Keep the downloaded file so you can choose it again.",
      );
    }
  };
  const lock = async <T,>(
    name: string,
    mode: "shared" | "exclusive",
    signal: AbortSignal | undefined,
    run: () => Promise<T>,
  ) =>
    navigator.locks.request(
      PREFIX + name,
      { mode, ...(signal ? { signal } : {}) },
      run,
    );
  const candidates = async (directory: FileSystemDirectoryHandle) => {
    const found: Array<{
      name: string;
      manifest: Manifest | null;
      bytes: number;
    }> = [];
    for await (const [name, handle] of (
      directory as DirectoryEntries
    ).entries()) {
      if (
        handle.kind !== "directory" ||
        !/^e1-[a-f0-9]{64}-[a-f0-9]{64}$/.test(name)
      )
        continue;
      try {
        const child = handle as FileSystemDirectoryHandle,
          manifest = await readManifest(child);
        let bytes = 0;
        try {
          bytes = (await (await child.getFileHandle("output.mp4")).getFile())
            .size;
        } catch (error) {
          if (!absent(error)) throw error;
        }
        found.push({ name, manifest, bytes });
      } catch (error) {
        if (!absent(error)) throw error;
      }
    }
    return found.sort(
      (a, b) =>
        (a.manifest?.createdAt ?? 0) - (b.manifest?.createdAt ?? 0) ||
        (a.name < b.name ? -1 : 1),
    );
  };
  async function lease<T>(
    key: BrowserExportCacheKey,
    consume: (file: File, receipt: ProjectExportReceipt) => Promise<T>,
    signal?: AbortSignal,
  ): Promise<{ found: true; value: T } | { found: false }> {
    const directory = await root(),
      name = entryName(key);
    interrupted(signal);
    return lock(name, "shared", signal, async () => {
      let child: FileSystemDirectoryHandle;
      try {
        child = await directory.getDirectoryHandle(name);
      } catch (error) {
        if (absent(error)) return { found: false };
        throw error;
      }
      const manifest = await readManifest(child);
      interrupted(signal);
      if (!manifest || entryName(manifest) !== name) return { found: false };
      let file: File;
      try {
        file = await (await child.getFileHandle("output.mp4")).getFile();
      } catch (error) {
        if (absent(error)) return { found: false };
        throw error;
      }
      if (
        file.size !== manifest.byteLength ||
        (await fingerprintLocalFile(file, { signal })) !== manifest.fileHash
      )
        throw new BrowserExportCacheError(
          "CACHE_CORRUPT",
          "The cached local export changed. Relink the verified file.",
        );
      interrupted(signal);
      return { found: true, value: await consume(file, manifest.receipt) };
    });
  }
  return {
    /** Serialize one request across tabs before checking cache or encoding. */
    async withRequestLock<T>(
      requestHash: string,
      run: () => Promise<T>,
      signal?: AbortSignal,
    ) {
      digest.parse(requestHash);
      await root();
      return lock("request:" + requestHash, "exclusive", signal, run);
    },
    withLease: lease,
    /** Missing entries never invoke consume: fresh writes happen AFTER the empty
     * shared lease is released, preventing self-deadlock. File must not escape. */
    async withPendingLease<T>(
      requestHash: string,
      consume: (file: File, receipt: ProjectExportReceipt) => Promise<T>,
      signal?: AbortSignal,
    ) {
      digest.parse(requestHash);
      const directory = await root();
      for (const item of await candidates(directory)) {
        if (item.manifest?.requestHash !== requestHash) continue;
        const result = await lease(
          { requestHash, fileHash: item.manifest.fileHash },
          consume,
          signal,
        );
        if (result.found) return result;
      }
      return { found: false as const };
    },
    async writePending(
      raw: ProjectExportReceipt,
      blob: Blob,
      signal?: AbortSignal,
    ) {
      const receipt = projectExportReceiptSchema.parse(raw),
        key = {
          requestHash: receipt.requestHash,
          fileHash: receipt.file.sha256,
        },
        name = entryName(key);
      interrupted(signal);
      if (
        blob.size !== receipt.file.byteLength ||
        (await fingerprintLocalFile(blob, { signal })) !== key.fileHash
      )
        throw new OutputHostError(
          "INVALID_OUTPUT",
          "The pending export bytes do not match their immutable receipt.",
        );
      if (blob.size > maxBytes)
        throw new BrowserExportCacheError(
          "CACHE_FULL",
          "This export exceeds the local cache allowance. Keep the download and relink it when needed.",
        );
      const directory = await root();
      return lock("mutate", "exclusive", signal, () =>
        lock(name, "exclusive", signal, async () => {
          interrupted(signal);
          let existing: FileSystemDirectoryHandle | undefined;
          try {
            existing = await directory.getDirectoryHandle(name);
          } catch (error) {
            if (!absent(error)) throw error;
          }
          if (existing) {
            const prior = await readManifest(existing);
            if (prior) {
              if (
                prior.requestHash !== key.requestHash ||
                prior.fileHash !== key.fileHash ||
                prior.byteLength !== blob.size ||
                JSON.stringify(prior.receipt) !== JSON.stringify(receipt)
              )
                throw new BrowserExportCacheError(
                  "CACHE_CORRUPT",
                  "The immutable cache entry already has a different receipt.",
                );
              const file = await (
                await existing.getFileHandle("output.mp4")
              ).getFile();
              if (
                file.size !== blob.size ||
                (await fingerprintLocalFile(file, { signal })) !== key.fileHash
              )
                throw new BrowserExportCacheError(
                  "CACHE_CORRUPT",
                  "The saved local file changed.",
                );
              return { stored: true, replayed: true, key };
            }
            await directory.removeEntry(name, { recursive: true });
          }
          const entries = await candidates(directory);
          let total = entries.reduce((sum, item) => sum + item.bytes, 0),
            count = entries.length;
          for (const item of entries) {
            if (count < maxEntries && total + blob.size <= maxBytes) break;
            const removed = await navigator.locks.request(
              PREFIX + item.name,
              { mode: "exclusive", ifAvailable: true },
              async (available) => {
                if (!available) return false;
                await directory.removeEntry(item.name, { recursive: true });
                return true;
              },
            );
            if (removed) {
              total -= item.bytes;
              count--;
            }
          }
          if (count >= maxEntries || total + blob.size > maxBytes)
            throw new BrowserExportCacheError(
              "CACHE_FULL",
              "Pinned exports fill the local cache. Download or release another export first.",
            );
          const child = await directory.getDirectoryHandle(name, {
              create: true,
            }),
            writer = await (
              await child.getFileHandle("output.mp4", { create: true })
            ).createWritable();
          const abort = () => {
            void writer.abort().catch(() => undefined);
          };
          signal?.addEventListener("abort", abort, { once: true });
          try {
            const reader = blob.stream().getReader();
            try {
              while (true) {
                const next = await abortableLocalRead(reader.read(), signal);
                if (next.done) break;
                interrupted(signal);
                await writer.write(next.value);
              }
            } finally {
              await reader.cancel().catch(() => undefined);
              reader.releaseLock();
            }
            interrupted(signal);
            await writer.close();
            interrupted(signal);
            await writeJson(
              child,
              {
                version: 1,
                ...key,
                byteLength: blob.size,
                createdAt: (options.now ?? Date.now)(),
                receipt,
              },
              signal,
            );
            return { stored: true, replayed: false, key };
          } catch (error) {
            await writer.abort().catch(() => undefined);
            await directory
              .removeEntry(name, { recursive: true })
              .catch(() => undefined);
            throw error;
          } finally {
            signal?.removeEventListener("abort", abort);
          }
        }),
      );
    },
  };
}
