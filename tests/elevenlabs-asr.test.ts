import { it, expect, vi, afterEach } from "vitest";
import {
  normalizeElevenLabsTranscript,
  transcribe,
} from "../packages/adapters/src/asr";
const config = {
  baseUrl: "https://api.elevenlabs.io/v1",
  model: "scribe_v1",
  apiKey: "synthetic-elevenlabs-secret",
};
const raw = {
  text: "Hello world.",
  language_code: "en",
  words: [
    { type: "word", text: "Hello", start: 0.1, end: 0.4 },
    { type: "spacing", text: " ", start: 0.4, end: 0.4 },
    { type: "word", text: "world.", start: 0.5, end: 0.9 },
  ],
};
afterEach(() => vi.unstubAllGlobals());
it("uses native ElevenLabs multipart/auth without changing actual word timing", async () => {
  const fetch = vi.fn(async () => new Response(JSON.stringify(raw)));
  vi.stubGlobal("fetch", fetch);
  const result = await transcribe(
    config,
    new Blob(["fixture"]),
    "speech.wav",
    "en",
    new AbortController().signal,
  );
  const [url, options] = fetch.mock.calls[0] as unknown as [URL, RequestInit];
  const form = options.body as FormData;
  expect(url.href).toBe("https://api.elevenlabs.io/v1/speech-to-text");
  expect(options.headers).toEqual({ "xi-api-key": config.apiKey });
  expect(options.redirect).toBe("error");
  expect(form.get("model_id")).toBe("scribe_v1");
  expect(form.get("timestamps_granularity")).toBe("word");
  expect(form.get("language_code")).toBe("en");
  expect(form.has("model")).toBe(false);
  expect(
    result.utterances[0].words.map((w) => [
      w.text,
      w.start_time_ms,
      w.end_time_ms,
    ]),
  ).toEqual([
    ["Hello", 100, 400],
    ["world.", 500, 900],
  ]);
  expect(JSON.stringify(result)).not.toContain(config.apiKey);
});
it("rejects missing, unordered and zero-length word timings; never fabricates words from spacing", () => {
  for (const invalid of [
    { text: "Hello" },
    { ...raw, words: raw.words.map((w) => ({ ...w, start: 2, end: 1 })) },
    { ...raw, words: [{ type: "spacing", text: " ", start: 0, end: 0 }] },
    { ...raw, words: [{ type: "word", text: "Hello", start: 1, end: 1 }] },
  ])
    expect(() => normalizeElevenLabsTranscript(invalid)).toThrow();
});
it("stops before network on cancellation or a wrong native base path", async () => {
  const fetch = vi.fn();
  vi.stubGlobal("fetch", fetch);
  const controller = new AbortController();
  controller.abort();
  await expect(
    transcribe(
      config,
      new Blob(["fixture"]),
      "x.wav",
      "auto",
      controller.signal,
    ),
  ).rejects.toThrow();
  await expect(
    transcribe(
      { ...config, baseUrl: "https://api.elevenlabs.io/wrong" },
      new Blob(["fixture"]),
      "x.wav",
      "auto",
      new AbortController().signal,
    ),
  ).rejects.toThrow(/base URL/);
  expect(fetch).not.toHaveBeenCalled();
});
it("does not expose provider error bodies or retry an uncertain request", async () => {
  const fetch = vi.fn(async () => new Response(config.apiKey, { status: 502 }));
  vi.stubGlobal("fetch", fetch);
  await expect(
    transcribe(
      config,
      new Blob(["fixture"]),
      "x.wav",
      "auto",
      new AbortController().signal,
    ),
  ).rejects.toThrow("Provider returned HTTP 502");
  expect(fetch).toHaveBeenCalledTimes(1);
});
