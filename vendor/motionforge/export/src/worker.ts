import type { Scene } from "@motionforge/schema";
import {
  exportVideo,
  type ExportVideoOptions,
  type ExportVideoResult,
  type RenderFrameSequenceProgress,
} from "./index";

export type WorkerExportOptions = Omit<
  ExportVideoOptions,
  | "scene"
  | "signal"
  | "onProgress"
  | "assets"
  | "extensions"
  | "worker"
  | "verificationSink"
  | "assetPolicy"
  | "analysisCache"
  | "fontCache"
  | "scratchSurfacePool"
  | "staticDisplayCache"
  | "opaqueExtensionRegistry"
>;

export type ExportWorkerRequest =
  | {
      type: "motionforge.export.start";
      id: string;
      scene: Scene;
      options?: WorkerExportOptions;
    }
  | { type: "motionforge.export.cancel"; id: string };

export type ExportWorkerEvent =
  | {
      type: "motionforge.export.progress";
      id: string;
      progress: RenderFrameSequenceProgress;
    }
  | {
      type: "motionforge.export.complete";
      id: string;
      result: ExportVideoResult;
    }
  | {
      type: "motionforge.export.error";
      id: string;
      error: { name: string; message: string };
    };

export type ExportWorkerHandlerOptions = {
  postMessage(event: ExportWorkerEvent): void;
  extensions?: ExportVideoOptions["extensions"];
  opaqueExtensionRegistry?: ExportVideoOptions["opaqueExtensionRegistry"];
  staticDisplayCache?: ExportVideoOptions["staticDisplayCache"];
  assetPolicy?: ExportVideoOptions["assetPolicy"];
  analysisCache?: ExportVideoOptions["analysisCache"];
  fontCache?: ExportVideoOptions["fontCache"];
  verificationSink?: ExportVideoOptions["verificationSink"];
};

export function createExportWorkerHandler(
  options: ExportWorkerHandlerOptions,
): (request: ExportWorkerRequest) => Promise<void> {
  const controllers = new Map<string, AbortController>();
  return async (request) => {
    if (request.type === "motionforge.export.cancel") {
      controllers
        .get(request.id)
        ?.abort(new DOMException("Export cancelled.", "AbortError"));
      return;
    }
    if (controllers.has(request.id)) {
      options.postMessage({
        type: "motionforge.export.error",
        id: request.id,
        error: {
          name: "DuplicateExportRequestError",
          message: `An export with id "${request.id}" is already active. Request ids must be unique until terminal completion.`,
        },
      });
      return;
    }
    const controller = new AbortController();
    controllers.set(request.id, controller);
    try {
      const {
        scratchSurfacePool: _nonSerializablePool,
        staticDisplayCache: _nonSerializableStaticCache,
        opaqueExtensionRegistry: _nonSerializableOpaqueRegistry,
        ...requestOptions
      } = (request.options ?? {}) as WorkerExportOptions & {
        scratchSurfacePool?: unknown;
        staticDisplayCache?: unknown;
        opaqueExtensionRegistry?: unknown;
      };
      const result = await exportVideo({
        ...requestOptions,
        scene: request.scene,
        signal: controller.signal,
        worker: true,
        extensions: options.extensions,
        opaqueExtensionRegistry: options.opaqueExtensionRegistry,
        staticDisplayCache: options.staticDisplayCache,
        assetPolicy: options.assetPolicy,
        analysisCache: options.analysisCache,
        fontCache: options.fontCache,
        verificationSink: options.verificationSink,
        onProgress: (progress) =>
          options.postMessage({
            type: "motionforge.export.progress",
            id: request.id,
            progress,
          }),
      });
      options.postMessage({
        type: "motionforge.export.complete",
        id: request.id,
        result,
      });
    } catch (error) {
      options.postMessage({
        type: "motionforge.export.error",
        id: request.id,
        error: {
          name: error instanceof Error ? error.name : "Error",
          message: error instanceof Error ? error.message : String(error),
        },
      });
    } finally {
      if (controllers.get(request.id) === controller) {
        controllers.delete(request.id);
      }
    }
  };
}

export type WorkerLike = {
  postMessage(message: ExportWorkerRequest): void;
  addEventListener(
    type: "message",
    listener: (event: MessageEvent<ExportWorkerEvent>) => void,
  ): void;
  removeEventListener(
    type: "message",
    listener: (event: MessageEvent<ExportWorkerEvent>) => void,
  ): void;
};

export class ExportWorkerClient {
  private sequence = 0;

  constructor(private readonly worker: WorkerLike) {}

  export(
    scene: Scene,
    options: WorkerExportOptions & {
      onProgress?: (progress: RenderFrameSequenceProgress) => void;
    } = {},
  ): { id: string; result: Promise<ExportVideoResult>; cancel(): void } {
    const id = `export-${++this.sequence}`;
    const {
      onProgress,
      scratchSurfacePool: _nonSerializablePool,
      staticDisplayCache: _nonSerializableStaticCache,
      opaqueExtensionRegistry: _nonSerializableOpaqueRegistry,
      ...serializableOptions
    } = options as typeof options & {
      scratchSurfacePool?: unknown;
      staticDisplayCache?: unknown;
      opaqueExtensionRegistry?: unknown;
    };
    let settled = false;
    let listener!: (event: MessageEvent<ExportWorkerEvent>) => void;
    const result = new Promise<ExportVideoResult>((resolve, reject) => {
      listener = (event) => {
        if (event.data.id !== id) return;
        if (event.data.type === "motionforge.export.progress") {
          onProgress?.(event.data.progress);
          return;
        }
        settled = true;
        this.worker.removeEventListener("message", listener);
        if (event.data.type === "motionforge.export.complete") {
          resolve(event.data.result);
        } else {
          const error = new Error(event.data.error.message);
          error.name = event.data.error.name;
          reject(error);
        }
      };
      this.worker.addEventListener("message", listener);
      this.worker.postMessage({
        type: "motionforge.export.start",
        id,
        scene,
        options: serializableOptions,
      });
    });
    return {
      id,
      result,
      cancel: () => {
        if (!settled) {
          this.worker.postMessage({ type: "motionforge.export.cancel", id });
        }
      },
    };
  }
}

export function installExportWorker(
  scope: {
    postMessage(event: ExportWorkerEvent): void;
    addEventListener(
      type: "message",
      listener: (event: MessageEvent<ExportWorkerRequest>) => void,
    ): void;
  },
  options: Omit<ExportWorkerHandlerOptions, "postMessage"> = {},
): void {
  const handle = createExportWorkerHandler({
    postMessage: (event) => scope.postMessage(event),
    ...options,
  });
  scope.addEventListener("message", (event) => {
    void handle(event.data);
  });
}
