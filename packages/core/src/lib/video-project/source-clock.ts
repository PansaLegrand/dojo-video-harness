import { assertNoUntimedWordGap } from "./speech-word-range";
import type { EditorItem } from "@/lib/editor/document";
import {
  toEditorDocument,
  type VideoProjectDocument,
  type VideoSourceBinding,
} from "./document";
import { applyEditorCommand } from "@/lib/editor/commands";

export function sourceWindow(item: EditorItem, fps: number) {
  const rate = item.node.type === "video" ? (item.node.playbackRate ?? 1) : 1;
  if (rate <= 0)
    throw new Error("Source-bound edits require forward playback.");
  const startMs =
    (item.node.type === "video"
      ? (item.node.videoStartTime ?? 0)
      : (item.node.audioStartTime ?? 0)) * 1000;
  return {
    startMs,
    endMs: startMs + ((item.node.duration! * 1000) / fps) * rate,
    rate,
    from: item.node.from ?? 0,
  };
}
export function projectSourceRange(
  item: EditorItem,
  fps: number,
  startMs: number,
  endMs: number,
) {
  const window = sourceWindow(item, fps);
  const start = Math.max(startMs, window.startMs),
    end = Math.min(endMs, window.endMs);
  if (end <= start) return null;
  const from =
    window.from +
    Math.round((((start - window.startMs) / window.rate) * fps) / 1000);
  const until = Math.min(
    window.from + item.node.duration!,
    window.from +
      Math.round((((end - window.startMs) / window.rate) * fps) / 1000),
  );
  return until > from ? { from, duration: until - from } : null;
}
export function resolveSpeechAnchor(
  document: VideoProjectDocument,
  input: {
    id: string;
    itemId: string;
    sourceItemId: string;
    evidenceId: string;
    wordIds: string[];
    holdMs?: number;
  },
): VideoSourceBinding {
  const evidence = document.evidence[input.evidenceId];
  if (!evidence || !input.wordIds.length)
    throw new Error("Select source words from available transcript evidence.");
  const positions = input.wordIds.map((id) =>
    evidence.words.findIndex((word) => word.id === id),
  );
  if (
    positions.some(
      (position, index) =>
        position < 0 || (index > 0 && position !== positions[index - 1]! + 1),
    )
  )
    throw new Error(
      "A speech range must select contiguous source words in order.",
    );
  assertNoUntimedWordGap(evidence, input.wordIds);
  return {
    ...input,
    sourceAssetId: evidence.sourceAssetId,
    sourceRevision: evidence.sourceRevision,
    sourceStartMs: evidence.words[positions[0]!]!.startMs,
    sourceEndMs: evidence.words[positions[positions.length - 1]!]!.endMs,
    status: "active",
  };
}
export function reprojectVideoSourceBindings(
  document: VideoProjectDocument,
): void {
  const byItem = new Map(
    Object.values(document.bindings).map((binding) => [
      binding.itemId,
      binding,
    ]),
  );
  const active = new Set<string>(),
    done = new Set<string>();
  const visit = (binding: VideoSourceBinding) => {
    if (done.has(binding.id)) return;
    if (active.has(binding.id) || binding.itemId === binding.sourceItemId)
      throw new Error("Source bindings cannot form a cycle.");
    active.add(binding.id);
    const parent = byItem.get(binding.sourceItemId);
    if (parent) visit(parent);
    const source = document.items.find(
      (item) => item.id === binding.sourceItemId,
    );
    const target = document.items.find((item) => item.id === binding.itemId);
    if (source && target) {
      const projected =
        parent?.status === "unresolved"
          ? null
          : projectSourceRange(
              source,
              document.format.fps,
              binding.sourceStartMs,
              binding.sourceEndMs,
            );
      if (projected && binding.holdMs)
        projected.duration = Math.min(
          (source.node.from ?? 0) + source.node.duration! - projected.from,
          Math.max(
            projected.duration,
            Math.ceil((binding.holdMs * document.format.fps) / 1000),
          ),
        );
      binding.status = projected ? "active" : "unresolved";
      if (
        projected &&
        (target.node.from !== projected.from ||
          target.node.duration !== projected.duration)
      ) {
        if (["video", "audio"].includes(target.node.type)) {
          const result = applyEditorCommand(toEditorDocument(document), {
            type: "updateItem",
            id: target.id,
            patch: { node: { ...target.node, ...projected } },
          });
          document.items = result.items;
          document.format = result.format;
        } else Object.assign(target.node, projected);
      }
    }
    active.delete(binding.id);
    done.add(binding.id);
  };
  Object.values(document.bindings).forEach(visit);
}
