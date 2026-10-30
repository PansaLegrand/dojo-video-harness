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
  const form = new FormData();
  form.set("file", file, name);
  form.set("model", config.model);
  form.set("response_format", "verbose_json");
  form.append("timestamp_granularities[]", "word");
  if (language !== "auto") form.set("language", language);
  const response = await fetch(
    providerUrl(config.baseUrl, "audio/transcriptions"),
    {
      method: "POST",
      redirect: "error",
      signal,
      headers: config.apiKey
        ? { Authorization: `Bearer ${config.apiKey}` }
        : {},
      body: form,
    },
  );
  return normalizeTranscript(await providerJson(response));
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
