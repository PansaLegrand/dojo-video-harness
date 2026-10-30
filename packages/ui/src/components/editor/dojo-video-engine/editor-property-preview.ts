import type { SceneNodeInput } from "@dojo-video-engine/schema";
import type { EditorDocument, EditorItem } from "@/lib/editor/document";
import {
  toEditorDocument,
  type VideoProjectDocument,
} from "@/lib/video-project/document";
import {
  editorCommandsToVideoCommands,
  executeVideoProjectCommands,
} from "@/lib/video-project/commands";
import { editorFormatCommands } from "./editor-aspect-ratio";

export type EditorPropertyPreview =
  | {
      kind: "node";
      itemId: string;
      nodeId: string;
      patch: Partial<Pick<SceneNodeInput, "params" | "volume">>;
    }
  | {
      kind: "caption";
      itemId: string;
      patch: Partial<
        Pick<
          NonNullable<EditorItem["caption"]>,
          "highlightColor" | "highlightStyle"
        >
      >;
    }
  | {
      kind: "format";
      patch: Partial<
        Pick<EditorDocument["format"], "width" | "height" | "backgroundColor">
      >;
    };

/** Use the same validated commands as commit, without changing persistence or history. */
export function previewEditorProperty(
  document: VideoProjectDocument,
  preview: EditorPropertyPreview,
): VideoProjectDocument {
  if (preview.kind === "format") {
    const commands = editorCommandsToVideoCommands(
      document,
      editorFormatCommands(toEditorDocument(document), preview.patch),
    );
    return commands.length
      ? executeVideoProjectCommands(document, commands).document
      : document;
  }
  const item = document.items.find((item) => item.id === preview.itemId);
  if (
    !item ||
    document.tracks.find((track) => track.id === item.trackId)?.locked
  )
    return document;
  if (preview.kind === "caption") {
    if (!item.caption) return document;
    const commands = editorCommandsToVideoCommands(document, [
      {
        type: "updateItem",
        id: item.id,
        patch: { caption: { ...item.caption, ...preview.patch } },
      },
    ]);
    return commands.length
      ? executeVideoProjectCommands(document, commands).document
      : document;
  }
  const { nodeId, patch } = preview;
  let found = false;
  function update(node: SceneNodeInput): SceneNodeInput {
    if (node.id === nodeId) {
      found = true;
      return { ...node, ...patch };
    }
    return { ...node, children: node.children?.map(update) };
  }
  const node = update(item.node);
  if (!found) return document;
  const commands = editorCommandsToVideoCommands(document, [
    { type: "updateItem", id: item.id, patch: { node } },
  ]);
  return commands.length
    ? executeVideoProjectCommands(document, commands).document
    : document;
}
