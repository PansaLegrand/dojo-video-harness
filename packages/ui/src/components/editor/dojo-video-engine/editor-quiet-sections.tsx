"use client";

import React, { useEffect, useRef, useState } from "react";
import { useTranslation } from "@/lib/i18n";
import { SILENCE_PRESETS } from "@/lib/browser-silence/types";
import { analyzeLocalQuietSections, prepareQuietSectionCommands, type LocalQuietSectionsProgress, type LocalQuietSectionsResult } from "@/lib/video-project/local-quiet-sections";
import type { SourceAnalysisProject } from "@/lib/video-project/source-analysis";
import type { VideoProjectCommand } from "@/lib/video-project/commands";
import { editorQuietSectionsCopy } from "./editor-quiet-sections-copy";
import { useNativeEditorText } from "./native-editor-copy";

export type EditorQuietSectionsProps = {
  current: SourceAnalysisProject; itemId: string; disabled: boolean;
  getCurrent: () => SourceAnalysisProject;
  onSeek: (frame: number) => void;
  /** Repeat the exact document reference/revision/project guard synchronously. */
  onApply: (commands: VideoProjectCommand[], reviewedCurrent: SourceAnalysisProject) => void;
};
const PAGE_SIZE = 20;
const STALE = "The project changed. Find quiet sections again.";
const same = (a: SourceAnalysisProject, b: SourceAnalysisProject) => a.projectId === b.projectId && a.revision === b.revision && a.document === b.document;
function failure(cause: unknown, applying = false): string {
  const message = cause instanceof Error ? cause.message : "";
  if (/entire clip|all project content/.test(message)) return "Keep part of this clip. You cannot remove the entire clip with quiet-section cuts.";
  if (/project changed|unreviewed|Analyze this clip/.test(message)) return STALE;
  if (/Relink|fingerprint|source identity|original local source/.test(message)) return "Relink the original media on this device before finding quiet sections.";
  if (/two minutes|memory limit/.test(message)) return "Choose a clip with no more than two minutes of source audio.";
  if (/250 MiB/.test(message)) return "The original file must be 250 MiB or smaller.";
  if (/forward|non-looping/.test(message)) return "Choose a clip with forward playback and no looping.";
  if (/300|Too many quiet/.test(message)) return "Too many quiet sections. Try the Natural preset or a shorter clip.";
  return applying ? "These cuts could not be applied. Check locked or linked tracks and try again." : "The audio could not be analyzed. Check the original file and try again.";
}

export function EditorQuietSections({ current, itemId, disabled, getCurrent, onSeek, onApply }: EditorQuietSectionsProps) {
  const { locale } = useTranslation(), nativeText = useNativeEditorText();
  const t = (text: string) => locale === "en" ? text : editorQuietSectionsCopy[locale]?.[text] ?? nativeText(text);
  const [preset, setPreset] = useState<keyof typeof SILENCE_PRESETS>("natural");
  const [review, setReview] = useState<{ result: LocalQuietSectionsResult; current: SourceAnalysisProject } | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set()), [page, setPage] = useState(0);
  const [busy, setBusy] = useState<"finding" | "applying" | null>(null), [progress, setProgress] = useState<LocalQuietSectionsProgress | null>(null);
  const [notice, setNotice] = useState<string | null>(null), [error, setError] = useState<string | null>(null);
  const operation = useRef<AbortController | null>(null), mounted = useRef(false), latest = useRef({ current, itemId, disabled });
  latest.current = { current, itemId, disabled };
  const cancel = () => { operation.current?.abort(); operation.current = null; setBusy(null); setProgress(null); setNotice("Quiet-section analysis cancelled."); };
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; operation.current?.abort(); operation.current = null; }; }, []);
  useEffect(() => {
    operation.current?.abort(); operation.current = null; setBusy(null); setProgress(null); setError(null);
    if (review) setNotice(STALE); else setNotice(null);
    setReview(null); setSelected(new Set()); setPage(0);
  }, [current.projectId, current.revision, current.document, itemId]);
  useEffect(() => { if (disabled && operation.current) cancel(); }, [disabled]);
  const validReview = review && same(review.current, current) && review.result.basis.itemId === itemId ? review : null;
  const active = (abort: AbortController, basis: SourceAnalysisProject, selectedItem: string) => {
    try { return mounted.current && operation.current === abort && !abort.signal.aborted && !latest.current.disabled && latest.current.itemId === selectedItem && same(latest.current.current, basis) && same(getCurrent(), basis); }
    catch { return false; }
  };
  const find = async () => {
    if (disabled || operation.current) return;
    const basis = getCurrent(); if (!same(basis, current)) { setError(STALE); return; }
    const abort = new AbortController(); operation.current = abort; setBusy("finding"); setReview(null); setSelected(new Set()); setPage(0); setNotice(null); setError(null);
    try {
      const result = await analyzeLocalQuietSections({ ...basis, itemId, settings: SILENCE_PRESETS[preset], signal: abort.signal,
        onProgress: value => { if (active(abort, basis, itemId)) setProgress(value); } });
      if (!active(abort, basis, itemId)) return;
      setReview({ result, current: basis }); setSelected(new Set(result.findings.map(value => value.id)));
    } catch (cause) { if (active(abort, basis, itemId)) setError(failure(cause)); }
    finally { if (mounted.current && operation.current === abort) { operation.current = null; setBusy(null); setProgress(null); } }
  };
  const apply = async () => {
    if (disabled || operation.current || !validReview || !selected.size) return;
    const reviewedCurrent = getCurrent(); if (!same(validReview.current, reviewedCurrent)) { setError(STALE); return; }
    const abort = new AbortController(); operation.current = abort; setBusy("applying"); setError(null); setNotice(null);
    try {
      const commands = await prepareQuietSectionCommands(validReview.result, reviewedCurrent, [...selected], abort.signal);
      if (!active(abort, reviewedCurrent, itemId)) return;
      // No await may separate this last check from the root's synchronous guard.
      if (!same(getCurrent(), reviewedCurrent)) { setError(STALE); return; }
      onApply(commands, reviewedCurrent);
      setReview(null); setSelected(new Set()); setNotice("Quiet-section cuts applied. Undo restores them together.");
    } catch (cause) { if (active(abort, reviewedCurrent, itemId)) setError(failure(cause, true)); }
    finally { if (mounted.current && operation.current === abort) { operation.current = null; setBusy(null); } }
  };
  const item = current.document.items.find(value => value.id === itemId);
  if (!item || !["video", "audio"].includes(item.node.type)) return null;
  const findings = validReview?.result.findings ?? [], pages = Math.max(1, Math.ceil(findings.length / PAGE_SIZE));
  const progressLabel = progress ? ({ reading: "Reading local media…", verifying: "Verifying original media…", decoding: "Reading source audio…", analyzing: "Finding quiet sections…" } as const)[progress.stage] : "Finding quiet sections…";
  return <details className="mt-3 min-w-0 shrink-0 border-t border-[var(--editor-border)] px-3 pb-3 pt-3" data-quiet-sections>
    <summary className="cursor-pointer text-xs font-medium">{t("Quiet sections")}</summary>
    <section aria-label={t("Quiet sections")} className="flex max-h-[min(60vh,32rem)] min-w-0 flex-col gap-3 overflow-y-auto pr-1 pt-3 text-xs">
      <p className="text-[11px] leading-relaxed text-[var(--editor-muted)]">{t("Finds quiet audio by volume on this device. It does not detect words or remove fillers.")}</p>
      <label className="flex min-w-0 flex-col gap-1">{t("Quiet-section preset")}<select aria-label={t("Quiet-section preset")} className="min-w-0 rounded border border-[var(--editor-border)] bg-[var(--editor-surface)] p-2" value={preset} disabled={disabled || !!busy} onChange={event => { setPreset(event.target.value as keyof typeof SILENCE_PRESETS); setReview(null); setSelected(new Set()); setPage(0); setNotice(null); setError(null); }}>
        <option value="natural">{t("Natural")}</option><option value="balanced">{t("Balanced")}</option><option value="tight">{t("Tight")}</option>
      </select></label>
      <div className="editor-source-points"><button type="button" disabled={disabled || !!busy} onClick={() => void find()}>{t("Find quiet sections")}</button>{busy && <button type="button" onClick={cancel}>{t("Cancel")}</button>}</div>
      {busy && <p role="status" className="text-[11px] text-[var(--editor-muted)]">{t(busy === "applying" ? "Checking selected cuts…" : progressLabel)}{busy === "finding" && progress ? ` ${Math.round(progress.percent)}%` : ""}</p>}
      {notice && <p role="status" className="text-[11px] text-[var(--editor-muted)]">{t(notice)}</p>}
      {error && <p role="alert" className="text-[11px] text-[var(--editor-danger-text)]">{t(error)}</p>}
      {validReview && !findings.length && <p role="status">{t("No quiet sections found with this preset.")}</p>}
      {!!findings.length && <>
        <p className="text-[11px] text-[var(--editor-muted)]">{t("Quiet sections found")}: {findings.length} · {t("Selected")}: {selected.size}</p>
        <div className="editor-source-points"><button type="button" disabled={disabled || !!busy} onClick={() => setSelected(new Set(findings.map(value => value.id)))}>{t("Select all")}</button><button type="button" disabled={disabled || !!busy} onClick={() => setSelected(new Set())}>{t("Clear selection")}</button></div>
        <ul className="flex min-w-0 flex-col gap-2" aria-label={t("Quiet-section results")}>{findings.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE).map(section => <li key={section.id} data-quiet-section={section.id} className="flex min-w-0 items-center justify-between gap-2">
          <label className="flex min-w-0 items-center gap-2"><input type="checkbox" className="shrink-0" checked={selected.has(section.id)} disabled={disabled || !!busy} onChange={event => setSelected(before => { const next = new Set(before); if (event.target.checked) next.add(section.id); else next.delete(section.id); return next; })} /><span dir="ltr">{(section.from / current.document.format.fps).toFixed(2)}–{((section.from + section.duration) / current.document.format.fps).toFixed(2)} s</span></label>
          <button type="button" className="shrink-0 text-[var(--editor-accent-text)]" disabled={disabled || !!busy} onClick={() => onSeek(section.from)}>{t("Preview section")}</button>
        </li>)}</ul>
        {pages > 1 && <nav className="editor-source-points" aria-label={t("Quiet-section pages")}><button type="button" disabled={page === 0 || !!busy} onClick={() => setPage(page - 1)}>{t("Previous")}</button><span className="text-center" aria-live="polite">{page + 1} / {pages}</span><button type="button" disabled={page + 1 >= pages || !!busy} onClick={() => setPage(page + 1)}>{t("Next")}</button></nav>}
        <p className="text-[11px] leading-relaxed text-[var(--editor-muted)]">{t("Applying cuts removes picture and sound across all tracks and closes the gaps. One Undo restores the whole batch.")}</p>
        <button type="button" className="editor-primary-button editor-wide-button" disabled={disabled || !!busy || !selected.size} onClick={() => void apply()}>{t("Apply selected cuts")}</button>
      </>}
    </section>
  </details>;
}
