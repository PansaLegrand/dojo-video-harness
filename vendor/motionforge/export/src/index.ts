import {
  BoundedTextMeasureCache,
  Canvas2DStaticDisplayCache,
  ScratchSurfacePool,
  checkedRgbaBytes,
  prepareFrame,
  disposeAssetsAsync,
  estimateMediaResources,
  preflightCanvas2D,
  renderStill,
  resolveAssets,
  type AudioClip,
  type ResolvedAssets,
  type ResolveAssetsOptions,
  type MediaResourceEstimate,
  type Canvas2DOpaqueExtensionRegistry,
  type TextMeasureCache,
} from "@motionforge/renderer-canvas2d";
import {
  withCanvas2DResolvedAssets,
  type Canvas2DSceneRuntime,
} from "@motionforge/renderer-canvas2d/runtime";
import { evaluateKeyframes, type ResolvedScene } from "@motionforge/core";
import type {
  Scene,
  SceneAudioBus,
  SceneNode,
  VolumeEnvelope,
} from "@motionforge/schema";
import {
  AudioSample,
  AudioSampleSource,
  BufferTarget,
  CanvasSource,
  getFirstEncodableAudioCodec,
  getFirstEncodableVideoCodec,
  Mp4OutputFormat,
  Output,
  StreamTarget,
  type StreamTargetChunk,
  type StreamTargetOptions,
  type Target,
  QUALITY_HIGH,
  type AudioCodec,
  type Quality,
  type VideoCodec,
} from "mediabunny";
import {
  unverifiedExportForSink,
  verifyExportBlob,
  verifyExportWithSink,
  type ExportVerificationExpectation,
  type ExportVerificationMode,
  type ExportVerificationResult,
  type ExportVerificationSink,
} from "./verification";

export * from "./verification";
import { measureAacEncoderTiming, audioEncoderConfigKey, type AacEncoderTiming } from "./aac-encoder-timing";
import { repairAacBlob, createAacTimingStream } from "./mp4-aac-target";
import type { AacMoovTiming } from "./mp4-aac-timing";
import { AacTimingError } from "./aac-timing-error";

export type ExportCapability = {
  webCodecs: boolean;
  videoEncoder: boolean;
  offscreenCanvas: boolean;
  worker: boolean;
  streamingTarget: boolean;
};

export type ExportEstimate = {
  totalFrames: number;
  durationSeconds: number;
  rawRgbaBytes: number;
  estimatedEncodedBytes: number;
  hasAudio: boolean;
  resources: MediaResourceEstimate;
};

export type ExportPreflightResult = {
  ok: boolean;
  capability: ExportCapability;
  estimate: ExportEstimate;
  issues: Array<{
    severity: "error" | "warning";
    code: string;
    message: string;
  }>;
};

export type HostExportFallbackRequest = {
  options: ExportVideoOptions;
  preflight: ExportPreflightResult;
};

/** Host-owned fallback; MotionForge does not select or operate a cloud renderer. */
export type HostExportFallback = (
  request: HostExportFallbackRequest,
) => Promise<ExportVideoResult>;

export type ExportExecutionResult = {
  executor: "browser" | "host";
  result: ExportVideoResult;
  preflight: ExportPreflightResult;
};

export type ExportVideoOptions = {
  scene: Scene;
  signal?: AbortSignal;
  onProgress?: (progress: RenderFrameSequenceProgress) => void;
  /**
   * Minimum milliseconds between progress callbacks. The final frame always
   * reports. Defaults to per-frame progress for backwards compatibility.
   */
  progressIntervalMs?: number;
  /** First scene frame to export (default 0). */
  startFrame?: number;
  /** Last scene frame to export, inclusive (default scene.duration - 1). */
  endFrame?: number;
  /**
   * Target bitrate in bits per second, or a mediabunny Quality preset.
   * Defaults to QUALITY_HIGH.
   */
  bitrate?: number | Quality;
  /**
   * Candidate codecs in order of preference. Defaults to every codec the MP4
   * container supports; the first one this browser can encode is used.
   */
  codecs?: VideoCodec[];
  /**
   * Pre-resolved assets. When omitted, exportVideo calls resolveAssets(scene)
   * itself before the frame loop.
   */
  assets?: ResolvedAssets;
  /** Trusted extension definitions used when resolving extension nodes. */
  extensions?: ResolveAssetsOptions["extensions"];
  /** Require every extension definition to support worker execution. */
  worker?: boolean;
  /** Exact opaque handlers used for extension display preflight/execution. */
  opaqueExtensionRegistry?: Canvas2DOpaqueExtensionRegistry;
  /** Final export uses original sources by default; opt in for draft proxy export. */
  preferProxy?: boolean;
  budget?: ResolveAssetsOptions["budget"];
  assetPolicy?: ResolveAssetsOptions["assetPolicy"];
  analysisCache?: ResolveAssetsOptions["analysisCache"];
  fontCache?: ResolveAssetsOptions["fontCache"];
  /** Shared by every encoded frame; an owned bounded pool is created when omitted. */
  scratchSurfacePool?: ScratchSurfacePool;
  /** Caller-owned when supplied; otherwise export creates and disposes a bounded cache. */
  staticDisplayCache?: Canvas2DStaticDisplayCache;
  /**
   * Audio is mixed and fed to the encoder in windows of this many seconds
   * (default 10), so audio memory stays flat regardless of scene length.
   * Exposed mainly for tests; the default is fine.
   */
  audioChunkSeconds?: number;
  /** Blob exports default to container verification; deeper modes stay bounded. */
  verification?: ExportVerificationMode;
  /** Opt in when sound is required; mute and silent inputs are otherwise valid. */
  requireAudibleAudio?: boolean;
  /** Host-owned reread callback for stream/file/custom sinks. */
  verificationSink?: ExportVerificationSink;
};

type RuntimeOwnedExportOption =
  | "scene"
  | "assets"
  | "extensions"
  | "worker"
  | "opaqueExtensionRegistry"
  | "preferProxy"
  | "budget"
  | "assetPolicy"
  | "analysisCache"
  | "fontCache"
  | "scratchSurfacePool"
  | "staticDisplayCache";

/** Export options for media already prepared by a Canvas2D runtime. */
export type RuntimeExportVideoOptions = Omit<
  ExportVideoOptions,
  RuntimeOwnedExportOption
>;

export type ExportVideoResult = {
  blob: Blob;
  codec: VideoCodec;
  /** Audio codec of the mixed track, or null when the scene has no audio. */
  audioCodec: AudioCodec | null;
  totalFrames: number;
  /** Present on exports produced by MF2-aware runtimes. */
  verification?: ExportVerificationResult;
};

export type ExportVideoStreamResult = Omit<ExportVideoResult, "blob"> & {
  mimeType: string;
};

export class ExportVerificationError extends Error {
  constructor(readonly verification: ExportVerificationResult) {
    super(
      `MotionForge output verification failed: ${verification.issues
        .map((issue) => `[${issue.code}] ${issue.message}`)
        .join("; ")}`,
    );
    this.name = "ExportVerificationError";
  }
}

/** An audible node's absolute active window in scene frames, ancestors applied. */
export type AudioPlacement = {
  node: SceneNode;
  /** First scene frame the node is audible (inclusive). */
  startFrame: number;
  /** Scene frame the node stops being audible (exclusive). */
  endFrame: number;
  /**
   * Frames between the node's own start and the audible window's start
   * (nonzero when an ancestor window clips the node's head). Needed to map
   * the window back to source time for video nodes, whose source clock runs
   * from the node's start, not the window's.
   */
  framesIntoNode: number;
};

/**
 * Walks the scene tree and returns every audible node — audio nodes and
 * video nodes (whose clips may carry their own soundtrack) — with its
 * absolute active window, mirroring the evaluator's timing semantics
 * (parent-relative `from`, duration defaulting to the parent's, clipped by
 * ancestor windows).
 */
export function collectAudioPlacements(scene: Scene): AudioPlacement[] {
  const placements: AudioPlacement[] = [];

  const visit = (
    nodes: SceneNode[],
    origin: number,
    windowStart: number,
    windowEnd: number,
    parentDuration: number,
  ): void => {
    for (const node of nodes) {
      const from = node.from ?? 0;
      const duration = node.duration ?? parentDuration;
      const start = origin + from;
      const activeStart = Math.max(windowStart, start);
      const activeEnd = Math.min(windowEnd, start + duration);

      if (activeStart >= activeEnd) {
        continue;
      }

      if (node.type === "audio" || node.type === "video") {
        placements.push({
          node,
          startFrame: activeStart,
          endFrame: activeEnd,
          framesIntoNode: activeStart - start,
        });
      }

      visit(node.children ?? [], start, activeStart, activeEnd, duration);
    }
  };

  visit(scene.nodes, 0, 0, scene.duration, scene.duration);
  return placements;
}

/** Source PCM positioned on the output timeline, ready for mixing. */
export type AudioSegment = {
  /** One Float32Array per source channel. */
  channels: Float32Array[];
  sampleRate: number;
  /** Seconds from the start of the mix where this segment begins. */
  startTime: number;
  /** Gain 0..1. */
  volume: number;
  /** Optional node-local gain curve multiplied by volume. */
  volumeEnvelope?: VolumeEnvelope;
  /** Node-local seconds at segment start, used when sampling volumeEnvelope. */
  envelopeStartTime?: number;
  /** Scene fps for frame-based volumeEnvelope sampling. */
  envelopeFps?: number;
  /** Stereo balance from -1 (left) to 1 (right). */
  pan?: number;
  /** Named mix bus; default master. */
  bus?: string;
};

/**
 * Mixes segments into output PCM (one Float32Array per channel) using linear
 * resampling. Mono segments fan out to every output channel; overlapping
 * segments sum and the final mix clamps to [-1, 1]. Pure and deterministic.
 */
export function mixAudioSegments(
  segments: AudioSegment[],
  durationSeconds: number,
  sampleRate = 48_000,
  channelCount = 2,
  clampOutput = true,
): Float32Array<ArrayBuffer>[] {
  const length = Math.max(1, Math.round(durationSeconds * sampleRate));
  const output = Array.from(
    { length: channelCount },
    () => new Float32Array(length),
  );

  for (const segment of segments) {
    const sourceLength = segment.channels[0]?.length ?? 0;

    if (sourceLength === 0 || segment.channels.length === 0) {
      continue;
    }

    const startIndex = Math.round(segment.startTime * sampleRate);
    const outSamples = Math.ceil(
      (sourceLength / segment.sampleRate) * sampleRate,
    );
    // Precomputed once per segment (not per channel, not per sample):
    // keyframe evaluation per output sample dominated the whole mix.
    const gains = segmentEnvelopeGains(segment, outSamples, sampleRate);

    for (let channel = 0; channel < channelCount; channel += 1) {
      const target = output[channel];
      const source =
        segment.channels[Math.min(channel, segment.channels.length - 1)];

      if (!target || !source) {
        continue;
      }
      const volume = segment.volume;
      const balance = panGain(segment.pan ?? 0, channel, channelCount);

      for (let index = 0; index < outSamples; index += 1) {
        const outIndex = startIndex + index;

        if (outIndex < 0 || outIndex >= length) {
          continue;
        }

        const sourcePosition = (index / sampleRate) * segment.sampleRate;
        const lower = Math.floor(sourcePosition);
        const upper = Math.min(sourceLength - 1, lower + 1);
        const t = sourcePosition - lower;
        const lowerValue = source[lower] ?? 0;
        const upperValue = source[upper] ?? 0;
        target[outIndex] =
          (target[outIndex] ?? 0) +
          (lowerValue + (upperValue - lowerValue) * t) *
            volume *
            (gains ? (gains[index] ?? 1) : 1) *
            balance;
      }
    }
  }

  if (clampOutput) {
    for (const channel of output) {
      for (let index = 0; index < channel.length; index += 1) {
        channel[index] = Math.min(1, Math.max(-1, channel[index] ?? 0));
      }
    }
  }

  return output;
}

function panGain(pan: number, channel: number, channelCount: number): number {
  if (channelCount !== 2) return 1;
  const bounded = Math.min(1, Math.max(-1, pan));
  return channel === 0
    ? bounded > 0
      ? 1 - bounded
      : 1
    : bounded < 0
      ? 1 + bounded
      : 1;
}

export function evaluateVolumeEnvelope(
  envelope: VolumeEnvelope | undefined,
  frame: number,
): number {
  const value = evaluateKeyframes(envelope ?? [], frame);
  return typeof value === "number" ? value : 1;
}

/**
 * Envelope gains are evaluated at block edges and interpolated within the
 * block (~2.7 ms at 48 kHz) instead of per sample. Linear ramps stay exact;
 * eased ramps deviate by less than the easing curvature across 128 samples,
 * far below audibility for volume automation.
 */
const ENVELOPE_BLOCK_SAMPLES = 128;

/**
 * Per-output-sample envelope gains for a segment, or null when the segment
 * has no envelope. Edges are sampled at the first and last sample of each
 * block so envelopes that clamp at their final keyframe inside a block keep
 * their exact endpoint values.
 */
function segmentEnvelopeGains(
  segment: AudioSegment,
  outSamples: number,
  sampleRate: number,
): Float32Array | null {
  const envelope = segment.volumeEnvelope;
  const fps = segment.envelopeFps;

  if (!envelope || !fps || outSamples <= 0) {
    return null;
  }

  const startTime = segment.envelopeStartTime ?? 0;
  const gains = new Float32Array(outSamples);

  let nextKeyframe = 0;
  for (let block = 0; block < outSamples;) {
    // Never interpolate one block across two different envelope segments. The
    // first sample on/after a knot starts a new block, including fractional
    // sample positions and export chunks beginning inside an existing ramp.
    let boundary = outSamples;
    while (nextKeyframe < envelope.length) {
      const sample = Math.ceil((envelope[nextKeyframe]!.frame / fps - startTime) * sampleRate);
      if (sample <= block) { nextKeyframe++; continue; }
      boundary = sample; break;
    }
    const end = Math.min(outSamples, block + ENVELOPE_BLOCK_SAMPLES, boundary);
    const first = evaluateVolumeEnvelope(
      envelope,
      (startTime + block / sampleRate) * fps,
    );
    const last = evaluateVolumeEnvelope(
      envelope,
      (startTime + (end - 1) / sampleRate) * fps,
    );
    const span = end - 1 - block;

    for (let index = block; index < end; index += 1) {
      gains[index] =
        span === 0 ? first : first + ((last - first) * (index - block)) / span;
    }
    block = end;
  }

  return gains;
}

export type RenderFrameSequenceProgress = {
  frame: number;
  frameIndex: number;
  totalFrames: number;
  timestampUs: number;
  sceneTimestampUs: number;
};

export type RenderedSequenceFrame = {
  frame: number;
  frameIndex: number;
  timestampUs: number;
  sceneTimestampUs: number;
};

export type RenderFrameSequenceOptions = {
  scene: Scene;
  context: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;
  startFrame?: number;
  endFrame?: number;
  signal?: AbortSignal;
  /** Resolved assets forwarded to the default renderStill renderer. */
  assets?: ResolvedAssets;
  /** Shared across the sequence; supplied pools remain caller-owned. */
  scratchSurfacePool?: ScratchSurfacePool;
  /** Supplied caches remain caller-owned; otherwise a bounded sequence cache is used. */
  staticDisplayCache?: Canvas2DStaticDisplayCache;
  renderFrame?: (
    context: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D,
    scene: Scene,
    frame: number,
    resolvedScene?: ResolvedScene,
    textMeasureCache?: TextMeasureCache,
    scratchSurfacePool?: ScratchSurfacePool,
    staticDisplayCache?: Canvas2DStaticDisplayCache,
  ) => void;
  onFrame?: (frame: RenderedSequenceFrame) => void | Promise<void>;
  onProgress?: (progress: RenderFrameSequenceProgress) => void;
  /**
   * Minimum milliseconds between progress callbacks. Defaults to 0 so callers
   * that need per-frame progress keep the historical behavior.
   */
  progressIntervalMs?: number;
};

/** Frame-loop options for media already prepared by a Canvas2D runtime. */
export type RuntimeRenderFrameSequenceOptions = Omit<
  RenderFrameSequenceOptions,
  "scene" | "assets" | "scratchSurfacePool" | "staticDisplayCache"
>;

export type RenderFrameSequenceResult = {
  startFrame: number;
  endFrame: number;
  totalFrames: number;
  renderedFrames: number;
};

export function detectExportCapability(
  globalObject: Partial<typeof globalThis> = globalThis,
): ExportCapability {
  return {
    webCodecs: typeof globalObject.VideoFrame === "function",
    videoEncoder: typeof globalObject.VideoEncoder === "function",
    offscreenCanvas: typeof globalObject.OffscreenCanvas === "function",
    worker: typeof globalObject.Worker === "function",
    streamingTarget:
      typeof globalObject.WritableStream === "function" &&
      typeof globalObject.TransformStream === "function",
  };
}

export function estimateExport(
  scene: Scene,
  options: { startFrame?: number; endFrame?: number; bitrate?: number } = {},
): ExportEstimate {
  const startFrame = options.startFrame ?? 0;
  const endFrame = options.endFrame ?? scene.duration - 1;
  validateFrameRange(scene, startFrame, endFrame);
  const totalFrames = endFrame - startFrame + 1;
  const durationSeconds = totalFrames / scene.fps;
  const bitrate =
    options.bitrate ??
    Math.max(
      1_000_000,
      Math.round(scene.width * scene.height * scene.fps * 0.08),
    );
  const hasAudio = collectAudioPlacements(scene).some(({ node }) => {
    if (node.type === "audio") return true;
    const asset = node.assetId ? scene.assets[node.assetId] : undefined;
    return asset?.metadata?.hasAudio !== false;
  });
  return {
    totalFrames,
    durationSeconds,
    rawRgbaBytes: scene.width * scene.height * 4 * totalFrames,
    estimatedEncodedBytes:
      Math.ceil((durationSeconds * bitrate) / 8) +
      (hasAudio ? Math.ceil((durationSeconds * 128_000) / 8) : 0),
    hasAudio,
    resources: estimateMediaResources(scene),
  };
}

export function preflightExport(
  scene: Scene,
  globalObject: Partial<typeof globalThis> = globalThis,
  options: Pick<
    ExportVideoOptions,
    | "startFrame"
    | "endFrame"
    | "bitrate"
    | "extensions"
    | "worker"
    | "opaqueExtensionRegistry"
    | "budget"
    | "assets"
  > = {},
): ExportPreflightResult {
  const capability = detectExportCapability(globalObject);
  const estimate = estimateExport(scene, {
    startFrame: options.startFrame,
    endFrame: options.endFrame,
    bitrate: typeof options.bitrate === "number" ? options.bitrate : undefined,
  });
  const canvas = preflightCanvas2D(scene, globalObject, {
    extensions: options.extensions,
    worker: options.worker,
    opaqueExtensionRegistry: options.opaqueExtensionRegistry,
    budget: options.budget,
  });
  const resolutionOnlyCodes = new Set([
    "image_decoder_unavailable",
    "font_loading_unavailable",
    "lottie_requires_dom",
    "asset_byte_budget_exceeded",
  ]);
  const issues: ExportPreflightResult["issues"] = canvas.issues.filter(
    (issue) =>
      !options.assets ||
      (!resolutionOnlyCodes.has(issue.code) &&
        !issue.code.startsWith("extension_")),
  );
  if (!capability.webCodecs) {
    issues.push({
      severity: "error",
      code: "video_frame_unavailable",
      message: "MP4 export requires the WebCodecs VideoFrame API.",
    });
  }
  if (!capability.videoEncoder) {
    issues.push({
      severity: "error",
      code: "video_encoder_unavailable",
      message: "MP4 export requires the WebCodecs VideoEncoder API.",
    });
  }
  if (options.worker && !capability.offscreenCanvas) {
    issues.push({
      severity: "error",
      code: "worker_offscreen_canvas_unavailable",
      message: "Worker export requires OffscreenCanvas.",
    });
  }
  if (!capability.worker) {
    issues.push({
      severity: "warning",
      code: "worker_unavailable",
      message:
        "Worker export is unavailable; main-thread export remains possible.",
    });
  }
  return {
    ok: !issues.some((issue) => issue.severity === "error"),
    capability,
    estimate,
    issues,
  };
}

/** Uses local browser export when capable, otherwise delegates explicitly to the host. */
export async function exportVideoWithFallback(
  options: ExportVideoOptions,
  fallback?: HostExportFallback,
  globalObject: Partial<typeof globalThis> = globalThis,
): Promise<ExportExecutionResult> {
  const preflight = preflightExport(options.scene, globalObject, {
    startFrame: options.startFrame,
    endFrame: options.endFrame,
    bitrate: options.bitrate,
    extensions: options.extensions,
    worker: options.worker,
    opaqueExtensionRegistry: options.opaqueExtensionRegistry,
    budget: options.budget,
    assets: options.assets,
  });
  if (preflight.ok) {
    return {
      executor: "browser",
      result: await exportVideo(options),
      preflight,
    };
  }
  if (!fallback) {
    throw new Error(
      `Local MotionForge export is unavailable and no host fallback was supplied:\n${preflight.issues
        .filter((issue) => issue.severity === "error")
        .map((issue) => `- [${issue.code}] ${issue.message}`)
        .join("\n")}`,
    );
  }
  return {
    executor: "host",
    result: await fallback({ options, preflight }),
    preflight,
  };
}

export async function renderFrameSequence(
  options: RenderFrameSequenceOptions,
): Promise<RenderFrameSequenceResult> {
  validateFrameRange(
    options.scene,
    options.startFrame ?? 0,
    options.endFrame ?? options.scene.duration - 1,
  );
  throwIfAborted(options.signal);

  // Blob, stream, and worker export all share this loop. Keep intermediate
  // surfaces and static rasters for the sequence, rather than allocating and
  // discarding the renderer's transient pool for every encoded frame.
  const ownedScratch = options.scratchSurfacePool
    ? undefined
    : new ScratchSurfacePool({
        createCanvas: (width, height) =>
          createExportCanvas(width, height).canvas,
        // Match the renderer's bounded transient policy, including oversized
        // shadows and object-fit:none surfaces outside the composition.
        maxBytes: Math.min(
          512 * 1024 * 1024,
          Math.max(
            64 * 1024 * 1024,
            checkedRgbaBytes(options.scene.width, options.scene.height) * 4,
          ),
        ),
        maxSurfaces: 32,
        maxDimension: Number.MAX_SAFE_INTEGER,
      });
  const ownedStatic = options.staticDisplayCache
    ? undefined
    : new Canvas2DStaticDisplayCache({
        maxBytes: 128 * 1024 * 1024,
        maxEntries: 256,
        maxKeyBytes: 1024 * 1024,
        maxDimension: 16_384,
      });
  try {
    return await renderFrameSequenceWithCaches({
      ...options,
      scratchSurfacePool: options.scratchSurfacePool ?? ownedScratch,
      staticDisplayCache: options.staticDisplayCache ?? ownedStatic,
    });
  } finally {
    try {
      ownedStatic?.dispose();
    } finally {
      ownedScratch?.dispose();
    }
  }
}

async function renderFrameSequenceWithCaches(
  options: RenderFrameSequenceOptions,
): Promise<RenderFrameSequenceResult> {
  const startFrame = options.startFrame ?? 0;
  const endFrame = options.endFrame ?? options.scene.duration - 1;

  const totalFrames = endFrame - startFrame + 1;
  const renderFrame =
    options.renderFrame ??
    ((
      context: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D,
      scene: Scene,
      frame: number,
      resolvedScene?: ResolvedScene,
      textMeasureCache?: TextMeasureCache,
      scratchSurfacePool?: ScratchSurfacePool,
      staticDisplayCache?: Canvas2DStaticDisplayCache,
    ) =>
      renderStill(context, scene, frame, {
        assets: options.assets,
        resolvedScene,
        textMeasureCache,
        scratchSurfacePool,
        staticDisplayCache,
      }));
  let renderedFrames = 0;
  let lastProgressAt = 0;
  const textMeasureCache: TextMeasureCache = new BoundedTextMeasureCache();

  for (let frame = startFrame; frame <= endFrame; frame += 1) {
    throwIfAborted(options.signal);

    let resolvedScene: ResolvedScene | undefined;

    if (options.assets) {
      // Stages decoded video frames for this scene frame; no-op for scenes
      // without video assets.
      resolvedScene = await prepareFrame(options.scene, frame, options.assets, {
        signal: options.signal,
      });
    }

    renderFrame(
      options.context,
      options.scene,
      frame,
      resolvedScene,
      textMeasureCache,
      options.scratchSurfacePool,
      options.staticDisplayCache,
    );

    const rendered: RenderedSequenceFrame = {
      frame,
      frameIndex: frame - startFrame,
      timestampUs: frameToTimestampUs(frame - startFrame, options.scene.fps),
      sceneTimestampUs: frameToTimestampUs(frame, options.scene.fps),
    };

    await options.onFrame?.(rendered);

    renderedFrames += 1;
    if (options.onProgress) {
      const progress = {
        ...rendered,
        totalFrames,
      };
      const progressIntervalMs = options.progressIntervalMs ?? 0;
      const now = performance.now();
      const isFinalFrame = frame === endFrame;

      if (
        progressIntervalMs <= 0 ||
        isFinalFrame ||
        now - lastProgressAt >= progressIntervalMs
      ) {
        lastProgressAt = now;
        options.onProgress(progress);
      }
    }
  }

  return {
    startFrame,
    endFrame,
    totalFrames,
    renderedFrames,
  };
}

/**
 * Runs the legacy deterministic frame loop against the runtime's current
 * Scene and resolved assets. The borrow remains active through async frame
 * callbacks and is released on success, failure, or cancellation.
 */
export async function renderFrameSequenceFromRuntime(
  runtime: Canvas2DSceneRuntime,
  options: RuntimeRenderFrameSequenceOptions,
): Promise<RenderFrameSequenceResult> {
  return await withCanvas2DResolvedAssets(
    runtime,
    ({ assets, scratchSurfacePool, staticDisplayCache, scene, signal }) =>
      renderFrameSequence({
        ...options,
        scene,
        assets,
        scratchSurfacePool,
        staticDisplayCache,
        signal,
      }),
    { signal: options.signal },
  );
}

/**
 * Renders the scene frame by frame through the shared Canvas2D renderer and
 * encodes it to an MP4 in the browser via WebCodecs (encoding and muxing by
 * mediabunny). Resolves with the finished file as a Blob.
 */
export async function exportVideo(
  options: ExportVideoOptions,
): Promise<ExportVideoResult> {
  const target = new BufferTarget();
  const result = await runExportVideo(options, target);
  if (!target.buffer) {
    throw new Error("MP4 muxing finished without producing an output buffer.");
  }
  const { mimeType, aacTiming, ...metadata } = result;
  const original = new Blob([target.buffer], { type: mimeType });
  const blob = aacTiming ? await repairAacBlob(original, aacTiming, options.signal) : original;
  const verification = await verifyExportBlob(
    blob,
    exportVerificationExpectation(options, result),
    options.verification ?? "container",
    options.signal,
  );
  if (verification.status === "failed") {
    throw new ExportVerificationError(verification);
  }
  return {
    ...metadata,
    blob,
    verification,
  };
}

/** Encodes the runtime's current prepared revision to an MP4 Blob. */
export async function exportVideoFromRuntime(
  runtime: Canvas2DSceneRuntime,
  options: RuntimeExportVideoOptions = {},
): Promise<ExportVideoResult> {
  return await withCanvas2DResolvedAssets(
    runtime,
    ({ assets, scratchSurfacePool, staticDisplayCache, scene, signal }) =>
      exportVideo({
        ...options,
        scene,
        assets,
        scratchSurfacePool,
        staticDisplayCache,
        signal,
      }),
    { signal: options.signal },
  );
}

export async function exportVideoToStream(
  options: ExportVideoOptions,
  writable: WritableStream<StreamTargetChunk>,
  streamOptions: StreamTargetOptions = {},
): Promise<ExportVideoStreamResult> {
  const relay = createAacTimingStream(writable, options.signal);
  let result: InternalExportResult;
  try { result = await runExportVideo(options, new StreamTarget(relay.writable, streamOptions), { onTiming: relay.setTiming, onMoov: relay.onMoov }); }
  catch (cause) { await relay.abort(cause); throw cause; }
  const expectation = exportVerificationExpectation(options, result);
  const mode = options.verification ?? "container";
  const request = {
    mode,
    expectation,
    metadata: {
      source: "custom" as const,
      byteLength: null,
      mimeType: result.mimeType,
      label: "WritableStream",
    },
    signal: options.signal,
  };
  const verification = options.verificationSink
    ? await verifyExportWithSink(options.verificationSink, request)
    : unverifiedExportForSink(expectation, mode, request.metadata);
  if (verification.status === "failed") {
    throw new ExportVerificationError(verification);
  }
  const { aacTiming: _aacTiming, ...metadata } = result;
  return { ...metadata, verification };
}

/** Streams an MP4 from the runtime's current prepared revision. */
export async function exportVideoToStreamFromRuntime(
  runtime: Canvas2DSceneRuntime,
  options: RuntimeExportVideoOptions,
  writable: WritableStream<StreamTargetChunk>,
  streamOptions: StreamTargetOptions = {},
): Promise<ExportVideoStreamResult> {
  return await withCanvas2DResolvedAssets(
    runtime,
    ({ assets, scratchSurfacePool, staticDisplayCache, scene, signal }) =>
      exportVideoToStream(
        {
          ...options,
          scene,
          assets,
          scratchSurfacePool,
          staticDisplayCache,
          signal,
        },
        writable,
        streamOptions,
      ),
    { signal: options.signal },
  );
}

function exportVerificationExpectation(
  options: ExportVideoOptions,
  result: Pick<InternalExportResult, "audioCodec" | "totalFrames">,
): ExportVerificationExpectation {
  return {
    width: options.scene.width,
    height: options.scene.height,
    durationSeconds: result.totalFrames / options.scene.fps,
    hasAudio:
      options.requireAudibleAudio === true || result.audioCodec !== null,
    requireAudibleAudio: options.requireAudibleAudio ?? false,
    fps: options.scene.fps,
  };
}

type InternalExportResult = ExportVideoStreamResult & { aacTiming?: AacMoovTiming };

async function runExportVideo(
  options: ExportVideoOptions,
  target: Target,
  timingSink: { onTiming?: (timing: AacMoovTiming) => void; onMoov?: (data: Uint8Array, position: number) => void } = {},
): Promise<InternalExportResult> {
  const { scene } = options;
  const preflight = preflightExport(scene, globalThis, {
    startFrame: options.startFrame,
    endFrame: options.endFrame,
    bitrate: options.bitrate,
    extensions: options.extensions,
    worker: options.worker,
    opaqueExtensionRegistry: options.opaqueExtensionRegistry,
    budget: options.budget,
    assets: options.assets,
  });

  if (!preflight.ok) {
    throw new Error(
      `MotionForge export preflight failed before encoding:\n${preflight.issues
        .filter((issue) => issue.severity === "error")
        .map((issue) => `- [${issue.code}] ${issue.message}`)
        .join(
          "\n",
        )}\nGate export UI with preflightExport() or detectExportCapability().`,
    );
  }

  const format = new Mp4OutputFormat();
  const codec = await getFirstEncodableVideoCodec(
    options.codecs ?? format.getSupportedVideoCodecs(),
    { width: scene.width, height: scene.height },
  );

  if (!codec) {
    throw new Error(
      `This browser cannot encode any MP4-compatible video codec at ${scene.width}x${scene.height}. Try a smaller scene size or a browser with WebCodecs encoding support.`,
    );
  }

  const assets =
    options.assets ??
    (await resolveAssets(scene, {
      extensions: options.extensions,
      worker: options.worker,
      opaqueExtensionRegistry: options.opaqueExtensionRegistry,
      signal: options.signal,
      preferProxy: options.preferProxy ?? false,
      budget: options.budget,
      assetPolicy: options.assetPolicy,
      analysisCache: options.analysisCache,
      fontCache: options.fontCache,
    }));
  const ownsAssets = options.assets === undefined;
  return withResolvedAssetOwnership(assets, ownsAssets, async () => {
    if (
      Array.from(assets.videos.values()).some((clip) => Boolean(clip.audio)) &&
      typeof globalThis.AudioDecoder !== "function"
    ) {
      throw new Error(
        "Resolved video media contains an embedded soundtrack, but this environment has no AudioDecoder. Declare metadata.hasAudio for earlier preflight or use a host fallback.",
      );
    }
    const { canvas, context } = createExportCanvas(scene.width, scene.height);

    // Tracks can only be added while the output is pending, so probe for
    // audible content up front (no decoding). Reuse this immutable placement
    // and ducking plan for every chunk in this pinned scene revision.
    const startFrame = options.startFrame ?? 0;
    const endFrame = options.endFrame ?? scene.duration - 1;
    const audioPlan = createAudioMixPlan(scene);
    const hasAudio = sceneHasAudibleContent(
      scene,
      assets,
      startFrame,
      endFrame,
      audioPlan.placements,
    );
    let audioSource: AudioSampleSource | null = null;
    let audioCodec: AudioCodec | null = null;
    let aacProfile: AacEncoderTiming | undefined, aacTiming: AacMoovTiming | undefined;
    let encodedTimingError: AacTimingError | undefined, checkedFirstPacket = false;

    if (hasAudio) {
      audioCodec = await getFirstEncodableAudioCodec(
        format.getSupportedAudioCodecs(),
        {
          numberOfChannels: MIX_CHANNELS,
          sampleRate: MIX_SAMPLE_RATE,
        },
      );

      if (!audioCodec) {
        throw new Error(
          "The scene has audio nodes but this browser cannot encode any MP4-compatible audio codec.",
        );
      }

      if (audioCodec === "aac") {
        aacProfile = await measureAacEncoderTiming({ sampleRate: MIX_SAMPLE_RATE, numberOfChannels: MIX_CHANNELS, bitrate: QUALITY_HIGH, signal: options.signal });
        aacTiming = { sampleRate: MIX_SAMPLE_RATE, sampleCount: Math.round((endFrame - startFrame + 1) / scene.fps * MIX_SAMPLE_RATE), primingSamples: aacProfile.primingSamples };
        timingSink.onTiming?.(aacTiming);
      }
    }
    const outputFormat = aacTiming && timingSink.onMoov ? new Mp4OutputFormat({ fastStart: false, onMoov: (data, position) => {
      if (encodedTimingError) throw encodedTimingError;
      timingSink.onMoov!(data, position);
    } }) : format;
    const output = new Output({ format: outputFormat, target });
    const source = new CanvasSource(canvas, { codec, bitrate: options.bitrate ?? QUALITY_HIGH });
    output.addVideoTrack(source, { frameRate: scene.fps });
    if (audioCodec) {
      // Raw PCM keeps the worker path independent of AudioBuffer.
      audioSource = new AudioSampleSource({
        codec: audioCodec,
        bitrate: QUALITY_HIGH,
        ...(aacProfile ? {
          onEncoderConfig: (config: AudioEncoderConfig) => { if (audioEncoderConfigKey(config) !== audioEncoderConfigKey(aacProfile!.encoderConfig)) encodedTimingError = new AacTimingError("AAC_TIMING_UNVERIFIED", "The AAC encoder profile changed after its timing check."); },
          onEncodedPacket: (packet: { timestamp: number }) => {
            if (checkedFirstPacket) return;
            checkedFirstPacket = true;
            if (Math.abs(packet.timestamp * MIX_SAMPLE_RATE) > .5) encodedTimingError = new AacTimingError("AAC_TIMING_UNVERIFIED", "The AAC encoder timestamps differ from its timing check.");
          },
        } : {}),
      });
      output.addAudioTrack(audioSource);
    }

    const frameDuration = 1 / scene.fps;
    let result: RenderFrameSequenceResult;
    const work = new AbortController();
    const forwardAbort = () => work.abort(options.signal?.reason);
    if (options.signal?.aborted) forwardAbort();
    else
      options.signal?.addEventListener("abort", forwardAbort, { once: true });
    const ranges = audioSource
      ? audioChunkRanges(
          startFrame,
          endFrame,
          scene.fps,
          options.audioChunkSeconds ?? 10,
        )
      : [];
    const overlapAudio =
      Boolean(audioSource) && audioPlanCanOverlapVideo(audioPlan, assets);
    type PreparedAudioChunk =
      | { ok: true; mixed: MixedAudioData | null }
      | { ok: false; error: unknown };
    let pendingAudio: Promise<PreparedAudioChunk> | null = null;
    let audioIndex = 0;
    const prepareNextAudio = () => {
      if (pendingAudio || audioIndex >= ranges.length || work.signal.aborted)
        return;
      const [chunkStart, chunkEnd] = ranges[audioIndex]!;
      // Store one handled promise, including failed preparation. A video error
      // can then abort/drain it without an unhandled rejection or stale PCM.
      pendingAudio = mixSceneAudioDataWithPlan(
        scene,
        assets,
        chunkStart,
        chunkEnd,
        audioPlan,
        work.signal,
      ).then(
        (mixed) => ({ ok: true, mixed }),
        (error) => {
          work.abort(error);
          return { ok: false, error };
        },
      );
    };
    const appendNextAudio = async () => {
      throwIfAborted(work.signal);
      prepareNextAudio();
      const prepared = await pendingAudio!;
      pendingAudio = null;
      if (!prepared.ok) throw prepared.error;
      throwIfAborted(work.signal);
      const [chunkStart, chunkEnd] = ranges[audioIndex]!;
      const sampleCount = Math.max(
        1,
        Math.round(((chunkEnd - chunkStart + 1) / scene.fps) * MIX_SAMPLE_RATE),
      );
      // Every range is appended, including explicit silence. Keep the exact
      // old chunk boundaries and PCM layout so limiting and A/V timing match.
      const data = new Float32Array(sampleCount * MIX_CHANNELS);
      prepared.mixed?.channels.forEach((channel, index) => {
        data.set(channel.subarray(0, sampleCount), index * sampleCount);
      });
      const sample = new AudioSample({
        data,
        format: "f32-planar",
        numberOfChannels: MIX_CHANNELS,
        sampleRate: MIX_SAMPLE_RATE,
        timestamp: (chunkStart - startFrame) / scene.fps + (aacProfile?.timestampLeadSamples ?? 0) / MIX_SAMPLE_RATE,
      });
      try {
        throwIfAborted(work.signal);
        await audioSource!.add(sample);
        if (encodedTimingError) throw encodedTimingError;
      } finally {
        sample.close();
      }
      audioIndex += 1;
    };

    try {
      await output.start();
      if (overlapAudio) prepareNextAudio();
      result = await renderFrameSequence({
        scene,
        context,
        assets,
        scratchSurfacePool: options.scratchSurfacePool,
        staticDisplayCache: options.staticDisplayCache,
        startFrame: options.startFrame,
        endFrame: options.endFrame,
        signal: work.signal,
        // Awaiting add() respects encoder backpressure before the next frame
        // is drawn over the shared canvas.
        onFrame: async ({ frame, timestampUs }) => {
          await source.add(timestampUs / 1_000_000, frameDuration);
          if (
            overlapAudio &&
            audioIndex < ranges.length &&
            frame >= ranges[audioIndex]![1]
          ) {
            await appendNextAudio();
            // Do not retain a successor until the previous AudioSample has
            // been encoded and closed. At most one pending PCM chunk exists.
            prepareNextAudio();
          }
        },
        onProgress: options.onProgress,
        progressIntervalMs: options.progressIntervalMs,
      });

      // Embedded soundtracks share a video Input; keep their decoding after
      // all video reads. Independent audio was already appended at boundaries.
      while (audioIndex < ranges.length) await appendNextAudio();

      throwIfAborted(work.signal);
      await output.finalize();
      throwIfAborted(work.signal);
      if (encodedTimingError) throw encodedTimingError;
    } catch (error) {
      work.abort(error);
      try {
        await output.cancel();
      } catch {
        // The render/encode error is the one worth surfacing.
      }
      await pendingAudio;
      pendingAudio = null;
      throw error;
    } finally {
      options.signal?.removeEventListener("abort", forwardAbort);
    }

    return {
      mimeType: format.mimeType,
      codec,
      audioCodec,
      totalFrames: result.totalFrames,
      ...(aacTiming ? { aacTiming } : {}),
    };
  });
}

/** @internal Ownership transaction shared by browser and worker export paths. */
export async function withResolvedAssetOwnership<T>(
  assets: ResolvedAssets,
  ownsAssets: boolean,
  operation: () => Promise<T>,
): Promise<T> {
  let operationError: unknown;
  try {
    return await operation();
  } catch (error) {
    operationError = error;
    throw error;
  } finally {
    if (ownsAssets) {
      try {
        await disposeAssetsAsync(assets);
      } catch (cleanupError) {
        if (operationError !== undefined) {
          throw new AggregateError(
            [operationError, cleanupError],
            "MotionForge export failed and owned media cleanup also failed.",
            { cause: operationError },
          );
        }
        throw cleanupError;
      }
    }
  }
}

const MIX_SAMPLE_RATE = 48_000;
const MIX_CHANNELS = 2;

/**
 * Splits an inclusive frame range into consecutive inclusive chunks of at
 * most `chunkSeconds`. Pure; exported for tests. Chunks cover the full range
 * with no overlap and no gaps.
 */
export function audioChunkRanges(
  startFrame: number,
  endFrame: number,
  fps: number,
  chunkSeconds: number,
): Array<[number, number]> {
  const chunkFrames = Math.max(1, Math.round(chunkSeconds * fps));
  const ranges: Array<[number, number]> = [];

  for (let from = startFrame; from <= endFrame; from += chunkFrames) {
    ranges.push([from, Math.min(endFrame, from + chunkFrames - 1)]);
  }

  return ranges;
}

/**
 * Whether any node would contribute sound to the range — the same walk the
 * mixer does, minus decoding. Decides up front if the MP4 gets an audio
 * track (tracks can only be added before output.start()).
 */
function sceneHasAudibleContent(
  scene: Scene,
  assets: ResolvedAssets,
  startFrame: number,
  endFrame: number,
  placements: AudioPlacement[],
): boolean {
  for (const placement of placements) {
    const assetId = placement.node.assetId ?? "";
    const isVideo = placement.node.type === "video";
    const clip = isVideo
      ? assets.videos.get(assetId)?.audio
      : assets.audio.get(assetId);

    if (!clip) {
      continue; // silent video clip, or missing asset surfaced later
    }

    const audibleStart = Math.max(placement.startFrame, startFrame);
    const audibleEnd = Math.min(placement.endFrame, endFrame + 1);

    if (audibleStart >= audibleEnd) {
      continue;
    }

    const rate = isVideo ? (placement.node.playbackRate ?? 1) : 1;
    const nodeTrim = isVideo
      ? (placement.node.videoStartTime ?? 0)
      : (placement.node.audioStartTime ?? 0);
    const framesIntoSource =
      placement.framesIntoNode + (audibleStart - placement.startFrame);
    const loopsAudio = placement.node.type === "audio" && placement.node.loop;
    const trimOffset = nodeTrim + (framesIntoSource / scene.fps) * rate;

    if (loopsAudio) {
      if (clip.duration > 0) {
        return true;
      }
    } else if (trimOffset < clip.duration) {
      return true;
    }
  }

  return false;
}

/** Mixed PCM for a frame range: one Float32Array per output channel. */
export type MixedAudioData = {
  channels: Float32Array<ArrayBuffer>[];
  sampleRate: number;
};

type AudioMixPlan = {
  placements: AudioPlacement[];
  duckingByBus: Map<string, DuckingWindow[]>;
};

function createAudioMixPlan(scene: Scene): AudioMixPlan {
  const placements = collectAudioPlacements(scene);
  const duckingByBus = new Map<string, DuckingWindow[]>();
  for (const placement of placements) {
    if (!placement.node.ducks) continue;
    const window = {
      ...placement.node.ducks,
      startFrame: placement.startFrame,
      endFrame: placement.endFrame,
    };
    const windows = duckingByBus.get(window.bus);
    if (windows) windows.push(window);
    else duckingByBus.set(window.bus, [window]);
  }
  return { placements, duckingByBus };
}

function audioPlanCanOverlapVideo(
  plan: AudioMixPlan,
  assets: ResolvedAssets,
): boolean {
  // Trusted extensions may read shared media during prepareFrame; do not infer
  // that their Input access is independent from audio preparation.
  if (assets.extensionNodes?.size) return false;
  const videoInputs = new Set(
    [...assets.videos.values()].map((clip) => clip.input),
  );
  for (const { node } of plan.placements) {
    if (node.type === "video" && assets.videos.get(node.assetId ?? "")?.audio)
      return false;
    if (node.type === "audio") {
      const clip = assets.audio.get(node.assetId ?? "");
      if (clip && videoInputs.has(clip.input)) return false;
    }
  }
  return true;
}

/**
 * Decodes and mixes every audible node (audio nodes and video-node
 * soundtracks) into raw per-channel PCM covering the frame range, or null
 * when the range has nothing audible. Environment-free (no AudioBuffer), so
 * it runs identically on the main thread and in workers; the export encodes
 * this directly and the player preview wraps it via mixSceneAudio().
 */
export async function mixSceneAudioData(
  scene: Scene,
  assets: ResolvedAssets,
  startFrame: number,
  endFrame: number,
  signal?: AbortSignal,
): Promise<MixedAudioData | null> {
  throwIfAborted(signal);
  return mixSceneAudioDataWithPlan(
    scene,
    assets,
    startFrame,
    endFrame,
    createAudioMixPlan(scene),
    signal,
  );
}

async function mixSceneAudioDataWithPlan(
  scene: Scene,
  assets: ResolvedAssets,
  startFrame: number,
  endFrame: number,
  plan: AudioMixPlan,
  signal?: AbortSignal,
): Promise<MixedAudioData | null> {
  throwIfAborted(signal);
  const { placements } = plan;

  if (placements.length === 0) {
    return null;
  }

  const segments: AudioSegment[] = [];

  for (const placement of placements) {
    throwIfAborted(signal);
    const assetId = placement.node.assetId ?? "";
    const isVideo = placement.node.type === "video";
    const clip = isVideo
      ? assets.videos.get(assetId)?.audio
      : assets.audio.get(assetId);

    if (!clip) {
      if (isVideo) {
        // Silent video clips are normal.
        if (assets.videos.has(assetId)) {
          continue;
        }
      }

      throw new Error(
        `${isVideo ? "Video" : "Audio"} node "${placement.node.id}" references asset "${assetId}" which is not in the resolved assets. Call resolveAssets(scene) first.`,
      );
    }

    // Video clips retime sound with playbackRate: the source range stretches
    // by the rate, and declaring the segment at rate × sampleRate makes the
    // mixer's resampler play it back in window time (pitch shifts, like a
    // varispeed deck — no time-stretch).
    const rate = isVideo ? (placement.node.playbackRate ?? 1) : 1;

    // Intersect the node's audible window with the export range.
    const audibleStart = Math.max(placement.startFrame, startFrame);
    const audibleEnd = Math.min(placement.endFrame, endFrame + 1);

    if (audibleStart >= audibleEnd) {
      continue;
    }

    const nodeTrim = isVideo
      ? (placement.node.videoStartTime ?? 0)
      : (placement.node.audioStartTime ?? 0);
    const framesIntoSource =
      placement.framesIntoNode + (audibleStart - placement.startFrame);
    const windowSeconds = (audibleEnd - audibleStart) / scene.fps;
    const trimOffset = nodeTrim + (framesIntoSource / scene.fps) * rate;
    const sourceRanges = loopedSourceRanges({
      start: trimOffset,
      duration: windowSeconds * rate,
      sourceDuration: clip.duration,
      loop: placement.node.type === "audio" && placement.node.loop === true,
    });

    if (sourceRanges.length === 0) {
      // Trimmed past the end of the clip: silence, not an error.
      continue;
    }

    for (const range of sourceRanges) {
      throwIfAborted(signal);
      segments.push({
        channels: await decodeAudioRange(
          clip,
          range.sourceStart,
          range.sourceEnd,
          signal,
        ),
        sampleRate: clip.sampleRate * rate,
        startTime:
          (audibleStart - startFrame) / scene.fps + range.outputOffset / rate,
        volume: placement.node.volume ?? 1,
        volumeEnvelope: placement.node.volumeEnvelope,
        envelopeStartTime:
          framesIntoSource / scene.fps + range.outputOffset / rate,
        envelopeFps: scene.fps,
        pan: placement.node.pan,
        bus: placement.node.audioBus ?? "master",
      });
    }
  }

  if (segments.length === 0) {
    return null;
  }

  const durationSeconds = (endFrame - startFrame + 1) / scene.fps;
  const byBus = new Map<string, AudioSegment[]>();
  segments.forEach((segment) => {
    const bus = segment.bus ?? "master";
    const group = byBus.get(bus);
    if (group) group.push(segment);
    else byBus.set(bus, [segment]);
  });
  const busMixes = new Map<string, Float32Array<ArrayBuffer>[]>();
  for (const [name, busSegments] of byBus) {
    throwIfAborted(signal);
    const channels = mixAudioSegments(
      busSegments,
      durationSeconds,
      MIX_SAMPLE_RATE,
      MIX_CHANNELS,
      false,
    );
    if (name !== "master") {
      applyBusGainAndPan(channels, scene.audioBuses?.[name]);
    }
    if (name !== "master" && scene.audioBuses?.[name]?.limiter) {
      limitAudioPeak(channels, scene.audioBuses[name]?.limiterCeiling ?? 0.98);
    }
    busMixes.set(name, channels);
  }

  for (const [name, channels] of busMixes) {
    throwIfAborted(signal);
    applyDucking(
      channels,
      plan.duckingByBus.get(name) ?? [],
      startFrame,
      scene.fps,
      MIX_SAMPLE_RATE,
    );
  }

  const length = Math.max(1, Math.round(durationSeconds * MIX_SAMPLE_RATE));
  const mixed = Array.from(
    { length: MIX_CHANNELS },
    () => new Float32Array(length),
  );
  for (const channels of busMixes.values()) {
    throwIfAborted(signal);
    channels.forEach((channel, channelIndex) => {
      const target = mixed[channelIndex];
      if (!target) return;
      for (let index = 0; index < target.length; index += 1) {
        target[index] = (target[index] ?? 0) + (channel[index] ?? 0);
      }
    });
  }
  applyBusGainAndPan(mixed, scene.audioBuses?.master);
  limitAudioPeak(mixed, scene.audioBuses?.master?.limiterCeiling ?? 0.98);

  if (length === 0) {
    return null;
  }

  return { channels: mixed, sampleRate: MIX_SAMPLE_RATE };
}

/** Mixes PCM from the runtime's exact current Scene/assets revision. */
export async function mixSceneAudioDataFromRuntime(
  runtime: Canvas2DSceneRuntime,
  startFrame: number,
  endFrame: number,
  signal?: AbortSignal,
): Promise<MixedAudioData | null> {
  return await withCanvas2DResolvedAssets(
    runtime,
    ({ assets, scene, signal: runtimeSignal }) =>
      mixSceneAudioData(scene, assets, startFrame, endFrame, runtimeSignal),
    { signal },
  );
}

type DuckingWindow = {
  bus: string;
  gain: number;
  attackFrames?: number;
  releaseFrames?: number;
  startFrame: number;
  endFrame: number;
};

function applyBusGainAndPan(
  channels: Float32Array[],
  bus: SceneAudioBus | undefined,
): void {
  const gain = bus?.gain ?? 1;
  const pan = bus?.pan ?? 0;
  channels.forEach((channel, channelIndex) => {
    const balance = panGain(pan, channelIndex, channels.length);
    for (let index = 0; index < channel.length; index += 1) {
      channel[index] = (channel[index] ?? 0) * gain * balance;
    }
  });
}

function applyDucking(
  channels: Float32Array[],
  windows: DuckingWindow[],
  mixStartFrame: number,
  fps: number,
  sampleRate: number,
): void {
  if (windows.length === 0) return;
  const length = channels[0]?.length ?? 0;
  for (let index = 0; index < length; index += 1) {
    const frame = mixStartFrame + (index / sampleRate) * fps;
    let gain = 1;
    for (const window of windows) {
      const attack = window.attackFrames ?? Math.round(fps * 0.08);
      const release = window.releaseFrames ?? Math.round(fps * 0.18);
      let candidate = 1;
      if (frame >= window.startFrame && frame < window.endFrame) {
        const progress =
          attack === 0 ? 1 : Math.min(1, (frame - window.startFrame) / attack);
        candidate = 1 + (window.gain - 1) * progress;
      } else if (
        frame >= window.endFrame &&
        frame < window.endFrame + release
      ) {
        const progress =
          release === 0 ? 1 : (frame - window.endFrame) / release;
        candidate = window.gain + (1 - window.gain) * progress;
      }
      gain = Math.min(gain, candidate);
    }
    if (gain < 1) {
      channels.forEach((channel) => {
        channel[index] = (channel[index] ?? 0) * gain;
      });
    }
  }
}

export function limitAudioPeak(
  channels: Float32Array[],
  ceiling = 0.98,
): { peakBefore: number; gain: number } {
  let peakBefore = 0;
  channels.forEach((channel) =>
    channel.forEach((sample) => {
      peakBefore = Math.max(peakBefore, Math.abs(sample));
    }),
  );
  const gain = peakBefore > ceiling ? ceiling / peakBefore : 1;
  channels.forEach((channel) => {
    for (let index = 0; index < channel.length; index += 1) {
      channel[index] = Math.min(
        ceiling,
        Math.max(-ceiling, (channel[index] ?? 0) * gain),
      );
    }
  });
  return { peakBefore, gain };
}

export function measureAudioLoudness(channels: Float32Array[]): {
  peak: number;
  rms: number;
  dbfs: number;
} {
  let peak = 0;
  let sumSquares = 0;
  let count = 0;
  channels.forEach((channel) =>
    channel.forEach((sample) => {
      peak = Math.max(peak, Math.abs(sample));
      sumSquares += sample * sample;
      count += 1;
    }),
  );
  const rms = count > 0 ? Math.sqrt(sumSquares / count) : 0;
  return {
    peak,
    rms,
    dbfs: rms > 0 ? 20 * Math.log10(rms) : Number.NEGATIVE_INFINITY,
  };
}

/**
 * mixSceneAudioData() packaged as a Web Audio AudioBuffer for playback.
 * DOM/AudioContext environments only — workers must use mixSceneAudioData().
 */
export async function mixSceneAudio(
  scene: Scene,
  assets: ResolvedAssets,
  startFrame: number,
  endFrame: number,
  signal?: AbortSignal,
): Promise<AudioBuffer | null> {
  const mixed = await mixSceneAudioData(
    scene,
    assets,
    startFrame,
    endFrame,
    signal,
  );

  if (!mixed) {
    return null;
  }

  const buffer = new AudioBuffer({
    numberOfChannels: mixed.channels.length,
    length: mixed.channels[0]?.length ?? 1,
    sampleRate: mixed.sampleRate,
  });

  mixed.channels.forEach((data, channel) => {
    buffer.copyToChannel(data, channel);
  });

  return buffer;
}

/**
 * Decodes a source range into per-channel PCM at the clip's sample rate,
 * positioning decoded packets at exact sample offsets relative to `start`.
 */
// Compressed audio decoders need preceding packets to restore overlap state.
// Bound warm-up work to 100 ms; allocation and all copied samples still use the
// exact requested source window below. This also applies to preview chunks.
// Keep negative presentation-time priming packets: clamping the query to zero
// loses AAC decoder history at the very first visible sample. The sink supports
// negative query times and naturally starts at the track's first packet.
const AUDIO_DECODE_PREROLL_SECONDS = 0.1;

async function decodeAudioRange(
  clip: Pick<AudioClip, "sampleRate" | "numberOfChannels" | "sink">,
  start: number,
  end: number,
  signal?: AbortSignal,
): Promise<Float32Array[]> {
  throwIfAborted(signal);
  const totalSamples = Math.max(1, Math.ceil((end - start) * clip.sampleRate));
  const channels = Array.from(
    { length: Math.max(1, clip.numberOfChannels) },
    () => new Float32Array(totalSamples),
  );

  for await (const sample of clip.sink.samples(start - AUDIO_DECODE_PREROLL_SECONDS, end)) {
    try {
      throwIfAborted(signal);
      const offsetSamples = Math.round(
        (sample.timestamp - start) * clip.sampleRate,
      );
      for (let channel = 0; channel < channels.length; channel += 1) {
        const target = channels[channel];

        if (!target) {
          continue;
        }

        const data = new Float32Array(sample.numberOfFrames);
        sample.copyTo(data, {
          planeIndex: Math.min(channel, sample.numberOfChannels - 1),
          format: "f32-planar",
        });

        throwIfAborted(signal);
        const sourceStart = Math.max(0, -offsetSamples);
        const sourceEnd = Math.min(data.length, totalSamples - offsetSamples);
        if (sourceEnd > sourceStart)
          target.set(
            data.subarray(sourceStart, sourceEnd),
            Math.max(0, offsetSamples),
          );
      }
    } finally {
      sample.close();
    }
  }

  return channels;
}

export type LoopedSourceRange = {
  /** Source seconds to decode, inclusive start. */
  sourceStart: number;
  /** Source seconds to decode, exclusive end. */
  sourceEnd: number;
  /** Seconds from the audible window start where this decoded range plays. */
  outputOffset: number;
};

export function loopedSourceRanges({
  start,
  duration,
  sourceDuration,
  loop,
}: {
  start: number;
  duration: number;
  sourceDuration: number;
  loop: boolean;
}): LoopedSourceRange[] {
  if (duration <= 0 || sourceDuration <= 0) {
    return [];
  }

  if (!loop) {
    const sourceStart = start;
    const sourceEnd = Math.min(sourceDuration, start + duration);

    return sourceStart < sourceEnd
      ? [{ sourceStart, sourceEnd, outputOffset: 0 }]
      : [];
  }

  const ranges: LoopedSourceRange[] = [];
  let remaining = duration;
  let outputOffset = 0;
  let cursor = positiveModulo(start, sourceDuration);

  while (remaining > 1e-9) {
    const span = Math.min(sourceDuration - cursor, remaining);

    if (span <= 0) {
      break;
    }

    ranges.push({
      sourceStart: cursor,
      sourceEnd: cursor + span,
      outputOffset,
    });
    remaining -= span;
    outputOffset += span;
    cursor = 0;
  }

  return ranges;
}

function positiveModulo(value: number, modulus: number): number {
  return ((value % modulus) + modulus) % modulus;
}

function createExportCanvas(
  width: number,
  height: number,
): {
  canvas: HTMLCanvasElement | OffscreenCanvas;
  context: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;
} {
  if (typeof OffscreenCanvas !== "undefined") {
    const canvas = new OffscreenCanvas(width, height);
    const context = canvas.getContext("2d");

    if (context) {
      return { canvas, context };
    }
  }

  if (typeof document !== "undefined") {
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext("2d");

    if (context) {
      return { canvas, context };
    }
  }

  throw new Error(
    "exportVideo() needs a Canvas2D context via OffscreenCanvas or a DOM canvas element.",
  );
}

export function frameToTimestampUs(frame: number, fps: number): number {
  if (!Number.isInteger(frame) || frame < 0) {
    throw new Error(`Frame must be a non-negative integer, received ${frame}.`);
  }

  if (!Number.isInteger(fps) || fps <= 0) {
    throw new Error(`FPS must be a positive integer, received ${fps}.`);
  }

  return Math.round((frame * 1_000_000) / fps);
}

function validateFrameRange(
  scene: Scene,
  startFrame: number,
  endFrame: number,
): void {
  if (!Number.isInteger(startFrame) || !Number.isInteger(endFrame)) {
    throw new Error(
      `Frame range must use integer frames, received startFrame=${startFrame}, endFrame=${endFrame}.`,
    );
  }

  if (startFrame < 0) {
    throw new Error(`startFrame must be >= 0, received ${startFrame}.`);
  }

  if (endFrame < startFrame) {
    throw new Error(
      `endFrame must be >= startFrame, received startFrame=${startFrame}, endFrame=${endFrame}.`,
    );
  }

  if (endFrame >= scene.duration) {
    throw new Error(
      `endFrame must be less than scene.duration (${scene.duration}), received ${endFrame}.`,
    );
  }
}

function throwIfAborted(signal: AbortSignal | undefined): void {
  if (signal?.aborted) {
    throw signal.reason instanceof Error
      ? signal.reason
      : new Error("Frame sequence render aborted.");
  }
}
