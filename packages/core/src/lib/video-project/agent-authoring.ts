import { z } from "zod/v3";
import type { VideoProjectCommand } from "./commands";

const id = z
  .string()
  .trim()
  .min(1)
  .max(191)
  .refine(
    (value) => !["__proto__", "prototype", "constructor"].includes(value),
    "Reserved identity.",
  );
const hash = z.string().regex(/^sha256:[a-f0-9]{64}$/);
const frame = z.number().int().min(0).max(2_592_000);
const itemIds = z
  .array(id)
  .min(1)
  .max(24)
  .refine(
    (ids) => new Set(ids).size === ids.length,
    "Scope IDs must be unique.",
  );

/** Optional for persisted V1 runs. New clients send one explicit authoring scope. */
export const nativeAgentScopeSchema = z.discriminatedUnion("kind", [
  z
    .object({
      kind: z.literal("selection"),
      itemIds,
      node: z.object({ itemId: id, nodeId: id }).strict().optional(),
    })
    .strict(),
  z
    .object({
      kind: z.literal("range"),
      fromFrame: frame,
      durationInFrames: frame.min(1),
    })
    .strict(),
  z.object({ kind: z.literal("project") }).strict(),
]);
export type NativeAgentScope = z.infer<typeof nativeAgentScopeSchema>;

export const nativeClarificationSchema = z
  .object({
    id,
    question: z.string().trim().min(1).max(1000),
    options: z
      .array(
        z
          .object({
            id,
            label: z.string().trim().min(1).max(160),
            targetItemIds: itemIds.optional(),
            scope: nativeAgentScopeSchema.optional(),
            value: z.string().max(500).optional(),
          })
          .strict(),
      )
      .min(2)
      .max(5)
      .optional(),
    allowText: z.boolean().optional(),
  })
  .strict()
  .refine(
    (value) =>
      !value.options ||
      new Set(value.options.map((option) => option.id)).size ===
        value.options.length,
    "Clarification options must have unique IDs.",
  )
  .refine(
    (value) => !!value.options?.length || value.allowText !== false,
    "The clarification must allow an answer.",
  );
export type NativeClarification = z.infer<typeof nativeClarificationSchema>;

export const nativeClarificationAnswerSchema = z
  .object({
    operationId: id,
    questionId: id,
    optionId: id.optional(),
    text: z.string().trim().min(1).max(1000).optional(),
    baseRevision: z.number().int().nonnegative(),
    baseHash: hash,
  })
  .strict()
  .refine(
    (value) =>
      Number(value.optionId !== undefined) +
        Number(value.text !== undefined) ===
      1,
    "Choose one answer or enter text.",
  );
export type NativeClarificationAnswer = z.infer<
  typeof nativeClarificationAnswerSchema
>;

export const nativeReviewBasisSchema = z
  .object({
    baseRevision: z.number().int().nonnegative(),
    baseHash: hash,
    proposalHash: hash,
    afterHash: hash,
  })
  .strict();
export type NativeReviewBasis = z.infer<typeof nativeReviewBasisSchema>;
export const nativeReviewRequestSchema = z
  .object({ baseRevision: z.number().int().nonnegative(), baseHash: hash })
  .strict();
export const nativeUndoRequestSchema = nativeReviewRequestSchema
  .extend({ operationId: id })
  .strict();

export const nativeReferenceSchema = z
  .object({
    runId: id,
    instruction: z.string().max(4000),
    summary: z.string().max(4000),
    changedItemIds: z.array(id).max(500),
    outcome: z.enum(["applied", "proposal", "answer", "needs_input"]),
    missingItemIds: z.array(id).max(500).optional(),
    baseRevision: z.number().int().nonnegative(),
    baseHash: hash,
  })
  .strict();
export type NativeAgentReference = z.infer<typeof nativeReferenceSchema>;

export const nativeAuthoringSchema = z
  .object({
    version: z.literal(1),
    scope: nativeAgentScopeSchema.optional(),
    reference: nativeReferenceSchema.optional(),
    clarification: z
      .object({
        parentRunId: id,
        questionId: id,
        question: z.string().min(1).max(1000),
        answer: z.string().min(1).max(1000),
        optionId: id.optional(),
      })
      .strict()
      .optional(),
  })
  .strict();
export type NativeAuthoring = z.infer<typeof nativeAuthoringSchema>;

export type NativeAffectedRange = {
  itemId: string;
  name: string;
  before: { from: number; duration: number } | null;
  after: { from: number; duration: number } | null;
  propagated: boolean;
};
export type NativeReviewDetails = {
  basis: NativeReviewBasis;
  commands: VideoProjectCommand[];
  impact: "direct" | "review";
  affected: NativeAffectedRange[];
  omittedAffectedCount: number;
  changedItemIds: string[];
  propagatedItemIds: string[];
  before: { fps: number; durationInFrames: number };
  after: { fps: number; durationInFrames: number };
  focusTimeMs: number;
};
