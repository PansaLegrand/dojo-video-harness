import { z } from "zod/v3";
import { zodToJsonSchema } from "zod-to-json-schema";
import type { Scene } from "@dojo-video-engine/schema";

export const INTERCHANGE_VERSION = 1 as const;
export const MAX_TICK = 100_000_000;
export const MAX_DIMENSION = 16_384;
export const MAX_COORDINATE = 1_000_000;
export const MAX_MESSAGE = 512;

export const idSchema = z.string().min(1).max(191);
export const markerIdSchema = z
  .string()
  .regex(/^[A-Za-z][A-Za-z0-9._-]{0,63}$/);
export const tickSchema = z.number().int().nonnegative().max(MAX_TICK);
export const durationTickSchema = z.number().int().positive().max(MAX_TICK);
export const dimensionSchema = z.number().int().positive().max(MAX_DIMENSION);
export const coordinateSchema = z
  .number()
  .finite()
  .min(-MAX_COORDINATE)
  .max(MAX_COORDINATE);
export const sizeSchema = z.number().finite().positive().max(MAX_COORDINATE);

/** A rational tick rate expressed as `numerator / denominator` ticks/second. */
export const rationalSchema = z
  .object({
    numerator: z.number().int().positive().max(1_000_000),
    denominator: z.number().int().positive().max(1_000_000),
  })
  .strict();
export type Rational = z.infer<typeof rationalSchema>;

export const interchangeDiagnosticCodes = [
  "timebase_quantized",
  "track_structure_flattened",
  "hierarchy_flattened",
  "unsupported_asset_dropped",
  "unsupported_node_dropped",
  "asset_metadata_reduced",
  "style_reduced",
  "playback_reduced",
  "audio_mix_reduced",
  "marker_label_dropped",
  "snapshot_flattened",
] as const;

export const interchangeDiagnosticSchema = z
  .object({
    severity: z.enum(["info", "warning"]),
    code: z.enum(interchangeDiagnosticCodes),
    path: z.array(z.union([z.string(), z.number().int()])).max(64),
    message: z.string().min(1).max(MAX_MESSAGE),
  })
  .strict();
export type InterchangeDiagnostic = z.infer<typeof interchangeDiagnosticSchema>;

export const interchangeFailureSchema = z
  .object({
    ok: z.literal(false),
    kind: z.literal("dojo-video-engine.interchange.failure"),
    version: z.literal(INTERCHANGE_VERSION),
    errors: z
      .array(
        z
          .object({
            code: z.enum(["invalid_input", "budget_exceeded"]),
            path: z.array(z.union([z.string(), z.number().int()])).max(64),
            message: z.string().min(1).max(MAX_MESSAGE),
          })
          .strict(),
      )
      .min(1)
      .max(64),
  })
  .strict();
export type InterchangeFailure = z.infer<typeof interchangeFailureSchema>;

export const interchangeBudgetsSchema = z
  .object({
    maxAssets: z.number().int().positive().max(256),
    maxTracks: z.number().int().positive().max(64),
    maxClips: z.number().int().positive().max(2_048),
    maxMarkers: z.number().int().positive().max(512),
    maxTextCharacters: z.number().int().positive().max(1_000_000),
    maxDurationSeconds: z.number().finite().positive().max(86_400),
    maxDiagnostics: z.number().int().positive().max(8_192),
  })
  .strict();
export type InterchangeBudgets = z.infer<typeof interchangeBudgetsSchema>;

export const defaultInterchangeBudgets: Readonly<InterchangeBudgets> =
  Object.freeze({
    maxAssets: 256,
    maxTracks: 64,
    maxClips: 2_048,
    maxMarkers: 512,
    maxTextCharacters: 1_000_000,
    maxDurationSeconds: 86_400,
    maxDiagnostics: 8_192,
  });

export function interchangeFailureJsonSchema(): Record<string, unknown> {
  return detachedJsonSchema(interchangeFailureSchema);
}

export function interchangeBudgetsJsonSchema(): Record<string, unknown> {
  return detachedJsonSchema(interchangeBudgetsSchema);
}

export function budgetsOf(
  overrides: Partial<InterchangeBudgets> | undefined,
): { ok: true; budgets: InterchangeBudgets } | InterchangeFailure {
  const parsed = interchangeBudgetsSchema.safeParse({
    ...defaultInterchangeBudgets,
    ...(overrides ?? {}),
  });
  if (!parsed.success) return zodFailure(parsed.error, ["budgets"]);
  return { ok: true, budgets: parsed.data };
}

export function checkSceneBudgets(
  scene: Scene,
  budgets: InterchangeBudgets,
): InterchangeFailure | null {
  if (Object.keys(scene.assets).length > budgets.maxAssets) {
    return failure(
      "budget_exceeded",
      ["scene", "assets"],
      `Asset count exceeds ${budgets.maxAssets}.`,
    );
  }
  if (Object.keys(scene.markers ?? {}).length > budgets.maxMarkers) {
    return failure(
      "budget_exceeded",
      ["scene", "markers"],
      `Marker count exceeds ${budgets.maxMarkers}.`,
    );
  }
  if (scene.duration / scene.fps > budgets.maxDurationSeconds) {
    return failure(
      "budget_exceeded",
      ["scene", "duration"],
      `Scene duration exceeds ${budgets.maxDurationSeconds} seconds.`,
    );
  }
  let count = 0;
  let textCharacters = 0;
  const work = [...scene.nodes];
  while (work.length) {
    const node = work.pop()!;
    count += 1;
    if (count > budgets.maxClips) {
      return failure(
        "budget_exceeded",
        ["scene", "nodes"],
        `Node count exceeds ${budgets.maxClips}.`,
      );
    }
    textCharacters +=
      node.text?.length ??
      node.runs?.reduce((total, run) => total + run.text.length, 0) ??
      0;
    if (textCharacters > budgets.maxTextCharacters) {
      return failure(
        "budget_exceeded",
        ["scene", "nodes"],
        `Text character count exceeds ${budgets.maxTextCharacters}.`,
      );
    }
    work.push(...(node.children ?? []));
  }
  return null;
}

export type IntegerConversion = { value: number; exact: boolean };

export function ticksToFrames(
  ticks: number,
  fps: number,
  timebase: Rational,
): IntegerConversion | null {
  return roundedRatio(
    BigInt(ticks) * BigInt(fps) * BigInt(timebase.denominator),
    BigInt(timebase.numerator),
    MAX_TICK * 1_000,
  );
}

export function framesToTicks(
  frames: number,
  fps: number,
  timebase: Rational,
): IntegerConversion | null {
  return roundedRatio(
    BigInt(frames) * BigInt(timebase.numerator),
    BigInt(fps) * BigInt(timebase.denominator),
    MAX_TICK,
  );
}

export function secondsToTicks(
  seconds: number,
  timebase: Rational,
): IntegerConversion | null {
  const unrounded = (seconds * timebase.numerator) / timebase.denominator;
  if (!Number.isFinite(unrounded) || unrounded < 0 || unrounded > MAX_TICK) {
    return null;
  }
  const value = Math.round(unrounded);
  return {
    value,
    exact:
      Math.abs(unrounded - value) <=
      Number.EPSILON * Math.max(1, unrounded) * 4,
  };
}

export function ticksToSeconds(ticks: number, timebase: Rational): number {
  return (ticks * timebase.denominator) / timebase.numerator;
}

function roundedRatio(
  numerator: bigint,
  denominator: bigint,
  maximum: number,
): IntegerConversion | null {
  const quotient = numerator / denominator;
  const remainder = numerator % denominator;
  const rounded = quotient + (remainder * 2n >= denominator ? 1n : 0n);
  if (rounded > BigInt(maximum) || rounded > BigInt(Number.MAX_SAFE_INTEGER)) {
    return null;
  }
  return { value: Number(rounded), exact: remainder === 0n };
}

export function pushDiagnostic(
  diagnostics: InterchangeDiagnostic[],
  budgets: InterchangeBudgets,
  diagnostic: InterchangeDiagnostic,
): void {
  if (diagnostics.length >= budgets.maxDiagnostics) {
    throw new InterchangeInternalError(
      failure(
        "budget_exceeded",
        ["diagnostics"],
        `Diagnostic count exceeds ${budgets.maxDiagnostics}.`,
      ),
    );
  }
  diagnostics.push(diagnostic);
}

export function detachedJsonSchema(
  schema: z.ZodTypeAny,
): Record<string, unknown> {
  return structuredClone({
    $schema: "http://json-schema.org/draft-07/schema#",
    ...(zodToJsonSchema(schema, {
      target: "jsonSchema7",
      $refStrategy: "root",
    }) as Record<string, unknown>),
  });
}

export function zodFailure(
  error: z.ZodError,
  prefix: Array<string | number> = [],
): InterchangeFailure {
  return {
    ok: false,
    kind: "dojo-video-engine.interchange.failure",
    version: 1,
    errors: error.issues.slice(0, 64).map((issue) => ({
      code: "invalid_input",
      path: [...prefix, ...issue.path].slice(0, 64),
      message: issue.message.slice(0, MAX_MESSAGE),
    })),
  };
}

export function failure(
  code: "invalid_input" | "budget_exceeded",
  path: Array<string | number>,
  message: string,
): InterchangeFailure {
  return {
    ok: false,
    kind: "dojo-video-engine.interchange.failure",
    version: 1,
    errors: [
      {
        code,
        path: path.slice(0, 64),
        message: message.slice(0, MAX_MESSAGE),
      },
    ],
  };
}

export class InterchangeInternalError extends Error {
  constructor(readonly result: InterchangeFailure) {
    super(result.errors[0]?.message ?? "Interchange failure.");
  }
}

export function caughtFailure(error: unknown): InterchangeFailure {
  if (error instanceof InterchangeInternalError) return error.result;
  let message = "Interchange input could not be read safely.";
  try {
    if (error instanceof Error && error.message) message = error.message;
  } catch {
    // Retain the bounded generic message for hostile thrown values.
  }
  return failure("invalid_input", [], message);
}
