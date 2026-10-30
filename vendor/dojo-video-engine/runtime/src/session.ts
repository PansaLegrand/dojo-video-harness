import { parseScene, type Scene } from "@dojo-video-engine/schema";
import {
  RuntimeError,
  sanitizeRuntimeDetails,
  serializeRuntimeError,
  type BackendPreflightResult,
  type BackendResourceUpdateSummary,
  type BackendUpdateTransaction,
  type PreparedFrameToken,
  type PreparedSceneBackend,
  type PreparedSceneBackendCapabilities,
  type RuntimeErrorCode,
  type RuntimeEvent,
  type RuntimeEventListener,
  type RuntimeMetricsProviders,
  type RuntimeOperationContext,
  type RuntimePhase,
} from "./types";
import {
  writeFrameImageArtifact,
  type FrameArtifactResult,
  type FrameArtifactSink,
} from "./artifact";

let nextSessionId = 1;

export type SceneRuntimeStatus =
  | "preparing"
  | "ready"
  | "disposing"
  | "disposed";

export type CreateSceneRuntimeOptions<Session, PreparedFrame, Target> = {
  scene: unknown;
  backend: PreparedSceneBackend<Session, PreparedFrame, Target>;
  signal?: AbortSignal;
  sessionId?: string;
  onEvent?: RuntimeEventListener;
};

export type UpdateSceneOptions = {
  expectedRevision?: number;
  signal?: AbortSignal;
};

export type RuntimeFrameOptions = { signal?: AbortSignal };

export type FrameArtifactOptions = RuntimeFrameOptions & {
  mimeType?: string;
  quality?: number;
  maxBytes?: number;
};

export type UpdateSceneResult = {
  revision: number;
  summary: BackendResourceUpdateSummary;
};

export async function createSceneRuntime<Session, PreparedFrame, Target>(
  options: CreateSceneRuntimeOptions<Session, PreparedFrame, Target>,
): Promise<PreparedSceneSession<Session, PreparedFrame, Target>> {
  const runtime = new PreparedSceneSession(
    options.backend,
    options.sessionId ?? `runtime-${nextSessionId++}`,
    options.onEvent,
  );
  await runtime.initialize(options.scene, options.signal);
  return runtime;
}

export class PreparedSceneSession<Session, PreparedFrame, Target> {
  private sceneState!: Scene;
  private backendState!: Session;
  private revisionState = 0;
  private generationState = 0;
  private statusState: SceneRuntimeStatus = "preparing";
  private capabilitiesState: PreparedSceneBackendCapabilities;
  private sequence = 0;
  private operationSequence = 0;
  private queue: Promise<void> = Promise.resolve();
  private readonly listeners = new Set<RuntimeEventListener>();
  private readonly activeControllers = new Set<AbortController>();
  private readonly tokenSet = new WeakSet<object>();
  private readonly tokenData = new WeakMap<object, PreparedFrame>();
  private disposalPromise?: Promise<void>;
  private initializationStarted = false;

  /** @internal Use createSceneRuntime(). */
  constructor(
    readonly backend: PreparedSceneBackend<Session, PreparedFrame, Target>,
    readonly sessionId: string,
    initialListener?: RuntimeEventListener,
  ) {
    if (!sessionId || sessionId.length > 191) {
      throw new Error(
        "Runtime sessionId must contain 1 through 191 characters.",
      );
    }
    this.capabilitiesState = structuredClone(backend.capabilities);
    if (initialListener) this.listeners.add(initialListener);
  }

  get revision(): number {
    return this.revisionState;
  }

  get status(): SceneRuntimeStatus {
    return this.statusState;
  }

  get capabilities(): PreparedSceneBackendCapabilities {
    return structuredClone(this.capabilitiesState);
  }

  get scene(): Scene {
    this.assertReady();
    return structuredClone(this.sceneState);
  }

  get metrics(): RuntimeMetricsProviders {
    this.assertReady();
    return this.backend.metrics?.(this.backendState, this.sceneState) ?? {};
  }

  /**
   * Serialized compatibility scope for legacy adapters that need their
   * concrete prepared state. Updates/disposal wait for the callback; a newer
   * intent aborts its signal. Do not retain the state after the callback.
   */
  useBackendState<Result>(
    expectedBackendId: string,
    callback: (context: {
      state: Session;
      scene: Scene;
      revision: number;
      signal: AbortSignal;
    }) => Result | Promise<Result>,
    options: RuntimeFrameOptions = {},
  ): Promise<Result> {
    this.assertReady();
    if (expectedBackendId !== this.backend.id) {
      return Promise.reject(
        this.error(
          "stale_operation",
          "prepare",
          `Runtime uses backend "${this.backend.id}", not "${expectedBackendId}".`,
        ),
      );
    }
    const revision = this.revisionState;
    const generation = this.generationState;
    const controller = this.createController(options.signal);
    return this.enqueue(async () => {
      try {
        return await this.withPhase(
          "prepare",
          "prepare_failed",
          controller.signal,
          undefined,
          async (operation) => {
            this.assertCurrent(
              generation,
              revision,
              controller.signal,
              "prepare",
              operation.operationId,
            );
            const result = await callback({
              state: this.backendState,
              scene: structuredClone(this.sceneState),
              revision,
              signal: controller.signal,
            });
            this.assertCurrent(
              generation,
              revision,
              controller.signal,
              "prepare",
              operation.operationId,
            );
            return result;
          },
        );
      } finally {
        this.releaseController(controller);
      }
    });
  }

  onEvent(listener: RuntimeEventListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  async initialize(sceneInput: unknown, signal?: AbortSignal): Promise<void> {
    if (this.initializationStarted) {
      throw this.error(
        "stale_operation",
        "prepare",
        "Runtime session initialization may only run once.",
      );
    }
    this.initializationStarted = true;
    const controller = this.createController(signal);
    let prepared!: Session;
    let hasPrepared = false;
    try {
      const scene = await this.withPhase(
        "parse",
        "invalid_scene",
        controller.signal,
        undefined,
        () => parseScene(sceneInput),
      );
      const preflight = await this.withPhase(
        "preflight",
        "preflight_failed",
        controller.signal,
        undefined,
        (context) => this.backend.preflight(scene, context),
      );
      this.assertPreflight(preflight, "preflight", undefined);
      if (preflight.capabilities) {
        this.capabilitiesState = structuredClone(preflight.capabilities);
      }
      prepared = await this.withPhase(
        "prepare",
        "prepare_failed",
        controller.signal,
        undefined,
        (context) => this.backend.prepare(scene, context),
        false,
        (value) => {
          prepared = value;
          hasPrepared = true;
        },
      );
      throwIfAborted(controller.signal);
      this.sceneState = scene;
      this.backendState = prepared;
      hasPrepared = false;
      this.statusState = "ready";
    } catch (error) {
      this.statusState = "disposed";
      if (hasPrepared) {
        try {
          await this.withPhase(
            "dispose",
            "dispose_failed",
            new AbortController().signal,
            undefined,
            () => this.backend.dispose(prepared),
            true,
          );
        } catch (cleanup) {
          throw this.error(
            "dispose_failed",
            "dispose",
            "Runtime preparation failed and prepared state cleanup also failed.",
            cleanup instanceof RuntimeError
              ? cleanup.context.operationId
              : undefined,
            new AggregateError([error, cleanup], "prepare + cleanup failure", {
              cause: error,
            }),
            undefined,
            {
              primary: serializeRuntimeError(error),
              cleanup: serializeRuntimeError(cleanup),
            },
          );
        }
      }
      throw error;
    } finally {
      this.releaseController(controller);
    }
  }

  updateScene(
    sceneInput: unknown,
    options: UpdateSceneOptions = {},
  ): Promise<UpdateSceneResult> {
    this.assertReady();
    const expectedRevision = options.expectedRevision ?? this.revisionState;
    this.assertExpectedRevision(expectedRevision, "update", undefined);
    if (options.signal?.aborted) {
      return Promise.reject(
        this.error(
          "aborted",
          "update",
          "Scene update was already aborted.",
          undefined,
          options.signal.reason,
        ),
      );
    }
    let nextScene: Scene;
    try {
      nextScene = parseScene(sceneInput);
    } catch (cause) {
      return Promise.reject(
        this.error(
          "invalid_scene",
          "parse",
          "Updated Scene is invalid.",
          undefined,
          cause,
        ),
      );
    }

    const intent = ++this.generationState;
    this.abortActive(createAbortError("Superseded by a Scene update."));
    const controller = this.createController(options.signal);
    return this.enqueue(async () => {
      let transaction: BackendUpdateTransaction<Session> | undefined;
      let committed = false;
      try {
        return await this.withPhase(
          "update",
          "update_failed",
          controller.signal,
          undefined,
          async (context) => {
            this.assertCurrent(
              intent,
              expectedRevision,
              controller.signal,
              "update",
              context.operationId,
            );
            const preflight = await this.backend.preflight(nextScene, context);
            this.assertPreflight(preflight, "update", context.operationId);
            transaction = this.backend.prepareUpdate
              ? await this.backend.prepareUpdate(
                  this.backendState,
                  this.sceneState,
                  nextScene,
                  context,
                )
              : await this.prepareReplacementTransaction(nextScene, context);
            this.assertCurrent(
              intent,
              expectedRevision,
              controller.signal,
              "update",
              context.operationId,
            );
            const committedUpdate = transaction.commit();
            committed = true;
            this.backendState = committedUpdate.session;
            this.sceneState = nextScene;
            this.revisionState += 1;
            if (preflight.capabilities) {
              this.capabilitiesState = structuredClone(preflight.capabilities);
            }
            if (committedUpdate.cleanup) {
              try {
                await committedUpdate.cleanup;
              } catch (cause) {
                throw this.error(
                  "dispose_failed",
                  "update",
                  "Scene update committed, but superseded resource cleanup failed.",
                  context.operationId,
                  cause,
                  undefined,
                  { committed: true },
                );
              }
            }
            return {
              revision: this.revisionState,
              summary: cloneSummary(transaction.summary),
            };
          },
          false,
          undefined,
          () => committed,
        );
      } catch (primary) {
        if (transaction && !committed) {
          try {
            await this.withPhase(
              "dispose",
              "dispose_failed",
              new AbortController().signal,
              undefined,
              () => transaction!.rollback(),
              true,
            );
          } catch (cleanup) {
            throw this.error(
              "dispose_failed",
              "dispose",
              "Scene update failed and provisional resource rollback also failed.",
              cleanup instanceof RuntimeError
                ? cleanup.context.operationId
                : undefined,
              new AggregateError(
                [primary, cleanup],
                "update + rollback failure",
                { cause: primary },
              ),
              undefined,
              {
                primary: serializeRuntimeError(primary),
                cleanup: serializeRuntimeError(cleanup),
              },
            );
          }
        }
        throw primary;
      } finally {
        this.releaseController(controller);
      }
    });
  }

  prepareFrame(
    frame: number,
    options: RuntimeFrameOptions = {},
  ): Promise<PreparedFrameToken<PreparedFrame>> {
    this.assertFrame(frame);
    const revision = this.revisionState;
    const generation = this.generationState;
    const controller = this.createController(options.signal);
    return this.enqueue(async () => {
      try {
        return await this.prepareFrameInternal(
          frame,
          revision,
          generation,
          controller.signal,
        );
      } finally {
        this.releaseController(controller);
      }
    });
  }

  renderPrepared(
    token: PreparedFrameToken<PreparedFrame>,
    target: Target,
    options: RuntimeFrameOptions = {},
  ): Promise<void> {
    const controller = this.createController(options.signal);
    return this.enqueue(async () => {
      try {
        await this.withPhase(
          "frame-render",
          "frame_render_failed",
          controller.signal,
          token.frame,
          async (context) => {
            this.assertToken(
              token,
              controller.signal,
              "frame-render",
              context.operationId,
            );
            await this.backend.renderFrame(
              this.backendState,
              this.sceneState,
              token.frame,
              this.preparedData(token),
              target,
              context,
            );
            this.assertToken(
              token,
              controller.signal,
              "frame-render",
              context.operationId,
            );
          },
        );
      } finally {
        this.releaseController(controller);
      }
    });
  }

  renderFrame(
    frame: number,
    target: Target,
    options: RuntimeFrameOptions = {},
  ): Promise<void> {
    this.assertFrame(frame);
    const revision = this.revisionState;
    const generation = this.generationState;
    const controller = this.createController(options.signal);
    return this.enqueue(async () => {
      try {
        const token = await this.prepareFrameInternal(
          frame,
          revision,
          generation,
          controller.signal,
        );
        await this.withPhase(
          "frame-render",
          "frame_render_failed",
          controller.signal,
          frame,
          async (context) => {
            this.assertToken(
              token,
              controller.signal,
              "frame-render",
              context.operationId,
            );
            await this.backend.renderFrame(
              this.backendState,
              this.sceneState,
              frame,
              this.preparedData(token),
              target,
              context,
            );
            this.assertToken(
              token,
              controller.signal,
              "frame-render",
              context.operationId,
            );
          },
        );
      } finally {
        this.releaseController(controller);
      }
    });
  }

  writeFrameArtifact<Receipt extends Record<string, unknown>>(
    frame: number,
    sink: FrameArtifactSink<Receipt>,
    options: FrameArtifactOptions = {},
  ): Promise<FrameArtifactResult<Receipt>> {
    this.assertFrame(frame);
    if (!this.backend.encodeFrameImage) {
      return Promise.reject(
        this.error(
          "artifact_unsupported",
          "encode",
          `Backend "${this.backend.id}" does not support frame-image artifacts.`,
        ),
      );
    }
    const mimeType = options.mimeType ?? "image/png";
    const maxBytes = options.maxBytes ?? 32 * 1024 * 1024;
    if (!Number.isInteger(maxBytes) || maxBytes < 1) {
      return Promise.reject(
        this.error(
          "artifact_too_large",
          "encode",
          "Artifact maxBytes must be a positive integer.",
        ),
      );
    }
    if (
      options.quality !== undefined &&
      (!Number.isFinite(options.quality) ||
        options.quality < 0 ||
        options.quality > 1)
    ) {
      return Promise.reject(
        this.error(
          "artifact_unsupported",
          "encode",
          "Artifact quality must be between 0 and 1.",
        ),
      );
    }
    if (!this.capabilitiesState.frameImageMimeTypes.includes(mimeType)) {
      return Promise.reject(
        this.error(
          "artifact_unsupported",
          "encode",
          `Backend "${this.backend.id}" does not support ${mimeType}.`,
        ),
      );
    }
    const revision = this.revisionState;
    const generation = this.generationState;
    const controller = this.createController(options.signal);
    return this.enqueue(async () => {
      try {
        const token = await this.prepareFrameInternal(
          frame,
          revision,
          generation,
          controller.signal,
        );
        const image = await this.withPhase(
          "encode",
          "artifact_encode_failed",
          controller.signal,
          frame,
          async (context) => {
            this.assertToken(
              token,
              controller.signal,
              "encode",
              context.operationId,
            );
            const encoded = await this.backend.encodeFrameImage!(
              this.backendState,
              this.sceneState,
              frame,
              this.preparedData(token),
              { mimeType, quality: options.quality, maxBytes },
              context,
            );
            this.assertToken(
              token,
              controller.signal,
              "encode",
              context.operationId,
            );
            if (encoded.mimeType !== mimeType) {
              throw this.error(
                "artifact_unsupported",
                "encode",
                `Backend returned ${encoded.mimeType} for requested ${mimeType}.`,
                context.operationId,
                undefined,
                frame,
              );
            }
            return encoded;
          },
        );
        return await this.withPhase(
          "artifact-write",
          "artifact_sink_failed",
          controller.signal,
          frame,
          async (context) => {
            this.assertToken(
              token,
              controller.signal,
              "artifact-write",
              context.operationId,
            );
            return await writeFrameImageArtifact({
              image,
              descriptor: {
                kind: "dojo-video-engine.frame-image",
                version: 1,
                sessionId: this.sessionId,
                revision,
                frame,
                sceneTimestampUs: Math.round(
                  (frame / this.sceneState.fps) * 1_000_000,
                ),
                operationKey: `${this.sessionId}:${revision}:${frame}:${mimeType}:q=${options.quality ?? "default"}`,
              },
              sink,
              signal: controller.signal,
              maxBytes,
              assertCurrent: () =>
                this.assertToken(
                  token,
                  controller.signal,
                  "artifact-write",
                  context.operationId,
                ),
            });
          },
          false,
          undefined,
          () => true,
        );
      } catch (error) {
        if (error instanceof Error && error.name === "ArtifactTooLargeError") {
          throw this.error(
            "artifact_too_large",
            "artifact-write",
            error.message,
            undefined,
            error,
            frame,
          );
        }
        throw error;
      } finally {
        this.releaseController(controller);
      }
    });
  }

  disposeAsync(): Promise<void> {
    if (this.disposalPromise) return this.disposalPromise;
    if (this.statusState === "disposed") return Promise.resolve();
    this.statusState = "disposing";
    this.generationState += 1;
    this.abortActive(createAbortError("Runtime session is disposing."));
    this.disposalPromise = this.enqueue(async () => {
      try {
        await this.withPhase(
          "dispose",
          "dispose_failed",
          new AbortController().signal,
          undefined,
          () => this.backend.dispose(this.backendState),
          true,
        );
      } finally {
        this.statusState = "disposed";
        this.listeners.clear();
      }
    });
    return this.disposalPromise;
  }

  private async prepareFrameInternal(
    frame: number,
    revision: number,
    generation: number,
    signal: AbortSignal,
  ): Promise<PreparedFrameToken<PreparedFrame>> {
    const data = await this.withPhase(
      "frame-prepare",
      "frame_prepare_failed",
      signal,
      frame,
      async (context) => {
        this.assertCurrent(
          generation,
          revision,
          signal,
          "frame-prepare",
          context.operationId,
          frame,
        );
        const prepared = await this.backend.prepareFrame(
          this.backendState,
          this.sceneState,
          frame,
          context,
        );
        this.assertCurrent(
          generation,
          revision,
          signal,
          "frame-prepare",
          context.operationId,
          frame,
        );
        return prepared;
      },
    );
    const token: PreparedFrameToken<PreparedFrame> = Object.freeze({
      sessionId: this.sessionId,
      revision,
      generation,
      frame,
    });
    this.tokenSet.add(token);
    this.tokenData.set(token, data);
    return token;
  }

  private async prepareReplacementTransaction(
    nextScene: Scene,
    context: RuntimeOperationContext,
  ): Promise<BackendUpdateTransaction<Session>> {
    const previous = this.backendState;
    const candidate = await this.backend.prepare(nextScene, context);
    let terminal: "commit" | "rollback" | undefined;
    return {
      summary: {
        reused: [],
        loaded: ["scene"],
        replaced: ["scene"],
        removed: [],
      },
      commit: () => {
        if (terminal)
          throw new Error(`Update transaction already ${terminal}.`);
        terminal = "commit";
        return {
          session: candidate,
          cleanup: Promise.resolve().then(() => this.backend.dispose(previous)),
        };
      },
      rollback: async () => {
        if (terminal === "rollback") return;
        if (terminal === "commit") {
          throw new Error("Committed update transaction cannot roll back.");
        }
        terminal = "rollback";
        await this.backend.dispose(candidate);
      },
    };
  }

  private assertPreflight(
    result: BackendPreflightResult,
    phase: RuntimePhase,
    operationId: string | undefined,
  ): void {
    if (
      result.ok &&
      !result.issues.some((issue) => issue.severity === "error")
    ) {
      return;
    }
    throw this.error(
      "preflight_failed",
      phase,
      `Backend "${this.backend.id}" preflight failed.`,
      operationId,
      undefined,
      undefined,
      { issues: result.issues },
    );
  }

  private assertFrame(frame: number): void {
    this.assertReady();
    if (
      !Number.isInteger(frame) ||
      frame < 0 ||
      frame >= this.sceneState.duration
    ) {
      throw this.error(
        "frame_out_of_range",
        "frame-prepare",
        `Frame must be an integer in [0, ${this.sceneState.duration - 1}], received ${String(frame)}.`,
        undefined,
        undefined,
        frame,
      );
    }
  }

  private assertReady(): void {
    if (this.statusState === "ready") return;
    throw this.error(
      this.statusState === "disposed" ? "disposed" : "disposed",
      "prepare",
      `Runtime session is ${this.statusState}.`,
    );
  }

  private assertExpectedRevision(
    expected: number,
    phase: RuntimePhase,
    operationId: string | undefined,
  ): void {
    if (!Number.isInteger(expected) || expected !== this.revisionState) {
      throw this.error(
        "stale_revision",
        phase,
        `Expected Scene revision ${expected}; current revision is ${this.revisionState}.`,
        operationId,
        undefined,
        undefined,
        { expectedRevision: expected, actualRevision: this.revisionState },
      );
    }
  }

  private assertCurrent(
    generation: number,
    revision: number,
    signal: AbortSignal,
    phase: RuntimePhase,
    operationId?: string,
    frame?: number,
  ): void {
    if (signal.aborted) {
      throw this.error(
        "aborted",
        phase,
        signal.reason instanceof Error
          ? signal.reason.message
          : "Runtime operation aborted.",
        operationId,
        signal.reason,
        frame,
      );
    }
    if (this.statusState !== "ready") {
      throw this.error(
        "disposed",
        phase,
        `Runtime is ${this.statusState}.`,
        operationId,
        undefined,
        frame,
      );
    }
    if (
      generation !== this.generationState ||
      revision !== this.revisionState
    ) {
      throw this.error(
        "stale_operation",
        phase,
        "Runtime operation belongs to a superseded Scene generation.",
        operationId,
        undefined,
        frame,
        {
          operationGeneration: generation,
          currentGeneration: this.generationState,
          operationRevision: revision,
          currentRevision: this.revisionState,
        },
      );
    }
  }

  private assertToken(
    token: PreparedFrameToken<PreparedFrame>,
    signal: AbortSignal,
    phase: RuntimePhase,
    operationId?: string,
  ): void {
    if (
      !this.tokenSet.has(token as object) ||
      token.sessionId !== this.sessionId
    ) {
      throw this.error(
        "stale_operation",
        phase,
        "Prepared frame token was not created by this runtime session.",
        operationId,
        undefined,
        token.frame,
      );
    }
    this.assertCurrent(
      token.generation,
      token.revision,
      signal,
      phase,
      operationId,
      token.frame,
    );
  }

  private preparedData(
    token: PreparedFrameToken<PreparedFrame>,
  ): PreparedFrame {
    const data = this.tokenData.get(token as object);
    if (data === undefined && !this.tokenData.has(token as object)) {
      throw this.error(
        "stale_operation",
        "frame-render",
        "Prepared frame payload is no longer available.",
        undefined,
        undefined,
        token.frame,
      );
    }
    return data as PreparedFrame;
  }

  private createController(external?: AbortSignal): AbortController {
    const controller = new AbortController();
    const abort = () => controller.abort(external?.reason);
    if (external?.aborted) abort();
    else external?.addEventListener("abort", abort, { once: true });
    Object.defineProperty(controller, "__dojoVideoEngineCleanup", {
      value: () => external?.removeEventListener("abort", abort),
    });
    this.activeControllers.add(controller);
    return controller;
  }

  private releaseController(controller: AbortController): void {
    this.activeControllers.delete(controller);
    const cleanup = (
      controller as AbortController & { __dojoVideoEngineCleanup?: () => void }
    ).__dojoVideoEngineCleanup;
    cleanup?.();
  }

  private abortActive(reason: Error): void {
    for (const controller of this.activeControllers) {
      if (!controller.signal.aborted) controller.abort(reason);
    }
  }

  private enqueue<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.queue.catch(() => undefined).then(operation);
    this.queue = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  }

  private async withPhase<T>(
    phase: RuntimePhase,
    code: RuntimeErrorCode,
    signal: AbortSignal,
    frame: number | undefined,
    work: (context: RuntimeOperationContext) => T | Promise<T>,
    allowDisposing = false,
    captureResult?: (result: T) => void,
    acceptAbortedResult?: () => boolean,
  ): Promise<T> {
    const operationId = `${this.sessionId}:op-${++this.operationSequence}`;
    const revision = this.revisionState;
    const generation = this.generationState;
    let terminal = false;
    const context: RuntimeOperationContext = {
      signal,
      sessionId: this.sessionId,
      operationId,
      revision,
      generation,
      emitProgress: (progressPhase, progress) => {
        if (terminal) return;
        const current = portableProgressNumber(progress.current);
        const total = portableProgressNumber(progress.total);
        const unit = portableProgressUnit(progress.unit);
        const details = portableProgressDetails(progress.details);
        this.emit({
          kind: "progress",
          phase: progressPhase,
          operationId,
          revision,
          ...(frame === undefined ? {} : { frame }),
          ...(current === undefined ? {} : { current }),
          ...(total === undefined ? {} : { total }),
          ...(unit === undefined ? {} : { unit }),
          ...(details === undefined ? {} : { details }),
        });
      },
    };
    this.emit({
      kind: "start",
      phase,
      operationId,
      revision,
      ...(frame === undefined ? {} : { frame }),
    });
    try {
      if (!allowDisposing) throwIfAborted(signal);
      const result = await work(context);
      captureResult?.(result);
      if (!allowDisposing && signal.aborted && !acceptAbortedResult?.()) {
        throwIfAborted(signal);
      }
      terminal = true;
      this.emit({
        kind: "complete",
        phase,
        operationId,
        revision: this.revisionState,
        ...(frame === undefined ? {} : { frame }),
      });
      return result;
    } catch (cause) {
      terminal = true;
      const error =
        cause instanceof RuntimeError
          ? cause
          : this.error(
              isAbortError(cause)
                ? "aborted"
                : cause instanceof Error &&
                    cause.name === "StalePreparedFrameError"
                  ? "stale_operation"
                  : cause instanceof Error &&
                      cause.name === "ArtifactTooLargeError"
                    ? "artifact_too_large"
                    : code,
              phase,
              cause instanceof Error ? cause.message : String(cause),
              operationId,
              cause,
              frame,
              cause instanceof Error &&
                cause.name === "ArtifactCommittedReceiptError"
                ? { committed: true }
                : undefined,
            );
      this.emit({
        kind: "error",
        phase,
        operationId,
        revision: this.revisionState,
        ...(frame === undefined ? {} : { frame }),
        code: error.code,
      });
      throw error;
    }
  }

  private emit(
    event: Omit<RuntimeEvent, "sequence" | "sessionId" | "backendId">,
  ): void {
    const complete: RuntimeEvent = {
      ...event,
      ...(event.details
        ? { details: sanitizeRuntimeDetails(event.details) }
        : {}),
      sequence: ++this.sequence,
      sessionId: this.sessionId,
      backendId: this.backend.id,
    };
    for (const listener of this.listeners) {
      try {
        listener(structuredClone(complete));
      } catch {
        // Observability cannot change engine behavior.
      }
    }
  }

  private error(
    code: RuntimeErrorCode,
    phase: RuntimePhase,
    message: string,
    operationId?: string,
    cause?: unknown,
    frame?: number,
    details?: Record<string, unknown>,
  ): RuntimeError {
    return new RuntimeError(message, code, phase, this.backend.id, {
      ...(operationId ? { operationId } : {}),
      revision: this.revisionState,
      ...(frame === undefined ? {} : { frame }),
      retryable: code === "aborted" || code === "stale_operation",
      ...(details ? { details } : {}),
      ...(cause === undefined ? {} : { cause }),
    });
  }
}

function portableProgressNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) && value >= 0
    ? value
    : undefined;
}

function portableProgressUnit(
  value: unknown,
): RuntimeEvent["unit"] | undefined {
  return value === "assets" ||
    value === "bytes" ||
    value === "frames" ||
    value === "items"
    ? value
    : undefined;
}

function portableProgressDetails(
  value: unknown,
): Record<string, unknown> | undefined {
  if (value === undefined) return undefined;
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return { serializationError: "details must be a plain JSON object." };
  }
  return sanitizeRuntimeDetails(value as Record<string, unknown>);
}

function cloneSummary(
  summary: BackendResourceUpdateSummary,
): BackendResourceUpdateSummary {
  return {
    reused: [...summary.reused],
    loaded: [...summary.loaded],
    replaced: [...summary.replaced],
    removed: [...summary.removed],
  };
}

function throwIfAborted(signal: AbortSignal): void {
  if (!signal.aborted) return;
  throw signal.reason instanceof Error
    ? signal.reason
    : createAbortError("Runtime operation aborted.");
}

function createAbortError(message: string): Error {
  if (typeof DOMException === "function") {
    return new DOMException(message, "AbortError");
  }
  const error = new Error(message);
  error.name = "AbortError";
  return error;
}

function isAbortError(value: unknown): boolean {
  return value instanceof Error && value.name === "AbortError";
}
