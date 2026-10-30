import { z } from "zod/v3";
import { zodToJsonSchema } from "zod-to-json-schema";
import {
  animationTargets,
  applyScenePatch,
  assetSchema,
  closedShapeGeometrySchema,
  duckingSchema,
  effectParamsSchema,
  maskDescriptorSchema,
  parseScene,
  scenePatchSchema,
  shapeGeometrySchema,
  supportedStyleKeys,
  volumeEnvelopePointSchema,
  type Scene,
  type SceneNode,
  type ScenePatch,
  type SceneStyle,
} from "@dojo-video-engine/schema";
import {
  clipLayout,
  clipLayouts,
  compileMotionPreset,
  mediaLook,
  mediaLooks,
  mergeAnimationsByProperty,
  motionPresetNames,
  motionPresetParamsSchema,
  type ClipLayoutKey,
  type MediaLookKey,
  type MotionPresetName,
} from "@dojo-video-engine/presets";
import {
  expandMacroNodeInput,
  type MacroContext,
} from "@dojo-video-engine/presets/macros";

/**
 * A non-recursive, intent-level editing vocabulary. Commands deliberately do
 * not expose ScenePatch's recursive insertNode payload: node.add accepts one
 * flat node and macro.insert accepts a named macro plus parameters. Commands
 * compile to the canonical patch contract before they can mutate a Scene.
 */

const idSchema = z.string().trim().min(1).max(191);
const commandAssetIdSchema = z
  .string()
  .min(1)
  .max(191)
  .regex(
    /^\S(?:[\s\S]*\S)?$/,
    "Asset ids cannot have leading or trailing whitespace.",
  );
const finiteNumber = z.number().finite();
const MAX_COMMANDS = 256;
const MAX_SELECTION_IDS = 128;
const MAX_TEXT_LENGTH = 100_000;
const MAX_COORDINATE = 10_000_000;
const MAX_TIMELINE_FRAME = 100_000_000;
const MAX_MEDIA_SECONDS = 10_000_000;
const MAX_OPAQUE_STRING = 16_384;
const MAX_OPAQUE_NUMBER = 1_000_000_000;
const MAX_OPAQUE_ARRAY = 64;
const MAX_OPAQUE_PROPERTIES = 64;
const MAX_ANIMATION_TRACKS = 128;
const MAX_KEYFRAMES_PER_TRACK = 2048;
const MAX_ANIMATION_REPEAT = 1000;
const OPAQUE_OBJECT_MARKER = "dojo-video-engine:bounded-opaque-object";
const OPAQUE_FORBIDDEN_KEYS = ["children", "nodes", "scene"] as const;

const boundedTextSchema = z.string().max(MAX_TEXT_LENGTH);
const pixelCoordinate = finiteNumber.min(-MAX_COORDINATE).max(MAX_COORDINATE);
// Scene lengths permit zero (useful for an intentional collapse); commands
// still reject negative dimensions even though the low-level style grammar is
// deliberately more general.
const pixelSize = finiteNumber.nonnegative();
const optionalParentId = idSchema.optional();

const opaqueScalarSchema = z.union([
  z.string().max(MAX_OPAQUE_STRING),
  z.number().finite().min(-MAX_OPAQUE_NUMBER).max(MAX_OPAQUE_NUMBER),
  z.boolean(),
  z.null(),
]);

function boundedOpaqueObject<T extends z.ZodTypeAny>(valueSchema: T) {
  return z
    .record(valueSchema)
    .superRefine((value, ctx) => {
      const keys = Object.keys(value);
      if (keys.length > MAX_OPAQUE_PROPERTIES) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `Opaque objects support at most ${MAX_OPAQUE_PROPERTIES} properties.`,
        });
      }
      for (const key of OPAQUE_FORBIDDEN_KEYS) {
        if (Object.hasOwn(value, key)) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: [key],
            message: `Opaque command data cannot contain ${key}; commands never carry recursive Scene/node trees.`,
          });
        }
      }
    })
    .describe(OPAQUE_OBJECT_MARKER);
}

// Finite-depth on purpose. This is JSON data, but never an unbounded recursive
// schema that invites a model to reproduce an entire Scene tree.
const opaqueObjectLevel1 = boundedOpaqueObject(opaqueScalarSchema);
const opaqueValueLevel1 = z.union([
  opaqueScalarSchema,
  z.array(opaqueScalarSchema).max(MAX_OPAQUE_ARRAY),
  opaqueObjectLevel1,
]);
const opaqueObjectLevel2 = boundedOpaqueObject(opaqueValueLevel1);
const opaqueValueLevel2 = z.union([
  opaqueScalarSchema,
  z.array(opaqueValueLevel1).max(MAX_OPAQUE_ARRAY),
  opaqueObjectLevel2,
]);
const opaqueObjectLevel3 = boundedOpaqueObject(opaqueValueLevel2);
const opaqueValueLevel3 = z.union([
  opaqueScalarSchema,
  z.array(opaqueValueLevel2).max(MAX_OPAQUE_ARRAY),
  opaqueObjectLevel3,
]);
const opaqueObjectLevel4 = boundedOpaqueObject(opaqueValueLevel3);

const commandStylePayloadSchema = opaqueObjectLevel3;
const commandTextRunSchema = z
  .object({
    text: z.string().min(1).max(MAX_TEXT_LENGTH),
    style: commandStylePayloadSchema.optional(),
  })
  .strict();

// Structural command shape only. Target-specific values, easing grammar, and
// strictly increasing frame order remain canonical Scene validation's job so
// the Zod and published JSON Schema boundaries accept exactly the same data.
const commandKeyframeSchema = z
  .object({
    frame: z.number().int().nonnegative().max(MAX_TIMELINE_FRAME),
    value: z.union([z.number().finite(), z.string().max(MAX_OPAQUE_STRING)]),
    easing: z.string().max(MAX_OPAQUE_STRING).optional(),
  })
  .strict();

const commandAnimationSchema = z
  .object({
    kind: z.literal("keyframes"),
    property: z.enum(animationTargets),
    frames: z.array(commandKeyframeSchema).min(1).max(MAX_KEYFRAMES_PER_TRACK),
    repeat: z
      .union([
        z.number().int().min(0).max(MAX_ANIMATION_REPEAT),
        z.literal("infinite"),
      ])
      .optional(),
    yoyo: z.boolean().optional(),
  })
  .strict();

const extensionDescriptorCommandSchema = z
  .object({
    name: z.string().trim().min(1).max(191),
    version: z.string().trim().min(1).max(128),
    // Kept opaque here so the command JSON Schema stays non-recursive. The
    // canonical Scene validator performs the full JSON-value validation.
    params: opaqueObjectLevel4,
  })
  .strict();

/** Flat by construction: there is intentionally no `children` property. */
export const flatSceneNodeCommandSchema = z
  .object({
    id: idSchema,
    type: z.enum([
      "div",
      "text",
      "img",
      "video",
      "audio",
      "lottie",
      "effect",
      "extension",
      "shape",
    ]),
    text: boundedTextSchema.optional(),
    runs: z.array(commandTextRunSchema).min(1).max(256).optional(),
    assetId: idSchema.optional(),
    effect: z.string().trim().min(1).optional(),
    params: effectParamsSchema.optional(),
    extension: extensionDescriptorCommandSchema.optional(),
    shape: shapeGeometrySchema.optional(),
    clip: closedShapeGeometrySchema.optional(),
    mask: maskDescriptorSchema.optional(),
    videoStartTime: finiteNumber.nonnegative().optional(),
    playbackRate: finiteNumber.min(-16).max(16).optional(),
    audioStartTime: finiteNumber.nonnegative().optional(),
    volume: finiteNumber.min(0).max(1).optional(),
    volumeEnvelope: z
      .array(volumeEnvelopePointSchema)
      .min(1)
      .max(1024)
      .optional(),
    audioBus: idSchema.max(64).optional(),
    pan: finiteNumber.min(-1).max(1).optional(),
    ducks: duckingSchema.optional(),
    videoEndBehavior: z.enum(["hold", "loop"]).optional(),
    loop: z.boolean().optional(),
    from: z
      .number()
      .int()
      .min(-MAX_TIMELINE_FRAME)
      .max(MAX_TIMELINE_FRAME)
      .optional(),
    duration: z.number().int().positive().max(MAX_TIMELINE_FRAME).optional(),
    style: commandStylePayloadSchema.optional(),
    animations: z
      .array(commandAnimationSchema)
      .max(MAX_ANIMATION_TRACKS)
      .optional(),
  })
  .strict();

const textSetCommandSchema = z
  .object({
    kind: z.literal("text.set"),
    id: idSchema,
    text: boundedTextSchema,
  })
  .strict();

const styleSetCommandSchema = z
  .object({
    kind: z.literal("style.set"),
    id: idSchema,
    style: commandStylePayloadSchema.optional(),
    unset: z
      .array(z.enum(supportedStyleKeys))
      .min(1)
      .max(supportedStyleKeys.length)
      .optional(),
  })
  .strict();

const placementSetCommandSchema = z
  .object({
    kind: z.literal("placement.set"),
    id: idSchema,
    position: z.enum(["relative", "absolute"]).optional(),
    left: pixelCoordinate.optional(),
    right: pixelCoordinate.optional(),
    top: pixelCoordinate.optional(),
    bottom: pixelCoordinate.optional(),
    zIndex: z
      .number()
      .int()
      .min(-MAX_COORDINATE)
      .max(MAX_COORDINATE)
      .optional(),
  })
  .strict();

const resizeSetCommandSchema = z
  .object({
    kind: z.literal("resize.set"),
    id: idSchema,
    width: pixelSize.max(MAX_COORDINATE).optional(),
    height: pixelSize.max(MAX_COORDINATE).optional(),
    aspectRatio: finiteNumber.positive().optional(),
  })
  .strict();

const alignCommandSchema = z
  .object({
    kind: z.literal("align"),
    ids: z.array(idSchema).min(1).max(MAX_SELECTION_IDS),
    edge: z.enum(["left", "centerX", "right", "top", "centerY", "bottom"]),
    relativeTo: z.enum(["selection", "frame"]).default("selection"),
  })
  .strict();

const distributeCommandSchema = z
  .object({
    kind: z.literal("distribute"),
    ids: z.array(idSchema).min(3).max(MAX_SELECTION_IDS),
    axis: z.enum(["horizontal", "vertical"]),
    spacing: z.enum(["gaps", "centers"]).default("gaps"),
  })
  .strict();

const timingSetCommandSchema = z
  .object({
    kind: z.literal("timing.set"),
    id: idSchema,
    from: z
      .number()
      .int()
      .min(-MAX_TIMELINE_FRAME)
      .max(MAX_TIMELINE_FRAME)
      .optional(),
    duration: z.number().int().positive().max(MAX_TIMELINE_FRAME).optional(),
  })
  .strict();

const mediaTrimCommandSchema = z
  .object({
    kind: z.literal("media.trim"),
    id: idSchema,
    startSeconds: finiteNumber.nonnegative().max(MAX_MEDIA_SECONDS),
    endSeconds: finiteNumber.positive().max(MAX_MEDIA_SECONDS).optional(),
  })
  .strict();

const mediaGainCommandSchema = z
  .object({
    kind: z.literal("media.gain"),
    id: idSchema,
    gain: finiteNumber.min(0).max(1),
    pan: finiteNumber.min(-1).max(1).optional(),
    bus: idSchema.max(64).optional(),
  })
  .strict();

const nodeAddCommandSchema = z
  .object({
    kind: z.literal("node.add"),
    node: flatSceneNodeCommandSchema,
    parentId: optionalParentId,
    beforeId: idSchema.optional(),
  })
  .strict();

const nodeRemoveCommandSchema = z
  .object({
    kind: z.literal("node.remove"),
    id: idSchema,
  })
  .strict();

const nodeMoveCommandSchema = z
  .object({
    kind: z.literal("node.move"),
    id: idSchema,
    parentId: optionalParentId,
    beforeId: idSchema.optional(),
  })
  .strict();

const nodeGroupCommandSchema = z
  .object({
    kind: z.literal("node.group"),
    ids: z.array(idSchema).min(2).max(MAX_SELECTION_IDS),
    groupId: idSchema,
    parentId: optionalParentId,
    beforeId: idSchema.optional(),
    style: commandStylePayloadSchema.optional(),
  })
  .strict();

const presetNameSchema = z.enum(
  motionPresetNames() as [MotionPresetName, ...MotionPresetName[]],
);

const motionPresetCommandSchema = z
  .object({
    kind: z.literal("motion.preset"),
    id: idSchema,
    preset: presetNameSchema,
    params: motionPresetParamsSchema.optional(),
    mode: z.enum(["replace", "append"]).default("replace"),
  })
  .strict();

const macroInsertCommandSchema = z
  .object({
    kind: z.literal("macro.insert"),
    name: idSchema,
    params: opaqueObjectLevel4.default({}),
    parentId: optionalParentId,
    beforeId: idSchema.optional(),
  })
  .strict();

const layoutKeys = Object.keys(clipLayouts) as [string, ...string[]];
const lookKeys = Object.keys(mediaLooks) as [string, ...string[]];
const layoutOwnedStyleKeys = Array.from(
  new Set(
    Object.values(clipLayouts).flatMap((preset) => Object.keys(preset.style)),
  ),
).sort();

const layoutApplyCommandSchema = z
  .object({
    kind: z.literal("layout.apply"),
    id: idSchema,
    layout: z.enum(layoutKeys).optional(),
    look: z.enum(lookKeys).optional(),
  })
  .strict();

const sceneSetCommandSchema = z
  .object({
    kind: z.literal("scene.set"),
    width: z.number().int().positive().max(MAX_COORDINATE).optional(),
    height: z.number().int().positive().max(MAX_COORDINATE).optional(),
    fps: z.number().int().positive().max(MAX_COORDINATE).optional(),
    duration: z.number().int().positive().max(MAX_TIMELINE_FRAME).optional(),
  })
  .strict();

const assetSetCommandSchema = z
  .object({
    kind: z.literal("asset.set"),
    asset: assetSchema.extend({ id: commandAssetIdSchema }),
  })
  .strict();

const assetRemoveCommandSchema = z
  .object({
    kind: z.literal("asset.remove"),
    id: commandAssetIdSchema,
  })
  .strict();

const commandOptions = [
  textSetCommandSchema,
  styleSetCommandSchema,
  placementSetCommandSchema,
  resizeSetCommandSchema,
  alignCommandSchema,
  distributeCommandSchema,
  timingSetCommandSchema,
  mediaTrimCommandSchema,
  mediaGainCommandSchema,
  nodeAddCommandSchema,
  nodeRemoveCommandSchema,
  nodeMoveCommandSchema,
  nodeGroupCommandSchema,
  motionPresetCommandSchema,
  macroInsertCommandSchema,
  layoutApplyCommandSchema,
  sceneSetCommandSchema,
  assetSetCommandSchema,
  assetRemoveCommandSchema,
] as const;

export const sceneCommandSchema = z
  .discriminatedUnion("kind", commandOptions)
  .superRefine((command, ctx) => {
    switch (command.kind) {
      case "style.set":
        if (
          (!command.style || Object.keys(command.style).length === 0) &&
          !command.unset
        ) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: "style.set needs style, unset, or both.",
          });
        }
        break;
      case "placement.set":
        if (
          command.position === undefined &&
          command.left === undefined &&
          command.right === undefined &&
          command.top === undefined &&
          command.bottom === undefined &&
          command.zIndex === undefined
        ) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: "placement.set needs at least one placement field.",
          });
        }
        if (command.left !== undefined && command.right !== undefined) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: ["right"],
            message:
              "Set left or right, not both; the compiler will clear the opposite edge.",
          });
        }
        if (command.top !== undefined && command.bottom !== undefined) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: ["bottom"],
            message:
              "Set top or bottom, not both; the compiler will clear the opposite edge.",
          });
        }
        break;
      case "resize.set":
        if (
          command.width === undefined &&
          command.height === undefined &&
          command.aspectRatio === undefined
        ) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: "resize.set needs width, height, or aspectRatio.",
          });
        }
        break;
      case "timing.set":
        if (command.from === undefined && command.duration === undefined) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: "timing.set needs from, duration, or both.",
          });
        }
        break;
      case "macro.insert":
        if (Object.hasOwn(command.params, "macro")) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: ["params", "macro"],
            message:
              "macro.insert params cannot contain macro; use the command's name field.",
          });
        }
        break;
      case "layout.apply":
        if (command.layout === undefined && command.look === undefined) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: "layout.apply needs layout, look, or both.",
          });
        }
        break;
      case "scene.set":
        if (
          command.width === undefined &&
          command.height === undefined &&
          command.fps === undefined &&
          command.duration === undefined
        ) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message:
              "scene.set needs width, height, fps, duration, or a combination.",
          });
        }
        break;
      default:
        break;
    }
  });

export const sceneCommandsSchema = z
  .array(sceneCommandSchema)
  .min(1)
  .max(MAX_COMMANDS);

export type SceneCommand = z.infer<typeof sceneCommandSchema>;
export type SceneCommands = SceneCommand[];

/** Draft-07 schema suitable for constrained model output and editor forms. */
export function sceneCommandJsonSchema(): Record<string, unknown> {
  const schema = zodToJsonSchema(sceneCommandsSchema, {
    name: "DojoVideoEngineSceneCommands",
    target: "jsonSchema7",
    $refStrategy: "none",
  }) as Record<string, unknown>;

  decorateCommandJsonSchema(schema);

  return {
    ...schema,
    title: "DojoVideoEngine scene commands",
    description:
      "Strict, discriminated, non-recursive commands that compile to canonical ScenePatch operations.",
  };
}

function decorateCommandJsonSchema(value: unknown): void {
  if (Array.isArray(value)) {
    value.forEach(decorateCommandJsonSchema);
    return;
  }
  if (!value || typeof value !== "object") return;
  const schema = value as Record<string, unknown>;

  // zod-to-json-schema emits the valid draft-07 shorthand
  // `type: ["number", "string"]` for keyframe values. Normalize that lone
  // shorthand to anyOf so strict AJV consumers need no allowUnionTypes escape.
  if (Array.isArray(schema.type) && Object.keys(schema).length === 1) {
    const types = schema.type.filter(
      (entry): entry is string => typeof entry === "string",
    );
    delete schema.type;
    schema.anyOf = types.map((type) => ({ type }));
  }

  if (schema.description === OPAQUE_OBJECT_MARKER) {
    schema.maxProperties = MAX_OPAQUE_PROPERTIES;
    const existingForbidden =
      typeof schema.propertyNames === "object" &&
      schema.propertyNames !== null &&
      typeof (schema.propertyNames as Record<string, unknown>).not ===
        "object" &&
      (schema.propertyNames as Record<string, unknown>).not !== null &&
      Array.isArray(
        (
          (schema.propertyNames as Record<string, unknown>).not as Record<
            string,
            unknown
          >
        ).enum,
      )
        ? (
            (
              (schema.propertyNames as Record<string, unknown>).not as Record<
                string,
                unknown
              >
            ).enum as unknown[]
          ).filter((entry): entry is string => typeof entry === "string")
        : [];
    schema.propertyNames = {
      not: {
        enum: [...new Set([...OPAQUE_FORBIDDEN_KEYS, ...existingForbidden])],
      },
    };
  }

  const properties =
    schema.properties && typeof schema.properties === "object"
      ? (schema.properties as Record<string, Record<string, unknown>>)
      : undefined;
  const kind = properties?.kind?.const;
  if (typeof kind === "string") {
    const requireAny = (keys: string[]): Record<string, unknown> => ({
      type: "object",
      anyOf: keys.map((key) => ({
        type: "object",
        properties: { [key]: {} },
        required: [key],
      })),
    });
    const constraints: Record<string, unknown>[] = [];
    switch (kind) {
      case "style.set":
        constraints.push({
          type: "object",
          anyOf: [
            {
              type: "object",
              properties: { unset: {} },
              required: ["unset"],
            },
            {
              type: "object",
              required: ["style"],
              properties: { style: { type: "object", minProperties: 1 } },
            },
          ],
        });
        break;
      case "placement.set":
        constraints.push(
          requireAny(["position", "left", "right", "top", "bottom", "zIndex"]),
          {
            type: "object",
            not: {
              type: "object",
              properties: { left: {}, right: {} },
              required: ["left", "right"],
            },
          },
          {
            type: "object",
            not: {
              type: "object",
              properties: { top: {}, bottom: {} },
              required: ["top", "bottom"],
            },
          },
        );
        break;
      case "resize.set":
        constraints.push(requireAny(["width", "height", "aspectRatio"]));
        break;
      case "timing.set":
        constraints.push(requireAny(["from", "duration"]));
        break;
      case "layout.apply":
        constraints.push(requireAny(["layout", "look"]));
        break;
      case "scene.set":
        constraints.push(requireAny(["width", "height", "fps", "duration"]));
        break;
      case "macro.insert": {
        const params = properties?.params;
        if (params) {
          params.propertyNames = {
            not: { enum: [...OPAQUE_FORBIDDEN_KEYS, "macro"] },
          };
        }
        break;
      }
      default:
        break;
    }
    if (constraints.length > 0) {
      schema.allOf = [
        ...(Array.isArray(schema.allOf) ? schema.allOf : []),
        ...constraints,
      ];
    }
  }

  Object.values(schema).forEach(decorateCommandJsonSchema);
}

export type CompileSceneCommandsContext = {
  /** ASR timing made available only to transcript-aware macros. */
  transcripts?: MacroContext["transcripts"];
  /** Compile motion presets through their reduced-motion variant. */
  reducedMotion?: boolean;
};

export type CommandDiagnostic = {
  commandIndex: number;
  kind: SceneCommand["kind"] | "<input>";
  severity: "info" | "warning";
  code: string;
  message: string;
  affectedIds: string[];
};

export type CommandError = {
  commandIndex: number;
  kind: string;
  code: string;
  message: string;
  path: string;
};

export type CompileSceneCommandsResult =
  | {
      ok: true;
      patch: ScenePatch;
      affectedIds: string[];
      diagnostics: CommandDiagnostic[];
    }
  | {
      ok: false;
      errors: CommandError[];
      affectedIds: string[];
      diagnostics: CommandDiagnostic[];
    };

export type ApplySceneCommandsResult =
  | {
      ok: true;
      scene: Scene;
      patch: ScenePatch;
      affectedIds: string[];
      diagnostics: CommandDiagnostic[];
    }
  | {
      ok: false;
      errors: CommandError[];
      affectedIds: string[];
      diagnostics: CommandDiagnostic[];
    };

type IndexedNode = {
  node: SceneNode;
  parentId?: string;
  siblingIndex: number;
};

function indexNodes(scene: Scene): Map<string, IndexedNode> {
  const result = new Map<string, IndexedNode>();
  const visit = (nodes: SceneNode[], parentId?: string): void => {
    nodes.forEach((node, siblingIndex) => {
      result.set(node.id, { node, parentId, siblingIndex });
      visit(node.children ?? [], node.id);
    });
  };
  visit(scene.nodes);
  return result;
}

function commandKindAt(input: unknown, index: number): string {
  if (!Array.isArray(input)) return "<input>";
  const item = input[index];
  if (typeof item !== "object" || item === null) return "<input>";
  const kind = (item as Record<string, unknown>).kind;
  return typeof kind === "string" ? kind : "<input>";
}

function validationErrors(input: unknown, error: z.ZodError): CommandError[] {
  return error.issues.map((issue) => {
    const first = issue.path[0];
    const commandIndex = typeof first === "number" ? first : -1;
    return {
      commandIndex,
      kind: commandIndex >= 0 ? commandKindAt(input, commandIndex) : "<input>",
      code: "invalid_command",
      message: issue.message,
      path:
        issue.path.length > 0 ? `commands.${issue.path.join(".")}` : "commands",
    };
  });
}

function commandError(
  commandIndex: number,
  kind: string,
  code: string,
  message: string,
  path = `commands.${commandIndex}`,
): CommandError {
  return { commandIndex, kind, code, message, path };
}

function semanticCommandError(
  command: SceneCommand,
  commandIndex: number,
): CommandError | undefined {
  if (
    command.kind === "media.trim" &&
    command.endSeconds !== undefined &&
    command.endSeconds <= command.startSeconds
  ) {
    return commandError(
      commandIndex,
      command.kind,
      "invalid_trim_window",
      "endSeconds must be greater than startSeconds.",
      `commands.${commandIndex}.endSeconds`,
    );
  }
  if (
    command.kind === "node.group" ||
    command.kind === "align" ||
    command.kind === "distribute"
  ) {
    if (new Set(command.ids).size !== command.ids.length) {
      return commandError(
        commandIndex,
        command.kind,
        "duplicate_ids",
        `${command.kind} ids must be unique.`,
        `commands.${commandIndex}.ids`,
      );
    }
  }
  return undefined;
}

function collectNodeIds(node: SceneNode, into: string[]): void {
  into.push(node.id);
  for (const child of node.children ?? []) collectNodeIds(child, into);
}

type Rect = { x: number; y: number; width: number; height: number };

function numericStyleValue(
  style: SceneStyle,
  key: keyof SceneStyle,
): number | undefined | null {
  const value = style[key];
  if (value === undefined) return undefined;
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function numericRect(
  scene: Scene,
  entry: IndexedNode,
): { rect: Rect } | { reason: string; code: string } {
  const style = entry.node.style ?? {};
  if (style.position !== "absolute") {
    return {
      code: "non_absolute_geometry",
      reason: `node "${entry.node.id}" is not absolutely positioned; align/distribute only edits explicit absolute coordinates`,
    };
  }
  if (style.transform !== undefined && style.transform !== "none") {
    return {
      code: "nonnumeric_geometry",
      reason: `node "${entry.node.id}" has a transform; align/distribute requires untransformed numeric geometry`,
    };
  }

  const width = numericStyleValue(style, "width");
  const height = numericStyleValue(style, "height");
  const left = numericStyleValue(style, "left");
  const right = numericStyleValue(style, "right");
  const top = numericStyleValue(style, "top");
  const bottom = numericStyleValue(style, "bottom");

  if (width === null || height === null) {
    return {
      code: "nonnumeric_geometry",
      reason: `node "${entry.node.id}" uses nonnumeric width/height; resolve %, px strings, or intrinsic size before align/distribute`,
    };
  }
  if (width === undefined || height === undefined) {
    return {
      code: "nonnumeric_geometry",
      reason: `node "${entry.node.id}" needs explicit numeric width and height for align/distribute`,
    };
  }
  if (left === null || right === null || top === null || bottom === null) {
    return {
      code: "nonnumeric_geometry",
      reason: `node "${entry.node.id}" uses nonnumeric edge geometry; align/distribute never guesses from strings or percentages`,
    };
  }

  const parentWidth = entry.parentId ? undefined : scene.width;
  const parentHeight = entry.parentId ? undefined : scene.height;
  const x =
    left !== undefined
      ? left
      : right !== undefined && parentWidth !== undefined
        ? parentWidth - right - width
        : undefined;
  const y =
    top !== undefined
      ? top
      : bottom !== undefined && parentHeight !== undefined
        ? parentHeight - bottom - height
        : undefined;

  if (x === undefined || y === undefined) {
    return {
      code: "nonnumeric_geometry",
      reason: `node "${entry.node.id}" needs numeric left/top geometry (right/bottom can only be resolved for root nodes)`,
    };
  }

  return { rect: { x, y, width, height } };
}

function geometryEntries(
  scene: Scene,
  ids: string[],
  commandIndex: number,
  kind: string,
): { entries: Array<IndexedNode & { rect: Rect }> } | { error: CommandError } {
  const index = indexNodes(scene);
  const entries: Array<IndexedNode & { rect: Rect }> = [];

  for (const id of ids) {
    const entry = index.get(id);
    if (!entry) {
      return {
        error: commandError(
          commandIndex,
          kind,
          "unknown_node",
          `No node with id "${id}". Inspect the current Scene and use an exact, case-sensitive id.`,
          `commands.${commandIndex}.ids`,
        ),
      };
    }
    const geometry = numericRect(scene, entry);
    if ("reason" in geometry) {
      return {
        error: commandError(
          commandIndex,
          kind,
          geometry.code,
          `${geometry.reason}. Use placement.set/resize.set with numeric pixels first.`,
          `commands.${commandIndex}.ids`,
        ),
      };
    }
    entries.push({ ...entry, rect: geometry.rect });
  }

  const parents = new Set(entries.map((entry) => entry.parentId ?? "<root>"));
  if (parents.size > 1) {
    return {
      error: commandError(
        commandIndex,
        kind,
        "incompatible_parents",
        "Selected nodes have different parents, so their local coordinates are not comparable. Move them under one parent first.",
        `commands.${commandIndex}.ids`,
      ),
    };
  }

  return { entries };
}

function compileAlign(
  scene: Scene,
  command: Extract<SceneCommand, { kind: "align" }>,
  commandIndex: number,
): { patch: ScenePatch } | { error: CommandError } {
  const resolved = geometryEntries(
    scene,
    command.ids,
    commandIndex,
    command.kind,
  );
  if ("error" in resolved) return resolved;
  const { entries } = resolved;

  if (
    command.relativeTo === "frame" &&
    entries.some((entry) => entry.parentId !== undefined)
  ) {
    return {
      error: commandError(
        commandIndex,
        command.kind,
        "nested_frame_alignment",
        "Frame-relative alignment requires root nodes; nested node coordinates are parent-local.",
        `commands.${commandIndex}.relativeTo`,
      ),
    };
  }

  const minX = Math.min(...entries.map((entry) => entry.rect.x));
  const maxX = Math.max(
    ...entries.map((entry) => entry.rect.x + entry.rect.width),
  );
  const minY = Math.min(...entries.map((entry) => entry.rect.y));
  const maxY = Math.max(
    ...entries.map((entry) => entry.rect.y + entry.rect.height),
  );
  const horizontal = ["left", "centerX", "right"].includes(command.edge);
  const target =
    command.relativeTo === "frame"
      ? command.edge === "left" || command.edge === "top"
        ? 0
        : command.edge === "right"
          ? scene.width
          : command.edge === "bottom"
            ? scene.height
            : command.edge === "centerX"
              ? scene.width / 2
              : scene.height / 2
      : command.edge === "left"
        ? minX
        : command.edge === "right"
          ? maxX
          : command.edge === "top"
            ? minY
            : command.edge === "bottom"
              ? maxY
              : command.edge === "centerX"
                ? (minX + maxX) / 2
                : (minY + maxY) / 2;

  return {
    patch: entries.map((entry) => {
      const position =
        command.edge === "left" || command.edge === "top"
          ? target
          : command.edge === "right"
            ? target - entry.rect.width
            : command.edge === "bottom"
              ? target - entry.rect.height
              : command.edge === "centerX"
                ? target - entry.rect.width / 2
                : target - entry.rect.height / 2;
      return {
        op: "setStyle" as const,
        id: entry.node.id,
        style: horizontal
          ? { left: position, right: null }
          : { top: position, bottom: null },
      };
    }),
  };
}

function compileDistribute(
  scene: Scene,
  command: Extract<SceneCommand, { kind: "distribute" }>,
  commandIndex: number,
): { patch: ScenePatch } | { error: CommandError } {
  const resolved = geometryEntries(
    scene,
    command.ids,
    commandIndex,
    command.kind,
  );
  if ("error" in resolved) return resolved;

  const horizontal = command.axis === "horizontal";
  const entries = [...resolved.entries].sort((a, b) => {
    const av =
      command.spacing === "centers"
        ? horizontal
          ? a.rect.x + a.rect.width / 2
          : a.rect.y + a.rect.height / 2
        : horizontal
          ? a.rect.x
          : a.rect.y;
    const bv =
      command.spacing === "centers"
        ? horizontal
          ? b.rect.x + b.rect.width / 2
          : b.rect.y + b.rect.height / 2
        : horizontal
          ? b.rect.x
          : b.rect.y;
    return av - bv || a.siblingIndex - b.siblingIndex;
  });
  const start = horizontal ? entries[0]?.rect.x : entries[0]?.rect.y;
  const last = entries[entries.length - 1];
  const end = last
    ? horizontal
      ? last.rect.x + last.rect.width
      : last.rect.y + last.rect.height
    : undefined;
  if (start === undefined || end === undefined) {
    return {
      error: commandError(
        commandIndex,
        command.kind,
        "empty_selection",
        "No nodes were available to distribute.",
      ),
    };
  }

  const positions = new Map<string, number>();
  if (command.spacing === "centers") {
    const first = entries[0];
    if (!first || !last) {
      return {
        error: commandError(
          commandIndex,
          command.kind,
          "empty_selection",
          "No nodes were available to distribute.",
        ),
      };
    }
    const firstCenter = horizontal
      ? first.rect.x + first.rect.width / 2
      : first.rect.y + first.rect.height / 2;
    const lastCenter = horizontal
      ? last.rect.x + last.rect.width / 2
      : last.rect.y + last.rect.height / 2;
    const step = (lastCenter - firstCenter) / (entries.length - 1);
    entries.forEach((entry, index) => {
      const size = horizontal ? entry.rect.width : entry.rect.height;
      positions.set(entry.node.id, firstCenter + step * index - size / 2);
    });
  } else {
    const totalSize = entries.reduce(
      (sum, entry) => sum + (horizontal ? entry.rect.width : entry.rect.height),
      0,
    );
    const gap = (end - start - totalSize) / (entries.length - 1);
    if (gap < 0) {
      return {
        error: commandError(
          commandIndex,
          command.kind,
          "insufficient_distribution_space",
          `The selected span is ${end - start}px but nodes need ${totalSize}px. Enlarge the span or use center spacing; gap distribution will not invent negative gaps.`,
          `commands.${commandIndex}.ids`,
        ),
      };
    }
    let cursor = start;
    for (const entry of entries) {
      positions.set(entry.node.id, cursor);
      cursor += (horizontal ? entry.rect.width : entry.rect.height) + gap;
    }
  }

  return {
    patch: entries.map((entry) => ({
      op: "setStyle" as const,
      id: entry.node.id,
      style: horizontal
        ? { left: positions.get(entry.node.id), right: null }
        : { top: positions.get(entry.node.id), bottom: null },
    })),
  };
}

function isDescendantOf(
  index: Map<string, IndexedNode>,
  possibleDescendant: string,
  possibleAncestor: string,
): boolean {
  let current = index.get(possibleDescendant);
  while (current?.parentId !== undefined) {
    if (current.parentId === possibleAncestor) return true;
    current = index.get(current.parentId);
  }
  return false;
}

function compileGroup(
  scene: Scene,
  command: Extract<SceneCommand, { kind: "node.group" }>,
  commandIndex: number,
): { patch: ScenePatch; affectedIds: string[] } | { error: CommandError } {
  const index = indexNodes(scene);
  if (index.has(command.groupId)) {
    return {
      error: commandError(
        commandIndex,
        command.kind,
        "duplicate_node_id",
        `Node id "${command.groupId}" already exists; choose a unique groupId.`,
        `commands.${commandIndex}.groupId`,
      ),
    };
  }
  const entries: IndexedNode[] = [];
  for (const id of command.ids) {
    const entry = index.get(id);
    if (!entry) {
      return {
        error: commandError(
          commandIndex,
          command.kind,
          "unknown_node",
          `No node with id "${id}".`,
          `commands.${commandIndex}.ids`,
        ),
      };
    }
    entries.push(entry);
  }
  for (const ancestor of command.ids) {
    for (const descendant of command.ids) {
      if (
        ancestor !== descendant &&
        isDescendantOf(index, descendant, ancestor)
      ) {
        return {
          error: commandError(
            commandIndex,
            command.kind,
            "nested_group_selection",
            `Cannot group ancestor "${ancestor}" together with its descendant "${descendant}". Select one level at a time.`,
            `commands.${commandIndex}.ids`,
          ),
        };
      }
    }
  }

  const parents = new Set(entries.map((entry) => entry.parentId ?? "<root>"));
  const inferredParent = parents.size === 1 ? entries[0]?.parentId : undefined;
  if (command.parentId === undefined && parents.size > 1) {
    return {
      error: commandError(
        commandIndex,
        command.kind,
        "incompatible_parents",
        "Selected nodes have different parents. Supply parentId explicitly if reparenting is intended.",
        `commands.${commandIndex}.ids`,
      ),
    };
  }
  const parentId = command.parentId ?? inferredParent;
  const sameSourceParent = parents.size === 1;
  const orderedIds = sameSourceParent
    ? [...entries]
        .sort((a, b) => a.siblingIndex - b.siblingIndex)
        .map((entry) => entry.node.id)
    : command.ids;
  let beforeId = command.beforeId;
  if (
    beforeId === undefined &&
    sameSourceParent &&
    parentId === inferredParent
  ) {
    const first = [...entries].sort(
      (a, b) => a.siblingIndex - b.siblingIndex,
    )[0];
    beforeId = first?.node.id;
  }

  const groupNode: SceneNode = {
    id: command.groupId,
    type: "div",
    style: {
      position: "absolute",
      inset: 0,
      ...((command.style ?? {}) as SceneStyle),
    },
  };
  return {
    patch: [
      { op: "insertNode", node: groupNode, parentId, beforeId },
      ...orderedIds.map((id) => ({
        op: "moveNode" as const,
        id,
        parentId: command.groupId,
      })),
    ],
    affectedIds: [
      command.groupId,
      ...orderedIds,
      ...entries.flatMap((entry) =>
        entry.parentId === undefined ? [] : [entry.parentId],
      ),
      ...(parentId === undefined ? [] : [parentId]),
    ],
  };
}

function appendMotionAnimations(
  existing: NonNullable<SceneNode["animations"]>,
  generated: NonNullable<SceneNode["animations"]>,
):
  | { animations: NonNullable<SceneNode["animations"]> }
  | { conflictingProperties: string[] } {
  const existingByProperty = new Map<string, typeof existing>();
  const generatedByProperty = new Map<string, typeof generated>();
  for (const animation of existing) {
    const group = existingByProperty.get(animation.property) ?? [];
    group.push(animation);
    existingByProperty.set(animation.property, group);
  }
  for (const animation of generated) {
    const group = generatedByProperty.get(animation.property) ?? [];
    group.push(animation);
    generatedByProperty.set(animation.property, group);
  }

  const conflictingProperties = Array.from(generatedByProperty.keys())
    .filter((property) => {
      const oldTracks = existingByProperty.get(property);
      if (!oldTracks) return false;
      return [...oldTracks, ...(generatedByProperty.get(property) ?? [])].some(
        (track) => track.repeat !== undefined || track.yoyo !== undefined,
      );
    })
    .sort();
  if (conflictingProperties.length > 0) return { conflictingProperties };

  const animations: NonNullable<SceneNode["animations"]> = [];
  const merged = new Set<string>();
  for (const animation of existing) {
    const additions = generatedByProperty.get(animation.property);
    if (!additions) {
      animations.push(animation);
      continue;
    }
    if (!merged.has(animation.property)) {
      animations.push(
        ...mergeAnimationsByProperty([
          ...(existingByProperty.get(animation.property) ?? []),
          ...additions,
        ]),
      );
      merged.add(animation.property);
    }
  }
  for (const animation of generated) {
    if (!existingByProperty.has(animation.property)) animations.push(animation);
  }
  return { animations };
}

function compileOne(
  scene: Scene,
  command: SceneCommand,
  commandIndex: number,
  context: CompileSceneCommandsContext,
):
  | {
      patch: ScenePatch;
      affectedIds: string[];
      diagnostics: CommandDiagnostic[];
    }
  | { error: CommandError; diagnostics?: CommandDiagnostic[] } {
  const nodes = indexNodes(scene);
  const diagnostic = (
    severity: CommandDiagnostic["severity"],
    code: string,
    message: string,
    affectedIds: string[],
  ): CommandDiagnostic => ({
    commandIndex,
    kind: command.kind,
    severity,
    code,
    message,
    affectedIds,
  });

  switch (command.kind) {
    case "text.set":
      return {
        patch: [
          {
            op: "setNodeProps",
            id: command.id,
            props: { text: command.text, runs: null },
          },
        ],
        affectedIds: [command.id],
        diagnostics: [],
      };
    case "style.set": {
      const style: Record<string, unknown> = { ...(command.style ?? {}) };
      for (const key of command.unset ?? []) style[key] = null;
      return {
        patch: [{ op: "setStyle", id: command.id, style }],
        affectedIds: [command.id],
        diagnostics: [],
      };
    }
    case "placement.set": {
      const style: Record<string, unknown> = {};
      if (command.position !== undefined) style.position = command.position;
      if (command.left !== undefined) {
        style.left = command.left;
        style.right = null;
      }
      if (command.right !== undefined) {
        style.right = command.right;
        style.left = null;
      }
      if (command.top !== undefined) {
        style.top = command.top;
        style.bottom = null;
      }
      if (command.bottom !== undefined) {
        style.bottom = command.bottom;
        style.top = null;
      }
      if (command.zIndex !== undefined) style.zIndex = command.zIndex;
      return {
        patch: [{ op: "setStyle", id: command.id, style }],
        affectedIds: [command.id],
        diagnostics: [],
      };
    }
    case "resize.set":
      return {
        patch: [
          {
            op: "setStyle",
            id: command.id,
            style: {
              ...(command.width !== undefined ? { width: command.width } : {}),
              ...(command.height !== undefined
                ? { height: command.height }
                : {}),
              ...(command.aspectRatio !== undefined
                ? { aspectRatio: command.aspectRatio }
                : {}),
            },
          },
        ],
        affectedIds: [command.id],
        diagnostics: [],
      };
    case "align": {
      const result = compileAlign(scene, command, commandIndex);
      if ("error" in result) return result;
      return {
        patch: result.patch,
        affectedIds: command.ids,
        diagnostics: [],
      };
    }
    case "distribute": {
      const result = compileDistribute(scene, command, commandIndex);
      if ("error" in result) return result;
      return {
        patch: result.patch,
        affectedIds: command.ids,
        diagnostics: [],
      };
    }
    case "timing.set":
      return {
        patch: [
          {
            op: "retime",
            id: command.id,
            ...(command.from !== undefined ? { from: command.from } : {}),
            ...(command.duration !== undefined
              ? { duration: command.duration }
              : {}),
          },
        ],
        affectedIds: [command.id],
        diagnostics: [],
      };
    case "media.trim": {
      const entry = nodes.get(command.id);
      if (!entry) {
        return {
          error: commandError(
            commandIndex,
            command.kind,
            "unknown_node",
            `No node with id "${command.id}".`,
            `commands.${commandIndex}.id`,
          ),
        };
      }
      if (entry.node.type !== "video" && entry.node.type !== "audio") {
        return {
          error: commandError(
            commandIndex,
            command.kind,
            "wrong_node_type",
            `media.trim needs a video or audio node; "${command.id}" is ${entry.node.type}.`,
            `commands.${commandIndex}.id`,
          ),
        };
      }
      const asset = entry.node.assetId
        ? scene.assets[entry.node.assetId]
        : undefined;
      const knownDuration = asset?.metadata?.duration;
      const playbackRate = entry.node.playbackRate ?? 1;
      const reverse = entry.node.type === "video" && playbackRate < 0;
      const resolvedEndSeconds =
        command.endSeconds ?? (reverse ? knownDuration : undefined);
      if (reverse && resolvedEndSeconds === undefined) {
        return {
          error: commandError(
            commandIndex,
            command.kind,
            "reverse_trim_needs_end",
            "Reverse video trim needs endSeconds, or declared asset duration from which the end boundary can be derived.",
            `commands.${commandIndex}.endSeconds`,
          ),
        };
      }
      if (
        resolvedEndSeconds !== undefined &&
        resolvedEndSeconds <= command.startSeconds
      ) {
        return {
          error: commandError(
            commandIndex,
            command.kind,
            "invalid_trim_window",
            "The resolved trim end must be greater than startSeconds.",
            `commands.${commandIndex}.endSeconds`,
          ),
        };
      }
      if (
        knownDuration !== undefined &&
        (command.startSeconds >= knownDuration ||
          (resolvedEndSeconds !== undefined &&
            resolvedEndSeconds > knownDuration))
      ) {
        return {
          error: commandError(
            commandIndex,
            command.kind,
            "trim_out_of_bounds",
            `Requested trim ${command.startSeconds}s–${resolvedEndSeconds ?? "end"} exceeds asset "${asset?.id}" duration ${knownDuration}s.`,
            `commands.${commandIndex}`,
          ),
        };
      }
      const props =
        entry.node.type === "video"
          ? {
              videoStartTime: reverse
                ? (resolvedEndSeconds as number)
                : command.startSeconds,
            }
          : { audioStartTime: command.startSeconds };
      const patch: ScenePatch = [{ op: "setNodeProps", id: command.id, props }];
      if (resolvedEndSeconds !== undefined) {
        const absolutePlaybackRate = Math.abs(playbackRate);
        patch.push({
          op: "retime",
          id: command.id,
          duration: Math.max(
            1,
            Math.round(
              ((resolvedEndSeconds - command.startSeconds) * scene.fps) /
                absolutePlaybackRate,
            ),
          ),
        });
      }
      return {
        patch,
        affectedIds: [command.id],
        diagnostics:
          knownDuration === undefined
            ? [
                diagnostic(
                  "warning",
                  "unverified_media_duration",
                  `Asset "${asset?.id ?? entry.node.assetId ?? "<missing>"}" has no declared duration; source bounds will be checked by runtime preflight.`,
                  [command.id],
                ),
              ]
            : [],
      };
    }
    case "media.gain": {
      const entry = nodes.get(command.id);
      if (!entry) {
        return {
          error: commandError(
            commandIndex,
            command.kind,
            "unknown_node",
            `No node with id "${command.id}".`,
            `commands.${commandIndex}.id`,
          ),
        };
      }
      if (entry.node.type !== "video" && entry.node.type !== "audio") {
        return {
          error: commandError(
            commandIndex,
            command.kind,
            "wrong_node_type",
            `media.gain needs a video or audio node; "${command.id}" is ${entry.node.type}.`,
            `commands.${commandIndex}.id`,
          ),
        };
      }
      return {
        patch: [
          {
            op: "setNodeProps",
            id: command.id,
            props: {
              volume: command.gain,
              ...(command.pan !== undefined ? { pan: command.pan } : {}),
              ...(command.bus !== undefined ? { audioBus: command.bus } : {}),
            },
          },
        ],
        affectedIds: [command.id],
        diagnostics: [],
      };
    }
    case "node.add":
      return {
        patch: [
          {
            op: "insertNode",
            node: command.node as SceneNode,
            parentId: command.parentId,
            beforeId: command.beforeId,
          },
        ],
        affectedIds: [
          command.node.id,
          ...(command.parentId ? [command.parentId] : []),
        ],
        diagnostics: [],
      };
    case "node.remove": {
      const ids: string[] = [];
      const entry = nodes.get(command.id);
      if (entry) collectNodeIds(entry.node, ids);
      return {
        patch: [{ op: "removeNode", id: command.id }],
        affectedIds: [
          ...(ids.length > 0 ? ids : [command.id]),
          ...(entry?.parentId ? [entry.parentId] : []),
        ],
        diagnostics: [],
      };
    }
    case "node.move": {
      const oldParentId = nodes.get(command.id)?.parentId;
      return {
        patch: [
          {
            op: "moveNode",
            id: command.id,
            parentId: command.parentId,
            beforeId: command.beforeId,
          },
        ],
        affectedIds: [
          command.id,
          ...(oldParentId ? [oldParentId] : []),
          ...(command.parentId ? [command.parentId] : []),
        ],
        diagnostics: [],
      };
    }
    case "node.group": {
      const result = compileGroup(scene, command, commandIndex);
      if ("error" in result) return result;
      return { ...result, diagnostics: [] };
    }
    case "motion.preset": {
      const entry = nodes.get(command.id);
      if (!entry) {
        return {
          error: commandError(
            commandIndex,
            command.kind,
            "unknown_node",
            `No node with id "${command.id}".`,
            `commands.${commandIndex}.id`,
          ),
        };
      }
      const generated = compileMotionPreset(command.preset, command.params, {
        reducedMotion: context.reducedMotion,
      });
      let animations = generated;
      if (command.mode === "append") {
        const appended = appendMotionAnimations(
          entry.node.animations ?? [],
          generated,
        );
        if ("conflictingProperties" in appended) {
          return {
            error: commandError(
              commandIndex,
              command.kind,
              "motion_append_playback_conflict",
              `Cannot append preset "${command.preset}" because repeating/yoyo track semantics would be lost for: ${appended.conflictingProperties.join(", ")}. Use mode "replace" or remove the conflicting playback metadata first.`,
              `commands.${commandIndex}.mode`,
            ),
          };
        }
        animations = appended.animations;
      }
      return {
        patch: [{ op: "setAnimations", id: command.id, animations }],
        affectedIds: [command.id],
        diagnostics: [
          diagnostic(
            "info",
            "motion_preset_compiled",
            `Compiled motion preset "${command.preset}" to ${generated.length} canonical animation track(s).`,
            [command.id],
          ),
        ],
      };
    }
    case "macro.insert": {
      const expanded = expandMacroNodeInput(
        { macro: command.name, ...command.params },
        {
          width: scene.width,
          height: scene.height,
          fps: scene.fps,
          duration: scene.duration,
          existingIds: nodes.keys(),
          assets: scene.assets,
          transcripts: context.transcripts,
        },
        { atRoot: command.parentId === undefined },
      );
      if (!expanded.ok) {
        return {
          error: commandError(
            commandIndex,
            command.kind,
            "macro_expansion_failed",
            expanded.errors.join(" | "),
            `commands.${commandIndex}.params`,
          ),
        };
      }
      const node = expanded.nodes[0] as SceneNode | undefined;
      if (!node || typeof node.id !== "string") {
        return {
          error: commandError(
            commandIndex,
            command.kind,
            "macro_expansion_failed",
            `Macro "${command.name}" did not produce one valid root node.`,
            `commands.${commandIndex}`,
          ),
        };
      }
      const ids: string[] = [];
      collectNodeIds(node, ids);
      return {
        patch: [
          {
            op: "insertNode",
            node,
            parentId: command.parentId,
            beforeId: command.beforeId,
          },
        ],
        affectedIds: [...ids, ...(command.parentId ? [command.parentId] : [])],
        diagnostics: expanded.diagnostics.map((message) =>
          diagnostic("info", "macro_expanded", message, ids),
        ),
      };
    }
    case "layout.apply": {
      const style: Record<string, unknown> = {};
      if (command.layout !== undefined) {
        const compiled = clipLayout(command.layout as ClipLayoutKey);
        for (const key of layoutOwnedStyleKeys) {
          if (!(key in compiled)) style[key] = null;
        }
        Object.assign(style, compiled);
      }
      if (command.look !== undefined) {
        Object.assign(style, mediaLook(command.look as MediaLookKey));
      }
      return {
        patch: [{ op: "setStyle", id: command.id, style }],
        affectedIds: [command.id],
        diagnostics: [
          diagnostic(
            "info",
            "layout_intent_compiled",
            `Compiled ${[
              command.layout ? `layout "${command.layout}"` : "",
              command.look ? `look "${command.look}"` : "",
            ]
              .filter(Boolean)
              .join(" and ")} to canonical style values.`,
            [command.id],
          ),
        ],
      };
    }
    case "scene.set": {
      const fields = ["width", "height", "fps", "duration"].filter(
        (field) => command[field as keyof typeof command] !== undefined,
      );
      return {
        patch: [
          {
            op: "setSceneMeta",
            ...(command.width === undefined ? {} : { width: command.width }),
            ...(command.height === undefined ? {} : { height: command.height }),
            ...(command.fps === undefined ? {} : { fps: command.fps }),
            ...(command.duration === undefined
              ? {}
              : { duration: command.duration }),
          },
        ],
        affectedIds: [],
        diagnostics: [
          diagnostic(
            "info",
            "scene_meta_set",
            `Compiled Scene metadata fields: ${fields.join(", ")}.`,
            [],
          ),
        ],
      };
    }
    case "asset.set":
      return {
        patch: [{ op: "setAsset", asset: command.asset }],
        affectedIds: [command.asset.id],
        diagnostics: [
          diagnostic(
            "info",
            "asset_set",
            `Compiled asset ${JSON.stringify(command.asset.id)} (${command.asset.type}).`,
            [command.asset.id],
          ),
        ],
      };
    case "asset.remove":
      return {
        patch: [{ op: "removeAsset", id: command.id }],
        affectedIds: [command.id],
        diagnostics: [
          diagnostic(
            "info",
            "asset_removed",
            `Compiled removal of asset ${JSON.stringify(command.id)}.`,
            [command.id],
          ),
        ],
      };
  }
}

/**
 * Compiles commands sequentially against a private working Scene so later
 * commands may refer to earlier additions. Any failure rejects the complete
 * transaction and exposes no partial patch.
 */
export function compileSceneCommands(
  sceneInput: unknown,
  commandsInput: unknown,
  context: CompileSceneCommandsContext = {},
): CompileSceneCommandsResult {
  let scene: Scene;
  try {
    scene = parseScene(sceneInput);
  } catch (error) {
    return {
      ok: false,
      errors: [
        commandError(
          -1,
          "<input>",
          "invalid_scene",
          `The input Scene is invalid before command compilation: ${error instanceof Error ? error.message : String(error)}`,
          "scene",
        ),
      ],
      affectedIds: [],
      diagnostics: [],
    };
  }

  const parsed = sceneCommandsSchema.safeParse(commandsInput);
  if (!parsed.success) {
    return {
      ok: false,
      errors: validationErrors(commandsInput, parsed.error),
      affectedIds: [],
      diagnostics: [],
    };
  }

  const patch: ScenePatch = [];
  const affectedIds: string[] = [];
  const diagnostics: CommandDiagnostic[] = [];

  for (
    let commandIndex = 0;
    commandIndex < parsed.data.length;
    commandIndex += 1
  ) {
    const command = parsed.data[commandIndex];
    if (!command) continue;
    const semanticError = semanticCommandError(command, commandIndex);
    if (semanticError) {
      return {
        ok: false,
        errors: [semanticError],
        affectedIds: [],
        diagnostics,
      };
    }
    const compiled = compileOne(scene, command, commandIndex, context);
    if ("error" in compiled) {
      return {
        ok: false,
        errors: [compiled.error],
        affectedIds: [],
        diagnostics: [...diagnostics, ...(compiled.diagnostics ?? [])],
      };
    }

    const applied = applyScenePatch(scene, compiled.patch);
    if (!applied.ok) {
      return {
        ok: false,
        errors: applied.errors.map((error) =>
          commandError(
            commandIndex,
            command.kind,
            "command_not_applicable",
            error.message,
            `commands.${commandIndex}`,
          ),
        ),
        affectedIds: [],
        diagnostics,
      };
    }

    scene = applied.scene;
    patch.push(...compiled.patch);
    affectedIds.push(...compiled.affectedIds);
    diagnostics.push(...compiled.diagnostics);
  }

  // Reparse once as the final public boundary so insert operations include
  // canonical node defaults and no compiler-internal values can leak out.
  const canonicalPatch = scenePatchSchema.parse(patch);
  return {
    ok: true,
    patch: canonicalPatch,
    affectedIds: [...new Set(affectedIds)],
    diagnostics,
  };
}

/** Compile and apply one all-or-nothing command transaction. */
export function applySceneCommands(
  sceneInput: unknown,
  commandsInput: unknown,
  context: CompileSceneCommandsContext = {},
): ApplySceneCommandsResult {
  const compiled = compileSceneCommands(sceneInput, commandsInput, context);
  if (!compiled.ok) return compiled;
  const applied = applyScenePatch(sceneInput, compiled.patch);
  if (!applied.ok) {
    return {
      ok: false,
      errors: applied.errors.map((error) =>
        commandError(
          error.opIndex,
          "<compiled-patch>",
          "compiled_patch_failed",
          error.message,
          "patch",
        ),
      ),
      affectedIds: [],
      diagnostics: compiled.diagnostics,
    };
  }
  return {
    ok: true,
    scene: applied.scene,
    patch: compiled.patch,
    affectedIds: compiled.affectedIds,
    diagnostics: compiled.diagnostics,
  };
}
