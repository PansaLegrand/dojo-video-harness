import {
  ALL_FORMATS,
  AudioSampleSink,
  BlobSource,
  CanvasSink,
  Input,
  type AudioSample,
  type WrappedCanvas,
} from "mediabunny";
import { disposeMediaInputSafely } from "@motionforge/renderer-canvas2d";

/** How deeply an exported artifact should be read back after encoding. */
export type ExportVerificationMode = "none" | "container" | "sampled" | "full";

export type ExportVerificationStatus = "verified" | "unverified" | "failed";

export type ExportVerificationCheckStatus = "passed" | "failed" | "skipped";

export type ExportVerificationCheckId =
  | "container_readable"
  | "video_track_present"
  | "video_dimensions_match"
  | "video_duration_match"
  | "audio_track_presence_match"
  | "audio_video_sync"
  | "video_frames_decoded"
  | "video_frame_nonblank"
  | "audio_samples_decoded"
  | "audio_audible"
  | "resources_disposed";

export type ExportVerificationIssueCode =
  | "verification_disabled"
  | "invalid_expectation"
  | "verification_aborted"
  | "container_unreadable"
  | "video_track_missing"
  | "video_dimensions_mismatch"
  | "video_duration_mismatch"
  | "audio_track_presence_mismatch"
  | "audio_video_sync_mismatch"
  | "video_decode_failed"
  | "video_frames_blank"
  | "pixel_access_unavailable"
  | "audio_decode_failed"
  | "audio_samples_silent"
  | "resource_disposal_failed"
  | "verification_sink_unavailable"
  | "host_verification_failed";

export type ExportVerificationCheck = {
  id: ExportVerificationCheckId;
  status: ExportVerificationCheckStatus;
  message: string;
  expected?: unknown;
  actual?: unknown;
};

export type ExportVerificationIssue = {
  code: ExportVerificationIssueCode;
  severity: "error" | "warning" | "info";
  message: string;
};

export type ExportVerificationExpectation = {
  width: number;
  height: number;
  durationSeconds: number;
  /** Whether an audio track must be present; silence is valid track content. */
  hasAudio: boolean;
  /** Require audible decoded samples only when the caller knows sound is mandatory. */
  requireAudibleAudio?: boolean;
  fps: number;
};

/** Serializable provenance supplied to verification and echoed in its result. */
export type ExportVerificationRequestMetadata = {
  source: "blob" | "custom";
  byteLength: number | null;
  mimeType: string | null;
  label?: string;
  attributes?: Record<string, string | number | boolean | null>;
};

export type ExportVerificationResult = {
  mode: ExportVerificationMode;
  status: ExportVerificationStatus;
  expectation: ExportVerificationExpectation;
  requestMetadata: ExportVerificationRequestMetadata;
  checks: ExportVerificationCheck[];
  issues: ExportVerificationIssue[];
};

export type ExportVerificationSinkRequest = {
  mode: ExportVerificationMode;
  expectation: ExportVerificationExpectation;
  metadata: ExportVerificationRequestMetadata;
  signal?: AbortSignal;
};

/**
 * Host callback for stream/file/custom targets that can reopen their output.
 * MotionForge never uploads output or assumes a storage provider: the host
 * rereads its sink and returns the same stable verification result contract.
 */
export type ExportVerificationSink = (
  request: ExportVerificationSinkRequest,
) => Promise<ExportVerificationResult>;

/**
 * Bounded decode policy. `full` means every expected frame for exports of at
 * most 120 frames, otherwise 120 uniformly spaced frames; it never means an
 * unbounded whole-file decode. Audio uses uniformly spaced sample windows.
 */
export const exportVerificationSamplingPolicy = Object.freeze({
  sampledVideoFrames: 3,
  fullVideoFrames: 120,
  sampledAudioSamples: 8,
  fullAudioSamples: 32,
  audioFramesPerSample: 4096,
  pixelGridSide: 16,
});

type ExportMediaInspection = {
  hasVideo: boolean;
  width: number | null;
  height: number | null;
  videoDurationSeconds: number | null;
  hasAudio: boolean;
  audioDurationSeconds: number | null;
  decodedVideoFrames: number;
  pixelAccessAvailable: boolean;
  hasNonblankVideoFrame: boolean;
  videoDecodeError?: string;
  decodedAudioSamples: number;
  hasAudibleAudio: boolean;
  audioDecodeError?: string;
};

/** @internal Test seam; production callers should use verifyExportBlob(). */
export type ExportVerificationInspector = {
  inspect(
    mode: Exclude<ExportVerificationMode, "none">,
    expectation: ExportVerificationExpectation,
    signal?: AbortSignal,
  ): Promise<ExportMediaInspection>;
  dispose(): void | Promise<void>;
};

/** @internal Test seam; production callers should use verifyExportBlob(). */
export type ExportVerificationInspectorFactory = (
  blob: Blob,
) => ExportVerificationInspector;

const checkOrder: readonly ExportVerificationCheckId[] = [
  "container_readable",
  "video_track_present",
  "video_dimensions_match",
  "video_duration_match",
  "audio_track_presence_match",
  "audio_video_sync",
  "video_frames_decoded",
  "video_frame_nonblank",
  "audio_samples_decoded",
  "audio_audible",
  "resources_disposed",
];

/** Verifies a rereadable Blob without sending it anywhere. */
export async function verifyExportBlob(
  blob: Blob,
  expectation: ExportVerificationExpectation,
  mode: ExportVerificationMode,
  signal?: AbortSignal,
): Promise<ExportVerificationResult> {
  if (mode !== "none") {
    throwIfAborted(signal);
    const header = new Uint8Array(await blob.slice(0, 32).arrayBuffer());
    throwIfAborted(signal);
    if (!hasMp4FileTypeBox(header)) {
      return failureResult(
        mode,
        expectation,
        {
          source: "blob",
          byteLength: blob.size,
          mimeType: blob.type || null,
        },
        "container_unreadable",
        "The encoded output is missing the required MP4 ftyp box.",
      );
    }
  }
  return __verifyExportBlobWithInspector(
    blob,
    expectation,
    mode,
    signal,
    (value) => new MediabunnyExportInspector(value),
  );
}

function hasMp4FileTypeBox(bytes: Uint8Array): boolean {
  return (
    bytes.length >= 8 &&
    bytes[4] === 0x66 &&
    bytes[5] === 0x74 &&
    bytes[6] === 0x79 &&
    bytes[7] === 0x70
  );
}

/** Invokes a host-owned reread/verification callback for a custom sink. */
export async function verifyExportWithSink(
  sink: ExportVerificationSink,
  request: ExportVerificationSinkRequest,
): Promise<ExportVerificationResult> {
  if (request.mode !== "none" && request.signal?.aborted) {
    return failureResult(
      request.mode,
      request.expectation,
      request.metadata,
      "verification_aborted",
      abortMessage(request.signal),
    );
  }

  try {
    return await sink(request);
  } catch (error) {
    return failureResult(
      request.mode,
      request.expectation,
      request.metadata,
      request.signal?.aborted
        ? "verification_aborted"
        : "host_verification_failed",
      request.signal?.aborted
        ? abortMessage(request.signal)
        : errorMessage(error),
    );
  }
}

/** Honest result for a streaming/custom sink that cannot be reopened. */
export function unverifiedExportForSink(
  expectation: ExportVerificationExpectation,
  mode: ExportVerificationMode,
  metadata: ExportVerificationRequestMetadata,
): ExportVerificationResult {
  const result = baseResult(mode, expectation, metadata);
  result.issues.push({
    code:
      mode === "none"
        ? "verification_disabled"
        : "verification_sink_unavailable",
    severity: mode === "none" ? "info" : "warning",
    message:
      mode === "none"
        ? "Output verification was disabled by the caller."
        : "The output sink cannot be reread. Supply verificationSink to verify without hidden buffering.",
  });
  return result;
}

/** @internal Test seam; guarantees inspector disposal on every started path. */
export async function __verifyExportBlobWithInspector(
  blob: Blob,
  expectation: ExportVerificationExpectation,
  mode: ExportVerificationMode,
  signal: AbortSignal | undefined,
  createInspector: ExportVerificationInspectorFactory,
): Promise<ExportVerificationResult> {
  const metadata: ExportVerificationRequestMetadata = {
    source: "blob",
    byteLength: blob.size,
    mimeType: blob.type || null,
  };

  if (mode === "none") {
    const result = baseResult(mode, expectation, metadata);
    result.issues.push({
      code: "verification_disabled",
      severity: "info",
      message: "Output verification was disabled by the caller.",
    });
    return result;
  }

  const invalidExpectation = validateExpectation(expectation);
  if (invalidExpectation) {
    return failureResult(
      mode,
      expectation,
      metadata,
      "invalid_expectation",
      invalidExpectation,
    );
  }

  if (signal?.aborted) {
    return failureResult(
      mode,
      expectation,
      metadata,
      "verification_aborted",
      abortMessage(signal),
    );
  }

  let inspector: ExportVerificationInspector | null = null;
  let result: ExportVerificationResult;
  let disposalError: unknown;

  try {
    inspector = createInspector(blob);
    const inspection = await inspector.inspect(mode, expectation, signal);
    throwIfAborted(signal);
    result = evaluateInspection(mode, expectation, metadata, inspection);
  } catch (error) {
    result = failureResult(
      mode,
      expectation,
      metadata,
      signal?.aborted ? "verification_aborted" : "container_unreadable",
      signal?.aborted ? abortMessage(signal) : errorMessage(error),
    );
  } finally {
    if (inspector) {
      try {
        await inspector.dispose();
      } catch (error) {
        disposalError = error;
      }
    }
  }

  if (inspector && !disposalError) {
    setCheck(result, {
      id: "resources_disposed",
      status: "passed",
      message: "Verification input and decoder resources were disposed.",
    });
  } else if (disposalError) {
    setCheck(result, {
      id: "resources_disposed",
      status: "failed",
      message: "Verification resources failed to dispose.",
    });
    result.issues.push({
      code: "resource_disposal_failed",
      severity: "error",
      message: errorMessage(disposalError),
    });
    result.status = "failed";
  }

  return result;
}

function evaluateInspection(
  mode: Exclude<ExportVerificationMode, "none">,
  expectation: ExportVerificationExpectation,
  metadata: ExportVerificationRequestMetadata,
  inspection: ExportMediaInspection,
): ExportVerificationResult {
  const result = baseResult(mode, expectation, metadata);
  setCheck(result, {
    id: "container_readable",
    status: "passed",
    message: "The output container was parsed successfully.",
  });

  if (!inspection.hasVideo) {
    failCheck(
      result,
      "video_track_present",
      "video_track_missing",
      "The output has no primary video track.",
      true,
      false,
    );
    return finalizeStatus(result);
  }

  setCheck(result, {
    id: "video_track_present",
    status: "passed",
    message: "A primary video track is present.",
  });

  const dimensionsMatch =
    inspection.width === expectation.width &&
    inspection.height === expectation.height;
  if (dimensionsMatch) {
    setCheck(result, {
      id: "video_dimensions_match",
      status: "passed",
      message: "Video display dimensions match the export request.",
      expected: { width: expectation.width, height: expectation.height },
      actual: { width: inspection.width, height: inspection.height },
    });
  } else {
    failCheck(
      result,
      "video_dimensions_match",
      "video_dimensions_mismatch",
      "Video display dimensions do not match the export request.",
      { width: expectation.width, height: expectation.height },
      { width: inspection.width, height: inspection.height },
    );
  }

  const toleranceSeconds = 1 / expectation.fps;
  const durationMatches = withinTolerance(
    inspection.videoDurationSeconds,
    expectation.durationSeconds,
    toleranceSeconds,
  );
  if (durationMatches) {
    setCheck(result, {
      id: "video_duration_match",
      status: "passed",
      message: "Video duration is within one composition frame of the request.",
      expected: expectation.durationSeconds,
      actual: inspection.videoDurationSeconds,
    });
  } else {
    failCheck(
      result,
      "video_duration_match",
      "video_duration_mismatch",
      `Video duration differs from the request by more than ${toleranceSeconds.toFixed(6)} seconds.`,
      expectation.durationSeconds,
      inspection.videoDurationSeconds,
    );
  }

  if (inspection.hasAudio === expectation.hasAudio) {
    setCheck(result, {
      id: "audio_track_presence_match",
      status: "passed",
      message: expectation.hasAudio
        ? "The expected audio track is present."
        : "No unexpected audio track is present.",
      expected: expectation.hasAudio,
      actual: inspection.hasAudio,
    });
  } else {
    failCheck(
      result,
      "audio_track_presence_match",
      "audio_track_presence_mismatch",
      expectation.hasAudio
        ? "The expected audio track is missing."
        : "The output contains an unexpected audio track.",
      expectation.hasAudio,
      inspection.hasAudio,
    );
  }

  if (inspection.hasAudio) {
    // AAC/MP4 encoders may report up to four 1024-sample priming/padding
    // frames beyond audible content. This is tail padding, not timeline drift.
    const syncToleranceSeconds = Math.max(toleranceSeconds, 4096 / 48_000);
    const syncMatches = withinTolerance(
      inspection.audioDurationSeconds,
      inspection.videoDurationSeconds,
      syncToleranceSeconds,
    );
    if (syncMatches) {
      setCheck(result, {
        id: "audio_video_sync",
        status: "passed",
        message:
          "Audio/video durations are within the bounded frame/codec-padding tolerance.",
        expected: inspection.videoDurationSeconds,
        actual: inspection.audioDurationSeconds,
      });
    } else {
      failCheck(
        result,
        "audio_video_sync",
        "audio_video_sync_mismatch",
        `Audio (${inspection.audioDurationSeconds?.toFixed(6)}s) and video (${inspection.videoDurationSeconds?.toFixed(6)}s) durations differ by more than ${syncToleranceSeconds.toFixed(6)} seconds.`,
        inspection.videoDurationSeconds,
        inspection.audioDurationSeconds,
      );
    }
  }

  if (mode === "sampled" || mode === "full") {
    evaluateVideoDecode(result, inspection);
  }
  if (
    expectation.hasAudio &&
    inspection.hasAudio &&
    (mode !== "container" || expectation.requireAudibleAudio === true)
  ) {
    evaluateAudioDecode(result, inspection);
  }

  return finalizeStatus(result);
}

function evaluateVideoDecode(
  result: ExportVerificationResult,
  inspection: ExportMediaInspection,
): void {
  if (inspection.videoDecodeError) {
    failCheck(
      result,
      "video_frames_decoded",
      "video_decode_failed",
      inspection.videoDecodeError,
    );
    return;
  }
  if (inspection.decodedVideoFrames <= 0) {
    failCheck(
      result,
      "video_frames_decoded",
      "video_decode_failed",
      "No representative video frame could be decoded.",
      "> 0",
      inspection.decodedVideoFrames,
    );
    return;
  }

  setCheck(result, {
    id: "video_frames_decoded",
    status: "passed",
    message: `Decoded ${inspection.decodedVideoFrames} bounded representative video frame(s).`,
    actual: inspection.decodedVideoFrames,
  });

  if (!inspection.pixelAccessAvailable) {
    setCheck(result, {
      id: "video_frame_nonblank",
      status: "skipped",
      message:
        "Pixel access was unavailable; nonblank content could not be proven.",
    });
    result.issues.push({
      code: "pixel_access_unavailable",
      severity: "warning",
      message:
        "Representative frames decoded, but this host did not expose readable Canvas2D pixels.",
    });
  } else if (!inspection.hasNonblankVideoFrame) {
    failCheck(
      result,
      "video_frame_nonblank",
      "video_frames_blank",
      "Every pixel sample from the representative video frames was blank.",
      true,
      false,
    );
  } else {
    setCheck(result, {
      id: "video_frame_nonblank",
      status: "passed",
      message:
        "At least one representative video frame contains nonblank pixels.",
    });
  }
}

function evaluateAudioDecode(
  result: ExportVerificationResult,
  inspection: ExportMediaInspection,
): void {
  if (inspection.audioDecodeError) {
    failCheck(
      result,
      "audio_samples_decoded",
      "audio_decode_failed",
      inspection.audioDecodeError,
    );
    return;
  }
  if (inspection.decodedAudioSamples <= 0) {
    failCheck(
      result,
      "audio_samples_decoded",
      "audio_decode_failed",
      "No representative audio sample could be decoded.",
      "> 0",
      inspection.decodedAudioSamples,
    );
    return;
  }

  setCheck(result, {
    id: "audio_samples_decoded",
    status: "passed",
    message: `Decoded ${inspection.decodedAudioSamples} bounded representative audio sample(s).`,
    actual: inspection.decodedAudioSamples,
  });
  if (inspection.hasAudibleAudio) {
    setCheck(result, {
      id: "audio_audible",
      status: "passed",
      message:
        "At least one representative audio sample contains audible signal.",
    });
  } else if (result.expectation.requireAudibleAudio === true) {
    failCheck(
      result,
      "audio_audible",
      "audio_samples_silent",
      "Every inspected representative audio sample was silent.",
      true,
      false,
    );
  } else {
    setCheck(result, {
      id: "audio_audible",
      status: "skipped",
      message:
        "The decoded audio is silent. Audibility was not required; muted or silent source content is valid.",
      actual: false,
    });
  }
}

class MediabunnyExportInspector implements ExportVerificationInspector {
  private readonly input: Input<BlobSource>;

  constructor(blob: Blob) {
    this.input = new Input({
      formats: ALL_FORMATS,
      source: new BlobSource(blob),
    });
  }

  async inspect(
    mode: Exclude<ExportVerificationMode, "none">,
    expectation: ExportVerificationExpectation,
    signal?: AbortSignal,
  ): Promise<ExportMediaInspection> {
    const abort = () => this.dispose();
    signal?.addEventListener("abort", abort, { once: true });
    try {
      throwIfAborted(signal);
      if (!(await this.input.canRead())) {
        throw new Error("Input has an unsupported or unrecognizable format.");
      }
      throwIfAborted(signal);
      const videoTrack = await this.input.getPrimaryVideoTrack();
      const audioTrack = await this.input.getPrimaryAudioTrack();
      throwIfAborted(signal);
      const videoDurationSeconds = videoTrack
        ? await this.input.computeDuration([videoTrack], { skipLiveWait: true })
        : null;
      const audioDurationSeconds = audioTrack
        ? await this.input.computeDuration([audioTrack], { skipLiveWait: true })
        : null;
      throwIfAborted(signal);

      const inspection: ExportMediaInspection = {
        hasVideo: videoTrack !== null,
        width: videoTrack?.displayWidth ?? null,
        height: videoTrack?.displayHeight ?? null,
        videoDurationSeconds,
        hasAudio: audioTrack !== null,
        audioDurationSeconds,
        decodedVideoFrames: 0,
        pixelAccessAvailable: false,
        hasNonblankVideoFrame: false,
        decodedAudioSamples: 0,
        hasAudibleAudio: false,
      };

      if ((mode === "sampled" || mode === "full") && videoTrack) {
        try {
          const timestamps = representativeTimestamps(
            videoDurationSeconds ?? expectation.durationSeconds,
            expectation.fps,
            mode === "sampled"
              ? exportVerificationSamplingPolicy.sampledVideoFrames
              : exportVerificationSamplingPolicy.fullVideoFrames,
            mode === "full",
          );
          const sink = new CanvasSink(videoTrack, { poolSize: 2 });
          for await (const wrapped of sink.canvasesAtTimestamps(timestamps, {
            verifyKeyPackets: true,
            skipLiveWait: true,
          })) {
            throwIfAborted(signal);
            if (!wrapped) continue;
            inspection.decodedVideoFrames += 1;
            const nonblank = inspectCanvasPixels(wrapped);
            if (nonblank !== null) {
              inspection.pixelAccessAvailable = true;
              inspection.hasNonblankVideoFrame ||= nonblank;
            }
          }
        } catch (error) {
          throwIfAborted(signal);
          inspection.videoDecodeError = errorMessage(error);
        }
      }

      if (
        (mode === "sampled" ||
          mode === "full" ||
          expectation.requireAudibleAudio === true) &&
        expectation.hasAudio &&
        audioTrack
      ) {
        try {
          const timestamps = uniformlySpacedTimestamps(
            audioDurationSeconds ?? expectation.durationSeconds,
            mode === "full"
              ? exportVerificationSamplingPolicy.fullAudioSamples
              : exportVerificationSamplingPolicy.sampledAudioSamples,
          );
          const sink = new AudioSampleSink(audioTrack);
          for await (const sample of sink.samplesAtTimestamps(timestamps, {
            verifyKeyPackets: true,
            skipLiveWait: true,
          })) {
            if (!sample) continue;
            try {
              throwIfAborted(signal);
              inspection.decodedAudioSamples += 1;
              inspection.hasAudibleAudio ||= sampleIsAudible(sample);
            } finally {
              sample.close();
            }
          }
        } catch (error) {
          throwIfAborted(signal);
          inspection.audioDecodeError = errorMessage(error);
        }
      }

      return inspection;
    } finally {
      signal?.removeEventListener("abort", abort);
    }
  }

  dispose(): void {
    disposeMediaInputSafely(this.input);
  }
}

function representativeTimestamps(
  durationSeconds: number,
  fps: number,
  maximum: number,
  everyFrameWhenBounded: boolean,
): number[] {
  const totalFrames = Math.max(
    1,
    Math.ceil(Math.max(0, durationSeconds) * fps),
  );
  const count = Math.min(
    maximum,
    everyFrameWhenBounded ? totalFrames : Math.min(3, totalFrames),
  );
  const frameIndices = uniformlySpacedIntegers(totalFrames, count);
  const lastTimestamp = Math.max(0, durationSeconds - 1 / Math.max(fps, 1));
  return frameIndices.map((frame) => Math.min(frame / fps, lastTimestamp));
}

function uniformlySpacedTimestamps(
  durationSeconds: number,
  maximum: number,
): number[] {
  const duration = Math.max(0, durationSeconds);
  if (duration === 0) return [0];
  const count = Math.max(1, maximum);
  return Array.from({ length: count }, (_, index) =>
    count === 1 ? 0 : (index / (count - 1)) * Math.max(0, duration - 0.001),
  );
}

function uniformlySpacedIntegers(total: number, count: number): number[] {
  if (count <= 1 || total <= 1) return [0];
  const values = Array.from({ length: count }, (_, index) =>
    Math.round((index / (count - 1)) * (total - 1)),
  );
  return Array.from(new Set(values));
}

function inspectCanvasPixels(wrapped: WrappedCanvas): boolean | null {
  const canvas = wrapped.canvas as HTMLCanvasElement | OffscreenCanvas;
  const context = canvas.getContext("2d") as
    | CanvasRenderingContext2D
    | OffscreenCanvasRenderingContext2D
    | null;
  if (!context || typeof context.getImageData !== "function") return null;
  const width = canvas.width;
  const height = canvas.height;
  if (width <= 0 || height <= 0) return false;
  const side = exportVerificationSamplingPolicy.pixelGridSide;

  try {
    for (let yIndex = 0; yIndex < side; yIndex += 1) {
      const y = Math.min(
        height - 1,
        Math.floor(((yIndex + 0.5) / side) * height),
      );
      for (let xIndex = 0; xIndex < side; xIndex += 1) {
        const x = Math.min(
          width - 1,
          Math.floor(((xIndex + 0.5) / side) * width),
        );
        const pixel = context.getImageData(x, y, 1, 1).data;
        if (
          (pixel[3] ?? 0) > 0 &&
          ((pixel[0] ?? 0) > 1 || (pixel[1] ?? 0) > 1 || (pixel[2] ?? 0) > 1)
        ) {
          return true;
        }
      }
    }
    return false;
  } catch {
    return null;
  }
}

function sampleIsAudible(sample: AudioSample): boolean {
  const frameCount = Math.min(
    sample.numberOfFrames,
    exportVerificationSamplingPolicy.audioFramesPerSample,
  );
  for (let channel = 0; channel < sample.numberOfChannels; channel += 1) {
    const values = new Float32Array(frameCount);
    sample.copyTo(values, {
      planeIndex: channel,
      format: "f32-planar",
      frameCount,
    });
    for (const value of values) {
      if (Math.abs(value) > 1e-5) return true;
    }
  }
  return false;
}

function baseResult(
  mode: ExportVerificationMode,
  expectation: ExportVerificationExpectation,
  metadata: ExportVerificationRequestMetadata,
): ExportVerificationResult {
  return {
    mode,
    status: "unverified",
    expectation: { ...expectation },
    requestMetadata: {
      ...metadata,
      ...(metadata.attributes
        ? { attributes: { ...metadata.attributes } }
        : {}),
    },
    checks: checkOrder.map((id) => ({
      id,
      status: "skipped",
      message: "This check was not reached for the selected verification path.",
    })),
    issues: [],
  };
}

function failureResult(
  mode: ExportVerificationMode,
  expectation: ExportVerificationExpectation,
  metadata: ExportVerificationRequestMetadata,
  code: ExportVerificationIssueCode,
  message: string,
): ExportVerificationResult {
  const result = baseResult(mode, expectation, metadata);
  result.status = "failed";
  result.issues.push({ code, severity: "error", message });
  if (code === "container_unreadable") {
    setCheck(result, {
      id: "container_readable",
      status: "failed",
      message,
    });
  }
  return result;
}

function failCheck(
  result: ExportVerificationResult,
  id: ExportVerificationCheckId,
  code: ExportVerificationIssueCode,
  message: string,
  expected?: unknown,
  actual?: unknown,
): void {
  setCheck(result, { id, status: "failed", message, expected, actual });
  result.issues.push({ code, severity: "error", message });
}

function setCheck(
  result: ExportVerificationResult,
  check: ExportVerificationCheck,
): void {
  const index = result.checks.findIndex(
    (candidate) => candidate.id === check.id,
  );
  if (index >= 0) result.checks[index] = check;
}

function finalizeStatus(
  result: ExportVerificationResult,
): ExportVerificationResult {
  if (result.issues.some((issue) => issue.severity === "error")) {
    result.status = "failed";
  } else if (result.issues.some((issue) => issue.severity === "warning")) {
    result.status = "unverified";
  } else {
    result.status = "verified";
  }
  return result;
}

function validateExpectation(
  expectation: ExportVerificationExpectation,
): string | null {
  if (typeof expectation.hasAudio !== "boolean")
    return "Verification hasAudio must be a boolean track-presence expectation.";
  if (
    expectation.requireAudibleAudio !== undefined &&
    typeof expectation.requireAudibleAudio !== "boolean"
  )
    return "Verification requireAudibleAudio must be a boolean.";
  if (expectation.requireAudibleAudio === true && !expectation.hasAudio)
    return "Audibility requires an expected audio track.";
  if (!Number.isInteger(expectation.width) || expectation.width <= 0) {
    return "Verification width must be a positive integer.";
  }
  if (!Number.isInteger(expectation.height) || expectation.height <= 0) {
    return "Verification height must be a positive integer.";
  }
  if (
    !Number.isFinite(expectation.durationSeconds) ||
    expectation.durationSeconds <= 0
  ) {
    return "Verification durationSeconds must be a positive finite number.";
  }
  if (!Number.isFinite(expectation.fps) || expectation.fps <= 0) {
    return "Verification fps must be a positive finite number.";
  }
  return null;
}

function withinTolerance(
  actual: number | null,
  expected: number | null,
  tolerance: number,
): boolean {
  return (
    actual !== null &&
    expected !== null &&
    Number.isFinite(actual) &&
    Number.isFinite(expected) &&
    Math.abs(actual - expected) <= tolerance + Number.EPSILON * 16
  );
}

function throwIfAborted(signal: AbortSignal | undefined): void {
  if (!signal?.aborted) return;
  throw signal.reason instanceof Error
    ? signal.reason
    : new DOMException("Export verification aborted.", "AbortError");
}

function abortMessage(signal: AbortSignal): string {
  return signal.reason instanceof Error
    ? signal.reason.message
    : "Export verification was aborted.";
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
