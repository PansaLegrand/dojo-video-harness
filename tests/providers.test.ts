import { it, expect } from "vitest";
import { normalizeTranscript } from "../packages/adapters/src/asr";
import { providerUrl } from "../packages/adapters/src/openai-compatible";
import { createVideoProjectDocument } from "../packages/core/src/lib/video-project/document";
import { transcriptEvidenceFromAsr } from "../packages/core/src/lib/video-project/semantic";
it("preserves real ASR word timing through the provider and evidence boundaries", async () => {
  const raw = normalizeTranscript({
    text: "Hello world.",
    words: [
      { word: "Hello", start: 0.125, end: 0.5 },
      { word: "world.", start: 0.6, end: 0.9 },
    ],
  });
  const document = createVideoProjectDocument();
  document.assets.voice = {
    id: "voice",
    name: "voice",
    source: "project",
    type: "audio",
  };
  document.sources.voice = { assetId: "voice", revision: "bytes-1" };
  const evidence = await transcriptEvidenceFromAsr(
    document,
    "voice",
    raw,
    "receipt",
  );
  expect(evidence.words.map((w) => [w.text, w.startMs, w.endMs])).toEqual([
    ["Hello", 125, 500],
    ["world.", 600, 900],
  ]);
});
it("rejects missing, reversed, and unordered timestamp evidence", () => {
  expect(() => normalizeTranscript({ text: "Hello" })).toThrow();
  expect(() =>
    normalizeTranscript({
      text: "Hello",
      words: [{ word: "Hello", start: 2, end: 1 }],
    }),
  ).toThrow();
  expect(() =>
    normalizeTranscript({
      text: "Hello world",
      words: [
        { word: "Hello", start: 1, end: 2 },
        { word: "world", start: 0, end: 1 },
      ],
    }),
  ).toThrow();
});
it("allows local compatible providers but rejects insecure remote and credential-bearing endpoints", () => {
  expect(
    providerUrl("http://127.0.0.1:11434/v1", "chat/completions").pathname,
  ).toBe("/v1/chat/completions");
  expect(() =>
    providerUrl("http://example.com/v1", "chat/completions"),
  ).toThrow();
  expect(() =>
    providerUrl("https://key:secret@example.com", "chat/completions"),
  ).toThrow();
});
