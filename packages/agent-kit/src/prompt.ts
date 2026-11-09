import { skillIndex } from "./skills.js";
import type { Skill } from "./catalog.js";
const TOOL_GUIDE =
  "Use function calls to inspect, read skills, and propose edits. Do not output edit JSON as ordinary text. ask_user pauses this run. A successful propose_edit hands validated commands to the host, which applies them directly or stages review according to its policy. Tool validation errors are observations: correct them without broadening scope. Never claim a proposal is applied. Preserve all editing, ownership, consent and source-evidence constraints supplied by the host.";
const OVERLAY_GUIDE =
  "For creation of ordinary titles, lower-thirds and supplied-text captions, use prepare_text_overlay before propose_edit. Preserve the requested placement kind: a lower-third stays in the lower portion of the picture, including when avoiding subtitles. Keep the helper's caption-aware placement; if there is insufficient room, ask for shorter copy or permission for another placement. Do not substitute a top-positioned name card.";
const CORRECTION_GUIDE =
  "For corrections to existing text, edit its existing stable IDs rather than creating another overlay. Resolve ordinary follow-ups from the recent conversation and current document: when a single text object is the clear conversational subject, a bare color request changes its letters (foreground color), and a request for color behind it changes that text backing, not the canvas. Preserve the other properties. Explicit user wording or an established focus on the background overrides this default. Do not ask the user to repeat an already clear target merely because it contains both text and a backing. Ask when competing referents remain genuinely unresolved; never guess a missing or removed target. Enlargement must visibly enlarge the letters: account for textFit and available bounds, resizing the existing text box/backing as needed without changing wording or unrelated items.";

/** Editing guides are generated in tool mode by the host. Never rewrite their text. */
export function composeToolAgentPrompt(input: {
  editingGuide: string;
  toolNames: readonly string[];
  skills: readonly Skill[];
}) {
  return [
    input.editingGuide,
    TOOL_GUIDE,
    ...(input.toolNames.includes("prepare_text_overlay")
      ? [OVERLAY_GUIDE]
      : []),
    CORRECTION_GUIDE,
    ...(input.toolNames.includes("review_edit")
      ? [
          "Completion preflight: use review_edit with a small typed requirement for EVERY requested output (max12). The first valid list freezes for this run. Use host cue IDs/prepare_caption_pair for complete bilingual captions; word-bound highlights need readable holdMs and genuine IDs. Repair every failed check, including bounded layout checks, then propose_edit with EXACTLY the successful reviewed commands. A review receipt proves only the declared checklist, never universal semantic or visual quality. A fancy ending must follow the original full duration and reach the final timeline end. Never claim completion after silently dropping a dependent request.",
        ]
      : []),
    ...(input.toolNames.includes("list_assets")
      ? [
          "Paged project readers: list_assets discovers every owned imported asset, including unused images/logos. read_caption_cues returns exact phrase-safe cue IDs/text/timing and genuine word IDs. Use the immutable snapshotHash supplied by the host. Follow coverage.nextCursor to complete the required source/query and preserve all returned IDs; incomplete coverage is unfinished work. Prefer these readers to guessing from the initial bounded context. Use asset_sequence requirements with items[{itemId,assetId,from,duration,sourceStartSeconds?}] to cover all exact media placements compactly (up to100 entries). Prepare one source's complete caption translations with prepare_caption_pair when it fits that helper's bound; a larger source requires a narrower or staged task rather than an omitted tail.",
        ]
      : []),
    "Available skills: " + JSON.stringify(skillIndex(input.skills)),
  ].join("\n\n");
}
