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
