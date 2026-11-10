import { expect, it, vi } from "vitest";
import {
  runToolLoop,
  parseLoopCheckpoint,
  encodeLoopCheckpoint,
  canResumeLoopCheckpoint,
  LoopKnownModelRejectionError,
} from "../packages/agent-loop/src/index";
import type { LoopCheckpointPort } from "../packages/agent-loop/src/index";
function fixture() {
  let saved: unknown = null;
  const checkpoint: LoopCheckpointPort = {
    runId: "rejection-run",
    snapshotHash: "same-input",
    encoding: "compact-v2",
    capacity: { maxBytes: 2096128, maxReplyBytes: 262144, reserveBytes: 65536 },
    load: async () => saved,
    save: async (value, expected) => {
      expect(saved ? parseLoopCheckpoint(saved).revision : null).toBe(expected);
      saved = encodeLoopCheckpoint(value);
    },
  };
  const options = {
    model: {
      identity: "same-provider:model:low",
      complete: vi.fn(async () => {
        throw new LoopKnownModelRejectionError(422);
      }),
    },
    checkpoint,
    messages: [{ role: "user" as const, content: "Use the same frozen input" }],
    tools: [],
    answer: async (text: string) => text,
    signal: new AbortController().signal,
    maxSteps: 8,
    maxToolCalls: 24,
    maxOutputTokens: 16000,
  };
  return { options, checkpoint, read: () => parseLoopCheckpoint(saved) };
}
it.each([400, 401, 403, 404, 422])(
  "retains sanitized known HTTP %s before throw and replays with zero new model calls",
  async (status) => {
    const f = fixture();
    f.options.model.complete.mockImplementation(async () => {
      throw new LoopKnownModelRejectionError(status);
    });
    await expect(runToolLoop(f.options)).rejects.toMatchObject({
      code: "LOOP_KNOWN_MODEL_REJECTION",
      status,
      checkpointSaved: true,
    });
    const cp = f.read();
    expect(cp.phase).toBe("model-rejected");
    expect(cp.knownRejection).toEqual({ version: 1, status, modelCall: 1 });
    expect(cp.usageKnown).toBe(true);
    expect(cp.usage).toEqual({ inputTokens: 0, outputTokens: 0 });
    expect(cp.modelCalls).toBe(1);
    expect(canResumeLoopCheckpoint(cp)).toBe(false);
    await expect(runToolLoop(f.options)).rejects.toMatchObject({
      code: "LOOP_KNOWN_MODEL_REJECTION",
      status,
      checkpointSaved: true,
    });
    expect(f.options.model.complete).toHaveBeenCalledTimes(1);
  },
);
it("retains the response if delivery crashes after saving the rejection", async () => {
  const f = fixture(),
    port = {
      ...f.checkpoint,
      save: async (
        value: Parameters<LoopCheckpointPort["save"]>[0],
        expected: number | null,
      ) => {
        await f.checkpoint.save(value, expected);
        if (value.knownRejection)
          throw new Error("Crash after saved known response");
      },
    };
  await expect(runToolLoop({ ...f.options, checkpoint: port })).rejects.toThrow(
    /Crash after/,
  );
  await expect(runToolLoop(f.options)).rejects.toMatchObject({
    code: "LOOP_KNOWN_MODEL_REJECTION",
  });
  expect(f.options.model.complete).toHaveBeenCalledTimes(1);
});
it.each(["transport timeout", "HTTP 500", "malformed paid output"])(
  "keeps %s unknown and forbids a new paid request",
  async (text) => {
    const f = fixture();
    f.options.model.complete.mockImplementation(async () => {
      throw new Error(text);
    });
    await expect(runToolLoop(f.options)).rejects.toThrow(text);
    expect(f.read().phase).toBe("model-pending");
    expect(f.read().knownRejection).toBeUndefined();
    await expect(runToolLoop(f.options)).rejects.toMatchObject({
      reason: "model-outcome-unknown",
    });
    expect(f.options.model.complete).toHaveBeenCalledTimes(1);
  },
);
it("rejects status laundering and changed provider identity without mutating the saved receipt", async () => {
  for (const status of [200, 402, 429, 500, 503])
    expect(() => new LoopKnownModelRejectionError(status)).toThrow(
      /not a qualified/,
    );
  const f = fixture();
  await expect(runToolLoop(f.options)).rejects.toMatchObject({ status: 422 });
  await expect(
    runToolLoop({
      ...f.options,
      model: { ...f.options.model, identity: "different-provider:model" },
    }),
  ).rejects.toThrow(/binding|snapshot|identity/);
  const bad = structuredClone(f.read());
  (bad.knownRejection as unknown as { status: string }).status = "400";
  expect(() => parseLoopCheckpoint(bad)).toThrow();
});
