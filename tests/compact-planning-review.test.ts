import { expect, it, vi } from "vitest";
import Ajv from "ajv";
import {
  builtInSkills,
  restoreCompletionStateFromMessages,
  type CompletionState,
  type EditorStagePorts,
} from "../packages/agent-kit/src/index";
import { createVideoToolset } from "../packages/agent/src/tools";
import {
  createVideoProjectDocument,
  hashVideoProjectDocument,
} from "../packages/core/src/lib/video-project/document";
import type {
  NativeAgentRequest,
  NativeAgentResult,
} from "../packages/core/src/lib/video-project/agent-runtime";
import { runAgent } from "../packages/agent/src/loop";
import type {
  LoopCheckpoint,
  LoopCheckpointPort,
} from "../packages/agent-loop/src/index";

async function fixture() {
  const document = createVideoProjectDocument({
    width: 640,
    height: 360,
    fps: 30,
    durationInFrames: 300,
  });
  document.items.push({
    id: "title",
    trackId: "visual",
    name: "Title",
    node: {
      id: "title",
      type: "text",
      text: "Welcome",
      from: 0,
      duration: 90,
      style: { color: "#ffffff" },
    },
  });
  const request: NativeAgentRequest = {
    contract: "video-project-commands",
    version: 1,
    baseRevision: 0,
    baseHash: await hashVideoProjectDocument(document),
    document,
    instruction: "Make the title red",
    context: { selectedItemIds: ["title"], playheadFrame: 0 },
  };
  const edit = {
    outcome: "proposal",
    summary: "Red title",
    commands: [
      {
        type: "set",
        target: { kind: "node", itemId: "title", nodeId: "title" },
        path: ["style", "color"],
        value: "#ff0000",
      },
    ],
  };
  const requirements = [
    {
      id: "red",
      kind: "property",
      target: { kind: "node", itemId: "title", nodeId: "title" },
      path: ["style", "color"],
      equals: "#ff0000",
    },
  ];
  const stages: EditorStagePorts<NativeAgentResult> = {
    phase: "planning",
    preparedCommands: false,
    generalEditing: true,
    deriveCaptionPlan: true,
    planEditStages: vi.fn(async () => {
      throw Error("No plan needed");
    }),
    saveCaptionBatch: vi.fn(async () => {
      throw Error("No batch");
    }),
    readEditArtifact: vi.fn(async () => {
      throw Error("No artifacts");
    }),
    resolvePreparedEdit: vi.fn(async (raw) => {
      if (raw && typeof raw === "object" && "reviewRef" in raw)
        throw Error("No planning artifact");
      return raw;
    }),
  };
  const session = (state?: CompletionState) =>
    createVideoToolset(request, builtInSkills(), [], {
      profile: "local-editor-v14",
      agentKitVersion: "0.2.9",
      stages,
      initialCompletionState: state,
    });
  const invoke = (s: ReturnType<typeof session>, name: string, args: unknown) =>
    s.tools
      .find((tool) => tool.name === name)!
      .execute(args, new AbortController().signal);
  const reviewArgs = { requirements, edit };
  const review = async (s: ReturnType<typeof session>) => {
    const result = await invoke(s, "review_edit", reviewArgs);
    expect(result).toMatchObject({
      kind: "observation",
      value: {
        completionPreflight: { status: "passed" },
        nextAction: expect.stringContaining("{reviewed:true}"),
      },
    });
    if (result.kind !== "observation")
      throw Error("Expected review observation");
    return result.value;
  };
  const messages = (value: unknown) => [
    {
      role: "assistant",
      tool_calls: [
        {
          id: "review-1",
          function: {
            name: "review_edit",
            arguments: JSON.stringify(reviewArgs),
          },
        },
      ],
    },
    { role: "tool", tool_call_id: "review-1", content: JSON.stringify(value) },
  ];
  return {
    request,
    stages,
    edit,
    reviewArgs,
    session,
    invoke,
    review,
    messages,
  };
}

it("simple planning finishes the checked edit without a stage plan, artifact or repeated commands", async () => {
  const f = await fixture(),
    s = f.session();
  await f.review(s);
  // The cached candidate must not alias the caller's mutable argument object.
  f.edit.commands[0].value = "#00ff00";
  const result = await f.invoke(s, "propose_edit", { reviewed: true });
  expect(result).toMatchObject({
    kind: "terminal",
    result: {
      outcome: "proposal",
      proposal: { commands: [{ type: "set", value: "#ff0000" }] },
    },
  });
  expect(f.stages.planEditStages).not.toHaveBeenCalled();
  expect(f.stages.readEditArtifact).not.toHaveBeenCalled();
});
it("restores the exact planning edit from checked checkpoint arguments", async () => {
  const f = await fixture(),
    first = f.session(),
    value = await f.review(first);
  const state = await restoreCompletionStateFromMessages(
    f.messages(value),
    f.request.baseHash,
    { reviewReferences: true, retainSuccessfulEdit: true },
  );
  expect(state?.successfulEdit).toEqual(f.edit);
  expect(
    await f.invoke(f.session(state), "propose_edit", { reviewed: true }),
  ).toMatchObject({ kind: "terminal", result: { outcome: "proposal" } });
});
it("actual planning wrapper resumes interrupted review and paid marker without another model call", async () => {
  const f = await fixture();
  let saved: LoopCheckpoint | null = null,
    interruption = 0,
    calls = 0;
  const checkpoint: LoopCheckpointPort = {
    runId: "compact-planning-restart",
    snapshotHash: f.request.baseHash,
    load: async () => structuredClone(saved),
    save: async (next, expected) => {
      expect(expected).toBe(saved?.revision ?? null);
      saved = structuredClone(next);
      if (interruption === 0 && next.phase === "tool-observations") {
        interruption++;
        throw Error("After saved review");
      }
      if (
        interruption === 1 &&
        next.phase === "model-returned" &&
        next.modelCalls === 2
      ) {
        interruption++;
        throw Error("After paid marker");
      }
    },
  };
  const input = {
    request: f.request,
    profile: "local-editor-v14" as const,
    agentKitVersion: "0.2.9",
    stages: f.stages,
    skills: builtInSkills(),
    checkpoint,
    signal: new AbortController().signal,
    model: {
      identity: "fixed-test-model",
      complete: async () => {
        calls++;
        return {
          text: "",
          calls: [
            {
              id: `call-${calls}`,
              name: calls === 1 ? "review_edit" : "propose_edit",
              arguments: JSON.stringify(
                calls === 1 ? f.reviewArgs : { reviewed: true },
              ),
            },
          ],
          usage: { inputTokens: 100, outputTokens: 40 },
        };
      },
    },
  };
  await expect(runAgent(input)).rejects.toThrow("After saved review");
  expect(calls).toBe(1);
  await expect(runAgent(input)).rejects.toThrow("After paid marker");
  expect(calls).toBe(2);
  const result = await runAgent(input);
  expect(result.outcome).toBe("proposal");
  expect(calls).toBe(2);
  expect(await runAgent(input)).toEqual(result);
  expect(calls).toBe(2);
});
it("rejects a cached edit whose commands no longer match its successful receipt", async () => {
  const f = await fixture(),
    value = await f.review(f.session());
  const state = await restoreCompletionStateFromMessages(
    f.messages(value),
    f.request.baseHash,
    { reviewReferences: true, retainSuccessfulEdit: true },
  );
  (state!.successfulEdit as typeof f.edit).commands[0].value = "#00ff00";
  await expect(
    f.invoke(f.session(state), "propose_edit", { reviewed: true }),
  ).rejects.toThrow(/exact edit|exact commands|review_edit/);
});
it("failed and malformed reviews clear earlier compact proposal eligibility", async () => {
  for (const malformed of [true, false]) {
    const f = await fixture(),
      s = f.session();
    await f.review(s);
    await f
      .invoke(
        s,
        "review_edit",
        malformed
          ? { unknown: true }
          : {
              edit: {
                ...f.edit,
                commands: [{ ...f.edit.commands[0], value: "#00ff00" }],
              },
            },
      )
      .catch(() => undefined);
    await expect(
      f.invoke(s, "propose_edit", { reviewed: true }),
    ).rejects.toThrow(/No latest successful/);
  }
});
it("checkpoint restoration rejects changed commands and clears cache on a later error", async () => {
  const f = await fixture(),
    value = await f.review(f.session()),
    messages = f.messages(value);
  const tampered = structuredClone(messages);
  tampered[0].tool_calls![0].function.arguments = JSON.stringify({
    edit: { ...f.edit, commands: [] },
  });
  await expect(
    restoreCompletionStateFromMessages(tampered, f.request.baseHash, {
      reviewReferences: true,
      retainSuccessfulEdit: true,
    }),
  ).rejects.toThrow(/does not match/);
  const state = await restoreCompletionStateFromMessages(
    [
      ...messages,
      {
        role: "assistant",
        tool_calls: [
          {
            id: "review-2",
            function: { name: "review_edit", arguments: "{}" },
          },
        ],
      },
      {
        role: "tool",
        tool_call_id: "review-2",
        content: JSON.stringify({ error: "Invalid review" }),
      },
    ],
    f.request.baseHash,
    { reviewReferences: true, retainSuccessfulEdit: true },
  );
  expect(state?.successfulEdit).toBeUndefined();
  expect(state?.successfulReceipt).toBeUndefined();
});
it("compact schema advertises only the marker and preview report while review keeps command grammar", async () => {
  const f = await fixture(),
    s = f.session(),
    propose = s.tools.find((tool) => tool.name === "propose_edit")!,
    review = s.tools.find((tool) => tool.name === "review_edit")!;
  const validate = new Ajv({ strict: false }).compile(propose.parameters);
  expect(validate({ reviewed: true })).toBe(true);
  expect(validate(f.edit)).toBe(false);
  expect(JSON.stringify(propose.parameters).length).toBeLessThan(1800);
  expect(JSON.stringify(review.parameters)).toContain("commands");
  expect(JSON.stringify(review.parameters).length).toBeGreaterThan(10000);
  const retained = createVideoToolset(f.request, builtInSkills(), [], {
    profile: "local-editor-v14",
    agentKitVersion: "0.2.8",
    stages: f.stages,
  });
  const bytes = (tools: typeof s.tools) =>
    Buffer.byteLength(
      JSON.stringify(
        tools.map(({ name, description, parameters }) => ({
          name,
          description,
          parameters,
        })),
      ),
    );
  const priorProposalBytes = Buffer.byteLength(
    JSON.stringify(
      retained.tools.find((tool) => tool.name === "propose_edit")!.parameters,
    ),
  );
  expect(Buffer.byteLength(JSON.stringify(propose.parameters))).toBeLessThan(
    priorProposalBytes / 10,
  );
  if (process.env.REPORT_COMPACT_SCHEMA === "1")
    console.info(
      JSON.stringify({
        measurement: "same-fixture-schema-bytes",
        beforeTools: bytes(retained.tools),
        afterTools: bytes(s.tools),
        beforePropose: priorProposalBytes,
        afterPropose: Buffer.byteLength(JSON.stringify(propose.parameters)),
      }),
    );
  await expect(
    f.invoke(s, "propose_edit", {
      reviewed: true,
      previewReport: {
        requestId: "forged",
        receiptHash: "a".repeat(64),
        issues: [],
      },
    }),
  ).rejects.toThrow(/No latest successful/);
  await f.review(s);
  await expect(
    f.invoke(s, "propose_edit", {
      reviewed: true,
      previewReport: {
        requestId: "forged",
        receiptHash: "a".repeat(64),
        issues: [],
      },
    }),
  ).rejects.toThrow(/preview/);
});
