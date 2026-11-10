import type { NativeAgentScope } from "@/lib/video-project/agent-authoring";
import type { VideoProjectDocument } from "@/lib/video-project/document";
import type { VideoSourceResolution } from "@/lib/video-project/types";
import type { VideoProjectAgentRun } from "@/lib/video-project/agent-types";
import type { NativeAgentProgress } from "@/lib/video-project/agent-progress";
import { captionTimingDiagnostics } from "@/lib/video-project/caption-source-range";

export type EditorAgentSource = {
  itemId: string; assetId: string; name: string; fileName: string; fromFrame: number; durationInFrames: number; fps: number; seekFrame?: number;
  media: "available" | "loading" | "missing"; storage: "local" | "project" | "static";
  transcript: "ready" | "partial" | "needed" | "queued" | "running" | "failed" | "unknown" | "not_applicable";
};
function assetWindows(item: VideoProjectDocument["items"][number], projectDuration: number, pinnedNodeId?: string) {
  const windows = new Map<string, { from: number; until: number }>();
  const visit = (node: typeof item.node, parentFrom: number, parentDuration: number, inside: boolean) => {
    const from = parentFrom + (node.from ?? 0), duration = node.duration ?? parentDuration;
    const included = inside || node.id === pinnedNodeId;
    if (included) for (const assetId of [node.assetId, node.params?.audioAssetId, node.params?.coverAssetId]) {
      if (typeof assetId !== "string") continue;
      const prior = windows.get(assetId);
      windows.set(assetId, { from: Math.min(prior?.from ?? from, from), until: Math.max(prior?.until ?? from + duration, from + duration) });
    }
    node.children?.forEach(child => visit(child, from, duration, included));
  };
  visit(item.node, 0, projectDuration, !pinnedNodeId);
  return windows;
}

/** Preview the same complete-item scope used by the host. Linked caption sources
 * remain visible without broadening the edit's own authorization. */
export function editorAgentScopedSources(document: VideoProjectDocument | null, scope: NativeAgentScope | null,
  urls: Readonly<Record<string, string>>, registered: readonly VideoSourceResolution[] = [], restoring = false): EditorAgentSource[] {
  if (!document || !scope) return [];
  const ids = new Set(scope.kind === "selection" ? scope.itemIds : document.items.filter(item => scope.kind === "project" ||
    (item.node.from ?? 0) >= scope.fromFrame && (item.node.from ?? 0) + item.node.duration! <= scope.fromFrame + scope.durationInFrames).map(item => item.id));
  for (const item of document.items) if (ids.has(item.id) && item.caption?.sourceItemId) ids.add(item.caption.sourceItemId);
  const result: EditorAgentSource[] = [];
  for (const item of document.items) {
    if (!ids.has(item.id)) continue;
    const windows = assetWindows(item, document.format.durationInFrames, scope.kind === "selection" ? scope.node?.nodeId : undefined);
    for (const [assetId, window] of windows) {
      const asset = document.assets[assetId]; if (!asset || !["video", "audio", "image"].includes(asset.type)) continue;
      const record = registered.find(source => source.sourceId === assetId);
      const speech = ["video", "audio"].includes(item.node.type) && item.node.assetId === assetId;
      const evidence = speech ? Object.values(document.evidence).find(row => row.sourceAssetId === assetId && row.sourceRevision === document.sources[assetId]?.revision) : undefined;
      result.push({ itemId: item.id, assetId, name: item.name, fileName: asset.name, fromFrame: window.from, durationInFrames: window.until - window.from, fps: document.format.fps, seekFrame: window.from,
        media: urls[assetId] || asset.source === "static" && asset.src ? "available" : restoring || record?.status === "uploading" ? "loading" : "missing",
        storage: asset.source,
        transcript: !speech ? "not_applicable" : !evidence ? "needed" : captionTimingDiagnostics(document, item.id, evidence) ? "partial" : "ready" });
    }
  }
  return result;
}

/** Captured run scope remains stable after manual timeline changes. Local byte
 * availability refines browser_required only; provider readiness stays host-owned. */
export function editorAgentRunSources(progress: NativeAgentProgress, document: VideoProjectDocument | null, urls: Readonly<Record<string, string>>, restoring = false): EditorAgentSource[] {
  return progress.sources.map(source => {
    const asset = document?.assets[source.assetId], current = document?.items.find(item => item.id === source.itemId);
    const window = current && document ? assetWindows(current, document.format.durationInFrames).get(source.assetId) : undefined;
    return { itemId: source.itemId, assetId: source.assetId, name: source.name, fileName: asset?.name ?? source.name, fromFrame: source.fromFrame, durationInFrames: source.durationInFrames, fps: source.fps,
      ...(window ? { seekFrame: window.from } : {}),
      media: source.media === "cloud_available" ? "available" : source.media === "browser_required" ? urls[source.assetId] ? "available" : restoring ? "loading" : "missing" : "missing",
      storage: source.media === "cloud_available" ? asset?.source === "static" ? "static" : "project" : "local",
      transcript: source.evidence === "not_requested" ? "not_applicable" : source.evidence };
  });
}

export type EditorAgentRunPresentation = {
  execution: "waiting_media" | "transcribing" | "preparing" | "ready" | "answered" | "needs_input" | "attention" | "cancelled" | "cancelling";
  application: "pending" | "review" | "applied" | "not_applied" | "not_applicable";
  verified: number; coverage: "declared" | "recipe" | "unknown" | "verified" | "incomplete";
};

/** Transport success and model narration never imply verified or applied edits. */
export function editorAgentRunPresentation(run: Pick<VideoProjectAgentRun, "status" | "phase" | "prerequisites" | "proposal" | "manualReviewRequired" | "verification" | "progress">): EditorAgentRunPresentation {
  const applied = run.status === "applied";
  const ready = ["ready", "awaiting_review"].includes(run.status) && !!run.proposal;
  const execution = run.phase === "cancellation_pending" ? "cancelling" : run.status === "cancelled" ? "cancelled" :
    ["failed", "stale"].includes(run.status) ? "attention" : run.status === "needs_evidence" ? run.prerequisites?.status === "running" ? "transcribing" : "waiting_media" :
    run.status === "needs_input" ? "needs_input" : run.status === "completed" ? "answered" : ready || applied ? "ready" : "preparing";
  if (run.progress) {
    const execution = run.phase === "cancellation_pending" ? "cancelling" : ({ waiting_for_media: "waiting_media", waiting_for_consent: "waiting_media", transcribing: "transcribing", needs_input: "needs_input", preparing: "preparing", ready: "ready", failed: "attention", cancelled: "cancelled", completed: run.proposal ? "ready" : "answered" } as const)[run.progress.execution.state];
    const application = applied ? "applied" : run.progress.application.state === "not_applicable" ? "not_applicable" : ready ? run.manualReviewRequired ? "review" : "pending" : "not_applied";
    return { execution, application, verified: run.progress.deliverables.filter(output => output.status === "passed").length,
      coverage: run.progress.coverage === "undeclared" ? "unknown" : run.progress.coverage };
  }
  const verified = run.verification?.status === "passed" ? run.verification.outcomes.filter(outcome => outcome.passed).length : 0;
  return { execution, application: applied ? "applied" : ready ? run.manualReviewRequired ? "review" : "pending" : "not_applied",
    verified, coverage: run.verification?.status === "passed" ? run.verification.coverage === "declared-outcomes" ? "declared" : "recipe" : "unknown" };
}
