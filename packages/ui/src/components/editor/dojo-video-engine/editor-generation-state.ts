import type { EditorExternalJobSummary } from "@/lib/video-project/external-job-types";
import type { VideoProjectAgentStatus } from "@/lib/video-project/agent-types";
import type { VideoProjectDocument } from "@/lib/video-project/document";
const active = new Set(["submitting", "running", "reconciliation_required", "storage_pending", "probing"]);
const stopped = new Set(["failed", "stale", "cancelled"]);
export type EditorGenerationPlacement = { trackId: string; fromFrame: number; durationInFrames: number; volume: number };
export function editorGenerationPlacement(raw: unknown): EditorGenerationPlacement | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const value = raw as Record<string, unknown>;
  if (typeof value.trackId !== "string" || !value.trackId || !Number.isSafeInteger(value.fromFrame) || Number(value.fromFrame) < 0 || Number(value.fromFrame) > 2_592_000 ||
    !Number.isSafeInteger(value.durationInFrames) || Number(value.durationInFrames) < 1 || Number(value.durationInFrames) > 216_000 || typeof value.volume !== "number" || !Number.isFinite(value.volume) || value.volume < 0 || value.volume > 1) return null;
  return { trackId: value.trackId, fromFrame: Number(value.fromFrame), durationInFrames: Number(value.durationInFrames), volume: value.volume };
}
export function editorGenerationOutputAvailable(job: EditorExternalJobSummary): boolean {
  const output = job.output;
  if (!["ready", "needs_review"].includes(job.status) || !job.assetId || !output || !["image", "video", "audio"].includes(output.kind) || !Number.isSafeInteger(output.byteLength) || output.byteLength <= 0) return false;
  const kind = job.kind === "music" ? "audio" : job.kind === "image" ? "image" : ["text_to_video", "image_to_video"].includes(job.kind) ? "video" : null;
  if (output.kind !== kind || typeof output.mimeType !== "string" || !output.mimeType.startsWith(kind === "image" ? "image/" : kind === "video" ? "video/" : "audio/")) return false;
  if (kind !== "audio" && (![output.width, output.height].every(value => Number.isSafeInteger(value) && value > 0))) return false;
  if (kind !== "image" && !(typeof output.durationSeconds === "number" && Number.isFinite(output.durationSeconds) && output.durationSeconds > 0)) return false;
  return true;
}
export function editorGenerationAssetUsed(job: EditorExternalJobSummary, document: VideoProjectDocument | null): boolean {
  if (!document || !job.assetId) return false;
  const ids = new Set(Object.values(document.assets).filter(asset => asset.source === "project" && asset.assetId === job.assetId).map(asset => asset.id));
  const visit = (node: VideoProjectDocument["items"][number]["node"]): boolean => !!node.assetId && ids.has(node.assetId) ||
    typeof node.params?.audioAssetId === "string" && ids.has(node.params.audioAssetId) || typeof node.params?.coverAssetId === "string" && ids.has(node.params.coverAssetId) || !!node.children?.some(visit);
  return document.items.some(item => visit(item.node));
}
export function editorGenerationState(job: EditorExternalJobSummary, parentStatus: VideoProjectAgentStatus, childStatus?: VideoProjectAgentStatus, inProject = false, now = Date.now()) {
  const credits = Number.isSafeInteger(job.quote?.credits) && job.quote.credits >= 0 ? Number(job.quote.credits) : null;
  const expires = typeof job.quote?.expiresAt === "string" ? Date.parse(job.quote.expiresAt) : NaN;
  const quoteValid = credits !== null && Number.isFinite(expires) && expires > now && /^sha256:[a-f0-9]{64}$/.test(job.quote?.quoteHash ?? "");
  const outputAvailable = editorGenerationOutputAvailable(job), cancelled = job.cancellationRequested || parentStatus === "cancelled", stale = ["stale", "failed"].includes(parentStatus);
  const placement = childStatus === "applied" ? inProject ? "applied" : "removed" : childStatus && stopped.has(childStatus) ? "attention" : job.insertionRunId ? "pending" : "not_added";
  const mustReuse = job.status === "needs_review" || cancelled || stale || placement === "attention" || placement === "removed";
  return { credits, quoteValid, quoteExpired: Number.isFinite(expires) && expires <= now,
    active: active.has(job.status), outputAvailable,
    canApprove: job.status === "quoted" && quoteValid && !cancelled && !stale,
    canReconcile: active.has(job.status),
    canCancel: !job.cancellationRequested && (job.status === "quoted" || active.has(job.status) || outputAvailable && placement !== "applied"),
    canPlace: outputAvailable && !["applied", "pending"].includes(placement),
    canAutoPlace: outputAvailable && job.status === "ready" && !cancelled && !stale && !job.insertionRunId,
    mustReuse, placement };
}
/** Convert the frozen planned span once when editing a saved placement; generated
 * duration remains a separate canonical output fact. */
export function editorGenerationCurrentPlacement(job: EditorExternalJobSummary, document: VideoProjectDocument): EditorGenerationPlacement | null {
  const original = editorGenerationPlacement(job.placement);
  if (!original || !Number.isFinite(job.placementFps) || job.placementFps <= 0) return null;
  const ratio = document.format.fps / job.placementFps;
  return { ...original, fromFrame: Math.round(original.fromFrame * ratio), durationInFrames: Math.max(1, Math.round(original.durationInFrames * ratio)) };
}
