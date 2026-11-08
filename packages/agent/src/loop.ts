import { composeToolAgentPrompt } from "../../agent-kit/src/index";
import {
  runToolLoop,
  parseLoopCheckpoint,
  type LoopCheckpointPort,
  type LoopCompactionOptions,
} from "../../agent-loop/src/index";
import {
  buildNativeAgentPrompts,
  compileNativeAgentResult,
  type NativeAgentRequest,
  type NativeAgentResult,
} from "../../core/src/lib/video-project/agent-runtime";
import { parseVideoProjectDocument } from "../../core/src/lib/video-project/document";
import { type Skill } from "./skills";
import { createVideoToolset, type AgentTool } from "./tools";
import type { LanguageModel, ChatMessage, AgentEvent } from "./types";

export type AgentCheckpointContext = {
  inventory: ReturnType<typeof createVideoToolset>["inventory"];
  skills: Skill[];
};

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
  maxOutputTokens?: number;
  checkpoint?:
    | LoopCheckpointPort
    | ((
        context: AgentCheckpointContext,
      ) => LoopCheckpointPort | Promise<LoopCheckpointPort>);
  compaction?: LoopCompactionOptions;
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
    responseMode: "tools",
  });
  const toolset = createVideoToolset(request, skills, input.extraTools ?? []);
  const tools = toolset.tools;
  const system = composeToolAgentPrompt({
    editingGuide: prompts.systemPrompt,
    toolNames: tools.map((tool) => tool.name),
    skills: toolset.skills,
  });
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
  const port =
    typeof input.checkpoint === "function"
      ? await input.checkpoint({
          inventory: toolset.inventory,
          skills: toolset.skills,
        })
      : input.checkpoint;
  const checkpoint: LoopCheckpointPort | undefined = port && {
    ...port,
    load: async () => {
      const saved = await port.load();
      if (saved !== null) sequence = parseLoopCheckpoint(saved).sequence;
      return saved;
    },
    save: async (next, expectedRevision) => {
      await port.save(next, expectedRevision);
      sequence = next.sequence;
    },
  };
  const completed = await runToolLoop({
    model,
    messages,
    tools,
    signal,
    maxSteps: input.maxSteps,
    maxToolCalls: input.maxToolCalls,
    maxOutputTokens: input.maxOutputTokens,
    checkpoint,
    compaction:
      input.compaction ??
      (checkpoint ? { maxCharacters: 320000, keepRecentGroups: 2 } : undefined),
    answerReplaySafe: true,
    answer: (text) =>
      compileNativeAgentResult(request, {
        outcome: "answer",
        summary: text.slice(0, 4000),
        commands: [],
      }),
    onEvent: async (event) => {
      sequence = Math.max(sequence, event.sequence + 1);
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
