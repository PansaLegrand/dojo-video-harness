import { afterAll, afterEach, expect, it, vi } from "vitest";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import os from "node:os";
import path from "node:path";
import { AgentService } from "../apps/server/src/agent-service";
import {
  ProjectStore,
  commitDocument,
  publicRun,
} from "../apps/server/src/store";
import { createVideoProjectDocument } from "../packages/core/src/lib/video-project/document";
import { builtInSkills } from "../packages/agent-kit/src/index";
import { parseLoopCheckpoint } from "../packages/agent-loop/src/index";
import type { LanguageModel, ModelReply } from "../packages/agent/src/types";
import type {
  AgentSpeechPort,
  AgentAsrTask,
} from "../apps/server/src/agent-speech";
const roots: string[] = [];
const measurements: Array<Record<string, number | string>> = [];
afterAll(async () => {
  if (!measurements.length) return;
  await mkdir("test-results", { recursive: true });
  await writeFile(
    "test-results/staged-agent-service-measurements.json",
    JSON.stringify(
      {
        version: 1,
        providerMode: "synthetic-no-paid-http",
        cases: measurements,
      },
      null,
      2,
    ),
  );
});
afterEach(async () => {
  vi.useRealTimers();
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  );
});
function requestFor(f: Awaited<ReturnType<typeof fixture>>) {
  return {
    operationId: randomUUID(),
    instruction:
      "Translate every source cue into Chinese, with red English and white Chinese captions.",
    baseRevision: f.project.revision,
    baseHash: f.project.documentHash,
    context: { selectedItemIds: [], playheadFrame: 0 },
    scope: { kind: "project" as const },
  };
}
async function fixture(
  sourceCount = 1,
  count = 501,
  stageOptions: ConstructorParameters<typeof AgentService>[7] = {
    captionBatchSize: 500,
  },
  speech?: AgentSpeechPort,
) {
  const directory = await mkdtemp(
    path.join(os.tmpdir(), "dojo-normal-stages-"),
  );
  roots.push(directory);
  const store = new ProjectStore(directory);
  await store.init();
  const project = await store.create();
  await store.transaction(project.id, async (p) => {
    const document = createVideoProjectDocument({
      width: 640,
      height: 360,
      fps: 30,
      durationInFrames: count * 120 * sourceCount,
    });
    for (let s = 0; s < sourceCount; s++) {
      document.assets[`a${s}`] = {
        id: `a${s}`,
        name: `Interview ${s}`,
        type: "video",
        source: "local",
        durationSeconds: count * 4,
      };
      document.sources[`a${s}`] = {
        assetId: `a${s}`,
        revision: `original-${s}`,
      };
      document.items.push({
        id: `speech${s}`,
        name: `Interview ${s}`,
        trackId: "visual",
        node: {
          id: `speech${s}`,
          type: "video",
          assetId: `a${s}`,
          from: s * count * 120,
          duration: count * 120,
        },
      });
      const words = Array.from({ length: count }, (_, i) => ({
        id: `word-${s}-${i}`,
        text: `Source ${s} sentence ${i}.`,
        startMs: i * 4000,
        endMs: i * 4000 + 3000,
      }));
      document.evidence[`e${s}`] = {
        id: `e${s}`,
        sourceAssetId: `a${s}`,
        sourceRevision: `original-${s}`,
        transcriptHash: `immutable-receipt-${s}`,
        language: "en",
        text: words.map((word) => word.text).join(" "),
        words,
      };
    }
    await commitDocument(p, document);
  });
  const pairs = Array.from({ length: sourceCount }, (_, s) => ({
    sourceItemId: `speech${s}`,
    evidenceId: `e${s}`,
    originalItemId: `en${s}`,
    translatedItemId: `zh${s}`,
    trackId: "visual",
    originalLanguage: "en",
    translatedLanguage: "zh",
    originalColor: "#ff0000",
    translatedColor: "#ffffff",
  }));
  const requirements = pairs.map(({ trackId: _track, ...pair }, s) => ({
    id: `pair-${s}`,
    kind: "caption_pair",
    ...pair,
  }));
  let calls = 0;
  const model: LanguageModel = {
    identity: "synthetic-stage-provider:model",
    complete: vi.fn(
      async (
        ...parameters: Parameters<LanguageModel["complete"]>
      ): Promise<ModelReply> => {
        const [messages, tools, _signal, limits] = parameters;
        calls++;
        const data = JSON.parse(
            String(
              messages.find((message) => message.role === "user")!.content,
            ),
          ),
          context = data.durableStages;
        let name: string, args: Record<string, unknown>;
        if (!context) {
          for (let s = 0; s < pairs.length; s++) {
            const source = data.completionCaptionSources.sources.find(
              (source: { sourceItemId: string }) =>
                source.sourceItemId === pairs[s].sourceItemId,
            );
            pairs[s].evidenceId = source.evidenceId;
            requirements[s].evidenceId = source.evidenceId;
          }
          expect(JSON.stringify(data.document.evidence)).toBe("{}");
          expect(JSON.stringify(data)).not.toContain("Source 0 sentence 500.");
          name = "plan_edit_stages";
          args = { requirements, captionPairs: pairs };
        } else if (context.activeStage.kind === "caption_batch") {
          const batch = context.captionBatch,
            pages = messages
              .filter((message) => message.role === "tool")
              .map((message) => JSON.parse(String(message.content)))
              .filter((value) => value?.kind === "caption-cues");
          const cues = [
            ...(context.retrievedCues ?? []),
            ...pages.flatMap((page) => page.cues),
          ];
          if (cues.length < batch.batch.count) {
            name = "read_caption_cues";
            args = {
              sourceItemId: batch.sourceItemId,
              evidenceId: batch.evidenceId,
              ...(batch.sourceRange ? { sourceRange: batch.sourceRange } : {}),
              ...(pages.at(-1)?.coverage.nextCursor
                ? { cursor: pages.at(-1).coverage.nextCursor }
                : {}),
            };
          } else {
            name = "save_caption_batch";
            args = {
              translations: cues.map((cue) => ({
                cueId: cue.cueId,
                text: `译${cue.cueId.slice(4)}`,
              })),
            };
          }
        } else {
          expect(context.activeStage.kind).toBe("assemble");
          expect(context.preparedCommands).toBe(true);
          const passed = messages.some(
            (message) =>
              message.role === "tool" &&
              JSON.parse(String(message.content)).completionPreflight
                ?.status === "passed",
          );
          name = passed ? "propose_edit" : "review_edit";
          const edit = {
            outcome: "proposal",
            summary: "Complete both languages for every cue",
            commands: [],
          };
          args = passed ? edit : { edit };
        }
        expect(tools.some((tool) => tool.name === name)).toBe(true);
        const text = JSON.stringify(args),
          outputTokens = Math.max(1, Math.ceil(text.length / 4));
        expect(outputTokens).toBeLessThanOrEqual(limits!.maxOutputTokens);
        return {
          text: "",
          calls: [{ id: `call-${calls}`, name, arguments: text }],
          usage: { inputTokens: 100, outputTokens },
          providerOutput: [
            {
              type: "function_call",
              call_id: `call-${calls}`,
              name,
              arguments: text,
              status: "completed",
            },
          ],
          outputTokenLimit: Math.min(8192, limits!.maxOutputTokens),
        };
      },
    ),
  };
  const agent = new AgentService(
    store,
    model,
    builtInSkills(),
    undefined,
    "review",
    speech,
    "local-editor-v6",
    stageOptions,
  );
  return {
    store,
    project: await store.read(project.id),
    model,
    agent,
    newAgent: (options: ConstructorParameters<typeof AgentService>[7] = {}) =>
      new AgentService(
        store,
        model,
        builtInSkills(),
        undefined,
        "review",
        speech,
        "local-editor-v6",
        options,
      ),
    calls: () => calls,
  };
}
async function settled(
  store: ProjectStore,
  projectId: string,
  waitForCompletedAsr = false,
) {
  for (let n = 0; n < 500; n++) {
    const project = await store.read(projectId),
      run = project.runs.at(-1)!;
    if (
      !["running", "queued"].includes(run.status) &&
      !(
        waitForCompletedAsr &&
        run.status === "needs_evidence" &&
        ["waiting_for_transcript", "speech_ready"].includes(run.phase)
      )
    )
      return { project, run };
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error("The staged run did not settle.");
}
it.each([1, 2])(
  "uses normal AgentService for %i 501-cue sources, final review/apply/reload and one Undo",
  async (sources) => {
    const f = await fixture(sources),
      originalEvidence = JSON.stringify(f.project.document.evidence);
    const start = await f.agent.start(f.project.id, {
      operationId: randomUUID(),
      instruction:
        "Caption every source in English and Chinese with red English and white Chinese. Preserve every genuine cue.",
      baseRevision: f.project.revision,
      baseHash: f.project.documentHash,
      context: { selectedItemIds: [], playheadFrame: 0 },
      scope: { kind: "project" },
    });
    const { project, run } = await settled(f.store, f.project.id);
    expect(run.status, JSON.stringify(run.error)).toBe("awaiting_review");
    expect(project.revision).toBe(f.project.revision);
    const state = project.editStagePlans![run.id];
    expect(state.plan.status).toBe("completed");
    const publicProgress = publicRun(run).progress!;
    expect(publicProgress.stages).toMatchObject({
      status: "completed",
      remainingRequirements: [],
    });
    expect(publicProgress.coverage).toBe("verified");
    expect(publicProgress.application.state).toBe("ready");
    expect(publicProgress.recovery.canResume).toBe(false);
    expect(
      state.plan.stages.filter((stage) => stage.kind === "caption_batch"),
    ).toHaveLength(sources * 2);
    expect(state.plan.usage.modelCalls).toBe(f.calls());
    expect(state.plan.usage.outputTokens).toBeLessThanOrEqual(32000);
    expect(state.plan.limits.outputTokens).toBe(32000);
    const bytes = Object.values(state.checkpoints).map((value) =>
      Buffer.byteLength(JSON.stringify(value)),
    );
    for (const raw of Object.values(state.checkpoints)) {
      const checkpoint = parseLoopCheckpoint(raw);
      expect(
        Buffer.byteLength(JSON.stringify(checkpoint.result ?? {})),
      ).toBeLessThan(2000);
    }
    expect(Math.max(...bytes)).toBeLessThan(2 * 1024 * 1024);
    expect(state.savedCandidateRef!.sizeBytes).toBeLessThan(4 * 1024 * 1024);
    const callsBeforeApply = f.calls(),
      review = await f.agent.review(project.id, start.run.id);
    const current = await f.store.read(project.id);
    await f.agent.apply(project.id, run.id, {
      operationId: "one-final-apply",
      baseRevision: current.revision,
      baseHash: current.documentHash,
      reviewBasis: review.review.basis,
    });
    const reopened = await new ProjectStore(f.store.directory).read(project.id);
    for (let s = 0; s < sources; s++) {
      const en = reopened.document.items.find((item) => item.id === `en${s}`)!,
        zh = reopened.document.items.find((item) => item.id === `zh${s}`)!;
      expect(en.caption!.cues).toHaveLength(501);
      expect(zh.caption!.cues).toHaveLength(501);
      expect(en.node.style?.color).toBe("#ff0000");
      expect(zh.node.style?.color).toBe("#ffffff");
    }
    expect(JSON.stringify(reopened.document.evidence)).toBe(originalEvidence);
    expect(f.calls()).toBe(callsBeforeApply);
    await f.agent.undo(project.id, run.id, {
      operationId: "undo-final",
      baseRevision: reopened.revision,
      baseHash: reopened.documentHash,
    });
    expect(
      (await f.store.read(project.id)).document.items.filter(
        (item) => item.caption,
      ),
    ).toHaveLength(0);
    expect(f.calls()).toBe(callsBeforeApply);
    measurements.push({
      case: `${sources}x501`,
      modelCalls: f.calls(),
      maxCheckpointBytes: Math.max(...bytes),
      finalCandidateArtifactBytes: state.savedCandidateRef!.sizeBytes,
      maxTerminalResultBytes: Math.max(
        ...Object.values(state.checkpoints).map((raw) =>
          Buffer.byteLength(
            JSON.stringify(parseLoopCheckpoint(raw).result ?? {}),
          ),
        ),
      ),
      publicNativeResultBytes: Buffer.byteLength(JSON.stringify(run.proposal)),
    });
  },
  30000,
);

it("normal default 100-cue policy resumes the interrupted last batch without repeating five saved outputs", async () => {
  let interrupted = false;
  const f = await fixture(1, 501, {
    onTransition: async (plan) => {
      const batches = plan.stages.filter(
        (stage) => stage.kind === "caption_batch",
      );
      if (
        !interrupted &&
        batches.filter((stage) => stage.status === "completed").length === 5 &&
        batches.at(-1)!.status === "pending"
      ) {
        interrupted = true;
        throw new Error("Lost stage transition notification");
      }
    },
  });
  const start = await f.agent.start(f.project.id, {
    operationId: randomUUID(),
    instruction:
      "Translate every genuine cue into Chinese and retain red English/white Chinese captions.",
    baseRevision: f.project.revision,
    baseHash: f.project.documentHash,
    context: { selectedItemIds: [], playheadFrame: 0 },
    scope: { kind: "project" },
  });
  const paused = await settled(f.store, f.project.id);
  expect(paused.run.status).toBe("failed");
  const publicProgress = publicRun(paused.run).progress!;
  expect(
    publicProgress.stages!.items.filter(
      (item) => item.kind === "caption_batch" && item.savedOutput,
    ),
  ).toHaveLength(5);
  expect(publicProgress.recovery.canResume).toBe(true);
  expect(publicProgress.coverage).toBe("declared");
  const before = paused.project.editStagePlans![start.run.id],
    savedBatches = before.plan.stages.filter(
      (stage) => stage.kind === "caption_batch",
    );
  expect(savedBatches).toHaveLength(6);
  expect(savedBatches.map((stage) => stage.status)).toEqual([
    "completed",
    "completed",
    "completed",
    "completed",
    "completed",
    "pending",
  ]);
  expect(f.calls()).toBe(11);
  const preserved = savedBatches.slice(0, 5).map((stage) => ({
    outputs: stage.outputs,
    checkpoint: before.checkpoints[stage.attemptId!],
  }));
  const restarted = f.newAgent();
  const body = {
    operationId: "resume-last-batch",
    baseRevision: paused.project.revision,
    baseHash: paused.project.documentHash,
  };
  await Promise.all([
    restarted.resume(f.project.id, start.run.id, body),
    restarted.resume(f.project.id, start.run.id, body),
  ]);
  const done = await settled(f.store, f.project.id);
  expect(done.run.status, JSON.stringify(done.run.error)).toBe(
    "awaiting_review",
  );
  expect(f.calls()).toBe(15);
  const after = done.project.editStagePlans![start.run.id];
  expect(after.plan.status).toBe("completed");
  expect(
    after.plan.stages
      .filter((stage) => stage.kind === "caption_batch")
      .slice(0, 5)
      .map((stage) => ({
        outputs: stage.outputs,
        checkpoint: after.checkpoints[stage.attemptId!],
      })),
  ).toEqual(preserved);
  expect(after.plan.usage.modelCalls).toBe(15);
  expect(after.plan.limits.outputTokens).toBe(32000);
  expect(done.project.revision).toBe(f.project.revision);
  measurements.push({
    case: "normal-default-100/501-interrupted-last",
    modelCalls: f.calls(),
    maxCheckpointBytes: Math.max(
      ...Object.values(after.checkpoints).map((value) =>
        Buffer.byteLength(JSON.stringify(value)),
      ),
    ),
    finalCandidateArtifactBytes: after.savedCandidateRef!.sizeBytes,
  });
}, 30000);

it("cancels after a stored batch without applying it or repeating paid model work", async () => {
  let cancelled = false;
  const f = await fixture(1, 201, {
    onTransition: async (plan) => {
      if (
        !cancelled &&
        plan.stages.some(
          (stage) =>
            stage.kind === "caption_batch" && stage.status === "completed",
        )
      ) {
        cancelled = true;
        await f.agent.cancel(f.project.id, plan.binding.runId);
      }
    },
  });
  const start = await f.agent.start(f.project.id, requestFor(f)),
    done = await settled(f.store, f.project.id);
  expect(done.run.status).toBe("cancelled");
  expect(f.calls()).toBe(3);
  expect(publicRun(done.run).progress!.recovery.canResume).toBe(false);
  expect(
    publicRun(done.run).progress!.stages!.items.some(
      (item) => item.savedOutput,
    ),
  ).toBe(true);
  const state = done.project.editStagePlans![start.run.id];
  expect(state.plan.status).toBe("cancelled");
  expect(
    state.plan.stages.filter(
      (stage) => stage.kind === "caption_batch" && stage.status === "completed",
    ),
  ).toHaveLength(1);
  expect(done.project.document.items.some((item) => item.caption)).toBe(false);
  expect(done.project.revision).toBe(f.project.revision);
  await f.newAgent().resume(f.project.id, start.run.id, {
    operationId: "cancelled-resume",
    baseRevision: done.project.revision,
    baseHash: done.project.documentHash,
  });
  expect(f.calls()).toBe(3);
}, 15000);

it("stops a changed original source before another model request and retains completed siblings", async () => {
  let changed = false;
  const f = await fixture(1, 201, {
    onTransition: async (plan) => {
      if (
        !changed &&
        plan.stages.some(
          (stage) =>
            stage.kind === "caption_batch" && stage.status === "completed",
        )
      ) {
        changed = true;
        await f.store.transaction(f.project.id, async (p) => {
          const document = structuredClone(p.document);
          document.sources.a0.revision = "changed-source";
          delete document.evidence.e0;
          await commitDocument(p, document);
        });
        throw new Error(
          "Source changed while the saved batch notification was in flight",
        );
      }
    },
  });
  const start = await f.agent.start(f.project.id, requestFor(f)),
    paused = await settled(f.store, f.project.id),
    count = f.calls();
  expect(count).toBe(3);
  const outputs = paused.project
    .editStagePlans![
      start.run.id
    ].plan.stages.filter((stage) => stage.status === "completed")
    .map((stage) => stage.outputs);
  await f.newAgent().resume(f.project.id, start.run.id, {
    operationId: "source-changed-resume",
    baseRevision: paused.project.revision,
    baseHash: paused.project.documentHash,
  });
  const done = await settled(f.store, f.project.id);
  expect(done.run.status).toBe("failed");
  expect(done.run.error?.code).toBe("STAGE_CONFLICT");
  expect(f.calls()).toBe(count);
  expect(
    done.project
      .editStagePlans![
        start.run.id
      ].plan.stages.filter((stage) => stage.status === "completed")
      .map((stage) => stage.outputs),
  ).toEqual(outputs);
}, 15000);

it("keeps unknown provider usage distinct and refuses a replacement continuation", async () => {
  const f = await fixture(1, 3, {}),
    complete = f.model.complete;
  let returned = 0;
  f.model.complete = vi.fn(
    async (...args: Parameters<LanguageModel["complete"]>) => {
      const value = await complete(...args);
      if (++returned === 2) delete value.usage;
      return value;
    },
  );
  const start = await f.agent.start(f.project.id, requestFor(f)),
    paused = await settled(f.store, f.project.id);
  expect(paused.run.status).toBe("failed");
  expect(f.calls()).toBe(2);
  const state = paused.project.editStagePlans![start.run.id];
  expect(state.plan.usage.usageKnown).toBe(false);
  expect(state.plan.usage.outputTokens).toBeGreaterThanOrEqual(16000);
  await expect(
    f.newAgent().resume(f.project.id, start.run.id, {
      operationId: "unknown-usage-resume",
      baseRevision: paused.project.revision,
      baseHash: paused.project.documentHash,
    }),
  ).rejects.toThrow(/usage is unknown/);
  expect(f.calls()).toBe(2);
  expect(paused.project.document.items.some((item) => item.caption)).toBe(
    false,
  );
}, 15000);

it("expires the original allowance between batches without discarding the completed output", async () => {
  vi.useFakeTimers({ toFake: ["Date"] });
  let expired = false;
  const f = await fixture(1, 201, {
    onTransition: async (plan) => {
      if (
        !expired &&
        plan.stages.some(
          (stage) =>
            stage.kind === "caption_batch" && stage.status === "completed",
        )
      ) {
        expired = true;
        vi.setSystemTime(Date.now() + 25 * 3600 * 1000);
      }
    },
  });
  const start = await f.agent.start(f.project.id, requestFor(f)),
    paused = await settled(f.store, f.project.id);
  expect(paused.run.status).toBe("failed");
  expect(paused.run.error?.message).toContain("expired");
  expect(f.calls()).toBe(3);
  const state = paused.project.editStagePlans![start.run.id];
  expect(
    state.plan.stages.filter(
      (stage) => stage.kind === "caption_batch" && stage.status === "completed",
    ),
  ).toHaveLength(1);
  await expect(
    f.newAgent().resume(f.project.id, start.run.id, {
      operationId: "expired-resume",
      baseRevision: paused.project.revision,
      baseHash: paused.project.documentHash,
    }),
  ).rejects.toThrow(/expired/);
  expect(f.calls()).toBe(3);
}, 15000);

it("reuses the completed source-bound ASR receipt after a stage restart without another provider submission", async () => {
  const tasks = new Map<string, AgentAsrTask>();
  const startAsr = vi.fn<AgentSpeechPort["start"]>(
    async (projectId, source) => {
      const words = Array.from({ length: 201 }, (_, i) => ({
        text: `Source 0 sentence ${i}.`,
        start_time_ms: i * 4000,
        end_time_ms: i * 4000 + 3000,
      }));
      const task: AgentAsrTask = {
        id: randomUUID(),
        project_id: projectId,
        asset_id: source.sourceId,
        sourceHash: source.fingerprint,
        operationId: `asr:${projectId}:${source.requestId}`,
        status: "completed",
        raw_asr_result: {
          text: words.map((word) => word.text).join(" "),
          language: "en",
          duration_ms: 804000,
          utterances: [
            {
              text: words.map((word) => word.text).join(" "),
              start_time_ms: 0,
              end_time_ms: 804000,
              words,
            },
          ],
        },
      };
      tasks.set(task.id, task);
      return task;
    },
  );
  const speech: AgentSpeechPort = {
    start: startAsr,
    get: (id) => tasks.get(id),
  };
  let interrupted = false;
  const f = await fixture(
    1,
    201,
    {
      onTransition: async (plan) => {
        if (
          !interrupted &&
          plan.stages.filter(
            (stage) =>
              stage.kind === "caption_batch" && stage.status === "completed",
          ).length === 2
        ) {
          interrupted = true;
          throw new Error("Interrupted after two paid batches");
        }
      },
    },
    speech,
  );
  await f.store.transaction(f.project.id, async (p) => {
    const document = structuredClone(p.document);
    document.evidence = {};
    p.sources.push({
      sourceId: "a0",
      assetId: "a0",
      url: "/owned/speech.mp4",
      status: "available",
      fingerprint: "a".repeat(64),
      scheme: "sha256",
      byteLength: 1024,
      mimeType: "video/mp4",
      fileName: "Speech.mp4",
    });
    await commitDocument(p, document, false);
  });
  const current = await f.store.read(f.project.id),
    input = {
      ...requestFor(f),
      baseRevision: current.revision,
      baseHash: current.documentHash,
      cloudConsent: true,
    };
  const started = await f.agent.start(f.project.id, input),
    paused = await settled(f.store, f.project.id, true);
  expect(paused.run.status, JSON.stringify(paused.run.error)).toBe("failed");
  expect(startAsr).toHaveBeenCalledTimes(1);
  expect(f.calls()).toBe(5);
  const savedRaw = JSON.stringify([...tasks.values()]),
    completedBefore = paused.project
      .editStagePlans![
        started.run.id
      ].plan.stages.filter((stage) => stage.status === "completed")
      .map((stage) => stage.outputs);
  await f.newAgent().resume(f.project.id, started.run.id, {
    operationId: "reuse-asr-and-batches",
    baseRevision: paused.project.revision,
    baseHash: paused.project.documentHash,
  });
  const done = await settled(f.store, f.project.id, true);
  expect(done.run.status, JSON.stringify(done.run.error)).toBe(
    "awaiting_review",
  );
  expect(startAsr).toHaveBeenCalledTimes(1);
  expect(f.calls()).toBe(9);
  expect(JSON.stringify([...tasks.values()])).toBe(savedRaw);
  expect(
    done.project
      .editStagePlans![started.run.id].plan.stages.filter(
        (stage) => stage.status === "completed",
      )
      .slice(0, completedBefore.length)
      .map((stage) => stage.outputs),
  ).toEqual(completedBefore);
}, 30000);

it("continues only a closed eight-call invocation and keeps all attempts inside one original budget", async () => {
  const f = await fixture(1, 3, {}),
    original = f.model.complete;
  let discovery = 0,
    actualRequests = 0;
  f.model.complete = vi.fn(
    async (...args: Parameters<LanguageModel["complete"]>) => {
      actualRequests++;
      const data = JSON.parse(
        String(args[0].find((message) => message.role === "user")!.content),
      );
      if (
        data.durableStages?.activeStage.kind === "caption_batch" &&
        discovery < 8
      ) {
        discovery++;
        return {
          text: "",
          calls: [
            {
              id: `discovery-${discovery}`,
              name: "inspect_project",
              arguments: JSON.stringify({ itemIds: ["speech0"] }),
            },
          ],
          usage: { inputTokens: 20, outputTokens: 5 },
        };
      }
      return original(...args);
    },
  );
  const start = await f.agent.start(f.project.id, requestFor(f)),
    done = await settled(f.store, f.project.id);
  expect(done.run.status, JSON.stringify(done.run.error)).toBe(
    "awaiting_review",
  );
  const state = done.project.editStagePlans![start.run.id],
    attempts = state.plan.attempts.filter(
      (attempt) => attempt.stageId === "caption:0:0",
    );
  expect(attempts).toHaveLength(2);
  expect(attempts.map((attempt) => attempt.usage.modelCalls)).toEqual([8, 2]);
  expect(state.plan.usage.modelCalls).toBe(actualRequests);
  expect(actualRequests).toBe(13);
  expect(state.plan.limits).toMatchObject({
    modelCalls: 32,
    toolCalls: 64,
    outputTokens: 32000,
    perStage: { modelCalls: 8, outputTokens: 16000 },
  });
  expect(
    new Set(state.plan.attempts.map((attempt) => attempt.modelIdentity)),
  ).toEqual(new Set([f.model.identity]));
  expect(done.project.runs).toHaveLength(1);
  expect(done.project.revision).toBe(f.project.revision);
}, 15000);

it("preserves a twelve-turn normal direct edit before a caption workflow exists", async () => {
  const f = await fixture(1, 3, {});
  let calls = 0;
  const edit = {
    outcome: "proposal",
    summary: "Use the requested blue background",
    commands: [
      {
        type: "set",
        target: { kind: "format" },
        path: ["backgroundColor"],
        value: "#123456",
      },
    ],
  };
  f.model.complete = vi.fn(async () => {
    const turn = ++calls,
      name =
        turn <= 10
          ? "read_skill"
          : turn === 11
            ? "review_edit"
            : "propose_edit";
    const args =
      turn <= 10
        ? { name: "precise-editing" }
        : turn === 11
          ? {
              requirements: [
                {
                  id: "background",
                  kind: "property",
                  target: { kind: "format" },
                  path: ["backgroundColor"],
                  equals: "#123456",
                },
              ],
              edit,
            }
          : edit;
    return {
      text: "",
      calls: [{ id: `direct-${turn}`, name, arguments: JSON.stringify(args) }],
      usage: { inputTokens: 20, outputTokens: 20 },
    };
  });
  const start = await f.agent.start(f.project.id, {
    ...requestFor(f),
    instruction: "Set the canvas background to blue #123456.",
  });
  const done = await settled(f.store, f.project.id);
  expect(done.run.status, JSON.stringify(done.run.error)).toBe(
    "awaiting_review",
  );
  expect(calls).toBe(12);
  expect(done.project.editStagePlans?.[start.run.id]).toBeUndefined();
  expect(
    parseLoopCheckpoint(done.run.loopCheckpoint!.checkpoint).snapshot.budgets
      .maxSteps,
  ).toBe(16);
}, 15000);

it("continues an active stage question in the same outer run with its exact original budget", async () => {
  const f = await fixture(1, 3, {}),
    complete = f.model.complete;
  let questioned = false,
    actual = 0;
  f.model.complete = vi.fn(
    async (...args: Parameters<LanguageModel["complete"]>) => {
      actual++;
      const data = JSON.parse(
        String(args[0].find((message) => message.role === "user")!.content),
      );
      if (
        !questioned &&
        data.durableStages?.activeStage.kind === "caption_batch" &&
        args[0].some((message) => message.role === "tool")
      ) {
        questioned = true;
        return {
          text: "",
          calls: [
            {
              id: "stage-question",
              name: "ask_user",
              arguments: JSON.stringify({
                id: "preserve-name",
                question: "Keep the source product name unchanged?",
                options: [
                  {
                    id: "keep",
                    label: "Keep the product name",
                    value: "Keep it unchanged",
                  },
                  {
                    id: "translate",
                    label: "Translate the product name",
                    value: "Translate it",
                  },
                ],
                allowText: false,
              }),
            },
          ],
          usage: { inputTokens: 20, outputTokens: 20 },
        };
      }
      return complete(...args);
    },
  );
  const start = await f.agent.start(f.project.id, requestFor(f)),
    waiting = await settled(f.store, f.project.id);
  expect(waiting.run.status, JSON.stringify(waiting.run.error)).toBe(
    "needs_input",
  );
  const before =
    waiting.project.editStagePlans![start.run.id].plan.usage.modelCalls;
  const response = await f.agent.answer(f.project.id, start.run.id, {
    operationId: "answer-within-stage",
    questionId: "preserve-name",
    optionId: "keep",
    baseRevision: waiting.project.revision,
    baseHash: waiting.project.documentHash,
  });
  expect(response.run.id).toBe(start.run.id);
  const done = await settled(f.store, f.project.id);
  expect(done.run.status, JSON.stringify(done.run.error)).toBe(
    "awaiting_review",
  );
  expect(done.project.runs).toHaveLength(1);
  const plan = done.project.editStagePlans![start.run.id].plan;
  expect(plan.usage.modelCalls).toBe(actual);
  expect(actual).toBeGreaterThan(before);
  expect(plan.limits).toMatchObject({ modelCalls: 32, outputTokens: 32000 });
  expect(
    plan.attempts.filter((attempt) => attempt.stageId === "caption:0:0"),
  ).toHaveLength(2);
}, 15000);

it("carries a planning clarification into the same outer run and aggregate stage budget", async () => {
  const f = await fixture(1, 3, {}),
    complete = f.model.complete;
  let questioned = false,
    actual = 0;
  f.model.complete = vi.fn(
    async (...args: Parameters<LanguageModel["complete"]>) => {
      actual++;
      const data = JSON.parse(
        String(args[0].find((message) => message.role === "user")!.content),
      );
      if (!questioned && !data.durableStages) {
        questioned = true;
        return {
          text: "",
          calls: [
            {
              id: "planning-question",
              name: "ask_user",
              arguments: JSON.stringify({
                id: "product-name",
                question: "Keep the product name unchanged?",
                options: [
                  { id: "keep", label: "Keep", value: "Keep it" },
                  {
                    id: "translate",
                    label: "Translate",
                    value: "Translate it",
                  },
                ],
                allowText: false,
              }),
            },
          ],
          usage: { inputTokens: 30, outputTokens: 30 },
        };
      }
      return complete(...args);
    },
  );
  const start = await f.agent.start(f.project.id, requestFor(f)),
    waiting = await settled(f.store, f.project.id);
  expect(waiting.run.status).toBe("needs_input");
  // Simulate shutdown immediately after the durable answer transaction, before
  // the next loop checkpoint exists. Startup must retain one run and its usage.
  await vi.waitFor(() =>
    expect(
      (f.agent as unknown as { active: Map<string, unknown> }).active.has(
        start.run.id,
      ),
    ).toBe(false),
  );
  const launch = vi
    .spyOn(
      f.agent as unknown as { launch(projectId: string, runId: string): void },
      "launch",
    )
    .mockImplementation(() => {});
  const result = await f.agent.answer(f.project.id, start.run.id, {
    operationId: "answer-before-plan",
    questionId: "product-name",
    optionId: "keep",
    baseRevision: waiting.project.revision,
    baseHash: waiting.project.documentHash,
  });
  expect(result.run.id).toBe(start.run.id);
  launch.mockRestore();
  const restartedStore = new ProjectStore(f.store.directory);
  const accepted = await restartedStore.read(f.project.id);
  await restartedStore.transaction(f.project.id, (p) => {
    p.runs[0].preludeCheckpoints![0].contextHash = "sha256:" + "0".repeat(64);
  });
  await restartedStore.recoverInterrupted();
  expect((await restartedStore.read(f.project.id)).runs[0].status).toBe(
    "failed",
  );
  await restartedStore.save(accepted);
  await restartedStore.recoverInterrupted();
  expect((await restartedStore.read(f.project.id)).runs[0]).toMatchObject({
    status: "queued",
    phase: "stage_resume",
  });
  const restarted = new AgentService(
    restartedStore,
    () => f.model,
    builtInSkills(),
    undefined,
    undefined,
    undefined,
    "local-editor-v6",
  );
  await restarted.resume(f.project.id, start.run.id, {
    operationId: "resume-planning-answer",
    baseRevision: waiting.project.revision,
    baseHash: waiting.project.documentHash,
  });
  const done = await settled(f.store, f.project.id);
  expect(done.run.status, JSON.stringify(done.run.error)).toBe(
    "awaiting_review",
  );
  expect(done.project.runs).toHaveLength(1);
  expect(done.run.preludeCheckpoints).toHaveLength(1);
  expect(done.project.editStagePlans![start.run.id].plan.usage.modelCalls).toBe(
    actual,
  );
  expect(actual).toBe(6);
  expect(
    done.project.editStagePlans![start.run.id].plan.limits.modelCalls,
  ).toBe(32);
}, 15000);
