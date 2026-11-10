import {
  runEditingStages,
  assertEditStageBinding,
  completionHash,
  STAGED_EDIT_POLICY,
  type EditorStagePorts,
  type EditStagePlan,
  type CompletionRequirement,
  type StageModelInvocation,
} from "../../../packages/agent-kit/src/index";
import { runEditingStages as runRetainedEditingStages } from "@dojo-video/agent-kit-v20";
import { runEditingStages as runRetainedAuthoringEditingStages } from "@dojo-video/agent-kit-v21";
import { runEditingStages as runRetainedReviewedEditingStages } from "@dojo-video/agent-kit-v22";
import {
  parseLoopCheckpoint,
  type LoopCheckpointPort,
} from "../../../packages/agent-loop/src/index";
import {
  compileNativeAgentResult,
  type NativeAgentRequest,
  type NativeAgentResult,
} from "../../../packages/core/src/lib/video-project/agent-runtime";
import { parseVideoProjectDocument } from "../../../packages/core/src/lib/video-project/document";
import {
  compileNativeCompletionResponse,
  validateNativeCompletionRequirements,
} from "../../../packages/core/src/lib/video-project/completion-preflight";
import { captionPairSettingsSchema } from "../../../packages/core/src/lib/video-project/caption-pair";
import {
  assembleCaptionTranslationBatches,
  captionBatchManifestSchema,
  captionBatchModelContext,
  createCaptionBatchManifest,
  prepareCaptionTranslationBatch,
} from "../../../packages/core/src/lib/video-project/caption-batches";
import { readNativeCaptionCues } from "../../../packages/core/src/lib/video-project/agent-readers";
import { nativeTranscriptScopedSourceItemIds } from "../../../packages/core/src/lib/video-project/agent-transcript-search";
import {
  createLocalEditStagePort,
  createLocalStageCheckpointPort,
  localEditStageBinding,
} from "./edit-stage-store";
import { runOf, type ProjectStore } from "./store";

export const LOCAL_STAGED_EDIT_POLICY = STAGED_EDIT_POLICY;
export type EditingStageInvocation = Omit<
  StageModelInvocation<NativeAgentResult>,
  "checkpointRef"
> & { checkpoint?: LoopCheckpointPort };
/** Local adapter for the portable coordinator. No provider call or document commit
 * occurs here; those remain the supplied model loop and guarded AgentService. */
export async function runStagedEditing(input: {
  store: ProjectStore;
  projectId: string;
  runId: string;
  request: NativeAgentRequest;
  modelIdentity: string;
  invoke(options: EditingStageInvocation): Promise<NativeAgentResult>;
  signal: AbortSignal;
  onTransition?: (plan: EditStagePlan) => Promise<void>;
  policy?: { captionBatchSize?: number };
}): Promise<NativeAgentResult> {
  const project = await input.store.read(input.projectId),
    run = runOf(project, input.runId),
    previous = project.editStagePlans?.[input.runId];
  const binding =
    previous?.plan.binding ??
    (await localEditStageBinding(project, run, input.modelIdentity));
  if (previous)
    await assertEditStageBinding(
      previous.plan,
      await localEditStageBinding(project, run, input.modelIdentity),
    );
  const document = parseVideoProjectDocument(input.request.document);
  if (!previous && Date.now() >= Date.parse(run.createdAt) + 24 * 3600 * 1000)
    throw new Error(
      "The original editing allowance expired before model submission.",
    );
  const preludes = (run.preludeCheckpoints ?? []).map((saved) =>
    parseLoopCheckpoint(saved.checkpoint),
  );
  if (
    preludes.some(
      (checkpoint) =>
        !checkpoint.usageKnown ||
        checkpoint.outputBudgetOverrun ||
        checkpoint.snapshot.modelIdentity !== input.modelIdentity,
    )
  )
    throw new Error(
      "The original question/provider usage requires reconciliation.",
    );
  const carried = preludes.reduce(
    (total, checkpoint) => ({
      modelCalls: total.modelCalls + checkpoint.modelCalls,
      toolCalls: total.toolCalls + checkpoint.toolCalls,
      inputTokens: total.inputTokens + checkpoint.usage.inputTokens,
      outputTokens: total.outputTokens + checkpoint.usage.outputTokens,
    }),
    { modelCalls: 0, toolCalls: 0, inputTokens: 0, outputTokens: 0 },
  );
  const port = createLocalEditStagePort({ ...input, binding });
  const coordinate =
    run.agentProfile === "local-editor-v9"
      ? runEditingStages
      : run.agentProfile === "local-editor-v8"
        ? runRetainedReviewedEditingStages
        : run.agentProfile === "local-editor-v7"
          ? runRetainedAuthoringEditingStages
          : runRetainedEditingStages;
  return coordinate({
    port,
    binding,
    modelIdentity: input.modelIdentity,
    snapshotHash: input.request.baseHash,
    run: { instruction: run.instruction, createdAt: run.createdAt },
    history: project.messages,
    signal: input.signal,
    ...(input.onTransition ? { onTransition: input.onTransition } : {}),
    policy: {
      ...STAGED_EDIT_POLICY,
      ...(input.policy?.captionBatchSize === undefined
        ? {}
        : { captionBatchSize: input.policy.captionBatchSize }),
    },
    records: {
      read: async () =>
        (await input.store.read(input.projectId)).editStagePlans?.[
          input.runId
        ] ?? null,
      accountPlanning: async (stageId, attemptId) => {
        const p = await input.store.read(input.projectId),
          raw = runOf(p, input.runId).loopCheckpoint?.checkpoint;
        if (!raw)
          throw new Error("The initial paid planning checkpoint is missing.");
        const checkpoint = parseLoopCheckpoint(raw),
          plan = (await port.load())!;
        await port.transition(
          {
            type: "record_usage",
            operationId: `planning-usage:${checkpoint.revision}`,
            stageId,
            attemptId,
            usage: {
              inputTokens: checkpoint.usage.inputTokens + carried.inputTokens,
              outputTokens:
                checkpoint.usage.outputTokens + carried.outputTokens,
              modelCalls: checkpoint.modelCalls + carried.modelCalls,
              toolCalls: checkpoint.toolCalls + carried.toolCalls,
              usageKnown: checkpoint.usageKnown,
            },
          },
          plan.revision,
        );
        await input.store.transaction(input.projectId, (p) => {
          const checkpoints = p.editStagePlans![input.runId].checkpoints;
          checkpoints.planning = raw;
          for (const [index, prelude] of (
            run.preludeCheckpoints ?? []
          ).entries())
            checkpoints[`prelude:${index}`] = prelude.checkpoint;
        });
      },
      saveReview: async (stageId, ref) => {
        await port.readArtifact(ref);
        await input.store.transaction(input.projectId, (p) => {
          const state = p.editStagePlans![input.runId];
          state.lastReviews ??= {};
          state.lastReviews[stageId] = ref;
        });
      },
      saveCandidate: async (ref) => {
        await port.readArtifact(ref);
        await input.store.transaction(input.projectId, (p) => {
          p.editStagePlans![input.runId].savedCandidateRef = ref;
        });
      },
      readQuestion: async (attemptId) => {
        const state = (await input.store.read(input.projectId)).editStagePlans![
            input.runId
          ],
          raw = state.checkpoints[attemptId];
        if (!raw) return undefined;
        const cp = parseLoopCheckpoint(raw),
          result = cp.result as NativeAgentResult;
        return cp.phase === "completed" && result.outcome === "needs_input"
          ? result
          : undefined;
      },
      checkpoint: async (attemptId) => {
        const state = (await input.store.read(input.projectId)).editStagePlans![
            input.runId
          ],
          raw = state.checkpoints[attemptId];
        if (!raw) return undefined;
        const checkpoint = parseLoopCheckpoint(raw),
          names = new Map(
            checkpoint.messages.flatMap((message) =>
              (message.tool_calls ?? []).map(
                (call) => [call.id, call.function.name] as const,
              ),
            ),
          );
        return {
          hash: await completionHash(checkpoint),
          phase: checkpoint.phase,
          modelCallLimit: checkpoint.snapshot.budgets.maxSteps,
          pendingTools: !!checkpoint.pendingTurn,
          providerOverrun: !!checkpoint.outputBudgetOverrun,
          hostWait: !!checkpoint.hostWait,
          usage: {
            ...checkpoint.usage,
            modelCalls: checkpoint.modelCalls,
            toolCalls: checkpoint.toolCalls,
            usageKnown: checkpoint.usageKnown,
          },
          resultOutcome: (checkpoint.result as { outcome?: string } | undefined)
            ?.outcome,
          resultQuestionId: (
            checkpoint.result as { clarification?: { id?: string } } | undefined
          )?.clarification?.id,
          observations: checkpoint.messages
            .filter((message) => message.role === "tool")
            .map((message) => ({
              tool: names.get(message.tool_call_id!) ?? "",
              value: JSON.parse(String(message.content)),
            })),
        };
      },
    },
    ...(["local-editor-v7", "local-editor-v8", "local-editor-v9"].includes(
      run.agentProfile ?? "",
    )
      ? { generalEditing: true as const }
      : {}),
    ...(["local-editor-v8", "local-editor-v9"].includes(run.agentProfile ?? "")
      ? { reviewReferences: true as const }
      : {}),
    ...(run.agentProfile === "local-editor-v9"
      ? { phaseScopedTools: true as const }
      : {}),
    native: {
      ...(["local-editor-v8", "local-editor-v9"].includes(
        run.agentProfile ?? "",
      )
        ? {
            validateRequirements: (requirements: CompletionRequirement[]) => {
              validateNativeCompletionRequirements(requirements);
            },
          }
        : {}),
      readableSourceItemIds: nativeTranscriptScopedSourceItemIds({
        ...input.request,
        document,
      }),
      parsePair: (raw) => captionPairSettingsSchema.parse(raw),
      parseManifest: (raw) => captionBatchManifestSchema.parse(raw),
      createManifest: (pair, batchSize) =>
        createCaptionBatchManifest(document, pair, batchSize),
      prepareBatch: (manifest, batchId, translations) =>
        prepareCaptionTranslationBatch(
          document,
          manifest,
          batchId,
          translations,
        ),
      assembleBatches: (manifest, batches) =>
        assembleCaptionTranslationBatches(document, manifest, batches),
      batchContext: (manifest, batchId) => ({
        ...captionBatchModelContext(manifest, batchId),
        readerScope: "active-batch",
      }),
      readCues: (query, options) =>
        readNativeCaptionCues(input.request, query, options),
      compileAnswer: (summary) =>
        compileNativeAgentResult(input.request, {
          outcome: "answer",
          summary,
          commands: [],
        }),
      compileFinal: (edit, completion) =>
        compileNativeCompletionResponse(input.request, {
          ...(edit as object),
          completion,
        }),
    },
    invoke: (options) => {
      const { checkpointRef, ...other } = options;
      other.eventOffset += preludes.length * 1000;
      if (!checkpointRef && !previous) {
        other.maxSteps = Math.min(
          other.maxSteps,
          STAGED_EDIT_POLICY.modelCalls - carried.modelCalls,
        );
        other.maxToolCalls = Math.min(
          other.maxToolCalls,
          STAGED_EDIT_POLICY.toolCalls - carried.toolCalls,
        );
        other.maxOutputTokens = Math.min(
          other.maxOutputTokens,
          STAGED_EDIT_POLICY.outputTokens - carried.outputTokens,
        );
        if (
          other.maxSteps < 1 ||
          other.maxToolCalls < 1 ||
          other.maxOutputTokens < 1
        )
          throw new Error(
            "The original overall question/edit budget is exhausted.",
          );
      }
      const checkpoint = checkpointRef
        ? createLocalStageCheckpointPort({
            ...input,
            binding,
            ...checkpointRef,
          })
        : undefined;
      return input.invoke({ ...other, ...(checkpoint ? { checkpoint } : {}) });
    },
  });
}
