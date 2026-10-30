import { z } from "zod/v3";
import {
  editorTransitionSchema,
  editorLinkedGroupSchema,
} from "@/lib/editor/composition-schema";
const id = z
  .string()
  .min(1)
  .max(191)
  .refine(
    (value) => !["__proto__", "prototype", "constructor"].includes(value),
    "Reserved composition identity.",
  );
const frame = z.number().int().min(0).max(2_592_000);
export const compositionCommandSchemas = [
  z
    .object({
      type: z.literal("setTransition"),
      transition: editorTransitionSchema.extend({
        audio: editorTransitionSchema.shape.audio.default("pictureOnly"),
      }),
    })
    .strict(),
  z.object({ type: z.literal("removeTransition"), id }).strict(),
  z
    .object({
      type: z.literal("setLinkedGroup"),
      group: editorLinkedGroupSchema,
    })
    .strict(),
  z.object({ type: z.literal("removeLinkedGroup"), id }).strict(),
  z.object({ type: z.literal("moveLinkedGroup"), id, from: frame }).strict(),
  z
    .object({
      type: z.literal("duplicateLinkedGroup"),
      id,
      newGroupId: id,
      itemIds: z.record(id, id),
      from: frame,
    })
    .strict(),
] as const;
export const compositionCommandSchema = z.discriminatedUnion(
  "type",
  compositionCommandSchemas,
);
export type VideoCompositionCommand = z.infer<typeof compositionCommandSchema>;
const types = new Set(
  compositionCommandSchemas.map((schema) => schema.shape.type.value),
);
export function isVideoCompositionCommand(command: {
  type: string;
}): command is VideoCompositionCommand {
  return types.has(command.type as VideoCompositionCommand["type"]);
}
