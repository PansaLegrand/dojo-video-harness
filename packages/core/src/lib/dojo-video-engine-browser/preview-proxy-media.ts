import {
  ALL_FORMATS,
  BlobSource,
  Conversion,
  EncodedPacketSink,
  Input,
  Mp4OutputFormat,
  Output,
  StreamTarget,
  VideoSampleSink,
  type InputTrack,
} from "mediabunny";
import { disposeMediaInputSafely } from "@dojo-video-engine/renderer-canvas2d";
import { hashLocalFileChunks } from "@/lib/video-project/local-file-hash";
import {
  EDITOR_MEDIA_ADMISSION,
  isHighResolutionVideo,
  unsupportedVideoColor,
} from "./media-admission";
import {
  openPreviewProxyCache,
  readPreviewProxyCache,
  removeUnpinnedPreviewProxyCache,
  reservePreviewProxyCache,
  writePreviewProxyManifest,
} from "./preview-proxy-cache";
import {
  PREVIEW_PROXY_LIMITS as LIMITS,
  PREVIEW_PROXY_VERSION,
  previewProxyDigest,
  previewProxyDimensions,
  previewProxyEntryName,
  type PreviewProxyManifest,
  type PreviewProxyRequest,
  type PreviewProxyResult,
} from "./preview-proxy-policy";

type MediaSummary = {
  width: number;
  height: number;
  rotation: number;
  duration: number;
  videoDuration: number;
  videoFrames: number;
  videoTimingHash: string;
  audioHash: string | null;
  audioPackets: number;
  audioBytes: number;
  audioChannels: number;
  audioSampleRate: number;
};

async function packetSignature(
  track: InputTrack,
  audio: boolean,
  signal: AbortSignal,
) {
  const times: Array<[number, number]> = [],
    chunks: Uint8Array[] = [];
  let bytes = 0;
  for await (const packet of new EncodedPacketSink(track).packets(
    undefined,
    undefined,
    { metadataOnly: !audio },
  )) {
    signal.throwIfAborted();
    if (
      times.length >= (audio ? LIMITS.audioPackets : LIMITS.videoFrames) ||
      !Number.isFinite(packet.timestamp) ||
      packet.timestamp <
        (audio ? -EDITOR_MEDIA_ADMISSION.audioPrerollSeconds : 0) ||
      !Number.isFinite(packet.duration) ||
      packet.duration <= 0
    )
      throw new Error("Unsupported preview proxy packet timeline.");
    if (
      !audio &&
      packet.byteLength > EDITOR_MEDIA_ADMISSION.maxVideoPacketBytes
    )
      throw new Error(
        "Preview proxy video packet exceeds its bounded decode budget.",
      );
    times.push([
      Math.round(packet.timestamp * 1e6),
      Math.round(packet.duration * 1e6),
    ]);
    if (audio) {
      bytes += packet.data.byteLength;
      if (bytes > EDITOR_MEDIA_ADMISSION.copiedAudioBytes)
        throw new Error("Preview proxy audio exceeds its bounded copy budget.");
      chunks.push(packet.data);
    }
  }
  if (!times.length) throw new Error("Preview proxy has no decodable packets.");
  if (!audio) times.sort((a, b) => a[0] - b[0]);
  const timing = new TextEncoder().encode(JSON.stringify(times));
  const data = new Uint8Array(timing.length + bytes);
  data.set(timing);
  let offset = timing.length;
  for (const chunk of chunks) {
    data.set(chunk, offset);
    offset += chunk.length;
  }
  return {
    count: times.length,
    bytes,
    hash: await previewProxyDigest(data.buffer),
  };
}

async function inspect(
  input: Input,
  signal: AbortSignal,
): Promise<MediaSummary> {
  const tracks = await input.getTracks();
  const video = await input.getPrimaryVideoTrack(),
    audio = await input.getPrimaryAudioTrack();
  if (
    !video ||
    tracks.filter((track) => track.type === "video").length !== 1 ||
    tracks.filter((track) => track.type === "audio").length > 1 ||
    tracks.some((track) => !["video", "audio"].includes(track.type)) ||
    ![0, 90, 180, 270].includes(await video.getRotation()) ||
    (await video.hasHighDynamicRange()) ||
    (await video.canBeTransparent())
  )
    throw new Error("Unsupported preview proxy track layout.");
  if (
    audio &&
    ((await audio.getCodec()) !== "aac" ||
      (await audio.getNumberOfChannels()) > 2)
  )
    throw new Error("Preview proxy audio must remain unchanged AAC.");
  const duration = await input.computeDuration();
  if (
    !Number.isFinite(duration) ||
    duration <= 0 ||
    duration > LIMITS.durationSeconds
  )
    throw new Error("Preview proxy duration exceeds its background budget.");
  const videoPackets = await packetSignature(video, false, signal);
  const audioPackets = audio
    ? await packetSignature(audio, true, signal)
    : null;
  const sample = await new VideoSampleSink(video).getSample(
    await video.getFirstTimestamp(),
    { skipLiveWait: true },
  );
  try {
    signal.throwIfAborted();
    if (!sample || unsupportedVideoColor(sample.colorSpace))
      throw new Error("Preview proxies require decoded SDR video.");
  } finally {
    sample?.close();
  }
  return {
    width: await video.getDisplayWidth(),
    height: await video.getDisplayHeight(),
    rotation: await video.getRotation(),
    duration,
    videoDuration: await video.computeDuration(),
    videoFrames: videoPackets.count,
    videoTimingHash: videoPackets.hash,
    audioHash: audioPackets?.hash ?? null,
    audioPackets: audioPackets?.count ?? 0,
    audioBytes: audioPackets?.bytes ?? 0,
    audioChannels: (await audio?.getNumberOfChannels()) ?? 0,
    audioSampleRate: (await audio?.getSampleRate()) ?? 0,
  };
}

export function assertPreviewProxyTimeline(
  original: MediaSummary,
  proxy: MediaSummary,
  audioFromOriginal = false,
) {
  if (
    original.videoFrames !== proxy.videoFrames ||
    original.videoTimingHash !== proxy.videoTimingHash ||
    Math.abs(original.videoDuration - proxy.videoDuration) > 0.00001 ||
    (audioFromOriginal
      ? proxy.audioPackets !== 0 ||
        proxy.audioHash !== null ||
        Math.abs(original.videoDuration - proxy.duration) > 0.00001
      : original.audioHash !== proxy.audioHash ||
        original.audioPackets !== proxy.audioPackets ||
        original.audioChannels !== proxy.audioChannels ||
        original.audioSampleRate !== proxy.audioSampleRate ||
        Math.abs(original.duration - proxy.duration) > 0.00001)
  ) {
    throw new Error("Preview proxy changed media timing or audio.");
  }
}

export async function verifyPreviewProxyFile(
  file: Blob,
  source: MediaSummary,
  dimensions: { width: number; height: number },
  signal: AbortSignal,
  audioFromOriginal = false,
) {
  if (file.size < 1 || file.size > LIMITS.outputBytes)
    throw new Error("Preview proxy exceeds its output budget.");
  const input = new Input({
    source: new BlobSource(file, {
      maxCacheSize: EDITOR_MEDIA_ADMISSION.metadataCacheBytes,
    }),
    formats: ALL_FORMATS.filter(
      (format) => format.name.toLowerCase() !== "hls",
    ),
  });
  const abort = () => disposeMediaInputSafely(input);
  signal.addEventListener("abort", abort, { once: true });
  try {
    signal.throwIfAborted();
    const result = await inspect(input, signal);
    if (
      result.width !== dimensions.width ||
      result.height !== dimensions.height ||
      result.rotation !== 0
    )
      throw new Error("Preview proxy dimensions changed.");
    assertPreviewProxyTimeline(source, result, audioFromOriginal);
    return result;
  } finally {
    signal.removeEventListener("abort", abort);
    disposeMediaInputSafely(input);
  }
}

/** Runs only under the origin-wide creation lock, in a dedicated worker. */
export async function preparePreviewProxy(
  request: PreviewProxyRequest,
  signal: AbortSignal,
): Promise<PreviewProxyResult | null> {
  const identity = /^local:(?:sha256:)?([a-f0-9]{64})$/.exec(request.assetId);
  const url = new URL(request.src);
  if (
    !identity ||
    identity[1] !== request.sourceHash ||
    url.protocol !== "blob:" ||
    url.origin !== location.origin ||
    !Number.isInteger(request.sourceBytes) ||
    request.sourceBytes <= 0 ||
    request.sourceBytes > LIMITS.inputBytes
  )
    throw new Error(
      "Preview proxies require an original local hash-bound blob.",
    );
  const response = await fetch(url, { signal });
  const responseBytes = Number(response.headers.get("content-length"));
  if (
    !response.ok ||
    !Number.isInteger(responseBytes) ||
    responseBytes !== request.sourceBytes ||
    responseBytes > LIMITS.inputBytes
  )
    throw new Error("Preview proxy source exceeds its verified byte budget.");
  const file = await response.blob();
  if (
    file.size !== request.sourceBytes ||
    file.size > LIMITS.inputBytes ||
    (await hashLocalFileChunks(file, { signal })) !== request.sourceHash
  )
    throw new Error("Preview proxy source identity changed.");
  signal.throwIfAborted();
  const input = new Input({
    source: new BlobSource(file, {
      maxCacheSize: EDITOR_MEDIA_ADMISSION.metadataCacheBytes,
    }),
    formats: ALL_FORMATS.filter(
      (format) => format.name.toLowerCase() !== "hls",
    ),
  });
  let conversion: Conversion | undefined;
  const abort = () => {
    disposeMediaInputSafely(input);
    void conversion?.cancel().catch(() => undefined);
  };
  signal.addEventListener("abort", abort, { once: true });
  let cleanup: (() => Promise<void>) | undefined;
  try {
    const source = await inspect(input, signal);
    const dimensions = previewProxyDimensions(source.width, source.height);
    // Browser muxers cannot preserve negative AAC priming timestamps. High-res
    // proxies own only picture; the preview resolver retains the original audio.
    const audioFromOriginal = isHighResolutionVideo(
      source.width,
      source.height,
    );
    if (!dimensions) return null;
    const root = await openPreviewProxyCache(),
      entry = previewProxyEntryName(request.sourceHash);
    try {
      const cached = await readPreviewProxyCache(root, request);
      if (cached) {
        if (
          cached.manifest.sourceWidth !== source.width ||
          cached.manifest.sourceHeight !== source.height ||
          cached.manifest.audioFromOriginal !== audioFromOriginal ||
          cached.manifest.videoDuration !== source.videoDuration ||
          cached.manifest.videoTimingHash !== source.videoTimingHash ||
          cached.manifest.audioHash !== source.audioHash ||
          (await hashLocalFileChunks(cached.file, { signal })) !==
            cached.manifest.proxyHash
        )
          throw new Error("Preview proxy cache identity changed.");
        await verifyPreviewProxyFile(
          cached.file,
          source,
          dimensions,
          signal,
          audioFromOriginal,
        );
        return { ...cached, cached: true };
      }
    } catch (error) {
      signal.throwIfAborted();
      if (!(await removeUnpinnedPreviewProxyCache(root, entry))) return null;
    }
    if (!(await reservePreviewProxyCache(root, entry))) return null;
    const directory = await root.getDirectoryHandle(entry, { create: true });
    cleanup = () => root.removeEntry(entry, { recursive: true });
    const handle = await directory.getFileHandle("media.mp4", { create: true });
    const writer = await handle.createWritable();
    let writerClosed = false;
    const target = new StreamTarget(
      new WritableStream({
        async write(chunk) {
          signal.throwIfAborted();
          if (chunk.position + chunk.data.byteLength > LIMITS.outputBytes)
            throw new Error("Preview proxy exceeds its output budget.");
          await writer.write({
            type: "write",
            position: chunk.position,
            data: chunk.data,
          });
        },
        async close() {
          await writer.close();
          writerClosed = true;
        },
        async abort() {
          await writer.abort();
          writerClosed = true;
        },
      }),
      { chunked: true, chunkSize: 1024 * 1024 },
    );
    try {
      conversion = await Conversion.init({
        input,
        output: new Output({
          format: new Mp4OutputFormat({ fastStart: false }),
          target,
        }),
        tracks: "all",
        trim: { start: 0 },
        showWarnings: false,
        tags: {},
        video: {
          ...dimensions,
          fit: "contain",
          codec: "avc",
          bitrate: Math.min(
            LIMITS.bitrate,
            Math.floor(
              (((LIMITS.outputBytes -
                (audioFromOriginal ? 0 : source.audioBytes) -
                1024 * 1024) *
                8) /
                source.duration) *
                0.9,
            ),
          ),
          keyFrameInterval: 0.5,
          forceTranscode: true,
          allowRotationMetadata: false,
        },
        audio: audioFromOriginal
          ? { discard: true }
          : { codec: "aac", forceTranscode: false },
      });
      if (
        !conversion.isValid ||
        conversion.discardedTracks.some(
          ({ track, reason }) =>
            !audioFromOriginal ||
            track.type !== "audio" ||
            reason !== "discarded_by_user",
        ) ||
        conversion.utilizedTracks.length !==
          (source.audioPackets && !audioFromOriginal ? 2 : 1)
      )
        throw new Error("Preview proxy could not preserve every media track.");
      signal.throwIfAborted();
      await conversion.execute();
      if (!writerClosed) {
        await writer.close();
        writerClosed = true;
      }
    } finally {
      if (!writerClosed) await writer.abort().catch(() => undefined);
    }
    signal.throwIfAborted();
    const proxy = await handle.getFile();
    await verifyPreviewProxyFile(
      proxy,
      source,
      dimensions,
      signal,
      audioFromOriginal,
    );
    const manifest: PreviewProxyManifest = {
      version: PREVIEW_PROXY_VERSION,
      sourceHash: request.sourceHash,
      sourceBytes: file.size,
      proxyHash: await hashLocalFileChunks(proxy, { signal }),
      proxyBytes: proxy.size,
      ...dimensions,
      sourceWidth: source.width,
      sourceHeight: source.height,
      duration: source.duration,
      videoDuration: source.videoDuration,
      audioFromOriginal,
      videoFrames: source.videoFrames,
      videoTimingHash: source.videoTimingHash,
      audioHash: source.audioHash,
      audioPackets: source.audioPackets,
      createdAt: Date.now(),
    };
    await writePreviewProxyManifest(directory, manifest);
    cleanup = undefined;
    return { file: proxy, manifest, cached: false };
  } finally {
    signal.removeEventListener("abort", abort);
    disposeMediaInputSafely(input);
    await cleanup?.().catch(() => undefined);
  }
}
