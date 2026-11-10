"use client";
import { useNativeEditorText } from "./native-editor-copy";
import type { EditorAgentSource } from "./editor-agent-progress";

const mediaLabel = { available: "Media available", loading: "Loading media…", missing: "Original file needed" } as const;
const transcriptLabel = { ready: "Transcript ready", partial: "Transcript needs timing review", needed: "Not transcribed", queued: "Transcription queued", running: "Transcribing…", failed: "Transcription needs attention", unknown: "Checking transcription status", not_applicable: "" } as const;
/** Source names are project content, never translated or reconstructed from prose. */
export function EditorAgentSources({ sources, title = "Media in this scope", onInspect, onRelink, disabled = false }: {
  sources: readonly EditorAgentSource[]; title?: string; onInspect?: (source: EditorAgentSource) => void;
  onRelink?: (source: EditorAgentSource) => void; disabled?: boolean;
}) {
  const t = useNativeEditorText();
  const row = (source: EditorAgentSource) => <li key={JSON.stringify([source.itemId, source.assetId])} data-agent-source={source.assetId} data-media-state={source.media}>
    <div><button type="button" className="editor-agent-source-name" title={source.fileName} disabled={!onInspect || source.seekFrame === undefined} onClick={() => onInspect?.(source)} aria-label={`${t("Go to clip")}: ${source.name}`}>{source.name}</button>
      <small>{(source.fromFrame / source.fps).toFixed(2)}–{((source.fromFrame + source.durationInFrames) / source.fps).toFixed(2)} s</small>
      {onInspect && source.seekFrame === undefined && <small>{t("Clip no longer in this timeline")}</small>}
      <small>{t(mediaLabel[source.media])}{source.media === "available" ? ` · ${t(source.storage === "local" ? "On this device" : source.storage === "project" ? "Stored in project" : "Built-in media")}` : ""}</small>
      {transcriptLabel[source.transcript] && <small data-transcript-state={source.transcript}>{t(transcriptLabel[source.transcript])}</small>}
    </div>
    {source.media === "missing" && source.storage === "local" && onRelink && <button type="button" className="editor-agent-source-relink" disabled={disabled} onClick={() => onRelink(source)}>{t("Choose original file")}</button>}
  </li>;
  return <section className="editor-agent-sources" aria-label={t(title)}>
    <h3>{t(title)} <span>{sources.length}</span></h3>
    {!sources.length ? <p>{t("No video, audio or images in this scope.")}</p> : <>
      <ul>{sources.slice(0, 3).map(row)}</ul>
      {sources.length > 3 && <details><summary>{t("Show all scoped media")} · {sources.length}</summary><ul>{sources.slice(3).map(row)}</ul></details>}
    </>}
  </section>;
}
