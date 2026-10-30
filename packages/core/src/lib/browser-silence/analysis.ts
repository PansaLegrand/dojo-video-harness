import { decodeLocalAudio } from "@/lib/browser-audio/local-audio";
import { audioWaveform } from "@/lib/browser-video/audio-cutter";
import { inspectSilenceSource } from "./inspect";
import {
  checkSilenceCancellation,
  SILENCE_LIMITS,
  SILENCE_SAMPLE_RATE,
  silenceDurationFrames,
  SilenceError,
  type SilenceAnalysis,
  type SilenceBin,
  type SilenceProgress,
} from "./types";

/** 10 ms peak bins retain quiet transients and never cancel opposite-polarity stereo. */
export async function analyzeSilencePcm(
  channels: Float32Array[],
  signal: AbortSignal,
  onProgress?: (percent: number) => void,
): Promise<SilenceBin[]> {
  checkSilenceCancellation(signal);
  const frames = channels[0]?.length ?? 0;
  if (
    !Number.isSafeInteger(frames) ||
    frames <= 0 ||
    channels.length > 2 ||
    channels.some((channel) => channel.length !== frames)
  ) {
    throw new SilenceError("decode-failed", "Invalid decoded audio.");
  }
  const bins: SilenceBin[] = [];
  const windowFrames = SILENCE_SAMPLE_RATE / 100;
  for (let startFrame = 0; startFrame < frames; startFrame += windowFrames) {
    const endFrame = Math.min(frames, startFrame + windowFrames);
    let peak = 0;
    for (const channel of channels)
      for (let frame = startFrame; frame < endFrame; frame++) {
        const value = channel[frame];
        if (!Number.isFinite(value))
          throw new SilenceError(
            "decode-failed",
            "The recording contains invalid audio samples.",
          );
        peak = Math.max(peak, Math.abs(value));
      }
    bins.push({
      startFrame,
      endFrame,
      db: Math.max(-120, 20 * Math.log10(peak || 1e-6)),
    });
    if (bins.length % 100 === 0 || endFrame === frames) {
      checkSilenceCancellation(signal);
      onProgress?.((endFrame / frames) * 100);
      await new Promise((resolve) => setTimeout(resolve, 0));
      checkSilenceCancellation(signal);
    }
  }
  return bins;
}

async function silenceWaveform(channels: Float32Array[], signal: AbortSignal) {
  const frames = channels[0].length,
    columns = Math.min(800, frames);
  const waveform: { min: number; max: number }[] = [];
  // Reuse the peak-preserving waveform primitive in bounded groups so a
  // long recording can still be cancelled during this final scan.
  for (let column = 0; column < columns; column += 64) {
    checkSilenceCancellation(signal);
    const endColumn = Math.min(columns, column + 64);
    const start = Math.floor((column * frames) / columns),
      end = Math.floor((endColumn * frames) / columns);
    waveform.push(
      ...audioWaveform(
        channels.map((channel) => channel.subarray(start, end)),
        endColumn - column,
      ),
    );
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
  checkSilenceCancellation(signal);
  return waveform;
}

export async function analyzeSilence({
  file,
  signal,
  onProgress,
}: {
  file: Blob;
  signal: AbortSignal;
  onProgress?: (progress: SilenceProgress) => void;
}): Promise<SilenceAnalysis> {
  onProgress?.({ stage: "inspecting", percent: 0 });
  const info = await inspectSilenceSource(file, signal);
  const durationFrames = silenceDurationFrames(info.duration);
  // Decode an absolute timestamp range, allocating only the bounded canonical
  // interval. A delayed container PTS is not recording duration or leading PCM.
  const startFrame = Math.round(info.sourceStart * SILENCE_SAMPLE_RATE);
  const endFrame = Math.min(
    silenceDurationFrames(info.sourceEnd),
    startFrame + durationFrames,
  );
  const decoded = await decodeLocalAudio({
    file,
    signal,
    sampleRate: SILENCE_SAMPLE_RATE,
    limits: SILENCE_LIMITS,
    range: { startFrame, endFrame },
    onProgress: (percent) => onProgress?.({ stage: "decoding", percent }),
  });
  checkSilenceCancellation(signal);
  const channels = decoded.channels.map((channel) => {
    if (channel.length === durationFrames) return channel;
    const normalized = new Float32Array(durationFrames);
    normalized.set(channel.subarray(0, durationFrames));
    return normalized;
  });
  const bins = await analyzeSilencePcm(channels, signal, (percent) =>
    onProgress?.({ stage: "analyzing", percent }),
  );
  checkSilenceCancellation(signal);
  const waveform = await silenceWaveform(channels, signal);
  checkSilenceCancellation(signal);
  return {
    info,
    channels,
    sampleRate: SILENCE_SAMPLE_RATE,
    durationFrames,
    bins,
    waveform,
  };
}
