import {
  composeToolAgentPrompt,
  restoreCompletionStateFromMessages,
  usesCompletionPreflight,
  usesPagedReaders,
  usesEfficientReaders,
  usesResolvedEditSchema,
  usesStagedEditing,
  usesReviewedEditReferences,
  usesPreviewRepair,
  usesAppendPreviewRepair,
  type PreviewRepairEvidence,
  type EditorStagePorts,
  type AgentProfile,
} from "../../agent-kit/src/index";
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
import {
  prepareCompletionCaptionCuePacket,
  prepareCaptionSourceOverview,
} from "../../core/src/lib/video-project/completion-caption-context";
import { nativeTranscriptScopedSourceItemIds } from "../../core/src/lib/video-project/agent-transcript-search";

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
  profile?: AgentProfile;
  stages?: EditorStagePorts<NativeAgentResult>;
  previewEvidence?: (
    requestId: string,
    signal: AbortSignal,
  ) => Promise<PreviewRepairEvidence>;
  stageContext?: unknown;
}): Promise<NativeAgentResult> {
  const { request, model, skills, signal } = input;
  signal.throwIfAborted();
  await compileNativeAgentResult(request, {
    outcome: "answer",
    summary: "Snapshot validation",
    commands: [],
  });
  const document = parseVideoProjectDocument(request.document);
  const prompts = buildNativeAgentPrompts(
    {
      ...request,
      document,
      instruction: request.instruction ?? "",
      messages: input.messages ?? [],
      responseMode: "tools",
    },
    usesStagedEditing(input.profile ?? "local-editor-v1")
      ? { evidenceMode: "reference-only" }
      : {},
  );
  if (usesCompletionPreflight(input.profile ?? "local-editor-v1")) {
    const sourceIds =
      nativeTranscriptScopedSourceItemIds({ ...request, document }) ??
      undefined;
    const packet = usesResolvedEditSchema(input.profile ?? "local-editor-v1")
      ? prepareCaptionSourceOverview(document, sourceIds, {
          referenceOnly: usesStagedEditing(input.profile ?? "local-editor-v1"),
        })
      : prepareCompletionCaptionCuePacket(document, sourceIds, {
          pagedReaders: usesPagedReaders(input.profile ?? "local-editor-v1"),
        });
    try {
      const initial = JSON.parse(prompts.userPrompt);
      if (initial.contextPlan) delete initial.contextPlan.captionSources;
      prompts.userPrompt = JSON.stringify({
        ...initial,
        completionCaptionSources: packet,
      });
    } catch {
      prompts.userPrompt +=
        "\nCompletion caption sources: " + JSON.stringify(packet);
    }
  }
  if (
    usesStagedEditing(input.profile ?? "local-editor-v1") &&
    input.stageContext !== undefined
  ) {
    prompts.userPrompt = JSON.stringify({
      ...JSON.parse(prompts.userPrompt),
      durableStages: input.stageContext,
    });
  }
  const toolset = createVideoToolset(request, skills, input.extraTools ?? [], {
    profile: input.profile,
    ...(input.stages ? { stages: input.stages } : {}),
    ...(input.previewEvidence
      ? { previewEvidence: input.previewEvidence }
      : {}),
  });
  const tools = toolset.tools;
  const system =
    composeToolAgentPrompt({
      profile: input.profile,
      editingGuide: prompts.systemPrompt,
      toolNames: tools.map((tool) => tool.name),
      skills: toolset.skills,
      phase: input.stages?.phase,
    }) +
    (usesPagedReaders(input.profile ?? "local-editor-v1")
      ? "\n\nFor an explicitly edited montage declared by asset_sequence, an appended ending follows the complete edited non-ending content, including retained unrelated items. Set final composition duration to the ending end. For other ending requests preserve the original full timeline basis."
      : "");
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
  if (port && usesCompletionPreflight(input.profile ?? "local-editor-v1")) {
    const saved = await checkpoint!.load();
    toolset.restoreCompletionState(
      saved === null
        ? undefined
        : await restoreCompletionStateFromMessages(
            parseLoopCheckpoint(saved).messages,
            request.baseHash,
            input.stages
              ? {
                  ...(usesReviewedEditReferences(
                    input.profile ?? "local-editor-v1",
                  )
                    ? { reviewReferences: true as const }
                    : {}),
                  ...(usesPreviewRepair(input.profile ?? "local-editor-v1")
                    ? { previewRepair: true as const }
                    : {}),
                  ...(usesAppendPreviewRepair(
                    input.profile ?? "local-editor-v1",
                  )
                    ? { appendPreviewRepair: true as const }
                    : {}),
                  resolvePreparedEdit: (edit) =>
                    input.stages!.resolvePreparedEdit(edit, signal),
                }
              : {},
          ),
    );
    checkpoint!.load = async () => saved;
  }
  const completed = await runToolLoop({
    model,
    messages,
    tools,
    signal,
    maxSteps:
      input.maxSteps ??
      (usesEfficientReaders(input.profile ?? "local-editor-v1") ? 16 : 8),
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
