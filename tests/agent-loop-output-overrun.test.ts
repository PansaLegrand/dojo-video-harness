import { expect, it, vi } from "vitest";
import {
  DEFAULT_CHECKPOINT_CAPACITY,
  encodeLoopCheckpoint,
  LoopProviderOutputBudgetError,
  parseLoopCheckpoint,
  runToolLoop,
  type LoopCheckpoint,
  type LoopCheckpointPort,
  type ModelReply,
  type ToolLoopInput,
} from "../packages/agent-loop/src/index";
import { hashJson } from "../packages/agent-loop/src/json";

function memory(after?: (next: LoopCheckpoint) => void) {
  let value: unknown = null;
  return {
    get value() {
      return parseLoopCheckpoint(value);
    },
    set value(next: LoopCheckpoint) {
      value = encodeLoopCheckpoint(next);
    },
    get wire() {
      return structuredClone(value);
    },
    port: {
      runId: "overrun-run",
      snapshotHash: "immutable-source-instruction",
      encoding: "compact-v2",
      capacity: DEFAULT_CHECKPOINT_CAPACITY,
      load: async () => structuredClone(value),
      save: async (next, expected) => {
        expect(expected).toBe(
          value === null ? null : parseLoopCheckpoint(value).revision,
        );
        value = encodeLoopCheckpoint(next);
        after?.(next);
      },
    } satisfies LoopCheckpointPort,
  };
}
function reply(
  tokens: number,
  name = "finish",
  outputTokenLimit?: number,
): ModelReply {
  return {
    text: "Retain this paid output exactly.",
    calls: [{ id: `${name}-call`, name, arguments: "{}" }],
    providerOutput: [
      {
        type: "reasoning",
        encrypted_content: "original opaque paid reasoning",
      },
    ],
    usage: { inputTokens: 13, outputTokens: tokens },
    ...(outputTokenLimit === undefined ? {} : { outputTokenLimit }),
  };
}
function options(
  port: LoopCheckpointPort,
  responses: ModelReply[],
  maxOutputTokens = 20,
): ToolLoopInput<string> {
  let index = 0;
  return {
    checkpoint: port,
    messages: [{ role: "user", content: "Complete the full original edit." }],
    signal: new AbortController().signal,
    model: {
      identity: "recorded-provider:model",
      complete: vi.fn(async () => responses[index++]),
    },
    tools: [
      {
        name: "read",
        description: "Read",
        parameters: { type: "object" },
        replaySafe: true,
        execute: vi.fn(async () => ({
          kind: "observation" as const,
          value: { exact: "source" },
        })),
      },
      {
        name: "finish",
        description: "Finish",
        parameters: { type: "object" },
        replaySafe: true,
        execute: vi.fn(async () => ({
          kind: "terminal" as const,
          result: "candidate",
        })),
      },
    ],
    answer: vi.fn(async (text) => text),
    maxSteps: 16,
    maxToolCalls: 24,
    maxOutputTokens,
  };
}
it("preserves a per-request overrun below the total budget and replays its error without model/tools", async () => {
  const saved = memory(),
    paid = reply(9, "finish", 8),
    input = options(saved.port, [paid]);
  await expect(runToolLoop(input)).rejects.toBeInstanceOf(
    LoopProviderOutputBudgetError,
  );
  expect(saved.value).toMatchObject({
    phase: "model-returned",
    usage: { inputTokens: 13, outputTokens: 9 },
    snapshot: {
      budgets: { maxOutputTokens: 20 },
      outputBudgetPolicy: "preserve-overrun-v1",
    },
    pendingTurn: { reply: paid, nextToolIndex: 0 },
    outputBudgetOverrun: {
      kind: "provider-output-budget",
      modelCall: 1,
      priorOutputTokens: 0,
      requestedMaxOutputTokens: 8,
      returnedOutputTokens: 9,
    },
    modelCalls: 1,
    toolCalls: 0,
  });
  expect(
    JSON.stringify(saved.wire).split("original opaque paid reasoning"),
  ).toHaveLength(2);
  await expect(runToolLoop(input)).rejects.toMatchObject({
    code: "LOOP_PROVIDER_OUTPUT_BUDGET",
    overrun: saved.value.outputBudgetOverrun,
  });
  expect(input.model.complete).toHaveBeenCalledTimes(1);
  expect(input.tools[1].execute).not.toHaveBeenCalled();
  expect(input.answer).not.toHaveBeenCalled();
});
it.each([
  [5, 6, 10],
  [11147, 8822, 16000],
])(
  "preserves cumulative actual usage after %i prior and %i returned tokens against %i frozen tokens",
  async (prior, returned, maximum) => {
    const saved = memory(),
      input = options(
        saved.port,
        [reply(prior, "read"), reply(returned)],
        maximum,
      );
    await expect(runToolLoop(input)).rejects.toMatchObject({
      code: "LOOP_PROVIDER_OUTPUT_BUDGET",
    });
    expect(saved.value.usage).toEqual({
      inputTokens: 26,
      outputTokens: prior + returned,
    });
    expect(saved.value.outputBudgetOverrun).toMatchObject({
      priorOutputTokens: prior,
      requestedMaxOutputTokens: maximum - prior,
      returnedOutputTokens: returned,
    });
    expect(saved.value.snapshot.budgets.maxOutputTokens).toBe(maximum);
    expect(input.tools[0].execute).toHaveBeenCalledTimes(1);
    expect(input.tools[1].execute).not.toHaveBeenCalled();
    await expect(runToolLoop(input)).rejects.toBeInstanceOf(
      LoopProviderOutputBudgetError,
    );
    expect(input.model.complete).toHaveBeenCalledTimes(2);
  },
);
it("replays a reply saved before a process crash with no new paid request or answer", async () => {
  let crash = true;
  const saved = memory((next) => {
    if (next.outputBudgetOverrun && crash) {
      crash = false;
      throw new Error("crash after durable overrun");
    }
  });
  const paid = { ...reply(21), calls: [] },
    input = options(saved.port, [paid]);
  await expect(runToolLoop(input)).rejects.toThrow(
    "crash after durable overrun",
  );
  expect(saved.value.pendingTurn?.reply).toEqual(paid);
  await expect(runToolLoop(input)).rejects.toMatchObject({
    code: "LOOP_PROVIDER_OUTPUT_BUDGET",
  });
  expect(input.model.complete).toHaveBeenCalledTimes(1);
  expect(input.answer).not.toHaveBeenCalled();
});
it("retains unknown-usage reservation and valid exactly-at-limit replies", async () => {
  for (const unknown of [false, true]) {
    const saved = memory(),
      paid = reply(20, "finish", 20);
    if (unknown) delete paid.usage;
    const input = options(saved.port, [paid]);
    expect(await runToolLoop(input)).toMatchObject({
      result: "candidate",
      usageKnown: !unknown,
      usage: { outputTokens: 20 },
    });
    expect(saved.value).not.toHaveProperty("outputBudgetOverrun");
    await runToolLoop(input);
    expect(input.model.complete).toHaveBeenCalledTimes(1);
  }
});
it("rejects forged overrun receipts, missing markers, limit metadata and invalid usage", async () => {
  const saved = memory(),
    input = options(saved.port, [reply(9, "finish", 8)]);
  await expect(runToolLoop(input)).rejects.toBeInstanceOf(
    LoopProviderOutputBudgetError,
  );
  for (const change of [
    (cp: LoopCheckpoint) => {
      delete cp.outputBudgetOverrun;
    },
    (cp: LoopCheckpoint) => {
      delete cp.snapshot.outputBudgetPolicy;
    },
    (cp: LoopCheckpoint) => {
      cp.outputBudgetOverrun!.priorOutputTokens = 1;
    },
    (cp: LoopCheckpoint) => {
      cp.outputBudgetOverrun!.requestedMaxOutputTokens = 9;
    },
    (cp: LoopCheckpoint) => {
      cp.outputBudgetOverrun!.returnedOutputTokens = 8;
    },
    (cp: LoopCheckpoint) => {
      cp.outputBudgetOverrun!.modelCall = 2;
    },
    (cp: LoopCheckpoint) => {
      cp.usage.outputTokens = 20;
    },
    (cp: LoopCheckpoint) => {
      cp.usage.inputTokens = 0;
    },
    (cp: LoopCheckpoint) => {
      cp.phase = "completed";
      cp.result = "forged";
    },
    (cp: LoopCheckpoint) => {
      cp.pendingTurn!.reply.outputTokenLimit = 0;
    },
    (cp: LoopCheckpoint) => {
      cp.pendingTurn!.reply.usage!.outputTokens = -1;
    },
    (cp: LoopCheckpoint) => {
      cp.pendingTurn!.reply.usage!.inputTokens = 1.5;
    },
    (cp: LoopCheckpoint) => {
      cp.usageKnown = false;
    },
  ]) {
    const changed = structuredClone(saved.value);
    change(changed);
    expect(() => parseLoopCheckpoint(changed)).toThrow();
  }
});
it("keeps the absent-policy legacy snapshot binding and its original overrun failure", async () => {
  let pause = true;
  const saved = memory((next) => {
    if (next.phase === "ready-for-model" && pause) {
      pause = false;
      throw new Error("legacy seed");
    }
  });
  const input = options(saved.port, [reply(21)]);
  await expect(runToolLoop(input)).rejects.toThrow("legacy seed");
  const legacy = saved.value;
  delete legacy.snapshot.outputBudgetPolicy;
  legacy.bindingHash = await hashJson({
    version: 1,
    snapshot: legacy.snapshot,
  });
  saved.value = legacy;
  await expect(runToolLoop(input)).rejects.toThrow(
    "Invalid loop checkpoint budget/counter",
  );
  expect(saved.value.snapshot).not.toHaveProperty("outputBudgetPolicy");
  expect(saved.value.phase).toBe("model-pending");
});
