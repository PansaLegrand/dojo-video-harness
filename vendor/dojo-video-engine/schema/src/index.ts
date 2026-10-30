import { isFontWeightDescriptor } from "./font-assets";
import { z } from "zod/v3";
import { zodToJsonSchema } from "zod-to-json-schema";
export { fontAssetIdsForFamily, fontFamilyNames } from "./font-assets";
import {
  borderValueSchema,
  colorValueSchema,
  easingValueSchema,
  filterValueSchema,
  fontFamilyValueSchema,
  fontWeightValueSchema,
  isEasingValue,
  isFilterValue,
  lengthValueSchema,
  namedEasingValues,
  objectPositionValueSchema,
  paintValueSchema,
  shadowValueSchema,
  singleShadowValueSchema,
  textStrokeValueSchema,
  transformOriginValueSchema,
  transformValueSchema,
} from "./values";
import { decorateSceneJsonSchema } from "./json-schema";
import {
  inspectJsonTreeSafety,
  sceneIngestionHardLimits,
  type JsonTreeSafetyIssue,
} from "./ingestion";

export { sceneIngestionHardLimits } from "./ingestion";

export const supportedStyleKeys = [
  "display",
  "flexDirection",
  "justifyContent",
  "alignItems",
  "gap",
  "width",
  "height",
  "minWidth",
  "minHeight",
  "maxWidth",
  "maxHeight",
  "aspectRatio",
  "safeArea",
  "padding",
  "paddingTop",
  "paddingRight",
  "paddingBottom",
  "paddingLeft",
  "margin",
  "marginTop",
  "marginRight",
  "marginBottom",
  "marginLeft",
  "position",
  "left",
  "right",
  "top",
  "bottom",
  "inset",
  "background",
  "backgroundColor",
  "fill",
  "stroke",
  "strokeWidth",
  "strokeLineCap",
  "strokeLineJoin",
  "strokeDash",
  "border",
  "borderRadius",
  "borderTopLeftRadius",
  "borderTopRightRadius",
  "borderBottomRightRadius",
  "borderBottomLeftRadius",
  "boxShadow",
  "overflow",
  "opacity",
  "blendMode",
  "isolation",
  "filter",
  "zIndex",
  "transform",
  "transformOrigin",
  "fontFamily",
  "fontSize",
  "fontWeight",
  "fontStyle",
  "color",
  "lineHeight",
  "letterSpacing",
  "textAlign",
  "direction",
  "textShadow",
  "textStroke",
  "maxLines",
  "minFontSize",
  "textFit",
  "textOverflow",
  "textBackgroundColor",
  "textBackgroundPadding",
  "textBackgroundPaddingX",
  "textBackgroundPaddingY",
  "textBackgroundRadius",
  "objectFit",
  "objectPosition",
  "imageRendering",
  "pixelSize",
] as const;

export type SupportedStyleKey = (typeof supportedStyleKeys)[number];

export const safeAreaSchema = z
  .object({
    top: lengthValueSchema.optional(),
    right: lengthValueSchema.optional(),
    bottom: lengthValueSchema.optional(),
    left: lengthValueSchema.optional(),
  })
  .strict();

export const blendModes = [
  "source-over",
  "lighter",
  "multiply",
  "screen",
  "overlay",
  "darken",
  "lighten",
  "color-dodge",
  "color-burn",
  "hard-light",
  "soft-light",
  "difference",
  "exclusion",
  "hue",
  "saturation",
  "color",
  "luminosity",
] as const;

export const styleSchema = z
  .object({
    display: z.literal("flex").optional(),
    flexDirection: z.enum(["row", "column"]).optional(),
    justifyContent: z
      .enum(["flex-start", "center", "flex-end", "space-between"])
      .optional(),
    alignItems: z
      .enum(["flex-start", "center", "flex-end", "stretch"])
      .optional(),
    gap: lengthValueSchema.optional(),
    width: lengthValueSchema.optional(),
    height: lengthValueSchema.optional(),
    minWidth: lengthValueSchema.optional(),
    minHeight: lengthValueSchema.optional(),
    maxWidth: lengthValueSchema.optional(),
    maxHeight: lengthValueSchema.optional(),
    aspectRatio: z
      .union([
        z.number().positive(),
        z
          .string()
          .regex(
            /^\s*\d+(?:\.\d+)?\s*\/\s*\d+(?:\.\d+)?\s*$/,
            "aspectRatio must be a positive number or a ratio such as 16/9.",
          )
          .refine((value) => {
            const [width, height] = value.split("/").map(Number);
            return (width ?? 0) > 0 && (height ?? 0) > 0;
          }, "aspectRatio components must both be positive."),
      ])
      .optional(),
    safeArea: safeAreaSchema.optional(),
    padding: lengthValueSchema.optional(),
    paddingTop: lengthValueSchema.optional(),
    paddingRight: lengthValueSchema.optional(),
    paddingBottom: lengthValueSchema.optional(),
    paddingLeft: lengthValueSchema.optional(),
    margin: lengthValueSchema.optional(),
    marginTop: lengthValueSchema.optional(),
    marginRight: lengthValueSchema.optional(),
    marginBottom: lengthValueSchema.optional(),
    marginLeft: lengthValueSchema.optional(),
    position: z.enum(["relative", "absolute"]).optional(),
    left: lengthValueSchema.optional(),
    right: lengthValueSchema.optional(),
    top: lengthValueSchema.optional(),
    bottom: lengthValueSchema.optional(),
    inset: lengthValueSchema.optional(),
    background: paintValueSchema.optional(),
    backgroundColor: colorValueSchema.optional(),
    fill: paintValueSchema.optional(),
    stroke: paintValueSchema.optional(),
    strokeWidth: z.number().min(0).max(1024).optional(),
    strokeLineCap: z.enum(["butt", "round", "square"]).optional(),
    strokeLineJoin: z.enum(["bevel", "round", "miter"]).optional(),
    strokeDash: z
      .array(z.number().nonnegative())
      .max(32)
      .refine(
        (values) => values.length === 0 || values.some((value) => value > 0),
        {
          message:
            "strokeDash must be empty or contain at least one positive length.",
        },
      )
      .optional(),
    border: borderValueSchema.optional(),
    borderRadius: lengthValueSchema.optional(),
    borderTopLeftRadius: lengthValueSchema.optional(),
    borderTopRightRadius: lengthValueSchema.optional(),
    borderBottomRightRadius: lengthValueSchema.optional(),
    borderBottomLeftRadius: lengthValueSchema.optional(),
    boxShadow: shadowValueSchema.optional(),
    overflow: z.enum(["visible", "hidden"]).optional(),
    opacity: z.number().min(0).max(1).optional(),
    blendMode: z.enum(blendModes).optional(),
    isolation: z.boolean().optional(),
    filter: filterValueSchema.optional(),
    zIndex: z.number().int().optional(),
    transform: transformValueSchema.optional(),
    transformOrigin: transformOriginValueSchema.optional(),
    fontFamily: fontFamilyValueSchema.optional(),
    fontSize: lengthValueSchema.optional(),
    fontWeight: fontWeightValueSchema.optional(),
    fontStyle: z.enum(["normal", "italic"]).optional(),
    color: colorValueSchema.optional(),
    lineHeight: lengthValueSchema.optional(),
    letterSpacing: lengthValueSchema.optional(),
    textAlign: z.enum(["left", "center", "right"]).optional(),
    direction: z.enum(["ltr", "rtl", "inherit"]).optional(),
    textShadow: singleShadowValueSchema.optional(),
    textStroke: textStrokeValueSchema.optional(),
    maxLines: z.number().int().positive().optional(),
    minFontSize: lengthValueSchema.optional(),
    textFit: z.enum(["wrap", "shrink", "truncate"]).optional(),
    textOverflow: z.enum(["clip", "ellipsis"]).optional(),
    textBackgroundColor: colorValueSchema.optional(),
    textBackgroundPadding: lengthValueSchema.optional(),
    textBackgroundPaddingX: lengthValueSchema.optional(),
    textBackgroundPaddingY: lengthValueSchema.optional(),
    textBackgroundRadius: lengthValueSchema.optional(),
    objectFit: z
      .enum(["contain", "cover", "fill", "none", "scale-down"])
      .optional(),
    objectPosition: objectPositionValueSchema.optional(),
    imageRendering: z.enum(["auto", "pixelated"]).optional(),
    pixelSize: z.number().min(1).max(256).optional(),
  })
  .strict({
    message:
      "Unsupported style property. DojoVideoEngine Scene v1 supports a curated CSS-like subset; move unsupported behavior into supported transforms, layout, or extension nodes.",
  });

export type SceneStyle = z.infer<typeof styleSchema>;

export const textRunStyleSchema = z
  .object({
    color: colorValueSchema.optional(),
    textStroke: textStrokeValueSchema.optional(),
    textBackgroundColor: colorValueSchema.optional(),
    textBackgroundPadding: lengthValueSchema.optional(),
    textBackgroundPaddingX: lengthValueSchema.optional(),
    textBackgroundPaddingY: lengthValueSchema.optional(),
    textBackgroundRadius: lengthValueSchema.optional(),
    opacity: z.number().min(0).max(1).optional(),
  })
  .strict();

export const textRunSchema = z
  .object({
    text: z.string().min(1),
    style: textRunStyleSchema.optional(),
  })
  .strict();

export type SceneTextRun = z.infer<typeof textRunSchema>;

/**
 * Validates a filter expression: `none` or a space-separated chain of
 * brightness()/contrast()/saturate()/grayscale()/sepia()/invert()/opacity()
 * (number or percentage), hue-rotate(<deg>), and blur(<px>). This is the
 * subset Canvas2D `context.filter` accepts with deterministic output.
 */
export function isFilterExpression(value: string): boolean {
  return isFilterValue(value);
}

export const namedEasings = namedEasingValues;

/**
 * Validates an easing expression: a named easing, `cubic-bezier(x1, y1, x2,
 * y2)` with x1/x2 in [0, 1], or `spring`/`spring(bounce)` with bounce in
 * [0, 1).
 */
export function isEasingExpression(value: string): boolean {
  return isEasingValue(value);
}

export const keyframeSchema = z
  .object({
    frame: z.number().int().nonnegative(),
    value: z.union([z.number(), z.string()]),
    easing: easingValueSchema.optional(),
  })
  .strict();

/**
 * Scene v1 properties with deliberate per-frame evaluation semantics.
 * Numeric values interpolate; compatible color/transform/filter strings
 * interpolate; other valid string values step between keyframes.
 */
export const animationStyleTargets = [
  "display",
  "flexDirection",
  "justifyContent",
  "alignItems",
  "gap",
  "width",
  "height",
  "minWidth",
  "minHeight",
  "maxWidth",
  "maxHeight",
  "aspectRatio",
  "padding",
  "paddingTop",
  "paddingRight",
  "paddingBottom",
  "paddingLeft",
  "margin",
  "marginTop",
  "marginRight",
  "marginBottom",
  "marginLeft",
  "position",
  "left",
  "right",
  "top",
  "bottom",
  "inset",
  "background",
  "backgroundColor",
  "fill",
  "stroke",
  "strokeWidth",
  "strokeLineCap",
  "strokeLineJoin",
  "border",
  "borderRadius",
  "borderTopLeftRadius",
  "borderTopRightRadius",
  "borderBottomRightRadius",
  "borderBottomLeftRadius",
  "boxShadow",
  "overflow",
  "opacity",
  "blendMode",
  "filter",
  "zIndex",
  "transform",
  "transformOrigin",
  "fontFamily",
  "fontSize",
  "fontWeight",
  "fontStyle",
  "color",
  "lineHeight",
  "letterSpacing",
  "textAlign",
  "direction",
  "textShadow",
  "textStroke",
  "maxLines",
  "minFontSize",
  "textFit",
  "textOverflow",
  "textBackgroundColor",
  "textBackgroundPadding",
  "textBackgroundPaddingX",
  "textBackgroundPaddingY",
  "textBackgroundRadius",
  "objectFit",
  "objectPosition",
  "imageRendering",
  "pixelSize",
] as const satisfies readonly SupportedStyleKey[];

export const animationTargets = [
  ...animationStyleTargets,
  "mask.opacity",
  "mask.feather",
  "mask.radius",
] as const;

export type SceneAnimationTarget = (typeof animationTargets)[number];

const animationTargetSchema = z.enum(animationTargets);

function validateAnimationFrameValue(
  target: SceneAnimationTarget,
  value: string | number,
): string | null {
  if (target === "mask.opacity") {
    return typeof value === "number" && value >= 0 && value <= 1
      ? null
      : "mask.opacity keyframes require numbers from 0 to 1.";
  }
  if (target === "mask.feather") {
    return typeof value === "number" && value >= 0 && value <= 256
      ? null
      : "mask.feather keyframes require numbers from 0 to 256.";
  }
  if (target === "mask.radius") {
    return lengthValueSchema.safeParse(value).success
      ? null
      : "mask.radius keyframes require a supported numeric, px, or % length.";
  }

  const parsed = styleSchema.safeParse({ [target]: value });
  return parsed.success
    ? null
    : parsed.error.issues.map((issue) => issue.message).join("; ");
}

export const animationSchema = z
  .object({
    kind: z.literal("keyframes"),
    property: animationTargetSchema,
    frames: z.array(keyframeSchema).min(1),
    repeat: z
      .union([z.number().int().min(0).max(1000), z.literal("infinite")])
      .optional(),
    yoyo: z.boolean().optional(),
  })
  .strict()
  .superRefine((animation, ctx) => {
    animation.frames.forEach((frame, index) => {
      const issue = validateAnimationFrameValue(
        animation.property,
        frame.value,
      );
      if (issue) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["frames", index, "value"],
          message: issue,
        });
      }
    });

    for (let index = 1; index < animation.frames.length; index += 1) {
      const previous = animation.frames[index - 1];
      const current = animation.frames[index];

      if (previous && current && current.frame <= previous.frame) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["frames", index, "frame"],
          message: `Keyframe frames must be strictly increasing; frame ${current.frame} follows frame ${previous.frame}. Sort the frames and merge duplicates.`,
        });
      }
    }
  });

export type SceneAnimation = z.infer<typeof animationSchema>;

export const volumeEnvelopePointSchema = z
  .object({
    frame: z.number().int().nonnegative(),
    value: z.number().min(0).max(1),
    easing: easingValueSchema.optional(),
  })
  .strict();

export const volumeEnvelopeSchema = z
  .array(volumeEnvelopePointSchema)
  .min(1)
  .superRefine((envelope, ctx) => {
    for (let index = 1; index < envelope.length; index += 1) {
      const previous = envelope[index - 1];
      const current = envelope[index];

      if (previous && current && current.frame <= previous.frame) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: [index, "frame"],
          message: `Volume envelope frames must be strictly increasing; frame ${current.frame} follows frame ${previous.frame}. Sort the points and merge duplicates.`,
        });
      }
    }
  });

export type VolumeEnvelope = z.infer<typeof volumeEnvelopeSchema>;

export const effectNames = [
  "cartoonBurst",
  "confettiBurst",
  "cloudPop",
  "speedLines",
  "neonAura",
  "scribbleCircle",
  "spectrumBars",
  "cassetteVuMeter",
  "waveformLine",
  "mirrorBars",
  "circularSpectrum",
  "neonWaveform",
  "pulseRings",
  "particleGalaxy",
  "albumCoverPulse",
  "audioBlob",
  "starfieldTunnel",
  "equalizerGrid",
  "liquidGradient",
  "kaleidoscope",
  "vinylRecord",
  "audioTerrain",
  "lightningArc",
  "minimalLineArt",
] as const;

// Effects that read per-frame audio spectra. resolveAssets() analyzes only the
// audio assets referenced by these, and each requires params.audioAssetId.
export const audioReactiveEffectNames = [
  "spectrumBars",
  "cassetteVuMeter",
  "waveformLine",
  "mirrorBars",
  "circularSpectrum",
  "neonWaveform",
  "pulseRings",
  "particleGalaxy",
  "albumCoverPulse",
  "audioBlob",
  "starfieldTunnel",
  "equalizerGrid",
  "liquidGradient",
  "kaleidoscope",
  "vinylRecord",
  "audioTerrain",
  "lightningArc",
  "minimalLineArt",
] as const;

export function isAudioReactiveEffect(
  effect: string | undefined,
): effect is (typeof audioReactiveEffectNames)[number] {
  return (audioReactiveEffectNames as readonly string[]).includes(effect ?? "");
}

export const effectParamsSchema = z
  .object({
    intensity: z.enum(["low", "medium", "high"]).optional(),
    seed: z.number().int().nonnegative().optional(),
    colors: z.array(colorValueSchema).min(1).max(8).optional(),
    particleCount: z.number().int().min(1).max(240).optional(),
    shockwave: z.boolean().optional(),
    emoji: z.string().min(1).max(12).optional(),
    direction: z
      .enum(["left", "right", "up", "down", "in", "out", "diagonal"])
      .optional(),
    density: z.enum(["low", "medium", "high"]).optional(),
    loops: z.number().int().min(1).max(8).optional(),
    strokeWidth: z.number().min(1).max(80).optional(),
    radius: z.number().positive().optional(),
    wobble: z.number().min(0).max(1).optional(),
    pulse: z.number().min(0).max(1).optional(),
    scale: z.number().min(0.1).max(4).optional(),
    spread: z.number().min(0).max(1).optional(),
    softness: z.number().min(0).max(1).optional(),
    glow: z.number().min(0).max(1).optional(),
    scope: z.enum(["text", "frame"]).optional(),
    audioAssetId: z.string().min(1).optional(),
    /** Audio-reactive effects: source offset in seconds, independent of scene placement. */
    audioStartTime: z.number().finite().nonnegative().optional(),
    /** Audio-reactive effects: positive source-time multiplier, matching a trimmed media clip. */
    audioPlaybackRate: z.number().finite().positive().max(16).optional(),
    coverAssetId: z.string().min(1).optional(),
    barCount: z.number().int().min(8).max(128).optional(),
    sensitivity: z.number().min(0.2).max(10).optional(),
    smoothing: z.boolean().optional(),
  })
  .strict({
    message:
      "Unsupported effect param. Use the documented params for this DojoVideoEngine effect preset.",
  });

export type SceneEffectName = (typeof effectNames)[number];
export type SceneEffectParams = z.infer<typeof effectParamsSchema>;

const extensionNamePattern = /^[A-Za-z0-9][A-Za-z0-9._/-]*$/;
const extensionVersionPattern =
  /^(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)(?:-(?:0|[1-9]\d*|[A-Za-z-][0-9A-Za-z-]*)(?:\.(?:0|[1-9]\d*|[A-Za-z-][0-9A-Za-z-]*))*)?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/;

export type SceneJsonValue =
  | string
  | number
  | boolean
  | null
  | SceneJsonValue[]
  | { [key: string]: SceneJsonValue };

/** JSON-only values accepted in agent-authored extension parameters. */
export const jsonValueSchema: z.ZodType<SceneJsonValue> = z.lazy(() =>
  z.union([
    z.string(),
    z.number().finite(),
    z.boolean(),
    z.null(),
    z.array(jsonValueSchema),
    z.record(jsonValueSchema),
  ]),
);

export const extensionDescriptorSchema = z
  .object({
    name: z
      .string()
      .min(1)
      .max(191)
      .regex(
        extensionNamePattern,
        "Extension names must be stable namespaced identifiers using letters, numbers, dot, slash, underscore, or hyphen.",
      ),
    version: z
      .string()
      .regex(
        extensionVersionPattern,
        "Extension versions must be exact semantic versions such as 1.0.0 or 1.0.0-beta.1.",
      ),
    params: z.record(jsonValueSchema),
  })
  .strict();

export type SceneExtensionDescriptor = z.infer<
  typeof extensionDescriptorSchema
>;

export const shapePointSchema = z
  .object({
    /** Normalized against the node box: 0 = start edge, 1 = end edge. */
    x: z.number().finite().min(-16).max(16),
    y: z.number().finite().min(-16).max(16),
  })
  .strict();

const pathDataPattern = /^[MmZzLlHhVvCcSsQqTtAa0-9eE+.,\s-]+$/;

const shapeGeometryOptions = [
  z
    .object({
      kind: z.literal("rect"),
      radius: lengthValueSchema.optional(),
    })
    .strict(),
  z.object({ kind: z.literal("ellipse") }).strict(),
  z
    .object({
      kind: z.literal("line"),
      points: z.tuple([shapePointSchema, shapePointSchema]),
    })
    .strict(),
  z
    .object({
      kind: z.literal("polyline"),
      points: z.array(shapePointSchema).min(2).max(256),
    })
    .strict(),
  z
    .object({
      kind: z.literal("polygon"),
      points: z.array(shapePointSchema).min(3).max(256),
    })
    .strict(),
  z
    .object({
      kind: z.literal("path"),
      d: z
        .string()
        .min(1)
        .max(100_000)
        .regex(
          pathDataPattern,
          "SVG path data may contain path commands and numeric coordinates only.",
        ),
      viewBox: z
        .object({
          x: z.number().finite(),
          y: z.number().finite(),
          width: z.number().positive(),
          height: z.number().positive(),
        })
        .strict(),
      fillRule: z.enum(["nonzero", "evenodd"]).optional(),
    })
    .strict(),
] as const;

export const shapeGeometrySchema = z.discriminatedUnion(
  "kind",
  shapeGeometryOptions,
);

export type SceneShapeGeometry = z.infer<typeof shapeGeometrySchema>;

export const closedShapeGeometrySchema = shapeGeometrySchema.refine(
  (shape) => shape.kind !== "line" && shape.kind !== "polyline",
  { message: "Clip and mask geometry must be closed." },
);

export const maskDescriptorSchema = z
  .object({
    shape: closedShapeGeometrySchema,
    inverted: z.boolean().optional(),
    opacity: z.number().min(0).max(1).optional(),
    feather: z.number().min(0).max(256).optional(),
  })
  .strict();

export type SceneMaskDescriptor = {
  shape: SceneShapeGeometry;
  inverted?: boolean;
  opacity?: number;
  feather?: number;
};

export const audioBusSchema = z
  .object({
    gain: z.number().min(0).max(2).optional(),
    pan: z.number().min(-1).max(1).optional(),
    limiter: z.boolean().optional(),
    limiterCeiling: z.number().min(0.1).max(1).optional(),
  })
  .strict();

export const duckingSchema = z
  .object({
    bus: z.string().min(1).max(64),
    gain: z.number().min(0).max(1),
    attackFrames: z.number().int().min(0).max(600).optional(),
    releaseFrames: z.number().int().min(0).max(600).optional(),
  })
  .strict();

export type SceneAudioBus = z.infer<typeof audioBusSchema>;
export type SceneDucking = z.infer<typeof duckingSchema>;

export const assetSchema = z
  .object({
    id: z.string().min(1),
    type: z.enum(["image", "video", "audio", "font", "lottie"]),
    src: z.string().min(1),
    sourceMode: z.enum(["auto", "stream", "buffer"]).optional(),
    proxy: z
      .object({
        src: z.string().min(1),
        width: z.number().int().positive().optional(),
        height: z.number().int().positive().optional(),
        bitrate: z.number().positive().optional(),
      })
      .strict()
      .optional(),
    metadata: z
      .object({
        duration: z.number().positive().optional(),
        width: z.number().int().positive().optional(),
        height: z.number().int().positive().optional(),
        byteLength: z.number().int().positive().optional(),
        mimeType: z.string().min(1).max(127).optional(),
        /** FontFace descriptors; omitted family preserves the asset-id-as-family contract. */
        fontFamily: z
          .string()
          .trim()
          .min(1)
          .max(200)
          .regex(/^[^,;{}]+$/)
          .optional(),
        fontWeight: z
          .union([
            z.number().int().min(1).max(1000),
            z
              .string()
              .max(24)
              .refine(
                isFontWeightDescriptor,
                "Font weight must be normal, bold, 1-1000, or an ascending variable range such as 100 900.",
              )
              .describe(
                "FontFace weight descriptor: normal, bold, fixed 1-1000 or ascending variable range.",
              ),
          ])
          .optional(),
        fontStyle: z.enum(["normal", "italic", "oblique"]).optional(),
        codec: z.string().min(1).optional(),
        hasAudio: z.boolean().optional(),
        audioCodec: z.string().min(1).optional(),
        audioSampleRate: z.number().int().positive().optional(),
        audioChannels: z.number().int().positive().max(32).optional(),
        frameRate: z
          .object({
            numerator: z.number().int().positive(),
            denominator: z.number().int().positive(),
          })
          .strict()
          .optional(),
        variableFrameRate: z.boolean().optional(),
        /** Host-owned stable content identity; signed URL rotation may preserve it. */
        contentHash: z.string().min(1).max(256).optional(),
      })
      .strict()
      .optional(),
  })
  .strict();

export type SceneAsset = z.infer<typeof assetSchema>;

const legacyAssetSchema: z.ZodType<SceneAsset> = z
  .object({
    id: z.string().min(1),
    type: z.enum(["image", "video", "audio", "font", "lottie"]),
    src: z.string().min(1),
  })
  .strict();

export type SceneNodeInput = {
  id: string;
  type:
    | "div"
    | "text"
    | "img"
    | "video"
    | "audio"
    | "lottie"
    | "effect"
    | "extension"
    | "shape";
  text?: string;
  /** Text nodes: metric-stable inline visual styles; mutually exclusive with text. */
  runs?: SceneTextRun[];
  assetId?: string;
  /** Effect nodes: named procedural visual preset rendered by the effect renderer. */
  effect?: SceneEffectName;
  /** Effect nodes: preset-specific parameters. */
  params?: SceneEffectParams;
  /** Trusted host extension reference and JSON-only parameters. */
  extension?: SceneExtensionDescriptor;
  /** Shape nodes: serializable rectangle, ellipse, line, polygon, or SVG path geometry. */
  shape?: SceneShapeGeometry;
  /** Visual nodes: closed geometry intersected with the current clipping region. */
  clip?: SceneShapeGeometry;
  /** Visual nodes: opaque vector mask, optionally inverted. */
  mask?: SceneMaskDescriptor;
  /** Video nodes: source trim offset in seconds (source footage has its own timebase, independent of scene fps). */
  videoStartTime?: number;
  /** Video and lottie nodes: playback speed multiplier (1 = natural speed). */
  playbackRate?: number;
  /** Audio nodes: source trim offset in seconds. */
  audioStartTime?: number;
  /**
   * Audio and video nodes: gain from 0 (silent) to 1 (natural), default 1.
   * A video node's clip audio is mixed into the export at this gain;
   * playbackRate also retimes the sound (pitch shifts — no time-stretch).
   */
  volume?: number;
  /**
   * Audio and video nodes: node-local gain curve multiplied by `volume`.
   * Frames are node-local, not source-local. Export and preview both sample it
   * during mixing, so fades and ducking affect sound rather than visuals.
   */
  volumeEnvelope?: VolumeEnvelope;
  /** Audio/video nodes: named mix bus (implicit default: master). */
  audioBus?: string;
  /** Audio/video nodes: stereo pan from -1 (left) to 1 (right). */
  pan?: number;
  /** Audio/video nodes: reduce a target bus while this node is active. */
  ducks?: SceneDucking;
  /** Video nodes: source behavior after reaching an edge. */
  videoEndBehavior?: "hold" | "loop";
  /** Audio nodes: wrap source playback through the node's active window. */
  loop?: boolean;
  from?: number;
  duration?: number;
  style?: SceneStyle;
  animations?: SceneAnimation[];
  children?: SceneNodeInput[];
};

export type SceneNode = SceneNodeInput;

function createSceneNodeSchema(
  includeExtensions: boolean,
): z.ZodType<SceneNodeInput> {
  const nodeTypeSchema = includeExtensions
    ? z.enum([
        "div",
        "text",
        "img",
        "video",
        "audio",
        "lottie",
        "effect",
        "extension",
        "shape",
      ])
    : z.enum(["div", "text", "img", "video", "audio", "lottie", "effect"]);
  const nodeSchema: z.ZodType<SceneNodeInput> = z.lazy(() =>
    z
      .object({
        id: z.string().min(1),
        type: nodeTypeSchema,
        text: z.string().optional(),
        runs: includeExtensions
          ? z.array(textRunSchema).min(1).max(256).optional()
          : z.never().optional(),
        assetId: z.string().optional(),
        effect: z.enum(effectNames).optional(),
        params: effectParamsSchema.optional(),
        extension: includeExtensions
          ? extensionDescriptorSchema.optional()
          : z.never().optional(),
        shape: includeExtensions
          ? shapeGeometrySchema.optional()
          : z.never().optional(),
        clip: includeExtensions
          ? closedShapeGeometrySchema.optional()
          : z.never().optional(),
        mask: includeExtensions
          ? maskDescriptorSchema.optional()
          : z.never().optional(),
        videoStartTime: z.number().nonnegative().optional(),
        playbackRate: z
          .number()
          .min(-16)
          .max(16)
          .refine((value) => value !== 0, "playbackRate cannot be zero.")
          .optional(),
        audioStartTime: z.number().nonnegative().optional(),
        volume: z.number().min(0).max(1).optional(),
        volumeEnvelope: volumeEnvelopeSchema.optional(),
        audioBus: z.string().min(1).max(64).optional(),
        pan: z.number().min(-1).max(1).optional(),
        ducks: duckingSchema.optional(),
        videoEndBehavior: z.enum(["hold", "loop"]).optional(),
        loop: z.boolean().optional(),
        from: z.number().int().default(0),
        duration: z.number().int().positive().optional(),
        style: styleSchema.default({}),
        animations: z.array(animationSchema).default([]),
        children: z.array(nodeSchema).default([]),
      })
      .strict()
      .superRefine((node, ctx) => {
        if (
          node.type === "text" &&
          typeof node.text !== "string" &&
          !node.runs
        ) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: ["text"],
            message: "Text nodes require a `text` string or non-empty `runs`.",
          });
        }

        if (node.type === "text" && node.text !== undefined && node.runs) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: ["runs"],
            message: "Text nodes use either `text` or `runs`, not both.",
          });
        }

        if (node.type !== "text" && node.runs !== undefined) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: ["runs"],
            message: `runs only applies to text nodes; remove it from this ${node.type} node.`,
          });
        }

        if (node.type === "effect" && !node.effect) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: ["effect"],
            message: "Effect nodes require an `effect` preset name.",
          });
        }

        if (
          node.type === "effect" &&
          isAudioReactiveEffect(node.effect) &&
          !node.params?.audioAssetId
        ) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: ["params", "audioAssetId"],
            message: `${node.effect} requires params.audioAssetId so preview and export analyze the same audio asset.`,
          });
        }

        if (node.type !== "effect" && node.effect !== undefined) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: ["effect"],
            message: `effect only applies to effect nodes; remove it from this ${node.type} node.`,
          });
        }

        if (node.type !== "effect" && node.params !== undefined) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: ["params"],
            message: `params only applies to effect nodes; remove it from this ${node.type} node.`,
          });
        }

        if (node.type === "extension" && !node.extension) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: ["extension"],
            message:
              "Extension nodes require an extension descriptor with name, exact version, and params.",
          });
        }

        if (node.type !== "extension" && node.extension !== undefined) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: ["extension"],
            message: `extension only applies to extension nodes; remove it from this ${node.type} node.`,
          });
        }

        if (node.type === "shape" && !node.shape) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: ["shape"],
            message: "Shape nodes require serializable shape geometry.",
          });
        }

        if (node.type !== "shape" && node.shape !== undefined) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: ["shape"],
            message: `shape only applies to shape nodes; remove it from this ${node.type} node.`,
          });
        }

        if (node.type === "audio" && (node.clip || node.mask)) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: node.clip ? ["clip"] : ["mask"],
            message:
              "Audio nodes are not visual and cannot carry clip or mask geometry.",
          });
        }

        const maskAnimations = (node.animations ?? []).filter((animation) =>
          animation.property.startsWith("mask."),
        );
        if (maskAnimations.length > 0 && !node.mask) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: ["animations"],
            message:
              "mask.* animations require a mask descriptor on the same node.",
          });
        }
        if (
          maskAnimations.some(
            (animation) => animation.property === "mask.radius",
          ) &&
          node.mask?.shape.kind !== "rect"
        ) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: ["animations"],
            message: "mask.radius animations require a rectangular mask shape.",
          });
        }

        if (
          (node.type === "img" ||
            node.type === "video" ||
            node.type === "audio" ||
            node.type === "lottie") &&
          !node.assetId
        ) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: ["assetId"],
            message: `${node.type} nodes require an assetId that points at scene.assets.`,
          });
        }

        if (node.type !== "video" && node.videoStartTime !== undefined) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: ["videoStartTime"],
            message: `videoStartTime only applies to video nodes; remove it from this ${node.type} node.`,
          });
        }

        if (
          node.type !== "video" &&
          node.type !== "lottie" &&
          node.playbackRate !== undefined
        ) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: ["playbackRate"],
            message: `playbackRate only applies to video and lottie nodes; remove it from this ${node.type} node.`,
          });
        }

        if (node.type === "lottie" && (node.playbackRate ?? 1) < 0) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: ["playbackRate"],
            message:
              "Negative playbackRate is currently supported for video nodes only.",
          });
        }

        if (node.type !== "audio" && node.audioStartTime !== undefined) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: ["audioStartTime"],
            message: `audioStartTime only applies to audio nodes; video nodes trim picture and sound together via videoStartTime. Remove it from this ${node.type} node.`,
          });
        }

        if (
          node.type !== "audio" &&
          node.type !== "video" &&
          (node.volume !== undefined ||
            node.volumeEnvelope !== undefined ||
            node.audioBus !== undefined ||
            node.pan !== undefined ||
            node.ducks !== undefined)
        ) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: [
              node.volume !== undefined
                ? "volume"
                : node.volumeEnvelope !== undefined
                  ? "volumeEnvelope"
                  : node.audioBus !== undefined
                    ? "audioBus"
                    : node.pan !== undefined
                      ? "pan"
                      : "ducks",
            ],
            message: `volume and volumeEnvelope only apply to audio and video nodes; audioBus, pan, and ducks share the same restriction. Remove them from this ${node.type} node.`,
          });
        }

        if (node.type !== "video" && node.videoEndBehavior !== undefined) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: ["videoEndBehavior"],
            message: `videoEndBehavior only applies to video nodes; remove it from this ${node.type} node.`,
          });
        }

        if (
          node.type === "video" &&
          (node.playbackRate ?? 1) < 0 &&
          (node.volume ?? 1) > 0
        ) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: ["volume"],
            message:
              "Reverse video playback is visual-only; set volume to 0 or use a separately reversed audio asset.",
          });
        }

        if (node.type !== "audio" && node.loop !== undefined) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: ["loop"],
            message: `loop only applies to audio nodes; remove it from this ${node.type} node.`,
          });
        }

        if (node.type === "audio") {
          if (Object.keys(node.style ?? {}).length > 0) {
            ctx.addIssue({
              code: z.ZodIssueCode.custom,
              path: ["style"],
              message:
                "Audio nodes are not visual; remove style (timeline placement uses from/duration).",
            });
          }

          if ((node.children ?? []).length > 0) {
            ctx.addIssue({
              code: z.ZodIssueCode.custom,
              path: ["children"],
              message: "Audio nodes cannot have children.",
            });
          }

          if ((node.animations ?? []).length > 0) {
            ctx.addIssue({
              code: z.ZodIssueCode.custom,
              path: ["animations"],
              message:
                "Audio nodes do not support animations yet; use volume or volumeEnvelope for sound gain.",
            });
          }
        }
      }),
  );

  return nodeSchema;
}

export const sceneNodeSchema = createSceneNodeSchema(true);
const legacySceneNodeSchema = createSceneNodeSchema(false);

function sceneDocumentFields(
  nodeSchema: z.ZodType<SceneNodeInput>,
  includeCurrentFeatures: boolean,
) {
  return {
    width: z.number().int().positive(),
    height: z.number().int().positive(),
    fps: z.number().int().positive(),
    duration: z.number().int().positive(),
    assets: z
      .record(includeCurrentFeatures ? assetSchema : legacyAssetSchema)
      .default({}),
    nodes: z.array(nodeSchema).default([]),
    markers: includeCurrentFeatures
      ? z.record(z.number().int().nonnegative()).optional()
      : z.never().optional(),
    audioBuses: includeCurrentFeatures
      ? z.record(audioBusSchema).optional()
      : z.never().optional(),
  };
}

type SceneDocumentForValidation = {
  duration: number;
  assets: Record<string, SceneAsset>;
  nodes: SceneNodeInput[];
  markers?: Record<string, number>;
  audioBuses?: Record<string, SceneAudioBus>;
};

const nodeAssetTypes: Partial<
  Record<SceneNodeInput["type"], SceneAsset["type"]>
> = {
  img: "image",
  video: "video",
  audio: "audio",
  lottie: "lottie",
};

function validateSceneDocument(
  scene: SceneDocumentForValidation,
  ctx: z.RefinementCtx,
): void {
  for (const [name, frame] of Object.entries(scene.markers ?? {})) {
    if (!/^[A-Za-z][A-Za-z0-9._-]{0,63}$/.test(name)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["markers", name],
        message:
          "Marker names must start with a letter and use at most 64 letters, numbers, dot, underscore, or hyphen characters.",
      });
    }
    if (frame >= scene.duration) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["markers", name],
        message: `Marker "${name}" at frame ${frame} must be inside the scene duration.`,
      });
    }
  }
  for (const name of Object.keys(scene.audioBuses ?? {})) {
    if (!/^[A-Za-z][A-Za-z0-9._-]{0,63}$/.test(name)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["audioBuses", name],
        message:
          "Audio bus names must start with a letter and use at most 64 letters, numbers, dot, underscore, or hyphen characters.",
      });
    }
  }
  for (const [id, asset] of Object.entries(scene.assets)) {
    if (id !== asset.id) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["assets", id],
        message: `Asset map key "${id}" must match asset.id "${asset.id}".`,
      });
    }
  }

  const seenNodeIds = new Set<string>();

  const validateAssetReference = (
    assetId: string,
    expectedType: SceneAsset["type"],
    path: Array<string | number>,
    owner: string,
  ): void => {
    const asset = scene.assets[assetId];
    if (!asset) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path,
        message: `${owner} references missing asset "${assetId}". Add it to scene.assets or update the reference.`,
      });
      return;
    }

    if (asset.type !== expectedType) {
      const article =
        expectedType === "audio" || expectedType === "image" ? "an" : "a";
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path,
        message: `${owner} requires ${article} ${expectedType} asset, but "${assetId}" is ${asset.type}. Use a ${expectedType} asset or change the node/effect.`,
      });
    }
  };

  const visit = (
    nodes: SceneNodeInput[],
    path: Array<string | number>,
  ): void => {
    nodes.forEach((node, index) => {
      const nodePath = [...path, index];
      if (seenNodeIds.has(node.id)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: [...nodePath, "id"],
          message: `Duplicate node id "${node.id}". Node ids must be unique across the scene so tools can patch and diff nodes reliably.`,
        });
      }

      seenNodeIds.add(node.id);

      if (
        (node.type === "audio" || node.type === "video") &&
        node.audioBus &&
        node.audioBus !== "master" &&
        !scene.audioBuses?.[node.audioBus]
      ) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: [...nodePath, "audioBus"],
          message: `Node "${node.id}" references missing audio bus "${node.audioBus}".`,
        });
      }
      if (
        node.ducks &&
        node.ducks.bus !== "master" &&
        !scene.audioBuses?.[node.ducks.bus]
      ) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: [...nodePath, "ducks", "bus"],
          message: `Node "${node.id}" ducks missing audio bus "${node.ducks.bus}".`,
        });
      }

      const expectedAssetType = nodeAssetTypes[node.type];
      if (node.assetId && expectedAssetType) {
        validateAssetReference(
          node.assetId,
          expectedAssetType,
          [...nodePath, "assetId"],
          `${node.type} node "${node.id}"`,
        );
      }

      if (node.type === "effect" && node.params?.audioAssetId) {
        validateAssetReference(
          node.params.audioAssetId,
          "audio",
          [...nodePath, "params", "audioAssetId"],
          `${node.effect ?? "audio-reactive"} effect "${node.id}"`,
        );
      }

      if (node.type === "effect" && node.params?.coverAssetId) {
        validateAssetReference(
          node.params.coverAssetId,
          "image",
          [...nodePath, "params", "coverAssetId"],
          `${node.effect ?? "cover"} effect "${node.id}"`,
        );
      }

      visit(node.children ?? [], [...nodePath, "children"]);
    });
  };

  visit(scene.nodes, ["nodes"]);
}

/** Legacy 0.4-and-earlier scene document, accepted only through migration. */
export const legacySceneV0Schema = z
  .object({
    schemaVersion: z.literal(0),
    ...sceneDocumentFields(legacySceneNodeSchema, false),
  })
  .strict()
  .superRefine(validateSceneDocument);

/** Current canonical Scene v1 document. */
export const sceneSchema = z
  .object({
    schemaVersion: z.literal(1),
    ...sceneDocumentFields(sceneNodeSchema, true),
  })
  .strict()
  .superRefine(validateSceneDocument);

export type LegacySceneV0 = z.infer<typeof legacySceneV0Schema>;
export type Scene = z.infer<typeof sceneSchema>;
export type SceneInput = Scene | LegacySceneV0;

export const CURRENT_SCENE_VERSION = 1 as const;

export type SceneMigrationResult = {
  scene: Scene;
  fromVersion: 0 | 1;
  toVersion: typeof CURRENT_SCENE_VERSION;
  migrations: readonly string[];
};

export class SceneValidationError extends Error {
  constructor(readonly issues: z.ZodIssue[]) {
    super(formatSceneIssues(issues));
    this.name = "SceneValidationError";
  }
}

/**
 * Objects previously normalized by parseScene/validateScene/migrateScene.
 * Re-parsing the same input object returns its cached canonical v1 scene, so
 * frame loops never pay for validation or legacy migration more than once.
 * Parsed scenes must be treated as immutable — mutating one bypasses
 * re-validation by design.
 */
const normalizedScenes = new WeakMap<object, SceneMigrationResult>();

type SafeSceneMigrationResult =
  | { ok: true; result: SceneMigrationResult }
  | { ok: false; issues: z.ZodIssue[] };

function safeMigrateScene(input: unknown): SafeSceneMigrationResult {
  if (typeof input === "object" && input !== null) {
    const cached = normalizedScenes.get(input);
    if (cached) {
      return { ok: true, result: cached };
    }
  }

  const treeSafety = inspectJsonTreeSafety(input, sceneIngestionHardLimits);
  if (!treeSafety.ok) {
    return {
      ok: false,
      issues: [
        {
          code: z.ZodIssueCode.custom,
          path: treeSafety.issue.path,
          message: formatJsonTreeSafetyIssue(treeSafety.issue, "Scene input"),
        },
      ],
    };
  }

  const version =
    typeof input === "object" && input !== null && "schemaVersion" in input
      ? (input as { schemaVersion?: unknown }).schemaVersion
      : undefined;

  if (version === 0) {
    const legacy = legacySceneV0Schema.safeParse(input);
    if (!legacy.success) {
      return { ok: false, issues: legacy.error.issues };
    }

    const migrated = sceneSchema.safeParse({
      ...legacy.data,
      schemaVersion: CURRENT_SCENE_VERSION,
    });
    if (!migrated.success) {
      return { ok: false, issues: migrated.error.issues };
    }

    return {
      ok: true,
      result: {
        scene: migrated.data,
        fromVersion: 0,
        toVersion: CURRENT_SCENE_VERSION,
        migrations: ["scene-v0-to-v1"],
      },
    };
  }

  if (version === CURRENT_SCENE_VERSION) {
    const current = sceneSchema.safeParse(input);
    return current.success
      ? {
          ok: true,
          result: {
            scene: current.data,
            fromVersion: CURRENT_SCENE_VERSION,
            toVersion: CURRENT_SCENE_VERSION,
            migrations: [],
          },
        }
      : { ok: false, issues: current.error.issues };
  }

  return {
    ok: false,
    issues: [
      {
        code: z.ZodIssueCode.custom,
        path: ["schemaVersion"],
        message:
          version === undefined
            ? `Scene schemaVersion is required. Use ${CURRENT_SCENE_VERSION} for new scenes or 0 for automatic migration.`
            : `Unsupported scene schemaVersion ${JSON.stringify(version)}. This build supports canonical version ${CURRENT_SCENE_VERSION} and migration from version 0.`,
      },
    ],
  };
}

function cacheNormalizedScene(
  input: unknown,
  result: SceneMigrationResult,
): void {
  normalizedScenes.set(result.scene, {
    scene: result.scene,
    fromVersion: CURRENT_SCENE_VERSION,
    toVersion: CURRENT_SCENE_VERSION,
    migrations: [],
  });
  if (typeof input === "object" && input !== null) {
    normalizedScenes.set(input, result);
  }
}

/**
 * Validates and deterministically migrates a legacy v0 or current v1 scene to
 * canonical Scene v1. The input is never mutated.
 */
export function migrateScene(input: unknown): SceneMigrationResult {
  const migrated = safeMigrateScene(input);
  if (!migrated.ok) {
    throw new SceneValidationError(migrated.issues);
  }

  cacheNormalizedScene(input, migrated.result);
  return migrated.result;
}

export function parseScene(input: unknown): Scene {
  return migrateScene(input).scene;
}

export type SceneRepairDiagnostic = {
  severity: "warning";
  code: "unknown_key_removed";
  /** Full path to the removed key in the supplied document. */
  path: Array<string | number>;
  key: string;
  message: string;
};

export type SceneRepairResult =
  | {
      ok: true;
      scene: Scene;
      fromVersion: 0 | 1;
      toVersion: typeof CURRENT_SCENE_VERSION;
      migrations: readonly string[];
      diagnostics: SceneRepairDiagnostic[];
    }
  | {
      ok: false;
      errors: string[];
      diagnostics: SceneRepairDiagnostic[];
    };

/**
 * Explicit tolerant ingestion for model, legacy-adapter, and import boundaries.
 * Only unknown object keys are removed; invalid values, missing fields,
 * unsupported versions, and cross-field errors remain failures. The input is
 * never mutated, and calling this function does not make later parseScene(input)
 * calls tolerant — canonical parsing remains strict.
 */
export function repairSceneInput(input: unknown): SceneRepairResult {
  const treeError = validateRepairTree(input);
  if (treeError) {
    return { ok: false, errors: [treeError], diagnostics: [] };
  }

  let candidate: unknown;
  try {
    candidate = structuredClone(input);
  } catch (error) {
    return {
      ok: false,
      errors: [
        `scene: repair input must be structured-cloneable data: ${error instanceof Error ? error.message : String(error)}`,
      ],
      diagnostics: [],
    };
  }

  const diagnostics: SceneRepairDiagnostic[] = [];

  // Nested strict-object errors are normally returned together. The bounded
  // retry handles cases where removing an outer unknown key lets Zod expose a
  // deeper strict-object issue on the next pass.
  for (let pass = 0; pass < 32; pass += 1) {
    const result = safeMigrateScene(candidate);
    if (result.ok) {
      cacheNormalizedScene(candidate, result.result);
      diagnostics.sort((left, right) =>
        formatRepairPath(left.path).localeCompare(formatRepairPath(right.path)),
      );
      return {
        ok: true,
        scene: result.result.scene,
        fromVersion: result.result.fromVersion,
        toVersion: result.result.toVersion,
        migrations: result.result.migrations,
        diagnostics,
      };
    }

    const unknownIssues = result.issues.filter(
      (
        issue,
      ): issue is z.ZodIssue & {
        code: typeof z.ZodIssueCode.unrecognized_keys;
        keys: string[];
      } => issue.code === z.ZodIssueCode.unrecognized_keys,
    );
    let removed = 0;

    for (const issue of unknownIssues) {
      const owner = valueAtRepairPath(candidate, issue.path);
      if (!isRepairRecord(owner)) continue;

      for (const key of issue.keys) {
        if (!Object.hasOwn(owner, key)) continue;
        delete owner[key];
        removed += 1;
        const path = [...issue.path, key].filter(
          (part): part is string | number =>
            typeof part === "string" || typeof part === "number",
        );
        diagnostics.push({
          severity: "warning",
          code: "unknown_key_removed",
          path,
          key,
          message: `${formatRepairPath(path)}: removed unknown key ${JSON.stringify(key)} during explicit repair.`,
        });
      }
    }

    if (removed === 0) {
      return {
        ok: false,
        errors: result.issues.map(formatSceneIssue),
        diagnostics,
      };
    }
  }

  return {
    ok: false,
    errors: [
      "scene: repair exceeded 32 unknown-key passes; reject the document instead of guessing further.",
    ],
    diagnostics,
  };
}

export function validateScene(
  input: unknown,
): { ok: true; scene: Scene } | { ok: false; errors: string[] } {
  const migrated = safeMigrateScene(input);
  if (migrated.ok) {
    cacheNormalizedScene(input, migrated.result);
    return { ok: true, scene: migrated.result.scene };
  }

  return {
    ok: false,
    errors: migrated.issues.map(formatSceneIssue),
  };
}

function isRepairRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function validateRepairTree(value: unknown): string | null {
  const maxValues = 100_000;
  const maxDepth = 256;
  const result = inspectJsonTreeSafety(value, {
    maxDocumentValues: maxValues,
    maxDocumentDepth: maxDepth,
  });
  if (result.ok) return null;
  if (result.issue.code === "non_tree_reference") {
    return `${formatRepairPath(result.issue.path)}: repair input must be a JSON tree without cycles or shared object references.`;
  }
  return `${formatRepairPath(result.issue.path)}: repair input exceeds the bounded ${maxValues}-value / ${maxDepth}-depth ingestion guard.`;
}

function formatJsonTreeSafetyIssue(
  issue: JsonTreeSafetyIssue,
  label: string,
): string {
  if (issue.code === "non_tree_reference") {
    return `${label} must form a JSON tree without cycles or shared object references.`;
  }
  const dimension = issue.code === "depth_exceeded" ? "depth" : "value count";
  return `${label} ${dimension} ${issue.actual} exceeds the hard parser-safety ceiling ${issue.limit}.`;
}

function valueAtRepairPath(
  value: unknown,
  path: ReadonlyArray<PropertyKey>,
): unknown {
  let current = value;
  for (const part of path) {
    if (
      (typeof part !== "string" && typeof part !== "number") ||
      typeof current !== "object" ||
      current === null
    ) {
      return undefined;
    }
    current = (current as Record<PropertyKey, unknown>)[part];
  }
  return current;
}

function formatRepairPath(path: ReadonlyArray<string | number>): string {
  return path.length > 0 ? path.join(".") : "scene";
}

function formatSceneIssue(issue: z.ZodIssue): string {
  const keys =
    issue.code === z.ZodIssueCode.unrecognized_keys
      ? ` Unsupported key(s): ${issue.keys.join(", ")}.`
      : "";
  return `${issue.path.join(".") || "scene"}: ${issue.message}${keys}`;
}

function formatSceneIssues(issues: z.ZodIssue[]): string {
  return issues.map(formatSceneIssue).join("\n");
}

/**
 * JSON Schema (draft-07) for the scene document, so editors and agents can
 * validate canonical structure, portable values, and target-specific
 * animation values without executing Zod. Cross-field invariants (unique node
 * ids, asset key = asset.id, node/asset and mask compatibility) remain
 * enforced by parseScene/validateScene.
 */
export function sceneJsonSchema(): Record<string, unknown> {
  return decorateSceneJsonSchema(
    zodToJsonSchema(sceneSchema, {
      name: "DojoVideoEngineScene",
      target: "jsonSchema7",
    }) as Record<string, unknown>,
    animationTargets,
  );
}

/** Structural JSON Schema for legacy v0 ingestion and migration tooling. */
export function legacySceneV0JsonSchema(): Record<string, unknown> {
  return zodToJsonSchema(legacySceneV0Schema, {
    name: "DojoVideoEngineSceneV0",
    target: "jsonSchema7",
  }) as Record<string, unknown>;
}

export {
  applyScenePatch,
  closestIds,
  sceneOpSchema,
  scenePatchSchema,
  type ApplyScenePatchResult,
  type SceneOp,
  type ScenePatch,
  type ScenePatchError,
} from "./patch";

export {
  inspectScene,
  lintScene,
  type SceneInspection,
  type SceneLintIssue,
  type SceneLintResult,
} from "./inspect";

export {
  defaultSceneComplexityLimits,
  preflightScene,
  type SceneComplexityIssue,
  type SceneComplexityIssueCode,
  type SceneComplexityLimits,
  type SceneComplexityPreflightResult,
  type SceneComplexityUsage,
} from "./preflight";

export {
  dojoVideoEngineJsonSchemaFormatNames,
  dojoVideoEngineJsonSchemaFormats,
  registerDojoVideoEngineJsonSchemaFormats,
  type JsonSchemaFormatRegistrar,
  type DojoVideoEngineJsonSchemaFormatName,
  type DojoVideoEngineJsonSchemaFormatPredicate,
} from "./json-schema";

export * from "./values";
