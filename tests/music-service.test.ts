import { afterEach, describe, expect, it, vi } from "vitest";
import { mkdtemp, mkdir, readFile, rm, stat } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { randomUUID, createHash } from "node:crypto";
import { ProjectStore, commitDocument } from "../apps/server/src/store";
import {
  MusicService,
  type MusicAdapters,
  type MusicJob,
} from "../apps/server/src/music-service";
import { MusicProviderError } from "../packages/adapters/src/music";
const roots: string[] = [];
const services: MusicService[] = [];
afterEach(async () => {
  for (const service of services.splice(0)) service.stop();
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  );
});
function wav(seconds = 1) {
  const rate = 8000,
    samples = rate * seconds,
    bytes = Buffer.alloc(44 + samples * 2);
  bytes.write("RIFF", 0);
  bytes.writeUInt32LE(bytes.length - 8, 4);
  bytes.write("WAVEfmt ", 8);
  bytes.writeUInt32LE(16, 16);
  bytes.writeUInt16LE(1, 20);
  bytes.writeUInt16LE(1, 22);
  bytes.writeUInt32LE(rate, 24);
  bytes.writeUInt32LE(rate * 2, 28);
  bytes.writeUInt16LE(2, 32);
  bytes.writeUInt16LE(16, 34);
  bytes.write("data", 36);
  bytes.writeUInt32LE(samples * 2, 40);
  for (let i = 0; i < samples; i++)
    bytes.writeInt16LE(
      Math.round(Math.sin((i * Math.PI * 2 * 440) / rate) * 4000),
      44 + i * 2,
    );
  return new Blob([bytes], { type: "audio/wav" });
}
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}
const track = {
  id: "track-provider",
  title: "Provider title",
  audioUrl: "https://cdn.kie.ai/music.mp3",
  durationSeconds: 999,
};
async function fixture(patch: Partial<MusicAdapters> = {}) {
  const directory = await mkdtemp(path.join(os.tmpdir(), "dojo-music-test-"));
  roots.push(directory);
  const store = new ProjectStore(directory);
  await store.init();
  const project = await store.create();
  let config = {
    baseUrl: "https://api.kie.ai",
    apiKey: "private-music-key",
    model: "V6",
  };
  const adapter = {
    submit: vi.fn(async () => ({ taskId: "provider-task-1" })),
    poll: vi.fn(async () => ({
      status: "succeeded" as const,
      tracks: [track],
    })),
    download: vi.fn(async () => wav()),
    ...patch,
  };
  const service = new MusicService(store, () => config, adapter, {
    pollIntervalMs: 1,
    deadlineMs: 1000,
  });
  services.push(service);
  const request = {
    operationId: "music-request",
    baseRevision: project.revision,
    baseHash: project.documentHash,
    prompt: "Gentle instrumental piano",
    title: "Piano bed",
    trackId: "audio",
    fromFrame: 15,
    durationInFrames: 60,
    volume: 0.2,
  };
  return {
    directory,
    store,
    project,
    service,
    adapter,
    request,
    rotate: () => {
      config = {
        ...config,
        apiKey: "replacement-key",
        model: "replacement-model",
      };
    },
  };
}
async function until(predicate: () => Promise<boolean>) {
  for (let i = 0; i < 100; i++) {
    if (await predicate()) return;
    await new Promise((r) => setTimeout(r, 5));
  }
  throw new Error("State did not settle");
}

describe("approved durable background music", () => {
  it("validates provider bounds before approval and requests at least ten seconds before trimming", async () => {
    const f = await fixture();
    await expect(
      f.service.propose(f.project.id, {
        ...f.request,
        prompt: "x".repeat(1001),
      }),
    ).rejects.toThrow();
    await expect(
      f.service.propose(f.project.id, { ...f.request, title: "x".repeat(81) }),
    ).rejects.toThrow();
    expect(await f.service.list(f.project.id)).toHaveLength(0);
    const job = await f.service.propose(f.project.id, f.request);
    await f.service.approve(f.project.id, job.id);
    await f.service.waitForIdle(f.project.id, job.id);
    expect(f.adapter.submit).toHaveBeenCalledWith(
      expect.any(Object),
      expect.objectContaining({ durationSeconds: 10 }),
      expect.any(AbortSignal),
    );
  });

  it.each(["cancelled", "failed", "stale"] as const)(
    "never pays for a proposal from a subsequently %s chat run",
    async (status) => {
      const f = await fixture(),
        sourceRunId = randomUUID(),
        context = { selectedItemIds: [], playheadFrame: 0 };
      await expect(
        f.service.propose(f.project.id, { ...f.request, sourceRunId }),
      ).rejects.toThrow(/chat request/);
      await f.store.transaction(f.project.id, (p) => {
        p.runs.push({
          id: sourceRunId,
          operationId: "source-run",
          status: "running",
          phase: "thinking",
          instruction: "Generate music",
          baseRevision: p.revision,
          baseHash: p.documentHash,
          context,
          proposal: null,
          prerequisites: null,
          error: null,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
          events: [],
          requestHash: "fixture",
          request: {
            contract: "video-project-commands",
            version: 1,
            baseRevision: p.revision,
            baseHash: p.documentHash,
            document: p.document,
            context,
            authoring: { version: 1, scope: { kind: "project" } },
          },
        });
      });
      await f.store.transaction(f.project.id, (p) => {
        p.runs[0].request.authoring = {
          version: 1,
          scope: { kind: "range", fromFrame: 0, durationInFrames: 30 },
        };
      });
      await expect(
        f.service.propose(f.project.id, { ...f.request, sourceRunId }),
      ).rejects.toThrow(/whole-project scope/);
      await f.store.transaction(f.project.id, (p) => {
        p.runs[0].request.authoring = {
          version: 1,
          scope: { kind: "project" },
        };
      });
      const job = await f.service.propose(f.project.id, {
        ...f.request,
        sourceRunId,
      });
      await f.store.transaction(f.project.id, (p) => {
        p.runs[0].status = status;
      });
      expect(await f.service.approve(f.project.id, job.id)).toMatchObject({
        status: "cancelled",
        error: { code: "SOURCE_RUN_UNAVAILABLE" },
      });
      expect(f.adapter.submit).not.toHaveBeenCalled();
      expect((await f.store.read(f.project.id)).revision).toBe(0);
    },
  );
  it("does no provider work before approval, preserves operation identity and inserts exactly once", async () => {
    const f = await fixture(),
      job = await f.service.propose(f.project.id, f.request);
    expect(job.status).toBe("awaiting_approval");
    expect(f.adapter.submit).not.toHaveBeenCalled();
    expect((await f.store.read(f.project.id)).revision).toBe(0);
    expect((await f.service.propose(f.project.id, f.request)).id).toBe(job.id);
    await expect(
      f.service.propose(f.project.id, { ...f.request, prompt: "Changed" }),
    ).rejects.toThrow(/reused/);
    await Promise.all([
      f.service.approve(f.project.id, job.id),
      f.service.approve(f.project.id, job.id),
    ]);
    await f.service.waitForIdle(f.project.id, job.id);
    const p = await f.store.read(f.project.id),
      done = await f.service.get(f.project.id, job.id);
    expect(done).toMatchObject({ status: "completed", insertedRevision: 1 });
    expect(f.adapter.submit).toHaveBeenCalledTimes(1);
    expect(p.document.items).toHaveLength(1);
    expect(p.document.items[0].node).toMatchObject({
      type: "audio",
      from: 15,
      duration: 30,
      volume: 0.2,
    });
    expect(p.document.assets[done.media!.sourceId].durationSeconds).toBeCloseTo(
      1,
    );
    expect(p.document.sources[done.media!.sourceId].contentHash).toBe(
      done.media!.hash,
    );
    expect(p.sources[0]).toMatchObject({
      status: "available",
      fingerprint: done.media!.hash,
      byteLength: 16044,
    });
    expect(
      await readFile(path.join(f.directory, "media", p.id, done.media!.hash)),
    ).toEqual(Buffer.from(await wav().arrayBuffer()));
    await f.service.resume(p.id, job.id);
    await f.service.approve(p.id, job.id);
    expect((await f.store.read(p.id)).revision).toBe(1);
    expect(f.adapter.submit).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(await f.service.list(p.id))).not.toMatch(
      /private-music-key|cdn\.kie|provider-task-1/,
    );
    await expect(
      stat(path.join(f.directory, "music-configs", job.id + ".json")),
    ).rejects.toMatchObject({ code: "ENOENT" });
  });
  it("preserves manual changes made during generation and freezes its provider configuration", async () => {
    const gate = deferred<{ status: "succeeded"; tracks: (typeof track)[] }>();
    const f = await fixture({ poll: vi.fn(async () => gate.promise) }),
      job = await f.service.propose(f.project.id, f.request);
    await f.service.approve(f.project.id, job.id);
    await until(
      async () => (await f.service.get(f.project.id, job.id)).hasProviderTask,
    );
    // Windows protects these files with directory ACLs, not POSIX mode bits.
    // Keep every job/configuration invariant above on all platforms.
    if (process.platform !== "win32") {
      expect(
        (await stat(path.join(f.directory, "music-configs", job.id + ".json")))
          .mode & 0o077,
      ).toBe(0);
    }
    f.rotate();
    await f.store.commit(f.project.id, {
      operationId: "manual",
      baseRevision: 0,
      baseHash: f.project.documentHash,
      commands: [
        {
          type: "set",
          target: { kind: "format" },
          path: ["backgroundColor"],
          value: "#123456",
        },
      ],
    });
    gate.resolve({ status: "succeeded", tracks: [track] });
    await f.service.waitForIdle(f.project.id, job.id);
    const p = await f.store.read(f.project.id);
    expect(p.revision).toBe(2);
    expect(p.document.format.backgroundColor).toBe("#123456");
    expect(f.adapter.poll).toHaveBeenCalledWith(
      expect.objectContaining({ apiKey: "private-music-key", model: "V6" }),
      "provider-task-1",
      expect.any(AbortSignal),
    );
  });
  it("cancelled submission retains late provider identity but never polls or inserts it", async () => {
    const submitted = deferred<{ taskId: string }>(),
      entered = deferred<void>();
    const f = await fixture({
        submit: vi.fn(async () => {
          entered.resolve();
          return submitted.promise;
        }),
      }),
      job = await f.service.propose(f.project.id, f.request);
    await f.service.approve(f.project.id, job.id);
    await entered.promise;
    await f.service.cancel(f.project.id, job.id);
    submitted.resolve({ taskId: "late-task" });
    await f.service.waitForIdle(f.project.id, job.id);
    expect(await f.service.get(f.project.id, job.id)).toMatchObject({
      status: "cancelled",
      hasProviderTask: true,
    });
    expect(f.adapter.poll).not.toHaveBeenCalled();
    expect((await f.store.read(f.project.id)).revision).toBe(0);
  });
  it("keeps uncertain submissions fenced until explicit task reconciliation", async () => {
    const f = await fixture({
        submit: vi.fn(async () => {
          throw new Error("secret provider response private-music-key");
        }),
      }),
      job = await f.service.propose(f.project.id, f.request);
    await f.service.approve(f.project.id, job.id);
    await f.service.waitForIdle(f.project.id, job.id);
    expect(await f.service.get(f.project.id, job.id)).toMatchObject({
      status: "submission_unknown",
      error: { code: "SUBMISSION_UNKNOWN" },
    });
    await f.service.recover();
    await expect(f.service.resume(f.project.id, job.id)).rejects.toThrow(
      /Reconcile/,
    );
    await f.service.approve(f.project.id, job.id);
    expect(f.adapter.submit).toHaveBeenCalledTimes(1);
    await expect(
      f.service.reconcile(f.project.id, job.id, {
        taskId: "../invalid",
        confirmed: true,
      }),
    ).rejects.toThrow();
    expect((await f.service.get(f.project.id, job.id)).status).toBe(
      "submission_unknown",
    );
    await f.service.reconcile(f.project.id, job.id, {
      taskId: "reconciled-task",
      confirmed: true,
    });
    await f.service.waitForIdle(f.project.id, job.id);
    expect(await f.service.get(f.project.id, job.id)).toMatchObject({
      status: "completed",
    });
    expect(f.adapter.submit).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(await f.service.list(f.project.id))).not.toContain(
      "private-music-key",
    );
  });
  it("recognizes a definite provider rejection without pretending its outcome is uncertain", async () => {
    const f = await fixture({
      submit: vi.fn(async () => {
        throw new MusicProviderError("provider_rejected", false, 401);
      }),
    });
    const job = await f.service.propose(f.project.id, f.request);
    await f.service.approve(f.project.id, job.id);
    await f.service.waitForIdle(f.project.id, job.id);
    expect(await f.service.get(f.project.id, job.id)).toMatchObject({
      status: "failed",
      error: { code: "SUBMISSION_REJECTED" },
    });
  });
  it("recovers a known task by polling without submitting another generation", async () => {
    const poll = vi
      .fn()
      .mockRejectedValueOnce(new Error("Polling interrupted"))
      .mockResolvedValue({ status: "succeeded", tracks: [track] });
    const f = await fixture({ poll }),
      job = await f.service.propose(f.project.id, f.request);
    await f.service.approve(f.project.id, job.id);
    await f.service.waitForIdle(f.project.id, job.id);
    expect((await f.service.get(f.project.id, job.id)).status).toBe(
      "needs_attention",
    );
    // A process death before the catch would leave this same known-task checkpoint running.
    await f.store.transaction(f.project.id, (p) => {
      const j = (p as typeof p & { musicJobs: Record<string, MusicJob> })
        .musicJobs[job.id];
      j.status = "running";
      j.error = undefined;
    });
    const restored = new MusicService(
      new ProjectStore(f.directory),
      () => {
        throw new Error("Must use snapshotted config");
      },
      f.adapter,
      { pollIntervalMs: 1 },
    );
    services.push(restored);
    await restored.recover();
    await restored.waitForIdle(f.project.id, job.id);
    expect((await f.store.read(f.project.id)).document.items).toHaveLength(1);
    expect(f.adapter.submit).toHaveBeenCalledTimes(1);
  });
  it("holds completed audio when its target is locked and inserts once after explicit resume", async () => {
    const gate = deferred<{ status: "succeeded"; tracks: (typeof track)[] }>();
    const f = await fixture({ poll: vi.fn(async () => gate.promise) }),
      job = await f.service.propose(f.project.id, f.request);
    await f.service.approve(f.project.id, job.id);
    await until(
      async () => (await f.service.get(f.project.id, job.id)).hasProviderTask,
    );
    await f.store.transaction(f.project.id, (p) => {
      p.document.tracks.find((t) => t.id === "audio")!.locked = true;
    });
    gate.resolve({ status: "succeeded", tracks: [track] });
    await f.service.waitForIdle(f.project.id, job.id);
    expect(await f.service.get(f.project.id, job.id)).toMatchObject({
      status: "ready_for_insertion",
      error: { code: "INSERTION_TARGET_CHANGED" },
    });
    const held = await f.store.read(f.project.id);
    expect(held.document.items).toHaveLength(0);
    expect(held.sources[0].status).toBe("available");
    await f.store.transaction(f.project.id, (p) => {
      p.document.tracks.find((t) => t.id === "audio")!.locked = false;
    });
    await Promise.all([
      f.service.resume(f.project.id, job.id),
      f.service.resume(f.project.id, job.id),
    ]);
    await f.service.waitForIdle(f.project.id, job.id);
    expect((await f.store.read(f.project.id)).document.items).toHaveLength(1);
    expect(f.adapter.submit).toHaveBeenCalledTimes(1);
    expect(f.adapter.download).toHaveBeenCalledTimes(1);
  });

  it("credential cleanup failure cannot reverse insertion or repeat a completed job", async () => {
    const gate = deferred<{ status: "succeeded"; tracks: (typeof track)[] }>();
    const f = await fixture({ poll: vi.fn(async () => gate.promise) }),
      job = await f.service.propose(f.project.id, f.request);
    await f.service.approve(f.project.id, job.id);
    await until(
      async () => (await f.service.get(f.project.id, job.id)).hasProviderTask,
    );
    const configFile = path.join(
      f.directory,
      "music-configs",
      job.id + ".json",
    );
    await rm(configFile);
    await mkdir(configFile);
    gate.resolve({ status: "succeeded", tracks: [track] });
    await f.service.waitForIdle(f.project.id, job.id);
    expect((await f.service.get(f.project.id, job.id)).status).toBe(
      "completed",
    );
    await f.service.recover();
    await f.service.resume(f.project.id, job.id);
    expect((await f.store.read(f.project.id)).revision).toBe(1);
    expect(f.adapter.submit).toHaveBeenCalledTimes(1);
  });

  it("publishes verified local bytes when their hash was already registered without an upload", async () => {
    const f = await fixture();
    const bytes = Buffer.from(await wav().arrayBuffer()),
      hash = createHash("sha256").update(bytes).digest("hex"),
      sourceId = `local:${hash}`;
    await f.store.transaction(f.project.id, (p) => {
      p.sources.push({
        sourceId,
        assetId: null,
        url: null,
        status: "local",
        fingerprint: hash,
        scheme: "sha256",
        byteLength: bytes.length,
        mimeType: "audio/wav",
        fileName: "existing.wav",
      });
    });
    const job = await f.service.propose(f.project.id, f.request);
    await f.service.approve(f.project.id, job.id);
    await f.service.waitForIdle(f.project.id, job.id);
    const p = await f.store.read(f.project.id);
    expect(p.sources).toHaveLength(1);
    expect(p.sources[0]).toMatchObject({
      status: "available",
      url: `/api/media/${p.id}/${encodeURIComponent(sourceId)}`,
    });
    expect((await f.service.get(p.id, job.id)).status).toBe("completed");
  });
  it("does not treat an HTML download or invented duration as audio evidence", async () => {
    const f = await fixture({
        download: vi.fn(
          async () =>
            new Blob(["<html>Not audio</html>"], { type: "audio/mpeg" }),
        ),
      }),
      job = await f.service.propose(f.project.id, f.request);
    await f.service.approve(f.project.id, job.id);
    await f.service.waitForIdle(f.project.id, job.id);
    expect(await f.service.get(f.project.id, job.id)).toMatchObject({
      status: "needs_attention",
      error: { code: "DOWNLOAD_FAILED" },
    });
    expect((await f.store.read(f.project.id)).document.items).toHaveLength(0);
  });
  it("does not regenerate or reinsert music after a manual undo", async () => {
    const f = await fixture(),
      job = await f.service.propose(f.project.id, f.request);
    await f.service.approve(f.project.id, job.id);
    await f.service.waitForIdle(f.project.id, job.id);
    await f.store.transaction(f.project.id, async (p) => {
      await commitDocument(p, p.past[0], false);
    });
    await f.service.resume(f.project.id, job.id);
    await f.service.approve(f.project.id, job.id);
    await f.service.recover();
    expect((await f.store.read(f.project.id)).document.items).toHaveLength(0);
    expect(f.adapter.submit).toHaveBeenCalledTimes(1);
  });
  it("validates stale project state and a changed target before any paid work", async () => {
    const f = await fixture();
    await expect(
      f.service.propose(f.project.id, { ...f.request, baseHash: "wrong" }),
    ).rejects.toThrow(/Save/);
    const job = await f.service.propose(f.project.id, f.request);
    await f.store.transaction(f.project.id, (p) => {
      p.document.tracks.find((t) => t.id === "audio")!.locked = true;
    });
    await expect(f.service.approve(f.project.id, job.id)).rejects.toThrow(
      /target changed/,
    );
    expect(f.adapter.submit).not.toHaveBeenCalled();
  });
  it("a killed process leaves a persisted submission fence and recovery never resubmits", async () => {
    const f = await fixture(),
      job = await f.service.propose(f.project.id, f.request);
    const child = spawn(
      process.execPath,
      [
        "--import",
        "tsx",
        "tests/fixtures/music-process.ts",
        f.directory,
        f.project.id,
        job.id,
      ],
      {
        cwd: process.cwd(),
        stdio: ["ignore", "pipe", "pipe"],
        env: { PATH: process.env.PATH, NODE_ENV: "test" },
      },
    );
    try {
      await new Promise<void>((resolve, reject) => {
        let stdout = "",
          stderr = "";
        child.stdout.on("data", (data) => {
          stdout += data;
          if (stdout.includes("SUBMIT_ENTERED")) resolve();
        });
        child.stderr.on("data", (data) => {
          stderr += data;
        });
        child.once("error", reject);
        child.once("exit", (code) =>
          reject(new Error(`Child exited ${code}: ${stderr}`)),
        );
      });
      child.kill("SIGKILL");
      await new Promise((resolve) => child.once("exit", resolve));
      const restored = new MusicService(
        new ProjectStore(f.directory),
        () => ({
          baseUrl: "https://api.kie.ai",
          apiKey: "replacement",
          model: "V6",
        }),
        f.adapter,
      );
      services.push(restored);
      await restored.recover();
      expect(await restored.get(f.project.id, job.id)).toMatchObject({
        status: "submission_unknown",
      });
      expect(f.adapter.submit).not.toHaveBeenCalled();
    } finally {
      if (child.exitCode === null && child.signalCode === null)
        child.kill("SIGKILL");
    }
  });
});
