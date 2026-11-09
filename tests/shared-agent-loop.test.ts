import { describe, expect, it, vi } from "vitest";
import {
  runToolLoop,
  type ModelReply,
  type LoopTool,
} from "../packages/agent-loop/src/index";

const call = (name: string, id = name): ModelReply => ({
  text: "",
  calls: [{ id, name, arguments: "{}" }],
  usage: { inputTokens: 7, outputTokens: 3 },
});
const tool = (
  name: string,
  execute: LoopTool<string>["execute"],
): LoopTool<string> => ({
  name,
  description: name,
  parameters: { type: "object" },
  execute,
});
const options = () => ({
  signal: new AbortController().signal,
  messages: [{ role: "user" as const, content: "Edit" }],
  answer: async (text: string) => text,
});

describe("shared host-independent tool loop", () => {
  it("corrects tool errors, retains call identities and aggregates the remaining token budget", async () => {
    const replies = [call("missing"), call("read"), call("finish")];
    const complete = vi.fn(async () => replies.shift()!);
    const result = await runToolLoop({
      ...options(),
      model: { complete },
      maxOutputTokens: 12,
      tools: [
        tool("read", async () => ({
          kind: "observation",
          value: { id: "existing" },
        })),
        tool("finish", async () => ({ kind: "terminal", result: "candidate" })),
      ],
    });
    expect(result).toEqual({
      result: "candidate",
      modelCalls: 3,
      usage: { inputTokens: 21, outputTokens: 9 },
    });
    expect(complete.mock.calls.map((args) => (args as unknown[])[3])).toEqual([
      { maxOutputTokens: 12, outputBudgetPolicy: "preserve-overrun-v1" },
      { maxOutputTokens: 9, outputBudgetPolicy: "preserve-overrun-v1" },
      { maxOutputTokens: 6, outputBudgetPolicy: "preserve-overrun-v1" },
    ]);
  });
  it("stops after a terminal call even when the model proposes another effect", async () => {
    const unexpected = vi.fn();
    const reply = call("finish");
    reply.calls.push({ id: "later", name: "later", arguments: "{}" });
    const result = await runToolLoop({
      ...options(),
      model: { complete: async () => reply },
      tools: [
        tool("finish", async () => ({ kind: "terminal", result: "done" })),
        tool("later", unexpected),
      ],
    });
    expect(result.result).toBe("done");
    expect(unexpected).not.toHaveBeenCalled();
  });
  it("does not reinterpret host persistence failures as correctable model errors", async () => {
    const complete = vi.fn(async () => call("read"));
    await expect(
      runToolLoop({
        ...options(),
        model: { complete },
        tools: [tool("read", async () => ({ kind: "observation", value: {} }))],
        onEvent: async (event) => {
          if (event.type === "tool.completed")
            throw new Error("store unavailable");
        },
      }),
    ).rejects.toThrow("store unavailable");
    expect(complete).toHaveBeenCalledTimes(1);
  });
  it("never starts a second paid turn after exhausting or losing output usage", async () => {
    for (const usage of [undefined, { inputTokens: 1, outputTokens: 3 }]) {
      const complete = vi.fn(async () => ({ ...call("read"), usage }));
      await expect(
        runToolLoop({
          ...options(),
          model: { complete },
          maxOutputTokens: 3,
          tools: [
            tool("read", async () => ({ kind: "observation", value: {} })),
          ],
        }),
      ).rejects.toThrow(/output budget/);
      expect(complete).toHaveBeenCalledTimes(1);
    }
  });
  it("rejects duplicate tool names and invalid limits before model work", async () => {
    const complete = vi.fn();
    const read = tool("read", async () => ({ kind: "observation", value: {} }));
    await expect(
      runToolLoop({ ...options(), model: { complete }, tools: [read, read] }),
    ).rejects.toThrow(/unique/);
    await expect(
      runToolLoop({
        ...options(),
        model: { complete },
        tools: [],
        maxSteps: Infinity,
      }),
    ).rejects.toThrow(/budget/);
    expect(complete).not.toHaveBeenCalled();
  });
  it("cancels between model completion and tool execution", async () => {
    const controller = new AbortController();
    const execute = vi.fn();
    await expect(
      runToolLoop({
        ...options(),
        signal: controller.signal,
        tools: [tool("read", execute)],
        model: {
          complete: async () => {
            controller.abort();
            return call("read");
          },
        },
      }),
    ).rejects.toThrow();
    expect(execute).not.toHaveBeenCalled();
  });
});
