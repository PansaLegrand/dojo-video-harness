import type { SceneNodeInput } from "@dojo-video-engine/schema";
import type { EditorItem, EditorTrack } from "./document";

export const editorItemKinds = {
  video: "Video",
  image: "Images",
  three: "Three.js scenes",
  svg: "SVG / Vector",
  graphics: "Graphics",
  visualizer: "Music visualizer",
  text: "Text",
  subtitles: "Subtitles",
  translation: "Translated subtitles",
  audio: "Audio",
} as const;
export type EditorItemKind = keyof typeof editorItemKinds;

export function editorItemKind(item: EditorItem): EditorItemKind {
  if (item.caption)
    return item.caption.role === "translation" ? "translation" : "subtitles";
  if (item.node.type === "audio") return "audio";
  if (item.node.type === "video") return "video";
  if (item.node.type === "img") return "image";
  if (item.visualizerSourceItemId || item.node.type === "effect")
    return "visualizer";
  const nodes: SceneNodeInput[] = [];
  const visit = (node: SceneNodeInput) => {
    nodes.push(node);
    node.children?.forEach(visit);
  };
  visit(item.node);
  if (nodes.some((node) => node.extension?.name === "dojo.three-scene"))
    return "three";
  if (item.motionGraphic) return "graphics";
  if (nodes.some((node) => node.type === "shape")) return "svg";
  if (
    nodes.some((node) => node.type === "text") &&
    nodes.every((node) => node.type === "text" || node.type === "div")
  )
    return "text";
  return "graphics";
}

/** Documents retain back-to-front paint order; the timeline presents overlays above footage. */
export function editorTimelineTracks(
  tracks: readonly EditorTrack[],
): EditorTrack[] {
  return [
    ...tracks.filter((track) => track.kind === "visual").reverse(),
    ...tracks.filter((track) => track.kind === "audio"),
  ];
}

export function editorTrackContentKind(
  track: EditorTrack,
  items: readonly EditorItem[],
): EditorItemKind | undefined {
  const kinds = new Set(
    items.filter((item) => item.trackId === track.id).map(editorItemKind),
  );
  if (kinds.size === 1) return [...kinds][0];
  if (kinds.size) return undefined;
  if (track.kind === "audio") return "audio";
  if (track.id === "visual" && track.name === "Video & graphics")
    return "video";
  return (Object.keys(editorItemKinds) as EditorItemKind[]).find(
    (kind) =>
      track.name === editorItemKinds[kind] ||
      track.name.startsWith(editorItemKinds[kind] + " "),
  );
}

export function editorTimelineTrackName(
  track: EditorTrack,
  items: readonly EditorItem[],
  translate: (text: string) => string,
): string {
  if (/^Video & graphics(?: \d+)?$/.test(track.name)) {
    const kind = editorTrackContentKind(track, items);
    if (kind) return translate(editorItemKinds[kind]);
  }
  for (const label of Object.values(editorItemKinds)) {
    if (track.name === label) return translate(label);
    const suffix = track.name.slice(label.length);
    if (track.name.startsWith(label) && /^ \d+$/.test(suffix))
      return translate(label) + suffix;
  }
  return translate(track.name);
}
