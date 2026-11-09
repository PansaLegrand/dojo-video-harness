import { afterEach, expect, it, vi } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import os from "node:os";
import path from "node:path";
import { AgentService } from "../apps/server/src/agent-service";
import {
  ProjectStore,
  commitDocument,
  publicRun,
  type StoredRun,
} from "../apps/server/src/store";
import { createAgentCheckpointPort } from "../apps/server/src/agent-loop-checkpoint";
import { runAgent } from "../packages/agent/src/loop";
import type {
  AgentTool,
  Skill,
  LanguageModel,
  ModelReply,
} from "../packages/agent/src/index";
import {
  parseLoopCheckpoint,
  measureLoopCheckpointBytes,
  type LoopCheckpointCapacity,
} from "../packages/agent-loop/src/index";
import { GptResponsesModel } from "../packages/adapters/src/gpt-responses";
import {
  createVideoProjectDocument,
  parseVideoProjectDocument,
  canonicalSerialize,
} from "../packages/core/src/lib/video-project/document";
import {
  prepareAgentSpeech,
  type AgentSpeechPort,
  type AgentAsrTask,
} from "../apps/server/src/agent-speech";
import type { NativeAgentRequest } from "../packages/core/src/lib/video-project/agent-runtime";
import type {
  LoopCheckpointPhase,
  LoopCheckpointPort,
} from "../packages/agent-loop/src/index";

const directories: string[] = [];
afterEach(async () => {
  vi.unstubAllGlobals();
  await Promise.all(
    directories
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true })),
  );
});
const usage = { inputTokens: 10, outputTokens: 5 }; // Known synthetic counts, never billing evidence.
const inspect = { id: "inspect", name: "inspect_project", arguments: "{}" };
const edit = {
  id: "edit",
  name: "propose_edit",
  arguments: JSON.stringify({
    summary: "Make title red",
    commands: [
      {
        type: "set",
        target: { kind: "node", itemId: "title", nodeId: "title" },
        path: ["style", "color"],
        value: "#ff0000",
      },
    ],
  }),
};
const reply = (
  calls = [inspect, edit],
  counts: ModelReply["usage"] | null = usage,
): ModelReply => ({ text: "", calls, ...(counts ? { usage: counts } : {}) });
async function seed(speech = false) {
  const directory = await mkdtemp(
    path.join(os.tmpdir(), "harness-checkpoint-"),
  );
  directories.push(directory);
  const store = new ProjectStore(directory);
  await store.init();
  const initial = await store.create();
  await store.transaction(initial.id, async (p) => {
    const document = createVideoProjectDocument({
      width: 640,
      height: 360,
      fps: 30,
      durationInFrames: 180,
    });
    document.items.push({
      id: "title",
      name: "Title",
      trackId: "visual",
      node: {
        id: "title",
        type: "text",
        text: "Hello",
        from: 0,
        duration: 180,
        style: { color: "#ffffff" },
      },
    });
    if (speech) {
      document.assets.source = {
        id: "source",
        name: "Speech.wav",
        type: "audio",
        source: "local",
        durationSeconds: 6,
      };
      document.sources.source = {
        assetId: "source",
        revision: "owned-source-revision",
      };
      document.items.push({
        id: "speech",
        name: "Speech",
        trackId: "audio",
        node: {
          id: "speech",
          type: "audio",
          assetId: "source",
          from: 0,
          duration: 180,
        },
      });
      p.sources.push({
        sourceId: "source",
        assetId: "source",
        url: "/owned/source.wav",
        status: "available",
        fingerprint: "a".repeat(64),
        scheme: "sha256",
        byteLength: 1000,
        mimeType: "audio/wav",
        fileName: "Speech.wav",
      });
    }
    await commitDocument(p, parseVideoProjectDocument(document), false);
  });
  const project = await store.read(initial.id);
  const runId = randomUUID();
  const input = {
    operationId: randomUUID(),
    instruction: speech
      ? "Add English captions to the speech"
      : "Make the title red",
    baseRevision: project.revision,
    baseHash: project.documentHash,
    scope: { kind: "project" as const },
    context: { selectedItemIds: [], playheadFrame: 0 },
    cloudConsent: speech,
  };
  const request: NativeAgentRequest = {
    contract: "video-project-commands",
    version: 1,
    baseRevision: project.revision,
    baseHash: project.documentHash,
    document: project.document,
    instruction: input.instruction,
    context: input.context,
    authoring: { version: 1, scope: input.scope },
  };
  const now = new Date().toISOString();
  const run: StoredRun = {
    id: runId,
    ...input,
    request,
    requestHash: canonicalSerialize(input),
    status: "running",
    phase: "thinking",
    proposal: null,
    prerequisites: null,
    error: null,
    createdAt: now,
    updatedAt: now,
    reviewBasisRequired: true,
    events: [],
  };
  await store.transaction(project.id, (p) => {
    p.runs.push(run);
  });
  return { store, projectId: project.id, runId, request, input };
}
type Fixture = Awaited<ReturnType<typeof seed>>;
function speechPort() {
  const tasks = new Map<string, AgentAsrTask>();
  const start = vi.fn<AgentSpeechPort["start"]>(async (projectId, source) => {
    const task: AgentAsrTask = {
      id: randomUUID(),
      project_id: projectId,
      asset_id: source.sourceId,
      sourceHash: source.fingerprint,
      operationId: `asr:${projectId}:${source.requestId}`,
      status: "completed",
      raw_asr_result: {
        text: "Hello.",
        language: "en",
        utterances: [
          {
            text: "Hello.",
            start_time_ms: 0,
            end_time_ms: 800,
            words: [{ text: "Hello.", start_time_ms: 0, end_time_ms: 800 }],
          },
        ],
      },
    };
    tasks.set(task.id, task);
    return task;
  });
  const port: AgentSpeechPort = { start, get: (id) => tasks.get(id) };
  return { port, start };
}
async function runUntilCrash(
  f: Fixture,
  model: LanguageModel,
  phase?: LoopCheckpointPhase,
  options: {
    extraTools?: AgentTool[];
    skills?: Skill[];
    request?: NativeAgentRequest;
    legacy?: boolean;
    capacity?: LoopCheckpointCapacity;
    history?: Array<{ role: "user" | "assistant"; text: string }>;
  } = {},
) {
  let port: LoopCheckpointPort | undefined;
  let crashed = false;
  const work = runAgent({
    request: options.request ?? f.request,
    model,
    skills: options.skills ?? [],
    extraTools: options.extraTools,
    signal: new AbortController().signal,
    messages: options.history ?? [],
    checkpoint: async ({ inventory, skills }) => {
      port = await createAgentCheckpointPort({
        store: f.store,
        projectId: f.projectId,
        runId: f.runId,
        request: options.request ?? f.request,
        history: options.history ?? [],
        inventory,
        skills,
        modelIdentity: model.identity,
        signal: new AbortController().signal,
      });
      return {
        ...port,
        ...(options.legacy
          ? { encoding: undefined, capacity: undefined }
          : options.capacity
            ? { capacity: options.capacity }
            : {}),
        save: async (next, previous) => {
          await port!.save(next, previous);
          if (!crashed && next.phase === phase) {
            crashed = true;
            throw new Error("Simulated crash after durable checkpoint");
          }
        },
      };
    },
    onEvent: (event) =>
      f.store.transaction(f.projectId, (p) => {
        p.runs[0]!.events.push(event);
      }),
  });
  await expect(work).rejects.toThrow();
  return port!;
}
async function restart(
  f: Fixture,
  model: LanguageModel,
  options: {
    extraTools?: AgentTool[];
    skills?: Skill[];
    speech?: AgentSpeechPort;
  } = {},
) {
  const store = new ProjectStore(f.store.directory);
  await store.init();
  const agent = new AgentService(
    store,
    model,
    options.skills ?? [],
    options.extraTools ? () => options.extraTools! : undefined,
    "review",
    options.speech,
  );
  await agent.recover();
  await expect
    .poll(async () => (await store.read(f.projectId)).runs[0]!.status)
    .not.toMatch(/^(queued|running)$/);
  return { store, agent, project: await store.read(f.projectId) };
}

it.each<LoopCheckpointPhase>([
  "model-returned",
  "tool-observations",
  "completed",
])(
  "resumes %s without repeating the model or a completed tool",
  async (phase) => {
    const f = await seed();
    const first = {
      identity: "fixture-model-v1",
      complete: vi.fn(async () => reply()),
    };
    await runUntilCrash(f, first, phase);
    const next = {
      identity: first.identity,
      complete: vi.fn(async () => {
        throw new Error("Known model response must not be requested again");
      }),
    };
    const recovered = await restart(f, next);
    const run = recovered.project.runs[0]!;
    expect(run.status, run.error?.message).toBe("awaiting_review");
    expect(first.complete).toHaveBeenCalledTimes(1);
    expect(next.complete).not.toHaveBeenCalled();
    expect(run.loopCheckpoint!.checkpoint).toMatchObject({
      phase: "completed",
      modelCalls: 1,
      toolCalls: 2,
      usedToolCallIds: ["inspect", "edit"],
    });
    expect(
      run.events.filter(
        (event) =>
          event.type === "tool.started" && event.name === "inspect_project",
      ),
    ).toHaveLength(1);
    expect(new Set(run.events.map((event) => event.sequence)).size).toBe(
      run.events.length,
    );
    expect(publicRun(run)).not.toHaveProperty("loopCheckpoint");
    const review = await recovered.agent.review(f.projectId, f.runId);
    await recovered.agent.apply(f.projectId, f.runId, {
      operationId: randomUUID(),
      baseRevision: recovered.project.revision,
      baseHash: recovered.project.documentHash,
      reviewBasis: review.review.basis,
    });
    const applied = await recovered.store.read(f.projectId);
    expect(applied.document.items[0]!.node.style!.color).toBe("#ff0000");
    await recovered.agent.undo(f.projectId, f.runId, {
      operationId: randomUUID(),
      baseRevision: applied.revision,
      baseHash: applied.documentHash,
    });
    expect((await recovered.store.read(f.projectId)).document).toEqual(
      recovered.project.document,
    );
    expect(next.complete).not.toHaveBeenCalled();
  },
);

it("replays an explicitly pure in-flight tool with the original call identity and budget", async () => {
  const f = await seed();
  await runUntilCrash(
    f,
    { identity: "fixture", complete: async () => reply() },
    "tool-pending",
  );
  const complete = vi.fn(async () => reply());
  const { project } = await restart(f, { identity: "fixture", complete });
  const run = project.runs[0]!;
  expect(run.status, run.error?.message).toBe("awaiting_review");
  expect(complete).not.toHaveBeenCalled();
  expect(run.loopCheckpoint!.checkpoint.toolCalls).toBe(2);
  expect(
    run.events.some(
      (event) =>
        event.name === "inspect_project" &&
        event.replay === true &&
        event.callId === "inspect",
    ),
  ).toBe(true);
});

it("keeps uncertain model and external tool outcomes failed until manual reconciliation", async () => {
  for (const kind of ["model", "tool"] as const) {
    const f = await seed();
    const execute = vi.fn<AgentTool["execute"]>(
      async (_args, _signal, context) => {
        expect(context).toMatchObject({
          callId: "external",
          runId: f.runId,
          replay: false,
        });
        throw new Error("Submission outcome unknown");
      },
    );
    const external: AgentTool = {
      name: "prepare_external_plan",
      description: "A durable host action",
      effect: "read",
      parameters: { type: "object" },
      execute,
    };
    const first = {
      identity: "fixture",
      complete: vi.fn(async () => {
        if (kind === "model")
          throw new Error("Paid provider response was lost");
        return reply([
          { id: "external", name: external.name, arguments: "{}" },
        ]);
      }),
    };
    await runUntilCrash(f, first, undefined, { extraTools: [external] });
    const complete = vi.fn(async () => reply());
    const { project } = await restart(
      f,
      { identity: "fixture", complete },
      { extraTools: [external] },
    );
    expect(project.runs[0]).toMatchObject({
      status: "failed",
      phase: "interrupted",
      error: { code: "INTERRUPTED" },
    });
    expect(first.complete).toHaveBeenCalledTimes(1);
    expect(complete).not.toHaveBeenCalled();
    expect(execute).toHaveBeenCalledTimes(kind === "tool" ? 1 : 0);
  }
});

it("carries cumulative provider usage and remaining output budget across restart", async () => {
  const f = await seed();
  await runUntilCrash(
    f,
    {
      identity: "fixture",
      complete: async () =>
        reply([inspect], { inputTokens: 40, outputTokens: 32000 }),
    },
    "tool-observations",
  );
  await f.store.transaction(f.projectId, (p) => {
    p.messages.push({
      id: randomUUID(),
      runId: randomUUID(),
      role: "user",
      text: "An unrelated later chat",
      status: "completed",
      createdAt: new Date().toISOString(),
    });
  });
  const complete = vi.fn<LanguageModel["complete"]>(
    async (_messages, _tools, _signal, limits) => {
      expect(limits?.maxOutputTokens).toBe(768);
      expect(
        JSON.parse(
          String(_messages.find((message) => message.role === "user")!.content),
        ).conversation,
      ).toEqual([]);
      return reply([edit], { inputTokens: 20, outputTokens: 700 });
    },
  );
  const { project } = await restart(f, { identity: "fixture", complete });
  expect(project.runs[0]!.status).toBe("awaiting_review");
  expect(project.runs[0]!.loopCheckpoint!.checkpoint).toMatchObject({
    modelCalls: 2,
    toolCalls: 2,
    usageKnown: true,
    usage: { inputTokens: 60, outputTokens: 32700 },
  });
});

it("does not authorize another model turn when previous provider usage was unknown", async () => {
  const f = await seed();
  await runUntilCrash(f, {
    identity: "fixture",
    complete: async () => reply([inspect], null),
  });
  const complete = vi.fn(async () => reply([edit]));
  const { project } = await restart(f, { identity: "fixture", complete });
  expect(project.runs[0]).toMatchObject({
    status: "failed",
    error: { message: expect.stringMatching(/output budget/) },
  });
  expect(project.runs[0]!.loopCheckpoint!.checkpoint).toMatchObject({
    usageKnown: false,
    modelCalls: 1,
    usage: { outputTokens: 32768 },
  });
  expect(complete).not.toHaveBeenCalled();
});

it.each(["source", "request", "tool", "skill", "provider"] as const)(
  "fails closed on %s drift before another model or tool call",
  async (kind) => {
    const f = await seed(kind === "source");
    const extra: AgentTool = {
      name: "custom_read",
      description: "Original schema",
      effect: "read",
      parameters: { type: "object" },
      execute: async () => ({ kind: "observation", value: {} }),
    };
    const skills = [
      {
        name: "custom-guide",
        description: "A trusted guide",
        instructions: "Preserve originals.",
      },
    ];
    await runUntilCrash(
      f,
      { identity: "fixture", complete: async () => reply() },
      "model-returned",
      { extraTools: [extra], skills },
    );
    await f.store.transaction(f.projectId, (p) => {
      if (kind === "source") p.sources[0]!.fingerprint = "b".repeat(64);
      if (kind === "request")
        p.runs[0]!.request.instruction = "A different request";
    });
    const complete = vi.fn(async () => reply());
    const { project } = await restart(
      f,
      {
        identity: kind === "provider" ? "different-provider" : "fixture",
        complete,
      },
      {
        extraTools: [
          {
            ...extra,
            description: kind === "tool" ? "Changed schema" : extra.description,
          },
        ],
        skills:
          kind === "skill"
            ? [{ ...skills[0]!, instructions: "Changed trusted guidance." }]
            : skills,
      },
    );
    expect(project.runs[0]!.status).toBe("failed");
    expect(project.runs[0]!.error?.message).toMatch(
      /checkpoint|source|inventory|provider/i,
    );
    expect(complete).not.toHaveBeenCalled();
  },
);

it("does not recover cancelled or legacy interrupted runs", async () => {
  const cancelled = await seed();
  await runUntilCrash(
    cancelled,
    { identity: "fixture", complete: async () => reply() },
    "model-returned",
  );
  const complete = vi.fn(async () => reply());
  const host = new AgentService(
    cancelled.store,
    { identity: "fixture", complete },
    [],
  );
  await host.cancel(cancelled.projectId, cancelled.runId);
  expect(
    (await restart(cancelled, { identity: "fixture", complete })).project
      .runs[0]!.status,
  ).toBe("cancelled");
  const legacy = await seed();
  const { project } = await restart(legacy, { identity: "fixture", complete });
  expect(project.runs[0]).toMatchObject({
    status: "failed",
    phase: "interrupted",
    error: { code: "INTERRUPTED" },
  });
  expect(complete).not.toHaveBeenCalled();
});

it("claims checkpoint revisions atomically through the project transaction", async () => {
  const f = await seed();
  const port = await runUntilCrash(
    f,
    { identity: "fixture", complete: async () => reply() },
    "model-returned",
  );
  const saved = parseLoopCheckpoint(
    (await f.store.read(f.projectId)).runs[0]!.loopCheckpoint!.checkpoint,
  );
  const next = { ...saved, revision: saved.revision + 1 };
  const attempts = await Promise.allSettled([
    port.save(next, saved.revision),
    port.save(next, saved.revision),
  ]);
  expect(
    attempts.filter((attempt) => attempt.status === "fulfilled"),
  ).toHaveLength(1);
  expect(
    (await f.store.read(f.projectId)).runs[0]!.loopCheckpoint!.checkpoint
      .revision,
  ).toBe(saved.revision + 1);
});

it("resumes a returned model turn with the same completed ASR receipt and no paid resubmission", async () => {
  const f = await seed(true);
  const { port, start } = speechPort();
  const request = (await prepareAgentSpeech(
    f.store,
    f.projectId,
    f.runId,
    port,
    new AbortController().signal,
  ))!;
  const evidenceId = Object.keys(
    parseVideoProjectDocument(request.document).evidence,
  )[0]!;
  expect(start).toHaveBeenCalledTimes(1);
  await f.store.transaction(f.projectId, (p) => {
    p.runs[0]!.status = "running";
    p.runs[0]!.speechContinuation!.modelStarted = true;
  });
  const calls = [
    {
      id: "caption",
      name: "propose_edit",
      arguments: JSON.stringify({
        summary: "Add captions",
        commands: [
          {
            type: "captionSource",
            sourceItemId: "speech",
            evidenceId,
            itemId: "captions",
            trackId: "visual",
          },
        ],
      }),
    },
  ];
  await runUntilCrash(
    f,
    { identity: "fixture", complete: async () => reply(calls) },
    "model-returned",
    { request },
  );
  const complete = vi.fn(async () => reply(calls));
  const { project, agent, store } = await restart(
    f,
    { identity: "fixture", complete },
    { speech: port },
  );
  expect(project.runs[0]!.status, project.runs[0]!.error?.message).toBe(
    "awaiting_review",
  );
  expect(complete).not.toHaveBeenCalled();
  expect(start).toHaveBeenCalledTimes(1);
  expect(
    project.runs[0]!.proposal!.commands.filter(
      (command) => command.type === "addEvidence",
    ),
  ).toHaveLength(1);
  const review = await agent.review(f.projectId, f.runId);
  await agent.apply(f.projectId, f.runId, {
    operationId: randomUUID(),
    baseRevision: project.revision,
    baseHash: project.documentHash,
    reviewBasis: review.review.basis,
  });
  expect(
    Object.keys((await store.read(f.projectId)).document.evidence),
  ).toEqual([evidenceId]);
  expect(start).toHaveBeenCalledTimes(1);
});

it.each(["local-editor-v1", "local-editor-v2"] as const)(
  "gives a clarification child fresh checkpoints and retains ASR after restart (%s)",
  async (profile) => {
    const f = await seed(true);
    await f.store.transaction(f.projectId, (p) => {
      p.runs = [];
    });
    const { port, start } = speechPort();
    let turn = 0;
    const complete = vi.fn<LanguageModel["complete"]>(async (messages) => {
      const context = JSON.parse(
        String(messages.find((message) => message.role === "user")!.content),
      );
      if (++turn === 1)
        return reply([
          {
            id: "question",
            name: "ask_user",
            arguments: JSON.stringify({
              id: "language",
              question: "Which language?",
              options: [
                { id: "english", label: "English" },
                { id: "chinese", label: "Chinese" },
              ],
              allowText: true,
            }),
          },
        ]);
      expect(context.authoring.clarification.answer).toBe("English");
      const evidenceId = Object.keys(context.document.evidence)[0];
      const edit = {
        summary: "Add English captions",
        commands: [
          {
            type: "captionSource",
            sourceItemId: "speech",
            evidenceId,
            itemId: "captions",
            trackId: "visual",
          },
        ],
      };
      const reviewed = messages.some(
        (message) =>
          message.role === "tool" &&
          String(message.content).includes('"status":"passed"'),
      );
      const preflight = profile === "local-editor-v2" && !reviewed;
      return reply([
        {
          id: preflight ? "review" : "caption",
          name: preflight ? "review_edit" : "propose_edit",
          arguments: JSON.stringify(
            preflight
              ? {
                  requirements: [
                    {
                      id: "captions",
                      kind: "item_present",
                      itemId: "captions",
                    },
                  ],
                  edit,
                }
              : edit,
          ),
        },
      ]);
    });
    let host = new AgentService(
      f.store,
      { identity: "fixture", complete },
      [],
      undefined,
      "review",
      port,
      profile,
    );
    const started = await host.start(f.projectId, f.input);
    await expect
      .poll(async () => (await f.store.read(f.projectId)).runs[0]!.status)
      .toBe("needs_input");
    const p = await f.store.read(f.projectId);
    const parent = p.runs[0]!;
    host = new AgentService(
      f.store,
      { identity: "fixture", complete },
      [],
      undefined,
      "review",
      port,
      profile,
    );
    await host.recover();
    const child = await host.answer(f.projectId, started.run.id, {
      operationId: randomUUID(),
      questionId: parent.clarification!.id,
      baseRevision: p.revision,
      baseHash: p.documentHash,
      optionId: "english",
    });
    await expect
      .poll(
        async () =>
          (await f.store.read(f.projectId)).runs.find(
            (run) => run.id === child.run.id,
          )!.status,
      )
      .toBe("awaiting_review");
    const saved = await f.store.read(f.projectId);
    const next = saved.runs.find((run) => run.id === child.run.id)!;
    expect(complete).toHaveBeenCalledTimes(
      profile === "local-editor-v2" ? 3 : 2,
    );
    expect(start).toHaveBeenCalledTimes(1);
    expect(next.speechContinuation!.sources[0]!.taskId).toBe(
      parent.speechContinuation!.sources[0]!.taskId,
    );
    expect(next.loopCheckpoint!.checkpoint).toMatchObject({
      modelCalls: profile === "local-editor-v2" ? 2 : 1,
      usage: {
        inputTokens: profile === "local-editor-v2" ? 20 : 10,
        outputTokens: profile === "local-editor-v2" ? 10 : 5,
      },
    });
    expect(next.loopCheckpoint!.checkpoint.snapshot.runId).toBe(next.id);
    expect(next.loopCheckpoint!.contextHash).not.toBe(
      parent.loopCheckpoint!.contextHash,
    );
  },
);

it("binds provider endpoint/model identity without credentials or mutable configuration", () => {
  const config = {
    baseUrl: "https://example.test/v1",
    apiKey: "credential-one",
    model: "gpt-test",
  };
  const model = new GptResponsesModel(config);
  expect(model.identity).not.toMatch(/password|credential|secret|private|user/);
  expect(
    new GptResponsesModel({ ...config, apiKey: "credential-two" }).identity,
  ).toBe(model.identity);
  expect(
    new GptResponsesModel({ ...config, model: "gpt-other" }).identity,
  ).not.toBe(model.identity);
  expect(
    new GptResponsesModel({ ...config, baseUrl: "https://other.test/v1" })
      .identity,
  ).not.toBe(model.identity);
  const original = model.identity;
  config.model = "gpt-mutated";
  expect(model.identity).toBe(original);
});

it("persists a model-factory configuration failure without stranding or restarting the run", async () => {
  const f = await seed();
  await f.store.transaction(f.projectId, (p) => {
    p.runs = [];
  });
  const factory = vi.fn(() => {
    throw new Error("Invalid provider configuration");
  });
  const host = new AgentService(f.store, factory, []);
  const started = await host.start(f.projectId, f.input);
  await expect
    .poll(async () => (await f.store.read(f.projectId)).runs[0]!.status)
    .toBe("failed");
  expect((await f.store.read(f.projectId)).runs[0]!.error?.message).toBe(
    "Invalid provider configuration",
  );
  expect((await host.start(f.projectId, f.input)).run.id).toBe(started.run.id);
  await host.recover();
  expect(factory).toHaveBeenCalledTimes(1);
});

it("stores the compact byte profile within the complete UTF-8 host envelope", async () => {
  const f = await seed();
  const complete = vi.fn<LanguageModel["complete"]>(
    async (_messages, _tools, _signal, limits) => {
      expect(limits?.maxReplyBytes).toBe(256 * 1024);
      return reply();
    },
  );
  await runUntilCrash(f, { identity: "fixture", complete }, "model-returned", {
    history: [{ role: "assistant", text: "界".repeat(4000) }],
  });
  const saved = (await f.store.read(f.projectId)).runs[0]!.loopCheckpoint!;
  expect(saved.checkpoint.version).toBe(2);
  const logical = parseLoopCheckpoint(saved.checkpoint);
  const wrapperBytes = new TextEncoder().encode(
    JSON.stringify({ ...saved, checkpoint: null }),
  ).byteLength;
  expect(wrapperBytes).toBeGreaterThan(
    JSON.stringify({ ...saved, checkpoint: null }).length,
  );
  expect(logical.snapshot.checkpointCapacity).toEqual({
    maxBytes: 2 * 1024 * 1024 - Math.max(1024, wrapperBytes),
    maxReplyBytes: 256 * 1024,
    reserveBytes: 64 * 1024,
  });
  expect(logical.snapshot.checkpointEncoding).toBe("compact-v2");
  expect(
    new TextEncoder().encode(JSON.stringify(saved)).byteLength,
  ).toBeLessThanOrEqual(2 * 1024 * 1024);
});

it("keeps an accepted 0.1.1 checkpoint identity, usage and profile unchanged on upgrade", async () => {
  const f = await seed();
  const calls = [inspect, edit];
  const opaque = {
    type: "reasoning",
    id: "reasoning",
    encrypted_content: "界".repeat(100000),
    summary: [],
  };
  const response = {
    ...reply(calls),
    providerOutput: [
      opaque,
      ...calls.map((call) => ({
        type: "function_call",
        call_id: call.id,
        name: call.name,
        arguments: call.arguments,
        status: "completed",
      })),
    ],
  };
  await runUntilCrash(
    f,
    { identity: "fixture", complete: async () => response },
    "model-returned",
    { legacy: true },
  );
  const before = (await f.store.read(f.projectId)).runs[0]!.loopCheckpoint!;
  expect(before.checkpoint.version).toBe(1);
  const original = parseLoopCheckpoint(before.checkpoint);
  expect(original.snapshot).not.toHaveProperty("checkpointCapacity");
  expect(original.snapshot).not.toHaveProperty("checkpointEncoding");
  const complete = vi.fn(async () => reply());
  const recovered = await restart(f, { identity: "fixture", complete });
  const after = recovered.project.runs[0]!.loopCheckpoint!;
  expect(recovered.project.runs[0]!.status).toBe("awaiting_review");
  expect(complete).not.toHaveBeenCalled();
  expect(after.contextHash).toBe(before.contextHash);
  expect(after.checkpoint.version).toBe(1);
  const restored = parseLoopCheckpoint(after.checkpoint);
  expect(restored.bindingHash).toBe(original.bindingHash);
  expect(restored.snapshot).toEqual(original.snapshot);
  expect(restored.usage).toEqual(original.usage);
  expect(restored.modelCalls).toBe(1);
});

it("rejects UTF-8 reply headroom before a paid call and retains the accepted capacity on restart", async () => {
  async function unicodeFixture() {
    const f = await seed();
    const instruction = "界".repeat(4000);
    f.request.instruction = instruction;
    f.input.instruction = instruction;
    await f.store.transaction(f.projectId, (p) => {
      p.runs[0]!.instruction = instruction;
      p.runs[0]!.request.instruction = instruction;
      p.runs[0]!.requestHash = canonicalSerialize(f.input);
    });
    return f;
  }
  const calibration = await unicodeFixture();
  const complete = vi.fn(async () => reply());
  await runUntilCrash(
    calibration,
    { identity: "capacity-fixture", complete },
    "ready-for-model",
  );
  const initial = parseLoopCheckpoint(
    (await calibration.store.read(calibration.projectId)).runs[0]!
      .loopCheckpoint!.checkpoint,
  );
  const bytes = measureLoopCheckpointBytes(initial);
  const f = await unicodeFixture();
  const capacity = {
    maxBytes: bytes + 32768 + 16384 - 1024,
    maxReplyBytes: 32768,
    reserveBytes: 16384,
  };
  await runUntilCrash(
    f,
    { identity: "capacity-fixture", complete },
    undefined,
    { capacity },
  );
  expect(complete).not.toHaveBeenCalled();
  const saved = parseLoopCheckpoint(
    (await f.store.read(f.projectId)).runs[0]!.loopCheckpoint!.checkpoint,
  );
  expect(saved.phase).toBe("ready-for-model");
  expect(saved.modelCalls).toBe(0);
  expect(saved.snapshot.checkpointCapacity).toEqual(capacity);
  const recovered = await restart(f, {
    identity: "capacity-fixture",
    complete,
  });
  expect(complete).not.toHaveBeenCalled();
  expect(recovered.project.runs[0]!.error?.code).toBe(
    "LOOP_CHECKPOINT_CAPACITY",
  );
  const after = parseLoopCheckpoint(
    recovered.project.runs[0]!.loopCheckpoint!.checkpoint,
  );
  expect(after.modelCalls).toBe(0);
  expect(after.snapshot.checkpointCapacity).toEqual(capacity);
});

it("records an oversize opaque provider reply as a breach without automatically repeating the request", async () => {
  const f = await seed();
  await f.store.transaction(f.projectId, (p) => {
    p.runs = [];
  });
  const marker = "opaque-fixture-not-for-logs";
  const fetch = vi.fn(
    async () =>
      new Response(
        JSON.stringify({
          status: "completed",
          output: [
            {
              type: "reasoning",
              id: "rs",
              encrypted_content: marker + "界".repeat(100000),
              summary: [],
            },
          ],
          usage: { input_tokens: 10, output_tokens: 5 },
        }),
      ),
  );
  vi.stubGlobal("fetch", fetch);
  const model = new GptResponsesModel({
    baseUrl: "https://provider.example/v1",
    model: "gpt-test",
    apiKey: "synthetic-key",
  });
  const host = new AgentService(f.store, model, []);
  await host.start(f.projectId, f.input);
  await expect
    .poll(async () => (await f.store.read(f.projectId)).runs[0]!.status)
    .toBe("failed");
  const run = (await f.store.read(f.projectId)).runs[0]!;
  expect(run.error?.code).toBe("PROVIDER_REPLY_CAPACITY_EXCEEDED");
  expect(run.error?.message).not.toContain(marker);
  expect(run.events.some((event) => event.type === "tool.started")).toBe(false);
  expect(parseLoopCheckpoint(run.loopCheckpoint!.checkpoint)).toMatchObject({
    phase: "model-pending",
    modelCalls: 1,
  });
  await host.recover();
  expect(fetch).toHaveBeenCalledTimes(1);
});
