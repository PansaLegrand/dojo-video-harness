import { describe, it, expect, vi } from "vitest";
import {
  runAgent,
  type LanguageModel,
  type ModelReply,
  type ChatMessage,
  type ToolSpec,
} from "../packages/agent/src";
import {
  createVideoProjectDocument,
  hashVideoProjectDocument,
} from "../packages/core/src/lib/video-project/document";
import {
  buildNativeAgentPrompts,
  type NativeAgentRequest,
} from "../packages/core/src/lib/video-project/agent-runtime";
const call = (
  name: string,
  args: unknown,
  id = crypto.randomUUID(),
): ModelReply => ({
  text: "",
  calls: [{ id, name, arguments: JSON.stringify(args) }],
});
const proposal = {
  summary: "Blue title",
  outcome: "proposal",
  commands: [
    {
      type: "set",
      target: { kind: "node", itemId: "title", nodeId: "title" },
      path: ["style", "color"],
      value: "#2563eb",
    },
  ],
};
async function fixture(): Promise<NativeAgentRequest> {
  const document = createVideoProjectDocument({
    width: 320,
    height: 180,
    fps: 30,
    durationInFrames: 120,
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
      duration: 120,
      style: { color: "#ffffff" },
    },
  });
  return {
    contract: "video-project-commands",
    version: 1,
    baseRevision: 0,
    baseHash: await hashVideoProjectDocument(document),
    document,
    context: { selectedItemIds: ["title"], playheadFrame: 0 },
    instruction: "Make the title blue",
    authoring: { version: 1, scope: { kind: "selection", itemIds: ["title"] } },
  };
}
function scripted(replies: ModelReply[]) {
  return {
    complete: vi.fn(
      async (
        _messages: ChatMessage[],
        _tools: ToolSpec[],
        _signal: AbortSignal,
      ) => {
        const reply = replies.shift();
        if (!reply) throw new Error("Unexpected model call");
        return reply;
      },
    ),
  } satisfies LanguageModel;
}
describe("readable bounded agent loop", () => {
  it("executes real function calls, corrects invalid input, and stages without mutating", async () => {
    const request = await fixture(),
      before = JSON.stringify(request);
    const model = scripted([
      call("inspect_project", { itemIds: ["title"] }),
      call("read_skill", { name: "precise" }),
      call("propose_edit", {
        ...proposal,
        commands: [{ ...proposal.commands[0], value: 12 }],
      }),
      call("propose_edit", proposal),
    ]);
    const events: string[] = [];
    const result = await runAgent({
      request,
      model,
      skills: [
        {
          name: "precise",
          description: "Edit precisely",
          instructions: "Use stable IDs",
        },
      ],
      signal: new AbortController().signal,
      onEvent: (e) => {
        events.push(e.type);
      },
    });
    expect(result.proposal?.commands).toHaveLength(1);
    expect(JSON.stringify(request)).toBe(before);
    expect(model.complete).toHaveBeenCalledTimes(4);
    expect(events.at(-1)).toBe("proposal.ready");
    expect(model.complete.mock.calls[3]?.[0]).toBeDefined();
  });
  it("pauses on a validated question without executing another tool or committing", async () => {
    const model = scripted([
      call("ask_user", {
        id: "q",
        question: "Which title?",
        options: [
          { id: "a", label: "Opening", targetItemIds: ["title"] },
          { id: "b", label: "Keep it" },
        ],
      }),
    ]);
    const result = await runAgent({
      request: await fixture(),
      model,
      skills: [],
      signal: new AbortController().signal,
    });
    expect(result.outcome).toBe("needs_input");
    expect(result.proposal).toBeNull();
    expect(model.complete).toHaveBeenCalledTimes(1);
  });
  it("rejects stale snapshots before paid model work", async () => {
    const request = await fixture();
    request.baseHash = "sha256:" + "0".repeat(64);
    const model = scripted([]);
    await expect(
      runAgent({
        request,
        model,
        skills: [],
        signal: new AbortController().signal,
      }),
    ).rejects.toThrow(/hash/);
    expect(model.complete).not.toHaveBeenCalled();
  });
  it("enforces scope and the step budget", async () => {
    const request = await fixture(),
      model = scripted([
        call("propose_edit", {
          ...proposal,
          commands: [
            {
              type: "set",
              target: { kind: "format" },
              path: ["width"],
              value: 640,
            },
          ],
        }),
      ]);
    await expect(
      runAgent({
        request,
        model,
        skills: [],
        signal: new AbortController().signal,
        maxSteps: 1,
      }),
    ).rejects.toThrow(/budget/);
  });
  it("aborts before dispatch and never repeats a failed provider call", async () => {
    const controller = new AbortController();
    controller.abort();
    const model = scripted([]);
    await expect(
      runAgent({
        request: await fixture(),
        model,
        skills: [],
        signal: controller.signal,
      }),
    ).rejects.toThrow();
    expect(model.complete).not.toHaveBeenCalled();
    const broken = {
      complete: vi.fn(async () => {
        throw new Error("Network response lost");
      }),
    };
    await expect(
      runAgent({
        request: await fixture(),
        model: broken,
        skills: [],
        signal: new AbortController().signal,
      }),
    ).rejects.toThrow(/lost/);
    expect(broken.complete).toHaveBeenCalledTimes(1);
  });
  it("includes existing group identities in the model context", async () => {
    const request = await fixture();
    const document = request.document as ReturnType<
      typeof createVideoProjectDocument
    >;
    document.items.push({
      ...structuredClone(document.items[0]),
      id: "other",
      node: { ...document.items[0].node, id: "other" },
    });
    document.linkedGroups = {
      pair: { id: "pair", itemIds: ["title", "other"] },
    };
    const prompts = buildNativeAgentPrompts({
      ...request,
      document,
      instruction: "unlink this group",
      messages: [],
    });
    expect(
      JSON.parse(prompts.userPrompt).document.linkedGroups.pair.itemIds,
    ).toEqual(["title", "other"]);
  });
});
