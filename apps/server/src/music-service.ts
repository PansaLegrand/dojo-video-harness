import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile, rm, open } from "node:fs/promises";
import path from "node:path";
import { z } from "zod/v3";
import { Input, BufferSource, ALL_FORMATS } from "mediabunny";
import {
  ProjectStore,
  HttpError,
  commitDocument,
  snapshot,
  atomicJson,
  identifier,
  type Project,
} from "./store";
import { atomicReplace } from "./atomic-replace";
import { canonicalSerialize } from "../../../packages/core/src/lib/video-project/document";
import { executeVideoProjectCommands } from "../../../packages/core/src/lib/video-project/commands";
import type { ProviderConfig } from "../../../packages/adapters/src/provider-http";
import {
  submitBackgroundMusic,
  pollBackgroundMusic,
  downloadMusicTrack,
  type BackgroundMusicRequest,
  type MusicTrack,
  MusicProviderError,
} from "../../../packages/adapters/src/music";

export const musicRequestSchema = z
  .object({
    operationId: z.string().min(1).max(191),
    sourceRunId: z.string().uuid().optional(),
    baseRevision: z.number().int().nonnegative(),
    baseHash: z.string().min(1).max(100),
    prompt: z.string().trim().min(1).max(1000),
    title: z.string().trim().min(1).max(80),
    trackId: z.string().min(1).max(191),
    fromFrame: z.number().int().nonnegative(),
    durationInFrames: z.number().int().positive().max(108000),
    volume: z.number().min(0).max(1).default(0.2),
  })
  .strict();
export type MusicRequest = z.infer<typeof musicRequestSchema>;
export type MusicJob = {
  id: string;
  operationId: string;
  requestHash: string;
  request: MusicRequest;
  status:
    | "awaiting_approval"
    | "submitting"
    | "running"
    | "downloading"
    | "ready_for_insertion"
    | "completed"
    | "cancelled"
    | "failed"
    | "submission_unknown"
    | "needs_attention";
  createdAt: string;
  updatedAt: string;
  approvedAt?: string;
  providerTaskId?: string;
  fps: number;
  trackIdentity: string;
  model?: string;
  error?: { code: string; message: string };
  media?: {
    hash: string;
    byteLength: number;
    mimeType: string;
    durationSeconds: number;
    sourceId: string;
    fileName: string;
  };
  itemId?: string;
  insertedRevision?: number;
};
type MusicProject = Project & { musicJobs?: Record<string, MusicJob> };
export type PublicMusicJob = Omit<
  MusicJob,
  "requestHash" | "trackIdentity" | "providerTaskId"
> & { hasProviderTask: boolean; mediaUrl?: string };
export type MusicAdapters = {
  submit: (
    config: ProviderConfig,
    request: BackgroundMusicRequest,
    signal: AbortSignal,
  ) => Promise<{ taskId: string }>;
  poll: (
    config: ProviderConfig,
    taskId: string,
    signal: AbortSignal,
  ) => ReturnType<typeof pollBackgroundMusic>;
  download: (
    track: MusicTrack,
    signal: AbortSignal,
    providerBaseUrl: string,
  ) => Promise<Blob>;
};
const defaults: MusicAdapters = {
  submit: submitBackgroundMusic,
  poll: pollBackgroundMusic,
  download: (track, signal, providerBaseUrl) =>
    downloadMusicTrack(track, signal, { localProviderOrigin: providerBaseUrl }),
};
const terminal = new Set<MusicJob["status"]>([
  "completed",
  "cancelled",
  "failed",
]);
const error = (code: string, message: string) => ({ code, message });
const unknownSubmission = error(
  "SUBMISSION_UNKNOWN",
  "Submission may have reached the music provider. Check its task history and reconcile the task ID; no generation was automatically repeated.",
);
const jobOf = (project: MusicProject, id: string) => {
  identifier.parse(id);
  const job = project.musicJobs?.[id];
  if (!job) throw new HttpError("Music job not found.", 404);
  return job;
};
function publicJob(projectId: string, job: MusicJob): PublicMusicJob {
  const {
    requestHash: _hash,
    trackIdentity: _track,
    providerTaskId,
    ...value
  } = structuredClone(job);
  return {
    ...value,
    hasProviderTask: !!providerTaskId,
    ...(job.media
      ? {
          mediaUrl: `/api/media/${projectId}/${encodeURIComponent(job.media.sourceId)}`,
        }
      : {}),
  };
}
function validPlacement(
  project: MusicProject,
  request: MusicRequest,
  fps: number,
  trackIdentity: string,
) {
  const track = project.document.tracks.find((t) => t.id === request.trackId);
  return (
    !!track &&
    track.kind === "audio" &&
    !track.locked &&
    canonicalSerialize(track) === trackIdentity &&
    project.document.format.fps === fps &&
    request.fromFrame + request.durationInFrames <=
      project.document.format.durationInFrames
  );
}
async function inspectAudio(blob: Blob, signal: AbortSignal) {
  if (!blob.size || blob.size > 50 * 1024 * 1024)
    throw new Error("Invalid music byte count");
  signal.throwIfAborted();
  const bytes = Buffer.from(await blob.arrayBuffer());
  const input = new Input({
    source: new BufferSource(bytes),
    formats: ALL_FORMATS,
  });
  try {
    const audio = await input.getPrimaryAudioTrack();
    if (!audio || (await input.getPrimaryVideoTrack()))
      throw new Error("Music must contain audio only");
    const durationSeconds = await audio.computeDuration();
    if (
      !Number.isFinite(durationSeconds) ||
      durationSeconds <= 0 ||
      durationSeconds > 1200
    )
      throw new Error("Invalid music duration");
    const mimeType = (await input.getFormat()).mimeType.replace(
      /^video\//,
      "audio/",
    );
    signal.throwIfAborted();
    return {
      bytes,
      durationSeconds,
      mimeType,
      hash: createHash("sha256").update(bytes).digest("hex"),
    };
  } finally {
    input.dispose();
  }
}

/** Generation is paid only after approve(). Jobs and insertion receipts share the
 * project transaction; private credentials are snapshotted outside project data. */
export class MusicService {
  private active = new Map<
    string,
    { controller: AbortController; work: Promise<void> }
  >();
  constructor(
    private store: ProjectStore,
    private getConfig: () => ProviderConfig,
    private adapters: MusicAdapters = defaults,
    private options: { pollIntervalMs?: number; deadlineMs?: number } = {},
  ) {}
  private configFile(id: string) {
    identifier.parse(id);
    return path.join(this.store.directory, "music-configs", id + ".json");
  }
  async list(projectId: string) {
    const p = (await this.store.read(projectId)) as MusicProject;
    return Object.values(p.musicJobs ?? {}).map((j) => publicJob(projectId, j));
  }
  async get(projectId: string, jobId: string) {
    return publicJob(projectId, jobOf(await this.store.read(projectId), jobId));
  }
  async propose(projectId: string, raw: unknown) {
    const request = musicRequestSchema.parse(raw),
      requestHash = canonicalSerialize(request);
    return this.store.transaction(projectId, (p) => {
      const project = p as MusicProject;
      project.musicJobs ??= {};
      const prior = Object.values(project.musicJobs).find(
        (j) => j.operationId === request.operationId,
      );
      if (prior) {
        if (prior.requestHash !== requestHash)
          throw new HttpError(
            "Music operation ID was reused with different inputs.",
            409,
          );
        return publicJob(projectId, prior);
      }
      if (request.sourceRunId) {
        const sourceRun = project.runs.find(
          (run) => run.id === request.sourceRunId,
        );
        if (
          !sourceRun ||
          ["cancelled", "stale", "failed"].includes(sourceRun.status)
        )
          throw new HttpError(
            "The chat request is no longer available for music generation.",
            409,
            "SOURCE_RUN_UNAVAILABLE",
          );
      }
      if (
        request.sourceRunId &&
        project.runs.find((run) => run.id === request.sourceRunId)?.request
          .authoring?.scope?.kind !== "project"
      )
        throw new HttpError(
          "Choose whole-project scope before generating background music.",
          409,
          "MUSIC_SCOPE_REQUIRED",
        );
      if (Object.keys(project.musicJobs).length >= 100)
        throw new HttpError(
          "This project has reached its 100 music-job limit.",
          409,
        );
      if (
        project.revision !== request.baseRevision ||
        project.documentHash !== request.baseHash
      )
        throw new HttpError(
          "Save and review the current project before generating music.",
          409,
        );
      if (request.durationInFrames / project.document.format.fps > 360)
        throw new HttpError(
          "Generate at most six minutes of music per request.",
        );
      const track = project.document.tracks.find(
        (t) => t.id === request.trackId,
      );
      const trackIdentity = track ? canonicalSerialize(track) : "";
      if (
        !validPlacement(
          project,
          request,
          project.document.format.fps,
          trackIdentity,
        )
      )
        throw new HttpError(
          "Choose an unlocked audio track and a range inside the current project.",
        );
      const id = randomUUID(),
        now = new Date().toISOString();
      const job: MusicJob = {
        id,
        operationId: request.operationId,
        requestHash,
        request,
        status: "awaiting_approval",
        createdAt: now,
        updatedAt: now,
        fps: project.document.format.fps,
        trackIdentity,
      };
      project.musicJobs[id] = job;
      return publicJob(projectId, job);
    });
  }
  async approve(projectId: string, jobId: string) {
    let submit = false;
    const result = await this.store.transaction(projectId, async (p) => {
      const project = p as MusicProject,
        job = jobOf(project, jobId);
      if (job.status !== "awaiting_approval") return publicJob(projectId, job);
      if (job.request.sourceRunId) {
        const sourceRun = project.runs.find(
          (run) => run.id === job.request.sourceRunId,
        );
        if (
          !sourceRun ||
          ["cancelled", "stale", "failed"].includes(sourceRun.status)
        ) {
          job.status = "cancelled";
          job.error = error(
            "SOURCE_RUN_UNAVAILABLE",
            "The originating chat request was cancelled, failed or became stale. Start a new music request if still wanted.",
          );
          job.updatedAt = new Date().toISOString();
          return publicJob(projectId, job);
        }
      }
      if (
        job.request.sourceRunId &&
        project.runs.find((run) => run.id === job.request.sourceRunId)?.request
          .authoring?.scope?.kind !== "project"
      )
        throw new HttpError(
          "Choose whole-project scope before generating background music.",
          409,
          "MUSIC_SCOPE_REQUIRED",
        );
      const config = { ...this.getConfig() };
      if (
        !config.apiKey &&
        !["localhost", "127.0.0.1", "[::1]"].includes(
          new URL(config.baseUrl).hostname,
        )
      )
        throw new HttpError(
          "Configure your music provider key before approving generation.",
        );
      if (!validPlacement(project, job.request, job.fps, job.trackIdentity))
        throw new HttpError(
          "The approved insertion target changed. Create a new music proposal.",
          409,
        );
      await mkdir(path.dirname(this.configFile(job.id)), {
        recursive: true,
        mode: 0o700,
      });
      // This private file must precede the persisted submission fence.
      await atomicJson(this.configFile(job.id), config);
      job.status = "submitting";
      job.model = config.model;
      job.approvedAt = new Date().toISOString();
      job.updatedAt = job.approvedAt;
      submit = true;
      return publicJob(projectId, job);
    });
    if (submit) this.launch(projectId, jobId, true);
    else if (terminal.has(result.status)) await this.removeConfig(jobId);
    return result;
  }
  async cancel(projectId: string, jobId: string) {
    const result = await this.store.transaction(projectId, (p) => {
      const job = jobOf(p, jobId);
      if (!terminal.has(job.status)) {
        job.status = "cancelled";
        job.error = undefined;
        job.updatedAt = new Date().toISOString();
      }
      return publicJob(projectId, job);
    });
    this.active.get(jobId)?.controller.abort();
    await this.removeConfig(jobId);
    return result;
  }
  async resume(projectId: string, jobId: string) {
    const job = jobOf(await this.store.read(projectId), jobId);
    if (terminal.has(job.status)) return publicJob(projectId, job);
    if (!job.approvedAt || !job.providerTaskId)
      throw new HttpError(
        "This job cannot be resumed automatically. Reconcile an uncertain provider task first.",
        409,
      );
    if (this.active.has(jobId)) return publicJob(projectId, job);
    await this.store.transaction(projectId, (p) => {
      const current = jobOf(p, jobId);
      if (!terminal.has(current.status)) {
        current.status = current.media ? "ready_for_insertion" : "running";
        current.error = undefined;
      }
    });
    this.launch(projectId, jobId, false);
    return this.get(projectId, jobId);
  }
  async reconcile(projectId: string, jobId: string, raw: unknown) {
    const value = z
      .object({
        taskId: z
          .string()
          .trim()
          .min(1)
          .max(200)
          .regex(/^[a-zA-Z0-9_-]+$/),
        confirmed: z.literal(true),
      })
      .strict()
      .parse(raw);
    await this.store.transaction(projectId, (p) => {
      const job = jobOf(p, jobId);
      if (job.providerTaskId === value.taskId) return;
      if (
        job.status !== "submission_unknown" ||
        !job.approvedAt ||
        job.providerTaskId
      )
        throw new HttpError(
          "Only an uncertain submission can be reconciled.",
          409,
        );
      job.providerTaskId = value.taskId;
      job.status = "needs_attention";
      job.error = undefined;
    });
    return this.resume(projectId, jobId);
  }
  async recover() {
    for (const { id } of await this.store.list()) {
      const resumable = await this.store.transaction(id, (p) => {
        const jobs = Object.values((p as MusicProject).musicJobs ?? {}),
          result: { resume: string[]; cleanup: string[] } = {
            resume: [],
            cleanup: [],
          };
        for (const job of jobs) {
          if (terminal.has(job.status)) result.cleanup.push(job.id);
          else if (job.status === "submitting") {
            job.status = "submission_unknown";
            job.error = unknownSubmission;
          } else if (
            ["running", "downloading"].includes(job.status) &&
            job.providerTaskId
          )
            result.resume.push(job.id);
        }
        return result;
      });
      for (const job of resumable.cleanup) await this.removeConfig(job);
      for (const job of resumable.resume) this.launch(id, job, false);
    }
  }
  private async removeConfig(jobId: string) {
    try {
      await rm(this.configFile(jobId), { force: true });
    } catch {
      /* Cleanup cannot roll back a completed insertion or trigger paid work. */
    }
  }
  private async cleanupTerminalConfig(projectId: string, jobId: string) {
    try {
      if (terminal.has(jobOf(await this.store.read(projectId), jobId).status))
        await this.removeConfig(jobId);
    } catch {
      /* Preserve recoverable credentials when project state cannot be read. */
    }
  }
  private launch(projectId: string, jobId: string, submit: boolean) {
    if (this.active.has(jobId)) return;
    const controller = new AbortController();
    const work = this.run(projectId, jobId, submit, controller.signal)
      .catch(() => {})
      .finally(() => {
        if (this.active.get(jobId)?.controller === controller)
          this.active.delete(jobId);
      });
    this.active.set(jobId, { controller, work });
  }
  async waitForIdle(_projectId: string, jobId: string) {
    await this.active.get(jobId)?.work;
  }
  stop() {
    for (const { controller } of this.active.values()) controller.abort();
  }
  private async run(
    projectId: string,
    jobId: string,
    submit: boolean,
    signal: AbortSignal,
  ) {
    let stage = "config";
    try {
      let job = jobOf(await this.store.read(projectId), jobId);
      if (terminal.has(job.status)) return;
      const config = JSON.parse(
        await readFile(this.configFile(jobId), "utf8"),
      ) as ProviderConfig;
      if (submit) {
        stage = "submit";
        const response = await this.adapters.submit(
          config,
          {
            prompt: job.request.prompt,
            title: job.request.title,
            durationSeconds: Math.max(
              10,
              job.request.durationInFrames / job.fps,
            ),
          },
          signal,
        );
        await this.store.transaction(projectId, (p) => {
          const current = jobOf(p, jobId);
          current.providerTaskId = response.taskId;
          if (current.status !== "cancelled") current.status = "running";
        });
      }
      stage = "poll";
      const deadline = Date.now() + (this.options.deadlineMs ?? 20 * 60_000);
      for (;;) {
        signal.throwIfAborted();
        job = jobOf(await this.store.read(projectId), jobId);
        if (terminal.has(job.status)) return;
        if (job.media) {
          stage = "insert";
          await this.insert(projectId, jobId);
          return;
        }
        if (!job.providerTaskId)
          throw new Error("Provider task identity missing");
        const result = await this.adapters.poll(
          config,
          job.providerTaskId,
          signal,
        );
        if (result.status === "failed") {
          await this.store.transaction(projectId, (p) => {
            const j = jobOf(p, jobId);
            if (!terminal.has(j.status)) {
              j.status = "failed";
              j.error = error(
                "PROVIDER_FAILED",
                "Music generation failed at the provider. No new generation was submitted.",
              );
            }
          });
          return;
        }
        if (result.status === "succeeded") {
          stage = "download";
          await this.store.transaction(projectId, (p) => {
            const j = jobOf(p, jobId);
            if (!terminal.has(j.status)) j.status = "downloading";
          });
          if (!result.tracks.length)
            throw new Error("No music tracks returned");
          // V1 deterministically uses the first provider track, named in the approval UI.
          const audio = await inspectAudio(
            await this.adapters.download(
              result.tracks[0],
              signal,
              config.baseUrl,
            ),
            signal,
          );
          const directory = path.join(this.store.directory, "media", projectId);
          await mkdir(directory, { recursive: true, mode: 0o700 });
          const temporary = path.join(
            directory,
            `${audio.hash}.${randomUUID()}.tmp`,
          );
          try {
            await writeFile(temporary, audio.bytes, { mode: 0o600 });
            const handle = await open(temporary, "r+");
            try {
              await handle.sync();
            } finally {
              await handle.close();
            }
            await atomicReplace(temporary, path.join(directory, audio.hash));
          } finally {
            await rm(temporary, { force: true });
          }
          await this.store.transaction(projectId, (p) => {
            const j = jobOf(p, jobId);
            if (terminal.has(j.status)) return;
            j.media = {
              hash: audio.hash,
              byteLength: audio.bytes.length,
              mimeType: audio.mimeType,
              durationSeconds: audio.durationSeconds,
              sourceId: `local:${audio.hash}`,
              fileName:
                j.request.title +
                ({
                  "audio/wav": ".wav",
                  "audio/mpeg": ".mp3",
                  "audio/mp4": ".m4a",
                  "audio/webm": ".webm",
                }[audio.mimeType] ?? ".audio"),
            };
            const sourceId = j.media.sourceId;
            const existingSource = p.sources.find(
              (source) => source.sourceId === sourceId,
            );
            if (existingSource) {
              if (
                existingSource.fingerprint !== audio.hash ||
                existingSource.byteLength !== audio.bytes.length
              )
                throw new HttpError(
                  "Existing source identity conflicts with generated music bytes.",
                  409,
                );
              existingSource.status = "available";
              existingSource.url = `/api/media/${projectId}/${encodeURIComponent(sourceId)}`;
              existingSource.assetId ??= sourceId;
            } else
              p.sources.push({
                sourceId,
                assetId: sourceId,
                url: `/api/media/${projectId}/${encodeURIComponent(sourceId)}`,
                status: "available",
                fingerprint: audio.hash,
                scheme: "sha256",
                byteLength: audio.bytes.length,
                mimeType: audio.mimeType,
                fileName: j.media.fileName,
              });
            j.status = "ready_for_insertion";
          });
          signal.throwIfAborted();
          stage = "insert";
          await this.insert(projectId, jobId);
          return;
        }
        if (Date.now() >= deadline) throw new Error("Music polling deadline");
        await new Promise<void>((resolve, reject) => {
          const timer = setTimeout(() => {
            signal.removeEventListener("abort", abort);
            resolve();
          }, this.options.pollIntervalMs ?? 5000);
          const abort = () => {
            clearTimeout(timer);
            reject(new Error("Cancelled"));
          };
          signal.addEventListener("abort", abort, { once: true });
          if (signal.aborted) abort();
        });
      }
    } catch (cause) {
      await this.store
        .transaction(projectId, (p) => {
          const job = jobOf(p, jobId);
          if (terminal.has(job.status)) return;
          job.updatedAt = new Date().toISOString();
          if (stage === "submit" && !job.providerTaskId) {
            if (
              cause instanceof MusicProviderError &&
              !cause.submissionUncertain
            ) {
              job.status = "failed";
              job.error = error(
                "SUBMISSION_REJECTED",
                "The provider rejected music generation. Check the provider settings before a new request.",
              );
            } else {
              job.status = "submission_unknown";
              job.error = unknownSubmission;
            }
          } else if (stage === "config") {
            job.status = "failed";
            job.error = error(
              "CONFIGURATION_UNAVAILABLE",
              "The saved provider configuration is unavailable. No generation was started.",
            );
          } else if (stage === "insert") {
            job.status = "ready_for_insertion";
            job.error = error(
              "INSERTION_FAILED",
              "Music is saved locally, but its timeline insertion needs attention. Restore the approved target and resume.",
            );
          } else {
            job.status = "needs_attention";
            job.error = error(
              stage === "download" ? "DOWNLOAD_FAILED" : "POLL_INTERRUPTED",
              "Music work stopped. Resume checks the existing provider task; it does not start another paid generation.",
            );
          }
        })
        .catch(() => {});
    } finally {
      await this.cleanupTerminalConfig(projectId, jobId);
    }
  }
  private async insert(projectId: string, jobId: string) {
    return this.store.transaction(projectId, async (p) => {
      const project = p as MusicProject,
        job = jobOf(project, jobId);
      if (terminal.has(job.status)) return;
      const media = job.media;
      if (!media) throw new Error("Music bytes are not available");
      if (!validPlacement(project, job.request, job.fps, job.trackIdentity)) {
        job.status = "ready_for_insertion";
        job.error = error(
          "INSERTION_TARGET_CHANGED",
          "The approved audio track, frame rate or range changed. Restore that target and resume, or import the retained music manually.",
        );
        return;
      }
      const operationId = `music:${job.id}`,
        itemId = `music-${job.id}`,
        assetId = media.sourceId;
      if (project.receipts[operationId]) {
        job.status = "completed";
        return;
      }
      const duration = Math.min(
        job.request.durationInFrames,
        Math.floor(media.durationSeconds * job.fps),
      );
      if (duration < 1) throw new Error("Music has no complete frame");
      const commands = [
        ...(!project.document.assets[assetId]
          ? [
              {
                type: "addAsset" as const,
                asset: {
                  id: assetId,
                  assetId,
                  type: "audio" as const,
                  name: job.request.title,
                  source: "local" as const,
                  durationSeconds: media.durationSeconds,
                  byteLength: media.byteLength,
                  mimeType: media.mimeType,
                },
              },
              {
                type: "addSource" as const,
                source: {
                  assetId,
                  revision: media.hash,
                  contentHash: media.hash,
                },
              },
            ]
          : []),
        {
          type: "addItem" as const,
          item: {
            id: itemId,
            name: job.request.title,
            trackId: job.request.trackId,
            node: {
              id: itemId,
              type: "audio" as const,
              assetId,
              from: job.request.fromFrame,
              duration,
              volume: job.request.volume,
            },
          },
        },
      ];
      const next = executeVideoProjectCommands(
        project.document,
        commands,
      ).document;
      if (!project.sources.some((s) => s.sourceId === media.sourceId))
        project.sources.push({
          sourceId: media.sourceId,
          assetId,
          url: `/api/media/${projectId}/${encodeURIComponent(media.sourceId)}`,
          status: "available",
          fingerprint: media.hash,
          scheme: "sha256",
          byteLength: media.byteLength,
          mimeType: media.mimeType,
          fileName: media.fileName,
        });
      await commitDocument(project, next);
      project.receipts[operationId] = {
        hash: job.requestHash,
        snapshot: snapshot(project),
      };
      job.status = "completed";
      job.itemId = itemId;
      job.insertedRevision = project.revision;
      job.error = undefined;
      job.updatedAt = new Date().toISOString();
    });
  }
}
