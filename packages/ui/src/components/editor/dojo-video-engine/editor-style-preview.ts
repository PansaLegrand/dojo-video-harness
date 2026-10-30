import type { SceneNodeInput, SceneStyle } from "@dojo-video-engine/schema";
import { editorFontStyle, getEditorFontAssets } from "@/lib/editor/fonts";
import type { EditorCommand } from "@/lib/editor/commands";
import type { VideoProjectDocument } from "@/lib/video-project/document";
import { editorCommandsToVideoCommands, executeVideoProjectCommands } from "@/lib/video-project/commands";
import { updateEditorNodeStyle } from "./editor-presets";

export type EditorStylePreview = { itemId: string; nodeId: string; style: Partial<SceneStyle> };
export { editorFontStyle } from "@/lib/editor/fonts";
/** A validated render-only document. The controller and its history stay untouched. */
export function previewEditorStyle(document: VideoProjectDocument, preview: EditorStylePreview): VideoProjectDocument {
  const item = document.items.find(item => item.id === preview.itemId);
  if (!item || document.tracks.find(track => track.id === item.trackId)?.locked) return document;
  let found = false;
  function update(node: SceneNodeInput): SceneNodeInput {
    if (node.id === preview.nodeId) { found = true; return updateEditorNodeStyle(node, { ...preview.style, ...(preview.style.fontFamily ? editorFontStyle(node.style, preview.style.fontFamily) : {}) }); }
    return { ...node, children: node.children?.map(update) };
  }
  const node = update(item.node);
  if (!found) return document;
  const fonts: EditorCommand[] = preview.style.fontFamily ? getEditorFontAssets(preview.style.fontFamily).filter(asset => !document.assets[asset.id]).map(asset => ({ type: "addAsset", asset })) : [];
  const commands = editorCommandsToVideoCommands(document, [...fonts, { type: "updateItem", id: item.id, patch: { node } }]);
  return commands.length ? executeVideoProjectCommands(document, commands).document : document;
}
