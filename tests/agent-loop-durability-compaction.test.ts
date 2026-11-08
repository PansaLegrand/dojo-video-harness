import { describe, expect, it } from "vitest";
import {
  compactLoopMessages,
  type ChatMessage,
} from "../packages/agent-loop/src/index";

const original: ChatMessage[] = [
  { role: "system", content: "Immutable editing rules and source evidence." },
  {
    role: "user",
    content: "Preserve my complete long instruction including the final outro.",
  },
];
function group(
  id: string,
  name = "inspect_project",
  value: unknown = { data: "x".repeat(200) },
): ChatMessage[] {
  return [
    {
      role: "assistant",
      content: null,
      tool_calls: [
        { id, type: "function", function: { name, arguments: "{}" } },
      ],
    },
    { role: "tool", tool_call_id: id, content: JSON.stringify(value) },
  ];
}
describe("deterministic conservative context compaction", () => {
  it("drops only old complete disposable groups and preserves recent complete plus pending pairs", () => {
    const old = group("old");
    const evidence = group("words", "search_transcript", {
      wordIds: ["genuine-word-1"],
    });
    const recentA = group("recent-a");
    const recentB = group("recent-b");
    const pending = group("pending").slice(0, 1);
    const messages = [
      ...original,
      ...old,
      ...evidence,
      ...recentA,
      ...recentB,
      ...pending,
    ];
    const expected = [
      ...original,
      ...evidence,
      ...recentA,
      ...recentB,
      ...pending,
    ];
    const input = {
      messages,
      initialMessages: original,
      compactableToolNames: ["inspect_project"],
      options: {
        maxCharacters: JSON.stringify(expected).length,
        keepRecentGroups: 2,
      },
    };
    expect(compactLoopMessages(input)).toEqual({
      messages: expected,
      droppedGroups: 1,
      characters: JSON.stringify(expected).length,
    });
    expect(compactLoopMessages(input).messages).toEqual(expected);
    expect(messages).toHaveLength(original.length + 9);
  });
  it("pins errors, explicit memory/evidence and literal durable plan references", () => {
    const groups = [
      ...group("error", "inspect_project", { error: "validation failed" }),
      ...group("memory"),
      ...group("plan", "inspect_project", {
        planId: "durable-plan-revision-7",
      }),
      ...group("recent"),
    ];
    const messages = [...original, ...groups];
    expect(() =>
      compactLoopMessages({
        messages,
        initialMessages: original,
        compactableToolNames: ["inspect_project"],
        pinnedToolCallIds: ["memory"],
        durablePlanRefs: ["durable-plan-revision-7"],
        options: {
          maxCharacters: JSON.stringify(messages).length - 1,
          keepRecentGroups: 1,
        },
      }),
    ).toThrow("Protected instructions/evidence");
  });
  it("never drops prepared commands or transcript evidence by default", () => {
    const messages = [
      ...original,
      ...group("commands", "prepare_text_overlay"),
      ...group("words", "search_transcript"),
      ...group("recent"),
    ];
    expect(() =>
      compactLoopMessages({
        messages,
        initialMessages: original,
        compactableToolNames: ["inspect_project"],
        options: {
          maxCharacters: JSON.stringify(messages).length - 1,
          keepRecentGroups: 1,
        },
      }),
    ).toThrow("Protected instructions/evidence");
  });
  it("rejects orphaned observations, incomplete internal groups and rewritten original instructions", () => {
    const compact = (messages: ChatMessage[]) =>
      compactLoopMessages({
        messages,
        initialMessages: original,
        compactableToolNames: ["inspect_project"],
        options: { maxCharacters: 10000 },
      });
    expect(() => compact([...original, group("orphan")[1]])).toThrow(
      "orphaned",
    );
    expect(() =>
      compact([
        ...original,
        ...group("pending").slice(0, 1),
        { role: "user", content: "new" },
      ]),
    ).toThrow("incomplete");
    expect(() => compact([{ role: "user", content: "replaced" }])).toThrow(
      "original instructions",
    );
  });
});
