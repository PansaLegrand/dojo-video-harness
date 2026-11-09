import { describe, expect, it, vi } from "vitest";
import {
  DEFAULT_CHECKPOINT_CAPACITY,
  encodeLoopCheckpoint,
  measureLoopCheckpointBytes,
  measureModelReplyBytes,
  parseLoopCheckpoint,
  runToolLoop,
  type ChatMessage,
  type CompactLoopCheckpoint,
  type LoopCheckpoint,
  type LoopCheckpointCapacity,
  type LoopCheckpointPort,
  type ModelReply,
  type ToolLoopInput,
} from "../packages/agent-loop/src/index";

function store(
  capacity?: LoopCheckpointCapacity,
  after?: (next: LoopCheckpoint) => void,
) {
  let value: LoopCheckpoint | CompactLoopCheckpoint | null = null;
  const history: LoopCheckpoint[] = [];
  const port: LoopCheckpointPort = {
    runId: "headroom-run",
    snapshotHash: "immutable-source-instruction-hash",
    ...(capacity ? { encoding: "compact-v2" as const, capacity } : {}),
    load: vi.fn(async () => structuredClone(value)),
    save: async (next, revision) => {
      if (revision !== (value?.revision ?? null))
        throw new Error("CAS conflict");
      const encoded = encodeLoopCheckpoint(next);
      const bytes = Buffer.byteLength(JSON.stringify(encoded), "utf8");
      const frozenCapacity = next.snapshot.checkpointCapacity;
      if (frozenCapacity && bytes > frozenCapacity.maxBytes)
        throw new Error("Physical host capacity exceeded");
      value = structuredClone(encoded);
      history.push(parseLoopCheckpoint(value));
      after?.(next);
    },
  };
  return {
    port,
    history,
    get wire() {
      return value!;
    },
    get checkpoint() {
      return parseLoopCheckpoint(value);
    },
  };
}
const policy = (
  patch: Partial<LoopCheckpointCapacity> = {},
): LoopCheckpointCapacity => ({
  maxBytes: 64_000,
  maxReplyBytes: 12_000,
  reserveBytes: 4096,
  ...patch,
});
const response = (opaque = "known opaque output"): ModelReply => ({
  text: "",
  calls: [{ id: "finish-1", name: "finish", arguments: "{}" }],
  providerOutput: [{ type: "reasoning", encrypted_content: opaque }],
  usage: { inputTokens: 11, outputTokens: 3 },
});
function input(
  port: LoopCheckpointPort,
  messages: ChatMessage[] = [
    { role: "system", content: "Keep the evidence." },
    { role: "user", content: "Keep this entire instruction." },
  ],
): ToolLoopInput<string> {
  return {
    checkpoint: port,
    messages,
    signal: new AbortController().signal,
    maxSteps: 3,
    maxToolCalls: 4,
    maxOutputTokens: 30,
    model: {
      identity: "synthetic-endpoint:model-1",
      complete: vi.fn(async () => response()),
    },
    tools: [
      {
        name: "finish",
        description: "Pure terminal",
        parameters: { type: "object" },
        replaySafe: true,
        execute: vi.fn(async () => ({
          kind: "terminal" as const,
          result: "done",
        })),
      },
    ],
    answer: async (text) => text,
  };
}

describe("UTF-8 checkpoint reply headroom", () => {
  it("rejects insufficient multibyte headroom before a model call or budget reservation", async () => {
    const memory = store(policy({ maxBytes: 25_000, maxReplyBytes: 8000 }));
    const options = input(memory.port, [
      { role: "user", content: "中🙂".repeat(2500) },
    ]);
    await expect(runToolLoop(options)).rejects.toMatchObject({
      code: "LOOP_CHECKPOINT_CAPACITY",
      reason: "reply-headroom",
    });
    expect(options.model.complete).not.toHaveBeenCalled();
    expect(memory.checkpoint).toMatchObject({
      phase: "ready-for-model",
      modelCalls: 0,
      sequence: 0,
    });
    expect(memory.history).toHaveLength(1);
  });

  it("stores original images and pending opaque output once, then resumes the saved reply", async () => {
    let fail = true;
    const memory = store(policy(), (next) => {
      if (next.phase === "model-returned" && fail) {
        fail = false;
        throw new Error("Crash after durable reply");
      }
    });
    const image = "unique-image-payload-" + "A".repeat(9000);
    const opaque = "unique-opaque-payload-" + "中🙂".repeat(600);
    const messages: ChatMessage[] = [
      { role: "system", content: "Never change source word IDs." },
      {
        role: "user",
        content: [
          { type: "text", text: "中".repeat(4000) },
          {
            type: "image_url",
            image_url: { url: "data:image/png;base64," + image },
          },
        ],
      },
    ];
    const options = input(memory.port, messages);
    options.model.complete = vi.fn(
      async (actualMessages, _tools, _signal, limits) => {
        expect(actualMessages).toEqual(messages);
        expect(limits).toEqual({ maxOutputTokens: 30, maxReplyBytes: 12000 });
        return response(opaque);
      },
    );
    await expect(runToolLoop(options)).rejects.toThrow(
      "Crash after durable reply",
    );
    expect(memory.wire.version).toBe(2);
    const serialized = JSON.stringify(memory.wire);
    expect(serialized.split("unique-image-payload-")).toHaveLength(2);
    expect(serialized.split("unique-opaque-payload-")).toHaveLength(2);
    expect(measureLoopCheckpointBytes(memory.checkpoint)).toBe(
      Buffer.byteLength(serialized, "utf8"),
    );
    expect(memory.checkpoint.messages.slice(0, messages.length)).toEqual(
      messages,
    );
    expect((await runToolLoop(options)).result).toBe("done");
    expect(options.model.complete).toHaveBeenCalledTimes(1);
    expect(options.tools[0].execute).toHaveBeenCalledTimes(1);
    expect(memory.checkpoint).toMatchObject({
      modelCalls: 1,
      toolCalls: 1,
      usedToolCallIds: ["finish-1"],
      usageKnown: true,
    });
    expect((await runToolLoop(options)).result).toBe("done");
    expect(options.model.complete).toHaveBeenCalledTimes(1);
  });

  it("measures the normalized reply's UTF-8 bytes including every opaque field", () => {
    const reply = response("中🙂".repeat(1000));
    expect(measureModelReplyBytes(reply)).toBe(
      Buffer.byteLength(JSON.stringify(reply), "utf8"),
    );
    expect(measureModelReplyBytes(reply)).toBeGreaterThan(
      JSON.stringify(reply).length,
    );
    expect(DEFAULT_CHECKPOINT_CAPACITY).toEqual({
      maxBytes: 2096128,
      maxReplyBytes: 262144,
      reserveBytes: 65536,
    });
  });

  it("accepts a reply exactly at its advertised bound and rejects an adapter contract breach without paid replay", async () => {
    const reply = response("");
    const bound = 8192;
    reply.providerOutput![0].encrypted_content = "X".repeat(
      bound - measureModelReplyBytes(reply),
    );
    expect(measureModelReplyBytes(reply)).toBe(bound);
    const memory = store(policy({ maxReplyBytes: bound }));
    const options = input(memory.port);
    options.model.complete = vi.fn(async () => reply);
    expect((await runToolLoop(options)).result).toBe("done");
    expect(measureLoopCheckpointBytes(memory.checkpoint)).toBeLessThan(64000);

    const invalid = store(policy({ maxReplyBytes: bound }));
    const bad = input(invalid.port);
    bad.model.complete = vi.fn(async () => response("中".repeat(bound)));
    await expect(runToolLoop(bad)).rejects.toMatchObject({
      reason: "reply-too-large",
    });
    expect(invalid.checkpoint.phase).toBe("model-pending");
    await expect(runToolLoop(bad)).rejects.toMatchObject({
      reason: "model-outcome-unknown",
    });
    expect(bad.model.complete).toHaveBeenCalledTimes(1);
    expect(bad.tools[0].execute).not.toHaveBeenCalled();
  });

  it("preserves a genuine legacy snapshot and binding despite new host defaults, with one load per invocation", async () => {
    let fail = true;
    const memory = store(undefined, (next) => {
      if (next.phase === "model-returned" && fail) {
        fail = false;
        throw new Error("Legacy crash");
      }
    });
    const options = input(memory.port);
    await expect(runToolLoop(options)).rejects.toThrow("Legacy crash");
    const binding = memory.checkpoint.bindingHash;
    expect(memory.wire.version).toBe(1);
    memory.port.encoding = "compact-v2";
    memory.port.capacity = policy();
    expect((await runToolLoop(options)).result).toBe("done");
    expect(memory.wire.version).toBe(1);
    expect(memory.checkpoint.bindingHash).toBe(binding);
    expect(memory.checkpoint.snapshot.checkpointCapacity).toBeUndefined();
    expect(memory.port.load).toHaveBeenCalledTimes(2);
    expect(options.model.complete).toHaveBeenCalledTimes(1);
    expect(vi.mocked(options.model.complete).mock.calls[0][3]).toEqual({
      maxOutputTokens: 30,
    });
  });

  it("retains the frozen capacity and unknown usage on completed replay instead of applying new defaults", async () => {
    const memory = store(policy());
    const options = input(memory.port);
    options.model.complete = vi.fn(async () => ({
      ...response(),
      usage: undefined,
    }));
    const first = await runToolLoop(options);
    expect(first.usageKnown).toBe(false);
    expect(first.usage.outputTokens).toBe(30);
    memory.port.capacity = policy({ maxBytes: 128000, maxReplyBytes: 24000 });
    const replay = await runToolLoop(options);
    expect(replay).toEqual(first);
    expect(memory.checkpoint.snapshot.checkpointCapacity).toEqual(policy());
    expect(options.model.complete).toHaveBeenCalledTimes(1);
  });

  it("freezes an offered policy before callbacks can mutate the caller's configuration", async () => {
    const capacity = policy();
    const memory = store(capacity);
    const options = input(memory.port);
    options.onEvent = () => {
      capacity.maxReplyBytes = 1_000_000;
      capacity.maxBytes = 2_000_000;
    };
    options.model.complete = vi.fn(
      async (_messages, _tools, _signal, limits) => {
        expect(limits?.maxReplyBytes).toBe(12000);
        return response();
      },
    );
    await runToolLoop(options);
    expect(memory.checkpoint.snapshot.checkpointCapacity).toEqual(policy());
  });

  it("rejects a capacity policy without an explicit compact storage contract before effects", async () => {
    const memory = store(policy());
    delete memory.port.encoding;
    const options = input(memory.port);
    await expect(runToolLoop(options)).rejects.toThrow("compact-v2 host port");
    expect(options.model.complete).not.toHaveBeenCalled();
    expect(memory.history).toEqual([]);
  });

  it("round-trips a large opaque returned turn with pinned evidence and its partial cursor", async () => {
    let fail = true;
    const memory = store({ ...DEFAULT_CHECKPOINT_CAPACITY }, (next) => {
      if (next.phase === "tool-observations" && fail) {
        fail = false;
        throw new Error("Crash after pinned observation");
      }
    });
    const options = input(memory.port, [
      { role: "system", content: "Keep genuine word IDs." },
      {
        role: "user",
        content: [
          { type: "text", text: "中".repeat(20000) },
          {
            type: "image_url",
            image_url: { url: "data:image/png;base64," + "A".repeat(300000) },
          },
        ],
      },
    ]);
    options.durablePlanRefs = ["immutable-plan-revision-7"];
    const read = vi.fn(async () => ({
      kind: "observation" as const,
      value: { wordId: "genuine-word-42", plan: "immutable-plan-revision-7" },
      pinned: true,
    }));
    options.tools.unshift({
      name: "read",
      description: "Source evidence",
      parameters: { type: "object" },
      replaySafe: true,
      execute: read,
    });
    options.model.complete = vi.fn(async () => ({
      ...response("unique-large-opaque-" + "中🙂".repeat(20000)),
      calls: [
        { id: "read-1", name: "read", arguments: "{}" },
        { id: "finish-1", name: "finish", arguments: "{}" },
      ],
    }));
    await expect(runToolLoop(options)).rejects.toThrow(
      "Crash after pinned observation",
    );
    const checkpoint = memory.checkpoint;
    expect(checkpoint.pendingTurn?.nextToolIndex).toBe(1);
    expect(checkpoint.pinnedToolCallIds).toEqual(["read-1"]);
    expect(checkpoint.messages.at(-1)).toMatchObject({
      role: "tool",
      tool_call_id: "read-1",
    });
    expect(
      JSON.stringify(memory.wire).split("unique-large-opaque-"),
    ).toHaveLength(2);
    expect(measureLoopCheckpointBytes(checkpoint)).toBeLessThan(
      Buffer.byteLength(JSON.stringify(checkpoint), "utf8") - 300000,
    );
    expect((await runToolLoop(options)).result).toBe("done");
    expect(options.model.complete).toHaveBeenCalledTimes(1);
    expect(read).toHaveBeenCalledTimes(1);
    expect(memory.checkpoint).toMatchObject({
      modelCalls: 1,
      toolCalls: 2,
      usedToolCallIds: ["read-1", "finish-1"],
      pinnedToolCallIds: ["read-1"],
    });
    expect(memory.checkpoint.snapshot.durablePlanRefs).toEqual([
      "immutable-plan-revision-7",
    ]);
  });

  it("compacts only disposable older complete groups when UTF-8 reply headroom is tighter than character context", async () => {
    const memory = store(policy());
    const options = input(memory.port);
    options.maxSteps = 4;
    options.compaction = { maxCharacters: 320000, keepRecentGroups: 2 };
    options.tools.unshift({
      name: "read",
      description: "Disposable inspection",
      parameters: { type: "object" },
      replaySafe: true,
      compactionSafe: true,
      execute: async () => ({
        kind: "observation",
        value: { data: "X".repeat(18000) },
      }),
    });
    let count = 0;
    options.model.complete = vi.fn(async (messages: ChatMessage[]) => {
      count++;
      if (count === 4) {
        expect(messages.slice(0, 2)).toEqual(options.messages);
        expect(
          messages.some((message) => message.tool_call_id === "read-1"),
        ).toBe(false);
        expect(
          messages
            .filter((message) => message.role === "tool")
            .map((message) => message.tool_call_id),
        ).toEqual(["read-2", "read-3"]);
        return response();
      }
      return {
        text: "",
        calls: [{ id: `read-${count}`, name: "read", arguments: "{}" }],
        usage: { inputTokens: 11, outputTokens: 3 },
      };
    });
    expect((await runToolLoop(options)).result).toBe("done");
    expect(count).toBe(4);
    expect(memory.checkpoint.usedToolCallIds).toEqual([
      "read-1",
      "read-2",
      "read-3",
      "finish-1",
    ]);
    expect(memory.checkpoint.usage.outputTokens).toBe(12);
  });

  it("fails before another paid turn rather than dropping pinned multibyte evidence", async () => {
    const memory = store(policy({ maxBytes: 48000 }));
    const options = input(memory.port);
    options.compaction = { maxCharacters: 320000, keepRecentGroups: 1 };
    options.tools = [
      {
        name: "read",
        description: "Pinned source memory",
        parameters: { type: "object" },
        replaySafe: true,
        compactionSafe: true,
        execute: async () => ({
          kind: "observation",
          value: { wordIds: "中".repeat(10800) },
          pinned: true,
        }),
      },
    ];
    options.model.complete = vi.fn(async () => ({
      text: "",
      calls: [{ id: "read-1", name: "read", arguments: "{}" }],
      usage: { inputTokens: 11, outputTokens: 3 },
    }));
    await expect(runToolLoop(options)).rejects.toMatchObject({
      code: "LOOP_CHECKPOINT_CAPACITY",
      reason: "protected-context",
    });
    expect(options.model.complete).toHaveBeenCalledTimes(1);
    expect(memory.checkpoint).toMatchObject({
      phase: "tool-observations",
      modelCalls: 1,
      toolCalls: 1,
      pinnedToolCallIds: ["read-1"],
    });
    expect(memory.checkpoint.messages.at(-1)?.content).toContain(
      "中".repeat(10800),
    );
  });

  it("preserves atomic CAS submission fences with compact storage", async () => {
    const memory = store(policy());
    const originalLoad = memory.port.load;
    let count = 0;
    let release!: () => void;
    const barrier = new Promise<void>((resolve) => {
      release = resolve;
    });
    memory.port.load = async () => {
      const value = await originalLoad();
      if (++count === 2) release();
      await barrier;
      return value;
    };
    const options = input(memory.port);
    const outcomes = await Promise.allSettled([
      runToolLoop(options),
      runToolLoop(options),
    ]);
    expect(
      outcomes.filter((outcome) => outcome.status === "fulfilled"),
    ).toHaveLength(1);
    expect(options.model.complete).toHaveBeenCalledTimes(1);
    expect(memory.wire.version).toBe(2);
    expect(memory.checkpoint.modelCalls).toBe(1);
  });
});
