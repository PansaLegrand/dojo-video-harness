import type { DisplayGroup } from "@dojo-video-engine/core";
import type { DetachedScratchSurface } from "./surface-pool";

const STATIC_NODE_TYPES = new Set<DisplayGroup["nodeType"]>([
  "div",
  "text",
  "img",
  "shape",
  "audio",
]);

const NODE_TIMING_FIELDS = new Set(["from", "duration", "localFrame"]);
const FINGERPRINT_VERSION = 1 as const;
const FNV_OFFSET_BASIS_64 = 0xcbf29ce484222325n;
const FNV_PRIME_64 = 0x100000001b3n;
const UINT64_MASK = 0xffffffffffffffffn;

export type StaticDisplayResourceReference =
  | Readonly<{
      kind: "image";
      assetId: string;
    }>
  | Readonly<{
      kind: "font";
      family: string;
      weight: string | number;
      style: "normal" | "italic";
    }>;

/**
 * Resolves host-owned resource identity that is not present in a display list.
 * Typical identities are a content hash, immutable URL, or loaded font epoch.
 */
export type StaticDisplayResourceIdentity = (
  reference: StaticDisplayResourceReference,
) => string;

export type StaticDisplayFingerprint = Readonly<{
  version: typeof FINGERPRINT_VERSION;
  /** Bounded lookup key. Cache hits are never accepted on this key alone. */
  key: string;
  /** Canonical deep signature used to reject digest collisions. */
  signature: string;
}>;

export type StaticDisplayFingerprintOptions = Readonly<{
  resourceIdentity?: StaticDisplayResourceIdentity;
}>;

/**
 * A deliberately conservative visual-static predicate.
 *
 * Audio nodes are accepted only for their visual group paint (background,
 * border, mask, and children); their audio playback is not cached here.
 */
export function isStaticDisplayGroup(group: DisplayGroup): boolean {
  return isStaticGroup(group, new Set<DisplayGroup>());
}

/**
 * Creates a deterministic snapshot fingerprint for a static display subtree.
 * Node activation timing is omitted because an already-compiled static
 * subtree paints identically while active. All other fields are retained.
 */
export function fingerprintStaticDisplayGroup(
  group: DisplayGroup,
  options: StaticDisplayFingerprintOptions = {},
): StaticDisplayFingerprint {
  const snapshot = normalizeCanonicalValue(group, "group") as DisplayGroup;
  if (!isStaticDisplayGroup(snapshot)) {
    throw new TypeError(
      "Only display groups proven visually static can be fingerprinted.",
    );
  }

  const references = collectResourceReferences(snapshot);
  const resources = references.map((reference) => {
    const identity = options.resourceIdentity
      ? options.resourceIdentity(reference)
      : canonicalStringify(reference);
    if (typeof identity !== "string") {
      throw new TypeError(
        "Static display resource identities must be strings.",
      );
    }
    return { reference, identity };
  });
  const signature = canonicalStringify({
    version: FINGERPRINT_VERSION,
    resources,
    group: snapshot,
  });
  const digest = fnv1a64(signature).toString(16).padStart(16, "0");
  return Object.freeze({
    version: FINGERPRINT_VERSION,
    key: `dojo-video-engine.static-display.v1:${digest}`,
    signature,
  });
}

export type StaticDisplayCacheDisposalReason =
  | "replace"
  | "collision"
  | "evict"
  | "delete"
  | "clear";

export type StaticDisplayCacheOptions<V> = Readonly<{
  /** Logical retained bytes: value bytes plus UTF-8 fingerprint metadata. */
  maxBytes: number;
  maxEntries: number;
  /** Maximum combined UTF-8 lookup-key and deep-signature bytes. */
  maxKeyBytes: number;
  dispose?: (value: V, reason: StaticDisplayCacheDisposalReason) => void;
}>;

export type StaticDisplayCacheStats = Readonly<{
  entries: number;
  bytes: number;
  valueBytes: number;
  keyBytes: number;
  maxBytes: number;
  maxEntries: number;
  maxKeyBytes: number;
  hits: number;
  misses: number;
  collisions: number;
  sets: number;
  replacements: number;
  evictions: number;
  deletions: number;
  clears: number;
  bypasses: number;
}>;

type CacheEntry<V> = {
  readonly key: string;
  readonly signature: string;
  readonly value: V;
  readonly valueBytes: number;
  readonly keyBytes: number;
  readonly retainedBytes: number;
};

type DisposalOutcome =
  | { readonly failed: false }
  | { readonly failed: true; readonly error: unknown };

/**
 * Generic renderer-session-owned LRU for rasterized static display subtrees.
 *
 * `set()` takes the caller's exact logical value size. A rejected/bypassed
 * value is never retained and remains caller-owned. Retained values transfer
 * to the cache and are disposed exactly once when removed.
 */
export class StaticDisplayCache<V> {
  readonly #maxBytes: number;
  readonly #maxEntries: number;
  readonly #maxKeyBytes: number;
  readonly #dispose?: StaticDisplayCacheOptions<V>["dispose"];
  readonly #entries = new Map<string, CacheEntry<V>>();

  #bytes = 0;
  #valueBytes = 0;
  #keyBytes = 0;
  #hits = 0;
  #misses = 0;
  #collisions = 0;
  #sets = 0;
  #replacements = 0;
  #evictions = 0;
  #deletions = 0;
  #clears = 0;
  #bypasses = 0;
  #disposing = false;

  constructor(options: StaticDisplayCacheOptions<V>) {
    if (!options) {
      throw new TypeError("Static display cache options are required.");
    }
    assertNonnegativeSafeInteger("maxBytes", options.maxBytes);
    assertNonnegativeSafeInteger("maxEntries", options.maxEntries);
    assertNonnegativeSafeInteger("maxKeyBytes", options.maxKeyBytes);
    if (
      options.dispose !== undefined &&
      typeof options.dispose !== "function"
    ) {
      throw new TypeError("Static display cache dispose must be a function.");
    }
    this.#maxBytes = options.maxBytes;
    this.#maxEntries = options.maxEntries;
    this.#maxKeyBytes = options.maxKeyBytes;
    this.#dispose = options.dispose;
  }

  get(fingerprint: StaticDisplayFingerprint): V | undefined {
    this.#assertNotDisposing();
    const normalized = normalizeFingerprint(fingerprint);
    const entry = this.#entries.get(normalized.key);
    if (!entry) {
      this.#misses += 1;
      return undefined;
    }
    if (entry.signature !== normalized.signature) {
      this.#misses += 1;
      this.#collisions += 1;
      return undefined;
    }

    this.#entries.delete(entry.key);
    this.#entries.set(entry.key, entry);
    this.#hits += 1;
    return entry.value;
  }

  /** Returns false when the value is too large or caching is disabled. */
  set(
    fingerprint: StaticDisplayFingerprint,
    value: V,
    valueBytes: number,
  ): boolean {
    this.#assertNotDisposing();
    assertNonnegativeSafeInteger("valueBytes", valueBytes);
    const normalized = normalizeFingerprint(fingerprint);
    const lookupBytes = utf8ByteLength(normalized.key);
    const signatureBytes = utf8ByteLength(normalized.signature);
    const keyBytes = checkedAdd(
      lookupBytes,
      signatureBytes,
      "fingerprint bytes",
    );
    const retainedBytes = checkedAdd(keyBytes, valueBytes, "retained bytes");

    if (
      this.#maxEntries === 0 ||
      keyBytes > this.#maxKeyBytes ||
      retainedBytes > this.#maxBytes
    ) {
      this.#bypasses += 1;
      return false;
    }

    const existing = this.#entries.get(normalized.key);
    let disposalFailed = false;
    let disposalError: unknown;
    if (existing) {
      this.#removeEntry(existing);
      this.#replacements += 1;
      const reason =
        existing.signature === normalized.signature ? "replace" : "collision";
      if (reason === "collision") this.#collisions += 1;
      const outcome = this.#disposeEntry(existing, reason);
      if (outcome.failed) {
        disposalFailed = true;
        disposalError = outcome.error;
      }
    }

    const entry: CacheEntry<V> = {
      key: normalized.key,
      signature: normalized.signature,
      value,
      valueBytes,
      keyBytes,
      retainedBytes,
    };
    this.#entries.set(entry.key, entry);
    this.#bytes += retainedBytes;
    this.#valueBytes += valueBytes;
    this.#keyBytes += keyBytes;
    this.#sets += 1;

    while (
      this.#entries.size > this.#maxEntries ||
      this.#bytes > this.#maxBytes
    ) {
      const oldest = this.#entries.values().next().value as
        | CacheEntry<V>
        | undefined;
      if (!oldest) break;
      this.#removeEntry(oldest);
      this.#evictions += 1;
      const outcome = this.#disposeEntry(oldest, "evict");
      if (outcome.failed && !disposalFailed) {
        disposalFailed = true;
        disposalError = outcome.error;
      }
    }

    if (disposalFailed) throw disposalError;
    return true;
  }

  delete(fingerprint: StaticDisplayFingerprint): boolean {
    this.#assertNotDisposing();
    const normalized = normalizeFingerprint(fingerprint);
    const entry = this.#entries.get(normalized.key);
    if (!entry) return false;
    if (entry.signature !== normalized.signature) {
      this.#collisions += 1;
      return false;
    }
    this.#removeEntry(entry);
    this.#deletions += 1;
    const outcome = this.#disposeEntry(entry, "delete");
    if (outcome.failed) throw outcome.error;
    return true;
  }

  clear(): void {
    this.#assertNotDisposing();
    const entries = Array.from(this.#entries.values());
    this.#entries.clear();
    this.#bytes = 0;
    this.#valueBytes = 0;
    this.#keyBytes = 0;
    this.#clears += 1;
    let disposalFailed = false;
    let disposalError: unknown;
    for (const entry of entries) {
      const outcome = this.#disposeEntry(entry, "clear");
      if (outcome.failed && !disposalFailed) {
        disposalFailed = true;
        disposalError = outcome.error;
      }
    }
    if (disposalFailed) throw disposalError;
  }

  stats(): StaticDisplayCacheStats {
    return Object.freeze({
      entries: this.#entries.size,
      bytes: this.#bytes,
      valueBytes: this.#valueBytes,
      keyBytes: this.#keyBytes,
      maxBytes: this.#maxBytes,
      maxEntries: this.#maxEntries,
      maxKeyBytes: this.#maxKeyBytes,
      hits: this.#hits,
      misses: this.#misses,
      collisions: this.#collisions,
      sets: this.#sets,
      replacements: this.#replacements,
      evictions: this.#evictions,
      deletions: this.#deletions,
      clears: this.#clears,
      bypasses: this.#bypasses,
    });
  }

  #removeEntry(entry: CacheEntry<V>): void {
    if (!this.#entries.delete(entry.key)) return;
    this.#bytes -= entry.retainedBytes;
    this.#valueBytes -= entry.valueBytes;
    this.#keyBytes -= entry.keyBytes;
  }

  #disposeEntry(
    entry: CacheEntry<V>,
    reason: StaticDisplayCacheDisposalReason,
  ): DisposalOutcome {
    this.#disposing = true;
    try {
      this.#dispose?.(entry.value, reason);
      return { failed: false };
    } catch (error) {
      return { failed: true, error };
    } finally {
      this.#disposing = false;
    }
  }

  #assertNotDisposing(): void {
    if (this.#disposing) {
      throw new Error(
        "Static display cache disposal callbacks cannot reenter the cache.",
      );
    }
  }
}

export type Canvas2DStaticDisplaySurface = HTMLCanvasElement | OffscreenCanvas;

export type Canvas2DStaticDisplayBounds = Readonly<{
  x: number;
  y: number;
  width: number;
  height: number;
}>;

export type Canvas2DStaticDisplayCacheOptions = Readonly<{
  maxBytes: number;
  maxEntries: number;
  maxKeyBytes: number;
  maxDimension?: number;
}>;

export type Canvas2DStaticDisplayCacheStats = StaticDisplayCacheStats &
  Readonly<{
    disposed: boolean;
    adoptionFailures: number;
    localBypasses: number;
  }>;

type Canvas2DStaticRaster = Readonly<{
  surface: Canvas2DStaticDisplaySurface;
  context: DetachedScratchSurface["context"];
  bucket: DetachedScratchSurface["bucket"];
  width: number;
  height: number;
}>;

/**
 * Canvas-owned specialization that retains exact RGBA rasters for static,
 * already-isolated display subtrees. Detached scratch backing stores transfer
 * ownership without a pixel copy and are shrunk on eviction/disposal.
 */
export class Canvas2DStaticDisplayCache {
  readonly #maxBytes: number;
  readonly #maxEntries: number;
  readonly #maxKeyBytes: number;
  readonly #maxDimension: number;
  readonly #cache: StaticDisplayCache<Canvas2DStaticRaster>;
  #disposed = false;
  #adoptionFailures = 0;
  #localBypasses = 0;

  constructor(options: Canvas2DStaticDisplayCacheOptions) {
    if (!options) {
      throw new TypeError("Canvas2D static display cache options are invalid.");
    }
    assertNonnegativeSafeInteger("maxBytes", options.maxBytes);
    assertNonnegativeSafeInteger("maxEntries", options.maxEntries);
    assertNonnegativeSafeInteger("maxKeyBytes", options.maxKeyBytes);
    const maxDimension = options.maxDimension ?? 16_384;
    assertNonnegativeSafeInteger("maxDimension", maxDimension);
    this.#maxBytes = options.maxBytes;
    this.#maxEntries = options.maxEntries;
    this.#maxKeyBytes = options.maxKeyBytes;
    this.#maxDimension = maxDimension;
    this.#cache = new StaticDisplayCache<Canvas2DStaticRaster>({
      maxBytes: options.maxBytes,
      maxEntries: options.maxEntries,
      maxKeyBytes: options.maxKeyBytes,
      dispose: (value) => shrinkCanvas(value.surface),
    });
  }

  get(
    group: DisplayGroup,
    bounds: Canvas2DStaticDisplayBounds,
    options: StaticDisplayFingerprintOptions = {},
  ): Canvas2DStaticDisplaySurface | undefined {
    this.#assertAlive();
    const fingerprint = this.#fingerprint(group, bounds, options);
    if (!fingerprint) return undefined;
    return this.#cache.get(fingerprint)?.surface;
  }

  /** Checks all deterministic budgets before a scratch lease is detached. */
  canAdopt(
    group: DisplayGroup,
    bounds: Canvas2DStaticDisplayBounds,
    bucket: Readonly<{ width: number; height: number }>,
    options: StaticDisplayFingerprintOptions = {},
  ): boolean {
    this.#assertAlive();
    const fingerprint = this.#fingerprint(group, bounds, options);
    const dimensions = normalizedRasterDimensions(bounds);
    if (
      !fingerprint ||
      !dimensions ||
      this.#maxEntries === 0 ||
      !Number.isSafeInteger(bucket.width) ||
      !Number.isSafeInteger(bucket.height) ||
      bucket.width < dimensions.width ||
      bucket.height < dimensions.height ||
      bucket.width > this.#maxDimension ||
      bucket.height > this.#maxDimension
    ) {
      this.#localBypasses += 1;
      return false;
    }
    const valueBytes = checkedRgbaByteLength(bucket.width, bucket.height);
    const keyBytes = checkedAdd(
      utf8ByteLength(fingerprint.key),
      utf8ByteLength(fingerprint.signature),
      "static fingerprint bytes",
    );
    if (
      keyBytes > this.#maxKeyBytes ||
      checkedAdd(keyBytes, valueBytes, "static retained bytes") > this.#maxBytes
    ) {
      this.#localBypasses += 1;
      return false;
    }
    return true;
  }

  /**
   * Adopts one detached scratch backing store without copying its pixels.
   * Ownership always transfers to this call: rejected values are shrunk.
   */
  adopt(
    group: DisplayGroup,
    bounds: Canvas2DStaticDisplayBounds,
    detached: DetachedScratchSurface,
    options: StaticDisplayFingerprintOptions = {},
  ): boolean {
    if (this.#disposed) {
      shrinkCanvas(detached.surface);
      this.#localBypasses += 1;
      return false;
    }
    const fingerprint = this.#fingerprint(group, bounds, options);
    if (!fingerprint) {
      shrinkCanvas(detached.surface);
      return false;
    }
    const dimensions = normalizedRasterDimensions(bounds);
    if (
      !dimensions ||
      detached.requested.width !== dimensions.width ||
      detached.requested.height !== dimensions.height ||
      detached.bucket.width < dimensions.width ||
      detached.bucket.height < dimensions.height ||
      detached.bucket.width > this.#maxDimension ||
      detached.bucket.height > this.#maxDimension
    ) {
      shrinkCanvas(detached.surface);
      this.#localBypasses += 1;
      return false;
    }
    const valueBytes = checkedRgbaByteLength(
      detached.bucket.width,
      detached.bucket.height,
    );
    if (detached.bytes !== valueBytes || valueBytes > this.#maxBytes) {
      shrinkCanvas(detached.surface);
      this.#localBypasses += 1;
      return false;
    }

    try {
      const retained = this.#cache.set(
        fingerprint,
        Object.freeze({
          surface: detached.surface,
          context: detached.context,
          bucket: detached.bucket,
          width: dimensions.width,
          height: dimensions.height,
        }),
        valueBytes,
      );
      if (!retained) shrinkCanvas(detached.surface);
      return retained;
    } catch {
      shrinkCanvas(detached.surface);
      this.#adoptionFailures += 1;
      this.#localBypasses += 1;
      return false;
    }
  }

  clear(): void {
    this.#assertAlive();
    this.#cache.clear();
  }

  dispose(): void {
    if (this.#disposed) return;
    this.#cache.clear();
    this.#disposed = true;
  }

  stats(): Canvas2DStaticDisplayCacheStats {
    const base = this.#cache.stats();
    return Object.freeze({
      ...base,
      bypasses: base.bypasses + this.#localBypasses,
      disposed: this.#disposed,
      adoptionFailures: this.#adoptionFailures,
      localBypasses: this.#localBypasses,
    });
  }

  #fingerprint(
    group: DisplayGroup,
    bounds: Canvas2DStaticDisplayBounds,
    options: StaticDisplayFingerprintOptions,
  ): StaticDisplayFingerprint | undefined {
    if (!isStaticDisplayGroup(group)) {
      this.#localBypasses += 1;
      return undefined;
    }
    try {
      const base = fingerprintStaticDisplayGroup(group, options);
      const normalizedBounds = normalizeCanonicalValue(bounds, "generic");
      const boundsSignature = stringifyNormalized(normalizedBounds);
      return Object.freeze({
        version: FINGERPRINT_VERSION,
        key: `${base.key}:${fnv1a64(boundsSignature)
          .toString(16)
          .padStart(16, "0")}`,
        signature: `${base.signature}\n${boundsSignature}`,
      });
    } catch {
      this.#localBypasses += 1;
      return undefined;
    }
  }

  #assertAlive(): void {
    if (this.#disposed) {
      throw new Error("Canvas2D static display cache is disposed.");
    }
  }
}

function normalizedRasterDimensions(
  bounds: Canvas2DStaticDisplayBounds,
): { width: number; height: number } | null {
  if (
    !bounds ||
    !Number.isSafeInteger(bounds.x) ||
    !Number.isSafeInteger(bounds.y) ||
    !Number.isSafeInteger(bounds.width) ||
    !Number.isSafeInteger(bounds.height) ||
    bounds.width <= 0 ||
    bounds.height <= 0
  ) {
    return null;
  }
  return { width: bounds.width, height: bounds.height };
}

function checkedRgbaByteLength(width: number, height: number): number {
  const pixels = width * height;
  const bytes = pixels * 4;
  if (!Number.isSafeInteger(pixels) || !Number.isSafeInteger(bytes)) {
    throw new RangeError("Static raster byte size exceeds safe accounting.");
  }
  return bytes;
}

function shrinkCanvas(surface: Canvas2DStaticDisplaySurface): void {
  try {
    surface.width = 1;
    surface.height = 1;
  } catch {
    // Canvas disposal is best-effort; the cache has already dropped the ref.
  }
}

function isStaticGroup(
  group: DisplayGroup,
  visited: Set<DisplayGroup>,
): boolean {
  if (!group || typeof group !== "object" || visited.has(group)) return false;
  visited.add(group);
  if (
    !STATIC_NODE_TYPES.has(group.nodeType) ||
    group.node?.type !== group.nodeType ||
    !isStaticResolvedNode(group.node, new Set<object>()) ||
    !contentMatchesStaticNode(group)
  ) {
    return false;
  }
  return group.children.every((child) => isStaticGroup(child, visited));
}

function isStaticResolvedNode(
  node: DisplayGroup["node"],
  seen: Set<object>,
): boolean {
  if (!node || typeof node !== "object" || seen.has(node)) return false;
  seen.add(node);
  if (
    !STATIC_NODE_TYPES.has(node.type) ||
    (node.animations?.length ?? 0) > 0 ||
    node.extension !== undefined ||
    node.effect !== undefined ||
    node.videoStartTime !== undefined ||
    node.playbackRate !== undefined ||
    node.videoEndBehavior !== undefined
  ) {
    return false;
  }
  return node.children.every((child) => isStaticResolvedNode(child, seen));
}

function contentMatchesStaticNode(group: DisplayGroup): boolean {
  const { content, nodeType } = group;
  if (nodeType === "div" || nodeType === "audio") return content === null;
  if (nodeType === "text") return content === null || content.kind === "text";
  if (nodeType === "shape") return content === null || content.kind === "shape";
  return (
    nodeType === "img" &&
    content?.kind === "media" &&
    content.resource.kind === "image"
  );
}

function collectResourceReferences(
  group: DisplayGroup,
): StaticDisplayResourceReference[] {
  const references = new Map<string, StaticDisplayResourceReference>();
  const visit = (current: DisplayGroup): void => {
    const { content } = current;
    if (content?.kind === "media" && content.resource.kind === "image") {
      const reference = Object.freeze({
        kind: "image" as const,
        assetId: content.resource.assetId,
      });
      references.set(canonicalStringify(reference), reference);
    } else if (content?.kind === "text") {
      const reference = Object.freeze({
        kind: "font" as const,
        family: content.font.family,
        weight: content.font.weight,
        style: content.font.style,
      });
      references.set(canonicalStringify(reference), reference);
    }
    current.children.forEach(visit);
  };
  visit(group);
  return Array.from(references.entries())
    .sort(([left], [right]) => compareCodeUnits(left, right))
    .map(([, reference]) => reference);
}

type CanonicalContext = "generic" | "group" | "node";

function normalizeCanonicalValue(
  value: unknown,
  context: CanonicalContext,
  ancestors = new Set<object>(),
): unknown {
  if (
    value === null ||
    typeof value === "string" ||
    typeof value === "boolean"
  ) {
    return value;
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value)) {
      throw new TypeError(
        "Static display fingerprints require finite numbers.",
      );
    }
    return Object.is(value, -0) ? 0 : value;
  }
  if (typeof value !== "object") {
    throw new TypeError(
      "Static display fingerprints require JSON-safe values.",
    );
  }
  if (ancestors.has(value)) {
    throw new TypeError("Static display fingerprints cannot contain cycles.");
  }
  ancestors.add(value);
  try {
    if (Array.isArray(value)) {
      const result: unknown[] = [];
      for (let index = 0; index < value.length; index += 1) {
        if (!(index in value)) {
          throw new TypeError(
            "Static display fingerprints cannot contain holes.",
          );
        }
        const itemContext = context === "node" ? "node" : context;
        result.push(
          normalizeCanonicalValue(value[index], itemContext, ancestors),
        );
      }
      return result;
    }

    const record = value as Record<string, unknown>;
    const prototype = Object.getPrototypeOf(record);
    if (prototype !== Object.prototype && prototype !== null) {
      throw new TypeError(
        "Static display fingerprints require JSON-safe plain objects.",
      );
    }
    const result: Record<string, unknown> = Object.create(null) as Record<
      string,
      unknown
    >;
    const keys = Object.keys(record).sort(compareCodeUnits);
    for (const key of keys) {
      if (context === "node" && NODE_TIMING_FIELDS.has(key)) continue;
      const nextContext: CanonicalContext =
        context === "group" && key === "node"
          ? "node"
          : (context === "group" && key === "children") ||
              (context === "node" && key === "children")
            ? context
            : "generic";
      result[key] = normalizeCanonicalValue(
        record[key],
        nextContext,
        ancestors,
      );
    }
    return result;
  } finally {
    ancestors.delete(value);
  }
}

function canonicalStringify(value: unknown): string {
  return stringifyNormalized(normalizeCanonicalValue(value, "generic"));
}

function stringifyNormalized(value: unknown): string {
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map(stringifyNormalized).join(",")}]`;
  }
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record)
    .sort(compareCodeUnits)
    .map((key) => `${JSON.stringify(key)}:${stringifyNormalized(record[key])}`)
    .join(",")}}`;
}

function normalizeFingerprint(
  fingerprint: StaticDisplayFingerprint,
): StaticDisplayFingerprint {
  if (
    !fingerprint ||
    fingerprint.version !== FINGERPRINT_VERSION ||
    typeof fingerprint.key !== "string" ||
    fingerprint.key.length === 0 ||
    typeof fingerprint.signature !== "string"
  ) {
    throw new TypeError("Invalid static display fingerprint.");
  }
  return {
    version: FINGERPRINT_VERSION,
    key: fingerprint.key,
    signature: fingerprint.signature,
  };
}

function fnv1a64(value: string): bigint {
  let hash = FNV_OFFSET_BASIS_64;
  const bytes = new TextEncoder().encode(value);
  for (const byte of bytes) {
    hash ^= BigInt(byte);
    hash = (hash * FNV_PRIME_64) & UINT64_MASK;
  }
  return hash;
}

function utf8ByteLength(value: string): number {
  let bytes = 0;
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code <= 0x7f) bytes += 1;
    else if (code <= 0x7ff) bytes += 2;
    else if (code >= 0xd800 && code <= 0xdbff) {
      const next = value.charCodeAt(index + 1);
      if (next >= 0xdc00 && next <= 0xdfff) index += 1;
      bytes += next >= 0xdc00 && next <= 0xdfff ? 4 : 3;
    } else bytes += 3;
    if (!Number.isSafeInteger(bytes)) {
      throw new RangeError(
        "UTF-8 byte length exceeds safe integer accounting.",
      );
    }
  }
  return bytes;
}

function checkedAdd(left: number, right: number, name: string): number {
  const total = left + right;
  if (!Number.isSafeInteger(total)) {
    throw new RangeError(`${name} exceed safe integer accounting.`);
  }
  return total;
}

function assertNonnegativeSafeInteger(name: string, value: number): void {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new RangeError(`${name} must be a non-negative safe integer.`);
  }
}

function compareCodeUnits(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}
