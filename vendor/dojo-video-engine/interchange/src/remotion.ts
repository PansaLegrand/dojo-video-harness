import { z } from "zod/v3";
import { sceneSchema, validateScene } from "@dojo-video-engine/schema";
import {
  INTERCHANGE_VERSION,
  budgetsOf,
  caughtFailure,
  checkSceneBudgets,
  detachedJsonSchema,
  dimensionSchema,
  failure,
  interchangeFailureSchema,
  zodFailure,
  type InterchangeBudgets,
} from "./common";

const compositionIdSchema = z
  .string()
  .regex(/^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/);

export const remotionHostDescriptorSchema = z
  .object({
    bridgeVersion: z.literal(INTERCHANGE_VERSION),
    kind: z.literal("dojo-video-engine.remotion-host"),
    composition: z
      .object({
        id: compositionIdSchema,
        width: dimensionSchema,
        height: dimensionSchema,
        fps: z.number().int().positive().max(1_000),
        durationInFrames: z.number().int().positive().max(86_400_000),
      })
      .strict(),
    scene: sceneSchema,
    hostContract: z
      .object({
        frameSource: z.literal("host"),
        renderEntry: z.literal("dojo-video-engine-canvas2d"),
        reactExecution: z.literal(false),
        arbitraryCompositionImport: z.literal(false),
      })
      .strict(),
  })
  .strict();
export type RemotionHostDescriptor = z.infer<
  typeof remotionHostDescriptorSchema
>;

export const remotionFramePayloadSchema = z
  .object({
    bridgeVersion: z.literal(INTERCHANGE_VERSION),
    kind: z.literal("dojo-video-engine.remotion-frame"),
    compositionId: compositionIdSchema,
    frame: z.number().int().nonnegative().max(86_399_999),
    scene: sceneSchema,
  })
  .strict();
export type RemotionFramePayload = z.infer<typeof remotionFramePayloadSchema>;

export const remotionHostResultSchema = z.union([
  z
    .object({
      ok: z.literal(true),
      kind: z.literal("dojo-video-engine.remotion-host-result"),
      version: z.literal(INTERCHANGE_VERSION),
      descriptor: remotionHostDescriptorSchema,
    })
    .strict(),
  interchangeFailureSchema,
]);
export const remotionFrameResultSchema = z.union([
  z
    .object({
      ok: z.literal(true),
      kind: z.literal("dojo-video-engine.remotion-frame-result"),
      version: z.literal(INTERCHANGE_VERSION),
      payload: remotionFramePayloadSchema,
    })
    .strict(),
  interchangeFailureSchema,
]);
export type RemotionHostResult = z.infer<typeof remotionHostResultSchema>;
export type RemotionFrameResult = z.infer<typeof remotionFrameResultSchema>;

/**
 * This bridge is intentionally one-way and data-only. A host React composition
 * owns the current frame and calls DojoVideoEngine; no React tree is evaluated here.
 */
export const remotionBridgeCapabilities = Object.freeze({
  version: INTERCHANGE_VERSION,
  direction: "dojo-video-engine-to-remotion-host" as const,
  evaluatesReact: false,
  importsArbitraryCompositions: false,
  payload: "canonical-scene-and-host-frame" as const,
});

export function remotionHostDescriptorJsonSchema(): Record<string, unknown> {
  return detachedJsonSchema(remotionHostDescriptorSchema);
}

export function remotionFramePayloadJsonSchema(): Record<string, unknown> {
  return detachedJsonSchema(remotionFramePayloadSchema);
}

export function remotionHostResultJsonSchema(): Record<string, unknown> {
  return detachedJsonSchema(remotionHostResultSchema);
}

export function remotionFrameResultJsonSchema(): Record<string, unknown> {
  return detachedJsonSchema(remotionFrameResultSchema);
}

export function createRemotionHostDescriptor(
  input: unknown,
  options: {
    compositionId?: string;
    budgets?: Partial<InterchangeBudgets>;
  } = {},
): RemotionHostResult {
  try {
    const validation = validateScene(input);
    if (!validation.ok) {
      return failure("invalid_input", ["scene"], validation.errors.join(" "));
    }
    const budgetResult = budgetsOf(options.budgets);
    if (!budgetResult.ok) return budgetResult;
    const budgetFailure = checkSceneBudgets(
      validation.scene,
      budgetResult.budgets,
    );
    if (budgetFailure) return budgetFailure;
    const parsed = remotionHostDescriptorSchema.safeParse({
      bridgeVersion: 1,
      kind: "dojo-video-engine.remotion-host",
      composition: {
        id: options.compositionId ?? "DojoVideoEngineScene",
        width: validation.scene.width,
        height: validation.scene.height,
        fps: validation.scene.fps,
        durationInFrames: validation.scene.duration,
      },
      scene: validation.scene,
      hostContract: {
        frameSource: "host",
        renderEntry: "dojo-video-engine-canvas2d",
        reactExecution: false,
        arbitraryCompositionImport: false,
      },
    });
    if (!parsed.success) return zodFailure(parsed.error, ["descriptor"]);
    return {
      ok: true,
      kind: "dojo-video-engine.remotion-host-result",
      version: 1,
      descriptor: structuredClone(parsed.data),
    };
  } catch (error) {
    return caughtFailure(error);
  }
}

export function createRemotionFramePayload(
  descriptorInput: unknown,
  frameInput: unknown,
  options: { budgets?: Partial<InterchangeBudgets> } = {},
): RemotionFrameResult {
  try {
    const descriptor = remotionHostDescriptorSchema.safeParse(descriptorInput);
    if (!descriptor.success) {
      return zodFailure(descriptor.error, ["descriptor"]);
    }
    const budgetResult = budgetsOf(options.budgets);
    if (!budgetResult.ok) return budgetResult;
    const budgetFailure = checkSceneBudgets(
      descriptor.data.scene,
      budgetResult.budgets,
    );
    if (budgetFailure) return budgetFailure;
    const { composition, scene } = descriptor.data;
    if (
      composition.width !== scene.width ||
      composition.height !== scene.height ||
      composition.fps !== scene.fps ||
      composition.durationInFrames !== scene.duration
    ) {
      return failure(
        "invalid_input",
        ["descriptor", "composition"],
        "Host composition dimensions, fps, and duration must match the canonical Scene.",
      );
    }
    const frame = z.number().int().nonnegative().safeParse(frameInput);
    if (!frame.success) return zodFailure(frame.error, ["frame"]);
    if (frame.data >= descriptor.data.composition.durationInFrames) {
      return failure(
        "invalid_input",
        ["frame"],
        "Frame must be inside the host composition duration.",
      );
    }
    const payload = remotionFramePayloadSchema.safeParse({
      bridgeVersion: 1,
      kind: "dojo-video-engine.remotion-frame",
      compositionId: descriptor.data.composition.id,
      frame: frame.data,
      scene: descriptor.data.scene,
    });
    if (!payload.success) return zodFailure(payload.error, ["payload"]);
    return {
      ok: true,
      kind: "dojo-video-engine.remotion-frame-result",
      version: 1,
      payload: structuredClone(payload.data),
    };
  } catch (error) {
    return caughtFailure(error);
  }
}
