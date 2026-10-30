import type { VideoProjectDocument } from "@/lib/video-project/document";
import type { NativeAgentScope, NativeReviewBasis } from "@/lib/video-project/agent-authoring";
import { editorCapabilityAvailability, type EditorCapabilityInput } from "@/lib/video-project/capabilities";

export function editorQuickActions(document: VideoProjectDocument | null, itemId: string | null, nodeId: string | null, scope: NativeAgentScope | null): Array<{ label: string; action: EditorCapabilityInput }> {
  if (!document || !itemId || !nodeId || !scope) return [];
  const item = document.items.find(item => item.id === itemId); if (!item) return [];
  if (scope.kind === "selection" && (!scope.itemIds.includes(itemId) || scope.node && scope.node.nodeId !== nodeId)) return [];
  if (scope.kind === "range" && ((item.node.from ?? 0) < scope.fromFrame || (item.node.from ?? 0) + item.node.duration! > scope.fromFrame + scope.durationInFrames)) return [];
  const target = { itemId, nodeId }, available = new Set(editorCapabilityAvailability(document, target).filter(entry => entry.available).map(entry => entry.id));
  const choices: Array<{ label: string; capability: EditorCapabilityInput["capability"]; parameters: Record<string, unknown> }> = [
    { label: "Blue text", capability: "text.color", parameters: { color: "#2563eb" } },
    { label: "White text", capability: "text.color", parameters: { color: "#ffffff" } },
    { label: "Center layer", capability: "layer.center", parameters: { axis: "both" } },
    { label: "Fit media", capability: "media.fit", parameters: { fit: "contain" } },
    { label: "Fill media", capability: "media.fit", parameters: { fit: "cover" } },
    { label: "Half opacity", capability: "layer.opacity", parameters: { percent: 50 } },
    { label: "Full opacity", capability: "layer.opacity", parameters: { percent: 100 } },
    { label: "Half volume", capability: "audio.volume", parameters: { percent: 50 } },
    { label: "Mute audio", capability: "audio.volume", parameters: { percent: 0 } },
  ];
  return choices.filter(choice => available.has(choice.capability)).map(({ label, capability, parameters }) => ({ label, action: { version: 1, capability, target, parameters } }));
}

export function editorComparisonIsStale(basis: NativeReviewBasis, current: { revision: number; documentHash: string } | null, pending: number, drafts: number): boolean {
  return !current || pending > 0 || drafts > 0 || current.revision !== basis.baseRevision || current.documentHash !== basis.baseHash;
}
