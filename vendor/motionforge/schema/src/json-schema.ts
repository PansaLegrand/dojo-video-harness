import {
  isBorderValue,
  isColorValue,
  isEasingValue,
  isFilterValue,
  isFontFamilyValue,
  isFontWeightString,
  isObjectPositionValue,
  isPaintValue,
  isShadowValue,
  isTextStrokeValue,
  isTransformOriginValue,
  isTransformValue,
  lengthStringSchema,
  parseShadowValue,
} from "./values";
import { isFontWeightDescriptor } from "./font-assets";

export const motionforgeJsonSchemaFormatNames = [
  "motionforge-length",
  "motionforge-aspect-ratio",
  "motionforge-color",
  "motionforge-paint",
  "motionforge-transform",
  "motionforge-transform-origin",
  "motionforge-object-position",
  "motionforge-filter",
  "motionforge-font-family",
  "motionforge-font-weight",
  "motionforge-font-weight-descriptor",
  "motionforge-border",
  "motionforge-shadow-list",
  "motionforge-single-shadow",
  "motionforge-text-stroke",
  "motionforge-easing",
] as const;

export type MotionforgeJsonSchemaFormatName =
  (typeof motionforgeJsonSchemaFormatNames)[number];

export type MotionforgeJsonSchemaFormatPredicate = (value: string) => boolean;

/**
 * Custom draft-07 string formats used by `scene.schema.json` when a portable
 * value parser is more precise than a maintainable regular expression.
 */
export const motionforgeJsonSchemaFormats: Readonly<
  Record<MotionforgeJsonSchemaFormatName, MotionforgeJsonSchemaFormatPredicate>
> = {
  "motionforge-length": (value) => lengthStringSchema.safeParse(value).success,
  "motionforge-aspect-ratio": isAspectRatioString,
  "motionforge-color": isColorValue,
  "motionforge-paint": isPaintValue,
  "motionforge-transform": isTransformValue,
  "motionforge-transform-origin": isTransformOriginValue,
  "motionforge-object-position": isObjectPositionValue,
  "motionforge-filter": isFilterValue,
  "motionforge-font-family": isFontFamilyValue,
  "motionforge-font-weight": isFontWeightString,
  "motionforge-font-weight-descriptor": isFontWeightDescriptor,
  "motionforge-border": isBorderValue,
  "motionforge-shadow-list": isShadowValue,
  "motionforge-single-shadow": (value) =>
    value === "none" || parseShadowValue(value) !== null,
  "motionforge-text-stroke": isTextStrokeValue,
  "motionforge-easing": isEasingValue,
};

export type JsonSchemaFormatRegistrar = {
  addFormat(
    name: string,
    format:
      | MotionforgeJsonSchemaFormatPredicate
      | {
          type: "string";
          validate: MotionforgeJsonSchemaFormatPredicate;
        },
  ): unknown;
};

/** Register every MotionForge format before compiling the generated schema. */
export function registerMotionforgeJsonSchemaFormats<
  T extends JsonSchemaFormatRegistrar,
>(validator: T): T {
  for (const [name, validate] of Object.entries(motionforgeJsonSchemaFormats)) {
    validator.addFormat(name, { type: "string", validate });
  }
  return validator;
}

/**
 * Adds the portable-value vocabulary and target-dependent animation value
 * constraints that zod-to-json-schema cannot infer from Zod refinements.
 */
export function decorateSceneJsonSchema(
  schema: Record<string, unknown>,
  animationTargets: readonly string[],
): Record<string, unknown> {
  annotatePortableFormats(schema);
  schema["x-motionforge-format-vocabulary"] = [
    ...motionforgeJsonSchemaFormatNames,
  ];
  schema.$comment =
    "Register @motionforge/schema motionforgeJsonSchemaFormats before compiling this schema; unknown formats must not be ignored.";

  const definition = childRecord(
    childRecord(schema, "definitions"),
    "MotionforgeScene",
  );
  const sceneProperties = childRecord(definition, "properties");
  const nodes = childRecord(sceneProperties, "nodes");
  const node = childRecord(nodes, "items");
  const nodeProperties = childRecord(node, "properties");
  const style = childRecord(nodeProperties, "style");
  const styleProperties = childRecord(style, "properties");
  const animations = childRecord(nodeProperties, "animations");
  const animation = childRecord(animations, "items");

  const aspectRatio = childRecord(styleProperties, "aspectRatio");
  const aspectRatioVariants = Array.isArray(aspectRatio.anyOf)
    ? aspectRatio.anyOf
    : [];
  for (const variant of aspectRatioVariants) {
    const candidate = asRecord(variant);
    if (candidate?.type === "string") {
      candidate.format = "motionforge-aspect-ratio";
    }
  }

  const radiusSchema = styleProperties.borderRadius;
  const targetGroups = new Map<
    string,
    { targets: string[]; valueSchema: Record<string, unknown> }
  >();
  for (const target of animationTargets) {
    const valueSchema = target.startsWith("mask.")
      ? maskAnimationValueSchema(target, radiusSchema)
      : cloneJsonSchema(styleProperties[target]);
    if (!valueSchema) continue;
    const signature = JSON.stringify(valueSchema);
    const group = targetGroups.get(signature);
    if (group) group.targets.push(target);
    else targetGroups.set(signature, { targets: [target], valueSchema });
  }
  animation.allOf = [...targetGroups.values()].map(
    ({ targets, valueSchema }) => ({
      if: {
        properties: {
          property:
            targets.length === 1 ? { const: targets[0] } : { enum: targets },
        },
        required: ["property"],
      },
      then: {
        properties: {
          frames: {
            items: {
              properties: { value: valueSchema },
            },
          },
        },
      },
    }),
  );
  return schema;
}

function annotatePortableFormats(value: unknown): void {
  const stack: unknown[] = [value];
  while (stack.length > 0) {
    const next = stack.pop();
    if (Array.isArray(next)) {
      stack.push(...next);
      continue;
    }
    const current = asRecord(next);
    if (!current) continue;
    const description =
      typeof current.description === "string" ? current.description : "";
    const format = formatForDescription(description);
    if (format) current.format = format;
    for (const child of Object.values(current)) {
      if (child && typeof child === "object") stack.push(child);
    }
  }
}

function formatForDescription(
  description: string,
): MotionforgeJsonSchemaFormatName | null {
  if (description.startsWith("FontFace weight descriptor"))
    return "motionforge-font-weight-descriptor";
  if (description.startsWith("Finite number string with optional px or %")) {
    return "motionforge-length";
  }
  if (description.startsWith("Expected a supported hex")) {
    return "motionforge-color";
  }
  if (description.startsWith("Expected a supported color or")) {
    return "motionforge-paint";
  }
  if (description.startsWith("Expected none or a translate")) {
    return "motionforge-transform";
  }
  if (description.startsWith("Expected horizontal left/center/right")) {
    return "motionforge-transform-origin";
  }
  if (description.startsWith("Expected one or two left/center/right")) {
    return "motionforge-object-position";
  }
  if (description.startsWith("Expected none or a supported Canvas2D filter")) {
    return "motionforge-filter";
  }
  if (
    description.startsWith("Expected a bounded comma-separated Canvas font")
  ) {
    return "motionforge-font-family";
  }
  if (description.startsWith("Expected normal/bold/bolder/lighter")) {
    return "motionforge-font-weight";
  }
  if (description.startsWith("Expected a nonnegative px width")) {
    return "motionforge-border";
  }
  if (description.startsWith("Expected comma-separated x/y")) {
    return "motionforge-shadow-list";
  }
  if (description.startsWith("Expected one x/y")) {
    return "motionforge-single-shadow";
  }
  if (description.startsWith("Expected a positive px width")) {
    return "motionforge-text-stroke";
  }
  if (description.startsWith("Expected a named easing")) {
    return "motionforge-easing";
  }
  return null;
}

function maskAnimationValueSchema(
  target: string,
  radiusSchema: unknown,
): Record<string, unknown> | null {
  if (target === "mask.opacity") {
    return { type: "number", minimum: 0, maximum: 1 };
  }
  if (target === "mask.feather") {
    return { type: "number", minimum: 0, maximum: 256 };
  }
  if (target === "mask.radius") return cloneJsonSchema(radiusSchema);
  return null;
}

function isAspectRatioString(value: string): boolean {
  const match = value.match(/^\s*(\d+(?:\.\d+)?)\s*\/\s*(\d+(?:\.\d+)?)\s*$/);
  if (!match) return false;
  const width = Number(match[1]);
  const height = Number(match[2]);
  return (
    Number.isFinite(width) && width > 0 && Number.isFinite(height) && height > 0
  );
}

function cloneJsonSchema(value: unknown): Record<string, unknown> | null {
  const record = asRecord(value);
  return record
    ? (JSON.parse(JSON.stringify(record)) as Record<string, unknown>)
    : null;
}

function childRecord(
  value: Record<string, unknown> | null,
  key: string,
): Record<string, unknown> {
  return asRecord(value?.[key]) ?? {};
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}
