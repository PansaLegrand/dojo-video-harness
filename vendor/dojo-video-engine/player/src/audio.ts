import { collectAudioPlacements, mixSceneAudio } from "@dojo-video-engine/export";
import type { ResolvedAssets } from "@dojo-video-engine/renderer-canvas2d";
import type { Scene } from "@dojo-video-engine/schema";

/**
 * Best-effort audio for preview playback. The export remains the audio
 * source of truth; implementations of this interface only need to play
 * scene-time-aligned sound and report their clock.
 */
export interface AudioPreview {
  /** Prepares the scene's audio. Resolves false when there is nothing audible. */
  load(
    scene: Scene,
    assets: ResolvedAssets | undefined,
    signal?: AbortSignal,
  ): Promise<boolean>;
  /** Starts playback at the given scene time in seconds. */
  start(atSeconds: number): void;
  stop(): void;
  /**
   * The audio clock's current scene-time position in seconds, or null when
   * not playing. The player treats this as the steadier reference and
   * re-anchors its frame clock to it on drift.
   */
  position(): number | null;
  dispose(): void;
}

export function previewAudioChunkRange(
  scene: Pick<Scene, "duration" | "fps">,
  atSeconds: number,
  chunkSeconds = 30,
): { chunkStart: number; startFrame: number; endFrame: number } {
  const chunkStart =
    Math.floor(Math.max(0, atSeconds) / chunkSeconds) * chunkSeconds;
  return {
    chunkStart,
    startFrame: Math.floor(chunkStart * scene.fps),
    endFrame: Math.min(
      scene.duration - 1,
      Math.ceil((chunkStart + chunkSeconds) * scene.fps) - 1,
    ),
  };
}

/**
 * Web Audio implementation: the scene's audible nodes are mixed once with
 * the exact pure mix functions the export uses (`mixSceneAudio`), cached as
 * one AudioBuffer, and played through a single AudioBufferSourceNode.
 * Seeking restarts the source at an offset — no re-mixing.
 */
export class WebAudioPreview implements AudioPreview {
  private context: AudioContext | undefined;
  private buffer: AudioBuffer | null = null;
  private adoptedBuffer = false;
  private source: AudioBufferSourceNode | null = null;
  private startedAtContextTime = 0;
  private startOffset = 0;

  constructor(private readonly createContext = () => new AudioContext()) {}

  /** True when this environment can play audio at all. */
  static supported(): boolean {
    return typeof AudioContext !== "undefined";
  }

  /**
   * Reuses a mix produced by an earlier preview (read from `mixedBuffer`),
   * so load() skips decoding and mixing entirely. Callers own cache
   * invalidation: adopt only when the scene's audible content is unchanged.
   */
  adoptMixedBuffer(buffer: AudioBuffer | null): void {
    this.buffer = buffer;
    this.adoptedBuffer = true;
  }

  /**
   * The mixed scene audio after load() (null when the scene is silent).
   * AudioBuffers are context-independent, so callers may cache this across
   * players and hand it to a new preview via adoptMixedBuffer().
   */
  get mixedBuffer(): AudioBuffer | null {
    return this.buffer;
  }

  async load(
    scene: Scene,
    assets: ResolvedAssets | undefined,
    signal?: AbortSignal,
  ): Promise<boolean> {
    if (!this.adoptedBuffer) {
      this.buffer = assets
        ? await mixSceneAudio(scene, assets, 0, scene.duration - 1, signal)
        : null;
    }

    return this.buffer !== null;
  }

  start(atSeconds: number): void {
    if (!this.buffer) {
      return;
    }

    // Created lazily inside start(), which the player calls from play() —
    // normally a user gesture, satisfying autoplay policies.
    this.context ??= this.createContext();
    void this.context.resume?.();
    this.stop();

    const offset = Math.max(0, Math.min(atSeconds, this.buffer.duration));
    const source = this.context.createBufferSource();
    source.buffer = this.buffer;
    source.connect(this.context.destination);
    source.start(0, offset);
    this.source = source;
    this.startedAtContextTime = this.context.currentTime;
    this.startOffset = offset;
  }

  stop(): void {
    if (this.source) {
      try {
        this.source.stop();
      } catch {
        // Stopping a source that already ended throws in some engines.
      }
      this.source.disconnect();
      this.source = null;
    }
  }

  position(): number | null {
    if (!this.source || !this.context) {
      return null;
    }

    return (
      this.startOffset + (this.context.currentTime - this.startedAtContextTime)
    );
  }

  dispose(): void {
    this.stop();
    void this.context?.close?.();
    this.context = undefined;
    this.buffer = null;
  }
}

type ScheduledPreviewAudioChunk = {
  endContextTime: number;
  source: AudioBufferSourceNode | null;
};

/**
 * Bounded-memory preview backend. One playing chunk and one prefetched chunk
 * share an AudioContext timeline, so mixing never waits for the previous
 * source's ended event. Seeking discards both chunks and their in-flight mix.
 */
export class ChunkedWebAudioPreview implements AudioPreview {
  private context: AudioContext | undefined;
  private scene: Scene | null = null;
  private assets: ResolvedAssets | undefined;
  private chunks: ScheduledPreviewAudioChunk[] = [];
  private timer: ReturnType<typeof setTimeout> | null = null;
  private mixController: AbortController | null = null;
  private unlinkLoadSignal: (() => void) | null = null;
  private loadSignal: AbortSignal | undefined;
  private lastMixError: Error | null = null;
  private generation = 0;
  private fillingGeneration: number | null = null;
  private playing = false;
  private clockStarted = false;
  private startedAtContextTime = 0;
  private startOffset = 0;
  private nextFrame = 0;

  constructor(
    private readonly chunkSeconds = 30,
    private readonly createContext = () => new AudioContext(),
  ) {
    if (!Number.isFinite(chunkSeconds) || chunkSeconds <= 0) {
      throw new RangeError("Audio preview chunk duration must be positive.");
    }
  }

  static supported(): boolean {
    return typeof AudioContext !== "undefined";
  }

  get error(): Error | null {
    return this.lastMixError;
  }

  async load(
    scene: Scene,
    assets: ResolvedAssets | undefined,
    signal?: AbortSignal,
  ): Promise<boolean> {
    if (signal?.aborted) throw signal.reason;
    this.stop();
    this.unlinkLoadSignal?.();
    this.loadSignal = signal;
    const abort = () => this.stop();
    signal?.addEventListener("abort", abort, { once: true });
    this.unlinkLoadSignal = signal
      ? () => signal.removeEventListener("abort", abort)
      : null;
    this.scene = scene;
    this.assets = assets;
    return Boolean(assets && collectAudioPlacements(scene).length > 0);
  }

  start(atSeconds: number): void {
    if (!this.scene || !this.assets || this.loadSignal?.aborted) return;
    this.context ??= this.createContext();
    void this.context.resume?.();
    this.stop();
    this.lastMixError = null;
    this.startOffset = Math.max(
      0,
      Math.min(atSeconds, this.scene.duration / this.scene.fps),
    );
    if (this.startOffset >= this.scene.duration / this.scene.fps) return;
    this.playing = true;
    this.clockStarted = false;
    this.nextFrame = 0;
    this.mixController = new AbortController();
    this.fillLookahead(this.generation, this.mixController.signal);
  }

  stop(): void {
    this.generation += 1;
    this.playing = false;
    this.clockStarted = false;
    this.mixController?.abort(
      typeof DOMException === "function"
        ? new DOMException("Audio preview work was superseded.", "AbortError")
        : new Error("Audio preview work was superseded."),
    );
    this.mixController = null;
    if (this.timer !== null) clearTimeout(this.timer);
    this.timer = null;
    for (const chunk of this.chunks) {
      if (!chunk.source) continue;
      chunk.source.onended = null;
      try {
        chunk.source.stop();
      } catch {
        // Already ended.
      }
      chunk.source.disconnect();
    }
    this.chunks = [];
  }

  position(): number | null {
    if (!this.playing || !this.context || !this.scene) return null;
    // Hold the requested position while the first mix is being prepared. The
    // player follows this clock instead of skipping the beginning of the audio.
    const position = this.clockStarted ? this.sceneTime() : this.startOffset;
    return position < this.scene.duration / this.scene.fps ? position : null;
  }

  dispose(): void {
    this.stop();
    this.unlinkLoadSignal?.();
    this.unlinkLoadSignal = null;
    this.loadSignal = undefined;
    void this.context?.close?.();
    this.context = undefined;
    this.scene = null;
    this.assets = undefined;
  }

  private sceneTime(): number {
    return (
      this.startOffset +
      Math.max(0, this.context!.currentTime - this.startedAtContextTime)
    );
  }

  private current(generation: number, signal: AbortSignal): boolean {
    return (
      this.playing && generation === this.generation && !signal.aborted
    );
  }

  private retireElapsedChunks(): void {
    const now = this.context!.currentTime;
    while (this.chunks.length && this.chunks[0]!.endContextTime <= now) {
      const chunk = this.chunks.shift()!;
      if (chunk.source) {
        chunk.source.onended = null;
        chunk.source.disconnect();
      }
    }
  }

  private fillLookahead(generation: number, signal: AbortSignal): void {
    if (
      !this.current(generation, signal) ||
      this.fillingGeneration === generation
    ) return;
    this.fillingGeneration = generation;
    void this.mixAhead(generation, signal)
      .catch((error: unknown) => {
        if (!this.current(generation, signal)) return;
        this.lastMixError =
          error instanceof Error ? error : new Error(String(error));
        this.stop();
      })
      .finally(() => {
        if (this.fillingGeneration === generation) this.fillingGeneration = null;
      });
  }

  private async mixAhead(generation: number, signal: AbortSignal): Promise<void> {
    const scene = this.scene!;
    const assets = this.assets!;
    const context = this.context!;
    while (this.current(generation, signal)) {
      this.retireElapsedChunks();
      if (this.clockStarted && this.sceneTime() >= scene.duration / scene.fps) {
        this.stop();
        return;
      }
      if (this.chunks.length >= 2 || this.nextFrame >= scene.duration) return;
      const sceneTime = this.clockStarted
        ? Math.max(this.nextFrame / scene.fps, this.sceneTime())
        : this.startOffset;
      if (sceneTime >= scene.duration / scene.fps) {
        this.stop();
        return;
      }
      const range = previewAudioChunkRange(scene, sceneTime, this.chunkSeconds);
      // Fractional frame rates can straddle a nominal chunk boundary. Do not
      // decode or schedule an overlapping frame at the start of the next chunk.
      const startFrame = Math.max(this.nextFrame, range.startFrame);
      const endFrame = Math.max(startFrame, range.endFrame);
      const buffer = await mixSceneAudio(
        scene, assets, startFrame, endFrame, signal,
      );
      if (!this.current(generation, signal)) return;
      if (!this.clockStarted) {
        this.startedAtContextTime = context.currentTime;
        this.clockStarted = true;
      }
      this.nextFrame = endFrame + 1;
      const endContextTime =
        this.startedAtContextTime + this.nextFrame / scene.fps - this.startOffset;
      // A late mix follows the established clock. Skip an entirely expired
      // chunk, or start at its current offset; never shift subsequent audio.
      if (endContextTime <= context.currentTime) continue;
      let source: AudioBufferSourceNode | null = null;
      if (buffer) {
        source = context.createBufferSource();
        source.buffer = buffer;
        source.connect(context.destination);
        const when = Math.max(
          context.currentTime,
          this.startedAtContextTime + startFrame / scene.fps - this.startOffset,
        );
        const offset =
          this.startOffset + when - this.startedAtContextTime - startFrame / scene.fps;
        try {
          source.start(when, Math.max(0, offset), endContextTime - when);
        } catch (error) {
          source.disconnect();
          throw error;
        }
      }
      this.chunks.push({ endContextTime, source });
      this.scheduleBoundary(generation, signal);
    }
  }

  private scheduleBoundary(generation: number, signal: AbortSignal): void {
    if (this.timer !== null) clearTimeout(this.timer);
    this.timer = null;
    const boundary = this.chunks[0]?.endContextTime;
    if (!this.current(generation, signal) || boundary === undefined) return;
    this.timer = setTimeout(() => {
      this.timer = null;
      if (!this.current(generation, signal)) return;
      this.retireElapsedChunks();
      if (this.sceneTime() >= this.scene!.duration / this.scene!.fps) {
        this.stop();
        return;
      }
      this.fillLookahead(generation, signal);
      // AudioContext time can pause while a wall-clock timer keeps running.
      // Recheck it before releasing a chunk or scheduling additional work.
      this.scheduleBoundary(generation, signal);
    }, Math.max(1, (boundary - this.context!.currentTime) * 1000));
  }
}
