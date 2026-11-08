import { createHash } from "node:crypto";
import { z } from "zod/v3";
import {
  canResumeLoopCheckpoint,
  parseLoopCheckpoint,
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
  checkpoint: LoopCheckpoint;
};
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
function parseEnvelope(p: Project, run: StoredRun): StoredAgentLoopCheckpoint {
  const parsed = envelopeSchema.parse(run.loopCheckpoint);
  const checkpoint = parseLoopCheckpoint(parsed.checkpoint);
  const { checkpoint: _checkpoint, contextHash, ...binding } = parsed;
  if (
    parsed.projectId !== p.id ||
    parsed.runId !== run.id ||
    parsed.runBindingHash !== runBinding(p, run) ||
    parsed.sourceHash !== sourceBinding(p, run) ||
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
): History | undefined {
  return run.loopCheckpoint ? parseEnvelope(p, run).history : undefined;
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
    load: () =>
      input.store.transaction(input.projectId, (p) => {
        const { saved } = assertCurrent(p);
        return saved ? structuredClone(saved.checkpoint) : null;
      }),
    save: (next, expectedRevision) =>
      input.store.transaction(input.projectId, (p) => {
        const { current, saved } = assertCurrent(p);
        if ((saved?.checkpoint.revision ?? null) !== expectedRevision)
          throw new AgentCheckpointConflict(
            "Another execution advanced this agent checkpoint.",
          );
        const checkpoint = parseLoopCheckpoint(next);
        if (
          checkpoint.snapshot.runId !== input.runId ||
          checkpoint.snapshot.snapshotHash !== contextHash ||
          checkpoint.revision !==
            (expectedRevision === null ? 0 : expectedRevision + 1)
        )
          throw new AgentCheckpointConflict(
            "The agent checkpoint revision or snapshot is invalid.",
          );
        current.loopCheckpoint = { ...binding, contextHash, checkpoint };
        current.updatedAt = new Date().toISOString();
      }),
  };
}
