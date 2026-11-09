import { expect, it } from "vitest";
import {
  createVideoProjectDocument,
  hashVideoProjectDocument,
} from "../packages/core/src/lib/video-project/document";
import { prepareCaptionSourceRange } from "../packages/core/src/lib/video-project/caption-source-range";
import { readNativeCaptionCues } from "../packages/core/src/lib/video-project/agent-readers";
import { prepareCaptionPair } from "../packages/core/src/lib/video-project/caption-pair";
import { executeVideoProjectCommands } from "../packages/core/src/lib/video-project/commands";
import { checkNativeCompletionRequirements } from "../packages/core/src/lib/video-project/completion-preflight";
import type { NativeAgentRequest } from "../packages/core/src/lib/video-project/agent-runtime";
async function fixture(fps = 30, rate = 1) {
  const document = createVideoProjectDocument({
    width: 640,
    height: 360,
    fps,
    durationInFrames: fps * 26,
  });
  document.assets.audio = {
    id: "audio",
    name: "Speech",
    type: "video",
    source: "local",
    durationSeconds: 24,
  };
  document.sources.audio = { assetId: "audio", revision: "original" };
  document.items.push({
    id: "speech",
    name: "Speech",
    trackId: "audio",
    node: {
      id: "speech",
      type: "video",
      assetId: "audio",
      from: fps * 2,
      duration: (fps * 24) / rate,
      playbackRate: rate,
    },
  });
  const words = Array.from({ length: 6 }, (_, index) => ({
    id: `word-${index}`,
    text: `Sentence${index}.`,
    startMs: index * 4000,
    endMs: index * 4000 + 3000,
  }));
  document.evidence.asr = {
    id: "asr",
    sourceAssetId: "audio",
    sourceRevision: "original",
    language: "en",
    transcriptHash: "hash",
    text: words.map((word) => word.text).join(" "),
    words,
  };
  const request: NativeAgentRequest = {
    contract: "video-project-commands",
    version: 1,
    baseRevision: 1,
    baseHash: await hashVideoProjectDocument(document),
    document,
    context: { selectedItemIds: ["speech"], playheadFrame: 0 },
    authoring: { version: 1, scope: { kind: "project" } },
  };
  return { document, request };
}
it.each([24, 30, 60])(
  "returns identical narrowed cue data and paired captions at %sfps without mutating evidence",
  async (fps) => {
    const { document, request } = await fixture(fps),
      before = structuredClone(document),
      range = { startMs: 4000, endMs: 12000 };
    const page = await readNativeCaptionCues(request, {
      snapshotHash: request.baseHash,
      sourceItemId: "speech",
      evidenceId: "asr",
      sourceRange: range,
    });
    expect(page.cues.map((cue) => cue.wordIds)).toEqual([
      ["word-1"],
      ["word-2"],
    ]);
    expect(page.source).toMatchObject({
      from: fps * 2,
      duration: fps * 8,
      sourceRange: { ...range, effectiveEndMs: 12000 },
    });
    const input = {
      sourceItemId: "speech",
      evidenceId: "asr",
      originalItemId: "en",
      translatedItemId: "zh",
      trackId: "visual",
      originalLanguage: "en",
      translatedLanguage: "zh",
      originalColor: "#ff0000",
      translatedColor: "#ffffff",
      sourceRange: range,
      translations: page.cues.map((cue, i) => ({
        cueId: cue.cueId,
        text: `中文${i}`,
      })),
    };
    expect(() => prepareCaptionPair(document, input)).toThrow();
    const prepared = prepareCaptionPair(document, input, { sourceRange: true });
    expect(prepared.cues).toEqual(page.cues.map(({ wordIds, ...cue }) => cue));
    const after = executeVideoProjectCommands(
      document,
      prepared.commands,
    ).document;
    expect(
      after.items.find((item) => item.id === "speech")!.node,
    ).toMatchObject({ videoStartTime: 4, from: fps * 2, duration: fps * 8 });
    const checks = checkNativeCompletionRequirements(document, after, [
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
    ]);
    expect(checks.filter((check) => !check.passed)).toEqual([]);
    expect(after.evidence).toEqual(document.evidence);
    expect(document).toEqual(before);
  },
);
it("uses playback rate and rounds inside the requested source end", async () => {
  const { document } = await fixture(24, 2);
  const result = prepareCaptionSourceRange(document, "speech", {
    startMs: 4001,
    endMs: 12345,
  });
  const item = result.document.items.find((item) => item.id === "speech")!;
  expect(item.node.duration).toBe(100);
  expect(item.node.videoStartTime).toBe(4.001);
  expect(result.sourceRange.effectiveEndMs).toBeLessThanOrEqual(12345);
  expect(result.sourceRange.effectiveEndMs).toBeGreaterThan(12260);
});
it("rejects reversed, expanding, sub-frame, unknown and looped source ranges", async () => {
  const { document } = await fixture();
  for (const sourceRange of [
    { startMs: 12000, endMs: 4000 },
    { startMs: -1, endMs: 4000 },
    { startMs: 0, endMs: 25000 },
    { startMs: 1, endMs: 2 },
    { startMs: 0, endMs: Infinity },
  ])
    expect(() =>
      prepareCaptionSourceRange(document, "speech", sourceRange),
    ).toThrow();
  const first = prepareCaptionSourceRange(document, "speech", {
    startMs: 4000,
    endMs: 12000,
  });
  expect(() =>
    prepareCaptionSourceRange(first.document, "speech", {
      startMs: 0,
      endMs: 12000,
    }),
  ).toThrow(/narrow/);
  expect(() =>
    prepareCaptionSourceRange(document, "missing", { startMs: 0, endMs: 1000 }),
  ).toThrow();
  document.assets.audio!.type = "audio";
  document.items[0]!.node.type = "audio";
  delete document.items[0]!.node.playbackRate;
  document.items[0]!.node.loop = true;
  expect(() =>
    prepareCaptionSourceRange(document, "speech", { startMs: 0, endMs: 1000 }),
  ).toThrow(/non-looping/);
});
it("binds cue cursors to exact range and rejects out-of-scope range inspection", async () => {
  const { document, request } = await fixture();
  const words = Array.from({ length: 201 }, (_, i) => ({
    id: `dense-${i}`,
    text: `W${i}.`,
    startMs: i * 100,
    endMs: i * 100 + 50,
  }));
  document.evidence.asr!.words = words;
  document.evidence.asr!.text = words.map((word) => word.text).join(" ");
  request.baseHash = await hashVideoProjectDocument(document);
  const first = await readNativeCaptionCues(request, {
    snapshotHash: request.baseHash,
    sourceItemId: "speech",
    evidenceId: "asr",
    sourceRange: { startMs: 0, endMs: 21000 },
  });
  const args = {
    snapshotHash: request.baseHash,
    sourceItemId: "speech",
    evidenceId: "asr",
    cursor: first.coverage.nextCursor,
  };
  await expect(readNativeCaptionCues(request, args)).rejects.toThrow(/cursor/);
  await expect(
    readNativeCaptionCues(request, {
      ...args,
      sourceRange: { startMs: 100, endMs: 21000 },
    }),
  ).rejects.toThrow(/cursor/);
  request.authoring!.scope = {
    kind: "range",
    fromFrame: 30000,
    durationInFrames: 10,
  };
  await expect(
    readNativeCaptionCues(request, {
      snapshotHash: request.baseHash,
      sourceItemId: "speech",
      evidenceId: "asr",
      sourceRange: { startMs: 0, endMs: 1000 },
    }),
  ).rejects.toThrow(/scope/);
});

it("composes explicit timestamp trim, original/translated captions and grouped media checks through the registered tools", async () => {
  const { request, document } = await fixture();
  request.instruction =
    "Trim Speech to source 4..12 seconds, then add English captions and white Chinese translation.";
  const { createVideoToolset } = await import("../packages/agent/src/tools");
  const { builtInSkills } = await import("../packages/agent-kit/src/index");
  const session = createVideoToolset(request, builtInSkills(), [], {
    profile: "local-editor-v3",
  });
  const signal = new AbortController().signal;
  const invoke = (name: string, args: unknown) =>
    session.tools.find((tool) => tool.name === name)!.execute(args, signal);
  const range = { startMs: 4000, endMs: 12000 };
  const observed = await invoke("read_caption_cues", {
    snapshotHash: request.baseHash,
    sourceItemId: "speech",
    evidenceId: "asr",
    sourceRange: range,
  });
  if (observed.kind !== "observation") throw new Error("fixture");
  const cues = (observed.value as { cues: Array<{ cueId: string }> }).cues;
  const pair = await invoke("prepare_caption_pair", {
    sourceItemId: "speech",
    evidenceId: "asr",
    originalItemId: "en",
    translatedItemId: "zh",
    trackId: "visual",
    originalLanguage: "en",
    translatedLanguage: "zh",
    originalColor: "#ff0000",
    translatedColor: "#ffffff",
    sourceRange: range,
    translations: cues.map((cue, i) => ({
      cueId: cue.cueId,
      text: `中文${i}`,
    })),
  });
  if (pair.kind !== "observation") throw new Error("fixture");
  const edit = {
    summary: "Trimmed bilingual clip",
    commands: (pair.value as { commands: unknown[] }).commands,
  };
  const requirements = [
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
      id: "source",
      kind: "asset_sequence",
      items: [
        {
          itemId: "speech",
          assetId: "audio",
          from: 60,
          duration: 240,
          sourceStartSeconds: 4,
        },
      ],
    },
  ];
  expect(await invoke("review_edit", { requirements, edit })).toMatchObject({
    kind: "observation",
    value: { completionPreflight: { status: "passed" } },
  });
  const final = await invoke("propose_edit", edit);
  if (final.kind !== "terminal") throw new Error("fixture");
  expect(final.result.completion!.requirements).toEqual(requirements);
  const after = executeVideoProjectCommands(
    document,
    final.result.proposal!.commands,
  ).document;
  expect(after.evidence).toEqual(document.evidence);
});

it("reports untimed tokens in the effective source window and prevents a false full-caption receipt", async () => {
  const { document, request } = await fixture();
  document.evidence.asr!.text = "So " + document.evidence.asr!.text;
  document.evidence.asr!.timingOmissions = [
    {
      tokenIndex: 0,
      text: "So",
      startMs: 0,
      endMs: 0,
      reason: "nonpositive-duration",
    },
  ];
  request.baseHash = await hashVideoProjectDocument(document);
  const original = await readNativeCaptionCues(request, {
    snapshotHash: request.baseHash,
    sourceItemId: "speech",
    evidenceId: "asr",
  });
  expect(original.coverage).toMatchObject({
    complete: false,
    cuesComplete: true,
    reason: "untimed_source_tokens",
    nextCursor: null,
  });
  const { prepareCompletionCaptionCuePacket } = await import(
    "../packages/core/src/lib/video-project/completion-caption-context"
  );
  expect(
    prepareCompletionCaptionCuePacket(document, undefined, {
      pagedReaders: true,
    }),
  ).toMatchObject({
    complete: false,
    sources: [
      { complete: false, cuesComplete: true, timingOmissions: { count: 1 } },
    ],
  });
  expect(
    prepareCompletionCaptionCuePacket(document).sources[0],
  ).not.toHaveProperty("timingOmissions");
  expect(original.source).toMatchObject({
    timingOmissions: { count: 1, examples: [{ text: "So", tokenIndex: 0 }] },
  });
  const input = {
    sourceItemId: "speech",
    evidenceId: "asr",
    originalItemId: "en",
    translatedItemId: "zh",
    trackId: "visual",
    originalLanguage: "en",
    translatedLanguage: "zh",
    originalColor: "#ff0000",
    translatedColor: "#ffffff",
    translations: original.cues.map((cue, index) => ({
      cueId: cue.cueId,
      text: `中文${index}`,
    })),
  };
  const commands = prepareCaptionPair(document, input, {
    sourceRange: true,
  }).commands;
  const after = executeVideoProjectCommands(document, commands).document;
  const requirements = [
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
  ];
  expect(
    checkNativeCompletionRequirements(document, after, requirements).find(
      (check) => check.id === "pair",
    ),
  ).toMatchObject({
    passed: false,
    message: expect.stringMatching(/positive-duration/),
  });
  const clipped = await readNativeCaptionCues(request, {
    snapshotHash: request.baseHash,
    sourceItemId: "speech",
    evidenceId: "asr",
    sourceRange: { startMs: 1000, endMs: 9000 },
  });
  expect(clipped.coverage.complete).toBe(true);
  expect(clipped.source.timingOmissions).toBeUndefined();
  expect(document.evidence.asr!.timingOmissions[0]!.startMs).toBe(0);
});
