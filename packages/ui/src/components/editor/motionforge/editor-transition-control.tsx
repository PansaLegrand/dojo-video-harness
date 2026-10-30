import React, { useEffect, useMemo, useRef, useState } from "react";
import type { VideoProjectDocument } from "@/lib/video-project/document";
import type { VideoProjectCommand } from "@/lib/video-project/commands";
import { useTranslation } from "@/lib/i18n";
import { useNativeEditorText } from "./native-editor-copy";
import { EditorField, EditorSelect } from "./editor-fields";
import {
  buildEditorTransitionCommands,
  editorTransitionDefaults,
  editorTransitionReason,
  editorTransitionTarget,
  removeEditorTransitionCommands,
  type EditorTransitionSettings,
} from "./editor-transition";
import { editorTransitionCopy } from "./editor-transition-copy";

export function EditorTransitionControl({
  document,
  itemId,
  disabled = false,
  onApply,
  onSeek,
}: {
  document: VideoProjectDocument;
  itemId: string | null;
  disabled?: boolean;
  onApply: (commands: VideoProjectCommand[]) => Promise<void>;
  onSeek?: (frame: number) => void;
}) {
  const { locale } = useTranslation(),
    fallback = useNativeEditorText(),
    t = (label: string) =>
      locale === "en"
        ? label
        : (editorTransitionCopy[locale]?.[label] ?? fallback(label));
  const target = useMemo(
    () => editorTransitionTarget(document, itemId),
    [document, itemId],
  );
  const [settings, setSettings] = useState(() =>
      editorTransitionDefaults(document, itemId),
    ),
    [open, setOpen] = useState(false),
    [busy, setBusy] = useState(false),
    [notice, setNotice] = useState<string | null>(null);
  const newId = useRef(crypto.randomUUID()),
    selected = useRef(itemId),
    generation = useRef(0),
    inFlight = useRef(false);
  selected.current = itemId;
  useEffect(() => {
    generation.current++;
    inFlight.current = false;
    setBusy(false);
    setOpen(false);
    return () => {
      generation.current++;
    };
  }, [itemId]);
  const basis = `${itemId}:${target.next?.id}:${JSON.stringify(target.existing ?? null)}`;
  useEffect(() => {
    setSettings(editorTransitionDefaults(document, itemId));
    setNotice(null);
    if (!target.existing) newId.current = crypto.randomUUID();
  }, [basis]);
  const locked = !!document.tracks.find(
    (track) => track.id === target.from?.trackId,
  )?.locked;
  const checked = useMemo(() => {
    if (target.reason || !itemId)
      return { reason: target.reason ?? "Choose a video or image clip." };
    if (!open) return { reason: undefined }; // Keep clip selection cheap until these controls are opened.
    try {
      return {
        commands: buildEditorTransitionCommands(
          document,
          itemId,
          settings,
          newId.current,
        ),
      };
    } catch (cause) {
      return { reason: editorTransitionReason(cause) };
    }
  }, [document, itemId, settings, target.reason, open]);
  const current = target.existing;
  const unchanged =
    !!current &&
    current.kind === settings.kind &&
    current.durationFrames === settings.durationFrames &&
    (current.audio === "crossfade") === settings.blendAudio;
  if (!target.from || !["video", "img"].includes(target.from.node.type))
    return null;
  async function apply(remove = false) {
    if (!itemId || inFlight.current || disabled || locked) return;
    const id = itemId,
      epoch = generation.current;
    inFlight.current = true;
    setBusy(true);
    setNotice(null);
    try {
      const commands = remove
        ? removeEditorTransitionCommands(document, id)
        : buildEditorTransitionCommands(document, id, settings, newId.current);
      await onApply(commands);
      if (selected.current === id && generation.current === epoch)
        setNotice(remove ? "Transition removed." : "Transition applied.");
    } catch (cause) {
      if (selected.current === id && generation.current === epoch)
        setNotice(editorTransitionReason(cause));
    } finally {
      if (selected.current === id && generation.current === epoch) {
        inFlight.current = false;
        setBusy(false);
      }
    }
  }
  return (
    <details
      open={open}
      onToggle={(event) => setOpen(event.currentTarget.open)}
      className="m-3 space-y-3 rounded border border-[var(--editor-border)] p-3"
      data-editor-transition
    >
      <summary className="cursor-pointer text-xs font-medium text-[var(--editor-text)]">
        {t("Transition to next clip")}
        {current && (
          <span className="ml-2 text-[10px] text-[var(--editor-muted)]">
            {t(current.kind === "dissolve" ? "Cross dissolve" : "Dip to black")}
          </span>
        )}
      </summary>
      {target.next && (
        <p className="text-[11px] text-[var(--editor-muted)]">
          {t("Next clip")}: {target.next.name}
        </p>
      )}
      <p className="text-[11px] leading-5 text-[var(--editor-muted)]">
        {t("Clip timing stays unchanged.")}
      </p>
      <fieldset
        disabled={disabled || busy || locked || !target.next}
        className="space-y-3"
      >
        <EditorSelect
          label={t("Transition")}
          value={settings.kind}
          options={[
            { value: "dissolve", label: t("Cross dissolve") },
            { value: "dipToBlack", label: t("Dip to black") },
          ]}
          onChange={(kind) => {
            setNotice(null);
            setSettings((value) => ({
              ...value,
              kind: kind as EditorTransitionSettings["kind"],
            }));
          }}
        />
        <EditorField
          label={t("Transition duration (s)")}
          type="number"
          min={2 / document.format.fps}
          max={Math.max(2, target.maximumFrames) / document.format.fps}
          step={1 / document.format.fps}
          decimalPlaces={3}
          value={settings.durationFrames / document.format.fps}
          onCommit={(value) => {
            setNotice(null);
            setSettings((current) => ({
              ...current,
              durationFrames: Math.round(Number(value) * document.format.fps),
            }));
          }}
        />
        <label className="flex items-center gap-2 text-xs text-[var(--editor-text)]">
          <input
            type="checkbox"
            checked={settings.blendAudio}
            onChange={(event) => {
              setNotice(null);
              setSettings((value) => ({
                ...value,
                blendAudio: event.target.checked,
              }));
            }}
          />
          {t("Blend audio")}
        </label>
        <p className="text-[11px] leading-5 text-[var(--editor-muted)]">
          {t(
            settings.blendAudio
              ? "Audio blends across the cut."
              : "Original audio stays unchanged.",
          )}
        </p>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            className="editor-primary-button"
            disabled={!!checked.reason || unchanged}
            onClick={() => void apply()}
          >
            {t("Apply transition")}
          </button>
          {current && (
            <button
              type="button"
              className="editor-secondary-button"
              onClick={() => void apply(true)}
            >
              {t("Remove transition")}
            </button>
          )}
          {onSeek && target.cut !== undefined && (
            <button
              type="button"
              className="editor-secondary-button"
              onClick={() => onSeek(target.cut!)}
            >
              {t("Preview cut")}
            </button>
          )}
        </div>
      </fieldset>
      {(checked.reason || locked) && (
        <p
          role="status"
          className="text-[11px] leading-5 text-[var(--editor-muted)]"
        >
          {t(
            locked ? "Unlock the track to edit transitions." : checked.reason!,
          )}
        </p>
      )}
      {notice && (
        <p
          role="status"
          className="text-[11px] leading-5 text-[var(--editor-text)]"
        >
          {t(notice)}
        </p>
      )}
    </details>
  );
}
