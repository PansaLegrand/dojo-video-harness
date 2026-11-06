import { z } from "zod/v3";
import { zodToJsonSchema } from "zod-to-json-schema";
import { sceneNodeSchema, styleSchema } from "@dojo-video-engine/schema";
import { motionControlPatchSchema } from "@/lib/motion-graphics/catalog";
import {
  captionCueSchema,
  editorCaptionSchema,
  editorFormatSchema,
  editorItemSchema,
  editorTrackSchema,
} from "@/lib/editor/document";
import { videoProjectDocumentSchema } from "./document";
import {
  VIDEO_PROJECT_EDITABLE_FIELDS,
  videoProjectCommandSchema,
  videoProjectTargetSchema,
  type VideoProjectTarget,
} from "./commands";
import { NATIVE_TRANSCRIPT_SEARCH_LIMITS } from "./agent-transcript-search";
import { nativeClarificationSchema } from "./agent-authoring";
import { editorCapabilityInputSchema } from "./capabilities";

const id = z.string().min(1).max(191);
export const nativeGraphicSchema = z
  .object({
    type: z.literal("insertGraphic"),
    itemId: id,
    trackId: id,
    name: z.string().max(500),
    node: z.record(z.unknown()),
  })
  .strict();
export const nativeSvgSchema = nativeGraphicSchema
  .omit({ node: true })
  .extend({
    type: z.literal("insertSvg"),
    svg: z.string().min(1).max(128_000),
    from: z.number().int().nonnegative(),
    duration: z.number().int().positive(),
  })
  .strict();
const motionEditSchema = z
  .object({
    type: z.literal("updateMotionGraphic"),
    itemId: id,
    patch: motionControlPatchSchema,
    imageAssetId: id.nullable().optional(),
  })
  .strict();
const captionsSchema = z
  .object({
    type: z.literal("captionSource"),
    sourceItemId: id,
    evidenceId: id,
    itemId: id,
    trackId: id,
    preset: z.string().max(64).optional(),
  })
  .strict();
const anchorSchema = z
  .object({
    type: z.literal("anchorSpeech"),
    id,
    itemId: id,
    sourceItemId: id,
    evidenceId: id,
    wordIds: z.array(id).min(1).max(500),
  })
  .strict();
const speechCutSchema = z
  .object({
    type: z.literal("cutSpeech"),
    sourceItemId: id,
    evidenceId: id,
    wordIds: z.array(id).min(1).max(500),
    mode: z.enum(["remove", "keep"]),
  })
  .strict();
const capabilitySchema = z
  .object({
    type: z.literal("applyCapability"),
    action: editorCapabilityInputSchema,
  })
  .strict();
const specialOperations = [
  nativeSvgSchema,
  nativeGraphicSchema,
  motionEditSchema,
  captionsSchema,
  anchorSchema,
  speechCutSchema,
  capabilitySchema,
] as const;

/** Same canonical model validator used before schema-assisted generation. */
export const nativeAgentModelResultSchema = z
  .object({
    summary: z.string().min(1).max(4000),
    outcome: z.enum(["proposal", "answer", "needs_input"]).default("proposal"),
    commands: z
      .array(z.union([...specialOperations, videoProjectCommandSchema]))
      .max(100),
    clarification: nativeClarificationSchema.optional(),
  })
  .strict()
  .refine(
    (result) =>
      result.outcome === "proposal"
        ? result.commands.length > 0
        : result.commands.length === 0,
    "Only editing proposals contain commands.",
  )
  .refine(
    (result) => !result.clarification || result.outcome === "needs_input",
    "Clarification questions cannot accompany editing commands.",
  );

export const NATIVE_AGENT_HOST_ONLY_OPERATIONS = [
  "addEvidence",
  "addSource",
  "bindSource",
  "bindAsset",
] as const;
type JsonSchema = Record<string, unknown>;
export type NativeAgentOperationDescriptor = {
  name: string;
  parameters: JsonSchema;
  units: Record<string, string>;
  example?: Record<string, unknown>;
};

function unwrap(schema: z.ZodTypeAny): z.ZodTypeAny {
  if (schema instanceof z.ZodEffects) return unwrap(schema.innerType());
  if (schema instanceof z.ZodOptional || schema instanceof z.ZodNullable)
    return unwrap(schema.unwrap());
  if (schema instanceof z.ZodDefault) return unwrap(schema.removeDefault());
  if (schema instanceof z.ZodLazy) return unwrap(schema.schema);
  return schema;
}

/** Keep recursive nodes/records shallow; exact runtime validation is never relaxed. */
function shallowSchema(input: z.ZodTypeAny, depth = 0): JsonSchema {
  if (input instanceof z.ZodEffects)
    return shallowSchema(input.innerType(), depth);
  if (input instanceof z.ZodOptional)
    return shallowSchema(input.unwrap(), depth);
  if (input instanceof z.ZodDefault)
    return shallowSchema(input.removeDefault(), depth);
  if (input instanceof z.ZodNullable)
    return { anyOf: [shallowSchema(input.unwrap(), depth), { type: "null" }] };
  const schema = unwrap(input);
  if (schema instanceof z.ZodObject) {
    if (depth >= 2)
      return {
        type: "object",
        description: "Native object; checked during host replay.",
      };
    const properties = Object.fromEntries(
      Object.entries(schema.shape as Record<string, z.ZodTypeAny>).map(
        ([key, value]) => [key, shallowSchema(value, depth + 1)],
      ),
    );
    const required = Object.entries(
      schema.shape as Record<string, z.ZodTypeAny>,
    )
      .filter(([, value]) => !value.isOptional())
      .map(([key]) => key);
    return {
      type: "object",
      properties,
      required,
      additionalProperties: schema._def.unknownKeys !== "strict",
    };
  }
  if (schema instanceof z.ZodRecord)
    return {
      type: "object",
      description:
        "A native keyed record; keys and values are checked during host replay.",
    };
  if (schema instanceof z.ZodArray)
    return {
      type: "array",
      items: shallowSchema(schema.element, depth + 1),
      ...(schema._def.minLength
        ? { minItems: schema._def.minLength.value }
        : {}),
      ...(schema._def.maxLength
        ? { maxItems: schema._def.maxLength.value }
        : {}),
    };
  if (schema instanceof z.ZodDiscriminatedUnion)
    return {
      anyOf: schema.options.map((option: z.ZodTypeAny) =>
        shallowSchema(option, depth),
      ),
    };
  if (schema instanceof z.ZodUnion) {
    // jsonValueSchema is a recursive union. Do not inline an unbounded engine schema.
    if (
      schema.options.some(
        (option: z.ZodTypeAny) =>
          option instanceof z.ZodArray ||
          option instanceof z.ZodRecord ||
          option instanceof z.ZodLazy,
      )
    )
      return {
        description: "A JSON value matching the target property's native type.",
      };
    return {
      anyOf: schema.options.map((option: z.ZodTypeAny) =>
        shallowSchema(option, depth),
      ),
    };
  }
  const converted = zodToJsonSchema(schema, {
    $refStrategy: "none",
  }) as JsonSchema;
  const { $schema: _meta, ...result } = converted;
  return result;
}

export function nativeAgentPropertyUnit(
  kind: VideoProjectTarget["kind"],
  path: readonly string[],
): string | undefined {
  const key = path.at(-1);
  if (kind === "cue" && ["startMs", "endMs"].includes(key ?? ""))
    return "milliseconds relative to the caption item";
  if (kind === "format" && key === "fps") return "frames per second";
  if (
    (kind === "format" && key === "durationInFrames") ||
    (kind === "node" && ["from", "duration"].includes(key ?? ""))
  )
    return "integer composition frames; nested nodes use parent-local frames";
  if (
    kind === "node" &&
    ["videoStartTime", "audioStartTime"].includes(key ?? "")
  )
    return "source seconds";
  if (kind === "node" && key === "playbackRate")
    return "source-time multiplier";
  if (kind === "node" && ["volume", "opacity"].includes(key ?? ""))
    return "ratio from 0 to 1";
  if (kind === "node" && path[0] === "animations")
    return "keyframe positions are integer node-local frames";
  if (kind === "project" && path[0] === "markers")
    return "integer composition frames";
  if (kind === "format" && ["width", "height"].includes(key ?? ""))
    return "composition pixels";
  if (
    path[0] === "style" &&
    /width|height|left|right|top|bottom|fontSize|padding|margin|radius|gap/i.test(
      key ?? "",
    )
  )
    return "composition pixels for numbers; supported CSS lengths may also be used";
  return undefined;
}

const OPERATION_UNITS: Record<string, Record<string, string>> = {
  splitItem: { frame: "integer composition frame" },
  moveItem: { from: "integer composition frame" },
  trimItem: {
    from: "integer composition frame",
    duration: "positive integer frame count",
  },
  removeGap: { frame: "integer composition frame" },
  removeTimelineRange: {
    from: "integer composition frame",
    duration: "positive integer frame count",
  },
  updateMotionGraphic: {
    "patch.duration": "seconds, 3–20",
    "patch.intensity": "ratio, 0.25–1.5",
  },
  cutSpeech: {
    wordIds: "immutable contiguous source word IDs; host computes timing",
  },
  anchorSpeech: {
    wordIds: "immutable contiguous source word IDs; host computes timing",
  },
};
let operationDescriptors: NativeAgentOperationDescriptor[] | undefined;

export function nativeAgentOperationDescriptors(): readonly NativeAgentOperationDescriptor[] {
  if (operationDescriptors) return operationDescriptors;
  const raw = videoProjectCommandSchema.innerType();
  const operations = [...specialOperations, ...raw.options].filter(
    (schema) =>
      !(NATIVE_AGENT_HOST_ONLY_OPERATIONS as readonly string[]).includes(
        schema.shape.type.value,
      ),
  );
  operationDescriptors = operations.map((schema) => {
    const name = schema.shape.type.value as string;
    const parameters = shallowSchema(schema);
    const example: Record<string, unknown> | undefined =
      name === "set"
        ? {
            type: "set",
            target: {
              kind: "node",
              itemId: "selected-item",
              nodeId: "selected-node",
            },
            path: ["style", "color"],
            value: "#ffffff",
          }
        : name === "clear"
          ? {
              type: "clear",
              target: {
                kind: "node",
                itemId: "selected-item",
                nodeId: "selected-node",
              },
              path: ["style", "color"],
            }
          : name === "trimItem"
            ? { type: "trimItem", id: "selected-item", from: 30, duration: 60 }
            : undefined;
    return {
      name,
      parameters,
      units: OPERATION_UNITS[name] ?? {},
      ...(example ? { example } : {}),
    };
  });
  return operationDescriptors;
}

function targetSchema(kind: VideoProjectTarget["kind"]): z.AnyZodObject {
  const definitions: Record<VideoProjectTarget["kind"], z.ZodTypeAny> = {
    node: sceneNodeSchema,
    item: editorItemSchema,
    caption: editorCaptionSchema,
    cue: captionCueSchema,
    track: editorTrackSchema,
    format: editorFormatSchema,
    project: videoProjectDocumentSchema,
  };
  return unwrap(definitions[kind]) as z.AnyZodObject;
}

/** A leaf validator is shared by descriptions and early, localized value errors. */
export function nativeAgentPropertySchema(
  kind: VideoProjectTarget["kind"],
  path: readonly string[],
): z.ZodTypeAny | undefined {
  if (!VIDEO_PROJECT_EDITABLE_FIELDS[kind]?.includes(path[0] ?? ""))
    return undefined;
  let schema: z.ZodTypeAny | undefined = targetSchema(kind);
  for (const key of path) {
    const owner = unwrap(schema!);
    schema =
      owner instanceof z.ZodObject
        ? owner.shape[key]
        : owner instanceof z.ZodRecord
          ? owner.valueSchema
          : undefined;
    if (!schema) return undefined;
  }
  return schema;
}

export function nativeAgentTargetDescriptor(kind: VideoProjectTarget["kind"]) {
  const schema = targetSchema(kind);
  const fields = Object.fromEntries(
    VIDEO_PROJECT_EDITABLE_FIELDS[kind]
      .filter((key) => schema.shape[key])
      .map((key) => [
        key,
        {
          schema: shallowSchema(schema.shape[key], 2),
          unit: nativeAgentPropertyUnit(kind, [key]),
        },
      ]),
  );
  return {
    kind,
    fields,
    pathRules: { maxDepth: 8, arrayIndexes: false, clearUsesNull: false },
    ...(kind === "node" ? { styleKeys: Object.keys(styleSchema.shape) } : {}),
  };
}

export function nativeAgentDescriptorGuide(): string {
  const targets = (
    Object.keys(VIDEO_PROJECT_EDITABLE_FIELDS) as VideoProjectTarget["kind"][]
  ).map((kind) => {
    const descriptor = nativeAgentTargetDescriptor(kind);
    return `${kind} editable roots: ${Object.keys(descriptor.fields).join(", ")}. Units: ${
      Object.entries(descriptor.fields)
        .filter(([, value]) => value.unit)
        .map(([key, value]) => `${key}=${value.unit}`)
        .join("; ") || "native property types"
    }.`;
  });
  return `Native target constraints:\n${targets.join("\n")}\nPaths have 1–8 property names; use clear without value, never array-index mutation. Caption cues and cue words are complete explicit arrays; do not patch their numeric positions. Source words are never writable.\n${nativeAgentOperationDescriptors()
    .filter((value) => Object.keys(value.units).length)
    .map(
      (value) =>
        `${value.name}: ${Object.entries(value.units)
          .map(([path, unit]) => `${path}=${unit}`)
          .join("; ")}`,
    )
    .join("\n")}`;
}

/** Reference composite schemas so the existing bounded worker wire stays shallow. */
function flattenSchemaDefinitions(root: JsonSchema): JsonSchema {
  const definitions: Record<string, JsonSchema> = {};
  let serial = 0;
  const reference = (value: JsonSchema): JsonSchema => {
    if (!value.properties && !value.anyOf && !value.items) return value;
    const key = `NativeShape${serial++}`;
    definitions[key] = visit(value);
    return { $ref: `#/definitions/${key}` };
  };
  const visit = (value: JsonSchema): JsonSchema => ({
    ...value,
    ...(value.properties
      ? {
          properties: Object.fromEntries(
            Object.entries(value.properties as Record<string, JsonSchema>).map(
              ([key, child]) => [key, reference(child)],
            ),
          ),
        }
      : {}),
    ...(value.items ? { items: reference(value.items as JsonSchema) } : {}),
    ...(Array.isArray(value.anyOf)
      ? { anyOf: value.anyOf.map((child) => reference(child as JsonSchema)) }
      : {}),
  });
  for (const [key, value] of Object.entries(
    root.definitions as Record<string, JsonSchema>,
  ))
    definitions[key] = visit(value);
  const { definitions: _original, ...envelope } = root;
  return { ...visit(envelope), definitions };
}

const responseSchemas = new Map<string, JsonSchema>();
const compositionOperations = new Set([
  "setTransition",
  "removeTransition",
  "setLinkedGroup",
  "removeLinkedGroup",
  "moveLinkedGroup",
  "duplicateLinkedGroup",
]);
export function nativeAgentResponseSchema(
  options: { clarification?: boolean; composition?: boolean } = {},
): JsonSchema {
  const mode = options.clarification === true;
  const composition = mode || options.composition === true,
    cacheKey = `${mode}:${composition}`;
  if (responseSchemas.has(cacheKey)) return responseSchemas.get(cacheKey)!;
  const descriptors = nativeAgentOperationDescriptors().filter(
    (operation) =>
      (mode || operation.name !== "applyCapability") &&
      (composition || !compositionOperations.has(operation.name)),
  );
  const definitions = Object.fromEntries(
    descriptors.map((value) => [
      value.name,
      value.name === "set" || value.name === "clear"
        ? {
            ...value.parameters,
            properties: {
              ...(value.parameters.properties as Record<string, JsonSchema>),
              target: { $ref: "#/definitions/NativeTarget" },
            },
          }
        : value.parameters,
    ]),
  );
  definitions.NativeTarget = shallowSchema(videoProjectTargetSchema);
  const envelope = shallowSchema(nativeAgentModelResultSchema);
  const properties = envelope.properties as Record<string, JsonSchema>;
  if (mode)
    properties.clarification = shallowSchema(nativeClarificationSchema, -1);
  else delete properties.clarification;
  properties.outcome = {
    type: "string",
    enum: ["proposal", "answer", "needs_input", "retrieve_context"],
  };
  properties.retrieval = shallowSchema(
    z
      .object({
        snapshotHash: z.string().regex(/^sha256:[a-f0-9]{64}$/),
        query: z
          .string()
          .min(1)
          .max(NATIVE_TRANSCRIPT_SEARCH_LIMITS.queryChars),
        sourceItemIds: z.array(id).max(24).optional(),
        cursor: z.string().max(100).optional(),
      })
      .strict(),
  );
  properties.commands = {
    ...properties.commands,
    items: {
      anyOf: descriptors.map((value) => ({
        $ref: `#/definitions/${value.name}`,
      })),
    },
  };
  // Ask new model responses to spell out outcome, while the canonical validator
  // retains its historical default for persisted/replayed older responses.
  const responseSchema = flattenSchemaDefinitions({
    ...envelope,
    required: ["summary", "outcome", "commands"],
    definitions,
  });
  if (JSON.stringify(responseSchema).length > 24_000)
    throw new Error("Native response schema exceeds its model input budget.");
  responseSchemas.set(cacheKey, responseSchema);
  return responseSchema;
}

export function nativeAgentResponseFormat(
  provider: string,
  options: { clarification?: boolean; composition?: boolean } = {},
): Record<string, unknown> {
  return provider === "openai"
    ? {
        type: "json_schema",
        json_schema: {
          name: "native_video_commands_v1",
          strict: false,
          schema: nativeAgentResponseSchema(options),
        },
      }
    : { type: "json_object" };
}
