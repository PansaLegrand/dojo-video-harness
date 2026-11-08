import { runToolLoop } from "../../agent-loop/src/index";
import {
  buildNativeAgentPrompts,
  compileNativeAgentResult,
  type NativeAgentRequest,
  type NativeAgentResult,
} from "../../core/src/lib/video-project/agent-runtime";
import { parseVideoProjectDocument } from "../../core/src/lib/video-project/document";
import { skillIndex, type Skill } from "./skills";
import { createVideoTools, type AgentTool } from "./tools";
import type { LanguageModel, ChatMessage, AgentEvent } from "./types";

/** Model -> function call -> validated tool -> observation -> repeat.
 * Persistence, user decisions, and final commits belong to the host. */
export async function runAgent(input: {
  request: NativeAgentRequest;
  model: LanguageModel;
  skills: Skill[];
  signal: AbortSignal;
  onEvent?: (event: AgentEvent) => void | Promise<void>;
  messages?: Array<{ role: string; text: string }>;
  maxSteps?: number;
  maxToolCalls?: number;
  extraTools?: AgentTool[];
}): Promise<NativeAgentResult> {
  const { request, model, skills, signal } = input;
  signal.throwIfAborted();
  await compileNativeAgentResult(request, {
    outcome: "answer",
    summary: "Snapshot validation",
    commands: [],
  });
  const document = parseVideoProjectDocument(request.document);
  const prompts = buildNativeAgentPrompts({
    ...request,
    document,
    instruction: request.instruction ?? "",
    messages: input.messages ?? [],
  });
  const system =
    prompts.systemPrompt.replace(
      "Return ONLY JSON:",
      "The propose_edit tool accepts:",
    ) +
    "\nUse function calls to inspect, read skills, and propose edits. Do not output edit JSON as ordinary text. Ask_user pauses this run. A successful propose_edit hands validated commands to the host, which applies them directly or stages review according to its policy. Tool validation errors are observations: correct them without broadening scope. Never claim a proposal is applied.\nFor creation of ordinary titles, lower-thirds and supplied-text captions, use prepare_text_overlay before propose_edit. Preserve the requested placement kind: a lower-third stays in the lower portion of the picture, including when avoiding subtitles. Keep the helper's caption-aware placement; if there is insufficient room, ask for shorter copy or permission for another placement. Do not substitute a top-positioned name card. For corrections to existing text, edit its existing stable IDs rather than creating another overlay. Resolve ordinary follow-ups from the recent conversation and current document: when a single text object is the clear conversational subject, a bare color request changes its letters (foreground color), and a request for color behind it changes that text backing, not the canvas. Preserve the other properties. Explicit user wording or an established focus on the background overrides this default. Do not ask the user to repeat an already clear target merely because it contains both text and a backing. Ask when competing referents remain genuinely unresolved; never guess a missing or removed target. Enlargement must visibly enlarge the letters: account for textFit and available bounds, resizing the existing text box/backing as needed without changing wording or unrelated items.\nAvailable skills: " +
    JSON.stringify(skillIndex(skills));
  const tools = [
    ...createVideoTools(request, skills),
    ...(input.extraTools ?? []),
  ];
  const messages: ChatMessage[] = [
    { role: "system", content: system },
    {
      role: "user",
      content: request.context.visualWitness
        ? [
            { type: "text", text: prompts.userPrompt },
            {
              type: "image_url",
              image_url: { url: request.context.visualWitness.imageDataUrl },
            },
          ]
        : prompts.userPrompt,
    },
  ];
  let sequence = 0;
  const completed = await runToolLoop({
    model,
    messages,
    tools,
    signal,
    maxSteps: input.maxSteps,
    maxToolCalls: input.maxToolCalls,
    answer: (text) =>
      compileNativeAgentResult(request, {
        outcome: "answer",
        summary: text.slice(0, 4000),
        commands: [],
      }),
    onEvent: async (event) => {
      sequence = event.sequence + 1;
      await input.onEvent?.(event);
    },
  });
  signal.throwIfAborted();
  const result = completed.result;
  await input.onEvent?.({
    sequence,
    type:
      result.outcome === "proposal"
        ? "proposal.ready"
        : result.outcome === "needs_input"
          ? "question.asked"
          : "answer.ready",
    summary: result.summary,
  });
  return result;
}
