"use client";

import type { EditorImportBatch } from "./editor-import-batch";
import { importEntryFinished } from "./editor-import-batch";
import { useNativeEditorText } from "./native-editor-copy";

export function EditorImportBatchPanel({ batch, busy, recoveryAvailable, onRetry, onSkip, onChoose, onDismiss }: {
  batch: EditorImportBatch | null; busy: boolean; recoveryAvailable: boolean;
  onRetry: () => void; onSkip: () => void; onChoose: () => void; onDismiss: () => void;
}) {
  const t = useNativeEditorText();
  if (!batch) return null;
  const pending = batch.entries.find(entry => !importEntryFinished(entry));
  const labels = { queued: "Waiting to import", importing: "Importing", completed: "Imported", duplicate: "Duplicate file skipped", failed: "Import paused", cancelled: "Cancelled", needs_file: "Choose original files", skipped: "Skipped" };
  return <section className="editor-import-batch" aria-label={t("Import queue")}>
    <div className="flex items-center justify-between gap-2"><strong>{t("Import queue")}</strong><span aria-live="polite">{batch.entries.filter(importEntryFinished).length}/{batch.entries.length}</span></div>
    <ol>{batch.entries.map((entry, index) => <li key={entry.id}>
      <span className="editor-batch-file" title={entry.name}>{index + 1}. {entry.name}</span><span>{t(labels[entry.state])}{entry.state === "importing" ? ` ${Math.round(entry.progress * 100)}%` : ""}</span>
      {entry.state === "failed" && entry.error && <p className="editor-batch-error">{t(entry.error)}</p>}
    </li>)}</ol>
    {!recoveryAvailable && <p role="status">{t("Import progress could not be saved. Keep this tab open to finish this batch.")}</p>}
    {!busy && <div className="editor-batch-actions">
      {pending && <>
        {pending.state === "needs_file" ? <button onClick={onChoose}>{t("Choose original files")}</button> : <button onClick={onRetry}>{t("Continue import")}</button>}
        <button onClick={onSkip}>{t("Skip this file")}</button>
      </>}
      <button onClick={onDismiss}>{t("Dismiss import queue")}</button>
    </div>}
  </section>;
}
