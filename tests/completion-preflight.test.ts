import { expect, it } from "vitest";
import {
  createVideoProjectDocument,
  hashVideoProjectDocument,
  parseVideoProjectDocument,
} from "../packages/core/src/lib/video-project/document";
import { executeVideoProjectCommands } from "../packages/core/src/lib/video-project/commands";
import { prepareCaptionPair } from "../packages/core/src/lib/video-project/caption-pair";
import { captionSourceCommands } from "../packages/core/src/lib/video-project/semantic";
import {
  reviewNativeCompletionEdit,
  compileNativeCompletionResponse,
  checkNativeCompletionRequirements,
} from "../packages/core/src/lib/video-project/completion-preflight";
import { normalizeCompletionNumber } from "../packages/core/src/lib/video-project/completion-number";
import { prepareNativeAgentReview } from "../packages/core/src/lib/video-project/agent-review";
import { buildVideoProjectRevertCommands } from "../packages/core/src/lib/video-project/revert";
import type { CompletionRequirement } from "../packages/agent-kit/src/index";
async function fixture(fps = 30) {
  const doc = createVideoProjectDocument({
    width: 640,
    height: 360,
    fps,
    durationInFrames: fps * 10,
  });
  doc.assets.audio = {
    id: "audio",
    name: "Speech",
    type: "audio",
    source: "local",
    durationSeconds: 10,
  };
  doc.sources.audio = { assetId: "audio", revision: "rev" };
  doc.items.push({
    id: "speech",
    name: "Speech",
    trackId: "audio",
    node: {
      id: "speech",
      type: "audio",
      assetId: "audio",
      from: 0,
      duration: fps * 10,
    },
  });
  doc.evidence.asr = {
    id: "asr",
    sourceAssetId: "audio",
    sourceRevision: "rev",
    transcriptHash: "hash",
    language: "eng",
    text: "Three point three percent. Three point one percent. Two thousand twenty-three.",
    words: [
      ...["Three", "point", "three", "percent."].map((text, index) => ({
        id: `a${index}`,
        text,
        startMs: 1000 + index * 100,
        endMs: 1100 + index * 100,
      })),
      ...["Three", "point", "one", "percent."].map((text, index) => ({
        id: `b${index}`,
        text,
        startMs: 4000 + index * 100,
        endMs: 4100 + index * 100,
      })),
      ...["Two", "thousand", "twenty-three."].map((text, index) => ({
        id: `y${index}`,
        text,
        startMs: 7000 + index * 100,
        endMs: 7100 + index * 100,
      })),
    ],
  };
  const document = parseVideoProjectDocument(doc);
  const request = {
    contract: "video-project-commands" as const,
    version: 1 as const,
    baseRevision: 1,
    baseHash: await hashVideoProjectDocument(document),
    document,
    context: { selectedItemIds: [], playheadFrame: 0 },
    authoring: { version: 1 as const, scope: { kind: "project" as const } },
  };
  const caption = captionSourceCommands(document, {
    sourceItemId: "speech",
    evidenceId: "asr",
    itemId: "en",
    trackId: "visual",
  }).find((command) => command.type === "addItem");
  if (caption?.type !== "addItem") throw new Error("fixture");
  const prepared = prepareCaptionPair(document, {
    sourceItemId: "speech",
    evidenceId: "asr",
    originalItemId: "en",
    translatedItemId: "zh",
    trackId: "visual",
    originalLanguage: "en",
    translatedLanguage: "zh",
    originalColor: "#ff0000",
    translatedColor: "#ffffff",
    translations: caption.item.caption!.cues.map((cue) => ({
      cueId: cue.id,
      text: "这是完整的中文翻译。",
    })),
  });
  const graphic = (
    itemId: string,
    value: string,
    from: number,
    duration: number,
    top: number,
  ) => ({
    type: "insertGraphic",
    itemId,
    trackId: "visual",
    name: itemId,
    node: {
      id: itemId,
      type: "text",
      text: value,
      from,
      duration,
      style: {
        position: "absolute",
        left: 40,
        top,
        width: 500,
        height: 60,
        fontSize: 32,
        color: "#ffff00",
      },
      animations: [{ preset: "popIn" }],
    },
  });
  const requirements: CompletionRequirement[] = [
    {
      id: "pair",
      kind: "caption_pair",
      sourceItemId: "speech",
      evidenceId: "asr",
      originalItemId: "en",
      translatedItemId: "zh",
      originalLanguage: "en",
      translatedLanguage: "zh",
      originalColor: "#ff0000",
      translatedColor: "#ffffff",
    },
    {
      id: "number",
      kind: "speech_highlight",
      itemId: "number",
      bindingId: "number-anchor",
      sourceItemId: "speech",
      evidenceId: "asr",
      wordIds: ["a0", "a1", "a2", "a3"],
      exactText: "3.3%",
      minReadableMs: 1000,
    },
    {
      id: "ending",
      kind: "appended_ending",
      itemId: "ending",
      exactText: "Made by DojoClip.com",
      minDurationMs: 1000,
      animated: true,
    },
  ];
  const edit = {
    summary: "Complete edit",
    commands: [
      ...prepared.commands,
      graphic("number", "3.3%", 0, fps, 50),
      {
        type: "anchorSpeech",
        id: "number-anchor",
        itemId: "number",
        sourceItemId: "speech",
        evidenceId: "asr",
        wordIds: ["a0", "a1", "a2", "a3"],
        holdMs: 1200,
      },
      {
        type: "set",
        target: { kind: "format" },
        path: ["durationInFrames"],
        value: fps * 13,
      },
      graphic("ending", "Made by DojoClip.com", fps * 10, fps * 3, 100),
    ],
  };
  return { document, request, requirements, edit, prepared };
}
it("preflights helper-built bilingual captions, genuine held number and appended ending through actual native compilation", async () => {
  const f = await fixture();
  const checked = await reviewNativeCompletionEdit(f.request, {
    requirements: f.requirements,
    edit: f.edit,
  });
  expect(checked.checks).toEqual(
    expect.arrayContaining([
      { id: "pair", passed: true, message: expect.any(String) },
    ]),
  );
  expect(checked.checks.filter((check) => !check.passed)).toEqual([]);
  expect(checked.receipt).toBeDefined();
  const result = await compileNativeCompletionResponse(f.request, {
    ...f.edit,
    completion: { requirements: f.requirements, receipt: checked.receipt },
  });
  expect(result.completion!.receipt).toEqual(checked.receipt);
  const comparison = await prepareNativeAgentReview({
    runId: "review",
    baseDocument: f.document,
    baseHash: f.request.baseHash,
    proposal: result.proposal!,
    current: {
      projectId: "project",
      document: f.document,
      revision: 1,
      documentHash: f.request.baseHash,
      sources: [],
      history: { canUndo: false, canRedo: false },
    },
  });
  expect(comparison.review.basis.afterHash).toBe(checked.receipt!.previewHash);
  expect(comparison.review.commands).toEqual(result.proposal!.commands);
});
it("rejects incomplete cue coverage, wrong color, omitted outcomes, unreadably short hold and later blank padding", async () => {
  const f = await fixture();
  const checked = await reviewNativeCompletionEdit(f.request, {
    requirements: f.requirements,
    edit: f.edit,
  });
  const after = executeVideoProjectCommands(
    f.document,
    checked.result.proposal!.commands,
  ).document;
  for (const mutate of [
    (d: typeof after) => {
      d.items.find((item) => item.id === "zh")!.caption!.cues.pop();
    },
    (d: typeof after) => {
      d.items.find((item) => item.id === "en")!.node.style!.color = "#ffffff";
    },
    (d: typeof after) => {
      d.items = d.items.filter((item) => item.id !== "ending");
    },
    (d: typeof after) => {
      d.items.find((item) => item.id === "number")!.node.duration = 5;
    },
    (d: typeof after) => {
      d.format.durationInFrames += 30;
    },
  ]) {
    const broken = structuredClone(after);
    mutate(broken);
    expect(
      checkNativeCompletionRequirements(
        f.document,
        broken,
        f.requirements,
      ).some((check) => !check.passed),
    ).toBe(true);
  }
});
it.each([24, 30, 60])(
  "keeps word start and readable hold through FPS, trim, split and Undo at%ifps",
  async (fps) => {
    const f = await fixture(fps);
    const checked = await reviewNativeCompletionEdit(f.request, {
      requirements: f.requirements,
      edit: f.edit,
    });
    const after = executeVideoProjectCommands(
      f.document,
      checked.result.proposal!.commands,
    ).document;
    const highlight = after.items.find((item) => item.id === "number")!;
    expect(highlight.node.from).toBe(fps);
    expect(highlight.node.duration).toBe(Math.ceil(1.2 * fps));
    expect(after.bindings["number-anchor"]).toMatchObject({
      sourceStartMs: 1000,
      sourceEndMs: 1400,
      holdMs: 1200,
    });
    const trimmed = executeVideoProjectCommands(after, [
      { type: "trimItem", id: "speech", from: fps / 2, duration: fps * 9 },
    ]).document;
    expect(trimmed.items.find((item) => item.id === "number")!.node.from).toBe(
      fps,
    );
    const split = executeVideoProjectCommands(after, [
      { type: "splitItem", id: "speech", frame: fps * 2, newId: "tail" },
    ]).document;
    expect(
      split.items.find((item) => item.id === "number")!.node.duration,
    ).toBe(fps);
    expect(
      executeVideoProjectCommands(
        split,
        buildVideoProjectRevertCommands(after, split),
      ).document,
    ).toEqual(after);
    const faster = executeVideoProjectCommands(after, [
      {
        type: "set",
        target: { kind: "format" },
        path: ["fps"],
        value: fps * 2,
      },
    ]).document;
    expect(
      faster.items.find((item) => item.id === "number")!.node.duration,
    ).toBe(Math.ceil(1.2 * fps * 2));
  },
);
it("leaves legacy anchor duration unchanged without holdMs", async () => {
  const f = await fixture();
  const edit = structuredClone(f.edit);
  delete (
    edit.commands.find((command) => command.type === "anchorSpeech") as {
      holdMs?: number;
    }
  ).holdMs;
  const result = await reviewNativeCompletionEdit(f.request, {
    requirements: f.requirements,
    edit,
  });
  expect(result.checks.find((check) => check.id === "number")!.passed).toBe(
    false,
  );
  const after = executeVideoProjectCommands(
    f.document,
    result.result.proposal!.commands,
  ).document;
  expect(after.items.find((item) => item.id === "number")!.node.duration).toBe(
    12,
  );
});
it("recognizes genuine spoken decimals/percent and rejects the year or wrong value", () => {
  expect(normalizeCompletionNumber("three point three percent.")).toBe("3.3%");
  expect(normalizeCompletionNumber("three point one percent")).toBe("3.1%");
  expect(normalizeCompletionNumber("two thousand twenty-three.")).toBe("2023");
  expect(normalizeCompletionNumber("3.3%")).toBe("3.3%");
  expect(() =>
    normalizeCompletionNumber("a growth rate around something"),
  ).toThrow();
});

it.each([
  ["b0", "b1", "b2", "b3"],
  ["y0", "y1", "y2"],
])(
  "rejects a genuine but wrong spoken range as the 3.3 percent label: %j",
  async (...wordIds) => {
    const f = await fixture();
    const requirements = structuredClone(
      f.requirements.filter(
        (requirement) => requirement.kind === "speech_highlight",
      ),
    );
    const requirement = requirements[0]!;
    if (requirement.kind !== "speech_highlight") throw new Error("fixture");
    requirement.wordIds = wordIds;
    const edit = structuredClone(f.edit);
    const anchor = edit.commands.find(
      (command) => command.type === "anchorSpeech",
    )!;
    if (!("wordIds" in anchor)) throw new Error("fixture");
    anchor.wordIds = wordIds;
    const reviewed = await reviewNativeCompletionEdit(f.request, {
      requirements,
      edit,
    });
    expect(reviewed.receipt).toBeUndefined();
    expect(
      reviewed.checks.find((check) => check.id === "number")!.message,
    ).toMatch(/numbers do not match/);
  },
);
it("requires actual property absence and accepts ordinary clarification/answer without a receipt", async () => {
  const f = await fixture();
  const before = structuredClone(f.document);
  before.items.push({
    id: "label",
    name: "Label",
    trackId: "visual",
    node: {
      id: "label",
      type: "text",
      text: "Label",
      from: 0,
      duration: 30,
      style: { backgroundColor: "red", width: 300, height: 60 },
    },
  });
  const after = executeVideoProjectCommands(before, [
    {
      type: "clear",
      target: { kind: "node", itemId: "label", nodeId: "label" },
      path: ["style", "backgroundColor"],
    },
  ]).document;
  const req: CompletionRequirement[] = [
    {
      id: "clear",
      kind: "property_absent",
      target: { kind: "node", itemId: "label", nodeId: "label" },
      path: ["style", "backgroundColor"],
    },
  ];
  expect(
    checkNativeCompletionRequirements(before, after, req).every(
      (check) => check.passed,
    ),
  ).toBe(true);
  expect(
    checkNativeCompletionRequirements(before, before, req).some(
      (check) => !check.passed,
    ),
  ).toBe(true);
  expect(
    (
      await compileNativeCompletionResponse(f.request, {
        outcome: "answer",
        summary: "A factual answer",
        commands: [],
      })
    ).outcome,
  ).toBe("answer");
  expect(
    (
      await compileNativeCompletionResponse(f.request, {
        outcome: "needs_input",
        summary: "Which style?",
        commands: [],
        clarification: {
          id: "style",
          question: "Which style?",
          allowText: true,
        },
      })
    ).outcome,
  ).toBe("needs_input");
  await expect(
    compileNativeCompletionResponse(f.request, f.edit),
  ).rejects.toThrow(/reviewed/);
});

it("rejects tiny/fitted/scaled required fonts and cumulatively transparent required text", async () => {
  const f = await fixture();
  const requirement = f.requirements.filter(
    (requirement) => requirement.kind === "appended_ending",
  );
  const source = f.edit.commands.find(
    (command) =>
      command.type === "insertGraphic" && command.itemId === "ending",
  )!;
  if (!("node" in source)) throw new Error("fixture");
  const scenarios = [
    { ...source.node, style: { ...source.node.style, fontSize: 1 } },
    {
      ...source.node,
      style: {
        ...source.node.style,
        width: 5,
        textFit: "shrink",
        minFontSize: 1,
      },
    },
    {
      id: "ending",
      type: "div",
      from: 300,
      duration: 90,
      style: { width: 560, height: 64, transform: "scale(0.01)" },
      animations: [{ preset: "fadeIn" }],
      children: [
        {
          id: "brand",
          type: "text",
          text: "Made by DojoClip.com",
          style: { width: 560, height: 64, fontSize: 32, color: "white" },
        },
      ],
    },
    {
      id: "ending",
      type: "div",
      from: 300,
      duration: 90,
      style: { width: 560, height: 64, opacity: 0.2 },
      children: [
        {
          id: "inner",
          type: "div",
          style: { width: 560, height: 64, opacity: 0.2 },
          children: [
            {
              id: "brand",
              type: "text",
              text: "Made by DojoClip.com",
              style: { width: 560, height: 64, fontSize: 32, color: "white" },
              animations: [{ preset: "popIn" }],
            },
          ],
        },
      ],
    },
    { ...source.node, style: { ...source.node.style, color: "transparent" } },
    {
      ...source.node,
      style: { ...source.node.style, color: "rgba(255,255,255,0)" },
    },
  ];
  for (const node of scenarios) {
    const reviewed = await reviewNativeCompletionEdit(f.request, {
      requirements: requirement,
      edit: {
        summary: "Ending",
        commands: [
          {
            type: "set",
            target: { kind: "format" },
            path: ["durationInFrames"],
            value: 390,
          },
          { ...source, node },
        ],
      },
    });
    expect(reviewed.receipt).toBeUndefined();
    expect(reviewed.checks.find((check) => check.id === "layout")!.passed).toBe(
      false,
    );
  }
});

it("checks eight exact media placements through a compact asset_sequence requirement", async () => {
  const document = createVideoProjectDocument({
    width: 640,
    height: 360,
    fps: 30,
    durationInFrames: 300,
  });
  for (let index = 0; index < 8; index++) {
    const id = `asset-${index}`;
    document.assets[id] = {
      id,
      name: `Media ${index}`,
      source: "local",
      type: index < 3 ? "video" : "image",
      ...(index < 3 ? { durationSeconds: 10 } : {}),
    };
    document.items.push({
      id: `item-${index}`,
      name: "Media",
      trackId: "visual",
      node: {
        id: `item-${index}`,
        type: index < 3 ? "video" : "img",
        assetId: id,
        from: index * 30,
        duration: 30,
        ...(index < 3 ? { videoStartTime: index } : {}),
      },
    });
  }
  const requirements = [
    {
      id: "placements",
      kind: "asset_sequence",
      items: document.items.map((item, index) => ({
        itemId: item.id,
        assetId: item.node.assetId!,
        from: index * 30,
        duration: 30,
        ...(index < 3 ? { sourceStartSeconds: index } : {}),
      })),
    },
  ];
  expect(
    checkNativeCompletionRequirements(document, document, requirements).every(
      (check) => check.passed,
    ),
  ).toBe(true);
  for (const change of ["missing", "asset", "time", "source"] as const) {
    const after = structuredClone(document);
    if (change === "missing") after.items.pop();
    if (change === "asset") after.items[0]!.node.assetId = "asset-1";
    if (change === "time") after.items[0]!.node.from = 1;
    if (change === "source") after.items[0]!.node.videoStartTime = 0.5;
    expect(
      checkNativeCompletionRequirements(document, after, requirements).find(
        (check) => check.id === "placements",
      )!.passed,
    ).toBe(false);
  }
});
it("grounds quoted phrase callouts while retaining numeric highlight validation", async () => {
  const f = await fixture();
  const doc = structuredClone(f.document);
  const words = ["year", "over", "year"];
  doc.evidence.asr!.words = words.map((text, index) => ({
    id: `quote-${index}`,
    text,
    startMs: 1000 + index * 200,
    endMs: 1200 + index * 200,
  }));
  doc.evidence.asr!.text = "year over year";
  const request = {
    ...f.request,
    document: doc,
    baseHash: await hashVideoProjectDocument(doc),
  };
  const edit = {
    summary: "Quote",
    commands: [
      {
        type: "insertGraphic",
        itemId: "quote",
        trackId: "visual",
        name: "Quote",
        node: {
          type: "text",
          text: "Year-over-year",
          from: 30,
          duration: 36,
          style: {
            position: "absolute",
            left: 40,
            top: 40,
            width: 560,
            height: 60,
            fontSize: 32,
            color: "#ffffff",
          },
        },
      },
      {
        type: "anchorSpeech",
        id: "quote-binding",
        itemId: "quote",
        sourceItemId: "speech",
        evidenceId: "asr",
        wordIds: ["quote-0", "quote-1", "quote-2"],
        holdMs: 1200,
      },
    ],
  };
  const requirement = {
    id: "quote",
    kind: "speech_callout",
    itemId: "quote",
    bindingId: "quote-binding",
    sourceItemId: "speech",
    evidenceId: "asr",
    wordIds: ["quote-0", "quote-1", "quote-2"],
    exactText: "Year-over-year",
    minReadableMs: 1200,
  };
  const checked = await reviewNativeCompletionEdit(request, {
    requirements: [requirement],
    edit,
  });
  expect(checked.checks.filter((check) => !check.passed)).toEqual([]);
  const replay = await compileNativeCompletionResponse(request, {
    ...edit,
    completion: { requirements: [requirement], receipt: checked.receipt },
  });
  expect(replay.completion!.requirements).toEqual([requirement]);
  const after = executeVideoProjectCommands(
    doc,
    replay.proposal!.commands,
  ).document;
  expect(
    checkNativeCompletionRequirements(doc, after, [
      { ...requirement, kind: "speech_highlight" },
    ]).find((check) => check.id === "quote")!.passed,
  ).toBe(false);
  const changed = structuredClone(after);
  changed.items.find((item) => item.id === "quote")!.node.text =
    "year over year growth";
  expect(
    checkNativeCompletionRequirements(doc, changed, [
      { ...requirement, exactText: "year over year growth" },
    ]).find((check) => check.id === "quote")!.passed,
  ).toBe(false);
});

it("appends after all retained edited content for an exact asset_sequence while preserving the legacy ending basis", async () => {
  const document = createVideoProjectDocument({
    width: 640,
    height: 360,
    fps: 30,
    durationInFrames: 360,
  });
  document.assets.video = {
    id: "video",
    name: "Interview",
    type: "video",
    source: "local",
    durationSeconds: 12,
  };
  document.items.push({
    id: "clip",
    name: "Interview",
    trackId: "visual",
    node: {
      id: "clip",
      type: "video",
      assetId: "video",
      from: 0,
      duration: 360,
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
  const edit = {
    summary: "Short montage and ending",
    commands: [
      { type: "trimItem", id: "clip", from: 0, duration: 240 },
      {
        type: "set",
        target: { kind: "node", itemId: "clip", nodeId: "clip" },
        path: ["videoStartTime"],
        value: 2,
      },
      {
        type: "set",
        target: { kind: "format" },
        path: ["durationInFrames"],
        value: 330,
      },
      {
        type: "insertGraphic",
        itemId: "ending",
        trackId: "visual",
        name: "Ending",
        node: {
          type: "text",
          text: "Made by DojoClip.com",
          from: 240,
          duration: 90,
          style: {
            position: "absolute",
            left: 40,
            top: 100,
            width: 560,
            height: 60,
            fontSize: 32,
            color: "#ffffff",
          },
          animations: [
            {
              kind: "keyframes",
              property: "opacity",
              frames: [
                { frame: 0, value: 0 },
                { frame: 6, value: 1 },
              ],
            },
          ],
        },
      },
    ],
  };
  const ending = {
    id: "ending",
    kind: "appended_ending",
    itemId: "ending",
    exactText: "Made by DojoClip.com",
    minDurationMs: 2000,
    animated: true,
  };
  const sequence = {
    id: "body",
    kind: "asset_sequence",
    items: [
      {
        itemId: "clip",
        assetId: "video",
        from: 0,
        duration: 240,
        sourceStartSeconds: 2,
      },
    ],
  };
  const checked = await reviewNativeCompletionEdit(request, {
    requirements: [sequence, ending],
    edit,
  });
  expect(checked.checks.filter((check) => !check.passed)).toEqual([]);
  expect(checked.receipt).toBeDefined();
  expect(
    (
      await reviewNativeCompletionEdit(request, {
        requirements: [ending],
        edit,
      })
    ).checks.some((check) => !check.passed),
  ).toBe(true);
  const after = executeVideoProjectCommands(
    document,
    checked.result.proposal!.commands,
  ).document;
  after.items.push({
    id: "retained",
    name: "Retained audio",
    trackId: "visual",
    node: { id: "retained", type: "div", from: 300, duration: 30 },
  });
  expect(
    checkNativeCompletionRequirements(document, after, [sequence, ending]).find(
      (check) => check.id === "ending",
    )!.passed,
  ).toBe(false);
});
