import type {
  AudioCutPlan,
  AudioCutSegment,
} from "@/lib/browser-video/audio-cutter";

export const SILENCE_SAMPLE_RATE = 48_000;
/** Ignore floating subtraction dust without truncating genuine fractional samples. */
export function silenceDurationFrames(duration: number): number {
  return Math.ceil(duration * SILENCE_SAMPLE_RATE - 1e-7);
}
export const SILENCE_LIMITS = Object.freeze({
  // The shared decoder accepts Infinity to disable product admission limits.
  // Available browser memory still determines whether decoding can complete.
  maxFileBytes: Infinity,
  maxDurationSeconds: Infinity,
  maxChannels: 2,
  maxSourceSampleRate: 96_000,
  maxPcmBytes: Infinity,
  maxCuts: 300,
});

export type SilenceSettings = {
  thresholdDb: number;
  minSilenceMs: number;
  paddingMs: number;
};
export const SILENCE_PRESETS = Object.freeze({
  natural: { thresholdDb: -40, minSilenceMs: 700, paddingMs: 180 },
  balanced: { thresholdDb: -35, minSilenceMs: 500, paddingMs: 120 },
  tight: { thresholdDb: -30, minSilenceMs: 350, paddingMs: 80 },
}) satisfies Record<string, SilenceSettings>;

export type SilenceSourceInfo = {
  sourceFile: Blob;
  kind: "audio" | "video";
  hasVideo: boolean;
  /** Duration and cut frames are relative to sourceStart, never to file zero. */
  duration: number;
  sourceStart: number;
  sourceEnd: number;
  channels: 1 | 2;
  sampleRate: number;
  audioStartTime: number;
  audioEndTime: number;
  videoStartTime?: number;
  videoEndTime?: number;
};
export type SilenceBin = { startFrame: number; endFrame: number; db: number };
export type SilenceAnalysis = {
  info: SilenceSourceInfo;
  channels: Float32Array[];
  sampleRate: typeof SILENCE_SAMPLE_RATE;
  durationFrames: number;
  bins: SilenceBin[];
  waveform: { min: number; max: number }[];
};
export type SilenceCut = {
  id: string;
  startFrame: number;
  endFrame: number;
  enabled: boolean;
};
export type SilencePlan = {
  /** Identity binding prevents using a stale plan after choosing another file. */
  analysis: SilenceAnalysis;
  audioPlan: AudioCutPlan;
  segments: AudioCutSegment[];
  state: "ready" | "no-cuts" | "all-silence";
  removedFrames: number;
};
export type SilenceProgress = {
  stage: "inspecting" | "decoding" | "analyzing";
  percent: number;
};
export class SilenceError extends Error {
  constructor(
    readonly reason:
      | "no-audio"
      | "unsupported"
      | "decode-failed"
      | "too-many-cuts"
      | "invalid-settings"
      | "invalid-plan",
    message: string,
  ) {
    super(message);
    this.name = "SilenceError";
  }
}
export function checkSilenceCancellation(signal: AbortSignal) {
  if (signal.aborted) throw new DOMException("Cancelled", "AbortError");
}
