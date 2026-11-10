import { expect, it, vi } from "vitest";
import Ajv from "ajv";
import {
  builtInSkills,
  completionCanonical,
  completionHash,
  createCompletionReceipt,
  createEditStagePlan,
  runEditingStages,
  transitionEditStagePlan,
  restoreCompletionStateFromMessages,
  type EditArtifactRef,
  type EditStagePlan,
  type EditStagePort,
  type StageCoordinatorState,
  type StageNativePorts,
} from "../packages/agent-kit/src/index";
import { createVideoToolset } from "../packages/agent/src/tools";
import {
  createVideoProjectDocument,
  hashVideoProjectDocument,
} from "../packages/core/src/lib/video-project/document";
import {
  compileNativeAgentResult,
  type NativeAgentRequest,
  type NativeAgentResult,
} from "../packages/core/src/lib/video-project/agent-runtime";
import { compileNativeCompletionResponse } from "../packages/core/src/lib/video-project/completion-preflight";

async function fixture() {
  const document = createVideoProjectDocument({
    width: 1280,
    height: 720,
    fps: 30,
    durationInFrames: 360,
  });
  const request: NativeAgentRequest = {
    contract: "video-project-commands",
    version: 1,
    baseRevision: 0,
    baseHash: await hashVideoProjectDocument(document),
    document,
    instruction: "Create a comparison",
    context: { selectedItemIds: [], playheadFrame: 0 },
  };
  const requirements = [
    { id: "first", kind: "item_present" as const, itemId: "shape0" },
    { id: "last", kind: "item_present" as const, itemId: "shape23" },
  ];
  const edit = {
    outcome: "proposal",
    summary: "Complete comparison",
    commands: Array.from({ length: 24 }, (_, index) => ({
      type: "insertGraphic",
      itemId: `shape${index}`,
      trackId: "visual",
      name: `Editable shape ${index} ${"descriptive ".repeat(25)}`,
      node: {
        type: "shape",
        from: 0,
        duration: 360,
        shape: { kind: "rect" },
        style: {
          position: "absolute",
          left: index * 45,
          top: 80,
          width: 30,
          height: 100,
          fill: "#22d3ee",
        },
      },
    })),
  };
  const binding = {
    projectId: "project",
    runId: "run",
    baseHash: request.baseHash,
    instructionHash: await completionHash(request.instruction),
    sourceHash: await completionHash(document.sources),
    scopeHash: await completionHash({ kind: "project" }),
    profile: "local-editor-v8",
    modelIdentity: "known-model",
  };
  let plan = await createEditStagePlan({
    id: "plan",
    binding,
    instruction: request.instruction!,
    requirements,
    limits: {
      modelCalls: 32,
      toolCalls: 64,
      outputTokens: 32000,
      attempts: 64,
      expiresAt: new Date(Date.now() + 3600000).toISOString(),
      perStage: { modelCalls: 8, toolCalls: 24, outputTokens: 16000 },
    },
    stages: [
      {
        id: "assemble",
        kind: "assemble",
        execution: "model",
        inputs: [],
        dependencies: [],
        descriptor: { kind: "editing-basis" },
      },
      {
        id: "verify",
        kind: "verify",
        execution: "host",
        inputs: [],
        dependencies: ["assemble"],
      },
    ],
  });
  const values = new Map<string, unknown>(),
    refs: Record<string, { ref: EditArtifactRef }> = {};
  const state: StageCoordinatorState = { plan, artifacts: refs };
  const port: EditStagePort = {
    load: async () => structuredClone(plan),
    initialize: async () => {
      throw Error("Already initialized");
    },
    transition: async (event, expectedRevision) => {
      const result = await transitionEditStagePlan(plan, event, {
        expectedRevision,
        now: new Date().toISOString(),
      });
      plan = result.plan;
      state.plan = plan;
      return result;
    },
    putArtifact: async (kind, value) => {
      const sha256 = await completionHash(value),
        ref: EditArtifactRef = {
          version: 1,
          id: `artifact:${sha256.slice(7)}`,
          runId: binding.runId,
          bindingHash: await completionHash(binding),
          kind,
          sha256,
          sizeBytes: new TextEncoder().encode(completionCanonical(value))
            .byteLength,
        };
      values.set(ref.id, structuredClone(value));
      refs[ref.id] = { ref };
      return ref;
    },
    // Deliberately return raw bytes in this unit adapter: coordinator must still
    // reject corrupt content rather than trusting a storage implementation.
    readArtifact: async (ref) => structuredClone(values.get(ref.id)),
  };
  const noTranslation = () => {
    throw Error("No translation or synthetic speech in this test");
  };
  const native: StageNativePorts<NativeAgentResult> = {
    readableSourceItemIds: [],
    parsePair: noTranslation,
    parseManifest: noTranslation,
    createManifest: noTranslation,
    prepareBatch: noTranslation,
    assembleBatches: noTranslation,
    batchContext: noTranslation,
    readCues: async () => ({}),
    compileAnswer: (summary) =>
      compileNativeAgentResult(request, {
        outcome: "answer",
        summary,
        commands: [],
      }),
    compileFinal: (edit, completion) =>
      compileNativeCompletionResponse(request, {
        ...(edit as object),
        completion,
      }),
  };
  const records = {
    read: async () => state,
    accountPlanning: async () => {},
    saveReview: async (stageId: string, ref: EditArtifactRef) => {
      state.lastReviews ??= {};
      state.lastReviews[stageId] = ref;
    },
    saveCandidate: async (ref: EditArtifactRef) => {
      state.savedCandidateRef = ref;
    },
    checkpoint: async () => undefined,
  };
  return {
    request,
    requirements,
    edit,
    binding,
    values,
    port,
    records,
    native,
  };
}
const signal = () => new AbortController().signal;

it("a successful staged review resolves its exact large edit after checkpoint restoration without model JSON repetition", async () => {
  const f = await fixture(),
    before = JSON.stringify(f.request);
  let ref: EditArtifactRef | undefined,
    stateBytes = 0,
    invocationCount = 0;
  const result = await runEditingStages({
    ...f,
    snapshotHash: f.request.baseHash,
    modelIdentity: f.binding.modelIdentity,
    run: {
      instruction: f.request.instruction!,
      createdAt: new Date().toISOString(),
    },
    history: [],
    generalEditing: true,
    reviewReferences: true,
    signal: signal(),
    invoke: async (options) => {
      invocationCount++;
      const session = createVideoToolset(f.request, builtInSkills(), [], {
        profile: "local-editor-v8",
        stages: options.stages,
        initialCompletionState: options.stages.completionState,
      });
      const reviewArgs = { requirements: f.requirements, edit: f.edit };
      const review = await session.tools
        .find((tool) => tool.name === "review_edit")!
        .execute(reviewArgs, signal());
      expect(review).toMatchObject({
        kind: "observation",
        value: {
          completionPreflight: { status: "passed" },
          nextAction: expect.stringContaining("{reviewed:true}"),
        },
      });
      if (review.kind !== "observation")
        throw Error("Review observation required");
      ref = (
        review.value as { completionPreflight: { reviewRef: EditArtifactRef } }
      ).completionPreflight.reviewRef;
      expect(ref.kind).toBe("verification");
      const restored = await restoreCompletionStateFromMessages(
        [
          {
            role: "assistant",
            tool_calls: [
              {
                id: "review",
                function: {
                  name: "review_edit",
                  arguments: JSON.stringify(reviewArgs),
                },
              },
            ],
          },
          {
            role: "tool",
            tool_call_id: "review",
            content: JSON.stringify(review.value),
          },
        ],
        f.request.baseHash,
        {
          reviewReferences: true,
          resolvePreparedEdit: (edit) =>
            options.stages.resolvePreparedEdit(edit, signal()),
        },
      );
      expect(restored?.successfulReviewRef).toEqual(ref);
      expect(restored).not.toHaveProperty("commands");
      stateBytes = JSON.stringify(restored).length;
      expect(stateBytes).toBeLessThan(3000);
      const resumed = createVideoToolset(f.request, builtInSkills(), [], {
        profile: "local-editor-v8",
        stages: options.stages,
        initialCompletionState: restored,
      });
      const propose = resumed.tools.find(
        (tool) => tool.name === "propose_edit",
      )!;
      const validate = new Ajv({ strict: false }).compile(propose.parameters);
      expect(validate({ reviewed: true })).toBe(true);
      expect(validate(f.edit)).toBe(true);
      expect(validate({ reviewed: true, commands: [] })).toBe(false);
      expect(validate({ reviewRef: ref })).toBe(false);
      expect(JSON.stringify(f.edit).length).toBeGreaterThan(12000);
      expect(JSON.stringify({ reviewed: true }).length).toBeLessThan(32);
      const terminal = await propose.execute({ reviewed: true }, signal());
      if (terminal.kind !== "terminal") throw Error("Proposal required");
      return terminal.result;
    },
  });
  expect(
    result.proposal?.commands.filter((command) => command.type === "addItem"),
  ).toHaveLength(24);
  expect(invocationCount).toBe(1);
  expect(JSON.stringify(f.request)).toBe(before);
  const noNewModel = vi.fn(async () => {
    throw Error("Saved candidate replay must not call a model");
  });
  const replay = await runEditingStages({
    ...f,
    snapshotHash: f.request.baseHash,
    modelIdentity: f.binding.modelIdentity,
    run: {
      instruction: f.request.instruction!,
      createdAt: new Date().toISOString(),
    },
    history: [],
    generalEditing: true,
    reviewReferences: true,
    signal: signal(),
    invoke: noNewModel,
  });
  expect(replay).toEqual(result);
  expect(noNewModel).not.toHaveBeenCalled();
});

it("failed and error reviews clear compact eligibility in memory and restored checkpoints", async () => {
  const f = await fixture();
  await expect(
    runEditingStages({
      ...f,
      snapshotHash: f.request.baseHash,
      modelIdentity: f.binding.modelIdentity,
      run: {
        instruction: f.request.instruction!,
        createdAt: new Date().toISOString(),
      },
      history: [],
      generalEditing: true,
      reviewReferences: true,
      signal: signal(),
      invoke: async (options) => {
        const session = createVideoToolset(f.request, builtInSkills(), [], {
          profile: "local-editor-v8",
          stages: options.stages,
        });
        const tool = (name: string) =>
          session.tools.find((tool) => tool.name === name)!;
        await expect(
          tool("propose_edit").execute({ reviewed: true }, signal()),
        ).rejects.toThrow(/No latest successful/);
        const args = { requirements: f.requirements, edit: f.edit },
          passed = await tool("review_edit").execute(args, signal());
        const failed = await tool("review_edit").execute(
          { edit: { ...f.edit, commands: [] } },
          signal(),
        );
        expect(failed).toMatchObject({
          kind: "observation",
          value: { completionPreflight: { status: "failed" } },
        });
        await expect(
          tool("propose_edit").execute({ reviewed: true }, signal()),
        ).rejects.toThrow(/No latest successful/);
        if (passed.kind !== "observation")
          throw Error("Expected successful review");
        for (const reply of [
          failed.kind === "observation" ? failed.value : {},
          { error: "Invalid native requirement path" },
        ]) {
          const restored = await restoreCompletionStateFromMessages(
            [
              {
                role: "assistant",
                tool_calls: [
                  {
                    id: "pass",
                    function: {
                      name: "review_edit",
                      arguments: JSON.stringify(args),
                    },
                  },
                  {
                    id: "fail",
                    function: {
                      name: "review_edit",
                      arguments: JSON.stringify({
                        edit: { ...f.edit, commands: [] },
                      }),
                    },
                  },
                ],
              },
              {
                role: "tool",
                tool_call_id: "pass",
                content: JSON.stringify(passed.value),
              },
              {
                role: "tool",
                tool_call_id: "fail",
                content: JSON.stringify(reply),
              },
            ],
            f.request.baseHash,
            {
              reviewReferences: true,
              resolvePreparedEdit: (edit) =>
                options.stages.resolvePreparedEdit(edit, signal()),
            },
          );
          expect(restored?.successfulReceipt).toBeUndefined();
          expect(restored?.successfulReviewRef).toBeUndefined();
        }
        throw Error("Done after negative reference checks");
      },
    }),
  ).rejects.toThrow(/Done after negative/);
});

it.each(["payload", "run", "binding", "receipt", "checks"])(
  "saved review rejects changed %s before proposing",
  async (mode) => {
    const f = await fixture();
    await expect(
      runEditingStages({
        ...f,
        snapshotHash: f.request.baseHash,
        modelIdentity: f.binding.modelIdentity,
        run: {
          instruction: f.request.instruction!,
          createdAt: new Date().toISOString(),
        },
        history: [],
        generalEditing: true,
        reviewReferences: true,
        signal: signal(),
        invoke: async (options) => {
          const session = createVideoToolset(f.request, builtInSkills(), [], {
            profile: "local-editor-v8",
            stages: options.stages,
          });
          const review = await session.tools
            .find((tool) => tool.name === "review_edit")!
            .execute({ requirements: f.requirements, edit: f.edit }, signal());
          if (review.kind !== "observation") throw Error("Review required");
          const ref = structuredClone(
            (
              review.value as {
                completionPreflight: { reviewRef: EditArtifactRef };
              }
            ).completionPreflight.reviewRef,
          );
          const record = f.values.get(ref.id) as {
            edit: { commands: unknown[] };
            receipt: Record<string, unknown>;
            checks: Array<{ passed: boolean }>;
          };
          if (mode === "run") ref.runId = "other-run";
          if (mode === "binding") ref.bindingHash = "sha256:" + "f".repeat(64);
          if (mode === "payload") record.edit.commands.pop();
          if (mode === "receipt")
            record.receipt.snapshotHash = "sha256:" + "f".repeat(64);
          if (mode === "checks") record.checks[0].passed = false;
          if (["payload", "receipt", "checks"].includes(mode)) {
            if (mode === "receipt" || mode === "checks") {
              const {
                version: _version,
                receiptHash: _receiptHash,
                ...fields
              } = record.receipt;
              record.receipt = await createCompletionReceipt({
                ...fields,
                ...(mode === "checks"
                  ? { checksHash: await completionHash(record.checks) }
                  : {}),
              } as Parameters<typeof createCompletionReceipt>[0]);
            }
            // Self-consistent transport bytes still cannot change source/command
            // receipt bindings or turn failed checks into a saved success.
            ref.sha256 = await completionHash(record);
            ref.sizeBytes = new TextEncoder().encode(
              completionCanonical(record),
            ).byteLength;
          }
          f.values.set(ref.id, record);
          await expect(
            options.stages.resolvePreparedEdit({ reviewRef: ref }, signal()),
          ).rejects.toThrow(/review|binding|content|checks/i);
          throw Error("Done after corruption check");
        },
      }),
    ).rejects.toThrow(/Done after corruption/);
  },
);

it("planning without a persisted stage review keeps the raw proposal form and rejects the compact marker", async () => {
  const f = await fixture(),
    stages = {
      preparedCommands: false,
      generalEditing: true,
      planEditStages: async () => {
        throw Error("No plan");
      },
      saveCaptionBatch: async () => {
        throw Error("No translation");
      },
      readEditArtifact: async () => ({}),
      resolvePreparedEdit: async (edit: unknown) => edit,
    };
  const session = createVideoToolset(f.request, builtInSkills(), [], {
    profile: "local-editor-v8",
    stages,
  });
  const review = await session.tools
    .find((tool) => tool.name === "review_edit")!
    .execute({ requirements: f.requirements, edit: f.edit }, signal());
  expect(review).toMatchObject({
    kind: "observation",
    value: {
      completionPreflight: { status: "passed" },
      nextAction: expect.stringContaining("exact edit object"),
    },
  });
  await expect(
    session.tools
      .find((tool) => tool.name === "propose_edit")!
      .execute({ reviewed: true }, signal()),
  ).rejects.toThrow(/No latest successful/);
  expect(
    await session.tools
      .find((tool) => tool.name === "propose_edit")!
      .execute(f.edit, signal()),
  ).toMatchObject({ kind: "terminal", result: { outcome: "proposal" } });
});
