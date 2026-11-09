export type EditorImportState = "queued" | "importing" | "completed" | "duplicate" | "failed" | "cancelled" | "needs_file" | "skipped";
export type EditorImportEntry = {
  id: string;
  itemId: string;
  name: string;
  size: number;
  mimeType: string;
  lastModified: number;
  state: EditorImportState;
  progress: number;
  assetId?: string;
  error?: string;
};
export type EditorImportBatch = {
  version: 1;
  projectId: string;
  nextFrame: number;
  entries: EditorImportEntry[];
};
export const editorImportBatchKey = (projectId: string) => `dojoclip-import-batch:${projectId}`;
export const importEntryFinished = (entry: EditorImportEntry) => ["completed", "duplicate", "skipped"].includes(entry.state);
export function createEditorImportBatch(projectId: string, files: readonly File[], from: number, createId: () => string): EditorImportBatch {
  if (files.length > 5000) throw new Error("Choose 5,000 files or fewer for one import batch.");
  return { version: 1, projectId, nextFrame: from, entries: files.map(file => ({ id: createId(), itemId: createId(), name: file.name, size: file.size,
    mimeType: file.type, lastModified: file.lastModified, state: "queued", progress: 0 })) };
}
/** Session metadata restores the queue. Original bytes stay in existing browser
 * source storage; unfinished files are explicitly chosen again after reload. */
export function restoreEditorImportBatch(raw: string | null, projectId: string): EditorImportBatch | null {
  if (!raw || raw.length > 2_000_000) return null;
  try {
    const value = JSON.parse(raw) as EditorImportBatch;
    if (value.version !== 1 || value.projectId !== projectId || !Number.isSafeInteger(value.nextFrame) || value.nextFrame < 0 ||
      !Array.isArray(value.entries) || value.entries.length > 5000) return null;
    const states: EditorImportState[] = ["queued", "importing", "completed", "duplicate", "failed", "cancelled", "needs_file", "skipped"];
    if (value.entries.some(entry => !entry || typeof entry.id !== "string" || !entry.id || typeof entry.itemId !== "string" || !entry.itemId ||
      typeof entry.name !== "string" || entry.name.length > 1000 || typeof entry.mimeType !== "string" || !Number.isSafeInteger(entry.size) || entry.size < 0 ||
      !Number.isFinite(entry.lastModified) || !states.includes(entry.state) || !Number.isFinite(entry.progress) || entry.progress < 0 || entry.progress > 1 ||
      (entry.assetId !== undefined && (typeof entry.assetId !== "string" || entry.assetId.length > 191)) || (entry.error !== undefined && (typeof entry.error !== "string" || entry.error.length > 1000)))) return null;
    if (new Set(value.entries.map(entry => entry.id)).size !== value.entries.length || new Set(value.entries.map(entry => entry.itemId)).size !== value.entries.length) return null;
    return { ...value, entries: value.entries.map(entry => importEntryFinished(entry) ? entry : { ...entry, state: "needs_file", progress: 0 }) };
  } catch { return null; }
}
export function matchEditorImportFiles(entries: readonly EditorImportEntry[], files: readonly File[]) {
  const remaining = [...files], matched = new Map<string, File>();
  for (const entry of entries.filter(entry => !importEntryFinished(entry))) {
    const index = remaining.findIndex(file => file.name === entry.name && file.size === entry.size && file.type === entry.mimeType && file.lastModified === entry.lastModified);
    if (index >= 0) matched.set(entry.id, remaining.splice(index, 1)[0]!);
  }
  return matched;
}

/** The host supplies actual import and guarded insertion. A completed item ID is
 * checked before any retry so a lost UI update cannot insert it a second time. */
export async function runEditorImportBatch<T extends { asset: { id: string; durationSeconds?: number } }>(
  initial: EditorImportBatch,
  files: ReadonlyMap<string, File>,
  ports: {
    signal: AbortSignal;
    fps: number;
    existingItem: (itemId: string) => { assetId?: string; from: number; duration: number } | undefined;
    importFile: (file: File, signal: AbortSignal, progress: (value: number) => void) => Promise<T>;
    insert: (result: T, entry: EditorImportEntry, frame: number) => void;
    release: (result: T) => void;
    changed: (batch: EditorImportBatch) => void;
  },
) {
  const batch = structuredClone(initial);
  const publish = () => ports.changed(structuredClone(batch));
  const completedAssets = new Set(batch.entries.filter(entry => entry.state === "completed" || entry.state === "duplicate").flatMap(entry => entry.assetId ? [entry.assetId] : []));
  for (const entry of batch.entries) {
    if (importEntryFinished(entry)) continue;
    const existing = ports.existingItem(entry.itemId);
    if (existing) {
      entry.state = "completed"; entry.assetId = existing.assetId; entry.progress = 1; delete entry.error;
      if (existing.assetId) completedAssets.add(existing.assetId);
      batch.nextFrame = existing.from + existing.duration; publish(); continue;
    }
    const file = files.get(entry.id);
    if (!file) { entry.state = "needs_file"; publish(); break; }
    try {
      ports.signal.throwIfAborted(); entry.state = "importing"; entry.progress = 0; delete entry.error; publish();
      const result = await ports.importFile(file, ports.signal, progress => { entry.progress = progress; publish(); });
      try {
        ports.signal.throwIfAborted();
        entry.assetId = result.asset.id;
        if (completedAssets.has(result.asset.id)) entry.state = "duplicate";
        else {
          ports.insert(result, entry, batch.nextFrame);
          batch.nextFrame += Math.max(1, Math.round((result.asset.durationSeconds ?? 5) * ports.fps));
          completedAssets.add(result.asset.id); entry.state = "completed";
        }
      } finally { ports.release(result); }
      entry.progress = 1; publish();
    } catch (cause) {
      entry.state = ports.signal.aborted ? "cancelled" : "failed";
      entry.error = (cause instanceof Error ? cause.message : "The file could not be imported.").slice(0, 1000);
      publish(); break;
    }
  }
  return batch;
}
