import type {
  MediaMetricsProvider,
  TextMetricsProvider,
} from "@dojo-video-engine/core";
import type { Scene } from "@dojo-video-engine/schema";

export type RuntimePhase =
  | "parse"
  | "preflight"
  | "resolve"
  | "evaluate"
  | "prepare"
  | "update"
  | "frame-prepare"
  | "frame-render"
  | "artifact-write"
  | "audio"
  | "encode"
  | "mux"
  | "verify"
  | "dispose";

export type RuntimeEventKind = "start" | "progress" | "complete" | "error";

export type RuntimeEvent = {
  kind: RuntimeEventKind;
  phase: RuntimePhase;
  sequence: number;
  sessionId: string;
  operationId: string;
  revision: number;
  backendId: string;
  frame?: number;
  current?: number;
  total?: number;
  unit?: "assets" | "bytes" | "frames" | "items";
  code?: RuntimeErrorCode;
  details?: Record<string, unknown>;
};

export type RuntimeEventListener = (event: RuntimeEvent) => void;

export type RuntimeErrorCode =
  | "invalid_scene"
  | "preflight_failed"
  | "prepare_failed"
  | "update_failed"
  | "stale_revision"
  | "stale_operation"
  | "frame_out_of_range"
  | "frame_prepare_failed"
  | "frame_render_failed"
  | "artifact_unsupported"
  | "artifact_encode_failed"
  | "artifact_too_large"
  | "artifact_sink_failed"
  | "aborted"
  | "disposed"
  | "dispose_failed";

export type SerializedRuntimeError = {
  name: "RuntimeError";
  message: string;
  code: RuntimeErrorCode;
  phase: RuntimePhase;
  backendId: string;
  operationId?: string;
  revision?: number;
  frame?: number;
  retryable: boolean;
  details?: Record<string, unknown>;
  cause?: { name: string; message: string };
};

export class RuntimeError extends Error {
  readonly name = "RuntimeError";

  constructor(
    message: string,
    readonly code: RuntimeErrorCode,
    readonly phase: RuntimePhase,
    readonly backendId: string,
    readonly context: {
      operationId?: string;
      revision?: number;
      frame?: number;
      retryable?: boolean;
      details?: Record<string, unknown>;
      cause?: unknown;
    } = {},
  ) {
    super(message, { cause: context.cause });
  }

  toJSON(): SerializedRuntimeError {
    const cause = this.context.cause;
    return {
      name: "RuntimeError",
      message: this.message,
      code: this.code,
      phase: this.phase,
      backendId: this.backendId,
      ...(this.context.operationId
        ? { operationId: this.context.operationId }
        : {}),
      ...(this.context.revision !== undefined
        ? { revision: this.context.revision }
        : {}),
      ...(this.context.frame !== undefined
        ? { frame: this.context.frame }
        : {}),
      retryable: this.context.retryable ?? false,
      ...(this.context.details
        ? { details: sanitizeRuntimeDetails(this.context.details) }
        : {}),
      ...(cause
        ? {
            cause: {
              name: cause instanceof Error ? cause.name : "Error",
              message: cause instanceof Error ? cause.message : String(cause),
            },
          }
        : {}),
    };
  }
}

export function serializeRuntimeError(error: unknown): SerializedRuntimeError {
  if (error instanceof RuntimeError) return error.toJSON();
  const value = error instanceof Error ? error : new Error(String(error));
  return {
    name: "RuntimeError",
    message: value.message,
    code: value.name === "AbortError" ? "aborted" : "prepare_failed",
    phase: "prepare",
    backendId: "unknown",
    retryable: value.name === "AbortError",
    cause: { name: value.name, message: value.message },
  };
}

export type BackendCapability = {
  name: string;
  supported: boolean;
  detail?: string;
};

export type PreparedSceneBackendCapabilities = {
  renderFrames: boolean;
  frameImageMimeTypes: string[];
  /**
   * Prepared state can be borrowed by backend-specific compatibility adapters
   * that preview or mix audio. This is not a renderer-neutral PCM API.
   */
  audioResources: boolean;
  worker: boolean;
  capabilities?: BackendCapability[];
};

export type BackendPreflightIssue = {
  severity: "error" | "warning";
  code: string;
  message: string;
};

export type BackendPreflightResult = {
  ok: boolean;
  issues: BackendPreflightIssue[];
  capabilities?: PreparedSceneBackendCapabilities;
};

export type BackendResourceUpdateSummary = {
  reused: string[];
  loaded: string[];
  replaced: string[];
  removed: string[];
};

export type BackendUpdateCommit<Session> = {
  session: Session;
  /** Awaitable cleanup for the superseded state; invoked exactly once. */
  cleanup?: Promise<void>;
};

export interface BackendUpdateTransaction<Session> {
  readonly summary: BackendResourceUpdateSummary;
  /** Synchronous publication point. Must be safe to call at most once. */
  commit(): BackendUpdateCommit<Session>;
  /** Idempotent rollback of provisional resources. */
  rollback(): Promise<void>;
}

export type RuntimeOperationContext = {
  signal: AbortSignal;
  sessionId: string;
  operationId: string;
  revision: number;
  generation: number;
  emitProgress(
    phase: RuntimePhase,
    progress: Pick<RuntimeEvent, "current" | "total" | "unit" | "details">,
  ): void;
};

export type BackendFrameImage = {
  width: number;
  height: number;
  mimeType: string;
  colorSpace?: "srgb";
  chunks: Iterable<Uint8Array> | AsyncIterable<Uint8Array>;
};

export type RuntimeMetricsProviders = {
  text?: TextMetricsProvider;
  media?: MediaMetricsProvider;
};

export interface PreparedSceneBackend<Session, PreparedFrame, Target> {
  readonly id: string;
  readonly capabilities: PreparedSceneBackendCapabilities;
  preflight(
    scene: Scene,
    context: RuntimeOperationContext,
  ): BackendPreflightResult | Promise<BackendPreflightResult>;
  prepare(scene: Scene, context: RuntimeOperationContext): Promise<Session>;
  prepareUpdate?(
    current: Session,
    previousScene: Scene,
    nextScene: Scene,
    context: RuntimeOperationContext,
  ): Promise<BackendUpdateTransaction<Session>>;
  prepareFrame(
    session: Session,
    scene: Scene,
    frame: number,
    context: RuntimeOperationContext,
  ): Promise<PreparedFrame>;
  renderFrame(
    session: Session,
    scene: Scene,
    frame: number,
    prepared: PreparedFrame,
    target: Target,
    context: RuntimeOperationContext,
  ): void | Promise<void>;
  encodeFrameImage?(
    session: Session,
    scene: Scene,
    frame: number,
    prepared: PreparedFrame,
    options: { mimeType: string; quality?: number; maxBytes: number },
    context: RuntimeOperationContext,
  ): Promise<BackendFrameImage>;
  metrics?(session: Session, scene: Scene): RuntimeMetricsProviders;
  dispose(session: Session): Promise<void>;
}

declare const preparedFrameTokenType: unique symbol;

export type PreparedFrameToken<PreparedFrame> = {
  readonly sessionId: string;
  readonly revision: number;
  readonly generation: number;
  readonly frame: number;
  /** Compile-time-only backend payload brand; prepared data remains opaque. */
  readonly [preparedFrameTokenType]?: (value: PreparedFrame) => PreparedFrame;
};

const MAX_RUNTIME_DETAILS_DEPTH = 12;
const MAX_RUNTIME_DETAILS_ENTRIES = 512;
const MAX_RUNTIME_DETAILS_KEY_LENGTH = 256;
const MAX_RUNTIME_DETAILS_STRING_LENGTH = 8_192;
const MAX_RUNTIME_DETAILS_BYTES = 32 * 1_024;

/** Converts observability metadata to a bounded, portable JSON object. */
export function sanitizeRuntimeDetails(
  value: Record<string, unknown>,
): Record<string, unknown> {
  try {
    const state = { entries: 0 };
    const result = strictRuntimeJsonClone(
      value,
      new WeakSet(),
      "details",
      0,
      state,
    ) as Record<string, unknown>;
    const bytes = new TextEncoder().encode(JSON.stringify(result)).byteLength;
    if (bytes > MAX_RUNTIME_DETAILS_BYTES) {
      throw new RangeError(
        `details exceeds ${MAX_RUNTIME_DETAILS_BYTES} UTF-8 bytes.`,
      );
    }
    return result;
  } catch (cause) {
    return {
      serializationError: truncateRuntimeDetailError(
        cause instanceof Error ? cause.message : String(cause),
      ),
    };
  }
}

function strictRuntimeJsonClone(
  value: unknown,
  seen: WeakSet<object>,
  path: string,
  depth: number,
  state: { entries: number },
): unknown {
  if (depth > MAX_RUNTIME_DETAILS_DEPTH) {
    throw new RangeError(
      `${path} exceeds maximum depth ${MAX_RUNTIME_DETAILS_DEPTH}.`,
    );
  }
  if (value === null || typeof value === "boolean") {
    return value;
  }
  if (typeof value === "string") {
    if (value.length > MAX_RUNTIME_DETAILS_STRING_LENGTH) {
      throw new RangeError(
        `${path} exceeds ${MAX_RUNTIME_DETAILS_STRING_LENGTH} characters.`,
      );
    }
    return value;
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new TypeError(`${path} is non-finite.`);
    return value;
  }
  if (typeof value !== "object") {
    throw new TypeError(`${path} contains non-JSON ${typeof value}.`);
  }
  if (seen.has(value)) throw new TypeError(`${path} is cyclic or shared.`);
  seen.add(value);
  if (Array.isArray(value)) {
    const result: unknown[] = [];
    for (let index = 0; index < value.length; index += 1) {
      if (!(index in value)) throw new TypeError(`${path} is sparse.`);
      state.entries += 1;
      if (state.entries > MAX_RUNTIME_DETAILS_ENTRIES) {
        throw new RangeError(
          `details exceeds ${MAX_RUNTIME_DETAILS_ENTRIES} entries.`,
        );
      }
      result.push(
        strictRuntimeJsonClone(
          value[index],
          seen,
          `${path}[${index}]`,
          depth + 1,
          state,
        ),
      );
    }
    return result;
  }
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) {
    throw new TypeError(`${path} contains a non-plain object.`);
  }
  const result: Record<string, unknown> = {};
  for (const [key, entry] of Object.entries(value)) {
    if (key.length > MAX_RUNTIME_DETAILS_KEY_LENGTH) {
      throw new RangeError(
        `${path} contains a key longer than ${MAX_RUNTIME_DETAILS_KEY_LENGTH} characters.`,
      );
    }
    state.entries += 1;
    if (state.entries > MAX_RUNTIME_DETAILS_ENTRIES) {
      throw new RangeError(
        `details exceeds ${MAX_RUNTIME_DETAILS_ENTRIES} entries.`,
      );
    }
    result[key] = strictRuntimeJsonClone(
      entry,
      seen,
      `${path}.${key}`,
      depth + 1,
      state,
    );
  }
  return result;
}

function truncateRuntimeDetailError(value: string): string {
  return value.length <= 512 ? value : `${value.slice(0, 509)}...`;
}
