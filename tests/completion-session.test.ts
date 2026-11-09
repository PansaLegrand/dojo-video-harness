import { expect, it } from "vitest";
import {
  createEditorToolset,
  createCompletionReceipt,
  completionHash,
  restoreCompletionStateFromMessages,
  validateCompletionReceipt,
  type CompletionRequirement,
  type CompletionReview,
  type CompletionState,
  type CompletionContract,
  builtInSkills,
} from "../packages/agent-kit/src/index";
import { runAgent } from "../packages/agent/src/loop";
import {
  createVideoProjectDocument,
  hashVideoProjectDocument,
} from "../packages/core/src/lib/video-project/document";
import type {
  LoopCheckpoint,
  LoopCheckpointPort,
} from "../packages/agent-loop/src/index";
const snapshotHash = "sha256:" + "a".repeat(64);
const requirements: CompletionRequirement[] = [
  {
    id: "color",
    kind: "property",
    target: { kind: "node", itemId: "title", nodeId: "title" },
    path: ["style", "color"],
    equals: "red",
  },
];
const edit = {
  summary: "Color",
  commands: [
    {
      type: "set",
      target: { kind: "node", itemId: "title", nodeId: "title" },
      path: ["style", "color"],
      value: "red",
    },
  ],
};
function session(
  initialCompletionState?: CompletionState,
  profile: "local-editor-v1" | "local-editor-v2" = "local-editor-v2",
) {
  const toolset = createEditorToolset({
    profile,
    snapshotHash,
    initialCompletionState,
    skills: [],
    proposalSchema: { type: "object" },
    ports: {
      inspectProject: () => ({}),
      inspectGraphicsSchema: () => ({}),
      searchTranscript: () => ({}),
      prepareSvgGraphic: () => ({}),
      prepareThreeScene: () => ({}),
      askUser: async (args) => ({ edit: args }),
      proposeEdit: async (args, _signal, completion?: CompletionContract) => ({
        edit: args,
        completion,
      }),
      reviewEdit: async (input) => {
        const candidate = input.edit as typeof edit;
        if (candidate.commands[0]?.value !== "red")
          throw new Error("Candidate compilation/layout failed");
        const checks = [{ id: "color", passed: true, message: "Checked" }];
        return {
          checks,
          receipt: await createCompletionReceipt({
            snapshotHash,
            requirementsHash: await completionHash(input.requirements),
            commandsHash: await completionHash(candidate.commands),
            compiledCommandsHash: await completionHash(candidate.commands),
            previewHash: snapshotHash,
            checksHash: await completionHash(checks),
          }),
        };
      },
    },
  });
  const call = (name: string, args: unknown) =>
    toolset.tools
      .find((tool) => tool.name === name)!
      .execute(args, new AbortController().signal);
  return { ...toolset, call };
}
function messages(args: unknown, value: unknown) {
  return [
    {
      role: "assistant",
      content: null,
      tool_calls: [
        {
          id: "review",
          type: "function",
          function: { name: "review_edit", arguments: JSON.stringify(args) },
        },
      ],
    },
    { role: "tool", tool_call_id: "review", content: JSON.stringify(value) },
  ];
}
it("pins the first valid plan even on compile failure and restores it before repair", async () => {
  const first = session();
  const args = { requirements, edit: { ...edit, commands: [] } };
  const failed = await first.call("review_edit", args);
  expect(failed).toMatchObject({
    kind: "observation",
    pinned: true,
    value: { completionPreflight: { status: "failed", requirements } },
  });
  if (failed.kind !== "observation") throw new Error("fixture");
  const state = await restoreCompletionStateFromMessages(
    messages(args, failed.value),
    snapshotHash,
  );
  const resumed = session(state);
  await expect(resumed.call("propose_edit", edit)).rejects.toThrow(
    /review_edit/,
  );
  const weaker = await resumed.call("review_edit", {
    requirements: [{ id: "present", kind: "item_present", itemId: "title" }],
    edit,
  });
  expect(weaker).toMatchObject({
    kind: "observation",
    pinned: true,
    value: { completionPreflight: { status: "failed", requirements } },
  });
  const passed = await resumed.call("review_edit", { edit });
  expect(passed).toMatchObject({
    kind: "observation",
    pinned: true,
    value: { completionPreflight: { status: "passed" } },
  });
  const final = await resumed.call("propose_edit", edit);
  expect(final).toMatchObject({
    kind: "terminal",
    result: { completion: { requirements } },
  });
});
it("requires an exact successful review and rejects forged metadata/receipts", async () => {
  const current = session();
  await expect(
    current.call("propose_edit", { ...edit, completion: { requirements } }),
  ).rejects.toThrow(/host-owned/);
  const args = { requirements, edit };
  const passed = await current.call("review_edit", args);
  if (passed.kind !== "observation") throw new Error("fixture");
  const review = (passed.value as { completionPreflight: CompletionReview })
    .completionPreflight;
  await expect(
    current.call("propose_edit", {
      ...edit,
      commands: [{ ...edit.commands[0]!, value: "blue" }],
    }),
  ).rejects.toThrow(/exact commands/);
  const receipt = {
    ...review.receipt!,
    previewHash: "sha256:" + "b".repeat(64),
  };
  await expect(validateCompletionReceipt(receipt)).rejects.toThrow(/integrity/);
  const corrupted = {
    completionPreflight: { ...review, requirementsHash: snapshotHash },
  };
  await expect(
    restoreCompletionStateFromMessages(messages(args, corrupted), snapshotHash),
  ).rejects.toThrow(/changed/);
  await expect(
    restoreCompletionStateFromMessages(
      messages(args, passed.value),
      "sha256:" + "c".repeat(64),
    ),
  ).rejects.toThrow(/snapshot/);
});
it("keeps legacy profile inventory and tools frozen", () => {
  const old = session(undefined, "local-editor-v1");
  expect(old.inventory.kitVersion).toBe("0.1.1");
  expect(
    old.tools.some(
      (tool) =>
        tool.name === "review_edit" || tool.name === "prepare_caption_pair",
    ),
  ).toBe(false);
  expect(
    old.inventory.unavailable.some(
      (tool) =>
        tool.name === "review_edit" || tool.name === "prepare_caption_pair",
    ),
  ).toBe(false);
  expect(session().inventory.kitVersion).toBe("0.1.2");
});
it("restores a successful pinned review from the existing durable checkpoint without another review call", async () => {
  const document = createVideoProjectDocument({
    width: 640,
    height: 360,
    fps: 30,
    durationInFrames: 90,
  });
  document.items.push({
    id: "title",
    name: "Title",
    trackId: "visual",
    node: {
      id: "title",
      type: "text",
      text: "Title",
      from: 0,
      duration: 90,
      style: { width: 300, height: 60, color: "white" },
    },
  });
  const request = {
    contract: "video-project-commands" as const,
    version: 1 as const,
    baseRevision: 1,
    baseHash: await hashVideoProjectDocument(document),
    document,
    context: { selectedItemIds: [], playheadFrame: 0 },
    authoring: { version: 1 as const, scope: { kind: "project" as const } },
  };
  let stored: LoopCheckpoint | null = null,
    crashed = false;
  const port: LoopCheckpointPort = {
    runId: "run",
    snapshotHash: request.baseHash,
    load: async () => stored,
    save: async (next, previous) => {
      expect(stored?.revision ?? null).toBe(previous);
      stored = structuredClone(next);
      if (!crashed && next.phase === "tool-observations") {
        crashed = true;
        throw new Error("Process ended after durable review");
      }
    },
  };
  const model = {
    identity: "fixture",
    complete: async () => ({
      text: "",
      calls: [
        {
          id: "review",
          name: "review_edit",
          arguments: JSON.stringify({ requirements, edit }),
        },
      ],
      usage: { inputTokens: 10, outputTokens: 5 },
    }),
  };
  await expect(
    runAgent({
      request,
      model,
      skills: [],
      signal: new AbortController().signal,
      profile: "local-editor-v2",
      checkpoint: port,
    }),
  ).rejects.toThrow(/Process ended/);
  expect(stored!.pinnedToolCallIds).toEqual(["review"]);
  let calls = 0;
  const result = await runAgent({
    request,
    model: {
      identity: "fixture",
      complete: async () => {
        calls++;
        return {
          text: "",
          calls: [
            {
              id: "propose",
              name: "propose_edit",
              arguments: JSON.stringify(edit),
            },
          ],
          usage: { inputTokens: 10, outputTokens: 5 },
        };
      },
    },
    skills: [],
    signal: new AbortController().signal,
    profile: "local-editor-v2",
    checkpoint: port,
  });
  expect(calls).toBe(1);
  expect(result.completion!.requirements).toEqual(requirements);
  expect(result.proposal!.commands).toHaveLength(1);
});
