import type { CaptionCue } from "@/lib/editor/document";
import type { VideoProjectDocument } from "@/lib/video-project/document";
import {
  editorCommandsToVideoCommands,
  executeVideoProjectCommands,
} from "@/lib/video-project/commands";

export type EditorContentPreview = { itemId: string } & (
  | { nodeId: string; text: string }
  | { cue: CaptionCue }
);

/** Apply display text to a render-only copy; original transcript evidence is immutable. */
export function previewEditorContent(
  document: VideoProjectDocument,
  preview: EditorContentPreview,
): VideoProjectDocument {
  const item = document.items.find((item) => item.id === preview.itemId);
  if (
    !item ||
    document.tracks.find((track) => track.id === item.trackId)?.locked
  )
    return document;
  if ("cue" in preview) {
    if (!item.caption?.cues.some((cue) => cue.id === preview.cue.id))
      return document;
    const caption = {
      ...item.caption,
      cues: item.caption.cues.map((cue) =>
        cue.id === preview.cue.id ? preview.cue : cue,
      ),
    };
    const commands = editorCommandsToVideoCommands(document, [
      { type: "updateItem", id: item.id, patch: { caption } },
    ]);
    return commands.length
      ? executeVideoProjectCommands(document, commands).document
      : document;
  }
  const nodes = [item.node];
  while (nodes.length) {
    const node = nodes.pop()!;
    if (node.id === preview.nodeId && node.type === "text") {
      const target = {
        kind: "node" as const,
        itemId: item.id,
        nodeId: preview.nodeId,
      };
      return executeVideoProjectCommands(document, [
        { type: "set", target, path: ["text"], value: preview.text },
        { type: "clear", target, path: ["runs"] },
      ]).document;
    }
    nodes.push(...(node.children ?? []));
  }
  return document;
}
