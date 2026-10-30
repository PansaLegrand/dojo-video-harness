import {
  ALL_FORMATS,
  AudioSampleSink,
  BlobSource,
  Input,
  UrlSource,
} from "mediabunny";

const MAX_SAMPLE_BYTES = 8 * 1024 * 1024;

/** Peaks use source timestamps, including leading silence and decoder preroll. */
export function accumulateAudioPeaks(
  peaks: Float32Array,
  samples: Float32Array,
  timestamp: number,
  sampleRate: number,
  duration: number,
) {
  for (let index = 0; index < samples.length; index++) {
    const time = timestamp + index / sampleRate;
    if (time < 0 || time >= duration) continue;
    const bucket = Math.min(
      peaks.length - 1,
      Math.floor((time / duration) * peaks.length),
    );
    const value = Math.abs(samples[index]!);
    if (Number.isFinite(value)) peaks[bucket] = Math.max(peaks[bucket]!, value);
  }
}

/** Decode sequential bounded samples instead of a whole-file AudioBuffer. */
export async function readEditorAudioPeaks(
  source: Blob | string,
  signal: AbortSignal,
  onProgress?: (fraction: number) => void,
): Promise<number[]> {
  if (signal.aborted) throw signal.reason;
  const input = new Input({
    formats: ALL_FORMATS,
    source:
      typeof source === "string"
        ? new UrlSource(source, {
            maxCacheSize: 4 * 1024 * 1024,
            parallelism: 1,
            getRetryDelay: (attempt) => (attempt < 1 ? 0.25 : null),
          })
        : new BlobSource(source),
  });
  let timeoutError: Error | undefined;
  const timer = setTimeout(() => {
    timeoutError = new Error(
      "Waveform preparation timed out. Retry when the media is available.",
    );
    input.dispose();
  }, 60_000);
  const abort = () => input.dispose();
  signal.addEventListener("abort", abort, { once: true });
  try {
    const track = await input.getPrimaryAudioTrack();
    if (!track || !(await track.canDecode()))
      throw new Error("Waveform unavailable.");
    const duration = await track.computeDuration();
    if (!Number.isFinite(duration) || duration <= 0 || duration > 24 * 60 * 60)
      throw new Error("Waveform duration is unsupported.");
    const channels = await track.getNumberOfChannels();
    if (channels < 1 || channels > 8)
      throw new Error("Waveform channel count is unsupported.");
    const peaks = new Float32Array(240);
    let scratch = new Float32Array(0),
      count = 0;
    for await (const sample of new AudioSampleSink(track).samples(
      0,
      duration,
    )) {
      try {
        if (signal.aborted) throw signal.reason;
        if (timeoutError) throw timeoutError;
        if (
          sample.numberOfFrames * 4 > MAX_SAMPLE_BYTES ||
          sample.numberOfChannels > 8
        )
          throw new Error("Waveform sample exceeds the memory budget.");
        if (scratch.length < sample.numberOfFrames)
          scratch = new Float32Array(sample.numberOfFrames);
        const pcm = scratch.subarray(0, sample.numberOfFrames);
        for (let channel = 0; channel < sample.numberOfChannels; channel++) {
          sample.copyTo(pcm, { planeIndex: channel, format: "f32-planar" });
          accumulateAudioPeaks(
            peaks,
            pcm,
            sample.timestamp,
            sample.sampleRate,
            duration,
          );
        }
        onProgress?.(
          Math.min(
            1,
            Math.max(0, (sample.timestamp + sample.duration) / duration),
          ),
        );
      } finally {
        sample.close();
      }
      // Long tracks must not monopolize the UI event loop; only one PCM sample is retained.
      if (++count % 16 === 0)
        await new Promise<void>((resolve) => setTimeout(resolve, 0));
    }
    if (signal.aborted) throw signal.reason;
    if (timeoutError) throw timeoutError;
    return Array.from(peaks);
  } catch (error) {
    if (signal.aborted) throw signal.reason;
    if (timeoutError) throw timeoutError;
    throw error;
  } finally {
    clearTimeout(timer);
    signal.removeEventListener("abort", abort);
    input.dispose();
  }
}

export type PreviewAttempt<T> =
  | { source: string; status: "ready"; value: T }
  | { source: string; status: "failed"; error: string };
/** Failed URLs are retryable explicitly and automatically after source relinking. */
export class MediaPreviewAttempts<T> {
  private entries = new Map<string, PreviewAttempt<T>>();
  get(id: string, source: string) {
    const entry = this.entries.get(id);
    return entry?.source === source ? entry : undefined;
  }
  set(id: string, entry: PreviewAttempt<T>) {
    this.entries.set(id, entry);
  }
  retry(id: string) {
    this.entries.delete(id);
  }
  retain(ids: ReadonlySet<string>) {
    for (const id of this.entries.keys())
      if (!ids.has(id)) this.entries.delete(id);
  }
}
