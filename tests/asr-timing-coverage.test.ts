import { expect, it } from "vitest";
import {
  createVideoProjectDocument,
  parseVideoProjectDocument,
} from "../packages/core/src/lib/video-project/document";
import {
  transcriptEvidenceFromAsr,
  semanticDigest,
} from "../packages/core/src/lib/video-project/semantic";

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
