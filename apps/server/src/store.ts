import { atomicReplace } from "./atomic-replace";
import {
  mkdir,
  readFile,
  writeFile,
  rename,
  open,
  readdir,
} from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { z } from "zod/v3";
import {
  createVideoProjectDocument,
  hashVideoProjectDocument,
  canonicalSerialize,
  type VideoProjectDocument,
} from "../../../packages/core/src/lib/video-project/document";
import {
  executeVideoProjectCommands,
  rebaseVideoProjectCommands,
  videoProjectCommandsSchema,
  type VideoProjectCommand,
} from "../../../packages/core/src/lib/video-project/commands";
import type {
  VideoProjectSnapshot,
  VideoSourceResolution,
} from "../../../packages/core/src/lib/video-project/types";
import type {
  VideoProjectAgentRun,
  VideoProjectAgentMessage,
} from "../../../packages/core/src/lib/video-project/agent-types";
import type { NativeAgentRequest } from "../../../packages/core/src/lib/video-project/agent-runtime";
import type { AgentEvent } from "../../../packages/agent/src/types";
import type { EditingWorkflow } from "./editing-workflow";
import type { MusicJob } from "./music-service";
import type { ExportReceipt } from "./exports";
import type { AgentSpeechContinuation } from "./agent-speech";
import {
  agentCheckpointRecovery,
  agentPreludeCheckpointRecovery,
  type StoredAgentLoopCheckpoint,
} from "./agent-loop-checkpoint";
import { nativeAgentProgress } from "../../../packages/core/src/lib/video-project/agent-progress";
import {
  captionSegmentationReceiptSchema,
  validateCaptionSegmentationReceipt,
  type CaptionSegmentationReceipt,
} from "../../../packages/core/src/lib/video-project/caption-segmentation";

export class HttpError extends Error {
  constructor(
    message: string,
    readonly status = 400,
    readonly code = "INVALID_REQUEST",
  ) {
    super(message);
  }
}
export const identifier = z.string().uuid();
export const commitInput = z
  .object({
    operationId: z.string().min(1).max(191),
    baseRevision: z.number().int().nonnegative(),
    baseHash: z.string(),
    commands: videoProjectCommandsSchema,
    summary: z.string().max(2000).optional(),
    captionSegmentation: captionSegmentationReceiptSchema.optional(),
  })
  .strict();
export type StoredRun = VideoProjectAgentRun & {
  browserToolsEnabled?: true;
  appliedReceipt?: {
    operationId: string;
    revision: number;
    documentHash: string;
  };
  request: NativeAgentRequest;
  requestHash: string;
  events: AgentEvent[];
  appliedBefore?: VideoProjectDocument;
  appliedAfter?: VideoProjectDocument;
  answers?: Record<string, { hash: string; childId: string }>;
  speechContinuation?: AgentSpeechContinuation;
  loopCheckpoint?: StoredAgentLoopCheckpoint;
  preludeCheckpoints?: StoredAgentLoopCheckpoint[];
  stageProgress?: import("../../../packages/agent-kit/src/stage-progress").EditStageProgress;
  stageRecovery?: { canResume: boolean; canReuseSavedResult: boolean };
  agentProfile?:
    | "local-editor-v1"
    | "local-editor-v2"
    | "local-editor-v3"
    | "local-editor-v4"
    | "local-editor-v5"
    | "local-editor-v6"
    | "local-editor-v7"
    | "local-editor-v8"
    | "local-editor-v9"
    | "local-editor-v10"
    | "local-editor-v11"
    | "local-editor-v12"
    | "local-editor-v13";
  completion?: import("../../../packages/agent-kit/src/index").CompletionContract;
};
export type Project = {
  id: string;
  name: string;
  description?: string;
  updatedAt?: string;
  revision: number;
  documentHash: string;
  document: VideoProjectDocument;
  sources: VideoSourceResolution[];
  past: VideoProjectDocument[];
  future: VideoProjectDocument[];
  versions: Record<string, VideoProjectDocument>;
  receipts: Record<
    string,
    {
      hash: string;
      snapshot: VideoProjectSnapshot;
      metadata?: { captionSegmentation: CaptionSegmentationReceipt };
    }
  >;
  runs: StoredRun[];
  messages: VideoProjectAgentMessage[];
  exports?: Record<string, ExportReceipt>;
  musicJobs?: Record<string, MusicJob>;
  editingWorkflows?: Record<string, EditingWorkflow>;
  editStagePlans?: Record<
    string,
    import("./edit-stage-store").StoredEditStageState
  >;
  browserRequests?: import("./local-browser-requests").LocalBrowserRequestState;
};
export function snapshot(p: Project): VideoProjectSnapshot {
  return {
    projectId: p.id,
    document: p.document,
    revision: p.revision,
    documentHash: p.documentHash,
    sources: p.sources,
    history: { canUndo: !!p.past.length, canRedo: !!p.future.length },
  };
}
export class ProjectStore {
  private queues = new Map<string, Promise<unknown>>();
  constructor(readonly directory: string) {}
  async init() {
    await mkdir(path.join(this.directory, "projects"), {
      recursive: true,
      mode: 0o700,
    });
    await mkdir(path.join(this.directory, "tasks"), {
      recursive: true,
      mode: 0o700,
    });
    await mkdir(path.join(this.directory, "media"), {
      recursive: true,
      mode: 0o700,
    });
  }
  file(id: string) {
    identifier.parse(id);
    return path.join(this.directory, "projects", id + ".json");
  }
  async read(id: string): Promise<Project> {
    return this.serialized(id, () => this.readSnapshot(id));
  }
  /** Internal unlocked read: transaction callbacks already own the project queue. */
  private async readSnapshot(id: string): Promise<Project> {
    try {
      return JSON.parse(await readFile(this.file(id), "utf8"));
    } catch (cause) {
      if ((cause as NodeJS.ErrnoException).code === "ENOENT")
        throw new HttpError("Project not found", 404);
      throw cause;
    }
  }
  async list() {
    const names = await readdir(path.join(this.directory, "projects"));
    return Promise.all(
      names
        .filter((x) => x.endsWith(".json"))
        .map(async (x) => {
          const p = await this.read(x.slice(0, -5));
          return projectSummary(p);
        }),
    );
  }
  async create(name = "Untitled video") {
    const document = createVideoProjectDocument({
      width: 1280,
      height: 720,
      fps: 30,
      durationInFrames: 180,
    });
    const p: Project = {
      id: randomUUID(),
      name,
      document,
      documentHash: await hashVideoProjectDocument(document),
      revision: 0,
      sources: [],
      past: [],
      future: [],
      versions: { "0": document },
      receipts: {},
      runs: [],
      messages: [],
    };
    await this.save(p);
    return p;
  }
  async save(p: Project) {
    p.updatedAt = new Date().toISOString();
    await atomicJson(this.file(p.id), p);
  }
  async archive(id: string) {
    return this.serialized(id, async () => {
      const project = await this.readSnapshot(id);
      if (
        project.runs.some((run) =>
          ["queued", "running", "needs_evidence"].includes(run.status),
        )
      )
        throw new HttpError(
          "Cancel active edits before deleting this project.",
          409,
        );
      if (
        Object.values(project.musicJobs ?? {}).some((job) =>
          ["submitting", "running", "downloading"].includes(job.status),
        )
      )
        throw new HttpError(
          "Cancel active music generation before deleting this project.",
          409,
        );
      if (
        Object.values(project.editingWorkflows ?? {}).some(
          (plan) => plan.status === "approved",
        )
      )
        throw new HttpError(
          "Cancel active workflow preparation before deleting this project.",
          409,
        );
      const trash = path.join(this.directory, "trash");
      await mkdir(trash, { recursive: true, mode: 0o700 });
      await atomicReplace(
        this.file(id),
        path.join(trash, `${id}-${randomUUID()}.json`),
      );
      return { deleted: true };
    });
  }
  /** Serialize read/validate/write, not model/network calls. Errors leave the file untouched. */
  async transaction<T>(
    id: string,
    fn: (p: Project) => T | Promise<T>,
  ): Promise<T> {
    return this.serialized(id, async () => {
      const p = await this.readSnapshot(id);
      const result = await fn(p);
      await this.save(p);
      return result;
    });
  }
  /** Queue readers too: a polling read must not keep a Windows replacement locked.
   * Different projects remain independent. Callbacks use their supplied snapshot;
   * never recursively enter this queue for the same project. */
  private async serialized<T>(id: string, fn: () => Promise<T>): Promise<T> {
    identifier.parse(id);
    const previous = this.queues.get(id) ?? Promise.resolve();
    const work = previous.catch(() => {}).then(fn);
    this.queues.set(id, work);
    try {
      return await work;
    } finally {
      if (this.queues.get(id) === work) this.queues.delete(id);
    }
  }
  async commit(
    id: string,
    raw: unknown,
    validate?: (p: Project, commands: VideoProjectCommand[]) => Promise<void>,
  ) {
    const input = commitInput.parse(raw);
    return this.transaction(id, async (p) => {
      const hash = canonicalSerialize(input),
        prior = p.receipts[input.operationId];
      if (prior) {
        if (prior.hash !== hash)
          throw new HttpError(
            "Operation ID was reused with different input.",
            409,
          );
        return prior.snapshot;
      }
      const base = p.versions[String(input.baseRevision)];
      if (!base || (await hashVideoProjectDocument(base)) !== input.baseHash)
        throw new HttpError(
          "The edit base is no longer available.",
          409,
          "REVISION_CONFLICT",
        );
      if (input.captionSegmentation) {
        try {
          await validateCaptionSegmentationReceipt(
            base,
            input.commands,
            input.captionSegmentation,
          );
        } catch (cause) {
          throw new HttpError(
            cause instanceof Error
              ? cause.message
              : "Prepare the linked caption edit again.",
            409,
            "CAPTION_SEGMENTATION_STALE",
          );
        }
      }
      const result = rebaseVideoProjectCommands(
        base,
        p.document,
        input.commands,
      );
      if (!result.ok)
        throw new HttpError(result.reason, 409, "REVISION_CONFLICT");
      if (input.captionSegmentation) {
        try {
          await validateCaptionSegmentationReceipt(
            p.document,
            result.commands,
            input.captionSegmentation,
          );
        } catch (cause) {
          throw new HttpError(
            cause instanceof Error
              ? cause.message
              : "The linked caption edit changed during recovery.",
            409,
            "CAPTION_SEGMENTATION_STALE",
          );
        }
      }
      await validate?.(p, result.commands);
      await commitDocument(p, result.document);
      const next = snapshot(p);
      p.receipts[input.operationId] = {
        hash,
        snapshot: next,
        ...(input.captionSegmentation
          ? { metadata: { captionSegmentation: input.captionSegmentation } }
          : {}),
      };
      return next;
    });
  }
  async recoverInterrupted() {
    const { localEditStageRecovery } = await import("./edit-stage-store");
    for (const { id } of await this.list())
      await this.transaction(id, (p) => {
        for (const run of p.runs)
          if (["queued", "running"].includes(run.status)) {
            const stageState = p.editStagePlans?.[run.id];
            if (stageState) {
              const recovery = localEditStageRecovery(stageState);
              run.status = recovery.safe
                ? "queued"
                : stageState.plan.status === "cancelled"
                  ? "cancelled"
                  : "failed";
              run.phase = recovery.safe
                ? "stage_resume"
                : "stage_needs_attention";
              run.error = recovery.safe
                ? null
                : {
                    code: "STAGE_RECONCILIATION_REQUIRED",
                    message: recovery.message!,
                  };
              run.updatedAt = new Date().toISOString();
              continue;
            }
            if (agentPreludeCheckpointRecovery(p, run)) {
              run.status = "queued";
              run.error = null;
              run.updatedAt = new Date().toISOString();
              continue;
            }
            const checkpoint = agentCheckpointRecovery(p, run);
            if (checkpoint.kind === "resume") {
              run.status = "queued";
              run.phase = "checkpoint_resume";
              run.error = null;
              run.updatedAt = new Date().toISOString();
              continue;
            }
            if (
              checkpoint.kind === "none" &&
              run.speechContinuation &&
              !run.speechContinuation.modelStarted
            ) {
              run.status = "needs_evidence";
              run.phase = "waiting_for_transcript";
              run.updatedAt = new Date().toISOString();
              continue;
            }
            run.status = "failed";
            run.phase = "interrupted";
            run.error = {
              code: "INTERRUPTED",
              message:
                checkpoint.message ??
                "The local server restarted. No provider call was automatically repeated. Start a new request when ready.",
            };
            run.updatedAt = new Date().toISOString();
          }
      });
  }
}
export async function commitDocument(
  p: Project,
  document: VideoProjectDocument,
  history = true,
) {
  if (history) {
    p.past.push(p.document);
    p.past = p.past.slice(-50);
    p.future = [];
  }
  p.document = document;
  p.documentHash = await hashVideoProjectDocument(document);
  p.revision++;
  p.versions[String(p.revision)] = document;
  for (const key of Object.keys(p.versions))
    if (Number(key) < p.revision - 100) delete p.versions[key];
}
export async function atomicJson(file: string, value: unknown) {
  const temp = file + "." + randomUUID() + ".tmp";
  await writeFile(temp, JSON.stringify(value), { mode: 0o600 });
  const handle = await open(temp, "r+");
  try {
    await handle.sync();
  } finally {
    await handle.close();
  }
  await atomicReplace(temp, file);
}
export function message(
  p: Project,
  runId: string,
  role: "user" | "assistant",
  text: string,
) {
  p.messages.push({
    id: randomUUID(),
    runId,
    role,
    text,
    status: "completed",
    createdAt: new Date().toISOString(),
  });
}
export const runOf = (p: Project, id: string) => {
  const run = p.runs.find((r) => r.id === id);
  if (!run) throw new HttpError("Run not found", 404);
  return run;
};
export function publicRun({
  browserToolsEnabled: _browserTools,
  appliedReceipt: _application,
  request: _request,
  requestHash: _hash,
  appliedBefore: _before,
  appliedAfter: _after,
  answers: _answers,
  speechContinuation: _speech,
  loopCheckpoint: _checkpoint,
  preludeCheckpoints: _preludes,
  stageProgress: _stages,
  stageRecovery: _stageRecovery,
  completion: _completion,
  ...run
}: StoredRun) {
  const progress = _stages
    ? nativeAgentProgress(
        {
          status: run.status,
          phase: run.phase,
          baseDocumentJson: _request.document,
          contextJson: run.context,
          requestJson: {
            ..._request,
            prerequisites: run.prerequisites,
            evidenceCommands: _speech?.evidenceCommands,
          },
          resultJson: {
            proposal: run.proposal,
            completion: _completion,
            ...(_completion && _stages.status === "completed"
              ? {
                  verification: {
                    status: "passed",
                    outcomes: _completion.requirements.map((requirement) => ({
                      id: requirement.id,
                      passed: true,
                      message: requirement.kind.replaceAll("_", " "),
                    })),
                  },
                }
              : {}),
          },
          asrTasksJson: _speech?.sources.map((source) => ({
            sourceId: source.assetId,
            taskId: source.taskId,
          })),
        },
        _stageRecovery?.canReuseSavedResult ?? false,
      )
    : undefined;
  if (progress && _stages) {
    progress.stages = _stages;
    if (!progress.deliverables.length)
      progress.deliverables = _stages.remainingRequirements.map(
        (requirement) => ({
          ...requirement,
          label: requirement.kind.replaceAll("_", " "),
          status: "pending",
        }),
      );
    if (_stages.status !== "completed") progress.coverage = "declared";
    progress.recovery.canResume =
      !!_stageRecovery?.canResume &&
      ["failed", "queued", "needs_evidence"].includes(run.status);
  }
  return {
    ...run,
    ...(progress ? { progress } : {}),
    manualReviewRequired: run.proposal?.impact === "review",
    ...(run.replyState
      ? {
          clarificationReply: {
            remaining: run.replyState.available ? (1 as const) : (0 as const),
            continuationRunId: run.replyState.continuationRunId,
            ...(run.replyState.answerOperationId
              ? { answerOperationId: run.replyState.answerOperationId }
              : {}),
            options: run.replyState.options,
          },
        }
      : {}),
  };
}

export function projectSummary(p: Project) {
  return {
    id: p.id,
    name: p.name,
    description: p.description ?? null,
    project_kind: "video" as const,
    updated_at: p.updatedAt ?? new Date(0).toISOString(),
  };
}
