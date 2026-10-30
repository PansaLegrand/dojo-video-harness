import type { Scene, SceneNode } from "@dojo-video-engine/schema";

/** Canvas shadows/filters use device pixels; retain fidelity until those paths
 * support a render scale explicitly. Authored coordinates never change. */
export function canScalePreview(scene: Scene): boolean {
  const visit = (node: SceneNode): boolean => {
    if (["effect", "extension", "lottie"].includes(node.type)) return false;
    const pixelStyles = ["boxShadow", "textShadow", "filter"] as const;
    if (
      pixelStyles.some((key) => node.style?.[key] && node.style[key] !== "none")
    )
      return false;
    if (
      node.animations?.some((animation) =>
        pixelStyles.includes(
          animation.property as (typeof pixelStyles)[number],
        ),
      )
    )
      return false;
    return node.children?.every(visit) ?? true;
  };
  return scene.nodes.every(visit);
}

export function previewResolution(
  scene: Scene,
  viewport: { width: number; height: number },
  devicePixelRatio = 1,
): { width: number; height: number } {
  if (!canScalePreview(scene))
    return { width: scene.width, height: scene.height };
  const dpr = Number.isFinite(devicePixelRatio)
    ? Math.max(1, Math.min(2, devicePixelRatio))
    : 1;
  const fit =
    viewport.width > 0 && viewport.height > 0
      ? Math.min(viewport.width / scene.width, viewport.height / scene.height) *
        dpr
      : 1;
  const scale = Math.min(1, fit, 1280 / Math.max(scene.width, scene.height));
  return {
    width: Math.max(1, Math.round(scene.width * scale)),
    height: Math.max(1, Math.round(scene.height * scale)),
  };
}
