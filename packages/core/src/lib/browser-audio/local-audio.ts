import type { Input } from "mediabunny";
import {
  encodePcm16,
  encodePcmFloat32,
  placePcmChunk,
  wavHeader,
  type WavSampleFormat,
} from "./pcm";

export type LocalAudioInfo = {
  duration: number;
  hasVideo: boolean;
  channels: number;
  sampleRate: number;
  audioStartTime: number;
};
export type LocalAudioLimits = {
  maxFileBytes: number;
  maxDurationSeconds: number;
  maxChannels: number;
  maxSourceSampleRate: number;
  maxPcmBytes: number;
};
export type LocalAudioErrorReason =
  | "file-too-large"
  | "too-long"
  | "no-audio"
  | "unsupported"
  | "decode-failed";
export class LocalAudioError extends Error {
  constructor(
    readonly reason: LocalAudioErrorReason,
    message: string,
  ) {
    super(message);
    this.name = "LocalAudioError";
  }
}
export function checkLocalAudioCancellation(signal: AbortSignal) {
  if (signal.aborted) throw new DOMException("Cancelled", "AbortError");
}

async function withInput<T>(
  file: Blob,
  signal: AbortSignal,
  limits: LocalAudioLimits,
  operation: (input: Input) => Promise<T>,
): Promise<T> {
  checkLocalAudioCancellation(signal);
  if (!file.size)
    throw new LocalAudioError(
      "decode-failed",
      "Choose a recording with an audio track.",
    );
  if (file.size > limits.maxFileBytes)
    throw new LocalAudioError(
      "file-too-large",
      "The file exceeds the local processing limit.",
    );
  const { Input, BlobSource, ALL_FORMATS } = await import("mediabunny");
  checkLocalAudioCancellation(signal);
  const input = new Input({
    formats: ALL_FORMATS,
    source: new BlobSource(file),
  });
  const abort = () => input.dispose();
  signal.addEventListener("abort", abort, { once: true });
  try {
    checkLocalAudioCancellation(signal);
    return await operation(input);
  } catch (error) {
    checkLocalAudioCancellation(signal);
    if (error instanceof LocalAudioError) throw error;
    throw new LocalAudioError(
      "decode-failed",
      "Could not read the recording. Try a supported audio or video file.",
    );
  } finally {
    signal.removeEventListener("abort", abort);
    input.dispose();
  }
}

async function readMetadata(
  input: Input,
  signal: AbortSignal,
  limits: LocalAudioLimits,
): Promise<LocalAudioInfo> {
  const track = await input.getPrimaryAudioTrack();
  checkLocalAudioCancellation(signal);
  if (!track)
    throw new LocalAudioError("no-audio", "This file has no audio track.");
  const video = await input.getPrimaryVideoTrack();
  const [
    audioDuration,
    videoDuration,
    channels,
    sampleRate,
    audioStartTime,
    canDecode,
  ] = await Promise.all([
    track.computeDuration(),
    video?.computeDuration() ?? 0,
    track.getNumberOfChannels(),
    track.getSampleRate(),
    track.getFirstTimestamp(),
    track.canDecode(),
  ]);
  checkLocalAudioCancellation(signal);
  const duration = Math.max(audioDuration, videoDuration);
  if (!Number.isFinite(duration) || duration <= 0)
    throw new LocalAudioError(
      "decode-failed",
      "Could not read a valid media duration.",
    );
  if (duration > limits.maxDurationSeconds)
    throw new LocalAudioError(
      "too-long",
      "The recording exceeds the local duration limit.",
    );
  if (
    !Number.isInteger(channels) ||
    channels < 1 ||
    channels > limits.maxChannels ||
    !Number.isInteger(sampleRate) ||
    sampleRate < 8000 ||
    sampleRate > limits.maxSourceSampleRate ||
    !Number.isFinite(audioStartTime)
  )
    throw new LocalAudioError(
      "unsupported",
      "Unsupported audio channel count or sample rate.",
    );
  if (!canDecode)
    throw new LocalAudioError(
      "unsupported",
      "Your browser cannot decode this audio format. Try a WAV, MP3, or another browser.",
    );
  return {
    duration,
    hasVideo: Boolean(video),
    channels,
    sampleRate,
    audioStartTime,
  };
}

export function inspectLocalAudio(
  file: Blob,
  signal: AbortSignal,
  limits: LocalAudioLimits,
): Promise<LocalAudioInfo> {
  return withInput(file, signal, limits, (input) =>
    readMetadata(input, signal, limits),
  );
}

/**
 * Only the chosen frame interval is decoded. Conversion seeks to its start,
 * trims decoder preroll, continuously resamples and rebases samples to that
 * interval. Its timestamp-aware null output avoids allocating leading gaps.
 */
export function decodeLocalAudio({
  file,
  signal,
  limits,
  sampleRate,
  outputChannels = "preserve",
  range,
  prerollSeconds = 0,
  onProgress,
}: {
  file: Blob;
  signal: AbortSignal;
  limits: LocalAudioLimits;
  sampleRate: number;
  outputChannels?: "preserve" | 1 | 2;
  /** Integer frames on the source media timeline at the target sample rate. */
  range?: { startFrame: number; endFrame: number };
  /** Opt in to at most 100ms of decoder warm-up; returned PCM stays on range. */
  prerollSeconds?: number;
  onProgress?: (percent: number) => void;
}) {
  if (!Number.isInteger(sampleRate) || sampleRate < 8000 || sampleRate > 96000)
    throw new LocalAudioError("unsupported", "Invalid output sample rate.");
  if (
    !Number.isFinite(prerollSeconds) ||
    prerollSeconds < 0 ||
    prerollSeconds > 0.1
  )
    throw new LocalAudioError("unsupported", "Invalid decoder preroll.");
  return withInput(file, signal, limits, async (input) => {
    const info = await readMetadata(input, signal, limits);
    const totalFrames = Math.ceil(info.duration * sampleRate);
    const startFrame = range?.startFrame ?? 0,
      endFrame = range?.endFrame ?? totalFrames;
    if (
      !Number.isSafeInteger(startFrame) ||
      !Number.isSafeInteger(endFrame) ||
      startFrame < 0 ||
      endFrame <= startFrame ||
      endFrame > totalFrames
    )
      throw new LocalAudioError("unsupported", "Invalid audio selection.");
    const numberOfChannels =
      outputChannels === "preserve" ? info.channels : outputChannels;
    const frames = endFrame - startFrame;
    if (
      frames * numberOfChannels * Float32Array.BYTES_PER_ELEMENT >
      limits.maxPcmBytes
    ) {
      throw new LocalAudioError(
        "too-long",
        "The selection exceeds the browser audio memory limit.",
      );
    }
    let decodeStart = startFrame / sampleRate - prerollSeconds;
    if (prerollSeconds > 0 && info.sampleRate !== sampleRate) {
      // A trimmed resampler must use the same sample grid as a full decode,
      // including fractional negative AAC priming. Advance by whole samples at
      // both rates, shortening (never extending) the requested warm-up interval.
      let commonRate = info.sampleRate,
        divisor = sampleRate;
      while (divisor) {
        const next = commonRate % divisor;
        commonRate = divisor;
        divisor = next;
      }
      if (1 / commonRate > Math.min(0.02, prerollSeconds / 2))
        throw new LocalAudioError(
          "unsupported",
          "Unsupported audio resampling grid.",
        );
      decodeStart =
        info.audioStartTime +
        Math.ceil((decodeStart - info.audioStartTime) * commonRate - 1e-7) /
          commonRate;
    }
    const offsetSeconds = startFrame / sampleRate - decodeStart;
    // Two native samples supply the interpolation neighbor at the right edge.
    // placePcmChunk still copies only the exact requested output array.
    const decodeEnd = Math.min(
      info.duration,
      endFrame / sampleRate +
        (prerollSeconds > 0 && info.sampleRate !== sampleRate
          ? 2 / info.sampleRate
          : 0),
    );
    const channels = Array.from(
      { length: numberOfChannels },
      () => new Float32Array(frames),
    );
    const { Conversion, Output, NullTarget, Mp4OutputFormat } = await import(
      "mediabunny"
    );
    checkLocalAudioCancellation(signal);
    const output = new Output({
      target: new NullTarget(),
      format: new Mp4OutputFormat({ fastStart: "fragmented" }),
    });
    let writtenFrames = 0;
    const conversion = await Conversion.init({
      input,
      output,
      tracks: "primary",
      video: { discard: true },
      showWarnings: false,
      trim: { start: decodeStart, end: decodeEnd },
      audio: {
        codec: "pcm-f32",
        sampleRate,
        numberOfChannels,
        forceTranscode: true,
        process(sample) {
          checkLocalAudioCancellation(signal);
          if (
            sample.sampleRate !== sampleRate ||
            sample.numberOfChannels !== numberOfChannels ||
            sample.numberOfFrames > sampleRate * 10
          ) {
            throw new LocalAudioError(
              "decode-failed",
              "The recording uses an unsupported audio format.",
            );
          }
          const chunk = Array.from(
            { length: numberOfChannels },
            (_, planeIndex) => {
              const data = new Float32Array(sample.numberOfFrames);
              sample.copyTo(data, { planeIndex, format: "f32-planar" });
              return data;
            },
          );
          writtenFrames = Math.max(
            writtenFrames,
            placePcmChunk(
              channels,
              chunk,
              sample.timestamp - offsetSeconds,
              sampleRate,
            ),
          );
          onProgress?.((writtenFrames / frames) * 100);
          // The unused mux output rejects even sub-nanosecond negative dust.
          // Normalize it after PCM placement; never move audible samples.
          if (
            prerollSeconds > 0 &&
            sample.timestamp < 0 &&
            sample.timestamp > -1e-9
          )
            sample.setTimestamp(0);
          return sample;
        },
      },
    });
    let cancellation: Promise<void> | undefined;
    const cancel = () =>
      (cancellation ??= conversion.cancel().catch(() => undefined));
    const abort = () => {
      void cancel();
    };
    signal.addEventListener("abort", abort, { once: true });
    try {
      checkLocalAudioCancellation(signal);
      if (
        !conversion.isValid ||
        !conversion.utilizedTracks.some((track) => track.isAudioTrack())
      ) {
        throw new LocalAudioError(
          "unsupported",
          "Your browser cannot decode this audio format.",
        );
      }
      await conversion.execute();
      checkLocalAudioCancellation(signal);
      // A selected interval entirely inside a legitimate track gap is silence.
      if (!writtenFrames && !range)
        throw new LocalAudioError(
          "no-audio",
          "This file has no playable audio samples.",
        );
      onProgress?.(100);
      checkLocalAudioCancellation(signal);
      return { info, channels, sampleRate, range: { startFrame, endFrame } };
    } catch (error) {
      await cancel();
      checkLocalAudioCancellation(signal);
      throw error;
    } finally {
      signal.removeEventListener("abort", abort);
    }
  });
}

/** Exact-duration PCM WAV with short encoding windows and responsive cancellation. */
export async function encodeLocalWav(
  channels: Float32Array[],
  sampleRate: number,
  signal: AbortSignal,
  onProgress?: (percent: number) => void,
  format: WavSampleFormat = "pcm16",
): Promise<Blob> {
  checkLocalAudioCancellation(signal);
  const frames = channels[0]?.length ?? 0;
  const sampleBytes = format === "float32" ? 4 : 2;
  if (
    !frames ||
    channels.length > 2 ||
    !Number.isInteger(sampleRate) ||
    sampleRate < 8000 ||
    sampleRate > 96000 ||
    frames * channels.length * sampleBytes > 0xffffffff - 36 ||
    channels.some((channel) => channel.length !== frames)
  )
    throw new LocalAudioError("unsupported", "Invalid PCM audio.");
  const parts: BlobPart[] = [
    wavHeader(frames, channels.length, sampleRate, format),
  ];
  for (let offset = 0; offset < frames; offset += sampleRate * 2) {
    checkLocalAudioCancellation(signal);
    const length = Math.min(sampleRate * 2, frames - offset);
    parts.push(
      format === "float32"
        ? encodePcmFloat32(channels, offset, length)
        : encodePcm16(channels, offset, length),
    );
    onProgress?.(((offset + length) / frames) * 100);
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
  checkLocalAudioCancellation(signal);
  return new Blob(parts, { type: "audio/wav" });
}
