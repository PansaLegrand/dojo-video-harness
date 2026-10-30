/**
 * Host-owned media policy and bounded cache primitives.
 *
 * This module deliberately has no dependency on the renderer. It can be
 * used by direct fetch based decoders as well as a range reader such as
 * Mediabunny's UrlSource `fetchFn`.
 */

export type MediaAssetLike = {
  id: string;
  type?: string;
  src: string;
  proxy?: { src: string; [key: string]: unknown };
  metadata?: {
    byteLength?: number;
    mime?: string;
    contentType?: string;
    [key: string]: unknown;
  };
};

export type AssetSource =
  | string
  | { src: string; headers?: HeadersInit; credentials?: RequestCredentials };

export type AssetPolicyContext = {
  asset: MediaAssetLike;
  source: string;
  url: URL | null;
  signal?: AbortSignal;
  attempt: number;
};

export type AssetRequestContext = AssetPolicyContext & {
  request: RequestInit;
};

export type AssetFetch = (
  input: RequestInfo | URL,
  init?: RequestInit,
) => Promise<Response>;

export type AssetPolicy = {
  /**
   * Stable host policy generation for decoded-resource reuse. Rotate this
   * whenever credentials, authorization, response validation, or fetch
   * semantics change. Without it, reuse is scoped to this policy object's
   * identity.
   */
  reuseKey?: string;
  /** Resolve a host-derived proxy. Returning null explicitly disables proxy use. */
  resolveProxy?: (
    asset: MediaAssetLike,
    context: { signal?: AbortSignal },
  ) => AssetSource | null | undefined | Promise<AssetSource | null | undefined>;
  /** Refresh a signed source after an authentication/authorization response. */
  refreshSignedUrl?: (
    context: AssetRequestContext,
    response: Response,
  ) => AssetSource | null | undefined | Promise<AssetSource | null | undefined>;
  /** Additional host authorization after the declarative scheme/origin checks. */
  authorizeSource?: (
    context: AssetPolicyContext,
  ) => boolean | void | Promise<boolean | void>;
  /** Stable host identity used across signed-URL rotation and compatibility checks. */
  contentKey?: (context: AssetPolicyContext) => string | Promise<string>;
  allowedSchemes?: readonly string[];
  allowedOrigins?: readonly (string | RegExp)[];
  allowedHosts?: readonly (string | RegExp)[];
  credentials?:
    | RequestCredentials
    | ((context: AssetPolicyContext) => RequestCredentials | undefined);
  headers?:
    | HeadersInit
    | ((context: AssetPolicyContext) => HeadersInit | undefined);
  fetch?: AssetFetch;
  /** Reject or annotate responses before their body is read. */
  validateResponse?: (
    response: Response,
    context: AssetRequestContext,
  ) => void | Promise<void>;
  /** MIME allow-list. Omitted content types are accepted for compatibility. */
  allowedMimeTypes?:
    | readonly string[]
    | ((context: AssetRequestContext) => readonly string[] | undefined);
  /** Maximum bytes for one asset. This also bounds a fetch wrapper cumulatively. */
  maxBytes?:
    | number
    | ((
        asset: MediaAssetLike,
        context: { source: string },
      ) => number | undefined);
};

export type PrepareAssetRequestOptions = {
  policy?: AssetPolicy;
  signal?: AbortSignal;
  preferProxy?: boolean;
  /** Used by range-fetch wrappers; defaults to the prepared source. */
  source?: AssetSource;
  requestInit?: RequestInit;
  attempt?: number;
  sourceKind?: AssetSourceKind;
  declarationKey?: string;
};

export type AssetSourceKind =
  | "primary"
  | "declared-proxy"
  | "derived-proxy"
  | "override";

export type PreparedAssetRequest = {
  asset: MediaAssetLike;
  source: string;
  url: URL | null;
  init: RequestInit;
  maxBytes?: number;
  policy: AssetPolicy;
  attempt: number;
  contentKey: string;
  sourceKind: AssetSourceKind;
  declarationKey: string;
};

export type AssetByteBudget = {
  readonly limit?: number;
  consumed: number;
};

export class AssetPolicyError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = "AssetPolicyError";
  }
}

function throwIfAborted(signal?: AbortSignal): void {
  if (!signal?.aborted) return;
  throw abortReason(signal);
}

function abortReason(signal: AbortSignal): Error {
  if (signal.reason instanceof Error) return signal.reason;
  if (typeof DOMException === "function") {
    return new DOMException("The media request was aborted.", "AbortError");
  }
  const error = new Error("The media request was aborted.");
  error.name = "AbortError";
  return error;
}

async function readWithAbort(
  reader: ReadableStreamDefaultReader<Uint8Array>,
  signal?: AbortSignal,
): Promise<ReadableStreamReadResult<Uint8Array>> {
  throwIfAborted(signal);
  if (!signal) return reader.read();
  let listener!: () => void;
  const aborted = new Promise<never>((_resolve, reject) => {
    listener = () => {
      const reason = abortReason(signal);
      reject(reason);
      void reader.cancel(reason).catch(() => undefined);
    };
    signal.addEventListener("abort", listener, { once: true });
  });
  try {
    return await Promise.race([reader.read(), aborted]);
  } finally {
    signal.removeEventListener("abort", listener);
  }
}

async function awaitAbortable<T>(
  operation: T | Promise<T>,
  signal?: AbortSignal,
): Promise<T> {
  throwIfAborted(signal);
  const pending = Promise.resolve(operation);
  if (!signal) return pending;
  let listener!: () => void;
  const aborted = new Promise<never>((_resolve, reject) => {
    listener = () => reject(abortReason(signal));
    signal.addEventListener("abort", listener, { once: true });
  });
  try {
    return await Promise.race([pending, aborted]);
  } finally {
    signal.removeEventListener("abort", listener);
  }
}

function sourceValue(source: AssetSource): {
  src: string;
  headers?: HeadersInit;
  credentials?: RequestCredentials;
} {
  return typeof source === "string" ? { src: source } : source;
}

function asUrl(source: string): URL | null {
  try {
    return new URL(
      source,
      typeof location === "undefined" ? undefined : location.href,
    );
  } catch {
    return null;
  }
}

function matches(
  value: string,
  patterns: readonly (string | RegExp)[],
): boolean {
  return patterns.some((pattern) =>
    pattern instanceof RegExp ? pattern.test(value) : pattern === value,
  );
}

function mergeHeaders(...values: Array<HeadersInit | undefined>): Headers {
  const result = new Headers();
  for (const value of values) {
    if (value) new Headers(value).forEach((item, key) => result.set(key, item));
  }
  return result;
}

function resolveMaxBytes(
  asset: MediaAssetLike,
  source: string,
  policy: AssetPolicy,
): number | undefined {
  const value =
    typeof policy.maxBytes === "function"
      ? policy.maxBytes(asset, { source })
      : policy.maxBytes;
  if (value === undefined) return undefined;
  if (!Number.isFinite(value) || value < 0) {
    throw new AssetPolicyError(`Invalid byte ceiling for asset "${asset.id}".`);
  }
  return value;
}

function authorizeDeclarative(
  url: URL | null,
  policy: AssetPolicy,
  assetId: string,
): void {
  if (
    policy.allowedSchemes &&
    (!url || !matches(url.protocol.slice(0, -1), policy.allowedSchemes))
  ) {
    throw new AssetPolicyError(
      `Source scheme is not allowed for asset "${assetId}".`,
    );
  }
  if (
    policy.allowedOrigins &&
    (!url || !matches(url.origin, policy.allowedOrigins))
  ) {
    throw new AssetPolicyError(
      `Source origin is not allowed for asset "${assetId}".`,
    );
  }
  if (
    policy.allowedHosts &&
    (!url || !matches(url.hostname, policy.allowedHosts))
  ) {
    throw new AssetPolicyError(
      `Source host is not allowed for asset "${assetId}".`,
    );
  }
}

export function assetDeclarationKey(asset: MediaAssetLike): string {
  return typeof asset.metadata?.contentHash === "string"
    ? `content:${asset.metadata.contentHash}`
    : `primary:${asset.src}\u0000proxy:${asset.proxy?.src ?? ""}`;
}

async function resolveSource(
  asset: MediaAssetLike,
  options: PrepareAssetRequestOptions,
): Promise<{
  value: AssetSource;
  kind: AssetSourceKind;
  declarationKey: string;
}> {
  const policy = options.policy ?? {};
  throwIfAborted(options.signal);
  const declarationKey = options.declarationKey ?? assetDeclarationKey(asset);
  if (options.source !== undefined) {
    return {
      value: options.source,
      kind: options.sourceKind ?? "override",
      declarationKey,
    };
  }
  if (options.preferProxy) {
    const derived = await awaitAbortable(
      policy.resolveProxy?.(asset, { signal: options.signal }),
      options.signal,
    );
    if (derived === null) {
      return { value: asset.src, kind: "primary", declarationKey };
    }
    if (derived !== undefined) {
      return { value: derived, kind: "derived-proxy", declarationKey };
    }
    if (asset.proxy?.src) {
      return {
        value: asset.proxy.src,
        kind: "declared-proxy",
        declarationKey,
      };
    }
  }
  return { value: asset.src, kind: "primary", declarationKey };
}

/** Resolves proxy/source policy and constructs a fetch request. */
export async function prepareAssetRequest(
  asset: MediaAssetLike,
  options: PrepareAssetRequestOptions = {},
): Promise<PreparedAssetRequest> {
  const policy = options.policy ?? {};
  const selection = await resolveSource(asset, options);
  const resolved = sourceValue(selection.value);
  const source = resolved.src;
  const url = asUrl(source);
  authorizeDeclarative(url, policy, asset.id);
  const context: AssetPolicyContext = {
    asset,
    source,
    url,
    signal: options.signal,
    attempt: options.attempt ?? 0,
  };
  if (
    policy.authorizeSource &&
    (await awaitAbortable(policy.authorizeSource(context), options.signal)) ===
      false
  ) {
    throw new AssetPolicyError(
      `Source authorization rejected asset "${asset.id}".`,
    );
  }
  const contentKey =
    (await awaitAbortable(policy.contentKey?.(context), options.signal)) ??
    (typeof asset.metadata?.contentHash === "string"
      ? asset.metadata.contentHash
      : source);
  if (!contentKey.trim()) {
    throw new AssetPolicyError(
      `Content identity is empty for asset "${asset.id}".`,
    );
  }
  const headers = mergeHeaders(
    options.requestInit?.headers,
    typeof policy.headers === "function"
      ? policy.headers(context)
      : policy.headers,
    resolved.headers,
  );
  let hasHeaders = false;
  headers.forEach(() => {
    hasHeaders = true;
  });
  const credentials =
    resolved.credentials ??
    options.requestInit?.credentials ??
    (typeof policy.credentials === "function"
      ? policy.credentials(context)
      : policy.credentials);
  const restrictsDestination = Boolean(
    policy.allowedSchemes ||
    policy.allowedOrigins ||
    policy.allowedHosts ||
    policy.authorizeSource,
  );
  const requestedRedirect = options.requestInit?.redirect;
  const redirect = restrictsDestination
    ? requestedRedirect === "manual"
      ? "manual"
      : "error"
    : requestedRedirect;
  const init: RequestInit = {
    ...options.requestInit,
    ...(hasHeaders ? { headers } : {}),
    ...(credentials ? { credentials } : {}),
    ...(redirect ? { redirect } : {}),
    ...(options.signal ? { signal: options.signal } : {}),
  };
  const maxBytes = resolveMaxBytes(asset, source, policy);
  const declared = asset.metadata?.byteLength;
  if (maxBytes !== undefined && declared !== undefined && declared > maxBytes) {
    throw new AssetPolicyError(
      `Declared size for asset "${asset.id}" exceeds its ${maxBytes}-byte limit.`,
    );
  }
  return {
    asset,
    source,
    url,
    init,
    maxBytes,
    policy,
    attempt: options.attempt ?? 0,
    contentKey,
    sourceKind: selection.kind,
    declarationKey: selection.declarationKey,
  };
}

function validateMime(response: Response, request: PreparedAssetRequest): void {
  const configured =
    typeof request.policy.allowedMimeTypes === "function"
      ? request.policy.allowedMimeTypes({ ...request, request: request.init })
      : request.policy.allowedMimeTypes;
  if (!configured) return;
  const contentType = response.headers
    .get("content-type")
    ?.split(";", 1)[0]
    ?.trim()
    .toLowerCase();
  if (
    contentType &&
    !configured.some((value) => value.toLowerCase() === contentType)
  ) {
    throw new AssetPolicyError(
      `MIME type ${contentType} is not allowed for asset "${request.asset.id}".`,
    );
  }
}

function responseLength(response: Response): number | undefined {
  const value = response.headers.get("content-length");
  if (!value) return undefined;
  const length = Number(value);
  return Number.isFinite(length) && length >= 0 ? length : undefined;
}

function responseTotalLength(response: Response): number | undefined {
  const total = response.headers
    .get("content-range")
    ?.match(/\/([0-9]+)$/)?.[1];
  if (!total) return undefined;
  const parsed = Number(total);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : undefined;
}

function assertTotalLength(response: Response, limit?: number): void {
  const total = responseTotalLength(response);
  if (total !== undefined && limit !== undefined && total > limit) {
    throw new AssetPolicyError(
      `Asset total size exceeds the ${limit}-byte media limit.`,
    );
  }
}

function makeBudget(
  limit: number | undefined,
  budget?: AssetByteBudget,
): AssetByteBudget {
  return budget ?? { limit, consumed: 0 };
}

function assertLength(
  length: number | undefined,
  budget: AssetByteBudget,
): void {
  if (
    length !== undefined &&
    budget.limit !== undefined &&
    budget.consumed + length > budget.limit
  ) {
    throw new AssetPolicyError(
      `Response exceeds the ${budget.limit}-byte media limit.`,
    );
  }
}

/** Reads a response body with header, stream, and AbortSignal enforcement. */
export async function readResponseBytes(
  response: Response,
  options: {
    maxBytes?: number;
    signal?: AbortSignal;
    budget?: AssetByteBudget;
  } = {},
): Promise<Uint8Array> {
  const budget = makeBudget(options.maxBytes, options.budget);
  throwIfAborted(options.signal);
  assertTotalLength(response, budget.limit);
  assertLength(responseLength(response), budget);
  if (!response.body) {
    const bytes = new Uint8Array(await response.arrayBuffer());
    assertLength(bytes.byteLength, budget);
    budget.consumed += bytes.byteLength;
    return bytes;
  }
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  let completed = false;
  try {
    for (;;) {
      throwIfAborted(options.signal);
      const result = await readWithAbort(reader, options.signal);
      if (result.done) break;
      const chunk = result.value;
      size += chunk.byteLength;
      assertLength(size, budget);
      chunks.push(chunk);
    }
    completed = true;
  } finally {
    if (!completed || options.signal?.aborted)
      await reader.cancel(options.signal?.reason).catch(() => undefined);
    else reader.releaseLock();
  }
  budget.consumed += size;
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes;
}

/** Fetches one asset and validates its response before returning it. */
export async function fetchAssetBounded(
  asset: MediaAssetLike,
  options: PrepareAssetRequestOptions = {},
): Promise<Response> {
  let request = await prepareAssetRequest(asset, options);
  const fetchFn = request.policy.fetch ?? fetch;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const effectiveSignal = options.signal ?? request.init.signal ?? undefined;
    throwIfAborted(effectiveSignal);
    const response = await fetchWithAbort(
      fetchFn,
      request.source,
      request.init,
      effectiveSignal,
    );
    const context: AssetRequestContext = {
      ...request,
      request: request.init,
      signal: effectiveSignal,
      attempt,
    };
    if (
      (response.status === 401 || response.status === 403) &&
      request.policy.refreshSignedUrl &&
      attempt === 0
    ) {
      let refreshed: AssetSource | null | undefined;
      try {
        refreshed = await awaitAbortable(
          request.policy.refreshSignedUrl(context, response),
          effectiveSignal,
        );
      } catch (error) {
        await response.body?.cancel(error).catch(() => undefined);
        throw error;
      }
      if (refreshed) {
        await response.body?.cancel().catch(() => undefined);
        request = await prepareAssetRequest(asset, {
          ...options,
          source: refreshed,
          signal: effectiveSignal,
          attempt: 1,
        });
        continue;
      }
    }
    try {
      if (!response.ok) {
        throw new AssetPolicyError(
          `HTTP ${response.status} while loading asset "${asset.id}".`,
        );
      }
      await authorizeRedirect(response, request, effectiveSignal);
      validateMime(response, request);
      await awaitAbortable(
        request.policy.validateResponse?.(response, context),
        effectiveSignal,
      );
      const budget = makeBudget(request.maxBytes);
      assertTotalLength(response, request.maxBytes);
      assertLength(responseLength(response), budget);
      return wrapResponseBody(response, budget, effectiveSignal);
    } catch (error) {
      await response.body?.cancel(error).catch(() => undefined);
      throw error;
    }
  }
  throw new AssetPolicyError(
    `Signed source refresh failed for asset "${asset.id}".`,
  );
}

async function fetchWithAbort(
  fetchFn: AssetFetch,
  input: RequestInfo | URL,
  init: RequestInit,
  signal?: AbortSignal,
): Promise<Response> {
  throwIfAborted(signal);
  const pending = Promise.resolve().then(() => fetchFn(input, init));
  if (!signal) return pending;
  return new Promise<Response>((resolve, reject) => {
    let aborted = false;
    const onAbort = () => {
      aborted = true;
      const reason = abortReason(signal);
      reject(reason);
      void pending.then(
        (response) => response.body?.cancel(reason).catch(() => undefined),
        () => undefined,
      );
    };
    signal.addEventListener("abort", onAbort, { once: true });
    void pending.then(
      (response) => {
        signal.removeEventListener("abort", onAbort);
        if (!aborted) resolve(response);
      },
      (error) => {
        signal.removeEventListener("abort", onAbort);
        if (!aborted) reject(error);
      },
    );
  });
}

async function authorizeRedirect(
  response: Response,
  request: PreparedAssetRequest,
  signal?: AbortSignal,
): Promise<void> {
  if (!response.url || response.url === request.source) return;
  const url = asUrl(response.url);
  authorizeDeclarative(url, request.policy, request.asset.id);
  const context: AssetPolicyContext = {
    asset: request.asset,
    source: response.url,
    url,
    signal,
    attempt: request.attempt,
  };
  if (
    request.policy.authorizeSource &&
    (await awaitAbortable(request.policy.authorizeSource(context), signal)) ===
      false
  ) {
    throw new AssetPolicyError(
      `Redirect authorization rejected asset "${request.asset.id}".`,
    );
  }
}

function wrapResponseBody(
  response: Response,
  budget: AssetByteBudget,
  signal?: AbortSignal,
): Response {
  if (!response.body || typeof ReadableStream === "undefined") return response;
  const reader = response.body.getReader();
  const body = new ReadableStream<Uint8Array>({
    async pull(controller) {
      try {
        throwIfAborted(signal);
        const result = await readWithAbort(reader, signal);
        if (result.done) {
          controller.close();
          return;
        }
        assertLength(result.value.byteLength, budget);
        budget.consumed += result.value.byteLength;
        controller.enqueue(result.value);
      } catch (error) {
        await reader.cancel(error).catch(() => undefined);
        controller.error(error);
      }
    },
    async cancel(reason) {
      await reader.cancel(reason).catch(() => undefined);
    },
  });
  return new Response(body, {
    status: response.status,
    statusText: response.statusText,
    headers: response.headers,
  });
}

/** Creates a fetchFn suitable for a range reader such as Mediabunny UrlSource. */
export function createBoundedAssetFetch(
  asset: MediaAssetLike,
  options: PrepareAssetRequestOptions = {},
): AssetFetch {
  const budgetPromise = prepareAssetRequest(asset, options);
  let budget: AssetByteBudget | undefined;
  return async (input, init) => {
    const prepared = await budgetPromise;
    budget ??= makeBudget(prepared.maxBytes);
    const normalized =
      typeof Request === "function" && input instanceof Request
        ? new Request(input, init)
        : null;
    const requestUrl = normalized?.url ?? String(input);
    const requestInit = normalized ? requestInitFromRequest(normalized) : init;
    const request = await prepareAssetRequest(asset, {
      ...options,
      source: requestUrl,
      requestInit,
    });
    const response = await fetchAssetBounded(asset, {
      ...options,
      source: request.source,
      requestInit: request.init,
    });
    assertLength(responseLength(response), budget);
    return wrapResponseBody(response, budget, options.signal);
  };
}

function requestInitFromRequest(request: Request): RequestInit {
  return {
    method: request.method,
    headers: request.headers,
    cache: request.cache,
    credentials: request.credentials,
    integrity: request.integrity,
    keepalive: request.keepalive,
    mode: request.mode,
    redirect: request.redirect,
    referrer: request.referrer,
    referrerPolicy: request.referrerPolicy,
    signal: request.signal,
  };
}

export type CacheStats = {
  entries: number;
  bytes: number;
  maxBytes: number;
  hits: number;
  misses: number;
  evictions: number;
  pending: number;
  maxPending?: number;
};

export type CacheValueSize<V> = (value: V, key: string) => number;

function estimateValueBytes(value: unknown, seen = new Set<object>()): number {
  if (value === null || value === undefined) return 0;
  if (typeof value !== "object") return 8;
  if (seen.has(value)) return 0;
  seen.add(value);
  if (ArrayBuffer.isView(value)) return value.byteLength;
  if (value instanceof ArrayBuffer) return value.byteLength;
  if (Array.isArray(value))
    return value.reduce((sum, item) => sum + estimateValueBytes(item, seen), 0);
  return Object.entries(value).reduce(
    (sum, [key, child]) =>
      sum + key.length * 2 + estimateValueBytes(child, seen),
    0,
  );
}

/** A Map-shaped LRU cache with a hard byte budget. */
export class AudioAnalysisCache<V = unknown> implements Map<string, V> {
  readonly [Symbol.toStringTag] = "Map";
  private readonly items = new Map<string, { value: V; bytes: number }>();
  private bytesUsed = 0;
  private hitCount = 0;
  private missCount = 0;
  private evictionCount = 0;
  private readonly pendingLoads = new Map<string, Promise<V>>();
  private readonly measure: CacheValueSize<V>;

  constructor(
    readonly maxBytes = 64 * 1024 * 1024,
    byteSize?: CacheValueSize<V>,
    readonly maxPending = 8,
  ) {
    if (!Number.isFinite(maxBytes) || maxBytes < 0)
      throw new Error("maxBytes must be non-negative.");
    this.measure = byteSize ?? ((value) => estimateValueBytes(value));
    if (!Number.isInteger(maxPending) || maxPending < 1) {
      throw new Error("maxPending must be a positive integer.");
    }
  }

  get size(): number {
    return this.items.size;
  }
  get stats(): CacheStats {
    return {
      entries: this.size,
      bytes: this.bytesUsed,
      maxBytes: this.maxBytes,
      hits: this.hitCount,
      misses: this.missCount,
      evictions: this.evictionCount,
      pending: this.pendingLoads.size,
      maxPending: this.maxPending,
    };
  }
  get(key: string): V | undefined {
    const entry = this.items.get(key);
    if (!entry) {
      this.missCount += 1;
      return undefined;
    }
    this.hitCount += 1;
    this.items.delete(key);
    this.items.set(key, entry);
    return entry.value;
  }
  has(key: string): boolean {
    return this.items.has(key);
  }
  set(key: string, value: V): this {
    const bytes = this.measure(value, key);
    if (!Number.isFinite(bytes) || bytes < 0)
      throw new Error(`Invalid size for cache entry "${key}".`);
    if (bytes > this.maxBytes) return this;
    const prior = this.items.get(key);
    if (prior) {
      this.bytesUsed -= prior.bytes;
      this.items.delete(key);
    }
    while (this.items.size > 0 && this.bytesUsed + bytes > this.maxBytes) {
      const oldest = this.items.keys().next().value as string | undefined;
      if (oldest === undefined) break;
      const removed = this.items.get(oldest);
      this.items.delete(oldest);
      this.bytesUsed -= removed?.bytes ?? 0;
      this.evictionCount += 1;
    }
    this.items.set(key, { value, bytes });
    this.bytesUsed += bytes;
    return this;
  }
  async getOrCreate(key: string, loader: () => V | Promise<V>): Promise<V> {
    if (this.items.has(key)) return this.get(key) as V;
    const pending = this.pendingLoads.get(key);
    if (pending) {
      this.hitCount += 1;
      return pending;
    }
    if (this.pendingLoads.size >= this.maxPending) {
      throw new Error(
        `Audio analysis cache has reached its ${this.maxPending}-load pending limit.`,
      );
    }
    this.missCount += 1;
    const loading = Promise.resolve()
      .then(loader)
      .then((value) => {
        this.set(key, value);
        return value;
      })
      .finally(() => this.pendingLoads.delete(key));
    this.pendingLoads.set(key, loading);
    return loading;
  }
  delete(key: string): boolean {
    const entry = this.items.get(key);
    if (!entry) return false;
    this.items.delete(key);
    this.bytesUsed -= entry.bytes;
    return true;
  }
  clear(): void {
    this.items.clear();
    this.bytesUsed = 0;
  }
  keys(): IterableIterator<string> {
    return this.items.keys();
  }
  values(): IterableIterator<V> {
    return Array.from(this.items.values(), (entry) => entry.value)[
      Symbol.iterator
    ]();
  }
  entries(): IterableIterator<[string, V]> {
    return Array.from(
      this.items,
      ([key, entry]) => [key, entry.value] as [string, V],
    )[Symbol.iterator]();
  }
  forEach(
    callback: (value: V, key: string, map: Map<string, V>) => void,
    thisArg?: unknown,
  ): void {
    this.items.forEach((entry, key) =>
      callback.call(
        thisArg,
        entry.value,
        key,
        this as unknown as Map<string, V>,
      ),
    );
  }
  [Symbol.iterator](): IterableIterator<[string, V]> {
    return this.entries();
  }
}

export type FontSetLike<F> = {
  add(face: F): unknown;
  delete?: (face: F) => boolean;
  remove?: (face: F) => boolean;
};
export type FontCacheStats = CacheStats & { activeLeases: number };
export type FontLease<F> = { readonly face: F; release(): void };

type FontEntry<F> = { face: F; bytes: number; refs: number };

/** Reference-counted font cache. Faces leave the FontFaceSet only after eviction. */
export class FontAssetCache<F = FontFace> {
  private readonly entries = new Map<string, FontEntry<F>>();
  private readonly pending = new Map<string, Promise<FontEntry<F>>>();
  private readonly pendingRefs = new Map<string, number>();
  private bytesUsed = 0;
  private hits = 0;
  private misses = 0;
  private evictions = 0;
  private active = 0;

  constructor(
    private readonly options: {
      maxEntries: number;
      maxBytes?: number;
      fontSet?: FontSetLike<F>;
      byteSize?: CacheValueSize<F>;
    },
  ) {
    if (!Number.isInteger(options.maxEntries) || options.maxEntries < 1)
      throw new Error("maxEntries must be positive.");
    if (
      options.maxBytes !== undefined &&
      (!Number.isFinite(options.maxBytes) || options.maxBytes < 0)
    )
      throw new Error("maxBytes must be non-negative.");
  }

  get size(): number {
    return this.entries.size;
  }
  get stats(): FontCacheStats {
    return {
      entries: this.size,
      bytes: this.bytesUsed,
      maxBytes: this.options.maxBytes ?? Number.POSITIVE_INFINITY,
      hits: this.hits,
      misses: this.misses,
      evictions: this.evictions,
      activeLeases: this.active,
      pending: this.pending.size,
      maxPending: this.options.maxEntries,
    };
  }

  async acquire(
    key: string,
    loader: () => F | Promise<F>,
    bytes?: number,
  ): Promise<FontLease<F>> {
    let entry = this.entries.get(key);
    if (entry) {
      this.hits += 1;
      entry.refs += 1;
      this.active += 1;
      this.entries.delete(key);
      this.entries.set(key, entry);
      return this.lease(key, entry);
    }
    this.misses += 1;
    let loading = this.pending.get(key);
    if (!loading) {
      const expectedBytes = bytes ?? 0;
      this.ensureCapacity(expectedBytes, true);
      loading = Promise.resolve()
        .then(loader)
        .then((face) => {
          const actualBytes = bytes ?? this.options.byteSize?.(face, key) ?? 0;
          if (!Number.isFinite(actualBytes) || actualBytes < 0)
            throw new Error(`Invalid size for font "${key}".`);
          this.ensureCapacity(actualBytes, false);
          const created: FontEntry<F> = {
            face,
            bytes: actualBytes,
            refs: this.pendingRefs.get(key) ?? 1,
          };
          this.options.fontSet?.add(face);
          this.entries.set(key, created);
          this.bytesUsed += actualBytes;
          this.evict();
          return created;
        })
        .finally(() => {
          this.pending.delete(key);
          this.pendingRefs.delete(key);
        });
      this.pending.set(key, loading);
    }
    this.active += 1;
    this.pendingRefs.set(key, (this.pendingRefs.get(key) ?? 0) + 1);
    try {
      entry = await loading;
      return this.lease(key, entry);
    } catch (error) {
      this.active = Math.max(0, this.active - 1);
      throw error;
    }
  }

  private lease(key: string, entry: FontEntry<F>): FontLease<F> {
    let released = false;
    return {
      face: entry.face,
      release: () => {
        if (released) return;
        released = true;
        entry.refs = Math.max(0, entry.refs - 1);
        this.active = Math.max(0, this.active - 1);
        this.evict();
      },
    };
  }

  private ensureCapacity(
    incomingBytes: number,
    reserveNewPending: boolean,
  ): void {
    if (incomingBytes > (this.options.maxBytes ?? Number.POSITIVE_INFINITY))
      throw new Error("Font exceeds cache byte budget.");
    const pendingReservations = this.pending.size + (reserveNewPending ? 1 : 0);
    this.evict(pendingReservations, incomingBytes);
    if (
      this.entries.size + pendingReservations > this.options.maxEntries ||
      (this.options.maxBytes !== undefined &&
        this.bytesUsed + incomingBytes > this.options.maxBytes)
    )
      throw new Error("Font cache has no evictable capacity.");
  }

  private evict(requiredEntries = 0, incomingBytes = 0): void {
    while (
      this.entries.size + requiredEntries > this.options.maxEntries ||
      (this.options.maxBytes !== undefined &&
        this.bytesUsed + incomingBytes > this.options.maxBytes)
    ) {
      const candidate = Array.from(this.entries.entries()).find(
        ([, entry]) => entry.refs === 0,
      );
      if (!candidate) return;
      const [key, entry] = candidate;
      this.entries.delete(key);
      this.bytesUsed -= entry.bytes;
      this.evictions += 1;
      if (this.options.fontSet?.delete) this.options.fontSet.delete(entry.face);
      else this.options.fontSet?.remove?.(entry.face);
    }
  }
}

export function createAudioAnalysisCache<V = unknown>(
  maxBytes?: number,
  byteSize?: CacheValueSize<V>,
  maxPending?: number,
): AudioAnalysisCache<V> {
  return new AudioAnalysisCache(maxBytes, byteSize, maxPending);
}
