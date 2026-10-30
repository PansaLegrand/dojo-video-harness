import type { SceneAsset } from "@motionforge/schema";
import { abortableLocalRead } from "@/lib/video-project/local-file-hash-utils";

/** Shared limits for imported originals and their local preview derivatives. */
export const EDITOR_MEDIA_ADMISSION = Object.freeze({
  maxFileBytes: 250 * 1024 * 1024,
  ordinaryEdge: 2048,
  maxEdge: 4096,
  maxPixels: 4096 * 2160,
  highResolutionSeconds: 120,
  highResolutionFrames: 7200,
  highResolutionFrameRate: 60,
  audioPackets: 12000,
  audioPrerollSeconds: 0.1,
  copiedAudioBytes: 8 * 1024 * 1024,
  maxVideoPacketBytes: 16 * 1024 * 1024,
  metadataCacheBytes: 8 * 1024 * 1024,
  probeTimeoutMs: 15_000,
  previewEdge: 960,
});

export const mediaAdmissionMessages = {
  size: "Choose a file smaller than 250 MB.",
  dimensions:
    "Choose 4K or smaller video. Very large square videos are not supported.",
  duration:
    "For 4K editing, choose a video up to two minutes and 60 frames per second, or use a 1080p copy.",
  codec:
    "This browser cannot decode this video format. Try an SDR H.264 MP4 copy.",
  profile: "Use an 8-bit SDR H.264 or HEVC copy for 4K editing.",
  hdr: "HDR and wide-gamut video are not supported yet. Export an SDR copy before importing it.",
  layout:
    "This 4K video needs one picture track and optional mono or stereo AAC sound. Export an SDR H.264 MP4 copy.",
  timeline:
    "This video's timing cannot be preserved by the local 4K preview. Export an SDR H.264 MP4 copy.",
  preview:
    "This browser cannot prepare a local 4K preview. Use a supported browser with local storage, or a 1080p copy.",
  unreadable: "This browser could not read the media file.",
} as const;
export class MediaAdmissionError extends Error {
  constructor(readonly reason: keyof typeof mediaAdmissionMessages) {
    super(mediaAdmissionMessages[reason]);
    this.name = "MediaAdmissionError";
  }
}

export type VideoAdmissionMetadata = {
  width: number;
  height: number;
  codedWidth: number;
  codedHeight: number;
  duration: number;
  codec: string | null;
  codecParameters: string | null;
  rotation: number;
  hdr: boolean;
  alpha: boolean;
  canDecode: boolean;
  videoTracks: number;
  audioTracks: number;
  otherTracks: number;
  audioCodec: string | null;
  audioChannels: number;
  audioSampleRate: number;
  audioCanDecode: boolean;
  videoFrames: number;
  audioPackets: number;
  audioBytes: number;
  timingSupported: boolean;
  variableFrameRate: boolean;
  fullPacketScan: boolean;
};
export const isHighResolutionVideo = (width: number, height: number) =>
  Math.max(width, height) > EDITOR_MEDIA_ADMISSION.ordinaryEdge;
export function unsupportedVideoColor(space?: {
  primaries?: string | null;
  transfer?: string | null;
  matrix?: string | null;
}): boolean {
  return (
    !!space &&
    (["bt2020", "smpte432"].includes(space.primaries ?? "") ||
      ["pq", "hlg"].includes(space.transfer ?? "") ||
      space.matrix === "bt2020-ncl")
  );
}
export function localVideoProxyDimensions(
  width: number,
  height: number,
): { width: number; height: number } | null {
  if (
    ![width, height].every((value) => Number.isInteger(value) && value > 0) ||
    Math.max(width, height) <= EDITOR_MEDIA_ADMISSION.previewEdge ||
    Math.max(width, height) > EDITOR_MEDIA_ADMISSION.maxEdge
  )
    return null;
  let a = width,
    b = height;
  while (b) [a, b] = [b, a % b];
  const ratioWidth = width / a,
    ratioHeight = height / a;
  let scale = Math.floor(
    EDITOR_MEDIA_ADMISSION.previewEdge / Math.max(ratioWidth, ratioHeight),
  );
  while (scale > 0 && ((ratioWidth * scale) % 2 || (ratioHeight * scale) % 2))
    scale--;
  return scale > 0
    ? { width: ratioWidth * scale, height: ratioHeight * scale }
    : null;
}
export function supportsLocalVideoProxy(
  runtime: Partial<typeof globalThis> = globalThis,
): boolean {
  return (
    typeof runtime.Worker === "function" &&
    typeof runtime.OffscreenCanvas === "function" &&
    typeof runtime.VideoDecoder === "function" &&
    typeof runtime.VideoEncoder === "function" &&
    typeof runtime.navigator?.storage?.getDirectory === "function" &&
    !!runtime.navigator?.locks
  );
}
function eightBitPhoneCodec(value: VideoAdmissionMetadata): boolean {
  if (value.codec === "avc") {
    const profile = /^avc[13]\.([a-f0-9]{2})/i.exec(
      value.codecParameters ?? "",
    );
    return !!profile && [66, 77, 88, 100].includes(parseInt(profile[1]!, 16));
  }
  return (
    value.codec === "hevc" &&
    /^(?:hvc1|hev1)\.[ABC]?1\./i.test(value.codecParameters ?? "")
  );
}

export function assertVideoAdmission(
  metadata: VideoAdmissionMetadata,
  proxySupported: boolean,
): { requiresProxy: boolean } {
  const dimensions = [
    metadata.width,
    metadata.height,
    metadata.codedWidth,
    metadata.codedHeight,
  ];
  if (
    dimensions.some(
      (value) =>
        !Number.isSafeInteger(value) ||
        value < 1 ||
        value > EDITOR_MEDIA_ADMISSION.maxEdge,
    ) ||
    metadata.width * metadata.height > EDITOR_MEDIA_ADMISSION.maxPixels ||
    metadata.codedWidth * metadata.codedHeight >
      EDITOR_MEDIA_ADMISSION.maxPixels
  )
    throw new MediaAdmissionError("dimensions");
  if (!Number.isFinite(metadata.duration) || metadata.duration <= 0)
    throw new MediaAdmissionError("unreadable");
  if (metadata.hdr) throw new MediaAdmissionError("hdr");
  if (
    !metadata.codec ||
    !metadata.canDecode ||
    (metadata.audioTracks > 0 && !metadata.audioCanDecode)
  )
    throw new MediaAdmissionError("codec");
  const requiresProxy = dimensions.some(
    (value) => value > EDITOR_MEDIA_ADMISSION.ordinaryEdge,
  );
  if (!requiresProxy) return { requiresProxy };
  if (!eightBitPhoneCodec(metadata)) throw new MediaAdmissionError("profile");
  if (
    ![0, 90, 180, 270].includes(metadata.rotation) ||
    metadata.alpha ||
    metadata.videoTracks !== 1 ||
    metadata.audioTracks > 1 ||
    metadata.otherTracks ||
    metadata.width !==
      (metadata.rotation % 180 ? metadata.codedHeight : metadata.codedWidth) ||
    metadata.height !==
      (metadata.rotation % 180 ? metadata.codedWidth : metadata.codedHeight) ||
    (metadata.audioTracks &&
      (metadata.audioCodec !== "aac" ||
        metadata.audioChannels < 1 ||
        metadata.audioChannels > 2))
  )
    throw new MediaAdmissionError("layout");
  if (
    metadata.duration > EDITOR_MEDIA_ADMISSION.highResolutionSeconds ||
    metadata.videoFrames > EDITOR_MEDIA_ADMISSION.highResolutionFrames ||
    metadata.videoFrames / metadata.duration >
      EDITOR_MEDIA_ADMISSION.highResolutionFrameRate + 0.01
  )
    throw new MediaAdmissionError("duration");
  if (
    !metadata.fullPacketScan ||
    !metadata.timingSupported ||
    metadata.videoFrames < 1 ||
    (metadata.audioTracks > 0 && metadata.audioPackets < 1) ||
    metadata.audioPackets > EDITOR_MEDIA_ADMISSION.audioPackets ||
    metadata.audioBytes > EDITOR_MEDIA_ADMISSION.copiedAudioBytes
  )
    throw new MediaAdmissionError("timeline");
  if (
    !proxySupported ||
    !localVideoProxyDimensions(metadata.width, metadata.height)
  )
    throw new MediaAdmissionError("preview");
  return { requiresProxy };
}

export type AdmittedEditorVideo = {
  type: "video";
  width: number;
  height: number;
  duration: number;
  requiresProxy: boolean;
  mediaMetadata: NonNullable<SceneAsset["metadata"]>;
};

/** Reads bounded packet metadata and proves the original codec can decode a
 * frame. Any late frame after cancellation is still closed by the inner job. */
export async function inspectEditorVideo(
  file: Blob,
  parent?: AbortSignal,
): Promise<AdmittedEditorVideo> {
  parent?.throwIfAborted();
  if (file.size > EDITOR_MEDIA_ADMISSION.maxFileBytes)
    throw new MediaAdmissionError("size");
  const {
    Input,
    BlobSource,
    ALL_FORMATS,
    EncodedPacketSink,
    VideoSampleSink,
    canEncodeVideo,
  } = await abortableLocalRead(import("mediabunny"), parent);
  parent?.throwIfAborted();
  const controller = new AbortController(),
    signal = controller.signal;
  const abort = () =>
    controller.abort(
      parent?.reason ?? new DOMException("Import cancelled.", "AbortError"),
    );
  parent?.addEventListener("abort", abort, { once: true });
  if (parent?.aborted) abort();
  const input = new Input({
    source: new BlobSource(file, {
      maxCacheSize: EDITOR_MEDIA_ADMISSION.metadataCacheBytes,
    }),
    formats: ALL_FORMATS.filter(
      (format) => format.name.toLowerCase() !== "hls",
    ),
  });
  let disposed = false;
  const dispose = () => {
    if (disposed) return;
    disposed = true;
    try {
      input.dispose();
    } catch {
      /* Already closed by cancellation. */
    }
  };
  signal.addEventListener("abort", dispose, { once: true });
  const timer = setTimeout(
    () => controller.abort(new MediaAdmissionError("unreadable")),
    EDITOR_MEDIA_ADMISSION.probeTimeoutMs,
  );
  const work = async (): Promise<AdmittedEditorVideo> => {
    const tracks = await input.getTracks();
    signal.throwIfAborted();
    const video = await input.getPrimaryVideoTrack(),
      audio = await input.getPrimaryAudioTrack();
    signal.throwIfAborted();
    if (!video) throw new MediaAdmissionError("unreadable");
    const [
      width,
      height,
      codedWidth,
      codedHeight,
      duration,
      codec,
      codecParameters,
      rotation,
      hdr,
      alpha,
      canDecode,
      audioCodec,
      audioChannels,
      audioSampleRate,
      audioCanDecode,
    ] = await Promise.all([
      video.getDisplayWidth(),
      video.getDisplayHeight(),
      video.getCodedWidth(),
      video.getCodedHeight(),
      input.computeDuration(undefined, { skipLiveWait: true }),
      video.getCodec(),
      video.getCodecParameterString(),
      video.getRotation(),
      video.hasHighDynamicRange(),
      video.canBeTransparent(),
      video.canDecode(),
      audio?.getCodec() ?? null,
      audio?.getNumberOfChannels() ?? 0,
      audio?.getSampleRate() ?? 0,
      audio?.canDecode() ?? true,
    ]);
    signal.throwIfAborted();
    const high = [width, height, codedWidth, codedHeight].some(
      (value) => value > EDITOR_MEDIA_ADMISSION.ordinaryEdge,
    );
    const metadata: VideoAdmissionMetadata = {
      width,
      height,
      codedWidth,
      codedHeight,
      duration,
      codec,
      codecParameters,
      rotation,
      hdr,
      alpha,
      canDecode,
      videoTracks: tracks.filter((track) => track.type === "video").length,
      audioTracks: tracks.filter((track) => track.type === "audio").length,
      otherTracks: tracks.filter(
        (track) => !["video", "audio"].includes(track.type),
      ).length,
      audioCodec,
      audioChannels,
      audioSampleRate,
      audioCanDecode,
      videoFrames: 0,
      audioPackets: 0,
      audioBytes: 0,
      timingSupported: true,
      variableFrameRate: false,
      fullPacketScan: high,
    };
    // Reject color/codec/dimension failures before any decoder allocation.
    if (hdr) throw new MediaAdmissionError("hdr");
    if (!canDecode || !codec || (audio && !audioCanDecode))
      throw new MediaAdmissionError("codec");
    if (
      [width, height, codedWidth, codedHeight].some(
        (value) =>
          !Number.isSafeInteger(value) ||
          value < 1 ||
          value > EDITOR_MEDIA_ADMISSION.maxEdge,
      ) ||
      width * height > EDITOR_MEDIA_ADMISSION.maxPixels ||
      codedWidth * codedHeight > EDITOR_MEDIA_ADMISSION.maxPixels
    )
      throw new MediaAdmissionError("dimensions");
    const times: Array<[number, number]> = [];
    for await (const packet of new EncodedPacketSink(video).packets(
      undefined,
      undefined,
      { metadataOnly: true, skipLiveWait: true },
    )) {
      signal.throwIfAborted();
      if (
        times.length >=
        (high ? EDITOR_MEDIA_ADMISSION.highResolutionFrames : 240)
      ) {
        if (high) throw new MediaAdmissionError("duration");
        break;
      }
      if (
        high &&
        (!Number.isSafeInteger(packet.byteLength) ||
          packet.byteLength < 1 ||
          packet.byteLength > EDITOR_MEDIA_ADMISSION.maxVideoPacketBytes)
      )
        throw new MediaAdmissionError("timeline");
      metadata.timingSupported &&=
        Number.isFinite(packet.timestamp) &&
        packet.timestamp >= 0 &&
        Number.isFinite(packet.duration) &&
        packet.duration > 0;
      times.push([
        Math.round(packet.timestamp * 1e6),
        Math.round(packet.duration * 1e6),
      ]);
    }
    times.sort((a, b) => a[0] - b[0]);
    metadata.videoFrames = times.length;
    metadata.variableFrameRate = times.some(
      (value, index) =>
        Math.abs(value[1] - times[0]![1]) > 2 ||
        (index > 0 &&
          Math.abs(value[0] - times[index - 1]![0] - times[index - 1]![1]) > 2),
    );
    if (high && audio)
      for await (const packet of new EncodedPacketSink(audio).packets(
        undefined,
        undefined,
        { metadataOnly: true, skipLiveWait: true },
      )) {
        signal.throwIfAborted();
        metadata.audioPackets++;
        metadata.audioBytes += packet.byteLength;
        metadata.timingSupported &&=
          Number.isFinite(packet.timestamp) &&
          packet.timestamp >= -EDITOR_MEDIA_ADMISSION.audioPrerollSeconds &&
          Number.isFinite(packet.duration) &&
          packet.duration > 0;
        if (
          metadata.audioPackets > EDITOR_MEDIA_ADMISSION.audioPackets ||
          metadata.audioBytes > EDITOR_MEDIA_ADMISSION.copiedAudioBytes
        )
          throw new MediaAdmissionError("timeline");
      }
    const supported = supportsLocalVideoProxy();
    const { requiresProxy } = assertVideoAdmission(metadata, supported);
    if (
      requiresProxy &&
      !(await canEncodeVideo("avc", {
        ...localVideoProxyDimensions(width, height)!,
        bitrate: 2_500_000,
      }))
    )
      throw new MediaAdmissionError("preview");
    signal.throwIfAborted();
    const sample = await new VideoSampleSink(video).getSample(
      await video.getFirstTimestamp(),
      { skipLiveWait: true },
    );
    try {
      signal.throwIfAborted();
      if (!sample) throw new MediaAdmissionError("codec");
      // Some containers omit colr while the codec bitstream still declares HDR.
      if (unsupportedVideoColor(sample.colorSpace))
        throw new MediaAdmissionError("hdr");
      if (requiresProxy && /P(?:10|12)$/.test(sample.format ?? ""))
        throw new MediaAdmissionError("profile");
    } finally {
      sample?.close();
    }
    return {
      type: "video",
      width,
      height,
      duration,
      requiresProxy,
      mediaMetadata: {
        width,
        height,
        duration,
        byteLength: file.size,
        codec,
        hasAudio: !!audio,
        ...(audioCodec ? { audioCodec, audioChannels, audioSampleRate } : {}),
        ...(high || metadata.variableFrameRate
          ? { variableFrameRate: metadata.variableFrameRate }
          : {}),
      },
    };
  };
  try {
    return await abortableLocalRead(work(), signal);
  } catch (error) {
    signal.throwIfAborted();
    if (error instanceof MediaAdmissionError) throw error;
    throw new MediaAdmissionError("unreadable");
  } finally {
    clearTimeout(timer);
    parent?.removeEventListener("abort", abort);
    signal.removeEventListener("abort", dispose);
    dispose();
  }
}
