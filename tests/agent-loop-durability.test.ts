import { describe, expect, it, vi } from "vitest";
import {
  canResumeLoopCheckpoint,
  LoopRecoveryRequiredError,
  parseLoopCheckpoint,
  runToolLoop,
  type LoopCheckpoint,
  type LoopCheckpointPort,
  type LoopTool,
  type ModelReply,
  type ToolLoopInput,
} from "../packages/agent-loop/src/index";

const reply = (...names: string[]): ModelReply => ({
  text: names.length ? "" : "Done",
  calls: names.map((name, index) => ({
    id: `${name}-${index}`,
    name,
    arguments: "{}",
  })),
  usage: { inputTokens: 7, outputTokens: 3 },
});
function memory(after?: (next: LoopCheckpoint) => void) {
  let value: LoopCheckpoint | null = null;
  const history: LoopCheckpoint[] = [];
  const port: LoopCheckpointPort = {
    runId: "run-1",
    snapshotHash: "source-request-inventory-hash",
    load: async () => structuredClone(value),
    save: async (next, expected) => {
      if (expected !== (value?.revision ?? null))
        throw new Error("CAS conflict");
      value = structuredClone(next);
      history.push(structuredClone(next));
      after?.(next);
    },
  };
  return {
    port,
    history,
    get value() {
      return value!;
    },
  };
}
const finish = (
  execute: LoopTool<string>["execute"] = vi.fn(async () => ({
    kind: "terminal" as const,
    result: "candidate",
  })),
): LoopTool<string> => ({
  name: "finish",
  description: "Finish",
  parameters: { type: "object" },
  execute,
});
const read = (
  execute: LoopTool<string>["execute"] = vi.fn(async () => ({
    kind: "observation" as const,
    value: { evidence: "source" },
  })),
): LoopTool<string> => ({
  name: "read",
  description: "Read",
  parameters: { type: "object" },
  replaySafe: true,
  execute,
});
function options(port: LoopCheckpointPort): ToolLoopInput<string> {
  return {
    checkpoint: port,
    signal: new AbortController().signal,
    messages: [
      { role: "system", content: "Retain immutable source evidence." },
      {
        role: "user",
        content:
          "Full original instruction: English, Chinese, colors, highlights, outro.",
      },
    ],
    tools: [finish()],
    answer: async (text) => text,
    model: {
      identity: "test-provider:model-1",
      complete: vi.fn(async () => reply("finish")),
    },
    maxSteps: 4,
    maxToolCalls: 6,
    maxOutputTokens: 12,
  };
}

describe("durable host-independent loop checkpoints", () => {
  it("persists initial binding and model/tool submission fences before effects", async () => {
    const store = memory();
    const input = options(store.port);
    input.model.complete = vi.fn(async () => {
      expect(store.value.phase).toBe("model-pending");
      expect(store.value.modelCalls).toBe(1);
      return reply("finish");
    });
    input.tools = [
      finish(
        vi.fn(async (_args, _signal, context) => {
          expect(store.value.phase).toBe("tool-pending");
          expect(store.value.pendingTurn?.reply.calls[0].id).toBe("finish-0");
          expect(context).toEqual({
            callId: "finish-0",
            runId: "run-1",
            replay: false,
          });
          return { kind: "terminal" as const, result: "candidate" };
        }),
      ),
    ];
    const events: number[] = [];
    input.onEvent = (event) => {
      events.push(event.sequence);
    };
    const result = await runToolLoop(input);
    expect(result).toEqual({
      result: "candidate",
      usage: { inputTokens: 7, outputTokens: 3 },
      modelCalls: 1,
      usageKnown: true,
    });
    expect(store.history.map((item) => item.phase)).toEqual([
      "ready-for-model",
      "model-pending",
      "model-returned",
      "tool-pending",
      "completed",
    ]);
    expect(store.value.bindingHash).toMatch(/^[a-f0-9]{64}$/);
    expect(store.value.snapshot.messages).toEqual(input.messages);
    expect(events).toEqual([0, 1, 2]);
    expect(store.value.sequence).toBe(3);
  });

  it("resumes a durable returned turn and completed terminal without a paid repeat", async () => {
    let fail = true;
    const store = memory((next) => {
      if (next.phase === "model-returned" && fail) {
        fail = false;
        throw new Error("crash after response save");
      }
    });
    const input = options(store.port);
    const execute = vi.fn(async () => ({
      kind: "terminal" as const,
      result: "candidate",
    }));
    input.tools = [finish(execute)];
    await expect(runToolLoop(input)).rejects.toThrow(
      "crash after response save",
    );
    expect(execute).not.toHaveBeenCalled();
    expect(canResumeLoopCheckpoint(store.value)).toBe(true);
    const recovered = await runToolLoop(input);
    expect(recovered.modelCalls).toBe(1);
    expect(input.model.complete).toHaveBeenCalledTimes(1);
    expect(execute).toHaveBeenCalledTimes(1);
    expect(await runToolLoop(input)).toEqual(recovered);
    expect(execute).toHaveBeenCalledTimes(1);
  });

  it("keeps observations, tool identities and the cursor across a multi-tool turn crash", async () => {
    let fail = true;
    const store = memory((next) => {
      if (next.phase === "tool-observations" && fail) {
        fail = false;
        throw new Error("crash after observation");
      }
    });
    const input = options(store.port);
    const reader = read();
    const terminal = finish();
    input.tools = [reader, terminal];
    input.model.complete = vi.fn(async () => reply("read", "finish"));
    await expect(runToolLoop(input)).rejects.toThrow("crash after observation");
    expect(store.value.pendingTurn?.nextToolIndex).toBe(1);
    expect(store.value.messages.at(-1)).toEqual({
      role: "tool",
      tool_call_id: "read-0",
      content: '{"evidence":"source"}',
    });
    expect((await runToolLoop(input)).result).toBe("candidate");
    expect(input.model.complete).toHaveBeenCalledTimes(1);
    expect(reader.execute).toHaveBeenCalledTimes(1);
    expect(terminal.execute).toHaveBeenCalledTimes(1);
    expect(store.value.usedToolCallIds).toEqual(["read-0", "finish-1"]);
    expect(store.value.toolCalls).toBe(2);
  });

  it("fails closed on an ambiguous paid model outcome", async () => {
    const store = memory();
    const input = options(store.port);
    input.model.complete = vi.fn(async () => {
      throw new Error("provider timeout");
    });
    await expect(runToolLoop(input)).rejects.toThrow("provider timeout");
    expect(store.value.phase).toBe("model-pending");
    expect(canResumeLoopCheckpoint(store.value)).toBe(false);
    await expect(runToolLoop(input)).rejects.toMatchObject({
      reason: "model-outcome-unknown",
    });
    expect(input.model.complete).toHaveBeenCalledTimes(1);
  });

  it("never repeats an uncertain tool by default, including a failed terminal save", async () => {
    const store = memory();
    const input = options(store.port);
    const save = store.port.save;
    store.port.save = async (next, revision) => {
      if (next.phase === "completed")
        throw new Error("terminal storage unavailable");
      await save(next, revision);
    };
    await expect(runToolLoop(input)).rejects.toThrow(
      "terminal storage unavailable",
    );
    expect(input.tools[0].execute).toHaveBeenCalledTimes(1);
    expect(store.value.phase).toBe("tool-pending");
    expect(canResumeLoopCheckpoint(store.value)).toBe(false);
    await expect(runToolLoop(input)).rejects.toBeInstanceOf(
      LoopRecoveryRequiredError,
    );
    expect(input.model.complete).toHaveBeenCalledTimes(1);
    expect(input.tools[0].execute).toHaveBeenCalledTimes(1);
  });

  it("only replays an explicitly safe tool under the same ID without resetting counters", async () => {
    let fail = true;
    const store = memory((next) => {
      if (next.phase === "tool-pending" && fail) {
        fail = false;
        throw new Error("crash before tool");
      }
    });
    const input = options(store.port);
    input.tools[0].replaySafe = true;
    await expect(runToolLoop(input)).rejects.toThrow("crash before tool");
    expect(canResumeLoopCheckpoint(store.value)).toBe(false);
    expect(
      canResumeLoopCheckpoint(store.value, { replaySafeToolNames: ["finish"] }),
    ).toBe(true);
    expect((await runToolLoop(input)).result).toBe("candidate");
    expect(input.tools[0].execute).toHaveBeenCalledWith(
      {},
      expect.any(AbortSignal),
      { callId: "finish-0", runId: "run-1", replay: true },
    );
    expect(store.value.toolCalls).toBe(1);
    expect(store.value.modelCalls).toBe(1);
  });

  it("does not reinterpret an unsafe executor rejection as a correctable model error", async () => {
    const store = memory();
    const input = options(store.port);
    input.tools[0].execute = vi.fn(async () => {
      throw new Error("unknown paid outcome");
    });
    await expect(runToolLoop(input)).rejects.toMatchObject({
      reason: "tool-outcome-unknown",
    });
    expect(store.value.phase).toBe("tool-pending");
    expect(input.model.complete).toHaveBeenCalledTimes(1);
  });

  it("retains unknown usage and its output reservation on completed replay", async () => {
    const store = memory();
    const input = options(store.port);
    input.model.complete = vi.fn(async () => ({
      ...reply("finish"),
      usage: undefined,
    }));
    const first = await runToolLoop(input);
    expect(first.usageKnown).toBe(false);
    expect(first.usage.outputTokens).toBe(12);
    expect((await runToolLoop(input)).usageKnown).toBe(false);
    expect(input.model.complete).toHaveBeenCalledTimes(1);
  });

  it("does not reset a consumed output budget when resuming known observations", async () => {
    let fail = true;
    const store = memory((next) => {
      if (next.phase === "tool-observations" && fail) {
        fail = false;
        throw new Error("restart");
      }
    });
    const input = options(store.port);
    input.tools = [read()];
    input.maxOutputTokens = 3;
    input.model.complete = vi.fn(async () => reply("read"));
    await expect(runToolLoop(input)).rejects.toThrow("restart");
    await expect(runToolLoop(input)).rejects.toThrow("output budget");
    expect(input.model.complete).toHaveBeenCalledTimes(1);
    expect(store.value.usage).toEqual({ inputTokens: 7, outputTokens: 3 });
  });

  it("rejects snapshot, model, tool inventory, run and budget drift before effects", async () => {
    const store = memory();
    const original = options(store.port);
    await runToolLoop(original);
    const changes: Array<(input: ToolLoopInput<string>) => void> = [
      (input) => {
        input.messages[1].content = "Changed instruction";
      },
      (input) => {
        input.model = { ...input.model, identity: "another-model" };
      },
      (input) => {
        input.checkpoint = { ...store.port, runId: "another-run" };
      },
      (input) => {
        input.checkpoint = { ...store.port, snapshotHash: "changed-source" };
      },
      (input) => {
        input.tools[0].parameters = { type: "object", required: ["id"] };
      },
      (input) => {
        input.tools[0].replaySafe = true;
      },
      (input) => {
        input.maxSteps = 5;
      },
      (input) => {
        input.maxToolCalls = 7;
      },
      (input) => {
        input.maxOutputTokens = 13;
      },
    ];
    for (const change of changes) {
      const next = options(store.port);
      change(next);
      await expect(runToolLoop(next)).rejects.toThrow("binding");
      expect(next.model.complete).not.toHaveBeenCalled();
      expect(next.tools[0].execute).not.toHaveBeenCalled();
    }
  });

  it("validates checkpoint version and persisted call accounting before recovery", async () => {
    const store = memory();
    await runToolLoop(options(store.port));
    expect(() => parseLoopCheckpoint({ ...store.value, version: 2 })).toThrow(
      "version",
    );
    expect(() =>
      parseLoopCheckpoint({ ...store.value, usedToolCallIds: [] }),
    ).toThrow("accounting");
    expect(canResumeLoopCheckpoint({ ...store.value, surprise: true })).toBe(
      false,
    );
  });

  it("requires atomic initialization so concurrent starts cannot both submit", async () => {
    const store = memory();
    const load = store.port.load;
    let count = 0;
    let release!: () => void;
    const barrier = new Promise<void>((resolve) => {
      release = resolve;
    });
    store.port.load = async () => {
      const value = await load();
      if (++count === 2) release();
      await barrier;
      return value;
    };
    const input = options(store.port);
    const outcomes = await Promise.allSettled([
      runToolLoop(input),
      runToolLoop(input),
    ]);
    expect(
      outcomes.filter((outcome) => outcome.status === "fulfilled"),
    ).toHaveLength(1);
    expect(
      outcomes.filter((outcome) => outcome.status === "rejected"),
    ).toHaveLength(1);
    expect(input.model.complete).toHaveBeenCalledTimes(1);
    expect(input.tools[0].execute).toHaveBeenCalledTimes(1);
  });

  it("saves a known returned model response before honoring cancellation", async () => {
    const store = memory();
    const input = options(store.port);
    const controller = new AbortController();
    input.signal = controller.signal;
    input.model.complete = vi.fn(async () => {
      controller.abort();
      return reply("finish");
    });
    await expect(runToolLoop(input)).rejects.toThrow();
    expect(store.value.phase).toBe("model-returned");
    expect(store.value.usage.outputTokens).toBe(3);
    expect(input.tools[0].execute).not.toHaveBeenCalled();
  });

  it("fences plain answer callbacks and resumes them only when explicitly safe", async () => {
    for (const safe of [false, true]) {
      let fail = true;
      const store = memory((next) => {
        if (next.phase === "answer-pending" && fail) {
          fail = false;
          throw new Error("answer fence crash");
        }
      });
      const input = options(store.port);
      input.answerReplaySafe = safe;
      input.model.complete = vi.fn(async () => reply());
      input.answer = vi.fn(async (text) => text);
      await expect(runToolLoop(input)).rejects.toThrow("answer fence crash");
      expect(input.answer).not.toHaveBeenCalled();
      expect(canResumeLoopCheckpoint(store.value)).toBe(false);
      if (safe) expect((await runToolLoop(input)).result).toBe("Done");
      else
        await expect(runToolLoop(input)).rejects.toMatchObject({
          reason: "answer-outcome-unknown",
        });
      expect(input.model.complete).toHaveBeenCalledTimes(1);
    }
  });

  it("fails before paid submission when protected initial context exceeds the policy", async () => {
    const store = memory();
    const input = options(store.port);
    input.compaction = { maxCharacters: 20, keepRecentGroups: 2 };
    await expect(runToolLoop(input)).rejects.toThrow(
      "Protected instructions/evidence",
    );
    expect(input.model.complete).not.toHaveBeenCalled();
    expect(store.value.phase).toBe("ready-for-model");
  });
});
