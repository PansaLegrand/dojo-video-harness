"use client";
import { CheckCircle2, Loader2, AlertCircle, Download, X } from "lucide-react";
import type { CaptionProgress } from "./editor-caption-workflow";
import { useNativeEditorText } from "./native-editor-copy";
const labels = { preparing: "Preparing captions…", uploading: "Uploading media…", transcribing: "Transcribing…", styling: "Applying caption style…", translating: "Translating captions…", saving: "Saving captions…", complete: "Captions ready", error: "Captions need attention", ready: "Transcription ready" };
export function EditorCaptionProgress({ progress, onDismiss, onOpen, onPlace, onDownload }: { progress: CaptionProgress; onDismiss?: () => void; onOpen?: (id: string) => void; onPlace?: () => void; onDownload?: () => void }) {
  const t = useNativeEditorText();
  const terminal = ["complete", "error", "ready"].includes(progress.phase);
  const phases = progress.translationOnly ? ["preparing", "translating", "saving"] : ["preparing", "uploading", "transcribing", "styling", ...(progress.translation ? ["translating"] : []), "saving"];
  const index = progress.phase === "complete" ? phases.length : phases.indexOf(progress.phase);
  return <div className={`editor-caption-progress ${progress.phase === "error" ? "is-error" : ""}`} role="status" aria-live="polite" data-caption-phase={progress.phase}>
    <div className="editor-caption-progress-heading">{progress.phase === "complete" ? <CheckCircle2 size={19} /> : progress.phase === "error" ? <AlertCircle size={19} /> : <Loader2 size={19} className="animate-spin motion-reduce:animate-none" />}<strong>{t(labels[progress.phase])}</strong>{terminal && onDismiss && <button type="button" aria-label={t("Dismiss caption progress")} onClick={onDismiss}><X size={15} /></button>}</div>
    <p className="editor-muted-copy">{progress.sourceName}</p>
    {!terminal && <><div className="editor-caption-progress-steps" aria-hidden="true">{phases.map((phase, at) => <span key={phase} data-state={at < index ? "done" : at === index ? "active" : "pending"} />)}</div>{progress.percent !== undefined && <div className="editor-caption-progress-meter"><progress max={100} value={progress.percent} /><span>{Math.round(progress.percent)}%</span></div>}</>}
    {progress.message && <p className="editor-muted-copy">{t(progress.message)}</p>}
    {!!progress.resultIds?.length && onOpen && <button className="editor-secondary-button" type="button" onClick={() => onOpen(progress.resultIds![0])}>{t("Edit captions")}</button>}
    {progress.phase === "ready" && onPlace && <button className="editor-secondary-button" type="button" onClick={onPlace}>{t("Place captions on selected clip")}</button>}
    {onDownload && <button className="editor-secondary-button" type="button" onClick={onDownload}><Download size={14} />{t("Download translated captions")}</button>}
  </div>;
}
