import type { EditorAsset, EditorDocument } from "@/lib/editor/document";
import { type EditorCommand } from "@/lib/editor/commands";
import { highResolutionInsertionIssue } from "@/lib/dojo-video-engine-browser/preview-proxy-policy";
import { editorSourceInsertion, type EditorSourceRange } from "./editor-source-range";

/** Plan the complete selection before dispatch, so an invalid later source does
 * not leave a partially inserted selection. All items remain ordinary edits. */
export function buildEditorMediaInsertions(document: EditorDocument, assets: readonly EditorAsset[], from: number, createId: () => string,
  options: { selectedTrackId?: string; itemId?: string; range?: EditorSourceRange } = {}) {
  if (assets.length > 500) throw new Error("Select 500 clips or fewer for a single batch edit.");
  const current = { ...document, assets: { ...document.assets }, tracks: [...document.tracks], items: [...document.items] };
  let at = from;
  const chosenTracks: Partial<Record<"visual" | "audio", string>> = {};
  const commands: EditorCommand[] = [], itemIds: string[] = [];
  const append = (command: EditorCommand) => {
    // Match the native command-batch transport, including tracks and assets.
    if (commands.length >= 500) throw new Error("Choose fewer media files for one edit.");
    commands.push(command);
  };
  for (const asset of assets) {
    if (!["video", "audio", "image"].includes(asset.type)) throw new Error("Choose a video, audio or image file.");
    const admissionIssue = highResolutionInsertionIssue(current, asset);
    if (admissionIssue) throw new Error(admissionIssue);
    const insertion = editorSourceInsertion(asset, current.format.fps, options.range);
    const kind = asset.type === "audio" ? "audio" : "visual";
    let track = current.tracks.find(track => track.id === (chosenTracks[kind] ?? options.selectedTrackId) && track.kind === kind && !track.locked) ?? current.tracks.find(track => track.kind === kind && !track.locked);
    if (!track || current.items.some(item => item.trackId === track!.id && (item.node.from ?? 0) < at + insertion.duration && (item.node.from ?? 0) + item.node.duration! > at)) {
      track = { id: createId(), name: `${kind === "audio" ? "Audio" : "Video & graphics"} ${current.tracks.length + 1}`, kind, muted: false, hidden: false, locked: false };
      append({ type: "addTrack", track });
      current.tracks.push(track);
    }
    chosenTracks[kind] = track.id;
    if (!current.assets[asset.id]) { append({ type: "addAsset", asset }); current.assets[asset.id] = asset; }
    const itemId = options.itemId ?? createId(); itemIds.push(itemId);
    const item = { id: itemId, trackId: track.id, name: asset.name, node: {
      id: itemId, type: asset.type === "image" ? "img" as const : asset.type === "audio" ? "audio" as const : "video" as const, assetId: asset.id, from: at, ...insertion,
      ...(asset.type !== "image" ? { volume: 1 } : {}),
      ...(asset.type !== "audio" ? { style: { position: "absolute" as const, left: 0, top: 0, width: current.format.width, height: current.format.height, objectFit: "contain" as const } } : {}),
      animations: [], children: [],
    } };
    append({ type: "addItem", item }); current.items.push(item);
    at += insertion.duration;
  }
  return { commands, itemIds, endFrame: at };
}
