import { createThreeRegistryOptions } from "@dojo-video-engine/three";
import { THREE_EXTENSION } from "@dojo-video-engine/three/schema";
import type { Scene, SceneNodeInput } from "@dojo-video-engine/schema";

let registry: ReturnType<typeof createThreeRegistryOptions> | undefined;
/** The module loads only the definition; Three.js itself loads when a layer resolves. */
export function graphicsRuntimeOptions(
  scene?: Scene,
): Partial<ReturnType<typeof createThreeRegistryOptions>> {
  const hasThree = (nodes: readonly SceneNodeInput[]): boolean =>
    nodes.some(
      (node) =>
        node.extension?.name === THREE_EXTENSION.name ||
        hasThree(node.children ?? []),
    );
  if (scene && !hasThree(scene.nodes)) return {};
  return (registry ??= createThreeRegistryOptions());
}
