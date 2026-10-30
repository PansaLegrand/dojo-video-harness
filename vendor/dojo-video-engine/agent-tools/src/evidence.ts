import { z } from "zod/v3";
import { zodToJsonSchema } from "zod-to-json-schema";
import { parseScene, type Scene, type SceneNode } from "@dojo-video-engine/schema";
import type { SourcePath } from "@dojo-video-engine/inspection";

export const EVIDENCE_CONTRACT_VERSION = 1 as const;

export type EvidenceErrorCode =
  | "aborted"
  | "artifact_render_failed"
  | "artifact_sink_failed"
  | "artifact_too_large"
  | "budget_exceeded"
  | "invalid_artifact"
  | "invalid_comparison_plan"
  | "invalid_frame"
  | "invalid_request"
  | "invalid_scene";

export type EvidenceError = {
  code: EvidenceErrorCode;
  path: SourcePath;
  message: string;
  artifactId?: string;
};

export type EvidenceFailure = {
  ok: false;
  kind: "dojo-video-engine.evidence.failure";
  version: typeof EVIDENCE_CONTRACT_VERSION;
  errors: EvidenceError[];
};

export type EvidenceBudgets = {
  maxSceneNodes: number;
  maxChanges: number;
  maxExplicitFrames: number;
  maxCandidates: number;
  maxFrames: number;
  maxReasonsPerFrame: number;
  maxPathSegments: number;
  maxComparedValues: number;
  maxArtifacts: number;
  maxArtifactBytes: number;
  maxTotalArtifactBytes: number;
  maxEnvelopeBytes: number;
};

export const defaultEvidenceBudgets: Readonly<EvidenceBudgets> = Object.freeze({
  maxSceneNodes: 1_024,
  maxChanges: 512,
  maxExplicitFrames: 64,
  maxCandidates: 8_192,
  maxFrames: 12,
  maxReasonsPerFrame: 8,
  maxPathSegments: 32,
  maxComparedValues: 100_000,
  maxArtifacts: 64,
  maxArtifactBytes: 16 * 1024 * 1024,
  maxTotalArtifactBytes: 64 * 1024 * 1024,
  maxEnvelopeBytes: 256 * 1024,
});

const pathSegmentSchema = z.union([
  z.string().min(1).max(191),
  z.number().int().nonnegative().max(100_000_000),
]);

const evidenceErrorSchema = z
  .object({
    code: z.enum([
      "aborted",
      "artifact_render_failed",
      "artifact_sink_failed",
      "artifact_too_large",
      "budget_exceeded",
      "invalid_artifact",
      "invalid_comparison_plan",
      "invalid_frame",
      "invalid_request",
      "invalid_scene",
    ]),
    path: z.array(pathSegmentSchema).max(32),
    message: z.string().min(1).max(512),
    artifactId: z.string().min(1).max(191).optional(),
  })
  .strict();

const evidenceFailureSchema = z
  .object({
    ok: z.literal(false),
    kind: z.literal("dojo-video-engine.evidence.failure"),
    version: z.literal(EVIDENCE_CONTRACT_VERSION),
    errors: z.array(evidenceErrorSchema).min(1).max(16),
  })
  .strict();

export const evidenceChangeSchema = z
  .object({
    kind: z.enum(["add", "remove", "change", "order"]),
    path: z.array(pathSegmentSchema).min(1).max(32),
  })
  .strict();

export type EvidenceChange = z.infer<typeof evidenceChangeSchema>;

const evidenceBudgetShape = Object.fromEntries(
  Object.entries(defaultEvidenceBudgets).map(([name, maximum]) => [
    name,
    z.number().int().positive().max(maximum).optional(),
  ]),
) as Record<keyof EvidenceBudgets, z.ZodOptional<z.ZodNumber>>;

export const evidenceBudgetsSchema = z.object(evidenceBudgetShape).strict();

export const proofFrameSelectionRequestSchema = z
  .object({
    // Scene ingestion remains one explicit boundary. The outer request and all
    // iterative hints are strict and non-recursive; parseScene owns Scene data.
    before: z.unknown(),
    after: z.unknown(),
    changes: z.array(evidenceChangeSchema).max(512).optional(),
    explicitFrames: z
      .array(z.number().int().nonnegative().max(100_000_000))
      .max(64)
      .optional(),
    budgets: evidenceBudgetsSchema.optional(),
  })
  .strict();

export type ProofFrameSelectionRequest = z.infer<
  typeof proofFrameSelectionRequestSchema
>;

export type ProofFrameReasonCode =
  | "animation-keyframe"
  | "cut-before"
  | "cut-end"
  | "cut-start"
  | "explicit"
  | "marker"
  | "scene-change"
  | "text-end"
  | "text-middle"
  | "text-start";

export type ProofFrameReason = {
  code: ProofFrameReasonCode;
  label: string;
  side?: "before" | "after";
  sourceId?: string;
  path?: SourcePath;
};

export type SelectedProofFrame = {
  frame: number;
  rank: number;
  score: number;
  reasons: ProofFrameReason[];
};

export type ProofFrameSelection = {
  ok: true;
  kind: "dojo-video-engine.proof-frame-selection";
  version: typeof EVIDENCE_CONTRACT_VERSION;
  beforeDuration: number;
  afterDuration: number;
  timelineDuration: number;
  candidatesConsidered: number;
  droppedCandidates: number;
  frames: SelectedProofFrame[];
};

export type ProofFrameSelectionEnvelope = ProofFrameSelection | EvidenceFailure;

const proofReasonSchema = z
  .object({
    code: z.enum([
      "animation-keyframe",
      "cut-before",
      "cut-end",
      "cut-start",
      "explicit",
      "marker",
      "scene-change",
      "text-end",
      "text-middle",
      "text-start",
    ]),
    label: z.string().min(1).max(512),
    side: z.enum(["before", "after"]).optional(),
    sourceId: z.string().min(1).max(191).optional(),
    path: z.array(pathSegmentSchema).max(32).optional(),
  })
  .strict();

const selectedProofFrameSchema = z
  .object({
    frame: z.number().int().nonnegative().max(100_000_000),
    rank: z.number().int().positive().max(64),
    score: z.number().int().nonnegative().max(100_000),
    reasons: z.array(proofReasonSchema).min(1).max(8),
  })
  .strict();

export const proofFrameSelectionSchema = z
  .object({
    ok: z.literal(true),
    kind: z.literal("dojo-video-engine.proof-frame-selection"),
    version: z.literal(EVIDENCE_CONTRACT_VERSION),
    beforeDuration: z.number().int().positive().max(100_000_000),
    afterDuration: z.number().int().positive().max(100_000_000),
    timelineDuration: z.number().int().positive().max(100_000_000),
    candidatesConsidered: z.number().int().nonnegative().max(100_000),
    droppedCandidates: z.number().int().nonnegative().max(100_000),
    frames: z.array(selectedProofFrameSchema).min(1).max(64),
  })
  .strict();

export const proofFrameSelectionEnvelopeSchema = z.discriminatedUnion("ok", [
  proofFrameSelectionSchema,
  evidenceFailureSchema,
]);

export function proofFrameSelectionRequestJsonSchema(): Record<
  string,
  unknown
> {
  return detachedJsonSchema(proofFrameSelectionRequestSchema);
}

export function proofFrameSelectionResultJsonSchema(): Record<string, unknown> {
  return detachedJsonSchema(proofFrameSelectionEnvelopeSchema);
}

/** @deprecated Use proofFrameSelectionRequestJsonSchema(). */
export function proofFrameSelectionJsonSchema(): Record<string, unknown> {
  return proofFrameSelectionRequestJsonSchema();
}

type IndexedNode = {
  node: SceneNode;
  id: string;
  origin: number;
  start: number;
  endExclusive: number;
  path: SourcePath;
};

type CandidateReason = ProofFrameReason & { priority: number };
type Candidate = {
  frame: number;
  reasons: Map<string, CandidateReason>;
};

const reasonPriority: Record<ProofFrameReasonCode, number> = {
  explicit: 1_000,
  "scene-change": 850,
  "animation-keyframe": 720,
  "cut-start": 680,
  "cut-end": 670,
  "cut-before": 660,
  marker: 640,
  "text-start": 560,
  "text-middle": 540,
  "text-end": 520,
};

/** Select deterministic high-signal proof frames without rendering anything. */
export function selectProofFrames(input: unknown): ProofFrameSelectionEnvelope {
  try {
    return selectProofFramesInternal(input);
  } catch (error) {
    return failure(
      evidenceError("invalid_request", ["request"], safeMessage(error)),
    );
  }
}

function selectProofFramesInternal(
  input: unknown,
): ProofFrameSelectionEnvelope {
  const request = proofFrameSelectionRequestSchema.safeParse(input);
  if (!request.success) return zodEvidenceFailure(request.error);

  let before: Scene;
  let after: Scene;
  try {
    before = parseScene(request.data.before);
  } catch (error) {
    return failure(
      evidenceError("invalid_scene", ["before"], safeMessage(error)),
    );
  }
  try {
    after = parseScene(request.data.after);
  } catch (error) {
    return failure(
      evidenceError("invalid_scene", ["after"], safeMessage(error)),
    );
  }

  const budgets = resolveEvidenceBudgets(request.data.budgets);
  if (
    request.data.changes &&
    request.data.changes.length > budgets.maxChanges
  ) {
    return budgetFailure(
      "changes",
      request.data.changes.length,
      budgets.maxChanges,
    );
  }
  if (
    request.data.explicitFrames &&
    request.data.explicitFrames.length > budgets.maxExplicitFrames
  ) {
    return budgetFailure(
      "explicit frames",
      request.data.explicitFrames.length,
      budgets.maxExplicitFrames,
    );
  }

  const indexedBefore = indexScene(before, "before", budgets);
  if (!indexedBefore.ok) return indexedBefore.failure;
  const indexedAfter = indexScene(after, "after", budgets);
  if (!indexedAfter.ok) return indexedAfter.failure;
  const duration = Math.max(before.duration, after.duration);
  const candidates = new Map<number, Candidate>();
  let reasonAttempts = 0;

  const add = (
    frame: number,
    reason: ProofFrameReason,
  ): EvidenceFailure | null => {
    if (!Number.isInteger(frame) || frame < 0 || frame >= duration) return null;
    reasonAttempts += 1;
    if (reasonAttempts > budgets.maxCandidates) {
      return budgetFailure(
        "proof-frame candidates",
        reasonAttempts,
        budgets.maxCandidates,
      );
    }
    const candidate = candidates.get(frame) ?? {
      frame,
      reasons: new Map<string, CandidateReason>(),
    };
    const normalized = normalizeReason(reason, budgets);
    const key = reasonKey(normalized);
    if (!candidate.reasons.has(key)) {
      candidate.reasons.set(key, {
        ...normalized,
        priority: reasonPriority[normalized.code],
      });
    }
    candidates.set(frame, candidate);
    return null;
  };

  for (const [index, frame] of (request.data.explicitFrames ?? []).entries()) {
    if (frame >= duration) {
      return failure(
        evidenceError(
          "invalid_frame",
          ["explicitFrames", index],
          `Explicit proof frame ${frame} is outside [0, ${duration - 1}].`,
        ),
      );
    }
    const exhausted = add(frame, {
      code: "explicit",
      label: `Explicit proof frame ${frame}`,
    });
    if (exhausted) return exhausted;
  }

  const suppliedChanges = request.data.changes;
  const changes =
    suppliedChanges ??
    deriveChanges(
      indexedBefore.nodes,
      indexedAfter.nodes,
      before,
      after,
      budgets,
    );
  if ("ok" in changes && changes.ok === false) return changes.failure;
  const resolvedChanges = Array.isArray(changes) ? changes : changes.changes;
  if (resolvedChanges.length > budgets.maxChanges) {
    return budgetFailure("changes", resolvedChanges.length, budgets.maxChanges);
  }

  const beforeById = new Map(
    indexedBefore.nodes.map((entry) => [entry.id, entry]),
  );
  const afterById = new Map(
    indexedAfter.nodes.map((entry) => [entry.id, entry]),
  );
  for (const change of resolvedChanges) {
    if (change.path.length > budgets.maxPathSegments) {
      return budgetFailure(
        "change path segments",
        change.path.length,
        budgets.maxPathSegments,
      );
    }
    const id = findChangedNodeId(change.path, beforeById, afterById);
    const entries = [beforeById.get(id ?? ""), afterById.get(id ?? "")].filter(
      (entry): entry is IndexedNode => entry !== undefined,
    );
    if (entries.length === 0) {
      const exhausted = add(0, {
        code: "scene-change",
        label: `Scene change at ${formatPath(change.path)}`,
        path: change.path,
      });
      if (exhausted) return exhausted;
      continue;
    }
    for (const entry of entries) {
      for (const frame of [
        entry.start,
        Math.floor(
          (entry.start + Math.max(entry.start, entry.endExclusive - 1)) / 2,
        ),
        Math.max(entry.start, entry.endExclusive - 1),
      ]) {
        const exhausted = add(frame, {
          code: "scene-change",
          label: `Changed node ${entry.id}`,
          sourceId: entry.id,
          path: change.path,
        });
        if (exhausted) return exhausted;
      }
    }
  }

  for (const [side, entries, scene] of [
    ["before", indexedBefore.nodes, before],
    ["after", indexedAfter.nodes, after],
  ] as const) {
    for (const entry of entries) {
      if (entry.endExclusive <= entry.start) continue;
      if (
        entry.node.type === "video" ||
        entry.node.type === "audio" ||
        entry.node.type === "img"
      ) {
        for (const [frame, code] of [
          [entry.start - 1, "cut-before"],
          [entry.start, "cut-start"],
          [entry.endExclusive - 1, "cut-end"],
        ] as const) {
          const exhausted = add(frame, {
            code,
            label: `${entry.id} ${code.replace("cut-", "cut ")}`,
            side,
            sourceId: entry.id,
            path: entry.path,
          });
          if (exhausted) return exhausted;
        }
      }
      for (const animation of entry.node.animations ?? []) {
        for (const keyframe of animation.frames) {
          const frame = entry.origin + keyframe.frame;
          if (frame < entry.start || frame >= entry.endExclusive) continue;
          const exhausted = add(frame, {
            code: "animation-keyframe",
            label: `${entry.id} ${animation.property} keyframe`,
            side,
            sourceId: entry.id,
            path: [...entry.path, "animations"],
          });
          if (exhausted) return exhausted;
        }
      }
      if (entry.node.type === "text") {
        for (const [frame, code] of [
          [entry.start, "text-start"],
          [
            Math.floor(
              (entry.start + Math.max(entry.start, entry.endExclusive - 1)) / 2,
            ),
            "text-middle",
          ],
          [entry.endExclusive - 1, "text-end"],
        ] as const) {
          const exhausted = add(frame, {
            code,
            label: `${entry.id} ${code.replace("text-", "text ")}`,
            side,
            sourceId: entry.id,
            path: entry.path,
          });
          if (exhausted) return exhausted;
        }
      }
    }
    for (const [name, frame] of Object.entries(scene.markers ?? {}).sort(
      ([left], [right]) => compareCodeUnits(left, right),
    )) {
      const exhausted = add(frame, {
        code: "marker",
        label: `Marker ${name}`,
        side,
        sourceId: name,
        path: ["markers", name],
      });
      if (exhausted) return exhausted;
    }
  }

  if (candidates.size === 0) {
    const exhausted = add(0, {
      code: "scene-change",
      label: "Initial composition frame",
      path: [],
    });
    if (exhausted) return exhausted;
  }

  const ranked = [...candidates.values()]
    .map((candidate) => scoreCandidate(candidate, budgets))
    .sort(
      (left, right) => right.score - left.score || left.frame - right.frame,
    );
  const selected = ranked.slice(0, budgets.maxFrames);
  const rankByFrame = new Map(
    selected.map((candidate, index) => [candidate.frame, index + 1]),
  );
  const frames: SelectedProofFrame[] = selected
    .map((candidate) => ({
      frame: candidate.frame,
      rank: rankByFrame.get(candidate.frame)!,
      score: candidate.score,
      reasons: candidate.reasons,
    }))
    .sort((left, right) => left.frame - right.frame);
  const result: ProofFrameSelection = {
    ok: true,
    kind: "dojo-video-engine.proof-frame-selection",
    version: EVIDENCE_CONTRACT_VERSION,
    beforeDuration: before.duration,
    afterDuration: after.duration,
    timelineDuration: duration,
    candidatesConsidered: candidates.size,
    droppedCandidates: Math.max(0, candidates.size - selected.length),
    frames,
  };
  return validateOutput(proofFrameSelectionSchema, result, budgets);
}

export type EvidenceArtifactKind = "still" | "visual-diff" | "contact-sheet";

export type EvidenceArtifactRequest =
  | {
      id: string;
      kind: "still";
      side: "before" | "after";
      frame: number;
    }
  | {
      id: string;
      kind: "visual-diff";
      beforeFrame: number;
      afterFrame: number;
    }
  | {
      id: string;
      kind: "contact-sheet";
      rowIds: string[];
      columns: 2 | 3;
    };

export type ComparisonSheetRow = {
  id: string;
  frame: number;
  beforeFrame: number | null;
  afterFrame: number | null;
  reasons: ProofFrameReason[];
  artifactIds: {
    before?: string;
    after?: string;
    visualDiff?: string;
  };
};

export type ComparisonSheetPlan = {
  ok: true;
  kind: "dojo-video-engine.comparison-sheet-plan";
  version: typeof EVIDENCE_CONTRACT_VERSION;
  id: string;
  title: string;
  columns: 2 | 3;
  rows: ComparisonSheetRow[];
  artifacts: EvidenceArtifactRequest[];
};

export type ComparisonSheetPlanEnvelope = ComparisonSheetPlan | EvidenceFailure;

export const comparisonSheetPlanRequestSchema = z
  .object({
    selection: proofFrameSelectionSchema,
    title: z.string().trim().min(1).max(160).optional(),
    includeVisualDiff: z.boolean().optional(),
    budgets: evidenceBudgetsSchema.optional(),
  })
  .strict();

const artifactRequestSchema = z.discriminatedUnion("kind", [
  z
    .object({
      id: z.string().min(1).max(191),
      kind: z.literal("still"),
      side: z.enum(["before", "after"]),
      frame: z.number().int().nonnegative().max(100_000_000),
    })
    .strict(),
  z
    .object({
      id: z.string().min(1).max(191),
      kind: z.literal("visual-diff"),
      beforeFrame: z.number().int().nonnegative().max(100_000_000),
      afterFrame: z.number().int().nonnegative().max(100_000_000),
    })
    .strict(),
  z
    .object({
      id: z.string().min(1).max(191),
      kind: z.literal("contact-sheet"),
      rowIds: z.array(z.string().min(1).max(191)).min(1).max(64),
      columns: z.union([z.literal(2), z.literal(3)]),
    })
    .strict(),
]);

const comparisonRowSchema = z
  .object({
    id: z.string().min(1).max(191),
    frame: z.number().int().nonnegative().max(100_000_000),
    beforeFrame: z.number().int().nonnegative().max(100_000_000).nullable(),
    afterFrame: z.number().int().nonnegative().max(100_000_000).nullable(),
    reasons: z.array(proofReasonSchema).min(1).max(8),
    artifactIds: z
      .object({
        before: z.string().min(1).max(191).optional(),
        after: z.string().min(1).max(191).optional(),
        visualDiff: z.string().min(1).max(191).optional(),
      })
      .strict(),
  })
  .strict();

export const comparisonSheetPlanSchema = z
  .object({
    ok: z.literal(true),
    kind: z.literal("dojo-video-engine.comparison-sheet-plan"),
    version: z.literal(EVIDENCE_CONTRACT_VERSION),
    id: z.string().min(1).max(191),
    title: z.string().min(1).max(160),
    columns: z.union([z.literal(2), z.literal(3)]),
    rows: z.array(comparisonRowSchema).min(1).max(64),
    artifacts: z.array(artifactRequestSchema).min(1).max(256),
  })
  .strict();

export const comparisonSheetPlanEnvelopeSchema = z.discriminatedUnion("ok", [
  comparisonSheetPlanSchema,
  evidenceFailureSchema,
]);

export function comparisonSheetPlanRequestJsonSchema(): Record<
  string,
  unknown
> {
  return detachedJsonSchema(comparisonSheetPlanRequestSchema);
}

export function comparisonSheetPlanResultJsonSchema(): Record<string, unknown> {
  return detachedJsonSchema(comparisonSheetPlanEnvelopeSchema);
}

/** @deprecated Use comparisonSheetPlanRequestJsonSchema(). */
export function comparisonSheetPlanJsonSchema(): Record<string, unknown> {
  return comparisonSheetPlanRequestJsonSchema();
}

/** Plan portable before/after/diff artifacts without creating browser values. */
export function planComparisonSheet(
  input: unknown,
): ComparisonSheetPlanEnvelope {
  try {
    return planComparisonSheetInternal(input);
  } catch (error) {
    return failure(
      evidenceError("invalid_comparison_plan", ["request"], safeMessage(error)),
    );
  }
}

function planComparisonSheetInternal(
  input: unknown,
): ComparisonSheetPlanEnvelope {
  const parsed = comparisonSheetPlanRequestSchema.safeParse(input);
  if (!parsed.success) {
    return zodEvidenceFailure(parsed.error, "invalid_comparison_plan");
  }
  const selectionError = validateSelectionSemantics(parsed.data.selection);
  if (selectionError) return failure(selectionError);
  const budgets = resolveEvidenceBudgets(parsed.data.budgets);
  const includeVisualDiff = parsed.data.includeVisualDiff ?? true;
  const columns: 2 | 3 = includeVisualDiff ? 3 : 2;
  const rows: ComparisonSheetRow[] = [];
  const artifacts: EvidenceArtifactRequest[] = [];

  for (const selected of parsed.data.selection.frames) {
    const suffix = String(selected.frame).padStart(8, "0");
    const beforeFrame =
      selected.frame < parsed.data.selection.beforeDuration
        ? selected.frame
        : null;
    const afterFrame =
      selected.frame < parsed.data.selection.afterDuration
        ? selected.frame
        : null;
    const rowId = `row-${suffix}`;
    const artifactIds: ComparisonSheetRow["artifactIds"] = {};
    if (beforeFrame !== null) {
      artifactIds.before = `still-before-${suffix}`;
      artifacts.push({
        id: artifactIds.before,
        kind: "still",
        side: "before",
        frame: beforeFrame,
      });
    }
    if (afterFrame !== null) {
      artifactIds.after = `still-after-${suffix}`;
      artifacts.push({
        id: artifactIds.after,
        kind: "still",
        side: "after",
        frame: afterFrame,
      });
    }
    if (includeVisualDiff && beforeFrame !== null && afterFrame !== null) {
      artifactIds.visualDiff = `visual-diff-${suffix}`;
      artifacts.push({
        id: artifactIds.visualDiff,
        kind: "visual-diff",
        beforeFrame,
        afterFrame,
      });
    }
    rows.push({
      id: rowId,
      frame: selected.frame,
      beforeFrame,
      afterFrame,
      reasons: structuredClone(selected.reasons),
      artifactIds,
    });
  }

  const planId = `comparison-${parsed.data.selection.beforeDuration}-${parsed.data.selection.afterDuration}-${parsed.data.selection.frames.map(({ frame }) => frame).join("-")}`;
  artifacts.push({
    id: "comparison-sheet",
    kind: "contact-sheet",
    rowIds: rows.map(({ id }) => id),
    columns,
  });
  if (artifacts.length > budgets.maxArtifacts) {
    return budgetFailure("artifacts", artifacts.length, budgets.maxArtifacts);
  }
  const plan: ComparisonSheetPlan = {
    ok: true,
    kind: "dojo-video-engine.comparison-sheet-plan",
    version: EVIDENCE_CONTRACT_VERSION,
    id: planId.slice(0, 191),
    title: parsed.data.title ?? "Before / after proof",
    columns,
    rows,
    artifacts,
  };
  return validateOutput(
    comparisonSheetPlanSchema,
    plan,
    budgets,
    "invalid_comparison_plan",
  );
}

function validateSelectionSemantics(
  selection: ProofFrameSelection,
): EvidenceError | null {
  if (
    selection.beforeDuration > selection.timelineDuration ||
    selection.afterDuration > selection.timelineDuration
  ) {
    return evidenceError(
      "invalid_comparison_plan",
      ["selection", "timelineDuration"],
      "Selection timelineDuration must cover both source durations.",
    );
  }
  const frames = new Set<number>();
  const ranks = new Set<number>();
  let previous = -1;
  for (const [index, selected] of selection.frames.entries()) {
    if (
      selected.frame <= previous ||
      selected.frame >= selection.timelineDuration ||
      frames.has(selected.frame)
    ) {
      return evidenceError(
        "invalid_comparison_plan",
        ["selection", "frames", index, "frame"],
        "Selected proof frames must be unique, strictly increasing, and inside the timeline.",
      );
    }
    if (ranks.has(selected.rank)) {
      return evidenceError(
        "invalid_comparison_plan",
        ["selection", "frames", index, "rank"],
        "Selected proof-frame ranks must be unique.",
      );
    }
    const reasons = new Set(selected.reasons.map(reasonKey));
    if (reasons.size !== selected.reasons.length) {
      return evidenceError(
        "invalid_comparison_plan",
        ["selection", "frames", index, "reasons"],
        "Selected proof-frame reasons must be deduplicated.",
      );
    }
    frames.add(selected.frame);
    ranks.add(selected.rank);
    previous = selected.frame;
  }
  return null;
}

export type EvidenceRenderedArtifact = {
  mimeType: "image/png" | "image/jpeg" | "image/webp";
  width: number;
  height: number;
  bytes: Uint8Array;
};

export type EvidenceArtifactRef = {
  id: string;
  kind: EvidenceArtifactKind;
  uri: string;
  mimeType: "image/png" | "image/jpeg" | "image/webp";
  byteLength: number;
  width: number;
  height: number;
};

export const evidenceArtifactRefSchema = z
  .object({
    id: z.string().min(1).max(191),
    kind: z.enum(["still", "visual-diff", "contact-sheet"]),
    uri: z
      .string()
      .min(1)
      .max(2_048)
      // Portable storage adapters may use these non-executable schemes.
      .regex(
        /^(?:artifact|memory|https?|s3|gs|ipfs):\/\//i,
        "Artifact URI must use artifact, memory, http(s), s3, gs, or ipfs.",
      ),
    mimeType: z.enum(["image/png", "image/jpeg", "image/webp"]),
    byteLength: z
      .number()
      .int()
      .nonnegative()
      .max(64 * 1024 * 1024),
    width: z.number().int().positive().max(16_384),
    height: z.number().int().positive().max(16_384),
  })
  .strict();

export type EvidenceRenderContext = {
  before: Scene;
  after: Scene;
  plan: ComparisonSheetPlan;
  signal: AbortSignal;
};

export interface EvidenceArtifactRenderer {
  render(
    request: EvidenceArtifactRequest,
    context: EvidenceRenderContext,
  ): Promise<EvidenceRenderedArtifact>;
  /** Join and release any renderer state for this materialization. */
  finalize?(context: EvidenceRenderContext): Promise<void>;
}

export type EvidenceSinkContext = { signal: AbortSignal };

export interface EvidenceArtifactSinkWriter {
  write(
    request: EvidenceArtifactRequest,
    artifact: EvidenceRenderedArtifact,
    context: EvidenceSinkContext,
  ): Promise<EvidenceArtifactRef>;
  commit(context: EvidenceSinkContext): Promise<void>;
  abort(error: EvidenceError, context: EvidenceSinkContext): Promise<void>;
}

export interface EvidenceArtifactSink {
  begin(
    plan: ComparisonSheetPlan,
    context: EvidenceSinkContext,
  ): Promise<EvidenceArtifactSinkWriter>;
}

export type EvidenceArtifactResult = {
  ok: true;
  kind: "dojo-video-engine.evidence-artifacts";
  version: typeof EVIDENCE_CONTRACT_VERSION;
  planId: string;
  totalBytes: number;
  artifacts: EvidenceArtifactRef[];
};

export type EvidenceArtifactEnvelope = EvidenceArtifactResult | EvidenceFailure;

const evidenceArtifactResultSchema = z
  .object({
    ok: z.literal(true),
    kind: z.literal("dojo-video-engine.evidence-artifacts"),
    version: z.literal(EVIDENCE_CONTRACT_VERSION),
    planId: z.string().min(1).max(191),
    totalBytes: z
      .number()
      .int()
      .nonnegative()
      .max(64 * 1024 * 1024),
    artifacts: z.array(evidenceArtifactRefSchema).min(1).max(256),
  })
  .strict();

export const evidenceArtifactEnvelopeSchema = z.discriminatedUnion("ok", [
  evidenceArtifactResultSchema,
  evidenceFailureSchema,
]);

export function evidenceArtifactRequestJsonSchema(): Record<string, unknown> {
  return detachedJsonSchema(artifactRequestSchema);
}

export function evidenceArtifactResultJsonSchema(): Record<string, unknown> {
  return detachedJsonSchema(evidenceArtifactEnvelopeSchema);
}

export type MaterializeEvidenceOptions = {
  before: unknown;
  after: unknown;
  plan: unknown;
  renderer: EvidenceArtifactRenderer;
  sink: EvidenceArtifactSink;
  signal?: AbortSignal;
  budgets?: Partial<EvidenceBudgets>;
};

/** Render and persist one comparison plan through injected transactional ports. */
export async function materializeEvidenceArtifacts(
  options: MaterializeEvidenceOptions,
): Promise<EvidenceArtifactEnvelope> {
  try {
    return await materializeEvidenceArtifactsInternal(options);
  } catch (error) {
    return failure(
      evidenceError("invalid_request", ["request"], safeMessage(error)),
    );
  }
}

async function materializeEvidenceArtifactsInternal(
  options: MaterializeEvidenceOptions,
): Promise<EvidenceArtifactEnvelope> {
  const planResult = comparisonSheetPlanSchema.safeParse(options.plan);
  if (!planResult.success) {
    return zodEvidenceFailure(planResult.error, "invalid_comparison_plan");
  }
  const budgetsResult = evidenceBudgetsSchema.safeParse(options.budgets ?? {});
  if (!budgetsResult.success) return zodEvidenceFailure(budgetsResult.error);
  const budgets = resolveEvidenceBudgets(budgetsResult.data);
  if (planResult.data.artifacts.length > budgets.maxArtifacts) {
    return budgetFailure(
      "artifacts",
      planResult.data.artifacts.length,
      budgets.maxArtifacts,
    );
  }

  let before: Scene;
  let after: Scene;
  try {
    before = parseScene(options.before);
    after = parseScene(options.after);
  } catch (error) {
    return failure(
      evidenceError("invalid_scene", ["sources"], safeMessage(error)),
    );
  }
  const sourcePlanError = validatePlanAgainstSources(
    planResult.data,
    before,
    after,
  );
  if (sourcePlanError) return failure(sourcePlanError);
  const controller = new AbortController();
  const externalSignal = options.signal;
  const onExternalAbort = () => controller.abort(externalSignal?.reason);
  if (externalSignal?.aborted) controller.abort(externalSignal.reason);
  else
    externalSignal?.addEventListener("abort", onExternalAbort, { once: true });
  const signal = controller.signal;
  const aborted = abortFailure(signal);
  if (aborted) return aborted;

  let writer: EvidenceArtifactSinkWriter | undefined;
  let beginPromise: Promise<EvidenceArtifactSinkWriter> | undefined;
  let committed = false;
  const refs: EvidenceArtifactRef[] = [];
  let totalBytes = 0;
  const renderContext: EvidenceRenderContext = Object.freeze({
    before: deepFreezeJson(structuredClone(before)),
    after: deepFreezeJson(structuredClone(after)),
    plan: deepFreezeJson(structuredClone(planResult.data)),
    signal,
  });
  try {
    beginPromise = options.sink.begin(
      deepFreezeJson(structuredClone(planResult.data)),
      { signal },
    );
    writer = await abortable(beginPromise, signal);
    for (const request of planResult.data.artifacts) {
      throwIfAborted(signal);
      const renderRequest = deepFreezeJson(
        structuredClone(request),
      ) as EvidenceArtifactRequest;
      let rendered: EvidenceRenderedArtifact;
      try {
        rendered = await abortable(
          options.renderer.render(renderRequest, renderContext),
          signal,
        );
      } catch (error) {
        throw operationError(
          signal.aborted ? "aborted" : "artifact_render_failed",
          request.id,
          safeMessage(error),
        );
      }
      const payloadError = validateRenderedArtifact(rendered, request, budgets);
      if (payloadError) throw new EvidenceOperationError(payloadError);
      totalBytes += rendered.bytes.byteLength;
      if (totalBytes > budgets.maxTotalArtifactBytes) {
        throw operationError(
          "artifact_too_large",
          request.id,
          `Evidence artifacts exceed ${budgets.maxTotalArtifactBytes} total bytes.`,
        );
      }
      let ref: EvidenceArtifactRef;
      try {
        ref = await abortable(
          writer.write(renderRequest, rendered, { signal }),
          signal,
        );
      } catch (error) {
        throw operationError(
          signal.aborted ? "aborted" : "artifact_sink_failed",
          request.id,
          safeMessage(error),
        );
      }
      const parsedRef = evidenceArtifactRefSchema.safeParse(ref);
      if (
        !parsedRef.success ||
        parsedRef.data.id !== request.id ||
        parsedRef.data.kind !== request.kind ||
        parsedRef.data.mimeType !== rendered.mimeType ||
        parsedRef.data.byteLength !== rendered.bytes.byteLength ||
        parsedRef.data.width !== rendered.width ||
        parsedRef.data.height !== rendered.height
      ) {
        throw operationError(
          "invalid_artifact",
          request.id,
          parsedRef.success
            ? "Artifact sink reference does not match the rendered artifact."
            : (parsedRef.error.issues[0]?.message ??
                "Invalid artifact reference."),
        );
      }
      refs.push(structuredClone(parsedRef.data));
    }
    throwIfAborted(signal);
    try {
      await options.renderer.finalize?.(renderContext);
    } catch (error) {
      throw operationError(
        signal.aborted ? "aborted" : "artifact_render_failed",
        "comparison-sheet",
        `Renderer finalization failed: ${safeMessage(error)}`,
      );
    }
    const pendingResult: EvidenceArtifactResult = {
      ok: true,
      kind: "dojo-video-engine.evidence-artifacts",
      version: EVIDENCE_CONTRACT_VERSION,
      planId: planResult.data.id,
      totalBytes,
      artifacts: refs,
    };
    const validatedResult = validateOutput(
      evidenceArtifactResultSchema,
      pendingResult,
      budgets,
      "invalid_artifact",
    );
    if (!validatedResult.ok) {
      throw new EvidenceOperationError(validatedResult.errors[0]!);
    }
    try {
      await abortable(writer.commit({ signal }), signal);
      committed = true;
    } catch (error) {
      throw operationError(
        signal.aborted ? "aborted" : "artifact_sink_failed",
        "comparison-sheet",
        safeMessage(error),
      );
    }
    externalSignal?.removeEventListener("abort", onExternalAbort);
    return validatedResult;
  } catch (error) {
    const externallyAborted = signal.aborted;
    controller.abort();
    const evidence =
      error instanceof EvidenceOperationError
        ? error.evidence
        : evidenceError(
            externallyAborted ? "aborted" : "artifact_sink_failed",
            ["artifacts"],
            safeMessage(error),
          );
    if (writer && !committed) {
      try {
        await writer.abort(evidence, { signal });
      } catch (abortError) {
        evidence.message =
          `${evidence.message}; sink abort failed: ${safeMessage(abortError)}`.slice(
            0,
            512,
          );
      }
    } else if (!writer && signal.aborted && beginPromise) {
      beginPromise
        .then((lateWriter) => lateWriter.abort(evidence, { signal }))
        .catch(() => undefined);
    }
    try {
      await options.renderer.finalize?.(renderContext);
    } catch (finalizeError) {
      evidence.message =
        `${evidence.message}; renderer finalization failed: ${safeMessage(finalizeError)}`.slice(
          0,
          512,
        );
    }
    externalSignal?.removeEventListener("abort", onExternalAbort);
    return failure(evidence);
  }
}

function validatePlanAgainstSources(
  plan: ComparisonSheetPlan,
  before: Scene,
  after: Scene,
): EvidenceError | null {
  const artifactIds = new Set<string>();
  const rowIds = plan.rows.map(({ id }) => id);
  if (new Set(rowIds).size !== rowIds.length) {
    return evidenceError(
      "invalid_comparison_plan",
      ["plan", "rows"],
      "Comparison row ids must be unique.",
    );
  }
  const contacts = plan.artifacts.filter(
    (artifact) => artifact.kind === "contact-sheet",
  );
  const terminal = plan.artifacts.at(-1);
  if (
    contacts.length !== 1 ||
    terminal?.kind !== "contact-sheet" ||
    contacts[0] !== terminal ||
    terminal.columns !== plan.columns ||
    JSON.stringify(terminal.rowIds) !== JSON.stringify(rowIds)
  ) {
    return evidenceError(
      "invalid_comparison_plan",
      ["plan", "artifacts"],
      "Comparison plans require exactly one matching terminal contact sheet.",
    );
  }
  const referenced = new Set<string>();
  for (const [index, artifact] of plan.artifacts.entries()) {
    if (artifactIds.has(artifact.id)) {
      return evidenceError(
        "invalid_comparison_plan",
        ["plan", "artifacts", index, "id"],
        `Comparison artifact id ${JSON.stringify(artifact.id)} is duplicated.`,
      );
    }
    artifactIds.add(artifact.id);
    if (
      artifact.kind === "still" &&
      artifact.frame >=
        (artifact.side === "before" ? before.duration : after.duration)
    ) {
      return evidenceError(
        "invalid_comparison_plan",
        ["plan", "artifacts", index, "frame"],
        `${artifact.side} still frame ${artifact.frame} is outside its source.`,
      );
    }
    if (
      artifact.kind === "visual-diff" &&
      (artifact.beforeFrame >= before.duration ||
        artifact.afterFrame >= after.duration)
    ) {
      return evidenceError(
        "invalid_comparison_plan",
        ["plan", "artifacts", index],
        "Diff frames must exist in both source Scenes.",
      );
    }
    if (
      artifact.kind === "contact-sheet" &&
      artifact.rowIds.some((id) => !rowIds.includes(id))
    ) {
      return evidenceError(
        "invalid_comparison_plan",
        ["plan", "artifacts", index, "rowIds"],
        "Contact-sheet rowIds must reference comparison rows.",
      );
    }
  }
  const byId = new Map(
    plan.artifacts.map((artifact) => [artifact.id, artifact]),
  );
  for (const [index, row] of plan.rows.entries()) {
    const expected = [
      ["before", row.artifactIds.before, row.beforeFrame],
      ["after", row.artifactIds.after, row.afterFrame],
    ] as const;
    for (const [side, id, frame] of expected) {
      if ((frame === null) !== (id === undefined)) {
        return evidenceError(
          "invalid_comparison_plan",
          ["plan", "rows", index, "artifactIds", side],
          `${side} artifact presence must match its frame.`,
        );
      }
      if (!id || frame === null) continue;
      const artifact = byId.get(id);
      if (
        artifact?.kind !== "still" ||
        artifact.side !== side ||
        artifact.frame !== frame
      ) {
        return evidenceError(
          "invalid_comparison_plan",
          ["plan", "rows", index, "artifactIds", side],
          `${side} artifact must reference its matching still request.`,
        );
      }
      referenced.add(id);
    }
    const visualId = row.artifactIds.visualDiff;
    const shouldHaveVisual =
      plan.columns === 3 && row.beforeFrame !== null && row.afterFrame !== null;
    if (shouldHaveVisual !== (visualId !== undefined)) {
      return evidenceError(
        "invalid_comparison_plan",
        ["plan", "rows", index, "artifactIds", "visualDiff"],
        "Visual-diff artifact presence must match comparable row frames.",
      );
    }
    if (visualId) {
      const artifact = byId.get(visualId);
      if (
        artifact?.kind !== "visual-diff" ||
        artifact.beforeFrame !== row.beforeFrame ||
        artifact.afterFrame !== row.afterFrame
      ) {
        return evidenceError(
          "invalid_comparison_plan",
          ["plan", "rows", index, "artifactIds", "visualDiff"],
          "Visual-diff artifact must reference the row's matching frames.",
        );
      }
      referenced.add(visualId);
    }
  }
  const nonTerminal = plan.artifacts.slice(0, -1).map(({ id }) => id);
  if (
    referenced.size !== nonTerminal.length ||
    nonTerminal.some((id) => !referenced.has(id))
  ) {
    return evidenceError(
      "invalid_comparison_plan",
      ["plan", "artifacts"],
      "Every non-terminal artifact must be referenced exactly once by a row.",
    );
  }
  return null;
}

class EvidenceOperationError extends Error {
  constructor(readonly evidence: EvidenceError) {
    super(evidence.message);
    this.name = "EvidenceOperationError";
  }
}

function operationError(
  code: EvidenceErrorCode,
  artifactId: string,
  message: string,
): EvidenceOperationError {
  return new EvidenceOperationError({
    code,
    path: ["artifacts", artifactId],
    message: message.slice(0, 512),
    artifactId,
  });
}

function validateRenderedArtifact(
  value: EvidenceRenderedArtifact,
  request: EvidenceArtifactRequest,
  budgets: EvidenceBudgets,
): EvidenceError | null {
  if (
    !value ||
    typeof value !== "object" ||
    !["image/png", "image/jpeg", "image/webp"].includes(value.mimeType) ||
    !Number.isInteger(value.width) ||
    value.width < 1 ||
    value.width > 16_384 ||
    !Number.isInteger(value.height) ||
    value.height < 1 ||
    value.height > 16_384 ||
    !(value.bytes instanceof Uint8Array)
  ) {
    return evidenceError(
      "invalid_artifact",
      ["artifacts", request.id],
      "Renderer must return bounded image metadata and Uint8Array bytes.",
      request.id,
    );
  }
  if (value.bytes.byteLength > budgets.maxArtifactBytes) {
    return evidenceError(
      "artifact_too_large",
      ["artifacts", request.id],
      `Artifact has ${value.bytes.byteLength} bytes; maximum is ${budgets.maxArtifactBytes}.`,
      request.id,
    );
  }
  return null;
}

function indexScene(
  scene: Scene,
  side: "before" | "after",
  budgets: EvidenceBudgets,
):
  | { ok: true; nodes: IndexedNode[] }
  | { ok: false; failure: EvidenceFailure } {
  const output: IndexedNode[] = [];
  const stack = scene.nodes
    .map((node, index) => ({
      node,
      parentOrigin: 0,
      parentActiveStart: 0,
      parentActiveEnd: scene.duration,
      path: ["nodes", index] as SourcePath,
    }))
    .reverse();
  while (stack.length > 0) {
    const current = stack.pop()!;
    if (output.length >= budgets.maxSceneNodes) {
      return {
        ok: false,
        failure: budgetFailure(
          `${side} scene nodes`,
          output.length + 1,
          budgets.maxSceneNodes,
        ),
      };
    }
    const origin = current.parentOrigin + (current.node.from ?? 0);
    const start = Math.max(0, current.parentActiveStart, origin);
    const requestedEnd =
      current.node.duration === undefined
        ? current.parentActiveEnd
        : origin + current.node.duration;
    const endExclusive = Math.max(
      start,
      Math.min(scene.duration, current.parentActiveEnd, requestedEnd),
    );
    output.push({
      node: current.node,
      id: current.node.id,
      origin,
      start,
      endExclusive,
      path: current.path,
    });
    const children = current.node.children ?? [];
    for (let index = children.length - 1; index >= 0; index -= 1) {
      stack.push({
        node: children[index]!,
        parentOrigin: origin,
        parentActiveStart: start,
        parentActiveEnd: endExclusive,
        path: [...current.path, "children", index],
      });
    }
  }
  return { ok: true, nodes: output };
}

function deriveChanges(
  beforeNodes: IndexedNode[],
  afterNodes: IndexedNode[],
  before: Scene,
  after: Scene,
  budgets: EvidenceBudgets,
):
  | EvidenceChange[]
  | { ok: false; failure: EvidenceFailure }
  | { ok: true; changes: EvidenceChange[] } {
  const changes: EvidenceChange[] = [];
  const comparisonState = { values: 0 };
  const beforeById = new Map(beforeNodes.map((entry) => [entry.id, entry]));
  const afterById = new Map(afterNodes.map((entry) => [entry.id, entry]));
  const ids = [...new Set([...beforeById.keys(), ...afterById.keys()])].sort(
    compareCodeUnits,
  );
  for (const id of ids) {
    const left = beforeById.get(id);
    const right = afterById.get(id);
    if (!left || !right) {
      changes.push({
        kind: left ? "remove" : "add",
        path: ["nodes", id],
      });
    } else {
      const equal = boundedJsonEqual(
        left.node,
        right.node,
        budgets,
        comparisonState,
      );
      if (equal === null) {
        return {
          ok: false,
          failure: budgetFailure(
            "compared scene values",
            comparisonState.values,
            budgets.maxComparedValues,
          ),
        };
      }
      if (!equal) {
        changes.push({ kind: "change", path: ["nodes", id] });
      }
    }
    if (changes.length > budgets.maxChanges) {
      return {
        ok: false,
        failure: budgetFailure("changes", changes.length, budgets.maxChanges),
      };
    }
  }
  for (const key of ["width", "height", "fps", "duration"] as const) {
    if (before[key] !== after[key]) {
      changes.push({ kind: "change", path: [key] });
    }
  }
  const markersEqual = boundedJsonEqual(
    before.markers,
    after.markers,
    budgets,
    comparisonState,
  );
  if (markersEqual === null) {
    return {
      ok: false,
      failure: budgetFailure(
        "compared scene values",
        comparisonState.values,
        budgets.maxComparedValues,
      ),
    };
  }
  if (!markersEqual) {
    changes.push({ kind: "change", path: ["markers"] });
  }
  return { ok: true, changes };
}

function boundedJsonEqual(
  left: unknown,
  right: unknown,
  budgets: EvidenceBudgets,
  state: { values: number },
): boolean | null {
  const stack: Array<[unknown, unknown]> = [[left, right]];
  while (stack.length > 0) {
    const [a, b] = stack.pop()!;
    state.values += 1;
    if (state.values > budgets.maxComparedValues) return null;
    if (Object.is(a, b)) continue;
    if (Array.isArray(a) && Array.isArray(b)) {
      if (a.length !== b.length) return false;
      for (let index = a.length - 1; index >= 0; index -= 1) {
        stack.push([a[index], b[index]]);
      }
      continue;
    }
    if (isRecord(a) && isRecord(b)) {
      const aKeys = Object.keys(a).sort(compareCodeUnits);
      const bKeys = Object.keys(b).sort(compareCodeUnits);
      if (
        aKeys.length !== bKeys.length ||
        aKeys.some((key, index) => key !== bKeys[index])
      ) {
        return false;
      }
      for (let index = aKeys.length - 1; index >= 0; index -= 1) {
        const key = aKeys[index]!;
        stack.push([a[key], b[key]]);
      }
      continue;
    }
    return false;
  }
  return true;
}

function findChangedNodeId(
  path: SourcePath,
  before: Map<string, IndexedNode>,
  after: Map<string, IndexedNode>,
): string | undefined {
  for (const segment of path) {
    if (
      typeof segment === "string" &&
      (before.has(segment) || after.has(segment))
    ) {
      return segment;
    }
  }
  return undefined;
}

function normalizeReason(
  reason: ProofFrameReason,
  budgets: EvidenceBudgets,
): ProofFrameReason {
  return {
    code: reason.code,
    label: reason.label.slice(0, 512),
    ...(reason.side ? { side: reason.side } : {}),
    ...(reason.sourceId ? { sourceId: reason.sourceId.slice(0, 191) } : {}),
    ...(reason.path
      ? { path: reason.path.slice(0, budgets.maxPathSegments) }
      : {}),
  };
}

function reasonKey(reason: ProofFrameReason): string {
  return [
    reason.code,
    reason.side ?? "",
    reason.sourceId ?? "",
    JSON.stringify(reason.path ?? []),
  ].join("\u0000");
}

function scoreCandidate(
  candidate: Candidate,
  budgets: EvidenceBudgets,
): { frame: number; score: number; reasons: ProofFrameReason[] } {
  const allReasons = [...candidate.reasons.values()].sort(
    (left, right) =>
      right.priority - left.priority ||
      compareCodeUnits(reasonKey(left), reasonKey(right)),
  );
  const reasons = allReasons
    .slice(0, budgets.maxReasonsPerFrame)
    .map(({ priority: _priority, ...reason }) => reason);
  const maximum = allReasons[0]?.priority ?? 0;
  return {
    frame: candidate.frame,
    score: maximum + Math.min(99, allReasons.length),
    reasons,
  };
}

function resolveEvidenceBudgets(
  input: Partial<EvidenceBudgets> | undefined,
): EvidenceBudgets {
  return { ...defaultEvidenceBudgets, ...(input ?? {}) };
}

function validateOutput<T>(
  schema: z.ZodType<T>,
  value: T,
  budgets: EvidenceBudgets,
  errorCode: EvidenceErrorCode = "invalid_request",
): T | EvidenceFailure {
  const parsed = schema.safeParse(value);
  if (!parsed.success) {
    return failure(
      evidenceError(
        errorCode,
        ["result"],
        parsed.error.issues[0]?.message ?? "Invalid evidence result.",
      ),
    );
  }
  const json = strictJsonStringify(parsed.data);
  if (!json.ok) {
    return failure(evidenceError(errorCode, ["result"], json.message));
  }
  const bytes = new TextEncoder().encode(json.value).byteLength;
  if (bytes > budgets.maxEnvelopeBytes) {
    return budgetFailure(
      "evidence envelope bytes",
      bytes,
      budgets.maxEnvelopeBytes,
    );
  }
  return structuredClone(parsed.data);
}

function strictJsonStringify(
  value: unknown,
): { ok: true; value: string } | { ok: false; message: string } {
  const seen = new WeakSet<object>();
  try {
    const json = JSON.stringify(value, (_key, entry: unknown) => {
      if (typeof entry === "number" && !Number.isFinite(entry)) {
        throw new TypeError("Evidence output contains a non-finite number.");
      }
      if (
        entry === undefined ||
        typeof entry === "function" ||
        typeof entry === "symbol" ||
        typeof entry === "bigint"
      ) {
        throw new TypeError("Evidence output contains a non-JSON value.");
      }
      if (entry && typeof entry === "object") {
        if (seen.has(entry)) {
          throw new TypeError(
            "Evidence output contains a shared/cyclic value.",
          );
        }
        seen.add(entry);
      }
      return entry;
    });
    return { ok: true, value: json };
  } catch (error) {
    return { ok: false, message: safeMessage(error) };
  }
}

function zodEvidenceFailure(
  error: z.ZodError,
  code: EvidenceErrorCode = "invalid_request",
): EvidenceFailure {
  return {
    ok: false,
    kind: "dojo-video-engine.evidence.failure",
    version: EVIDENCE_CONTRACT_VERSION,
    errors: error.issues.slice(0, 16).map((issue) =>
      evidenceError(
        code,
        issue.path.map((segment) =>
          typeof segment === "number" ? segment : String(segment),
        ),
        issue.message,
      ),
    ),
  };
}

function failure(...errors: EvidenceError[]): EvidenceFailure {
  return {
    ok: false,
    kind: "dojo-video-engine.evidence.failure",
    version: EVIDENCE_CONTRACT_VERSION,
    errors: errors.slice(0, 16).map((error) => structuredClone(error)),
  };
}

function evidenceError(
  code: EvidenceErrorCode,
  path: SourcePath,
  message: string,
  artifactId?: string,
): EvidenceError {
  return {
    code,
    path: path.slice(0, 32),
    message: message.slice(0, 512),
    ...(artifactId ? { artifactId: artifactId.slice(0, 191) } : {}),
  };
}

function budgetFailure(
  subject: string,
  actual: number,
  limit: number,
): EvidenceFailure {
  return failure(
    evidenceError(
      "budget_exceeded",
      ["budgets"],
      `${subject} ${actual} exceeds limit ${limit}.`,
    ),
  );
}

function abortFailure(signal: AbortSignal): EvidenceFailure | null {
  return signal.aborted
    ? failure(
        evidenceError("aborted", ["signal"], "Evidence work was aborted."),
      )
    : null;
}

function throwIfAborted(signal: AbortSignal): void {
  if (signal.aborted) {
    throw new EvidenceOperationError(
      evidenceError("aborted", ["signal"], "Evidence work was aborted."),
    );
  }
}

function abortable<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
  if (signal.aborted) {
    promise.catch(() => undefined);
    return Promise.reject(new Error("Evidence work was aborted."));
  }
  return new Promise<T>((resolve, reject) => {
    const onAbort = () => reject(new Error("Evidence work was aborted."));
    signal.addEventListener("abort", onAbort, { once: true });
    promise.then(
      (value) => {
        signal.removeEventListener("abort", onAbort);
        resolve(value);
      },
      (error) => {
        signal.removeEventListener("abort", onAbort);
        reject(error);
      },
    );
  });
}

function detachedJsonSchema(schema: z.ZodTypeAny): Record<string, unknown> {
  return structuredClone({
    $schema: "http://json-schema.org/draft-07/schema#",
    ...(zodToJsonSchema(schema, {
      target: "jsonSchema7",
      $refStrategy: "none",
    }) as Record<string, unknown>),
  });
}

function safeMessage(error: unknown): string {
  try {
    return error instanceof Error && error.message.trim() !== ""
      ? error.message.slice(0, 512)
      : String(error).slice(0, 512);
  } catch {
    return "Unknown evidence provider failure.";
  }
}

function formatPath(path: SourcePath): string {
  return path.length === 0 ? "$" : path.map(String).join(".");
}

function compareCodeUnits(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function deepFreezeJson<T>(value: T): T {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value as Record<string, unknown>)) {
      deepFreezeJson(child);
    }
  }
  return value;
}
