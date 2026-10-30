/** Browser PCM uses normalized samples. Invalid and out-of-range values saturate safely. */
const finiteSample = (sample: number) =>
  Number.isFinite(sample) ? Math.max(-1, Math.min(1, sample)) : 0;
export type WavSampleFormat = "pcm16" | "float32";

export function wavHeader(
  frames: number,
  channels: number,
  sampleRate: number,
  format: WavSampleFormat = "pcm16",
): ArrayBuffer {
  const header = new ArrayBuffer(44),
    view = new DataView(header);
  const text = (offset: number, value: string) => {
    for (let i = 0; i < value.length; i++)
      view.setUint8(offset + i, value.charCodeAt(i));
  };
  const sampleBytes = format === "float32" ? 4 : 2;
  const bytes = frames * channels * sampleBytes;
  text(0, "RIFF");
  view.setUint32(4, 36 + bytes, true);
  text(8, "WAVE");
  text(12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, format === "float32" ? 3 : 1, true);
  view.setUint16(22, channels, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * channels * sampleBytes, true);
  view.setUint16(32, channels * sampleBytes, true);
  view.setUint16(34, sampleBytes * 8, true);
  text(36, "data");
  view.setUint32(40, bytes, true);
  return header;
}

/** Copy decoded PCM onto a timeline. Negative preroll and samples beyond its end are cropped. */
export function placePcmChunk(
  target: Float32Array[],
  source: Float32Array[],
  timestamp: number,
  sampleRate: number,
): number {
  if (
    !target.length ||
    target.length !== source.length ||
    !Number.isFinite(timestamp) ||
    !Number.isInteger(sampleRate) ||
    sampleRate <= 0 ||
    source.some((channel) => channel.length !== source[0].length) ||
    target.some((channel) => channel.length !== target[0].length)
  )
    throw new Error("Invalid PCM timeline");
  const start = Math.round(timestamp * sampleRate);
  const sourceStart = Math.max(0, -start),
    targetStart = Math.max(0, start);
  const count = Math.min(
    source[0].length - sourceStart,
    target[0].length - targetStart,
  );
  if (count > 0)
    for (let channel = 0; channel < target.length; channel++) {
      target[channel].set(
        source[channel].subarray(sourceStart, sourceStart + count),
        targetStart,
      );
    }
  return Math.min(target[0].length, Math.max(0, start + source[0].length));
}

/** Interleaved 16-bit PCM, saturating rather than wrapping clipping/nonfinite values. */
export function encodePcm16(
  channels: Float32Array[],
  offset: number,
  frames: number,
): ArrayBuffer {
  const data = new ArrayBuffer(frames * channels.length * 2),
    view = new DataView(data);
  for (let frame = 0; frame < frames; frame++)
    for (let channel = 0; channel < channels.length; channel++) {
      const value = finiteSample(channels[channel][offset + frame]);
      view.setInt16(
        (frame * channels.length + channel) * 2,
        Math.round(value * (value < 0 ? 32768 : 32767)),
        true,
      );
    }
  return data;
}

/** Float WAV preserves finite over-full-scale samples so separated stems still sum to the input. */
export function encodePcmFloat32(
  channels: Float32Array[],
  offset: number,
  frames: number,
): ArrayBuffer {
  const data = new ArrayBuffer(frames * channels.length * 4),
    view = new DataView(data);
  for (let frame = 0; frame < frames; frame++)
    for (let channel = 0; channel < channels.length; channel++) {
      const value = channels[channel][offset + frame];
      view.setFloat32(
        (frame * channels.length + channel) * 4,
        Number.isFinite(value) ? value : 0,
        true,
      );
    }
  return data;
}
