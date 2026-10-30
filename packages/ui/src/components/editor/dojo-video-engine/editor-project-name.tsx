"use client";

import { useEffect, useId, useRef, useState } from "react";
import { AlertCircle, CheckCircle2, CornerDownLeft, Loader2 } from "lucide-react";
import { getProjectNameValidationError, PROJECT_NAME_MAX_LENGTH } from "@/lib/project-name";
import { useNativeEditorText } from "./native-editor-copy";

type Feedback = { kind: "idle" | "editing" | "saving" | "saved" } | { kind: "error"; message: string; retryable: boolean };

export function EditorProjectName({ name, disabled, documentStatus, onSave }: {
  name: string;
  disabled?: boolean;
  documentStatus: "Saved" | "Saving…" | "Unsaved changes" | "Save failed";
  onSave: (name: string) => Promise<string | null>;
}) {
  const t = useNativeEditorText();
  const [draft, setDraft] = useState(name);
  const [feedback, setFeedback] = useState<Feedback>({ kind: "idle" });
  const acknowledged = useRef(name);
  const dirty = useRef(false);
  const pending = useRef(false);
  const cancelBlur = useRef(false);
  const composing = useRef(false);
  const mounted = useRef(true);
  const inputRef = useRef<HTMLInputElement>(null);
  const statusId = useId();

  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  useEffect(() => {
    if (name === acknowledged.current) return;
    acknowledged.current = name;
    // Project-context refreshes must not replace an unfinished rename.
    if (!dirty.current && !pending.current) { setDraft(name); setFeedback({ kind: "idle" }); }
  }, [name]);
  useEffect(() => {
    if (feedback.kind !== "saved") return;
    const timer = setTimeout(() => setFeedback({ kind: "idle" }), 3500);
    return () => clearTimeout(timer);
  }, [feedback.kind]);

  async function commit(value: string) {
    if (disabled || pending.current) return;
    const next = value.trim();
    const validation = getProjectNameValidationError(next);
    if (validation) { setFeedback({ kind: "error", message: validation, retryable: false }); return; }
    if (next === acknowledged.current) {
      dirty.current = false; setDraft(next); setFeedback({ kind: "saved" }); return;
    }
    pending.current = true; setFeedback({ kind: "saving" });
    try {
      const savedName = await onSave(next);
      if (!savedName) throw new Error("Name not saved");
      if (!mounted.current) return;
      acknowledged.current = savedName; dirty.current = false;
      setDraft(savedName); setFeedback({ kind: "saved" });
    } catch {
      if (mounted.current) setFeedback({ kind: "error", message: "Name not saved", retryable: true });
    } finally { pending.current = false; }
  }

  const message = feedback.kind === "error" ? feedback.message : feedback.kind === "editing" ? "Press Enter to save" : feedback.kind === "saving" ? "Saving name…" : feedback.kind === "saved" ? "Name saved" : documentStatus;
  return <div className="editor-project-name-control" data-rename-state={feedback.kind}>
    <input
      ref={inputRef} aria-label={t("Project name")} aria-describedby={statusId}
      aria-invalid={feedback.kind === "error"} aria-busy={feedback.kind === "saving"}
      value={draft} disabled={disabled} readOnly={feedback.kind === "saving"}
      maxLength={PROJECT_NAME_MAX_LENGTH} className="editor-project-name"
      onChange={event => { dirty.current = event.target.value !== acknowledged.current; setDraft(event.target.value); setFeedback({ kind: dirty.current ? "editing" : "idle" }); }}
      onBlur={event => { if (cancelBlur.current) { cancelBlur.current = false; return; } if (dirty.current) void commit(event.currentTarget.value); }}
      onCompositionStart={() => { composing.current = true; }} onCompositionEnd={() => { composing.current = false; }}
      onKeyDown={event => {
        if (composing.current || event.nativeEvent.isComposing || event.nativeEvent.keyCode === 229 || pending.current) return;
        if (event.key === "Enter") {
          event.preventDefault();
          if (dirty.current) event.currentTarget.blur();
          else { setDraft(acknowledged.current); setFeedback({ kind: "saved" }); event.currentTarget.blur(); }
        }
        if (event.key === "Escape") {
          event.preventDefault(); cancelBlur.current = true; dirty.current = false;
          setDraft(acknowledged.current); setFeedback({ kind: "idle" }); event.currentTarget.blur();
        }
      }}
    />
    <span id={statusId} className="editor-project-name-status" role={feedback.kind === "error" ? "alert" : "status"}>
      {feedback.kind === "saving" ? <Loader2 size={13} className="animate-spin" /> : feedback.kind === "saved" ? <CheckCircle2 size={14} /> : feedback.kind === "error" ? <AlertCircle size={14} /> : feedback.kind === "editing" ? <CornerDownLeft size={13} /> : null}
      <span>{t(message)}</span>
      {feedback.kind === "error" && feedback.retryable && <button type="button" onKeyDown={event => event.stopPropagation()} onClick={() => void commit(inputRef.current?.value ?? draft)}>{t("Retry")}</button>}
    </span>
  </div>;
}
