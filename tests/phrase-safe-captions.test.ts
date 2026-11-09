import { expect, it } from "vitest";
import {
  createVideoProjectDocument,
  parseVideoProjectDocument,
} from "../packages/core/src/lib/video-project/document";
import { captionSourceCommands } from "../packages/core/src/lib/video-project/semantic";
import { prepareCompletionCaptionCuePacket } from "../packages/core/src/lib/video-project/completion-caption-context";
import { nativeTranscriptScopedSourceItemIds } from "../packages/core/src/lib/video-project/agent-transcript-search";
function fixture(
  prefix: string,
  number: string[],
  boundary: "time" | "length",
) {
  const doc = createVideoProjectDocument({
    width: 640,
    height: 360,
    fps: 30,
    durationInFrames: 300,
  });
  doc.assets.a = {
    id: "a",
    name: "Audio",
    type: "audio",
    source: "local",
    durationSeconds: 10,
  };
  doc.sources.a = { assetId: "a", revision: "rev" };
  doc.items.push({
    id: "source",
    name: "Source",
    trackId: "audio",
    node: { id: "source", type: "audio", assetId: "a", from: 0, duration: 300 },
  });
  const words = [
    { id: "prefix", text: prefix, startMs: 0, endMs: 100 },
    ...number.map((text, index) => ({
      id: `number-${index}`,
      text,
      startMs: (boundary === "time" ? 3900 : 200) + index * 100,
      endMs: (boundary === "time" ? 4000 : 300) + index * 100,
    })),
  ];
  doc.evidence.e = {
    id: "e",
    sourceAssetId: "a",
    sourceRevision: "rev",
    language: "eng",
    transcriptHash: "hash",
    text: words.map((word) => word.text).join(" "),
    words,
  };
  return parseVideoProjectDocument(doc);
}
function cues(document: ReturnType<typeof fixture>, phraseSafe?: boolean) {
  const cmd = captionSourceCommands(document, {
    sourceItemId: "source",
    evidenceId: "e",
    itemId: "caption",
    trackId: "visual",
    phraseSafe,
  }).find((command) => command.type === "addItem");
  if (cmd?.type !== "addItem") throw new Error("fixture");
  return cmd.item.caption!.cues;
}
it.each(["time", "length"] as const)(
  "keeps spoken decimal+percent atomic across the %s flush while preserving legacy output",
  (boundary) => {
    const doc = fixture(
        boundary === "time" ? "GDP expanded at" : "x".repeat(70),
        ["three", "point", "three", "percent."],
        boundary,
      ),
      before = structuredClone(doc);
    const legacy = cues(doc);
    expect(cues(doc, false)).toEqual(legacy);
    expect(legacy[0]!.text).toMatch(/three$/);
    expect(legacy[1]!.text).toBe("point three percent.");
    const safe = cues(doc, true);
    expect(safe[0]!.text).toBe(
      boundary === "time" ? "GDP expanded at" : "x".repeat(70),
    );
    expect(safe[1]!.text).toBe("three point three percent.");
    expect(safe.flatMap((cue) => cue.words!.map((word) => word.text))).toEqual(
      doc.evidence.e!.words.map((word) => word.text),
    );
    expect(doc).toEqual(before);
    const packet = prepareCompletionCaptionCuePacket(doc);
    expect(packet.complete).toBe(true);
    expect(packet.sources[0]!.language).toBe("en");
    expect(packet.sources[0]!.cues).toEqual(
      safe.map(({ id, text, startMs, endMs }) => ({
        cueId: id,
        text,
        startMs,
        endMs,
      })),
    );
  },
);
it("keeps the second decimal and the negative year as complete genuine phrases", () => {
  const decimal = fixture(
    "GDP expanded at",
    ["three", "point", "one", "percent."],
    "time",
  );
  expect(cues(decimal, true)[1]!.text).toBe("three point one percent.");
  const year = fixture(
    "GDP expanded at",
    ["two", "thousand", "twenty-three."],
    "time",
  );
  expect(cues(year, true)[1]!.text).toBe("two thousand twenty-three.");
});
it("builds an exact packet for audio-only documents and bounds the full serialized packet", () => {
  const doc = fixture(
    "GDP expanded at",
    ["three", "point", "three", "percent."],
    "time",
  );
  doc.tracks = doc.tracks.filter((track) => track.kind === "audio");
  expect(prepareCompletionCaptionCuePacket(doc).complete).toBe(true);
  const words = Array.from({ length: 300 }, (_, index) => ({
    id: `w${index}`,
    text: "word".repeat(15) + ".",
    startMs: index * 20,
    endMs: index * 20 + 15,
  }));
  for (let i = 0; i < 12; i++) {
    const id = `source-${i}-` + "x".repeat(175);
    doc.items.push({
      id,
      name: id,
      trackId: "audio",
      node: { id, type: "audio", assetId: "a", from: 0, duration: 300 },
    });
  }
  doc.evidence.e!.words = words;
  doc.evidence.e!.text = words.map((word) => word.text).join(" ");
  const packet = prepareCompletionCaptionCuePacket(doc);
  expect(
    new TextEncoder().encode(JSON.stringify(packet)).byteLength,
  ).toBeLessThanOrEqual(32000);
  expect(packet.complete).toBe(false);
  expect(packet.sources.length).toBeLessThanOrEqual(12);
});

it("keeps explicit empty source filters and out-of-range scopes empty", () => {
  const document = fixture(
    "GDP expanded at",
    ["three", "point", "three", "percent."],
    "time",
  );
  expect(prepareCompletionCaptionCuePacket(document).sources).toHaveLength(1);
  expect(prepareCompletionCaptionCuePacket(document, []).sources).toEqual([]);
  const ids = nativeTranscriptScopedSourceItemIds({
    baseHash: "fixture",
    document,
    context: { selectedItemIds: [] },
    authoring: {
      scope: { kind: "range", fromFrame: 600, durationInFrames: 30 },
    },
  });
  expect(ids).toEqual([]);
  expect(
    prepareCompletionCaptionCuePacket(document, ids ?? undefined).sources,
  ).toEqual([]);
});
