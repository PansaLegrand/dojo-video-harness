"use client";
import { useState } from "react";
import type { NativeAgentProgress } from "@/lib/video-project/agent-progress";
import type { VideoProjectDocument } from "@/lib/video-project/document";
import { editorStageBudgetState, editorStageProgress } from "./editor-stage-progress";
import { useNativeEditorText } from "./native-editor-copy";
const kinds: Record<string,string> = { evidence:"Source evidence",caption_batch:"Caption batch",assemble:"Assemble edits",verify:"Verify deliverables",external_job:"External media job" };
const statuses = { pending:"Pending", running:"Stage running", waiting:"Stage waiting", completed:"Stage finished", failed:"Needs attention", cancelled:"Cancelled" };
const requirements: Record<string,string> = { caption_pair:"Captions and translation",asset_sequence:"Media sequence",speech_highlight:"Speech highlight",speech_callout:"Speech callout",appended_ending:"Ending",property:"Property change",property_absent:"Property removed",item_present:"Timeline item",item_absent:"Item removed" };
export function EditorAgentStages({ raw, sources, document, disabled, onSeekFrame }: { raw: unknown; sources: NativeAgentProgress["sources"]; document: VideoProjectDocument | null; disabled: boolean; onSeekFrame?: (frame:number)=>void }) {
 const t=useNativeEditorText(), [expanded,setExpanded]=useState(false), progress=editorStageProgress(raw); if(!progress) return null;
 const budget=editorStageBudgetState(progress), items=expanded?progress.items:progress.items.slice(0,8), saved=progress.items.some(item=>item.savedOutput);
 return <section className="editor-agent-stages" aria-label={t("Edit stages")} data-stage-plan-status={progress.status}>
  <h3>{t("Edit stages")} · {progress.completedStages}/{progress.totalStages} <small>{t("Stages finished")}</small></h3>
  <ol>{items.map(stage=>{const source=sources.find(source=>source.itemId===stage.sourceItemId),current=document?.items.find(item=>item.id===stage.sourceItemId);return <li key={stage.id} data-agent-stage={stage.id} data-stage-status={stage.status}>
   <div><strong>{t(kinds[stage.kind]??"Other edit stage")}</strong><small>{t(statuses[stage.status])}</small></div>
   {source&&<p>{onSeekFrame&&current?<button type="button" disabled={disabled} onClick={()=>onSeekFrame(current.node.from??0)} aria-label={t("Go to clip")+": "+source.name}>{source.name}</button>:source.name}</p>}
   <p className="editor-agent-stage-units">{t("Completed units")}: {stage.completedUnits}/{stage.totalUnits}{stage.savedOutput&&<span>{t("Saved stage output")}</span>}</p>
   {stage.failure&&<><p className="editor-agent-stage-failure">{t("Check the existing request below; completed stages do not need new generation.")}</p><details><summary>{t("Error details")}</summary><p>{stage.failure.message}</p><code>{stage.failure.code}</code></details></>}
  </li>;})}</ol>
  {progress.items.length>8&&<button type="button" aria-expanded={expanded} onClick={()=>setExpanded(value=>!value)}>{t(expanded?"Show fewer stages":"Show all stages")} · {progress.items.length}</button>}
  {saved&&<p className="editor-agent-stage-note">{t("Saved stage work is retained. Timeline application and paid jobs are tracked separately.")}</p>}
  {progress.remainingRequirements.length>0&&<details className="editor-agent-stage-requirements"><summary>{t("Requirements awaiting final verification")} · {progress.remainingRequirements.length}</summary><ul>{progress.remainingRequirements.map(requirement=><li key={requirement.id}>{t(requirements[requirement.kind]??"Requested outputs")}</li>)}</ul></details>}
  {budget==="unknown"&&<p role="status">{t("Usage needs reconciliation. Saved work remains available.")}</p>}
  {budget==="exhausted"&&<p role="status">{t("No authorized model continuation remains. Saved results can still be checked or placed.")}</p>}
  {budget!=="finished"&&budget!=="unknown"&&<details className="editor-agent-stage-budget"><summary>{t("Remaining run budget")}</summary><dl><div><dt>{t("Model turns")}</dt><dd>{progress.remainingBudget.modelCalls}</dd></div><div><dt>{t("Tool actions")}</dt><dd>{progress.remainingBudget.toolCalls}</dd></div><div><dt>{t("Output tokens")}</dt><dd>{progress.remainingBudget.outputTokens}</dd></div></dl></details>}
 </section>;
}
