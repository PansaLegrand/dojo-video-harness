import {
  ExportVerificationError,
  verifyExportWithSink,
  type ExportVideoOptions,
  type ExportVideoStreamResult,
  type ExportVerificationSink,
  type RenderFrameSequenceProgress,
} from "@dojo-video-engine/export";
import type { StreamTargetChunk, StreamTargetOptions } from "mediabunny";
import type {
  DojoVideoEngineExportOptions,
  DojoVideoEngineExportPlan,
} from "./export-client";

export type StreamExportRequest =
  | {
      type: "start";
      id: string;
      options: Omit<
        ExportVideoOptions,
        "onProgress" | "signal" | "verificationSink"
      >;
      writable: WritableStream<StreamTargetChunk>;
      streamOptions: StreamTargetOptions;
    }
  | { type: "cancel"; id: string };
export type StreamExportEvent =
  | { type: "progress"; id: string; progress: RenderFrameSequenceProgress }
  | { type: "heartbeat"; id: string }
  | { type: "complete"; id: string; result: ExportVideoStreamResult }
  | { type: "error"; id: string; error: { name: string; message: string } };
export interface StreamExportWorker extends EventTarget {
  postMessage(message: StreamExportRequest, transfer?: Transferable[]): void;
  terminate(): void;
}

let transferSupport: boolean | undefined;
export function supportsTransferableWritableStream(): boolean {
  if (transferSupport !== undefined) return transferSupport;
  try {
    const original = new WritableStream();
    const transferred = structuredClone(original, { transfer: [original] });
    void transferred.abort().catch(() => undefined);
    return (transferSupport = true);
  } catch {
    return (transferSupport = false);
  }
}

export class StreamWorkerStartupError extends Error {
  constructor(
    message: string,
    readonly safeToFallback: boolean,
  ) {
    super(message);
  }
}

/** The host owns the actual destination; only a bounded forwarding stream moves
 * to the worker. That preserves abort/rollback even after worker termination. */
export function startWorkerStreamExport(
  options: DojoVideoEngineExportOptions & {
    verificationSink?: ExportVerificationSink;
    createStreamWorker?: () => StreamExportWorker;
  },
  writable: WritableStream<StreamTargetChunk>,
  streamOptions: StreamTargetOptions,
  plan: DojoVideoEngineExportPlan,
) {
  const worker =
    options.createStreamWorker?.() ??
    new Worker(new URL("./stream-export.worker.ts", import.meta.url), {
      type: "module",
      name: "dojo-video-engine-stream-export",
    });
  const writer = (() => {
    try {
      return writable.getWriter();
    } catch (error) {
      worker.terminate();
      throw new StreamWorkerStartupError(
        error instanceof Error ? error.message : String(error),
        false,
      );
    }
  })();
  void writer.closed.catch(() => undefined);
  const controller = new AbortController();
  const id = crypto.randomUUID();
  let settled = false,
    completionStarted = false,
    released = false,
    timer: ReturnType<typeof setTimeout> | undefined;
  const release = () => {
    if (!released) {
      released = true;
      writer.releaseLock();
    }
  };
  let resolve!: (value: ExportVideoStreamResult) => void,
    reject!: (error: Error) => void;
  const result = new Promise<ExportVideoStreamResult>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  const cleanup = () => {
    clearTimeout(timer);
    worker.removeEventListener("message", message);
    worker.removeEventListener("error", failed);
    worker.removeEventListener("messageerror", failed);
    worker.terminate();
  };
  const fail = (cause: unknown) => {
    if (settled) return;
    settled = true;
    const error = cause instanceof Error ? cause : new Error(String(cause));
    controller.abort(error);
    cleanup();
    void writer
      .abort(error)
      .catch(() => undefined)
      .finally(() => {
        release();
        reject(error);
      });
  };
  const heartbeat = () => {
    clearTimeout(timer);
    timer = setTimeout(
      () => fail(new Error("Export worker stopped responding.")),
      Math.max(1, options.workerWatchdogMs ?? 60_000),
    );
  };
  const failed = () =>
    fail(new Error("Export worker failed. The unfinished file was aborted."));
  const bridge = new WritableStream<StreamTargetChunk>(
    {
      async write(chunk) {
        if (controller.signal.aborted) throw controller.signal.reason;
        if (
          chunk.type !== "write" ||
          !(chunk.data instanceof Uint8Array) ||
          chunk.data.byteLength > 1024 * 1024 ||
          !Number.isSafeInteger(chunk.position) ||
          chunk.position < 0
        )
          throw new Error("Invalid bounded export write.");
        try {
          await writer.write(chunk);
        } catch (error) {
          fail(error);
          throw error;
        }
      },
      async close() {
        await writer.close();
      },
      async abort(reason) {
        if (!settled) fail(reason ?? new Error("Export stream aborted."));
      },
    },
    { highWaterMark: 1 },
  );
  const message = (event: Event) => {
    const data = (event as MessageEvent<StreamExportEvent>).data;
    if (settled || !data || data.id !== id) return;
    if (data.type === "progress") {
      heartbeat();
      try {
        options.onProgress?.(data.progress);
      } catch (error) {
        fail(error);
      }
      return;
    }
    if (data.type === "heartbeat") {
      heartbeat();
      return;
    }
    if (data.type === "error") {
      const error = new Error(data.error.message);
      error.name = data.error.name;
      fail(error);
      return;
    }
    if (data.type !== "complete" || completionStarted) return;
    completionStarted = true;
    void (async () => {
      try {
        if (!data.result.verification)
          throw new Error("Export returned no verification expectation.");
        // Stream-transfer messages and worker result messages use different ports.
        // Wait for the host destination itself, even if complete arrives first.
        await writer.closed;
        clearTimeout(timer);
        let value = data.result;
        if (options.verificationSink) {
          const verification = await verifyExportWithSink(
            options.verificationSink,
            {
              mode: options.verification ?? "container",
              expectation: data.result.verification.expectation,
              metadata: data.result.verification.requestMetadata,
              signal: controller.signal,
            },
          );
          if (verification.status === "failed")
            throw new ExportVerificationError(verification);
          value = { ...value, verification };
        }
        if (controller.signal.aborted || settled) return;
        options.onPhaseChange?.("complete");
        if (settled || controller.signal.aborted) return;
        settled = true;
        cleanup();
        release();
        resolve(value);
      } catch (error) {
        fail(error);
      }
    })();
  };
  worker.addEventListener("message", message);
  worker.addEventListener("error", failed);
  worker.addEventListener("messageerror", failed);
  try {
    heartbeat();
    worker.postMessage(
      {
        type: "start",
        id,
        writable: bridge,
        streamOptions: {
          ...streamOptions,
          chunked: true,
          chunkSize: Math.min(
            1024 * 1024,
            Math.max(1024, streamOptions.chunkSize ?? 1024 * 1024),
          ),
        },
        options: {
          scene: options.scene,
          startFrame: options.startFrame,
          endFrame: options.endFrame,
          bitrate: options.bitrate,
          codecs: options.codecs,
          verification: options.verification,
          requireAudibleAudio: options.requireAudibleAudio,
          audioChunkSeconds: options.audioChunkSeconds,
          budget: options.budget,
          progressIntervalMs: options.progressIntervalMs,
        },
      },
      [bridge],
    );
  } catch (error) {
    const safe = !bridge.locked;
    if (safe) {
      settled = true;
      cleanup();
      release();
    } else {
      fail(error);
      void result.catch(() => undefined);
    }
    throw new StreamWorkerStartupError(
      error instanceof Error ? error.message : String(error),
      safe,
    );
  }
  return {
    plan,
    result,
    cancel: () => fail(new DOMException("Export cancelled.", "AbortError")),
  };
}
