import type { CaptionCue, EditorItem } from "@/lib/editor/document";
import { normalizeAsrUtteranceWords } from "@/lib/video-agent/asr-word-normalization";
import { editorRequest } from "./editor-media";

function parseTimestamp(value: string): number {
  const match = value.trim().match(/^(?:(\d+):)?(\d{2}):(\d{2})[,.](\d{3})$/);
  if (!match) throw new Error(`Invalid subtitle time: ${value}`);
  const [, hours, minutes, seconds, milliseconds] = match;
  return (
    ((Number(hours ?? 0) * 60 + Number(minutes)) * 60 + Number(seconds)) *
      1000 +
    Number(milliseconds)
  );
}

export function parseEditorSubtitles(source: string): CaptionCue[] {
  const blocks = source
    .replace(/^\uFEFF/, "")
    .replace(/\r/g, "")
    .trim()
    .split(/\n\s*\n/);
  const cues: CaptionCue[] = [];
  for (const block of blocks) {
    const lines = block.split("\n");
    const timeIndex = lines.findIndex((line) => line.includes("-->"));
    if (timeIndex < 0) continue;
    const [start, end] = lines[timeIndex]!.split("-->");
    const startMs = parseTimestamp(start!);
    const endMs = parseTimestamp(end!.trim().split(/\s/)[0]!);
    if (endMs <= startMs)
      throw new Error("A subtitle must end after it starts.");
    const text = lines
      .slice(timeIndex + 1)
      .join("\n")
      .replace(/<[^>]*>/g, "")
      .replace(/&amp;/g, "&")
      .replace(/&lt;/g, "<")
      .replace(/&gt;/g, ">")
      .trim();
    if (text) cues.push({ id: `cue-${cues.length + 1}`, text, startMs, endMs });
  }
  if (!cues.length)
    throw new Error("No subtitles found. Choose an SRT or WebVTT file.");
  if (cues.length > 5000)
    throw new Error("A subtitle track can contain up to 5,000 cues.");
  return cues.sort((a, b) => a.startMs - b.startMs);
}

function timestamp(ms: number) {
  const value = Math.max(0, Math.round(ms));
  const seconds = Math.floor(value / 1000);
  return `${String(Math.floor(seconds / 3600)).padStart(2, "0")}:${String(Math.floor(seconds / 60) % 60).padStart(2, "0")}:${String(seconds % 60).padStart(2, "0")},${String(value % 1000).padStart(3, "0")}`;
}

export function serializeEditorSubtitles(
  item: EditorItem,
  fps: number,
): string {
  const offset = ((item.node.from ?? 0) * 1000) / fps;
  const duration = ((item.node.duration ?? 1) * 1000) / fps;
  return (item.caption?.cues ?? [])
    .filter((cue) => cue.startMs < duration)
    .map(
      (cue, index) =>
        `${index + 1}\n${timestamp(offset + cue.startMs)} --> ${timestamp(offset + Math.min(duration, cue.endMs))}\n${cue.text}\n`,
    )
    .join("\n");
}

const openingPunctuation = new Set([
  "“",
  "‘",
  "(",
  "[",
  "{",
  "「",
  "『",
  "【",
  "（",
]);
function openingTailStart(value: string) {
  let cursor = value.length;
  while (cursor > 0 && /\s/u.test(value[cursor - 1]!)) cursor--;
  let found = false;
  while (cursor > 0 && openingPunctuation.has(value[cursor - 1]!)) {
    found = true;
    cursor--;
    while (cursor > 0 && /\s/u.test(value[cursor - 1]!)) cursor--;
  }
  return found ? cursor : value.length;
}

function utteranceWordSpans(text: string, words: Array<{ text: string }>) {
  const spans: Array<{ start: number; end: number }> = [];
  let cursor = 0;
  for (const word of words) {
    const pattern = Array.from(word.text)
      .map(
        (letter, index) =>
          (index > 0 && /\p{P}/u.test(letter) ? "\\s*" : "") +
          letter.replace(/[.*+?^$(){}|[\]\\]/g, "\\$&"),
      )
      .join("");
    const matcher = new RegExp(pattern, "giu");
    matcher.lastIndex = cursor;
    const match = matcher.exec(text);
    if (!match) return null;
    cursor = match.index + match[0].length;
    spans.push({ start: match.index, end: cursor });
  }
  return spans;
}

/** Preserve original writing-system spacing and punctuation in a timed source slice. */
function retainedUtteranceText(
  text: string,
  words: Array<{ text: string }>,
  retained: number[],
  spans: ReturnType<typeof utteranceWordSpans>,
) {
  if (!words.length || retained.length === words.length) return text;
  const fallback = () => retained.map((index) => words[index]!.text).join(" ");
  if (!retained.length) return "";
  const first = retained[0]!,
    last = retained.at(-1)!;
  if (retained.length !== last - first + 1) return fallback();
  if (!spans) return fallback();
  let start = first === 0 ? 0 : spans[first]!.start;
  if (first > 0) {
    const gap = text.slice(spans[first - 1]!.end, start);
    start = spans[first - 1]!.end + openingTailStart(gap);
  }
  let end = last === spans.length - 1 ? text.length : spans[last + 1]!.start;
  if (last < spans.length - 1) {
    const gap = text.slice(spans[last]!.end, end);
    end = spans[last]!.end + openingTailStart(gap);
  }
  return text.slice(start, end).trim();
}

export function editorCuesFromAsr(
  raw: unknown,
  clip: EditorItem,
  fps: number,
): CaptionCue[] {
  const payload = raw as {
    utterances?: Array<{
      text?: string;
      start_time_ms?: number;
      end_time_ms?: number;
      words?: unknown;
    }>;
  };
  if (!Array.isArray(payload?.utterances))
    throw new Error("The transcription contains no captions.");
  const rate = clip.node.playbackRate ?? 1;
  const sourceStartMs =
    (clip.node.videoStartTime ?? clip.node.audioStartTime ?? 0) * 1000;
  const durationMs = ((clip.node.duration ?? 1) * 1000) / fps;
  const local = (ms: number) => (ms - sourceStartMs) / rate;
  const cues = payload.utterances.flatMap((utterance, index) => {
    const startMs = Math.max(0, local(Number(utterance.start_time_ms)));
    const endMs = Math.min(durationMs, local(Number(utterance.end_time_ms)));
    if (
      !Number.isFinite(startMs) ||
      !Number.isFinite(endMs) ||
      endMs <= startMs ||
      !utterance.text
    )
      return [];
    const normalizedWords = normalizeAsrUtteranceWords(
      utterance.words,
      utterance.text,
    );
    const spans = utteranceWordSpans(utterance.text, normalizedWords);
    const retained: number[] = [];
    const words = normalizedWords.flatMap((word, wordIndex) => {
      const start = Math.max(0, local(word.startMs));
      const end = Math.min(durationMs, local(word.endMs));
      if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start)
        return [];
      retained.push(wordIndex);
      const span = spans?.[wordIndex];
      return [
        {
          text: span ? utterance.text!.slice(span.start, span.end) : word.text,
          startMs: start,
          endMs: end,
        },
      ];
    });
    if (normalizedWords.length && !words.length) return [];
    const text = retainedUtteranceText(
      utterance.text,
      normalizedWords,
      retained,
      spans,
    );
    // Conflicting provider prose/word tokens must not masquerade as precise highlights.
    const timedWords = words.every((word) => text.includes(word.text))
      ? words
      : [];
    return [
      {
        id: `asr-${index}`,
        text,
        startMs,
        endMs,
        ...(timedWords.length ? { words: timedWords } : {}),
      },
    ];
  });
  if (!cues.length)
    throw new Error("No speech was found inside the selected clip.");
  return cues;
}

export async function startEditorTranscription(
  projectId: string,
  assetId: string,
  language: string,
  signal: AbortSignal | undefined,
  operationId: string,
) {
  return editorRequest<{ task_id: string }>(
    "/api/asr/tasks/create-and-start-automatic-speech-recognition",
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      signal,
      body: JSON.stringify({
        asset_id: assetId,
        request_id: operationId,
        project_id: projectId,
        language,
        task_name: "Editor captions",
        word_level_timestamps: true,
        max_caption_length: 80,
        max_caption_duration_ms: 4000,
        punctuation: true,
        profanity_filter: false,
        segment_by: "sentence",
      }),
    },
  );
}

export async function getEditorTranscription(
  taskId: string,
  signal?: AbortSignal,
) {
  return editorRequest<{
    status: string;
    progress?: number;
    raw_asr_result?: unknown;
    error_message?: string;
  }>(
    `/api/asr/tasks/${encodeURIComponent(taskId)}/get-automatic-speech-recognition-status`,
    { signal },
  );
}

type TranslationData = {
  task_id?: string;
  project_id?: string | null;
  target_language?: string;
  output_subtitle_data?: {
    utterances?: Array<{
      text: string;
      start_time_ms: number;
      end_time_ms: number;
    }>;
  };
};
function translatedCues(data: TranslationData, cues: CaptionCue[]) {
  const result = data.output_subtitle_data?.utterances;
  if (!result?.length || result.length !== cues.length)
    throw new Error(
      "The translated result does not match the source captions.",
    );
  return result.map((cue, index) => ({
    id: cues[index].id,
    text: cue.text,
    startMs: cues[index].startMs,
    endMs: cues[index].endMs,
  }));
}
export async function translateEditorCaptions(
  projectId: string,
  cues: CaptionCue[],
  language: string,
  signal?: AbortSignal,
  sourceLanguage = "auto",
  operationId: string = crypto.randomUUID(),
): Promise<{ cues: CaptionCue[]; taskId?: string }> {
  const data = await editorRequest<TranslationData>(
    "/api/subtitle-translation",
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      signal,
      body: JSON.stringify({
        project_id: projectId,
        request_id: operationId,
        source_language: sourceLanguage,
        target_language: language,
        text: cues.map((cue) => cue.text).join(" "),
        utterances: cues.map((cue, index) => ({
          text: cue.text,
          index,
          start_time_ms: Math.round(cue.startMs),
          end_time_ms: Math.round(cue.endMs),
        })),
      }),
    },
  );
  return { cues: translatedCues(data, cues), taskId: data.task_id };
}
export async function recoverEditorTranslation(
  projectId: string,
  taskId: string,
  cues: CaptionCue[],
  language: string,
  signal?: AbortSignal,
) {
  const data = await editorRequest<TranslationData>(
    `/api/subtitle-translation/${encodeURIComponent(taskId)}`,
    { signal },
  );
  if (
    data.task_id !== taskId ||
    data.project_id !== projectId ||
    data.target_language !== language
  )
    throw new Error("The translation receipt does not match these captions.");
  return translatedCues(data, cues);
}
