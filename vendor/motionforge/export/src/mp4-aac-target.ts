import type { StreamTargetChunk } from "mediabunny";
import { AacTimingError } from "./aac-timing-error";
import { MAX_AAC_MOOV_BYTES, repairAacMoov, type AacMoovTiming } from "./mp4-aac-timing";

function check(signal?: AbortSignal) { signal?.throwIfAborted(); }
function fail(message: string): never { throw new AacTimingError("AAC_TIMING_UNSUPPORTED", message); }

/** Reads only top-level headers and a bounded moov; media stays in native Blob slices. */
export async function repairAacBlob(blob: Blob, timing: AacMoovTiming, signal?: AbortSignal): Promise<Blob> {
  let movie: { position: number; size: number } | undefined, at = 0, boxes = 0;
  while (at < blob.size) {
    check(signal);
    if (++boxes > 10000 || at + 8 > blob.size) fail("Invalid MP4 output structure.");
    const bytes = new Uint8Array(await blob.slice(at, at + 16).arrayBuffer()); check(signal);
    const view = new DataView(bytes.buffer), raw = view.getUint32(0), header = raw === 1 ? 16 : 8;
    if (bytes.length < header) fail("Truncated MP4 output header.");
    const size = raw === 1 ? Number(view.getBigUint64(8)) : raw || blob.size - at;
    if (!Number.isSafeInteger(size) || size < header || at + size > blob.size) fail("Invalid MP4 output length.");
    const type = String.fromCharCode(...bytes.subarray(4, 8));
    if (type === "moof") fail("Fragmented AAC timing repair is not supported.");
    if (type === "moov") {
      if (movie) fail("Ambiguous MP4 movie metadata.");
      if (size > MAX_AAC_MOOV_BYTES) throw new AacTimingError("AAC_TIMING_BUDGET", "AAC timing metadata exceeds its bounded budget.");
      movie = { position: at, size };
    }
    at += size;
  }
  if (!movie) fail("AAC output is missing movie metadata.");
  const bytes = new Uint8Array(await blob.slice(movie.position, movie.position + movie.size).arrayBuffer()); check(signal);
  const repaired = repairAacMoov(bytes, movie.position, timing); check(signal);
  return new Blob([blob.slice(0, movie.position), repaired.data, blob.slice(movie.position + movie.size)], { type: blob.type });
}

/** Final metadata is replaced before the caller's writer commits. Never reopens a finalized file. */
export function createAacTimingStream(destination: WritableStream<StreamTargetChunk>, signal?: AbortSignal) {
  const writer = destination.getWriter();
  let timing: AacMoovTiming | undefined, movie: { data: Uint8Array; position: number } | undefined;
  let extent = 0, settled = false, released = false;
  let abortTask: Promise<void> | undefined;
  const release = () => { if (!released) { released = true; writer.releaseLock(); } };
  const abort = (reason?: unknown): Promise<void> => {
    if (abortTask) return abortTask;
    if (settled) return Promise.resolve();
    settled = true;
    abortTask = (async () => { try { await writer.abort(reason); } finally { release(); } })();
    return abortTask;
  };
  const writable = new WritableStream<StreamTargetChunk>({
    async write(chunk) {
      check(signal); if (settled) fail("The export stream has already closed.");
      if (!Number.isSafeInteger(chunk.position) || chunk.position < 0 || !Number.isSafeInteger(chunk.position + chunk.data.byteLength)) fail("Invalid export stream position.");
      extent = Math.max(extent, chunk.position + chunk.data.byteLength);
      await writer.write(chunk); check(signal);
    },
    async close() {
      try {
        check(signal);
        if (timing) {
          if (!movie || movie.position + movie.data.byteLength !== extent) fail("Streaming AAC correction requires final, end-positioned movie metadata.");
          const repaired = repairAacMoov(movie.data, movie.position, timing); check(signal);
          await writer.write({ type: "write", position: movie.position, data: repaired.data }); check(signal);
        }
        await writer.close(); settled = true; release();
      } catch (cause) { await abort(cause); throw cause; }
    },
    abort,
  });
  return {
    writable, abort,
    setTiming(value: AacMoovTiming) { if (timing) fail("AAC timing was configured twice."); timing = { ...value }; },
    onMoov(data: Uint8Array, position: number) {
      check(signal); if (!timing) return;
      if (movie || data.byteLength > MAX_AAC_MOOV_BYTES) throw new AacTimingError("AAC_TIMING_BUDGET", "AAC movie metadata exceeds the streaming budget.");
      movie = { data: new Uint8Array(data), position };
    },
  };
}
