import { z } from "zod/v3";
import {
  closestIds,
  sceneNodeSchema,
  styleSchema,
  type SceneNode,
  type SceneStyle,
} from "@dojo-video-engine/schema";
import {
  clipLayout,
  clipLayouts,
  mediaLook,
  mediaLooks,
  resolveSafeArea,
  safeAreaBox,
  type ClipLayoutKey,
  type CompositionSize,
  type MediaLookKey,
  type SafeAreaAnchor,
  type SafeAreaBoxOptions,
  type SafeAreaInput,
} from "./index";

/**
 * Layout intents: declarative node-level sugar that resolves to plain scene
 * styles at expansion time. Agents describe *where* and *what role* instead of
 * computing pixel coordinates and font sizes — the spatial math the models
 * reliably get wrong. Everything here compiles down to the same validated
 * style keys the schema already accepts; nothing new reaches the renderer.
 */

const looseNumber = z.preprocess(
  (value) =>
    typeof value === "string" && value.trim() !== "" ? Number(value) : value,
  z.number().finite(),
);

export const placeAnchors = [
  "top-left",
  "top-center",
  "top-right",
  "center-left",
  "center",
  "center-right",
  "bottom-left",
  "bottom-center",
  "bottom-right",
] as const;

export type PlaceAnchor = (typeof placeAnchors)[number];

export const placeIntentSchema = z
  .object({
    anchor: z.enum(placeAnchors),
    /** Extra pixels inside the safe area; number = both axes. */
    margin: z
      .union([
        looseNumber,
        z
          .object({ x: looseNumber.optional(), y: looseNumber.optional() })
          .strict(),
      ])
      .optional(),
    /** false = anchor against the raw composition edges (default true). */
    safeArea: z.boolean().optional(),
    offsetX: looseNumber.optional(),
    offsetY: looseNumber.optional(),
    zIndex: looseNumber.optional(),
  })
  .strict({
    message:
      'place supports only: anchor, margin, safeArea, offsetX, offsetY, zIndex. Example: {"anchor":"bottom-center","margin":32}.',
  });

export type PlaceIntent = z.infer<typeof placeIntentSchema>;

export const textRoles = [
  "display",
  "title",
  "subtitle",
  "body",
  "caption",
  "label",
] as const;

export type TextRole = (typeof textRoles)[number];

type TextRoleRamp = {
  /** Font size as a fraction of the composition's short side. */
  sizeRatio: number;
  fontWeight: number;
  lineHeight: number;
  /** Letter spacing as a fraction of the resolved font size. */
  letterSpacingRatio?: number;
  /** Shrink-to-fit floor as a fraction of the resolved font size. */
  minFontSizeRatio?: number;
};

const textRoleRamps: Record<TextRole, TextRoleRamp> = {
  display: {
    sizeRatio: 0.115,
    fontWeight: 900,
    lineHeight: 0.98,
    minFontSizeRatio: 0.4,
  },
  title: {
    sizeRatio: 0.085,
    fontWeight: 800,
    lineHeight: 1.05,
    minFontSizeRatio: 0.4,
  },
  subtitle: { sizeRatio: 0.044, fontWeight: 600, lineHeight: 1.2 },
  body: { sizeRatio: 0.036, fontWeight: 500, lineHeight: 1.35 },
  caption: { sizeRatio: 0.032, fontWeight: 600, lineHeight: 1.25 },
  label: {
    sizeRatio: 0.026,
    fontWeight: 700,
    lineHeight: 1.1,
    letterSpacingRatio: 0.14,
  },
};

/**
 * Composition-scaled typography for a semantic role. The ramp keys off the
 * short side so vertical, square, and landscape compositions all land on
 * proportionate sizes without the author knowing font math.
 */
export function textRoleStyle(
  role: TextRole,
  size: CompositionSize,
): SceneStyle {
  const ramp = textRoleRamps[role];
  const shortSide = Math.max(1, Math.min(size.width, size.height));
  const fontSize = Math.max(10, Math.round(ramp.sizeRatio * shortSide));
  const style: SceneStyle = {
    fontSize,
    fontWeight: ramp.fontWeight,
    lineHeight: ramp.lineHeight,
  };

  if (ramp.letterSpacingRatio !== undefined) {
    style.letterSpacing = Math.round(fontSize * ramp.letterSpacingRatio);
  }

  if (ramp.minFontSizeRatio !== undefined) {
    style.textFit = "shrink";
    style.minFontSize = Math.max(
      10,
      Math.round(fontSize * ramp.minFontSizeRatio),
    );
  }

  return style;
}

/**
 * Fills role typography into a style, never overriding keys the author set.
 */
export function applyTextRole(
  style: SceneStyle | undefined,
  role: TextRole,
  size: CompositionSize,
): SceneStyle {
  const roleStyle = textRoleStyle(role, size) as Record<string, unknown>;
  const merged: Record<string, unknown> = { ...roleStyle };

  for (const [key, value] of Object.entries(style ?? {})) {
    if (value !== undefined) {
      merged[key] = value;
    }
  }

  return merged as SceneStyle;
}

function readMargins(margin: PlaceIntent["margin"]): { x: number; y: number } {
  if (typeof margin === "number") {
    return { x: Math.round(margin), y: Math.round(margin) };
  }

  return {
    x: Math.round(margin?.x ?? 0),
    y: Math.round(margin?.y ?? 0),
  };
}

/**
 * Resolves a place intent into an absolutely positioned flex wrapper that
 * spans the (safe-area inset) composition and aligns the child with flexbox.
 * Flex alignment sidesteps the unsolvable part of anchor math: the child's
 * intrinsic size (wrapped text, contain-fit images) is unknown until layout,
 * so we never have to guess it. The child's `from`/`duration` hoist onto the
 * wrapper; child timing and animations stay node-local and unchanged.
 */
export function resolvePlaceIntent(params: {
  node: SceneNode;
  place: PlaceIntent;
  size: CompositionSize;
  wrapperId: string;
}): SceneNode {
  const { node, place, size, wrapperId } = params;
  const insets = resolveSafeArea(
    size,
    place.safeArea === false ? false : "auto",
  );
  const margins = readMargins(place.margin);
  const left = insets.left + margins.x;
  const top = insets.top + margins.y;
  const width = Math.max(1, size.width - left - (insets.right + margins.x));
  const height = Math.max(1, size.height - top - (insets.bottom + margins.y));
  const [vertical, horizontal] = splitAnchor(place.anchor);

  const wrapperStyle: SceneStyle = {
    position: "absolute",
    left,
    top,
    width,
    height,
    display: "flex",
    flexDirection: "column",
    justifyContent:
      vertical === "top"
        ? "flex-start"
        : vertical === "bottom"
          ? "flex-end"
          : "center",
    alignItems:
      horizontal === "left"
        ? "flex-start"
        : horizontal === "right"
          ? "flex-end"
          : "center",
  };

  if (place.zIndex !== undefined) {
    wrapperStyle.zIndex = Math.round(place.zIndex);
  }

  const offsetX = Math.round(place.offsetX ?? 0);
  const offsetY = Math.round(place.offsetY ?? 0);

  if (offsetX !== 0 || offsetY !== 0) {
    wrapperStyle.transform = `translate(${offsetX}px, ${offsetY}px)`;
  }

  const child: SceneNode = { ...node };
  const from = child.from;
  const duration = child.duration;
  delete child.from;
  delete child.duration;

  return {
    id: wrapperId,
    type: "div",
    ...(from !== undefined ? { from } : {}),
    ...(duration !== undefined ? { duration } : {}),
    style: wrapperStyle,
    children: [child],
  };
}

function splitAnchor(
  anchor: PlaceAnchor,
): ["top" | "center" | "bottom", "left" | "center" | "right"] {
  if (anchor === "center") {
    return ["center", "center"];
  }

  const [vertical, horizontal] = anchor.split("-") as [
    "top" | "center" | "bottom",
    "left" | "center" | "right",
  ];

  return [vertical, horizontal];
}

export type MediaIntentError = { key: "look" | "layout"; message: string };

/**
 * Resolves `look` (media color/filter treatment) and `layout` (clip
 * positioning) shorthand keys into style merges. The node's own style wins on
 * conflicts, so authors can take a preset and adjust one property.
 */
export function resolveMediaIntents(params: {
  style: SceneStyle | undefined;
  look?: string;
  layout?: string;
}): { style: SceneStyle } | { errors: MediaIntentError[] } {
  const errors: MediaIntentError[] = [];
  let base: Record<string, unknown> = {};

  if (params.layout !== undefined) {
    if (params.layout in clipLayouts) {
      base = { ...base, ...clipLayout(params.layout as ClipLayoutKey) };
    } else {
      errors.push({
        key: "layout",
        message: `Unknown layout "${params.layout}". Available layouts: ${Object.keys(clipLayouts).join(", ")}.`,
      });
    }
  }

  if (params.look !== undefined) {
    if (params.look in mediaLooks) {
      base = { ...base, ...mediaLook(params.look as MediaLookKey) };
    } else {
      errors.push({
        key: "look",
        message: `Unknown look "${params.look}". Available looks: ${Object.keys(mediaLooks).join(", ")}.`,
      });
    }
  }

  if (errors.length > 0) {
    return { errors };
  }

  const merged: Record<string, unknown> = { ...base };

  for (const [key, value] of Object.entries(params.style ?? {})) {
    if (value !== undefined) {
      merged[key] = value;
    }
  }

  return { style: merged as SceneStyle };
}

// ---------------------------------------------------------------------------
// Versioned discovery and compilation boundary

/**
 * Version 1 describes compilers that erase authoring intent into ordinary
 * Scene v1 nodes/styles. The manifest is discovery data, never executable
 * runtime state and never a second stored scene format.
 */
export const LAYOUT_COMPILER_MANIFEST_VERSION = 1 as const;

export type LayoutCompilerManifestVersion =
  typeof LAYOUT_COMPILER_MANIFEST_VERSION;

export type LayoutCompilerFamily =
  | "place"
  | "safe-area"
  | "text-role"
  | "media-look"
  | "clip-layout";

export type LayoutCompilerId =
  | "place"
  | "safe-area/box"
  | `text-role/${TextRole}`
  | `media-look/${MediaLookKey}`
  | `clip-layout/${ClipLayoutKey}`;

export type LayoutCompilerNodeType = SceneNode["type"];
export type LayoutCompilerContextKey = "composition" | "node" | "wrapperId";

export type LayoutCompilerOutputKind = "style" | "node-wrapper";

export type LayoutCompilerManifest = Readonly<{
  manifestVersion: LayoutCompilerManifestVersion;
  id: LayoutCompilerId;
  family: LayoutCompilerFamily;
  name: string;
  description: string;
  category?: string;
  /** Portable JSON Schema draft-07 for `compileLayoutIntent().params`. */
  paramsSchema: Readonly<Record<string, unknown>>;
  examples: readonly Readonly<Record<string, unknown>>[];
  appliesTo: readonly LayoutCompilerNodeType[];
  requiredContext: readonly LayoutCompilerContextKey[];
  output: Readonly<{
    kind: LayoutCompilerOutputKind;
    roles: readonly string[];
    canonicalTarget: "scene-v1";
    /** Keys supplied by the compiler before caller style overrides. */
    ownedStyleKeys: readonly string[];
  }>;
}>;

export type CompileLayoutIntentContext = {
  composition?: CompositionSize;
  /** Required only by the `place` compiler. */
  node?: SceneNode;
  /** Required only by the `place` compiler. */
  wrapperId?: string;
  /** Optional author override. Existing helper precedence is preserved. */
  style?: SceneStyle;
  /** Optional target assertion for hosts compiling by selected-node id. */
  targetType?: LayoutCompilerNodeType;
};

export type CompileLayoutIntentRequest = {
  id: string;
  params?: unknown;
  context?: CompileLayoutIntentContext;
};

export type LayoutCompileIssueCode =
  | "invalid_request"
  | "unknown_intent"
  | "invalid_params"
  | "missing_context"
  | "invalid_context"
  | "unsupported_target"
  | "non_json_value"
  | "compile_failed";

export type LayoutCompileIssue = {
  code: LayoutCompileIssueCode;
  path: string;
  message: string;
  suggestions: string[];
};

export type LayoutCompileDiagnostic = {
  code: "layout_intent_compiled";
  path: "id";
  message: string;
};

export type CompiledLayoutIntentValue =
  | { kind: "style"; style: SceneStyle }
  | { kind: "node-wrapper"; node: SceneNode };

export type CompileLayoutIntentResult =
  | {
      ok: true;
      id: LayoutCompilerId;
      value: CompiledLayoutIntentValue;
      diagnostics: LayoutCompileDiagnostic[];
    }
  | { ok: false; errors: LayoutCompileIssue[] };

const draft07 = "http://json-schema.org/draft-07/schema#";
const allNodeTypes: LayoutCompilerNodeType[] = [
  "div",
  "text",
  "img",
  "video",
  "audio",
  "lottie",
  "effect",
  "extension",
  "shape",
];
const visualNodeTypes = allNodeTypes.filter((type) => type !== "audio");
const mediaIntentNodeTypes: LayoutCompilerNodeType[] = ["div", "img", "video"];

const jsonFiniteNumberSchema = {
  anyOf: [
    { type: "number" },
    { type: "string", pattern: "^[+-]?(?:\\d+(?:\\.\\d*)?|\\.\\d+)$" },
  ],
};

const placeParamsJsonSchema = {
  $schema: draft07,
  type: "object",
  properties: {
    anchor: { type: "string", enum: [...placeAnchors] },
    margin: {
      anyOf: [
        jsonFiniteNumberSchema,
        {
          type: "object",
          properties: {
            x: jsonFiniteNumberSchema,
            y: jsonFiniteNumberSchema,
          },
          additionalProperties: false,
        },
      ],
    },
    safeArea: { type: "boolean" },
    offsetX: jsonFiniteNumberSchema,
    offsetY: jsonFiniteNumberSchema,
    zIndex: jsonFiniteNumberSchema,
  },
  required: ["anchor"],
  additionalProperties: false,
};

const safeAreaAnchors: SafeAreaAnchor[] = [
  "center",
  "top",
  "bottom",
  "title",
  "subtitle",
  "lowerThird",
  "statCallout",
];
const safeAreaProfileNames = ["auto", "vertical", "square", "landscape"];
const safeAreaInputJsonSchema = {
  anyOf: [
    { type: "string", enum: safeAreaProfileNames },
    { type: "boolean" },
    jsonFiniteNumberSchema,
    {
      type: "object",
      properties: {
        x: jsonFiniteNumberSchema,
        y: jsonFiniteNumberSchema,
        top: jsonFiniteNumberSchema,
        right: jsonFiniteNumberSchema,
        bottom: jsonFiniteNumberSchema,
        left: jsonFiniteNumberSchema,
      },
      additionalProperties: false,
    },
  ],
};
const safeAreaBoxParamsJsonSchema = {
  $schema: draft07,
  type: "object",
  properties: {
    anchor: { type: "string", enum: safeAreaAnchors },
    safeArea: safeAreaInputJsonSchema,
    width: jsonFiniteNumberSchema,
    height: jsonFiniteNumberSchema,
    widthRatio: jsonFiniteNumberSchema,
    heightRatio: jsonFiniteNumberSchema,
    align: { type: "string", enum: ["left", "center", "right"] },
    offsetX: jsonFiniteNumberSchema,
    offsetY: jsonFiniteNumberSchema,
  },
  required: ["anchor"],
  additionalProperties: false,
};
const emptyParamsJsonSchema = {
  $schema: draft07,
  type: "object",
  properties: {},
  additionalProperties: false,
};

const safeAreaInputSchema: z.ZodType<SafeAreaInput, z.ZodTypeDef, unknown> =
  z.union([
    z.enum(["auto", "vertical", "square", "landscape"]),
    z.boolean(),
    looseNumber,
    z
      .object({
        x: looseNumber.optional(),
        y: looseNumber.optional(),
        top: looseNumber.optional(),
        right: looseNumber.optional(),
        bottom: looseNumber.optional(),
        left: looseNumber.optional(),
      })
      .strict(),
  ]);

const safeAreaBoxIntentSchema = z
  .object({
    anchor: z.enum(safeAreaAnchors as [SafeAreaAnchor, ...SafeAreaAnchor[]]),
    safeArea: safeAreaInputSchema.optional(),
    width: looseNumber.optional(),
    height: looseNumber.optional(),
    widthRatio: looseNumber.optional(),
    heightRatio: looseNumber.optional(),
    align: z.enum(["left", "center", "right"]).optional(),
    offsetX: looseNumber.optional(),
    offsetY: looseNumber.optional(),
  })
  .strict();

const emptyParamsSchema = z.object({}).strict();
const compositionSchema = z
  .object({
    width: z.number().int().positive(),
    height: z.number().int().positive(),
  })
  .strict();
const wrapperIdSchema = z.string().trim().min(1).max(191);

function sortedKeys(value: Record<string, unknown>): string[] {
  return Object.keys(value).sort(compareCodeUnits);
}

function manifest(
  value: Omit<LayoutCompilerManifest, "manifestVersion">,
): LayoutCompilerManifest {
  return {
    manifestVersion: LAYOUT_COMPILER_MANIFEST_VERSION,
    ...value,
  };
}

const layoutCompilerManifestSource = deepFreeze(
  [
    manifest({
      id: "place",
      family: "place",
      name: "Place",
      description:
        "Anchor a root node inside the composition safe area through a flex wrapper.",
      paramsSchema: placeParamsJsonSchema,
      examples: [{ anchor: "bottom-center", margin: 32 }],
      appliesTo: allNodeTypes,
      requiredContext: ["composition", "node", "wrapperId"],
      output: {
        kind: "node-wrapper",
        roles: ["layout", "placement"],
        canonicalTarget: "scene-v1",
        ownedStyleKeys: [
          "alignItems",
          "display",
          "flexDirection",
          "height",
          "justifyContent",
          "left",
          "position",
          "top",
          "transform",
          "width",
          "zIndex",
        ],
      },
    }),
    manifest({
      id: "safe-area/box",
      family: "safe-area",
      name: "Safe-area box",
      description:
        "Resolve a named safe-area anchor into explicit Scene v1 box geometry.",
      paramsSchema: safeAreaBoxParamsJsonSchema,
      examples: [
        {
          anchor: "lowerThird",
          safeArea: "auto",
          widthRatio: 0.72,
        },
      ],
      appliesTo: visualNodeTypes,
      requiredContext: ["composition"],
      output: {
        kind: "style",
        roles: ["layout", "safe-area"],
        canonicalTarget: "scene-v1",
        ownedStyleKeys: ["height", "left", "position", "top", "width"],
      },
    }),
    ...textRoles.map((role) =>
      manifest({
        id: `text-role/${role}`,
        family: "text-role",
        name: role[0]!.toUpperCase() + role.slice(1),
        description: `Apply the composition-scaled ${role} typography role.`,
        paramsSchema: emptyParamsJsonSchema,
        examples: [{}],
        appliesTo: ["text"],
        requiredContext: ["composition"],
        output: {
          kind: "style",
          roles: ["text", "typography"],
          canonicalTarget: "scene-v1",
          ownedStyleKeys: sortedKeys(
            textRoleStyle(role, { width: 1000, height: 1000 }) as Record<
              string,
              unknown
            >,
          ),
        },
      }),
    ),
    ...Object.entries(mediaLooks).map(([key, preset]) =>
      manifest({
        id: `media-look/${key as MediaLookKey}`,
        family: "media-look",
        name: preset.name,
        description: preset.description,
        category: preset.category,
        paramsSchema: emptyParamsJsonSchema,
        examples: [{}],
        appliesTo: mediaIntentNodeTypes,
        requiredContext: [],
        output: {
          kind: "style",
          roles: ["media", "visual-treatment"],
          canonicalTarget: "scene-v1",
          ownedStyleKeys: sortedKeys(preset.style as Record<string, unknown>),
        },
      }),
    ),
    ...Object.entries(clipLayouts).map(([key, preset]) =>
      manifest({
        id: `clip-layout/${key as ClipLayoutKey}`,
        family: "clip-layout",
        name: preset.name,
        description: preset.description,
        category: preset.category,
        paramsSchema: emptyParamsJsonSchema,
        examples: [{}],
        appliesTo: mediaIntentNodeTypes,
        requiredContext: [],
        output: {
          kind: "style",
          roles: ["layout", "visual-media"],
          canonicalTarget: "scene-v1",
          ownedStyleKeys: sortedKeys(preset.style as Record<string, unknown>),
        },
      }),
    ),
  ].sort((left, right) => compareCodeUnits(left.id, right.id)),
);

const layoutCompilerManifestsById = new Map(
  layoutCompilerManifestSource.map((entry) => [entry.id, entry]),
);

/**
 * Returns a detached, deeply frozen, JSON-safe manifest snapshot. Mutating a
 * result can never alter later discovery or compiler behavior.
 */
export function layoutCompilerManifests(): readonly LayoutCompilerManifest[] {
  return deepFreeze(cloneJson(layoutCompilerManifestSource));
}

/** Returns one detached manifest, or `undefined` for an unknown stable id. */
export function getLayoutCompilerManifest(
  id: string,
): LayoutCompilerManifest | undefined {
  const found = layoutCompilerManifestsById.get(id as LayoutCompilerId);
  return found === undefined ? undefined : deepFreeze(cloneJson(found));
}

/**
 * Nonthrowing intent dispatcher for agents, commands, and programmer tools.
 * It validates JSON input and context, then delegates to the existing 1.x
 * helpers so their tree shape, numeric defaults, and override precedence stay
 * byte-for-byte compatible for JSON-safe input.
 */
export function compileLayoutIntent(
  requestInput: unknown,
): CompileLayoutIntentResult {
  try {
    if (!isPlainRecord(requestInput)) {
      return failure(
        issue(
          "invalid_request",
          "request",
          "Layout compiler request must be a plain JSON object.",
        ),
      );
    }

    const unknownRequestKeys = Object.keys(requestInput).filter(
      (key) => !["id", "params", "context"].includes(key),
    );
    if (unknownRequestKeys.length > 0) {
      return failure(
        issue(
          "invalid_request",
          unknownRequestKeys[0]!,
          `Unknown layout compiler request key ${JSON.stringify(unknownRequestKeys[0])}.`,
          ["id", "params", "context"],
        ),
      );
    }

    if (typeof requestInput.id !== "string" || requestInput.id.length === 0) {
      return failure(
        issue(
          "invalid_request",
          "id",
          "Layout compiler request needs a non-empty string id.",
          layoutCompilerManifestSource.slice(0, 3).map(({ id }) => id),
        ),
      );
    }

    const found = layoutCompilerManifestsById.get(
      requestInput.id as LayoutCompilerId,
    );
    if (!found) {
      return failure(
        issue(
          "unknown_intent",
          "id",
          `Unknown layout compiler ${JSON.stringify(requestInput.id)}.`,
          closestIds(
            requestInput.id,
            layoutCompilerManifestSource.map(({ id }) => id),
            3,
          ),
        ),
      );
    }

    const params = requestInput.params ?? {};
    const contextInput = requestInput.context ?? {};
    const jsonIssue = findJsonIssue(params, "params");
    if (jsonIssue) return failure(jsonIssue);
    if (!isPlainRecord(contextInput)) {
      return failure(
        issue(
          "invalid_context",
          "context",
          "Layout compiler context must be a plain JSON object.",
        ),
      );
    }
    const unknownContextKeys = Object.keys(contextInput).filter(
      (key) =>
        !["composition", "node", "wrapperId", "style", "targetType"].includes(
          key,
        ),
    );
    if (unknownContextKeys.length > 0) {
      return failure(
        issue(
          "invalid_context",
          `context.${unknownContextKeys[0]}`,
          `Unknown layout compiler context key ${JSON.stringify(unknownContextKeys[0])}.`,
          ["composition", "node", "wrapperId", "style", "targetType"],
        ),
      );
    }

    const contextJsonIssue = findJsonIssue(contextInput, "context");
    if (contextJsonIssue) return failure(contextJsonIssue);

    const missing = found.requiredContext.filter(
      (key) => contextInput[key] === undefined,
    );
    if (missing.length > 0) {
      return {
        ok: false,
        errors: missing.map((key) =>
          issue(
            "missing_context",
            `context.${key}`,
            `Layout compiler ${JSON.stringify(found.id)} requires context.${key}.`,
          ),
        ),
      };
    }

    if (contextInput.targetType !== undefined) {
      if (
        typeof contextInput.targetType !== "string" ||
        !allNodeTypes.includes(
          contextInput.targetType as LayoutCompilerNodeType,
        )
      ) {
        return failure(
          issue(
            "invalid_context",
            "context.targetType",
            "targetType must be a canonical Scene node type.",
            found.appliesTo as string[],
          ),
        );
      }
      if (
        !found.appliesTo.includes(
          contextInput.targetType as LayoutCompilerNodeType,
        )
      ) {
        return failure(
          issue(
            "unsupported_target",
            "context.targetType",
            `${found.id} does not apply to ${JSON.stringify(contextInput.targetType)} nodes.`,
            found.appliesTo as string[],
          ),
        );
      }
    }

    const styleResult =
      contextInput.style === undefined
        ? undefined
        : styleSchema.safeParse(contextInput.style);
    if (styleResult && !styleResult.success) {
      return zodFailure("invalid_context", "context.style", styleResult.error);
    }
    const style = styleResult?.data;

    let compiled: CompiledLayoutIntentValue;
    if (found.id === "place") {
      const parsed = placeIntentSchema.safeParse(params);
      if (!parsed.success) {
        return zodFailure("invalid_params", "params", parsed.error);
      }
      const composition = parseComposition(contextInput.composition);
      if (!composition.ok) return composition.result;
      const wrapperId = wrapperIdSchema.safeParse(contextInput.wrapperId);
      if (!wrapperId.success) {
        return zodFailure(
          "invalid_context",
          "context.wrapperId",
          wrapperId.error,
        );
      }
      const node = sceneNodeSchema.safeParse(contextInput.node);
      if (!node.success) {
        return zodFailure("invalid_context", "context.node", node.error);
      }

      compiled = {
        kind: "node-wrapper",
        node: resolvePlaceIntent({
          node: cloneJson(contextInput.node) as SceneNode,
          place: parsed.data,
          size: composition.value,
          wrapperId: wrapperId.data,
        }),
      };
    } else if (found.id === "safe-area/box") {
      const parsed = safeAreaBoxIntentSchema.safeParse(params);
      if (!parsed.success) {
        return zodFailure("invalid_params", "params", parsed.error);
      }
      const composition = parseComposition(contextInput.composition);
      if (!composition.ok) return composition.result;
      const { anchor, ...options } = parsed.data;
      compiled = {
        kind: "style",
        style: {
          ...safeAreaBox(
            composition.value,
            anchor,
            options as SafeAreaBoxOptions,
          ),
          ...style,
        },
      };
    } else if (found.family === "text-role") {
      const parsed = emptyParamsSchema.safeParse(params);
      if (!parsed.success) {
        return zodFailure("invalid_params", "params", parsed.error);
      }
      const composition = parseComposition(contextInput.composition);
      if (!composition.ok) return composition.result;
      compiled = {
        kind: "style",
        style: applyTextRole(
          style,
          found.id.slice("text-role/".length) as TextRole,
          composition.value,
        ),
      };
    } else if (found.family === "media-look") {
      const parsed = emptyParamsSchema.safeParse(params);
      if (!parsed.success) {
        return zodFailure("invalid_params", "params", parsed.error);
      }
      compiled = {
        kind: "style",
        style: mediaLook(
          found.id.slice("media-look/".length) as MediaLookKey,
          style,
        ),
      };
    } else {
      const parsed = emptyParamsSchema.safeParse(params);
      if (!parsed.success) {
        return zodFailure("invalid_params", "params", parsed.error);
      }
      compiled = {
        kind: "style",
        style: clipLayout(
          found.id.slice("clip-layout/".length) as ClipLayoutKey,
          style,
        ),
      };
    }

    const compiledJsonIssue = findJsonIssue(compiled, "value");
    if (compiledJsonIssue) return failure(compiledJsonIssue);

    return {
      ok: true,
      id: found.id,
      value: cloneJson(compiled),
      diagnostics: [
        {
          code: "layout_intent_compiled",
          path: "id",
          message: `Compiled ${JSON.stringify(found.id)} to ${found.output.canonicalTarget} ${found.output.kind}.`,
        },
      ],
    };
  } catch (error) {
    return failure(
      issue(
        "compile_failed",
        "request",
        `Layout intent compilation failed safely: ${error instanceof Error ? error.message : String(error)}`,
      ),
    );
  }
}

function parseComposition(
  value: unknown,
):
  | { ok: true; value: CompositionSize }
  | { ok: false; result: CompileLayoutIntentResult } {
  const parsed = compositionSchema.safeParse(value);
  if (!parsed.success) {
    return {
      ok: false,
      result: zodFailure(
        "invalid_context",
        "context.composition",
        parsed.error,
      ),
    };
  }
  return { ok: true, value: parsed.data };
}

function zodFailure(
  code: Extract<LayoutCompileIssueCode, "invalid_params" | "invalid_context">,
  prefix: string,
  error: z.ZodError,
): CompileLayoutIntentResult {
  return {
    ok: false,
    errors: error.issues.map((entry) => {
      const path = [prefix, ...entry.path.map(String)].join(".");
      const options =
        entry.code === z.ZodIssueCode.invalid_enum_value
          ? entry.options.map(String)
          : [];
      const input = readIssueInput(entry);
      return issue(
        code,
        path,
        entry.message,
        typeof input === "string" && options.length > 0
          ? closestIds(input, options, Math.min(3, options.length))
          : options.slice(0, 3),
      );
    }),
  };
}

function readIssueInput(entry: z.ZodIssue): unknown {
  return "received" in entry ? entry.received : undefined;
}

function issue(
  code: LayoutCompileIssueCode,
  path: string,
  message: string,
  suggestions: readonly string[] = [],
): LayoutCompileIssue {
  return { code, path, message, suggestions: [...suggestions] };
}

function failure(error: LayoutCompileIssue): CompileLayoutIntentResult {
  return { ok: false, errors: [error] };
}

function findJsonIssue(
  root: unknown,
  rootPath: string,
): LayoutCompileIssue | undefined {
  const stack: Array<{ value: unknown; path: string; depth: number }> = [
    { value: root, path: rootPath, depth: 0 },
  ];
  const seen = new WeakSet<object>();
  let values = 0;

  while (stack.length > 0) {
    const current = stack.pop()!;
    values += 1;
    if (values > 50_000) {
      return issue(
        "non_json_value",
        current.path,
        "Layout compiler input exceeds the 50,000-value JSON safety limit.",
      );
    }
    if (current.depth > 64) {
      return issue(
        "non_json_value",
        current.path,
        "Layout compiler input exceeds the 64-level JSON depth limit.",
      );
    }

    const value = current.value;
    if (
      value === null ||
      typeof value === "string" ||
      typeof value === "boolean"
    ) {
      continue;
    }
    if (typeof value === "number") {
      if (!Number.isFinite(value)) {
        return issue(
          "non_json_value",
          current.path,
          "JSON numbers must be finite.",
        );
      }
      continue;
    }
    if (typeof value !== "object") {
      return issue(
        "non_json_value",
        current.path,
        `Unsupported non-JSON ${typeof value} value.`,
      );
    }
    if (seen.has(value)) {
      return issue(
        "non_json_value",
        current.path,
        "Layout compiler input must be an acyclic JSON tree without shared object references.",
      );
    }
    seen.add(value);

    if (Array.isArray(value)) {
      value.forEach((item, index) =>
        stack.push({
          value: item,
          path: `${current.path}.${index}`,
          depth: current.depth + 1,
        }),
      );
      continue;
    }
    if (!isPlainRecord(value)) {
      return issue(
        "non_json_value",
        current.path,
        "Layout compiler input accepts only plain JSON objects.",
      );
    }
    for (const [key, child] of Object.entries(value)) {
      stack.push({
        value: child,
        path: `${current.path}.${key}`,
        depth: current.depth + 1,
      });
    }
  }

  return undefined;
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return false;
  }
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function compareCodeUnits(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function cloneJson<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function deepFreeze<T>(value: T): T {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value as Record<string, unknown>)) {
      deepFreeze(child);
    }
  }
  return value;
}
