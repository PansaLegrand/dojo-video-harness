import type {
  MediaMetrics,
  MediaMetricsProvider,
  TextMetricsProvider,
} from "@motionforge/core";
import type { Scene, SceneAsset } from "@motionforge/schema";
import {
  createSceneRuntime,
  type PreparedSceneSession,
  type RuntimeEventListener,
} from "@motionforge/runtime";
import type {
  BackendResourceUpdateSummary,
  BackendUpdateTransaction,
  PreparedSceneBackend,
} from "@motionforge/runtime";
import {
  collectReachableAssetIds,
  BoundedTextMeasureCache,
  Canvas2DStaticDisplayCache,
  disposeAssetsAsync,
  prepareFrame,
  preflightCanvas2D,
  renderStill,
  resolveAssets,
  type ResolvedAssets,
  type ResolveAssetsOptions,
  type TextMeasureCache,
} from "./index";
import type { ResolvedScene } from "@motionforge/core";
import {
  ScratchSurfacePool,
  checkedRgbaBytes,
  type ScratchSurfaceFactory,
} from "./surface-pool";

export type Canvas2DRenderTarget =
  | CanvasRenderingContext2D
  | OffscreenCanvasRenderingContext2D;

type CanvasSurface = HTMLCanvasElement | OffscreenCanvas;

export type Canvas2DPreparedState = {
  readonly assets: ResolvedAssets;
  /** Revision-owned render scratch, or an explicitly borrowed host pool. */
  readonly scratchSurfacePool: ScratchSurfacePool;
  readonly ownsScratchSurfacePool: boolean;
  /** Revision-owned cache, or an explicitly borrowed host cache. */
  readonly staticDisplayCache: Canvas2DStaticDisplayCache;
  ownsStaticDisplayCache: boolean;
  textMeasureCaches: WeakMap<object, TextMeasureCache>;
  disposed: boolean;
  artifactSurface?: CanvasSurface;
  artifactContext?: Canvas2DRenderTarget;
  renderSurface?: CanvasSurface;
  renderContext?: Canvas2DRenderTarget;
  preparedGeneration: number;
  textMetrics?: TextMetricsProvider;
};

export type Canvas2DPreparedFrame = {
  resolvedScene: ResolvedScene;
  generation: number;
};

export type Canvas2DRuntimeBackendOptions = {
  resolve?: Omit<ResolveAssetsOptions, "signal" | "reuseFrom">;
  globalObject?: Partial<typeof globalThis>;
  textMetrics?: TextMetricsProvider;
  textMetricsFactory?: (context: {
    scene: Scene;
    assets: ResolvedAssets;
  }) => TextMetricsProvider;
  artifactMimeTypes?: string[];
  createArtifactCanvas?: (width: number, height: number) => CanvasSurface;
  createRenderCanvas?: (width: number, height: number) => CanvasSurface;
  /** Host-owned pool shared by every prepared revision; MotionForge never disposes it. */
  scratchSurfacePool?: ScratchSurfacePool;
  /** Policy used to create one runtime-owned pool per prepared revision. */
  scratchSurfacePoolPolicy?: Readonly<{
    createCanvas?: ScratchSurfaceFactory;
    maxBytes?: number;
    maxSurfaces?: number;
    maxDimension?: number;
  }>;
  /** Host-owned cache shared across revisions; MotionForge never disposes it. */
  staticDisplayCache?: Canvas2DStaticDisplayCache;
  /** Policy used to create one runtime-owned cache per prepared revision. */
  staticDisplayCachePolicy?: Readonly<{
    maxBytes?: number;
    maxEntries?: number;
    maxKeyBytes?: number;
    maxDimension?: number;
  }>;
};

export type Canvas2DSceneRuntime = PreparedSceneSession<
  Canvas2DPreparedState,
  Canvas2DPreparedFrame,
  Canvas2DRenderTarget
>;

export type CreateCanvas2DSceneRuntimeOptions =
  Canvas2DRuntimeBackendOptions & {
    scene: unknown;
    signal?: AbortSignal;
    sessionId?: string;
    onEvent?: RuntimeEventListener;
  };

/** Convenience assembly; the base runtime package remains renderer-neutral. */
export async function createCanvas2DSceneRuntime(
  options: CreateCanvas2DSceneRuntimeOptions,
): Promise<Canvas2DSceneRuntime> {
  const { scene, signal, sessionId, onEvent, ...backendOptions } = options;
  return await createSceneRuntime({
    scene,
    signal,
    sessionId,
    onEvent,
    backend: createCanvas2DRuntimeBackend(backendOptions),
  });
}

/** Serialized compatibility scope for existing player/export `assets` options. */
export function withCanvas2DResolvedAssets<Result>(
  runtime: Canvas2DSceneRuntime,
  callback: (context: {
    assets: ResolvedAssets;
    scratchSurfacePool: ScratchSurfacePool;
    staticDisplayCache: Canvas2DStaticDisplayCache;
    scene: Scene;
    signal: AbortSignal;
  }) => Result | Promise<Result>,
  options: { signal?: AbortSignal } = {},
): Promise<Result> {
  return runtime.useBackendState(
    "canvas2d",
    async ({ state, scene, signal }) => {
      // Legacy prepareFrame mutates staging maps outside the adapter, so every
      // compatibility scope invalidates older Canvas prepared tokens.
      state.preparedGeneration += 1;
      try {
        return await callback({
          assets: state.assets,
          scratchSurfacePool: state.scratchSurfacePool,
          staticDisplayCache: state.staticDisplayCache,
          scene,
          signal,
        });
      } finally {
        state.preparedGeneration += 1;
      }
    },
    options,
  );
}

export function createCanvas2DRuntimeBackend(
  options: Canvas2DRuntimeBackendOptions = {},
): PreparedSceneBackend<
  Canvas2DPreparedState,
  Canvas2DPreparedFrame,
  Canvas2DRenderTarget
> {
  if (options.scratchSurfacePool && options.scratchSurfacePoolPolicy) {
    throw new Error(
      "Canvas2D runtime accepts either scratchSurfacePool or scratchSurfacePoolPolicy, not both.",
    );
  }
  if (options.staticDisplayCache && options.staticDisplayCachePolicy) {
    throw new Error(
      "Canvas2D runtime accepts either staticDisplayCache or staticDisplayCachePolicy, not both.",
    );
  }
  const globalObject = options.globalObject ?? globalThis;
  const mimeTypes = Array.from(
    new Set(options.artifactMimeTypes ?? ["image/png"]),
  ).sort(compareCodeUnits);
  const supportedArtifactMimeTypes = new Set([
    "image/png",
    "image/jpeg",
    "image/webp",
  ]);
  if (
    mimeTypes.length === 0 ||
    mimeTypes.some((mimeType) => !supportedArtifactMimeTypes.has(mimeType))
  ) {
    throw new Error(
      "Canvas2D artifactMimeTypes must contain PNG, JPEG, or WebP MIME types.",
    );
  }
  const frameImageMimeTypes = canCreateArtifactSurface(options, globalObject)
    ? mimeTypes
    : [];
  const backend: PreparedSceneBackend<
    Canvas2DPreparedState,
    Canvas2DPreparedFrame,
    Canvas2DRenderTarget
  > = {
    id: "canvas2d",
    capabilities: {
      renderFrames: true,
      frameImageMimeTypes,
      audioResources: true,
      worker: typeof globalObject.OffscreenCanvas === "function",
    },
    preflight: (scene) => {
      const customContext = probeCustomRenderContext(scene, options);
      const result = preflightCanvas2D(scene, globalObject, {
        extensions: options.resolve?.extensions,
        worker: options.resolve?.worker,
        budget: options.resolve?.budget,
        opaqueExtensionRegistry: options.resolve?.opaqueExtensionRegistry,
      });
      const issues = result.issues.filter((issue) => {
        if (!customContext) return true;
        if (issue.code === "canvas_unavailable") return false;
        if (issue.code === "filter_unavailable") {
          return !("filter" in customContext);
        }
        if (issue.code === "conic_gradient_unavailable") {
          return typeof customContext.createConicGradient !== "function";
        }
        if (issue.code === "letter_spacing_unavailable") {
          return !("letterSpacing" in customContext);
        }
        return true;
      });
      return {
        ok: !issues.some((issue) => issue.severity === "error"),
        issues: issues.map((issue) => ({
          severity: issue.severity,
          code: issue.code,
          message: issue.message,
        })),
        capabilities: backend.capabilities,
      };
    },
    prepare: async (scene, context) => {
      const assets = await resolveAssets(scene, {
        ...options.resolve,
        signal: context.signal,
      });
      let scratch: { pool: ScratchSurfacePool; owned: boolean } | undefined;
      let staticCache:
        | { cache: Canvas2DStaticDisplayCache; owned: boolean }
        | undefined;
      try {
        scratch = createRuntimeScratchSurfacePool(scene, options, globalObject);
        staticCache = createRuntimeStaticDisplayCache(options);
        return {
          assets,
          scratchSurfacePool: scratch.pool,
          ownsScratchSurfacePool: scratch.owned,
          staticDisplayCache: staticCache.cache,
          ownsStaticDisplayCache: staticCache.owned,
          textMeasureCaches: new WeakMap(),
          disposed: false,
          preparedGeneration: 0,
          renderSurface: createRuntimeRenderCanvas(
            scene.width,
            scene.height,
            options,
            globalObject,
          ),
          textMetrics: resolveRuntimeTextProvider(options, scene, assets),
        };
      } catch (error) {
        if (staticCache?.owned) staticCache.cache.dispose();
        if (scratch?.owned) await scratch.pool.disposeAsync();
        await disposeAssetsAsync(assets);
        throw error;
      }
    },
    prepareUpdate: async (current, previousScene, nextScene, context) => {
      const candidateAssets = await resolveAssets(nextScene, {
        ...options.resolve,
        signal: context.signal,
        reuseFrom: { scene: previousScene, assets: current.assets },
      });
      let candidate: Canvas2DPreparedState;
      let scratch: { pool: ScratchSurfacePool; owned: boolean } | undefined;
      try {
        scratch = createRuntimeScratchSurfacePool(
          nextScene,
          options,
          globalObject,
        );
        candidate = {
          assets: candidateAssets,
          scratchSurfacePool: scratch.pool,
          ownsScratchSurfacePool: scratch.owned,
          staticDisplayCache: current.staticDisplayCache,
          // Ownership transfers only at commit. Rollback disposal must not
          // clear the cache still owned by the live current revision.
          ownsStaticDisplayCache: false,
          textMeasureCaches: new WeakMap(),
          disposed: false,
          preparedGeneration: 0,
          renderSurface: createRuntimeRenderCanvas(
            nextScene.width,
            nextScene.height,
            options,
            globalObject,
          ),
          textMetrics: resolveRuntimeTextProvider(
            options,
            nextScene,
            candidateAssets,
          ),
        };
      } catch (error) {
        if (scratch?.owned) await scratch.pool.disposeAsync();
        await disposeAssetsAsync(candidateAssets);
        throw error;
      }
      const summary = summarizeResourceUpdate(
        previousScene,
        nextScene,
        current.assets,
        candidate.assets,
      );
      let terminal: "commit" | "rollback" | undefined;
      return {
        summary,
        commit: () => {
          if (terminal) throw new Error(`Canvas2D update already ${terminal}.`);
          terminal = "commit";
          candidate.ownsStaticDisplayCache = current.ownsStaticDisplayCache;
          current.ownsStaticDisplayCache = false;
          return {
            session: candidate,
            cleanup: disposeState(current),
          };
        },
        rollback: async () => {
          if (terminal === "rollback") return;
          if (terminal === "commit") {
            throw new Error("Committed Canvas2D update cannot roll back.");
          }
          terminal = "rollback";
          await disposeState(candidate);
        },
      } satisfies BackendUpdateTransaction<Canvas2DPreparedState>;
    },
    prepareFrame: async (state, scene, frame, context) => {
      const resolvedScene = await prepareFrame(scene, frame, state.assets, {
        signal: context.signal,
      });
      state.preparedGeneration += 1;
      return { resolvedScene, generation: state.preparedGeneration };
    },
    renderFrame: (state, scene, frame, prepared, target) => {
      assertLatestPreparedFrame(state, prepared);
      renderToTarget(state, scene, frame, prepared, target);
    },
    encodeFrameImage: async (
      state,
      scene,
      frame,
      prepared,
      artifactOptions,
      operationContext,
    ) => {
      assertLatestPreparedFrame(state, prepared);
      const { surface, context: artifactContext } = ensureArtifactSurface(
        state,
        scene.width,
        scene.height,
        options,
        globalObject,
      );
      try {
        renderStill(artifactContext, scene, frame, {
          assets: state.assets,
          resolvedScene: prepared.resolvedScene,
          textMeasureCache: textMeasureCacheFor(state, artifactContext),
          scratchSurfacePool: state.scratchSurfacePool,
          staticDisplayCache: state.staticDisplayCache,
        });
      } catch (error) {
        state.artifactContext = undefined;
        surface.width = scene.width;
        surface.height = scene.height;
        throw error;
      }
      const blob = await canvasToBlob(
        surface,
        artifactOptions.mimeType,
        artifactOptions.quality,
        operationContext.signal,
      );
      if (blob.size > artifactOptions.maxBytes) {
        const error = new RangeError(
          `Canvas artifact is ${blob.size} bytes; maximum is ${artifactOptions.maxBytes}.`,
        );
        error.name = "ArtifactTooLargeError";
        throw error;
      }
      const bytes = new Uint8Array(
        await abortableArrayBuffer(blob, operationContext.signal),
      );
      return {
        width: scene.width,
        height: scene.height,
        mimeType: blob.type,
        colorSpace: "srgb",
        chunks: [bytes],
      };
    },
    metrics: (state) => ({
      ...(state.textMetrics ? { text: state.textMetrics } : {}),
      media: createResolvedMediaMetricsProvider(state.assets),
    }),
    dispose: disposeState,
  };
  return backend;
}

function renderToTarget(
  state: Canvas2DPreparedState,
  scene: Scene,
  frame: number,
  prepared: Canvas2DPreparedFrame,
  target: Canvas2DRenderTarget,
): void {
  const surface = state.renderSurface;
  if (!surface) throw new Error("Canvas2D runtime render surface is disposed.");
  surface.width = scene.width;
  surface.height = scene.height;
  const renderContext =
    state.renderContext ??
    (surface.getContext("2d") as Canvas2DRenderTarget | null);
  if (!renderContext) {
    throw new Error("Canvas2D runtime render context is unavailable.");
  }
  state.renderContext = renderContext;
  try {
    renderStill(renderContext, scene, frame, {
      assets: state.assets,
      resolvedScene: prepared.resolvedScene,
      textMeasureCache: textMeasureCacheFor(state, renderContext),
      scratchSurfacePool: state.scratchSurfacePool,
      staticDisplayCache: state.staticDisplayCache,
    });
  } catch (error) {
    state.renderContext = undefined;
    surface.width = scene.width;
    surface.height = scene.height;
    throw error;
  }
  target.save();
  try {
    if (typeof target.resetTransform === "function") target.resetTransform();
    else target.setTransform(1, 0, 0, 1, 0, 0);
    target.clearRect(0, 0, scene.width, scene.height);
    target.globalAlpha = 1;
    target.globalCompositeOperation = "source-over";
    target.filter = "none";
    target.shadowBlur = 0;
    target.shadowColor = "rgba(0, 0, 0, 0)";
    target.shadowOffsetX = 0;
    target.shadowOffsetY = 0;
    target.drawImage(surface, 0, 0);
  } finally {
    target.restore();
  }
}

export function createResolvedMediaMetricsProvider(
  assets: ResolvedAssets,
): MediaMetricsProvider {
  return {
    measure(asset: SceneAsset): MediaMetrics | undefined {
      const source = assets.resolvedSources?.get(asset.id);
      const reason = source
        ? `prepared Canvas2D ${source.usingProxy ? "proxy" : "primary"} resource`
        : "prepared Canvas2D resource";
      const fieldMeasurements = {
        width: { measurement: "exact" as const, reason },
        height: { measurement: "exact" as const, reason },
        durationSeconds: { measurement: "exact" as const, reason },
        frameRate: { measurement: "exact" as const, reason },
      };
      const image = assets.images.get(asset.id);
      if (image) {
        return {
          width: image.width,
          height: image.height,
          fieldMeasurements: {
            width: fieldMeasurements.width,
            height: fieldMeasurements.height,
          },
        };
      }
      const video = assets.videos.get(asset.id);
      if (video) {
        return {
          width: video.width,
          height: video.height,
          durationSeconds: video.duration,
          fieldMeasurements: {
            width: fieldMeasurements.width,
            height: fieldMeasurements.height,
            durationSeconds: fieldMeasurements.durationSeconds,
          },
        };
      }
      const audio = assets.audio.get(asset.id);
      if (audio) {
        return {
          durationSeconds: audio.duration,
          fieldMeasurements: {
            durationSeconds: fieldMeasurements.durationSeconds,
          },
        };
      }
      const lottie = assets.lotties.get(asset.id);
      if (lottie) {
        const frameRate = rationalFrameRate(lottie.fr);
        return {
          width: lottie.width,
          height: lottie.height,
          durationSeconds: (lottie.op - lottie.ip) / lottie.fr,
          frameRate,
          fieldMeasurements: {
            ...fieldMeasurements,
            frameRate: {
              measurement: "estimated",
              reason: `${reason}; rationalized from the Lottie decimal frame rate`,
            },
          },
        };
      }
      // Declared metadata is merged by core's resolveMediaMetrics().
      return undefined;
    },
  };
}

function summarizeResourceUpdate(
  previousScene: Scene,
  nextScene: Scene,
  previous: ResolvedAssets,
  next: ResolvedAssets,
): BackendResourceUpdateSummary {
  const previousExtensions = previous.extensionNodes ?? new Map();
  const nextExtensions = next.extensionNodes ?? new Map();
  const previousIds = collectReachableAssetIds(
    previousScene,
    Array.from(previousExtensions.values()),
  );
  const nextIds = collectReachableAssetIds(
    nextScene,
    Array.from(nextExtensions.values()),
  );
  const reused: string[] = [];
  const loaded: string[] = [];
  const replaced: string[] = [];
  const removed: string[] = [];
  for (const id of nextIds) {
    const priorValue = resolvedValue(previous, id);
    const nextValue = resolvedValue(next, id);
    if (priorValue !== undefined && priorValue === nextValue) reused.push(id);
    else if (previousIds.has(id)) replaced.push(id);
    else loaded.push(id);
  }
  for (const id of previousIds) {
    if (!nextIds.has(id)) removed.push(id);
  }
  for (const [nodeId, nextExtension] of nextExtensions) {
    const summaryId = `extension-node:${nodeId}`;
    const previousExtension = previousExtensions.get(nodeId);
    if (!previousExtension) {
      loaded.push(summaryId);
    } else if (
      previousExtension.definition === nextExtension.definition &&
      previousExtension.adapter === nextExtension.adapter &&
      previousExtension.resolvedAssets === nextExtension.resolvedAssets
    ) {
      reused.push(summaryId);
    } else {
      replaced.push(summaryId);
    }
  }
  for (const nodeId of previousExtensions.keys()) {
    if (!nextExtensions.has(nodeId)) removed.push(`extension-node:${nodeId}`);
  }
  return {
    reused: Array.from(new Set(reused)).sort(compareCodeUnits),
    loaded: Array.from(new Set(loaded)).sort(compareCodeUnits),
    replaced: Array.from(new Set(replaced)).sort(compareCodeUnits),
    removed: Array.from(new Set(removed)).sort(compareCodeUnits),
  };
}

function resolvedValue(assets: ResolvedAssets, id: string): unknown {
  return (
    assets.images.get(id) ??
    assets.fonts.get(id) ??
    assets.videos.get(id) ??
    assets.audio.get(id) ??
    assets.lotties.get(id)
  );
}

function resolveRuntimeTextProvider(
  options: Canvas2DRuntimeBackendOptions,
  scene: Scene,
  assets: ResolvedAssets,
): TextMetricsProvider | undefined {
  if (options.textMetricsFactory) {
    return options.textMetricsFactory({ scene, assets });
  }
  const provider = options.textMetrics as
    | (TextMetricsProvider & { clearCache?: () => void })
    | undefined;
  provider?.clearCache?.();
  return provider;
}

function assertLatestPreparedFrame(
  state: Canvas2DPreparedState,
  prepared: Canvas2DPreparedFrame,
): void {
  if (prepared.generation === state.preparedGeneration) return;
  const error = new Error(
    "Canvas2D prepared frame was superseded by a newer frame preparation.",
  );
  error.name = "StalePreparedFrameError";
  throw error;
}

async function disposeState(state: Canvas2DPreparedState): Promise<void> {
  if (state.disposed) return;
  state.disposed = true;
  let assetError: unknown;
  try {
    await disposeAssetsAsync(state.assets);
  } catch (error) {
    assetError = error;
  } finally {
    try {
      if (state.ownsScratchSurfacePool) {
        await state.scratchSurfacePool.disposeAsync();
      }
    } finally {
      if (state.ownsStaticDisplayCache) state.staticDisplayCache.dispose();
      (
        state.textMetrics as TextMetricsProvider & { clearCache?: () => void }
      )?.clearCache?.();
      state.textMetrics = undefined;
      state.textMeasureCaches = new WeakMap();
      state.artifactContext = undefined;
      state.artifactSurface = undefined;
      state.renderContext = undefined;
      // Canvas width reset discards any nested save stack retained by a failed draw.
      if (state.renderSurface) {
        state.renderSurface.width = 1;
        state.renderSurface.height = 1;
      }
      state.renderSurface = undefined;
    }
  }
  if (assetError !== undefined) throw assetError;
}

function textMeasureCacheFor(
  state: Canvas2DPreparedState,
  context: Canvas2DRenderTarget,
): TextMeasureCache {
  const key = context as unknown as object;
  let cache = state.textMeasureCaches.get(key);
  if (!cache) {
    cache = new BoundedTextMeasureCache();
    state.textMeasureCaches.set(key, cache);
  }
  return cache;
}

function ensureArtifactSurface(
  state: Canvas2DPreparedState,
  width: number,
  height: number,
  options: Canvas2DRuntimeBackendOptions,
  globalObject: Partial<typeof globalThis>,
): { surface: CanvasSurface; context: Canvas2DRenderTarget } {
  let surface = state.artifactSurface;
  if (!surface) {
    surface = options.createArtifactCanvas
      ? options.createArtifactCanvas(width, height)
      : defaultCanvas(width, height, globalObject);
    state.artifactSurface = surface;
  }
  surface.width = width;
  surface.height = height;
  const context =
    state.artifactContext ??
    (surface.getContext("2d") as Canvas2DRenderTarget | null);
  if (!context) throw new Error("Canvas2D artifact context is unavailable.");
  state.artifactContext = context;
  return { surface, context };
}

function defaultCanvas(
  width: number,
  height: number,
  globalObject: Partial<typeof globalThis>,
): CanvasSurface {
  if (typeof globalObject.OffscreenCanvas === "function") {
    return new globalObject.OffscreenCanvas(width, height);
  }
  const canvas = globalObject.document?.createElement?.("canvas");
  if (!canvas)
    throw new Error("Frame artifacts need a Canvas surface factory.");
  canvas.width = width;
  canvas.height = height;
  return canvas;
}

function createRuntimeRenderCanvas(
  width: number,
  height: number,
  options: Canvas2DRuntimeBackendOptions,
  globalObject: Partial<typeof globalThis>,
): CanvasSurface {
  return options.createRenderCanvas
    ? options.createRenderCanvas(width, height)
    : defaultCanvas(width, height, globalObject);
}

const DEFAULT_RUNTIME_SCRATCH_BYTES = 64 * 1024 * 1024;
const MAX_DEFAULT_RUNTIME_SCRATCH_BYTES = 512 * 1024 * 1024;
// Shadows, pixelation, and objectFit:none may legitimately stage beyond the
// composition edge. The byte ceiling remains the authoritative memory guard.
const DEFAULT_RUNTIME_SCRATCH_MAX_DIMENSION = 16_384;

function createRuntimeScratchSurfacePool(
  scene: Scene,
  options: Canvas2DRuntimeBackendOptions,
  globalObject: Partial<typeof globalThis>,
): { pool: ScratchSurfacePool; owned: boolean } {
  if (options.scratchSurfacePool) {
    if (options.scratchSurfacePool.stats().disposed) {
      throw new Error(
        "Canvas2D runtime scratchSurfacePool is already disposed.",
      );
    }
    return { pool: options.scratchSurfacePool, owned: false };
  }
  const policy = options.scratchSurfacePoolPolicy;
  const sceneBytes = checkedRgbaBytes(scene.width, scene.height);
  const createCanvas =
    policy?.createCanvas ??
    options.createRenderCanvas ??
    options.createArtifactCanvas ??
    ((width: number, height: number) =>
      defaultCanvas(width, height, globalObject));
  return {
    pool: new ScratchSurfacePool({
      createCanvas,
      maxBytes:
        policy?.maxBytes ??
        Math.min(
          MAX_DEFAULT_RUNTIME_SCRATCH_BYTES,
          Math.max(DEFAULT_RUNTIME_SCRATCH_BYTES, sceneBytes * 4),
        ),
      maxSurfaces: policy?.maxSurfaces ?? 32,
      maxDimension:
        policy?.maxDimension ??
        Math.max(
          DEFAULT_RUNTIME_SCRATCH_MAX_DIMENSION,
          scene.width,
          scene.height,
        ),
    }),
    owned: true,
  };
}

const DEFAULT_RUNTIME_STATIC_CACHE_BYTES = 128 * 1024 * 1024;

function createRuntimeStaticDisplayCache(
  options: Canvas2DRuntimeBackendOptions,
): { cache: Canvas2DStaticDisplayCache; owned: boolean } {
  if (options.staticDisplayCache) {
    if (options.staticDisplayCache.stats().disposed) {
      throw new Error(
        "Canvas2D runtime staticDisplayCache is already disposed.",
      );
    }
    return { cache: options.staticDisplayCache, owned: false };
  }
  const policy = options.staticDisplayCachePolicy;
  return {
    cache: new Canvas2DStaticDisplayCache({
      maxBytes: policy?.maxBytes ?? DEFAULT_RUNTIME_STATIC_CACHE_BYTES,
      maxEntries: policy?.maxEntries ?? 256,
      maxKeyBytes: policy?.maxKeyBytes ?? 1 * 1024 * 1024,
      maxDimension: policy?.maxDimension ?? 16_384,
    }),
    owned: true,
  };
}

function canCreateArtifactSurface(
  options: Canvas2DRuntimeBackendOptions,
  globalObject: Partial<typeof globalThis>,
): boolean {
  return Boolean(
    options.createArtifactCanvas ||
    typeof globalObject.OffscreenCanvas === "function" ||
    globalObject.document?.createElement,
  );
}

function probeCustomRenderContext(
  scene: Scene,
  options: Canvas2DRuntimeBackendOptions,
): Canvas2DRenderTarget | undefined {
  if (!options.createRenderCanvas) return undefined;
  let surface: CanvasSurface | undefined;
  try {
    surface = options.createRenderCanvas(scene.width, scene.height);
    return surface.getContext("2d") as Canvas2DRenderTarget | undefined;
  } catch {
    return undefined;
  } finally {
    if (surface) {
      surface.width = 1;
      surface.height = 1;
    }
  }
}

async function canvasToBlob(
  canvas: CanvasSurface,
  mimeType: string,
  quality?: number,
  signal?: AbortSignal,
): Promise<Blob> {
  if (signal?.aborted) throw abortReason(signal);
  if ("convertToBlob" in canvas) {
    return await awaitWithAbort(
      canvas.convertToBlob({ type: mimeType, quality }),
      signal,
    );
  }
  return await awaitWithAbort(
    new Promise<Blob>((resolve, reject) => {
      try {
        canvas.toBlob(
          (blob) =>
            blob
              ? resolve(blob)
              : reject(new Error("Canvas toBlob() returned null.")),
          mimeType,
          quality,
        );
      } catch (error) {
        reject(error);
      }
    }),
    signal,
  );
}

async function awaitWithAbort<T>(
  promise: Promise<T>,
  signal?: AbortSignal,
): Promise<T> {
  void promise.catch(() => undefined);
  if (!signal) return await promise;
  if (signal.aborted) throw abortReason(signal);
  let listener!: () => void;
  const aborted = new Promise<never>((_resolve, reject) => {
    listener = () => reject(abortReason(signal));
    signal.addEventListener("abort", listener, { once: true });
  });
  try {
    return await Promise.race([promise, aborted]);
  } finally {
    signal.removeEventListener("abort", listener);
    void promise.catch(() => undefined);
  }
}

function abortableArrayBuffer(
  blob: Blob,
  signal: AbortSignal,
): Promise<ArrayBuffer> {
  if (signal.aborted) return Promise.reject(abortReason(signal));
  return awaitWithAbort(blob.arrayBuffer(), signal);
}

function abortReason(signal: AbortSignal): Error {
  if (signal.reason instanceof Error) return signal.reason;
  const error = new Error("Canvas2D runtime operation aborted.");
  error.name = "AbortError";
  return error;
}

function rationalFrameRate(value: number): {
  numerator: number;
  denominator: number;
} {
  const denominator = 1_000;
  const numerator = Math.max(1, Math.round(value * denominator));
  const divisor = greatestCommonDivisor(numerator, denominator);
  return { numerator: numerator / divisor, denominator: denominator / divisor };
}

function greatestCommonDivisor(left: number, right: number): number {
  let a = Math.abs(left);
  let b = Math.abs(right);
  while (b !== 0) [a, b] = [b, a % b];
  return a || 1;
}

function compareCodeUnits(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}
