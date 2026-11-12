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
  type StageCaptionPair,
  STAGED_EDIT_POLICY,
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
import {
  compileNativeCompletionResponse,
  validateNativeCompletionRequirements,
} from "../packages/core/src/lib/video-project/completion-preflight";
import { captionPairSettingsSchema } from "../packages/core/src/lib/video-project/caption-pair";
import {
  captionBatchManifestSchema,
  createCaptionBatchManifest,
  prepareCaptionTranslationBatch,
  assembleCaptionTranslationBatches,
  captionBatchModelContext,
} from "../packages/core/src/lib/video-project/caption-batches";
import { readNativeCaptionCues } from "../packages/core/src/lib/video-project/agent-readers";
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
async function fixture(
  profile:
    | "local-editor-v7"
    | "local-editor-v8"
    | "local-editor-v9"
    | "local-editor-v10"
    | "local-editor-v11"
    | "local-editor-v14" = "local-editor-v7",
  secondSource = false,
) {
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
  if (secondSource) {
    raw.assets.recording2 = { ...raw.assets.recording, id: "recording2" };
    raw.sources.recording2 = { assetId: "recording2", revision: "source-v2" };
    raw.items.push({
      ...raw.items[0],
      id: "narration2",
      node: {
        ...raw.items[0].node,
        id: "narration2",
        assetId: "recording2",
        from: 360,
      },
    });
    raw.evidence.speech2 = {
      ...raw.evidence.speech,
      id: "speech2",
      sourceAssetId: "recording2",
      sourceRevision: "source-v2",
      words: words.map((word) => ({ ...word, id: `second-${word.id}` })),
    };
    raw.format.durationInFrames = 720;
  }
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
    agentProfile: profile,
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
    readableSourceItemIds: secondSource
      ? ["narration", "narration2"]
      : ["narration"],
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

it.each([
  "local-editor-v7",
  "local-editor-v8",
  "local-editor-v9",
  "local-editor-v10",
  "local-editor-v11",
] as const)(
  "runs %s through actual AgentService review, Apply, reload, replay and Undo",
  async (profile) => {
    const f = await fixture(profile);
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
            String(
              messages.find((message) => message.role === "user")!.content,
            ),
          );
          const context = prompt.durableStages;
          let name: string, args: unknown;
          if (!context) {
            expect(limits!.maxOutputTokens).toBe(
              profile === "local-editor-v11" ? 32000 : 16000,
            );
            expect(tools.some((tool) => tool.name === "plan_edit_stages")).toBe(
              true,
            );
            expect(
              tools.some((tool) => tool.name === "save_caption_batch"),
            ).toBe(
              ![
                "local-editor-v9",
                "local-editor-v10",
                "local-editor-v11",
              ].includes(profile),
            );
            name = "plan_edit_stages";
            args = { requirements: f.requirements, captionPairs: [] };
          } else {
            if (profile === "local-editor-v11")
              expect(limits!.maxOutputTokens).toBeGreaterThan(16000);
            else expect(limits!.maxOutputTokens).toBeLessThanOrEqual(16000);
            expect(context.activeStage.kind).toBe("assemble");
            expect(context.preparedCommands).toBe(false);
            expect(tools.some((tool) => tool.name === "plan_edit_stages")).toBe(
              ![
                "local-editor-v9",
                "local-editor-v10",
                "local-editor-v11",
              ].includes(profile),
            );
            expect(
              tools.some((tool) => tool.name === "save_caption_batch"),
            ).toBe(
              ![
                "local-editor-v9",
                "local-editor-v10",
                "local-editor-v11",
              ].includes(profile),
            );
            const reviewed = messages.some(
              (message) =>
                message.role === "tool" &&
                JSON.parse(String(message.content)).completionPreflight
                  ?.status === "passed",
            );
            name = reviewed ? "propose_edit" : "review_edit";
            args = reviewed
              ? profile === "local-editor-v7"
                ? f.edit
                : { reviewed: true }
              : { edit: f.edit };
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
      profile,
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
    expect(run.agentProfile).toBe(profile);
    expect(ready.editStagePlans![run.id].plan.status).toBe("completed");
    expect(ready.editStagePlans![run.id].plan.limits).toMatchObject({
      modelCalls: 32,
      toolCalls: 64,
      outputTokens: 32000,
      perStage: {
        modelCalls: ["local-editor-v10", "local-editor-v11"].includes(profile)
          ? 16
          : 8,
        toolCalls: 24,
        outputTokens: profile === "local-editor-v11" ? 32000 : 16000,
      },
    });
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
  },
);

it.each([
  "local-editor-v6",
  "local-editor-v7",
  "local-editor-v8",
  "local-editor-v9",
  "local-editor-v10",
] as const)(
  "new-profile recovery retains accepted %s checkpoint byte-for-byte",
  async (profile) => {
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
      profile,
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
    expect(before.agentProfile).toBe(profile);
    expect(before.loopCheckpoint?.toolInventoryHash).toBeTruthy();
    expect(oldComplete).toHaveBeenCalledTimes(1);
    const neverComplete = vi.fn(async () => {
      throw new Error(
        "An accepted old run must not adopt a new model/profile.",
      );
    });
    const current = new AgentService(
      f.store,
      { identity: "new-model-configuration", complete: neverComplete },
      builtInSkills(),
      undefined,
      "review",
      undefined,
      "local-editor-v11",
    );
    await current.recover();
    expect((await current.start(initial.id, body)).run.id).toBe(before.id);
    const restored = (await f.store.read(initial.id)).runs.at(-1)!;
    expect(restored.agentProfile).toBe(profile);
    expect(restored.loopCheckpoint).toEqual(before.loopCheckpoint);
    expect(restored.request).toEqual(before.request);
    expect(restored.requestHash).toBe(before.requestHash);
    expect(neverComplete).not.toHaveBeenCalled();
  },
);

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

it("new native path validation rejects an impossible plan before persistence and permits a repaired declaration", async () => {
  const f = await fixture("local-editor-v8");
  const { validateNativeCompletionRequirements } = await import(
    "../packages/core/src/lib/video-project/completion-preflight"
  );
  const invalid = [
    {
      id: "source-duration",
      kind: "property",
      target: { kind: "item", itemId: "narration" },
      path: ["duration"],
      equals: 360,
    },
  ];
  const valid = [{ ...invalid[0], path: ["node", "duration"] }];
  let stageInvocations = 0;
  await expect(
    runEditingStages({
      ...f.input,
      generalEditing: true,
      native: {
        ...f.input.native,
        validateRequirements: (requirements) => {
          validateNativeCompletionRequirements(requirements);
        },
      },
      invoke: async (options) => {
        stageInvocations++;
        if (options.stageContext)
          throw new Error("Test boundary before assembly model work");
        await expect(
          options.stages.planEditStages(
            { requirements: invalid, captionPairs: [] },
            f.input.signal,
          ),
        ).rejects.toThrow(/invalid item property path/);
        expect(await f.port.load()).toBeNull();
        expect(await f.records.read()).toBeNull();
        return options.stages.planEditStages(
          { requirements: valid, captionPairs: [] },
          f.input.signal,
        );
      },
    }),
  ).rejects.toThrow("Test boundary before assembly model work");
  const plan = (await f.port.load())!;
  expect(plan.requirements).toEqual(valid);
  expect(stageInvocations).toBe(2);
  expect((await f.store.read(f.project.id)).document).toEqual(f.document);
});

it("the reviewed-edit marker resolves one prepared bilingual prefix without duplicating captions", async () => {
  const f = await fixture("local-editor-v8");
  const {
    createCaptionBatchManifest,
    captionBatchManifestSchema,
    prepareCaptionTranslationBatch,
    assembleCaptionTranslationBatches,
    captionBatchModelContext,
  } = await import("../packages/core/src/lib/video-project/caption-batches");
  const { captionPairSettingsSchema } = await import(
    "../packages/core/src/lib/video-project/caption-pair"
  );
  const { readNativeCaptionCues } = await import(
    "../packages/core/src/lib/video-project/agent-readers"
  );
  const { validateNativeCompletionRequirements } = await import(
    "../packages/core/src/lib/video-project/completion-preflight"
  );
  const pair = {
    sourceItemId: "narration",
    evidenceId: "speech",
    originalItemId: "en",
    translatedItemId: "zh",
    trackId: "visual",
    originalLanguage: "en",
    translatedLanguage: "zh",
    originalColor: "#ffffff",
    translatedColor: "#22d3ee",
  };
  const requirements = [
    { id: "bilingual", kind: "caption_pair", ...pair },
    { id: "chart", kind: "item_present", itemId: "chart-0" },
  ];
  delete (requirements[0] as Record<string, unknown>).trackId;
  const edit = {
    outcome: "proposal",
    summary: "Caption pair and one editable diagram",
    commands: [f.edit.commands[1]],
  };
  let invocations = 0;
  const input = {
    ...f.input,
    generalEditing: true as const,
    reviewReferences: true as const,
    native: {
      ...f.input.native,
      validateRequirements: (requirements: CompletionRequirement[]) => {
        validateNativeCompletionRequirements(requirements);
      },
      parsePair: (raw: unknown) => captionPairSettingsSchema.parse(raw),
      parseManifest: (raw: unknown) => captionBatchManifestSchema.parse(raw),
      createManifest: (settings: any, batchSize: number) =>
        createCaptionBatchManifest(f.document, settings, batchSize),
      prepareBatch: (manifest: any, batchId: string, raw: unknown) =>
        prepareCaptionTranslationBatch(f.document, manifest, batchId, raw),
      assembleBatches: (manifest: any, batches: unknown[]) =>
        assembleCaptionTranslationBatches(f.document, manifest, batches),
      batchContext: (manifest: any, batchId: string) =>
        captionBatchModelContext(manifest, batchId),
      readCues: (query: any, options?: any) =>
        readNativeCaptionCues(f.request, query, options),
    },
    invoke: async (options: StageModelInvocation<NativeAgentResult>) => {
      invocations++;
      const toolset = createVideoToolset(f.request, builtInSkills(), [], {
        profile: "local-editor-v8",
        stages: options.stages,
      });
      const call = (name: string, args: unknown) =>
        toolset.tools
          .find((tool) => tool.name === name)!
          .execute(args, f.input.signal);
      if (!options.stageContext)
        return (
          (await call("plan_edit_stages", {
            requirements,
            captionPairs: [pair],
          })) as { result: NativeAgentResult }
        ).result;
      if ((options.stageContext as any).activeStage.kind === "caption_batch") {
        const page = (await call("read_caption_cues", {
          sourceItemId: "narration",
          evidenceId: "speech",
        })) as { value: { cues: Array<{ cueId: string }> } };
        return (
          (await call("save_caption_batch", {
            translations: page.value.cues.map((cue, index) => ({
              cueId: cue.cueId,
              text: `译${index}`,
            })),
          })) as { result: NativeAgentResult }
        ).result;
      }
      expect(options.stageContext).toMatchObject({
        activeStage: { kind: "assemble" },
        preparedCommands: true,
      });
      const reviewed = (await call("review_edit", { edit })) as any;
      expect(reviewed.value.completionPreflight.status).toBe("passed");
      expect(reviewed.value.completionPreflight.reviewRef).toBeDefined();
      return (
        (await call("propose_edit", { reviewed: true })) as {
          result: NativeAgentResult;
        }
      ).result;
    },
  };
  const result = await runEditingStages(input);
  expect(result.outcome).toBe("proposal");
  const after = executeVideoProjectCommands(
    f.document,
    result.proposal!.commands,
  ).document;
  expect(
    after.items
      .filter((item) => item.caption)
      .map((item) => item.id)
      .sort(),
  ).toEqual(["en", "zh"]);
  expect(after.items.filter((item) => item.id === "chart-0")).toHaveLength(1);
  expect(after.evidence).toEqual(f.document.evidence);
  const calls = invocations;
  const noMoreModel = vi.fn(async () => {
    throw new Error("Known reviewed candidate must replay without model work");
  });
  expect(await runEditingStages({ ...input, invoke: noMoreModel })).toEqual(
    result,
  );
  expect(noMoreModel).not.toHaveBeenCalled();
  expect(invocations).toBe(calls);
});

function captionNative(f: Awaited<ReturnType<typeof fixture>>) {
  return {
    ...f.input.native,
    validateRequirements: (requirements: CompletionRequirement[]) => {
      validateNativeCompletionRequirements(requirements);
    },
    parsePair: (raw: unknown) => captionPairSettingsSchema.parse(raw),
    parseManifest: (raw: unknown) => captionBatchManifestSchema.parse(raw),
    createManifest: (settings: StageCaptionPair, size: number) =>
      createCaptionBatchManifest(f.document, settings, size),
    prepareBatch: (manifest: unknown, batchId: string, raw: unknown) =>
      prepareCaptionTranslationBatch(f.document, manifest, batchId, raw),
    assembleBatches: (manifest: unknown, batches: unknown[]) =>
      assembleCaptionTranslationBatches(f.document, manifest, batches),
    batchContext: captionBatchModelContext,
    readCues: (
      query: Parameters<typeof readNativeCaptionCues>[1],
      options?: Parameters<typeof readNativeCaptionCues>[2],
    ) => readNativeCaptionCues(f.request, query, options),
    compileFinal: (
      edit: unknown,
      completion: Parameters<typeof compileNativeCompletionResponse>[1],
    ) =>
      compileNativeCompletionResponse(
        f.request,
        { ...(edit as object), completion },
        { preserveAuthoredPaintOrder: true, preciseSpeechDiagnostics: true },
      ),
  };
}
function declaredPairs(): StageCaptionPair[] {
  const settings = {
    sourceItemId: "narration",
    evidenceId: "speech",
    trackId: "visual",
    originalLanguage: "en",
    translatedLanguage: "zh",
    originalColor: "#ff0000",
    translatedColor: "#ffffff",
  };
  return [
    {
      ...settings,
      originalItemId: "en-first",
      translatedItemId: "zh-first",
    },
    {
      ...settings,
      sourceItemId: "narration2",
      evidenceId: "speech2",
      originalItemId: "en-second",
      translatedItemId: "zh-second",
    },
  ];
}

it("derives two caption checks alongside nine other outcomes and carries the full frozen checklist through real batches, native review and candidate replay", async () => {
  const f = await fixture("local-editor-v14", true),
    pairs = declaredPairs();
  const supplied: CompletionRequirement[] = [
    {
      id: "original",
      kind: "asset_sequence",
      items: [
        {
          itemId: "narration",
          assetId: "recording",
          from: 0,
          duration: 360,
          sourceStartSeconds: 0,
        },
        {
          itemId: "narration2",
          assetId: "recording2",
          from: 360,
          duration: 360,
          sourceStartSeconds: 0,
        },
      ],
    },
    { id: "chart", kind: "item_present", itemId: "chart-0" },
    ...["duration", "audioStartTime", "volume"].map((path, index) => ({
      id: `voice-${path}`,
      kind: "property" as const,
      target: {
        kind: "node" as const,
        itemId: "narration",
        nodeId: "narration",
      },
      path: [path],
      equals: [360, 0, 1][index],
    })),
    ...["width", "height", "fps", "durationInFrames"].map((path, index) => ({
      id: `format-${path}`,
      kind: "property" as const,
      target: { kind: "format" as const },
      path: [path],
      equals: [640, 360, 30, 720][index],
    })),
  ];
  const edit = {
    outcome: "proposal",
    summary:
      "Two ranged caption pairs, source preservation and editable animated chart",
    commands: [f.edit.commands[1]],
  };
  let planning = 0,
    batches = 0,
    assembly = 0;
  let frozenHash = "";
  const input = {
    ...f.input,
    generalEditing: true as const,
    deriveCaptionPlan: true as const,
    reviewReferences: true as const,
    phaseScopedTools: true as const,
    policy: { ...STAGED_EDIT_POLICY, captionBatchSize: 4 },
    native: captionNative(f),
    invoke: async (options: StageModelInvocation<NativeAgentResult>) => {
      const set = createVideoToolset(f.request, builtInSkills(), [], {
        profile: "local-editor-v14",
        stages: options.stages,
      });
      const call = (name: string, value: unknown) =>
        set.tools
          .find((tool) => tool.name === name)!
          .execute(value, f.input.signal);
      if (!options.stageContext) {
        planning++;
        const result = (await call("plan_edit_stages", {
          requirements: supplied,
          captionPairs: pairs,
        })) as { result: NativeAgentResult };
        const plan = (await f.port.load())!;
        expect(plan.requirements).toHaveLength(11);
        expect(plan.requirements.slice(0, 9)).toEqual(supplied);
        expect(plan.requirements.slice(9).map((value) => value.kind)).toEqual([
          "caption_pair",
          "caption_pair",
        ]);
        frozenHash = plan.requirementsHash;
        return result.result;
      }
      expect(options.stages.completionState?.requirements).toHaveLength(11);
      expect(options.stages.completionState?.requirementsHash).toBe(frozenHash);
      const context = options.stageContext as any;
      if (context.activeStage.kind === "caption_batch") {
        batches++;
        const batch = context.captionBatch;
        const page = (await call("read_caption_cues", {
          sourceItemId: batch.sourceItemId,
          evidenceId: batch.evidenceId,
          sourceRange: batch.sourceRange,
        })) as { value: { cues: Array<{ cueId: string; text: string }> } };
        expect(page.value.cues).toHaveLength(4);
        return (
          (await call("save_caption_batch", {
            translations: page.value.cues.map((cue) => ({
              cueId: cue.cueId,
              text: `译 ${cue.text}`,
            })),
          })) as { result: NativeAgentResult }
        ).result;
      }
      assembly++;
      const review = (await call("review_edit", { edit })) as any;
      expect(
        review.value.completionPreflight.checks.filter(
          (check: { passed: boolean }) => !check.passed,
        ),
      ).toEqual([]);
      expect(review.value.completionPreflight.status).toBe("passed");
      expect(review.value.completionPreflight.requirements).toHaveLength(11);
      expect(review.value.completionPreflight.requirementsHash).toBe(
        frozenHash,
      );
      expect(review.value.completionPreflight.reviewRef).toBeDefined();
      return (
        (await call("propose_edit", { reviewed: true })) as {
          result: NativeAgentResult;
        }
      ).result;
    },
  };
  const result = await runEditingStages(input);
  expect([planning, batches, assembly]).toEqual([1, 6, 1]);
  expect(result.outcome).toBe("proposal");
  expect(result.completion?.requirements).toHaveLength(11);
  expect(result.completion?.receipt.requirementsHash).toBe(frozenHash);
  const after = executeVideoProjectCommands(
    f.document,
    result.proposal!.commands,
  ).document;
  expect(
    after.items
      .filter((item) => item.caption)
      .map((item) => item.id)
      .sort(),
  ).toEqual(["en-first", "en-second", "zh-first", "zh-second"]);
  expect(after.items.find((item) => item.id === "narration")).toEqual(
    f.document.items[0],
  );
  expect(after.evidence).toEqual(f.document.evidence);
  expect((await f.port.load())!.requirementsHash).toBe(frozenHash);
  const neverModel = vi.fn(async () => {
    throw Error("Saved candidate replay must reuse all caption artifacts");
  });
  expect(await runEditingStages({ ...input, invoke: neverModel })).toEqual(
    result,
  );
  expect(neverModel).not.toHaveBeenCalled();
});

it.each([
  "empty",
  "overflow",
  "conflict",
  "missing-evidence",
  "outside-scope",
  "bad-range",
  "duplicate-items",
])(
  "rejects invalid derived plan %s before freezing or writing artifacts",
  async (failure) => {
    const f = await fixture("local-editor-v14", true),
      pairs = declaredPairs();
    let requirements: CompletionRequirement[] = [
      { id: "chart", kind: "item_present", itemId: "chart-0" },
    ];
    if (failure === "empty") {
      requirements = [];
      pairs.splice(0);
    }
    if (failure === "overflow")
      requirements = Array.from({ length: 11 }, (_, index) => ({
        id: `keep-${index}`,
        kind: "item_present",
        itemId: `graphic-${index}`,
      }));
    if (failure === "conflict") {
      const { trackId: _track, sourceRange: _range, ...fields } = pairs[0];
      requirements.push({
        id: "conflict",
        kind: "caption_pair",
        ...fields,
        translatedColor: "#000000",
      });
    }
    if (failure === "missing-evidence") pairs[0].evidenceId = "missing";
    if (failure === "outside-scope") pairs[0].sourceItemId = "other-source";
    if (failure === "bad-range")
      pairs[0].sourceRange = { startMs: 6000, endMs: 5000 };
    if (failure === "duplicate-items")
      pairs[1].translatedItemId = pairs[0].translatedItemId;
    const before = JSON.stringify(f.document);
    await expect(
      runEditingStages({
        ...f.input,
        generalEditing: true,
        deriveCaptionPlan: true,
        native: captionNative(f),
        invoke: (options) =>
          options.stages.planEditStages(
            { requirements, captionPairs: pairs },
            f.input.signal,
          ),
      }),
    ).rejects.toThrow();
    expect(await f.port.load()).toBeNull();
    expect(await f.records.read()).toBeNull();
    expect(JSON.stringify(f.document)).toBe(before);
  },
);
