import { parseScene, type Scene } from "@dojo-video-engine/schema";
import {
  BoundedTextMeasureCache,
  preflightCanvas2D,
  prepareFrame,
  renderStill,
  type ResolvedAssets,
} from "@dojo-video-engine/renderer-canvas2d";
import {
  createCanvas2DSceneRuntime,
  withCanvas2DResolvedAssets,
} from "@dojo-video-engine/renderer-canvas2d/runtime";
import {
  dojoVideoEnginePreviewWorkerSceneBlockers,
  previewAbortError,
  type DojoVideoEnginePreviewWorkerRequest,
  type DojoVideoEnginePreviewWorkerResponse,
} from "./preview-worker-protocol";

/** Metadata is only an eligibility hint; actual track inspection owns silence. */
export function assertDojoVideoEnginePreviewWorkerSilence(
  scene: Scene,
  assets: Pick<ResolvedAssets, "videos">,
): void {
  const nodes = [...scene.nodes];
  while (nodes.length) {
    const node = nodes.pop()!;
    if (
      node.type === "audio" ||
      (node.type === "video" &&
        node.volume !== 0 &&
        assets.videos.get(node.assetId ?? "")?.audio)
    )
      throw new Error(
        "Resolved media contains audio and requires main-thread preview.",
      );
    nodes.push(...(node.children ?? []));
  }
}

export type DojoVideoEnginePreviewWorkerRenderer = {
  renderFrame(frame: number, signal: AbortSignal): Promise<ImageBitmap>;
  updateScene(
    scene: Scene,
    size: { width: number; height: number },
    signal: AbortSignal,
  ): Promise<void>;
  disposeAsync(): Promise<void>;
};

type HandlerOptions = {
  postMessage(
    message: DojoVideoEnginePreviewWorkerResponse,
    transfer?: Transferable[],
  ): void;
  /** Test seam; production resolves and renders real worker-owned media. */
  createRenderer?: (
    scene: Scene,
    size: { width: number; height: number },
    signal: AbortSignal,
  ) => Promise<DojoVideoEnginePreviewWorkerRenderer>;
};

/** One worker owns one reusable media runtime and at most one queued frame. */
export function createDojoVideoEnginePreviewWorkerHandler(options: HandlerOptions) {
  let renderer: DojoVideoEnginePreviewWorkerRenderer | null = null;
  let scene: Scene | null = null;
  let disposed = false;
  let initialized = false;
  let revision = -1;
  const lifecycle = new AbortController();
  let configuration: {
    id: number;
    controller: AbortController;
    task: Promise<void>;
  } | null = null;
  let active: {
    id: number;
    controller: AbortController;
    task: Promise<void>;
  } | null = null;
  let pending: Extract<
    DojoVideoEnginePreviewWorkerRequest,
    { type: "render" }
  > | null = null;

  const reply = (
    response: DojoVideoEnginePreviewWorkerResponse,
    transfer?: Transferable[],
  ) => {
    if (!disposed) options.postMessage(response, transfer);
  };
  const errorReply = (requestId: number, error: unknown) => {
    const normalized =
      error instanceof Error ? error : new Error(String(error));
    reply({
      type: "error",
      requestId,
      name: normalized.name,
      message: normalized.message,
    });
  };

  const startRender = (
    request: Extract<DojoVideoEnginePreviewWorkerRequest, { type: "render" }>,
  ): Promise<void> => {
    const controller = new AbortController();
    const operation = {
      id: request.requestId,
      controller,
      task: Promise.resolve(),
    };
    active = operation;
    operation.task = (async () => {
      let bitmap: ImageBitmap | null = null;
      try {
        if (!renderer || !scene || configuration)
          throw new Error("Worker preview is not ready.");
        if (request.revision !== revision)
          throw new Error("Worker preview scene revision is stale.");
        if (
          !Number.isInteger(request.frame) ||
          request.frame < 0 ||
          request.frame >= scene.duration
        )
          throw new RangeError("Worker preview frame is outside the scene.");
        bitmap = await renderer.renderFrame(request.frame, controller.signal);
        if (disposed || controller.signal.aborted) {
          reply({ type: "cancelled", requestId: request.requestId });
        } else {
          reply(
            {
              type: "frame",
              requestId: request.requestId,
              revision,
              frame: request.frame,
              bitmap,
            },
            [bitmap],
          );
          // Ownership moved to the host. Closing it here would close the transfer.
          bitmap = null;
        }
      } catch (error) {
        if (controller.signal.aborted)
          reply({ type: "cancelled", requestId: request.requestId });
        else errorReply(request.requestId, error);
      } finally {
        bitmap?.close();
        if (active === operation) active = null;
        const next = pending;
        pending = null;
        if (next && !disposed) void startRender(next);
      }
    })();
    return operation.task;
  };

  return async function handle(input: unknown): Promise<void> {
    if (!input || typeof input !== "object") return;
    const request = input as DojoVideoEnginePreviewWorkerRequest;
    if (request.type === "dispose") {
      if (disposed) return;
      disposed = true;
      lifecycle.abort(previewAbortError("Worker preview was disposed."));
      configuration?.controller.abort(
        previewAbortError("Worker preview was disposed."),
      );
      active?.controller.abort(
        previewAbortError("Worker preview was disposed."),
      );
      pending = null;
      await configuration?.task;
      await active?.task;
      await renderer?.disposeAsync();
      renderer = null;
      return;
    }
    if (
      disposed ||
      !Number.isSafeInteger(request.requestId) ||
      request.requestId < 1
    )
      return;
    if (request.type === "cancel") {
      if (configuration?.id === request.requestId)
        configuration.controller.abort(
          previewAbortError("Worker preview preparation was cancelled."),
        );
      if (active?.id === request.requestId)
        active.controller.abort(
          previewAbortError("Worker preview frame was cancelled."),
        );
      if (pending?.requestId === request.requestId) {
        pending = null;
        reply({ type: "cancelled", requestId: request.requestId });
      }
      return;
    }
    if (request.type === "init" || request.type === "update") {
      if (
        configuration ||
        (request.type === "init" ? initialized : !renderer)
      ) {
        errorReply(
          request.requestId,
          new Error("Worker preview cannot accept this scene update."),
        );
        return;
      }
      initialized = true;
      const controller = new AbortController();
      const operation = {
        id: request.requestId,
        controller,
        task: Promise.resolve(),
      };
      configuration = operation;
      operation.task = (async () => {
        try {
          if (
            !Number.isSafeInteger(request.revision) ||
            request.revision <= revision
          )
            throw new Error("Worker preview scene revision is stale.");
          const nextScene = parseScene(request.scene);
          const blockers = dojoVideoEnginePreviewWorkerSceneBlockers(nextScene);
          if (blockers.length)
            throw new Error(
              `Scene requires main-thread preview: ${blockers.join(", ")}.`,
            );
          if (
            !Number.isInteger(request.width) ||
            !Number.isInteger(request.height) ||
            request.width <= 0 ||
            request.height <= 0 ||
            request.width > nextScene.width ||
            request.height > nextScene.height
          )
            throw new Error(
              "Worker preview dimensions must be within the scene bounds.",
            );
          if (pending) {
            reply({ type: "cancelled", requestId: pending.requestId });
            pending = null;
          }
          if (active) {
            active.controller.abort(
              previewAbortError("Worker preview scene changed."),
            );
            await active.task;
          }
          if (controller.signal.aborted) throw controller.signal.reason;
          const size = { width: request.width, height: request.height };
          if (request.type === "init") {
            renderer = await (options.createRenderer ?? createWorkerRenderer)(
              nextScene,
              size,
              lifecycle.signal,
            );
          } else {
            await renderer!.updateScene(nextScene, size, controller.signal);
          }
          if (controller.signal.aborted) throw controller.signal.reason;
          scene = nextScene;
          revision = request.revision;
          reply({ type: "ready", requestId: request.requestId, revision });
        } catch (error) {
          errorReply(request.requestId, error);
        } finally {
          if (configuration === operation) configuration = null;
        }
      })();
      await operation.task;
      return;
    }
    if (request.type === "render") {
      if (active) {
        if (pending) reply({ type: "cancelled", requestId: pending.requestId });
        pending = request;
      } else await startRender(request);
    }
  };
}

async function createWorkerRenderer(
  initialScene: Scene,
  initialSize: { width: number; height: number },
  signal: AbortSignal,
): Promise<DojoVideoEnginePreviewWorkerRenderer> {
  let scene = initialScene;
  let size = initialSize;
  const preflight = preflightCanvas2D(scene, globalThis, { worker: true });
  if (!preflight.ok)
    throw new Error(
      preflight.issues
        .filter((issue) => issue.severity === "error")
        .map((issue) => issue.message)
        .join(" "),
    );
  const canvas = new OffscreenCanvas(size.width, size.height);
  const context = canvas.getContext("2d");
  if (!context)
    throw new Error("Worker preview Canvas2D context is unavailable.");
  const runtime = await createCanvas2DSceneRuntime({
    scene,
    signal,
    resolve: { worker: true, preferProxy: true },
    // This adapter renders directly through a compatibility scope; the runtime's
    // ordinary full-resolution staging surface is never used by preview.
    createRenderCanvas: () => new OffscreenCanvas(1, 1),
  });
  try {
    await withCanvas2DResolvedAssets(
      runtime,
      ({ assets }) => {
        assertDojoVideoEnginePreviewWorkerSilence(scene, assets);
      },
      { signal },
    );
  } catch (error) {
    await runtime.disposeAsync().catch(() => undefined);
    throw error;
  }
  const textMeasureCache = new BoundedTextMeasureCache();
  return {
    updateScene: async (nextScene, nextSize, updateSignal) => {
      await runtime.updateScene(nextScene, {
        expectedRevision: runtime.revision,
        signal: updateSignal,
      });
      await withCanvas2DResolvedAssets(
        runtime,
        ({ assets }) => {
          assertDojoVideoEnginePreviewWorkerSilence(nextScene, assets);
        },
        { signal: updateSignal },
      );
      scene = nextScene;
      size = nextSize;
      if (canvas.width !== size.width) canvas.width = size.width;
      if (canvas.height !== size.height) canvas.height = size.height;
    },
    renderFrame: async (frame, frameSignal) => {
      let bitmap: ImageBitmap | undefined;
      try {
        return await withCanvas2DResolvedAssets(
          runtime,
          async ({
            assets,
            scratchSurfacePool,
            staticDisplayCache,
            signal: operationSignal,
          }) => {
            const resolvedScene = await prepareFrame(scene, frame, assets, {
              signal: operationSignal,
            });
            if (operationSignal.aborted)
              throw previewAbortError("Worker preview frame was cancelled.");
            // Scene coordinates, layout, and timings are unchanged by preview sizing.
            context.setTransform(
              size.width / scene.width,
              0,
              0,
              size.height / scene.height,
              0,
              0,
            );
            renderStill(context, scene, frame, {
              assets,
              resolvedScene,
              scratchSurfacePool,
              staticDisplayCache,
              textMeasureCache,
            });
            bitmap = canvas.transferToImageBitmap();
            return bitmap;
          },
          { signal: frameSignal },
        );
      } catch (error) {
        // A runtime abort can arrive between the callback and scope completion.
        bitmap?.close();
        throw error;
      }
    },
    disposeAsync: async () => {
      await runtime.disposeAsync();
      canvas.width = 1;
      canvas.height = 1;
    },
  };
}
