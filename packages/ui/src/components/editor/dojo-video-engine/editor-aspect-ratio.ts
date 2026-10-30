import type { EditorCommand } from "@/lib/editor/commands";
import type { EditorDocument, EditorFormat } from "@/lib/editor/document";

export const editorAspectRatios = [
  { value: "9:16", width: 1080, height: 1920, label: "9:16 · Portrait" },
  { value: "16:9", width: 1920, height: 1080, label: "16:9 · Landscape" },
  { value: "1:1", width: 1080, height: 1080, label: "1:1 · Square" },
  { value: "4:5", width: 1080, height: 1350, label: "4:5 · Portrait" },
  { value: "dci", width: 2048, height: 1080, label: "DCI · Cinema" },
] as const;

export function editorAspectRatioValue(format: Pick<EditorFormat, "width" | "height">): string {
  return editorAspectRatios.find(preset => preset.width * format.height === preset.height * format.width)?.value ?? "custom";
}

/** Keep automatically fitted media attached to the canvas when its size changes. */
export function editorFormatCommands(document: EditorDocument, patch: Partial<EditorFormat>): EditorCommand[] {
  const commands: EditorCommand[] = [];
  const width = patch.width ?? document.format.width;
  const height = patch.height ?? document.format.height;
  if (width === document.format.width && height === document.format.height) return [{ type: "updateFormat", patch }];
  for (const item of document.items) {
    const style = item.node.style;
    if (!["video", "img"].includes(item.node.type) || !style || document.tracks.find(track => track.id === item.trackId)?.locked) continue;
    if ((style.left ?? 0) !== 0 || (style.top ?? 0) !== 0 || style.width !== document.format.width || style.height !== document.format.height) continue;
    commands.push({ type: "updateItem", id: item.id, patch: { node: { ...item.node, style: { ...style, width, height } } } });
  }
  // Apply FPS changes after refitting so media timing is retimed only once.
  return [...commands, { type: "updateFormat", patch }];
}
