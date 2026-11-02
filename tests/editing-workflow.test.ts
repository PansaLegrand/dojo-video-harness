import { afterEach, expect, it } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { randomUUID } from "node:crypto";
import {
  EditingWorkflowService,
  assembleWorkflowCandidate,
  workflowUtterances,
  type WorkflowTaskReceipt,
} from "../apps/server/src/editing-workflow";
import { AgentService } from "../apps/server/src/agent-service";
import { ProjectStore, commitDocument } from "../apps/server/src/store";
import {
  createVideoProjectDocument,
  canonicalSerialize,
} from "../packages/core/src/lib/video-project/document";
const dirs: string[] = [];
afterEach(async () => {
  await Promise.all(
    dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })),
  );
});
const instruction =
  "Join these clips, add this logo, generate captions, translate them into Spanish, then export.";
async function fixture() {
  const dir = await mkdtemp(path.join(os.tmpdir(), "workflow-test-"));
  dirs.push(dir);
  const store = new ProjectStore(dir);
  await store.init();
  const seed = await store.create();
  await store.transaction(seed.id, async (p) => {
    const d = createVideoProjectDocument({
      width: 320,
      height: 180,
      fps: 30,
      durationInFrames: 180,
    });
    for (const id of ["a", "b"]) {
      d.assets[id] = {
        id,
        type: "video",
        source: "local",
        name: id,
        durationSeconds: 4,
      };
      d.sources[id] = { assetId: id, revision: `revision-${id}` };
      d.items.push({
        id: `clip-${id}`,
        name: `Clip ${id}`,
        trackId: "visual",
        node: {
          id: `clip-${id}`,
          type: "video",
          assetId: id,
          from: id === "a" ? 0 : 90,
          duration: 60,
          videoStartTime: id === "a" ? 0 : 1,
          volume: 1,
        },
      });
      p.sources.push({
        sourceId: id,
        assetId: id,
        url: null,
        status: "local",
        fingerprint: (id === "a" ? "a" : "b").repeat(64),
        scheme: "sha256",
        byteLength: 1000,
        mimeType: "video/mp4",
        fileName: `${id}.mp4`,
      });
    }
    d.assets.logo = {
      id: "logo",
      type: "image",
      source: "local",
      name: "Logo",
      width: 20,
      height: 20,
    };
    await commitDocument(p, d, false);
  });
  const tasks = new Map<string, WorkflowTaskReceipt>(),
    service = new EditingWorkflowService(store, (id) => tasks.get(id));
  const agent = new AgentService(
    store,
    {
      complete: async () => ({
        text: "",
        calls: [
          {
            id: randomUUID(),
            name: "prepare_editing_workflow",
            arguments: JSON.stringify({
              clipIds: ["clip-a", "clip-b"],
              logoAssetId: "logo",
              generateCaptions: true,
              sourceLanguage: "en",
              translationLanguage: "es",
              exportVideo: true,
            }),
          },
        ],
      }),
    },
    [],
    (p, r) => [service.tool(p, r)],
  );
  const before = await store.read(seed.id);
  const started = await agent.start(seed.id, {
    operationId: randomUUID(),
    instruction,
    baseRevision: before.revision,
    baseHash: before.documentHash,
    context: { selectedItemIds: [], playheadFrame: 0 },
    scope: { kind: "project" },
  });
  for (let i = 0; i < 100; i++) {
    const p = await store.read(seed.id);
    if (p.runs[0].status === "completed") break;
    await new Promise((r) => setTimeout(r, 5));
  }
  const plan = (await service.list(seed.id))[0];
  expect(plan).toBeDefined();
  const approve = () =>
    service.approve(seed.id, plan.id, {
      baseRevision: before.revision,
      baseHash: before.documentHash,
      sourceConsent: true,
    });
  function receipts() {
    return plan.sources.map((source) => {
      const taskId = randomUUID();
      tasks.set(taskId, {
        id: taskId,
        project_id: seed.id,
        asset_id: source.sourceId,
        sourceHash: source.fingerprint,
        operationId: `asr:${seed.id}:${source.requestId}`,
        status: "completed",
        raw_asr_result: {
          text: "Alpha. Beta.",
          language: "en",
          utterances: [
            {
              text: "Alpha. Beta.",
              start_time_ms: 100,
              end_time_ms: 1600,
              words: [
                { text: "Alpha.", start_time_ms: 100, end_time_ms: 600 },
                { text: "Beta.", start_time_ms: 1100, end_time_ms: 1600 },
              ],
            },
          ],
        },
      });
      return { assetId: source.assetId, taskId };
    });
  }
  return {
    dir,
    store,
    service,
    agent,
    tasks,
    projectId: seed.id,
    runId: started.run.id,
    before,
    plan,
    approve,
    receipts,
  };
}
async function prepare(f: Awaited<ReturnType<typeof fixture>>) {
  await f.approve();
  const asr = f.receipts();
  const candidates = await f.service.captions(f.projectId, f.plan.id, { asr });
  const translations = candidates.captions.map((caption) => {
    const taskId = randomUUID(),
      requestId = f.plan.translations[caption.itemId],
      utterances = workflowUtterances(caption.cues);
    f.tasks.set(taskId, {
      id: taskId,
      project_id: f.projectId,
      status: "completed",
      operationId: `translation:${f.projectId}:${requestId}`,
      requestHash: canonicalSerialize({
        v: {
          project_id: f.projectId,
          request_id: requestId,
          target_language: "es",
          utterances,
        },
        model: "fixture",
        base: "fixture",
      }),
      output_subtitle_data: {
        utterances: utterances.map((cue) => ({
          ...cue,
          text: `ES ${cue.text}`,
        })),
      },
    });
    return { itemId: caption.itemId, taskId };
  });
  return { asr, translations };
}
it("one instruction selects the actual workflow tool and keeps every project edit behind Compare/Apply", async () => {
  const f = await fixture();
  expect(f.plan.input.clipIds).toEqual(["clip-a", "clip-b"]);
  expect((await f.store.read(f.projectId)).document).toEqual(f.before.document);
  const receipts = await prepare(f);
  await f.service.complete(f.projectId, f.plan.id, receipts);
  const staged = await f.store.read(f.projectId);
  expect(staged.document).toEqual(f.before.document);
  expect(staged.runs[0].status).toBe("awaiting_review");
  const reviewed = await f.agent.review(f.projectId, f.runId);
  const applied = await f.agent.apply(f.projectId, f.runId, {
    operationId: randomUUID(),
    baseRevision: staged.revision,
    baseHash: staged.documentHash,
    reviewBasis: reviewed.review.basis,
  });
  expect(
    applied.document.items.find((x) => x.id === "clip-b")!.node,
  ).toMatchObject({ from: 60, duration: 60, videoStartTime: 1 });
  expect(
    applied.document.items.filter((x) => x.node.type === "img"),
  ).toHaveLength(1);
  expect(Object.keys(applied.document.evidence)).toHaveLength(2);
  const captions = applied.document.items.filter((x) => x.caption);
  expect(captions).toHaveLength(2);
  expect(
    captions.every(
      (x) =>
        x.caption?.role === "translation" &&
        x.caption.mode === "sentence" &&
        x.caption.cues.every((c) => c.text.startsWith("ES ") && !c.words),
    ),
  ).toBe(true);
  expect(applied.document.format.durationInFrames).toBe(120);
  expect((await f.service.list(f.projectId))[0].applied).toMatchObject({
    revision: applied.revision,
    documentHash: applied.documentHash,
  });
});
it("requires consent and rejects stale approval before any provider actions", async () => {
  const f = await fixture();
  await expect(
    f.service.approve(f.projectId, f.plan.id, {
      baseRevision: f.before.revision,
      baseHash: f.before.documentHash,
      sourceConsent: false,
    }),
  ).rejects.toThrow();
  await f.store.commit(f.projectId, {
    operationId: "manual",
    baseRevision: f.before.revision,
    baseHash: f.before.documentHash,
    commands: [{ type: "moveItem", id: "clip-a", from: 1 }],
  });
  await expect(f.approve()).rejects.toThrow(/changed/);
  expect(f.tasks.size).toBe(0);
});
it("fails closed on forged ASR identity and altered translation timing", async () => {
  const f = await fixture();
  await f.approve();
  const asr = f.receipts();
  f.tasks.get(asr[0].taskId)!.sourceHash = "wrong";
  await expect(
    f.service.captions(f.projectId, f.plan.id, { asr }),
  ).rejects.toThrow(/ASR receipt/);
  const g = await fixture(),
    receipts = await prepare(g);
  (
    g.tasks.get(receipts.translations[0].taskId)!.output_subtitle_data as {
      utterances: Array<{ end_time_ms: number }>;
    }
  ).utterances[0].end_time_ms += 100;
  await expect(
    g.service.complete(g.projectId, g.plan.id, receipts),
  ).rejects.toThrow(/timing/);
  expect((await g.store.read(g.projectId)).documentHash).toBe(
    g.before.documentHash,
  );
});
it("persists the approved plan through restart and replays completion without duplicating captions", async () => {
  const f = await fixture(),
    receipts = await prepare(f);
  const restartedStore = new ProjectStore(f.dir),
    restarted = new EditingWorkflowService(restartedStore, (id) =>
      f.tasks.get(id),
    );
  await restartedStore.init();
  expect((await restarted.list(f.projectId))[0].status).toBe("approved");
  await restarted.complete(f.projectId, f.plan.id, receipts);
  const p = await f.store.read(f.projectId);
  await restarted.complete(f.projectId, f.plan.id, receipts);
  expect((await f.store.read(f.projectId)).runs[0].proposal).toEqual(
    p.runs[0].proposal,
  );
  await expect(
    restarted.complete(f.projectId, f.plan.id, {
      ...receipts,
      translations: [],
    }),
  ).rejects.toThrow(/completion changed/);
});
it("cancel fences completion and cannot leave an actionable chat proposal", async () => {
  const f = await fixture(),
    receipts = await prepare(f);
  await f.service.cancel(f.projectId, f.plan.id);
  await expect(
    f.service.complete(f.projectId, f.plan.id, receipts),
  ).rejects.toThrow();
  expect((await f.store.read(f.projectId)).runs[0].status).toBe("cancelled");
});
it("cannot claim an export without an applied matching completed output receipt", async () => {
  const f = await fixture();
  await expect(
    f.service.exported(f.projectId, f.plan.id, { exportId: randomUUID() }),
  ).rejects.toThrow(/Export must/);
});
it("individual concatenate and image-overlay commands preserve source clocks and imported asset identity", async () => {
  const f = await fixture();
  const joined = assembleWorkflowCandidate(f.before.document, {
    id: f.plan.id,
    input: { ...f.plan.input, logoAssetId: undefined, generateCaptions: false },
  });
  expect(
    joined.document.items.map((x) => ({
      id: x.id,
      from: x.node.from,
      source: x.node.videoStartTime,
    })),
  ).toEqual([
    { id: "clip-a", from: 0, source: 0 },
    { id: "clip-b", from: 60, source: 1 },
  ]);
  const overlay = assembleWorkflowCandidate(f.before.document, {
    id: f.plan.id,
    input: { ...f.plan.input, generateCaptions: false },
  });
  const logo = overlay.document.items.find((x) => x.node.type === "img")!;
  expect(logo.node).toMatchObject({ assetId: "logo", from: 0, duration: 120 });
  expect(overlay.document.assets.logo).toEqual(f.before.document.assets.logo);
});

it("ordinary chat cancellation fences approved provider calls and receipt completion", async () => {
  const f = await fixture();
  await f.approve();
  await f.service.authorizeProviderRequest(
    f.projectId,
    f.plan.sources[0].requestId,
  );
  await f.agent.cancel(f.projectId, f.runId);
  await expect(
    f.service.authorizeProviderRequest(
      f.projectId,
      f.plan.sources[0].requestId,
    ),
  ).rejects.toThrow(/no longer/);
  await expect(
    f.service.captions(f.projectId, f.plan.id, { asr: f.receipts() }),
  ).rejects.toThrow(/no longer/);
  await expect(f.approve()).rejects.toThrow(/no longer/);
});
it("an approved workflow must be cancelled before archiving its project", async () => {
  const f = await fixture();
  await f.approve();
  await expect(f.store.archive(f.projectId)).rejects.toThrow();
  await f.service.cancel(f.projectId, f.plan.id);
  await expect(f.store.archive(f.projectId)).resolves.toBeDefined();
});
it("workflow completion accepts only the exact applied export revision and replays one receipt", async () => {
  const f = await fixture(),
    receipts = await prepare(f);
  await f.service.complete(f.projectId, f.plan.id, receipts);
  const review = await f.agent.review(f.projectId, f.runId);
  const current = await f.store.read(f.projectId);
  const applied = await f.agent.apply(f.projectId, f.runId, {
    operationId: randomUUID(),
    baseRevision: current.revision,
    baseHash: current.documentHash,
    reviewBasis: review.review.basis,
  });
  const { prepareExport, finishExport } = await import(
    "../apps/server/src/exports"
  );
  const exportId = randomUUID();
  await prepareExport(f.store, f.projectId, {
    phase: "prepare",
    exportId,
    documentRevision: applied.revision,
    width: 320,
    height: 180,
    fps: 30,
    durationInFrames: 120,
    resolution: "original",
    sourceType: "editor_export",
  });
  await finishExport(f.store, f.projectId, exportId, 100, "a".repeat(64));
  await f.store.transaction(f.projectId, (p) => {
    p.exports![exportId].profile.documentRevision = applied.revision + 1;
  });
  await expect(
    f.service.exported(f.projectId, f.plan.id, { exportId }),
  ).rejects.toThrow(/applied workflow revision/);
  await f.store.transaction(f.projectId, (p) => {
    p.exports![exportId].profile.documentRevision = applied.revision;
  });
  expect(
    (await f.service.exported(f.projectId, f.plan.id, { exportId })).status,
  ).toBe("exported");
  expect(
    (await f.service.exported(f.projectId, f.plan.id, { exportId })).exportId,
  ).toBe(exportId);
});
