import {
  detectExportCapability,
  exportVideo,
  exportVideoToStream,
  type ExportVideoStreamResult,
  type ExportVerificationSink,
  preflightExport,
  type ExportPreflightResult,
  type ExportVideoOptions,
  type ExportVideoResult,
  type RenderFrameSequenceProgress,
} from "@dojo-video-engine/export";
import {
  ExportWorkerClient,
  type WorkerLike,
} from "@dojo-video-engine/export/worker";
import {
  startWorkerStreamExport,
  supportsTransferableWritableStream,
  StreamWorkerStartupError,
  type StreamExportWorker,
} from "./stream-export";
import type { StreamTargetChunk, StreamTargetOptions } from "mediabunny";
import { inspectScene, type Scene } from "@dojo-video-engine/schema";
import {
  copyExportCandidate,
  tryCopyVideoBlob,
  tryCopyVideoStream,
} from "./copy-export";
import { prepareExportWorkerFonts } from "./export-worker-readiness";

export type DojoVideoEngineExportStrategy =
  | "worker"
  | "main-thread"
  | "copy"
  | "unavailable";

export type DojoVideoEngineExportPlan = {
  strategy: DojoVideoEngineExportStrategy;
  preflight: ExportPreflightResult;
  workerPreflight: ExportPreflightResult | null;
  fallbackReasons: string[];
};

export type DojoVideoEngineExportPhase =
  | "preparing"
  | "rendering"
  | "finishing"
  | "complete";

export type DojoVideoEngineExportOptions = {
  scene: Scene;
  startFrame?: number;
  endFrame?: number;
  bitrate?: ExportVideoOptions["bitrate"];
  codecs?: ExportVideoOptions["codecs"];
  verification?: ExportVideoOptions["verification"];
  requireAudibleAudio?: boolean;
  audioChunkSeconds?: number;
  budget?: ExportVideoOptions["budget"];
  onPhaseChange?: (phase: DojoVideoEngineExportPhase) => void;
  progressIntervalMs?: number;
  onProgress?: (progress: RenderFrameSequenceProgress) => void;
  preferWorker?: boolean;
  /** Disable conservative full-source packet copying for reference exports. */
  preferCopy?: boolean;
  workerWatchdogMs?: number;
  onStrategyChange?: (
    strategy: Exclude<DojoVideoEngineExportStrategy, "unavailable">,
    reason: string,
  ) => void;
  runtime?: Partial<typeof globalThis>;
  /** Host/test seam; production uses the bundled DojoVideoEngine worker. */
  createWorker?: () => DojoVideoEngineExportWorker;
  createStreamWorker?: () => StreamExportWorker;
  /** Host/test seam; production uses DojoVideoEngine's main-thread exporter. */
  exportMainThread?: (
    options: ExportVideoOptions,
  ) => Promise<ExportVideoResult>;
};

export type DojoVideoEngineExportTask = {
  plan: DojoVideoEngineExportPlan;
  result: Promise<ExportVideoResult>;
  cancel(): void;
};

export type DojoVideoEngineExportWorker = WorkerLike & {
  terminate(): void;
};

export class DojoVideoEngineExportPreflightError extends Error {
  readonly code: string = "DOJO_VIDEO_ENGINE_EXPORT_PREFLIGHT_FAILED";

  constructor(readonly plan: DojoVideoEngineExportPlan) {
    const errors = plan.preflight.issues.filter(
      (issue) => issue.severity === "error",
    );
    super(
      errors.map((issue) => issue.message).join(" ") ||
        "This scene cannot be exported in the current browser.",
    );
    this.name = "DojoVideoEngineExportPreflightError";
  }
}

/**
 * Produces a deterministic export decision before allocating decoders or
 * encoders. Font scenes are provisional worker candidates until the actual
 * worker preflights and loads its fonts; DOM/Lottie scenes stay on the main thread.
 */
export function planDojoVideoEngineExport(
  scene: Scene,
  runtime: Partial<typeof globalThis> = globalThis,
  options: Partial<DojoVideoEngineExportOptions> = {},
): DojoVideoEngineExportPlan {
  const preflight = preflightExport(scene, runtime, encodingOptions(options));
  const fallbackReasons: string[] = [];
  if (!preflight.ok) {
    return {
      strategy: "unavailable",
      preflight,
      workerPreflight: null,
      fallbackReasons,
    };
  }

  const capability = detectExportCapability(runtime);
  const inspection = inspectScene(scene);
  const preferWorker = options.preferWorker !== false;

  if (!preferWorker) fallbackReasons.push("worker_not_preferred");
  if (!capability.worker) fallbackReasons.push("worker_unavailable");
  if (!capability.offscreenCanvas)
    fallbackReasons.push("offscreen_canvas_unavailable");
  if (inspection.capabilities.hasLottie)
    fallbackReasons.push("lottie_requires_main_thread");
  if (inspection.capabilities.hasExtensions)
    fallbackReasons.push("extension_registry_requires_main_thread");

  const canTryWorker = preferWorker && fallbackReasons.length === 0;
  // A window FontFaceSet says nothing about worker support. Font scenes must
  // obtain their worker preflight from that worker before starting output.
  const workerPreflight =
    canTryWorker && !inspection.capabilities.hasFonts
      ? preflightExport(scene, buildWorkerPreflightRuntime(runtime), {
          ...encodingOptions(options),
          worker: true,
        })
      : null;
  if (workerPreflight && !workerPreflight.ok) {
    fallbackReasons.push(
      ...workerPreflight.issues
        .filter((issue) => issue.severity === "error")
        .map((issue) => `worker:${issue.code}`),
    );
  }

  return {
    strategy:
      canTryWorker && (inspection.capabilities.hasFonts || workerPreflight?.ok)
        ? "worker"
        : "main-thread",
    preflight,
    workerPreflight,
    fallbackReasons,
  };
}

export function startDojoVideoEngineSceneExport(
  options: DojoVideoEngineExportOptions,
): DojoVideoEngineExportTask {
  options = withExportPhases(options);
  options.onPhaseChange?.("preparing");
  const runtime = options.runtime ?? globalThis;
  let plan = planDojoVideoEngineExport(options.scene, runtime, {
    ...options,
  });
  if (plan.strategy === "unavailable") {
    throw new DojoVideoEngineExportPreflightError(plan);
  }

  if (copyExportCandidate(options)) {
    const controller = new AbortController();
    let fallback: DojoVideoEngineExportTask | undefined;
    const result = (async () => {
      const copied = await tryCopyVideoBlob({
        ...encodingOptions(options),
        scene: options.scene,
        signal: controller.signal,
        progressIntervalMs: options.progressIntervalMs,
        onProgress: options.onProgress,
        onCopyStart: () => {
          plan.strategy = "copy";
          options.onStrategyChange?.("copy", "unchanged_source_packets");
        },
      });
      if (controller.signal.aborted) throw controller.signal.reason;
      if (copied) {
        options.onPhaseChange?.("complete");
        return copied;
      }
      plan.fallbackReasons.push("copy_media_ineligible");
      fallback = startRenderedSceneExport(options, plan);
      Object.assign(plan, fallback.plan);
      return fallback.result;
    })();
    return {
      plan,
      result,
      cancel: () => {
        controller.abort(new DOMException("Export cancelled.", "AbortError"));
        fallback?.cancel();
      },
    };
  }
  return startRenderedSceneExport(options, plan);
}

function startRenderedSceneExport(
  options: DojoVideoEngineExportOptions,
  initialPlan: DojoVideoEngineExportPlan,
): DojoVideoEngineExportTask {
  let plan = initialPlan;
  if (plan.strategy === "worker") {
    try {
      const worker = (options.createWorker ?? createDojoVideoEngineExportWorker)();
      if (inspectScene(options.scene).capabilities.hasFonts) {
        return startFontPreparedWorker(
          options,
          plan,
          worker,
          () => startWorkerExportWithRecovery({ worker, options, plan }),
          () => startRenderedSceneExport(options, plan),
        );
      }
      return startWorkerExportWithRecovery({ worker, options, plan });
    } catch (error) {
      plan = {
        ...plan,
        strategy: "main-thread",
        fallbackReasons: [
          ...plan.fallbackReasons,
          `worker_start_failed:${
            error instanceof Error ? error.message : String(error)
          }`,
        ],
      };
    }
  }

  const controller = new AbortController();
  const mainThreadExport = options.exportMainThread ?? exportVideo;
  return {
    plan,
    result: mainThreadExport({
      ...encodingOptions(options),
      scene: options.scene,
      signal: controller.signal,
      progressIntervalMs: options.progressIntervalMs,
      onProgress: options.onProgress,
    }).then((result) => {
      options.onPhaseChange?.("complete");
      return result;
    }),
    cancel: () =>
      controller.abort(new DOMException("Export cancelled.", "AbortError")),
  };
}

/** Font preparation owns no output. Only this stage may choose a new executor
 * for a file; after stream handoff the established writer owns failure cleanup. */
function startFontPreparedWorker<T>(
  options: DojoVideoEngineExportOptions,
  plan: DojoVideoEngineExportPlan,
  worker: DojoVideoEngineExportWorker | StreamExportWorker,
  start: () => { result: Promise<T>; cancel(): void },
  fallback: () => { result: Promise<T>; cancel(): void },
  cancelDestination?: (reason: unknown) => void,
): { plan: DojoVideoEngineExportPlan; result: Promise<T>; cancel(): void } {
  const controller = new AbortController();
  let active: { result: Promise<T>; cancel(): void } | undefined;
  let destinationAborted = false;
  const abortDestination = (reason: unknown) => {
    if (!destinationAborted) {
      destinationAborted = true;
      cancelDestination?.(reason);
    }
  };
  const result = (async () => {
    try {
      plan.workerPreflight = await prepareExportWorkerFonts(
        worker as unknown as Parameters<typeof prepareExportWorkerFonts>[0],
        options.scene,
        {
          startFrame: options.startFrame,
          endFrame: options.endFrame,
          bitrate: options.bitrate,
          codecs: options.codecs,
          budget: options.budget,
        },
        controller.signal,
        options.workerWatchdogMs ?? 60_000,
      );
    } catch (error) {
      worker.terminate();
      if (controller.signal.aborted) throw controller.signal.reason;
      plan.strategy = "main-thread";
      const reason = `worker_font_preparation_failed:${error instanceof Error ? error.message : String(error)}`;
      plan.fallbackReasons.push(reason);
      options.onStrategyChange?.("main-thread", reason);
      if (controller.signal.aborted) throw controller.signal.reason;
      active = fallback();
      return active.result;
    }
    if (controller.signal.aborted) {
      worker.terminate();
      throw controller.signal.reason;
    }
    try {
      active = start();
    } catch (error) {
      worker.terminate();
      if (error instanceof StreamWorkerStartupError && !error.safeToFallback)
        throw error;
      plan.strategy = "main-thread";
      plan.fallbackReasons.push("worker_start_failed_after_font_preparation");
      active = fallback();
    }
    return active.result;
  })().catch((error) => {
    if (!active) {
      worker.terminate();
      abortDestination(error);
    }
    throw error;
  });
  return {
    plan,
    result,
    cancel() {
      if (controller.signal.aborted) return;
      const reason = new DOMException("Export cancelled.", "AbortError");
      controller.abort(reason);
      if (active) active.cancel();
      else {
        worker.terminate();
        abortDestination(reason);
      }
    },
  };
}

function startWorkerExportWithRecovery(params: {
  worker: DojoVideoEngineExportWorker;
  options: DojoVideoEngineExportOptions;
  plan: DojoVideoEngineExportPlan;
}): DojoVideoEngineExportTask {
  const { worker, options, plan } = params;
  const mainThreadExport = options.exportMainThread ?? exportVideo;
  const fallbackController = new AbortController();
  const watchdogMs = Math.max(1, options.workerWatchdogMs ?? 60_000);
  let cancelled = false;
  let workerProgressSeen = false;
  let watchdog: ReturnType<typeof setTimeout> | null = null;
  let workerTask: ReturnType<ExportWorkerClient["export"]>;
  let settleFailure!: (error: Error) => void;
  const browserWorker = worker as unknown as {
    addEventListener(
      type: "error" | "messageerror" | "message",
      listener: (event: Event) => void,
    ): void;
    removeEventListener(
      type: "error" | "messageerror" | "message",
      listener: (event: Event) => void,
    ): void;
  };
  const resetWatchdog = () => {
    if (watchdog) clearTimeout(watchdog);
    watchdog = setTimeout(() => {
      settleFailure(new Error("DojoVideoEngine export worker stopped responding."));
    }, watchdogMs);
  };
  const workerError = (event: Event) => {
    const message =
      "message" in event && typeof event.message === "string"
        ? event.message
        : "DojoVideoEngine export worker crashed.";
    settleFailure(new Error(message));
  };
  const workerHeartbeat = (event: Event) => {
    const data = (event as MessageEvent).data;
    if (
      data?.type === "dojo-video-engine.export.heartbeat" &&
      data.requestId === workerTask?.id
    ) {
      resetWatchdog();
    }
  };
  const workerMessageError = () =>
    settleFailure(
      new Error("DojoVideoEngine export worker returned an unreadable message."),
    );

  const result = new Promise<ExportVideoResult>((resolve, reject) => {
    let settled = false;
    const cleanup = () => {
      if (watchdog) clearTimeout(watchdog);
      watchdog = null;
      browserWorker.removeEventListener("error", workerError);
      browserWorker.removeEventListener("messageerror", workerMessageError);
      browserWorker.removeEventListener("message", workerHeartbeat);
      worker.terminate();
    };
    const rejectCancelled = () => {
      const error = new Error("Export cancelled.");
      error.name = "AbortError";
      reject(error);
    };
    settleFailure = (error) => {
      if (settled) return;
      settled = true;
      cleanup();
      if (cancelled) {
        rejectCancelled();
        return;
      }
      if (workerProgressSeen && !isRecoverableWorkerCompatibilityError(error)) {
        reject(error);
        return;
      }
      const reason = `worker_runtime_failed:${error.message}`;
      plan.strategy = "main-thread";
      plan.fallbackReasons.push(reason);
      options.onStrategyChange?.("main-thread", reason);
      mainThreadExport({
        ...encodingOptions(options),
        scene: options.scene,
        signal: fallbackController.signal,
        progressIntervalMs: options.progressIntervalMs,
        onProgress: options.onProgress,
      }).then((value) => {
        options.onPhaseChange?.("complete");
        resolve(value);
      }, reject);
    };

    browserWorker.addEventListener("error", workerError);
    browserWorker.addEventListener("messageerror", workerMessageError);
    browserWorker.addEventListener("message", workerHeartbeat);
    workerTask = new ExportWorkerClient(worker).export(options.scene, {
      ...encodingOptions(options),
      progressIntervalMs: options.progressIntervalMs,
      onProgress: (progress) => {
        workerProgressSeen = true;
        resetWatchdog();
        options.onProgress?.(progress);
      },
    });
    resetWatchdog();
    workerTask.result.then(
      (value) => {
        if (settled) return;
        settled = true;
        cleanup();
        options.onPhaseChange?.("complete");
        resolve(value);
      },
      (cause) =>
        settleFailure(
          cause instanceof Error ? cause : new Error(String(cause)),
        ),
    );
  });

  return {
    plan,
    result,
    cancel: () => {
      if (cancelled) return;
      cancelled = true;
      fallbackController.abort(
        new DOMException("Export cancelled.", "AbortError"),
      );
      workerTask?.cancel();
      settleFailure(new Error("Export cancelled."));
    },
  };
}

function isRecoverableWorkerCompatibilityError(error: Error) {
  return /\bAudioBuffer is not (?:defined|a constructor)\b/i.test(
    error.message,
  );
}

/** Backwards-compatible promise API for other product callers. */
export async function exportDojoVideoEngineScene(
  options: DojoVideoEngineExportOptions,
): Promise<ExportVideoResult> {
  return startDojoVideoEngineSceneExport(options).result;
}

function createDojoVideoEngineExportWorker(): DojoVideoEngineExportWorker {
  return new Worker(new URL("./export.worker.ts", import.meta.url), {
    type: "module",
    name: "dojo-video-engine-browser-export",
  });
}

function buildWorkerPreflightRuntime(
  runtime: Partial<typeof globalThis>,
): Partial<typeof globalThis> {
  const keys = [
    "AudioData",
    "AudioDecoder",
    "AudioEncoder",
    "DOMMatrix",
    "OffscreenCanvas",
    "Path2D",
    "TransformStream",
    "VideoDecoder",
    "VideoEncoder",
    "VideoFrame",
    "Worker",
    "WritableStream",
    "createImageBitmap",
  ] as const;
  return Object.fromEntries(
    keys.flatMap((key) =>
      key in runtime
        ? [[key, runtime[key] as (typeof runtime)[typeof key]]]
        : [],
    ),
  ) as Partial<typeof globalThis>;
}

/** Caller-owned positional sink. It never constructs a full output Blob. */
export function startDojoVideoEngineSceneStreamExport(
  options: DojoVideoEngineExportOptions & {
    verificationSink?: ExportVerificationSink;
  },
  writable: WritableStream<StreamTargetChunk>,
  streamOptions: StreamTargetOptions = {},
): {
  plan: DojoVideoEngineExportPlan;
  result: Promise<ExportVideoStreamResult>;
  cancel(): void;
} {
  const phased = withExportPhases(options);
  phased.onPhaseChange?.("preparing");
  let plan = planDojoVideoEngineExport(options.scene, options.runtime, options);
  if (plan.strategy === "unavailable")
    throw new DojoVideoEngineExportPreflightError(plan);
  if (copyExportCandidate(options)) {
    const controller = new AbortController();
    let fallback: ReturnType<typeof startRenderedStreamExport> | undefined;
    const result = (async () => {
      try {
        const copied = await tryCopyVideoStream(
          {
            ...encodingOptions(options),
            scene: options.scene,
            signal: controller.signal,
            progressIntervalMs: options.progressIntervalMs,
            onProgress: phased.onProgress,
            verificationSink: options.verificationSink,
            onCopyStart: () => {
              plan.strategy = "copy";
              options.onStrategyChange?.("copy", "unchanged_source_packets");
            },
          },
          writable,
          streamOptions,
        );
        if (controller.signal.aborted) throw controller.signal.reason;
        if (copied) {
          phased.onPhaseChange?.("complete");
          return copied;
        }
        plan.fallbackReasons.push("copy_media_ineligible");
        fallback = startRenderedStreamExport(
          phased,
          writable,
          streamOptions,
          plan,
        );
        Object.assign(plan, fallback.plan);
        return await fallback.result;
      } catch (error) {
        if (!writable.locked) {
          const cleanup = writable.abort(error).catch(() => {});
          if (!controller.signal.aborted) await cleanup;
        }
        throw error;
      }
    })();
    return {
      plan,
      result,
      cancel: () => {
        controller.abort(new DOMException("Export cancelled.", "AbortError"));
        fallback?.cancel();
      },
    };
  }
  return startRenderedStreamExport(phased, writable, streamOptions, plan);
}

function startRenderedStreamExport(
  options: DojoVideoEngineExportOptions & {
    verificationSink?: ExportVerificationSink;
  },
  writable: WritableStream<StreamTargetChunk>,
  streamOptions: StreamTargetOptions,
  initialPlan: DojoVideoEngineExportPlan,
): {
  plan: DojoVideoEngineExportPlan;
  result: Promise<ExportVideoStreamResult>;
  cancel(): void;
} {
  let plan = initialPlan;
  const phased = options;
  if (plan.strategy === "worker" && supportsTransferableWritableStream()) {
    try {
      if (inspectScene(options.scene).capabilities.hasFonts) {
        const worker =
          options.createStreamWorker?.() ??
          new Worker(new URL("./stream-export.worker.ts", import.meta.url), {
            type: "module",
            name: "dojo-video-engine-stream-export",
          });
        return startFontPreparedWorker(
          options,
          plan,
          worker,
          () =>
            startWorkerStreamExport(
              { ...phased, createStreamWorker: () => worker },
              writable,
              streamOptions,
              plan,
            ),
          () =>
            startRenderedStreamExport(phased, writable, streamOptions, plan),
          (reason) => {
            void writable.abort(reason).catch(() => undefined);
          },
        );
      }
      return startWorkerStreamExport(phased, writable, streamOptions, plan);
    } catch (error) {
      if (error instanceof StreamWorkerStartupError && !error.safeToFallback)
        throw error;
      plan = {
        ...plan,
        strategy: "main-thread",
        fallbackReasons: [
          ...plan.fallbackReasons,
          "stream_worker_start_failed",
        ],
      };
    }
  } else if (plan.strategy === "worker") {
    plan = {
      ...plan,
      strategy: "main-thread",
      fallbackReasons: [
        ...plan.fallbackReasons,
        "transferable_stream_unavailable",
      ],
    };
  }
  const controller = new AbortController();
  const result = exportVideoToStream(
    {
      ...encodingOptions(options),
      scene: options.scene,
      signal: controller.signal,
      progressIntervalMs: options.progressIntervalMs,
      onProgress: phased.onProgress,
      verificationSink: options.verificationSink,
    },
    writable,
    streamOptions,
  ).then((value) => {
    phased.onPhaseChange?.("complete");
    return value;
  });
  return {
    plan,
    result,
    cancel: () =>
      controller.abort(new DOMException("Export cancelled.", "AbortError")),
  };
}

function encodingOptions(options: Partial<DojoVideoEngineExportOptions>) {
  return {
    startFrame: options.startFrame,
    endFrame: options.endFrame,
    bitrate: options.bitrate,
    codecs: options.codecs,
    verification: options.verification,
    requireAudibleAudio: options.requireAudibleAudio,
    audioChunkSeconds: options.audioChunkSeconds,
    budget: options.budget,
  };
}

function withExportPhases(
  options: DojoVideoEngineExportOptions,
): DojoVideoEngineExportOptions {
  let finishing = false;
  let rendering = false;
  return {
    ...options,
    onProgress: (progress) => {
      if (!rendering) {
        rendering = true;
        options.onPhaseChange?.("rendering");
      }
      options.onProgress?.(progress);
      if (!finishing && progress.frameIndex + 1 === progress.totalFrames) {
        finishing = true;
        options.onPhaseChange?.("finishing");
      }
    },
  };
}
