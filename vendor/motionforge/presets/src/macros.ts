import { z } from "zod/v3";
import {
  canonicalEffectParamKeys,
  effectParamAliases,
  normalizeEffectParamValue,
} from "./effect-params";
import {
  closestIds,
  effectNames,
  styleSchema,
  type SceneAnimation,
  type SceneEffectName,
  type SceneNode,
  type SceneStyle,
} from "@motionforge/schema";
import {
  audioOverlay,
  audioOverlayTemplates,
  captionTemplates,
  fadeUp,
  imageOverlay,
  imageOverlayTemplates,
  isSpacelessScriptText,
  mediaLook,
  mediaLooks,
  mergeAnimationsByProperty,
  popIn,
  slideIn,
  styledCaptions,
  subtitleTrack,
  textOverlay,
  textOverlayTemplates,
  transitionOverlay,
  transitionTemplates,
  videoOverlay,
  videoOverlayTemplates,
  type AudioOverlayTemplateKey,
  type CaptionTemplateKey,
  type ImageOverlayPlacement,
  type ImageOverlayTemplateKey,
  type MediaLookKey,
  type SubtitleSegment,
  type TextOverlaySlot,
  type TextOverlayTemplateKey,
  type TransitionTemplateKey,
  type VideoOverlayTemplateKey,
} from "./index";
import {
  placeIntentSchema,
  resolveMediaIntents,
  resolvePlaceIntent,
  applyTextRole,
  textRoles,
  type TextRole,
} from "./intents";

/**
 * Macro nodes: the JSON-facing surface of the preset library.
 *
 * Agents emit `{"macro":"textOverlay","template":"lowerThird",...}` instead of
 * hand-building the div/text/keyframe tree, and expansion runs the same preset
 * functions humans call from TypeScript. This keeps model output small and
 * moves layout/spatial math (safe areas, font scales, stagger frames) out of
 * inference and into deterministic code. Expansion happens before scene
 * validation and produces plain scene nodes — the schema and renderer never
 * see a macro.
 *
 * Design rules for macros (hold these when adding new ones):
 * - Params are validated with a lenient zod schema (`.strip`, not `.strict`):
 *   unknown keys are dropped, not fatal. The async generation path has no model
 *   repair retry, so a single decorated key must never sink a whole render.
 *   Real misuse still surfaces via required-field errors and expansion
 *   diagnostics; `normalizeMacroEnvelope` lifts/drops the node-shaped keys
 *   (`style`, `animations`, `children`, ...) models habitually add.
 * - Expansion is pure and total: valid params always produce a valid node.
 * - Generated ids are unique against the scene and the rest of the input.
 * - Prefer forgiving inputs (string numbers, floats for frames) over strict
 *   ones; the caller is a language model.
 */

export type MacroTranscriptWord = {
  text: string;
  /** Source-media milliseconds. */
  startMs: number;
  endMs: number;
};

export type MacroContext = {
  width: number;
  height: number;
  fps: number;
  /** Scene duration in frames. */
  duration: number;
  /** Node ids already used by the scene (and prior expansions). */
  existingIds?: Iterable<string>;
  /**
   * Scene assets keyed by id, for reference checks. Omit to skip asset
   * validation (e.g. when assets are registered later in the same patch).
   */
  assets?: Record<string, { type: string }>;
  /**
   * ASR transcripts keyed by asset id, for the captions macro. Word times are
   * source-media milliseconds. Omit when the host has no transcript store.
   */
  transcripts?: Record<string, { words: MacroTranscriptWord[] }>;
};

type MacroRuntime = {
  ctx: MacroContext;
  uniqueId: (preferred: string) => string;
  diagnostics: string[];
};

export type MacroDefinition<P = unknown> = {
  name: string;
  description: string;
  /** One-line JSON example, used in error messages and prompt docs. */
  usage: string;
  /** Input stays unknown so schemas may use defaults, pipes, and refines. */
  params: z.ZodType<P, z.ZodTypeDef, unknown>;
  expand: (params: P, runtime: MacroRuntime) => SceneNode;
};

// ---------------------------------------------------------------------------
// Forgiving primitives: accept "30", 30.4, etc. — the caller is an LLM.

const looseNumber = z.preprocess(
  (value) =>
    typeof value === "string" && value.trim() !== "" ? Number(value) : value,
  z.number().finite(),
);

const frameCount = looseNumber
  .transform((value) => Math.round(value))
  .pipe(z.number().int().min(1));

const framePosition = looseNumber
  .transform((value) => Math.round(value))
  .pipe(z.number().int().min(0));

const slotText = z.string().trim().min(1).max(400);

const optionalSlotText = z.preprocess(
  (value) =>
    typeof value === "string" && value.trim() === "" ? undefined : value,
  z.string().trim().min(1).max(400).optional(),
);

const optionalNonEmptyString = z.preprocess(
  (value) =>
    typeof value === "string" && value.trim() === "" ? undefined : value,
  z.string().trim().min(1).optional(),
);

function keysEnum<T extends Record<string, unknown>>(record: T) {
  return z.enum(Object.keys(record) as [string, ...string[]]);
}

// Style-ish caption params are lenient (.strip, not .strict): models decorate
// with plausible-but-unsupported keys (area.anchor, style.textAlign,
// highlightStyle.textStroke), and the async generation path has no repair
// retry — dropping an unknown decoration beats failing the whole patch.
// Top-level macro params stay strict so real misuse still errors loudly.
const captionAreaParams = z
  .object({
    top: z.union([looseNumber, z.string().trim().min(1)]).optional(),
    height: z.union([looseNumber, z.string().trim().min(1)]).optional(),
  })
  .strip();

const captionStyleParams = z
  .object({
    fontFamily: z.string().trim().min(1).max(160).optional(),
    fontSize: looseNumber.pipe(z.number().positive()).optional(),
    fontWeight: z.union([looseNumber, z.string().trim().min(1)]).optional(),
    fontStyle: z.enum(["normal", "italic"]).optional(),
    color: z.string().trim().min(1).max(80).optional(),
    highlightColor: z.string().trim().min(1).max(80).optional(),
    lineHeight: z.union([looseNumber, z.string().trim().min(1)]).optional(),
    letterSpacing: z.union([looseNumber, z.string().trim().min(1)]).optional(),
    textShadow: z.string().trim().min(1).max(240).optional(),
    textStroke: z.string().trim().min(1).max(160).optional(),
    textBackgroundColor: z.string().trim().min(1).max(80).optional(),
    textBackgroundPaddingX: looseNumber.pipe(z.number().min(0)).optional(),
    textBackgroundPaddingY: looseNumber.pipe(z.number().min(0)).optional(),
    textBackgroundRadius: looseNumber.pipe(z.number().min(0)).optional(),
  })
  .strip();

const captionHighlightStyleParams = z
  .object({
    color: z.string().trim().min(1).max(80).optional(),
    highlightColor: z.string().trim().min(1).max(80).optional(),
    backgroundColor: z.string().trim().min(1).max(80).optional(),
    fontWeight: z.union([looseNumber, z.string().trim().min(1)]).optional(),
    scale: looseNumber.pipe(z.number().positive()).optional(),
    textShadow: z.string().trim().min(1).max(240).optional(),
    textBackgroundPaddingX: looseNumber.pipe(z.number().min(0)).optional(),
    textBackgroundPaddingY: looseNumber.pipe(z.number().min(0)).optional(),
    textBackgroundRadius: looseNumber.pipe(z.number().min(0)).optional(),
  })
  .strip()
  // "highlightColor" is an LLM-favored synonym inside highlightStyle; fold it
  // into "color" without ever emitting an explicit undefined — spreads copy
  // undefined values and would erase the template's default highlight color.
  .transform(({ highlightColor, color, ...style }) => {
    const resolvedColor = color ?? highlightColor;

    return {
      ...style,
      ...(resolvedColor !== undefined ? { color: resolvedColor } : {}),
    };
  });

// ---------------------------------------------------------------------------
// Registry

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- type-erased store; registerMacro keeps the per-macro typing.
const registry = new Map<string, MacroDefinition<any>>();

export function registerMacro<P>(definition: MacroDefinition<P>): void {
  if (registry.has(definition.name)) {
    throw new Error(
      `Macro "${definition.name}" is already registered. Macro names must be unique.`,
    );
  }

  registry.set(definition.name, definition);
}

export function macroNames(): string[] {
  return Array.from(registry.keys());
}

/**
 * Read-only discovery metadata for a registered macro.
 *
 * The expansion callback is deliberately omitted: consumers that only need to
 * build documentation, manifests, or JSON Schema should not receive a handle
 * to the mutable registry or to its execution surface.
 */
export type MacroDocumentationDefinition = Readonly<{
  name: string;
  description: string;
  usage: string;
  params: z.ZodTypeAny;
}>;

/**
 * Returns fresh, frozen documentation records without exposing the registry.
 * Zod schemas are immutable builder values and are safe to share for
 * validation/schema conversion.
 */
export function macroDefinitions(): readonly MacroDocumentationDefinition[] {
  return Object.freeze(
    Array.from(registry.values(), ({ name, description, usage, params }) =>
      Object.freeze({ name, description, usage, params }),
    ),
  );
}

/** Compact per-macro documentation lines for agent system prompts. */
export function macroPromptGuide(): string {
  return Array.from(registry.values())
    .map(
      (entry) =>
        `- ${entry.name}: ${entry.description} Example: ${entry.usage}`,
    )
    .join("\n");
}

export function isMacroNode(input: unknown): input is Record<string, unknown> {
  return isRecord(input) && typeof input.macro === "string";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

// ---------------------------------------------------------------------------
// Shared helpers

function requireAsset(
  runtime: MacroRuntime,
  assetId: string,
  expectedType: "image" | "video" | "audio" | "lottie",
  macroName: string,
): string | null {
  const assets = runtime.ctx.assets;

  if (!assets) {
    return null;
  }

  const asset = assets[assetId];

  if (!asset) {
    const available = Object.entries(assets)
      .filter(([, entry]) => entry.type === expectedType)
      .map(([id]) => `"${id}"`);
    return `macro "${macroName}": assetId "${assetId}" is not in scene.assets. ${
      available.length > 0
        ? `Available ${expectedType} assets: ${available.join(", ")}.`
        : `The scene has no ${expectedType} assets; emit a setAsset op first (or add the asset to scene.assets).`
    }`;
  }

  if (asset.type !== expectedType) {
    return `macro "${macroName}": asset "${assetId}" is a ${asset.type} asset, but this macro needs a ${expectedType} asset.`;
  }

  return null;
}

function noteWindowPastScene(
  runtime: MacroRuntime,
  macroName: string,
  from: number,
  duration: number,
): void {
  const end = from + duration;

  if (from >= runtime.ctx.duration) {
    runtime.diagnostics.push(
      `macro "${macroName}" starts at frame ${from}, but the scene ends at frame ${runtime.ctx.duration}; it will not be visible unless the scene duration grows (setSceneMeta).`,
    );
  } else if (end > runtime.ctx.duration) {
    runtime.diagnostics.push(
      `macro "${macroName}" runs to frame ${end}, past the scene's ${runtime.ctx.duration} frames; the tail is trimmed at render time.`,
    );
  }
}

// ---------------------------------------------------------------------------
// Motion params shared by visual macros

export const macroEnterNames = [
  "fadeIn",
  "fadeUp",
  "popIn",
  "slideInLeft",
  "slideInRight",
  "slideInUp",
  "slideInDown",
  "none",
] as const;

export const macroExitNames = ["fadeOut", "popOut", "none"] as const;

const motionParams = {
  enter: z.enum(macroEnterNames).optional(),
  enterDelay: framePosition.optional(),
  enterDuration: frameCount.optional(),
  exit: z.enum(macroExitNames).optional(),
  exitDuration: frameCount.optional(),
};

type MotionParams = {
  enter?: (typeof macroEnterNames)[number];
  enterDelay?: number;
  enterDuration?: number;
  exit?: (typeof macroExitNames)[number];
  exitDuration?: number;
};

const motionDoc =
  "Motion: enter (fadeIn, fadeUp, popIn, slideInLeft/Right/Up/Down, none) with enterDelay/enterDuration frames; exit (fadeOut, popOut, none) with exitDuration.";

/**
 * `undefined` keeps the template's default entrance; `false` disables it;
 * an array replaces it. Setting only enterDelay/enterDuration implies the
 * default fadeUp so the timing params never get silently ignored.
 */
function buildEnterAnimations(
  params: MotionParams,
): SceneAnimation[] | false | undefined {
  if (
    params.enter === undefined &&
    params.enterDelay === undefined &&
    params.enterDuration === undefined
  ) {
    return undefined;
  }

  const name = params.enter ?? "fadeUp";

  if (name === "none") {
    return false;
  }

  const options = {
    delay: params.enterDelay ?? 0,
    durationInFrames: params.enterDuration,
  };

  switch (name) {
    case "popIn":
      return popIn(options);
    case "fadeUp":
      return fadeUp(options);
    case "slideInLeft":
      return slideIn("left", options);
    case "slideInRight":
      return slideIn("right", options);
    case "slideInUp":
      return slideIn("up", options);
    case "slideInDown":
      return slideIn("down", options);
    case "fadeIn": {
      const duration = params.enterDuration ?? 12;
      const delay = params.enterDelay ?? 0;
      const frames: SceneAnimation["frames"] =
        delay > 0
          ? [
              { frame: 0, value: 0 },
              { frame: delay, value: 0 },
              { frame: delay + duration, value: 1, easing: "easeOut" },
            ]
          : [
              { frame: 0, value: 0 },
              { frame: duration, value: 1, easing: "easeOut" },
            ];

      return [{ kind: "keyframes", property: "opacity", frames }];
    }
  }
}

/** Exit tracks anchored to the node's final frames (window known here). */
function buildExitAnimations(
  params: MotionParams,
  nodeDuration: number,
): SceneAnimation[] {
  const exit = params.exit ?? "none";

  if (exit === "none" || nodeDuration < 3) {
    return [];
  }

  const end = nodeDuration - 1;
  const length = Math.min(params.exitDuration ?? 12, end - 1);
  const start = Math.max(1, end - length);
  const opacity: SceneAnimation = {
    kind: "keyframes",
    property: "opacity",
    frames: [
      { frame: 0, value: 1 },
      { frame: start, value: 1 },
      { frame: end, value: 0, easing: "easeIn" },
    ],
  };

  if (exit === "fadeOut") {
    return [opacity];
  }

  return [
    opacity,
    {
      kind: "keyframes",
      property: "transform",
      frames: [
        { frame: 0, value: "scale(1)" },
        { frame: start, value: "scale(1)" },
        { frame: end, value: "scale(0.85)", easing: "easeIn" },
      ],
    },
  ];
}

/**
 * Appends exit tracks and collapses same-property tracks (enter + exit both
 * animate opacity) into single merged tracks the evaluator renders correctly.
 */
function withExitMotion(
  node: SceneNode,
  params: MotionParams,
  nodeDuration: number,
): SceneNode {
  const exit = buildExitAnimations(params, nodeDuration);
  const animations = [...(node.animations ?? []), ...exit];

  if (animations.length === 0) {
    return node;
  }

  return { ...node, animations: mergeAnimationsByProperty(animations) };
}

const mediaPlacements = [
  "center",
  "top",
  "bottom",
  "topLeft",
  "topRight",
  "bottomLeft",
  "bottomRight",
] as const satisfies readonly ImageOverlayPlacement[];

const mediaDoc = `Optional placement (${mediaPlacements.join(", ")}) overrides the template position; optional look (${Object.keys(mediaLooks).join(", ")}) applies a filter treatment.`;

// ---------------------------------------------------------------------------
// Built-in macros

const effectColor = z.string().trim().min(1).max(80);
const effectNameSchema = z.enum(effectNames);

const effectPlacementParams = {
  left: z.union([looseNumber, z.string().trim().min(1)]).optional(),
  top: z.union([looseNumber, z.string().trim().min(1)]).optional(),
  width: z.union([looseNumber, z.string().trim().min(1)]).optional(),
  height: z.union([looseNumber, z.string().trim().min(1)]).optional(),
};

const commonEffectParams = {
  intensity: z.enum(["low", "medium", "high"]).optional(),
  seed: looseNumber
    .transform((value) => Math.round(Math.max(0, value)))
    .pipe(z.number().int().nonnegative())
    .optional(),
  colors: z.array(effectColor).min(1).max(8).optional(),
  particleCount: looseNumber
    .transform((value) => Math.round(value))
    .pipe(z.number().int().min(1).max(240))
    .optional(),
  shockwave: z.boolean().optional(),
  emoji: optionalNonEmptyString.pipe(z.string().max(12).optional()),
  direction: z
    .enum(["left", "right", "up", "down", "in", "out", "diagonal"])
    .optional(),
  density: z.enum(["low", "medium", "high"]).optional(),
  loops: looseNumber
    .transform((value) => Math.round(value))
    .pipe(z.number().int().min(1).max(8))
    .optional(),
  strokeWidth: looseNumber.pipe(z.number().min(1).max(80)).optional(),
  radius: looseNumber.pipe(z.number().positive()).optional(),
  wobble: looseNumber.pipe(z.number().min(0).max(1)).optional(),
  pulse: looseNumber.pipe(z.number().min(0).max(1)).optional(),
  scale: looseNumber.pipe(z.number().min(0.1).max(4)).optional(),
  spread: looseNumber.pipe(z.number().min(0).max(1)).optional(),
  softness: looseNumber.pipe(z.number().min(0).max(1)).optional(),
  glow: looseNumber.pipe(z.number().min(0).max(1)).optional(),
  scope: z.enum(["text", "frame"]).optional(),
};

type CommonEffectParams = z.infer<typeof commonEffectParamsSchema>;

const commonEffectParamsSchema = z.object(commonEffectParams).strip();

function effectNodeParams(params: CommonEffectParams) {
  return {
    ...(params.intensity ? { intensity: params.intensity } : {}),
    ...(params.seed !== undefined ? { seed: params.seed } : {}),
    ...(params.colors ? { colors: params.colors } : {}),
    ...(params.particleCount ? { particleCount: params.particleCount } : {}),
    ...(params.shockwave !== undefined ? { shockwave: params.shockwave } : {}),
    ...(params.emoji ? { emoji: params.emoji } : {}),
    ...(params.direction ? { direction: params.direction } : {}),
    ...(params.density ? { density: params.density } : {}),
    ...(params.loops !== undefined ? { loops: params.loops } : {}),
    ...(params.strokeWidth !== undefined
      ? { strokeWidth: params.strokeWidth }
      : {}),
    ...(params.radius !== undefined ? { radius: params.radius } : {}),
    ...(params.wobble !== undefined ? { wobble: params.wobble } : {}),
    ...(params.pulse !== undefined ? { pulse: params.pulse } : {}),
    ...(params.scale !== undefined ? { scale: params.scale } : {}),
    ...(params.spread !== undefined ? { spread: params.spread } : {}),
    ...(params.softness !== undefined ? { softness: params.softness } : {}),
    ...(params.glow !== undefined ? { glow: params.glow } : {}),
    ...(params.scope !== undefined ? { scope: params.scope } : {}),
  };
}

function defaultEffectBox(
  runtime: MacroRuntime,
  params: {
    effect: SceneEffectName;
    left?: string | number;
    top?: string | number;
    width?: string | number;
    height?: string | number;
  },
) {
  const effect = params.effect;
  const fullFrame = effect === "speedLines";
  const widthRatio =
    effect === "neonAura" || effect === "scribbleCircle"
      ? 0.7
      : effect === "cloudPop"
        ? 0.62
        : 0.58;
  const heightRatio =
    effect === "neonAura" || effect === "scribbleCircle"
      ? 0.42
      : effect === "cloudPop"
        ? 0.34
        : 0.3;
  const width =
    params.width ??
    (fullFrame
      ? runtime.ctx.width
      : Math.round(runtime.ctx.width * widthRatio));
  const height =
    params.height ??
    (fullFrame
      ? runtime.ctx.height
      : Math.round(runtime.ctx.height * heightRatio));
  const widthForDefaultLeft =
    typeof width === "number"
      ? width
      : fullFrame
        ? runtime.ctx.width
        : runtime.ctx.width * widthRatio;
  const heightForDefaultTop =
    typeof height === "number"
      ? height
      : fullFrame
        ? runtime.ctx.height
        : runtime.ctx.height * heightRatio;

  return {
    left:
      params.left ??
      (fullFrame
        ? 0
        : Math.round((runtime.ctx.width - widthForDefaultLeft) / 2)),
    top:
      params.top ??
      (fullFrame
        ? 0
        : Math.round((runtime.ctx.height - heightForDefaultTop) / 2)),
    width,
    height,
  };
}

function buildEffectNode(
  runtime: MacroRuntime,
  params: CommonEffectParams & {
    id?: string;
    effect: SceneEffectName;
    from?: number;
    duration?: number;
    left?: string | number;
    top?: string | number;
    width?: string | number;
    height?: string | number;
    zIndex?: number;
  },
): SceneNode {
  const from = params.from ?? 0;
  const duration =
    params.duration ?? Math.max(1, Math.min(42, runtime.ctx.duration - from));
  noteWindowPastScene(runtime, params.effect, from, duration);
  const box = defaultEffectBox(runtime, params);

  return {
    id: runtime.uniqueId(params.id ?? `${params.effect}-effect`),
    type: "effect",
    effect: params.effect,
    from,
    duration,
    style: {
      position: "absolute",
      ...box,
      zIndex: params.zIndex ?? 40,
    },
    params: effectNodeParams(params),
  };
}

const effectOverlayParams = z
  .object({
    effect: effectNameSchema.default("cartoonBurst"),
    id: z.string().trim().min(1).optional(),
    from: framePosition.optional(),
    duration: frameCount.optional(),
    ...effectPlacementParams,
    ...commonEffectParams,
    ...motionParams,
  })
  .strip();

registerMacro<z.infer<typeof effectOverlayParams>>({
  name: "effectOverlay",
  description:
    "Categorized standalone effect layer. Presets: impact/cartoonBurst, celebration/confettiBurst, text-atmosphere/cloudPop, comic/speedLines, glow/neonAura, annotation/scribbleCircle. Produces one selectable effect node.",
  usage:
    '{"macro":"effectOverlay","effect":"confettiBurst","from":60,"duration":45,"intensity":"high","colors":["#facc15","#38bdf8","#fb7185"]}',
  params: effectOverlayParams,
  expand: (params, runtime) => {
    const node = buildEffectNode(runtime, {
      ...params,
      effect: params.effect as SceneEffectName,
    });

    return withExitMotion(node, params, node.duration ?? 1);
  },
});

const cartoonBurstParams = z
  .object({
    id: z.string().trim().min(1).optional(),
    from: framePosition.optional(),
    duration: frameCount.optional(),
    ...effectPlacementParams,
    ...commonEffectParams,
    ...motionParams,
  })
  .strip();

registerMacro<z.infer<typeof cartoonBurstParams>>({
  name: "cartoonBurst",
  description:
    "Procedural effect layer for explosions, impact pops, spark bursts, emoji hits, and comic energy. The result is a selectable effect node with normal from/duration/style bounds.",
  usage:
    '{"macro":"cartoonBurst","from":24,"duration":30,"left":240,"top":620,"width":600,"height":420,"intensity":"high","emoji":"!"}',
  params: cartoonBurstParams,
  expand: (params, runtime) => {
    const node = buildEffectNode(runtime, {
      ...params,
      effect: "cartoonBurst",
    });

    return withExitMotion(node, params, node.duration ?? 1);
  },
});

const textEffectTemplates = [
  "cloudPop",
  "neonAura",
  "scribbleCircle",
  "speedLines",
  "stickerBurst",
] as const;
const textEffectAccentTemplates = [
  "neonAura",
  "speedLines",
  "scribbleCircle",
  "cloudPop",
  "stickerBurst",
] as const;

const textEffectToEffect = {
  cloudPop: "cloudPop",
  neonAura: "neonAura",
  scribbleCircle: "scribbleCircle",
  speedLines: "speedLines",
  stickerBurst: "cartoonBurst",
} as const satisfies Record<
  (typeof textEffectTemplates)[number],
  SceneEffectName
>;

const textEffectParams = z
  .object({
    template: z.enum(textEffectTemplates).default("cloudPop"),
    accents: z.array(z.enum(textEffectAccentTemplates)).max(4).optional(),
    id: z.string().trim().min(1).optional(),
    text: slotText,
    from: framePosition.optional(),
    duration: frameCount.optional(),
    left: z.union([looseNumber, z.string().trim().min(1)]).optional(),
    top: z.union([looseNumber, z.string().trim().min(1)]).optional(),
    width: z.union([looseNumber, z.string().trim().min(1)]).optional(),
    height: z.union([looseNumber, z.string().trim().min(1)]).optional(),
    fontSize: looseNumber.pipe(z.number().positive()).optional(),
    color: z.string().trim().min(1).max(80).optional(),
    fontFamily: z.string().trim().min(1).max(160).optional(),
    fontWeight: z.union([looseNumber, z.string().trim().min(1)]).optional(),
    textStroke: z.string().trim().min(1).max(160).optional(),
    textShadow: z.string().trim().min(1).max(240).optional(),
    ...commonEffectParams,
    ...motionParams,
  })
  .strip();

registerMacro<z.infer<typeof textEffectParams>>({
  name: "textEffect",
  description:
    "Editable headline text with one surrounding procedural effect. Templates: cloudPop, neonAura, scribbleCircle, speedLines, stickerBurst. Use for text surrounded by clouds, cartoon aura, speed lines, hand-drawn circles, or sticker-style impact.",
  usage:
    '{"macro":"textEffect","template":"cloudPop","text":"WOW","from":30,"duration":60,"intensity":"high","colors":["#ffffff","#bae6fd"]}',
  params: textEffectParams,
  expand: (params, runtime) => {
    const from = params.from ?? 0;
    const duration =
      params.duration ?? Math.max(1, Math.min(72, runtime.ctx.duration - from));
    noteWindowPastScene(runtime, "textEffect", from, duration);
    const id = runtime.uniqueId(params.id ?? `${params.template}-text`);
    const width = params.width ?? Math.round(runtime.ctx.width * 0.78);
    const height = params.height ?? Math.round(runtime.ctx.height * 0.26);
    const widthForDefaultLeft =
      typeof width === "number" ? width : runtime.ctx.width * 0.78;
    const heightForDefaultTop =
      typeof height === "number" ? height : runtime.ctx.height * 0.26;
    const left =
      params.left ?? Math.round((runtime.ctx.width - widthForDefaultLeft) / 2);
    const top =
      params.top ?? Math.round((runtime.ctx.height - heightForDefaultTop) / 2);
    const shortSide = Math.min(runtime.ctx.width, runtime.ctx.height);
    const effect = textEffectToEffect[params.template];
    const accentEffects = Array.from(
      new Set(
        (params.accents ?? [])
          .map((accent) => textEffectToEffect[accent])
          .filter((accent) => accent !== effect),
      ),
    );
    const textEffectNode = (
      effectName: SceneEffectName,
      index: number,
      overrides: Partial<CommonEffectParams> = {},
    ): SceneNode => ({
      id: index === 0 ? `${id}-effect` : `${id}-${effectName}`,
      type: "effect",
      effect: effectName,
      duration,
      style: {
        position: "absolute",
        inset: 0,
        zIndex: index,
      },
      params: effectNodeParams({
        ...params,
        ...overrides,
        scope: "text",
        intensity:
          overrides.intensity ??
          params.intensity ??
          (params.template === "stickerBurst" ? "high" : "medium"),
        shockwave:
          overrides.shockwave ??
          params.shockwave ??
          (params.template === "stickerBurst" ? true : undefined),
        emoji:
          overrides.emoji ??
          params.emoji ??
          (params.template === "stickerBurst" ? "!" : undefined),
      }),
    });
    const group: SceneNode = {
      id,
      type: "div",
      from,
      duration,
      style: {
        position: "absolute",
        left,
        top,
        width,
        height,
        overflow: "visible",
        zIndex: 45,
      },
      children: [
        textEffectNode(effect, 0),
        ...accentEffects.map((accent, index) =>
          textEffectNode(accent, index + 1, {
            intensity: accent === "speedLines" ? "medium" : params.intensity,
            spread:
              accent === "speedLines" ? (params.spread ?? 0.45) : params.spread,
            glow: accent === "neonAura" ? (params.glow ?? 0.6) : params.glow,
            softness:
              accent === "cloudPop"
                ? (params.softness ?? 0.65)
                : params.softness,
          }),
        ),
        {
          id: `${id}-text`,
          type: "text",
          text: params.text,
          duration,
          style: {
            position: "absolute",
            inset: 0,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            textAlign: "center",
            color: params.color ?? "#ffffff",
            fontFamily: params.fontFamily ?? "system-ui, sans-serif",
            fontSize: params.fontSize ?? Math.round(shortSide * 0.14),
            fontWeight: params.fontWeight ?? 900,
            lineHeight: 0.95,
            textFit: "shrink",
            minFontSize: 36,
            textStroke:
              params.textStroke ??
              (params.template === "cloudPop"
                ? "10px rgba(15, 23, 42, 0.35)"
                : "8px rgba(15, 23, 42, 0.55)"),
            textShadow:
              params.textShadow ?? "0 18px 48px rgba(15, 23, 42, 0.35)",
            zIndex: 1,
          },
          animations: popIn({
            durationInFrames: Math.min(
              14,
              Math.max(6, Math.floor(duration / 3)),
            ),
          }),
        },
      ],
    };

    return withExitMotion(group, params, duration);
  },
});

/** Expand another registered macro from inside an expand fn (designed
 * wrapper macros build on workhorse macros instead of duplicating layout). */
function expandRegisteredMacro(
  name: string,
  input: unknown,
  runtime: MacroRuntime,
): SceneNode {
  const definition = registry.get(name);
  if (!definition) {
    throw new Error(`Macro "${name}" is not registered.`);
  }
  return definition.expand(definition.params.parse(input), runtime);
}

const graphicPalettes = {
  slate: {
    background: "#0f172a",
    panel: "rgba(15, 23, 42, 0.82)",
    text: "#f8fafc",
    muted: "#cbd5e1",
    accent: "#38bdf8",
    accent2: "#f59e0b",
  },
  sunrise: {
    background: "#311827",
    panel: "rgba(127, 29, 29, 0.78)",
    text: "#fff7ed",
    muted: "#fed7aa",
    accent: "#fb7185",
    accent2: "#facc15",
  },
  mint: {
    background: "#052e2b",
    panel: "rgba(6, 78, 59, 0.78)",
    text: "#ecfdf5",
    muted: "#a7f3d0",
    accent: "#2dd4bf",
    accent2: "#bef264",
  },
  ink: {
    background: "#111827",
    panel: "rgba(17, 24, 39, 0.88)",
    text: "#f9fafb",
    muted: "#d1d5db",
    accent: "#ffffff",
    accent2: "#9ca3af",
  },
  berry: {
    background: "#2e1065",
    panel: "rgba(88, 28, 135, 0.78)",
    text: "#faf5ff",
    muted: "#e9d5ff",
    accent: "#c084fc",
    accent2: "#fb7185",
  },
} as const;

type GraphicPaletteKey = keyof typeof graphicPalettes;

const graphicPaletteSchema = keysEnum(graphicPalettes).default("slate");
const graphicTempos = ["calm", "standard", "energetic"] as const;
const graphicTempoSchema = z.enum(graphicTempos).default("standard");

function graphicPalette(params: {
  palette?: string;
  accentColor?: string;
  colors?: string[];
}) {
  const base =
    graphicPalettes[(params.palette ?? "slate") as GraphicPaletteKey] ??
    graphicPalettes.slate;

  return {
    ...base,
    accent: params.accentColor ?? params.colors?.[0] ?? base.accent,
    accent2: params.colors?.[1] ?? base.accent2,
    text: params.colors?.[2] ?? base.text,
  };
}

function defaultGraphicDuration(params: {
  runtime: MacroRuntime;
  from: number;
  seconds: number;
}) {
  return Math.max(
    1,
    Math.min(
      Math.round(Math.max(1, params.runtime.ctx.fps) * params.seconds),
      params.runtime.ctx.duration - params.from,
    ),
  );
}

function tempoEnterDuration(
  tempo: (typeof graphicTempos)[number],
  frames: { calm: number; standard: number; energetic: number },
) {
  return tempo === "calm"
    ? frames.calm
    : tempo === "energetic"
      ? frames.energetic
      : frames.standard;
}

const lowerThirdLooks = ["glass", "solid", "minimal"] as const;

const lowerThirdParams = z
  .object({
    id: z.string().trim().min(1).optional(),
    title: slotText,
    subtitle: optionalSlotText,
    kicker: optionalSlotText,
    from: framePosition.optional(),
    duration: frameCount.optional(),
    palette: graphicPaletteSchema,
    accentColor: z.string().trim().min(1).max(80).optional(),
    colors: z.array(z.string().trim().min(1)).min(1).max(4).optional(),
    look: z.enum(lowerThirdLooks).default("glass"),
    tempo: graphicTempoSchema,
    align: z.enum(["left", "right"]).default("left"),
    exit: z.enum(macroExitNames).optional(),
    exitDuration: frameCount.optional(),
  })
  .strip();

registerMacro<z.infer<typeof lowerThirdParams>>({
  name: "lowerThird",
  description:
    "Designed speaker/subject lower-third. Params: title, optional subtitle/kicker, palette slate|sunrise|mint|ink|berry, look glass|solid|minimal, align left|right, tempo calm|standard|energetic. Use for names, roles, guests, places, and labels.",
  usage:
    '{"macro":"lowerThird","title":"Ada Lovelace","subtitle":"Analyst","kicker":"Interview","from":30,"duration":120,"palette":"slate"}',
  params: lowerThirdParams,
  expand: (params, runtime) => {
    const from = params.from ?? 0;
    const duration =
      params.duration ?? defaultGraphicDuration({ runtime, from, seconds: 4 });
    noteWindowPastScene(runtime, "lowerThird", from, duration);
    const palette = graphicPalette(params);
    const baseStyle =
      params.look === "minimal"
        ? {
            backgroundColor: "rgba(15,23,42,0.1)",
            border: `0px solid ${palette.accent}`,
            boxShadow: "none",
          }
        : params.look === "solid"
          ? {
              backgroundColor: palette.panel,
              border: `3px solid ${palette.accent}`,
              boxShadow: "0px 18px 52px rgba(0,0,0,0.34)",
            }
          : {
              backgroundColor: palette.panel,
              border: `2px solid ${palette.accent}`,
              boxShadow: "0px 18px 48px rgba(0,0,0,0.32)",
            };

    return expandRegisteredMacro(
      "textOverlay",
      {
        template: "lowerThird",
        id: params.id ?? "lower-third",
        title: params.title,
        subtitle: params.subtitle,
        kicker: params.kicker,
        accentColor: palette.accent,
        from,
        duration,
        enter: params.align === "right" ? "slideInRight" : "slideInLeft",
        enterDuration: tempoEnterDuration(params.tempo, {
          calm: 18,
          standard: 12,
          energetic: 8,
        }),
        exit: params.exit ?? "fadeOut",
        exitDuration:
          params.exitDuration ?? Math.min(10, Math.max(1, duration - 1)),
        style: {
          ...baseStyle,
          ...(params.align === "right"
            ? {
                left: Math.round(runtime.ctx.width * 0.18),
                width: Math.round(runtime.ctx.width * 0.76),
              }
            : {}),
        },
        titleStyle: { color: palette.text },
        subtitleStyle: { color: palette.muted },
        kickerStyle: { color: palette.accent },
      },
      runtime,
    );
  },
});

const titleCardLooks = ["editorial", "bold", "minimal"] as const;

const titleCardParams = z
  .object({
    id: z.string().trim().min(1).optional(),
    title: slotText,
    subtitle: optionalSlotText,
    kicker: optionalSlotText,
    from: framePosition.optional(),
    duration: frameCount.optional(),
    palette: graphicPaletteSchema,
    accentColor: z.string().trim().min(1).max(80).optional(),
    colors: z.array(z.string().trim().min(1)).min(1).max(4).optional(),
    look: z.enum(titleCardLooks).default("editorial"),
    tempo: graphicTempoSchema,
    exit: z.enum(macroExitNames).optional(),
    exitDuration: frameCount.optional(),
  })
  .strip();

registerMacro<z.infer<typeof titleCardParams>>({
  name: "titleCard",
  description:
    "Designed opening or section title card. Params: title, optional subtitle/kicker, palette slate|sunrise|mint|ink|berry, look editorial|bold|minimal, tempo calm|standard|energetic.",
  usage:
    '{"macro":"titleCard","title":"The Launch","subtitle":"Week one recap","from":0,"duration":120,"palette":"sunrise","look":"bold"}',
  params: titleCardParams,
  expand: (params, runtime) => {
    const from = params.from ?? 0;
    const duration =
      params.duration ?? defaultGraphicDuration({ runtime, from, seconds: 4 });
    noteWindowPastScene(runtime, "titleCard", from, duration);
    const palette = graphicPalette(params);
    const bold = params.look === "bold";
    const minimal = params.look === "minimal";

    return expandRegisteredMacro(
      "textOverlay",
      {
        template: "titleCard",
        id: params.id ?? "title-card",
        title: params.title,
        subtitle: params.subtitle,
        kicker: params.kicker,
        accentColor: palette.accent,
        from,
        duration,
        enter: bold ? "popIn" : "fadeUp",
        enterDuration: tempoEnterDuration(params.tempo, {
          calm: 20,
          standard: 14,
          energetic: 9,
        }),
        exit: params.exit ?? "fadeOut",
        exitDuration:
          params.exitDuration ?? Math.min(12, Math.max(1, duration - 1)),
        style: {
          backgroundColor: minimal ? "rgba(0,0,0,0)" : palette.panel,
          borderRadius: minimal ? 0 : 28,
          border: minimal
            ? "0px solid transparent"
            : `2px solid ${palette.accent}`,
          padding: bold ? 48 : 36,
          boxShadow: minimal ? "none" : "0px 24px 72px rgba(0,0,0,0.32)",
        },
        titleStyle: {
          color: palette.text,
          fontSize: bold ? 128 : 108,
          textStroke: bold ? "5px rgba(15,23,42,0.46)" : undefined,
        },
        subtitleStyle: { color: palette.muted },
        kickerStyle: { color: palette.accent },
      },
      runtime,
    );
  },
});

const calloutCorners = [
  "topLeft",
  "topRight",
  "bottomLeft",
  "bottomRight",
] as const;

const calloutArrowParams = z
  .object({
    id: z.string().trim().min(1).optional(),
    text: slotText,
    from: framePosition.optional(),
    duration: frameCount.optional(),
    corner: z.enum(calloutCorners).default("topRight"),
    palette: graphicPaletteSchema,
    accentColor: z.string().trim().min(1).max(80).optional(),
    colors: z.array(z.string().trim().min(1)).min(1).max(4).optional(),
    tempo: graphicTempoSchema,
    exit: z.enum(macroExitNames).optional(),
    exitDuration: frameCount.optional(),
  })
  .strip();

registerMacro<z.infer<typeof calloutArrowParams>>({
  name: "calloutArrow",
  description:
    "Designed annotation label with an arrow line pointing inward from a corner. Params: text, corner topLeft|topRight|bottomLeft|bottomRight, palette, tempo. Use for pointing at a product, UI detail, or visual evidence.",
  usage:
    '{"macro":"calloutArrow","text":"New dashboard","corner":"topRight","from":45,"duration":90,"palette":"mint"}',
  params: calloutArrowParams,
  expand: (params, runtime) => {
    const from = params.from ?? 0;
    const duration =
      params.duration ??
      defaultGraphicDuration({ runtime, from, seconds: 3.5 });
    noteWindowPastScene(runtime, "calloutArrow", from, duration);
    const id = runtime.uniqueId(params.id ?? "callout-arrow");
    const palette = graphicPalette(params);
    const w = Math.round(runtime.ctx.width * 0.42);
    const h = Math.round(runtime.ctx.height * 0.12);
    const marginX = Math.round(runtime.ctx.width * 0.07);
    const marginY = Math.round(runtime.ctx.height * 0.12);
    const right = params.corner.endsWith("Right");
    const bottom = params.corner.startsWith("bottom");
    const lineWidth = Math.round(w * 0.52);
    const lineTop = bottom ? 18 : h - 22;
    const labelLeft = right ? w - Math.round(w * 0.72) : 0;
    const labelTop = bottom ? 48 : 0;
    const group: SceneNode = {
      id,
      type: "div",
      from,
      duration,
      style: {
        position: "absolute",
        left: right ? runtime.ctx.width - marginX - w : marginX,
        top: bottom ? runtime.ctx.height - marginY - h : marginY,
        width: w,
        height: h,
        overflow: "visible",
        zIndex: 48,
      },
      animations:
        buildEnterAnimations({
          enter: "fadeUp",
          enterDuration: tempoEnterDuration(params.tempo, {
            calm: 18,
            standard: 12,
            energetic: 8,
          }),
        }) || [],
      children: [
        {
          id: `${id}-line`,
          type: "div",
          duration,
          style: {
            position: "absolute",
            left: right ? w - lineWidth : 0,
            top: lineTop,
            width: lineWidth,
            height: 5,
            borderRadius: 999,
            backgroundColor: palette.accent,
            transform: `rotate(${right ? -12 : 12}deg)`,
            transformOrigin: right ? "right center" : "left center",
            boxShadow: `0px 0px 22px ${palette.accent}`,
          },
        },
        {
          id: `${id}-head`,
          type: "text",
          text: right ? "<" : ">",
          duration,
          style: {
            position: "absolute",
            left: right ? w - lineWidth - 28 : lineWidth - 6,
            top: lineTop - 28,
            width: 44,
            height: 44,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            color: palette.accent,
            fontSize: 54,
            fontWeight: 900,
            lineHeight: 1,
          },
        },
        {
          id: `${id}-label`,
          type: "text",
          text: params.text,
          duration,
          style: {
            position: "absolute",
            left: labelLeft,
            top: labelTop,
            width: Math.round(w * 0.72),
            minHeight: 72,
            padding: 22,
            borderRadius: 18,
            backgroundColor: palette.panel,
            border: `2px solid ${palette.accent}`,
            boxShadow: "0px 18px 44px rgba(0,0,0,0.3)",
            color: palette.text,
            fontFamily: "Inter, system-ui, Arial, sans-serif",
            fontSize: 38,
            fontWeight: 900,
            lineHeight: 1.05,
            textFit: "shrink",
            minFontSize: 20,
            textAlign: "center",
          },
        },
      ],
    };

    return withExitMotion(
      group,
      {
        exit: params.exit ?? "fadeOut",
        exitDuration:
          params.exitDuration ?? Math.min(10, Math.max(1, duration - 1)),
      },
      duration,
    );
  },
});

const kineticTextLooks = ["wordPop", "stack", "ticker"] as const;

const kineticTextParams = z
  .object({
    id: z.string().trim().min(1).optional(),
    text: slotText,
    from: framePosition.optional(),
    duration: frameCount.optional(),
    palette: graphicPaletteSchema,
    accentColor: z.string().trim().min(1).max(80).optional(),
    colors: z.array(z.string().trim().min(1)).min(1).max(4).optional(),
    look: z.enum(kineticTextLooks).default("wordPop"),
    tempo: graphicTempoSchema,
    exit: z.enum(macroExitNames).optional(),
    exitDuration: frameCount.optional(),
  })
  .strip();

registerMacro<z.infer<typeof kineticTextParams>>({
  name: "kineticText",
  description:
    "Designed animated typography. Params: text, look wordPop|stack|ticker, palette, tempo. Splits the phrase into timed editable text beats with staggered motion.",
  usage:
    '{"macro":"kineticText","text":"SHIP IT TODAY","from":15,"duration":90,"look":"wordPop","palette":"berry","tempo":"energetic"}',
  params: kineticTextParams,
  expand: (params, runtime) => {
    const from = params.from ?? 0;
    const duration =
      params.duration ?? defaultGraphicDuration({ runtime, from, seconds: 3 });
    noteWindowPastScene(runtime, "kineticText", from, duration);
    const id = runtime.uniqueId(params.id ?? "kinetic-text");
    const palette = graphicPalette(params);
    const words = params.text.trim().split(/\s+/).filter(Boolean).slice(0, 10);
    const tokens = words.length > 0 ? words : [params.text.trim()];
    const shortSide = Math.min(runtime.ctx.width, runtime.ctx.height);
    const boxWidth = Math.round(runtime.ctx.width * 0.86);
    const boxHeight =
      params.look === "stack"
        ? Math.round(runtime.ctx.height * 0.34)
        : Math.round(runtime.ctx.height * 0.2);
    const step = Math.max(
      3,
      Math.floor(
        duration / (tokens.length + (params.tempo === "energetic" ? 1 : 2)),
      ),
    );
    const childDuration = Math.max(1, duration);
    const fontSize =
      params.look === "ticker"
        ? Math.round(shortSide * 0.1)
        : Math.round(shortSide * (params.look === "stack" ? 0.11 : 0.13));

    const tokenNode = (word: string, index: number): SceneNode => {
      const offset =
        params.look === "ticker"
          ? index * Math.round(step * 0.75)
          : index * step;
      const stackTop =
        params.look === "stack"
          ? Math.round((boxHeight / tokens.length) * index)
          : 0;
      const stackHeight =
        params.look === "stack"
          ? Math.max(44, Math.round(boxHeight / tokens.length))
          : boxHeight;

      return {
        id: `${id}-w${index + 1}`,
        type: "text",
        text: word,
        duration: childDuration,
        style: {
          position: "absolute",
          left: params.look === "ticker" ? `${index * 9}%` : 0,
          top: stackTop,
          width: params.look === "ticker" ? "44%" : "100%",
          height: stackHeight,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          color: index % 2 === 0 ? palette.text : palette.accent,
          fontFamily: "Inter, system-ui, Arial, sans-serif",
          fontSize,
          fontWeight: 950,
          lineHeight: 0.95,
          textAlign: "center",
          textFit: "shrink",
          minFontSize: 30,
          textStroke: "5px rgba(15,23,42,0.48)",
          textShadow: "0px 16px 48px rgba(0,0,0,0.42)",
        },
        animations: popIn({
          delay: offset,
          durationInFrames: tempoEnterDuration(params.tempo, {
            calm: 14,
            standard: 10,
            energetic: 7,
          }),
          fromScale: params.tempo === "energetic" ? 0.72 : 0.84,
        }),
      };
    };

    const group: SceneNode = {
      id,
      type: "div",
      from,
      duration,
      style: {
        position: "absolute",
        left: Math.round((runtime.ctx.width - boxWidth) / 2),
        top: Math.round((runtime.ctx.height - boxHeight) / 2),
        width: boxWidth,
        height: boxHeight,
        overflow: "visible",
        zIndex: 50,
      },
      children: tokens.map(tokenNode),
    };

    return withExitMotion(
      group,
      {
        exit: params.exit ?? "fadeOut",
        exitDuration:
          params.exitDuration ?? Math.min(12, Math.max(1, duration - 1)),
      },
      duration,
    );
  },
});

const progressBarLooks = ["line", "pill", "meter"] as const;

const progressBarParams = z
  .object({
    id: z.string().trim().min(1).optional(),
    label: optionalSlotText,
    value: optionalSlotText,
    percent: looseNumber.pipe(z.number().min(0).max(100)).default(100),
    from: framePosition.optional(),
    duration: frameCount.optional(),
    palette: graphicPaletteSchema,
    accentColor: z.string().trim().min(1).max(80).optional(),
    colors: z.array(z.string().trim().min(1)).min(1).max(4).optional(),
    look: z.enum(progressBarLooks).default("pill"),
    placement: z.enum(["top", "center", "bottom"]).default("bottom"),
    tempo: graphicTempoSchema,
    exit: z.enum(macroExitNames).optional(),
    exitDuration: frameCount.optional(),
  })
  .strip();

registerMacro<z.infer<typeof progressBarParams>>({
  name: "progressBar",
  description:
    "Designed animated progress/goal bar. Params: percent 0..100, optional label/value, placement top|center|bottom, look line|pill|meter, palette, tempo.",
  usage:
    '{"macro":"progressBar","label":"Funded","value":"72%","percent":72,"from":60,"duration":90,"placement":"bottom","palette":"mint"}',
  params: progressBarParams,
  expand: (params, runtime) => {
    const from = params.from ?? 0;
    const duration =
      params.duration ?? defaultGraphicDuration({ runtime, from, seconds: 3 });
    noteWindowPastScene(runtime, "progressBar", from, duration);
    const id = runtime.uniqueId(params.id ?? "progress-bar");
    const palette = graphicPalette(params);
    const w = Math.round(runtime.ctx.width * 0.78);
    const h = params.label || params.value ? 132 : 76;
    const top =
      params.placement === "top"
        ? Math.round(runtime.ctx.height * 0.12)
        : params.placement === "center"
          ? Math.round((runtime.ctx.height - h) / 2)
          : Math.round(runtime.ctx.height * 0.76);
    const trackHeight = params.look === "line" ? 12 : 28;
    const fillPercent = `${params.percent}%`;
    const fillRadius = params.look === "line" ? 8 : 999;
    const labelNodes: SceneNode[] = params.label
      ? [
          {
            id: `${id}-label`,
            type: "text",
            text: params.label,
            duration,
            style: {
              position: "absolute",
              left: 0,
              top: 0,
              width: "70%",
              height: 44,
              color: palette.text,
              fontFamily: "Inter, system-ui, Arial, sans-serif",
              fontSize: 34,
              fontWeight: 850,
              lineHeight: 1,
            },
          },
        ]
      : [];
    const valueNodes: SceneNode[] = params.value
      ? [
          {
            id: `${id}-value`,
            type: "text",
            text: params.value,
            duration,
            style: {
              position: "absolute",
              right: 0,
              top: 0,
              width: "30%",
              height: 44,
              color: palette.accent,
              fontFamily: "Inter, system-ui, Arial, sans-serif",
              fontSize: 34,
              fontWeight: 950,
              lineHeight: 1,
              textAlign: "right",
            },
          },
        ]
      : [];
    const children: SceneNode[] = [
      ...labelNodes,
      ...valueNodes,
      {
        id: `${id}-track`,
        type: "div",
        duration,
        style: {
          position: "absolute",
          left: 0,
          bottom: params.look === "meter" ? 20 : 10,
          width: "100%",
          height: trackHeight,
          borderRadius: fillRadius,
          backgroundColor: "rgba(255,255,255,0.2)",
          border:
            params.look === "meter"
              ? `2px solid ${palette.accent2}`
              : "0px solid transparent",
          overflow: "hidden",
        },
        children: [
          {
            id: `${id}-fill`,
            type: "div",
            duration,
            style: {
              position: "absolute",
              left: 0,
              top: 0,
              width: fillPercent,
              height: "100%",
              borderRadius: fillRadius,
              backgroundColor: palette.accent,
              transform: "scale(1, 1)",
              transformOrigin: "left center",
              boxShadow: `0px 0px 28px ${palette.accent}`,
            },
            animations: [
              {
                kind: "keyframes",
                property: "transform",
                frames: [
                  { frame: 0, value: "scale(0, 1)" },
                  {
                    frame: tempoEnterDuration(params.tempo, {
                      calm: 30,
                      standard: 22,
                      energetic: 14,
                    }),
                    value: "scale(1, 1)",
                    easing:
                      params.tempo === "energetic" ? "easeOut" : "easeInOut",
                  },
                ],
              },
            ],
          },
        ],
      },
    ];
    const group: SceneNode = {
      id,
      type: "div",
      from,
      duration,
      style: {
        position: "absolute",
        left: Math.round((runtime.ctx.width - w) / 2),
        top,
        width: w,
        height: h,
        padding: params.look === "meter" ? 18 : 0,
        borderRadius: params.look === "meter" ? 22 : 0,
        backgroundColor:
          params.look === "meter" ? palette.panel : "rgba(0,0,0,0)",
        zIndex: 46,
      },
      animations:
        buildEnterAnimations({
          enter: "fadeUp",
          enterDuration: tempoEnterDuration(params.tempo, {
            calm: 16,
            standard: 10,
            energetic: 7,
          }),
        }) || [],
      children,
    };

    return withExitMotion(
      group,
      {
        exit: params.exit ?? "fadeOut",
        exitDuration:
          params.exitDuration ?? Math.min(10, Math.max(1, duration - 1)),
      },
      duration,
    );
  },
});

const chapterTransitionParams = z
  .object({
    id: z.string().trim().min(1).optional(),
    title: slotText,
    subtitle: optionalSlotText,
    chapter: optionalSlotText,
    from: framePosition.optional(),
    duration: frameCount.optional(),
    palette: graphicPaletteSchema,
    accentColor: z.string().trim().min(1).max(80).optional(),
    colors: z.array(z.string().trim().min(1)).min(1).max(4).optional(),
    tempo: graphicTempoSchema,
    exit: z.enum(macroExitNames).optional(),
    exitDuration: frameCount.optional(),
  })
  .strip();

registerMacro<z.infer<typeof chapterTransitionParams>>({
  name: "chapterTransition",
  description:
    "Designed full-frame chapter/section transition with title, optional chapter number and subtitle, accent rule, and fade exit.",
  usage:
    '{"macro":"chapterTransition","chapter":"02","title":"The Build","subtitle":"From prototype to launch","from":120,"duration":75,"palette":"ink"}',
  params: chapterTransitionParams,
  expand: (params, runtime) => {
    const from = params.from ?? 0;
    const duration =
      params.duration ??
      defaultGraphicDuration({ runtime, from, seconds: 2.5 });
    noteWindowPastScene(runtime, "chapterTransition", from, duration);
    const id = runtime.uniqueId(params.id ?? "chapter-transition");
    const palette = graphicPalette(params);
    const shortSide = Math.min(runtime.ctx.width, runtime.ctx.height);
    const contentWidth = Math.round(runtime.ctx.width * 0.78);
    const contentLeft = Math.round((runtime.ctx.width - contentWidth) / 2);
    const chapterNodes: SceneNode[] = params.chapter
      ? [
          {
            id: `${id}-chapter`,
            type: "text",
            text: params.chapter,
            duration,
            style: {
              position: "absolute",
              left: contentLeft,
              top: Math.round(runtime.ctx.height * 0.28),
              width: contentWidth,
              height: 72,
              color: palette.accent,
              fontFamily: "Inter, system-ui, Arial, sans-serif",
              fontSize: Math.round(shortSide * 0.08),
              fontWeight: 950,
              lineHeight: 1,
              textAlign: "center",
            },
          },
        ]
      : [];
    const subtitleNodes: SceneNode[] = params.subtitle
      ? [
          {
            id: `${id}-subtitle`,
            type: "text",
            text: params.subtitle,
            duration,
            style: {
              position: "absolute",
              left: contentLeft,
              top: Math.round(runtime.ctx.height * 0.52),
              width: contentWidth,
              height: 72,
              color: palette.muted,
              fontFamily: "Inter, system-ui, Arial, sans-serif",
              fontSize: Math.round(shortSide * 0.045),
              fontWeight: 750,
              lineHeight: 1.12,
              textAlign: "center",
              textFit: "shrink",
              minFontSize: 24,
            },
            animations: fadeUp({
              delay: 10,
              durationInFrames: 12,
              distance: 28,
            }),
          },
        ]
      : [];
    const group: SceneNode = {
      id,
      type: "div",
      from,
      duration,
      style: {
        position: "absolute",
        inset: 0,
        background: `linear-gradient(180deg, ${palette.background} 0%, ${palette.panel} 100%)`,
        overflow: "hidden",
        zIndex: 60,
      },
      animations:
        buildEnterAnimations({
          enter: "fadeIn",
          enterDuration: tempoEnterDuration(params.tempo, {
            calm: 18,
            standard: 10,
            energetic: 6,
          }),
        }) || [],
      children: [
        ...chapterNodes,
        {
          id: `${id}-title`,
          type: "text",
          text: params.title,
          duration,
          style: {
            position: "absolute",
            left: contentLeft,
            top: Math.round(runtime.ctx.height * 0.36),
            width: contentWidth,
            height: Math.round(runtime.ctx.height * 0.16),
            color: palette.text,
            fontFamily: "Inter, system-ui, Arial, sans-serif",
            fontSize: Math.round(shortSide * 0.13),
            fontWeight: 950,
            lineHeight: 0.94,
            textAlign: "center",
            textFit: "shrink",
            minFontSize: 44,
            textShadow: "0px 18px 56px rgba(0,0,0,0.38)",
          },
          animations: popIn({
            delay: tempoEnterDuration(params.tempo, {
              calm: 8,
              standard: 5,
              energetic: 2,
            }),
            durationInFrames: tempoEnterDuration(params.tempo, {
              calm: 18,
              standard: 12,
              energetic: 8,
            }),
          }),
        },
        ...subtitleNodes,
        {
          id: `${id}-rule`,
          type: "div",
          duration,
          style: {
            position: "absolute",
            left: Math.round(runtime.ctx.width * 0.28),
            top: Math.round(runtime.ctx.height * 0.65),
            width: Math.round(runtime.ctx.width * 0.44),
            height: 6,
            borderRadius: 999,
            backgroundColor: palette.accent,
            boxShadow: `0px 0px 28px ${palette.accent}`,
            transform: "scale(1, 1)",
            transformOrigin: "center center",
          },
          animations: [
            {
              kind: "keyframes",
              property: "transform",
              frames: [
                { frame: 0, value: "scale(0, 1)" },
                {
                  frame: tempoEnterDuration(params.tempo, {
                    calm: 24,
                    standard: 16,
                    energetic: 10,
                  }),
                  value: "scale(1, 1)",
                  easing: "easeOut",
                },
              ],
            },
          ],
        },
      ],
    };

    return withExitMotion(
      group,
      {
        exit: params.exit ?? "fadeOut",
        exitDuration:
          params.exitDuration ?? Math.min(14, Math.max(1, duration - 1)),
      },
      duration,
    );
  },
});

const lottiePlacements = [
  "center",
  "topLeft",
  "topRight",
  "bottomLeft",
  "bottomRight",
] as const;
const lottieTones = ["none", "bright", "muted", "warm", "cool"] as const;

const lottieOverlayParams = z
  .object({
    id: z.string().trim().min(1).optional(),
    assetId: z.string().trim().min(1),
    from: framePosition.optional(),
    duration: frameCount.optional(),
    placement: z.enum(lottiePlacements).default("center"),
    size: looseNumber.pipe(z.number().positive()).optional(),
    playbackRate: looseNumber.pipe(z.number().positive()).optional(),
    tone: z.enum(lottieTones).default("none"),
    ...motionParams,
  })
  .strip();

registerMacro<z.infer<typeof lottieOverlayParams>>({
  name: "lottieOverlay",
  description:
    'Places a self-contained uploaded or linked Lottie asset as a timed sticker/animation. Emit setAsset first with type:"lottie" and an existing asset/local id; the model must select/retime/place Lottie JSON, never author it. placement center|topLeft|topRight|bottomLeft|bottomRight; tone none|bright|muted|warm|cool applies renderer-safe filters.',
  usage:
    '{"macro":"lottieOverlay","assetId":"sparkle_pack","from":45,"duration":75,"placement":"topRight","size":220,"playbackRate":1}',
  params: lottieOverlayParams,
  expand: (params, runtime) => {
    const assetError = requireAsset(
      runtime,
      params.assetId,
      "lottie",
      "lottieOverlay",
    );

    if (assetError) {
      throw new MacroExpansionError([assetError]);
    }

    const from = params.from ?? 0;
    const duration =
      params.duration ?? defaultGraphicDuration({ runtime, from, seconds: 3 });
    noteWindowPastScene(runtime, "lottieOverlay", from, duration);
    const id = runtime.uniqueId(params.id ?? "lottie-overlay");
    const size = Math.round(
      params.size ?? Math.min(runtime.ctx.width, runtime.ctx.height) * 0.24,
    );
    const margin = Math.round(
      Math.min(runtime.ctx.width, runtime.ctx.height) * 0.06,
    );
    const left =
      params.placement === "center"
        ? Math.round((runtime.ctx.width - size) / 2)
        : params.placement.endsWith("Right")
          ? runtime.ctx.width - margin - size
          : margin;
    const top =
      params.placement === "center"
        ? Math.round((runtime.ctx.height - size) / 2)
        : params.placement.startsWith("bottom")
          ? runtime.ctx.height - margin - size
          : margin;
    const filter =
      params.tone === "bright"
        ? "brightness(1.18) contrast(1.08) saturate(1.18)"
        : params.tone === "muted"
          ? "brightness(0.96) contrast(0.92) saturate(0.72)"
          : params.tone === "warm"
            ? "brightness(1.04) contrast(1.04) saturate(1.12) sepia(0.22)"
            : params.tone === "cool"
              ? "brightness(1.04) contrast(1.06) saturate(0.9) hue-rotate(190deg)"
              : undefined;
    const node: SceneNode = {
      id,
      type: "lottie",
      assetId: params.assetId,
      from,
      duration,
      ...(params.playbackRate !== undefined
        ? { playbackRate: params.playbackRate }
        : {}),
      style: {
        position: "absolute",
        left,
        top,
        width: size,
        height: size,
        objectFit: "contain",
        zIndex: 52,
        ...(filter ? { filter } : {}),
      },
      ...(buildEnterAnimations({
        enter: params.enter ?? "popIn",
        ...(params.enterDelay !== undefined
          ? { enterDelay: params.enterDelay }
          : {}),
        enterDuration: params.enterDuration ?? 8,
      })
        ? {
            animations: buildEnterAnimations({
              enter: params.enter ?? "popIn",
              ...(params.enterDelay !== undefined
                ? { enterDelay: params.enterDelay }
                : {}),
              enterDuration: params.enterDuration ?? 8,
            }) as SceneAnimation[],
          }
        : {}),
    };

    return withExitMotion(
      node,
      {
        ...params,
        exit: params.exit ?? "fadeOut",
        exitDuration:
          params.exitDuration ?? Math.min(10, Math.max(1, duration - 1)),
      },
      duration,
    );
  },
});

const emphasisLooks = ["scribble", "glow", "burst", "clouds"] as const;
const emphasisPositions = ["top", "center", "bottom"] as const;
const emphasisTempos = ["calm", "energetic"] as const;

const emphasisParams = z
  .object({
    id: z.string().trim().min(1).optional(),
    text: slotText,
    from: framePosition.optional(),
    duration: frameCount.optional(),
    look: z.enum(emphasisLooks).default("scribble"),
    position: z.enum(emphasisPositions).default("top"),
    tempo: z.enum(emphasisTempos).default("energetic"),
    color: z.string().trim().min(1).max(80).optional(),
    colors: z.array(z.string().trim().min(1)).min(1).max(8).optional(),
    exit: z.enum(macroExitNames).optional(),
    exitDuration: frameCount.optional(),
  })
  .strip();

const emphasisLookToTextEffect = {
  scribble: { template: "scribbleCircle", accents: ["neonAura"] },
  glow: { template: "neonAura", accents: [] },
  burst: { template: "stickerBurst", accents: [] },
  clouds: { template: "cloudPop", accents: [] },
} as const;

registerMacro<z.infer<typeof emphasisParams>>({
  name: "emphasis",
  description:
    "Designed callout that stresses a spoken word or short phrase — the default look for speech highlights. Looks: scribble (hand-drawn circle + glow), glow (neon aura), burst (comic sticker pop), clouds (soft cloud pop). position: top|center|bottom band. tempo: calm|energetic animation energy. Holds ~5s by default.",
  usage:
    '{"macro":"emphasis","text":"3 MILLION","from":120,"duration":150,"look":"scribble","position":"top","tempo":"energetic"}',
  params: emphasisParams,
  expand: (params, runtime) => {
    const from = params.from ?? 0;
    const fps = Math.max(1, runtime.ctx.fps);
    const duration =
      params.duration ??
      Math.max(1, Math.min(Math.round(fps * 5), runtime.ctx.duration - from));
    const look = emphasisLookToTextEffect[params.look];
    const calm = params.tempo === "calm";
    const width = Math.round(runtime.ctx.width * 0.76);
    const height = Math.round(runtime.ctx.height * 0.18);
    const top =
      params.position === "top"
        ? Math.round(runtime.ctx.height * 0.14)
        : params.position === "bottom"
          ? Math.round(runtime.ctx.height * 0.68)
          : Math.round((runtime.ctx.height - height) / 2);

    return expandRegisteredMacro(
      "textEffect",
      {
        template: look.template,
        ...(look.accents.length > 0 ? { accents: [...look.accents] } : {}),
        id: params.id ?? `emphasis-${params.look}`,
        text: params.text,
        from,
        duration,
        width,
        height,
        top,
        left: Math.round((runtime.ctx.width - width) / 2),
        color: params.color ?? "#ffffff",
        textStroke: "8px rgba(15, 23, 42, 0.72)",
        textShadow: "0 14px 42px rgba(15, 23, 42, 0.45)",
        ...(params.colors ? { colors: params.colors } : {}),
        intensity: calm ? "medium" : "high",
        wobble: calm ? 0.35 : 0.6,
        pulse: calm ? 0.2 : 0.45,
        glow: params.look === "glow" ? 0.7 : 0.58,
        ...(params.look === "clouds" ? { softness: 0.65 } : {}),
        exit: params.exit ?? "fadeOut",
        exitDuration:
          params.exitDuration ??
          Math.min(calm ? 14 : 10, Math.max(1, duration - 1)),
      },
      runtime,
    );
  },
});

const bRollModes = ["fullFrame", "pip"] as const;

const bRollParams = z
  .object({
    id: z.string().trim().min(1).optional(),
    assetId: z.string().trim().min(1),
    from: framePosition.optional(),
    duration: frameCount.optional(),
    mode: z.enum(bRollModes).default("fullFrame"),
    placement: z.enum(mediaPlacements).optional(),
    kenBurns: z.boolean().default(true),
    look: keysEnum(mediaLooks).optional(),
    volume: looseNumber.pipe(z.number().min(0).max(1)).optional(),
    /** Video B-roll: source trim offset in seconds. */
    trimStart: looseNumber.pipe(z.number().min(0)).optional(),
    playbackRate: looseNumber.pipe(z.number().positive()).optional(),
    ...motionParams,
  })
  .strip();

registerMacro<z.infer<typeof bRollParams>>({
  name: "bRoll",
  description:
    "Timed B-roll insert of an image or video asset over the main footage. mode fullFrame covers the frame (default; stills get a slow Ken Burns drift unless kenBurns:false), mode pip is a corner inset (placement). Video B-roll is muted by default (volume 0) so the speaker keeps talking underneath. Holds ~4s by default.",
  usage:
    '{"macro":"bRoll","assetId":"beach","from":120,"duration":120,"mode":"fullFrame"}',
  params: bRollParams,
  expand: (params, runtime) => {
    const declaredType = runtime.ctx.assets?.[params.assetId]?.type;
    if (runtime.ctx.assets && !declaredType) {
      throw new MacroExpansionError([
        `macro "bRoll": assetId "${params.assetId}" is not in scene.assets. Emit a setAsset op first (or add the asset to scene.assets).`,
      ]);
    }
    if (declaredType && declaredType !== "image" && declaredType !== "video") {
      throw new MacroExpansionError([
        `macro "bRoll": asset "${params.assetId}" is a ${declaredType} asset; B-roll needs an image or video asset.`,
      ]);
    }
    const assetType: "image" | "video" =
      declaredType === "video" ? "video" : "image";

    const from = params.from ?? 0;
    const fps = Math.max(1, runtime.ctx.fps);
    const duration =
      params.duration ??
      Math.max(1, Math.min(Math.round(fps * 4), runtime.ctx.duration - from));
    noteWindowPastScene(runtime, "bRoll", from, duration);

    if (params.mode === "pip") {
      const shared = {
        id: params.id ?? "broll-pip",
        assetId: params.assetId,
        from,
        duration,
        placement: params.placement ?? "bottomRight",
        ...(params.look ? { look: params.look } : {}),
        enter: params.enter ?? "popIn",
        exit: params.exit ?? "fadeOut",
        ...(params.enterDelay !== undefined
          ? { enterDelay: params.enterDelay }
          : {}),
        ...(params.enterDuration !== undefined
          ? { enterDuration: params.enterDuration }
          : {}),
        ...(params.exitDuration !== undefined
          ? { exitDuration: params.exitDuration }
          : {}),
      };

      return assetType === "video"
        ? expandRegisteredMacro(
            "videoOverlay",
            {
              ...shared,
              template: "pictureInPicture",
              volume: params.volume ?? 0,
              ...(params.trimStart !== undefined
                ? { trimStart: params.trimStart }
                : {}),
              ...(params.playbackRate !== undefined
                ? { playbackRate: params.playbackRate }
                : {}),
            },
            runtime,
          )
        : expandRegisteredMacro(
            "imageOverlay",
            { ...shared, template: "sticker" },
            runtime,
          );
    }

    const id = runtime.uniqueId(params.id ?? "broll");
    const kenBurns = assetType === "image" && params.kenBurns;

    const mediaChild: SceneNode = {
      id: `${id}-media`,
      type: assetType === "video" ? "video" : "img",
      assetId: params.assetId,
      duration,
      ...(assetType === "video"
        ? {
            volume: params.volume ?? 0,
            ...(params.trimStart !== undefined
              ? { videoStartTime: params.trimStart }
              : {}),
            ...(params.playbackRate !== undefined
              ? { playbackRate: params.playbackRate }
              : {}),
          }
        : {}),
      style: {
        position: "absolute",
        inset: 0,
        width: "100%",
        height: "100%",
        objectFit: "cover",
        ...(params.look ? mediaLook(params.look as MediaLookKey) : {}),
      },
      animations: kenBurns
        ? [
            {
              kind: "keyframes",
              property: "transform",
              frames: [
                { frame: 0, value: "scale(1.05) translate(0%, 0%)" },
                {
                  frame: Math.max(1, duration),
                  value: "scale(1.16) translate(-1.5%, -1%)",
                  easing: "linear",
                },
              ],
            },
          ]
        : [],
    };

    const enter = buildEnterAnimations({
      enter: params.enter ?? "fadeIn",
      ...(params.enterDelay !== undefined
        ? { enterDelay: params.enterDelay }
        : {}),
      enterDuration: params.enterDuration ?? 8,
    });

    const group: SceneNode = {
      id,
      type: "div",
      from,
      duration,
      style: {
        position: "absolute",
        inset: 0,
        overflow: "hidden",
        backgroundColor: "#000000",
        zIndex: 30,
      },
      ...(enter ? { animations: enter } : {}),
      children: [mediaChild],
    };

    return withExitMotion(
      group,
      {
        ...params,
        exit: params.exit ?? "fadeOut",
        exitDuration:
          params.exitDuration ?? Math.min(10, Math.max(1, duration - 1)),
      },
      duration,
    );
  },
});

const textOverlaySlots = [
  "kicker",
  "title",
  "subtitle",
  "body",
  "value",
  "label",
  "attribution",
] as const satisfies readonly TextOverlaySlot[];

const textOverlayParams = z
  .object({
    template: keysEnum(textOverlayTemplates).default("titleCard"),
    id: z.string().trim().min(1).optional(),
    kicker: optionalSlotText,
    title: optionalSlotText,
    subtitle: optionalSlotText,
    body: optionalSlotText,
    value: optionalSlotText,
    label: optionalSlotText,
    attribution: optionalSlotText,
    accentColor: z.string().trim().min(1).optional(),
    style: styleSchema.optional(),
    kickerStyle: styleSchema.optional(),
    titleStyle: styleSchema.optional(),
    subtitleStyle: styleSchema.optional(),
    bodyStyle: styleSchema.optional(),
    valueStyle: styleSchema.optional(),
    labelStyle: styleSchema.optional(),
    attributionStyle: styleSchema.optional(),
    from: framePosition.optional(),
    duration: frameCount.optional(),
    ...motionParams,
  })
  .strip()
  .superRefine((params, issueCtx) => {
    const template =
      textOverlayTemplates[params.template as TextOverlayTemplateKey];

    for (const slot of template.required) {
      if (params[slot as (typeof textOverlaySlots)[number]] === undefined) {
        issueCtx.addIssue({
          code: z.ZodIssueCode.custom,
          path: [slot],
          message: `Template "${params.template}" requires "${slot}". Required: ${template.required.join(", ")}${
            template.optional?.length
              ? `; optional: ${template.optional.join(", ")}`
              : ""
          }.`,
        });
      }
    }
  });

registerMacro<z.infer<typeof textOverlayParams>>({
  name: "textOverlay",
  description: `Production text layout with safe-area placement, hierarchy, and entrance motion built in. Templates: ${Object.keys(textOverlayTemplates).join(", ")}. ${motionDoc}`,
  usage:
    '{"macro":"textOverlay","template":"lowerThird","title":"Ada Lovelace","subtitle":"Analyst","from":30,"duration":120,"enter":"slideInLeft","exit":"fadeOut"}',
  params: textOverlayParams,
  expand: (params, runtime) => {
    const from = params.from ?? 0;
    const duration =
      params.duration ??
      Math.max(1, Math.min(120, runtime.ctx.duration - from));
    noteWindowPastScene(runtime, "textOverlay", from, duration);

    const node = textOverlay({
      template: params.template as TextOverlayTemplateKey,
      id: runtime.uniqueId(params.id ?? `${params.template}-overlay`),
      composition: { width: runtime.ctx.width, height: runtime.ctx.height },
      from,
      duration,
      kicker: params.kicker,
      title: params.title,
      subtitle: params.subtitle,
      body: params.body,
      value: params.value,
      label: params.label,
      attribution: params.attribution,
      accentColor: params.accentColor,
      style: params.style as SceneStyle | undefined,
      kickerStyle: params.kickerStyle as SceneStyle | undefined,
      titleStyle: params.titleStyle as SceneStyle | undefined,
      subtitleStyle: params.subtitleStyle as SceneStyle | undefined,
      bodyStyle: params.bodyStyle as SceneStyle | undefined,
      valueStyle: params.valueStyle as SceneStyle | undefined,
      labelStyle: params.labelStyle as SceneStyle | undefined,
      attributionStyle: params.attributionStyle as SceneStyle | undefined,
      enter: buildEnterAnimations(params),
    });

    return withExitMotion(node, params, duration);
  },
});

const imageOverlayParams = z
  .object({
    template: keysEnum(imageOverlayTemplates).default("productShot"),
    id: z.string().trim().min(1).optional(),
    assetId: z.string().trim().min(1),
    from: framePosition.optional(),
    duration: frameCount.optional(),
    opacity: looseNumber.pipe(z.number().min(0).max(1)).optional(),
    placement: z.enum(mediaPlacements).optional(),
    look: keysEnum(mediaLooks).optional(),
    ...motionParams,
  })
  .strip();

registerMacro<z.infer<typeof imageOverlayParams>>({
  name: "imageOverlay",
  description: `Places an image asset with template-correct sizing and objectFit. Templates: ${Object.keys(imageOverlayTemplates).join(", ")}. ${mediaDoc} ${motionDoc}`,
  usage:
    '{"macro":"imageOverlay","template":"sticker","assetId":"logo","placement":"topRight","enter":"popIn","exit":"fadeOut"}',
  params: imageOverlayParams,
  expand: (params, runtime) => {
    const assetError = requireAsset(
      runtime,
      params.assetId,
      "image",
      "imageOverlay",
    );

    if (assetError) {
      throw new MacroExpansionError([assetError]);
    }

    const from = params.from ?? 0;
    const duration =
      params.duration ?? Math.max(1, runtime.ctx.duration - from);
    noteWindowPastScene(runtime, "imageOverlay", from, duration);

    const node = imageOverlay({
      template: params.template as ImageOverlayTemplateKey,
      id: runtime.uniqueId(params.id ?? `${params.template}-overlay`),
      assetId: params.assetId,
      composition: { width: runtime.ctx.width, height: runtime.ctx.height },
      from,
      duration,
      opacity: params.opacity,
      placement: params.placement,
      // The look lands on the img child; container filters are not inherited.
      imageStyle: params.look
        ? mediaLook(params.look as MediaLookKey)
        : undefined,
      enter: buildEnterAnimations(params),
    });

    return withExitMotion(node, params, duration);
  },
});

const videoOverlayParams = z
  .object({
    template: keysEnum(videoOverlayTemplates).default("pictureInPicture"),
    id: z.string().trim().min(1).optional(),
    assetId: z.string().trim().min(1),
    from: framePosition.optional(),
    duration: frameCount.optional(),
    /** Source trim offset in seconds. */
    trimStart: looseNumber.pipe(z.number().min(0)).optional(),
    playbackRate: looseNumber.pipe(z.number().positive()).optional(),
    volume: looseNumber.pipe(z.number().min(0).max(1)).optional(),
    placement: z.enum(mediaPlacements).optional(),
    look: keysEnum(mediaLooks).optional(),
    ...motionParams,
  })
  .strip();

registerMacro<z.infer<typeof videoOverlayParams>>({
  name: "videoOverlay",
  description: `Places a video asset with template-correct layout; decorative templates default to muted. Templates: ${Object.keys(videoOverlayTemplates).join(", ")}. ${mediaDoc} ${motionDoc}`,
  usage:
    '{"macro":"videoOverlay","template":"pictureInPicture","assetId":"clip1","placement":"bottomRight","enter":"slideInRight","look":"cinematicWarm"}',
  params: videoOverlayParams,
  expand: (params, runtime) => {
    const assetError = requireAsset(
      runtime,
      params.assetId,
      "video",
      "videoOverlay",
    );

    if (assetError) {
      throw new MacroExpansionError([assetError]);
    }

    const from = params.from ?? 0;
    const duration =
      params.duration ?? Math.max(1, runtime.ctx.duration - from);
    noteWindowPastScene(runtime, "videoOverlay", from, duration);

    const node = videoOverlay({
      template: params.template as VideoOverlayTemplateKey,
      id: runtime.uniqueId(params.id ?? `${params.template}-overlay`),
      assetId: params.assetId,
      composition: { width: runtime.ctx.width, height: runtime.ctx.height },
      from,
      duration,
      trimStart: params.trimStart,
      playbackRate: params.playbackRate,
      volume: params.volume,
      placement: params.placement,
      // videoOverlay nodes are the video element itself, so the look's
      // filter chain merges straight into its style.
      style: params.look ? mediaLook(params.look as MediaLookKey) : undefined,
      enter: buildEnterAnimations(params),
    });

    return withExitMotion(node, params, duration);
  },
});

const audioOverlayParams = z
  .object({
    template: keysEnum(audioOverlayTemplates).default("backgroundMusic"),
    id: z.string().trim().min(1).optional(),
    assetId: z.string().trim().min(1),
    from: framePosition.optional(),
    duration: frameCount.optional(),
    /** Source trim offset in seconds. */
    trimStart: looseNumber.pipe(z.number().min(0)).optional(),
    volume: looseNumber.pipe(z.number().min(0).max(1)).optional(),
    loop: z.boolean().optional(),
    fadeInDuration: frameCount.optional(),
    fadeOutDuration: frameCount.optional(),
  })
  .strip();

registerMacro<z.infer<typeof audioOverlayParams>>({
  name: "audioOverlay",
  description: `Adds an audio asset at a role-appropriate volume with optional fades and looping. Templates: ${Object.keys(audioOverlayTemplates).join(", ")}.`,
  usage:
    '{"macro":"audioOverlay","template":"backgroundMusic","assetId":"music","loop":true,"fadeOutDuration":24}',
  params: audioOverlayParams,
  expand: (params, runtime) => {
    const assetError = requireAsset(
      runtime,
      params.assetId,
      "audio",
      "audioOverlay",
    );

    if (assetError) {
      throw new MacroExpansionError([assetError]);
    }

    const from = params.from ?? 0;
    const duration =
      params.duration ?? Math.max(1, runtime.ctx.duration - from);
    noteWindowPastScene(runtime, "audioOverlay", from, duration);

    return audioOverlay({
      template: params.template as AudioOverlayTemplateKey,
      id: runtime.uniqueId(params.id ?? `${params.template}-overlay`),
      assetId: params.assetId,
      from,
      duration,
      trimStart: params.trimStart,
      volume: params.volume,
      loop: params.loop,
      fadeInDuration: params.fadeInDuration,
      fadeOutDuration: params.fadeOutDuration,
    });
  },
});

const transitionParams = z
  .object({
    template: keysEnum(transitionTemplates).default("fade"),
    id: z.string().trim().min(1).optional(),
    /** Scene frame the transition is centered on (default: mid-scene). */
    at: framePosition.optional(),
    duration: frameCount.default(18),
    color: z.string().trim().min(1).optional(),
  })
  .strip();

registerMacro<z.infer<typeof transitionParams>>({
  name: "transition",
  description: `Full-frame transition overlay between moments. Templates: ${Object.keys(transitionTemplates).join(", ")}.`,
  usage: '{"macro":"transition","template":"wipeLeft","at":90,"duration":18}',
  params: transitionParams,
  expand: (params, runtime) => {
    const at =
      params.at ??
      Math.max(0, Math.round((runtime.ctx.duration - params.duration) / 2));
    noteWindowPastScene(runtime, "transition", at, params.duration);

    return transitionOverlay(params.template as TransitionTemplateKey, {
      id: runtime.uniqueId(params.id ?? `${params.template}-transition`),
      at,
      duration: params.duration,
      color: params.color,
    });
  },
});

const timedSubtitleSegment = z
  .object({
    text: slotText,
    /** Window-relative seconds (relative to the macro's `from` frame). */
    startSeconds: looseNumber.pipe(z.number().min(0)),
    endSeconds: looseNumber.pipe(z.number().positive()),
  })
  .strip()
  .superRefine((segment, issueCtx) => {
    if (segment.endSeconds <= segment.startSeconds) {
      issueCtx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["endSeconds"],
        message: `endSeconds (${segment.endSeconds}) must be greater than startSeconds (${segment.startSeconds}).`,
      });
    }
  });

const subtitlesParams = z
  .object({
    template: keysEnum(captionTemplates).default("classic"),
    id: z.string().trim().min(1).optional(),
    segments: z
      .array(z.union([slotText, timedSubtitleSegment]))
      .min(1)
      .max(60),
    from: framePosition.optional(),
    duration: frameCount.optional(),
    area: captionAreaParams.optional(),
    style: captionStyleParams.optional(),
  })
  .strip()
  .superRefine((params, issueCtx) => {
    const timed = params.segments.filter(
      (segment) => typeof segment !== "string",
    ).length;

    if (timed > 0 && timed < params.segments.length) {
      issueCtx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["segments"],
        message:
          "Mix of timed and untimed segments: give every segment startSeconds/endSeconds, or make them all plain strings for an even spread.",
      });
    }
  });

registerMacro<z.infer<typeof subtitlesParams>>({
  name: "subtitles",
  description: `Subtitle lines from text YOU provide (e.g. written or translated lines), styled by a caption template. Plain strings spread evenly across the window; {"text","startSeconds","endSeconds"} segments render at exact window-relative times — use those timings when translating a clip's transcript so translated lines stay in sync. For the clip's own speech, use the captions macro instead. Optional style/area override subtitle colors, font, stroke, and placement. Templates: ${Object.keys(captionTemplates).join(", ")}.`,
  usage:
    '{"macro":"subtitles","template":"spotlight","segments":["First line","Second line"],"style":{"color":"#ff69b4"}} or {"macro":"subtitles","segments":[{"text":"Bonjour","startSeconds":0.5,"endSeconds":1.6}],"from":0}',
  params: subtitlesParams,
  expand: (params, runtime) => {
    const from = params.from ?? 0;
    const timed = params.segments.every(
      (segment) => typeof segment !== "string",
    );

    let segments: SubtitleSegment[];
    let duration: number;

    if (timed) {
      const entries = params.segments as Array<{
        text: string;
        startSeconds: number;
        endSeconds: number;
      }>;
      segments = entries
        .slice()
        .sort((a, b) => a.startSeconds - b.startSeconds)
        .map((segment) => ({
          text: segment.text,
          startMs: Math.round(segment.startSeconds * 1000),
          endMs: Math.round(segment.endSeconds * 1000),
        }));
      const lastEndMs = segments[segments.length - 1]?.endMs ?? 0;
      duration =
        params.duration ??
        Math.max(1, Math.ceil((lastEndMs / 1000) * runtime.ctx.fps));
    } else {
      duration = params.duration ?? Math.max(1, runtime.ctx.duration - from);
      const windowMs = (duration / runtime.ctx.fps) * 1000;
      const shareMs = windowMs / params.segments.length;
      segments = (params.segments as string[]).map((text, index) => ({
        text,
        startMs: Math.round(index * shareMs),
        endMs: Math.round((index + 1) * shareMs),
      }));
    }

    noteWindowPastScene(runtime, "subtitles", from, duration);

    const node = subtitleTrack(segments, {
      fps: runtime.ctx.fps,
      idPrefix: runtime.uniqueId(params.id ?? `${params.template}-subtitles`),
      template: params.template as CaptionTemplateKey,
      composition: { width: runtime.ctx.width, height: runtime.ctx.height },
      area: params.area,
      style: params.style,
    });

    // Children carry window-local times; the container owns the window.
    return {
      ...node,
      ...(from > 0 ? { from } : {}),
      duration,
    };
  },
});

const captionsParams = z
  .object({
    assetId: z.string().trim().min(1),
    template: keysEnum(captionTemplates).default("classic"),
    id: z.string().trim().min(1).optional(),
    /** Scene frame where the clip's playback starts (default 0). */
    from: framePosition.optional(),
    /** Cap in frames; default runs to the last spoken word. */
    duration: frameCount.optional(),
    /** Source trim offset in seconds — match the video node's videoStartTime. */
    trimStart: looseNumber.pipe(z.number().min(0)).optional(),
    /** Tokens per caption line; defaults per template, doubled for CJK. */
    maxWordsPerSegment: looseNumber
      .transform((value) => Math.round(value))
      .pipe(z.number().int().min(1).max(30))
      .optional(),
    area: captionAreaParams.optional(),
    style: captionStyleParams.optional(),
    highlightStyle: captionHighlightStyleParams.optional(),
  })
  .strip();

registerMacro<z.infer<typeof captionsParams>>({
  name: "captions",
  description: `Word-accurate speech captions generated from the clip's stored transcript — never retype the words yourself. Aligns via from (scene frame where the clip starts) and trimStart (the clip's source trim in seconds). Optional style/highlightStyle override caption colors, font, stroke, and active-word emphasis. Templates: ${Object.keys(captionTemplates).join(", ")}.`,
  usage:
    '{"macro":"captions","assetId":"video_1","template":"karaoke","from":0,"trimStart":0,"style":{"color":"#ff69b4","highlightColor":"#ffffff"}}',
  params: captionsParams,
  expand: (params, runtime) => {
    if (runtime.ctx.assets) {
      const asset = runtime.ctx.assets[params.assetId];
      if (!asset) {
        throw new MacroExpansionError([
          `macro "captions": assetId "${params.assetId}" is not in scene.assets. Add the transcribed audio/video asset before inserting captions.`,
        ]);
      }
      if (asset.type !== "audio" && asset.type !== "video") {
        throw new MacroExpansionError([
          `macro "captions": asset "${params.assetId}" is a ${asset.type} asset; captions require a transcribed audio or video asset.`,
        ]);
      }
    }
    const transcripts = runtime.ctx.transcripts;

    if (!transcripts) {
      throw new MacroExpansionError([
        `macro "captions": no transcript store is available in this context; use the subtitles macro with explicit segments instead.`,
      ]);
    }

    const transcript = transcripts[params.assetId];

    if (!transcript || transcript.words.length === 0) {
      const available = Object.entries(transcripts)
        .filter(([, entry]) => entry.words.length > 0)
        .map(([id]) => `"${id}"`);
      throw new MacroExpansionError([
        `macro "captions": no transcript exists for asset "${params.assetId}".${
          available.length > 0
            ? ` Assets with transcripts: ${available.join(", ")}.`
            : " No asset in this project has been transcribed yet; tell the user to request subtitles for the clip so transcription starts, or use the subtitles macro with explicit segments."
        }`,
      ]);
    }

    const from = params.from ?? 0;
    const shiftMs = Math.round((params.trimStart ?? 0) * 1000);
    const capMs =
      params.duration !== undefined
        ? (params.duration / runtime.ctx.fps) * 1000
        : Number.POSITIVE_INFINITY;

    const words = transcript.words
      .map((word) => ({
        word: word.text,
        startMs: word.startMs - shiftMs,
        endMs: word.endMs - shiftMs,
      }))
      .filter((word) => word.endMs > 0 && word.startMs < capMs)
      .map((word) => ({
        ...word,
        startMs: Math.max(0, word.startMs),
        endMs: Math.min(word.endMs, capMs),
      }));

    if (words.length === 0) {
      throw new MacroExpansionError([
        `macro "captions": the transcript for "${params.assetId}" has no speech inside the requested window (trimStart ${params.trimStart ?? 0}s${
          params.duration !== undefined
            ? `, duration ${params.duration} frames`
            : ""
        }).`,
      ]);
    }

    const lastEndMs = words[words.length - 1]?.endMs ?? 0;
    const duration =
      params.duration ??
      Math.max(1, Math.ceil((lastEndMs / 1000) * runtime.ctx.fps));
    noteWindowPastScene(runtime, "captions", from, duration);

    // CJK/Thai ASR "words" are single characters or tiny tokens; the default
    // 5-8 tokens per line would produce comically short lines there.
    const spaceless = isSpacelessScriptText(
      words
        .slice(0, 120)
        .map((word) => word.word)
        .join(""),
    );
    const maxWordsPerSegment =
      params.maxWordsPerSegment ?? (spaceless ? 14 : undefined);

    const node = styledCaptions(words, {
      fps: runtime.ctx.fps,
      idPrefix: runtime.uniqueId(params.id ?? `${params.template}-captions`),
      template: params.template as CaptionTemplateKey,
      area: params.area,
      style: params.style,
      highlightStyle: params.highlightStyle,
      ...(maxWordsPerSegment !== undefined ? { maxWordsPerSegment } : {}),
    });

    return {
      ...node,
      ...(from > 0 ? { from } : {}),
      duration,
    };
  },
});

const countdownParams = z
  .object({
    id: z.string().trim().min(1).optional(),
    start: looseNumber
      .transform((value) => Math.round(value))
      .pipe(z.number().int().min(1).max(100)),
    end: looseNumber
      .transform((value) => Math.round(value))
      .pipe(z.number().int().min(0))
      .default(1),
    /** Text shown for one beat after the final number (e.g. "GO!"). */
    finale: optionalNonEmptyString.pipe(z.string().max(30).optional()),
    from: framePosition.optional(),
    /** Total countdown window in frames. If omitted, each beat lasts one second. */
    duration: frameCount.optional(),
    /** Frames each number stays on screen (default: one second). */
    framesPerNumber: frameCount.optional(),
    color: z.string().trim().min(1).optional(),
    accentColor: z.string().trim().min(1).optional(),
  })
  .strip()
  .superRefine((params, issueCtx) => {
    if (params.end > params.start) {
      issueCtx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["end"],
        message: `end (${params.end}) must be <= start (${params.start}); the countdown counts down.`,
      });
    }
  });

registerMacro<z.infer<typeof countdownParams>>({
  name: "countdown",
  description:
    "Full-bleed numeric countdown, one beat per number, with pop-in/fade-out motion and an optional finale word.",
  usage:
    '{"macro":"countdown","start":5,"end":1,"duration":150,"finale":"GO!"}',
  params: countdownParams,
  expand: (params, runtime) => {
    const from = params.from ?? 0;
    const values: number[] = [];

    for (let value = params.start; value >= params.end; value -= 1) {
      values.push(value);
    }

    const beats = values.length + (params.finale ? 1 : 0);
    const duration =
      params.duration ?? beats * (params.framesPerNumber ?? runtime.ctx.fps);
    noteWindowPastScene(runtime, "countdown", from, duration);

    if (from + duration > runtime.ctx.duration) {
      runtime.diagnostics.push(
        `macro "countdown" needs ${from + duration} frames; add a setSceneMeta op with duration ${from + duration} if the countdown should play out fully.`,
      );
    }

    const id = runtime.uniqueId(params.id ?? "countdown");
    const shortSide = Math.min(runtime.ctx.width, runtime.ctx.height);
    const color = params.color ?? "#ffffff";
    const accentColor = params.accentColor ?? "#fef3c7";

    const beatWindow = (index: number): { from: number; duration: number } => {
      const beatStart = Math.round((duration * index) / beats);
      const beatEnd =
        index === beats - 1
          ? duration
          : Math.round((duration * (index + 1)) / beats);

      return {
        from: beatStart,
        duration: Math.max(1, beatEnd - beatStart),
      };
    };

    const beatNode = (
      text: string,
      index: number,
      isFinale: boolean,
    ): SceneNode => {
      const window = beatWindow(index);

      return {
        id: `${id}-${isFinale ? "finale" : `n${text}`}`,
        type: "text",
        text,
        from: window.from,
        duration: window.duration,
        style: {
          position: "absolute",
          left: 0,
          top: 0,
          width: "100%",
          height: "100%",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          color: isFinale ? accentColor : color,
          fontSize: Math.round(shortSide * (isFinale ? 0.2 : 0.24)),
          fontWeight: 900,
          lineHeight: 1,
          textAlign: "center",
          textFit: "shrink",
          minFontSize: 48,
          textShadow: isFinale
            ? "0 18px 56px rgba(251, 191, 36, 0.42)"
            : "0 18px 56px rgba(59, 130, 246, 0.34)",
        },
        animations: [
          {
            kind: "keyframes",
            property: "opacity",
            frames: [
              { frame: 0, value: 0, easing: "easeOut" },
              {
                frame: Math.min(5, Math.max(1, window.duration - 1)),
                value: 1,
              },
              {
                frame: Math.max(6, window.duration - 6),
                value: 1,
                easing: "linear",
              },
              {
                frame: Math.max(7, window.duration - 1),
                value: 0,
                easing: "easeIn",
              },
            ],
          },
          {
            kind: "keyframes",
            property: "transform",
            frames: [
              { frame: 0, value: "scale(0.82)", easing: "easeOut" },
              {
                frame: Math.max(1, window.duration - 1),
                value: isFinale ? "scale(1.12)" : "scale(1.06)",
              },
            ],
          },
        ],
      };
    };

    return {
      id,
      type: "div",
      from,
      duration,
      style: { position: "absolute", inset: 0 },
      children: [
        ...values.map((value, index) => beatNode(String(value), index, false)),
        ...(params.finale
          ? [beatNode(params.finale, values.length, true)]
          : []),
      ],
    };
  },
});

// ---------------------------------------------------------------------------
// Expansion walker

/** Thrown by macro expand() implementations for asset/reference errors. */
export class MacroExpansionError extends Error {
  constructor(readonly errors: string[]) {
    super(errors.join("\n"));
    this.name = "MacroExpansionError";
  }
}

export type ExpandNodesResult =
  | { ok: true; nodes: unknown[]; diagnostics: string[] }
  | { ok: false; errors: string[] };

type WalkState = {
  usedIds: Set<string>;
  diagnostics: string[];
  errors: string[];
  ctx: MacroContext;
};

/**
 * Expands macro nodes and layout intents (`place`, `textRole`, `look`,
 * `layout`) anywhere in a node tree, returning plain scene-node input ready
 * for schema validation. Nothing here mutates the input. All problems are
 * collected (not first-only) so an agent can fix a whole response in one
 * retry.
 */
export function expandMacroNodes(
  nodesInput: unknown,
  ctx: MacroContext,
): ExpandNodesResult {
  if (!Array.isArray(nodesInput)) {
    // Pass through; scene validation reports the real shape problem.
    return { ok: true, nodes: nodesInput as unknown[], diagnostics: [] };
  }

  const state: WalkState = {
    usedIds: new Set(ctx.existingIds ?? []),
    diagnostics: [],
    errors: [],
    ctx,
  };

  collectDeclaredIds(nodesInput, state.usedIds);

  // Partial success: a single malformed node must not sink the whole scene.
  // Expand each root node in isolation; if it (or a descendant) produced errors,
  // drop that node and keep its errors aside as diagnostics, then apply the
  // rest. Only when nothing survives do we surface a hard failure so the model
  // still gets the actionable message for a genuinely empty result.
  const nodes: unknown[] = [];
  const droppedErrors: string[] = [];
  let droppedCount = 0;

  nodesInput.forEach((node, index) => {
    const errorMark = state.errors.length;
    const expanded = expandNode(node, state, `nodes[${index}]`, 0);

    if (state.errors.length > errorMark) {
      droppedErrors.push(...state.errors.splice(errorMark));
      droppedCount += 1;
      return;
    }

    nodes.push(expanded);
  });

  if (nodes.length === 0 && nodesInput.length > 0) {
    return { ok: false, errors: droppedErrors };
  }

  const diagnostics = [...state.diagnostics];
  if (droppedCount > 0) {
    diagnostics.push(
      `Dropped ${droppedCount} node(s) that failed to expand and applied the rest. Details: ${droppedErrors.join(" | ")}`,
    );
  }

  return { ok: true, nodes, diagnostics };
}

/**
 * Single-node variant for patch `insertNode` ops. `atRoot` gates `place`
 * intents, which anchor against the whole composition and therefore only make
 * sense for nodes inserted at the scene root.
 */
export function expandMacroNodeInput(
  nodeInput: unknown,
  ctx: MacroContext,
  options: { atRoot?: boolean } = {},
): ExpandNodesResult {
  if (!isRecord(nodeInput)) {
    return { ok: true, nodes: [nodeInput], diagnostics: [] };
  }

  const state: WalkState = {
    usedIds: new Set(ctx.existingIds ?? []),
    diagnostics: [],
    errors: [],
    ctx,
  };

  collectDeclaredIds([nodeInput], state.usedIds);

  const node = expandNode(
    nodeInput,
    state,
    "node",
    options.atRoot === false ? 1 : 0,
  );

  if (state.errors.length > 0) {
    return { ok: false, errors: state.errors };
  }

  return { ok: true, nodes: [node], diagnostics: state.diagnostics };
}

function expandNode(
  input: unknown,
  state: WalkState,
  path: string,
  depth: number,
): unknown {
  if (!isRecord(input)) {
    return input;
  }

  if (typeof input.macro === "string") {
    return expandMacro(input, state, path);
  }

  let node: Record<string, unknown> = { ...input };

  if (node.textRole !== undefined) {
    node = applyTextRoleIntent(node, state, path);
  }

  if (node.look !== undefined || node.layout !== undefined) {
    node = applyMediaIntents(node, state, path);
  }

  if (Array.isArray(node.children)) {
    node.children = node.children.map((child, index) =>
      expandNode(child, state, `${path}.children[${index}]`, depth + 1),
    );
  }

  if (node.place !== undefined) {
    node = applyPlaceIntent(node, state, path, depth);
  }

  return node;
}

// Canvas paint order is zIndex-sorted (document order breaks ties at 0), so
// an overlay without a zIndex is only visible by luck: any later-inserted
// base video buries it. Every visual overlay macro therefore gets a default
// band; explicit zIndex in the expansion or params always wins. Base media
// stays at 0 by design.
const MACRO_DEFAULT_Z_INDEX: Record<string, number> = {
  textOverlay: 40,
  imageOverlay: 35,
  videoOverlay: 35,
  lowerThird: 44,
  countdown: 50,
  transition: 55,
  subtitles: 60,
  captions: 60,
};

function applyMacroDefaultZIndex(name: string, node: SceneNode): SceneNode {
  const defaultZIndex = MACRO_DEFAULT_Z_INDEX[name];

  if (
    defaultZIndex === undefined ||
    node.type === "audio" ||
    node.style?.zIndex !== undefined
  ) {
    return node;
  }

  return {
    ...node,
    style: {
      ...(node.style ?? {}),
      zIndex: defaultZIndex,
    },
  };
}

function expandMacro(
  input: Record<string, unknown>,
  state: WalkState,
  path: string,
): unknown {
  const name = input.macro as string;
  const definition = registry.get(name);

  if (!definition) {
    const hints = closestIds(name, registry.keys(), 2).map((id) => `"${id}"`);
    state.errors.push(
      `${path}: unknown macro "${name}". Available macros: ${macroNames().join(", ")}.${
        hints.length > 0 ? ` Did you mean ${hints.join(" or ")}?` : ""
      }`,
    );
    return input;
  }

  const { macro: _macro, ...params } = input;
  const envelope = normalizeMacroEnvelope(
    name,
    params,
    state.diagnostics,
    path,
  );
  const parseInput = isEffectMacroName(name)
    ? normalizeEffectMacroParams(envelope)
    : envelope;
  const parsed = definition.params.safeParse(parseInput);

  if (!parsed.success) {
    for (const issue of parsed.error.issues) {
      const issuePath = issue.path.length > 0 ? `.${issue.path.join(".")}` : "";
      state.errors.push(
        `${path} (macro "${name}")${issuePath}: ${issue.message}`,
      );
    }

    state.errors.push(`${path}: usage: ${definition.usage}`);
    return input;
  }

  const runtime: MacroRuntime = {
    ctx: state.ctx,
    uniqueId: (preferred) => claimUniqueId(state.usedIds, preferred),
    diagnostics: state.diagnostics,
  };

  try {
    const node = applyMacroDefaultZIndex(
      name,
      definition.expand(parsed.data, runtime),
    );
    claimSubtreeIds(node, state);
    state.diagnostics.push(`Expanded macro "${name}" into node "${node.id}".`);
    return node;
  } catch (error) {
    if (error instanceof MacroExpansionError) {
      state.errors.push(...error.errors);
    } else {
      state.errors.push(
        `${path}: macro "${name}" failed to expand: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }

    return input;
  }
}

function isEffectMacroName(name: string): boolean {
  return (
    name === "effectOverlay" || name === "textEffect" || name === "cartoonBurst"
  );
}

// Macros whose schema forwards a `style` object verbatim (as an override for the
// generated node). Their `style` must be left untouched by the envelope
// normalizer; every other macro takes flat placement params.
const STYLE_FORWARDING_MACROS = new Set([
  "textOverlay",
  "captions",
  "subtitles",
]);

// Raw scene-node keys a model tends to wrap a macro in because it knows the node
// format. No macro accepts these as params, so with `.strip()` schemas they
// would vanish silently; we drop them explicitly with a diagnostic instead so
// the loss is visible and the model gets steered back to flat params.
const RAW_NODE_ENVELOPE_KEYS = [
  "type",
  "children",
  "animations",
  "keyframes",
  "props",
] as const;

// Placement/text keys that map 1:1 to flat macro params, so they can be lifted
// out of a node-shaped `style` object instead of thrown away with it.
const LIFTABLE_STYLE_KEYS = [
  "left",
  "top",
  "right",
  "bottom",
  "width",
  "height",
  "fontSize",
  "fontFamily",
  "fontWeight",
  "color",
  "textStroke",
  "textShadow",
] as const;

/**
 * Reshapes a macro node that a model wrote in raw scene-node form. Models fluent
 * in the node schema habitually wrap macros in `style: {...}` and `animations:
 * [...]`; against a `.strip()` schema those either get silently dropped (losing
 * position) or, for a still-strict field, error. This pulls the placement/text
 * keys out of `style` into flat params and removes the raw-node envelope keys,
 * recording each rewrite as a diagnostic. Style-forwarding macros keep `style`.
 */
function normalizeMacroEnvelope(
  name: string,
  input: Record<string, unknown>,
  diagnostics: string[],
  path: string,
): Record<string, unknown> {
  let changed = false;
  const normalized: Record<string, unknown> = { ...input };

  if (!STYLE_FORWARDING_MACROS.has(name) && isRecord(normalized.style)) {
    const style = normalized.style as Record<string, unknown>;
    const lifted: string[] = [];

    for (const key of LIFTABLE_STYLE_KEYS) {
      if (style[key] !== undefined && normalized[key] === undefined) {
        normalized[key] = style[key];
        lifted.push(key);
      }
    }

    delete normalized.style;
    changed = true;
    diagnostics.push(
      `${path}: macro "${name}" carried a node-shaped \`style\` object; ${
        lifted.length > 0
          ? `lifted ${lifted.join(", ")} to flat params and dropped the rest`
          : "dropped it"
      }. Macros take flat placement params, not a \`style\` object.`,
    );
  }

  for (const key of RAW_NODE_ENVELOPE_KEYS) {
    if (normalized[key] !== undefined) {
      delete normalized[key];
      changed = true;
      diagnostics.push(
        `${path}: macro "${name}" carried a raw-node \`${key}\` key; dropped it. Use enter/exit for macro motion, and raw nodes for hand-built trees.`,
      );
    }
  }

  return changed ? normalized : input;
}

// Effect-param key aliases and value coercions for the macro path share the
// implementation in effect-params.ts with downstream raw-node adapters. This
// wrapper additionally resolves textEffect template aliases and keeps unknown
// keys so the macro zod schemas can `.strip()` them.
function normalizeEffectMacroParams(
  params: Record<string, unknown>,
): Record<string, unknown> {
  const normalized = { ...params };

  if (normalized.template !== undefined) {
    normalized.template = normalizeTextEffectTemplateAlias(normalized.template);
  }

  if (Array.isArray(normalized.accents)) {
    normalized.accents = normalized.accents
      .map(normalizeTextEffectTemplateAlias)
      .filter((accent) => accent !== undefined);
  }

  effectParamAliases.forEach((canonical, alias) => {
    if (
      normalized[canonical] === undefined &&
      normalized[alias] !== undefined
    ) {
      normalized[canonical] = normalized[alias];
      delete normalized[alias];
    }
  });

  canonicalEffectParamKeys.forEach((key) => {
    if (normalized[key] === undefined) {
      return;
    }

    const value = normalizeEffectParamValue(key, normalized[key]);

    if (value === undefined) {
      delete normalized[key];
    } else {
      normalized[key] = value;
    }
  });

  return normalized;
}

function normalizeTextEffectTemplateAlias(value: unknown): unknown {
  if (typeof value !== "string") {
    return value;
  }

  const text = value.trim().toLowerCase();

  if (text === "aura" || text === "glow" || text === "neon") {
    return "neonAura";
  }

  if (
    text === "speed" ||
    text === "lines" ||
    text === "manga" ||
    text === "speedlines"
  ) {
    return "speedLines";
  }

  if (text === "scribble" || text === "circle" || text === "outline") {
    return "scribbleCircle";
  }

  if (text === "cloud" || text === "smoke" || text === "cloudpop") {
    return "cloudPop";
  }

  if (
    text === "spark" ||
    text === "sparks" ||
    text === "burst" ||
    text === "impact"
  ) {
    return "stickerBurst";
  }

  return value;
}

function applyTextRoleIntent(
  node: Record<string, unknown>,
  state: WalkState,
  path: string,
): Record<string, unknown> {
  const { textRole, ...rest } = node;
  const parsed = z.enum(textRoles).safeParse(textRole);

  if (!parsed.success) {
    state.errors.push(
      `${path}.textRole: unknown role ${JSON.stringify(textRole)}. Available roles: ${textRoles.join(", ")}.`,
    );
    return rest;
  }

  if (node.type !== "text") {
    state.errors.push(
      `${path}.textRole: textRole only applies to text nodes; this node is type ${JSON.stringify(node.type)}.`,
    );
    return rest;
  }

  return {
    ...rest,
    style: applyTextRole(
      isRecord(rest.style) ? (rest.style as never) : undefined,
      parsed.data as TextRole,
      { width: state.ctx.width, height: state.ctx.height },
    ),
  };
}

function applyMediaIntents(
  node: Record<string, unknown>,
  state: WalkState,
  path: string,
): Record<string, unknown> {
  const { look, layout, ...rest } = node;

  if (
    (look !== undefined && typeof look !== "string") ||
    (layout !== undefined && typeof layout !== "string")
  ) {
    state.errors.push(`${path}: look and layout must be preset-name strings.`);
    return rest;
  }

  if (rest.type !== "img" && rest.type !== "video" && rest.type !== "div") {
    state.errors.push(
      `${path}: look/layout only apply to img, video, or div nodes; this node is type ${JSON.stringify(rest.type)}.`,
    );
    return rest;
  }

  const resolved = resolveMediaIntents({
    style: isRecord(rest.style) ? (rest.style as never) : undefined,
    look: look as string | undefined,
    layout: layout as string | undefined,
  });

  if ("errors" in resolved) {
    for (const error of resolved.errors) {
      state.errors.push(`${path}.${error.key}: ${error.message}`);
    }

    return rest;
  }

  return { ...rest, style: resolved.style };
}

function applyPlaceIntent(
  node: Record<string, unknown>,
  state: WalkState,
  path: string,
  depth: number,
): Record<string, unknown> {
  const { place, ...rest } = node;

  if (depth > 0) {
    state.errors.push(
      `${path}.place: place only applies to nodes at the scene root; position nested nodes inside their parent with style (position/left/top or flex).`,
    );
    return rest;
  }

  if (typeof rest.id !== "string" || rest.id.length === 0) {
    state.errors.push(`${path}.place: the placed node needs an id.`);
    return rest;
  }

  const parsed = placeIntentSchema.safeParse(place);

  if (!parsed.success) {
    for (const issue of parsed.error.issues) {
      const issuePath = issue.path.length > 0 ? `.${issue.path.join(".")}` : "";
      state.errors.push(`${path}.place${issuePath}: ${issue.message}`);
    }

    return rest;
  }

  const wrapperId = claimUniqueId(state.usedIds, `${rest.id}-place`);
  const wrapped = resolvePlaceIntent({
    node: rest as SceneNode,
    place: parsed.data,
    size: { width: state.ctx.width, height: state.ctx.height },
    wrapperId,
  });

  state.diagnostics.push(
    `Placed node "${rest.id}" at ${parsed.data.anchor} inside wrapper "${wrapperId}".`,
  );

  return wrapped as unknown as Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// Id bookkeeping

function collectDeclaredIds(input: unknown, into: Set<string>): void {
  if (Array.isArray(input)) {
    for (const entry of input) {
      collectDeclaredIds(entry, into);
    }

    return;
  }

  if (!isRecord(input)) {
    return;
  }

  // Macro ids are claimed at expansion time (uniqueId), not here.
  if (typeof input.macro === "string") {
    return;
  }

  if (typeof input.id === "string" && input.id.length > 0) {
    into.add(input.id);
  }

  if (Array.isArray(input.children)) {
    collectDeclaredIds(input.children, into);
  }
}

function claimUniqueId(usedIds: Set<string>, preferred: string): string {
  let candidate = preferred;

  for (let index = 2; usedIds.has(candidate); index += 1) {
    candidate = `${preferred}-${index}`;
  }

  usedIds.add(candidate);
  return candidate;
}

/**
 * Presets derive child ids from the container id, so a unique container id
 * normally guarantees a unique subtree. This walk backstops that invariant:
 * residual collisions are suffixed rather than surfacing as a confusing
 * whole-scene validation failure.
 */
function claimSubtreeIds(node: SceneNode, state: WalkState): void {
  state.usedIds.add(node.id);

  for (const child of node.children ?? []) {
    if (state.usedIds.has(child.id)) {
      const renamed = claimUniqueId(state.usedIds, child.id);
      state.diagnostics.push(
        `Renamed generated node id "${child.id}" to "${renamed}" to keep ids unique.`,
      );
      child.id = renamed;
    }

    claimSubtreeIds(child, state);
  }
}
