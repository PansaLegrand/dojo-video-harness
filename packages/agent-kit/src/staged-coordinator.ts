import {
  completionCanonical,
  completionHash,
  parseCompletionRequirements,
  type CompletionContract,
} from "./completion.js";
import {
  createEditStagePlan,
  EditStageError,
  type EditArtifactRef,
  type EditStage,
  type EditStageBinding,
  type EditStagePlan,
  type EditStagePort,
  type EditStageUsage,
} from "./stages.js";
import {
  editStageContext,
  readEditArtifactPage,
  type EditArtifactField,
} from "./artifacts.js";
import type { EditorStagePorts } from "./staged-tools.js";
import type { CaptionCueQuery } from "./tools.js";
export type StagedEditPolicy = {
  planningModelCalls: number;
  modelCalls: number;
  toolCalls: number;
  outputTokens: number;
  attempts: number;
  stageModelCalls: number;
  stageToolCalls: number;
  stageOutputTokens: number;
  captionBatchSize: number;
};
export const STAGED_EDIT_POLICY: Readonly<StagedEditPolicy> = Object.freeze({
  planningModelCalls: 16,
  modelCalls: 32,
  toolCalls: 64,
  outputTokens: 32000,
  attempts: 64,
  stageModelCalls: 8,
  stageToolCalls: 24,
  stageOutputTokens: 16000,
  captionBatchSize: 100,
});
export type StageCaptionPair = {
  sourceItemId: string;
  evidenceId: string;
  originalItemId: string;
  translatedItemId: string;
  trackId: string;
  originalLanguage: string;
  translatedLanguage: string;
  originalColor: string;
  translatedColor: string;
  sourceRange?: { startMs: number; endMs: number };
};
export type StageCaptionManifest = {
  version: 1;
  grouping: "phrase-safe-v1";
  snapshotHash: string;
  sourceHash: string;
  manifestHash: string;
  settings: StageCaptionPair;
  totalCues: number;
  batchSize: number;
  batches: Array<{
    id: string;
    offset: number;
    count: number;
    cuesHash: string;
  }>;
};
export type StageNativeResult = {
  outcome: string;
  summary: string;
  completion?: CompletionContract;
  proposal?: { commands: unknown[] } | null;
};
export type StageNativePorts<T extends StageNativeResult> = {
  readableSourceItemIds: string[] | null;
  parsePair(raw: unknown): StageCaptionPair;
  parseManifest(raw: unknown): StageCaptionManifest;
  createManifest(
    pair: StageCaptionPair,
    batchSize: number,
  ): Promise<StageCaptionManifest>;
  prepareBatch(
    manifest: StageCaptionManifest,
    batchId: string,
    raw: unknown,
  ): Promise<{ count: number }>;
  assembleBatches(
    manifest: StageCaptionManifest,
    batches: unknown[],
  ): Promise<{ commands: unknown[] }>;
  batchContext(manifest: StageCaptionManifest, batchId: string): unknown;
  readCues(
    query: CaptionCueQuery,
    options?: { cueRange: { offset: number; count: number } },
  ): Promise<unknown>;
  compileAnswer(summary: string): Promise<T>;
  compileFinal(edit: unknown, completion: CompletionContract): Promise<T>;
};
export type StageCoordinatorState = {
  plan: EditStagePlan;
  artifacts: Record<string, { ref: EditArtifactRef }>;
  savedCandidateRef?: EditArtifactRef;
  lastReviews?: Record<string, EditArtifactRef>;
  pendingReplies?: Record<string, { attemptId: string; ref: EditArtifactRef }>;
};
export type StageCoordinatorRecords<
  T extends StageNativeResult = StageNativeResult,
> = {
  read(): Promise<StageCoordinatorState | null>;
  accountPlanning(stageId: string, attemptId: string): Promise<void>;
  saveReview(stageId: string, ref: EditArtifactRef): Promise<void>;
  saveCandidate(ref: EditArtifactRef): Promise<void>;
  checkpoint(attemptId: string): Promise<StageCheckpointFacts | undefined>;
  readQuestion?(attemptId: string): Promise<T | undefined>;
};
export type StageCheckpointFacts = {
  hash: string;
  phase: string;
  modelCallLimit: number;
  pendingTools: boolean;
  providerOverrun: boolean;
  hostWait: boolean;
  usage: EditStageUsage;
  resultOutcome?: string;
  resultQuestionId?: string;
  observations: Array<{ tool: string; value: unknown }>;
};
export type StageModelInvocation<T extends StageNativeResult> = {
  stages: EditorStagePorts<T>;
  stageContext?: unknown;
  checkpointRef?: { stageId: string; attemptId: string };
  maxSteps: number;
  maxToolCalls: number;
  maxOutputTokens: number;
  eventOffset: number;
};
type FrozenInput = {
  version: 1;
  stageId: string;
  context: Record<string, unknown>;
  limits: { maxSteps: number; maxToolCalls: number; maxOutputTokens: number };
  preparedRef?: EditArtifactRef;
};
type Candidate = {
  kind: "final-candidate";
  edit: unknown;
  completion: CompletionContract;
};
type ReviewRecord = {
  edit: unknown;
  checks: unknown[];
  receipt?: CompletionContract["receipt"];
};
/** Portable editing workflow. Hosts own persistence, sources, native replay and provider invocation. */
export async function runEditingStages<T extends StageNativeResult>(input: {
  port: EditStagePort;
  records: StageCoordinatorRecords<T>;
  binding: EditStageBinding;
  modelIdentity: string;
  snapshotHash: string;
  run: { instruction: string; createdAt: string };
  history: Array<{
    id: string;
    runId: string | null;
    role: string;
    text: string;
  }>;
  native: StageNativePorts<T>;
  policy?: StagedEditPolicy;
  invoke(options: StageModelInvocation<T>): Promise<T>;
  signal: AbortSignal;
  onTransition?: (plan: EditStagePlan) => Promise<void>;
}): Promise<T> {
  const policy = input.policy ?? STAGED_EDIT_POLICY;
  const { port, binding, run } = input;
  const previous = await input.records.read();
  if (binding.modelIdentity !== input.modelIdentity)
    throw new EditStageError(
      "STAGE_CONFLICT",
      "The staged provider/model identity changed.",
    );
  const saved = async () => {
    const state = await input.records.read();
    if (!state) throw new Error("The owned editing stage state is missing.");
    return state;
  };
  const answer = (summary: string) => input.native.compileAnswer(summary);
  const notify = async () => {
    const plan = await port.load();
    if (plan) await input.onTransition?.(plan);
  };
  const artifact = async (ref: EditArtifactRef) => port.readArtifact(ref);
  async function continueStageAttempt(
    stageId: string,
    attemptId: string,
    replyRef?: EditArtifactRef,
  ) {
    const state = await saved(),
      plan = state.plan,
      stage = plan.stages.find((stage) => stage.id === stageId)!,
      attempt = plan.attempts.find((attempt) => attempt.id === attemptId)!;
    const facts = await input.records.checkpoint(attemptId);
    if (!facts) return false;
    const boundary = replyRef
      ? facts.phase === "completed" &&
        ["answer", "needs_input"].includes(facts.resultOutcome ?? "")
      : facts.phase === "tool-observations" &&
        facts.usage.modelCalls >= facts.modelCallLimit;
    if (
      !boundary ||
      facts.pendingTools ||
      facts.providerOverrun ||
      facts.hostWait ||
      !facts.usage.usageKnown ||
      !plan.usage.usageKnown ||
      Date.now() >= Date.parse(plan.limits.expiresAt) ||
      plan.usage.modelCalls >= plan.limits.modelCalls ||
      plan.usage.toolCalls >= plan.limits.toolCalls ||
      plan.usage.outputTokens >= plan.limits.outputTokens
    )
      return false;
    if (
      completionCanonical(facts.usage) !== completionCanonical(attempt.usage) ||
      !attempt.inputRef
    )
      throw new EditStageError(
        "STAGE_CONFLICT",
        "The continuation usage/context proof differs from its saved attempt.",
      );
    const old = (await artifact(attempt.inputRef)) as FrozenInput;
    const failure =
      replyRef ??
      (await port.putArtifact("failure", {
        code: "STAGE_STEP_LIMIT",
        stageId,
        attemptId,
        summary:
          "The invocation finished all tools at its step limit. The original overall allowance still applies.",
        usage: facts.usage,
      }));
    const refs = [
      ...Object.values(state.artifacts)
        .filter((row) =>
          ["creative-decision", "failure"].includes(row.ref.kind),
        )
        .map((row) => row.ref),
      failure,
    ];
    const context = {
      ...old.context,
      ...editStageContext(plan, stageId, refs),
      activeStage: old.context.activeStage,
      preparedCommands: !!old.preparedRef,
    } as Record<string, unknown>;
    if (replyRef) {
      const reply = (await artifact(replyRef)) as {
        kind?: string;
        questionId?: string;
      };
      if (
        reply.kind !== "user-reply" ||
        (facts.resultOutcome === "needs_input" &&
          reply.questionId !== facts.resultQuestionId)
      )
        throw new EditStageError(
          "STAGE_CONFLICT",
          "The explicit reply does not match this saved question.",
        );
      context.explicitUserReply = reply;
    }
    if (stage.kind === "caption_batch") {
      const manifest = manifestFor(plan, stage),
        descriptor = manifest.batches.find(
          (batch) => batch.id === stage.descriptor!.batchId,
        )!;
      const prior = (old.context.retrievedCues ?? []) as Array<{
        cueId: string;
      }>;
      const pages = facts.observations
        .filter((row) => row.tool === "read_caption_cues")
        .map(
          (row) =>
            row.value as {
              kind?: string;
              snapshotHash?: string;
              source?: {
                sourceItemId?: string;
                evidenceId?: string;
                cueRange?: { offset: number; count: number };
              };
              cues?: Array<{ cueId: string }>;
              coverage?: { nextCursor?: string | null };
            },
        )
        .filter(
          (page) =>
            page.kind === "caption-cues" &&
            page.snapshotHash === input.snapshotHash &&
            page.source?.sourceItemId === manifest.settings.sourceItemId &&
            page.source.evidenceId === manifest.settings.evidenceId &&
            page.source.cueRange?.offset === descriptor.offset &&
            page.source.cueRange.count === descriptor.count,
        );
      const cues = new Map(prior.map((cue) => [cue.cueId, cue]));
      for (const cue of pages.flatMap((page) => page.cues ?? [])) {
        const previous = cues.get(cue.cueId);
        if (
          previous &&
          completionCanonical(previous) !== completionCanonical(cue)
        )
          throw new EditStageError(
            "STAGE_CONFLICT",
            "A retrieved cue changed across invocation boundaries.",
          );
        cues.set(cue.cueId, cue);
      }
      context.retrievedCues = [...cues.values()];
      context.captionBatch = {
        ...(old.context.captionBatch as object),
        ...(pages.at(-1)?.coverage?.nextCursor
          ? { initialCursor: pages.at(-1)!.coverage!.nextCursor }
          : {}),
      };
    }
    const frozen: FrozenInput = {
      ...old,
      context,
      limits: {
        maxSteps: Math.min(
          plan.limits.perStage?.modelCalls ?? policy.stageModelCalls,
          plan.limits.modelCalls - plan.usage.modelCalls,
        ),
        maxToolCalls: Math.min(
          plan.limits.perStage?.toolCalls ?? policy.stageToolCalls,
          plan.limits.toolCalls - plan.usage.toolCalls,
        ),
        maxOutputTokens: Math.min(
          plan.limits.perStage?.outputTokens ?? policy.stageOutputTokens,
          plan.limits.outputTokens - plan.usage.outputTokens,
        ),
      },
    };
    const inputRef = await port.putArtifact("evidence", frozen),
      nextId = `stage:${stageId}:part:${plan.attempts.filter((attempt) => attempt.stageId === stageId).length + 1}`;
    await port.transition(
      {
        type: "continue",
        operationId: `continue:${attemptId}`,
        stageId,
        previousAttemptId: attemptId,
        attemptId: nextId,
        checkpointId: `${input.binding.runId}:${nextId}`,
        inputRef,
        reason: replyRef ? "user_reply" : "stage_budget",
        ...(replyRef ? { replyRef } : {}),
        priorCheckpointHash: facts.hash,
        priorUsageHash: await completionHash(attempt.usage),
      },
      plan.revision,
    );
    await notify();
    return true;
  }
  const manifestFor = (
    plan: EditStagePlan,
    stage: EditStage,
  ): StageCaptionManifest => {
    const owner =
      stage.kind === "evidence"
        ? stage
        : plan.stages.find(
            (value) =>
              value.kind === "evidence" &&
              value.descriptor?.manifest &&
              (value.descriptor.manifest as StageCaptionManifest)
                .manifestHash === stage.descriptor?.manifestHash,
          );
    return input.native.parseManifest(owner?.descriptor?.manifest);
  };
  const complete = async (stage: EditStage, outputs: EditArtifactRef[]) => {
    const plan = (await port.load())!;
    await port.transition(
      {
        type: "complete",
        operationId: `complete:${stage.id}`,
        stageId: stage.id,
        attemptId: stage.attemptId!,
        outputs,
      },
      plan.revision,
    );
  };
  const candidate = async (): Promise<T | undefined> => {
    const state = await saved();
    if (!state.savedCandidateRef) return undefined;
    const value = (await artifact(state.savedCandidateRef)) as Candidate;
    if (
      value.kind !== "final-candidate" ||
      value.completion.receipt.requirementsHash !== state.plan.requirementsHash
    )
      throw new EditStageError(
        "STAGE_CONFLICT",
        "The saved final candidate no longer matches its stage outcomes.",
      );
    const result = await input.native.compileFinal(
      value.edit,
      value.completion,
    );
    const assembling = state.plan.stages.find(
      (stage) => stage.kind === "assemble",
    )!;
    if (assembling.status !== "completed") {
      const ref = await port.putArtifact("commands", {
        summary: result.summary,
        commands: result.proposal!.commands,
      });
      await complete(assembling, [ref]);
    }
    let plan = (await port.load())!,
      verification = plan.stages.find((stage) => stage.kind === "verify")!;
    if (verification.status !== "completed") {
      if (verification.status === "pending") {
        const attemptId = "stage:verify";
        await port.transition(
          {
            type: "claim",
            operationId: "claim:verify",
            stageId: verification.id,
            attemptId,
            checkpointId: `${input.binding.runId}:${attemptId}`,
          },
          plan.revision,
        );
        plan = (await port.load())!;
        verification = plan.stages.find(
          (stage) => stage.id === verification.id,
        )!;
      }
      await complete(verification, [state.savedCandidateRef]);
    }
    return result;
  };
  async function ensureEvidence(stage: EditStage) {
    let plan = (await port.load())!;
    if (stage.status === "pending") {
      const first = plan.stages[0].id === stage.id,
        attemptId = first ? "planning" : `stage:${stage.id}`;
      await port.transition(
        {
          type: "claim",
          operationId: `claim:${stage.id}`,
          stageId: stage.id,
          attemptId,
          checkpointId: first
            ? input.binding.runId
            : `${input.binding.runId}:${attemptId}`,
        },
        plan.revision,
      );
      plan = (await port.load())!;
      stage = plan.stages.find((value) => value.id === stage.id)!;
    }
    if (stage.id === plan.stages[0].id)
      await input.records.accountPlanning(stage.id, stage.attemptId!);
    const manifest = manifestFor(plan, stage),
      ref = await port.putArtifact("evidence", {
        kind: "caption-manifest",
        manifest,
      });
    await complete(stage, [ref]);
  }
  async function initialize(raw: unknown) {
    const value = raw as { requirements?: unknown; captionPairs?: unknown };
    const requirements = parseCompletionRequirements(value.requirements, {
      assetSequence: true,
      speechCallout: true,
    });
    if (
      !Array.isArray(value.captionPairs) ||
      !value.captionPairs.length ||
      value.captionPairs.length > 12
    )
      throw new Error("Plan 1–12 exact caption pairs.");
    const scope = input.native.readableSourceItemIds,
      manifests: StageCaptionManifest[] = [];
    for (const rawPair of value.captionPairs) {
      const pair = input.native.parsePair(rawPair);
      if (scope !== null && !scope.includes(pair.sourceItemId))
        throw new Error(
          "This speech source is outside the current authorized read scope.",
        );
      if (
        !requirements.some(
          (requirement) =>
            requirement.kind === "caption_pair" &&
            requirement.sourceItemId === pair.sourceItemId &&
            requirement.evidenceId === pair.evidenceId &&
            requirement.originalItemId === pair.originalItemId &&
            requirement.translatedItemId === pair.translatedItemId &&
            requirement.originalLanguage === pair.originalLanguage &&
            requirement.translatedLanguage === pair.translatedLanguage &&
            requirement.originalColor.toLowerCase() ===
              pair.originalColor.toLowerCase() &&
            requirement.translatedColor.toLowerCase() ===
              pair.translatedColor.toLowerCase(),
        )
      )
        throw new Error(
          "Every planned pair must match its frozen declared outcome.",
        );
      manifests.push(
        await input.native.createManifest(pair, policy.captionBatchSize),
      );
    }
    if (
      requirements.filter((requirement) => requirement.kind === "caption_pair")
        .length !== manifests.length
    )
      throw new Error(
        "Declare and plan every requested caption pair exactly once.",
      );
    const ids = manifests.flatMap((manifest) => [
      manifest.settings.originalItemId,
      manifest.settings.translatedItemId,
    ]);
    if (new Set(ids).size !== ids.length)
      throw new Error("Caption pairs need distinct stable item identities.");
    const stages: Parameters<typeof createEditStagePlan>[0]["stages"] = [];
    for (const [index, manifest] of manifests.entries()) {
      const evidenceId = `evidence:${index}`;
      stages.push({
        id: evidenceId,
        kind: "evidence",
        execution: "host",
        sourceItemId: manifest.settings.sourceItemId,
        dependencies: stages.length ? [stages.at(-1)!.id] : [],
        inputs: [],
        descriptor: { manifest },
      });
      for (const [batchIndex, batch] of manifest.batches.entries())
        stages.push({
          id: `caption:${index}:${batchIndex}`,
          kind: "caption_batch",
          execution: "model",
          sourceItemId: manifest.settings.sourceItemId,
          dependencies: [stages.at(-1)!.id],
          inputs: [],
          descriptor: {
            manifestHash: manifest.manifestHash,
            batchId: batch.id,
          },
        });
    }
    stages.push(
      {
        id: "assemble",
        kind: "assemble",
        execution: "model",
        dependencies: [stages.at(-1)!.id],
        inputs: [],
      },
      {
        id: "verify",
        kind: "verify",
        execution: "host",
        dependencies: ["assemble"],
        inputs: [],
      },
    );
    const limits = {
      modelCalls: policy.modelCalls,
      toolCalls: policy.toolCalls,
      outputTokens: policy.outputTokens,
      attempts: policy.attempts,
      expiresAt: new Date(
        Date.parse(run.createdAt) + 24 * 3600 * 1000,
      ).toISOString(),
      perStage: {
        modelCalls: policy.stageModelCalls,
        toolCalls: policy.stageToolCalls,
        outputTokens: policy.stageOutputTokens,
      },
    };
    const plan = await createEditStagePlan({
      id: `edit:${input.binding.runId}`,
      binding,
      instruction: run.instruction,
      requirements,
      limits,
      stages,
    });
    await port.initialize(plan);
    const history = input.history.filter((message) => message.role === "user");
    await port.putArtifact("creative-decision", {
      kind: "conversation-decisions",
      decisions: history
        .slice(-128)
        .map(({ id, runId, text }) => ({ id, runId, role: "user", text })),
      coverage: {
        complete: history.length <= 128,
        omitted: Math.max(0, history.length - 128),
      },
    });
    await ensureEvidence(plan.stages[0]);
    return answer(
      "The exact caption plan is saved. Continuing its bounded batches under the original overall allowance.",
    );
  }
  function stages(
    stage?: EditStage,
    frozen?: FrozenInput,
  ): EditorStagePorts<T> {
    const getPlan = async () => (await port.load())!;
    return {
      preparedCommands: !!frozen?.preparedRef,
      ...(stage
        ? {
            completionState: {
              version: 1 as const,
              snapshotHash: input.snapshotHash,
              requirements: previous?.plan.requirements ?? [],
              requirementsHash: previous?.plan.requirementsHash ?? "",
            },
          }
        : {}),
      planEditStages: async (raw) => {
        if (stage || (await port.load()))
          throw new Error(
            "The existing stage plan and outcomes are immutable.",
          );
        return initialize(raw);
      },
      saveCaptionBatch: async (raw) => {
        input.signal.throwIfAborted();
        if (!stage || stage.kind !== "caption_batch")
          throw new Error("Save only the active caption batch.");
        const plan = await getPlan(),
          manifest = manifestFor(plan, stage),
          batch = await input.native.prepareBatch(
            manifest,
            String(stage.descriptor!.batchId),
            (raw as { translations?: unknown }).translations,
          );
        const ref = await port.putArtifact("caption-batch", batch);
        await complete(stage, [ref]);
        return answer(
          `Saved ${batch.count} exact translations. The host continues remaining stages; the overall edit is not yet complete.`,
        );
      },
      readEditArtifact: async (args) => {
        const state = await saved(),
          record = state.artifacts[args.artifactId];
        if (!record) throw new Error("This owned artifact is missing.");
        return readEditArtifactPage(port, {
          ref: record.ref,
          field: args.field as EditArtifactField | undefined,
          cursor: args.cursor,
        });
      },
      readCaptionCues: async (args) => {
        if (!stage || stage.kind !== "caption_batch")
          return input.native.readCues(args);
        const manifest = manifestFor(await getPlan(), stage),
          batch = manifest.batches.find(
            (batch) => batch.id === stage.descriptor!.batchId,
          )!;
        if (
          args.sourceItemId !== manifest.settings.sourceItemId ||
          args.evidenceId !== manifest.settings.evidenceId ||
          completionCanonical(args.sourceRange ?? null) !==
            completionCanonical(manifest.settings.sourceRange ?? null)
        )
          throw new Error(
            "Read only the active batch's exact source, evidence and requested sourceRange.",
          );
        return input.native.readCues(args, {
          cueRange: { offset: batch.offset, count: batch.count },
        });
      },
      resolvePreparedEdit: async (raw) => {
        if (!stage) return raw;
        if (stage.kind !== "assemble")
          throw new Error(
            "Finish the active caption batch before final editing review.",
          );
        const edit = raw as { commands?: unknown },
          source = frozen?.preparedRef
            ? ((await artifact(frozen.preparedRef)) as { commands: unknown[] })
            : undefined;
        if (!edit || typeof edit !== "object" || !Array.isArray(edit.commands))
          throw new Error("Editing requires an explicit command array.");
        return {
          ...edit,
          commands: [...(source?.commands ?? []), ...edit.commands],
        };
      },
      recordReview: async (review) => {
        if (!stage || stage.kind !== "assemble") return;
        const ref = await port.putArtifact(
          review.receipt ? "verification" : "failure",
          { kind: "editing-review", ...review },
        );
        await input.records.saveReview(stage.id, ref);
      },
      completeEditing: async (result) => {
        if (!stage) return result;
        if (
          stage.kind !== "assemble" ||
          result.outcome !== "proposal" ||
          !result.completion
        )
          throw new Error(
            "The final stage requires a completely reviewed native proposal.",
          );
        const state = await saved(),
          ref = state.lastReviews?.[stage.id];
        if (!ref)
          throw new Error("The saved successful editing review is missing.");
        const review = (await artifact(ref)) as ReviewRecord;
        if (
          review.receipt?.commandsHash !==
          result.completion.receipt.commandsHash
        )
          throw new Error(
            "The final proposal differs from the saved successful review.",
          );
        const finalRef = await port.putArtifact("verification", {
          kind: "final-candidate",
          edit: review.edit,
          completion: result.completion,
        } satisfies Candidate);
        await input.records.saveCandidate(finalRef);
        return answer(
          "All staged outputs are verified. The owned final candidate is saved for guarded application.",
        );
      },
    };
  }
  if (!previous) {
    const result = await input.invoke({
      stages: stages(),
      maxSteps: Math.min(policy.planningModelCalls, policy.modelCalls),
      maxToolCalls: policy.stageToolCalls,
      maxOutputTokens: policy.stageOutputTokens,
      eventOffset: 0,
    });
    if (!(await port.load()) || result.outcome === "needs_input") return result;
    await notify();
  }
  while (true) {
    input.signal.throwIfAborted();
    const ready = await candidate();
    if (ready) {
      await notify();
      return ready;
    }
    let plan = (await port.load())!;
    if (["failed", "cancelled"].includes(plan.status))
      throw new EditStageError(
        "STAGE_CONFLICT",
        "This staged edit needs attention; completed provider work remains saved.",
      );
    let stage =
      plan.stages.find((stage) =>
        ["running", "waiting"].includes(stage.status),
      ) ??
      plan.stages.find(
        (stage) =>
          stage.status === "pending" &&
          stage.dependencies.every(
            (id) =>
              plan.stages.find((value) => value.id === id)?.status ===
              "completed",
          ),
      );
    if (!stage)
      throw new Error(
        "The stage plan has no runnable or complete final output.",
      );
    if (stage.kind === "evidence") {
      if (stage.attemptId === "planning") {
        const facts = await input.records.checkpoint(stage.attemptId),
          reply = (await saved()).pendingReplies?.[stage.id];
        if (
          facts?.phase === "completed" &&
          facts.resultOutcome === "needs_input"
        ) {
          if (!reply || reply.attemptId !== stage.attemptId) {
            const question = await input.records.readQuestion?.(
              stage.attemptId,
            );
            if (question?.outcome === "needs_input") return question;
            throw new EditStageError(
              "STAGE_CONFLICT",
              "The saved essential question requires its explicit reply before editing can continue.",
            );
          }
          const value = (await artifact(reply.ref)) as {
            kind?: string;
            questionId?: string;
          };
          if (
            value.kind !== "user-reply" ||
            value.questionId !== facts.resultQuestionId
          )
            throw new EditStageError(
              "STAGE_CONFLICT",
              "The explicit reply does not match the original planning question.",
            );
        }
      }
      await ensureEvidence(stage);
      await notify();
      continue;
    }
    if (stage.kind !== "caption_batch" && stage.kind !== "assemble")
      throw new Error(
        "This host stage is waiting for its dedicated input/result port.",
      );
    if (stage.status === "pending") {
      let preparedRef: EditArtifactRef | undefined;
      if (stage.kind === "assemble") {
        const commands: unknown[] = [];
        for (const evidence of plan.stages.filter(
          (value) => value.kind === "evidence",
        )) {
          const manifest = manifestFor(plan, evidence),
            related = plan.stages.filter(
              (value) =>
                value.kind === "caption_batch" &&
                value.descriptor?.manifestHash === manifest.manifestHash,
            );
          if (
            related.some(
              (value) =>
                value.status !== "completed" || value.outputs.length !== 1,
            )
          )
            throw new Error("Missing caption batches prevent final assembly.");
          const batches = await Promise.all(
            related.map((value) => artifact(value.outputs[0])),
          );
          commands.push(
            ...(await input.native.assembleBatches(manifest, batches)).commands,
          );
        }
        preparedRef = await port.putArtifact("commands", {
          summary:
            "All exact caption batches, source trims, reciprocal pairing and styles",
          commands,
        });
      }
      const state = await saved(),
        contextRefs = Object.values(state.artifacts)
          .filter((row) =>
            ["creative-decision", "failure"].includes(row.ref.kind),
          )
          .map((row) => row.ref),
        context = editStageContext(
          plan,
          stage.id,
          contextRefs,
        ) as unknown as Record<string, unknown>;
      context.activeStage = {
        id: stage.id,
        kind: stage.kind,
        sourceItemId: stage.sourceItemId,
        descriptor: stage.descriptor,
      };
      const initialReply = state.pendingReplies?.[plan.stages[0].id];
      if (initialReply?.attemptId === "planning")
        context.explicitUserReply = await artifact(initialReply.ref);
      context.preparedCommands = !!preparedRef;
      if (stage.kind === "caption_batch") {
        const manifest = manifestFor(plan, stage),
          batchId = String(stage.descriptor!.batchId);
        context.captionBatch = input.native.batchContext(manifest, batchId);
      }
      const limits = {
        maxSteps: Math.min(
          plan.limits.perStage?.modelCalls ?? policy.stageModelCalls,
          plan.limits.modelCalls - plan.usage.modelCalls,
        ),
        maxToolCalls: Math.min(
          plan.limits.perStage?.toolCalls ?? policy.stageToolCalls,
          plan.limits.toolCalls - plan.usage.toolCalls,
        ),
        maxOutputTokens: Math.min(
          plan.limits.perStage?.outputTokens ?? policy.stageOutputTokens,
          plan.limits.outputTokens - plan.usage.outputTokens,
        ),
      };
      const frozen = {
        version: 1 as const,
        stageId: stage.id,
        context,
        limits,
        ...(preparedRef ? { preparedRef } : {}),
      };
      const inputRef = await port.putArtifact("evidence", frozen),
        attemptId = `stage:${stage.id}`;
      await port.transition(
        {
          type: "claim",
          operationId: `claim:${stage.id}`,
          stageId: stage.id,
          attemptId,
          checkpointId: `${input.binding.runId}:${attemptId}`,
          inputRef,
        },
        plan.revision,
      );
      plan = (await port.load())!;
      stage = plan.stages.find((value) => value.id === stage!.id)!;
      await notify();
    }
    const attempt = plan.attempts.find(
      (attempt) => attempt.id === stage!.attemptId,
    )!;
    const pendingReply = (await saved()).pendingReplies?.[stage.id];
    if (pendingReply?.attemptId === attempt.id) {
      if (await continueStageAttempt(stage.id, attempt.id, pendingReply.ref))
        continue;
      throw new EditStageError(
        "STAGE_UNKNOWN_OUTCOME",
        "The saved question cannot continue within its original known allowance.",
      );
    }
    if (!attempt.inputRef)
      throw new Error("The stage's frozen model context is missing.");
    const frozen = (await artifact(attempt.inputRef)) as FrozenInput;
    const stagePorts = stages(stage, frozen);
    stagePorts.completionState = {
      version: 1,
      snapshotHash: input.snapshotHash,
      requirements: plan.requirements,
      requirementsHash: plan.requirementsHash,
    };
    const checkpointRef = { stageId: stage.id, attemptId: attempt.id };
    let result: T;
    try {
      result = await input.invoke({
        stages: stagePorts,
        stageContext: frozen.context,
        checkpointRef,
        ...frozen.limits,
        eventOffset:
          (plan.attempts.findIndex((value) => value.id === attempt.id) + 1) *
          1000,
      });
    } catch (cause) {
      const latest = await saved();
      if (
        latest.savedCandidateRef ||
        latest.plan.stages.find((value) => value.id === stage!.id)?.status ===
          "completed"
      ) {
        await notify();
        continue;
      }
      if (await continueStageAttempt(stage.id, attempt.id)) continue;
      throw cause;
    }
    await notify();
    const final = await candidate();
    if (final) {
      await notify();
      return final;
    }
    const completed = await port.load();
    if (
      completed?.stages.find((value) => value.id === stage!.id)?.status ===
      "completed"
    )
      continue;
    if (result.outcome === "needs_input") {
      const current = (await port.load())!;
      await port.transition(
        {
          type: "wait",
          operationId: `question-wait:${attempt.id}`,
          stageId: stage.id,
          attemptId: attempt.id,
        },
        current.revision,
      );
      await notify();
      return result;
    }
    throw new EditStageError(
      "STAGE_CONFLICT",
      "The model returned before saving its complete stage. Saved artifacts are retained for explicit continuation.",
    );
  }
}
