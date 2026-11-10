import { afterEach, expect, it, vi } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import os from "node:os";
import path from "node:path";
import {
  createEditStagePlan,
  parseEditStageEvent,
  parseEditStagePlan,
  type EditStagePlan,
} from "../packages/agent-kit/src/index";
import {
  createLocalEditStagePort,
  createLocalStageCheckpointPort,
  localEditStageBinding,
} from "../apps/server/src/edit-stage-store";
import { ProjectStore, type StoredRun } from "../apps/server/src/store";
import {
  runToolLoop,
  type LoopCheckpointPort,
} from "../packages/agent-loop/src/index";
import { hashVideoProjectDocument } from "../packages/core/src/lib/video-project/document";
const roots: string[] = [];
afterEach(async () => {
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  );
});
const now = "2026-11-10T00:00:00.000Z";
async function fixture() {
  const directory = await mkdtemp(path.join(os.tmpdir(), "dojo-stages-"));
  roots.push(directory);
  const store = new ProjectStore(directory);
  await store.init();
  const project = await store.create();
  project.document.assets.original = {
    id: "original",
    name: "Original input",
    type: "video",
    source: "local",
    durationSeconds: 6,
  };
  project.document.sources.original = {
    assetId: "original",
    revision: "original-revision",
  };
  project.documentHash = await hashVideoProjectDocument(project.document);
  await store.save(project);
  const run: StoredRun = {
    id: randomUUID(),
    operationId: "stage-run",
    status: "running",
    phase: "stages",
    instruction: "Caption every genuine cue and retain the requested colors.",
    cloudConsent: false,
    baseRevision: project.revision,
    baseHash: project.documentHash,
    context: { selectedItemIds: [], playheadFrame: 0 },
    proposal: null,
    prerequisites: null,
    error: null,
    createdAt: now,
    updatedAt: now,
    scope: { kind: "project" },
    reviewBasisRequired: true,
    agentProfile: "local-editor-v5",
    events: [],
    requestHash: "original-request",
    request: {
      contract: "video-project-commands",
      version: 1,
      baseRevision: project.revision,
      baseHash: project.documentHash,
      document: project.document,
      context: { selectedItemIds: [], playheadFrame: 0 },
      authoring: { version: 1, scope: { kind: "project" } },
    },
  };
  await store.transaction(project.id, (p) => {
    p.runs.push(run);
  });
  const binding = await localEditStageBinding(
    await store.read(project.id),
    run,
    "frozen-provider:model",
  );
  const plan = await createEditStagePlan({
    id: "complete-edit",
    binding,
    instruction: run.instruction,
    requirements: [
      { id: "all-captions", kind: "item_present", itemId: "original" },
    ],
    limits: {
      modelCalls: 16,
      toolCalls: 24,
      outputTokens: 16384,
      attempts: 32,
      expiresAt: "2099-01-01T00:00:00.000Z",
    },
    stages: [
      {
        id: "evidence",
        kind: "evidence",
        execution: "host",
        dependencies: [],
        inputs: [],
      },
      {
        id: "captions",
        kind: "caption_batch",
        execution: "model",
        dependencies: ["evidence"],
        inputs: [],
      },
      {
        id: "assemble",
        kind: "assemble",
        execution: "host",
        dependencies: ["captions"],
        inputs: [],
      },
      {
        id: "verify",
        kind: "verify",
        execution: "host",
        dependencies: ["assemble"],
        inputs: [],
      },
    ],
  });
  const input = {
    store,
    projectId: project.id,
    runId: run.id,
    binding,
    now: () => now,
  };
  const port = createLocalEditStagePort(input);
  expect(await port.load()).toBeNull();
  await port.initialize(plan);
  return { store, project, run, binding, plan, port, input };
}
const claim = (stageId = "evidence", attemptId = "evidence-attempt") => ({
  type: "claim" as const,
  operationId: `claim:${attemptId}`,
  stageId,
  attemptId,
  checkpointId: `checkpoint:${attemptId}`,
});
async function evidence(f: Awaited<ReturnType<typeof fixture>>) {
  const started = await f.port.transition(claim(), 0);
  const ref = await f.port.putArtifact("evidence", {
    asrTaskId: "completed-receipt",
    words: [{ id: "word-1", text: "Genuine", startMs: 0, endMs: 100 }],
  });
  await f.port.transition(
    {
      type: "complete",
      operationId: "evidence-completed",
      stageId: "evidence",
      attemptId: "evidence-attempt",
      outputs: [ref],
    },
    started.plan.revision,
  );
  return ref;
}
it("round-trips pending/completed/failed plans and immutable artifacts through a fresh local store", async () => {
  const f = await fixture();
  expect(await f.port.load()).toEqual(f.plan);
  expect((await f.port.initialize(f.plan)).created).toBe(false);
  const ref = await evidence(f);
  const start = await f.port.transition(
    claim("captions", "caption-attempt"),
    2,
  );
  await f.port.transition(
    {
      type: "fail",
      operationId: "known-failure",
      stageId: "captions",
      attemptId: "caption-attempt",
      failure: {
        code: "INPUT_MISSING",
        message: "The final translation batch is missing.",
      },
    },
    start.plan.revision,
  );
  const reopened = createLocalEditStagePort({
    ...f.input,
    store: new ProjectStore(f.store.directory),
  });
  expect(await reopened.load()).toMatchObject({
    status: "failed",
    stages: [
      { status: "completed" },
      { status: "failed" },
      { status: "pending" },
      { status: "pending" },
    ],
  });
  expect(await reopened.readArtifact(ref)).toMatchObject({
    asrTaskId: "completed-receipt",
  });
  expect((await f.store.read(f.project.id)).revision).toBe(f.project.revision);
});
it("applies one concurrent wake and returns an idempotent replay without another effect", async () => {
  const f = await fixture(),
    event = claim();
  const results = await Promise.all([
    f.port.transition(event, 0),
    f.port.transition(event, 0),
  ]);
  expect(results.map((r) => r.applied).sort()).toEqual([false, true]);
  expect((await f.port.load())?.attempts).toHaveLength(1);
  await expect(
    f.port.transition({ ...event, attemptId: "another-attempt" }, 0),
  ).rejects.toThrow(/reused/);
  await expect(
    f.port.transition(claim("captions", "too-early"), 1),
  ).rejects.toThrow(/not ready/);
});
it("retains completed paid outputs after cancellation and accepts a late receipt without advancing", async () => {
  const f = await fixture(),
    started = await f.port.transition(claim(), 0);
  const cancelled = await f.port.transition(
    { type: "cancel", operationId: "cancel" },
    started.plan.revision,
  );
  const ref = await f.port.putArtifact("provider-receipt", {
    taskId: "completed-once",
    assetId: "stored-output",
    approvedInputHash: "frozen",
  });
  const event = {
    type: "complete" as const,
    operationId: "late-completion",
    stageId: "evidence",
    attemptId: "evidence-attempt",
    outputs: [ref],
  };
  const completed = await f.port.transition(event, cancelled.plan.revision);
  expect(completed.plan.status).toBe("cancelled");
  expect(completed.plan.stages[0]).toMatchObject({
    status: "cancelled",
    outputs: [ref],
  });
  expect(
    (await f.port.transition(event, cancelled.plan.revision)).applied,
  ).toBe(false);
  expect(await f.port.readArtifact(ref)).toMatchObject({
    taskId: "completed-once",
  });
  await expect(
    f.port.transition(
      claim("captions", "cancelled-attempt"),
      completed.plan.revision,
    ),
  ).rejects.toThrow(/cannot start/);
});
it("rejects changed sources, run ownership and tampered artifact hashes while retaining saved receipts", async () => {
  const f = await fixture(),
    ref = await evidence(f);
  await f.store.transaction(f.project.id, (p) => {
    p.document.sources.original.revision = "new-source";
  });
  await expect(
    f.port.transition(claim("captions", "caption-attempt"), 2),
  ).rejects.toThrow(/source.*binding changed/);
  expect(await f.port.readArtifact(ref)).toMatchObject({
    asrTaskId: "completed-receipt",
  });
  await expect(
    f.port.readArtifact({ ...ref, runId: randomUUID() }),
  ).rejects.toThrow(/another run/);
  await f.store.transaction(f.project.id, (p) => {
    p.editStagePlans![f.run.id].artifacts[ref.id].value = { replaced: true };
  });
  await expect(f.port.readArtifact(ref)).rejects.toThrow(/content\/byte/);
});
it("rejects malformed, cyclic, incomplete or forged completed definitions", async () => {
  const f = await fixture();
  for (const alter of [
    (p: EditStagePlan) => {
      p.stages[0].dependencies = ["verify"];
    },
    (p: EditStagePlan) => {
      p.stages[0].status = "completed";
    },
    (p: EditStagePlan) => {
      p.status = "completed";
    },
    (p: EditStagePlan) => {
      p.usage.outputTokens = 1;
    },
    (p: EditStagePlan) => {
      p.limits.outputTokens = 0;
    },
  ]) {
    const changed = structuredClone(f.plan);
    alter(changed);
    expect(() => parseEditStagePlan(changed)).toThrow();
  }
  await expect(
    f.port.initialize({ ...f.plan, instruction: "Alter the frozen task." }),
  ).rejects.toThrow(/instruction/);
  for (const event of [
    { type: "auto-retry", operationId: "bad" },
    { type: "cancel", operationId: "bad", provider: "changed" },
    { type: "claim", operationId: "bad", stageId: "evidence" },
  ])
    expect(() => parseEditStageEvent(event)).toThrow();
});
it("atomically checkpoints paid usage and replays a saved model return without another model request", async () => {
  const f = await fixture();
  await evidence(f);
  const attemptId = "caption-attempt",
    checkpointId = `${f.run.id}:${attemptId}`;
  await f.port.transition(
    {
      type: "claim",
      operationId: "claim-caption",
      stageId: "captions",
      attemptId,
      checkpointId,
    },
    2,
  );
  const saved = createLocalStageCheckpointPort({
    ...f.input,
    stageId: "captions",
    attemptId,
  });
  let crash = true;
  const checkpoint: LoopCheckpointPort = {
    ...saved,
    save: async (next, revision) => {
      await saved.save(next, revision);
      if (next.phase === "model-returned" && crash) {
        crash = false;
        throw new Error("Crash after paid reply and usage");
      }
    },
  };
  const model = {
    identity: f.binding.modelIdentity,
    complete: vi.fn(async () => {
      expect((await f.port.load())?.usage.modelCalls).toBe(1);
      return {
        text: "",
        calls: [{ id: "batch-call", name: "save_batch", arguments: "{}" }],
        usage: { inputTokens: 10, outputTokens: 12 },
      };
    }),
  };
  const execute = vi.fn(async () => ({
    kind: "terminal" as const,
    result: "batch-artifact",
  }));
  const options = {
    checkpoint,
    model,
    messages: [{ role: "user" as const, content: f.run.instruction }],
    tools: [
      {
        name: "save_batch",
        description: "Persist exact batch",
        parameters: { type: "object" },
        replaySafe: true,
        execute,
      },
    ],
    signal: new AbortController().signal,
    answer: async (text: string) => text,
    maxSteps: 8,
    maxToolCalls: 12,
    maxOutputTokens: 16384,
  };
  await expect(runToolLoop(options)).rejects.toThrow(
    "Crash after paid reply and usage",
  );
  expect((await f.port.load())?.usage).toMatchObject({
    modelCalls: 1,
    inputTokens: 10,
    outputTokens: 12,
  });
  expect((await runToolLoop({ ...options, checkpoint: saved })).result).toBe(
    "batch-artifact",
  );
  expect(model.complete).toHaveBeenCalledTimes(1);
  expect(execute).toHaveBeenCalledTimes(1);
  expect((await f.port.load())?.usage).toMatchObject({
    modelCalls: 1,
    toolCalls: 1,
    outputTokens: 12,
  });
});
it("binds original content and caption inputs while allowing cloud registration, generated outputs and appearance edits", async () => {
  const f = await fixture(),
    project = await f.store.read(f.project.id),
    run = project.runs[0];
  project.sources.push({
    sourceId: "original",
    assetId: null,
    fingerprint: "a".repeat(64),
    scheme: "sha256",
    byteLength: 100,
    mimeType: "video/mp4",
    fileName: "input.mp4",
    url: null,
    status: "local",
  });
  project.document.items.push({
    id: "display-input",
    name: "Manual original",
    trackId: "visual",
    node: {
      id: "display-input",
      type: "text",
      from: 0,
      duration: 180,
      text: "Display",
      style: { color: "#ffffff" },
    },
    caption: {
      mode: "sentence",
      highlightColor: "#ffff00",
      direction: "ltr",
      cues: [
        {
          id: "manual-1",
          text: "Current manual input",
          startMs: 0,
          endMs: 1000,
        },
      ],
      language: "en",
      role: "original",
      sourceItemId: "original-video",
      pairedItemId: "translation",
    },
  });
  run.request.document = structuredClone(project.document);
  const before = await localEditStageBinding(
    project,
    run,
    f.binding.modelIdentity,
  );
  project.sources[0].assetId = "backend-upload-123";
  project.sources[0].status = "available";
  project.sources.push({
    ...project.sources[0],
    sourceId: "generated-output",
    fingerprint: "b".repeat(64),
  });
  project.document.assets.generated = {
    id: "generated",
    name: "New output",
    type: "image",
    source: "local",
  };
  project.document.sources.generated = {
    assetId: "generated",
    revision: "new-output",
  };
  project.document.items[0].node.style = { color: "#ff0000" };
  expect(
    (await localEditStageBinding(project, run, f.binding.modelIdentity))
      .sourceHash,
  ).toBe(before.sourceHash);
  project.document.items[0].caption!.cues[0].text =
    "Changed original display input";
  expect(
    (await localEditStageBinding(project, run, f.binding.modelIdentity))
      .sourceHash,
  ).not.toBe(before.sourceHash);
  project.document.items[0].caption!.cues[0].text = "Current manual input";
  project.sources[0].fingerprint = "c".repeat(64);
  expect(
    (await localEditStageBinding(project, run, f.binding.modelIdentity))
      .sourceHash,
  ).not.toBe(before.sourceHash);
});
it("preserves exact fractional canonical artifact bytes through disk reload", async () => {
  const f = await fixture(),
    value = {
      sourceRange: { startMs: 0.30000000000000004, endMs: 1000.1234567890123 },
      playbackRate: 1.2345678901234567,
    };
  const ref = await f.port.putArtifact("evidence", value);
  const reopened = createLocalEditStagePort({
    ...f.input,
    store: new ProjectStore(f.store.directory),
  });
  expect(await reopened.readArtifact(ref)).toEqual(value);
  expect(JSON.stringify(await reopened.readArtifact(ref))).toContain(
    "0.30000000000000004",
  );
});
