import {
  ExportVerificationError,
  verifyExportBlob,
  verifyExportWithSink,
  unverifiedExportForSink,
  type ExportVideoOptions,
  type ExportVideoResult,
  type ExportVideoStreamResult,
} from "@motionforge/export";
import { parseScene, type Scene, type SceneNode } from "@motionforge/schema";
import {
  ALL_FORMATS,
  AudioSampleSink,
  BlobSource,
  BufferTarget,
  EncodedAudioPacketSource,
  EncodedPacketSink,
  EncodedVideoPacketSource,
  Input,
  IsobmffInputFormat,
  Mp4OutputFormat,
  Output,
  QUALITY_HIGH,
  StreamTarget,
  type InputAudioTrack,
  type InputVideoTrack,
  type StreamTargetChunk,
  type StreamTargetOptions,
  type Target,
} from "mediabunny";

const MAX_MEMORY_BYTES = 256 * 1024 * 1024;
const MAX_PACKETS = 180_000;
const TIME_EPSILON = 0.0000015;
type CopyOptions = ExportVideoOptions & {
  preferCopy?: boolean;
  onCopyStart?: () => void;
};
export type CopyExportCandidate = {
  scene: Scene;
  node: SceneNode;
  src: string;
  muted: boolean;
};

/** Deliberately narrow: unknown visual/audio properties always use rendering. */
export function copyExportCandidate(
  options: Pick<
    CopyOptions,
    "scene" | "startFrame" | "endFrame" | "bitrate" | "codecs" | "preferCopy"
  >,
): CopyExportCandidate | null {
  if (
    options.preferCopy === false ||
    (options.bitrate !== undefined && options.bitrate !== QUALITY_HIGH) ||
    (options.codecs &&
      (options.codecs.length !== 1 || options.codecs[0] !== "avc"))
  )
    return null;
  const scene = parseScene(options.scene);
  if (
    (options.startFrame ?? 0) !== 0 ||
    (options.endFrame ?? scene.duration - 1) !== scene.duration - 1 ||
    scene.duration > MAX_PACKETS ||
    (scene.audioBuses && Object.keys(scene.audioBuses).length)
  )
    return null;
  const videos = scene.nodes.filter((node) => node.type === "video");
  if (videos.length !== 1) return null;
  const node = videos[0]!;
  if (
    (node.from ?? 0) !== 0 ||
    (node.duration ?? scene.duration) !== scene.duration ||
    (node.videoStartTime ?? 0) !== 0 ||
    (node.playbackRate ?? 1) !== 1 ||
    (node.volume !== undefined && node.volume !== 0 && node.volume !== 1) ||
    (node.pan ?? 0) !== 0 ||
    node.audioBus ||
    node.ducks ||
    node.volumeEnvelope?.length ||
    node.videoEndBehavior === "loop" ||
    node.loop ||
    node.clip ||
    node.mask ||
    node.children?.length ||
    node.animations?.length
  )
    return null;
  const style = node.style ?? {};
  const allowed = new Set([
    "position",
    "left",
    "top",
    "inset",
    "width",
    "height",
    "objectFit",
    "objectPosition",
    "opacity",
    "display",
    "zIndex",
  ]);
  if (Object.keys(style).some((key) => !allowed.has(key))) return null;
  if (
    style.position !== "absolute" ||
    (style.left ?? 0) !== 0 ||
    (style.top ?? 0) !== 0 ||
    (style.inset ?? 0) !== 0 ||
    (style.width !== scene.width && style.width !== "100%") ||
    (style.height !== scene.height && style.height !== "100%") ||
    (style.opacity ?? 1) !== 1 ||
    style.display !== undefined ||
    (style.objectPosition !== undefined &&
      style.objectPosition !== "50% 50%") ||
    (style.objectFit !== undefined &&
      !["contain", "cover", "fill"].includes(style.objectFit))
  )
    return null;
  const index = scene.nodes.indexOf(node);
  if (
    scene.nodes.some(
      (other, at) =>
        other !== node &&
        !(
          at < index &&
          other.type === "div" &&
          /^__editor_background_*$/.test(other.id) &&
          !other.children?.length &&
          !other.animations?.length &&
          !other.clip &&
          !other.mask &&
          (other.style?.zIndex ?? 0) <= (style.zIndex ?? 0) &&
          Object.keys(other.style ?? {}).every((key) =>
            ["position", "inset", "backgroundColor"].includes(key),
          )
        ),
    )
  )
    return null;
  const asset = scene.assets[node.assetId ?? ""];
  if (!asset || asset.type !== "video" || !asset.src.startsWith("blob:"))
    return null;
  return { scene, node, src: asset.src, muted: node.volume === 0 };
}

type PreparedCopy = {
  candidate: CopyExportCandidate;
  input: Input;
  video: InputVideoTrack;
  audio: InputAudioTrack | null;
  videoConfig: VideoDecoderConfig;
  audioConfig?: AudioDecoderConfig;
  estimatedBytes: number;
};
function checkAbort(signal?: AbortSignal): void {
  if (signal?.aborted)
    throw (
      signal.reason ?? new DOMException("Copy export cancelled.", "AbortError")
    );
}
function abortable<T>(pending: Promise<T>, signal?: AbortSignal): Promise<T> {
  if (!signal) return pending;
  return new Promise<T>((resolve, reject) => {
    const abort = () =>
      reject(
        signal.reason ??
          new DOMException("Copy export cancelled.", "AbortError"),
      );
    if (signal.aborted) abort();
    else signal.addEventListener("abort", abort, { once: true });
    // Always observe pending work, even when cancellation won the race.
    void pending.then(
      (value) => {
        signal.removeEventListener("abort", abort);
        resolve(value);
      },
      (error) => {
        signal.removeEventListener("abort", abort);
        reject(error);
      },
    );
  });
}
const near = (a: number, b: number) => Math.abs(a - b) <= TIME_EPSILON;

async function prepareCopy(
  options: CopyOptions,
  maximum: number,
): Promise<PreparedCopy | null> {
  if (
    options.assets ||
    options.assetPolicy ||
    options.extensions ||
    options.preferProxy
  )
    return null;
  const candidate = copyExportCandidate(options);
  if (!candidate) return null;
  let input: Input | undefined;
  let accepted = false;
  try {
    checkAbort(options.signal);
    const response = await fetch(candidate.src, { signal: options.signal });
    if (!response.ok) return null;
    const limit = Math.min(
      maximum,
      options.budget?.maxAssetBytes ?? 512 * 1024 * 1024,
    );
    if (Number(response.headers.get("content-length")) > limit) {
      await response.body?.cancel();
      return null;
    }
    const blob = await response.blob();
    checkAbort(options.signal);
    if (!blob.size || blob.size > limit) return null;
    input = new Input({ source: new BlobSource(blob), formats: ALL_FORMATS });
    const abort = () => input?.dispose();
    options.signal?.addEventListener("abort", abort, { once: true });
    try {
      // Restrict to AVC/AAC in ISO base media containers. Annex-B transport
      // streams need packet conversion and are handled by the normal renderer.
      if (!((await input.getFormat()) instanceof IsobmffInputFormat))
        return null;
      const tracks = await input.getTracks();
      checkAbort(options.signal);
      const videos = tracks.filter((track) => track.isVideoTrack());
      const audios = tracks.filter((track) => track.isAudioTrack());
      if (
        videos.length !== 1 ||
        tracks.length !== videos.length + audios.length ||
        (!candidate.muted && audios.length > 1)
      )
        return null;
      const video = videos[0]!;
      const { scene } = candidate;
      const [
        codec,
        rotation,
        codedWidth,
        codedHeight,
        width,
        height,
        hdr,
        alpha,
        videoConfig,
      ] = await Promise.all([
        video.getCodec(),
        video.getRotation(),
        video.getCodedWidth(),
        video.getCodedHeight(),
        video.getDisplayWidth(),
        video.getDisplayHeight(),
        video.hasHighDynamicRange(),
        video.canBeTransparent(),
        video.getDecoderConfig(),
      ]);
      if (
        codec !== "avc" ||
        rotation !== 0 ||
        codedWidth !== scene.width ||
        codedHeight !== scene.height ||
        width !== scene.width ||
        height !== scene.height ||
        hdr ||
        alpha ||
        !videoConfig?.description?.byteLength
      )
        return null;
      let bytes = 0,
        count = 0;
      const seen = new Uint8Array(scene.duration);
      const videoSink = new EncodedPacketSink(video);
      for await (const packet of videoSink.packets(undefined, undefined, {
        metadataOnly: true,
      })) {
        checkAbort(options.signal);
        const frame = Math.round(packet.timestamp * scene.fps);
        if (
          ++count > scene.duration ||
          frame < 0 ||
          frame >= seen.length ||
          seen[frame] ||
          !near(packet.timestamp, frame / scene.fps) ||
          !near(packet.duration, 1 / scene.fps) ||
          packet.sideData.alphaByteLength
        )
          return null;
        seen[frame] = 1;
        bytes += packet.byteLength;
      }
      if (count !== scene.duration) return null;
      const first = await videoSink.getFirstPacket({ verifyKeyPackets: true });
      if (!first || first.type !== "key" || !near(first.timestamp, 0))
        return null;
      const duration = scene.duration / scene.fps;
      let audio: InputAudioTrack | null = candidate.muted
        ? null
        : (audios[0] ?? null);
      let audioConfig: AudioDecoderConfig | undefined;
      if (!audio && options.requireAudibleAudio) return null;
      if (audio) {
        const config = await audio.getDecoderConfig();
        if (
          (await audio.getCodec()) !== "aac" ||
          !config?.description?.byteLength ||
          config.codec !== "mp4a.40.2" ||
          (await audio.getNumberOfChannels()) !== 2 ||
          (await audio.getSampleRate()) !== 48_000 ||
          !Number.isInteger(duration * 48_000)
        )
          return null;
        audioConfig = config;
        let end = 0,
          packets = 0;
        for await (const packet of new EncodedPacketSink(audio).packets(
          undefined,
          undefined,
          { metadataOnly: true },
        )) {
          checkAbort(options.signal);
          if (
            ++packets > MAX_PACKETS ||
            !near(packet.timestamp, end) ||
            packet.duration <= 0 ||
            packet.timestamp < 0
          )
            return null;
          end = packet.timestamp + packet.duration;
          bytes += packet.byteLength;
        }
        if (!packets || !near(end, duration)) return null;
        // The renderer always peak-limits the stereo48k mix to0.98. Prove it
        // is a no-op before preserving AAC bytes; never silently skip audio DSP.
        let decoded = 0,
          audible = false;
        for await (const sample of new AudioSampleSink(audio).samples()) {
          try {
            checkAbort(options.signal);
            if (
              sample.sampleRate !== 48_000 ||
              sample.numberOfChannels !== 2 ||
              sample.numberOfFrames > 8192 ||
              !near(sample.timestamp, decoded / 48_000)
            )
              return null;
            for (let channel = 0; channel < 2; channel++) {
              const data = new Float32Array(sample.numberOfFrames);
              sample.copyTo(data, {
                planeIndex: channel,
                format: "f32-planar",
              });
              for (const value of data) {
                if (!Number.isFinite(value) || Math.abs(value) > 0.98)
                  return null;
                if (value !== 0) audible = true;
              }
            }
            decoded += sample.numberOfFrames;
            if (decoded > duration * 48_000) return null;
          } finally {
            sample.close();
          }
        }
        if (
          decoded !== duration * 48_000 ||
          (options.requireAudibleAudio && !audible)
        )
          return null;
        count += packets;
      }
      const estimatedBytes = bytes + count * 128 + 1024 * 1024;
      if (estimatedBytes > maximum) return null;
      accepted = true;
      return {
        candidate,
        input,
        video,
        audio,
        videoConfig,
        audioConfig,
        estimatedBytes,
      };
    } finally {
      options.signal?.removeEventListener("abort", abort);
    }
  } catch (error) {
    checkAbort(options.signal);
    // No output exists yet. Unsupported/malformed local media uses the normal
    // renderer, which retains its established capability and error handling.
    return null;
  } finally {
    if (!accepted) input?.dispose();
  }
}

async function writeCopy(
  prepared: PreparedCopy,
  options: CopyOptions,
  target: Target,
  maximum: number,
): Promise<ExportVideoStreamResult> {
  const { scene } = prepared.candidate;
  const output = new Output({ format: new Mp4OutputFormat(), target });
  const video = new EncodedVideoPacketSource("avc");
  output.addVideoTrack(video, { rotation: 0 });
  const audio = prepared.audio ? new EncodedAudioPacketSource("aac") : null;
  if (audio) output.addAudioTrack(audio);
  target.on("write", ({ end }) => {
    if (end > maximum)
      throw new Error("Copied output exceeds the export byte limit.");
  });
  let cancellation: Promise<void> | undefined;
  const cancelOutput = () => (cancellation ??= output.cancel().catch(() => {}));
  const abort = () => {
    prepared.input.dispose();
    void cancelOutput();
  };
  options.signal?.addEventListener("abort", abort, { once: true });
  try {
    checkAbort(options.signal);
    options.onCopyStart?.();
    checkAbort(options.signal);
    await abortable(output.start(), options.signal);
    let frameIndex = 0,
      lastProgress = 0;
    for await (const packet of new EncodedPacketSink(prepared.video).packets(
      undefined,
      undefined,
      { verifyKeyPackets: true },
    )) {
      checkAbort(options.signal);
      await abortable(
        video.add(packet, { decoderConfig: prepared.videoConfig }),
        options.signal,
      );
      const now = performance.now();
      if (
        frameIndex + 1 === scene.duration ||
        now - lastProgress >= (options.progressIntervalMs ?? 0)
      ) {
        lastProgress = now;
        options.onProgress?.({
          frame: frameIndex,
          frameIndex,
          totalFrames: scene.duration,
          timestampUs: Math.round((frameIndex / scene.fps) * 1_000_000),
          sceneTimestampUs: Math.round((frameIndex / scene.fps) * 1_000_000),
        });
      }
      frameIndex++;
    }
    video.close();
    if (audio && prepared.audio) {
      for await (const packet of new EncodedPacketSink(
        prepared.audio,
      ).packets()) {
        checkAbort(options.signal);
        await abortable(
          audio.add(packet, { decoderConfig: prepared.audioConfig }),
          options.signal,
        );
      }
      audio.close();
    }
    checkAbort(options.signal);
    await abortable(output.finalize(), options.signal);
    checkAbort(options.signal);
    return {
      mimeType: "video/mp4",
      codec: "avc",
      audioCodec: audio ? "aac" : null,
      totalFrames: scene.duration,
    };
  } catch (error) {
    const cleanup = cancelOutput();
    if (!options.signal?.aborted) await cleanup;
    checkAbort(options.signal);
    throw error;
  } finally {
    options.signal?.removeEventListener("abort", abort);
    prepared.input.dispose();
  }
}

const expectation = (prepared: PreparedCopy, options: CopyOptions) => ({
  width: prepared.candidate.scene.width,
  height: prepared.candidate.scene.height,
  durationSeconds:
    prepared.candidate.scene.duration / prepared.candidate.scene.fps,
  fps: prepared.candidate.scene.fps,
  hasAudio: prepared.audio !== null,
  requireAudibleAudio: options.requireAudibleAudio ?? false,
});

export async function tryCopyVideoBlob(
  options: CopyOptions,
): Promise<ExportVideoResult | null> {
  const prepared = await prepareCopy(options, MAX_MEMORY_BYTES);
  if (!prepared) return null;
  try {
    const target = new BufferTarget();
    const metadata = await writeCopy(
      prepared,
      options,
      target,
      MAX_MEMORY_BYTES,
    );
    if (!target.buffer) throw new Error("Copy export produced no MP4.");
    const blob = new Blob([target.buffer], { type: "video/mp4" });
    const verification = await verifyExportBlob(
      blob,
      expectation(prepared, options),
      options.verification ?? "container",
      options.signal,
    );
    if (verification.status === "failed")
      throw new ExportVerificationError(verification);
    return {
      blob,
      codec: metadata.codec,
      audioCodec: metadata.audioCodec,
      totalFrames: metadata.totalFrames,
      verification,
    };
  } finally {
    prepared.input.dispose();
  }
}

export async function tryCopyVideoStream(
  options: CopyOptions,
  writable: WritableStream<StreamTargetChunk>,
  streamOptions: StreamTargetOptions,
): Promise<ExportVideoStreamResult | null> {
  const maximum = options.budget?.maxAssetBytes ?? 512 * 1024 * 1024;
  const prepared = await prepareCopy(options, maximum);
  if (!prepared) return null;
  let writer: WritableStreamDefaultWriter<StreamTargetChunk> | undefined;
  const abortDestination = () => {
    void writer?.abort(options.signal?.reason).catch(() => {});
  };
  try {
    // No writer is acquired until all eligibility/packet/audio checks finish.
    const destination = (writer = writable.getWriter());
    void destination.closed.catch(() => {});
    options.signal?.addEventListener("abort", abortDestination, { once: true });
    const bounded = new WritableStream<StreamTargetChunk>({
      async write(chunk) {
        checkAbort(options.signal);
        if (
          chunk.type !== "write" ||
          chunk.position < 0 ||
          chunk.position + chunk.data.byteLength > maximum
        )
          throw new Error("Copied output exceeds the export byte limit.");
        await abortable(destination.write(chunk), options.signal);
      },
      close: () => abortable(destination.close(), options.signal),
      abort: (reason) => {
        const cleanup = destination.abort(reason);
        if (options.signal?.aborted) {
          void cleanup.catch(() => {});
          return;
        }
        return cleanup;
      },
    });
    const result = await writeCopy(
      prepared,
      options,
      new StreamTarget(bounded, {
        ...streamOptions,
        chunked: true,
        chunkSize: Math.min(
          1024 * 1024,
          Math.max(1024, streamOptions.chunkSize ?? 1024 * 1024),
        ),
      }),
      maximum,
    );
    const expected = expectation(prepared, options),
      mode = options.verification ?? "container";
    const metadata = {
      source: "custom" as const,
      byteLength: null,
      mimeType: "video/mp4",
      label: "Copied WritableStream",
    };
    const verification = options.verificationSink
      ? await verifyExportWithSink(options.verificationSink, {
          mode,
          expectation: expected,
          metadata,
          signal: options.signal,
        })
      : unverifiedExportForSink(expected, mode, metadata);
    if (verification.status === "failed")
      throw new ExportVerificationError(verification);
    return { ...result, verification };
  } catch (error) {
    const cleanup = writer?.abort(error).catch(() => {});
    if (!options.signal?.aborted) await cleanup;
    checkAbort(options.signal);
    throw error;
  } finally {
    options.signal?.removeEventListener("abort", abortDestination);
    writer?.releaseLock();
    prepared.input.dispose();
  }
}
