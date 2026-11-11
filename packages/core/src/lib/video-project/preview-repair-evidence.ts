import type { PreviewRepairEvidence } from "../../../../agent-kit/src/preview-repair";
import { browserHostValueHash } from "./browser-host-requests";
import {
  projectPreviewRequestSchema,
  validateProjectPreviewReceipt,
} from "./browser-output-requests";
/** Called with the existing owned output reader's request, grant and immutable
 * receipt. Pixels and source/revision checks retain their existing authority. */
export function previewRepairEvidence(raw: {
  request: unknown;
  grant: unknown;
  receipt: unknown;
}): PreviewRepairEvidence {
  const request = projectPreviewRequestSchema.parse(raw.request);
  const receipt = validateProjectPreviewReceipt(
    request,
    raw.grant,
    raw.receipt,
  );
  if (!request.candidateRef || request.candidateRef.kind !== "verification")
    throw new Error(
      "Preview correction needs an owned successfully reviewed candidate.",
    );
  return {
    requestId: request.id,
    receiptHash: browserHostValueHash(receipt),
    candidateRef: request.candidateRef,
    snapshotHash: request.snapshot.documentHash,
    renderHash: receipt.renderHash,
    frames: receipt.frames.map((frame) => frame.frame),
    audio: receipt.audio,
  };
}
