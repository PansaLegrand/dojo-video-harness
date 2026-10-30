import {
  isAudioReactiveEffect,
  parseScene,
  type Scene,
  type SceneAsset,
  type SceneEffectName,
  type SceneNode,
} from "./index";
import { fontAssetIdsForFamily } from "./font-assets";

export type SceneInspection = {
  schemaVersion: number;
  width: number;
  height: number;
  fps: number;
  durationFrames: number;
  durationSeconds: number;
  markers: { total: number; names: string[] };
  media: {
    reachableAssets: number;
    unreachableAssets: number;
    audioBuses: number;
    video: {
      freeze: true;
      loop: boolean;
      reverseVisual: boolean;
      reverseAudio: false;
    };
  };
  assets: { total: number } & Record<SceneAsset["type"], number>;
  nodes: { total: number; root: number } & Record<SceneNode["type"], number>;
  effects: Partial<Record<SceneEffectName, number>>;
  extensions: Record<string, number>;
  capabilities: {
    hasVisuals: boolean;
    hasAudio: boolean;
    hasVideo: boolean;
    hasLottie: boolean;
    hasEffects: boolean;
    hasExtensions: boolean;
    hasShapes: boolean;
    hasVectorPaths: boolean;
    hasClipping: boolean;
    hasMasks: boolean;
    hasSoftMasks: boolean;
    hasBlendModes: boolean;
    hasIsolatedGroups: boolean;
    hasRichText: boolean;
    hasAudioReactiveEffects: boolean;
    hasFonts: boolean;
    hasAnimations: boolean;
    hasVolumeAutomation: boolean;
    hasLoopedAudio: boolean;
    hasLoopedVideo: boolean;
    hasReverseVideo: boolean;
    hasAudioBuses: boolean;
    hasPanning: boolean;
    hasDucking: boolean;
    requiresBrowserExport: true;
  };
};

export function inspectScene(input: unknown): SceneInspection {
  const scene = parseScene(input);
  const assets: SceneInspection["assets"] = {
    total: 0,
    image: 0,
    video: 0,
    audio: 0,
    font: 0,
    lottie: 0,
  };
  const nodes: SceneInspection["nodes"] = {
    total: 0,
    root: scene.nodes.length,
    div: 0,
    text: 0,
    img: 0,
    video: 0,
    audio: 0,
    lottie: 0,
    effect: 0,
    extension: 0,
    shape: 0,
  };
  const effects: SceneInspection["effects"] = {};
  const extensions: SceneInspection["extensions"] = {};
  let hasAnimations = false;
  let hasVolumeAutomation = false;
  let hasLoopedAudio = false;
  let hasAudioReactiveEffects = false;
  let hasLoopedVideo = false;
  let hasReverseVideo = false;
  let hasPanning = false;
  let hasDucking = false;
  const reachableAssets = new Set<string>();
  let hasVectorPaths = false;
  let hasClipping = false;
  let hasMasks = false;
  let hasSoftMasks = false;
  let hasBlendModes = false;
  let hasIsolatedGroups = false;
  let hasRichText = false;

  for (const asset of Object.values(scene.assets)) {
    assets.total += 1;
    assets[asset.type] += 1;
  }

  const visit = (sceneNodes: Scene["nodes"]): void => {
    for (const node of sceneNodes) {
      nodes.total += 1;
      nodes[node.type] += 1;

      if (node.effect) {
        effects[node.effect] = (effects[node.effect] ?? 0) + 1;
        hasAudioReactiveEffects ||= isAudioReactiveEffect(node.effect);
      }
      if (node.extension) {
        const key = `${node.extension.name}@${node.extension.version}`;
        extensions[key] = (extensions[key] ?? 0) + 1;
      }
      hasVectorPaths ||=
        node.shape?.kind === "path" ||
        node.clip?.kind === "path" ||
        node.mask?.shape.kind === "path";
      hasClipping ||= node.clip !== undefined;
      hasMasks ||= node.mask !== undefined;
      hasSoftMasks ||=
        (node.mask?.feather ?? 0) > 0 || (node.mask?.opacity ?? 1) < 1;
      hasBlendModes ||= node.style?.blendMode !== undefined;
      hasIsolatedGroups ||= node.style?.isolation === true;
      hasRichText ||= (node.runs?.length ?? 0) > 0;
      hasAnimations ||= (node.animations ?? []).length > 0;
      hasVolumeAutomation ||= node.volumeEnvelope !== undefined;
      hasLoopedAudio ||= node.type === "audio" && node.loop === true;
      hasLoopedVideo ||=
        node.type === "video" && node.videoEndBehavior === "loop";
      hasReverseVideo ||= node.type === "video" && (node.playbackRate ?? 1) < 0;
      hasPanning ||= node.pan !== undefined && node.pan !== 0;
      hasDucking ||= node.ducks !== undefined;
      if (node.assetId) reachableAssets.add(node.assetId);
      if (node.params?.audioAssetId)
        reachableAssets.add(node.params.audioAssetId);
      if (node.params?.coverAssetId)
        reachableAssets.add(node.params.coverAssetId);
      if (node.style?.fontFamily)
        fontAssetIdsForFamily(scene.assets, node.style.fontFamily).forEach(
          (id) => reachableAssets.add(id),
        );
      visit(node.children ?? []);
    }
  };

  visit(scene.nodes);

  return {
    schemaVersion: scene.schemaVersion,
    width: scene.width,
    height: scene.height,
    fps: scene.fps,
    durationFrames: scene.duration,
    durationSeconds: scene.duration / scene.fps,
    markers: {
      total: Object.keys(scene.markers ?? {}).length,
      names: Object.keys(scene.markers ?? {}).sort(),
    },
    media: {
      reachableAssets: reachableAssets.size,
      unreachableAssets: Math.max(0, assets.total - reachableAssets.size),
      audioBuses: Object.keys(scene.audioBuses ?? {}).length,
      video: {
        freeze: true,
        loop: hasLoopedVideo,
        reverseVisual: hasReverseVideo,
        reverseAudio: false,
      },
    },
    assets,
    nodes,
    effects,
    extensions,
    capabilities: {
      hasVisuals:
        nodes.div +
          nodes.text +
          nodes.img +
          nodes.video +
          nodes.lottie +
          nodes.effect +
          nodes.extension +
          nodes.shape >
        0,
      hasAudio: nodes.audio > 0 || nodes.video > 0 || assets.audio > 0,
      hasVideo: nodes.video > 0 || assets.video > 0,
      hasLottie: nodes.lottie > 0 || assets.lottie > 0,
      hasEffects: nodes.effect > 0,
      hasExtensions: nodes.extension > 0,
      hasShapes: nodes.shape > 0,
      hasVectorPaths,
      hasClipping,
      hasMasks,
      hasSoftMasks,
      hasBlendModes,
      hasIsolatedGroups,
      hasRichText,
      hasAudioReactiveEffects,
      hasFonts: assets.font > 0,
      hasAnimations,
      hasVolumeAutomation,
      hasLoopedAudio,
      hasLoopedVideo,
      hasReverseVideo,
      hasAudioBuses: Object.keys(scene.audioBuses ?? {}).length > 0,
      hasPanning,
      hasDucking,
      requiresBrowserExport: true,
    },
  };
}

export type SceneLintIssue = {
  severity: "warning";
  code:
    | "animation_outside_node"
    | "inaudible_media"
    | "invisible_node"
    | "node_window_clipped"
    | "node_window_empty"
    | "unused_asset";
  path: Array<string | number>;
  message: string;
  nodeId?: string;
  assetId?: string;
};

export type SceneLintResult =
  | { ok: true; scene: Scene; issues: SceneLintIssue[] }
  | { ok: false; errors: string[] };

/**
 * Finds valid-but-suspicious scene data without changing it. Invalid scenes
 * are returned as validation errors so agents can use one preflight call.
 */
export function lintScene(input: unknown): SceneLintResult {
  let scene: Scene;
  try {
    scene = parseScene(input);
  } catch (error) {
    return {
      ok: false,
      errors: [error instanceof Error ? error.message : String(error)],
    };
  }

  const issues: SceneLintIssue[] = [];
  const referencedAssets = new Set<string>();

  const visit = (
    nodes: Scene["nodes"],
    parentDuration: number,
    path: Array<string | number>,
  ): void => {
    nodes.forEach((node, index) => {
      const nodePath = [...path, index];
      const from = node.from ?? 0;
      const animations = node.animations ?? [];
      const style = node.style ?? {};
      const declaredDuration =
        node.duration ?? Math.max(0, parentDuration - from);
      const visibleDuration = Math.max(
        0,
        Math.min(declaredDuration, parentDuration - from),
      );

      if (from >= parentDuration) {
        issues.push({
          severity: "warning",
          code: "node_window_empty",
          path: [...nodePath, "from"],
          nodeId: node.id,
          message: `Node "${node.id}" starts at frame ${from}, outside its parent duration ${parentDuration}, so it never renders.`,
        });
      } else if (from + declaredDuration > parentDuration) {
        issues.push({
          severity: "warning",
          code: "node_window_clipped",
          path: [...nodePath, "duration"],
          nodeId: node.id,
          message: `Node "${node.id}" ends after its parent and is clipped to ${visibleDuration} visible frame(s).`,
        });
      }

      for (
        let animationIndex = 0;
        animationIndex < animations.length;
        animationIndex += 1
      ) {
        const animation = animations[animationIndex];
        if (!animation) continue;
        const lastFrame = animation?.frames[animation.frames.length - 1]?.frame;
        if (lastFrame !== undefined && lastFrame >= visibleDuration) {
          issues.push({
            severity: "warning",
            code: "animation_outside_node",
            path: [...nodePath, "animations", animationIndex, "frames"],
            nodeId: node.id,
            message: `Animation "${animation.property}" on node "${node.id}" ends at local frame ${lastFrame}, outside its ${visibleDuration}-frame visible window.`,
          });
        }
      }

      if (
        node.type !== "audio" &&
        style.opacity === 0 &&
        !animations.some((animation) => animation.property === "opacity")
      ) {
        issues.push({
          severity: "warning",
          code: "invisible_node",
          path: [...nodePath, "style", "opacity"],
          nodeId: node.id,
          message: `Node "${node.id}" has opacity 0 and no opacity animation, so it never becomes visible.`,
        });
      }

      if (
        (node.type === "audio" || node.type === "video") &&
        node.volume === 0 &&
        !(node.volumeEnvelope ?? []).some((point) => point.value > 0)
      ) {
        issues.push({
          severity: "warning",
          code: "inaudible_media",
          path: [...nodePath, "volume"],
          nodeId: node.id,
          message: `${node.type} node "${node.id}" has zero gain for its whole window.`,
        });
      }

      if (node.assetId) referencedAssets.add(node.assetId);
      if (node.params?.audioAssetId)
        referencedAssets.add(node.params.audioAssetId);
      if (node.params?.coverAssetId)
        referencedAssets.add(node.params.coverAssetId);
      if (node.style?.fontFamily)
        fontAssetIdsForFamily(scene.assets, node.style.fontFamily).forEach(
          (id) => referencedAssets.add(id),
        );

      visit(node.children ?? [], visibleDuration, [...nodePath, "children"]);
    });
  };

  visit(scene.nodes, scene.duration, ["nodes"]);

  for (const assetId of Object.keys(scene.assets).sort()) {
    if (!referencedAssets.has(assetId)) {
      issues.push({
        severity: "warning",
        code: "unused_asset",
        path: ["assets", assetId],
        assetId,
        message: `Asset "${assetId}" is declared but not referenced by any node or effect.`,
      });
    }
  }

  return { ok: true, scene, issues };
}
