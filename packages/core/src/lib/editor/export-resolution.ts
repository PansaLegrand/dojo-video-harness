import {
  parseScene,
  type Scene,
  type SceneNodeInput,
} from "@motionforge/schema";
import { assertEditorCanvasDimensions } from "./canvas-format";

export const editorExportResolutions = [
  { value: "source", label: "Original", longEdge: null },
  { value: "1080p", label: "Full HD", longEdge: 1920 },
  { value: "2k", label: "2K", longEdge: 2048 },
  { value: "qhd", label: "QHD", longEdge: 2560 },
  { value: "3k", label: "3K", longEdge: 3072 },
  { value: "4k", label: "4K", longEdge: 3840 },
  { value: "4096", label: "4096 px", longEdge: 4096 },
] as const;
export type EditorExportResolution =
  (typeof editorExportResolutions)[number]["value"];
export function isEditorExportResolution(
  value: unknown,
): value is EditorExportResolution {
  return editorExportResolutions.some((option) => option.value === value);
}

/** Presets name the long edge; H.264 requires the other edge to be even. */
export function editorExportDimensions(
  format: { width: number; height: number },
  resolution: EditorExportResolution,
) {
  const longEdge = editorExportResolutions.find(
    (option) => option.value === resolution,
  )?.longEdge;
  if (!longEdge) return { width: format.width, height: format.height };
  const scale = longEdge / Math.max(format.width, format.height);
  const dimensions = {
    width: Math.round((format.width * scale) / 2) * 2,
    height: Math.round((format.height * scale) / 2) * 2,
  };
  assertEditorCanvasDimensions(dimensions);
  return dimensions;
}

/** Scale the complete rendered composition, preserving authored geometry and clocks. */
export function editorExportScene(
  scene: Scene,
  resolution: EditorExportResolution,
): Scene {
  const dimensions = editorExportDimensions(scene, resolution);
  assertEditorCanvasDimensions(dimensions);
  if (dimensions.width === scene.width && dimensions.height === scene.height)
    return scene;
  const scale = Math.min(
    dimensions.width / scene.width,
    dimensions.height / scene.height,
  );
  const ids = new Set<string>();
  const collect = (node: SceneNodeInput) => {
    ids.add(node.id);
    node.children?.forEach(collect);
  };
  scene.nodes.forEach(collect);
  let id = "__editor_export_scale";
  while (ids.has(id)) id += "_";
  return parseScene({
    ...scene,
    ...dimensions,
    nodes: [
      {
        id,
        type: "div",
        from: 0,
        duration: scene.duration,
        style: {
          position: "absolute",
          width: scene.width,
          height: scene.height,
          left: (dimensions.width - scene.width * scale) / 2,
          top: (dimensions.height - scene.height * scale) / 2,
          transformOrigin: "left top",
          transform: `scale(${scale})`,
        },
        children: scene.nodes,
      },
    ],
  });
}
