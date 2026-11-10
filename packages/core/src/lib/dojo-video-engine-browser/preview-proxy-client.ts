import type { Scene, SceneAsset } from "@dojo-video-engine/schema";
import {
  applyPreviewProxies,
  PREVIEW_PROXY_LIMITS,
  PREVIEW_PROXY_VERSION,
  previewProxyCandidates,
  previewProxyEntryName,
  previewProxyLockName,
  requiredPreviewProxyAssets,
  validatePreviewProxyManifest,
  type PreviewProxyManifest,
  type PreviewProxyRequest,
  type PreviewProxyResult,
} from "./preview-proxy-policy";
import { supportsLocalVideoProxy } from "./media-admission";

type Prepared = PreviewProxyResult & { releasePin(): void };
export type ReadyPreviewProxy = {
  url: string;
  manifest: PreviewProxyManifest;
  cached: boolean;
};
type PoolOptions = {
  prepare?: (
    request: PreviewProxyRequest,
    signal: AbortSignal,
  ) => Promise<Prepared | null>;
  createUrl?: (file: Blob) => string;
  revokeUrl?: (url: string) => void;
  delayMs?: number;
};
type Lease = { result: Promise<ReadyPreviewProxy | null>; release(): void };
type Entry = {
  key: string;
  request: PreviewProxyRequest;
  users: Set<() => boolean>;
  controller: AbortController;
  result: Promise<ReadyPreviewProxy | null>;
  resolve(value: ReadyPreviewProxy | null): void;
  ready?: ReadyPreviewProxy;
  releasePin?: () => void;
  started: boolean;
};

async function pinEntry(
  entry: string,
  signal: AbortSignal,
): Promise<() => void> {
  let release!: () => void;
  let acquired!: () => void;
  const ready = new Promise<void>((resolve) => {
    acquired = resolve;
  });
  const operation = navigator.locks.request(
    previewProxyLockName(entry),
    { mode: "shared", signal },
    async () => {
      const held = new Promise<void>((resolve) => {
        release = resolve;
      });
      acquired();
      await held;
    },
  );
  await Promise.race([
    ready,
    operation.then(() => {
      throw new Error("Preview proxy pin was not acquired.");
    }),
  ]);
  return release;
}

function supported() {
  return supportsLocalVideoProxy();
}

export async function preparePreviewProxyInWorker(
  request: PreviewProxyRequest,
  signal: AbortSignal,
  onSkip?: (reason: string) => void,
): Promise<Prepared | null> {
  if (!supported() || signal.aborted) return null;
  const worker = new Worker(
    new URL("./preview-proxy.worker.ts", import.meta.url),
    { type: "module", name: "dojo-video-engine-preview-proxy" },
  );
  return new Promise((resolve) => {
    let finished = false;
    const finish = (result: Prepared | null) => {
      if (finished) {
        result?.releasePin();
        return;
      }
      finished = true;
      clearTimeout(timer);
      signal.removeEventListener("abort", cancel);
      worker.terminate();
      resolve(result);
    };
    const cancel = () => finish(null);
    const timer = setTimeout(cancel, 90_000);
    signal.addEventListener("abort", cancel, { once: true });
    worker.onerror = worker.onmessageerror = () => finish(null);
    worker.onmessage = ({ data }) => {
      if (data?.type === "skipped") {
        onSkip?.(String(data.reason ?? "Proxy skipped."));
        finish(null);
        return;
      }
      if (data?.type !== "complete" || finished) return;
      void (async () => {
        let releasePin: (() => void) | undefined;
        try {
          const result = data.result as PreviewProxyResult;
          validatePreviewProxyManifest(result?.manifest, request);
          if (result.manifest.version !== PREVIEW_PROXY_VERSION)
            throw new Error(
              "Preview proxy transfer belongs to another cache policy.",
            );
          if (
            !(result.file instanceof Blob) ||
            result.file.size !== result.manifest.proxyBytes
          )
            throw new Error("Invalid proxy transfer.");
          // Worker still holds its shared pin until this second pin is acquired.
          releasePin = await pinEntry(
            previewProxyEntryName(request.sourceHash),
            signal,
          );
          if (signal.aborted || finished) {
            releasePin();
            return;
          }
          worker.postMessage({ type: "accepted" });
          finish({ ...result, releasePin });
        } catch {
          releasePin?.();
          finish(null);
        }
      })();
    };
    if (signal.aborted) cancel();
    else worker.postMessage({ type: "prepare", request });
  });
}

/** One bounded queue per page; the worker also serializes across tabs with Web Locks. */
export class PreviewProxyPool {
  private entries = new Map<string, Entry>();
  private active: Entry | null = null;
  private timer: ReturnType<typeof setTimeout> | undefined;
  private readyListeners = new Set<(request: PreviewProxyRequest) => void>();
  constructor(private readonly options: PoolOptions = {}) {}
  subscribeReady(listener: (request: PreviewProxyRequest) => void): () => void {
    this.readyListeners.add(listener);
    return () => {
      this.readyListeners.delete(listener);
    };
  }
  retainReady(
    assetId: string,
    src: string,
  ): (ReadyPreviewProxy & { release(): void }) | null {
    const entry = [...this.entries.values()].find(
      (value) =>
        value.request.assetId === assetId &&
        value.request.src === src &&
        value.ready &&
        !value.controller.signal.aborted,
    );
    if (!entry?.ready) return null;
    const lease = this.acquire(entry.request, () => false);
    return { ...entry.ready, release: lease.release };
  }
  acquire(request: PreviewProxyRequest, canStart = () => true): Lease {
    const key = `${request.sourceHash}:${request.src}`;
    let entry = this.entries.get(key);
    if (!entry) {
      if (this.entries.size >= PREVIEW_PROXY_LIMITS.pendingEntries)
        return { result: Promise.resolve(null), release() {} };
      let resolve!: (value: ReadyPreviewProxy | null) => void;
      const result = new Promise<ReadyPreviewProxy | null>((done) => {
        resolve = done;
      });
      entry = {
        key,
        request,
        users: new Set(),
        controller: new AbortController(),
        result,
        resolve,
        started: false,
      };
      this.entries.set(key, entry);
    }
    const permission = () => canStart();
    entry.users.add(permission);
    this.kick();
    let released = false;
    return {
      result: entry.result,
      release: () => {
        if (released) return;
        released = true;
        entry!.users.delete(permission);
        if (entry!.users.size) return;
        entry!.controller.abort();
        entry!.resolve(null);
        this.entries.delete(key);
        if (entry!.ready)
          (this.options.revokeUrl ?? URL.revokeObjectURL)(entry!.ready.url);
        entry!.releasePin?.();
        this.kick();
      },
    };
  }
  kick() {
    if (this.active || this.timer !== undefined) return;
    this.timer = setTimeout(() => {
      this.timer = undefined;
      const entry = [...this.entries.values()].find(
        (value) => !value.started && [...value.users].some((allow) => allow()),
      );
      if (!entry) return;
      entry.started = true;
      this.active = entry;
      void (this.options.prepare ?? preparePreviewProxyInWorker)(
        entry.request,
        entry.controller.signal,
      )
        .then((result) => {
          if (!result) {
            entry.resolve(null);
            return;
          }
          if (entry.controller.signal.aborted || !entry.users.size) {
            result.releasePin();
            entry.resolve(null);
            return;
          }
          try {
            entry.ready = {
              url: (this.options.createUrl ?? URL.createObjectURL)(result.file),
              manifest: result.manifest,
              cached: result.cached,
            };
          } catch (error) {
            result.releasePin();
            throw error;
          }
          entry.releasePin = result.releasePin;
          entry.resolve(entry.ready);
          for (const listener of this.readyListeners) {
            try {
              listener(entry.request);
            } catch {
              /* Observers do not own conversion completion. */
            }
          }
        })
        .catch(() => entry.resolve(null))
        .finally(() => {
          this.active = null;
          this.kick();
        });
    }, this.options.delayMs ?? 750);
  }
}

const sharedPool = new PreviewProxyPool();
export const retainReadyPreviewProxy = (assetId: string, src: string) =>
  sharedPool.retainReady(assetId, src);
export const subscribePreviewProxyReady = (
  listener: (request: PreviewProxyRequest) => void,
) => sharedPool.subscribeReady(listener);
export class DojoVideoEnginePreviewProxyManager {
  private entries = new Map<
    string,
    {
      request: PreviewProxyRequest;
      lease: Lease;
      ready?: ReadyPreviewProxy;
      adopted: boolean;
      failed: boolean;
    }
  >();
  private playing = false;
  private closed = false;
  private failedSources = new Set<string>();
  revision = 0;
  constructor(
    private readonly onReady: () => void,
    private readonly pool = sharedPool,
  ) {}
  setPlaying(playing: boolean) {
    this.playing = playing;
    let changed = false;
    if (!playing)
      for (const entry of this.entries.values())
        if (entry.ready && !entry.adopted) {
          entry.adopted = true;
          changed = true;
        }
    if (changed) {
      this.revision++;
      this.onReady();
    }
    this.pool.kick();
  }
  updateScene(scene: Scene, playing: boolean) {
    if (this.closed) return;
    const candidates = previewProxyCandidates(scene);
    const currentKeys = new Set(
      candidates.map((value) => `${value.sourceHash}:${value.src}`),
    );
    for (const key of this.failedSources)
      if (!currentKeys.has(key)) this.failedSources.delete(key);
    for (const [id, entry] of this.entries)
      if (
        !candidates.some(
          (candidate) =>
            candidate.assetId === id && candidate.src === entry.request.src,
        )
      ) {
        entry.lease.release();
        this.entries.delete(id);
        this.revision++;
      }
    this.setPlaying(playing);
    // Do not queue fresh decode/encode work during active playback.
    if (!playing)
      for (const request of candidates) {
        if (
          this.entries.has(request.assetId) ||
          this.failedSources.has(`${request.sourceHash}:${request.src}`)
        )
          continue;
        const lease = this.pool.acquire(
          request,
          () => !this.playing && !this.closed,
        );
        const entry = {
          request,
          lease,
          ready: undefined as ReadyPreviewProxy | undefined,
          adopted: false,
          failed: false,
        };
        this.entries.set(request.assetId, entry);
        void lease.result.then((ready) => {
          if (this.closed || this.entries.get(request.assetId) !== entry)
            return;
          if (!ready) {
            entry.failed = true;
            this.revision++;
            this.onReady();
            return;
          }
          entry.ready = ready;
          entry.adopted = !this.playing;
          this.revision++;
          this.onReady();
        });
      }
    this.pool.kick();
  }
  /** Imported high-resolution originals never become an implicit preview fallback. */
  readiness(scene: Scene): {
    status: "ready" | "preparing" | "error";
    assetIds: string[];
    reason?: "relink" | "geometry" | "budget" | "failed";
    message?: string;
  } {
    const required = requiredPreviewProxyAssets(scene);
    if (!required.length) return { status: "ready", assetIds: [] };
    const ids = required.map((asset) => asset.id);
    if (required.length > PREVIEW_PROXY_LIMITS.cacheEntries)
      return {
        status: "error",
        assetIds: ids,
        reason: "budget",
        message:
          "This preview supports up to four 4K sources. Use 1080p copies for additional clips.",
      };
    const candidates = new Set(
      previewProxyCandidates(scene).map((request) => request.assetId),
    );
    let preparing = false;
    for (const asset of required) {
      if (
        asset.proxy &&
        asset.proxy.width &&
        asset.proxy.height &&
        Math.max(asset.proxy.width, asset.proxy.height) <=
          PREVIEW_PROXY_LIMITS.targetEdge
      )
        continue;
      if (!asset.src.startsWith("blob:"))
        return {
          status: "error",
          assetIds: [asset.id],
          reason: "relink",
          message:
            "Relink the original 4K file on this device to prepare its local preview.",
        };
      if (!candidates.has(asset.id))
        return {
          status: "error",
          assetIds: [asset.id],
          reason: "geometry",
          message:
            "This 4K clip needs a fixed video size and compatible appearance settings for its local preview.",
        };
      const entry = this.entries.get(asset.id);
      if (
        entry?.failed ||
        this.failedSources.has(
          `${entry?.request.sourceHash ?? asset.id.replace(/^local:(?:sha256:)?/, "")}:${asset.src}`,
        )
      )
        return {
          status: "error",
          assetIds: [asset.id],
          reason: "failed",
          message:
            "The local 4K preview could not be prepared. Relink the source or use a 1080p copy.",
        };
      if (!entry?.ready || !entry.adopted) preparing = true;
    }
    return { status: preparing ? "preparing" : "ready", assetIds: ids };
  }
  scene(scene: Scene): Scene {
    const eligible = new Set(
      previewProxyCandidates(scene).map((value) => value.assetId),
    );
    const proxies = new Map<
      string,
      { originalSrc: string; proxy: NonNullable<SceneAsset["proxy"]> }
    >();
    for (const [id, entry] of this.entries)
      if (entry.ready && entry.adopted && eligible.has(id))
        proxies.set(id, {
          originalSrc: entry.request.src,
          proxy: {
            src: entry.ready.url,
            width: entry.ready.manifest.width,
            height: entry.ready.manifest.height,
            bitrate: PREVIEW_PROXY_LIMITS.bitrate,
          },
        });
    return applyPreviewProxies(scene, proxies);
  }
  /** Renderer lifetime may outlast UI source selection; keep its files pinned. */
  retainScene(scene: Scene): () => void {
    const leases: Lease[] = [];
    for (const [id, entry] of this.entries)
      if (entry.ready && scene.assets[id]?.proxy?.src === entry.ready.url)
        leases.push(this.pool.acquire(entry.request, () => false));
    return () => leases.forEach((lease) => lease.release());
  }
  rejectScene(scene: Scene) {
    for (const [id, entry] of this.entries)
      if (entry.ready && scene.assets[id]?.proxy?.src === entry.ready.url) {
        this.failedSources.add(
          `${entry.request.sourceHash}:${entry.request.src}`,
        );
        entry.lease.release();
        this.entries.delete(id);
        this.revision++;
      }
  }
  dispose() {
    if (this.closed) return;
    this.closed = true;
    for (const entry of this.entries.values()) entry.lease.release();
    this.entries.clear();
  }
}
