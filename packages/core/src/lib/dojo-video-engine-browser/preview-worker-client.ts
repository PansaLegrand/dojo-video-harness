import { parseScene, type Scene } from "@dojo-video-engine/schema";
import {
  planDojoVideoEngineWorkerPreview,
  previewAbortError,
  type DojoVideoEnginePreviewWorkerRequest,
  type DojoVideoEnginePreviewWorkerResponse,
} from "./preview-worker-protocol";

export { planDojoVideoEngineWorkerPreview } from "./preview-worker-protocol";

export interface DojoVideoEnginePreviewWorker extends EventTarget {
  postMessage(message: DojoVideoEnginePreviewWorkerRequest): void;
  terminate(): void;
}

export type DojoVideoEngineWorkerPreviewOptions = {
  width: number;
  height: number;
  signal?: AbortSignal;
  runtime?: Partial<typeof globalThis>;
  createWorker?: () => DojoVideoEnginePreviewWorker;
  /** An unresponsive worker must release the caller to use its main-thread fallback. */
  watchdogMs?: number;
};

type FrameRequest = {
  id: number;
  frame: number;
  signal?: AbortSignal;
  resolve(): void;
  reject(error: Error): void;
  unlink(): void;
  settled: boolean;
};

type ConfigurationRequest = {
  type: "init" | "update";
  id: number;
  revision: number;
  scene: Scene;
  width: number;
  height: number;
  resolve(): void;
  reject(error: Error): void;
  unlink(): void;
};

/**
 * Worker-owned media and rendering, with a transferable bitmap per presented
 * frame. The DOM canvas stays on the main thread so worker failure can fall
 * back without replacing the canvas or losing its last visible frame.
 */
export class DojoVideoEngineWorkerPreviewRenderer {
  private nextId = 1;
  private revision = 0;
  private active: FrameRequest | null = null;
  private pending: FrameRequest | null = null;
  private closed = false;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private configuration: ConfigurationRequest | null = null;

  private constructor(
    private scene: Scene,
    private readonly context:
      | CanvasRenderingContext2D
      | OffscreenCanvasRenderingContext2D,
    private readonly worker: DojoVideoEnginePreviewWorker,
    private readonly options: DojoVideoEngineWorkerPreviewOptions,
  ) {
    worker.addEventListener("message", this.onMessage);
    worker.addEventListener("error", this.onWorkerError);
    worker.addEventListener("messageerror", this.onWorkerError);
  }

  static async create(
    sceneInput: Scene,
    context: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D,
    options: DojoVideoEngineWorkerPreviewOptions,
  ): Promise<DojoVideoEngineWorkerPreviewRenderer> {
    const scene = parseScene(sceneInput);
    const plan = planDojoVideoEngineWorkerPreview(scene, options.runtime);
    if (!plan.eligible)
      throw new Error(
        `Worker preview is unavailable: ${plan.reasons.join(", ")}.`,
      );
    validateDimensions(scene, options);
    if (options.signal?.aborted)
      throw previewAbortError("Worker preview preparation was cancelled.");

    const worker = (options.createWorker ?? createPreviewWorker)();
    const renderer = new DojoVideoEngineWorkerPreviewRenderer(
      scene,
      context,
      worker,
      { ...options },
    );
    try {
      await renderer.configure("init", scene, options);
      return renderer;
    } catch (error) {
      renderer.dispose();
      throw error;
    }
  }

  /** Reuses worker media/caches; call after the previous player's disposal. */
  async updateScene(
    sceneInput: Scene,
    options: { width: number; height: number; signal?: AbortSignal },
  ): Promise<void> {
    if (this.closed) throw new Error("Worker preview is disposed.");
    if (this.configuration)
      throw new Error("Worker preview is already updating.");
    const scene = parseScene(sceneInput);
    const plan = planDojoVideoEngineWorkerPreview(scene, this.options.runtime);
    if (!plan.eligible)
      throw new Error(
        `Worker preview is unavailable: ${plan.reasons.join(", ")}.`,
      );
    validateDimensions(scene, options);
    if (options.signal?.aborted)
      throw previewAbortError("Worker preview update was cancelled.");
    await this.configure("update", scene, options);
  }

  /** Player calls this serially; concurrent callers retain only the latest pending target. */
  renderFrame(frame: number, signal?: AbortSignal): Promise<void> {
    if (this.closed)
      return Promise.reject(new Error("Worker preview is disposed."));
    if (this.configuration)
      return Promise.reject(new Error("Worker preview is updating."));
    if (!Number.isInteger(frame) || frame < 0 || frame >= this.scene.duration)
      return Promise.reject(
        new RangeError("Worker preview frame is outside the scene."),
      );
    if (signal?.aborted)
      return Promise.reject(
        previewAbortError("Worker preview frame was cancelled."),
      );
    return new Promise<void>((resolve, reject) => {
      const request: FrameRequest = {
        id: this.nextId++,
        frame,
        signal,
        resolve,
        reject,
        unlink: () => undefined,
        settled: false,
      };
      const abort = () => {
        this.rejectFrame(
          request,
          previewAbortError("Worker preview frame was cancelled."),
        );
        if (this.pending === request) this.pending = null;
        if (this.active === request)
          this.post({ type: "cancel", requestId: request.id });
      };
      request.unlink = () => signal?.removeEventListener("abort", abort);
      signal?.addEventListener("abort", abort, { once: true });
      if (this.active) {
        if (this.pending)
          this.rejectFrame(
            this.pending,
            previewAbortError("Worker preview frame was superseded."),
          );
        this.pending = request;
      } else {
        this.startFrame(request);
      }
    });
  }

  dispose(): void {
    this.fail(previewAbortError("Worker preview was disposed."));
  }

  private configure(
    type: "init" | "update",
    scene: Scene,
    options: { width: number; height: number; signal?: AbortSignal },
  ): Promise<void> {
    return new Promise((resolve, reject) => {
      const abort = () =>
        this.fail(
          previewAbortError("Worker preview preparation was cancelled."),
        );
      options.signal?.addEventListener("abort", abort, { once: true });
      this.configuration = {
        type,
        id: this.nextId++,
        scene,
        revision: type === "init" ? 0 : this.revision + 1,
        width: options.width,
        height: options.height,
        resolve,
        reject,
        unlink: () => options.signal?.removeEventListener("abort", abort),
      };
      if (this.pending) {
        this.rejectFrame(
          this.pending,
          previewAbortError("Worker preview scene changed."),
        );
        this.pending = null;
      }
      if (this.active) {
        this.rejectFrame(
          this.active,
          previewAbortError("Worker preview scene changed."),
        );
        this.post({ type: "cancel", requestId: this.active.id });
      } else this.startConfiguration();
    });
  }

  private startConfiguration(): void {
    const request = this.configuration;
    if (!request) return;
    this.armWatchdog();
    this.post({
      type: request.type,
      requestId: request.id,
      revision: request.revision,
      scene: request.scene,
      width: request.width,
      height: request.height,
    });
  }

  private startFrame(request: FrameRequest): void {
    this.active = request;
    this.armWatchdog();
    this.post({
      type: "render",
      requestId: request.id,
      revision: this.revision,
      frame: request.frame,
    });
  }

  private readonly onMessage = (event: Event): void => {
    const response = (event as MessageEvent<DojoVideoEnginePreviewWorkerResponse>)
      .data;
    if (!response || typeof response !== "object") return;
    // A stale transfer still owns GPU memory, including after cancellation.
    const bitmap = response.type === "frame" ? response.bitmap : null;
    try {
      if (this.closed) return;
      if (this.configuration?.id === response.requestId) {
        if (response.type === "ready") {
          if (response.revision !== this.configuration.revision) {
            this.fail(
              new Error("Worker returned a mismatched scene revision."),
            );
            return;
          }
          this.clearWatchdog();
          const request = this.configuration;
          this.revision = request.revision;
          this.scene = request.scene;
          this.options.width = request.width;
          this.options.height = request.height;
          request.unlink();
          this.configuration = null;
          request.resolve();
        } else if (response.type === "error") {
          this.fail(responseError(response));
        }
        return;
      }
      const request = this.active;
      if (!request || request.id !== response.requestId) return;
      if (response.type === "error") {
        this.fail(responseError(response));
        return;
      }
      if (response.type !== "frame" && response.type !== "cancelled") return;
      this.clearWatchdog();
      this.active = null;
      if (response.type === "cancelled" || request.signal?.aborted) {
        this.rejectFrame(
          request,
          previewAbortError("Worker preview frame was cancelled."),
        );
      } else if (
        response.frame !== request.frame ||
        response.revision !== this.revision
      ) {
        this.rejectFrame(
          request,
          new Error("Worker returned a mismatched preview frame."),
        );
        this.fail(new Error("Worker returned a mismatched preview frame."));
        return;
      } else if (this.pending || this.configuration) {
        this.rejectFrame(
          request,
          previewAbortError("Worker preview frame was superseded."),
        );
      } else if (!request.settled) {
        try {
          this.present(response.bitmap);
          request.settled = true;
          request.unlink();
          request.resolve();
        } catch (error) {
          const normalized = normalizeError(error);
          this.rejectFrame(request, normalized);
          this.fail(normalized);
          return;
        }
      }
      if (this.configuration) this.startConfiguration();
      else {
        const pending = this.pending;
        this.pending = null;
        if (pending) this.startFrame(pending);
      }
    } finally {
      bitmap?.close();
    }
  };

  private present(bitmap: ImageBitmap): void {
    if (
      bitmap.width !== this.options.width ||
      bitmap.height !== this.options.height
    )
      throw new Error("Worker returned unexpected preview dimensions.");
    const { context } = this;
    if (context.canvas.width !== bitmap.width)
      context.canvas.width = bitmap.width;
    if (context.canvas.height !== bitmap.height)
      context.canvas.height = bitmap.height;
    context.save();
    try {
      context.setTransform(1, 0, 0, 1, 0, 0);
      context.globalAlpha = 1;
      context.globalCompositeOperation = "copy";
      context.filter = "none";
      context.drawImage(bitmap, 0, 0);
    } finally {
      context.restore();
    }
  }

  private readonly onWorkerError = (): void => {
    this.fail(
      new Error("Worker preview failed to load or stopped unexpectedly."),
    );
  };

  private post(request: DojoVideoEnginePreviewWorkerRequest): void {
    if (this.closed) return;
    try {
      this.worker.postMessage(request);
    } catch (error) {
      this.fail(normalizeError(error));
    }
  }

  private rejectFrame(request: FrameRequest, error: Error): void {
    if (request.settled) return;
    request.settled = true;
    request.unlink();
    request.reject(error);
  }

  private fail(error: Error): void {
    if (this.closed) return;
    this.closed = true;
    this.clearWatchdog();
    this.configuration?.unlink();
    this.configuration?.reject(error);
    this.configuration = null;
    if (this.active) this.rejectFrame(this.active, error);
    if (this.pending) this.rejectFrame(this.pending, error);
    this.active = null;
    this.pending = null;
    this.worker.removeEventListener("message", this.onMessage);
    this.worker.removeEventListener("error", this.onWorkerError);
    this.worker.removeEventListener("messageerror", this.onWorkerError);
    try {
      this.worker.postMessage({ type: "dispose" });
    } catch {
      /* Already failed. */
    }
    this.worker.terminate();
  }

  private armWatchdog(): void {
    this.clearWatchdog();
    this.timer = setTimeout(
      () => this.fail(new Error("Worker preview timed out.")),
      Math.max(1, this.options.watchdogMs ?? 20_000),
    );
  }

  private clearWatchdog(): void {
    if (this.timer !== null) clearTimeout(this.timer);
    this.timer = null;
  }
}

function validateDimensions(
  scene: Scene,
  size: { width: number; height: number },
): void {
  if (
    !Number.isInteger(size.width) ||
    !Number.isInteger(size.height) ||
    size.width <= 0 ||
    size.height <= 0 ||
    size.width > scene.width ||
    size.height > scene.height
  )
    throw new Error(
      "Worker preview dimensions must be within the scene bounds.",
    );
}

function responseError(
  response: Extract<DojoVideoEnginePreviewWorkerResponse, { type: "error" }>,
): Error {
  const error = new Error(response.message);
  error.name = response.name;
  return error;
}

function normalizeError(error: unknown): Error {
  return error instanceof Error ? error : new Error(String(error));
}

function createPreviewWorker(): DojoVideoEnginePreviewWorker {
  return new Worker(new URL("./preview.worker.ts", import.meta.url), {
    type: "module",
    name: "dojo-video-engine-browser-preview",
  });
}
