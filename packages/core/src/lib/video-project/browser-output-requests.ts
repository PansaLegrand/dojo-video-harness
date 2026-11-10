import { z } from "zod/v3";
import hash from "fast-sha256";
import { editorFormatSchema } from "@/lib/editor/document";
import {
  editorExportResolutions,
  type EditorExportResolution,
} from "@/lib/editor/export-resolution";
import {
  browserHostValueHash,
  browserInspectionGrantSchema,
} from "./browser-host-requests";
import { inspectionImageDimensions } from "./source-inspection";

const id = z.string().min(1).max(191),
  digest = z.string().regex(/^[a-f0-9]{64}$/);
const artifactDigest = z.string().regex(/^sha256:[a-f0-9]{64}$/);
const exportResolutionValues = editorExportResolutions.map(
  (option) => option.value,
) as [EditorExportResolution, ...EditorExportResolution[]];
export const OUTPUT_PREVIEW_LIMITS = Object.freeze({
  maxFrames: 4,
  maxDimension: 768,
  maxOutputBytes: 512 * 1024,
  timeoutMs: 60000,
});
export const OUTPUT_EXPORT_MAX_BYTES = 256 * 1024 * 1024;
export const outputSnapshotSchema = z
  .object({
    revision: z.number().int().nonnegative(),
    documentHash: z.string().min(1).max(300),
  })
  .strict();
export const outputFormatSchema = editorFormatSchema
  .pick({ width: true, height: true, fps: true, durationInFrames: true })
  .extend({
    hasAudio: z.boolean(),
    requireAudibleAudio: z.boolean().default(false),
  })
  .strict();
export const preparedOutputCandidateRefSchema = z
  .object({
    version: z.literal(1),
    id,
    runId: id,
    bindingHash: artifactDigest,
    kind: z.enum(["commands", "verification"]),
    sha256: artifactDigest,
    sizeBytes: z
      .number()
      .int()
      .positive()
      .max(4 * 1024 * 1024),
  })
  .strict();
const previewScopeSchema = z
  .object({
    version: z.literal(1),
    kind: z.literal("project-preview"),
    projectId: id,
    runId: id,
    snapshot: outputSnapshotSchema,
    renderHash: z.string().min(1).max(300),
    format: outputFormatSchema,
    candidateRef: preparedOutputCandidateRefSchema.optional(),
    frames: z.array(z.number().int().nonnegative()).min(1).max(4),
    limits: z
      .object({
        maxFrames: z.number().int().min(1).max(4),
        maxDimension: z.number().int().min(1).max(768),
        maxOutputBytes: z
          .number()
          .int()
          .min(1)
          .max(512 * 1024),
        timeoutMs: z.number().int().positive().max(60000).default(60000),
      })
      .strict(),
  })
  .strict();
export type ProjectPreviewScope = z.infer<typeof previewScopeSchema>;
export function projectPreviewScopeHash(raw: ProjectPreviewScope) {
  return browserHostValueHash(previewScopeSchema.parse(raw));
}
export const projectPreviewRequestSchema = previewScopeSchema
  .extend({ id, scopeHash: digest })
  .strict()
  .superRefine((value, context) => {
    const { id: _id, scopeHash, ...scope } = value;
    if (
      scopeHash !== projectPreviewScopeHash(scope) ||
      value.frames.length > value.limits.maxFrames ||
      value.frames.some(
        (frame, index) =>
          frame >= value.format.durationInFrames ||
          (index > 0 && frame <= value.frames[index - 1]!),
      ) ||
      (!value.candidateRef &&
        value.renderHash !== value.snapshot.documentHash) ||
      (value.candidateRef && value.candidateRef.runId !== value.runId)
    )
      context.addIssue({
        code: "custom",
        message:
          "Preview scope, candidate binding or timeline frame coverage is invalid.",
      });
  });
export type ProjectPreviewRequest = z.infer<typeof projectPreviewRequestSchema>;
export function createProjectPreviewRequest(
  scope: ProjectPreviewScope,
  requestId: string,
) {
  return projectPreviewRequestSchema.parse({
    ...scope,
    id: requestId,
    scopeHash: projectPreviewScopeHash(scope),
  });
}
export function assertProjectPreviewGrant(
  request: ProjectPreviewRequest,
  raw: unknown,
) {
  const grant = browserInspectionGrantSchema.parse(raw);
  if (grant.scopeHash !== request.scopeHash)
    throw new OutputHostError(
      "CONSENT_REQUIRED",
      "Approve these exact output frames before sending pixels.",
    );
  return grant;
}
const previewFrameSchema = z
  .object({
    frame: z.number().int().nonnegative(),
    sceneTimestampUs: z.number().int().nonnegative(),
    width: z.number().int().positive().max(768),
    height: z.number().int().positive().max(768),
    mimeType: z.literal("image/jpeg"),
    byteLength: z
      .number()
      .int()
      .positive()
      .max(512 * 1024),
    sha256: digest,
    dataUrl: z.string().max(720000),
  })
  .strict();
export const projectPreviewReceiptSchema = z
  .object({
    version: z.literal(1),
    kind: z.literal("project-preview"),
    requestId: id,
    requestHash: digest,
    scopeHash: digest,
    authorizationId: id,
    snapshot: outputSnapshotSchema,
    renderHash: z.string().min(1).max(300),
    engineVersion: z.literal("1.2.3"),
    frames: z.array(previewFrameSchema).min(1).max(4),
    coverage: z.literal("requested-frames-only"),
    semanticCoverage: z.literal("unknown"),
    audio: z.literal("not-inspected"),
  })
  .strict();
export type ProjectPreviewReceipt = z.infer<typeof projectPreviewReceiptSchema>;
export class OutputHostError extends Error {
  constructor(
    readonly code:
      | "CONSENT_REQUIRED"
      | "STALE_OUTPUT"
      | "WAITING_APPLICATION"
      | "UNSUPPORTED"
      | "MISSING_SAVED_EXPORT"
      | "OUTPUT_BYTES"
      | "INVALID_OUTPUT"
      | "PUBLICATION_UNVERIFIED",
    message: string,
  ) {
    super(message);
    this.name = "OutputHostError";
  }
}
const sha = (bytes: Uint8Array) =>
  [...hash(bytes)].map((value) => value.toString(16).padStart(2, "0")).join("");
export function parseOutputJpeg(dataUrl: string) {
  const encoded = dataUrl.match(
    /^data:image\/jpeg;base64,([A-Za-z0-9+/]+={0,2})$/,
  )?.[1];
  if (!encoded || encoded.length % 4 !== 0 || encoded.length > 720000)
    throw new OutputHostError(
      "INVALID_OUTPUT",
      "Output inspection requires a bounded JPEG.",
    );
  const binary = atob(encoded);
  if (btoa(binary) !== encoded)
    throw new OutputHostError(
      "INVALID_OUTPUT",
      "Output image encoding changed.",
    );
  const bytes = Uint8Array.from(binary, (value) => value.charCodeAt(0));
  if (
    bytes[0] !== 255 ||
    bytes[1] !== 216 ||
    bytes.at(-2) !== 255 ||
    bytes.at(-1) !== 217
  )
    throw new OutputHostError("INVALID_OUTPUT", "Output image is not a JPEG.");
  return {
    ...inspectionImageDimensions(bytes.subarray(0, 256 * 1024)),
    byteLength: bytes.length,
    sha256: sha(bytes),
  };
}
export function validateProjectPreviewReceipt(
  request: ProjectPreviewRequest,
  grant: unknown,
  raw: unknown,
) {
  projectPreviewRequestSchema.parse(request);
  const authorization = assertProjectPreviewGrant(request, grant),
    receipt = projectPreviewReceiptSchema.parse(raw);
  if (
    receipt.requestId !== request.id ||
    receipt.requestHash !== browserHostValueHash(request) ||
    receipt.scopeHash !== request.scopeHash ||
    receipt.authorizationId !== authorization.id ||
    browserHostValueHash(receipt.snapshot) !==
      browserHostValueHash(request.snapshot) ||
    receipt.renderHash !== request.renderHash ||
    receipt.frames.length !== request.frames.length
  )
    throw new OutputHostError(
      "STALE_OUTPUT",
      "This preview belongs to another output revision or request.",
    );
  let total = 0;
  for (const [index, frame] of receipt.frames.entries()) {
    const image = parseOutputJpeg(frame.dataUrl);
    if (
      frame.frame !== request.frames[index] ||
      frame.sceneTimestampUs !==
        Math.round((frame.frame * 1e6) / request.format.fps) ||
      image.width !== frame.width ||
      image.height !== frame.height ||
      image.byteLength !== frame.byteLength ||
      image.sha256 !== frame.sha256 ||
      Math.max(frame.width, frame.height) > request.limits.maxDimension ||
      frame.width > request.format.width ||
      frame.height > request.format.height ||
      Math.abs(
        frame.width * request.format.height -
          frame.height * request.format.width,
      ) > Math.max(request.format.width, request.format.height)
    )
      throw new OutputHostError(
        "INVALID_OUTPUT",
        "The preview pixels do not match their timeline frame or dimensions.",
      );
    total += frame.byteLength;
  }
  if (total > request.limits.maxOutputBytes)
    throw new OutputHostError(
      "OUTPUT_BYTES",
      "The preview exceeds its approved output byte allowance.",
    );
  return receipt;
}

export const projectExportIntentSchema = z
  .object({
    version: z.literal(1),
    kind: z.literal("project-export"),
    id,
    projectId: id,
    runId: id,
    target: z.literal("final-application"),
    destination: z.enum(["download", "project"]).default("download"),
    output: z
      .object({
        container: z.literal("mp4"),
        resolution: z.enum(exportResolutionValues),
      })
      .strict(),
    maxBytes: z.number().int().positive().max(OUTPUT_EXPORT_MAX_BYTES),
    maxRuntimeMs: z.number().int().positive().max(180000).default(180000),
  })
  .strict();
export type ProjectExportIntent = z.infer<typeof projectExportIntentSchema>;
export const projectExportRequestSchema = z
  .object({
    version: z.literal(1),
    kind: z.literal("project-export"),
    id,
    projectId: id,
    runId: id,
    intentHash: digest,
    applicationOperationId: id,
    snapshot: outputSnapshotSchema,
    format: outputFormatSchema,
    destination: z.enum(["download", "project"]),
    output: projectExportIntentSchema.shape.output,
    maxBytes: z.number().int().positive().max(OUTPUT_EXPORT_MAX_BYTES),
    maxRuntimeMs: z.number().int().positive().max(180000).default(180000),
  })
  .strict();
export type ProjectExportRequest = z.infer<typeof projectExportRequestSchema>;
/** Only the host may supply the actual committed Apply receipt under its lock. */
export function bindProjectExportIntent(
  raw: ProjectExportIntent,
  application: {
    runId: string;
    operationId: string;
    snapshot: z.infer<typeof outputSnapshotSchema>;
  },
  format: z.infer<typeof outputFormatSchema>,
  existing?: ProjectExportRequest,
) {
  const intent = projectExportIntentSchema.parse(raw);
  if (application.runId !== intent.runId)
    throw new OutputHostError(
      "WAITING_APPLICATION",
      "This export is waiting for its final guarded application.",
    );
  const request = projectExportRequestSchema.parse({
    version: 1,
    kind: intent.kind,
    id: intent.id,
    projectId: intent.projectId,
    runId: intent.runId,
    intentHash: browserHostValueHash(intent),
    applicationOperationId: application.operationId,
    snapshot: application.snapshot,
    format,
    destination: intent.destination,
    output: intent.output,
    maxBytes: intent.maxBytes,
    maxRuntimeMs: intent.maxRuntimeMs,
  });
  if (
    existing &&
    browserHostValueHash(existing) !== browserHostValueHash(request)
  )
    throw new OutputHostError(
      "STALE_OUTPUT",
      "An export intent is already bound to a different final application.",
    );
  return request;
}
export const projectExportReceiptSchema = z
  .object({
    version: z.literal(1),
    kind: z.literal("project-export"),
    requestId: id,
    requestHash: digest,
    snapshot: outputSnapshotSchema,
    exportId: id,
    file: outputFormatSchema
      .extend({
        mimeType: z.literal("video/mp4"),
        byteLength: z.number().int().positive().max(OUTPUT_EXPORT_MAX_BYTES),
        sha256: digest,
      })
      .strict(),
    verification: z
      .object({
        mode: z.enum(["sampled", "full"]),
        status: z.literal("verified"),
        checks: z
          .array(
            z
              .object({
                id: z.string().min(1).max(100),
                status: z.enum(["passed", "failed", "skipped"]),
              })
              .strict(),
          )
          .max(32),
      })
      .strict(),
    download: z
      .object({
        state: z.enum(["not-started", "started", "acknowledged"]),
        method: z.enum(["none", "browser-download", "file-system"]),
      })
      .strict(),
    publication: z.literal("not-published"),
    semanticCoverage: z.literal("unknown"),
  })
  .strict();
export type ProjectExportReceipt = z.infer<typeof projectExportReceiptSchema>;
export function validateProjectExportReceipt(
  request: ProjectExportRequest,
  raw: unknown,
) {
  projectExportRequestSchema.parse(request);
  const receipt = projectExportReceiptSchema.parse(raw);
  if (
    receipt.requestId !== request.id ||
    receipt.requestHash !== browserHostValueHash(request) ||
    browserHostValueHash(receipt.snapshot) !==
      browserHostValueHash(request.snapshot) ||
    receipt.file.byteLength > request.maxBytes ||
    Object.entries(request.format).some(
      ([key, value]) =>
        receipt.file[key as keyof typeof request.format] !== value,
    ) ||
    receipt.verification.checks.some((check) => check.status === "failed")
  )
    throw new OutputHostError(
      "STALE_OUTPUT",
      "Export verification does not match the applied revision and output specification.",
    );
  if (
    ![
      "container_readable",
      "video_track_present",
      "video_dimensions_match",
      "video_duration_match",
      "video_frames_decoded",
      "resources_disposed",
    ].every((id) =>
      receipt.verification.checks.some(
        (check) => check.id === id && check.status === "passed",
      ),
    )
  )
    throw new OutputHostError(
      "INVALID_OUTPUT",
      "The saved export lacks required bounded decode verification.",
    );
  const audioChecks = request.format.hasAudio
    ? [
        "audio_track_presence_match",
        "audio_video_sync",
        "audio_samples_decoded",
        ...(request.format.requireAudibleAudio ? ["audio_audible"] : []),
      ]
    : [];
  if (
    audioChecks.some(
      (id) =>
        !receipt.verification.checks.some(
          (check) => check.id === id && check.status === "passed",
        ),
    )
  )
    throw new OutputHostError(
      "INVALID_OUTPUT",
      "The export lacks the requested bounded audio verification.",
    );
  if (
    (receipt.download.state === "not-started") !==
    (receipt.download.method === "none")
  )
    throw new OutputHostError(
      "INVALID_OUTPUT",
      "Download state does not match its actual host acknowledgment.",
    );
  return receipt;
}
/** Never accept publication from a browser/model claim. The caller must first
 * query and verify the owned ProjectVideoOutput and canonical storage record. */
export function assertProjectExportPublication(
  request: ProjectExportRequest,
  receipt: ProjectExportReceipt,
  ownerId: string,
  output: {
    id: string;
    browserExportId: string;
    userId: string;
    projectId: string;
    status: string;
    assetId: string | null;
    canonicalStorageVerified: boolean;
    snapshot: z.infer<typeof outputSnapshotSchema>;
    fileHash: string;
    byteLength: number;
  },
) {
  validateProjectExportReceipt(request, receipt);
  if (
    output.userId !== ownerId ||
    output.projectId !== request.projectId ||
    output.browserExportId !== receipt.exportId ||
    output.status !== "completed" ||
    !output.assetId ||
    !output.canonicalStorageVerified ||
    browserHostValueHash(output.snapshot) !==
      browserHostValueHash(request.snapshot) ||
    output.fileHash !== receipt.file.sha256 ||
    output.byteLength !== receipt.file.byteLength
  )
    throw new OutputHostError(
      "PUBLICATION_UNVERIFIED",
      "This file is not a verified owned project publication.",
    );
  return {
    state: "published" as const,
    outputId: output.id,
    assetId: output.assetId,
  };
}
