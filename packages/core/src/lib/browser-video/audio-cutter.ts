import { wavHeader } from "@/lib/browser-audio/pcm";
import { readFadeSource } from "./fade-source";

export type AudioCutMode = "keep" | "remove";
export type AudioCutSegment = {
  sourceStart: number;
  sourceEnd: number;
  outputStart: number;
  outputEnd: number;
};
export type AudioCutPlan = {
  sampleRate: number;
  totalFrames: number;
  fadeInFrames: number;
  fadeOutFrames: number;
  joinFadeFrames: number;
  segments: AudioCutSegment[];
};

export function planAudioCut({
  sourceFrames,
  sampleRate,
  start,
  end,
  mode,
  fadeIn,
  fadeOut,
}: {
  sourceFrames: number;
  sampleRate: number;
  start: number;
  end: number;
  mode: AudioCutMode;
  fadeIn: number;
  fadeOut: number;
}): AudioCutPlan {
  if (
    (mode !== "keep" && mode !== "remove") ||
    !Number.isSafeInteger(sourceFrames) ||
    sourceFrames <= 0 ||
    !Number.isInteger(sampleRate) ||
    sampleRate < 8000 ||
    sampleRate > 96000 ||
    ![start, end, fadeIn, fadeOut].every(Number.isFinite) ||
    start < 0 ||
    end <= start ||
    end > sourceFrames / sampleRate + 1e-7 ||
    fadeIn < 0 ||
    fadeOut < 0
  )
    throw new Error("Invalid audio selection");
  const first = Math.max(0, Math.round(start * sampleRate));
  const last = Math.min(sourceFrames, Math.round(end * sampleRate));
  if (last <= first) throw new Error("Empty audio selection");
  const ranges =
    mode === "keep"
      ? [[first, last]]
      : [
          [0, first],
          [last, sourceFrames],
        ];
  let totalFrames = 0;
  const segments: AudioCutSegment[] = ranges
    .filter(([a, b]) => b > a)
    .map(([sourceStart, sourceEnd]) => {
      const outputStart = totalFrames;
      totalFrames += sourceEnd - sourceStart;
      return { sourceStart, sourceEnd, outputStart, outputEnd: totalFrames };
    });
  const fadeInFrames = Math.round(fadeIn * sampleRate),
    fadeOutFrames = Math.round(fadeOut * sampleRate);
  if (!totalFrames || fadeInFrames + fadeOutFrames > totalFrames)
    throw new Error("Invalid audio fades");
  return {
    sampleRate,
    totalFrames,
    fadeInFrames,
    fadeOutFrames,
    joinFadeFrames: Math.round(0.005 * sampleRate),
    segments,
  };
}

/** Draw a bounded min/max waveform, preserving brief peaks rather than averaging them away. */
export function audioWaveform(
  channels: Float32Array[],
  columns = 800,
): { min: number; max: number }[] {
  if (
    !channels.length ||
    !channels[0].length ||
    !Number.isInteger(columns) ||
    columns < 1 ||
    columns > 2048
  )
    return [];
  const frames = channels[0].length;
  return Array.from({ length: Math.min(columns, frames) }, (_, index) => {
    const count = Math.min(columns, frames),
      first = Math.floor((index * frames) / count),
      last = Math.floor(((index + 1) * frames) / count);
    let min = 0,
      max = 0;
    for (const channel of channels)
      for (let frame = first; frame < last; frame++) {
        min = Math.min(min, channel[frame] ?? 0);
        max = Math.max(max, channel[frame] ?? 0);
      }
    return { min, max };
  });
}

/** The same integer-frame plan drives all formats; only the final encoding differs. */
export function cutAudioWindow(
  channels: Float32Array[],
  plan: AudioCutPlan,
  offset: number,
  length: number,
): Float32Array[] {
  if (
    !Number.isSafeInteger(offset) ||
    offset < 0 ||
    !Number.isSafeInteger(length) ||
    length < 0 ||
    offset + length > plan.totalFrames
  )
    throw new Error("Invalid audio window");
  if (
    !channels.length ||
    channels.length > 2 ||
    channels.some(
      (channel) =>
        channel.length <
        Math.max(...plan.segments.map((segment) => segment.sourceEnd)),
    )
  )
    throw new Error("Invalid audio channels");
  const output = channels.map(() => new Float32Array(length));
  for (let index = 0; index < plan.segments.length; index++) {
    const segment = plan.segments[index];
    const first = Math.max(offset, segment.outputStart),
      last = Math.min(offset + length, segment.outputEnd);
    const joinFrames = Math.min(
      plan.joinFadeFrames,
      Math.floor((segment.outputEnd - segment.outputStart) / 2),
    );
    for (let frame = first; frame < last; frame++) {
      let gain = 1;
      if (plan.fadeInFrames) gain *= Math.min(1, frame / plan.fadeInFrames);
      if (plan.fadeOutFrames)
        gain *= Math.min(
          1,
          (plan.totalFrames - 1 - frame) / plan.fadeOutFrames,
        );
      if (joinFrames && index > 0)
        gain *= Math.min(1, (frame - segment.outputStart) / joinFrames);
      if (joinFrames && index < plan.segments.length - 1)
        gain *= Math.min(1, (segment.outputEnd - 1 - frame) / joinFrames);
      const sourceFrame = segment.sourceStart + frame - segment.outputStart;
      for (let channel = 0; channel < channels.length; channel++)
        output[channel][frame - offset] =
          (channels[channel][sourceFrame] ?? 0) * gain;
    }
  }
  return output;
}

export async function readAudioCutterSource(
  file: File,
  url: string,
  signal: AbortSignal,
): Promise<AudioBuffer> {
  if (
    !file.type.startsWith("audio/") &&
    !/\.(mp3|wav|m4a|aac|ogg|flac|aiff|aif|opus)$/i.test(file.name)
  )
    throw new Error("Choose an audio file");
  const source = await readFadeSource(file, url, signal);
  if (source.kind !== "audio") throw new Error("Choose an audio file");
  return source.buffer;
}

function cancelled(signal: AbortSignal) {
  if (signal.aborted) throw new DOMException("Cancelled", "AbortError");
}

export async function exportCutAudio(
  buffer: Pick<
    AudioBuffer,
    "numberOfChannels" | "sampleRate" | "getChannelData"
  >,
  plan: AudioCutPlan,
  format: "wav" | "mp3",
  signal: AbortSignal,
  progress: (percent: number) => void,
): Promise<Blob> {
  cancelled(signal);
  const channels = Array.from(
    { length: buffer.numberOfChannels },
    (_, channel) => buffer.getChannelData(channel),
  );
  const windowSize = Math.round(buffer.sampleRate * 2);
  const windows = function* () {
    for (let offset = 0; offset < plan.totalFrames; offset += windowSize) {
      yield { offset, length: Math.min(windowSize, plan.totalFrames - offset) };
    }
  };
  if (format === "wav") {
    const parts: BlobPart[] = [
      wavHeader(plan.totalFrames, channels.length, buffer.sampleRate),
    ];
    for (const { offset, length } of windows()) {
      cancelled(signal);
      const samples = cutAudioWindow(channels, plan, offset, length);
      const pcm = new ArrayBuffer(length * channels.length * 2),
        view = new DataView(pcm);
      for (let frame = 0; frame < length; frame++)
        for (let channel = 0; channel < channels.length; channel++) {
          const sample = Math.max(-1, Math.min(1, samples[channel][frame]));
          view.setInt16(
            (frame * channels.length + channel) * 2,
            Math.round(sample * (sample < 0 ? 32768 : 32767)),
            true,
          );
        }
      parts.push(pcm);
      progress(((offset + length) / plan.totalFrames) * 100);
      await new Promise((resolve) => setTimeout(resolve, 0));
    }
    cancelled(signal);
    return new Blob(parts, { type: "audio/wav" });
  }
  const {
    Output,
    BufferTarget,
    Mp3OutputFormat,
    AudioBufferSource,
    canEncodeAudio,
  } = await import("mediabunny");
  if (!(await canEncodeAudio("mp3"))) {
    const { registerMp3Encoder } = await import("@mediabunny/mp3-encoder");
    registerMp3Encoder();
  }
  cancelled(signal);
  const output = new Output({
    format: new Mp3OutputFormat(),
    target: new BufferTarget(),
  });
  const source = new AudioBufferSource({ codec: "mp3", bitrate: 192_000 });
  output.addAudioTrack(source);
  const abort = () => {
    void output.cancel().catch(() => undefined);
  };
  signal.addEventListener("abort", abort, { once: true });
  try {
    cancelled(signal);
    await output.start();
    for (const { offset, length } of windows()) {
      cancelled(signal);
      const samples = cutAudioWindow(channels, plan, offset, length);
      const chunk = new AudioBuffer({
        length,
        sampleRate: buffer.sampleRate,
        numberOfChannels: channels.length,
      });
      samples.forEach((data, channel) => chunk.copyToChannel(data, channel));
      await source.add(chunk);
      progress(((offset + length) / plan.totalFrames) * 100);
    }
    await output.finalize();
    cancelled(signal);
    return new Blob([output.target.buffer!], { type: "audio/mpeg" });
  } catch (error) {
    if (!signal.aborted) await output.cancel().catch(() => undefined);
    cancelled(signal);
    throw error;
  } finally {
    signal.removeEventListener("abort", abort);
  }
}
