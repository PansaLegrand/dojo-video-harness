import { AudioSample, AudioSampleSource, BufferTarget, Mp4OutputFormat, Output, Input, BlobSource, ALL_FORMATS, AudioSampleSink, EncodedPacketSink, type Quality } from "mediabunny";
import { disposeMediaInputSafely } from "@motionforge/renderer-canvas2d";
import { AacTimingError } from "./aac-timing-error";

export type AacEncoderTiming = {
  sampleRate: number; numberOfChannels: number; primingSamples: number; timestampLeadSamples: number;
  correlation: number; confidenceMargin: number; encoderConfig: AudioEncoderConfig;
};
const MAX_PROBE_BYTES = 1024 * 1024;
const PROBE_FRAMES = 16384;
const PROBE_ORIGIN_SECONDS = 1;
function fail(message: string): never { throw new AacTimingError("AAC_TIMING_UNVERIFIED", message); }
function aborted(signal?: AbortSignal) { if (signal?.aborted) throw signal.reason ?? new DOMException("AAC timing check cancelled.", "AbortError"); }
export function audioEncoderConfigKey(config: AudioEncoderConfig): string {
  const extra = config as AudioEncoderConfig & { aac?: { format?: string } };
  return JSON.stringify([config.codec, config.sampleRate, config.numberOfChannels, config.bitrate, config.bitrateMode, extra.aac?.format]);
}

/** Pure numerical gate; synthetic nonperiodic content avoids tone-cycle ambiguity. */
export function estimateAacPriming(reference: Float32Array, decoded: Float32Array, sampleRate: number, maxDelay: number) {
  const start = 1024, end = reference.length - 1024;
  if (end <= start || decoded.length < reference.length + maxDelay) fail("AAC timing probe returned insufficient decoded audio.");
  const score = (lag: number, stride: number) => {
    let dot = 0, left = 0, right = 0;
    for (let i = start; i < end; i += stride) { const a = reference[i]!, b = decoded[i + lag]!; dot += a * b; left += a * a; right += b * b; }
    return left > 0 && right > 0 ? dot / Math.sqrt(left * right) : -1;
  };
  let delay = 0, correlation = -1;
  for (let lag = 0; lag <= maxDelay; lag += 4) { const value = score(lag, 4); if (value > correlation) { delay = lag; correlation = value; } }
  const coarse = delay; correlation = -1;
  for (let lag = Math.max(0, coarse - 4); lag <= Math.min(maxDelay, coarse + 4); lag++) { const value = score(lag, 1); if (value > correlation) { delay = lag; correlation = value; } }
  let competitor = -1; const separation = Math.max(8, Math.round(sampleRate * .001));
  for (let lag = 0; lag <= maxDelay; lag += 4) if (Math.abs(lag - delay) > separation) competitor = Math.max(competitor, score(lag, 4));
  const confidenceMargin = correlation - competitor;
  if (!Number.isFinite(correlation) || correlation < .98 || confidenceMargin < .02 || delay >= maxDelay - 4) fail("This browser's AAC encoder delay could not be measured reliably.");
  return { primingSamples: delay, correlation, confidenceMargin };
}

/**
 * Bounded, per-export calibration of the actual public Mbi AAC pipeline. No user
 * audio or fixed platform delay is used. The separate probe never enters output.
 */
export async function measureAacEncoderTiming(options: { sampleRate: number; numberOfChannels: number; bitrate: number | Quality; signal?: AbortSignal }): Promise<AacEncoderTiming> {
  const { sampleRate, numberOfChannels, bitrate, signal } = options; aborted(signal);
  if (!Number.isInteger(sampleRate) || sampleRate < 8000 || sampleRate > 96000 || ![1, 2].includes(numberOfChannels)) fail("AAC timing calibration supports bounded mono/stereo encoder profiles.");
  const maxDelay = Math.min(16384, Math.ceil(sampleRate / 4)), decoded = new Float32Array(PROBE_FRAMES + maxDelay + 8192);
  const reference = new Float32Array(PROBE_FRAMES), data = new Float32Array(PROBE_FRAMES * numberOfChannels);
  const duration = PROBE_FRAMES / sampleRate;
  for (let i = 0; i < PROBE_FRAMES; i++) { const time = i / sampleRate, fade = Math.max(0, Math.min(1, i / 256, (PROBE_FRAMES - 1 - i) / 256)); reference[i] = .2 * fade * Math.sin(2 * Math.PI * (170 * time + 600 / duration * time * time)); }
  for (let channel = 0; channel < numberOfChannels; channel++) data.set(reference, channel * PROBE_FRAMES);
  const target = new BufferTarget(), output = new Output({ target, format: new Mp4OutputFormat() });
  let config: AudioEncoderConfig | undefined, firstNative: number | undefined, encodedBytes = 0, encodedPackets = 0, input: Input | undefined;
  let sample: AudioSample | undefined, cancelled = false, timeoutError: Error | undefined;
  const cancel = () => { cancelled = true; void output.cancel().catch(() => {}); if (input) disposeMediaInputSafely(input); };
  const timeout = setTimeout(() => { timeoutError = new AacTimingError("AAC_TIMING_UNVERIFIED", "AAC timing calibration timed out in this browser."); cancel(); }, 10000);
  signal?.addEventListener("abort", cancel, { once: true });
  const check = () => { aborted(signal); if (timeoutError) throw timeoutError; if (cancelled) fail("AAC timing calibration was interrupted."); };
  try {
    const source = new AudioSampleSource({ codec: "aac", bitrate,
      onEncoderConfig: value => { config = structuredClone(value); },
      onEncodedPacket: packet => {
        firstNative ??= packet.timestamp; encodedBytes += packet.byteLength; encodedPackets++;
        if (encodedBytes > MAX_PROBE_BYTES || encodedPackets > 256) { timeoutError = new AacTimingError("AAC_TIMING_BUDGET", "AAC timing probe exceeded its encoded-media budget."); cancel(); }
      },
    });
    output.addAudioTrack(source); await output.start(); check();
    sample = new AudioSample({ data, format: "f32-planar", sampleRate, numberOfChannels, timestamp: PROBE_ORIGIN_SECONDS });
    await source.add(sample); sample.close(); sample = undefined; check(); await output.finalize(); check();
    if (!target.buffer || target.buffer.byteLength > MAX_PROBE_BYTES || firstNative === undefined || !config || config.sampleRate !== sampleRate || config.numberOfChannels !== numberOfChannels || !config.codec.startsWith("mp4a.40.")) fail("AAC timing probe did not produce the requested encoder profile.");
    input = new Input({ source: new BlobSource(new Blob([target.buffer], { type: "audio/mp4" })), formats: ALL_FORMATS });
    const track = await input.getPrimaryAudioTrack(); check();
    if (!track || track.sampleRate !== sampleRate || track.numberOfChannels !== numberOfChannels) fail("AAC timing probe changed its sample rate or channel layout.");
    const firstPacket = await new EncodedPacketSink(track).getFirstPacket(); check(); if (!firstPacket) fail("AAC timing probe contains no packets.");
    let frames = 0;
    for await (const value of new AudioSampleSink(track).samples()) {
      try {
        check();
        if (value.sampleRate !== sampleRate) fail("AAC decoder changed the probe's sample rate.");
        const offset = Math.round((value.timestamp - firstPacket.timestamp) * sampleRate);
        if (offset < 0 || offset + value.numberOfFrames > decoded.length) fail("AAC decoder timing exceeded the probe budget.");
        const block = new Float32Array(value.numberOfFrames); value.copyTo(block, { format: "f32-planar", planeIndex: 0 }); decoded.set(block, offset); frames = Math.max(frames, offset + value.numberOfFrames);
      } finally { value.close(); }
    }
    check(); if (frames < PROBE_FRAMES) fail("AAC decoder returned an incomplete probe.");
    const timing = estimateAacPriming(reference, decoded, sampleRate, maxDelay); check();
    if (frames < PROBE_FRAMES + timing.primingSamples) fail("AAC encoder did not retain the complete probe tail.");
    const timestampLeadSamples = Math.max(0, -Math.round((firstNative - PROBE_ORIGIN_SECONDS) * sampleRate));
    if (timestampLeadSamples > maxDelay) fail("AAC encoder packet timestamps exceed the verified timing range.");
    return { ...timing, sampleRate, numberOfChannels, timestampLeadSamples, encoderConfig: config };
  } catch (cause) {
    aborted(signal); if (timeoutError) throw timeoutError;
    if (cause instanceof AacTimingError) throw cause;
    throw new AacTimingError("AAC_TIMING_UNVERIFIED", `AAC timing calibration failed: ${cause instanceof Error ? cause.message : String(cause)}`);
  } finally {
    clearTimeout(timeout); signal?.removeEventListener("abort", cancel); sample?.close();
    if (input) disposeMediaInputSafely(input);
    await output.cancel().catch(() => {});
  }
}
