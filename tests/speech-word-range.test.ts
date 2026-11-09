import { expect, it } from "vitest";
import {
  createVideoProjectDocument,
  parseVideoProjectDocument,
} from "../packages/core/src/lib/video-project/document";
import { resolveSpeechAnchor } from "../packages/core/src/lib/video-project/source-clock";
import { speechCutCommands } from "../packages/core/src/lib/video-project/semantic";
import { executeVideoProjectCommands } from "../packages/core/src/lib/video-project/commands";
import { checkNativeCompletionRequirements } from "../packages/core/src/lib/video-project/completion-preflight";
function fixture(omittedIndex: number) {
  const document = createVideoProjectDocument({
    width: 640,
    height: 360,
    fps: 30,
    durationInFrames: 300,
  });
  document.assets.video = {
    id: "video",
    name: "Video",
    type: "video",
    source: "local",
    durationSeconds: 10,
  };
  document.sources.video = { assetId: "video", revision: "source" };
  document.items.push(
    {
      id: "clip",
      name: "Video",
      trackId: "visual",
      node: {
        id: "clip",
        type: "video",
        assetId: "video",
        from: 0,
        duration: 300,
      },
    },
    {
      id: "label",
      name: "Label",
      trackId: "visual",
      node: {
        id: "label",
        type: "text",
        text: "Year over year",
        from: 30,
        duration: 60,
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
  );
  const tokens = ["Before", "Year", "over", "year", "After"];
  const words = tokens.flatMap((text, tokenIndex) =>
    tokenIndex === omittedIndex
      ? []
      : [
          {
            id: `w:aaaaaaaaaaaaaaaa:${tokenIndex}`,
            text,
            startMs: tokenIndex * 1000,
            endMs: tokenIndex * 1000 + 500,
          },
        ],
  );
  document.evidence.e = {
    id: "e",
    sourceAssetId: "video",
    sourceRevision: "source",
    transcriptHash: "sha256:" + "a".repeat(64),
    language: "en",
    text: tokens.join(" "),
    words,
    timingOmissions: [
      {
        tokenIndex: omittedIndex,
        text: tokens[omittedIndex]!,
        startMs: 0,
        endMs: 0,
        reason: "nonpositive-duration",
      },
    ],
  };
  return document;
}
const args = {
  id: "anchor",
  itemId: "label",
  sourceItemId: "clip",
  evidenceId: "e",
  wordIds: [
    "w:aaaaaaaaaaaaaaaa:1",
    "w:aaaaaaaaaaaaaaaa:2",
    "w:aaaaaaaaaaaaaaaa:3",
  ],
  holdMs: 1500,
};
it.each([0, 4])(
  "allows a genuine three-word phrase when omitted token%s is outside the phrase",
  (omitted) => {
    const doc = fixture(omitted),
      before = structuredClone(doc);
    const binding = resolveSpeechAnchor(doc, args);
    expect(binding).toMatchObject({
      sourceStartMs: 1000,
      sourceEndMs: 3500,
      wordIds: args.wordIds,
    });
    const after = executeVideoProjectCommands(doc, [
      { type: "bindSource", binding },
    ]).document;
    expect(
      checkNativeCompletionRequirements(doc, after, [
        {
          id: "phrase",
          kind: "speech_callout",
          itemId: "label",
          bindingId: "anchor",
          sourceItemId: "clip",
          evidenceId: "e",
          wordIds: args.wordIds,
          exactText: "Year over year",
          minReadableMs: 1500,
        },
      ]).every((check) => check.passed),
    ).toBe(true);
    expect(doc).toEqual(before);
  },
);
it("rejects an interior omitted word for anchored callouts, cuts and raw bindings", () => {
  const doc = fixture(2),
    ids = ["w:aaaaaaaaaaaaaaaa:1", "w:aaaaaaaaaaaaaaaa:3"],
    before = structuredClone(doc);
  expect(() => resolveSpeechAnchor(doc, { ...args, wordIds: ids })).toThrow(
    /untimed source tokens/,
  );
  expect(() =>
    speechCutCommands(doc, {
      sourceItemId: "clip",
      evidenceId: "e",
      wordIds: ids,
      mode: "remove",
    }),
  ).toThrow(/untimed source tokens/);
  const forged = structuredClone(doc);
  forged.bindings.anchor = {
    ...args,
    wordIds: ids,
    sourceAssetId: "video",
    sourceRevision: "source",
    sourceStartMs: 1000,
    sourceEndMs: 3500,
    status: "active",
  };
  expect(() => parseVideoProjectDocument(forged)).toThrow(
    /untimed source tokens/,
  );
  expect(doc).toEqual(before);
});
it("preserves all-valid binding bytes and rejects unknown original-token mappings with omissions", () => {
  const doc = fixture(0);
  delete doc.evidence.e!.timingOmissions;
  expect(resolveSpeechAnchor(doc, args)).toEqual({
    ...args,
    sourceAssetId: "video",
    sourceRevision: "source",
    sourceStartMs: 1000,
    sourceEndMs: 3500,
    status: "active",
  });
  doc.evidence.e!.timingOmissions = [
    {
      tokenIndex: 0,
      text: "Before",
      startMs: 0,
      endMs: 0,
      reason: "nonpositive-duration",
    },
  ];
  doc.evidence.e!.words[0]!.id = "unknown";
  expect(() =>
    resolveSpeechAnchor(doc, {
      ...args,
      wordIds: ["unknown", ...args.wordIds.slice(1)],
    }),
  ).toThrow(/original token identities/);
});
