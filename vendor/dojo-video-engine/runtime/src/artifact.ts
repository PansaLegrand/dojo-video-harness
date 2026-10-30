import type { BackendFrameImage } from "./types";

export type FrameImageArtifactDescriptor = {
  kind: "dojo-video-engine.frame-image";
  version: 1;
  sessionId: string;
  revision: number;
  frame: number;
  sceneTimestampUs: number;
  width: number;
  height: number;
  mimeType: string;
  colorSpace: "srgb";
  operationKey: string;
};

export type ArtifactSinkContext = { signal: AbortSignal };

export interface ArtifactSinkWriter<Receipt extends Record<string, unknown>> {
  write(chunk: Uint8Array, context: ArtifactSinkContext): Promise<void>;
  commit(context: ArtifactSinkContext): Promise<Receipt>;
  /** Idempotent. A failed commit may be followed by abort. */
  abort(reason: unknown): Promise<void>;
}

export interface FrameArtifactSink<Receipt extends Record<string, unknown>> {
  begin(
    descriptor: FrameImageArtifactDescriptor,
    context: ArtifactSinkContext,
  ): Promise<ArtifactSinkWriter<Receipt>>;
}

export type FrameArtifactResult<Receipt extends Record<string, unknown>> = {
  descriptor: FrameImageArtifactDescriptor & { byteLength: number };
  receipt: Receipt;
};

export async function writeFrameImageArtifact<
  Receipt extends Record<string, unknown>,
>(options: {
  image: BackendFrameImage;
  descriptor: Omit<
    FrameImageArtifactDescriptor,
    "width" | "height" | "mimeType" | "colorSpace"
  >;
  sink: FrameArtifactSink<Receipt>;
  signal: AbortSignal;
  maxBytes: number;
  assertCurrent(): void;
}): Promise<FrameArtifactResult<Receipt>> {
  if (!Number.isInteger(options.maxBytes) || options.maxBytes < 1) {
    throw new RangeError("maxBytes must be a positive integer.");
  }
  if (
    !Number.isInteger(options.image.width) ||
    options.image.width < 1 ||
    !Number.isInteger(options.image.height) ||
    options.image.height < 1 ||
    !options.image.mimeType
  ) {
    throw new TypeError(
      "Artifact backend must provide positive integer dimensions and a MIME type.",
    );
  }
  const descriptor: FrameImageArtifactDescriptor = {
    ...options.descriptor,
    width: options.image.width,
    height: options.image.height,
    mimeType: options.image.mimeType,
    colorSpace: options.image.colorSpace ?? "srgb",
  };
  options.assertCurrent();
  throwIfAborted(options.signal);
  const sinkDescriptor = Object.freeze({ ...descriptor });
  const writer = await options.sink.begin(sinkDescriptor, {
    signal: options.signal,
  });
  let terminal = false;
  let byteLength = 0;
  try {
    for await (const chunk of options.image.chunks) {
      options.assertCurrent();
      throwIfAborted(options.signal);
      if (!(chunk instanceof Uint8Array)) {
        throw new TypeError("Artifact backends must yield Uint8Array chunks.");
      }
      byteLength += chunk.byteLength;
      if (byteLength > options.maxBytes) {
        const error = new RangeError(
          `Frame artifact exceeds ${options.maxBytes} bytes.`,
        );
        error.name = "ArtifactTooLargeError";
        throw error;
      }
      await writer.write(chunk, { signal: options.signal });
    }
    options.assertCurrent();
    throwIfAborted(options.signal);
    const receipt = await writer.commit({ signal: options.signal });
    terminal = true;
    let receiptClone: Receipt;
    try {
      receiptClone = cloneJsonReceipt(receipt);
    } catch (cause) {
      const error = new TypeError(
        `Artifact was committed but its receipt is invalid: ${cause instanceof Error ? cause.message : String(cause)}`,
      );
      error.name = "ArtifactCommittedReceiptError";
      throw error;
    }
    return {
      descriptor: { ...descriptor, byteLength },
      receipt: receiptClone,
    };
  } catch (primary) {
    if (!terminal) {
      try {
        await writer.abort(primary);
      } catch (cleanup) {
        throw new AggregateError(
          [primary, cleanup],
          "Artifact write failed and sink abort also failed.",
          { cause: primary },
        );
      }
    }
    throw primary;
  }
}

function throwIfAborted(signal: AbortSignal): void {
  if (!signal.aborted) return;
  const reason = signal.reason;
  if (reason instanceof Error) throw reason;
  const error = new Error("Runtime operation aborted.");
  error.name = "AbortError";
  throw error;
}

function cloneJsonReceipt<T extends Record<string, unknown>>(receipt: T): T {
  const seen = new WeakSet<object>();
  const clone = strictJsonClone(receipt, seen, "receipt");
  const serialized = JSON.stringify(clone);
  const byteLength = new TextEncoder().encode(serialized).byteLength;
  if (byteLength > 64 * 1024) {
    throw new TypeError(
      `Artifact sink receipt is ${byteLength} UTF-8 bytes; maximum is 65536.`,
    );
  }
  return clone as T;
}

function strictJsonClone(
  value: unknown,
  seen: WeakSet<object>,
  path: string,
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
      throw new TypeError(`${path} contains a non-finite number.`);
    }
    return value;
  }
  if (typeof value !== "object") {
    throw new TypeError(`${path} contains non-JSON ${typeof value}.`);
  }
  if (seen.has(value)) {
    throw new TypeError(`${path} contains a cycle or shared object reference.`);
  }
  seen.add(value);
  if (Array.isArray(value)) {
    return value.map((entry, index) =>
      strictJsonClone(entry, seen, `${path}[${index}]`),
    );
  }
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) {
    throw new TypeError(
      `${path} contains non-plain object ${value.constructor?.name ?? "unknown"}.`,
    );
  }
  const result: Record<string, unknown> = {};
  for (const [key, entry] of Object.entries(value)) {
    result[key] = strictJsonClone(entry, seen, `${path}.${key}`);
  }
  return result;
}
