import { runAgent } from "../packages/agent/src/loop";
import type {
  LoopCheckpoint,
  LoopCheckpointPort,
} from "../packages/agent-loop/src/index";
import { expect, it, vi } from "vitest";
import Ajv from "ajv";
import {
  builtInSkills,
  completionCanonical,
  completionHash,
  createEditorHostTools,
  restoreCompletionStateFromMessages,
  type CompletionState,
  type EditArtifactRef,
  type EditorStagePorts,
  type PreviewRepairClaim,
  type PreviewRepairEvidence,
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
const signal = () => new AbortController().signal;
async function fixture() {
  const document = createVideoProjectDocument({
    width: 640,
    height: 360,
    fps: 30,
    durationInFrames: 120,
  });
  const request: NativeAgentRequest = {
    contract: "video-project-commands",
    version: 1,
    baseRevision: 0,
    baseHash: await hashVideoProjectDocument(document),
    document,
    instruction: "Make an editable graphic and check its preview",
    context: { selectedItemIds: [], playheadFrame: 0 },
  };
  const requirements = [
    { id: "graphic", kind: "item_present" as const, itemId: "graphic" },
  ];
  const edit = (fill: string) => ({
    outcome: "proposal",
    summary: "Graphic",
    commands: [
      {
        type: "insertGraphic",
        itemId: "graphic",
        trackId: "visual",
        name: "Graphic",
        node: {
          type: "shape",
          from: 0,
          duration: 120,
          shape: { kind: "rect" },
          style: {
            position: "absolute",
            left: 40,
            top: 40,
            width: 100,
            height: 100,
            fill,
          },
        },
      },
    ],
  });
  const values = new Map<string, unknown>();
  const evidence = new Map<string, PreviewRepairEvidence>();
  let latest: EditArtifactRef | undefined,
    claim: PreviewRepairClaim | undefined;
  const stages: EditorStagePorts<NativeAgentResult> = {
    phase: "assemble",
    preparedCommands: false,
    planEditStages: async () => {
      throw Error("Already planned");
    },
    saveCaptionBatch: async () => {
      throw Error("No translation");
    },
    readEditArtifact: async () => ({}),
    resolvePreparedEdit: async (raw) => {
      const ref = (raw as { reviewRef?: EditArtifactRef })?.reviewRef;
      if (!ref) return raw;
      const saved = values.get(ref.id) as { edit: unknown };
      if (!saved || (await completionHash(saved)) !== ref.sha256)
        throw Error("Invalid saved review");
      return structuredClone(saved.edit);
    },
    recordReview: async (review) => {
      const sha256 = await completionHash(review);
      const ref: EditArtifactRef = {
        version: 1,
        id: sha256,
        runId: "run",
        bindingHash: "sha256:" + "a".repeat(64),
        kind: review.receipt ? "verification" : "failure",
        sha256,
        sizeBytes: new TextEncoder().encode(completionCanonical(review)).length,
      };
      values.set(ref.id, structuredClone(review));
      latest = ref;
      return review.receipt ? { reviewRef: ref } : undefined;
    },
    claimPreviewRepair: async (next) => {
      if (claim && completionCanonical(claim) !== completionCanonical(next))
        throw Error("Single preview correction exhausted");
      claim = structuredClone(next);
    },
  };
  const prepare = vi.fn(async (input: Record<string, unknown>) => {
    const ref = input.candidateRef as EditArtifactRef;
    const record = values.get(ref.id) as { receipt: { previewHash: string } };
    const requestId = `preview-${ref.sha256}`;
    evidence.set(requestId, {
      requestId,
      receiptHash: "b".repeat(64),
      candidateRef: ref,
      snapshotHash: request.visualDocumentHash ?? request.baseHash,
      renderHash: record.receipt.previewHash,
      frames: input.frames as number[],
      audio: "not-inspected",
    });
    return {
      kind: "observation" as const,
      value: {
        projectPreview: {
          requestRef: {
            kind: "project-preview",
            id: requestId,
            hash: "c".repeat(64),
          },
          status: "fulfilled",
        },
      },
    };
  });
  const hostTools = createEditorHostTools<NativeAgentResult>({
    profile: "local-editor-v10",
    ports: { request_project_preview: prepare },
  });
  const build = (
    state?: CompletionState,
    profile: "local-editor-v9" | "local-editor-v10" = "local-editor-v10",
  ) =>
    createVideoToolset(request, builtInSkills(), hostTools, {
      profile,
      stages,
      initialCompletionState: state,
      previewEvidence: async (requestId) => {
        const item = evidence.get(requestId);
        if (!item) throw Error("No saved browser receipt");
        return structuredClone(item);
      },
    });
  return {
    request,
    extraTools: hostTools,
    edit,
    requirements,
    stages,
    evidence,
    prepare,
    build,
    claim: () => claim,
    latest: () => latest,
  };
}
function tools(
  session: ReturnType<Awaited<ReturnType<typeof fixture>>["build"]>,
) {
  return (name: string, args: unknown) =>
    session.tools.find((tool) => tool.name === name)!.execute(args, signal());
}
async function reviewed(
  f: Awaited<ReturnType<typeof fixture>>,
  invoke: ReturnType<typeof tools>,
  color = "#ff0000",
) {
  const args = { requirements: f.requirements, edit: f.edit(color) };
  const result = await invoke("review_edit", args);
  expect(result).toMatchObject({
    kind: "observation",
    value: { completionPreflight: { status: "passed" } },
  });
  return { args, result };
}
async function preview(
  f: Awaited<ReturnType<typeof fixture>>,
  invoke: ReturnType<typeof tools>,
) {
  await invoke("request_project_preview", { reviewed: true, frames: [0, 60] });
  return [...f.evidence.values()].at(-1)!;
}
it("uses exact candidate preview, one native correction, second preview and an explicit remaining-failure report", async () => {
  const f = await fixture(),
    session = f.build(),
    invoke = tools(session);
  await reviewed(f, invoke);
  const initialRef = f.latest();
  const before = await preview(f, invoke);
  expect(f.prepare.mock.calls[0][0].candidateRef).toEqual(initialRef);
  const repair = {
    requestId: before.requestId,
    receiptHash: before.receiptHash,
    issues: [{ frame: 60, description: "The graphic uses the wrong color" }],
  };
  const result = await invoke("review_edit", {
    edit: f.edit("#0000ff"),
    previewRepair: repair,
  });
  expect(result).toMatchObject({
    kind: "observation",
    value: {
      completionPreflight: {
        status: "passed",
        previewRepair: { kind: "preview-repair" },
      },
    },
  });
  expect(f.claim()?.basisRef).toEqual(initialRef);
  await expect(invoke("propose_edit", { reviewed: true })).rejects.toThrow(
    /second preview/,
  );
  await expect(
    invoke("propose_edit", {
      reviewed: true,
      previewReport: { ...repair, issues: [] },
    }),
  ).rejects.toThrow(/exact candidate/);
  const after = await preview(f, invoke);
  expect(after.candidateRef).not.toEqual(initialRef);
  const final = await invoke("propose_edit", {
    reviewed: true,
    previewReport: {
      requestId: after.requestId,
      receiptHash: after.receiptHash,
      issues: [
        {
          frame: 60,
          description: "The intended brand image is still unavailable",
        },
      ],
    },
  });
  expect(final).toMatchObject({
    kind: "terminal",
    result: {
      outcome: "proposal",
      summary: expect.stringContaining("brand image is still unavailable"),
    },
  });
  if (final.kind !== "terminal") throw Error("Expected native proposal");
  expect(final.result.summary).toContain("Audio was not inspected");
  expect(JSON.stringify(final.result.proposal?.commands)).toContain("#0000ff");
  expect((f.request.document as { items: unknown[] }).items).toHaveLength(0);
});
it.each([
  "snapshotHash",
  "renderHash",
  "candidateRef",
  "receiptHash",
  "frames",
])("rejects changed preview %s before claiming correction", async (field) => {
  const f = await fixture(),
    invoke = tools(f.build());
  await reviewed(f, invoke);
  const evidence = await preview(f, invoke);
  const changed = {
    ...evidence,
    [field]:
      field === "frames"
        ? [0]
        : field === "candidateRef"
          ? { ...evidence.candidateRef, runId: "foreign" }
          : "changed",
  };
  f.evidence.set(evidence.requestId, changed as PreviewRepairEvidence);
  const result = await invoke("review_edit", {
    edit: f.edit("#0000ff"),
    previewRepair: {
      requestId: evidence.requestId,
      receiptHash: evidence.receiptHash,
      issues: [{ frame: 60, description: "Observed wrong color" }],
    },
  });
  expect(result).toMatchObject({
    kind: "observation",
    value: { completionPreflight: { status: "failed" } },
  });
  expect(f.claim()).toBeUndefined();
});
it("retains the claimed round through checkpoint restoration, rejects a third correction and preserves old schemas", async () => {
  const f = await fixture(),
    session = f.build(),
    invoke = tools(session);
  const first = await reviewed(f, invoke),
    before = await preview(f, invoke);
  const args = {
    edit: f.edit("#0000ff"),
    previewRepair: {
      requestId: before.requestId,
      receiptHash: before.receiptHash,
      issues: [{ frame: 0, description: "Wrong color" }],
    },
  };
  const repaired = await invoke("review_edit", args);
  if (first.result.kind !== "observation" || repaired.kind !== "observation")
    throw Error("Expected observations");
  const messages = [first, { args, result: repaired }].flatMap((record, i) => [
    {
      role: "assistant",
      tool_calls: [
        {
          id: `review-${i}`,
          function: {
            name: "review_edit",
            arguments: JSON.stringify(record.args),
          },
        },
      ],
    },
    {
      role: "tool",
      tool_call_id: `review-${i}`,
      content: JSON.stringify(
        record.result.kind === "observation" ? record.result.value : {},
      ),
    },
  ]);
  const restored = await restoreCompletionStateFromMessages(
    messages,
    f.request.baseHash,
    {
      reviewReferences: true,
      previewRepair: true,
      resolvePreparedEdit: (edit) =>
        f.stages.resolvePreparedEdit(edit, signal()),
    },
  );
  expect(restored?.previewRepair).toEqual(f.claim());
  const resumed = tools(f.build(restored));
  const second = await preview(f, resumed);
  const third = await resumed("review_edit", {
    edit: f.edit("#00ff00"),
    previewRepair: {
      requestId: second.requestId,
      receiptHash: second.receiptHash,
      issues: [{ frame: 0, description: "Still wrong" }],
    },
  });
  expect(JSON.stringify(third)).toMatch(/exhausted|exact candidate/);
  expect(f.claim()?.requestId).toBe(before.requestId);
  const ajv = new Ajv({ strict: false });
  const old = f.build(undefined, "local-editor-v9");
  expect(
    ajv.compile(
      old.tools.find((tool) => tool.name === "review_edit")!.parameters,
    )(args),
  ).toBe(false);
  expect(
    ajv.compile(
      session.tools.find((tool) => tool.name === "review_edit")!.parameters,
    )(args),
  ).toBe(true);
});
it("an unsuccessful correction still consumes its claimed round", async () => {
  const f = await fixture(),
    invoke = tools(f.build());
  await reviewed(f, invoke);
  const before = await preview(f, invoke);
  const bad = f.edit("#0000ff");
  bad.commands[0].trackId = "missing";
  const result = await invoke("review_edit", {
    edit: bad,
    previewRepair: {
      requestId: before.requestId,
      receiptHash: before.receiptHash,
      issues: [{ frame: 0, description: "Observed wrong color" }],
    },
  });
  expect(result).toMatchObject({
    kind: "observation",
    value: {
      completionPreflight: {
        status: "failed",
        previewRepair: { kind: "preview-repair" },
      },
    },
  });
  expect(f.claim()).toBeDefined();
  await expect(invoke("propose_edit", { reviewed: true })).rejects.toThrow(
    /No latest successful/,
  );
});

it("actual local loop resumes the claimed correction and second preview without resetting or repeating model replies", async () => {
  const f = await fixture();
  let calls = 0,
    saved: LoopCheckpoint | null = null,
    interrupted = false;
  const checkpoint: LoopCheckpointPort = {
    runId: "preview-loop",
    snapshotHash: f.request.baseHash,
    load: async () => structuredClone(saved),
    save: async (value, expected) => {
      expect(expected).toBe(saved?.revision ?? null);
      saved = structuredClone(value);
      if (
        !interrupted &&
        value.phase === "tool-observations" &&
        value.modelCalls === 3
      ) {
        interrupted = true;
        throw Error("Interrupted after correction observation");
      }
    },
  };
  const model = {
    identity: "synthetic-preview-model",
    complete: async () => {
      calls++;
      const evidence = [...f.evidence.values()].at(-1);
      const name =
        calls === 1 || calls === 3
          ? "review_edit"
          : calls === 5
            ? "propose_edit"
            : "request_project_preview";
      const args =
        calls === 1
          ? { requirements: f.requirements, edit: f.edit("#ff0000") }
          : calls === 3
            ? {
                edit: f.edit("#0000ff"),
                previewRepair: {
                  requestId: evidence!.requestId,
                  receiptHash: evidence!.receiptHash,
                  issues: [
                    { frame: 0, description: "Wrong color in sampled frame" },
                  ],
                },
              }
            : calls === 5
              ? {
                  reviewed: true,
                  previewReport: {
                    requestId: evidence!.requestId,
                    receiptHash: evidence!.receiptHash,
                    issues: [],
                  },
                }
              : { reviewed: true, frames: [0, 60] };
      return {
        text: "",
        usage: { inputTokens: 40, outputTokens: 80 },
        calls: [{ id: `call-${calls}`, name, arguments: JSON.stringify(args) }],
      };
    },
  };
  const input = {
    request: f.request,
    profile: "local-editor-v10" as const,
    skills: builtInSkills(),
    stages: f.stages,
    extraTools: f.extraTools,
    model,
    checkpoint,
    signal: signal(),
    previewEvidence: async (requestId: string) =>
      structuredClone(f.evidence.get(requestId)!),
  };
  await expect(runAgent(input)).rejects.toThrow(
    "Interrupted after correction observation",
  );
  expect(calls).toBe(3);
  const result = await runAgent(input);
  expect(result).toMatchObject({
    outcome: "proposal",
    summary: expect.stringContaining("No remaining issues were reported"),
  });
  expect(calls).toBe(5);
  expect(f.prepare).toHaveBeenCalledTimes(2);
  expect(await runAgent(input)).toEqual(result);
  expect(calls).toBe(5);
});
