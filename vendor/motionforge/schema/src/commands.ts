import { z } from "zod/v3";
import { zodToJsonSchema } from "zod-to-json-schema";
import {
  animationSchema,
  audioBusSchema,
  duckingSchema,
  effectNames,
  effectParamsSchema,
  parseScene,
  styleSchema,
  supportedStyleKeys,
  volumeEnvelopeSchema,
  type Scene,
  type SceneAnimation,
  type SceneDucking,
  type SceneEffectName,
  type SceneEffectParams,
  type SceneStyle,
  type VolumeEnvelope,
} from "./index";
import {
  applyScenePatch,
  scenePatchSchema,
  type ScenePatch,
} from "./patch";

/**
 * Agent command protocol.
 *
 * ScenePatch remains the canonical low-level edit vocabulary. Commands are a
 * smaller model-facing surface: media node variants are discriminated, style
 * writes are explicit key/value changes, and recursive children are omitted.
 * This avoids the invalid cross-type property combinations and large recursive
 * schemas produced when a model is given SceneNode directly.
 */

export const SCENE_COMMAND_PROTOCOL_VERSION = 1 as const;
export const MAX_SCENE_COMMANDS_PER_BATCH = 32;

const styleLengthBoxSchema = z
  .object({
    top: z.union([z.number(), z.string()]).optional(),
    right: z.union([z.number(), z.string()]).optional(),
    bottom: z.union([z.number(), z.string()]).optional(),
    left: z.union([z.number(), z.string()]).optional(),
  })
  .strict();

export const sceneStyleCommandValueSchema = z.union([
  z.string(),
  z.number().finite(),
  z.boolean(),
  z.null(),
  z.array(z.number().nonnegative()).max(32),
  styleLengthBoxSchema,
]);

export const sceneStyleChangeSchema = z
  .object({
    property: z.enum(supportedStyleKeys),
    value: sceneStyleCommandValueSchema,
  })
  .strict();

const nodeIdSchema = z.string().trim().min(1).max(191);
const assetIdSchema = z.string().trim().min(1).max(191);
const frameSchema = z.number().int().nonnegative();
const durationSchema = z.number().int().positive();
const nullablePlacementIdSchema = nodeIdSchema.nullable().optional();

const insertionPlacementShape = {
  parentId: nullablePlacementIdSchema,
  beforeId: nullablePlacementIdSchema,
};

const visualInsertionShape = {
  id: nodeIdSchema,
  from: frameSchema,
  duration: durationSchema,
  style: z.array(sceneStyleChangeSchema).max(48).default([]),
  animations: z.array(animationSchema).max(24).default([]),
  ...insertionPlacementShape,
};

const setTextCommandSchema = z
  .object({
    kind: z.literal("node.set_text"),
    id: nodeIdSchema,
    text: z.string().max(20_000),
  })
  .strict();

const setStyleCommandSchema = z
  .object({
    kind: z.literal("node.set_style"),
    id: nodeIdSchema,
    changes: z.array(sceneStyleChangeSchema).min(1).max(48),
  })
  .strict();

const setTimingCommandSchema = z
  .object({
    kind: z.literal("node.set_timing"),
    id: nodeIdSchema,
    from: frameSchema,
    duration: durationSchema,
  })
  .strict();

const setStartCommandSchema = z
  .object({
    kind: z.literal("node.set_start"),
    id: nodeIdSchema,
    from: frameSchema,
  })
  .strict();

const setDurationCommandSchema = z
  .object({
    kind: z.literal("node.set_duration"),
    id: nodeIdSchema,
    duration: durationSchema,
  })
  .strict();

const setAnimationsCommandSchema = z
  .object({
    kind: z.literal("node.set_animations"),
    id: nodeIdSchema,
    animations: z.array(animationSchema).max(24),
  })
  .strict();

const setVolumeCommandSchema = z
  .object({
    kind: z.literal("media.set_volume"),
    id: nodeIdSchema,
    volume: z.number().min(0).max(1),
  })
  .strict();

const setLoopCommandSchema = z
  .object({
    kind: z.literal("audio.set_loop"),
    id: nodeIdSchema,
    loop: z.boolean(),
  })
  .strict();

const setPlaybackRateCommandSchema = z
  .object({
    kind: z.literal("media.set_playback_rate"),
    id: nodeIdSchema,
    playbackRate: z.number().min(0.0625).max(16),
  })
  .strict();

const setSourceOffsetCommandSchema = z
  .object({
    kind: z.literal("media.set_source_offset"),
    id: nodeIdSchema,
    mediaType: z.enum(["video", "audio"]),
    seconds: z.number().nonnegative(),
  })
  .strict();

const setVolumeEnvelopeCommandSchema = z
  .object({
    kind: z.literal("audio.set_volume_envelope"),
    id: nodeIdSchema,
    envelope: volumeEnvelopeSchema,
  })
  .strict();

const setPanCommandSchema = z
  .object({
    kind: z.literal("audio.set_pan"),
    id: nodeIdSchema,
    pan: z.number().min(-1).max(1),
  })
  .strict();

const setAudioBusCommandSchema = z
  .object({
    kind: z.literal("audio.set_bus"),
    id: nodeIdSchema,
    bus: z.string().trim().min(1).max(64).nullable(),
  })
  .strict();

const setDuckingCommandSchema = z
  .object({
    kind: z.literal("audio.set_ducking"),
    id: nodeIdSchema,
    ducking: duckingSchema.nullable(),
  })
  .strict();

const insertTextCommandSchema = z
  .object({
    kind: z.literal("node.insert_text"),
    text: z.string().max(20_000),
    ...visualInsertionShape,
  })
  .strict();

const insertDivCommandSchema = z
  .object({
    kind: z.literal("node.insert_div"),
    ...visualInsertionShape,
  })
  .strict();

const insertImageCommandSchema = z
  .object({
    kind: z.literal("node.insert_image"),
    assetId: assetIdSchema,
    ...visualInsertionShape,
  })
  .strict();

const insertVideoCommandSchema = z
  .object({
    kind: z.literal("node.insert_video"),
    assetId: assetIdSchema,
    volume: z.number().min(0).max(1).default(1),
    playbackRate: z.number().min(0.0625).max(16).default(1),
    sourceOffsetSeconds: z.number().nonnegative().default(0),
    endBehavior: z.enum(["hold", "loop"]).default("hold"),
    ...visualInsertionShape,
  })
  .strict();

const insertAudioCommandSchema = z
  .object({
    kind: z.literal("node.insert_audio"),
    id: nodeIdSchema,
    assetId: assetIdSchema,
    from: frameSchema,
    duration: durationSchema,
    volume: z.number().min(0).max(1).default(1),
    loop: z.boolean().default(false),
    sourceOffsetSeconds: z.number().nonnegative().default(0),
    bus: z.string().trim().min(1).max(64).nullable().default(null),
    pan: z.number().min(-1).max(1).default(0),
    envelope: volumeEnvelopeSchema.nullable().default(null),
    ducking: duckingSchema.nullable().default(null),
    ...insertionPlacementShape,
  })
  .strict();

const insertLottieCommandSchema = z
  .object({
    kind: z.literal("node.insert_lottie"),
    assetId: assetIdSchema,
    playbackRate: z.number().min(0.0625).max(16).default(1),
    ...visualInsertionShape,
  })
  .strict();

const insertEffectCommandSchema = z
  .object({
    kind: z.literal("node.insert_effect"),
    effect: z.enum(effectNames),
    params: effectParamsSchema.default({}),
    ...visualInsertionShape,
  })
  .strict();

const removeNodeCommandSchema = z
  .object({
    kind: z.literal("node.remove"),
    id: nodeIdSchema,
  })
  .strict();

const moveNodeCommandSchema = z
  .object({
    kind: z.literal("node.move"),
    id: nodeIdSchema,
    parentId: nodeIdSchema.nullable(),
    beforeId: nodeIdSchema.nullable(),
  })
  .strict();

const registerAssetCommandSchema = z
  .object({
    kind: z.literal("asset.register"),
    id: assetIdSchema,
    assetType: z.enum(["image", "video", "audio", "font", "lottie"]),
    src: z.string().min(1),
    sourceMode: z.enum(["auto", "stream", "buffer"]).default("auto"),
  })
  .strict();

const removeAssetCommandSchema = z
  .object({
    kind: z.literal("asset.remove"),
    id: assetIdSchema,
  })
  .strict();

const setSceneDurationCommandSchema = z
  .object({
    kind: z.literal("scene.set_duration"),
    duration: durationSchema,
  })
  .strict();

const setSceneFormatCommandSchema = z
  .object({
    kind: z.literal("scene.set_format"),
    width: z.number().int().positive(),
    height: z.number().int().positive(),
    fps: z.number().int().positive(),
  })
  .strict();

const setMarkerCommandSchema = z
  .object({
    kind: z.literal("scene.set_marker"),
    name: z.string().trim().min(1).max(191),
    frame: frameSchema.nullable(),
  })
  .strict();

const setSceneAudioBusCommandSchema = z
  .object({
    kind: z.literal("scene.set_audio_bus"),
    name: z.string().trim().min(1).max(64),
    bus: audioBusSchema.nullable(),
  })
  .strict();

export const sceneCommandSchema = z.discriminatedUnion("kind", [
  setTextCommandSchema,
  setStyleCommandSchema,
  setTimingCommandSchema,
  setStartCommandSchema,
  setDurationCommandSchema,
  setAnimationsCommandSchema,
  setVolumeCommandSchema,
  setLoopCommandSchema,
  setPlaybackRateCommandSchema,
  setSourceOffsetCommandSchema,
  setVolumeEnvelopeCommandSchema,
  setPanCommandSchema,
  setAudioBusCommandSchema,
  setDuckingCommandSchema,
  insertTextCommandSchema,
  insertDivCommandSchema,
  insertImageCommandSchema,
  insertVideoCommandSchema,
  insertAudioCommandSchema,
  insertLottieCommandSchema,
  insertEffectCommandSchema,
  removeNodeCommandSchema,
  moveNodeCommandSchema,
  registerAssetCommandSchema,
  removeAssetCommandSchema,
  setSceneDurationCommandSchema,
  setSceneFormatCommandSchema,
  setMarkerCommandSchema,
  setSceneAudioBusCommandSchema,
]);

export const sceneCommandBatchSchema = z
  .object({
    version: z.literal(SCENE_COMMAND_PROTOCOL_VERSION),
    baseRevision: z.number().int().nonnegative(),
    commands: z
      .array(sceneCommandSchema)
      .min(1)
      .max(MAX_SCENE_COMMANDS_PER_BATCH),
  })
  .strict();

export type SceneStyleCommandValue = z.infer<
  typeof sceneStyleCommandValueSchema
>;
export type SceneStyleChange = z.infer<typeof sceneStyleChangeSchema>;
export type SceneCommand = z.infer<typeof sceneCommandSchema>;
export type SceneCommandBatch = z.infer<typeof sceneCommandBatchSchema>;

export type SceneCommandCompileError = {
  commandIndex: number;
  path: string;
  message: string;
};

export type CompileSceneCommandBatchResult =
  | {
      ok: true;
      batch: SceneCommandBatch;
      patch: ScenePatch;
    }
  | {
      ok: false;
      errors: SceneCommandCompileError[];
    };

export type ApplySceneCommandBatchResult =
  | {
      ok: true;
      batch: SceneCommandBatch;
      patch: ScenePatch;
      scene: Scene;
    }
  | {
      ok: false;
      errors: SceneCommandCompileError[];
    };

function issuePath(path: PropertyKey[]) {
  return path
    .map((segment) =>
      typeof segment === "number" ? `[${segment}]` : String(segment),
    )
    .join(".")
    .replace(".[", "[");
}

function parseStyleChanges(
  changes: SceneStyleChange[],
  options: { allowDelete: boolean },
): { ok: true; style: Record<string, unknown> } | { ok: false; message: string } {
  const style: Record<string, unknown> = {};
  for (const change of changes) {
    if (change.value === null && !options.allowDelete) {
      return {
        ok: false,
        message: `Style property ${JSON.stringify(change.property)} cannot be null on a newly inserted node.`,
      };
    }
    style[change.property] = change.value;
  }

  const toValidate = Object.fromEntries(
    Object.entries(style).filter(([, value]) => value !== null),
  );
  const parsed = styleSchema.safeParse(toValidate);
  if (!parsed.success) {
    return {
      ok: false,
      message: parsed.error.issues
        .map((issue) => `${issuePath(issue.path)}: ${issue.message}`)
        .join("; "),
    };
  }

  return { ok: true, style };
}

function placement(command: {
  parentId?: string | null;
  beforeId?: string | null;
}) {
  return {
    ...(command.parentId ? { parentId: command.parentId } : {}),
    ...(command.beforeId ? { beforeId: command.beforeId } : {}),
  };
}

function visualNodeBase(command: {
  id: string;
  from: number;
  duration: number;
  animations: SceneAnimation[];
}) {
  return {
    id: command.id,
    from: command.from,
    duration: command.duration,
    animations: command.animations,
  };
}

function compileCommand(
  command: SceneCommand,
): { ok: true; patch: ScenePatch } | { ok: false; message: string } {
  switch (command.kind) {
    case "node.set_text":
      return {
        ok: true,
        patch: [{ op: "setText", id: command.id, text: command.text }],
      };
    case "node.set_style": {
      const parsed = parseStyleChanges(command.changes, { allowDelete: true });
      return parsed.ok
        ? {
            ok: true,
            patch: [{ op: "setStyle", id: command.id, style: parsed.style }],
          }
        : parsed;
    }
    case "node.set_timing":
      return {
        ok: true,
        patch: [
          {
            op: "retime",
            id: command.id,
            from: command.from,
            duration: command.duration,
          },
        ],
      };
    case "node.set_start":
      return {
        ok: true,
        patch: [{ op: "retime", id: command.id, from: command.from }],
      };
    case "node.set_duration":
      return {
        ok: true,
        patch: [{ op: "retime", id: command.id, duration: command.duration }],
      };
    case "node.set_animations":
      return {
        ok: true,
        patch: [
          {
            op: "setAnimations",
            id: command.id,
            animations: command.animations,
          },
        ],
      };
    case "media.set_volume":
      return {
        ok: true,
        patch: [
          { op: "setNodeProps", id: command.id, props: { volume: command.volume } },
        ],
      };
    case "audio.set_loop":
      return {
        ok: true,
        patch: [
          { op: "setNodeProps", id: command.id, props: { loop: command.loop } },
        ],
      };
    case "media.set_playback_rate":
      return {
        ok: true,
        patch: [
          {
            op: "setNodeProps",
            id: command.id,
            props: { playbackRate: command.playbackRate },
          },
        ],
      };
    case "media.set_source_offset":
      return {
        ok: true,
        patch: [
          {
            op: "setNodeProps",
            id: command.id,
            props:
              command.mediaType === "video"
                ? { videoStartTime: command.seconds }
                : { audioStartTime: command.seconds },
          },
        ],
      };
    case "audio.set_volume_envelope":
      return {
        ok: true,
        patch: [
          {
            op: "setNodeProps",
            id: command.id,
            props: { volumeEnvelope: command.envelope },
          },
        ],
      };
    case "audio.set_pan":
      return {
        ok: true,
        patch: [
          { op: "setNodeProps", id: command.id, props: { pan: command.pan } },
        ],
      };
    case "audio.set_bus":
      return {
        ok: true,
        patch: [
          { op: "setNodeProps", id: command.id, props: { audioBus: command.bus } },
        ],
      };
    case "audio.set_ducking":
      return {
        ok: true,
        patch: [
          {
            op: "setNodeProps",
            id: command.id,
            props: { ducks: command.ducking },
          },
        ],
      };
    case "node.insert_text":
    case "node.insert_div":
    case "node.insert_image":
    case "node.insert_video":
    case "node.insert_lottie":
    case "node.insert_effect": {
      const parsedStyle = parseStyleChanges(command.style, {
        allowDelete: false,
      });
      if (!parsedStyle.ok) return parsedStyle;
      const base = {
        ...visualNodeBase(command),
        style: parsedStyle.style as SceneStyle,
      };
      const node =
        command.kind === "node.insert_text"
          ? { ...base, type: "text" as const, text: command.text }
          : command.kind === "node.insert_div"
            ? { ...base, type: "div" as const }
            : command.kind === "node.insert_image"
              ? {
                  ...base,
                  type: "img" as const,
                  assetId: command.assetId,
                }
              : command.kind === "node.insert_video"
                ? {
                    ...base,
                    type: "video" as const,
                    assetId: command.assetId,
                    volume: command.volume,
                    playbackRate: command.playbackRate,
                    videoStartTime: command.sourceOffsetSeconds,
                    videoEndBehavior: command.endBehavior,
                  }
                : command.kind === "node.insert_lottie"
                  ? {
                      ...base,
                      type: "lottie" as const,
                      assetId: command.assetId,
                      playbackRate: command.playbackRate,
                    }
                  : {
                      ...base,
                      type: "effect" as const,
                      effect: command.effect,
                      params: command.params,
                    };
      return {
        ok: true,
        patch: [{ op: "insertNode", node, ...placement(command) }],
      };
    }
    case "node.insert_audio":
      return {
        ok: true,
        patch: [
          {
            op: "insertNode",
            node: {
              id: command.id,
              type: "audio",
              assetId: command.assetId,
              from: command.from,
              duration: command.duration,
              volume: command.volume,
              loop: command.loop,
              audioStartTime: command.sourceOffsetSeconds,
              ...(command.bus ? { audioBus: command.bus } : {}),
              ...(command.pan !== 0 ? { pan: command.pan } : {}),
              ...(command.envelope
                ? { volumeEnvelope: command.envelope }
                : {}),
              ...(command.ducking ? { ducks: command.ducking } : {}),
            },
            ...placement(command),
          },
        ],
      };
    case "node.remove":
      return {
        ok: true,
        patch: [{ op: "removeNode", id: command.id }],
      };
    case "node.move":
      return {
        ok: true,
        patch: [
          {
            op: "moveNode",
            id: command.id,
            ...(command.parentId ? { parentId: command.parentId } : {}),
            ...(command.beforeId ? { beforeId: command.beforeId } : {}),
          },
        ],
      };
    case "asset.register":
      return {
        ok: true,
        patch: [
          {
            op: "setAsset",
            asset: {
              id: command.id,
              type: command.assetType,
              src: command.src,
              sourceMode: command.sourceMode,
            },
          },
        ],
      };
    case "asset.remove":
      return {
        ok: true,
        patch: [{ op: "removeAsset", id: command.id }],
      };
    case "scene.set_duration":
      return {
        ok: true,
        patch: [{ op: "setSceneMeta", duration: command.duration }],
      };
    case "scene.set_format":
      return {
        ok: true,
        patch: [
          {
            op: "setSceneMeta",
            width: command.width,
            height: command.height,
            fps: command.fps,
          },
        ],
      };
    case "scene.set_marker":
      return {
        ok: true,
        patch: [
          { op: "setMarker", name: command.name, frame: command.frame },
        ],
      };
    case "scene.set_audio_bus":
      return {
        ok: true,
        patch: [
          { op: "setAudioBus", name: command.name, bus: command.bus },
        ],
      };
  }
}

function parseErrors(error: z.ZodError): SceneCommandCompileError[] {
  return error.issues.map((issue) => {
    const commandIndex =
      issue.path[0] === "commands" && typeof issue.path[1] === "number"
        ? issue.path[1]
        : -1;
    return {
      commandIndex,
      path: issuePath(issue.path),
      message: issue.message,
    };
  });
}

export function compileSceneCommandBatch(
  sceneInput: unknown,
  batchInput: unknown,
): CompileSceneCommandBatchResult {
  try {
    parseScene(sceneInput);
  } catch (error) {
    return {
      ok: false,
      errors: [
        {
          commandIndex: -1,
          path: "scene",
          message:
            error instanceof Error ? error.message : String(error),
        },
      ],
    };
  }

  const parsedBatch = sceneCommandBatchSchema.safeParse(batchInput);
  if (!parsedBatch.success) {
    return { ok: false, errors: parseErrors(parsedBatch.error) };
  }

  const patch: ScenePatch = [];
  const errors: SceneCommandCompileError[] = [];
  parsedBatch.data.commands.forEach((command, commandIndex) => {
    const compiled = compileCommand(command);
    if (compiled.ok) {
      patch.push(...compiled.patch);
    } else {
      errors.push({
        commandIndex,
        path: `commands[${commandIndex}]`,
        message: compiled.message,
      });
    }
  });
  if (errors.length > 0) return { ok: false, errors };

  const parsedPatch = scenePatchSchema.safeParse(patch);
  if (!parsedPatch.success) {
    return {
      ok: false,
      errors: parsedPatch.error.issues.map((issue) => ({
        commandIndex:
          typeof issue.path[0] === "number" ? issue.path[0] : -1,
        path: `patch.${issuePath(issue.path)}`,
        message: issue.message,
      })),
    };
  }

  return {
    ok: true,
    batch: parsedBatch.data,
    patch: parsedPatch.data,
  };
}

export function applySceneCommandBatch(
  sceneInput: unknown,
  batchInput: unknown,
): ApplySceneCommandBatchResult {
  const compiled = compileSceneCommandBatch(sceneInput, batchInput);
  if (!compiled.ok) return compiled;

  const applied = applyScenePatch(sceneInput, compiled.patch);
  if (!applied.ok) {
    return {
      ok: false,
      errors: applied.errors.map((error) => ({
        commandIndex: error.opIndex,
        path: `patch[${error.opIndex}]`,
        message: error.message,
      })),
    };
  }

  return {
    ok: true,
    batch: compiled.batch,
    patch: compiled.patch,
    scene: applied.scene,
  };
}

export function sceneCommandBatchJsonSchema(): Record<string, unknown> {
  return zodToJsonSchema(sceneCommandBatchSchema, {
    name: "MotionforgeSceneCommandBatch",
    target: "jsonSchema7",
    $refStrategy: "none",
  }) as Record<string, unknown>;
}

export type {
  Scene,
  SceneAnimation,
  SceneDucking,
  SceneEffectName,
  SceneEffectParams,
  SceneStyle,
  VolumeEnvelope,
};
