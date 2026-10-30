import { z } from "zod/v3";
import { zodToJsonSchema } from "zod-to-json-schema";

export const LAYOUT_CONTRACT_VERSION = 1 as const;
export const LAYOUT_ROOT = "$root" as const;
export const MAX_LAYOUT_GRID_INDEX = 4_095 as const;

const finite = z.number().finite();
const nonnegative = finite.nonnegative();
const weight = finite.min(0).max(1_000);
const nonnegativeLengthString = z
  .string()
  .regex(
    /^(?:\d+(?:\.\d+)?|\.\d+)(?:px|%)$/,
    "Expected a non-negative px or % length.",
  );
const signedLengthString = z
  .string()
  .regex(
    /^-?(?:\d+(?:\.\d+)?|\.\d+)(?:px|%)$/,
    "Expected a finite px or % length.",
  );

export const layoutLengthSchema = z.union([
  nonnegative,
  nonnegativeLengthString,
]);
export const layoutOffsetSchema = z.union([finite, signedLengthString]);
export const layoutSizingSchema = z.union([
  z.literal("hug"),
  z.literal("fill"),
  layoutLengthSchema,
]);

const insetObjectSchema = z
  .object({
    top: layoutLengthSchema.optional(),
    right: layoutLengthSchema.optional(),
    bottom: layoutLengthSchema.optional(),
    left: layoutLengthSchema.optional(),
    x: layoutLengthSchema.optional(),
    y: layoutLengthSchema.optional(),
  })
  .strict();

export const layoutInsetsSchema = z.union([
  layoutLengthSchema,
  insetObjectSchema,
]);

export const layoutTrackSchema = z
  .object({
    size: layoutSizingSchema,
    grow: weight.optional(),
    shrink: weight.optional(),
    min: layoutLengthSchema.optional(),
    max: layoutLengthSchema.optional(),
  })
  .strict();

export const layoutConstraintSchema = z.discriminatedUnion("kind", [
  z
    .object({
      kind: z.literal("align"),
      target: z.string().min(1).max(191),
      axis: z.enum(["x", "y"]),
      edge: z.enum(["start", "center", "end"]),
    })
    .strict(),
  z
    .object({
      kind: z.enum(["after", "before"]),
      target: z.string().min(1).max(191),
      axis: z.enum(["x", "y"]),
      gap: layoutLengthSchema.optional(),
    })
    .strict(),
  z
    .object({
      kind: z.literal("match"),
      target: z.string().min(1).max(191),
      dimension: z.enum(["width", "height"]),
    })
    .strict(),
]);

export const overlayAnchors = [
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

export const layoutItemSchema = z
  .object({
    id: z.string().min(1).max(191),
    width: layoutSizingSchema.optional(),
    height: layoutSizingSchema.optional(),
    minWidth: layoutLengthSchema.optional(),
    minHeight: layoutLengthSchema.optional(),
    maxWidth: layoutLengthSchema.optional(),
    maxHeight: layoutLengthSchema.optional(),
    aspectRatio: finite.positive().max(10_000).optional(),
    grow: weight.optional(),
    shrink: weight.optional(),
    margin: layoutInsetsSchema.optional(),
    alignSelf: z.enum(["start", "center", "end", "stretch"]).optional(),
    justifySelf: z.enum(["start", "center", "end", "stretch"]).optional(),
    anchor: z.enum(overlayAnchors).optional(),
    offsetX: layoutOffsetSchema.optional(),
    offsetY: layoutOffsetSchema.optional(),
    grid: z
      .object({
        row: z
          .number()
          .int()
          .nonnegative()
          .max(MAX_LAYOUT_GRID_INDEX)
          .optional(),
        column: z
          .number()
          .int()
          .nonnegative()
          .max(MAX_LAYOUT_GRID_INDEX)
          .optional(),
        rowSpan: z.number().int().min(1).max(64).optional(),
        columnSpan: z.number().int().min(1).max(64).optional(),
      })
      .strict()
      .optional(),
    constraints: z.array(layoutConstraintSchema).max(8).optional(),
  })
  .strict();

const containerCommon = {
  gap: layoutLengthSchema.optional(),
  rowGap: layoutLengthSchema.optional(),
  columnGap: layoutLengthSchema.optional(),
  padding: layoutInsetsSchema.optional(),
  safeArea: layoutInsetsSchema.optional(),
} as const;

export const stackLayoutSchema = z
  .object({
    kind: z.literal("stack"),
    axis: z.enum(["row", "column"]),
    wrap: z.enum(["nowrap", "wrap"]).optional(),
    justify: z
      .enum([
        "start",
        "center",
        "end",
        "space-between",
        "space-around",
        "space-evenly",
      ])
      .optional(),
    align: z.enum(["start", "center", "end", "stretch"]).optional(),
    alignContent: z
      .enum([
        "start",
        "center",
        "end",
        "stretch",
        "space-between",
        "space-around",
        "space-evenly",
      ])
      .optional(),
    ...containerCommon,
  })
  .strict();

export const gridLayoutSchema = z
  .object({
    kind: z.literal("grid"),
    columns: z.array(layoutTrackSchema).min(1).max(64),
    rows: z.array(layoutTrackSchema).min(1).max(64).optional(),
    autoFlow: z.enum(["row", "column"]).optional(),
    justifyItems: z.enum(["start", "center", "end", "stretch"]).optional(),
    alignItems: z.enum(["start", "center", "end", "stretch"]).optional(),
    ...containerCommon,
  })
  .strict();

export const overlayLayoutSchema = z
  .object({
    kind: z.literal("overlay"),
    defaultAnchor: z.enum(overlayAnchors).optional(),
    padding: layoutInsetsSchema.optional(),
    safeArea: layoutInsetsSchema.optional(),
  })
  .strict();

export const layoutContainerSchema = z.discriminatedUnion("kind", [
  stackLayoutSchema,
  gridLayoutSchema,
  overlayLayoutSchema,
]);

export const layoutPlanSchema = z
  .object({
    layoutVersion: z.literal(LAYOUT_CONTRACT_VERSION),
    containerId: z.string().min(1).max(191).default(LAYOUT_ROOT),
    layout: layoutContainerSchema,
    items: z.array(layoutItemSchema).max(4_096),
  })
  .strict()
  .superRefine((plan, ctx) => {
    if (
      plan.layout.kind === "grid" &&
      plan.layout.autoFlow === "column" &&
      plan.layout.rows === undefined
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        params: { layoutCode: "column_flow_rows_required" },
        path: ["layout", "rows"],
        message:
          "Column auto-flow requires explicit rows so geometry never depends on a host budget.",
      });
    }
    const ids = new Set<string>();
    for (let index = 0; index < plan.items.length; index += 1) {
      const item = plan.items[index]!;
      if (ids.has(item.id)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          params: { layoutCode: "duplicate_item" },
          path: ["items", index, "id"],
          message: `Layout item id ${JSON.stringify(item.id)} is duplicated.`,
        });
      }
      ids.add(item.id);
      if (plan.layout.kind !== "grid" && item.grid !== undefined) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          params: { layoutCode: "field_not_consumed" },
          path: ["items", index, "grid"],
          message: "grid placement only applies to grid layouts.",
        });
      }
      if (
        plan.layout.kind !== "overlay" &&
        (item.anchor !== undefined ||
          item.offsetX !== undefined ||
          item.offsetY !== undefined ||
          item.constraints !== undefined)
      ) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          params: { layoutCode: "field_not_consumed" },
          path: ["items", index],
          message:
            "anchor, offsets, and sibling constraints only apply to overlay layouts.",
        });
      }
      if (plan.layout.kind === "stack" && item.justifySelf !== undefined) {
        ignoredItemField(ctx, index, "justifySelf", "stack");
      }
      if (
        plan.layout.kind === "grid" &&
        (item.grow !== undefined || item.shrink !== undefined)
      ) {
        if (item.grow !== undefined)
          ignoredItemField(ctx, index, "grow", "grid");
        if (item.shrink !== undefined)
          ignoredItemField(ctx, index, "shrink", "grid");
      }
      if (plan.layout.kind === "overlay") {
        for (const field of [
          "grow",
          "shrink",
          "alignSelf",
          "justifySelf",
        ] as const) {
          if (item[field] !== undefined)
            ignoredItemField(ctx, index, field, "overlay");
        }
      }
    }
  });

function ignoredItemField(
  ctx: z.RefinementCtx,
  index: number,
  field: string,
  kind: string,
): void {
  ctx.addIssue({
    code: z.ZodIssueCode.custom,
    params: { layoutCode: "field_not_consumed" },
    path: ["items", index, field],
    message: `${field} is not consumed by ${kind} layout; remove it instead of relying on ignored input.`,
  });
}

export type LayoutLength = z.infer<typeof layoutLengthSchema>;
export type LayoutOffset = z.infer<typeof layoutOffsetSchema>;
export type LayoutSizing = z.infer<typeof layoutSizingSchema>;
export type LayoutInsetsInput = z.infer<typeof layoutInsetsSchema>;
export type LayoutTrack = z.infer<typeof layoutTrackSchema>;
export type LayoutConstraint = z.infer<typeof layoutConstraintSchema>;
export type LayoutItem = z.infer<typeof layoutItemSchema>;
export type StackLayout = z.infer<typeof stackLayoutSchema>;
export type GridLayout = z.infer<typeof gridLayoutSchema>;
export type OverlayLayout = z.infer<typeof overlayLayoutSchema>;
export type LayoutContainer = z.infer<typeof layoutContainerSchema>;
export type LayoutPlan = z.infer<typeof layoutPlanSchema>;

export type LayoutPlanValidationIssue = {
  path: Array<string | number>;
  code: string;
  message: string;
};

export type LayoutPlanValidationResult =
  | { ok: true; plan: LayoutPlan }
  | { ok: false; issues: LayoutPlanValidationIssue[] };

/** Validates, normalizes, and defensively clones a flat Layout Contract plan. */
export function validateLayoutPlan(input: unknown): LayoutPlanValidationResult {
  const result = layoutPlanSchema.safeParse(input);
  if (!result.success) {
    return {
      ok: false,
      issues: result.error.issues.map((issue) => ({
        path: [...issue.path],
        code:
          issue.code === z.ZodIssueCode.custom &&
          typeof issue.params?.layoutCode === "string"
            ? issue.params.layoutCode
            : issue.code,
        message: issue.message,
      })),
    };
  }
  return { ok: true, plan: structuredClone(result.data) };
}

const generatedLayoutPlanJsonSchema = Object.freeze(
  decorateLayoutPlanJsonSchema(
    zodToJsonSchema(layoutPlanSchema, {
      name: "DojoVideoEngineLayoutPlanV1",
      target: "jsonSchema7",
      $refStrategy: "none",
    }) as Record<string, unknown>,
  ),
);

/** Detached draft-07 schema suitable for function tools and host validation. */
export function layoutPlanJsonSchema(): Record<string, unknown> {
  return structuredClone(generatedLayoutPlanJsonSchema);
}

/**
 * Zod refinements do not appear in generated JSON Schema automatically.
 * Draft-07 can encode kind-specific forbidden fields, so add those conditions
 * here. Uniqueness by an object's `id` value is not expressible in draft-07;
 * callers must still run validateLayoutPlan() before compilation.
 */
function decorateLayoutPlanJsonSchema(
  schema: Record<string, unknown>,
): Record<string, unknown> {
  const definitions = schema.definitions as
    | Record<string, Record<string, unknown>>
    | undefined;
  const root = definitions?.DojoVideoEngineLayoutPlanV1;
  if (!root)
    throw new Error(
      "Generated LayoutPlan JSON Schema lost its root definition.",
    );
  const condition = (kind: string, forbidden: string[]) => ({
    if: {
      properties: {
        layout: {
          properties: { kind: { const: kind } },
          required: ["kind"],
        },
      },
      required: ["layout"],
    },
    then: {
      properties: {
        items: {
          items: {
            not: { anyOf: forbidden.map((field) => ({ required: [field] })) },
          },
        },
      },
    },
  });
  root.allOf = [
    condition("stack", [
      "grid",
      "anchor",
      "offsetX",
      "offsetY",
      "constraints",
      "justifySelf",
    ]),
    condition("grid", [
      "anchor",
      "offsetX",
      "offsetY",
      "constraints",
      "grow",
      "shrink",
    ]),
    condition("overlay", [
      "grid",
      "grow",
      "shrink",
      "alignSelf",
      "justifySelf",
    ]),
    {
      if: {
        properties: {
          layout: {
            properties: {
              kind: { const: "grid" },
              autoFlow: { const: "column" },
            },
            required: ["kind", "autoFlow"],
          },
        },
        required: ["layout"],
      },
      then: {
        properties: {
          layout: { required: ["rows"] },
        },
      },
    },
  ];
  return schema;
}
