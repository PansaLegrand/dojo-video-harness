import { z } from "zod/v3";
import type { VideoProjectCommand } from "./commands";
import {
  nativeAgentScopeSchema,
  nativeReviewBasisSchema,
  type NativeAgentScope,
  type NativeClarification,
} from "./agent-authoring";

export const VIDEO_PROJECT_AGENT_CONTRACT = "video-project-commands" as const;
export const VIDEO_PROJECT_AGENT_VERSION = 1 as const;
const id = z.string().trim().min(1).max(191);
export const visualWitnessSchema = z
  .object({
    itemId: id,
    documentHash: z.string().regex(/^sha256:[a-f0-9]{64}$/),
    frame: z.number().int().nonnegative(),
    imageDataUrl: z
      .string()
      .max(500_000)
      .regex(/^data:image\/(?:png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/),
    sourceId: id.optional(),
    sourceRevision: id.optional(),
    sourceTimeMs: z.number().finite().nonnegative().optional(),
  })
  .strict();
export const agentContextSchema = z
  .object({
    selectedItemIds: z.array(id).max(24).default([]),
    selectedNodeId: id.optional(),
    playheadFrame: z.number().int().nonnegative(),
    visualWitness: visualWitnessSchema.optional(),
  })
  .strict();
export const agentRunInputSchema = z
  .object({
    operationId: id,
    instruction: z.string().trim().min(1).max(4000),
    baseRevision: z.number().int().nonnegative(),
    baseHash: z.string().regex(/^sha256:[a-f0-9]{64}$/),
    context: agentContextSchema,
    cloudConsent: z.boolean().default(false),
    visualConsent: z.boolean().default(false),
    scope: nativeAgentScopeSchema.optional(),
    referenceRunId: id.optional(),
  })
  .strict();
export const agentApplyInputSchema = z
  .object({
    operationId: id,
    baseRevision: z.number().int().nonnegative(),
    baseHash: z.string().regex(/^sha256:[a-f0-9]{64}$/),
    reviewBasis: nativeReviewBasisSchema.optional(),
  })
  .strict();
export type VideoProjectAgentContext = z.infer<typeof agentContextSchema>;
export type VideoProjectAgentRunInput = z.infer<typeof agentRunInputSchema>;
export type VideoProjectAgentStatus =
  | "queued"
  | "running"
  | "needs_evidence"
  | "needs_input"
  | "completed"
  | "awaiting_review"
  | "ready"
  | "applied"
  | "failed"
  | "cancelled"
  | "stale";
export type VideoProjectAgentProposal = {
  impact: "direct" | "review";
  summary: string;
  commands: VideoProjectCommand[];
  changedItemIds: string[];
  previewHash: string;
  propagatedItemIds?: string[];
};
export type VideoProjectAgentRun = {
  /** Explicit host policy for integrations that require a human review. */
  manualReviewRequired?: boolean;
  /** Optional host disclosure; absence never grants upload consent. */
  cloudConsent?: boolean;
  id: string;
  operationId: string;
  status: VideoProjectAgentStatus;
  phase: string;
  instruction: string;
  baseRevision: number;
  baseHash: string;
  context: VideoProjectAgentContext;
  proposal: VideoProjectAgentProposal | null;
  recoverableOutput?: boolean;
  scope?: NativeAgentScope;
  referenceRunId?: string;
  clarification?: NativeClarification;
  reviewBasisRequired?: boolean;
  undoOfRunId?: string;
  clarificationParentRunId?: string;
  /** Product UI view of local continuation availability; not a billing allowance. */
  clarificationReply?: {
    remaining: 0 | 1;
    continuationRunId?: string;
    options: Record<
      string,
      {
        scope: NativeAgentScope;
        itemCount: number;
        itemNames: string[];
        fps: number;
      }
    >;
  };
  replyState?: {
    available: boolean;
    continuationRunId?: string;
    options: Record<
      string,
      {
        scope: NativeAgentScope;
        itemCount: number;
        itemNames: string[];
        fps: number;
      }
    >;
  };
  prerequisites: {
    kind: "transcript";
    assetIds: string[];
    taskIds: string[];
    status: "consent_required" | "running" | "ready";
  } | null;
  error: { code: string; message: string } | null;
  createdAt: string;
  updatedAt: string;
};
export type VideoProjectAgentMessage = {
  id: string;
  role: "user" | "assistant";
  text: string;
  runId: string | null;
  status: string;
  createdAt: string;
};
