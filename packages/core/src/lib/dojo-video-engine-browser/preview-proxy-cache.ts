import {
  PREVIEW_PROXY_LIMITS,
  PREVIEW_PROXY_VERSION,
  previewProxyEntryName,
  previewProxyLockName,
  validatePreviewProxyManifest,
  type PreviewProxyManifest,
  type PreviewProxyRequest,
} from "./preview-proxy-policy";

const CACHE_DIRECTORY = "dojo-video-engine-preview-proxies";
type DirectoryEntries = FileSystemDirectoryHandle & {
  entries(): AsyncIterableIterator<[string, FileSystemHandle]>;
};

export async function openPreviewProxyCache(): Promise<FileSystemDirectoryHandle> {
  return (await navigator.storage.getDirectory()).getDirectoryHandle(
    CACHE_DIRECTORY,
    { create: true },
  );
}

/** Caller holds the source's shared Web Lock throughout file/URL use. */
export async function readPreviewProxyCache(
  root: FileSystemDirectoryHandle,
  request: PreviewProxyRequest,
) {
  let directory: FileSystemDirectoryHandle;
  try {
    directory = await root.getDirectoryHandle(
      previewProxyEntryName(request.sourceHash),
    );
  } catch (error) {
    if ((error as DOMException).name === "NotFoundError") return null;
    throw error;
  }
  const metadata = await (
    await directory.getFileHandle("manifest.json")
  ).getFile();
  if (metadata.size > 4096)
    throw new Error("Invalid preview proxy metadata size.");
  const manifest = validatePreviewProxyManifest(
    JSON.parse(await metadata.text()),
    request,
  );
  if (manifest.version !== PREVIEW_PROXY_VERSION)
    throw new Error("Preview proxy cache namespace changed.");
  const file = await (await directory.getFileHandle("media.mp4")).getFile();
  if (file.size !== manifest.proxyBytes)
    throw new Error("Preview proxy cache file changed.");
  return { file, manifest };
}

/** Exclusive global creation lock serializes writers; entry locks pin readers across tabs. */
export async function reservePreviewProxyCache(
  root: FileSystemDirectoryHandle,
  currentEntry: string,
): Promise<boolean> {
  const entries: Array<{ name: string; bytes: number; createdAt: number }> = [];
  for await (const [name, handle] of (root as DirectoryEntries).entries()) {
    if (handle.kind !== "directory" || !/^v\d+-[a-f0-9]{64}$/.test(name))
      continue;
    let bytes = PREVIEW_PROXY_LIMITS.outputBytes,
      createdAt = 0;
    try {
      const directory = handle as FileSystemDirectoryHandle;
      bytes = (await (await directory.getFileHandle("media.mp4")).getFile())
        .size;
      const metadata = await (
        await directory.getFileHandle("manifest.json")
      ).getFile();
      if (metadata.size <= 4096)
        createdAt = Number(JSON.parse(await metadata.text()).createdAt) || 0;
    } catch {
      /* An interrupted, unpublished entry can be evicted only when unpinned. */
    }
    entries.push({ name, bytes, createdAt });
  }
  let total = entries.reduce((sum, entry) => sum + entry.bytes, 0),
    count = entries.length;
  for (const entry of entries.sort(
    (a, b) => a.createdAt - b.createdAt || a.name.localeCompare(b.name),
  )) {
    if (
      count < PREVIEW_PROXY_LIMITS.cacheEntries &&
      total + PREVIEW_PROXY_LIMITS.outputBytes <=
        PREVIEW_PROXY_LIMITS.cacheBytes
    )
      break;
    if (entry.name === currentEntry) continue;
    const removed = await navigator.locks.request(
      previewProxyLockName(entry.name),
      { mode: "exclusive", ifAvailable: true },
      async (lock) => {
        if (!lock) return false;
        await root.removeEntry(entry.name, { recursive: true });
        return true;
      },
    );
    if (removed) {
      total -= entry.bytes;
      count--;
    }
  }
  return (
    count < PREVIEW_PROXY_LIMITS.cacheEntries &&
    total + PREVIEW_PROXY_LIMITS.outputBytes <= PREVIEW_PROXY_LIMITS.cacheBytes
  );
}

export async function removeUnpinnedPreviewProxyCache(
  root: FileSystemDirectoryHandle,
  entry: string,
): Promise<boolean> {
  return navigator.locks.request(
    previewProxyLockName(entry),
    { mode: "exclusive", ifAvailable: true },
    async (lock) => {
      if (!lock) return false;
      await root.removeEntry(entry, { recursive: true }).catch((error) => {
        if ((error as DOMException).name !== "NotFoundError") throw error;
      });
      return true;
    },
  );
}

export async function writePreviewProxyManifest(
  directory: FileSystemDirectoryHandle,
  manifest: PreviewProxyManifest,
) {
  const writer = await (
    await directory.getFileHandle("manifest.json", { create: true })
  ).createWritable();
  try {
    await writer.write(JSON.stringify(manifest));
    await writer.close();
  } catch (error) {
    await writer.abort().catch(() => undefined);
    throw error;
  }
}
