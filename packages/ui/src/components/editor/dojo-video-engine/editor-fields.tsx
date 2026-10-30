"use client";
import { useEffect, useId, useRef, useState } from "react";
import { parseColorValue } from "@dojo-video-engine/schema/values";
import { useEditorInteraction } from "./editor-interaction";
import { useNativeEditorText } from "./native-editor-copy";

const inputClass =
  "w-full min-w-0 rounded border border-[var(--editor-border)] bg-[var(--editor-surface)] px-2 py-1.5 text-xs text-[var(--editor-text)] outline-none focus:border-violet-400 disabled:opacity-40";

export function inputColor(value: string): string {
  const color = parseColorValue(value);
  if (color?.kind === "rgba") return `#${[color.red, color.green, color.blue].map(channel => Math.round(channel).toString(16).padStart(2, "0")).join("")}`;
  return color?.kind === "named" && color.name === "white" ? "#ffffff" : "#000000";
}

export function EditorField({
  label,
  value,
  onCommit,
  onPreview,
  type = "text",
  min,
  max,
  step = 1,
  decimalPlaces,
  disabled,
  validate,
}: {
  label: string;
  value: string | number;
  onCommit: (value: string) => void;
  onPreview?: (value: string | null) => void;
  type?: "text" | "number" | "color";
  min?: number;
  max?: number;
  step?: number;
  decimalPlaces?: number;
  disabled?: boolean;
  validate?: (value: string) => string | null;
}) {
  const t = useNativeEditorText();
  const format = (value: string | number) => type === "number" && decimalPlaces !== undefined && String(value).trim() && Number.isFinite(Number(value)) ? Number(value).toFixed(decimalPlaces) : String(value);
  const displayBound = (bound: number | undefined, direction: "min" | "max") => {
    if (bound === undefined || decimalPlaces === undefined || type !== "number") return bound;
    const rounded = Number(format(bound));
    if (direction === "min" ? rounded >= bound : rounded <= bound) return rounded;
    return Number((rounded + (direction === "min" ? 1 : -1) * 10 ** -decimalPlaces).toFixed(decimalPlaces));
  };
  const displayValue = format(value);
  const [draft, setDraft] = useState(displayValue);
  const [validationError, setValidationError] = useState<string | null>(null);
  const errorId = useId();
  const cancelCommit = useRef(false);
  const focused = useRef(false);
  const interaction = useEditorInteraction();
  const previewRef = useRef(onPreview); previewRef.current = onPreview;
  useEffect(() => () => { if (focused.current) { previewRef.current?.(null); interaction?.endInteraction(); } }, [interaction]);
  const valid = (value: string) => type !== "number" || (value.trim() !== "" && Number.isFinite(Number(value)) && (min === undefined || Number(value) >= min) && (max === undefined || Number(value) <= max));
  useEffect(() => { if (!focused.current) { setDraft(displayValue); setValidationError(null); } }, [displayValue]);
  function commit() {
    if (cancelCommit.current) { cancelCommit.current = false; return; }
    // Focusing a rounded display must never overwrite precise source timing.
    if (decimalPlaces !== undefined && draft === displayValue) return;
    const committed = format(draft);
    const message = validate?.(committed);
    setValidationError(message ?? null);
    if (message) return;
    if (draft === displayValue) return;
    if (
      type === "number" &&
      (!committed.trim() ||
        !Number.isFinite(Number(committed)) ||
        (min !== undefined && Number(committed) < min) ||
        (max !== undefined && Number(committed) > max))
    ) {
      setDraft(displayValue);
      return;
    }
    setDraft(committed);
    if (committed !== displayValue) onCommit(committed);
  }
  return (
    <label className="flex min-w-0 flex-col gap-1 text-[11px] text-[var(--editor-muted)]">
      {t(label)}
      <input
        className={inputClass}
        aria-label={t(label)}
        type={type}
        value={type === "color" ? inputColor(draft) : draft}
        min={displayBound(min, "min")}
        max={displayBound(max, "max")}
        step={step}
        disabled={disabled}
        aria-invalid={validationError ? true : undefined}
        aria-describedby={validationError ? errorId : undefined}
        onChange={(event) => { const value = event.target.value; setDraft(value); if (validationError) setValidationError(validate?.(value) ?? null); onPreview?.(valid(value) && !validate?.(value) ? value : null); }}
        onFocus={() => { if (!focused.current) { focused.current = true; interaction?.beginInteraction(); } }}
        onBlur={() => { commit(); onPreview?.(null); if (focused.current) { focused.current = false; interaction?.endInteraction(); } }}
        onKeyDown={(event) => {
          if (event.nativeEvent.isComposing || event.nativeEvent.keyCode === 229) return;
          if (event.key === "Enter") event.currentTarget.blur();
          if (event.key === "Escape") {
            cancelCommit.current = true;
            setValidationError(null);
            setDraft(displayValue);
            event.currentTarget.blur();
          }
        }}
      />
      {validationError && <span id={errorId} role="alert" className="text-red-600 dark:text-red-400">{t(validationError)}</span>}
    </label>
  );
}

export function EditorTextArea({
  label,
  value,
  onCommit,
  onPreview,
  rows = 3,
}: {
  label: string;
  value: string;
  onCommit: (value: string) => void;
  onPreview?: (value: string | null) => void;
  rows?: number;
}) {
  const t = useNativeEditorText();
  const [draft, setDraft] = useState(value);
  const focused = useRef(false);
  const cancelled = useRef(false);
  const previewRef = useRef(onPreview); previewRef.current = onPreview;
  const interaction = useEditorInteraction();
  useEffect(() => () => { if (focused.current) { previewRef.current?.(null); interaction?.endInteraction(); } }, [interaction]);
  useEffect(() => { if (!focused.current) setDraft(value); }, [value]);
  return (
    <label className="flex flex-col gap-1 text-[11px] text-[var(--editor-muted)]">
      {t(label)}
      <textarea
        aria-label={t(label)}
        rows={rows}
        value={draft}
        onChange={(event) => { setDraft(event.target.value); onPreview?.(event.target.value); }}
        onFocus={() => { if (!focused.current) { focused.current = true; interaction?.beginInteraction(); } }}
        onBlur={() => {
          if (!cancelled.current && draft !== value) onCommit(draft);
          cancelled.current = false; onPreview?.(null);
          if (focused.current) { focused.current = false; interaction?.endInteraction(); }
        }}
        onKeyDown={event => {
          if (event.nativeEvent.isComposing || event.nativeEvent.keyCode === 229) return;
          if (event.key === "Escape") {
            event.preventDefault(); event.stopPropagation(); cancelled.current = true;
            setDraft(value); event.currentTarget.blur();
          }
        }}
        className={inputClass}
      />
    </label>
  );
}

export function EditorSelect({ label, value, options, onChange, onPreview, disabled }: {
  label: string; value: string; options: Array<{ value: string; label: string }>;
  onChange: (value: string) => void; onPreview?: (value: string | null) => void; disabled?: boolean;
}) {
  const t = useNativeEditorText();
  const [draft, setDraft] = useState(value);
  const draftRef = useRef(value);
  const focused = useRef(false);
  const cancelled = useRef(false);
  const interaction = useEditorInteraction();
  const previewRef = useRef(onPreview); previewRef.current = onPreview;
  useEffect(() => { if (!focused.current) { setDraft(value); draftRef.current = value; } }, [value]);
  useEffect(() => () => { if (focused.current) { previewRef.current?.(null); interaction?.endInteraction(); } }, [interaction]);
  return <label className="flex min-w-0 flex-col gap-1 text-[11px] text-[var(--editor-muted)]">
    {t(label)}
    <select aria-label={t(label)} className={inputClass} value={onPreview ? draft : value} disabled={disabled}
      onFocus={() => { if (onPreview && !focused.current) { focused.current = true; interaction?.beginInteraction(); } }}
      onChange={event => { const next = event.target.value; draftRef.current = next; setDraft(next); if (onPreview && focused.current) onPreview(next); else onChange(next); }}
      onBlur={() => { if (focused.current) { if (!cancelled.current && draftRef.current !== value) onChange(draftRef.current); onPreview?.(null); focused.current = false; cancelled.current = false; interaction?.endInteraction(); } }}
      onKeyDown={event => {
        if (!onPreview || event.nativeEvent.isComposing) return;
        if (event.key === "Escape") { cancelled.current = true; draftRef.current = value; setDraft(value); event.currentTarget.blur(); }
        if (event.key === "Enter" && draftRef.current !== value) event.currentTarget.blur();
      }}>
      {options.map(option => <option key={option.value} value={option.value}>{t(option.label)}</option>)}
    </select>
  </label>;
}
