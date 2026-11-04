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
  const registry = new Map(tools.map((tool) => [tool.name, tool]));
  if (registry.size !== tools.length)
    throw new Error("Tool names must be unique.");
  const specs = tools.map(
    ({ execute: _execute, effect: _effect, ...spec }) => spec,
  );
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
  let sequence = 0,
    toolCalls = 0,
    observationBytes = 0;
  const ids = new Set<string>();
  const emit = async (
    type: AgentEvent["type"],
    name?: string,
    summary?: string,
  ) => {
    signal.throwIfAborted();
    await input.onEvent?.({
      sequence: sequence++,
      type,
      ...(name ? { name } : {}),
      ...(summary ? { summary } : {}),
    });
  };
  for (let step = 0; step < (input.maxSteps ?? 8); step++) {
    signal.throwIfAborted();
    await emit("model.started");
    const response = await model.complete(messages, specs, signal);
    signal.throwIfAborted();
    messages.push({
      role: "assistant",
      content: response.text || null,
      providerOutput: response.providerOutput,
      ...(response.calls.length
        ? {
            tool_calls: response.calls.map((call) => ({
              id: call.id,
              type: "function" as const,
              function: { name: call.name, arguments: call.arguments },
            })),
          }
        : {}),
    });
    if (!response.calls.length) {
      if (!response.text.trim())
        throw new Error("The model returned no answer or tool calls.");
      await emit("answer.ready", undefined, response.text.slice(0, 500));
      return compileNativeAgentResult(request, {
        outcome: "answer",
        summary: response.text.slice(0, 4000),
        commands: [],
      });
    }
    for (const call of response.calls) {
      signal.throwIfAborted();
      if (++toolCalls > (input.maxToolCalls ?? 24))
        throw new Error("Tool-call budget reached. Narrow the request.");
      if (ids.has(call.id))
        throw new Error("The model reused a tool-call identity.");
      ids.add(call.id);
      await emit("tool.started", call.name);
      let observation: unknown;
      let terminal: NativeAgentResult | undefined;
      try {
        const tool = registry.get(call.name);
        if (!tool)
          throw new Error("Unknown tool. Choose from the advertised registry.");
        const outcome = await tool.execute(JSON.parse(call.arguments), signal);
        signal.throwIfAborted();
        if (outcome.kind === "terminal") terminal = outcome.result;
        else {
          observation = outcome.value;
          if (JSON.stringify(observation).length > 120_000)
            throw new Error(
              "Result exceeds context budget. Inspect fewer items.",
            );
        }
      } catch (cause) {
        signal.throwIfAborted();
        observation = {
          error: cause instanceof Error ? cause.message : "Tool failed",
          hint: "Correct the input or ask a focused question.",
        };
      }
      // Host persistence failures must stop the run, not become prompts for another paid call.
      if (terminal) {
        await emit("tool.completed", call.name, "Validated");
        await emit(
          terminal.outcome === "proposal"
            ? "proposal.ready"
            : terminal.outcome === "needs_input"
              ? "question.asked"
              : "answer.ready",
          undefined,
          terminal.summary,
        );
        return terminal;
      }
      const content = JSON.stringify(observation);
      observationBytes += content.length;
      if (observationBytes > 240_000)
        throw new Error("Observation budget reached. Narrow the request.");
      messages.push({ role: "tool", tool_call_id: call.id, content });
      await emit("tool.completed", call.name);
    }
  }
  throw new Error("Model-step budget reached. Narrow the request.");
}
