import { inspectScene, parseScene, type Scene } from "@dojo-video-engine/schema";
import {
  BoundedTextMeasureCache,
  disposeAssetsAsync,
  prepareFrame,
  renderStill,
  resolveAssets,
  type ResolvedAssets,
  type ResolveAssetsOptions,
  type ScratchSurfacePool,
  type Canvas2DStaticDisplayCache,
  type Canvas2DOpaqueExtensionRegistry,
  type TextMeasureCache,
} from "@dojo-video-engine/renderer-canvas2d";
import {
  withCanvas2DResolvedAssets,
  type Canvas2DSceneRuntime,
} from "@dojo-video-engine/renderer-canvas2d/runtime";
import {
  ChunkedWebAudioPreview,
  WebAudioPreview,
  type AudioPreview,
} from "./audio";

export {
  ChunkedWebAudioPreview,
  previewAudioChunkRange,
  WebAudioPreview,
  type AudioPreview,
} from "./audio";

/**
 * Maps wall-clock time to scene frames. This is the only place in the
 * playback path where wall-clock time exists: rendering stays a pure function
 * of (scene, frame). The clock is pure given injected timestamps, so playback
 * timing is unit-testable without timers.
 *
 * Frames are integers in [0, durationInFrames). While playing, the frame at
 * time `now` is anchored to the play() position: floor((now − anchorTime) /
 * 1000 × fps) + anchorFrame. Pausing re-anchors; seeking re-anchors while
 * preserving play state.
 */
export class FrameClock {
  readonly fps: number;
  readonly durationInFrames: number;
  loop: boolean;

  private anchorFrame = 0;
  private anchorTime = 0;
  private isPlaying = false;

  constructor(options: {
    fps: number;
    durationInFrames: number;
    loop?: boolean;
  }) {
    if (options.fps <= 0 || !Number.isFinite(options.fps)) {
      throw new Error(
        `FrameClock fps must be a positive number, got ${options.fps}.`,
      );
    }
    if (
      !Number.isInteger(options.durationInFrames) ||
      options.durationInFrames <= 0
    ) {
      throw new Error(
        `FrameClock durationInFrames must be a positive integer, got ${options.durationInFrames}.`,
      );
    }

    this.fps = options.fps;
    this.durationInFrames = options.durationInFrames;
    this.loop = options.loop ?? false;
  }

  get playing(): boolean {
    return this.isPlaying;
  }

  /** Starts (or restarts) playback at the current frame position. */
  play(now: number): void {
    if (this.isPlaying) {
      return;
    }

    // Playing from the final frame restarts from 0 — the universal
    // player-button expectation.
    if (!this.loop && this.anchorFrame >= this.durationInFrames - 1) {
      this.anchorFrame = 0;
    }

    this.anchorTime = now;
    this.isPlaying = true;
  }

  /** Freezes the clock at the frame visible at `now`. */
  pause(now: number): void {
    if (!this.isPlaying) {
      return;
    }

    this.anchorFrame = this.frameAt(now).frame;
    this.isPlaying = false;
  }

  /** Jumps to a frame (clamped to the scene range), preserving play state. */
  seek(frame: number, now: number): void {
    this.anchorFrame = Math.min(
      Math.max(Math.floor(frame), 0),
      this.durationInFrames - 1,
    );
    this.anchorTime = now;
  }

  /**
   * The frame visible at wall time `now`, and whether non-looping playback
   * has run past the final frame. Calling this never mutates the clock;
   * the caller decides what to do at the end (pause, loop is internal).
   */
  frameAt(now: number): { frame: number; ended: boolean } {
    if (!this.isPlaying) {
      return { frame: this.anchorFrame, ended: false };
    }

    const elapsed = Math.max(0, now - this.anchorTime);
    const advanced = Math.floor((elapsed / 1000) * this.fps) + this.anchorFrame;

    if (advanced < this.durationInFrames) {
      return { frame: advanced, ended: false };
    }

    if (this.loop) {
      return { frame: advanced % this.durationInFrames, ended: false };
    }

    return { frame: this.durationInFrames - 1, ended: true };
  }
}

export type PlayerEvent = "frame" | "play" | "pause" | "ended";

async function waitForPlayerOperation<T>(
  operation: Promise<T>,
  signal?: AbortSignal,
): Promise<T> {
  if (!signal) return operation;
  if (signal.aborted) throw signal.reason;
  let listener!: () => void;
  const aborted = new Promise<never>((_resolve, reject) => {
    listener = () =>
      reject(
        signal.reason instanceof Error
          ? signal.reason
          : new Error("Player operation aborted."),
      );
    signal.addEventListener("abort", listener, { once: true });
  });
  try {
    return await Promise.race([operation, aborted]);
  } finally {
    signal.removeEventListener("abort", listener);
  }
}

export type PlayerOptions = {
  /** A 2D context sized to the scene; the player draws into it. */
  context: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;
  scene: unknown;
  /** Host-owned frame renderer (for example a worker). Requires audio:false;
   * the host owns media resolution and renderer disposal. */
  renderFrame?: (frame: number, signal: AbortSignal) => Promise<void>;
  /**
   * Pre-resolved assets. When omitted, createPlayer() resolves them and
   * dispose() releases them; when provided, the caller owns their lifetime.
   */
  assets?: ResolvedAssets;
  /** Trusted extension definitions used when resolving extension nodes. */
  extensions?: ResolveAssetsOptions["extensions"];
  /** Require every extension definition to support worker execution. */
  worker?: boolean;
  /** Exact opaque handlers used for extension display preflight/execution. */
  opaqueExtensionRegistry?: Canvas2DOpaqueExtensionRegistry;
  /** Preview uses declared proxy sources by default. */
  preferProxy?: boolean;
  /** Decoder/cache/image memory limits forwarded to asset resolution. */
  budget?: ResolveAssetsOptions["budget"];
  assetPolicy?: ResolveAssetsOptions["assetPolicy"];
  analysisCache?: ResolveAssetsOptions["analysisCache"];
  fontCache?: ResolveAssetsOptions["fontCache"];
  /** Cancels asset resolution and in-flight frame preparation. */
  signal?: AbortSignal;
  analyzeWaveforms?: boolean;
  /** Reused for every frame; the caller retains ownership and must dispose it. */
  scratchSurfacePool?: ScratchSurfacePool;
  /** Caller-owned bounded static raster cache; Player never disposes it. */
  staticDisplayCache?: Canvas2DStaticDisplayCache;
  loop?: boolean;
  /**
   * Audio preview. Defaults to a WebAudioPreview when the environment has
   * AudioContext; pass `false` to disable sound, or your own AudioPreview.
   * Preview audio is best-effort — the export is the audio source of truth.
   */
  audio?: AudioPreview | false;
  /** Injectable time source for tests; defaults to performance.now. */
  now?: () => number;
  /** Injectable frame scheduler for tests; defaults to requestAnimationFrame. */
  requestFrame?: (callback: () => void) => number;
  cancelFrame?: (handle: number) => void;
};

type PlayerRuntimeOwnedOption =
  | "scene"
  | "assets"
  | "extensions"
  | "worker"
  | "opaqueExtensionRegistry"
  | "preferProxy"
  | "budget"
  | "assetPolicy"
  | "analysisCache"
  | "fontCache"
  | "analyzeWaveforms"
  | "scratchSurfacePool"
  | "staticDisplayCache";

/**
 * Player options for an already-prepared Canvas2D runtime. Media resolution
 * belongs to the runtime; the player only borrows its current Scene/assets.
 */
export type RuntimePlayerOptions = Omit<
  PlayerOptions,
  PlayerRuntimeOwnedOption
>;

type PlayerLifecycle = {
  onDisposeRequested?: () => void;
};

/**
 * A playing/seekable view of a scene on a canvas. Create with createPlayer().
 *
 * The render loop awaits prepareFrame() per displayed frame (video decode),
 * so a slow decode never tears: the player skips to the latest target frame
 * rather than rendering stale intermediates.
 */
export class Player {
  readonly scene: Scene;

  private readonly clock: FrameClock;
  private readonly context: PlayerOptions["context"];
  private readonly externalRenderFrame: PlayerOptions["renderFrame"];
  private readonly assets: ResolvedAssets | undefined;
  private readonly ownsAssets: boolean;
  private readonly now: () => number;
  private readonly requestFrame: (callback: () => void) => number;
  private readonly cancelFrame: (handle: number) => void;
  private readonly signal: AbortSignal | undefined;
  private readonly scratchSurfacePool: ScratchSurfacePool | undefined;
  private readonly staticDisplayCache: Canvas2DStaticDisplayCache | undefined;
  private readonly renderController = new AbortController();
  private unlinkOptionSignal: (() => void) | null = null;

  private listeners = new Map<PlayerEvent, Set<(frame: number) => void>>();
  private renderedFrame = -1;
  private rafHandle: number | null = null;
  private rendering = false;
  private renderQueue: Promise<void> = Promise.resolve();
  private assetsReleased = false;
  private disposed = false;
  private disposalPromise: Promise<void> | null = null;
  private lastRenderError: Error | null = null;
  private errorListeners = new Set<(error: Error) => void>();
  private audio: AudioPreview | null = null;
  private pendingAudio: AudioPreview | null = null;
  private readonly disposedAudio = new WeakSet<AudioPreview>();
  private audioReadyPromise: Promise<void> = Promise.resolve();
  private readonly textMeasureCache: TextMeasureCache =
    new BoundedTextMeasureCache();
  private onDisposeRequested: (() => void) | null;

  /** @internal — use createPlayer(). */
  constructor(
    scene: Scene,
    options: PlayerOptions,
    assets: ResolvedAssets | undefined,
    ownsAssets: boolean,
    lifecycle: PlayerLifecycle = {},
  ) {
    this.scene = scene;
    this.context = options.context;
    this.externalRenderFrame = options.renderFrame;
    this.assets = assets;
    this.ownsAssets = ownsAssets;
    this.scratchSurfacePool = options.scratchSurfacePool;
    this.staticDisplayCache = options.staticDisplayCache;
    this.onDisposeRequested = lifecycle.onDisposeRequested ?? null;
    this.signal = this.renderController.signal;
    if (options.signal) {
      const abort = () => this.renderController.abort(options.signal?.reason);
      if (options.signal.aborted) abort();
      else {
        options.signal.addEventListener("abort", abort, { once: true });
        this.unlinkOptionSignal = () =>
          options.signal?.removeEventListener("abort", abort);
      }
    }
    this.now = options.now ?? (() => performance.now());
    this.requestFrame =
      options.requestFrame ??
      ((callback) => globalThis.requestAnimationFrame(callback));
    this.cancelFrame =
      options.cancelFrame ??
      ((handle) => globalThis.cancelAnimationFrame(handle));
    this.clock = new FrameClock({
      fps: scene.fps,
      durationInFrames: scene.duration,
      loop: options.loop ?? false,
    });
  }

  get playing(): boolean {
    return this.clock.playing;
  }

  /** The most recently rendered frame (−1 before the first render). */
  get currentFrame(): number {
    return this.renderedFrame;
  }

  get loop(): boolean {
    return this.clock.loop;
  }

  set loop(value: boolean) {
    this.clock.loop = value;
  }

  /** Last asynchronous render-loop error, if playback stopped because of one. */
  get error(): Error | null {
    return this.lastRenderError;
  }

  onError(listener: (error: Error) => void): () => void {
    this.errorListeners.add(listener);
    return () => this.errorListeners.delete(listener);
  }

  /**
   * Resolves once the audio preview is attached, or once the player knows
   * there will be none (silent scene, unsupported environment, mix failure).
   * The mix is prepared off the critical path, so the first frame paints
   * before sound exists; playback started earlier joins the audio clock the
   * moment it attaches. Await this when audio must be live before play().
   */
  get audioReady(): Promise<void> {
    return this.audioReadyPromise;
  }

  on(event: PlayerEvent, listener: (frame: number) => void): () => void {
    if (!this.listeners.has(event)) {
      this.listeners.set(event, new Set());
    }

    this.listeners.get(event)?.add(listener);
    return () => this.listeners.get(event)?.delete(listener);
  }

  play(): void {
    this.assertAlive();

    if (this.clock.playing) {
      return;
    }

    this.clock.play(this.now());
    const startFrame = this.clock.frameAt(this.now()).frame;
    this.audio?.start(startFrame / this.scene.fps);
    this.emit("play", this.renderedFrame);
    this.scheduleTick();
  }

  pause(): void {
    this.assertAlive();

    if (!this.clock.playing) {
      return;
    }

    this.clock.pause(this.now());
    this.audio?.stop();
    this.stopTicking();
    this.emit("pause", this.clock.frameAt(this.now()).frame);
  }

  /** Jumps to a frame and renders it; resolves when the frame is on screen. */
  async seek(frame: number): Promise<void> {
    this.assertAlive();
    this.clock.seek(frame, this.now());
    const target = this.clock.frameAt(this.now()).frame;

    if (this.clock.playing) {
      this.audio?.start(target / this.scene.fps);
    }

    await this.renderFrame(target);
  }

  /** Stops playback and releases player-owned assets. */
  dispose(): void {
    if (this.disposed) {
      return;
    }

    this.stopTicking();
    this.disposed = true;
    const notifyDisposeRequested = this.onDisposeRequested;
    this.onDisposeRequested = null;
    notifyDisposeRequested?.();
    this.renderController.abort(
      typeof DOMException === "function"
        ? new DOMException("Player disposed.", "AbortError")
        : new Error("Player disposed."),
    );
    this.unlinkOptionSignal?.();
    this.unlinkOptionSignal = null;
    this.listeners.clear();
    this.errorListeners.clear();
    if (this.audio) this.disposeAudioOnce(this.audio);
    this.audio = null;
    if (this.pendingAudio) this.disposeAudioOnce(this.pendingAudio);
    this.pendingAudio = null;
    void this.beginDisposal().catch(() => {
      // Await disposeAsync() when teardown failures must be observed.
    });
  }

  /** Stops playback and waits for audio/render work and owned media teardown. */
  async disposeAsync(): Promise<void> {
    this.dispose();
    await this.beginDisposal();
  }

  /** @internal — wired by createPlayer() after load() decides audibility. */
  attachAudio(audio: AudioPreview): void {
    if (this.pendingAudio === audio) this.pendingAudio = null;
    if (this.disposed) {
      this.disposeAudioOnce(audio);
      return;
    }

    this.audio = audio;

    // The mix finished while playback was already running: join it at the
    // current position instead of staying silent until the next play().
    if (this.clock.playing) {
      audio.start(this.clock.frameAt(this.now()).frame / this.scene.fps);
    }
  }

  /** @internal — binds preview preparation to the player lifecycle signal. */
  loadAudio(audio: AudioPreview): Promise<boolean> {
    this.pendingAudio = audio;
    return audio.load(this.scene, this.assets, this.signal);
  }

  /** @internal — clears a preview that resolved silent or failed to load. */
  discardAudio(audio: AudioPreview): void {
    if (this.pendingAudio === audio) this.pendingAudio = null;
    this.disposeAudioOnce(audio);
  }

  private disposeAudioOnce(audio: AudioPreview): void {
    if (this.disposedAudio.has(audio)) return;
    this.disposedAudio.add(audio);
    audio.dispose();
  }

  /** @internal — wired by createPlayer(). */
  setAudioReady(ready: Promise<void>): void {
    this.audioReadyPromise = ready;
  }

  /** @internal — first paint from createPlayer(). */
  async renderInitialFrame(): Promise<void> {
    await this.renderFrame(0);
  }

  private scheduleTick(): void {
    if (this.rafHandle !== null || this.disposed) {
      return;
    }

    this.rafHandle = this.requestFrame(() => {
      this.rafHandle = null;
      void this.tick().catch((error: unknown) => this.handleRenderError(error));
    });
  }

  private stopTicking(): void {
    if (this.rafHandle !== null) {
      this.cancelFrame(this.rafHandle);
      this.rafHandle = null;
    }
  }

  private async tick(): Promise<void> {
    if (this.disposed || !this.clock.playing) {
      return;
    }

    // Audio hardware is the steadier clock: when the frame clock drifts more
    // than one frame from the audio position, re-anchor the frame clock. A
    // skipped video frame is invisible; skipped audio is not.
    const audioPosition = this.audio?.position();

    if (audioPosition != null) {
      const audioFrame = Math.floor(audioPosition * this.scene.fps);
      const clockFrame = this.clock.frameAt(this.now()).frame;

      if (
        Math.abs(audioFrame - clockFrame) > 1 &&
        audioFrame < this.clock.durationInFrames
      ) {
        this.clock.seek(audioFrame, this.now());
      }
    }

    const { frame, ended } = this.clock.frameAt(this.now());

    // Loop wrap: the clock jumped backwards, so the audio source (which
    // plays linearly) must restart from the wrapped position.
    if (frame < this.renderedFrame && this.clock.loop) {
      this.audio?.start(frame / this.scene.fps);
    }

    if (frame !== this.renderedFrame) {
      await this.renderFrame(frame);
    }

    if (ended) {
      this.clock.pause(this.now());
      this.audio?.stop();
      this.emit("ended", frame);
      return;
    }

    this.scheduleTick();
  }

  private async renderFrame(frame: number): Promise<void> {
    const task = this.renderQueue
      .catch(() => undefined)
      .then(() => this.performRenderFrame(frame));
    this.renderQueue = task.catch(() => undefined);
    return task;
  }

  private async performRenderFrame(frame: number): Promise<void> {
    if (this.disposed) return;

    this.rendering = true;

    try {
      if (this.externalRenderFrame) {
        await waitForPlayerOperation(this.externalRenderFrame(frame, this.signal!), this.signal);
        if (this.disposed) return;
        this.renderedFrame = frame;
        this.emit("frame", frame);
        return;
      }
      const resolvedScene = this.assets
        ? await waitForPlayerOperation(
            prepareFrame(this.scene, frame, this.assets, {
              signal: this.signal,
            }),
            this.signal,
          )
        : undefined;

      if (this.disposed) {
        return;
      }

      renderStill(this.context, this.scene, frame, {
        assets: this.assets,
        resolvedScene,
        textMeasureCache: this.textMeasureCache,
        scratchSurfacePool: this.scratchSurfacePool,
        staticDisplayCache: this.staticDisplayCache,
      });
      this.renderedFrame = frame;
      this.emit("frame", frame);
    } catch (error) {
      if (!this.disposed) {
        throw error;
      }
    } finally {
      this.rendering = false;

      if (this.disposed) {
        void this.beginDisposal().catch(() => undefined);
      }
    }
  }

  private beginDisposal(): Promise<void> {
    if (this.disposalPromise) return this.disposalPromise;
    const ownedAssetDisposal = this.releaseOwnedAssets();
    this.disposalPromise = (async () => {
      await this.renderQueue.catch(() => undefined);
      await ownedAssetDisposal;
    })();
    return this.disposalPromise;
  }

  private async releaseOwnedAssets(): Promise<void> {
    if (!this.ownsAssets || !this.assets || this.assetsReleased) {
      return;
    }

    this.assetsReleased = true;
    await disposeAssetsAsync(this.assets);
  }

  private handleRenderError(error: unknown): void {
    if (this.disposed) return;
    const normalized =
      error instanceof Error ? error : new Error(String(error));
    this.lastRenderError = normalized;
    if (this.clock.playing) {
      this.clock.pause(this.now());
      this.audio?.stop();
    }
    this.stopTicking();
    Array.from(this.errorListeners).forEach((listener) => listener(normalized));
  }

  private emit(event: PlayerEvent, frame: number): void {
    const listeners = Array.from(this.listeners.get(event) ?? []);

    for (const listener of listeners) {
      listener(frame);
    }
  }

  private assertAlive(): void {
    if (this.disposed) {
      throw new Error(
        "Player is disposed; create a new one with createPlayer().",
      );
    }
  }
}

/**
 * Validates the scene, resolves assets (unless provided), renders frame 0,
 * and returns a ready Player.
 */
export async function createPlayer(options: PlayerOptions): Promise<Player> {
  return await createPlayerInternal(options);
}

async function createPlayerInternal(
  options: PlayerOptions,
  lifecycle: PlayerLifecycle = {},
): Promise<Player> {
  if (options.renderFrame && options.audio !== false) {
    throw new Error("A host-owned frame renderer requires audio:false; audio ownership must be explicit.");
  }
  const scene = parseScene(options.scene);
  const inspection = inspectScene(scene);
  const needsAssets = !options.renderFrame && (
    Object.keys(scene.assets).length > 0 || inspection.capabilities.hasExtensions
  );
  const ownsAssets = options.assets === undefined && needsAssets;
  const assets =
    options.assets ??
    (needsAssets
      ? await resolveAssets(scene, {
          extensions: options.extensions,
          worker: options.worker,
          opaqueExtensionRegistry: options.opaqueExtensionRegistry,
          preferProxy: options.preferProxy ?? true,
          budget: options.budget,
          assetPolicy: options.assetPolicy,
          analysisCache: options.analysisCache,
          fontCache: options.fontCache,
          analyzeWaveforms: options.analyzeWaveforms,
          signal: options.signal,
        })
      : undefined);

  const player = new Player(scene, options, assets, ownsAssets, lifecycle);

  try {
    // Best-effort audio preview: attach only when the scene actually has
    // something audible, so silent scenes never touch AudioContext. The mix
    // runs concurrently with the first paint and attaches whenever it lands —
    // decoding a long soundtrack must never delay the first visible frame.
    if (options.audio !== false) {
      const audio =
        options.audio ??
        (ChunkedWebAudioPreview.supported()
          ? new ChunkedWebAudioPreview()
          : null);

      if (audio) {
        player.setAudioReady(
          player
            .loadAudio(audio)
            .then((audible) => {
              if (audible) {
                player.attachAudio(audio);
              } else {
                player.discardAudio(audio);
              }
            })
            .catch(() => {
              // Preview audio is best-effort; the export mixes its own.
              player.discardAudio(audio);
            }),
        );
      }
    }

    await player.renderInitialFrame();
    return player;
  } catch (error) {
    await player.disposeAsync();
    throw error;
  }
}

/**
 * Creates a player that borrows the current prepared Canvas2D runtime state.
 *
 * The compatibility scope stays open until the player is fully disposed, so
 * the runtime cannot replace or release media while a frame/audio task still
 * uses it. A runtime update/disposal or caller abort disposes the player and
 * releases the scope before the newer runtime operation can continue.
 */
export async function createPlayerFromRuntime(
  runtime: Canvas2DSceneRuntime,
  options: RuntimePlayerOptions,
): Promise<Player> {
  let settleReady = (_player: Player): void => undefined;
  let rejectReady = (_error: unknown): void => undefined;
  let readySettled = false;
  const ready = new Promise<Player>((resolve, reject) => {
    settleReady = (player) => {
      if (readySettled) return;
      readySettled = true;
      resolve(player);
    };
    rejectReady = (error) => {
      if (readySettled) return;
      readySettled = true;
      reject(error);
    };
  });

  const scope = withCanvas2DResolvedAssets(
    runtime,
    async ({
      assets,
      scratchSurfacePool,
      staticDisplayCache,
      scene,
      signal,
    }) => {
      let releaseScope = (): void => undefined;
      const releaseRequested = new Promise<void>((resolve) => {
        releaseScope = resolve;
      });
      let player: Player | undefined;
      const abort = () => player?.dispose();
      signal.addEventListener("abort", abort, { once: true });

      try {
        player = await createPlayerInternal(
          {
            ...options,
            scene,
            assets,
            scratchSurfacePool,
            staticDisplayCache,
            signal,
          },
          { onDisposeRequested: releaseScope },
        );

        if (signal.aborted) {
          player.dispose();
          await player.disposeAsync();
          throw signal.reason instanceof Error
            ? signal.reason
            : new Error("Runtime player creation was aborted.");
        }

        settleReady(player);
        await releaseRequested;
        await player.disposeAsync();
      } finally {
        signal.removeEventListener("abort", abort);
        if (player && !readySettled) {
          await player.disposeAsync();
        }
      }
    },
    { signal: options.signal },
  );

  void scope.catch((error: unknown) => rejectReady(error));
  return await ready;
}
