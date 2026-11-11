import { expect, it, vi } from "vitest";
import { createHash } from "node:crypto";
import { withLocalVisualInputs } from "../apps/server/src/local-visual-model";
import {
  runToolLoop,
  parseLoopCheckpoint,
  type LanguageModel,
  type LoopCheckpoint,
  type ChatMessage,
} from "../packages/agent-loop/src/index";
import type { EditorVisualInputRef } from "../packages/agent-kit/src/index";
function frame(id = "owned") {
  const bytes = Buffer.from([
    255, 216, 255, 192, 0, 17, 8, 0, 180, 1, 64, 3, 1, 17, 0, 2, 17, 0, 3, 17,
    0, 255, 217,
  ]);
  const metadata = {
    sha256: createHash("sha256").update(bytes).digest("hex"),
    byteLength: bytes.length,
    mimeType: "image/jpeg" as const,
    width: 320,
    height: 180,
    sourceId: "photo",
    sourceRevision: "original",
    requestedMs: 0,
    actualMs: 0,
  };
  const ref: EditorVisualInputRef = {
    version: 1,
    requestRef: { kind: "source-inspection", id, hash: "a".repeat(64) },
    receiptHash: "b".repeat(64),
    frames: [metadata],
  };
  return {
    ref,
    resolved: [
      {
        dataUrl: `data:image/jpeg;base64,${bytes.toString("base64")}`,
        sha256: metadata.sha256,
        byteLength: bytes.length,
        label: { sourceId: "photo", actualMs: 0 },
      },
    ],
  };
}
function messages(ref: EditorVisualInputRef): ChatMessage[] {
  return [
    {
      role: "assistant",
      content: "",
      tool_calls: [
        {
          id: "inspect",
          type: "function",
          function: { name: "inspect_image", arguments: "{}" },
        },
      ],
    },
    {
      role: "tool",
      tool_call_id: "inspect",
      content: JSON.stringify({ visualInput: ref }),
    },
  ];
}
it("hydrates a copy of authorized pixels only after preparation, with exact cache and byte checks", async () => {
  const f = frame(),
    complete = vi.fn(async () => ({
      text: "Inspected",
      calls: [],
      usage: { inputTokens: 1, outputTokens: 1 },
    }));
  const model = withLocalVisualInputs(
    { identity: "local-test", complete },
    vi.fn(async () => f.resolved),
  );
  const input = messages(f.ref),
    original = JSON.stringify(input),
    signal = new AbortController().signal;
  await expect(model.complete(input, [], signal)).rejects.toThrow(
    /preparation/,
  );
  await model.prepare!(input, [], signal);
  await model.complete(input, [], signal);
  expect(JSON.stringify(complete.mock.calls[0])).toContain("data:image/jpeg");
  expect(JSON.stringify(input)).toBe(original);
  expect(original).not.toContain("data:image");
  const broken = withLocalVisualInputs(
    { identity: "local-test", complete },
    async () => [{ ...f.resolved[0]!, sha256: "f".repeat(64) }],
  );
  await expect(broken.prepare!(input, [], signal)).rejects.toThrow(/changed/);
  expect(complete).toHaveBeenCalledTimes(1);
});
it("enforces the original visual allowance and reuses repeated receipt references", async () => {
  const f = frame(),
    resolve = vi.fn(async () => f.resolved),
    complete = vi.fn();
  const model = withLocalVisualInputs(
      { identity: "local-test", complete },
      resolve,
    ),
    signal = new AbortController().signal;
  await model.prepare!(messages(f.ref), [], signal);
  await model.prepare!(messages(f.ref), [], signal);
  expect(resolve).toHaveBeenCalledTimes(1);
  const tooMany = Array.from({ length: 17 }, (_, index) =>
    messages(frame(`owned-${index}`).ref).map((message) => ({
      ...message,
      ...(message.tool_call_id ? { tool_call_id: `inspect-${index}` } : {}),
      ...(message.tool_calls
        ? {
            tool_calls: message.tool_calls.map((call) => ({
              ...call,
              id: `inspect-${index}`,
            })),
          }
        : {}),
    })),
  ).flat();
  await expect(model.prepare!(tooMany, [], signal)).rejects.toThrow(
    /allowance/,
  );
  expect(complete).not.toHaveBeenCalled();
});
it("retains an inspection response when receipt preparation fails and resumes without repeating that model call", async () => {
  const f = frame();
  let available = false,
    paid = 0,
    saved: LoopCheckpoint | null = null;
  const base: LanguageModel = {
    identity: "local-test",
    complete: async (input) => {
      paid++;
      if (paid === 1)
        return {
          text: "",
          calls: [{ id: "inspect", name: "inspect_image", arguments: "{}" }],
          usage: { inputTokens: 2, outputTokens: 1 },
        };
      expect(JSON.stringify(input)).toContain("data:image/jpeg");
      return {
        text: "Inspected only approved pixels",
        calls: [],
        usage: { inputTokens: 3, outputTokens: 1 },
      };
    },
  };
  const create = () =>
    withLocalVisualInputs(base, async () => {
      if (!available) throw Error("Receipt unavailable");
      return f.resolved;
    });
  const options = {
    messages: [{ role: "user" as const, content: "Inspect original" }],
    tools: [
      {
        name: "inspect_image",
        description: "Owned inspection",
        parameters: { type: "object" },
        replaySafe: true,
        execute: async () => ({
          kind: "observation" as const,
          value: { visualInput: f.ref },
        }),
      },
    ],
    signal: new AbortController().signal,
    answer: async (text: string) => text,
    checkpoint: {
      runId: "local-test",
      snapshotHash: "source",
      load: async () => saved,
      save: async (next: LoopCheckpoint) => {
        saved = structuredClone(next);
      },
    },
    maxSteps: 3,
    maxToolCalls: 3,
    maxOutputTokens: 100,
  };
  await expect(runToolLoop({ ...options, model: create() })).rejects.toThrow(
    /Receipt unavailable/,
  );
  expect(paid).toBe(1);
  expect(parseLoopCheckpoint(saved).phase).toBe("tool-observations");
  expect(JSON.stringify(saved)).not.toContain("data:image");
  available = true;
  const result = await runToolLoop({ ...options, model: create() });
  expect(result.result).toBe("Inspected only approved pixels");
  expect(paid).toBe(2);
  expect(JSON.stringify(saved)).not.toContain("data:image");
});
