import type { ASRResult } from "@/types/asr";
import { normalizeAsrUtteranceWords } from "@/lib/video-agent/asr-word-normalization";
import type {
  VideoAgentTranscript,
  VideoAgentTranscriptSegment,
  VideoAgentTranscriptWord,
} from "@/lib/video-agent/domain/media";

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

/** Pure normalization shared by legacy transcript loading and VA5 evidence. */
export function normalizeAsrResult(
  assetId: string,
  raw: unknown,
): VideoAgentTranscript | null {
  if (!isRecord(raw) || !Array.isArray(raw.utterances)) return null;

  const result = raw as unknown as ASRResult;
  const words: VideoAgentTranscriptWord[] = [];
  const segments: VideoAgentTranscriptSegment[] = [];
  for (const utterance of result.utterances) {
    if (!isRecord(utterance)) continue;
    const segmentText =
      typeof utterance.text === "string" ? utterance.text.trim() : "";
    if (
      segmentText &&
      typeof utterance.start_time_ms === "number" &&
      Number.isFinite(utterance.start_time_ms) &&
      typeof utterance.end_time_ms === "number" &&
      Number.isFinite(utterance.end_time_ms) &&
      utterance.end_time_ms > utterance.start_time_ms
    ) {
      segments.push({
        text: segmentText,
        startMs: Math.max(0, Math.round(utterance.start_time_ms)),
        endMs: Math.max(0, Math.round(utterance.end_time_ms)),
      });
    }
    words.push(...normalizeAsrUtteranceWords(utterance.words, segmentText));
  }
  if (words.length === 0 && segments.length === 0) return null;
  return {
    assetId,
    language: typeof result.language === "string" ? result.language : null,
    durationMs:
      typeof result.duration_ms === "number" &&
      Number.isFinite(result.duration_ms) &&
      result.duration_ms >= 0
        ? Math.round(result.duration_ms)
        : null,
    text: typeof result.text === "string" ? result.text.trim() : "",
    words,
    segments,
  };
}

export function isValidNoSpeechAsrResult(raw: unknown) {
  if (!isRecord(raw) || !Array.isArray(raw.utterances)) return false;
  if (raw.utterances.length > 0) return false;
  return (
    (raw.text === undefined || raw.text === null || raw.text === "") &&
    (raw.duration_ms === undefined ||
      raw.duration_ms === null ||
      (typeof raw.duration_ms === "number" &&
        Number.isFinite(raw.duration_ms) &&
        raw.duration_ms >= 0))
  );
}
