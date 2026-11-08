import type { SceneNodeInput } from "@dojo-video-engine/schema";
import type { VideoProjectDocument } from "./document";

function textConstraints(node: SceneNodeInput) {
  return {
    text: node.text ?? node.runs?.map(run => run.text).join("") ?? "",
    fit: node.style?.textFit,
    maxLines: node.style?.maxLines,
  };
}

/** Check the font-independent conflict before accepting an agent proposal. */
export function assertNativeTextLineLimits(before: VideoProjectDocument, after: VideoProjectDocument) {
  const previous = new Map<string, ReturnType<typeof textConstraints>>();
  const collect = (node: SceneNodeInput) => {
    if (node.type === "text") previous.set(node.id, textConstraints(node));
    node.children?.forEach(collect);
  };
  before.items.forEach(item => collect(item.node));
  const check = (node: SceneNodeInput) => {
    if (node.type === "text") {
      const current = textConstraints(node);
      const old = previous.get(node.id);
      // Existing projects remain editable while the user repairs older layouts.
      const unchanged = old && old.text === current.text && old.fit === current.fit && old.maxLines === current.maxLines;
      const lines = current.text.split("\n").length;
      if (!unchanged && current.fit === "shrink" && current.maxLines !== undefined && lines > current.maxLines) {
        throw new Error(`Text node "${node.id}" contains ${lines} explicit lines but maxLines is ${current.maxLines}. Increase maxLines to at least ${lines} or remove line breaks. A smaller font cannot resolve explicit line breaks.`);
      }
    }
    node.children?.forEach(check);
  };
  after.items.forEach(item => check(item.node));
}
