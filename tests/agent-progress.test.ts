import { expect, it } from "vitest";
import { createVideoProjectDocument } from "../packages/core/src/lib/video-project/document";
import { nativeAgentProgress } from "../packages/core/src/lib/video-project/agent-progress";
import { transcriptEvidenceFromAsr } from "../packages/core/src/lib/video-project/semantic";

function fixture() {
  const doc = createVideoProjectDocument({
    width: 640,
    height: 360,
    fps: 30,
    durationInFrames: 300,
  });
  doc.assets.a = {
    id: "a",
    name: "Duplicate.mp4",
    type: "video",
    source: "local",
    durationSeconds: 10,
  };
  doc.assets.b = {
    id: "b",
    name: "Duplicate.mp4",
    type: "video",
    source: "project",
    assetId: "owned-b",
    durationSeconds: 10,
  };
  doc.sources.a = { assetId: "a", revision: "original-a" };
  doc.sources.b = { assetId: "b", revision: "original-b" };
  doc.items.push(
    {
      id: "first",
      name: "Captured first",
      trackId: "visual",
      node: {
        id: "first",
        type: "video",
        assetId: "a",
        from: 0,
        duration: 120,
      },
    },
    {
      id: "second",
      name: "Captured second",
      trackId: "visual",
      node: {
        id: "second",
        type: "video",
        assetId: "b",
        from: 120,
        duration: 180,
      },
    },
  );
  return {
    status: "queued",
    phase: "created",
    baseDocumentJson: doc,
    contextJson: { selectedItemIds: [], playheadFrame: 0 },
    requestJson: {} as Record<string, any>,
    resultJson: {} as Record<string, any>,
    asrTasksJson: [] as Array<Record<string, any>>,
  };
}
it("captures stable source IDs/names/windows while distinguishing browser media from missing bytes", () => {
  const run = fixture(),
    result = nativeAgentProgress(run)!;
  expect(
    result.sources.map((row) => [
      row.itemId,
      row.assetId,
      row.name,
      row.fromFrame,
      row.durationInFrames,
      row.media,
    ]),
  ).toEqual([
    ["first", "a", "Captured first", 0, 120, "browser_required"],
    ["second", "b", "Captured second", 120, 180, "cloud_available"],
  ]);
  expect(result.coverage).toBe("undeclared");
  expect(result.deliverables).toEqual([]);
  expect(result.execution.state).toBe("preparing");
  expect(result.application.state).toBe("pending");
});
it("keeps explicit empty selection distinct from project and limits range to owned whole clips", () => {
  const run = fixture();
  run.requestJson.authoring = { scope: { kind: "selection", itemIds: [] } };
  // Invalid explicit scopes cannot silently become project-wide summaries.
  expect(nativeAgentProgress(run)).toBeUndefined();
  run.requestJson.authoring.scope = {
    kind: "range",
    fromFrame: 120,
    durationInFrames: 180,
  };
  expect(nativeAgentProgress(run)!.sources.map((row) => row.itemId)).toEqual([
    "second",
  ]);
  run.requestJson.authoring.scope = { kind: "selection", itemIds: ["first"] };
  expect(nativeAgentProgress(run)!.sources.map((row) => row.itemId)).toEqual([
    "first",
  ]);
});
it("reports per-source completion and failure without inferring success from a completed ASR HTTP response", () => {
  const run = fixture();
  run.status = "needs_evidence";
  run.phase = "waiting_for_transcript";
  run.requestJson.prerequisites = {
    kind: "transcript",
    assetIds: ["a", "b"],
    status: "running",
  };
  run.asrTasksJson = [
    { sourceId: "a", taskId: "asr-a" },
    { sourceId: "b", taskId: "asr-b" },
  ];
  run.requestJson.evidenceProgress = [
    { sourceId: "a", status: "ready" },
    { sourceId: "b", status: "failed" },
  ];
  const result = nativeAgentProgress(run)!;
  expect(result.sources.map((row) => row.evidence)).toEqual([
    "ready",
    "failed",
  ]);
  expect(result.execution.state).toBe("transcribing");
  expect(result.sources[1].taskId).toBe("asr-b");
  expect(result.recovery.canResume).toBe(true);
  expect(result.coverage).toBe("undeclared");
});
it("reports waiting for local bytes or exact consent separately", () => {
  const run = fixture();
  run.status = "needs_evidence";
  run.phase = "awaiting_consent";
  run.requestJson.prerequisites = {
    kind: "transcript",
    assetIds: ["a"],
    status: "consent_required",
  };
  expect(nativeAgentProgress(run)!.execution.state).toBe("waiting_for_media");
  run.requestJson.prerequisites.assetIds = ["b"];
  expect(nativeAgentProgress(run)!.execution.state).toBe("waiting_for_consent");
});
it("retains partial timing for the original window and recognizes a genuine cropped complete window", async () => {
  const run = fixture(),
    doc = run.baseDocumentJson;
  const evidence = await transcriptEvidenceFromAsr(doc, "a", {
    text: "So hello",
    utterances: [
      {
        text: "So hello",
        words: [
          { text: "So", start_time_ms: 0, end_time_ms: 0 },
          { text: "hello", start_time_ms: 100, end_time_ms: 700 },
        ],
      },
    ],
  });
  doc.evidence[evidence.id] = evidence;
  expect(nativeAgentProgress(run)!.sources[0].evidence).toBe("partial");
  delete doc.evidence[evidence.id];
  run.requestJson.evidenceCommands = [{ type: "addEvidence", evidence }];
  expect(nativeAgentProgress(run)!.sources[0].evidence).toBe("partial");
  doc.items[0].node.videoStartTime = 1;
  expect(nativeAgentProgress(run)!.sources[0].evidence).toBe("ready");
});
it("uses saved host verification rather than narrative text to describe checked deliverables", () => {
  const run = fixture();
  run.status = "ready";
  run.resultJson.proposal = { summary: "Everything is done" };
  expect(nativeAgentProgress(run)!.coverage).toBe("undeclared");
  run.resultJson.completion = {
    requirements: [{ id: "caption", kind: "item_present", itemId: "first" }],
  };
  expect(nativeAgentProgress(run)!.coverage).toBe("declared");
  run.resultJson.verification = {
    status: "passed",
    outcomes: [
      { id: "caption", passed: true, message: "Original captions present" },
    ],
  };
  const result = nativeAgentProgress(run)!;
  expect(result.coverage).toBe("verified");
  expect(result.deliverables[0]).toMatchObject({
    itemId: "first",
    frame: 0,
    status: "passed",
  });
  expect(result.application.state).toBe("ready");
});
it.each(["cancelled", "applied", "stale", "needs_input", "completed"])(
  "keeps execution and application distinctions for %s",
  (status) => {
    const run = fixture();
    run.status = status;
    const result = nativeAgentProgress(run, true)!;
    expect(result.execution.state).toBe(
      status === "stale"
        ? "failed"
        : status === "applied"
          ? "completed"
          : status,
    );
    expect(result.recovery.canResume).toBe(false);
    expect(result.recovery.canCancel).toBe(status === "needs_input");
    if (status === "applied") expect(result.application.state).toBe("applied");
    if (status === "stale") {
      expect(result.application.state).toBe("stale");
      expect(result.recovery.canReuseSavedResult).toBe(true);
    }
  },
);
it("does not turn malformed archived metadata into fabricated progress", () => {
  expect(
    nativeAgentProgress({ ...fixture(), baseDocumentJson: null }),
  ).toBeUndefined();
});

it("captures nested source use, deduplicates a reused asset and respects a pinned child", () => {
  const run = fixture();
  run.baseDocumentJson.items.push({
    id: "group",
    name: "Selected group",
    trackId: "visual",
    node: {
      id: "group",
      type: "div",
      from: 30,
      duration: 120,
      children: [
        { id: "nested-a", type: "video", assetId: "a", from: 10, duration: 30 },
        {
          id: "nested-a-again",
          type: "video",
          assetId: "a",
          from: 50,
          duration: 20,
        },
        { id: "nested-b", type: "video", assetId: "b", from: 75, duration: 30 },
      ],
    },
  });
  run.requestJson.authoring = {
    scope: { kind: "selection", itemIds: ["group"] },
  };
  expect(
    nativeAgentProgress(run)!.sources.map((row) => [
      row.itemId,
      row.assetId,
      row.fromFrame,
      row.durationInFrames,
    ]),
  ).toEqual([
    ["group", "a", 40, 60],
    ["group", "b", 105, 30],
  ]);
  run.requestJson.authoring.scope.node = {
    itemId: "group",
    nodeId: "nested-b",
  };
  expect(nativeAgentProgress(run)!.sources.map((row) => row.assetId)).toEqual([
    "b",
  ]);
});

it("keeps legal colon-containing item/asset identity tuples distinct", () => {
  const run = fixture(),
    doc = run.baseDocumentJson;
  for (const id of ["c", "b:c"]) {
    doc.assets[id] = {
      id,
      name: "Duplicate.png",
      type: "image",
      source: "local",
    };
    doc.sources[id] = { assetId: id, revision: "original" };
  }
  doc.items.push(
    {
      id: "a:b",
      name: "First tuple",
      trackId: "visual",
      node: { id: "a:b", type: "img", assetId: "c", from: 0, duration: 30 },
    },
    {
      id: "a",
      name: "Second tuple",
      trackId: "visual",
      node: { id: "a", type: "img", assetId: "b:c", from: 30, duration: 30 },
    },
  );
  run.requestJson.authoring = {
    scope: { kind: "selection", itemIds: ["a:b", "a"] },
  };
  expect(
    nativeAgentProgress(run)!.sources.map((row) => [row.itemId, row.assetId]),
  ).toEqual([
    ["a:b", "c"],
    ["a", "b:c"],
  ]);
});
