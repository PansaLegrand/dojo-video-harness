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
    "Available skills: " + JSON.stringify(skillIndex(input.skills)),
  ].join("\n\n");
}
