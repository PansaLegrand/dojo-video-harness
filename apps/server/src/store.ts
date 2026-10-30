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
import type { ExportReceipt } from "./exports";

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
  })
  .strict();
export type StoredRun = VideoProjectAgentRun & {
  request: NativeAgentRequest;
  requestHash: string;
  events: AgentEvent[];
  appliedBefore?: VideoProjectDocument;
  appliedAfter?: VideoProjectDocument;
  answers?: Record<string, { hash: string; childId: string }>;
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
  receipts: Record<string, { hash: string; snapshot: VideoProjectSnapshot }>;
  runs: StoredRun[];
  messages: VideoProjectAgentMessage[];
  exports?: Record<string, ExportReceipt>;
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
    const previous = this.queues.get(id) ?? Promise.resolve();
    const work = previous
      .catch(() => {})
      .then(async () => {
        const project = await this.read(id);
        if (
          project.runs.some((run) =>
            ["queued", "running", "needs_evidence"].includes(run.status),
          )
        )
          throw new HttpError(
            "Cancel active edits before deleting this project.",
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
    this.queues.set(id, work);
    try {
      return await work;
    } finally {
      if (this.queues.get(id) === work) this.queues.delete(id);
    }
  }
  /** Serialize read/validate/write, not model/network calls. Errors leave the file untouched. */
  async transaction<T>(
    id: string,
    fn: (p: Project) => T | Promise<T>,
  ): Promise<T> {
    const previous = this.queues.get(id) ?? Promise.resolve();
    const work = previous
      .catch(() => {})
      .then(async () => {
        const p = await this.read(id);
        const result = await fn(p);
        await this.save(p);
        return result;
      });
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
      const result = rebaseVideoProjectCommands(
        base,
        p.document,
        input.commands,
      );
      if (!result.ok)
        throw new HttpError(result.reason, 409, "REVISION_CONFLICT");
      await validate?.(p, result.commands);
      await commitDocument(p, result.document);
      const next = snapshot(p);
      p.receipts[input.operationId] = { hash, snapshot: next };
      return next;
    });
  }
  async recoverInterrupted() {
    for (const { id } of await this.list())
      await this.transaction(id, (p) => {
        for (const run of p.runs)
          if (["queued", "running"].includes(run.status)) {
            run.status = "failed";
            run.phase = "interrupted";
            run.error = {
              code: "INTERRUPTED",
              message:
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
  request: _request,
  requestHash: _hash,
  appliedBefore: _before,
  appliedAfter: _after,
  answers: _answers,
  ...run
}: StoredRun) {
  return {
    ...run,
    ...(run.replyState
      ? {
          clarificationReply: {
            remaining: run.replyState.available ? (1 as const) : (0 as const),
            continuationRunId: run.replyState.continuationRunId,
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
