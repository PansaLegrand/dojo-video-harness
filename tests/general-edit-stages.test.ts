import { afterEach, expect, it, vi } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { randomUUID } from "node:crypto";
import {
  builtInSkills,
  completionHash,
  runEditingStages,
  createStagedEditorTools,
  type CompletionRequirement,
  type EditArtifactRef,
  type StageCoordinatorRecords,
  type StageModelInvocation,
} from "../packages/agent-kit/src/index";
import {
  createLocalEditStagePort,
  localEditStageBinding,
} from "../apps/server/src/edit-stage-store";
import { ProjectStore, type StoredRun } from "../apps/server/src/store";
import { createVideoToolset } from "../packages/agent/src/tools";
import {
  compileNativeAgentResult,
  type NativeAgentRequest,
  type NativeAgentResult,
} from "../packages/core/src/lib/video-project/agent-runtime";
import { compileNativeCompletionResponse } from "../packages/core/src/lib/video-project/completion-preflight";
import {
  createVideoProjectDocument,
  hashVideoProjectDocument,
  parseVideoProjectDocument,
} from "../packages/core/src/lib/video-project/document";
import { executeVideoProjectCommands } from "../packages/core/src/lib/video-project/commands";

const roots: string[] = [];
afterEach(async () => {
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  );
});
async function fixture() {
  const directory = await mkdtemp(path.join(os.tmpdir(), "dojo-general-edit-"));
  roots.push(directory);
  const store = new ProjectStore(directory);
  await store.init();
  const project = await store.create();
  const raw = createVideoProjectDocument({
    width: 640,
    height: 360,
    fps: 30,
    durationInFrames: 360,
  });
  raw.assets.recording = {
    id: "recording",
    type: "audio",
    name: "Synthetic speech fixture",
    source: "local",
    durationSeconds: 12,
  };
  raw.sources.recording = { assetId: "recording", revision: "source-v1" };
  raw.items.push({
    id: "narration",
    name: "Narration",
    trackId: "audio",
    node: {
      id: "narration",
      type: "audio",
      assetId: "recording",
      from: 0,
      duration: 360,
      audioStartTime: 0,
      volume: 1,
    },
  });
  const words = Array.from({ length: 12 }, (_, index) => ({
    id: `w${index}`,
    text: `Word${index}.`,
    startMs: index * 1000,
    endMs: index * 1000 + 500,
  }));
  // Deliberately synthetic timing for the executable kernel test, never live ASR proof.
  raw.evidence.speech = {
    id: "speech",
    sourceAssetId: "recording",
    sourceRevision: "source-v1",
    transcriptHash: "synthetic-word-receipt",
    language: "en",
    text: words.map((word) => word.text).join(" "),
    words,
  };
  const document = parseVideoProjectDocument(raw),
    baseHash = await hashVideoProjectDocument(document);
  const request: NativeAgentRequest = {
    contract: "video-project-commands",
    version: 1,
    baseRevision: project.revision,
    baseHash,
    document,
    instruction:
      "Caption the original narration in English and explain three topics with editable animated bar charts.",
    context: { selectedItemIds: [], playheadFrame: 0 },
    authoring: { version: 1, scope: { kind: "project" } },
  };
  const now = new Date().toISOString();
  const run: StoredRun = {
    id: randomUUID(),
    operationId: "general-edit",
    status: "running",
    phase: "stages",
    instruction: request.instruction!,
    cloudConsent: false,
    baseRevision: project.revision,
    baseHash,
    context: request.context!,
    proposal: null,
    prerequisites: null,
    error: null,
    createdAt: now,
    updatedAt: now,
    scope: { kind: "project" },
    reviewBasisRequired: true,
    agentProfile: "local-editor-v7",
    events: [],
    requestHash: "synthetic-instruction",
    request,
  };
  await store.transaction(project.id, (project) => {
    project.document = document;
    project.documentHash = baseHash;
    project.runs.push(run);
  });
  const binding = await localEditStageBinding(
    await store.read(project.id),
    run,
    "synthetic-model",
  );
  const port = createLocalEditStagePort({
    store,
    projectId: project.id,
    runId: run.id,
    binding,
  });
  const records: StageCoordinatorRecords<NativeAgentResult> = {
    read: async () =>
      (await store.read(project.id)).editStagePlans?.[run.id] ?? null,
    accountPlanning: async (stageId, attemptId) => {
      const plan = (await port.load())!;
      await port.transition(
        {
          type: "record_usage",
          operationId: "planning-paid-receipt",
          stageId,
          attemptId,
          usage: {
            modelCalls: 1,
            toolCalls: 1,
            inputTokens: 100,
            outputTokens: 30,
            usageKnown: true,
          },
        },
        plan.revision,
      );
    },
    saveReview: async (stageId, ref) => {
      await port.readArtifact(ref);
      await store.transaction(project.id, (project) => {
        const state = project.editStagePlans![run.id];
        state.lastReviews ??= {};
        state.lastReviews[stageId] = ref;
      });
    },
    saveCandidate: async (ref) => {
      await port.readArtifact(ref);
      await store.transaction(project.id, (project) => {
        project.editStagePlans![run.id].savedCandidateRef = ref;
      });
    },
    checkpoint: async () => undefined,
  };
  const neverPair = vi.fn(() => {
    throw new Error("Monolingual editing must not invent a translation pair.");
  });
  const native = {
    readableSourceItemIds: ["narration"],
    parsePair: neverPair,
    parseManifest: neverPair,
    createManifest: neverPair,
    prepareBatch: neverPair,
    assembleBatches: neverPair,
    batchContext: neverPair,
    readCues: async () => ({}),
    compileAnswer: (summary: string) =>
      compileNativeAgentResult(request, {
        outcome: "answer",
        summary,
        commands: [],
      }),
    compileFinal: (
      edit: unknown,
      completion: Parameters<typeof compileNativeCompletionResponse>[1],
    ) =>
      compileNativeCompletionResponse(request, {
        ...(edit as object),
        completion,
      }),
  };
  const requirements: CompletionRequirement[] = [
    { id: "voice", kind: "item_present", itemId: "narration" },
    { id: "captions", kind: "item_present", itemId: "captions-en" },
    ...[0, 1, 2].map((index) => ({
      id: `chart-${index}`,
      kind: "item_present" as const,
      itemId: `chart-${index}`,
    })),
  ];
  const commands: unknown[] = [
    {
      type: "captionSource",
      sourceItemId: "narration",
      evidenceId: "speech",
      itemId: "captions-en",
      trackId: "visual",
    },
    ...[0, 1, 2].map((index) => ({
      type: "insertGraphic",
      itemId: `chart-${index}`,
      trackId: "visual",
      name: `Editable chart ${index}`,
      node: {
        type: "div",
        from: index * 120,
        duration: 120,
        style: {
          position: "absolute",
          left: 30,
          top: 30,
          width: 580,
          height: 200,
        },
        children: [
          {
            id: `chart-${index}-old`,
            type: "shape",
            shape: { kind: "rect" },
            style: {
              position: "absolute",
              left: 20,
              top: 80,
              width: 100,
              height: 100,
              fill: "#0ea5e9",
            },
          },
          {
            id: `chart-${index}-new`,
            type: "shape",
            shape: { kind: "rect" },
            style: {
              position: "absolute",
              left: 160,
              top: 30,
              width: 100,
              height: 150,
              fill: "#f97316",
            },
            animations: [
              {
                kind: "keyframes",
                property: "opacity",
                frames: [
                  { frame: 0, value: 0 },
                  { frame: 10, value: 1 },
                ],
              },
            ],
          },
          {
            id: `chart-${index}-label`,
            type: "text",
            text: "100 → 150",
            style: {
              position: "absolute",
              left: 300,
              top: 40,
              width: 220,
              height: 70,
              fontSize: 32,
              color: "#ffffff",
            },
          },
        ],
      },
    })),
  ];
  const edit = {
    outcome: "proposal",
    summary: "English captions and three editable animated charts",
    commands,
  };
  const input = {
    port,
    records,
    binding,
    modelIdentity: binding.modelIdentity,
    snapshotHash: baseHash,
    run,
    history: [],
    native,
    signal: new AbortController().signal,
  };
  return {
    store,
    project,
    run,
    request,
    document,
    port,
    records,
    input,
    neverPair,
    requirements,
    edit,
  };
}

it("keeps the retained profile's pair-only boundary and tool schema unchanged", async () => {
  const f = await fixture();
  await expect(
    runEditingStages({
      ...f.input,
      invoke: (options) =>
        options.stages.planEditStages(
          { requirements: f.requirements, captionPairs: [] },
          f.input.signal,
        ),
    }),
  ).rejects.toThrow("Plan 1–12 exact caption pairs.");
  expect(await f.port.load()).toBeNull();
  const tool = createStagedEditorTools({
    preparedCommands: false,
    planEditStages: async () => "yield",
    saveCaptionBatch: async () => "yield",
    readEditArtifact: async () => ({}),
    resolvePreparedEdit: async (raw) => raw,
  })[0];
  expect((tool.parameters as any).properties.captionPairs.minItems).toBe(1);
  expect(f.neverPair).not.toHaveBeenCalled();
});

it("uses the existing evidence, assembly and verification stages for native English captions and grouped chart motion", async () => {
  const f = await fixture();
  let invocations = 0;
  const invoke = vi.fn(
    async (options: StageModelInvocation<NativeAgentResult>) => {
      invocations++;
      const tools = createVideoToolset(f.request, builtInSkills(), [], {
        profile: "local-editor-v7",
        stages: options.stages,
      });
      const call = (name: string, args: unknown) =>
        tools.tools
          .find((tool) => tool.name === name)!
          .execute(args, f.input.signal);
      if (!options.stageContext) {
        const schema = tools.tools.find(
          (tool) => tool.name === "plan_edit_stages",
        )!.parameters as any;
        expect(schema.properties.captionPairs.minItems).toBe(0);
        const result = await call("plan_edit_stages", {
          requirements: f.requirements,
          captionPairs: [],
        });
        expect(result.kind).toBe("terminal");
        return (result as { kind: "terminal"; result: NativeAgentResult })
          .result;
      }
      expect(options.stageContext).toMatchObject({
        activeStage: { id: "assemble", kind: "assemble" },
        preparedCommands: false,
      });
      const empty = await call("review_edit", {
        edit: {
          outcome: "proposal",
          summary: "No actual commands",
          commands: [],
        },
      });
      expect((empty as any).value.completionPreflight.status).toBe("failed");
      const review = await call("review_edit", { edit: f.edit });
      expect((review as any).value.completionPreflight.status).toBe("passed");
      const result = await call("propose_edit", f.edit);
      expect(result.kind).toBe("terminal");
      const plan = (await f.port.load())!;
      await f.port.transition(
        {
          type: "record_usage",
          operationId: "assembly-paid-receipt",
          stageId: "assemble",
          attemptId: "stage:assemble",
          usage: {
            modelCalls: 3,
            toolCalls: 3,
            inputTokens: 300,
            outputTokens: 200,
            usageKnown: true,
          },
        },
        plan.revision,
      );
      return (result as { kind: "terminal"; result: NativeAgentResult }).result;
    },
  );
  const result = await runEditingStages({
    ...f.input,
    generalEditing: true,
    invoke,
  });
  expect(result.outcome).toBe("proposal");
  expect(invocations).toBe(2);
  const plan = (await f.port.load())!;
  expect(
    plan.stages.map((stage) => [stage.id, stage.kind, stage.status]),
  ).toEqual([
    ["evidence:editing", "evidence", "completed"],
    ["assemble", "assemble", "completed"],
    ["verify", "verify", "completed"],
  ]);
  expect(plan.usage).toMatchObject({
    modelCalls: 4,
    toolCalls: 4,
    inputTokens: 400,
    outputTokens: 230,
    usageKnown: true,
  });
  expect(plan.limits).toMatchObject({
    modelCalls: 32,
    toolCalls: 64,
    outputTokens: 32000,
    attempts: 64,
  });
  expect(f.neverPair).not.toHaveBeenCalled();
  const values = Object.values((await f.records.read())!.artifacts).map(
    (row) => row.ref,
  );
  expect(values.filter((ref) => ref.kind === "caption-batch")).toHaveLength(0);
  const evidence = await f.port.readArtifact(plan.stages[0].outputs[0]);
  expect(evidence).toEqual({
    kind: "editing-basis",
    snapshotHash: f.request.baseHash,
    bindingHash: plan.bindingHash,
    requirementsHash: plan.requirementsHash,
  });
  const after = executeVideoProjectCommands(
    f.document,
    result.proposal!.commands,
  ).document;
  expect(after.items.find((item) => item.id === "narration")).toEqual(
    f.document.items[0],
  );
  expect(after.evidence).toEqual(f.document.evidence);
  const captions = after.items.find((item) => item.id === "captions-en")!;
  expect(captions.caption!.cues.flatMap((cue) => cue.words ?? [])).toEqual(
    f.document.evidence.speech.words.map(({ text, startMs, endMs }) => ({
      text,
      startMs,
      endMs,
    })),
  );
  expect(
    after.items.filter((item) => item.id.startsWith("chart-")),
  ).toHaveLength(3);
  expect(
    after.items.find((item) => item.id === "chart-0")!.node.children![1]
      .animations,
  ).toHaveLength(1);
  // Persisted receipt replay is native kernel validation, not another model invocation.
  const neverInvoke = vi.fn(async () => {
    throw new Error("A completed edit must not repurchase model work.");
  });
  const replayed = await runEditingStages({
    ...f.input,
    generalEditing: true,
    invoke: neverInvoke,
  });
  expect(replayed).toEqual(result);
  expect(neverInvoke).not.toHaveBeenCalled();
  expect((await f.store.read(f.project.id)).document).toEqual(f.document);
});

it("rejects untranslated declared pairs rather than treating an empty array as a way to drop an outcome", async () => {
  const f = await fixture();
  const pair = {
    id: "bilingual",
    kind: "caption_pair",
    sourceItemId: "narration",
    evidenceId: "speech",
    originalItemId: "en",
    translatedItemId: "zh",
    originalLanguage: "en",
    translatedLanguage: "zh",
    originalColor: "#ff0000",
    translatedColor: "#ffffff",
  };
  await expect(
    runEditingStages({
      ...f.input,
      generalEditing: true,
      invoke: (options) =>
        options.stages.planEditStages(
          { requirements: [pair], captionPairs: [] },
          f.input.signal,
        ),
    }),
  ).rejects.toThrow(
    "Declare and plan every requested caption pair exactly once.",
  );
  expect(await f.port.load()).toBeNull();
});

it("runs the new local profile through actual AgentService review, Apply, reload, replay and Undo", async () => {
  const f = await fixture();
  await f.store.transaction(f.project.id, (project) => {
    project.runs = [];
  });
  const { AgentService } = await import("../apps/server/src/agent-service");
  type LanguageModel = import("../packages/agent/src/types").LanguageModel;
  let calls = 0;
  const model: LanguageModel = {
    identity: "synthetic-general-authoring-model",
    complete: vi.fn(
      async (...parameters: Parameters<LanguageModel["complete"]>) => {
        const [messages, tools, _signal, limits] = parameters;
        calls++;
        const prompt = JSON.parse(
          String(messages.find((message) => message.role === "user")!.content),
        );
        const context = prompt.durableStages;
        let name: string, args: unknown;
        if (!context) {
          name = "plan_edit_stages";
          args = { requirements: f.requirements, captionPairs: [] };
        } else {
          expect(context.activeStage.kind).toBe("assemble");
          expect(context.preparedCommands).toBe(false);
          const reviewed = messages.some(
            (message) =>
              message.role === "tool" &&
              JSON.parse(String(message.content)).completionPreflight
                ?.status === "passed",
          );
          name = reviewed ? "propose_edit" : "review_edit";
          args = reviewed ? f.edit : { edit: f.edit };
        }
        expect(tools.some((tool) => tool.name === name)).toBe(true);
        const encoded = JSON.stringify(args),
          outputTokens = Math.ceil(encoded.length / 4);
        expect(outputTokens).toBeLessThanOrEqual(limits!.maxOutputTokens);
        return {
          text: "",
          calls: [{ id: `call-${calls}`, name, arguments: encoded }],
          usage: { inputTokens: 100, outputTokens },
        };
      },
    ),
  };
  const agent = new AgentService(
    f.store,
    model,
    builtInSkills(),
    undefined,
    "review",
    undefined,
    "local-editor-v7",
  );
  const initial = await f.store.read(f.project.id),
    body = {
      operationId: "normal-general-request",
      instruction: f.request.instruction!,
      baseRevision: initial.revision,
      baseHash: initial.documentHash,
      context: { selectedItemIds: [], playheadFrame: 0 },
      scope: { kind: "project" as const },
    };
  const started = await agent.start(initial.id, body);
  const deadline = performance.now() + 10000;
  let ready = await f.store.read(initial.id);
  while (
    ["queued", "running"].includes(ready.runs.at(-1)!.status) &&
    performance.now() < deadline
  ) {
    await new Promise((resolve) => setTimeout(resolve, 10));
    ready = await f.store.read(initial.id);
  }
  const run = ready.runs.at(-1)!;
  expect(run.status, JSON.stringify(run.error)).toBe("awaiting_review");
  expect(run.agentProfile).toBe("local-editor-v7");
  expect(ready.editStagePlans![run.id].plan.status).toBe("completed");
  expect(
    ready.editStagePlans![run.id].plan.stages.map((stage) => stage.kind),
  ).toEqual(["evidence", "assemble", "verify"]);
  expect(calls).toBe(3);
  const beforeReplay = calls;
  expect((await agent.start(initial.id, body)).run.id).toBe(run.id);
  expect((await f.store.read(initial.id)).runs).toHaveLength(1);
  expect(calls).toBe(beforeReplay);
  const review = await agent.review(initial.id, started.run.id);
  await agent.apply(initial.id, started.run.id, {
    operationId: "apply-general",
    baseRevision: ready.revision,
    baseHash: ready.documentHash,
    reviewBasis: review.review.basis,
  });
  const reopened = await new ProjectStore(f.store.directory).read(initial.id);
  expect(
    reopened.document.items.find((item) => item.id === "captions-en")?.caption
      ?.language,
  ).toBe("en");
  expect(
    reopened.document.items.filter((item) => item.id.startsWith("chart-")),
  ).toHaveLength(3);
  expect(reopened.document.evidence).toEqual(f.document.evidence);
  expect(calls).toBe(beforeReplay);
  await agent.undo(initial.id, started.run.id, {
    operationId: "undo-general",
    baseRevision: reopened.revision,
    baseHash: reopened.documentHash,
  });
  const undone = await f.store.read(initial.id);
  expect(undone.document.items).toEqual(f.document.items);
  expect(undone.document.evidence).toEqual(f.document.evidence);
  expect(undone.document.sources).toEqual(f.document.sources);
  expect(undone.document.format).toEqual(f.document.format);
  expect(calls).toBe(beforeReplay);
});

it("new-profile recovery and same-operation replay retain an accepted v6 profile and checkpoint byte-for-byte", async () => {
  const f = await fixture();
  await f.store.transaction(f.project.id, (project) => {
    project.runs = [];
  });
  const { AgentService } = await import("../apps/server/src/agent-service");
  const oldComplete = vi.fn(async () => ({
    text: "The project contains one narration source.",
    calls: [],
    usage: { inputTokens: 20, outputTokens: 10 },
  }));
  const old = new AgentService(
    f.store,
    { identity: "frozen-old-model", complete: oldComplete },
    builtInSkills(),
    undefined,
    "review",
    undefined,
    "local-editor-v6",
  );
  const initial = await f.store.read(f.project.id),
    body = {
      operationId: "accepted-old-description",
      instruction:
        "Describe the project's existing sources without changing anything.",
      baseRevision: initial.revision,
      baseHash: initial.documentHash,
      context: { selectedItemIds: [], playheadFrame: 0 },
      scope: { kind: "project" as const },
    };
  await old.start(initial.id, body);
  const deadline = performance.now() + 10000;
  let saved = await f.store.read(initial.id);
  while (
    ["queued", "running"].includes(saved.runs.at(-1)!.status) &&
    performance.now() < deadline
  ) {
    await new Promise((resolve) => setTimeout(resolve, 10));
    saved = await f.store.read(initial.id);
  }
  const before = structuredClone(saved.runs.at(-1)!);
  expect(before.status).toBe("completed");
  expect(before.agentProfile).toBe("local-editor-v6");
  expect(before.loopCheckpoint?.toolInventoryHash).toBeTruthy();
  expect(oldComplete).toHaveBeenCalledTimes(1);
  const neverComplete = vi.fn(async () => {
    throw new Error("An accepted old run must not adopt a new model/profile.");
  });
  const current = new AgentService(
    f.store,
    { identity: "new-model-configuration", complete: neverComplete },
    builtInSkills(),
    undefined,
    "review",
    undefined,
    "local-editor-v7",
  );
  await current.recover();
  expect((await current.start(initial.id, body)).run.id).toBe(before.id);
  const restored = (await f.store.read(initial.id)).runs.at(-1)!;
  expect(restored.agentProfile).toBe("local-editor-v6");
  expect(restored.loopCheckpoint).toEqual(before.loopCheckpoint);
  expect(restored.request).toEqual(before.request);
  expect(restored.requestHash).toBe(before.requestHash);
  expect(neverComplete).not.toHaveBeenCalled();
});

it("preserves typed error/recovery metadata from the retained v6 coordinator package", async () => {
  const f = await fixture();
  await f.store.transaction(f.project.id, (project) => {
    project.runs = [];
  });
  const { AgentService } = await import("../apps/server/src/agent-service");
  const { EditStageError } = await import("@dojo-video/agent-kit-v20");
  const model = {
    identity: "synthetic-legacy-error",
    complete: vi.fn(async () => {
      throw new EditStageError(
        "STAGE_CONFLICT",
        "Retained old stage needs attention.",
      );
    }),
  };
  const agent = new AgentService(
    f.store,
    model,
    builtInSkills(),
    undefined,
    "review",
    undefined,
    "local-editor-v6",
  );
  const initial = await f.store.read(f.project.id);
  await agent.start(initial.id, {
    operationId: "retained-error",
    instruction: "Describe this source without edits.",
    baseRevision: initial.revision,
    baseHash: initial.documentHash,
    context: { selectedItemIds: [], playheadFrame: 0 },
    scope: { kind: "project" },
  });
  const deadline = performance.now() + 10000;
  let saved = await f.store.read(initial.id);
  while (
    ["queued", "running"].includes(saved.runs.at(-1)!.status) &&
    performance.now() < deadline
  ) {
    await new Promise((resolve) => setTimeout(resolve, 10));
    saved = await f.store.read(initial.id);
  }
  expect(saved.runs.at(-1)).toMatchObject({
    status: "failed",
    agentProfile: "local-editor-v6",
    error: {
      code: "STAGE_CONFLICT",
      message: "Retained old stage needs attention.",
    },
  });
  expect(saved.document).toEqual(f.document);
  expect(model.complete).toHaveBeenCalledTimes(1);
});
