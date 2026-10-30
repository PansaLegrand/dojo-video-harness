export type TextMeasureCacheOptions = Readonly<{
  maxEntries?: number;
  /** Oversized keys are measured normally but never retained. */
  maxKeyBytes?: number;
}>;

export type TextMeasureCacheStats = Readonly<{
  entries: number;
  maxEntries: number;
  maxKeyBytes: number;
  hits: number;
  misses: number;
  sets: number;
  evictions: number;
  bypasses: number;
}>;

/** Structural 1.x input contract; plain caller-owned Maps remain valid. */
export type TextMeasureCache = Map<string, number>;

/** Public bounded LRU implementation for exact Canvas text widths. */
export class BoundedTextMeasureCache extends Map<string, number> {
  readonly #maxEntries: number;
  readonly #maxKeyBytes: number;
  #hits = 0;
  #misses = 0;
  #sets = 0;
  #evictions = 0;
  #bypasses = 0;

  constructor(options: TextMeasureCacheOptions = {}) {
    super();
    this.#maxEntries = options.maxEntries ?? 2_048;
    this.#maxKeyBytes = options.maxKeyBytes ?? 64 * 1_024;
    assertNonnegativeSafeInteger("maxEntries", this.#maxEntries);
    assertNonnegativeSafeInteger("maxKeyBytes", this.#maxKeyBytes);
  }

  override get(key: string): number | undefined {
    const value = super.get(key);
    if (value === undefined) {
      this.#misses += 1;
      return undefined;
    }
    super.delete(key);
    super.set(key, value);
    this.#hits += 1;
    return value;
  }

  override set(key: string, value: number): this {
    if (typeof key !== "string") {
      throw new TypeError("Text measure cache keys must be strings.");
    }
    if (!Number.isFinite(value) || value < 0) {
      throw new TypeError(
        "Text measure cache widths must be finite and non-negative.",
      );
    }
    if (
      this.#maxEntries === 0 ||
      utf8ByteLengthAtMost(key, this.#maxKeyBytes) === null
    ) {
      this.#bypasses += 1;
      return this;
    }
    if (super.has(key)) super.delete(key);
    super.set(key, value);
    this.#sets += 1;
    while (this.size > this.#maxEntries) {
      const oldest = this.keys().next().value as string | undefined;
      if (oldest === undefined) break;
      super.delete(oldest);
      this.#evictions += 1;
    }
    return this;
  }

  stats(): TextMeasureCacheStats {
    return Object.freeze({
      entries: this.size,
      maxEntries: this.#maxEntries,
      maxKeyBytes: this.#maxKeyBytes,
      hits: this.#hits,
      misses: this.#misses,
      sets: this.#sets,
      evictions: this.#evictions,
      bypasses: this.#bypasses,
    });
  }
}

function utf8ByteLengthAtMost(value: string, maximum: number): number | null {
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
    if (bytes > maximum) return null;
  }
  return bytes;
}

function assertNonnegativeSafeInteger(name: string, value: number): void {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new RangeError(`${name} must be a non-negative safe integer.`);
  }
}
