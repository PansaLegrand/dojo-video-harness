import { skillIndex } from "./skills.js";
import {
  usesEfficientReaders,
  usesResolvedEditSchema,
  usesStagedEditing,
  usesAuthoringContracts,
  usesReviewedEditReferences,
  usesPhaseScopedTools,
  usesPreviewRepair,
  usesAppendPreviewRepair,
  usesSemanticEditingGuidance,
  usesDerivedCaptionPlan,
  type AgentProfile,
} from "./catalog.js";
import type { Skill } from "./catalog.js";
const TOOL_GUIDE =
  "Use function calls to inspect, read skills, and propose edits. Do not output edit JSON as ordinary text. ask_user pauses this run. A successful propose_edit hands validated commands to the host, which applies them directly or stages review according to its policy. Tool validation errors are observations: correct them without broadening scope. Never claim a proposal is applied. Preserve all editing, ownership, consent and source-evidence constraints supplied by the host.";
const OVERLAY_GUIDE =
  "For creation of ordinary titles, lower-thirds and supplied-text captions, use prepare_text_overlay before propose_edit. Preserve the requested placement kind: a lower-third stays in the lower portion of the picture, including when avoiding subtitles. Keep the helper's caption-aware placement; if there is insufficient room, ask for shorter copy or permission for another placement. Do not substitute a top-positioned name card.";
const CORRECTION_GUIDE =
  "For corrections to existing text, edit its existing stable IDs rather than creating another overlay. Resolve ordinary follow-ups from the recent conversation and current document: when a single text object is the clear conversational subject, a bare color request changes its letters (foreground color), and a request for color behind it changes that text backing, not the canvas. Preserve the other properties. Explicit user wording or an established focus on the background overrides this default. Do not ask the user to repeat an already clear target merely because it contains both text and a backing. Ask when competing referents remain genuinely unresolved; never guess a missing or removed target. Enlargement must visibly enlarge the letters: account for textFit and available bounds, resizing the existing text box/backing as needed without changing wording or unrelated items.";

/** Editing guides are generated in tool mode by the host. Never rewrite their text. */
export function composeToolAgentPrompt(input: {
  profile?: AgentProfile;
  editingGuide: string;
  toolNames: readonly string[];
  skills: readonly Skill[];
  phase?: "planning" | "caption_batch" | "assemble";
}) {
  const efficient =
    input.profile !== undefined && usesEfficientReaders(input.profile);
  const resolved =
    input.profile !== undefined && usesResolvedEditSchema(input.profile);
  const authoring =
    input.profile !== undefined && usesAuthoringContracts(input.profile);
  const reviewReferences =
    input.profile !== undefined && usesReviewedEditReferences(input.profile);
  const phaseScoped =
    input.profile !== undefined && usesPhaseScopedTools(input.profile);
  const phase = input.phase ?? "planning";
  if (phaseScoped && !["planning", "caption_batch", "assemble"].includes(phase))
    throw new Error("The host supplied an unknown editing phase.");
  const staged =
    input.profile !== undefined && usesStagedEditing(input.profile);
  return [
    input.editingGuide,
    phaseScoped
      ? PHASE_EXECUTION_GUIDES[phase]
      : authoring
        ? AUTHORING_EXECUTION_GUIDE
        : staged
          ? STAGED_EXECUTION_GUIDE
          : resolved
            ? EDITING_EXECUTION_GUIDE
            : efficient
              ? EFFICIENT_TOOL_GUIDE
              : TOOL_GUIDE,
    ...(input.toolNames.includes("prepare_text_overlay")
      ? [OVERLAY_GUIDE]
      : []),
    CORRECTION_GUIDE,
    ...(input.profile && usesPreviewRepair(input.profile)
      ? [
          usesAppendPreviewRepair(input.profile)
            ? APPEND_PREVIEW_REPAIR_GUIDE
            : PREVIEW_REPAIR_GUIDE,
        ]
      : []),
    ...(input.profile && usesSemanticEditingGuidance(input.profile)
      ? [SEMANTIC_EDITING_GUIDE]
      : []),
    ...(input.profile && usesDerivedCaptionPlan(input.profile)
      ? [DERIVED_CAPTION_PLAN_GUIDE]
      : []),
    ...(input.toolNames.includes("review_edit")
      ? [
          phaseScoped && phase === "assemble"
            ? ASSEMBLY_COMPLETION_GUIDE
            : reviewReferences
              ? REVIEW_REFERENCE_COMPLETION_GUIDE
              : authoring
                ? AUTHORING_COMPLETION_GUIDE
                : "Completion preflight: use review_edit with a small typed requirement for EVERY requested output (max12). The first valid list freezes for this run. Use host cue IDs/prepare_caption_pair for complete bilingual captions; word-bound highlights need readable holdMs and genuine IDs. Repair every failed check, including bounded layout checks, then propose_edit with EXACTLY the successful reviewed commands. A review receipt proves only the declared checklist, never universal semantic or visual quality. A fancy ending must follow the original full duration and reach the final timeline end. Never claim completion after silently dropping a dependent request.",
        ]
      : []),
    ...(input.toolNames.includes("list_assets")
      ? [
          phaseScoped
            ? PHASE_READER_GUIDE
            : "Paged project readers: list_assets discovers every owned imported asset, including unused images/logos. read_caption_cues returns exact phrase-safe cue IDs/text/timing and genuine word IDs. Use the immutable snapshotHash supplied by the host. Follow coverage.nextCursor to complete the required source/query and preserve all returned IDs; incomplete coverage is unfinished work. Prefer these readers to guessing from the initial bounded context. Use asset_sequence requirements with items[{itemId,assetId,from,duration,sourceStartSeconds?}] to cover all exact media placements compactly (up to100 entries). Prepare one source's complete caption translations with prepare_caption_pair when it fits that helper's bound; a larger source requires a narrower or staged task rather than an omitted tail.",
        ]
      : []),
    (efficient
      ? "Optional skill references for a specific missing operation: "
      : "Available skills: ") + JSON.stringify(skillIndex(input.skills)),
  ].join("\n\n");
}
const STAGED_EXECUTION_GUIDE =
  "Complete the original request using frozen project facts, declared outcomes and the active durable stage. For large or multi-source caption work, call plan_edit_stages with every requested outcome and exact source/range caption settings. The host persists the ordered plan and original overall budget, then continues each stage. In a caption_batch stage read only that exact batch's ranged genuine cue IDs; save_caption_batch persists all of its translations and yields to the host. Completed siblings are immutable reusable artifacts. Do not claim the overall task complete after one batch. read_edit_artifact resolves a specific missing owned artifact; financial/provider/binary data stays in dedicated host ports. During assembly the host includes its prepared command artifacts automatically. Supply only additional or repair commands; commands:[] is valid only when preparedCommands is explicitly present in durableStages. Requirements remain frozen while commands remain repairable. Review the complete expanded candidate and propose the exact successful edit. Current project edits and the original instruction govern earlier decisions. Host-input waits pause this same attempt until its authorized receipt exists; never spend model calls polling. All stages share the original overall allowance; no stage, narration or skill authorizes additional provider work or fallback. For existing manually edited caption text, use read_caption_track and preserve its current-display-v1 IDs/times/pair links; these display values never replace genuine ASR words. Read at most one needed skill before starting preparation and retain explicit incomplete coverage.";

const EFFICIENT_TOOL_GUIDE =
  "Complete the requested editing work using authoritative supplied project metadata, IDs, cue packets and source clocks. Begin preparation once the needed facts are available. Reader calls resolve a specific missing or ambiguous requested fact. Scope all discovery to REQUESTED assets, source ranges and outputs. 'All requested outputs' never requires enumerating an unrelated imported library. The reader snapshotHash argument can be omitted because the host already binds its frozen snapshot; a supplied mismatch is rejected. Use list_assets name/type filters for missing named assets; preserve IDs already supplied instead of looking them up again. Use read_caption_cues only for the requested sourceRange/pages when its needed cues are incomplete. read_skill is optional reference: use at most one relevant skill before beginning preparation, then read another only when a concrete validation gap requires it. Avoid repeated inspection that returns the same facts. Prepare requested caption pairs and exact media placement commands, review_edit the complete candidate, repair failed checks and propose_edit exact successful commands. ask_user is for essential unresolved information. Preserve editing scope, source evidence and paid-operation authorization. Never claim application before the host applies the candidate.";

const EDITING_EXECUTION_GUIDE =
  "Complete requested edits using the authoritative supplied metadata and targeted reads. Only requested assets and moments need discovery. Reader snapshots are bound by the host; model reader arguments use source/asset selectors and cursors. For ANY sourceRange, first call read_caption_cues with that exact sourceRange for each speech source before translating or preparing captions. The initial caption packet is SOURCE OVERVIEW only and its original cue count does not supply ranged cue IDs/text. Translate only the exact returned ranged cue pages and pass the same range to prepare_caption_pair. Reuse provided asset IDs; list_assets filters missing named targets only. Requirements freeze on the first valid review, while COMMANDS REMAIN REPAIRABLE. A failed review or empty command attempt means assemble/repair the complete command batch from prepared results and native media placements, then review again. Preserve every requested deliverable. review_edit.edit and propose_edit both require outcome:proposal and nonempty commands. Clarification uses ask_user, and factual answers use the ordinary answer path. Never abandon an otherwise supported edit because the initial command batch failed validation. Read at most one needed skill before preparation, then additional guidance only for a specific validation gap. A successful review authorizes exact reviewed commands. The host applies the candidate under its ownership/scope/revision policy.";

const AUTHORING_COMPLETION_GUIDE =
  "Review before proposing: define a small supported concrete check for every requested deliverable (max12), using kind rather than type. Supported kinds are in each requirements JSON schema; never invent preserve_source, animated_chapters, financial_accuracy or visual_style kinds. Monolingual captions use captionSource and item/property checks; never invent an en-to-en caption_pair. Preserve full source audio with asset_sequence plus exact source offset/duration properties as needed. Each important graphic can use item_present plus text/timing/property checks. Use speech_callout for an exact spoken currency/phrase; speech_highlight additionally requires supported numeric normalization. An ending inside existing narration uses item/property checks; appended_ending is only for an ending after the original/edited content. Neither review_edit nor a rejected propose_edit saves a draft. Send review_edit({requirements,edit:{outcome:'proposal',summary,commands:[ALL intended commands]}}). Repair the complete edit and review again until passed; then send that EXACT edit object to propose_edit, without requirements or receipt. Do not send commands:[] after a rejected proposal. A receipt verifies its declared checks, not universal financial/creative accuracy; use permitted preview evidence for visual uncertainty.";
const AUTHORING_EXECUTION_GUIDE =
  "Complete the user's requested edit using authoritative source IDs and targeted reads. For an original-language audio/video explainer, read all required cue pages, keep the source narration unchanged, use captionSource for genuine captions, and native/macro graphics for the explanation. read_skill is optional guidance, not an editing operation. plan_edit_stages accepts captionPairs:[] for general editing or monolingual captions; use actual distinct-language pairs only when translation was requested. All requested outcomes remain declared and frozen, all stages share one original budget, and no plan applies edits or creates caption commands by itself. In assembly supply every actual caption/graphic/media command; commands:[] works only when durableStages explicitly reports preparedCommands. Read inspect_graphics_schema before unfamiliar native graphics: macro names use node.macro, not node.type; ordinary 2D animations use {kind:'keyframes',property:'opacity',frames:[{frame:0,value:0},{frame:12,value:1}]}. Native nested frames are parent-local, source speech uses actual source milliseconds/word IDs. Correct tool validation failures with the supplied schemas without dropping requested work. Finish a supported editing request with a successfully reviewed proposal, not an ordinary answer describing unfinished work. If genuinely blocked, state the remaining work honestly; do not claim application or spend beyond the original allowance.";

const REVIEW_REFERENCE_COMPLETION_GUIDE =
  "Review the complete edit with review_edit({requirements,edit:{outcome:'proposal',summary,commands:[ALL intended commands]}}). Use only supported concrete requirement kinds and exact native property paths; the first valid list freezes. inspect_project's from/duration index fields come from the node: use target:{kind:'node',itemId,nodeId} and path:['duration'] for timing, or explicit item path:['node','duration']; direct item path:['duration'] is invalid. A successful review retains the exact complete edit as an immutable owned verification artifact. Finish with propose_edit({reviewed:true}), without regenerating any command JSON, receipt or reference. The host resolves only this same attempt's latest successful review and still validates its source/requirements/checks/command hashes and native compiler output. A failed or error review invalidates the compact proposal path; retain your full commands, repair them and review the full edit again. Empty additional commands are allowed only when the host explicitly reports preparedCommands. Original-language captions use captionSource; never invent a same-language translation pair. Speech callouts bind genuine words; use exact phrases for currencies rather than unsupported number normalization. An ending inside existing audio uses item/property checks; appended_ending means after prior content. Native validity and declared checks do not prove universal financial or creative quality; use authorized preview evidence for visual uncertainty. Requirements, source identity, original budget and permissions never reset.";

const PHASE_EXECUTION_GUIDES = {
  planning:
    "Active phase: PLANNING. Inspect only missing source facts and read the complete requested speech pages. For dependent edits, declare concrete supported outcomes once with plan_edit_stages; original-language captions and creative graphics use captionPairs:[], not a same-language translation pair. This saves the plan and yields to the host, which starts the appropriate next phase under the same original budget. Simple edits may instead be reviewed and proposed directly using the exact raw edit, following the successful review reply. No caption batch is active yet. Native macro/shape schemas are discoverable through inspect_graphics_schema. End an editing request with the actual reviewed proposal, never a description of a future edit.",
  caption_batch:
    "Active phase: CAPTION BATCH. The plan and requested outcomes are already frozen. Read only this active batch's exact source/range cue IDs and supply one requested-language translation per genuine cue to save_caption_batch. Saving yields to the host, which advances the remaining batches and assembly. Do not create another plan, review/propose a partial whole-project edit, poll providers, invent source timings or replace ASR evidence. Other requested graphics, media and endings remain required and will be authored during final assembly; do not mark the overall request complete after one batch.",
  assemble:
    "Active phase: FINAL ASSEMBLY. The original plan and completion outcomes are ALREADY FROZEN. Do not create, restart or replace a plan, add a translation batch or declare a new checklist. Fulfill the FULL original user instruction, including requested graphics, charts, captions, source preservation and ending even if the bounded checklist covers only some concrete properties. Author the complete intended additional edit, then review/repair it and finish the actual proposal. The host includes prepared caption commands only when durableStages explicitly reports preparedCommands; otherwise include source-bound captionSource and all graphic commands yourself. Discover installed native/macro syntax when needed. Native animations use kind:keyframes with property and frames; macro names use node.macro, not node.type. All work shares the unchanged original allowance. Do not stop with an ordinary answer describing unfinished editing.",
} as const;
const ASSEMBLY_COMPLETION_GUIDE =
  "The completion requirements are already frozen by the host. Call review_edit with {edit:{outcome:'proposal',summary,commands:[all intended additional commands]}} and OMIT requirements to preserve that list. Never replace, add to or weaken it. A failed check requires repairing the full command list and reviewing again; it does not authorize replanning. Fulfill all requested outputs even when the checklist is only a bounded subset of semantic/visual quality. If a successful review returns reviewRef, finish with propose_edit({reviewed:true}); the host resolves that same owned successful full edit and checks its hashes/native compilation without regenerating command JSON. If no saved reference exists, follow the review reply's exact raw-edit fallback. Empty additional commands are allowed only with explicit host preparedCommands. Source/evidence identities, original budget, consent and shared Undo remain unchanged.";
const PHASE_READER_GUIDE =
  "Read authoritative supplied metadata and targeted source/asset/caption pages for the current phase. Follow returned cursors for the requested range and retain genuine source word/cue IDs; incomplete coverage is unfinished work. Do not enumerate unrelated imported assets or invent timing. During final assembly, all batches and the plan are already fixed; readers resolve missing facts for the actual complete edit, not a new planning pass. Use the host's completion-target hints: flattened item-index from/duration are node fields, so use a node target or explicit item.node path for completion checks.";

const PREVIEW_REPAIR_GUIDE =
  "Original source audio facts distinguish present, absent and unknown audio tracks. A silent source needs no ASR. An audio track does not prove speech. Resolve genuinely ambiguous speech targets with ask_user. For visual uncertainty use the existing request_project_preview after successful assembly review with {frames,reviewed:true}. Wait for the authorized browser receipt, inspect the actual labeled sampled pixels, then either propose with previewReport:{requestId,receiptHash,issues:[]} or correct observed failures through review_edit({edit,previewRepair:{requestId,receiptHash,issues:[{frame,description}]}}). Omit requirements to preserve the frozen checklist. Exactly ONE correction command batch can be claimed under the original allowance. Its claim persists even if review fails. After a successful correction request a SECOND preview of the repaired candidate and finish with propose_edit({reviewed:true,previewReport:{requestId,receiptHash,issues:[remaining sampled failures]}}). A second correction is unavailable. Report unresolved failures honestly and stop. Sampled images cover only listed frames, audio is not inspected, and unsampled/semantic quality remains unknown. Native review/Apply/Undo and provider consent still govern all work.";

const APPEND_PREVIEW_REPAIR_GUIDE =
  "Original source audio facts distinguish present, absent and unknown tracks. Silent originals need no ASR. Use ask_user for genuinely ambiguous speech targets. After a successful full assembly review, request_project_preview({frames,reviewed:true}) and inspect its authorized labeled samples. To repair observed failures with incremental native commands, send review_edit({edit:{outcome:'proposal',summary,commands:[only targeted repair commands]},previewRepair:{mode:'append',requestId,receiptHash,issues:[{frame,description}]}}). The host resolves that exact owned verified candidate and appends the supplied commands once, preserving its original assembly and prepared captions. Requirements and the original compiler snapshot remain frozen. The complete expanded candidate receives native validation before its single correction claim is consumed. Both repair modes validate before claiming. Invalid commands may be corrected against the same receipt. Omit mode when supplying a complete replacement batch. A successfully claimed correction requires a SECOND preview of the repaired candidate and propose_edit({reviewed:true,previewReport:{requestId,receiptHash,issues:[remaining sampled failures]}}). Report remaining sampled failures honestly. Samples cover only listed frames and leave audio and unsampled quality uninspected. Apply, Undo, consent and the original overall allowance continue through the existing host ports.";

const SEMANTIC_EDITING_GUIDE =
  "Before plan_edit_stages or the first review freezes requirements, choose the check that matches the intended displayed content. speech_callout requires genuine word IDs for a verbatim spoken quote, exactText matching that quote, and exactly that displayed text in the checked item. Put explanatory labels, shortened currency and unit labels in separate items with their own item/property checks. speech_highlight uses only recognized numeric word IDs and a supported numeric or percent exactText display. Keep currency, unit and context labels in separate items. Preserve the original genuine word identities and timing. Once requirements freeze, repair the edit against them. For caption translation, EACH cue must retain ALL facts, proper names, numbers, units, reporting periods, time qualifiers, comparisons and negation from THAT source cue. Neighboring context may clarify meaning while every source fact stays in its own cue. Before save_caption_batch, self-check every translated cue against its matching genuine source cue and confirm complete cue-ID coverage. Context never authorizes moving a fact to an adjacent cue or dropping it for brevity.";

const DERIVED_CAPTION_PLAN_GUIDE =
  "In plan_edit_stages, captionPairs are authoritative declarations for the requested bilingual captions. Declare each pair once with its exact source/evidence, stable item IDs, languages, colors and requested sourceRange. The host validates those pairs and derives any missing caption_pair checks before requirements freeze. A matching explicit pair check is reused. Keep all other requested outcome checks in requirements; supplied checks are preserved, and the combined supplied plus derived list must fit12. Conflicting fields, duplicate IDs and explicit checks for unplanned pairs are rejected. requirements:[] is valid when declared pairs derive at least one check. Both requirements:[] and captionPairs:[] is invalid. After planning, use the host's complete frozen checklist without rewriting or weakening it. Scope, genuine cue coverage, per-cue fidelity and the original allowance remain binding.";
