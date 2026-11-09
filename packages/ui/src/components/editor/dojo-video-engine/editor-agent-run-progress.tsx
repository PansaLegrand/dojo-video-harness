"use client";
import { useMemo } from "react";
import type { VideoProjectAgentRun } from "@/lib/video-project/agent-types";
import type { VideoProjectDocument } from "@/lib/video-project/document";
import { editorAgentRunPresentation, editorAgentRunSources } from "./editor-agent-progress";
import { EditorAgentStages } from "./editor-agent-stages";
import { EditorAgentSources } from "./editor-agent-sources";
import { useNativeEditorText } from "./native-editor-copy";
const executionLabels = { waiting_media: "Waiting for media", transcribing: "Transcribing sources", preparing: "Preparing edits", ready: "Edits prepared", answered: "Answer ready", needs_input: "Reply needed", attention: "Needs attention", cancelled: "Cancelled", cancelling: "Cancellation requested" } as const;
const applicationLabels = { pending: "Ready to apply", review: "Ready for review", applied: "Applied to project", not_applied: "Not applied", not_applicable: "No project changes" } as const;
const outputLabels: Record<string, string> = { caption_pair: "Captions and translation", asset_sequence: "Media sequence", speech_highlight: "Speech highlight", speech_callout: "Speech callout", appended_ending: "Ending", property: "Property change", property_absent: "Property removed", item_present: "Timeline item", item_absent: "Item removed" };
const recipeLabels: Record<string, string> = { assetSequence: "Media sequence", subtitles: "Captions", textOverlay: "Text", countdown: "Countdown", motionGraphic: "Motion graphic", audioBed: "Audio" };
export function EditorAgentRunProgress({ run, document, sources, restoringSources, onSeekFrame, onRelinkSource, disabled }: {
  run: VideoProjectAgentRun; document: VideoProjectDocument | null; sources: Readonly<Record<string, string>>; restoringSources: boolean;
  onSeekFrame?: (frame: number) => void; onRelinkSource?: (assetId: string) => void; disabled: boolean;
}) {
  const t = useNativeEditorText(), state = editorAgentRunPresentation(run);
  const rows = useMemo(() => run.progress ? editorAgentRunSources(run.progress, document, sources, restoringSources) : [], [run.progress, document, sources, restoringSources]);
  if (!run.progress && !run.verification) return null;
  const outputs = run.progress?.deliverables ?? run.verification?.outcomes.map(outcome => ({ id: outcome.id, label: outcome.message, status: "passed" as const })) ?? [];
  return <div className="editor-agent-progress" data-agent-coverage={state.coverage}>
    <dl className="editor-agent-progress-states">
      <div><dt>{t("Preparation")}</dt><dd data-agent-execution={state.execution}>{t(run.progress?.execution.state === "waiting_for_consent" ? "Waiting for cloud consent" : executionLabels[state.execution])}</dd></div>
      <div><dt>{t("Project changes")}</dt><dd data-agent-application={state.application}>{t(applicationLabels[state.application])}</dd></div>
    </dl>
    {run.progress && <EditorAgentSources title="Request sources" sources={rows} disabled={disabled} onInspect={onSeekFrame ? source => onSeekFrame(source.seekFrame!) : undefined} onRelink={onRelinkSource ? source => onRelinkSource(source.assetId) : undefined} />}
    {run.progress && <EditorAgentStages raw={"stages" in run.progress ? run.progress.stages : undefined} sources={run.progress.sources} document={document} disabled={disabled} onSeekFrame={onSeekFrame} />}
    <section className="editor-agent-outputs" aria-label={t("Requested outputs")}>
      <h3>{t("Requested outputs")}{outputs.length ? ` · ${state.verified}/${outputs.length}` : ""}</h3>
      {!outputs.length ? <p>{t("Outputs appear as the edit is planned.")}</p> : <ul>{outputs.map(output => {
        const itemId = "itemId" in output && typeof output.itemId === "string" ? output.itemId : undefined;
        const item = document?.items.find(item => item.id === itemId);
        const label = "kind" in output && typeof output.kind === "string" ? outputLabels[output.kind] ?? output.label : output.id.startsWith("recipe:") ? recipeLabels[output.id.slice(7)] ?? output.label : output.label;
        return <li key={output.id} data-deliverable-status={output.status}>
          {item && onSeekFrame ? <button type="button" onClick={() => onSeekFrame(item.node.from ?? 0)}>{t(label)} · {item.name}</button> : <span>{t(label)}</span>}
          <small>{t(output.status === "passed" ? "Verified" : output.status === "failed" ? "Needs attention" : "Pending")}</small>
        </li>;
      })}</ul>}
      {state.coverage === "incomplete" && <p role="status">{t("Some requested outputs need attention.")}</p>}
    </section>
  </div>;
}
