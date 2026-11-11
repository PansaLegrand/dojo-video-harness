import { parseEditArtifactRef, type EditArtifactRef } from "./stages.js";
import { assertEditingProposal } from "./editing-schema.js";

/** The saved candidate already includes any prepared caption commands. */
export function appendPreviewRepairEdit(
  basis: unknown,
  delta: unknown,
): unknown {
  assertEditingProposal(basis);
  assertEditingProposal(delta);
  return {
    ...(delta as object),
    commands: [
      ...(basis as { commands: unknown[] }).commands,
      ...(delta as { commands: unknown[] }).commands,
    ],
  };
}

export type PreviewIssue = { frame: number; description: string };
export type PreviewRepairEvidence = {
  requestId: string;
  receiptHash: string;
  candidateRef: EditArtifactRef;
  snapshotHash: string;
  renderHash: string;
  frames: number[];
  audio: "not-inspected";
};
export type PreviewInspection = {
  requestId: string;
  receiptHash: string;
  issues: PreviewIssue[];
};
export type PreviewRepairClaim = PreviewInspection & {
  kind: "preview-repair";
  basisRef: EditArtifactRef;
  commandsHash: string;
  renderHash: string;
};
const id = { type: "string", minLength: 1, maxLength: 191 };
export const previewInspectionSchema = {
  type: "object",
  properties: {
    requestId: id,
    receiptHash: { type: "string", pattern: "^[a-f0-9]{64}$" },
    issues: {
      type: "array",
      minItems: 0,
      maxItems: 8,
      items: {
        type: "object",
        properties: {
          frame: { type: "integer", minimum: 0, maximum: 2592000 },
          description: { type: "string", minLength: 1, maxLength: 300 },
        },
        required: ["frame", "description"],
        additionalProperties: false,
      },
    },
  },
  required: ["requestId", "receiptHash", "issues"],
  additionalProperties: false,
} as const;
export const previewRepairInspectionSchema = {
  ...previewInspectionSchema,
  properties: {
    ...previewInspectionSchema.properties,
    issues: { ...previewInspectionSchema.properties.issues, minItems: 1 },
  },
};
function row(raw: unknown, keys: string[]): Record<string, unknown> {
  if (
    !raw ||
    typeof raw !== "object" ||
    Array.isArray(raw) ||
    Object.keys(raw).some((key) => !keys.includes(key))
  )
    throw new Error("Invalid preview inspection fields.");
  return raw as Record<string, unknown>;
}
export function parsePreviewInspection(raw: unknown): PreviewInspection {
  const value = row(raw, ["requestId", "receiptHash", "issues"]);
  if (
    typeof value.requestId !== "string" ||
    !value.requestId ||
    value.requestId.length > 191 ||
    typeof value.receiptHash !== "string" ||
    !/^[a-f0-9]{64}$/.test(value.receiptHash) ||
    !Array.isArray(value.issues) ||
    value.issues.length > 8
  )
    throw new Error("Invalid bounded preview inspection.");
  const issues = value.issues.map((rawIssue) => {
    const issue = row(rawIssue, ["frame", "description"]);
    if (
      typeof issue.frame !== "number" ||
      !Number.isSafeInteger(issue.frame) ||
      issue.frame < 0 ||
      issue.frame > 2592000 ||
      typeof issue.description !== "string" ||
      !issue.description.trim() ||
      issue.description.length > 300
    )
      throw new Error(
        "Preview issues need a sampled frame and a bounded description.",
      );
    return { frame: issue.frame, description: issue.description };
  });
  return { requestId: value.requestId, receiptHash: value.receiptHash, issues };
}
/** The host stores this marker under its existing artifact transaction. A distinct
 * marker for the same run conflicts, including after an unsuccessful correction. */
export function parsePreviewRepairClaim(raw: unknown): PreviewRepairClaim {
  const value = row(raw, [
    "kind",
    "basisRef",
    "commandsHash",
    "renderHash",
    "requestId",
    "receiptHash",
    "issues",
  ]);
  const inspection = parsePreviewInspection({
    requestId: value.requestId,
    receiptHash: value.receiptHash,
    issues: value.issues,
  });
  if (
    value.kind !== "preview-repair" ||
    !inspection.issues.length ||
    typeof value.renderHash !== "string" ||
    !/^(?:sha256:)?[a-f0-9]{64}$/.test(value.renderHash) ||
    typeof value.commandsHash !== "string" ||
    !/^sha256:[a-f0-9]{64}$/.test(value.commandsHash)
  )
    throw new Error("Invalid preview correction claim.");
  const basisRef = parseEditArtifactRef(value.basisRef);
  if (basisRef.kind !== "verification")
    throw new Error("Preview correction requires a verified candidate.");
  return {
    kind: "preview-repair",
    ...inspection,
    basisRef,
    commandsHash: value.commandsHash,
    renderHash: value.renderHash,
  };
}
