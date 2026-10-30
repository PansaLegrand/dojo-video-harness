import { z } from "zod/v3";
const identity = z
  .string()
  .min(1)
  .max(191)
  .refine(
    (value) => !["__proto__", "prototype", "constructor"].includes(value),
    "Reserved composition identity.",
  );
/** No defaults: documents that predate composition records retain their exact hash. */
export const editorTransitionSchema = z
  .object({
    id: identity,
    fromItemId: identity,
    toItemId: identity,
    kind: z.enum(["dissolve", "dipToBlack"]),
    durationFrames: z.number().int().min(2).max(2_592_000),
    audio: z.enum(["pictureOnly", "crossfade"]),
  })
  .strict();
export const editorLinkedGroupSchema = z
  .object({
    id: identity,
    name: z.string().trim().min(1).max(100).optional(),
    itemIds: z
      .array(identity)
      .min(2)
      .max(500)
      .refine(
        (ids) => new Set(ids).size === ids.length,
        "A linked group must contain unique clip IDs.",
      ),
  })
  .strict();
export const editorTransitionsSchema = z
  .record(identity, editorTransitionSchema)
  .refine(
    (value) => Object.keys(value).length > 0,
    "Omit an empty transition record.",
  )
  .optional();
export const editorLinkedGroupsSchema = z
  .record(identity, editorLinkedGroupSchema)
  .refine(
    (value) => Object.keys(value).length > 0,
    "Omit an empty linked-group record.",
  )
  .optional();
export type EditorTransition = z.infer<typeof editorTransitionSchema>;
export type EditorLinkedGroup = z.infer<typeof editorLinkedGroupSchema>;
