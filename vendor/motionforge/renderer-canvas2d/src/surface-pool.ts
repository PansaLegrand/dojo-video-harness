export const SCRATCH_SURFACE_BUCKET_SIZE = 64;

export type Canvas2DSurface = HTMLCanvasElement | OffscreenCanvas;

export type Canvas2DSurfaceContext =
  | CanvasRenderingContext2D
  | OffscreenCanvasRenderingContext2D;

export type ScratchSurfaceFactory = (
  width: number,
  height: number,
) => Canvas2DSurface;

export type ScratchSurfacePoolOptions = {
  createCanvas: ScratchSurfaceFactory;
  /** Maximum retained RGBA backing bytes, including leased surfaces. */
  maxBytes: number;
  /** Maximum retained surface count, including leased surfaces. */
  maxSurfaces: number;
  /** Maximum requested or allocated width/height. */
  maxDimension: number;
};

export type ScratchSurfaceBounds = Readonly<{
  width: number;
  height: number;
}>;

export type ScratchSurfaceReleaseOptions = {
  /** Drop the surface instead of trusting renderer state after a failed draw. */
  poisoned?: boolean;
};

export type DetachedScratchSurface = Readonly<{
  surface: Canvas2DSurface;
  context: Canvas2DSurfaceContext;
  requested: ScratchSurfaceBounds;
  bucket: ScratchSurfaceBounds;
  purpose: string;
  /** Full bucket RGBA backing bytes transferred out of pool ownership. */
  bytes: number;
}>;

export type ScratchSurfaceLease = {
  readonly surface: Canvas2DSurface;
  readonly context: Canvas2DSurfaceContext;
  /** Integer pixel bounds requested by the caller. */
  readonly requested: ScratchSurfaceBounds;
  /** Actual reusable backing-store bounds selected by the pool. */
  readonly bucket: ScratchSurfaceBounds;
  readonly purpose: string;
  readonly released: boolean;
  /**
   * Atomically transfers this live backing store out of pool ownership.
   * The first successful call is terminal; later detach/release calls are no-ops.
   */
  detach(): DetachedScratchSurface | undefined;
  /** Idempotent. A poisoned first release destroys the backing store. */
  release(options?: ScratchSurfaceReleaseOptions): void;
};

export type ScratchSurfacePoolStats = Readonly<{
  disposed: boolean;
  surfaceCount: number;
  idleSurfaceCount: number;
  leasedSurfaceCount: number;
  allocatedBytes: number;
  idleBytes: number;
  leasedBytes: number;
  peakAllocatedBytes: number;
  peakLeasedBytes: number;
  allocations: number;
  reuses: number;
  evictions: number;
  failures: number;
  poisonedReleases: number;
  detaches: number;
}>;

export type ScratchSurfacePoolErrorCode =
  | "invalid_options"
  | "invalid_request"
  | "budget_exceeded"
  | "factory_failed"
  | "context_unavailable"
  | "disposed";

export class ScratchSurfacePoolError extends Error {
  constructor(
    readonly code: ScratchSurfacePoolErrorCode,
    message: string,
    options?: { cause?: unknown },
  ) {
    super(message, options);
    this.name = "ScratchSurfacePoolError";
  }
}

type SurfaceEntry = {
  readonly id: number;
  readonly surface: Canvas2DSurface;
  context: Canvas2DSurfaceContext;
  readonly width: number;
  readonly height: number;
  readonly bytes: number;
  leased: boolean;
  idleOrder: number;
};

/**
 * Renderer-session-owned Canvas surface pool.
 *
 * Surfaces are bucketed, byte-accounted, and never shared concurrently. The
 * pool deliberately accepts a host factory so DOM, workers, and headless
 * adapters use exactly the same lifecycle contract.
 */
export class ScratchSurfacePool {
  readonly #createCanvas: ScratchSurfaceFactory;
  readonly #maxBytes: number;
  readonly #maxSurfaces: number;
  readonly #maxDimension: number;
  readonly #entries = new Map<number, SurfaceEntry>();

  #disposed = false;
  #nextId = 1;
  #idleClock = 0;
  #allocatedBytes = 0;
  #leasedBytes = 0;
  #peakAllocatedBytes = 0;
  #peakLeasedBytes = 0;
  #allocations = 0;
  #reuses = 0;
  #evictions = 0;
  #failures = 0;
  #poisonedReleases = 0;
  #detaches = 0;

  constructor(options: ScratchSurfacePoolOptions) {
    if (!options || typeof options.createCanvas !== "function") {
      throw new ScratchSurfacePoolError(
        "invalid_options",
        "Scratch surface pools need a host createCanvas(width, height) factory.",
      );
    }
    assertNonnegativeSafeInteger("maxBytes", options.maxBytes);
    assertNonnegativeSafeInteger("maxSurfaces", options.maxSurfaces);
    assertPositiveSafeInteger("maxDimension", options.maxDimension);
    this.#createCanvas = options.createCanvas;
    this.#maxBytes = options.maxBytes;
    this.#maxSurfaces = options.maxSurfaces;
    this.#maxDimension = options.maxDimension;
  }

  acquire(request: {
    width: number;
    height: number;
    purpose: string;
  }): ScratchSurfaceLease {
    if (this.#disposed) {
      return this.#fail(
        "disposed",
        "Cannot acquire a scratch surface from a disposed pool.",
      );
    }

    let requestedWidth: number;
    let requestedHeight: number;
    try {
      requestedWidth = normalizeRequestedDimension(
        "width",
        request?.width,
        this.#maxDimension,
      );
      requestedHeight = normalizeRequestedDimension(
        "height",
        request?.height,
        this.#maxDimension,
      );
    } catch (error) {
      this.#failures += 1;
      throw error;
    }
    if (typeof request.purpose !== "string" || request.purpose.length === 0) {
      return this.#fail(
        "invalid_request",
        "Scratch surface purpose must be a non-empty string.",
      );
    }

    const bucketWidth = bucketDimension(requestedWidth, this.#maxDimension);
    const bucketHeight = bucketDimension(requestedHeight, this.#maxDimension);
    let requestedBytes: number;
    try {
      requestedBytes = checkedRgbaBytes(bucketWidth, bucketHeight);
    } catch (error) {
      this.#failures += 1;
      throw error;
    }

    const reusable = this.#exactBucket(bucketWidth, bucketHeight);
    if (reusable) {
      reusable.leased = true;
      reusable.idleOrder = 0;
      this.#leasedBytes += reusable.bytes;
      this.#peakLeasedBytes = Math.max(
        this.#peakLeasedBytes,
        this.#leasedBytes,
      );
      this.#reuses += 1;
      return this.#lease(
        reusable,
        requestedWidth,
        requestedHeight,
        request.purpose,
      );
    }

    const leasedCount = this.#leasedCount();
    if (
      leasedCount + 1 > this.#maxSurfaces ||
      this.#leasedBytes + requestedBytes > this.#maxBytes
    ) {
      return this.#fail(
        "budget_exceeded",
        `Scratch surface ${bucketWidth}x${bucketHeight} (${requestedBytes} bytes) exceeds the available leased-surface budget.`,
      );
    }

    while (
      this.#entries.size + 1 > this.#maxSurfaces ||
      this.#allocatedBytes + requestedBytes > this.#maxBytes
    ) {
      const oldest = this.#oldestIdle();
      if (!oldest) {
        return this.#fail(
          "budget_exceeded",
          `Scratch surface ${bucketWidth}x${bucketHeight} (${requestedBytes} bytes) exceeds the configured pool budget.`,
        );
      }
      this.#destroy(oldest, true);
    }

    let surface: Canvas2DSurface | undefined;
    try {
      surface = this.#createCanvas(bucketWidth, bucketHeight);
      surface.width = bucketWidth;
      surface.height = bucketHeight;
    } catch (cause) {
      if (surface) shrinkSurface(surface);
      return this.#fail(
        "factory_failed",
        `Scratch surface factory failed for ${bucketWidth}x${bucketHeight}.`,
        cause,
      );
    }
    if (surface.width !== bucketWidth || surface.height !== bucketHeight) {
      shrinkSurface(surface);
      return this.#fail(
        "factory_failed",
        `Scratch surface factory could not allocate ${bucketWidth}x${bucketHeight}.`,
      );
    }

    let context: Canvas2DSurfaceContext | null;
    try {
      context = getCanvas2DContext(surface);
    } catch (cause) {
      shrinkSurface(surface);
      return this.#fail(
        "context_unavailable",
        `Scratch surface ${bucketWidth}x${bucketHeight} could not create a 2D context.`,
        cause,
      );
    }
    if (!context) {
      shrinkSurface(surface);
      return this.#fail(
        "context_unavailable",
        `Scratch surface ${bucketWidth}x${bucketHeight} returned no 2D context.`,
      );
    }

    const entry: SurfaceEntry = {
      id: this.#nextId,
      surface,
      context,
      width: bucketWidth,
      height: bucketHeight,
      bytes: requestedBytes,
      leased: true,
      idleOrder: 0,
    };
    this.#nextId += 1;
    this.#entries.set(entry.id, entry);
    this.#allocatedBytes += entry.bytes;
    this.#leasedBytes += entry.bytes;
    this.#peakAllocatedBytes = Math.max(
      this.#peakAllocatedBytes,
      this.#allocatedBytes,
    );
    this.#peakLeasedBytes = Math.max(this.#peakLeasedBytes, this.#leasedBytes);
    this.#allocations += 1;
    return this.#lease(entry, requestedWidth, requestedHeight, request.purpose);
  }

  stats(): ScratchSurfacePoolStats {
    const leasedSurfaceCount = this.#leasedCount();
    const surfaceCount = this.#entries.size;
    return Object.freeze({
      disposed: this.#disposed,
      surfaceCount,
      idleSurfaceCount: surfaceCount - leasedSurfaceCount,
      leasedSurfaceCount,
      allocatedBytes: this.#allocatedBytes,
      idleBytes: this.#allocatedBytes - this.#leasedBytes,
      leasedBytes: this.#leasedBytes,
      peakAllocatedBytes: this.#peakAllocatedBytes,
      peakLeasedBytes: this.#peakLeasedBytes,
      allocations: this.#allocations,
      reuses: this.#reuses,
      evictions: this.#evictions,
      failures: this.#failures,
      poisonedReleases: this.#poisonedReleases,
      detaches: this.#detaches,
    });
  }

  dispose(): void {
    if (this.#disposed) return;
    this.#disposed = true;
    for (const entry of [...this.#entries.values()].sort(
      (left, right) => left.id - right.id,
    )) {
      this.#destroy(entry, false);
    }
  }

  async disposeAsync(): Promise<void> {
    this.dispose();
  }

  #lease(
    entry: SurfaceEntry,
    requestedWidth: number,
    requestedHeight: number,
    purpose: string,
  ): ScratchSurfaceLease {
    let released = false;
    const pool = this;
    return {
      surface: entry.surface,
      context: entry.context,
      requested: Object.freeze({
        width: requestedWidth,
        height: requestedHeight,
      }),
      bucket: Object.freeze({ width: entry.width, height: entry.height }),
      purpose,
      get released() {
        return released;
      },
      detach() {
        if (released) return undefined;
        if (!pool.#detach(entry)) {
          released = true;
          return undefined;
        }
        released = true;
        return Object.freeze({
          surface: entry.surface,
          context: entry.context,
          requested: Object.freeze({
            width: requestedWidth,
            height: requestedHeight,
          }),
          bucket: Object.freeze({ width: entry.width, height: entry.height }),
          purpose,
          bytes: entry.bytes,
        });
      },
      release(options = {}) {
        if (released) return;
        released = true;
        pool.#release(entry, options.poisoned === true);
      },
    };
  }

  #detach(entry: SurfaceEntry): boolean {
    if (!entry.leased || !this.#entries.delete(entry.id)) return false;
    entry.leased = false;
    this.#allocatedBytes -= entry.bytes;
    this.#leasedBytes -= entry.bytes;
    this.#detaches += 1;
    return true;
  }

  #release(entry: SurfaceEntry, poisoned: boolean): void {
    if (!entry.leased || !this.#entries.has(entry.id)) return;
    entry.leased = false;
    this.#leasedBytes -= entry.bytes;
    if (poisoned) {
      this.#poisonedReleases += 1;
      this.#destroy(entry, false);
      return;
    }

    const resetContext = resetSurface(entry);
    if (!resetContext) {
      this.#failures += 1;
      this.#destroy(entry, false);
      return;
    }
    entry.context = resetContext;
    this.#idleClock += 1;
    entry.idleOrder = this.#idleClock;
  }

  #exactBucket(width: number, height: number): SurfaceEntry | undefined {
    return [...this.#entries.values()]
      .filter(
        (entry) =>
          !entry.leased && entry.width === width && entry.height === height,
      )
      .sort((left, right) => left.id - right.id)[0];
  }

  #oldestIdle(): SurfaceEntry | undefined {
    return [...this.#entries.values()]
      .filter((entry) => !entry.leased)
      .sort(
        (left, right) => left.idleOrder - right.idleOrder || left.id - right.id,
      )[0];
  }

  #leasedCount(): number {
    let count = 0;
    for (const entry of this.#entries.values()) {
      if (entry.leased) count += 1;
    }
    return count;
  }

  #destroy(entry: SurfaceEntry, eviction: boolean): void {
    if (!this.#entries.delete(entry.id)) return;
    this.#allocatedBytes -= entry.bytes;
    if (entry.leased) {
      this.#leasedBytes -= entry.bytes;
      entry.leased = false;
    }
    if (eviction) this.#evictions += 1;
    shrinkSurface(entry.surface);
  }

  #fail(
    code: ScratchSurfacePoolErrorCode,
    message: string,
    cause?: unknown,
  ): never {
    this.#failures += 1;
    throw new ScratchSurfacePoolError(code, message, { cause });
  }
}

function normalizeRequestedDimension(
  name: "width" | "height",
  value: number,
  maxDimension: number,
): number {
  if (!Number.isFinite(value) || value <= 0) {
    throw new ScratchSurfacePoolError(
      "invalid_request",
      `Scratch surface ${name} must be finite and greater than zero.`,
    );
  }
  const normalized = Math.ceil(value);
  if (!Number.isSafeInteger(normalized) || normalized > maxDimension) {
    throw new ScratchSurfacePoolError(
      "invalid_request",
      `Scratch surface ${name} ${normalized} exceeds maxDimension ${maxDimension}.`,
    );
  }
  return normalized;
}

function bucketDimension(value: number, maxDimension: number): number {
  const rounded =
    Math.ceil(value / SCRATCH_SURFACE_BUCKET_SIZE) *
    SCRATCH_SURFACE_BUCKET_SIZE;
  return Math.min(maxDimension, rounded);
}

export function checkedRgbaBytes(width: number, height: number): number {
  if (
    !Number.isSafeInteger(width) ||
    width <= 0 ||
    !Number.isSafeInteger(height) ||
    height <= 0
  ) {
    throw new ScratchSurfacePoolError(
      "invalid_request",
      "Scratch surface byte accounting needs positive safe-integer dimensions.",
    );
  }
  const pixels = width * height;
  const bytes = pixels * 4;
  if (!Number.isSafeInteger(pixels) || !Number.isSafeInteger(bytes)) {
    throw new ScratchSurfacePoolError(
      "invalid_request",
      `Scratch surface ${width}x${height} exceeds safe RGBA byte accounting.`,
    );
  }
  return bytes;
}

function getCanvas2DContext(
  surface: Canvas2DSurface,
): Canvas2DSurfaceContext | null {
  return surface.getContext("2d") as Canvas2DSurfaceContext | null;
}

function resetSurface(entry: SurfaceEntry): Canvas2DSurfaceContext | null {
  try {
    const reset = (
      entry.context as Canvas2DSurfaceContext & {
        reset?: () => void;
      }
    ).reset;
    if (typeof reset === "function") {
      try {
        reset.call(entry.context);
      } catch {
        // A width reset is the strongest portable recovery from an unknown
        // Canvas save stack, including one left by a throwing adapter.
        entry.surface.width = entry.width;
      }
    } else {
      // Assigning width unwinds any unknown save stack and resets all state.
      entry.surface.width = entry.width;
    }
    if (
      entry.surface.width !== entry.width ||
      entry.surface.height !== entry.height
    ) {
      return null;
    }
    const context = getCanvas2DContext(entry.surface);
    if (!context) return null;
    context.clearRect(0, 0, entry.width, entry.height);
    return context;
  } catch {
    return null;
  }
}

function shrinkSurface(surface: Canvas2DSurface): void {
  try {
    surface.width = 1;
    surface.height = 1;
  } catch {
    // Disposal is best-effort after a host canvas has already failed.
  }
}

function assertNonnegativeSafeInteger(name: string, value: number): void {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new ScratchSurfacePoolError(
      "invalid_options",
      `${name} must be a non-negative safe integer.`,
    );
  }
}

function assertPositiveSafeInteger(name: string, value: number): void {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new ScratchSurfacePoolError(
      "invalid_options",
      `${name} must be a positive safe integer.`,
    );
  }
}
