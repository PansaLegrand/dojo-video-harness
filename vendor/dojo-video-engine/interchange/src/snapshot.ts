import { z } from "zod/v3";
import {
  sceneSchema,
  validateScene,
  type SceneAsset,
  type SceneNode,
  type SceneStyle,
} from "@dojo-video-engine/schema";
import {
  INTERCHANGE_VERSION,
  MAX_DIMENSION,
  budgetsOf,
  caughtFailure,
  coordinateSchema,
  detachedJsonSchema,
  dimensionSchema,
  failure,
  idSchema,
  interchangeDiagnosticSchema,
  interchangeFailureSchema,
  pushDiagnostic,
  sizeSchema,
  zodFailure,
  type InterchangeBudgets,
  type InterchangeDiagnostic,
  type InterchangeFailure,
} from "./common";

const safeCssTokenSchema = z
  .string()
  .regex(
    /^(?![\s\S]*[;{}@])(?![\s\S]*(?:[uU][rR][lL]|[vV][aA][rR]|[cC][aA][lL][cC]|[eE][xX][pP][rR][eE][sS][sS][iI][oO][nN])\s*\()[\s\S]{1,256}$/,
    "Static CSS values cannot contain declarations, dynamic functions, URLs, variables, or at-rules.",
  );
const safeImageSourceSchema = z
  .string()
  .min(1)
  .max(4_096)
  .regex(
    /^(?:https?:\/\/|data:image\/(?:png|jpeg|webp|gif);base64,|memory:|asset:|\/|\.\.?(?:\/|$))/,
    "Image sources must use http:, https:, data:image, memory:, asset:, or a relative path.",
  );
const boxSchema = z
  .object({
    x: coordinateSchema,
    y: coordinateSchema,
    width: sizeSchema,
    height: sizeSchema,
  })
  .strict();
const boxStyleSchema = z
  .object({
    backgroundColor: safeCssTokenSchema.optional(),
    opacity: z.number().finite().min(0).max(1).optional(),
    borderRadius: z
      .number()
      .finite()
      .nonnegative()
      .max(MAX_DIMENSION)
      .optional(),
  })
  .strict();
const textStyleSchema = boxStyleSchema.extend({
  color: safeCssTokenSchema.optional(),
  fontFamily: safeCssTokenSchema.optional(),
  fontSize: z.number().finite().positive().max(4_096).optional(),
  fontWeight: z
    .union([
      z.number().finite().min(1).max(1_000),
      z.enum(["normal", "bold", "bolder", "lighter"]),
    ])
    .optional(),
  textAlign: z.enum(["left", "center", "right"]).optional(),
  direction: z.enum(["ltr", "rtl", "inherit"]).optional(),
});
const imageStyleSchema = z
  .object({
    opacity: z.number().finite().min(0).max(1).optional(),
    borderRadius: z
      .number()
      .finite()
      .nonnegative()
      .max(MAX_DIMENSION)
      .optional(),
    objectFit: z
      .enum(["contain", "cover", "fill", "none", "scale-down"])
      .optional(),
  })
  .strict();
const elementBase = { id: idSchema, box: boxSchema };

const divElementSchema = z
  .object({
    ...elementBase,
    tag: z.literal("div"),
    style: boxStyleSchema.optional(),
  })
  .strict();
const spanElementSchema = z
  .object({
    ...elementBase,
    tag: z.literal("span"),
    text: z.string().max(100_000),
    style: textStyleSchema.optional(),
  })
  .strict();
const paragraphElementSchema = z
  .object({
    ...elementBase,
    tag: z.literal("p"),
    text: z.string().max(100_000),
    style: textStyleSchema.optional(),
  })
  .strict();
const imageElementSchema = z
  .object({
    ...elementBase,
    tag: z.literal("img"),
    src: safeImageSourceSchema,
    alt: z.string().max(512).optional(),
    style: imageStyleSchema.optional(),
  })
  .strict();

export const staticSnapshotElementSchema = z.discriminatedUnion("tag", [
  divElementSchema,
  spanElementSchema,
  paragraphElementSchema,
  imageElementSchema,
]);

export const staticHtmlSnapshotV1Schema = z
  .object({
    snapshotVersion: z.literal(INTERCHANGE_VERSION),
    sanitized: z.literal(true),
    width: dimensionSchema,
    height: dimensionSchema,
    fps: z.number().int().positive().max(1_000),
    durationFrames: z.number().int().positive().max(86_400_000),
    elements: z.array(staticSnapshotElementSchema).max(2_048),
  })
  .strict();
export type StaticHtmlSnapshotV1 = z.infer<typeof staticHtmlSnapshotV1Schema>;

const importSuccessSchema = z
  .object({
    ok: z.literal(true),
    kind: z.literal("dojo-video-engine.static-snapshot-import"),
    version: z.literal(INTERCHANGE_VERSION),
    scene: sceneSchema,
    diagnostics: z.array(interchangeDiagnosticSchema).max(8_192),
  })
  .strict();
export type StaticSnapshotImportResult =
  | z.infer<typeof importSuccessSchema>
  | InterchangeFailure;

export function staticHtmlSnapshotV1JsonSchema(): Record<string, unknown> {
  return detachedJsonSchema(staticHtmlSnapshotV1Schema);
}

export function staticSnapshotImportResultJsonSchema(): Record<
  string,
  unknown
> {
  return detachedJsonSchema(
    z.union([importSuccessSchema, interchangeFailureSchema]),
  );
}

/**
 * Import a host-produced static box snapshot. This is deliberately not an HTML
 * parser: executable markup and dynamic layout have no representation here.
 */
export function importStaticHtmlSnapshot(
  input: unknown,
  options: { budgets?: Partial<InterchangeBudgets> } = {},
): StaticSnapshotImportResult {
  try {
    const parsed = staticHtmlSnapshotV1Schema.safeParse(input);
    if (!parsed.success) return zodFailure(parsed.error);
    const budgetResult = budgetsOf(options.budgets);
    if (!budgetResult.ok) return budgetResult;
    const budgets = budgetResult.budgets;
    if (parsed.data.elements.length > budgets.maxClips) {
      return failure(
        "budget_exceeded",
        ["elements"],
        `Snapshot has ${parsed.data.elements.length} elements; maximum is ${budgets.maxClips}.`,
      );
    }
    const characters = parsed.data.elements.reduce(
      (total, element) =>
        total +
        (element.tag === "span" || element.tag === "p"
          ? element.text.length
          : 0),
      0,
    );
    if (characters > budgets.maxTextCharacters) {
      return failure(
        "budget_exceeded",
        ["elements"],
        `Snapshot text has ${characters} characters; maximum is ${budgets.maxTextCharacters}.`,
      );
    }
    const images = parsed.data.elements.filter(
      (element) => element.tag === "img",
    ).length;
    if (images > budgets.maxAssets) {
      return failure(
        "budget_exceeded",
        ["elements"],
        `Snapshot has ${images} images; maximum is ${budgets.maxAssets}.`,
      );
    }
    if (
      parsed.data.durationFrames / parsed.data.fps >
      budgets.maxDurationSeconds
    ) {
      return failure(
        "budget_exceeded",
        ["durationFrames"],
        `Snapshot duration exceeds ${budgets.maxDurationSeconds} seconds.`,
      );
    }
    const ids = new Set<string>();
    for (const [index, element] of parsed.data.elements.entries()) {
      if (ids.has(element.id)) {
        return failure(
          "invalid_input",
          ["elements", index, "id"],
          `Duplicate element id ${element.id}.`,
        );
      }
      ids.add(element.id);
    }

    const assets: Record<string, SceneAsset> = {};
    const nodes: SceneNode[] = [];
    for (const element of parsed.data.elements) {
      const style: SceneStyle = {
        position: "absolute",
        left: element.box.x,
        top: element.box.y,
        width: element.box.width,
        height: element.box.height,
        ...(element.style ?? {}),
      };
      if (element.tag === "img") {
        const assetId = `snapshot.${element.id}`;
        assets[assetId] = {
          id: assetId,
          type: "image",
          src: element.src,
        };
        nodes.push({
          id: element.id,
          type: "img",
          assetId,
          from: 0,
          duration: parsed.data.durationFrames,
          style,
        });
      } else if (element.tag === "div") {
        nodes.push({
          id: element.id,
          type: "div",
          from: 0,
          duration: parsed.data.durationFrames,
          style,
        });
      } else {
        nodes.push({
          id: element.id,
          type: "text",
          text: element.text,
          from: 0,
          duration: parsed.data.durationFrames,
          style,
        });
      }
    }
    const validation = validateScene({
      schemaVersion: 1,
      width: parsed.data.width,
      height: parsed.data.height,
      fps: parsed.data.fps,
      duration: parsed.data.durationFrames,
      assets,
      nodes,
    });
    if (!validation.ok) {
      return failure("invalid_input", ["scene"], validation.errors.join(" "));
    }
    const diagnostics: InterchangeDiagnostic[] = [];
    if (parsed.data.elements.length) {
      pushDiagnostic(diagnostics, budgets, {
        severity: "info",
        code: "snapshot_flattened",
        path: ["elements"],
        message:
          "The sanitized static snapshot was imported as explicit absolute Scene boxes.",
      });
    }
    return {
      ok: true,
      kind: "dojo-video-engine.static-snapshot-import",
      version: 1,
      scene: validation.scene,
      diagnostics: structuredClone(diagnostics),
    };
  } catch (error) {
    return caughtFailure(error);
  }
}
