import {
  assertEditStageBinding,
  completionCanonical,
  completionHash,
  EditStageError,
  parseEditArtifactRef,
  parseEditStagePlan,
  transitionEditStagePlan,
  type EditArtifactKind,
  type EditArtifactRef,
  type EditStageBinding,
  type EditStagePlan,
  type EditStagePort,
} from "../../../packages/agent-kit/src/index";
import {
  parseLoopCheckpoint,
  canResumeLoopCheckpoint,
  encodeLoopCheckpoint,
  type CompactLoopCheckpoint,
  type LoopCheckpoint,
  type LoopCheckpointPort,
} from "../../../packages/agent-loop/src/index";
import {
  runOf,
  type Project,
  type ProjectStore,
  type StoredRun,
} from "./store";

export type StoredEditStageState = {
  definitionHash: string;
  plan: EditStagePlan;
  artifacts: Record<string, { ref: EditArtifactRef; value: unknown }>;
  checkpoints: Record<string, LoopCheckpoint | CompactLoopCheckpoint>;
  savedCandidateRef?: EditArtifactRef;
  lastReviews?: Record<string, EditArtifactRef>;
  pendingReplies?: Record<string, { attemptId: string; ref: EditArtifactRef }>;
};
export function localEditStageRecovery(state: StoredEditStageState): {
  safe: boolean;
  message?: string;
} {
  try {
    const plan = parseEditStagePlan(state.plan);
    if (plan.status === "cancelled" || plan.status === "failed")
      return {
        safe: false,
        message:
          "The original stage plan is stopped or expired; saved outputs remain retained.",
      };
    if (state.savedCandidateRef) return { safe: true };
    if (
      Date.now() >= Date.parse(plan.limits.expiresAt) ||
      !plan.usage.usageKnown
    )
      return {
        safe: false,
        message:
          "The original allowance expired or provider usage is unknown; saved results remain available without a replacement request.",
      };
    const active = plan.stages.find(
      (stage) => stage.status === "running" || stage.status === "waiting",
    );
    if (!active?.attemptId || !state.checkpoints[active.attemptId])
      return { safe: true };
    const checkpoint = parseLoopCheckpoint(state.checkpoints[active.attemptId]);
    if (checkpoint.outputBudgetOverrun || !checkpoint.usageKnown)
      return {
        safe: false,
        message:
          "Provider overrun or unknown usage requires reconciliation; no replacement request was submitted.",
      };
    return canResumeLoopCheckpoint(checkpoint, {
      replaySafeToolNames: checkpoint.snapshot.tools
        .filter((tool) => tool.replaySafe)
        .map((tool) => tool.name),
      answerReplaySafe: checkpoint.snapshot.answerReplaySafe,
    })
      ? { safe: true }
      : {
          safe: false,
          message:
            "The saved provider or unsafe tool outcome is unknown; no replacement work was submitted.",
        };
  } catch {
    return {
      safe: false,
      message: "The saved editing stage records failed their integrity checks.",
    };
  }
}
export async function localEditStageBinding(
  project: Project,
  run: StoredRun,
  modelIdentity: string,
): Promise<EditStageBinding> {
  const basis = run.request.document as Project["document"],
    sourceIds = new Set(Object.keys(basis.sources));
  return {
    projectId: project.id,
    runId: run.id,
    baseHash: run.baseHash,
    instructionHash: await completionHash(run.instruction),
    scopeHash: await completionHash(run.scope ?? { kind: "project" }),
    sourceHash: await completionHash({
      sources: project.sources
        .filter((source) => sourceIds.has(source.sourceId))
        .map(({ sourceId, fingerprint, scheme, byteLength, mimeType }) => ({
          sourceId,
          fingerprint,
          scheme,
          byteLength,
          mimeType,
        }))
        .sort((a, b) =>
          a.sourceId < b.sourceId ? -1 : a.sourceId > b.sourceId ? 1 : 0,
        ),
      sourceIdentities: Object.fromEntries(
        [...sourceIds]
          .sort()
          .map((id) => [id, project.document.sources[id] ?? null]),
      ),
      fps: project.document.format.fps,
      clocks: basis.items
        .filter((item) => ["video", "audio"].includes(item.node.type))
        .map((original) => {
          const item = project.document.items.find(
            (item) => item.id === original.id,
          );
          return item
            ? {
                id: item.id,
                type: item.node.type,
                assetId: item.node.assetId,
                from: item.node.from ?? 0,
                duration: item.node.duration,
                videoStartTime: item.node.videoStartTime ?? 0,
                audioStartTime: item.node.audioStartTime ?? 0,
                playbackRate: item.node.playbackRate ?? 1,
                loop: item.node.loop ?? false,
              }
            : { id: original.id, missing: true };
        }),
      captionInputs: basis.items
        .filter((item) => item.caption)
        .map((original) => {
          const current = project.document.items.find(
            (item) => item.id === original.id,
          );
          return current?.caption
            ? {
                id: current.id,
                from: current.node.from ?? 0,
                duration: current.node.duration,
                sourceItemId: current.caption.sourceItemId,
                pairedItemId: current.caption.pairedItemId,
                language: current.caption.language,
                role: current.caption.role,
                cues: current.caption.cues.map(
                  ({ id, text, startMs, endMs }) => ({
                    id,
                    text,
                    startMs,
                    endMs,
                  }),
                ),
              }
            : { id: original.id, missing: true };
        }),
      speechSources: run.speechContinuation?.sources ?? [],
      speechEvidence: run.speechContinuation?.evidenceCommands ?? [],
    }),
    profile: run.agentProfile ?? "local-editor-v1",
    modelIdentity,
  };
}
function owned(project: Project, runId: string) {
  runOf(project, runId);
  return project.editStagePlans?.[runId];
}
function state(project: Project, runId: string) {
  const found = owned(project, runId);
  if (!found)
    throw new EditStageError(
      "STAGE_CONFLICT",
      "The editing stage plan is unavailable.",
    );
  return found;
}
async function current(
  project: Project,
  input: { runId: string; binding: EditStageBinding },
  plan: EditStagePlan,
) {
  const run = runOf(project, input.runId);
  if (
    input.binding.projectId !== project.id ||
    input.binding.runId !== input.runId
  )
    throw new EditStageError(
      "STAGE_CONFLICT",
      "Stage ownership does not match this project/run.",
    );
  await assertEditStageBinding(plan, input.binding);
  await assertEditStageBinding(
    plan,
    await localEditStageBinding(project, run, input.binding.modelIdentity),
  );
}
async function readStoredArtifact(
  saved: StoredEditStageState,
  raw: EditArtifactRef,
) {
  const ref = parseEditArtifactRef(raw),
    artifact = saved.artifacts[ref.id];
  if (
    !artifact ||
    completionCanonical(artifact.ref) !== completionCanonical(ref) ||
    ref.runId !== saved.plan.binding.runId ||
    ref.bindingHash !== saved.plan.bindingHash
  )
    throw new EditStageError(
      "STAGE_CONFLICT",
      "This artifact is missing or belongs to another run/source.",
    );
  const json = completionCanonical(artifact.value);
  if (
    (await completionHash(artifact.value)) !== ref.sha256 ||
    new TextEncoder().encode(json).length !== ref.sizeBytes
  )
    throw new EditStageError(
      "STAGE_INVALID",
      "The stored editing artifact failed its content/byte check.",
    );
  return structuredClone(artifact.value);
}
export async function putLocalEditStageArtifact(
  saved: StoredEditStageState,
  kind: EditArtifactKind,
  value: unknown,
): Promise<EditArtifactRef> {
  const json = completionCanonical(value),
    sizeBytes = new TextEncoder().encode(json).length;
  if (sizeBytes > 4 * 1024 * 1024)
    throw new EditStageError(
      "STAGE_INVALID",
      "The editing artifact exceeds its byte budget.",
    );
  const sha256 = await completionHash(value),
    identity = await completionHash({
      kind,
      sha256,
      bindingHash: saved.plan.bindingHash,
    });
  const ref = parseEditArtifactRef({
    version: 1,
    id: `artifact:${identity.slice(7)}`,
    runId: saved.plan.binding.runId,
    bindingHash: saved.plan.bindingHash,
    kind,
    sha256,
    sizeBytes,
  });
  if (saved.artifacts[ref.id]) {
    await readStoredArtifact(saved, ref);
    return ref;
  }
  if (
    Object.keys(saved.artifacts).length >= 128 ||
    Object.values(saved.artifacts).reduce(
      (n, a) => n + a.ref.sizeBytes,
      sizeBytes,
    ) >
      8 * 1024 * 1024
  )
    throw new EditStageError(
      "STAGE_INVALID",
      "The private editing-artifact storage budget is exhausted.",
    );
  saved.artifacts[ref.id] = { ref, value: JSON.parse(json) };
  return ref;
}
export function createLocalEditStagePort(input: {
  store: ProjectStore;
  projectId: string;
  runId: string;
  binding: EditStageBinding;
  now?: () => string;
}): EditStagePort {
  const now = input.now ?? (() => new Date().toISOString());
  return {
    load: async () => {
      const project = await input.store.read(input.projectId),
        saved = owned(project, input.runId);
      if (!saved) return null;
      const plan = parseEditStagePlan(saved.plan);
      await assertEditStageBinding(plan, input.binding);
      return plan;
    },
    initialize: async (raw) =>
      input.store.transaction(input.projectId, async (project) => {
        const plan = parseEditStagePlan(raw);
        await current(project, input, plan);
        if (
          plan.revision ||
          plan.attempts.length ||
          Object.keys(plan.operations).length ||
          plan.stages.some((s) => s.status !== "pending")
        )
          throw new EditStageError(
            "STAGE_INVALID",
            "Only a new pending definition can initialize a stage plan.",
          );
        const definitionHash = await completionHash(plan),
          previous = owned(project, input.runId);
        if (previous) {
          if (previous.definitionHash !== definitionHash)
            throw new EditStageError(
              "STAGE_CONFLICT",
              "This run already owns a different immutable stage plan.",
            );
          return { plan: parseEditStagePlan(previous.plan), created: false };
        }
        project.editStagePlans ??= {};
        project.editStagePlans[input.runId] = {
          definitionHash,
          plan,
          artifacts: {},
          checkpoints: {},
        };
        return { plan, created: true };
      }),
    transition: async (event, expectedRevision) =>
      input.store.transaction(input.projectId, async (project) => {
        const saved = state(project, input.runId),
          plan = parseEditStagePlan(saved.plan);
        // Late paid results survive cancellation without authorizing further work.
        if (!(event.type === "complete" && plan.status === "cancelled"))
          await current(project, input, plan);
        else await assertEditStageBinding(plan, input.binding);
        if (event.type === "complete")
          for (const ref of event.outputs) await readStoredArtifact(saved, ref);
        if (
          (event.type === "claim" || event.type === "continue") &&
          event.inputRef
        )
          await readStoredArtifact(saved, event.inputRef);
        if (event.type === "continue") {
          const rawCheckpoint = saved.checkpoints[event.previousAttemptId];
          if (!rawCheckpoint)
            throw new EditStageError(
              "STAGE_CONFLICT",
              "Continuation requires its saved prior checkpoint.",
            );
          const checkpoint = parseLoopCheckpoint(rawCheckpoint);
          if (
            (await completionHash(checkpoint)) !== event.priorCheckpointHash ||
            !checkpoint.usageKnown ||
            checkpoint.outputBudgetOverrun ||
            checkpoint.hostWait
          )
            throw new EditStageError(
              "STAGE_UNKNOWN_OUTCOME",
              "An unknown/overrun host or provider outcome cannot authorize continuation.",
            );
          if (event.reason === "stage_budget") {
            if (
              checkpoint.phase !== "tool-observations" ||
              checkpoint.pendingTurn ||
              checkpoint.modelCalls < checkpoint.snapshot.budgets.maxSteps
            )
              throw new EditStageError(
                "STAGE_CONFLICT",
                "Continue only after all tools finished at the prior stage-step boundary.",
              );
          } else {
            const result = checkpoint.result as
              | { outcome?: unknown }
              | undefined;
            if (
              checkpoint.phase !== "completed" ||
              !["answer", "needs_input"].includes(String(result?.outcome))
            )
              throw new EditStageError(
                "STAGE_CONFLICT",
                "A reply continues only its completed answer/question checkpoint.",
              );
            await readStoredArtifact(saved, event.replyRef!);
          }
        }
        const result = await transitionEditStagePlan(plan, event, {
          expectedRevision,
          now: now(),
        });
        saved.plan = result.plan;
        return result;
      }),
    putArtifact: async (kind: EditArtifactKind, value: unknown) =>
      input.store.transaction(input.projectId, async (project) => {
        const saved = state(project, input.runId);
        await assertEditStageBinding(saved.plan, input.binding);
        return putLocalEditStageArtifact(saved, kind, value);
      }),
    readArtifact: async (ref) => {
      const project = await input.store.read(input.projectId),
        saved = state(project, input.runId);
      await assertEditStageBinding(saved.plan, input.binding);
      return readStoredArtifact(saved, ref);
    },
  };
}
/** Checkpoint, absolute usage and transition fence share one local transaction. */
export function createLocalStageCheckpointPort(input: {
  store: ProjectStore;
  projectId: string;
  runId: string;
  binding: EditStageBinding;
  stageId: string;
  attemptId: string;
}): LoopCheckpointPort {
  return {
    runId: `${input.runId}:${input.attemptId}`,
    snapshotHash: `${input.binding.baseHash}:${input.stageId}:${input.attemptId}`,
    load: async () => {
      const project = await input.store.read(input.projectId),
        saved = state(project, input.runId);
      await current(project, input, saved.plan);
      return structuredClone(saved.checkpoints[input.attemptId] ?? null);
    },
    save: async (raw, expectedRevision) =>
      input.store.transaction(input.projectId, async (project) => {
        const saved = state(project, input.runId),
          checkpoint = parseLoopCheckpoint(raw),
          previous = saved.checkpoints[input.attemptId];
        const attempt = saved.plan.attempts.find(
          (a) => a.id === input.attemptId && a.stageId === input.stageId,
        );
        if (checkpoint.phase === "model-pending") {
          if (Date.now() >= Date.parse(saved.plan.limits.expiresAt))
            throw new EditStageError(
              "STAGE_BUDGET",
              "The original funded stage execution allowance expired before submission.",
            );
          const stage = saved.plan.stages.find(
            (stage) => stage.id === input.stageId,
          );
          if (
            !stage ||
            !["running", "waiting"].includes(stage.status) ||
            saved.savedCandidateRef
          )
            throw new EditStageError(
              "STAGE_CONFLICT",
              "The saved stage output must be reused before another model request.",
            );
          await current(project, input, saved.plan);
        }
        if (
          !attempt ||
          attempt.checkpointId !== checkpoint.snapshot.runId ||
          checkpoint.snapshot.runId !== `${input.runId}:${input.attemptId}` ||
          checkpoint.snapshot.snapshotHash !==
            `${input.binding.baseHash}:${input.stageId}:${input.attemptId}`
        )
          throw new EditStageError(
            "STAGE_CONFLICT",
            "The stage checkpoint belongs to another attempt.",
          );
        if ((previous?.revision ?? null) !== expectedRevision)
          throw new EditStageError(
            "STAGE_CONFLICT",
            "Another execution advanced this stage checkpoint.",
          );
        if (
          checkpoint.revision !==
          (expectedRevision === null ? 0 : expectedRevision + 1)
        )
          throw new EditStageError(
            "STAGE_CONFLICT",
            "The stage checkpoint revision is invalid.",
          );
        await assertEditStageBinding(saved.plan, input.binding);
        const result = await transitionEditStagePlan(
          saved.plan,
          {
            type: "record_usage",
            operationId: `checkpoint:${(await completionHash({ attemptId: input.attemptId, revision: checkpoint.revision })).slice(7)}`,
            stageId: input.stageId,
            attemptId: input.attemptId,
            usage: {
              ...checkpoint.usage,
              modelCalls: checkpoint.modelCalls,
              toolCalls: checkpoint.toolCalls,
              usageKnown: checkpoint.usageKnown,
            },
          },
          {
            expectedRevision: saved.plan.revision,
            now: new Date().toISOString(),
          },
        );
        saved.plan = result.plan;
        saved.checkpoints[input.attemptId] = encodeLoopCheckpoint(checkpoint);
      }),
  };
}
