import {
  checkSilenceCancellation,
  SILENCE_LIMITS,
  silenceDurationFrames,
  SilenceError,
  type SilenceSourceInfo,
} from "./types";

const inspected = new WeakMap<Blob, SilenceSourceInfo>();

/** Primary video determines the video timeline; audio-only files omit leading container delay. */
export async function inspectSilenceSource(
  file: Blob,
  signal: AbortSignal,
): Promise<SilenceSourceInfo> {
  checkSilenceCancellation(signal);
  if (!Number.isSafeInteger(file.size) || file.size <= 0)
    throw new SilenceError(
      "decode-failed",
      "Choose a recording with an audio track.",
    );
  const cached = inspected.get(file);
  if (cached) return cached;
  const { Input, BlobSource, ALL_FORMATS } = await import("mediabunny");
  checkSilenceCancellation(signal);
  const input = new Input({
    source: new BlobSource(file),
    formats: ALL_FORMATS,
  });
  const abort = () => input.dispose();
  signal.addEventListener("abort", abort, { once: true });
  try {
    const [audio, video] = await Promise.all([
      input.getPrimaryAudioTrack(),
      input.getPrimaryVideoTrack(),
    ]);
    checkSilenceCancellation(signal);
    if (!audio)
      throw new SilenceError("no-audio", "This file has no audio track.");
    const [
      audioStartTime,
      audioEndTime,
      channels,
      sampleRate,
      canDecode,
      videoStartTime,
      videoEndTime,
    ] = await Promise.all([
      audio.getFirstTimestamp(),
      audio.computeDuration(),
      audio.getNumberOfChannels(),
      audio.getSampleRate(),
      audio.canDecode(),
      video?.getFirstTimestamp(),
      video?.computeDuration(),
    ]);
    checkSilenceCancellation(signal);
    if (
      ![audioStartTime, audioEndTime].every(Number.isFinite) ||
      !Number.isInteger(channels) ||
      channels < 1 ||
      channels > 2 ||
      !Number.isInteger(sampleRate) ||
      sampleRate < 8000 ||
      sampleRate > SILENCE_LIMITS.maxSourceSampleRate ||
      !canDecode
    ) {
      throw new SilenceError(
        "unsupported",
        "Choose a supported mono or stereo recording with a sample rate between 8 and 96 kHz.",
      );
    }
    const sourceStart = Math.max(0, video ? videoStartTime! : audioStartTime);
    const sourceEnd = video ? videoEndTime! : audioEndTime;
    const duration = sourceEnd - sourceStart;
    if (
      ![sourceStart, sourceEnd, duration].every(Number.isFinite) ||
      duration <= 0 ||
      sourceEnd <= 0
    ) {
      throw new SilenceError(
        "decode-failed",
        "Could not read a valid recording timeline.",
      );
    }
    if (
      ![
        silenceDurationFrames(sourceStart),
        silenceDurationFrames(sourceEnd),
        silenceDurationFrames(duration),
      ].every(Number.isSafeInteger)
    ) {
      throw new SilenceError(
        "decode-failed",
        "Could not read a sample-accurate recording timeline.",
      );
    }
    const info: SilenceSourceInfo = {
      sourceFile: file,
      kind: video ? "video" : "audio",
      hasVideo: Boolean(video),
      duration,
      sourceStart,
      sourceEnd,
      channels: channels as 1 | 2,
      sampleRate,
      audioStartTime,
      audioEndTime,
      ...(video ? { videoStartTime, videoEndTime } : {}),
    };
    inspected.set(file, info);
    return info;
  } catch (error) {
    checkSilenceCancellation(signal);
    if (error instanceof SilenceError) throw error;
    throw new SilenceError(
      "decode-failed",
      "Could not read the recording. Try a supported audio or video file.",
    );
  } finally {
    signal.removeEventListener("abort", abort);
    input.dispose();
  }
}
