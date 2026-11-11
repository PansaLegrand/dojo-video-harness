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
async function fixture(
  options: { preparedCaptions?: boolean; lockedAudio?: boolean } = {},
) {
  const document = createVideoProjectDocument({
    width: 640,
    height: 360,
    fps: 30,
    durationInFrames: 120,
  });
  const prepared: unknown[] = [];
  if (options.lockedAudio)
    document.tracks.find((track) => track.id === "audio")!.locked = true;
  if (options.preparedCaptions) {
    document.assets.voice = {
      id: "voice",
      type: "audio",
      name: "Synthetic narration fixture",
      source: "local",
      durationSeconds: 4,
    };
    document.sources.voice = { assetId: "voice", revision: "synthetic-source" };
    document.items.push({
      id: "voice",
      name: "Voice",
      trackId: "audio",
      node: {
        id: "voice",
        type: "audio",
        assetId: "voice",
        from: 0,
        duration: 120,
      },
    });
    document.evidence.words = {
      id: "words",
      sourceAssetId: "voice",
      sourceRevision: "synthetic-source",
      transcriptHash: "synthetic-transcript",
      language: "en",
      text: "A clear explanation.",
      words: [
        { id: "w0", text: "A", startMs: 0, endMs: 200 },
        { id: "w1", text: "clear", startMs: 300, endMs: 600 },
        { id: "w2", text: "explanation.", startMs: 700, endMs: 1300 },
      ],
    };
    prepared.push({
      type: "captionSource",
      sourceItemId: "voice",
      evidenceId: "words",
      itemId: "captions",
      trackId: "visual",
    });
  }
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
    preparedCommands: prepared.length > 0,
    planEditStages: async () => {
      throw Error("Already planned");
    },
    saveCaptionBatch: async () => {
      throw Error("No translation");
    },
    readEditArtifact: async () => ({}),
    resolvePreparedEdit: async (raw) => {
      const ref = (raw as { reviewRef?: EditArtifactRef })?.reviewRef;
      if (!ref)
        return prepared.length
          ? {
              ...(raw as object),
              commands: [
                ...prepared,
                ...(raw as { commands: unknown[] }).commands,
              ],
            }
          : raw;
      if (
        ref.runId !== "run" ||
        ref.bindingHash !== "sha256:" + "a".repeat(64) ||
        ref.kind !== "verification"
      )
        throw Error("Foreign saved review");
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
    claimPreviewRepair: vi.fn(async (next: PreviewRepairClaim) => {
      if (claim && completionCanonical(claim) !== completionCanonical(next))
        throw Error("Single preview correction exhausted");
      claim = structuredClone(next);
    }),
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
    profile:
      | "local-editor-v9"
      | "local-editor-v10"
      | "local-editor-v11"
      | "local-editor-v12" = "local-editor-v10",
    withPreviewEvidence = true,
  ) =>
    createVideoToolset(request, builtInSkills(), hostTools, {
      profile,
      stages,
      initialCompletionState: state,
      ...(withPreviewEvidence
        ? {
            previewEvidence: async (requestId: string) => {
              const item = evidence.get(requestId);
              if (!item) throw Error("No saved browser receipt");
              return structuredClone(item);
            },
          }
        : {}),
    });
  return {
    request,
    extraTools: hostTools,
    edit,
    requirements,
    stages,
    prepared,
    values,
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
it.each(["local-editor-v10", "local-editor-v12"] as const)(
  "%s retains its claim through checkpoint restore and rejects a changed second correction",
  async (profile) => {
    const f = await fixture(),
      session = f.build(undefined, profile),
      invoke = tools(session);
    const first = await reviewed(f, invoke),
      before = await preview(f, invoke);
    const args = {
      edit:
        profile === "local-editor-v12"
          ? {
              outcome: "proposal",
              summary: "Targeted repair",
              commands: [
                {
                  type: "set",
                  target: {
                    kind: "node",
                    itemId: "graphic",
                    nodeId: "graphic",
                  },
                  path: ["style", "fill"],
                  value: "#0000ff",
                },
              ],
            }
          : f.edit("#0000ff"),
      previewRepair: {
        ...(profile === "local-editor-v12" ? { mode: "append" } : {}),
        requestId: before.requestId,
        receiptHash: before.receiptHash,
        issues: [{ frame: 0, description: "Wrong color" }],
      },
    };
    const repaired = await invoke("review_edit", args);
    if (first.result.kind !== "observation" || repaired.kind !== "observation")
      throw Error("Expected observations");
    const messages = [first, { args, result: repaired }].flatMap(
      (record, i) => [
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
      ],
    );
    const restored = await restoreCompletionStateFromMessages(
      messages,
      f.request.baseHash,
      {
        reviewReferences: true,
        previewRepair: true,
        ...(profile === "local-editor-v12"
          ? { appendPreviewRepair: true as const }
          : {}),
        resolvePreparedEdit: (edit) =>
          f.stages.resolvePreparedEdit(edit, signal()),
      },
    );
    expect(restored?.previewRepair).toEqual(f.claim());
    const resumed = tools(f.build(restored, profile));
    const second = await preview(f, resumed);
    const third = await resumed("review_edit", {
      edit:
        profile === "local-editor-v12"
          ? {
              outcome: "proposal",
              summary: "Changed repair",
              commands: [
                {
                  type: "set",
                  target: {
                    kind: "node",
                    itemId: "graphic",
                    nodeId: "graphic",
                  },
                  path: ["style", "fill"],
                  value: "#00ff00",
                },
              ],
            }
          : f.edit("#00ff00"),
      previewRepair: {
        ...(profile === "local-editor-v12" ? { mode: "append" } : {}),
        requestId:
          profile === "local-editor-v12" ? before.requestId : second.requestId,
        receiptHash:
          profile === "local-editor-v12"
            ? before.receiptHash
            : second.receiptHash,
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
  },
);
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

it.each(["local-editor-v10", "local-editor-v12"] as const)(
  "%s actual local loop resumes the claimed correction and second preview without repeating model replies",
  async (profile) => {
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
                  edit:
                    profile === "local-editor-v12"
                      ? {
                          outcome: "proposal",
                          summary: "Targeted fill repair",
                          commands: [
                            {
                              type: "set",
                              target: {
                                kind: "node",
                                itemId: "graphic",
                                nodeId: "graphic",
                              },
                              path: ["style", "fill"],
                              value: "#0000ff",
                            },
                          ],
                        }
                      : f.edit("#0000ff"),
                  previewRepair: {
                    ...(profile === "local-editor-v12"
                      ? { mode: "append" }
                      : {}),
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
          calls: [
            { id: `call-${calls}`, name, arguments: JSON.stringify(args) },
          ],
        };
      },
    };
    const input = {
      request: f.request,
      profile,
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
  },
);

it("first-review guidance offers preview inspection only when the trusted host provides its tool and receipt reader", async () => {
  const f = await fixture();
  const available = await reviewed(f, tools(f.build()));
  expect(available.result).toMatchObject({
    kind: "observation",
    value: {
      nextAction: expect.stringContaining(
        "request_project_preview({frames,reviewed:true})",
      ),
    },
  });
  expect(JSON.stringify(available.result)).toContain("simple edit");
  const unavailable = await reviewed(
    f,
    tools(f.build(undefined, "local-editor-v10", false)),
  );
  if (unavailable.result.kind !== "observation")
    throw Error("Expected successful review");
  expect(
    (unavailable.result.value as { nextAction: string }).nextAction,
  ).not.toContain("request_project_preview");
  expect(
    (unavailable.result.value as { nextAction: string }).nextAction,
  ).toContain("Call propose_edit");
});

function reviewMessages(
  records: Array<{ args: unknown; result: { kind: string; value?: unknown } }>,
) {
  return records.flatMap(({ args, result }, index) => [
    {
      role: "assistant",
      tool_calls: [
        {
          id: `append-review-${index}`,
          function: { name: "review_edit", arguments: JSON.stringify(args) },
        },
      ],
    },
    {
      role: "tool",
      tool_call_id: `append-review-${index}`,
      content: JSON.stringify(result.value),
    },
  ]);
}

it("appends a targeted repair against the owned full review and restores its expanded receipt without duplicating prepared captions", async () => {
  const f = await fixture({ preparedCaptions: true });
  const invoke = tools(f.build(undefined, "local-editor-v12"));
  const assembly = {
    outcome: "proposal",
    summary: "Editable nested chart",
    commands: [
      {
        type: "insertGraphic",
        itemId: "graphic",
        trackId: "visual",
        name: "Chart",
        node: {
          id: "graphic",
          type: "div",
          from: 0,
          duration: 120,
          style: {
            position: "absolute",
            left: 40,
            top: 40,
            width: 100,
            height: 100,
          },
          children: [
            {
              id: "bar",
              type: "shape",
              shape: { kind: "rect" },
              style: {
                width: 100,
                height: 100,
                fill: "#ff0000",
                backgroundColor: "#ff0000",
              },
            },
          ],
        },
      },
    ],
  };
  const originalArgs = { requirements: f.requirements, edit: assembly };
  const original = {
    args: originalArgs,
    result: await invoke("review_edit", originalArgs),
  };
  expect(original.result).toMatchObject({
    kind: "observation",
    value: { completionPreflight: { status: "passed" } },
  });
  const first = await preview(f, invoke);
  const delta = {
    outcome: "proposal",
    summary: "Repair the inspected graphic",
    commands: [
      {
        type: "set",
        target: { kind: "node", itemId: "graphic", nodeId: "bar" },
        path: ["style", "fill"],
        value: "#0000ff",
      },
      {
        type: "clear",
        target: { kind: "node", itemId: "graphic", nodeId: "bar" },
        path: ["style", "backgroundColor"],
      },
    ],
  };
  const args = {
    edit: delta,
    previewRepair: {
      mode: "append",
      requestId: first.requestId,
      receiptHash: first.receiptHash,
      issues: [{ frame: 0, description: "Wrong fill in the sampled graphic" }],
    },
  };
  const before = JSON.stringify(f.request),
    result = await invoke("review_edit", args);
  expect(result).toMatchObject({
    kind: "observation",
    value: { completionPreflight: { status: "passed" } },
  });
  expect(f.stages.claimPreviewRepair).toHaveBeenCalledTimes(1);
  expect(f.claim()?.basisRef).toEqual(first.candidateRef);
  const expanded = [...f.prepared, ...assembly.commands, ...delta.commands];
  expect(f.claim()?.commandsHash).toBe(await completionHash(expanded));
  const record = f.values.get(f.latest()!.id) as {
    edit: { commands: unknown[] };
  };
  expect(record.edit.commands).toEqual(expanded);
  expect(JSON.stringify(f.request)).toBe(before);
  if (original.result.kind !== "observation" || result.kind !== "observation")
    throw Error("Review observations required");
  const restored = await restoreCompletionStateFromMessages(
    reviewMessages([original, { args, result }]),
    f.request.baseHash,
    {
      reviewReferences: true,
      previewRepair: true,
      appendPreviewRepair: true,
      resolvePreparedEdit: (edit) =>
        f.stages.resolvePreparedEdit(edit, signal()),
    },
  );
  expect(restored?.successfulReceipt?.commandsHash).toBe(
    await completionHash(expanded),
  );
  const resumed = tools(f.build(restored, "local-editor-v12"));
  await expect(resumed("propose_edit", { reviewed: true })).rejects.toThrow(
    /second preview/,
  );
  const second = await preview(f, resumed);
  const proposed = await resumed("propose_edit", {
    reviewed: true,
    previewReport: {
      requestId: second.requestId,
      receiptHash: second.receiptHash,
      issues: [],
    },
  });
  expect(proposed.kind).toBe("terminal");
  if (proposed.kind !== "terminal") throw Error("Native proposal required");
  const commands = proposed.result.proposal!.commands;
  expect(
    commands.filter(
      (command) => command.type === "addItem" && command.item.id === "captions",
    ),
  ).toHaveLength(1);
  expect(JSON.stringify(commands)).toContain("#0000ff");
  expect(f.claim()?.requestId).toBe(first.requestId);
});

it.each(["missing-target", "omitted-mode"] as const)(
  "%s repair failure leaves the claim available for explicit append after checkpoint restoration",
  async (failure) => {
    const f = await fixture(),
      invoke = tools(f.build(undefined, "local-editor-v12"));
    const original = await reviewed(f, invoke),
      first = await preview(f, invoke);
    const inspection = {
      mode: "append",
      requestId: first.requestId,
      receiptHash: first.receiptHash,
      issues: [{ frame: 0, description: "Wrong fill" }],
    };
    const invalid = {
      edit: {
        outcome: "proposal",
        summary: "Invalid target",
        commands: [
          {
            type: "set",
            target: {
              kind: "node",
              itemId: failure === "missing-target" ? "missing" : "graphic",
              nodeId: failure === "missing-target" ? "missing" : "graphic",
            },
            path: ["style", "fill"],
            value: "#0000ff",
          },
        ],
      },
      previewRepair:
        failure === "missing-target"
          ? inspection
          : {
              requestId: inspection.requestId,
              receiptHash: inspection.receiptHash,
              issues: inspection.issues,
            },
    };
    const failed = await invoke("review_edit", invalid);
    expect(failed).toMatchObject({
      kind: "observation",
      value: { completionPreflight: { status: "failed" } },
    });
    expect(f.claim()).toBeUndefined();
    expect(f.stages.claimPreviewRepair).not.toHaveBeenCalled();
    if (original.result.kind !== "observation" || failed.kind !== "observation")
      throw Error("Review observations required");
    const restored = await restoreCompletionStateFromMessages(
      reviewMessages([original, { args: invalid, result: failed }]),
      f.request.baseHash,
      {
        reviewReferences: true,
        previewRepair: true,
        appendPreviewRepair: true,
        resolvePreparedEdit: (edit) =>
          f.stages.resolvePreparedEdit(edit, signal()),
      },
    );
    expect(restored?.successfulReviewRef).toBeUndefined();
    const resumed = tools(f.build(restored, "local-editor-v12"));
    expect(
      await resumed("review_edit", {
        previewRepair: inspection,
        edit: {
          outcome: "proposal",
          summary: "Valid repair",
          commands: [
            {
              type: "set",
              target: { kind: "node", itemId: "graphic", nodeId: "graphic" },
              path: ["style", "fill"],
              value: "#0000ff",
            },
          ],
        },
      }),
    ).toMatchObject({
      kind: "observation",
      value: { completionPreflight: { status: "passed" } },
    });
    expect(f.stages.claimPreviewRepair).toHaveBeenCalledTimes(1);
    expect(f.claim()?.basisRef).toEqual(first.candidateRef);
  },
);

it.each(["empty", "unknown-mode", "locked-source", "foreign-basis"] as const)(
  "rejects invalid append %s before claiming a correction",
  async (mode) => {
    const f = await fixture({ preparedCaptions: true, lockedAudio: true });
    const invoke = tools(f.build(undefined, "local-editor-v12"));
    await reviewed(f, invoke);
    const first = await preview(f, invoke);
    let commands: unknown[] = [
      {
        type: "set",
        target: { kind: "node", itemId: "graphic", nodeId: "graphic" },
        path: ["style", "fill"],
        value: "#0000ff",
      },
    ];
    if (mode === "empty") commands = [];
    if (mode === "locked-source")
      commands = [
        {
          type: "set",
          target: { kind: "node", itemId: "voice", nodeId: "voice" },
          path: ["volume"],
          value: 0,
        },
      ];
    if (mode === "foreign-basis")
      f.evidence.set(first.requestId, {
        ...first,
        candidateRef: { ...first.candidateRef, runId: "foreign" },
      });
    expect(
      await invoke("review_edit", {
        edit: {
          outcome: "proposal",
          summary: "Invalid correction control",
          commands,
        },
        previewRepair: {
          mode: mode === "unknown-mode" ? "merge" : "append",
          requestId: first.requestId,
          receiptHash: first.receiptHash,
          issues: [{ frame: 0, description: "Observed synthetic failure" }],
        },
      }),
    ).toMatchObject({
      kind: "observation",
      value: { completionPreflight: { status: "failed" } },
    });
    expect(f.stages.claimPreviewRepair).not.toHaveBeenCalled();
    expect(f.claim()).toBeUndefined();
  },
);
