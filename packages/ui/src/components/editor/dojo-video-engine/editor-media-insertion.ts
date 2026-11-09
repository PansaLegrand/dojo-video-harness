import type { EditorAsset, EditorDocument } from "@/lib/editor/document";
import { applyEditorCommand, type EditorCommand } from "@/lib/editor/commands";
import { highResolutionInsertionIssue } from "@/lib/dojo-video-engine-browser/preview-proxy-policy";
import { editorSourceInsertion, type EditorSourceRange } from "./editor-source-range";

/** Plan the complete selection before dispatch, so an invalid later source does
 * not leave a partially inserted selection. All items remain ordinary edits. */
export function buildEditorMediaInsertions(document: EditorDocument, assets: readonly EditorAsset[], from: number, createId: () => string,
  options: { selectedTrackId?: string; itemId?: string; range?: EditorSourceRange } = {}) {
  let current = document, at = from;
  const commands: EditorCommand[] = [], itemIds: string[] = [];
  const append = (command: EditorCommand) => { current = applyEditorCommand(current, command); commands.push(command); };
  for (const asset of assets) {
    if (!["video", "audio", "image"].includes(asset.type)) throw new Error("Choose a video, audio or image file.");
    const admissionIssue = highResolutionInsertionIssue(current, asset);
    if (admissionIssue) throw new Error(admissionIssue);
    const insertion = editorSourceInsertion(asset, current.format.fps, options.range);
    const kind = asset.type === "audio" ? "audio" : "visual";
    let track = current.tracks.find(track => track.id === options.selectedTrackId && track.kind === kind && !track.locked) ?? current.tracks.find(track => track.kind === kind && !track.locked);
    if (!track || current.items.some(item => item.trackId === track!.id && (item.node.from ?? 0) < at + insertion.duration && (item.node.from ?? 0) + item.node.duration! > at)) {
      track = { id: createId(), name: `${kind === "audio" ? "Audio" : "Video & graphics"} ${current.tracks.length + 1}`, kind, muted: false, hidden: false, locked: false };
      append({ type: "addTrack", track });
    }
    if (!current.assets[asset.id]) append({ type: "addAsset", asset });
    const itemId = options.itemId ?? createId(); itemIds.push(itemId);
    append({ type: "addItem", item: { id: itemId, trackId: track.id, name: asset.name, node: {
      id: itemId, type: asset.type === "image" ? "img" : asset.type === "audio" ? "audio" : "video", assetId: asset.id, from: at, ...insertion,
      ...(asset.type !== "image" ? { volume: 1 } : {}),
      ...(asset.type !== "audio" ? { style: { position: "absolute", left: 0, top: 0, width: current.format.width, height: current.format.height, objectFit: "contain" } } : {}),
      animations: [], children: [],
    } } });
    at += insertion.duration;
  }
  return { commands, itemIds, endFrame: at };
}
