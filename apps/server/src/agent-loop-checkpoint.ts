import {
  completionHash,
  transitionEditStagePlan,
  usesStagedEditing,
} from "../../../packages/agent-kit/src/index";
import { createHash } from "node:crypto";
import { z } from "zod/v3";
import {
  canResumeLoopCheckpoint,
  DEFAULT_CHECKPOINT_CAPACITY,
  encodeLoopCheckpoint,
  LoopCheckpointCapacityError,
  parseLoopCheckpoint,
  type CompactLoopCheckpoint,
  type LoopCheckpoint,
  type LoopCheckpointPort,
} from "../../../packages/agent-loop/src/index";
import { replaySafeNativeToolNames } from "../../../packages/agent/src/tools";
import { canonicalSerialize } from "../../../packages/core/src/lib/video-project/document";
import type { NativeAgentRequest } from "../../../packages/core/src/lib/video-project/agent-runtime";
import type { Project, ProjectStore, StoredRun } from "./store";

type History = Array<{ role: "user" | "assistant"; text: string }>;
export type StoredAgentLoopCheckpoint = {
  version: 1;
  projectId: string;
  runId: string;
  runBindingHash: string;
  sourceHash: string;
  effectiveRequestHash: string;
  toolInventoryHash: string;
  modelIdentity?: string;
  history: History;
  contextHash: string;
  checkpoint: LoopCheckpoint | CompactLoopCheckpoint;
};
type ParsedAgentLoopCheckpoint = Omit<
  StoredAgentLoopCheckpoint,
  "checkpoint"
> & { checkpoint: LoopCheckpoint };
const MAX_LOCAL_CHECKPOINT_BYTES = 2 * 1024 * 1024;
const digest = (value: unknown) =>
  "sha256:" +
  createHash("sha256").update(canonicalSerialize(value)).digest("hex");
const hash = z.string().regex(/^sha256:[a-f0-9]{64}$/);
const envelopeSchema = z
  .object({
    version: z.literal(1),
    projectId: z.string().uuid(),
    runId: z.string().uuid(),
    runBindingHash: hash,
    sourceHash: hash,
    effectiveRequestHash: hash,
    toolInventoryHash: hash,
    modelIdentity: z.string().min(1).max(2048).optional(),
    history: z
      .array(
        z
          .object({
            role: z.enum(["user", "assistant"]),
            text: z.string().max(4000),
          })
          .strict(),
      )
      .max(12),
    contextHash: hash,
    checkpoint: z.unknown(),
  })
  .strict();

export class AgentCheckpointConflict extends Error {
  readonly code = "AGENT_CHECKPOINT_CONFLICT";
  constructor(message: string) {
    super(message);
    this.name = "AgentCheckpointConflict";
  }
}
function runBinding(p: Project, run: StoredRun) {
  return digest({
    projectId: p.id,
    runId: run.id,
    requestHash: run.requestHash,
    request: run.request,
    baseRevision: run.baseRevision,
    baseHash: run.baseHash,
    cloudConsent: run.cloudConsent,
  });
}
function sourceBinding(p: Project, run: StoredRun) {
  return digest({
    sources: p.sources
      .map(
        ({ sourceId, assetId, fingerprint, scheme, byteLength, mimeType }) => ({
          sourceId,
          assetId,
          fingerprint,
          scheme,
          byteLength,
          mimeType,
        }),
      )
      .sort((a, b) =>
        a.sourceId < b.sourceId ? -1 : a.sourceId > b.sourceId ? 1 : 0,
      ),
    sourceIdentities: p.document.sources,
    speechSources: run.speechContinuation?.sources,
    speechEvidence: run.speechContinuation?.evidenceCommands,
  });
}
function parseEnvelope(
  p: Project,
  run: StoredRun,
  stagePlanOwnsCurrentBinding = false,
): ParsedAgentLoopCheckpoint {
  const parsed = envelopeSchema.parse(run.loopCheckpoint);
  const checkpoint = parseLoopCheckpoint(parsed.checkpoint);
  const { checkpoint: _checkpoint, contextHash, ...binding } = parsed;
  if (
    parsed.projectId !== p.id ||
    parsed.runId !== run.id ||
    (!stagePlanOwnsCurrentBinding &&
      parsed.runBindingHash !== runBinding(p, run)) ||
    (!stagePlanOwnsCurrentBinding &&
      parsed.sourceHash !== sourceBinding(p, run)) ||
    contextHash !== digest(binding) ||
    checkpoint.snapshot.runId !== run.id ||
    checkpoint.snapshot.snapshotHash !== contextHash
  )
    throw new AgentCheckpointConflict(
      "The saved agent checkpoint no longer matches its request or source identities. Start a new request.",
    );
  return { ...parsed, checkpoint };
}

/** History is frozen at the first model turn, independently of later chat runs. */
export function agentCheckpointHistory(
  p: Project,
  run: StoredRun,
  options: { stagePlanOwnsCurrentBinding?: boolean } = {},
): History | undefined {
  return run.loopCheckpoint
    ? parseEnvelope(
        p,
        run,
        options.stagePlanOwnsCurrentBinding === true &&
          usesStagedEditing(run.agentProfile ?? "local-editor-v1") &&
          !!p.editStagePlans?.[run.id],
      ).history
    : undefined;
}

/** A host-accepted planning clarification may restart before its next model fence.
 * The previous paid answers remain immutable audit records and carry all usage. */
export function agentPreludeCheckpointRecovery(
  p: Project,
  run: StoredRun,
): boolean {
  if (
    !usesStagedEditing(run.agentProfile ?? "local-editor-v1") ||
    run.loopCheckpoint ||
    !run.preludeCheckpoints?.length ||
    run.phase !== "stage_resume" ||
    !run.request.authoring?.clarification ||
    !Object.values(run.answers ?? {}).some(
      (answer) => answer.childId === run.id,
    )
  )
    return false;
  try {
    for (const raw of run.preludeCheckpoints) {
      const saved = envelopeSchema.parse(raw),
        checkpoint = parseLoopCheckpoint(saved.checkpoint);
      const { checkpoint: _checkpoint, contextHash, ...binding } = saved;
      const result = checkpoint.result as
        | { outcome?: string; clarification?: { id?: string } }
        | undefined;
      if (
        saved.projectId !== p.id ||
        saved.runId !== run.id ||
        contextHash !== digest(binding) ||
        checkpoint.snapshot.runId !== run.id ||
        checkpoint.snapshot.snapshotHash !== contextHash ||
        checkpoint.phase !== "completed" ||
        !checkpoint.usageKnown ||
        checkpoint.outputBudgetOverrun ||
        checkpoint.hostWait ||
        result?.outcome !== "needs_input" ||
        !result.clarification?.id
      )
        return false;
    }
    const last = parseLoopCheckpoint(run.preludeCheckpoints.at(-1)!.checkpoint);
    return (
      (last.result as { clarification: { id: string } }).clarification.id ===
      run.request.authoring.clarification.questionId
    );
  } catch {
    return false;
  }
}

/** Called inside ProjectStore's existing transaction during startup. No executor
 * or provider is invoked while deciding whether the persisted boundary is safe. */
export function agentCheckpointRecovery(
  p: Project,
  run: StoredRun,
): { kind: "none" | "resume" | "uncertain" | "invalid"; message?: string } {
  if (!run.loopCheckpoint) return { kind: "none" };
  try {
    const saved = parseEnvelope(p, run);
    return canResumeLoopCheckpoint(saved.checkpoint, {
      replaySafeToolNames: [...replaySafeNativeToolNames],
      answerReplaySafe: true,
    })
      ? { kind: "resume" }
      : {
          kind: "uncertain",
          message:
            "The server restarted during an uncertain model or external tool call. Its outcome must be reconciled; it was not automatically repeated.",
        };
  } catch {
    return {
      kind: "invalid",
      message:
        "The saved agent checkpoint failed its request/source integrity check. No provider call was repeated.",
    };
  }
}

export async function createAgentCheckpointPort(input: {
  store: ProjectStore;
  projectId: string;
  runId: string;
  request: NativeAgentRequest;
  history: History;
  inventory: unknown;
  skills: unknown;
  modelIdentity?: string;
  signal: AbortSignal;
}): Promise<LoopCheckpointPort> {
  const project = await input.store.read(input.projectId);
  const run = project.runs.find((candidate) => candidate.id === input.runId);
  if (!run)
    throw new AgentCheckpointConflict(
      "The checkpoint run is no longer available.",
    );
  const binding = {
    version: 1 as const,
    projectId: input.projectId,
    runId: input.runId,
    runBindingHash: runBinding(project, run),
    sourceHash: sourceBinding(project, run),
    effectiveRequestHash: digest(input.request),
    toolInventoryHash: digest({
      inventory: input.inventory,
      skills: input.skills,
    }),
    modelIdentity: input.modelIdentity,
    history: structuredClone(input.history),
  };
  const contextHash = digest(binding);
  const envelopeBytes = new TextEncoder().encode(
    JSON.stringify({ ...binding, contextHash, checkpoint: null }),
  ).byteLength;
  const capacity = {
    ...DEFAULT_CHECKPOINT_CAPACITY,
    maxBytes: MAX_LOCAL_CHECKPOINT_BYTES - Math.max(1024, envelopeBytes),
  };
  const assertCurrent = (p: Project) => {
    input.signal.throwIfAborted();
    const current = p.runs.find((candidate) => candidate.id === input.runId);
    if (!current || current.status !== "running")
      throw new AgentCheckpointConflict(
        "The agent run is no longer executing.",
      );
    if (
      runBinding(p, current) !== binding.runBindingHash ||
      sourceBinding(p, current) !== binding.sourceHash
    )
      throw new AgentCheckpointConflict(
        "The agent request or source identities changed while it was executing.",
      );
    const saved = current.loopCheckpoint ? parseEnvelope(p, current) : null;
    if (saved && saved.contextHash !== contextHash)
      throw new AgentCheckpointConflict(
        "The saved agent request, tool inventory, skills or provider changed. Start a new request.",
      );
    return { current, saved };
  };
  return {
    runId: input.runId,
    snapshotHash: contextHash,
    encoding: "compact-v2",
    capacity,
    load: () =>
      input.store.transaction(input.projectId, (p) => {
        const { saved } = assertCurrent(p);
        return saved ? structuredClone(saved.checkpoint) : null;
      }),
    save: (next, expectedRevision) =>
      input.store.transaction(input.projectId, async (p) => {
        const checkpoint = parseLoopCheckpoint(next);
        const owner = p.runs.find((candidate) => candidate.id === input.runId);
        // A returned paid reply is retained even if cancellation/source changes
        // happened during HTTP. Subsequent tools/model fences still fail closed.
        const retainPaid =
          owner &&
          usesStagedEditing(owner.agentProfile ?? "local-editor-v1") &&
          checkpoint.phase === "model-returned";
        const { current, saved } = retainPaid
          ? {
              current: owner!,
              saved: owner!.loopCheckpoint
                ? parseEnvelope(p, owner!, true)
                : null,
            }
          : assertCurrent(p);
        if (saved && saved.contextHash !== contextHash)
          throw new AgentCheckpointConflict(
            "The paid reply belongs to another frozen checkpoint.",
          );
        if ((saved?.checkpoint.revision ?? null) !== expectedRevision)
          throw new AgentCheckpointConflict(
            "Another execution advanced this agent checkpoint.",
          );
        if (
          checkpoint.snapshot.runId !== input.runId ||
          checkpoint.snapshot.snapshotHash !== contextHash ||
          checkpoint.revision !==
            (expectedRevision === null ? 0 : expectedRevision + 1)
        )
          throw new AgentCheckpointConflict(
            "The agent checkpoint revision or snapshot is invalid.",
          );
        const stored = {
          ...binding,
          contextHash,
          checkpoint: encodeLoopCheckpoint(checkpoint),
        };
        // Legacy accepted profiles keep their original format/budget. New byte-
        // bounded profiles also fit the complete private host envelope.
        if (
          checkpoint.snapshot.checkpointCapacity &&
          new TextEncoder().encode(JSON.stringify(stored)).byteLength >
            MAX_LOCAL_CHECKPOINT_BYTES
        )
          throw new LoopCheckpointCapacityError("checkpoint-too-large");
        const staged = usesStagedEditing(
          current.agentProfile ?? "local-editor-v1",
        )
          ? p.editStagePlans?.[current.id]
          : undefined;
        let planning = staged?.plan.attempts.find(
          (attempt) => attempt.id === "planning",
        );
        if (
          staged &&
          !planning &&
          staged.plan.stages[0]?.status === "pending"
        ) {
          const first = staged.plan.stages[0];
          staged.plan = (
            await transitionEditStagePlan(
              staged.plan,
              {
                type: "claim",
                operationId: `claim:${first.id}`,
                stageId: first.id,
                attemptId: "planning",
                checkpointId: current.id,
              },
              {
                expectedRevision: staged.plan.revision,
                now: new Date().toISOString(),
              },
            )
          ).plan;
          planning = staged.plan.attempts.find(
            (attempt) => attempt.id === "planning",
          );
        }
        if (staged && planning) {
          const carried = (current.preludeCheckpoints ?? []).map((saved) =>
            parseLoopCheckpoint(saved.checkpoint),
          );
          const usage = carried.reduce(
            (total, cp) => ({
              modelCalls: total.modelCalls + cp.modelCalls,
              toolCalls: total.toolCalls + cp.toolCalls,
              inputTokens: total.inputTokens + cp.usage.inputTokens,
              outputTokens: total.outputTokens + cp.usage.outputTokens,
              usageKnown: total.usageKnown && cp.usageKnown,
            }),
            {
              modelCalls: checkpoint.modelCalls,
              toolCalls: checkpoint.toolCalls,
              ...checkpoint.usage,
              usageKnown: checkpoint.usageKnown,
            },
          );
          staged.plan = (
            await transitionEditStagePlan(
              staged.plan,
              {
                type: "record_usage",
                operationId: `planning-checkpoint:${(await completionHash({ revision: checkpoint.revision, contextHash })).slice(7)}`,
                stageId: planning.stageId,
                attemptId: planning.id,
                usage,
              },
              {
                expectedRevision: staged.plan.revision,
                now: new Date().toISOString(),
              },
            )
          ).plan;
          staged.checkpoints.planning = stored.checkpoint;
        }
        current.loopCheckpoint = stored;
        current.updatedAt = new Date().toISOString();
      }),
  };
}
