import { afterEach, expect, it, vi } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { randomUUID } from "node:crypto";
import { AgentService } from "../apps/server/src/agent-service";
import type { ChatMessage } from "../packages/agent/src/types";
import {
  ProjectStore,
  commitDocument,
  snapshot,
} from "../apps/server/src/store";
import {
  isBasicEditingWorkflowRequest,
  type AgentAsrTask,
  type AgentSpeechPort,
} from "../apps/server/src/agent-speech";
import { EditingWorkflowService } from "../apps/server/src/editing-workflow";
import { createVideoProjectDocument } from "../packages/core/src/lib/video-project/document";

const roots: string[] = [];
afterEach(async () => {
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  );
});
const instruction =
  "Add English captions, then Chinese translations, style English red and Chinese white, highlight each growth number, and append an editable animated Made by DojoClip.com ending.";
const rawAsr = {
  text: "Growth rate 20%",
  language: "en",
  utterances: [
    {
      text: "Growth rate 20%",
      start_time_ms: 500,
      end_time_ms: 1500,
      words: [
        { text: "Growth", start_time_ms: 500, end_time_ms: 800 },
        { text: "rate", start_time_ms: 800, end_time_ms: 1000 },
        { text: "20%", start_time_ms: 1000, end_time_ms: 1500 },
      ],
    },
  ],
};
async function fixture(available = false) {
  const root = await mkdtemp(path.join(os.tmpdir(), "agent-speech-"));
  roots.push(root);
  const store = new ProjectStore(root);
  await store.init();
  const seed = await store.create();
  await store.transaction(seed.id, async (p) => {
    const document = createVideoProjectDocument({
      width: 640,
      height: 360,
      fps: 30,
      durationInFrames: 90,
    });
    document.assets.speech = {
      id: "speech",
      name: "Speech",
      type: "video",
      source: "local",
      durationSeconds: 3,
    };
    document.assets.logo = {
      id: "logo",
      type: "image",
      source: "local",
      name: "Imported logo",
      width: 20,
      height: 20,
    };
    document.sources.speech = { assetId: "speech", revision: "source-v1" };
    document.items.push({
      id: "clip",
      name: "Speech",
      trackId: "visual",
      node: {
        id: "clip",
        type: "video",
        assetId: "speech",
        from: 0,
        duration: 90,
      },
    });
    p.sources.push({
      sourceId: "speech",
      assetId: available ? "speech" : null,
      status: available ? "available" : "local",
      fingerprint: "a".repeat(64),
      scheme: "sha256",
      byteLength: 1000,
      mimeType: "audio/mpeg",
      fileName: "speech.mp3",
      url: null,
    });
    await commitDocument(p, document, false);
  });
  const p = await store.read(seed.id),
    tasks = new Map<string, AgentAsrTask>();
  const port: AgentSpeechPort = {
    defer: isBasicEditingWorkflowRequest,
    get: (id) => tasks.get(id),
    start: vi.fn(async (projectId, source) => {
      const operationId = `asr:${projectId}:${source.requestId}`;
      const prior = [...tasks.values()].find(
        (task) => task.operationId === operationId,
      );
      if (prior) return prior;
      const task: AgentAsrTask = {
        id: randomUUID(),
        project_id: projectId,
        asset_id: source.sourceId,
        sourceHash: source.fingerprint,
        operationId,
        status: "running",
      };
      tasks.set(task.id, task);
      return task;
    }),
  };
  const model = {
    complete: vi.fn(async (messages: ChatMessage[]) => {
      const user = JSON.parse(
        String(messages.find((message) => message.role === "user")!.content),
      );
      // This service regression verifies the complete instruction handoff. The
      // dependent-instruction scenario separately grades every editing outcome.
      expect(user.instruction).toBe(instruction);
      const evidenceId = Object.keys(user.document.evidence)[0];
      expect(evidenceId).toBeTruthy();
      return {
        text: "",
        calls: [
          {
            id: "caption",
            name: "propose_edit",
            arguments: JSON.stringify({
              outcome: "proposal",
              summary: "Caption proposal",
              commands: [
                {
                  type: "captionSource",
                  sourceItemId: "clip",
                  evidenceId,
                  itemId: "captions",
                  trackId: "visual",
                },
              ],
            }),
          },
        ],
      };
    }),
  };
  const agent = new AgentService(store, model, [], undefined, "review", port);
  const input = {
    operationId: "instruction",
    instruction,
    baseHash: p.documentHash,
    baseRevision: p.revision,
    scope: { kind: "project" },
    context: { selectedItemIds: ["clip"], playheadFrame: 0 },
  };
  return { root, store, p, tasks, port, model, agent, input };
}
async function waitFor(f: Awaited<ReturnType<typeof fixture>>, status: string) {
  await expect
    .poll(async () => {
      const run = (await f.store.read(f.p.id)).runs[0];
      if (run?.status === "failed" && status !== "failed")
        throw new Error(run.error?.message);
      return run?.status;
    })
    .toBe(status);
  // Allow the non-blocking launch cleanup to release its in-process fence.
  await new Promise((resolve) => setTimeout(resolve, 0));
  return (await f.store.read(f.p.id)).runs[0];
}
async function resume(
  f: Awaited<ReturnType<typeof fixture>>,
  agent = f.agent,
  cloudConsent?: boolean,
) {
  const p = await f.store.read(f.p.id);
  return agent.resume(p.id, p.runs[0].id, {
    operationId: "resume",
    baseHash: p.documentHash,
    baseRevision: p.revision,
    ...(cloudConsent ? { cloudConsent: true } : {}),
  });
}
async function readyTask(f: Awaited<ReturnType<typeof fixture>>) {
  await expect
    .poll(
      async () =>
        (await f.store.read(f.p.id)).runs[0]?.speechContinuation?.sources[0]
          ?.taskId,
    )
    .toBeTruthy();
  await new Promise((resolve) => setTimeout(resolve, 0));
  return [...f.tasks.values()][0];
}

it("waits for consent and local upload, deduplicates resumes, then stages evidence with the full instruction", async () => {
  const f = await fixture();
  const started = await f.agent.start(f.p.id, f.input);
  let run = await waitFor(f, "needs_evidence");
  expect(run).toMatchObject({
    cloudConsent: false,
    prerequisites: { status: "consent_required", assetIds: ["speech"] },
  });
  await resume(f, f.agent, true);
  await waitFor(f, "needs_evidence");
  expect(f.port.start).not.toHaveBeenCalled();
  await f.store.transaction(f.p.id, (p) => {
    p.sources[0].status = "available";
    p.sources[0].assetId = "speech";
  });
  await f.store.commit(f.p.id, {
    operationId: "consented-upload",
    baseHash: f.p.documentHash,
    baseRevision: f.p.revision,
    commands: [
      {
        type: "bindAsset",
        id: "speech",
        assetId: "speech",
        sourceRevision: "source-v1",
      },
    ],
  });
  await Promise.all(Array.from({ length: 8 }, () => resume(f)));
  const task = await readyTask(f);
  expect(f.port.start).toHaveBeenCalledTimes(1);
  expect(f.model.complete).not.toHaveBeenCalled();
  expect((await f.store.read(f.p.id)).document.evidence).toEqual({});
  task.status = "completed";
  task.raw_asr_result = rawAsr;
  await Promise.all(Array.from({ length: 8 }, () => resume(f)));
  run = await waitFor(f, "awaiting_review");
  expect(f.port.start).toHaveBeenCalledTimes(1);
  expect(f.model.complete).toHaveBeenCalledTimes(1);
  expect(run.request.document).toEqual(f.p.document);
  expect(run.proposal!.commands[0].type).toBe("addEvidence");
  expect((await f.store.read(f.p.id)).document.evidence).toEqual({});
  const review = await f.agent.review(f.p.id, started.run.id),
    latest = snapshot(await f.store.read(f.p.id));
  await f.agent.apply(f.p.id, started.run.id, {
    operationId: "apply",
    baseRevision: latest.revision,
    baseHash: latest.documentHash,
    reviewBasis: review.review.basis,
  });
  const applied = await f.store.read(f.p.id);
  expect(Object.values(applied.document.evidence)).toHaveLength(1);
  expect(applied.document.items.some((item) => item.id === "captions")).toBe(
    true,
  );
  await f.agent.undo(f.p.id, started.run.id, {
    operationId: "undo",
    baseHash: applied.documentHash,
    baseRevision: applied.revision,
  });
  expect((await f.store.read(f.p.id)).document.evidence).toEqual(
    applied.document.evidence,
  );
  expect(f.model.complete).toHaveBeenCalledTimes(1);
});

it("resumes the same completed ASR receipt after a host restart without another submission", async () => {
  const f = await fixture(true);
  await f.agent.start(f.p.id, { ...f.input, cloudConsent: true });
  const task = await readyTask(f);
  const stored = await f.store.read(f.p.id),
    requestId = stored.runs[0].speechContinuation!.sources[0].requestId;
  await f.store.transaction(f.p.id, (p) => {
    p.runs[0].status = "running";
    p.runs[0].phase = "preparing_speech";
  });
  const nextStore = new ProjectStore(f.root);
  await nextStore.init();
  await nextStore.recoverInterrupted();
  expect((await nextStore.read(f.p.id)).runs[0]).toMatchObject({
    status: "needs_evidence",
    speechContinuation: { sources: [{ requestId, taskId: task.id }] },
  });
  task.status = "completed";
  task.raw_asr_result = rawAsr;
  const restarted = new AgentService(
    nextStore,
    f.model,
    [],
    undefined,
    "review",
    f.port,
  );
  await resume(f, restarted);
  await waitFor(f, "awaiting_review");
  expect(f.port.start).toHaveBeenCalledTimes(1);
  expect(f.model.complete).toHaveBeenCalledTimes(1);
});

it("a failed or uncertain interrupted ASR receipt is terminal and is never resubmitted", async () => {
  const f = await fixture(true);
  await f.agent.start(f.p.id, { ...f.input, cloudConsent: true });
  const task = await readyTask(f);
  task.status = "failed";
  task.error_message = "Server restarted during provider work; not repeated.";
  await resume(f);
  expect(await waitFor(f, "failed")).toMatchObject({
    error: { message: task.error_message },
  });
  await resume(f);
  expect(f.port.start).toHaveBeenCalledTimes(1);
  expect(f.model.complete).not.toHaveBeenCalled();
});

it("rejects source drift and mismatched receipts before the model starts", async () => {
  for (const change of ["fingerprint", "receipt"] as const) {
    const f = await fixture(true);
    await f.agent.start(f.p.id, { ...f.input, cloudConsent: true });
    const task = await readyTask(f);
    task.status = "completed";
    task.raw_asr_result = rawAsr;
    if (change === "fingerprint")
      await f.store.transaction(f.p.id, (p) => {
        p.sources[0].fingerprint = "b".repeat(64);
      });
    else task.project_id = randomUUID();
    await resume(f);
    await waitFor(f, "failed");
    expect(f.port.start).toHaveBeenCalledTimes(1);
    expect(f.model.complete).not.toHaveBeenCalled();
    expect((await f.store.read(f.p.id)).documentHash).toBe(f.p.documentHash);
  }
});

it("keeps cancellation terminal when transcription later completes", async () => {
  const f = await fixture(true);
  const started = await f.agent.start(f.p.id, {
    ...f.input,
    cloudConsent: true,
  });
  const task = await readyTask(f);
  await f.agent.cancel(f.p.id, started.run.id);
  task.status = "completed";
  task.raw_asr_result = rawAsr;
  await resume(f);
  expect((await f.store.read(f.p.id)).runs[0].status).toBe("cancelled");
  expect(f.model.complete).not.toHaveBeenCalled();
  expect(f.port.start).toHaveBeenCalledTimes(1);
});

it("rechecks authoritative ASR evidence before applying a staged proposal", async () => {
  const f = await fixture(true);
  const started = await f.agent.start(f.p.id, {
    ...f.input,
    cloudConsent: true,
  });
  const task = await readyTask(f);
  task.status = "completed";
  task.raw_asr_result = rawAsr;
  await resume(f);
  await waitFor(f, "awaiting_review");
  const review = await f.agent.review(f.p.id, started.run.id);
  task.raw_asr_result = { ...rawAsr, text: "Forged receipt" };
  const latest = await f.store.read(f.p.id);
  await expect(
    f.agent.apply(f.p.id, started.run.id, {
      operationId: "apply",
      baseHash: latest.documentHash,
      baseRevision: latest.revision,
      reviewBasis: review.review.basis,
    }),
  ).rejects.toThrow(/differs from the provider receipt/);
  expect((await f.store.read(f.p.id)).documentHash).toBe(f.p.documentHash);
});

it("does not resume a model-started run after interruption", async () => {
  const f = await fixture(true);
  await f.agent.start(f.p.id, { ...f.input, cloudConsent: true });
  await readyTask(f);
  await f.store.transaction(f.p.id, (p) => {
    p.runs[0].status = "running";
    p.runs[0].speechContinuation!.modelStarted = true;
  });
  await f.store.recoverInterrupted();
  expect((await f.store.read(f.p.id)).runs[0]).toMatchObject({
    status: "failed",
    phase: "interrupted",
  });
  await resume(f);
  expect(f.model.complete).not.toHaveBeenCalled();
  expect(f.port.start).toHaveBeenCalledTimes(1);
});

it("reuses the same ASR receipt across a clarification child while preserving the original request", async () => {
  const f = await fixture(true);
  f.model.complete.mockImplementationOnce(async () => ({
    text: "",
    calls: [
      {
        id: "question",
        name: "ask_user",
        arguments: JSON.stringify({
          id: "ending-style",
          question: "Which ending style?",
          allowText: true,
        }),
      },
    ],
  }));
  const started = await f.agent.start(f.p.id, {
    ...f.input,
    cloudConsent: true,
  });
  const task = await readyTask(f);
  await f.store.commit(f.p.id, {
    operationId: "upload-before-question",
    baseHash: f.p.documentHash,
    baseRevision: f.p.revision,
    commands: [
      {
        type: "bindAsset",
        id: "speech",
        assetId: "speech",
        sourceRevision: "source-v1",
      },
    ],
  });
  task.status = "completed";
  task.raw_asr_result = rawAsr;
  await resume(f);
  const parent = await waitFor(f, "needs_input");
  const promoted = await f.store.read(f.p.id);
  expect(parent.baseHash).toBe(f.p.documentHash);
  expect(promoted.documentHash).not.toBe(parent.baseHash);
  const child = await f.agent.answer(f.p.id, started.run.id, {
    operationId: "answer",
    questionId: parent.clarification!.id,
    text: "Use a clean pop animation",
    baseHash: promoted.documentHash,
    baseRevision: promoted.revision,
  });
  await expect
    .poll(async () => (await f.store.read(f.p.id)).runs[1]?.status)
    .toBe("awaiting_review");
  const completed = (await f.store.read(f.p.id)).runs[1];
  expect(completed.id).toBe(child.run.id);
  expect(completed.cloudConsent).toBe(true);
  expect(completed.instruction).toBe(instruction);
  expect(completed.speechContinuation!.sources[0].taskId).toBe(task.id);
  expect(f.port.start).toHaveBeenCalledTimes(1);
  expect(f.model.complete).toHaveBeenCalledTimes(2);
  expect((await f.store.read(f.p.id)).documentHash).toBe(promoted.documentHash);
});

it("stops a waiting request after canonical manual edits instead of polling stale work forever", async () => {
  const f = await fixture(true);
  await f.agent.start(f.p.id, { ...f.input, cloudConsent: true });
  await readyTask(f);
  await f.store.commit(f.p.id, {
    operationId: "manual",
    baseHash: f.p.documentHash,
    baseRevision: f.p.revision,
    commands: [
      {
        type: "set",
        target: { kind: "item", itemId: "clip" },
        path: ["name"],
        value: "Manually renamed",
      },
    ],
  });
  await resume(f);
  expect((await f.store.read(f.p.id)).runs[0]).toMatchObject({
    status: "stale",
    error: { code: "PROJECT_CHANGED" },
  });
  expect(f.model.complete).not.toHaveBeenCalled();
  expect(f.port.start).toHaveBeenCalledTimes(1);
});

it("records a submitted ASR receipt without advancing when cancellation races the handoff", async () => {
  const f = await fixture(true),
    original = f.port.start;
  let release!: () => void;
  const pending = new Promise<void>((resolve) => {
    release = resolve;
  });
  f.port.start = vi.fn(async (projectId, source) => {
    const task = await original(projectId, source);
    await pending;
    return task;
  });
  const started = await f.agent.start(f.p.id, {
    ...f.input,
    cloudConsent: true,
  });
  await expect.poll(() => f.tasks.size).toBe(1);
  await f.agent.cancel(f.p.id, started.run.id);
  release();
  await expect
    .poll(
      async () =>
        (await f.store.read(f.p.id)).runs[0].speechContinuation!.sources[0]
          .taskId,
    )
    .toBe([...f.tasks.values()][0].id);
  await resume(f);
  expect((await f.store.read(f.p.id)).runs[0].status).toBe("cancelled");
  expect(f.model.complete).not.toHaveBeenCalled();
  expect(f.port.start).toHaveBeenCalledTimes(1);
});

it("preserves the approval card before ASR for the fully represented basic workflow", async () => {
  const f = await fixture(),
    workflows = new EditingWorkflowService(f.store, (id) => f.tasks.get(id));
  const basic =
    "Join these clips, add this logo, generate captions, translate them into Spanish, then export.";
  const model = {
    complete: vi.fn(async () => ({
      text: "",
      calls: [
        {
          id: "workflow",
          name: "prepare_editing_workflow",
          arguments: JSON.stringify({
            clipIds: ["clip"],
            logoAssetId: "logo",
            generateCaptions: true,
            sourceLanguage: "en",
            translationLanguage: "es",
            exportVideo: true,
          }),
        },
      ],
    })),
  };
  const agent = new AgentService(
    f.store,
    model,
    [],
    (projectId, runId) => [workflows.tool(projectId, runId)],
    "review",
    f.port,
  );
  await agent.start(f.p.id, {
    ...f.input,
    instruction: basic,
    cloudConsent: true,
  });
  const run = await waitFor(f, "completed");
  const project = await f.store.read(f.p.id);
  expect(run.instruction).toBe(basic);
  expect(Object.values(project.editingWorkflows!)[0].status).toBe(
    "awaiting_approval",
  );
  expect(f.port.start).not.toHaveBeenCalled();
  expect(project.documentHash).toBe(f.p.documentHash);
  expect(isBasicEditingWorkflowRequest({ ...run.request, instruction })).toBe(
    false,
  );
  expect(
    isBasicEditingWorkflowRequest({
      ...run.request,
      instruction: basic.replace(
        "then export",
        "use red subtitles, then export",
      ),
    }),
  ).toBe(false);
  expect(
    isBasicEditingWorkflowRequest({
      ...run.request,
      instruction: basic.replace(
        "then export",
        "highlight every growth number, then export",
      ),
    }),
  ).toBe(false);
});

it("rejects source-revision or unrelated asset metadata changes disguised as upload promotion", async () => {
  for (const tamper of ["revision", "metadata"] as const) {
    const f = await fixture();
    await f.agent.start(f.p.id, { ...f.input, cloudConsent: true });
    await waitFor(f, "needs_evidence");
    await f.store.transaction(f.p.id, async (p) => {
      p.sources[0].status = "available";
      p.sources[0].assetId = "speech";
      const document = structuredClone(p.document);
      document.assets.speech = {
        ...document.assets.speech,
        source: "project",
        assetId: "speech",
      };
      if (tamper === "revision")
        document.sources.speech.revision = "unowned-revision";
      else document.assets.speech.name = "Changed source metadata";
      await commitDocument(p, document);
    });
    await resume(f);
    expect((await f.store.read(f.p.id)).runs[0].status).toBe("stale");
    expect(f.port.start).not.toHaveBeenCalled();
    expect(f.model.complete).not.toHaveBeenCalled();
  }
});
