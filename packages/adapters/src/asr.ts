import { z } from "zod/v3";
import {
  providerUrl,
  providerJson,
  type ProviderConfig,
} from "./provider-http";
const transcript = z.object({
  text: z.string(),
  language: z.string().optional(),
  words: z
    .array(
      z
        .object({
          word: z.string().min(1),
          start: z.number().finite().nonnegative(),
          end: z.number().finite().positive(),
        })
        .refine((w) => w.end > w.start),
    )
    .min(1)
    .max(50_000),
});
/** Word timestamps are evidence. Segment-only providers cannot authorize word cuts. */
export async function transcribe(
  config: ProviderConfig,
  file: Blob,
  name: string,
  language: string,
  signal: AbortSignal,
) {
  signal.throwIfAborted();
  const base = providerUrl(config.baseUrl, "audio/transcriptions");
  const eleven = base.hostname === "api.elevenlabs.io";
  if (eleven && base.pathname !== "/v1/audio/transcriptions")
    throw new Error(
      "Use https://api.elevenlabs.io/v1 as the ElevenLabs base URL.",
    );
  const form = new FormData();
  form.set("file", file, name);
  if (eleven) {
    form.set("model_id", config.model);
    form.set("timestamps_granularity", "word");
    form.set("tag_audio_events", "false");
    form.set("diarize", "false");
    if (language !== "auto") form.set("language_code", language);
  } else {
    form.set("model", config.model);
    form.set("response_format", "verbose_json");
    form.append("timestamp_granularities[]", "word");
    if (language !== "auto") form.set("language", language);
  }
  const response = await fetch(
    eleven ? providerUrl(config.baseUrl, "speech-to-text") : base,
    {
      method: "POST",
      redirect: "error",
      signal,
      headers: config.apiKey
        ? eleven
          ? { "xi-api-key": config.apiKey }
          : { Authorization: `Bearer ${config.apiKey}` }
        : {},
      body: form,
    },
  );
  const raw = await providerJson(response);
  return eleven ? normalizeElevenLabsTranscript(raw) : normalizeTranscript(raw);
}
const elevenTranscript = z.object({
  text: z.string(),
  language_code: z.string().optional(),
  words: z
    .array(
      z.object({
        type: z.enum(["word", "spacing", "audio_event"]),
        text: z.string(),
        start: z.number().finite().nonnegative(),
        end: z.number().finite().nonnegative(),
      }),
    )
    .min(1)
    .max(100_000),
});
export function normalizeElevenLabsTranscript(raw: unknown) {
  const parsed = elevenTranscript.safeParse(raw);
  if (!parsed.success)
    throw new Error(
      "ElevenLabs must return a single transcript with genuine word timestamps.",
    );
  return normalizeTranscript({
    text: parsed.data.text,
    language: parsed.data.language_code,
    words: parsed.data.words
      .filter((w) => w.type === "word")
      .map((w) => ({ word: w.text, start: w.start, end: w.end })),
  });
}
export function normalizeTranscript(raw: unknown) {
  const result = transcript.parse(raw);
  let previous = -1;
  const groups: Array<{
    text: string;
    start_time_ms: number;
    end_time_ms: number;
    words: Array<{ text: string; start_time_ms: number; end_time_ms: number }>;
  }> = [];
  for (const word of result.words) {
    if (word.start < previous)
      throw new Error("Provider word timestamps are not ordered.");
    previous = word.start;
    const entry = {
      text: word.word,
      start_time_ms: word.start * 1000,
      end_time_ms: word.end * 1000,
    };
    let group = groups.at(-1);
    if (!group || group.words.length >= 12 || /[.!?。！？]$/.test(group.text)) {
      group = {
        text: "",
        start_time_ms: entry.start_time_ms,
        end_time_ms: entry.end_time_ms,
        words: [],
      };
      groups.push(group);
    }
    group.words.push(entry);
    group.text = group.words.map((w) => w.text).join(" ");
    group.end_time_ms = entry.end_time_ms;
  }
  return {
    text: result.text,
    language: result.language,
    duration_ms: result.words.at(-1)!.end * 1000,
    utterances: groups,
  };
}
