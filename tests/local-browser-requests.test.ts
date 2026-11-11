import { afterEach, expect, it } from "vitest";
import { mkdtemp, rm, mkdir, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createHash, randomUUID } from "node:crypto";
import { ProjectStore, type StoredRun } from "../apps/server/src/store";
import { LocalBrowserRequests } from "../apps/server/src/local-browser-requests";
import { hashVideoProjectDocument } from "../packages/core/src/lib/video-project/document";
import {
  browserHostValueHash,
  type BrowserInspectionRequest,
} from "../packages/core/src/lib/video-project/browser-host-requests";
import { createVideoToolset } from "../packages/agent/src/tools";
const roots: string[] = [];
afterEach(async () => {
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  );
});
async function fixture() {
  const directory = await mkdtemp(path.join(os.tmpdir(), "local-browser-"));
  roots.push(directory);
  const store = new ProjectStore(directory);
  await store.init();
  const project = await store.create(),
    fingerprint = "a".repeat(64),
    sourceId = `local:${fingerprint}`,
    runId = randomUUID();
  await store.transaction(project.id, async (p) => {
    p.document.assets[sourceId] = {
      id: sourceId,
      name: "Image",
      source: "local",
      type: "image",
      byteLength: 100,
    };
    p.document.sources[sourceId] = {
      assetId: sourceId,
      revision: `sha256:${fingerprint}`,
      contentHash: fingerprint,
    };
    p.documentHash = await hashVideoProjectDocument(p.document);
    p.sources.push({
      sourceId,
      fingerprint,
      scheme: "sha256",
      byteLength: 100,
      mimeType: "image/png",
      fileName: "Image.png",
      status: "local",
      assetId: null,
      url: null,
    });
    const now = new Date().toISOString();
    p.runs.push({
      id: runId,
      operationId: "inspect",
      instruction: "Inspect this image",
      status: "running",
      phase: "thinking",
      baseRevision: p.revision,
      baseHash: p.documentHash,
      context: { selectedItemIds: [], playheadFrame: 0 },
      proposal: null,
      prerequisites: null,
      error: null,
      createdAt: now,
      updatedAt: now,
      scope: { kind: "project" },
      reviewBasisRequired: true,
      browserToolsEnabled: true,
      agentProfile: "local-editor-v10",
      requestHash: "request",
      events: [],
      request: {
        contract: "video-project-commands",
        version: 1,
        baseRevision: p.revision,
        baseHash: p.documentHash,
        document: p.document,
        context: { selectedItemIds: [], playheadFrame: 0 },
        authoring: { version: 1, scope: { kind: "project" } },
      },
    } satisfies StoredRun);
  });
  const service = new LocalBrowserRequests(store),
    current = await store.read(project.id),
    run = current.runs[0]!;
  const inspect = service
    .tools(project.id, runId, run.request)
    .find((tool) => tool.name === "inspect_image")!;
  const prepare = () =>
    inspect.execute({ sourceId }, new AbortController().signal);
  await prepare();
  const request = (await service.list(project.id, runId, "source-inspection"))
    .requests[0]!.request as BrowserInspectionRequest;
  return {
    store,
    directory,
    projectId: project.id,
    runId,
    sourceId,
    service,
    request,
    prepare,
    run,
  };
}
function receipt(request: BrowserInspectionRequest, grant: { id: string }) {
  const bytes = Buffer.from([
    255, 216, 255, 192, 0, 17, 8, 0, 180, 1, 64, 3, 1, 17, 0, 2, 17, 0, 3, 17,
    0, 255, 217,
  ]);
  return {
    version: 1,
    requestId: request.id,
    requestHash: browserHostValueHash(request),
    scopeHash: request.scopeHash,
    authorizationId: grant.id,
    provenance: {
      algorithm: "dojo-source-inspection-v1",
      engineVersion: "1.2.3",
      sourceKind: "original",
      source: request.source,
      displayWidth: 320,
      displayHeight: 180,
      orientation: "display-oriented",
      rotationDegrees: 0,
      sourceMimeType: "image/png",
      colorPolicy: "browser-sdr-to-srgb-v1",
      colorMetadata: null,
      firstTimestampMs: 0,
      sourceEndMs: null,
      coverage: "requested-moments-only",
    },
    frames: [
      {
        requestedMs: 0,
        actualMs: 0,
        durationMs: null,
        width: 320,
        height: 180,
        byteLength: bytes.length,
        sha256: createHash("sha256").update(bytes).digest("hex"),
        mimeType: "image/jpeg",
        dataUrl: `data:image/jpeg;base64,${bytes.toString("base64")}`,
      },
    ],
  };
}
it("requires an exact grant, persists one immutable receipt and resolves metadata after restart", async () => {
  const f = await fixture();
  expect(await f.prepare()).toMatchObject({ kind: "waiting" });
  expect(
    JSON.stringify(
      await f.service.list(f.projectId, f.runId, "source-inspection"),
    ),
  ).not.toContain("data:image");
  await expect(
    f.service.fulfill(f.projectId, f.runId, f.request.id, {}),
  ).rejects.toThrow(/Approve/);
  await expect(
    f.service.authorize(f.projectId, f.runId, f.request.id, {
      operationId: "grant",
      scopeHash: "b".repeat(64),
    }),
  ).rejects.toThrow(/exact/);
  const { grant } = await f.service.authorize(
    f.projectId,
    f.runId,
    f.request.id,
    { operationId: "grant", scopeHash: f.request.scopeHash },
  );
  const pixels = receipt(f.request, grant);
  const forged = structuredClone(pixels);
  forged.frames[0]!.sha256 = "f".repeat(64);
  await expect(
    f.service.fulfill(f.projectId, f.runId, f.request.id, forged),
  ).rejects.toThrow(/bytes changed/);
  expect(
    (await f.service.fulfill(f.projectId, f.runId, f.request.id, pixels))
      .replayed,
  ).toBe(false);
  expect(
    (await f.service.fulfill(f.projectId, f.runId, f.request.id, pixels))
      .replayed,
  ).toBe(true);
  const tool = await f.prepare();
  expect(tool.kind).toBe("observation");
  if (tool.kind !== "observation") throw Error("Expected saved metadata");
  const ref = (tool.value as any).visualInput;
  expect(JSON.stringify(ref)).not.toContain("data:image");
  const reopened = new LocalBrowserRequests(new ProjectStore(f.directory));
  expect(
    (
      await reopened.modelFrames(
        f.projectId,
        f.runId,
        ref,
        new AbortController().signal,
      )
    )[0]!.dataUrl,
  ).toBe(pixels.frames[0]!.dataUrl);
  await expect(
    reopened.receipt(f.projectId, randomUUID(), f.request.id),
  ).rejects.toThrow(/not found/);
  await expect(
    reopened.receipt(f.projectId, f.runId, "__proto__"),
  ).rejects.toThrow(/not found/);
  await f.store.transaction(f.projectId, (p) => {
    p.document.sources[f.sourceId]!.contentHash = "b".repeat(64);
  });
  await expect(
    reopened.modelFrames(
      f.projectId,
      f.runId,
      ref,
      new AbortController().signal,
    ),
  ).rejects.toThrow(/source changed/);
});
it("retains exact grants through failed attempts while cancellation prevents restart", async () => {
  const f = await fixture();
  await f.service.authorize(f.projectId, f.runId, f.request.id, {
    operationId: "grant",
    scopeHash: f.request.scopeHash,
  });
  await f.service.fail(f.projectId, f.runId, f.request.id, {
    code: "DECODE_FAILED",
    message: "Browser decoder stopped",
  });
  expect(await f.prepare()).toMatchObject({
    kind: "observation",
    value: {
      browserRequest: { status: "failed", error: { code: "DECODE_FAILED" } },
    },
  });
  expect(
    (
      await f.service.retry(f.projectId, f.runId, f.request.id, {
        operationId: "retry",
      })
    ).record,
  ).toMatchObject({
    status: "waiting_browser",
    grant: { scopeHash: f.request.scopeHash },
  });
  await f.service.cancel(f.projectId, f.runId);
  await expect(
    f.service.retry(f.projectId, f.runId, f.request.id, {
      operationId: "retry-2",
    }),
  ).rejects.toThrow(/cancelled/);
});
it("honors trusted host replay only in new local runs and rejects forged source identity", async () => {
  const f = await fixture(),
    extra = f.service.tools(f.projectId, f.runId, f.run.request);
  for (const [profile, safe] of [
    ["local-editor-v9", false],
    ["local-editor-v10", true],
  ] as const) {
    const tools = createVideoToolset(f.run.request, [], extra, {
      profile,
      stages: {
        phase: "planning",
        preparedCommands: false,
        planEditStages: async () => {
          throw Error("unused");
        },
        saveCaptionBatch: async () => {
          throw Error("unused");
        },
        readEditArtifact: async () => ({}),
        resolvePreparedEdit: async (raw) => raw,
      },
    }).tools;
    expect(
      tools.find((tool) => tool.name === "inspect_image")!.replaySafe,
    ).toBe(safe);
  }
  await f.store.transaction(f.projectId, (p) => {
    p.sources[0]!.fingerprint = "b".repeat(64);
  });
  await expect(f.prepare()).rejects.toThrow(/fingerprint/);
});

it("runs native review, browser wait, one correction and second preview on the same durable local stage", async () => {
  const f = await fixture();
  await f.store.transaction(f.projectId, (p) => {
    p.runs = [];
    p.browserRequests = {};
  });
  const { AgentService } = await import("../apps/server/src/agent-service");
  const { withLocalVisualInputs } = await import(
    "../apps/server/src/local-visual-model"
  );
  const { fulfillProjectPreview } = await import(
    "../packages/core/src/lib/video-project/browser-output-host"
  );
  const { builtInSkills } = await import("../packages/agent-kit/src/index");
  const requirements = [
    { id: "graphic", kind: "item_present", itemId: "graphic" },
  ];
  const edit = (fill: string) => ({
    outcome: "proposal",
    summary: "Editable graphic",
    commands: [
      {
        type: "insertGraphic",
        itemId: "graphic",
        name: "Graphic",
        trackId: "visual",
        node: {
          type: "shape",
          shape: { kind: "rect" },
          from: 0,
          duration: 120,
          style: {
            position: "absolute",
            left: 20,
            top: 20,
            width: 100,
            height: 100,
            fill,
          },
        },
      },
    ],
  });
  let calls = 0;
  const model = {
    identity: "local-native-preview-test",
    complete: async (messages: Array<{ role: string; content?: unknown }>) => {
      calls++;
      const inputs = messages
        .filter((message) => message.role === "tool")
        .map((message) => JSON.parse(String(message.content)));
      const failure = inputs.at(-1);
      if (failure?.error || failure?.completionPreflight?.status === "failed")
        throw Error(JSON.stringify(failure));
      const latest = inputs
        .filter((input) => input.visualInput)
        .at(-1)?.visualInput;
      const report = latest
        ? {
            requestId: latest.requestRef.id,
            receiptHash: latest.receiptHash,
            issues: [],
          }
        : undefined;
      const name =
        calls === 1
          ? "plan_edit_stages"
          : [2, 4].includes(calls)
            ? "review_edit"
            : [3, 5].includes(calls)
              ? "request_project_preview"
              : "propose_edit";
      const args =
        calls === 1
          ? { requirements, captionPairs: [] }
          : calls === 2
            ? { edit: edit("#ff0000") }
            : calls === 4
              ? {
                  edit: edit("#0000ff"),
                  previewRepair: {
                    ...report,
                    issues: [
                      {
                        frame: 60,
                        description:
                          "The approved preview needs a blue graphic",
                      },
                    ],
                  },
                }
              : calls === 6
                ? { reviewed: true, previewReport: report }
                : { reviewed: true, frames: [0, 60] };
      return {
        text: "",
        calls: [
          { id: `native-${calls}`, name, arguments: JSON.stringify(args) },
        ],
        usage: { inputTokens: 30, outputTokens: 100 },
      };
    },
  };
  const agent = new AgentService(
    f.store,
    model,
    builtInSkills(),
    undefined,
    "review",
    undefined,
    "local-editor-v10",
    {
      browser: {
        tools: (projectId, runId, request) =>
          f.service.tools(projectId, runId, request),
        model: (projectId, runId, model) =>
          withLocalVisualInputs(model, (ref, signal) =>
            f.service.modelFrames(projectId, runId, ref, signal),
          ),
        previewEvidence: (projectId, runId, id) =>
          f.service.previewEvidence(projectId, runId, id),
        cancel: (projectId, runId) => f.service.cancel(projectId, runId),
      },
    },
  );
  const current = await f.store.read(f.projectId);
  const started = await agent.start(f.projectId, {
    operationId: "preview-native",
    instruction: "Create a graphic, inspect it, and correct it once",
    baseRevision: current.revision,
    baseHash: current.documentHash,
    context: { selectedItemIds: [], playheadFrame: 0 },
    scope: { kind: "project" },
  });
  const read = async () => (await f.store.read(f.projectId)).runs[0]!;
  const wait = async (status: string) =>
    expect
      .poll(
        async () => {
          const run = await read();
          if (run.status === "failed") throw Error(run.error?.message);
          return run.status;
        },
        { timeout: 10000 },
      )
      .toBe(status);
  const resume = (
    projectId: string,
    runId: string,
    revision: number,
    hash: string,
  ) =>
    agent.resume(projectId, runId, {
      operationId: "preview-receipt",
      baseRevision: revision,
      baseHash: hash,
    });
  for (let round = 0; round < 2; round++) {
    await wait("needs_evidence");
    const listed = await f.service.list(
        f.projectId,
        started.run.id,
        "project-preview",
      ),
      row = listed.requests.find((record) => !record.hasReceipt)!;
    expect(row).toBeTruthy();
    if (row.request?.kind !== "project-preview")
      throw Error("Expected candidate preview request");
    await expect(
      f.service.renderInput(f.projectId, started.run.id, row.request.id),
    ).rejects.toThrow(/Approve/);
    const { grant } = await f.service.authorize(
      f.projectId,
      started.run.id,
      row.request.id,
      { operationId: `grant-${round}`, scopeHash: row.request.scopeHash },
    );
    const input = await f.service.renderInput(
      f.projectId,
      started.run.id,
      row.request.id,
    );
    expect(
      input.document.items.find((item) => item.id === "graphic")!.node.style!
        .fill,
    ).toBe(round ? "#0000ff" : "#ff0000");
    const request =
      input.request as import("../packages/core/src/lib/video-project/browser-output-requests").ProjectPreviewRequest;
    const pixels = Buffer.from([
      255, 216, 255, 192, 0, 17, 8, 0, 180, 1, 64, 3, 1, 17, 0, 2, 17, 0, 3, 17,
      0, 255, 217,
    ]);
    const captured = await fulfillProjectPreview(request, grant, {
      getState: () => ({
        ...request.snapshot,
        pendingCommands: 0,
        interactionDrafts: 0,
        renderHash: request.renderHash,
      }),
      capture: async (frame) => ({
        frame,
        renderHash: request.renderHash,
        imageDataUrl: `data:image/jpeg;base64,${pixels.toString("base64")}`,
      }),
      loadSaved: async () => null,
      persist: async () => ({}),
    });
    await f.service.fulfill(
      f.projectId,
      started.run.id,
      row.request.id,
      captured.receipt,
    );
    await f.service.resumeReady(resume, f.projectId, started.run.id);
  }
  await wait("awaiting_review");
  expect(calls).toBe(6);
  const saved = await f.store.read(f.projectId);
  expect(saved.documentHash).toBe(current.documentHash);
  expect(saved.editStagePlans![started.run.id]!.plan.status).toBe("completed");
  expect(
    JSON.stringify(saved.editStagePlans![started.run.id]!.checkpoints),
  ).not.toContain("data:image");
  expect(JSON.stringify((await read()).proposal)).toContain("#0000ff");
  await f.service.resumeReady(resume, f.projectId, started.run.id);
  expect(calls).toBe(6);
  const exportTool = f.service
    .tools(f.projectId, started.run.id, (await read()).request)
    .find((tool) => tool.name === "request_project_export")!;
  const prepared = await exportTool.execute(
    {
      destination: "project",
      output: { container: "mp4", resolution: "source" },
    },
    new AbortController().signal,
  );
  expect(prepared).toMatchObject({
    kind: "observation",
    value: { projectExport: { status: "waiting_application" } },
  });
  const exportId = (prepared as any).value.projectExport.requestRef.id;
  await expect(
    f.service.authorize(f.projectId, started.run.id, exportId, {
      operationId: "early",
      scopeHash: "a".repeat(64),
      mode: "cloud-publication",
    }),
  ).rejects.toThrow(/Apply/);
  const review = await agent.review(f.projectId, started.run.id);
  const applied = await agent.apply(f.projectId, started.run.id, {
    operationId: "actual-apply",
    baseRevision: saved.revision,
    baseHash: saved.documentHash,
    reviewBasis: review.review.basis,
  });
  const listed = await f.service.list(
    f.projectId,
    started.run.id,
    "project-preview",
  );
  const bound = listed.requests.find((row) => row.kind === "project-export")!;
  if (bound.request?.kind !== "project-export")
    throw Error("Expected applied export");
  const outputRequest = bound.request;
  expect(outputRequest.applicationOperationId).toBe("actual-apply");
  expect(outputRequest.snapshot).toEqual({
    revision: applied.revision,
    documentHash: applied.documentHash,
  });
  const { browserHostValueHash } = await import(
    "../packages/core/src/lib/video-project/browser-host-requests"
  );
  await f.service.authorize(f.projectId, started.run.id, exportId, {
    operationId: "export-consent",
    scopeHash: browserHostValueHash(outputRequest),
    mode: "cloud-publication",
  });
  const file = Buffer.from("synthetic verified-export receipt fixture");
  const digest = createHash("sha256").update(file).digest("hex"),
    fileId = randomUUID();
  const outputReceipt = {
    version: 1,
    kind: "project-export",
    requestId: outputRequest.id,
    requestHash: browserHostValueHash(outputRequest),
    snapshot: outputRequest.snapshot,
    exportId: fileId,
    file: {
      ...outputRequest.format,
      mimeType: "video/mp4",
      sha256: digest,
      byteLength: file.length,
    },
    verification: {
      mode: "sampled",
      status: "verified",
      checks: [
        "container_readable",
        "video_track_present",
        "video_dimensions_match",
        "video_duration_match",
        "video_frames_decoded",
        "resources_disposed",
      ].map((id) => ({ id, status: "passed" })),
    },
    download: { state: "not-started", method: "none" },
    publication: "not-published",
    semanticCoverage: "unknown",
  };
  await expect(
    f.service.fulfill(f.projectId, started.run.id, exportId, {
      ...outputReceipt,
      exportId: "../different-project",
    }),
  ).rejects.toThrow();
  await f.service.fulfill(f.projectId, started.run.id, exportId, outputReceipt);
  expect(
    await f.service.receipt(f.projectId, started.run.id, exportId),
  ).not.toHaveProperty("publication");
  await f.store.commit(f.projectId, {
    operationId: "later-manual-edit",
    baseRevision: applied.revision,
    baseHash: applied.documentHash,
    commands: [
      {
        type: "set",
        target: { kind: "format" },
        path: ["backgroundColor"],
        value: "#123456",
      },
    ],
  });
  const { prepareExport, claimExport, finishExport } = await import(
    "../apps/server/src/exports"
  );
  await prepareExport(f.store, f.projectId, {
    exportId: fileId,
    documentRevision: applied.revision,
    width: outputRequest.format.width,
    height: outputRequest.format.height,
    fps: outputRequest.format.fps,
    durationInFrames: outputRequest.format.durationInFrames,
    resolution: "source",
    sourceType: "editor_export",
    phase: "prepare",
  });
  await claimExport(f.store, f.projectId, fileId, digest, file.length);
  await mkdir(path.join(f.directory, "media", f.projectId), {
    recursive: true,
  });
  const filePath = path.join(
    f.directory,
    "media",
    f.projectId,
    fileId + ".mp4",
  );
  await writeFile(filePath, file);
  await finishExport(f.store, f.projectId, fileId, file.length, digest);
  const reopened = new LocalBrowserRequests(new ProjectStore(f.directory));
  expect(
    await reopened.receipt(f.projectId, started.run.id, exportId),
  ).toMatchObject({ publication: { state: "published", outputId: fileId } });
  expect(
    (
      await reopened.fulfill(
        f.projectId,
        started.run.id,
        exportId,
        outputReceipt,
      )
    ).replayed,
  ).toBe(true);
  await writeFile(filePath, Buffer.alloc(file.length));
  expect(
    await reopened.receipt(f.projectId, started.run.id, exportId),
  ).toMatchObject({ publicationError: { code: "PUBLICATION_UNVERIFIED" } });
  expect(calls).toBe(6);
  await expect
    .poll(
      () => (agent as unknown as { active: Map<string, unknown> }).active.size,
    )
    .toBe(0);
});

it("resumes an accepted three-tool host wait after the export adapter is installed", async () => {
  const f = await fixture();
  await f.store.transaction(f.projectId, (project) => {
    project.runs = [];
    project.browserRequests = {};
  });
  const { AgentService } = await import("../apps/server/src/agent-service");
  const { withLocalVisualInputs } = await import(
    "../apps/server/src/local-visual-model"
  );
  const { builtInSkills } = await import("../packages/agent-kit/src/index");
  const { parseLoopCheckpoint } = await import(
    "../packages/agent-loop/src/index"
  );
  let calls = 0;
  const model = {
    identity: "retained-three-tool-host",
    complete: async () => {
      calls++;
      return calls === 1
        ? {
            text: "",
            calls: [
              {
                id: "inspect-original",
                name: "inspect_image",
                arguments: JSON.stringify({ sourceId: f.sourceId }),
              },
            ],
            usage: { inputTokens: 2, outputTokens: 1 },
          }
        : {
            text: "Only the exact approved original was inspected.",
            calls: [],
            usage: { inputTokens: 3, outputTokens: 1 },
          };
    },
  };
  const create = (hasExport: boolean) =>
    new AgentService(
      f.store,
      model,
      builtInSkills(),
      undefined,
      "review",
      undefined,
      "local-editor-v10",
      {
        browser: {
          tools: (projectId, runId, request) =>
            f.service
              .tools(projectId, runId, request)
              .filter(
                (tool) => hasExport || tool.name !== "request_project_export",
              ),
          model: (projectId, runId, model) =>
            withLocalVisualInputs(model, (ref, signal) =>
              f.service.modelFrames(projectId, runId, ref, signal),
            ),
          previewEvidence: (projectId, runId, id) =>
            f.service.previewEvidence(projectId, runId, id),
          cancel: (projectId, runId) => f.service.cancel(projectId, runId),
        },
      },
    );
  const previous = create(false),
    project = await f.store.read(f.projectId);
  const started = await previous.start(f.projectId, {
    operationId: "accepted-before-export",
    instruction: "Inspect this original image",
    baseRevision: project.revision,
    baseHash: project.documentHash,
    context: { selectedItemIds: [], playheadFrame: 0 },
    scope: { kind: "project" },
  });
  await expect
    .poll(async () => (await f.store.read(f.projectId)).runs[0]!.phase)
    .toBe("waiting_for_host");
  await expect
    .poll(
      () =>
        (previous as unknown as { active: Map<string, unknown> }).active.size,
    )
    .toBe(0);
  const accepted = (await f.store.read(f.projectId)).runs[0]!.loopCheckpoint!;
  expect(
    parseLoopCheckpoint(accepted.checkpoint).snapshot.tools.some(
      (tool) => tool.name === "request_project_export",
    ),
  ).toBe(false);
  const row = (
    await f.service.list(f.projectId, started.run.id, "source-inspection")
  ).requests[0]!;
  if (row.request?.kind !== "source-inspection")
    throw Error("Expected original inspection");
  const { grant } = await f.service.authorize(
    f.projectId,
    started.run.id,
    row.request.id,
    { operationId: "grant", scopeHash: row.request.scopeHash },
  );
  await f.service.fulfill(
    f.projectId,
    started.run.id,
    row.request.id,
    receipt(row.request, grant),
  );
  const current = create(true);
  await f.service.resumeReady(
    (projectId, runId, revision, hash) =>
      current.resume(projectId, runId, {
        operationId: "resume-retained",
        baseRevision: revision,
        baseHash: hash,
      }),
    f.projectId,
    started.run.id,
  );
  await expect
    .poll(async () => (await f.store.read(f.projectId)).runs[0]!.status)
    .toBe("completed");
  const resumed = (await f.store.read(f.projectId)).runs[0]!.loopCheckpoint!;
  expect(resumed.toolInventoryHash).toBe(accepted.toolInventoryHash);
  expect(
    parseLoopCheckpoint(resumed.checkpoint).snapshot.tools.some(
      (tool) => tool.name === "request_project_export",
    ),
  ).toBe(false);
  expect(calls).toBe(2);
  await expect
    .poll(
      () =>
        (current as unknown as { active: Map<string, unknown> }).active.size,
    )
    .toBe(0);
});
