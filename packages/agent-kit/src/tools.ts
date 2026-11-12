import {
  previewInspectionSchema,
  previewRepairInspectionSchema,
  parsePreviewInspection,
  parsePreviewRepairClaim,
  appendPreviewRepairEdit,
  type PreviewInspection,
  type PreviewRepairEvidence,
  type PreviewRepairClaim,
} from "./preview-repair.js";
import { parseEditArtifactRef } from "./stages.js";
import { deriveCaptionPlanRequirements } from "./caption-plan.js";
import type { StageCaptionPair } from "./staged-coordinator.js";
import {
  editingOnlyProposalSchema,
  reviewedProposalSchema,
  embedEditingSchema,
  assertEditingProposal,
} from "./editing-schema.js";
import {
  toolMetadata,
  type AgentTool,
  type Skill,
  type AgentProfile,
  usesCompletionPreflight,
  usesPagedReaders,
  usesEfficientReaders,
  usesResolvedEditSchema,
  usesStagedEditing,
  usesAuthoringContracts,
  usesReviewedEditReferences,
  usesPhaseScopedTools,
  usesPreviewRepair,
  usesAppendPreviewRepair,
  usesDerivedCaptionPlan,
} from "./catalog.js";
import {
  completionCanonical,
  completionHash,
  parseCompletionRequirements,
  validateCompletionReceipt,
  completionRequirementsSchema,
  pagedCompletionRequirementsSchema,
  authoringCompletionRequirementsSchema,
  type CompletionRequirement,
  type CompletionReceipt,
  type CompletionCheck,
  type CompletionContract,
  type CompletionState,
} from "./completion.js";
import { readSkill, selectSkills } from "./skills.js";
import { buildAgentInventory } from "./inventory.js";
import {
  createStagedEditorTools,
  type EditorStagePorts,
} from "./staged-tools.js";

type MaybePromise<T> = T | Promise<T>;
export type Placement = {
  itemId: string;
  trackId: string;
  name: string;
  from: number;
  duration: number;
};
export type TranscriptQuery = {
  snapshotHash: string;
  query: string;
  sourceItemIds?: string[];
  cursor?: string;
};
export type AssetQuery = {
  snapshotHash: string;
  name?: string;
  type?: "video" | "audio" | "image" | "font" | "lottie";
  usage?: "all" | "used" | "unused";
  cursor?: string;
};
export type CaptionSourceRange = { startMs: number; endMs: number };
export type CaptionCueQuery = {
  snapshotHash: string;
  sourceItemId: string;
  evidenceId: string;
  sourceRange?: CaptionSourceRange;
  cursor?: string;
};
export type CaptionTrackQuery = {
  snapshotHash: string;
  captionItemId: string;
  cursor?: string;
};
export type EditorToolPorts<T> = {
  readCaptionTrack?: (
    input: CaptionTrackQuery,
    signal: AbortSignal,
  ) => MaybePromise<unknown>;
  stages?: EditorStagePorts<T>;
  previewEvidence?: (
    requestId: string,
    signal: AbortSignal,
  ) => MaybePromise<PreviewRepairEvidence>;
  listAssets?: (args: AssetQuery, signal: AbortSignal) => MaybePromise<unknown>;
  readCaptionCues?: (
    args: CaptionCueQuery,
    signal: AbortSignal,
  ) => MaybePromise<unknown>;
  inspectProject(
    args: { itemIds?: string[] },
    signal: AbortSignal,
  ): MaybePromise<unknown>;
  inspectGraphicsSchema(
    signal: AbortSignal,
    query?: {
      kind: "native" | "macro" | "three";
      macro?: string;
    },
  ): MaybePromise<unknown>;
  searchTranscript(
    args: TranscriptQuery,
    signal: AbortSignal,
  ): MaybePromise<unknown>;
  prepareSvgGraphic(
    args: Placement & { svg: string },
    signal: AbortSignal,
  ): MaybePromise<unknown>;
  prepareThreeScene(
    args: Placement & { params: unknown },
    signal: AbortSignal,
  ): MaybePromise<unknown>;
  prepareTextOverlay?: (
    args: unknown,
    signal: AbortSignal,
  ) => MaybePromise<unknown>;
  validateRequirements?: (
    requirements: CompletionRequirement[],
  ) => MaybePromise<void>;
  reviewEdit?: (
    input: { requirements: CompletionRequirement[]; edit: unknown },
    signal: AbortSignal,
  ) => Promise<{ receipt?: CompletionReceipt; checks: CompletionCheck[] }>;
  prepareCaptionPair?: (
    input: unknown,
    signal: AbortSignal,
  ) => MaybePromise<unknown>;
  proposeEdit(
    args: unknown,
    signal: AbortSignal,
    completion?: CompletionContract,
  ): Promise<T>;
  askUser(args: unknown, signal: AbortSignal): Promise<T>;
};
const object = (
  properties: Record<string, unknown> = {},
  required: string[] = [],
) => ({ type: "object", properties, required, additionalProperties: false });
const string = { type: "string" };
const placement = {
  itemId: string,
  trackId: string,
  name: string,
  from: { type: "integer", minimum: 0 },
  duration: { type: "integer", minimum: 1 },
};
function authoringValidationMessage(error: unknown): string {
  const message = error instanceof Error ? error.message : "Preflight failed";
  const diagnostic =
    error && typeof error === "object" && "diagnostic" in error
      ? (error as { diagnostic?: unknown }).diagnostic
      : undefined;
  if (!diagnostic || typeof diagnostic !== "object")
    return message.slice(0, 1800);
  const value = diagnostic as {
    issues?: Array<{ path?: unknown[]; message?: string }>;
    operation?: string;
  };
  const details = (value.issues ?? []).slice(0, 3).map((issue) => {
    const path = (issue.path ?? [])
      .slice(0, 16)
      .map((part) => String(part).slice(0, 80))
      .join(".");
    return `${path || "edit"}: ${String(issue.message ?? "Invalid value").slice(0, 250)}`;
  });
  const hint =
    value.operation === "insertGraphic"
      ? "For installed macros use node:{macro:'kineticText',text,from,duration,...documented parameters}; native node.type must be an installed primitive. Native animations need kind:'keyframes',property,frames. Read inspect_graphics_schema for valid installed examples."
      : "Correct these fields in the complete edit and review again.";
  return [message, ...details, hint].join(" ").slice(0, 2000);
}
function record(
  value: unknown,
  keys: readonly string[],
): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error("Tool input must be an object.");
  for (const key of Object.keys(value))
    if (!keys.includes(key)) throw new Error(`Unknown tool field: ${key}`);
  return value as Record<string, unknown>;
}
function text(
  value: unknown,
  key: string,
  minimum = 0,
  maximum = 300000,
): string {
  if (
    typeof value !== "string" ||
    value.length < minimum ||
    value.length > maximum
  )
    throw new Error(
      `${key} must be a string of ${minimum}–${maximum} characters.`,
    );
  return value;
}
function strings(value: unknown, key: string, maximum: number): string[] {
  if (!Array.isArray(value) || value.length > maximum)
    throw new Error(`${key} exceeds its item limit.`);
  return value.map((entry) => text(entry, key, 0, 191));
}
function placed(value: Record<string, unknown>): Placement {
  if (
    !Number.isInteger(value.from) ||
    (value.from as number) < 0 ||
    !Number.isInteger(value.duration) ||
    (value.duration as number) < 1
  )
    throw new Error(
      "Placement requires integer composition frames and positive duration.",
    );
  return {
    itemId: text(value.itemId, "itemId"),
    trackId: text(value.trackId, "trackId"),
    name: text(value.name, "name"),
    from: value.from as number,
    duration: value.duration as number,
  };
}
const sourceRangeParameters = object(
  {
    startMs: { type: "number", minimum: 0 },
    endMs: { type: "number", exclusiveMinimum: 0 },
  },
  ["startMs", "endMs"],
);
function sourceRange(value: unknown): CaptionSourceRange {
  const input = record(value, ["startMs", "endMs"]);
  if (
    typeof input.startMs !== "number" ||
    !Number.isFinite(input.startMs) ||
    input.startMs < 0 ||
    typeof input.endMs !== "number" ||
    !Number.isFinite(input.endMs) ||
    input.endMs <= input.startMs
  )
    throw new Error(
      "Source range requires finite increasing millisecond times.",
    );
  return { startMs: input.startMs, endMs: input.endMs };
}
const defaultClarification = object(
  {
    id: string,
    question: string,
    options: {
      type: "array",
      minItems: 2,
      maxItems: 5,
      items: object(
        {
          id: string,
          label: string,
          targetItemIds: { type: "array", items: string },
        },
        ["id", "label"],
      ),
    },
    allowText: { type: "boolean" },
  },
  ["id", "question"],
);

/** Only trusted host ports can supply executors. Skills and model output never register tools. */
export function createEditorToolset<T>(input: {
  ports: EditorToolPorts<T>;
  skills: readonly Skill[];
  profile: AgentProfile;
  proposalSchema: Record<string, unknown>;
  clarificationSchema?: Record<string, unknown>;
  extraTools?: readonly AgentTool<T>[];
  snapshotHash?: string;
  previewSnapshotHash?: string;
  initialCompletionState?: CompletionState;
}) {
  const { ports } = input;
  const completion = usesCompletionPreflight(input.profile);
  const authoring = usesAuthoringContracts(input.profile);
  const previewRepair = usesPreviewRepair(input.profile);
  const appendPreviewRepair = usesAppendPreviewRepair(input.profile);
  const previewAvailable =
    previewRepair &&
    !!ports.previewEvidence &&
    !!input.extraTools?.some((tool) => tool.name === "request_project_preview");
  const reviewReferences = usesReviewedEditReferences(input.profile);
  const stages = usesStagedEditing(input.profile) ? ports.stages : undefined;
  const deriveCaptionPlan =
    usesDerivedCaptionPlan(input.profile) && stages?.deriveCaptionPlan === true;
  const phaseScoped = usesPhaseScopedTools(input.profile),
    phase = stages?.phase ?? "planning";
  if (phaseScoped && !["planning", "caption_batch", "assemble"].includes(phase))
    throw new Error("The host supplied an unknown editing phase.");
  if (usesStagedEditing(input.profile) && !stages)
    throw new Error("Staged profiles require their durable host ports.");
  if (completion && (!ports.reviewEdit || !input.snapshotHash))
    throw new Error(
      "Completion profiles require a preflight port and snapshot identity.",
    );
  if (
    usesPagedReaders(input.profile) &&
    (!ports.listAssets || !ports.readCaptionCues)
  )
    throw new Error("Paged-reader profiles require both reader executors.");
  const initialState = input.initialCompletionState ?? stages?.completionState;
  let state = initialState ? structuredClone(initialState) : undefined;
  const checkedState = async () => {
    if (state) {
      if (
        state.snapshotHash !== input.snapshotHash ||
        state.version !== 1 ||
        (await completionHash(
          parseCompletionRequirements(state.requirements, {
            assetSequence: usesPagedReaders(input.profile),
            speechCallout: usesPagedReaders(input.profile),
          }),
        )) !== state.requirementsHash
      )
        throw new Error(
          "Completion state changed or belongs to another snapshot.",
        );
      if (state.successfulReceipt) {
        const receipt = await validateCompletionReceipt(
          state.successfulReceipt,
        );
        if (
          receipt.snapshotHash !== state.snapshotHash ||
          receipt.requirementsHash !== state.requirementsHash
        )
          throw new Error("Completion review binding changed.");
        if (
          reviewReferences &&
          state.successfulReviewRef &&
          parseEditArtifactRef(state.successfulReviewRef).kind !==
            "verification"
        )
          throw new Error("The successful review reference is invalid.");
      }
    }
    return state;
  };
  const inspectPreview = async (
    raw: unknown,
    basis: { ref: unknown; renderHash: string },
    signal: AbortSignal,
    savedEvidence?: PreviewRepairEvidence,
  ) => {
    const inspection = parsePreviewInspection(raw);
    if (!ports.previewEvidence)
      throw new Error("The host has no owned preview receipt reader.");
    const evidence =
      savedEvidence ??
      (await ports.previewEvidence(inspection.requestId, signal));
    if (
      evidence.requestId !== inspection.requestId ||
      evidence.receiptHash !== inspection.receiptHash ||
      evidence.snapshotHash !==
        (input.previewSnapshotHash ?? input.snapshotHash) ||
      evidence.renderHash !== basis.renderHash ||
      completionCanonical(evidence.candidateRef) !==
        completionCanonical(basis.ref) ||
      evidence.audio !== "not-inspected" ||
      !evidence.frames.length ||
      evidence.frames.length > 4 ||
      inspection.issues.some((issue) => !evidence.frames.includes(issue.frame))
    )
      throw new Error(
        "Preview evidence differs from the exact candidate, source revision or sampled frames.",
      );
    return { inspection, evidence };
  };
  let skills: Skill[] = [];
  const readerSnapshotHash = (value: unknown) => {
    if (value === undefined && usesEfficientReaders(input.profile))
      return input.snapshotHash!;
    const supplied = text(value, "snapshotHash", 1, 80);
    if (usesEfficientReaders(input.profile) && supplied !== input.snapshotHash)
      throw new Error("Reader snapshot differs from the frozen host snapshot.");
    return supplied;
  };
  const observed = (value: unknown) => ({
    kind: "observation" as const,
    value,
  });
  let tools: AgentTool<T>[] = [
    {
      ...toolMetadata("inspect_project"),
      parameters: object({
        itemIds: { type: "array", items: string, maxItems: 24 },
      }),
      execute: async (args, signal) => {
        const value = record(args, ["itemIds"]);
        return observed(
          await ports.inspectProject(
            value.itemIds === undefined
              ? {}
              : { itemIds: strings(value.itemIds, "itemIds", 24) },
            signal,
          ),
        );
      },
    },
    {
      ...toolMetadata("read_skill"),
      parameters: object({ name: string }, ["name"]),
      execute: async (args) => {
        const value = record(args, ["name"]);
        return observed(readSkill(skills, text(value.name, "name")));
      },
    },
    {
      ...toolMetadata("search_transcript"),
      parameters: object(
        {
          snapshotHash: string,
          query: string,
          sourceItemIds: { type: "array", items: string, maxItems: 24 },
          cursor: string,
        },
        ["snapshotHash", "query"],
      ),
      execute: async (args, signal) => {
        const value = record(args, [
          "snapshotHash",
          "query",
          "sourceItemIds",
          "cursor",
        ]);
        return observed(
          await ports.searchTranscript(
            {
              snapshotHash: text(value.snapshotHash, "snapshotHash"),
              query: text(value.query, "query", 1, 160),
              ...(value.sourceItemIds === undefined
                ? {}
                : {
                    sourceItemIds: strings(
                      value.sourceItemIds,
                      "sourceItemIds",
                      24,
                    ),
                  }),
              ...(value.cursor === undefined
                ? {}
                : { cursor: text(value.cursor, "cursor", 0, 2000) }),
            },
            signal,
          ),
        );
      },
    },
    {
      ...toolMetadata("inspect_graphics_schema"),
      ...(authoring
        ? {
            description:
              "Read authoritative installed native 2D node/animation and macro descriptors with valid JSON examples, plus editable 3D scene schema. Use before authoring custom charts or unfamiliar graphics. Macro nodes use macro:'kineticText' with its documented fields; native node.type is never a macro name. Native animations use kind:'keyframes', property and frames:[{frame,value}], never invented preset objects.",
          }
        : {}),
      parameters: authoring
        ? object({
            kind: {
              type: "string",
              enum: ["native", "macro", "three"],
              description:
                "Defaults to native 2D primitives and keyframe syntax; request only the missing kind.",
            },
            macro: {
              type: "string",
              minLength: 1,
              maxLength: 64,
              description:
                "Installed macro name, only with kind:macro; omit for its compact index.",
            },
          })
        : object(),
      execute: async (args, signal) => {
        const value = record(args, authoring ? ["kind", "macro"] : []);
        if (!authoring)
          return observed(await ports.inspectGraphicsSchema(signal));
        const kind = value.kind ?? "native";
        if (
          !["native", "macro", "three"].includes(String(kind)) ||
          (value.macro !== undefined &&
            (kind !== "macro" ||
              typeof value.macro !== "string" ||
              !value.macro.length ||
              value.macro.length > 64))
        )
          throw new Error(
            "Choose kind:native, kind:macro with an optional installed macro name, or kind:three.",
          );
        return observed(
          await ports.inspectGraphicsSchema(signal, {
            kind: kind as "native" | "macro" | "three",
            ...(value.macro === undefined
              ? {}
              : { macro: value.macro as string }),
          }),
        );
      },
    },
    {
      ...toolMetadata("prepare_svg_graphic"),
      parameters: object(
        { ...placement, svg: { type: "string", maxLength: 128000 } },
        [...Object.keys(placement), "svg"],
      ),
      execute: async (args, signal) => {
        const value = record(args, [...Object.keys(placement), "svg"]);
        return observed(
          await ports.prepareSvgGraphic(
            { ...placed(value), svg: text(value.svg, "svg", 0, 128000) },
            signal,
          ),
        );
      },
    },
    {
      ...toolMetadata("prepare_three_scene"),
      parameters: object(
        {
          ...placement,
          params: {
            type: "object",
            description:
              "Installed 3D scene schema from inspect_graphics_schema.",
          },
        },
        [...Object.keys(placement), "params"],
      ),
      execute: async (args, signal) => {
        const value = record(args, [...Object.keys(placement), "params"]);
        if (!Object.hasOwn(value, "params"))
          throw new Error("params is required.");
        return observed(
          await ports.prepareThreeScene(
            { ...placed(value), params: value.params },
            signal,
          ),
        );
      },
    },
  ];
  if (ports.prepareTextOverlay)
    tools.push({
      ...toolMetadata("prepare_text_overlay"),
      parameters: object(
        {
          itemId: string,
          trackId: string,
          kind: { type: "string", enum: ["title", "lowerThird", "caption"] },
          text: { type: "string", maxLength: 240 },
          subtitle: { type: "string", maxLength: 120 },
          from: {
            type: "integer",
            minimum: 0,
            description:
              "Start in integer composition frames, using the inspected project fps.",
          },
          duration: {
            type: "integer",
            minimum: 1,
            description: "Length in composition frames, not seconds.",
          },
        },
        ["itemId", "trackId", "kind", "text", "from", "duration"],
      ),
      execute: async (args, signal) =>
        observed(await ports.prepareTextOverlay!(args, signal)),
    });
  if (completion) {
    tools.push({
      ...toolMetadata("review_edit"),
      ...(authoring
        ? {
            description: appendPreviewRepair
              ? "Review the complete intended edit, keeping frozen requirements. For a targeted correction to an owned inspected candidate, send previewRepair:{mode:'append',requestId,receiptHash,issues:[{frame,description}]} and edit:{outcome:'proposal',summary,commands:[only incremental native repair commands]}. The host resolves that exact verified candidate, appends the repair commands once, and validates the complete result against the original snapshot and requirements before claiming ONE correction. Both repair modes validate before claiming. Invalid repair commands do not consume the claim. Omit mode when sending a full replacement command batch. After a successful correction request a SECOND preview and propose the saved reviewed result with its sampled unresolved issues. This never applies edits."
              : previewRepair
                ? "Review the complete intended edit, omitting requirements once they are frozen. To correct actual sampled preview failures, include previewRepair:{requestId,receiptHash,issues:[{frame,description}]}. The host verifies the exact prior saved candidate and authorized browser receipt, then claims ONE correction command batch before native review. The claim survives failed checks and restart. After correction request a second preview and report unresolved issues with the final reviewed proposal. This tool retains normal command/check validation."
                : reviewReferences
                  ? "Review the complete intended edit with {requirements,edit:{outcome:'proposal',summary,commands:[all commands]}}. Invalid requirement paths are rejected before freezing. A successful review retains the exact edit as an owned immutable verification artifact and returns a small reference; then call propose_edit({reviewed:true}) WITHOUT regenerating commands. A failed/error review clears that compact route; repair and review the complete edit again. This never applies edits."
                  : "Review the complete intended edit WITHOUT applying or saving a draft. Call with {requirements:[supported typed checks],edit:{outcome:'proposal',summary:'...',commands:[all commands]}}. The first valid requirement list freezes. Repair failed checks by reviewing the full repaired edit again. On success call propose_edit with that exact edit object. A rejected propose_edit does not save commands: reviewing commands:[] cannot recover them. Empty additional commands are allowed only when the host explicitly reports preparedCommands.",
          }
        : {}),
      parameters: object(
        {
          requirements: authoring
            ? authoringCompletionRequirementsSchema
            : usesPagedReaders(input.profile)
              ? pagedCompletionRequirementsSchema
              : completionRequirementsSchema,
          ...(previewRepair
            ? {
                previewRepair: appendPreviewRepair
                  ? {
                      ...previewRepairInspectionSchema,
                      properties: {
                        ...previewRepairInspectionSchema.properties,
                        mode: {
                          type: "string",
                          const: "append",
                          description:
                            "Append only the supplied incremental commands to the exact owned candidate identified by this preview receipt.",
                        },
                      },
                    }
                  : previewRepairInspectionSchema,
              }
            : {}),
          edit: usesResolvedEditSchema(input.profile)
            ? embedEditingSchema(input.proposalSchema, {
                preparedCommands: stages?.preparedCommands,
              })
            : input.proposalSchema,
        },
        ["edit"],
      ),
      execute: async (args, signal) => {
        const previousRef = state?.successfulReviewRef,
          previousReceipt = state?.successfulReceipt;
        if (previewRepair && state) {
          delete state.successfulReceipt;
          delete state.successfulReviewRef;
        }
        const value = record(
          args,
          previewRepair
            ? ["requirements", "edit", "previewRepair"]
            : ["requirements", "edit"],
        );
        if (reviewReferences && state) {
          delete state.successfulReceipt;
          delete state.successfulReviewRef;
        }
        await checkedState();
        const declared =
          value.requirements === undefined
            ? state?.requirements
            : parseCompletionRequirements(value.requirements, {
                assetSequence: usesPagedReaders(input.profile),
                speechCallout: usesPagedReaders(input.profile),
              });
        if (!declared)
          throw new Error(
            "Declare all requested outcomes in requirements before the first review.",
          );
        if (reviewReferences) await ports.validateRequirements?.(declared);
        const requirementsHash = await completionHash(declared);
        state ??= {
          version: 1,
          snapshotHash: input.snapshotHash!,
          requirements: declared,
          requirementsHash,
        };
        let checks: CompletionCheck[];
        let receipt: CompletionReceipt | undefined;
        let reviewRef: CompletionState["successfulReviewRef"];
        let pendingRepairClaim: PreviewRepairClaim | undefined;
        let edit = value.edit;
        try {
          let repairInspection = value.previewRepair;
          let append = false;
          if (appendPreviewRepair && repairInspection !== undefined) {
            const repair = record(repairInspection, [
              "requestId",
              "receiptHash",
              "issues",
              "mode",
            ]);
            if (repair.mode !== undefined && repair.mode !== "append")
              throw new Error(
                "Use previewRepair.mode:'append' for incremental commands, or omit mode for a full replacement.",
              );
            append = repair.mode === "append";
            const { mode: _mode, ...inspection } = repair;
            repairInspection = inspection;
          }
          if (stages && !append)
            edit = await stages.resolvePreparedEdit(edit, signal);
          if (usesResolvedEditSchema(input.profile))
            assertEditingProposal(edit);
          if (requirementsHash !== state.requirementsHash)
            throw new Error(
              "The first valid requirements are frozen. Repair the edit instead of weakening or replacing the checklist.",
            );
          if (previewRepair && value.previewRepair !== undefined) {
            if (!stages?.claimPreviewRepair)
              throw new Error(
                "Preview correction requires a durable assembly plan.",
              );
            const prior = state.previewRepair;
            let basisRef = prior?.basisRef ?? previousRef;
            let renderHash = prior?.renderHash ?? previousReceipt?.previewHash;
            let savedEvidence: PreviewRepairEvidence | undefined;
            if (appendPreviewRepair && (!basisRef || !renderHash)) {
              const inspection = parsePreviewInspection(repairInspection);
              if (!ports.previewEvidence)
                throw new Error(
                  "The host has no owned preview receipt reader.",
                );
              savedEvidence = await ports.previewEvidence(
                inspection.requestId,
                signal,
              );
              basisRef ??= parseEditArtifactRef(savedEvidence.candidateRef);
              renderHash ??= savedEvidence.renderHash;
            }
            if (!basisRef || !renderHash)
              throw new Error(
                "Review the complete candidate successfully before requesting a preview correction.",
              );
            const { inspection } = await inspectPreview(
              repairInspection,
              { ref: basisRef, renderHash },
              signal,
              savedEvidence,
            );
            if (appendPreviewRepair) {
              const basis = await stages.resolvePreparedEdit(
                { reviewRef: basisRef },
                signal,
              );
              assertEditingProposal(basis);
              if (append) edit = appendPreviewRepairEdit(basis, edit);
            }
            const claim = parsePreviewRepairClaim({
              kind: "preview-repair",
              ...inspection,
              basisRef,
              renderHash,
              commandsHash: await completionHash(
                (edit as { commands: unknown }).commands,
              ),
            });
            if (
              prior &&
              completionCanonical(prior) !== completionCanonical(claim)
            )
              throw new Error(
                "The single preview correction round is exhausted. Inspect the repaired preview and report remaining failures.",
              );
            if (appendPreviewRepair) pendingRepairClaim = claim;
            else {
              await stages.claimPreviewRepair(claim, signal);
              state.previewRepair = claim;
            }
          } else if (previewRepair && state.previewRepair) {
            throw new Error(
              "This run already claimed its single preview correction. Reuse the exact correction claim or report its unresolved failures.",
            );
          }
          const reviewed = await ports.reviewEdit!(
            { requirements: state.requirements, edit },
            signal,
          );
          checks = reviewed.checks;
          if (!checks.length || checks.length > 40)
            throw new Error("Invalid bounded preflight checks.");
          if (checks.every((check) => check.passed)) {
            const checked = await validateCompletionReceipt(reviewed.receipt);
            if (
              checked.snapshotHash !== state.snapshotHash ||
              checked.requirementsHash !== state.requirementsHash ||
              checked.commandsHash !==
                (await completionHash(
                  (edit as { commands?: unknown })?.commands,
                )) ||
              checked.checksHash !== (await completionHash(reviewed.checks))
            )
              throw new Error(
                "The host preflight receipt does not match the declared edit.",
              );
            receipt = checked;
            if (pendingRepairClaim) {
              await stages!.claimPreviewRepair!(pendingRepairClaim, signal);
              state.previewRepair = pendingRepairClaim;
            }
          }
          const recorded = await stages?.recordReview?.(
            {
              requirements: state.requirements,
              edit,
              checks,
              ...(receipt ? { receipt } : {}),
            },
            signal,
          );
          if (receipt) {
            state.successfulReceipt = receipt;
            if (reviewReferences && recorded?.reviewRef) {
              reviewRef = parseEditArtifactRef(recorded.reviewRef);
              if (reviewRef.kind !== "verification")
                throw new Error(
                  "Successful review was not retained as a verification artifact.",
                );
              state.successfulReviewRef = reviewRef;
            }
          }
        } catch (error) {
          receipt = undefined;
          reviewRef = undefined;
          if (reviewReferences && state) {
            delete state.successfulReceipt;
            delete state.successfulReviewRef;
          }
          checks = [
            {
              id: "preflight",
              passed: false,
              message: authoring
                ? authoringValidationMessage(error)
                : (error instanceof Error
                    ? error.message
                    : "Preflight failed"
                  ).slice(0, 2000),
            },
          ];
        }
        return {
          kind: "observation",
          pinned: true,
          value: {
            ...(authoring
              ? {
                  nextAction:
                    previewRepair && state.previewRepair
                      ? receipt
                        ? "Request a SECOND preview with {frames,reviewed:true}, inspect its actual labeled frames, then call propose_edit({reviewed:true,previewReport:{requestId,receiptHash,issues:[remaining sampled failures]}}). The single correction round is consumed."
                        : "The single preview correction round was claimed and its checks failed. Report these failed checks and remaining sampled issues explicitly. A different correction batch is unavailable under this run's allowance."
                      : previewAvailable && receipt && reviewRef
                        ? "For visual uncertainty, request_project_preview({frames,reviewed:true}) for this saved candidate and inspect its actual labeled pixels. If the samples are clean, propose_edit({reviewed:true,previewReport:{requestId,receiptHash,issues:[]}}). Observed failures permit one previewRepair correction and a second preview. A simple edit that needs no visual inspection may finish with {reviewed:true}."
                        : reviewReferences && receipt && reviewRef
                          ? "Call propose_edit with {reviewed:true}. The host resolves this exact successful review; do not regenerate its command JSON."
                          : receipt
                            ? "Call propose_edit with the exact edit object from this successful review; do not send the requirements or receipt yourself."
                            : "No edit was saved or applied. Keep every frozen requirement, repair the complete command list, and call review_edit again with that full edit. Do not use commands:[] unless the host explicitly supplies preparedCommands.",
                }
              : {}),
            completionPreflight: {
              version: 1,
              snapshotHash: state.snapshotHash,
              requirements: state.requirements,
              requirementsHash: state.requirementsHash,
              status: receipt ? "passed" : "failed",
              checks,
              ...(receipt ? { receipt } : {}),
              ...(reviewRef ? { reviewRef } : {}),
              ...(previewRepair && state.previewRepair
                ? { previewRepair: state.previewRepair }
                : {}),
            },
          },
        };
      },
    });
    if (ports.prepareCaptionPair)
      tools.push({
        ...toolMetadata("prepare_caption_pair"),
        parameters: object(
          {
            sourceItemId: string,
            evidenceId: string,
            originalItemId: string,
            translatedItemId: string,
            trackId: string,
            originalLanguage: string,
            translatedLanguage: string,
            originalColor: string,
            translatedColor: string,
            ...(usesPagedReaders(input.profile)
              ? { sourceRange: sourceRangeParameters }
              : {}),
            translations: {
              type: "array",
              maxItems: 500,
              items: object(
                {
                  cueId: string,
                  text: { type: "string", minLength: 1, maxLength: 1000 },
                },
                ["cueId", "text"],
              ),
            },
          },
          [
            "sourceItemId",
            "evidenceId",
            "originalItemId",
            "translatedItemId",
            "trackId",
            "originalLanguage",
            "translatedLanguage",
            "originalColor",
            "translatedColor",
            "translations",
          ],
        ),
        execute: async (args, signal) => ({
          kind: "observation",
          pinned: true,
          value: await ports.prepareCaptionPair!(args, signal),
        }),
      });
  }
  if (usesPagedReaders(input.profile)) {
    tools.push(
      {
        ...toolMetadata("list_assets"),
        parameters: object(
          {
            ...(usesResolvedEditSchema(input.profile)
              ? {}
              : { snapshotHash: string }),
            name: { type: "string", maxLength: 128 },
            type: { enum: ["video", "audio", "image", "font", "lottie"] },
            usage: { enum: ["all", "used", "unused"] },
            cursor: { type: "string", maxLength: 160 },
          },
          usesEfficientReaders(input.profile) ? [] : ["snapshotHash"],
        ),
        execute: async (args, signal) => {
          const value = record(args, [
            ...(usesResolvedEditSchema(input.profile) ? [] : ["snapshotHash"]),
            "name",
            "type",
            "usage",
            "cursor",
          ]);
          if (
            value.type !== undefined &&
            !["video", "audio", "image", "font", "lottie"].includes(
              String(value.type),
            )
          )
            throw new Error("Unknown asset type.");
          if (
            value.usage !== undefined &&
            !["all", "used", "unused"].includes(String(value.usage))
          )
            throw new Error("Unknown asset usage filter.");
          return {
            kind: "observation",
            pinned: true,
            value: await ports.listAssets!(
              {
                snapshotHash: readerSnapshotHash(value.snapshotHash),
                ...(value.name === undefined
                  ? {}
                  : { name: text(value.name, "name", 0, 128) }),
                ...(value.type === undefined
                  ? {}
                  : { type: value.type as AssetQuery["type"] }),
                ...(value.usage === undefined
                  ? {}
                  : { usage: value.usage as AssetQuery["usage"] }),
                ...(value.cursor === undefined
                  ? {}
                  : { cursor: text(value.cursor, "cursor", 1, 160) }),
              },
              signal,
            ),
          };
        },
      },
      {
        ...toolMetadata("read_caption_cues"),
        parameters: object(
          {
            ...(usesResolvedEditSchema(input.profile)
              ? {}
              : { snapshotHash: string }),
            sourceItemId: { type: "string", minLength: 1, maxLength: 191 },
            evidenceId: { type: "string", minLength: 1, maxLength: 191 },
            sourceRange: sourceRangeParameters,
            cursor: { type: "string", maxLength: 160 },
          },
          usesEfficientReaders(input.profile)
            ? ["sourceItemId", "evidenceId"]
            : ["snapshotHash", "sourceItemId", "evidenceId"],
        ),
        execute: async (args, signal) => {
          const value = record(args, [
            ...(usesResolvedEditSchema(input.profile) ? [] : ["snapshotHash"]),
            "sourceItemId",
            "evidenceId",
            "sourceRange",
            "cursor",
          ]);
          return {
            kind: "observation",
            pinned: true,
            value: await ports.readCaptionCues!(
              {
                snapshotHash: readerSnapshotHash(value.snapshotHash),
                sourceItemId: text(value.sourceItemId, "sourceItemId", 1, 191),
                evidenceId: text(value.evidenceId, "evidenceId", 1, 191),
                ...(value.sourceRange === undefined
                  ? {}
                  : { sourceRange: sourceRange(value.sourceRange) }),
                ...(value.cursor === undefined
                  ? {}
                  : { cursor: text(value.cursor, "cursor", 1, 160) }),
              },
              signal,
            ),
          };
        },
      },
    );
  }
  if (stages)
    tools.push(
      ...createStagedEditorTools(
        {
          ...stages,
          generalEditing: authoring && stages.generalEditing === true,
          deriveCaptionPlan,
          planEditStages: async (raw, signal) => {
            await checkedState();
            const value = raw as {
              requirements?: unknown;
              captionPairs?: unknown;
            };
            let requirements =
              deriveCaptionPlan &&
              Array.isArray(value.requirements) &&
              value.requirements.length === 0
                ? []
                : parseCompletionRequirements(value.requirements, {
                    assetSequence: true,
                    speechCallout: true,
                  });
            if (deriveCaptionPlan && state) {
              if (!Array.isArray(value.captionPairs))
                throw new Error("Plan 0–12 exact caption pairs.");
              requirements = await deriveCaptionPlanRequirements(
                requirements,
                value.captionPairs as StageCaptionPair[],
              );
            }
            if (reviewReferences && requirements.length)
              await ports.validateRequirements?.(requirements);
            if (
              state &&
              (await completionHash(requirements)) !== state.requirementsHash
            )
              throw new Error(
                "The staged plan must preserve every frozen completion requirement.",
              );
            return stages.planEditStages(raw, signal);
          },
        },
        authoring
          ? {
              requirementsSchema: deriveCaptionPlan
                ? { ...authoringCompletionRequirementsSchema, minItems: 0 }
                : authoringCompletionRequirementsSchema,
              ...(deriveCaptionPlan
                ? {
                    description:
                      "Freeze every requested outcome and exact captionPairs. Each validated pair declares its source/evidence, item IDs, languages, colors and requested range. The host derives a missing caption_pair check and preserves every supplied check, with at most12 combined. Matching explicit pair checks are reused; conflicts, duplicate IDs and unplanned checks are rejected. requirements may be empty only when pairs derive at least one check. Saving yields to bounded caption batches and assembly under the original budget; it never applies edits.",
                  }
                : {}),
            }
          : undefined,
      ),
    );
  if (stages && ports.readCaptionTrack)
    tools.push({
      ...toolMetadata("read_caption_track"),
      parameters: object(
        {
          captionItemId: { type: "string", minLength: 1, maxLength: 191 },
          cursor: { type: "string", maxLength: 160 },
        },
        ["captionItemId"],
      ),
      execute: async (raw, signal) => {
        const value = record(raw, ["captionItemId", "cursor"]);
        return {
          kind: "observation",
          pinned: true,
          value: await ports.readCaptionTrack!(
            {
              snapshotHash: input.snapshotHash!,
              captionItemId: text(value.captionItemId, "captionItemId", 1, 191),
              ...(value.cursor === undefined
                ? {}
                : { cursor: text(value.cursor, "cursor", 1, 160) }),
            },
            signal,
          ),
        };
      },
    });
  tools.push(
    {
      ...toolMetadata("propose_edit"),
      ...(authoring
        ? {
            description: previewRepair
              ? "Finish the latest successful saved review with {reviewed:true}. After visual inspection include previewReport:{requestId,receiptHash,issues:[remaining sampled failures]}; after a correction this MUST cite a SECOND preview of the repaired candidate. The host verifies candidate identity/receipts and appends sampled coverage, remaining failures and audio-not-inspected to the saved summary. One correction round is available. Exact raw reviewed edits remain supported before a preview correction."
              : reviewReferences
                ? "Finish the latest successful saved review with exactly {reviewed:true}. The host resolves its immutable owned edit, rechecks hashes/receipt and compiles it for guarded application; do not regenerate its command JSON or supply an artifact reference. A failed/error review invalidates this route until a new complete review passes. The raw reviewed edit form remains supported."
                : "Finish an edit only AFTER review_edit passed for the same complete edit. Send the exact reviewed {outcome:'proposal',summary,commands} object. This call does not save an unreviewed draft. A failed attempt changes no document or draft, so retain your full commands and review them before trying again.",
          }
        : {}),
      parameters: previewRepair
        ? {
            oneOf: [
              reviewedProposalSchema(input.proposalSchema, {
                preparedCommands: stages?.preparedCommands,
              }),
              object(
                {
                  reviewed: { const: true },
                  previewReport: previewInspectionSchema,
                },
                ["reviewed", "previewReport"],
              ),
            ],
          }
        : reviewReferences
          ? reviewedProposalSchema(input.proposalSchema, {
              preparedCommands: stages?.preparedCommands,
            })
          : usesResolvedEditSchema(input.profile)
            ? editingOnlyProposalSchema(input.proposalSchema, {
                preparedCommands: stages?.preparedCommands,
              })
            : input.proposalSchema,
      execute: async (args, signal) => {
        let previewReport: PreviewInspection | undefined;
        const useReviewed =
          reviewReferences &&
          args &&
          typeof args === "object" &&
          Object.hasOwn(args, "reviewed");
        if (useReviewed) {
          const marker = record(
            args,
            previewRepair ? ["reviewed", "previewReport"] : ["reviewed"],
          );
          if (previewRepair && marker.previewReport !== undefined)
            previewReport = parsePreviewInspection(marker.previewReport);
          if (marker.reviewed !== true)
            throw new Error(
              "Use exactly {reviewed:true} for the latest successful saved review.",
            );
          await checkedState();
          if (
            !state?.successfulReceipt ||
            !state.successfulReviewRef ||
            !stages
          )
            throw new Error(
              "No latest successful saved review is available. Review the complete repaired edit first.",
            );
          args = await stages.resolvePreparedEdit(
            { reviewRef: state.successfulReviewRef },
            signal,
          );
        } else {
          // Validate model form before allowing any internal reference resolution.
          if (reviewReferences) assertEditingProposal(args);
          if (stages) args = await stages.resolvePreparedEdit(args, signal);
        }
        if (usesResolvedEditSchema(input.profile)) assertEditingProposal(args);
        if (!completion)
          return {
            kind: "terminal",
            result: await ports.proposeEdit(args, signal),
          };
        if (
          args &&
          typeof args === "object" &&
          Object.hasOwn(args, "completion")
        )
          throw new Error(
            "Completion metadata is host-owned; do not supply it in propose_edit.",
          );
        await checkedState();
        if (
          !state?.successfulReceipt ||
          state.successfulReceipt.commandsHash !==
            (await completionHash((args as { commands?: unknown })?.commands))
        )
          throw new Error(
            authoring
              ? "propose_edit saved and applied nothing. Call review_edit with {requirements:[supported concrete checks],edit:{outcome:'proposal',summary,commands:[the full intended commands]}}. After success send that exact edit to propose_edit. Do not replace your rejected command list with commands:[]."
              : "Run review_edit successfully for these exact commands before propose_edit. Do not omit or weaken requirements.",
          );
        if (previewRepair && (state.previewRepair || previewReport)) {
          if (!previewReport || !state.successfulReviewRef)
            throw new Error(
              "Inspect a second preview of the repaired candidate and provide previewReport with sampled unresolved issues before proposing.",
            );
          const { evidence } = await inspectPreview(
            previewReport,
            {
              ref: state.successfulReviewRef,
              renderHash: state.successfulReceipt.previewHash,
            },
            signal,
          );
          if (
            state.previewRepair &&
            evidence.requestId === state.previewRepair.requestId
          )
            throw new Error(
              "The repaired candidate requires a new preview receipt.",
            );
          const unresolved = previewReport.issues.length
            ? " Remaining sampled issues: " +
              previewReport.issues
                .map((issue) => `frame ${issue.frame}: ${issue.description}`)
                .join(". ")
            : " No remaining issues were reported in these sampled frames.";
          args = {
            ...(args as Record<string, unknown>),
            summary: (
              String((args as { summary: string }).summary).slice(0, 1000) +
              ` Preview inspected frames ${evidence.frames.join(", ")}.` +
              unresolved +
              " Audio was not inspected. Unsampled visual and semantic coverage remains unknown."
            ).slice(0, 4000),
          };
        }
        const result = await ports.proposeEdit(args, signal, {
          requirements: state.requirements,
          receipt: state.successfulReceipt,
        });
        return {
          kind: "terminal",
          result: stages?.completeEditing
            ? await stages.completeEditing(result, signal)
            : result,
        };
      },
    },
    {
      ...toolMetadata("ask_user"),
      parameters: input.clarificationSchema ?? defaultClarification,
      execute: async (args, signal) => ({
        kind: "terminal",
        result: await ports.askUser(args, signal),
      }),
    },
    ...(input.extraTools ?? []),
  );
  if (previewRepair)
    tools = tools.map((tool) => {
      if (tool.name !== "request_project_preview") return tool;
      const execute = tool.execute;
      return {
        ...tool,
        description:
          tool.description +
          " After a successful assembly review, use {frames,reviewed:true} for its exact saved candidate. Inspect the labeled pixels before declaring sampled issues. One correction round is permitted, followed by a second preview and an honest unresolved report.",
        parameters: {
          oneOf: [
            tool.parameters,
            object(
              {
                frames: {
                  type: "array",
                  minItems: 1,
                  maxItems: 4,
                  items: { type: "integer", minimum: 0, maximum: 2592000 },
                },
                reviewed: { const: true },
              },
              ["frames", "reviewed"],
            ),
          ],
        },
        execute: async (args, signal) => {
          if (
            args &&
            typeof args === "object" &&
            Object.hasOwn(args, "reviewed")
          ) {
            const value = record(args, ["frames", "reviewed"]);
            await checkedState();
            if (
              value.reviewed !== true ||
              !state?.successfulReviewRef ||
              !state.successfulReceipt ||
              !stages
            )
              throw new Error(
                "Preview requires the latest successful saved assembly review.",
              );
            await stages.resolvePreparedEdit(
              { reviewRef: state.successfulReviewRef },
              signal,
            );
            args = {
              frames: value.frames,
              candidateRef: state.successfulReviewRef,
            };
          }
          return execute(args, signal);
        },
      };
    });
  if (new Set(tools.map((tool) => tool.name)).size !== tools.length)
    throw new Error("Tool names must be unique.");
  if (phaseScoped)
    tools = tools.filter((tool) => {
      if (tool.name === "plan_edit_stages") return phase === "planning";
      if (tool.name === "save_caption_batch") return phase === "caption_batch";
      if (["review_edit", "propose_edit"].includes(tool.name))
        return phase !== "caption_batch";
      return true;
    });
  skills = selectSkills(
    input.skills,
    tools.map((tool) => tool.name),
    input.profile,
  );
  // Cancellation is checked before calling any host code, including read-only helpers.
  for (const tool of tools) {
    const execute = tool.execute;
    tool.execute = async (args, signal) => {
      signal.throwIfAborted();
      return execute(args, signal);
    };
  }
  return {
    tools,
    skills,
    inventory: buildAgentInventory({ profile: input.profile, tools, skills }),
    restoreCompletionState: (restored: CompletionState | undefined) => {
      if (
        state &&
        restored &&
        state.requirementsHash !== restored.requirementsHash
      )
        throw new Error(
          "Cannot replace frozen completion requirements during restore.",
        );
      const claimed = previewRepair ? state?.previewRepair : undefined;
      if (
        claimed &&
        restored?.previewRepair &&
        completionCanonical(claimed) !==
          completionCanonical(restored.previewRepair)
      )
        throw new Error("The saved preview correction claim changed.");
      state = restored ? structuredClone(restored) : state;
      if (claimed && state) state.previewRepair = claimed;
    },
  };
}
