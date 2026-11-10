import { expect, it, vi } from "vitest";
import {
  canResumeLoopCheckpoint,
  DEFAULT_CHECKPOINT_CAPACITY,
  encodeLoopCheckpoint,
  LoopHostInputRequiredError,
  parseLoopCheckpoint,
  runToolLoop,
  type HostRequestRef,
  type LoopCheckpoint,
  type LoopCheckpointPort,
  type LoopTool,
  type ToolLoopInput,
} from "../packages/agent-loop/src/index";
import { hashJson } from "../packages/agent-loop/src/json";
const ref: HostRequestRef = {
  kind: "source-inspection",
  id: "owned-request",
  hash: "a".repeat(64),
};
function memory(after?: (next: LoopCheckpoint) => void) {
  let wire: unknown = null;
  const port: LoopCheckpointPort = {
    runId: "host-wait-run",
    snapshotHash: "owned-source-snapshot",
    encoding: "compact-v2",
    capacity: DEFAULT_CHECKPOINT_CAPACITY,
    load: async () => structuredClone(wire),
    save: async (next, revision) => {
      if (
        revision !== (wire === null ? null : parseLoopCheckpoint(wire).revision)
      )
        throw new Error("CAS conflict");
      wire = encodeLoopCheckpoint(next);
      after?.(next);
    },
  };
  return {
    port,
    get checkpoint() {
      return parseLoopCheckpoint(wire);
    },
    set checkpoint(value: LoopCheckpoint) {
      wire = encodeLoopCheckpoint(value);
    },
    get wire() {
      return structuredClone(wire);
    },
  };
}
function fixture(store: ReturnType<typeof memory>) {
  let ready = false,
    created = 0;
  const requests = new Set<string>();
  const inspect: LoopTool<string> = {
    name: "inspect",
    description: "Idempotently request/lookup authorized inspection",
    parameters: { type: "object" },
    replaySafe: true,
    execute: vi.fn(async (_args, _signal, context) => {
      if (!requests.has(context!.callId)) {
        requests.add(context!.callId);
        created++;
      }
      return ready
        ? {
            kind: "observation" as const,
            value: {
              kind: "owned-inspection-ref",
              requestId: ref.id,
              receiptHash: ref.hash,
            },
            pinned: true,
          }
        : { kind: "waiting" as const, requestRef: ref };
    }),
  };
  const read: LoopTool<string> = {
    name: "read",
    description: "Read",
    parameters: { type: "object" },
    replaySafe: true,
    execute: vi.fn(async () => ({
      kind: "observation" as const,
      value: { retained: "completed before wait" },
    })),
  };
  const finish: LoopTool<string> = {
    name: "finish",
    description: "Finish",
    parameters: { type: "object" },
    replaySafe: true,
    execute: vi.fn(async () => ({
      kind: "terminal" as const,
      result: "candidate",
    })),
  };
  let call = 0;
  const input: ToolLoopInput<string> = {
    checkpoint: store.port,
    signal: new AbortController().signal,
    messages: [
      {
        role: "user",
        content: "Inspect the owned source before making this edit.",
      },
    ],
    tools: [read, inspect, finish],
    answer: vi.fn(async (text) => text),
    model: {
      identity: "frozen-provider:model",
      complete: vi.fn(async () => ({
        text: "",
        calls:
          ++call === 1
            ? [
                { id: "read-before", name: "read", arguments: "{}" },
                { id: "inspect-once", name: "inspect", arguments: "{}" },
              ]
            : [{ id: "finish-once", name: "finish", arguments: "{}" }],
        providerOutput: [
          { type: "reasoning", encrypted_content: "retained paid context" },
        ],
        usage: { inputTokens: 10, outputTokens: 5 },
      })),
    },
    maxSteps: 4,
    maxToolCalls: 6,
    maxOutputTokens: 100,
  };
  return {
    input,
    inspect,
    read,
    finish,
    ready: () => {
      ready = true;
    },
    created: () => created,
  };
}
it("saves a host wait, rechecks the same request without model polling, then continues once", async () => {
  const saved = memory(),
    f = fixture(saved);
  await expect(runToolLoop(f.input)).rejects.toMatchObject({
    code: "LOOP_HOST_INPUT_REQUIRED",
    requestRef: ref,
    checkpointSaved: true,
  });
  expect(saved.checkpoint).toMatchObject({
    phase: "waiting-for-host",
    modelCalls: 1,
    toolCalls: 2,
    hostWait: { requestRef: ref, toolCallId: "inspect-once" },
    pendingTurn: { nextToolIndex: 1 },
  });
  expect(
    JSON.stringify(saved.wire).split("retained paid context"),
  ).toHaveLength(2);
  expect(
    canResumeLoopCheckpoint(saved.wire, { replaySafeToolNames: ["inspect"] }),
  ).toBe(true);
  expect(canResumeLoopCheckpoint(saved.wire, { replaySafeToolNames: [] })).toBe(
    false,
  );
  await expect(runToolLoop(f.input)).rejects.toBeInstanceOf(
    LoopHostInputRequiredError,
  );
  expect(f.input.model.complete).toHaveBeenCalledTimes(1);
  expect(saved.checkpoint.toolCalls).toBe(2);
  expect(f.created()).toBe(1);
  f.ready();
  expect((await runToolLoop(f.input)).result).toBe("candidate");
  expect(f.input.model.complete).toHaveBeenCalledTimes(2);
  expect(f.read.execute).toHaveBeenCalledTimes(1);
  expect(f.finish.execute).toHaveBeenCalledTimes(1);
  await runToolLoop(f.input);
  expect(f.input.model.complete).toHaveBeenCalledTimes(2);
  expect(f.finish.execute).toHaveBeenCalledTimes(1);
});
it.each(["tool-pending", "waiting-for-host"] as const)(
  "recovers a crash after durable %s without another paid response",
  async (phase) => {
    let crash = true;
    const saved = memory((next) => {
        if (
          next.phase === phase &&
          next.pendingTurn?.reply.calls[next.pendingTurn.nextToolIndex]
            ?.name === "inspect" &&
          crash
        ) {
          crash = false;
          throw new Error("crash at host boundary");
        }
      }),
      f = fixture(saved);
    await expect(runToolLoop(f.input)).rejects.toThrow(
      "crash at host boundary",
    );
    await expect(runToolLoop(f.input)).rejects.toBeInstanceOf(
      LoopHostInputRequiredError,
    );
    expect(f.input.model.complete).toHaveBeenCalledTimes(1);
    expect(f.created()).toBe(1);
    f.ready();
    expect((await runToolLoop(f.input)).result).toBe("candidate");
    expect(f.read.execute).toHaveBeenCalledTimes(1);
  },
);
it("keeps cancelled waiting work saved and never resumes with an aborted signal", async () => {
  const saved = memory(),
    f = fixture(saved),
    controller = new AbortController();
  f.input.signal = controller.signal;
  f.inspect.execute = vi.fn(async () => {
    controller.abort(new Error("cancelled"));
    return { kind: "waiting" as const, requestRef: ref };
  });
  await expect(runToolLoop(f.input)).rejects.toThrow("cancelled");
  expect(saved.checkpoint.phase).toBe("waiting-for-host");
  await expect(runToolLoop(f.input)).rejects.toThrow("cancelled");
  expect(f.input.model.complete).toHaveBeenCalledTimes(1);
  expect(f.inspect.execute).toHaveBeenCalledTimes(1);
});
it("rejects malformed, changed and forged host references before any new model call", async () => {
  for (const bad of [
    { ...ref, hash: "wrong" },
    { ...ref, id: "" },
    { ...ref, kind: "arbitrary-network" },
    { ...ref, url: "https://unowned.invalid" },
  ]) {
    const saved = memory(),
      f = fixture(saved);
    f.inspect.execute = vi.fn(async () => ({
      kind: "waiting" as const,
      requestRef: bad as HostRequestRef,
    }));
    await expect(runToolLoop(f.input)).rejects.toThrow();
    expect(saved.checkpoint.phase).toBe("tool-pending");
    expect(f.input.model.complete).toHaveBeenCalledTimes(1);
  }
  const saved = memory(),
    f = fixture(saved);
  await expect(runToolLoop(f.input)).rejects.toBeInstanceOf(
    LoopHostInputRequiredError,
  );
  const original = saved.checkpoint.hostWait;
  f.inspect.execute = vi.fn(async () => ({
    kind: "waiting" as const,
    requestRef: { ...ref, id: "changed-request" },
  }));
  await expect(runToolLoop(f.input)).rejects.toThrow(/identity changed/);
  expect(saved.checkpoint.hostWait).toEqual(original);
  expect(f.input.model.complete).toHaveBeenCalledTimes(1);
  for (const change of [
    (cp: LoopCheckpoint) => {
      delete cp.hostWait;
    },
    (cp: LoopCheckpoint) => {
      delete cp.snapshot.hostInputPolicy;
    },
    (cp: LoopCheckpoint) => {
      cp.hostWait!.toolCallId = "different";
    },
    (cp: LoopCheckpoint) => {
      cp.phase = "model-returned";
    },
    (cp: LoopCheckpoint) => {
      cp.snapshot.tools.find((t) => t.name === "inspect")!.replaySafe = false;
    },
  ]) {
    const cp = saved.checkpoint;
    change(cp);
    expect(() => parseLoopCheckpoint(cp)).toThrow();
  }
});
it("retains absent-policy snapshot bytes instead of silently enabling host waits", async () => {
  let seed = true;
  const saved = memory((next) => {
      if (next.phase === "ready-for-model" && seed) {
        seed = false;
        throw new Error("seed old snapshot");
      }
    }),
    f = fixture(saved);
  await expect(runToolLoop(f.input)).rejects.toThrow("seed old snapshot");
  const legacy = saved.checkpoint;
  delete legacy.snapshot.hostInputPolicy;
  legacy.bindingHash = await hashJson({
    version: 1,
    snapshot: legacy.snapshot,
  });
  saved.checkpoint = legacy;
  f.ready();
  expect((await runToolLoop(f.input)).result).toBe("candidate");
  expect(saved.checkpoint.snapshot).not.toHaveProperty("hostInputPolicy");
});
it("rejects missing/stale owned input preparation before model budget or paid submission", async () => {
  const saved = memory(),
    f = fixture(saved);
  f.input.model.prepare = vi.fn(async () => {
    throw new Error("missing owned receipt");
  });
  await expect(runToolLoop(f.input)).rejects.toThrow("missing owned receipt");
  expect(saved.checkpoint).toMatchObject({
    phase: "ready-for-model",
    modelCalls: 0,
    toolCalls: 0,
    usage: { inputTokens: 0, outputTokens: 0 },
  });
  expect(f.input.model.complete).not.toHaveBeenCalled();
  let prepared: unknown[] = [];
  f.input.model.prepare = vi.fn(async (...args) => {
    prepared = args;
  });
  const original = f.input.model.complete;
  f.input.model.complete = vi.fn(
    async (...args: Parameters<typeof original>) => {
      expect(args).toEqual(prepared);
      return original(...args);
    },
  );
  await expect(runToolLoop(f.input)).rejects.toBeInstanceOf(
    LoopHostInputRequiredError,
  );
  expect(f.input.model.complete).toHaveBeenCalledTimes(1);
});
it("honors cancellation after prepare and a crash at the paid fence without a repeated request", async () => {
  const saved = memory(),
    f = fixture(saved),
    controller = new AbortController();
  f.input.signal = controller.signal;
  f.input.model.prepare = vi.fn(async () => {
    controller.abort(new Error("cancel before paid fence"));
  });
  await expect(runToolLoop(f.input)).rejects.toThrow(
    "cancel before paid fence",
  );
  expect(saved.checkpoint.modelCalls).toBe(0);
  expect(f.input.model.complete).not.toHaveBeenCalled();
  const other = memory((next) => {
      if (next.phase === "model-pending")
        throw new Error("crash after paid fence");
    }),
    second = fixture(other);
  second.input.model.prepare = vi.fn(async () => {});
  await expect(runToolLoop(second.input)).rejects.toThrow(
    "crash after paid fence",
  );
  expect(second.input.model.complete).not.toHaveBeenCalled();
  await expect(runToolLoop(second.input)).rejects.toMatchObject({
    reason: "model-outcome-unknown",
  });
  expect(second.input.model.complete).not.toHaveBeenCalled();
  expect(second.input.model.prepare).toHaveBeenCalledTimes(1);
});
it("lets only one duplicate wake consume the fulfilled host receipt", async () => {
  const saved = memory(),
    f = fixture(saved);
  await expect(runToolLoop(f.input)).rejects.toBeInstanceOf(
    LoopHostInputRequiredError,
  );
  f.ready();
  const results = await Promise.allSettled([
    runToolLoop(f.input),
    runToolLoop(f.input),
  ]);
  expect(
    results.filter((result) => result.status === "fulfilled"),
  ).toHaveLength(1);
  expect(f.finish.execute).toHaveBeenCalledTimes(1);
  expect(f.input.model.complete).toHaveBeenCalledTimes(2);
  expect(saved.checkpoint.phase).toBe("completed");
});
it("rejects a host wait from an executor that was not declared replay-safe", async () => {
  const saved = memory(),
    f = fixture(saved);
  f.inspect.replaySafe = false;
  await expect(runToolLoop(f.input)).rejects.toThrow(/explicitly replay-safe/);
  expect(saved.checkpoint.phase).toBe("tool-pending");
  expect(f.input.model.complete).toHaveBeenCalledTimes(1);
  expect(
    canResumeLoopCheckpoint(saved.wire, { replaySafeToolNames: ["inspect"] }),
  ).toBe(false);
});
