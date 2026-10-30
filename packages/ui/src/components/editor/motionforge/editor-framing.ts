import type { SceneNodeInput, SceneStyle } from "@motionforge/schema";
import {
  parseObjectPositionValue,
  type TransformOriginComponent,
} from "@motionforge/schema/values";

export type EditorFocalPoint =
  | { kind: "simple"; x: number; y: number }
  | { kind: "custom" | "animated" | "unsupported" };
function percent(value: TransformOriginComponent): number | null {
  if (value.kind === "keyword")
    return value.value === "center"
      ? 50
      : value.value === "left" || value.value === "top"
        ? 0
        : 100;
  return value.value.unit === "%" &&
    value.value.value >= 0 &&
    value.value.value <= 100
    ? value.value.value
    : null;
}
/** Read only representable percentages; custom authored units/animations stay intact. */
export function readEditorFocalPoint(node: SceneNodeInput): EditorFocalPoint {
  if (node.type !== "video" && node.type !== "img")
    return { kind: "unsupported" };
  if (
    node.animations?.some(
      (animation) =>
        animation.property === "objectPosition" ||
        animation.property === "objectFit",
    )
  )
    return { kind: "animated" };
  const parsed = parseObjectPositionValue(
    node.style?.objectPosition ?? "50% 50%",
  );
  if (!parsed) return { kind: "custom" };
  const x = percent(parsed.x),
    y = percent(parsed.y);
  return x === null || y === null
    ? { kind: "custom" }
    : { kind: "simple", x, y };
}
export function editorFocalPointPatch(
  node: SceneNodeInput,
  action:
    | { kind: "crop" }
    | { kind: "center" }
    | { kind: "position"; axis: "x" | "y"; value: number },
): Partial<SceneStyle> {
  const current = readEditorFocalPoint(node);
  if (current.kind === "unsupported" || current.kind === "animated")
    throw new Error(
      "Custom framing animation is preserved. These controls are unavailable.",
    );
  if (action.kind === "center")
    return { objectFit: "cover", objectPosition: "50% 50%" };
  if (action.kind === "crop") return { objectFit: "cover" };
  if (current.kind !== "simple")
    throw new Error(
      "This position uses custom units. Center the focal point to use percentage controls.",
    );
  if (!Number.isFinite(action.value) || action.value < 0 || action.value > 100)
    throw new Error("Focal position must be between 0 and 100.");
  return {
    objectFit: "cover",
    objectPosition: `${action.axis === "x" ? action.value : current.x}% ${action.axis === "y" ? action.value : current.y}%`,
  };
}
