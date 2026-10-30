import {
  createPlayer as createStandalonePlayer,
  createPlayerFromRuntime,
  type Player,
  type RuntimePlayerOptions,
} from "@dojo-video-engine/player";
import {
  createCanvas2DSceneRuntime,
  withCanvas2DResolvedAssets,
  type Canvas2DSceneRuntime,
} from "@dojo-video-engine/renderer-canvas2d/runtime";
import {
  BoundedTextMeasureCache,
  prepareFrame,
  renderStill,
} from "@dojo-video-engine/renderer-canvas2d";
import type { Scene } from "@dojo-video-engine/schema";
import {
  DojoVideoEngineWorkerPreviewRenderer,
  planDojoVideoEngineWorkerPreview,
  type DojoVideoEngineWorkerPreviewOptions,
} from "./preview-worker-client";

type WorkerRenderer = Pick<
  DojoVideoEngineWorkerPreviewRenderer,
  "updateScene" | "renderFrame" | "dispose"
>;

type PreviewSessionDependencies = {
  createRuntime: typeof createCanvas2DSceneRuntime;
  createPlayer: typeof createPlayerFromRuntime;
  createStandalonePlayer?: typeof createStandalonePlayer;
  createWorkerRenderer?: (
    scene: Scene,
    context: RuntimePlayerOptions["context"],
    options: DojoVideoEngineWorkerPreviewOptions,
  ) => Promise<WorkerRenderer>;
  canUseWorker?: (scene: Scene) => boolean;
};

/**
 * One canvas owns one prepared runtime. Small edits reuse decoded assets;
 * superseded players finish disposal before another revision borrows them.
 * Audio uses the engine's chunked mixer, so no stale whole-scene mix is cached.
 */
export class DojoVideoEnginePreviewSession {
  private runtime: Canvas2DSceneRuntime | null = null;
  private runtimeScene: Scene | null = null;
  private workerRenderer: WorkerRenderer | null = null;
  private workerDisabled = false;
  private renderOperations = new Set<Promise<void>>();
  private readonly fallbackTextCache = new BoundedTextMeasureCache();
  private player: Player | null = null;
  private controller: AbortController | null = null;
  private queue: Promise<unknown> = Promise.resolve();
  private closed = false;
  private disposal: Promise<void> | null = null;
  private sceneReleases = new Set<() => void>();

  constructor(
    private readonly options: Omit<RuntimePlayerOptions, "signal">,
    private readonly dependencies: PreviewSessionDependencies = {
      createRuntime: createCanvas2DSceneRuntime,
      createPlayer: createPlayerFromRuntime,
    },
  ) {}

  setScene(scene: Scene, releaseScene?: () => void): Promise<Player | null> {
    if (this.closed) {
      releaseScene?.();
      return Promise.reject(new Error("Preview session is disposed."));
    }
    this.cancelPending();
    const controller = new AbortController();
    this.controller = controller;
    const previous = this.player;
    this.player = null;
    const operation = this.queue
      .catch(() => undefined)
      .then(async () => {
        await previous?.disposeAsync();
        // Player cancellation can win a race before an asynchronous renderer
        // releases its resources. Drain that work before updating its scene.
        await Promise.allSettled(this.renderOperations);
        if (controller.signal.aborted || this.closed) {
          releaseScene?.();
          return null;
        }
        if (releaseScene) this.sceneReleases.add(releaseScene);
        const releaseSupersededScenes = () => {
          for (const release of this.sceneReleases)
            if (release !== releaseScene) {
              this.sceneReleases.delete(release);
              release();
            }
        };
        try {
          let player: Player;
          if (await this.prepareWorker(scene, controller.signal)) {
            releaseSupersededScenes();
            player = await (
              this.dependencies.createStandalonePlayer ?? createStandalonePlayer
            )({
              ...this.options,
              scene,
              audio: false,
              signal: controller.signal,
              renderFrame: (frame, signal) =>
                this.renderWorkerFrame(scene, frame, signal),
            });
          } else {
            this.disposeWorker();
            const runtime = await this.ensureMainRuntime(
              scene,
              controller.signal,
            );
            releaseSupersededScenes();
            if (controller.signal.aborted || this.closed) return null;
            const canvas = this.options.context.canvas;
            if (canvas)
              this.options.context.setTransform(
                canvas.width / scene.width,
                0,
                0,
                canvas.height / scene.height,
                0,
                0,
              );
            player = await this.dependencies.createPlayer(runtime, {
              ...this.options,
              signal: controller.signal,
            });
          }
          if (controller.signal.aborted || this.closed) {
            await player.disposeAsync();
            return null;
          }
          this.player = player;
          return player;
        } catch (error) {
          if (controller.signal.aborted || this.closed) return null;
          throw error;
        }
      });
    this.queue = operation;
    return operation;
  }

  private async prepareWorker(
    scene: Scene,
    signal: AbortSignal,
  ): Promise<boolean> {
    if (
      this.workerDisabled ||
      this.options.audio ||
      !(
        this.dependencies.canUseWorker ??
        ((value) => planDojoVideoEngineWorkerPreview(value).eligible)
      )(scene)
    )
      return false;
    // Never retain a second decoder set when moving from the main renderer.
    if (this.runtime) {
      await this.runtime.disposeAsync();
      this.runtime = null;
      this.runtimeScene = null;
    }
    if (signal.aborted || this.closed) throw signal.reason;
    const canvas = this.options.context.canvas;
    const dimensions = {
      width: canvas?.width || scene.width,
      height: canvas?.height || scene.height,
      signal,
    };
    try {
      if (this.workerRenderer)
        await this.workerRenderer.updateScene(scene, dimensions);
      else
        this.workerRenderer = await (
          this.dependencies.createWorkerRenderer ??
          DojoVideoEngineWorkerPreviewRenderer.create
        )(scene, this.options.context, dimensions);
      if (signal.aborted || this.closed) {
        this.disposeWorker();
        throw signal.reason;
      }
      return true;
    } catch (error) {
      this.disposeWorker();
      if (signal.aborted || this.closed) throw error;
      // A compatibility/load failure should not retry the same broken worker
      // on every edit. This session continues on the established renderer.
      this.workerDisabled = true;
      return false;
    }
  }

  private async ensureMainRuntime(
    scene: Scene,
    signal: AbortSignal,
  ): Promise<Canvas2DSceneRuntime> {
    if (signal.aborted || this.closed) throw signal.reason;
    if (!this.runtime) {
      this.runtime = await this.dependencies.createRuntime({
        scene,
        signal,
        resolve: { preferProxy: true, videoProxyAudio: "original" },
        // This session borrows media and paints directly into its host context;
        // it never uses the runtime's separate full-scene render surface.
        createRenderCanvas: () => {
          if (typeof OffscreenCanvas !== "undefined")
            return new OffscreenCanvas(1, 1);
          const canvas = (
            this.options.context.canvas as HTMLCanvasElement
          ).ownerDocument.createElement("canvas");
          canvas.width = 1;
          canvas.height = 1;
          return canvas;
        },
      });
    } else if (this.runtimeScene !== scene) {
      await this.runtime.updateScene(scene, {
        expectedRevision: this.runtime.revision,
        signal,
      });
    }
    this.runtimeScene = scene;
    return this.runtime;
  }

  private renderWorkerFrame(
    scene: Scene,
    frame: number,
    signal: AbortSignal,
  ): Promise<void> {
    const operation = this.renderWorkerOrFallback(scene, frame, signal);
    this.renderOperations.add(operation);
    void operation
      .finally(() => this.renderOperations.delete(operation))
      .catch(() => {});
    return operation;
  }

  private async renderWorkerOrFallback(
    scene: Scene,
    frame: number,
    signal: AbortSignal,
  ): Promise<void> {
    if (this.workerRenderer && !this.workerDisabled) {
      try {
        await this.workerRenderer.renderFrame(frame, signal);
        return;
      } catch (error) {
        if (signal.aborted || this.closed) throw error;
        this.workerDisabled = true;
        this.disposeWorker();
      }
    }
    if (signal.aborted || this.closed) throw signal.reason;
    const runtime = await this.ensureMainRuntime(scene, signal);
    if (signal.aborted || this.closed) throw signal.reason;
    await withCanvas2DResolvedAssets(
      runtime,
      async ({
        assets,
        scratchSurfacePool,
        staticDisplayCache,
        signal: runtimeSignal,
      }) => {
        const resolvedScene = await prepareFrame(scene, frame, assets, {
          signal: runtimeSignal,
        });
        if (runtimeSignal.aborted || signal.aborted || this.closed)
          throw runtimeSignal.reason ?? signal.reason;
        const context = this.options.context;
        context.save();
        try {
          // Worker bitmap presentation can reset the canvas state. Reestablish
          // authored coordinates without changing the preview backing pixels.
          context.setTransform(
            context.canvas.width / scene.width,
            0,
            0,
            context.canvas.height / scene.height,
            0,
            0,
          );
          renderStill(context, scene, frame, {
            assets,
            resolvedScene,
            textMeasureCache: this.fallbackTextCache,
            scratchSurfacePool,
            staticDisplayCache,
          });
        } finally {
          context.restore();
        }
      },
      { signal },
    );
  }

  private disposeWorker(): void {
    this.workerRenderer?.dispose();
    this.workerRenderer = null;
  }

  cancelPending(): void {
    this.player?.dispose();
    this.controller?.abort(
      new DOMException("Preview superseded.", "AbortError"),
    );
  }

  disposeAsync(): Promise<void> {
    if (this.disposal) return this.disposal;
    this.closed = true;
    this.cancelPending();
    this.disposal = (async () => {
      await this.queue.catch(() => undefined);
      await this.player?.disposeAsync();
      this.player = null;
      await Promise.allSettled(this.renderOperations);
      this.disposeWorker();
      try {
        await this.runtime?.disposeAsync();
      } finally {
        this.runtime = null;
        this.runtimeScene = null;
        for (const release of this.sceneReleases) release();
        this.sceneReleases.clear();
      }
    })();
    return this.disposal;
  }
}
