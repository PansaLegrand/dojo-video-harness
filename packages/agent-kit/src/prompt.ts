import { skillIndex } from "./skills.js";
import {
  usesEfficientReaders,
  usesResolvedEditSchema,
  usesStagedEditing,
  usesAuthoringContracts,
  usesReviewedEditReferences,
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
}) {
  const efficient =
    input.profile !== undefined && usesEfficientReaders(input.profile);
  const resolved =
    input.profile !== undefined && usesResolvedEditSchema(input.profile);
  const authoring =
    input.profile !== undefined && usesAuthoringContracts(input.profile);
  const reviewReferences =
    input.profile !== undefined && usesReviewedEditReferences(input.profile);
  const staged =
    input.profile !== undefined && usesStagedEditing(input.profile);
  return [
    input.editingGuide,
    authoring
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
    ...(input.toolNames.includes("review_edit")
      ? [
          reviewReferences
            ? REVIEW_REFERENCE_COMPLETION_GUIDE
            : authoring
              ? AUTHORING_COMPLETION_GUIDE
              : "Completion preflight: use review_edit with a small typed requirement for EVERY requested output (max12). The first valid list freezes for this run. Use host cue IDs/prepare_caption_pair for complete bilingual captions; word-bound highlights need readable holdMs and genuine IDs. Repair every failed check, including bounded layout checks, then propose_edit with EXACTLY the successful reviewed commands. A review receipt proves only the declared checklist, never universal semantic or visual quality. A fancy ending must follow the original full duration and reach the final timeline end. Never claim completion after silently dropping a dependent request.",
        ]
      : []),
    ...(input.toolNames.includes("list_assets")
      ? [
          "Paged project readers: list_assets discovers every owned imported asset, including unused images/logos. read_caption_cues returns exact phrase-safe cue IDs/text/timing and genuine word IDs. Use the immutable snapshotHash supplied by the host. Follow coverage.nextCursor to complete the required source/query and preserve all returned IDs; incomplete coverage is unfinished work. Prefer these readers to guessing from the initial bounded context. Use asset_sequence requirements with items[{itemId,assetId,from,duration,sourceStartSeconds?}] to cover all exact media placements compactly (up to100 entries). Prepare one source's complete caption translations with prepare_caption_pair when it fits that helper's bound; a larger source requires a narrower or staged task rather than an omitted tail.",
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
