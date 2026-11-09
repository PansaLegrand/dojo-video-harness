import { expect, it } from "vitest";
import {
  createVideoProjectDocument,
  parseVideoProjectDocument,
} from "./document";
import { transcriptEvidenceFromAsr, semanticDigest } from "./semantic";

function fixture() {
  const doc = createVideoProjectDocument({
    width: 640,
    height: 360,
    fps: 30,
    durationInFrames: 360,
  });
  doc.assets.speech = {
    id: "speech",
    name: "Speech",
    type: "video",
    source: "local",
    durationSeconds: 12,
  };
  doc.sources.speech = { assetId: "speech", revision: "unchanged-original" };
  doc.items.push({
    id: "clip",
    name: "Speech",
    trackId: "visual",
    node: {
      id: "clip",
      type: "video",
      assetId: "speech",
      from: 0,
      duration: 360,
    },
  });
  return doc;
}
it("retains the real cropped-token policy without inventing source timing or renumbering words", async () => {
  const doc = fixture();
  const raw = {
    text: "So growth continues.",
    language: "en",
    duration_ms: 12000,
    utterances: [
      {
        text: "So growth continues.",
        start_time_ms: 0,
        end_time_ms: 1200,
        words: [
          { text: "So", start_time_ms: 0, end_time_ms: 0 },
          { text: "growth", start_time_ms: 100, end_time_ms: 600 },
          { text: "continues.", start_time_ms: 650, end_time_ms: 1200 },
        ],
      },
    ],
  };
  const before = JSON.stringify(raw);
  const evidence = await transcriptEvidenceFromAsr(
    doc,
    "speech",
    raw,
    "receipt",
  );
  expect(evidence.text).toBe(raw.text);
  expect(evidence.transcriptHash).toBe(await semanticDigest(raw));
  expect(evidence.words.map((word) => word.text)).toEqual([
    "growth",
    "continues.",
  ]);
  expect(evidence.words[0].id).toMatch(/:1$/);
  expect(evidence.words[1].id).toMatch(/:2$/);
  expect(evidence.timingOmissions).toEqual([
    {
      tokenIndex: 0,
      text: "So",
      startMs: 0,
      endMs: 0,
      reason: "nonpositive-duration",
    },
  ]);
  doc.evidence[evidence.id] = evidence;
  expect(() => parseVideoProjectDocument(doc)).not.toThrow();
  expect(JSON.stringify(raw)).toBe(before);
});
it("keeps all-valid evidence free of new optional metadata and rejects an entirely untimed receipt", async () => {
  const doc = fixture();
  const raw = {
    text: "Hello",
    language: "en",
    duration_ms: 12000,
    utterances: [
      {
        text: "Hello",
        start_time_ms: 100,
        end_time_ms: 500,
        words: [{ text: "Hello", start_time_ms: 100, end_time_ms: 500 }],
      },
    ],
  };
  expect(
    (await transcriptEvidenceFromAsr(doc, "speech", raw)).timingOmissions,
  ).toBeUndefined();
  raw.utterances[0].words[0].end_time_ms = 100;
  await expect(transcriptEvidenceFromAsr(doc, "speech", raw)).rejects.toThrow(
    /positive-duration/,
  );
});

it.each([0, 1, 2])(
  "fails closed for a missing-time speech token at position %s without changing its receipt",
  async (index) => {
    const words: Array<Record<string, unknown>> = [
      { text: "One", start_time_ms: 100, end_time_ms: 200 },
      { text: "lost", start_time_ms: 300, end_time_ms: 400 },
      { text: "three.", start_time_ms: 500, end_time_ms: 600 },
    ];
    delete words[index].start_time_ms;
    const raw = {
      text: "One lost three.",
      utterances: [
        { text: "One lost three.", start_time_ms: 0, end_time_ms: 700, words },
      ],
    };
    const before = JSON.stringify(raw);
    await expect(
      transcriptEvidenceFromAsr(fixture(), "speech", raw, "completed-receipt"),
    ).rejects.toThrow(/without finite timestamps.*receipt is retained/);
    expect(JSON.stringify(raw)).toBe(before);
  },
);

it.each([undefined, null, "500", Number.NaN, Number.POSITIVE_INFINITY])(
  "rejects nonfinite or absent end timestamps (%s)",
  async (end) => {
    const raw = {
      text: "Hello",
      utterances: [
        {
          text: "Hello",
          start_time_ms: 0,
          end_time_ms: 700,
          words: [{ text: "Hello", start_time_ms: 100, end_time_ms: end }],
        },
      ],
    };
    await expect(
      transcriptEvidenceFromAsr(fixture(), "speech", raw),
    ).rejects.toThrow(/finite timestamps/);
  },
);

it.each([undefined, []])(
  "rejects a speech utterance lacking word timing even beside a valid utterance",
  async (missing) => {
    const raw = {
      text: "One missing.",
      utterances: [
        {
          text: "One",
          start_time_ms: 0,
          end_time_ms: 200,
          words: [{ text: "One", start_time_ms: 0, end_time_ms: 200 }],
        },
        {
          text: "missing.",
          start_time_ms: 300,
          end_time_ms: 700,
          words: missing,
        },
      ],
    };
    await expect(
      transcriptEvidenceFromAsr(fixture(), "speech", raw),
    ).rejects.toThrow(/no word timestamps/);
  },
);

it("ignores actual noise/spacing/punctuation and keeps legacy normalization opt-in", async () => {
  const { normalizeAsrResult } = await import(
    "@/lib/video-agent/transcript-normalizer"
  );
  const raw = {
    text: "One.",
    utterances: [
      {
        text: "One.",
        start_time_ms: 0,
        end_time_ms: 500,
        words: [
          { text: "noise", type: "noise" },
          { text: " ", type: "spacing" },
          { text: "One", start_time_ms: 100, end_time_ms: 300 },
          { text: ".", type: "punctuation" },
        ],
      },
    ],
  };
  const evidence = await transcriptEvidenceFromAsr(fixture(), "speech", raw);
  expect(evidence.words.map((word) => word.text)).toEqual(["One"]);
  const legacy = {
    text: "One lost three.",
    utterances: [
      {
        words: [
          { text: "One", start_time_ms: 100, end_time_ms: 200 },
          { text: "lost" },
          { text: "three.", start_time_ms: 500, end_time_ms: 600 },
        ],
      },
    ],
  };
  expect(normalizeAsrResult("speech", legacy)?.words).toHaveLength(2);
});
