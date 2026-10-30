import type { Scene } from "@motionforge/schema";
import {
  createCanvas2DSceneRuntime,
  type Canvas2DRenderTarget,
  type Canvas2DSceneRuntime,
  type CreateCanvas2DSceneRuntimeOptions,
} from "@motionforge/renderer-canvas2d/runtime";
import type {
  ComparisonSheetPlan,
  EvidenceArtifactRef,
  EvidenceArtifactRenderer,
  EvidenceArtifactRequest,
  EvidenceArtifactSink,
  EvidenceArtifactSinkWriter,
  EvidenceError,
  EvidenceRenderContext,
  EvidenceRenderedArtifact,
  EvidenceSinkContext,
} from "./evidence";

type CanvasSurface = HTMLCanvasElement | OffscreenCanvas;
type RasterContext =
  | CanvasRenderingContext2D
  | OffscreenCanvasRenderingContext2D;

export type EvidenceCanvasFactory = (
  width: number,
  height: number,
) => CanvasSurface;

export type EvidenceRuntime = Pick<
  Canvas2DSceneRuntime,
  "renderFrame" | "disposeAsync"
>;

export type EvidenceRuntimeFactory = (
  options: CreateCanvas2DSceneRuntimeOptions,
) => Promise<EvidenceRuntime>;

export type Canvas2DEvidenceRendererOptions = {
  createCanvas?: EvidenceCanvasFactory;
  createRuntime?: EvidenceRuntimeFactory;
  encodeCanvas?: (
    canvas: CanvasSurface,
    options: {
      mimeType: "image/png" | "image/jpeg" | "image/webp";
      quality?: number;
      signal: AbortSignal;
    },
  ) => Promise<Uint8Array>;
  mimeType?: "image/png" | "image/jpeg" | "image/webp";
  quality?: number;
  maxDimension?: number;
  maxPixels?: number;
  maxBytes?: number;
  maxRasterBytes?: number;
  maxRasterSurfaces?: number;
  contactSheetCellWidth?: number;
  contactSheetCellHeight?: number;
  runtime?: Omit<CreateCanvas2DSceneRuntimeOptions, "scene" | "signal">;
};

export interface Canvas2DEvidenceRenderer extends EvidenceArtifactRenderer {
  /** Idempotent cleanup for failed/incomplete materializations. */
  dispose(): Promise<void>;
  stats(): {
    activeMaterializations: number;
    runtimesCreated: number;
    runtimesDisposed: number;
    peakRasterBytes: number;
    peakRasterSurfaces: number;
    disposed: boolean;
  };
}

type Raster = {
  canvas: CanvasSurface;
  context: RasterContext;
  width: number;
  height: number;
};

type MaterializationState = {
  id: number;
  plan: ComparisonSheetPlan;
  beforeScene: Scene;
  afterScene: Scene;
  beforeRuntime?: EvidenceRuntime;
  afterRuntime?: EvidenceRuntime;
  rasters: Map<string, Raster>;
  thumbnails: Map<string, Raster>;
  ownedRasters: Set<Raster>;
  rasterBytes: number;
  tail: Promise<void>;
  controller: AbortController;
  disposed: boolean;
  disposePromise?: Promise<void>;
  abortListener?: () => void;
};

/** Prepared Canvas2D evidence renderer; workflow results receive only bytes/refs. */
export function createCanvas2DEvidenceRenderer(
  options: Canvas2DEvidenceRendererOptions = {},
): Canvas2DEvidenceRenderer {
  const createCanvas = options.createCanvas ?? defaultCanvasFactory;
  const createRuntime = options.createRuntime ?? createCanvas2DSceneRuntime;
  const encodeCanvas = options.encodeCanvas ?? defaultEncodeCanvas;
  const mimeType = options.mimeType ?? "image/png";
  const maxDimension = boundedInteger(
    options.maxDimension,
    8_192,
    1,
    16_384,
    "maxDimension",
  );
  const maxPixels = boundedInteger(
    options.maxPixels,
    64 * 1024 * 1024,
    1,
    128 * 1024 * 1024,
    "maxPixels",
  );
  const maxBytes = boundedInteger(
    options.maxBytes,
    16 * 1024 * 1024,
    1,
    64 * 1024 * 1024,
    "maxBytes",
  );
  const maxRasterBytes = boundedInteger(
    options.maxRasterBytes,
    128 * 1024 * 1024,
    1,
    512 * 1024 * 1024,
    "maxRasterBytes",
  );
  const maxRasterSurfaces = boundedInteger(
    options.maxRasterSurfaces,
    64,
    1,
    256,
    "maxRasterSurfaces",
  );
  const contactSheetCellWidth = boundedInteger(
    options.contactSheetCellWidth,
    Math.min(320, maxDimension),
    1,
    maxDimension,
    "contactSheetCellWidth",
  );
  const contactSheetCellHeight = boundedInteger(
    options.contactSheetCellHeight,
    Math.min(180, maxDimension),
    1,
    maxDimension,
    "contactSheetCellHeight",
  );
  if (
    options.quality !== undefined &&
    (!Number.isFinite(options.quality) ||
      options.quality < 0 ||
      options.quality > 1)
  ) {
    throw new RangeError("Canvas evidence quality must be between 0 and 1.");
  }

  const states = new WeakMap<ComparisonSheetPlan, MaterializationState>();
  const active = new Set<MaterializationState>();
  let nextStateId = 1;
  let runtimesCreated = 0;
  let runtimesDisposed = 0;
  let peakRasterBytes = 0;
  let peakRasterSurfaces = 0;
  let disposed = false;

  const disposeState = async (state: MaterializationState): Promise<void> => {
    if (state.disposePromise) return await state.disposePromise;
    state.disposed = true;
    state.controller.abort();
    if (state.abortListener) state.abortListener();
    active.delete(state);
    states.delete(state.plan);
    state.disposePromise = (async () => {
      const runtimes = [state.beforeRuntime, state.afterRuntime].filter(
        (runtime): runtime is EvidenceRuntime => runtime !== undefined,
      );
      const failures: unknown[] = [];
      for (const runtime of runtimes) {
        try {
          await runtime.disposeAsync();
          runtimesDisposed += 1;
        } catch (error) {
          failures.push(error);
        }
      }
      for (const raster of [...state.ownedRasters])
        releaseRaster(state, raster);
      state.rasters.clear();
      state.thumbnails.clear();
      if (failures.length > 0) {
        throw new AggregateError(
          failures,
          "Canvas evidence runtime disposal failed.",
        );
      }
    })();
    return await state.disposePromise;
  };

  const getState = (context: EvidenceRenderContext): MaterializationState => {
    if (disposed) throw new Error("Canvas evidence renderer is disposed.");
    const existing = states.get(context.plan);
    if (existing) return existing;
    const state: MaterializationState = {
      id: nextStateId++,
      plan: context.plan,
      beforeScene: context.before,
      afterScene: context.after,
      rasters: new Map(),
      thumbnails: new Map(),
      ownedRasters: new Set(),
      rasterBytes: 0,
      tail: Promise.resolve(),
      controller: new AbortController(),
      disposed: false,
    };
    const onAbort = () => {
      state.controller.abort(context.signal.reason);
      void disposeState(state).catch(() => undefined);
    };
    context.signal.addEventListener("abort", onAbort, { once: true });
    state.abortListener = () =>
      context.signal.removeEventListener("abort", onAbort);
    states.set(context.plan, state);
    active.add(state);
    return state;
  };

  const runtimeFor = async (
    state: MaterializationState,
    side: "before" | "after",
    signal: AbortSignal,
  ): Promise<EvidenceRuntime> => {
    const current =
      side === "before" ? state.beforeRuntime : state.afterRuntime;
    if (current) return current;
    throwIfAborted(signal);
    const scene = side === "before" ? state.beforeScene : state.afterScene;
    const creation = createRuntime({
      ...options.runtime,
      scene,
      signal,
      createRenderCanvas: createCanvas,
    });
    let runtime: EvidenceRuntime;
    try {
      runtime = await abortable(creation, signal);
    } catch (error) {
      if (signal.aborted) {
        creation
          .then(async (late) => {
            await late.disposeAsync();
            runtimesDisposed += 1;
          })
          .catch(() => undefined);
      }
      throw error;
    }
    runtimesCreated += 1;
    if (state.disposed || signal.aborted) {
      await runtime.disposeAsync();
      runtimesDisposed += 1;
      throw abortError();
    }
    if (side === "before") state.beforeRuntime = runtime;
    else state.afterRuntime = runtime;
    return runtime;
  };

  const allocateRaster = (
    state: MaterializationState,
    width: number,
    height: number,
  ): Raster => {
    assertDimensions(width, height, maxDimension, maxPixels);
    const bytes = width * height * 4;
    if (
      state.rasterBytes + bytes > maxRasterBytes ||
      state.ownedRasters.size + 1 > maxRasterSurfaces
    ) {
      throw new RangeError(
        `Canvas evidence raster residency exceeds ${maxRasterBytes} bytes or ${maxRasterSurfaces} surfaces.`,
      );
    }
    const raster = createRaster(createCanvas, width, height);
    state.ownedRasters.add(raster);
    state.rasterBytes += bytes;
    peakRasterBytes = Math.max(peakRasterBytes, state.rasterBytes);
    peakRasterSurfaces = Math.max(peakRasterSurfaces, state.ownedRasters.size);
    return raster;
  };

  const releaseRaster = (state: MaterializationState, raster: Raster) => {
    if (!state.ownedRasters.delete(raster)) return;
    state.rasterBytes -= raster.width * raster.height * 4;
    releaseCanvas(raster.canvas);
  };

  const retainThumbnail = (
    state: MaterializationState,
    id: string,
    source: Raster,
  ) => {
    const thumbnail = allocateRaster(
      state,
      contactSheetCellWidth,
      contactSheetCellHeight,
    );
    resetContext(
      thumbnail.context,
      contactSheetCellWidth,
      contactSheetCellHeight,
    );
    const scale = Math.min(
      contactSheetCellWidth / source.width,
      contactSheetCellHeight / source.height,
    );
    const width = Math.max(1, Math.round(source.width * scale));
    const height = Math.max(1, Math.round(source.height * scale));
    thumbnail.context.drawImage(
      source.canvas,
      Math.floor((contactSheetCellWidth - width) / 2),
      Math.floor((contactSheetCellHeight - height) / 2),
      width,
      height,
    );
    state.thumbnails.set(id, thumbnail);
  };

  const stillRaster = async (
    state: MaterializationState,
    id: string,
    side: "before" | "after",
    frame: number,
    signal: AbortSignal,
  ): Promise<Raster> => {
    const cached = state.rasters.get(id);
    if (cached) return cached;
    const scene = side === "before" ? state.beforeScene : state.afterScene;
    assertDimensions(scene.width, scene.height, maxDimension, maxPixels);
    if (!Number.isInteger(frame) || frame < 0 || frame >= scene.duration) {
      throw new RangeError(`${side} evidence frame ${frame} is out of range.`);
    }
    const raster = allocateRaster(state, scene.width, scene.height);
    const runtime = await runtimeFor(state, side, signal);
    try {
      await withContextIsolation(raster.context, () =>
        runtime.renderFrame(frame, raster.context as Canvas2DRenderTarget, {
          signal,
        }),
      );
      throwIfAborted(signal);
      state.rasters.set(id, raster);
      return raster;
    } catch (error) {
      releaseRaster(state, raster);
      throw error;
    }
  };

  const diffRaster = async (
    state: MaterializationState,
    request: Extract<EvidenceArtifactRequest, { kind: "visual-diff" }>,
    signal: AbortSignal,
  ): Promise<Raster> => {
    const cached = state.rasters.get(request.id);
    if (cached) return cached;
    const beforeSourceId =
      state.plan.artifacts.find(
        (artifact) =>
          artifact.kind === "still" &&
          artifact.side === "before" &&
          artifact.frame === request.beforeFrame,
      )?.id ?? `${request.id}:before-source`;
    const afterSourceId =
      state.plan.artifacts.find(
        (artifact) =>
          artifact.kind === "still" &&
          artifact.side === "after" &&
          artifact.frame === request.afterFrame,
      )?.id ?? `${request.id}:after-source`;
    const before = await stillRaster(
      state,
      beforeSourceId,
      "before",
      request.beforeFrame,
      signal,
    );
    const after = await stillRaster(
      state,
      afterSourceId,
      "after",
      request.afterFrame,
      signal,
    );
    const width = Math.max(before.width, after.width);
    const height = Math.max(before.height, after.height);
    assertDimensions(width, height, maxDimension, maxPixels);
    const output = allocateRaster(state, width, height);
    try {
      const beforePixels = paddedRgba(before, width, height);
      const afterPixels = paddedRgba(after, width, height);
      const image = output.context.createImageData(width, height);
      for (let index = 0; index < image.data.length; index += 4) {
        const alphaDifference = Math.abs(
          afterPixels[index + 3]! - beforePixels[index + 3]!,
        );
        image.data[index] = Math.max(
          alphaDifference,
          Math.abs(afterPixels[index]! - beforePixels[index]!),
        );
        image.data[index + 1] = Math.max(
          alphaDifference,
          Math.abs(afterPixels[index + 1]! - beforePixels[index + 1]!),
        );
        image.data[index + 2] = Math.max(
          alphaDifference,
          Math.abs(afterPixels[index + 2]! - beforePixels[index + 2]!),
        );
        // This is explicitly an opaque visual-diff image, not raw RGBA data.
        image.data[index + 3] = 255;
      }
      output.context.putImageData(image, 0, 0);
      state.rasters.set(request.id, output);
      return output;
    } catch (error) {
      releaseRaster(state, output);
      throw error;
    }
  };

  const rasterForRequest = async (
    state: MaterializationState,
    request: EvidenceArtifactRequest,
    signal: AbortSignal,
  ): Promise<Raster> => {
    if (request.kind === "still") {
      return await stillRaster(
        state,
        request.id,
        request.side,
        request.frame,
        signal,
      );
    }
    if (request.kind === "visual-diff") {
      return await diffRaster(state, request, signal);
    }
    const cellWidth = contactSheetCellWidth;
    const cellHeight = contactSheetCellHeight;
    const width = request.columns * cellWidth;
    const height = request.rowIds.length * cellHeight;
    assertDimensions(width, height, maxDimension, maxPixels);
    const sheet = allocateRaster(state, width, height);
    try {
      await withContextIsolation(sheet.context, async () => {
        resetContext(sheet.context, width, height);
        for (const [rowIndex, rowId] of request.rowIds.entries()) {
          const row = state.plan.rows.find(
            (candidate) => candidate.id === rowId,
          );
          if (!row) throw new Error(`Unknown comparison row ${rowId}.`);
          const ids = [row.artifactIds.before, row.artifactIds.after];
          if (request.columns === 3) ids.push(row.artifactIds.visualDiff);
          for (const [column, artifactId] of ids.entries()) {
            if (!artifactId) continue;
            const planned = state.plan.artifacts.find(
              (artifact) => artifact.id === artifactId,
            );
            if (!planned || planned.kind === "contact-sheet") {
              throw new Error(`Missing planned artifact ${artifactId}.`);
            }
            let raster = state.thumbnails.get(artifactId);
            if (!raster) {
              const full = await rasterForRequest(state, planned, signal);
              retainThumbnail(state, artifactId, full);
              for (const source of new Set(state.rasters.values())) {
                releaseRaster(state, source);
              }
              state.rasters.clear();
              raster = state.thumbnails.get(artifactId);
            }
            if (!raster) {
              throw new Error(`Could not retain thumbnail ${artifactId}.`);
            }
            const x = column * cellWidth;
            const y = rowIndex * cellHeight;
            sheet.context.drawImage(raster.canvas, x, y, cellWidth, cellHeight);
          }
        }
      });
      return sheet;
    } catch (error) {
      releaseRaster(state, sheet);
      throw error;
    }
  };

  const render = async (
    request: EvidenceArtifactRequest,
    context: EvidenceRenderContext,
  ): Promise<EvidenceRenderedArtifact> => {
    const state = getState(context);
    const execute = async (): Promise<EvidenceRenderedArtifact> => {
      const signal = state.controller.signal;
      let terminalRaster: Raster | undefined;
      try {
        throwIfAborted(signal);
        const raster = await rasterForRequest(state, request, signal);
        if (request.kind === "contact-sheet") terminalRaster = raster;
        const bytes = await abortable(
          encodeCanvas(raster.canvas, {
            mimeType,
            ...(options.quality === undefined
              ? {}
              : { quality: options.quality }),
            signal,
          }),
          signal,
        );
        if (!(bytes instanceof Uint8Array)) {
          throw new TypeError(
            "Canvas evidence encoder must return Uint8Array.",
          );
        }
        if (bytes.byteLength > maxBytes) {
          throw new RangeError(
            `Canvas evidence artifact has ${bytes.byteLength} bytes; maximum is ${maxBytes}.`,
          );
        }
        if (request.kind !== "contact-sheet") {
          retainThumbnail(state, request.id, raster);
          for (const full of new Set(state.rasters.values())) {
            releaseRaster(state, full);
          }
          state.rasters.clear();
        }
        return {
          mimeType,
          width: raster.width,
          height: raster.height,
          bytes: new Uint8Array(bytes),
        };
      } catch (error) {
        await disposeState(state).catch(() => undefined);
        throw error;
      } finally {
        if (terminalRaster) releaseRaster(state, terminalRaster);
        if (request.kind === "contact-sheet") {
          await disposeState(state);
        }
      }
    };
    const task = state.tail.then(execute, execute);
    state.tail = task.then(
      () => undefined,
      () => undefined,
    );
    return await task;
  };

  return {
    render,
    async finalize(context) {
      const state = states.get(context.plan);
      if (state) await disposeState(state);
    },
    async dispose() {
      if (disposed) return;
      disposed = true;
      const failures: unknown[] = [];
      for (const state of [...active].sort(
        (left, right) => left.id - right.id,
      )) {
        try {
          state.controller.abort();
          await state.tail;
          await disposeState(state);
        } catch (error) {
          failures.push(error);
        }
      }
      if (failures.length > 0) {
        throw new AggregateError(failures, "Canvas evidence disposal failed.");
      }
    },
    stats() {
      return {
        activeMaterializations: active.size,
        runtimesCreated,
        runtimesDisposed,
        peakRasterBytes,
        peakRasterSurfaces,
        disposed,
      };
    },
  };
}

function createRaster(
  factory: EvidenceCanvasFactory,
  width: number,
  height: number,
): Raster {
  const canvas = factory(width, height);
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d", {
    willReadFrequently: true,
  }) as RasterContext | null;
  if (!context) throw new Error("Canvas2D evidence context is unavailable.");
  return { canvas, context, width, height };
}

function paddedRgba(
  raster: Raster,
  width: number,
  height: number,
): Uint8ClampedArray {
  if (raster.width === width && raster.height === height) {
    return raster.context.getImageData(0, 0, width, height).data;
  }
  const output = new Uint8ClampedArray(width * height * 4);
  const source = raster.context.getImageData(
    0,
    0,
    raster.width,
    raster.height,
  ).data;
  for (let y = 0; y < raster.height; y += 1) {
    output.set(
      source.subarray(y * raster.width * 4, (y + 1) * raster.width * 4),
      y * width * 4,
    );
  }
  return output;
}

async function withContextIsolation<T>(
  context: RasterContext,
  operation: () => T | Promise<T>,
): Promise<T> {
  context.save();
  try {
    return await operation();
  } finally {
    context.restore();
  }
}

function resetContext(context: RasterContext, width: number, height: number) {
  if (typeof context.resetTransform === "function") context.resetTransform();
  else context.setTransform(1, 0, 0, 1, 0, 0);
  context.globalAlpha = 1;
  context.globalCompositeOperation = "source-over";
  context.filter = "none";
  context.shadowBlur = 0;
  context.shadowColor = "rgba(0,0,0,0)";
  context.shadowOffsetX = 0;
  context.shadowOffsetY = 0;
  context.clearRect(0, 0, width, height);
}

function assertDimensions(
  width: number,
  height: number,
  maxDimension: number,
  maxPixels: number,
) {
  if (
    !Number.isInteger(width) ||
    !Number.isInteger(height) ||
    width < 1 ||
    height < 1 ||
    width > maxDimension ||
    height > maxDimension ||
    width * height > maxPixels
  ) {
    throw new RangeError(
      `Canvas evidence dimensions ${width}x${height} exceed configured bounds.`,
    );
  }
}

function defaultCanvasFactory(width: number, height: number): CanvasSurface {
  if (typeof OffscreenCanvas !== "undefined") {
    return new OffscreenCanvas(width, height);
  }
  if (typeof document !== "undefined") {
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    return canvas;
  }
  throw new Error(
    "Canvas evidence rendering needs OffscreenCanvas or document.",
  );
}

async function defaultEncodeCanvas(
  canvas: CanvasSurface,
  options: {
    mimeType: "image/png" | "image/jpeg" | "image/webp";
    quality?: number;
    signal: AbortSignal;
  },
): Promise<Uint8Array> {
  throwIfAborted(options.signal);
  let blob: Blob;
  if ("convertToBlob" in canvas) {
    blob = await abortable(
      canvas.convertToBlob({
        type: options.mimeType,
        ...(options.quality === undefined ? {} : { quality: options.quality }),
      }),
      options.signal,
    );
  } else {
    blob = await abortable(
      new Promise<Blob>((resolve, reject) => {
        canvas.toBlob(
          (value) =>
            value
              ? resolve(value)
              : reject(new Error("Canvas encoding failed.")),
          options.mimeType,
          options.quality,
        );
      }),
      options.signal,
    );
  }
  if (blob.type !== options.mimeType) {
    throw new Error(
      `Canvas encoded ${JSON.stringify(blob.type)}, expected ${JSON.stringify(options.mimeType)}.`,
    );
  }
  return new Uint8Array(await abortable(blob.arrayBuffer(), options.signal));
}

function releaseCanvas(canvas: CanvasSurface): void {
  canvas.width = 1;
  canvas.height = 1;
}

function throwIfAborted(signal: AbortSignal): void {
  if (signal.aborted) throw abortError();
}

function abortError(): Error {
  const error = new Error("Canvas evidence operation was aborted.");
  error.name = "AbortError";
  return error;
}

function abortable<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
  if (signal.aborted) {
    promise.catch(() => undefined);
    return Promise.reject(abortError());
  }
  return new Promise<T>((resolve, reject) => {
    const onAbort = () => reject(abortError());
    signal.addEventListener("abort", onAbort, { once: true });
    promise.then(
      (value) => {
        signal.removeEventListener("abort", onAbort);
        resolve(value);
      },
      (error) => {
        signal.removeEventListener("abort", onAbort);
        reject(error);
      },
    );
  });
}

function boundedInteger(
  value: number | undefined,
  fallback: number,
  minimum: number,
  maximum: number,
  name: string,
): number {
  const result = value ?? fallback;
  if (!Number.isSafeInteger(result) || result < minimum || result > maximum) {
    throw new RangeError(
      `${name} must be an integer in [${minimum}, ${maximum}].`,
    );
  }
  return result;
}

export type EvidenceMemoryScope = {
  sessionId?: string;
  handle?: string;
};

export type MemoryEvidenceStoreOptions = {
  storeId?: string;
  maxEntries?: number;
  maxBytes?: number;
  maxArtifactBytes?: number;
};

export interface MemoryEvidenceArtifactStore {
  readonly sink: EvidenceArtifactSink;
  sinkFor(scope?: EvidenceMemoryScope): EvidenceArtifactSink;
  sinkForRequest(context: {
    sessionId: string;
    handle: string;
  }): EvidenceArtifactSink;
  readonly workflowCleanup: {
    onDisposeHandle(context: {
      sessionId: string;
      handle: string;
    }): Promise<void>;
    onDisposeSession(context: { sessionId: string }): Promise<void>;
  };
  read(uri: string): Uint8Array | undefined;
  ref(uri: string): EvidenceArtifactRef | undefined;
  list(scope?: EvidenceMemoryScope): EvidenceArtifactRef[];
  disposeHandle(context: { sessionId: string; handle: string }): Promise<void>;
  disposeSession(context: { sessionId: string }): Promise<void>;
  dispose(): Promise<void>;
  stats(): {
    entries: number;
    bytes: number;
    openTransactions: number;
    disposed: boolean;
  };
}

type StoredArtifact = {
  ref: EvidenceArtifactRef;
  bytes: Uint8Array;
  scope: Required<EvidenceMemoryScope>;
};

/** Transactional bounded byte store; reads always return defensive copies. */
export function createMemoryEvidenceArtifactStore(
  options: MemoryEvidenceStoreOptions = {},
): MemoryEvidenceArtifactStore {
  const storeId = options.storeId ?? "evidence";
  if (!/^[A-Za-z0-9._-]{1,64}$/.test(storeId)) {
    throw new Error("Memory evidence storeId must be a portable identifier.");
  }
  const maxEntries = boundedInteger(
    options.maxEntries,
    256,
    1,
    4_096,
    "maxEntries",
  );
  const maxBytes = boundedInteger(
    options.maxBytes,
    64 * 1024 * 1024,
    1,
    256 * 1024 * 1024,
    "maxBytes",
  );
  const maxArtifactBytes = boundedInteger(
    options.maxArtifactBytes,
    16 * 1024 * 1024,
    1,
    64 * 1024 * 1024,
    "maxArtifactBytes",
  );
  const committed = new Map<string, StoredArtifact>();
  const open = new Map<
    number,
    { scope: Required<EvidenceMemoryScope>; abort: () => void }
  >();
  let byteLength = 0;
  let transactionCounter = 0;
  let disposed = false;

  const sinkFor = (
    scopeInput: EvidenceMemoryScope = {},
  ): EvidenceArtifactSink => {
    const scope = normalizedScope(scopeInput);
    return {
      async begin(plan, context) {
        assertStoreReady(disposed, context.signal);
        const transaction = ++transactionCounter;
        const pending = new Map<string, StoredArtifact>();
        let pendingBytes = 0;
        let terminal: "open" | "committed" | "aborted" = "open";
        const expected = new Set(plan.artifacts.map(({ id }) => id));
        const abortPending = () => {
          if (terminal !== "open") return;
          pending.clear();
          pendingBytes = 0;
          terminal = "aborted";
          open.delete(transaction);
        };
        open.set(transaction, { scope, abort: abortPending });

        const writer: EvidenceArtifactSinkWriter = {
          async write(request, artifact, writeContext) {
            assertStoreReady(disposed, writeContext.signal);
            assertTransactionOpen(terminal, writeContext.signal);
            if (!expected.has(request.id)) {
              throw new Error(`Artifact ${request.id} is not in the plan.`);
            }
            if (pending.has(request.id)) {
              throw new Error(`Artifact ${request.id} was written twice.`);
            }
            if (
              !(artifact.bytes instanceof Uint8Array) ||
              artifact.bytes.byteLength > maxArtifactBytes
            ) {
              throw new RangeError(
                `Artifact ${request.id} exceeds the memory-store byte limit.`,
              );
            }
            const uri = memoryUri(storeId, scope, transaction, request.id);
            const ref: EvidenceArtifactRef = {
              id: request.id,
              kind: request.kind,
              uri,
              mimeType: artifact.mimeType,
              byteLength: artifact.bytes.byteLength,
              width: artifact.width,
              height: artifact.height,
            };
            const bytes = new Uint8Array(artifact.bytes);
            pending.set(uri, { ref: structuredClone(ref), bytes, scope });
            pendingBytes += bytes.byteLength;
            if (pendingBytes > maxBytes) {
              pending.delete(uri);
              pendingBytes -= bytes.byteLength;
              throw new RangeError(
                "Pending evidence transaction exceeds maxBytes.",
              );
            }
            return structuredClone(ref);
          },
          async commit(commitContext) {
            assertStoreReady(disposed, commitContext.signal);
            assertTransactionOpen(terminal, commitContext.signal);
            if (pending.size !== expected.size) {
              throw new Error(
                `Evidence transaction has ${pending.size}/${expected.size} artifacts.`,
              );
            }
            if (committed.size + pending.size > maxEntries) {
              throw new RangeError(
                "Evidence store maxEntries would be exceeded.",
              );
            }
            if (byteLength + pendingBytes > maxBytes) {
              throw new RangeError(
                "Evidence store maxBytes would be exceeded.",
              );
            }
            for (const [uri, artifact] of pending) {
              committed.set(uri, artifact);
            }
            byteLength += pendingBytes;
            pending.clear();
            pendingBytes = 0;
            terminal = "committed";
            open.delete(transaction);
          },
          async abort(
            _error: EvidenceError,
            _abortContext: EvidenceSinkContext,
          ) {
            if (terminal === "committed") return;
            if (terminal === "aborted") return;
            abortPending();
          },
        };
        return writer;
      },
    };
  };

  const deleteWhere = (predicate: (entry: StoredArtifact) => boolean) => {
    for (const [uri, artifact] of committed) {
      if (!predicate(artifact)) continue;
      committed.delete(uri);
      byteLength -= artifact.bytes.byteLength;
      artifact.bytes.fill(0);
    }
  };

  const store: MemoryEvidenceArtifactStore = {
    sink: undefined as never,
    sinkFor,
    sinkForRequest({ sessionId, handle }) {
      return sinkFor({ sessionId, handle });
    },
    workflowCleanup: undefined as never,
    read(uri) {
      const artifact = committed.get(uri);
      return artifact ? new Uint8Array(artifact.bytes) : undefined;
    },
    ref(uri) {
      const artifact = committed.get(uri);
      return artifact ? structuredClone(artifact.ref) : undefined;
    },
    list(scopeInput) {
      const scope = scopeInput ? normalizedScope(scopeInput) : undefined;
      return [...committed.values()]
        .filter(
          (artifact) =>
            !scope ||
            (artifact.scope.sessionId === scope.sessionId &&
              artifact.scope.handle === scope.handle),
        )
        .map(({ ref }) => structuredClone(ref))
        .sort((left, right) =>
          left.uri < right.uri ? -1 : left.uri > right.uri ? 1 : 0,
        );
    },
    async disposeHandle({ sessionId, handle }) {
      for (const transaction of [...open.values()]) {
        if (
          transaction.scope.sessionId === sessionId &&
          transaction.scope.handle === handle
        ) {
          transaction.abort();
        }
      }
      deleteWhere(
        (artifact) =>
          artifact.scope.sessionId === sessionId &&
          artifact.scope.handle === handle,
      );
    },
    async disposeSession({ sessionId }) {
      for (const transaction of [...open.values()]) {
        if (transaction.scope.sessionId === sessionId) transaction.abort();
      }
      deleteWhere((artifact) => artifact.scope.sessionId === sessionId);
    },
    async dispose() {
      if (disposed) return;
      disposed = true;
      for (const transaction of [...open.values()]) transaction.abort();
      deleteWhere(() => true);
    },
    stats() {
      return {
        entries: committed.size,
        bytes: byteLength,
        openTransactions: open.size,
        disposed,
      };
    },
  };
  (store as { sink: EvidenceArtifactSink }).sink = sinkFor();
  (
    store as {
      workflowCleanup: MemoryEvidenceArtifactStore["workflowCleanup"];
    }
  ).workflowCleanup = {
    onDisposeHandle: (context) => store.disposeHandle(context),
    onDisposeSession: (context) => store.disposeSession(context),
  };
  return store;
}

function normalizedScope(
  input: EvidenceMemoryScope,
): Required<EvidenceMemoryScope> {
  const sessionId = input.sessionId ?? "default";
  const handle = input.handle ?? "default";
  for (const [name, value] of [
    ["sessionId", sessionId],
    ["handle", handle],
  ] as const) {
    if (value.length < 1 || value.length > 191) {
      throw new Error(`${name} must contain 1 through 191 characters.`);
    }
  }
  return { sessionId, handle };
}

function memoryUri(
  storeId: string,
  scope: Required<EvidenceMemoryScope>,
  transaction: number,
  artifactId: string,
): string {
  return `memory://${storeId}/${encodeURIComponent(scope.sessionId)}/${encodeURIComponent(scope.handle)}/tx-${transaction}/${encodeURIComponent(artifactId)}`;
}

function assertStoreReady(disposed: boolean, signal: AbortSignal): void {
  if (disposed) throw new Error("Memory evidence store is disposed.");
  throwIfAborted(signal);
}

function assertTransactionOpen(
  terminal: "open" | "committed" | "aborted",
  signal: AbortSignal,
): void {
  if (terminal !== "open") {
    throw new Error(`Evidence transaction is already ${terminal}.`);
  }
  throwIfAborted(signal);
}
