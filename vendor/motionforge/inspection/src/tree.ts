import {
  parseScene,
  type Scene,
  type SceneAsset,
  type SceneNode,
} from "@motionforge/schema";
import {
  resolveMediaMetrics,
  type ResolvedMediaMetrics,
} from "@motionforge/core";
import type {
  InspectionBaseOptions,
  MediaMetricsProvider,
  TimelineInspection,
  TimelineInspectionNode,
  TimelineSource,
  TreeInspection,
  TreeInspectionNode,
} from "./types";

const window = (start: number, endExclusive: number) => ({
  start,
  endExclusive,
  duration: Math.max(0, endExclusive - start),
});

export function inspectTree(
  sceneInput: unknown,
  options: InspectionBaseOptions = {},
): TreeInspection {
  const scene = parseScene(sceneInput);
  const nodes: TreeInspectionNode[] = [];
  let documentOrder = 0;

  const visit = (
    children: Scene["nodes"],
    parentId: string | null,
    depth: number,
    parentOrigin: number,
    parentDuration: number,
    parentActive: { start: number; endExclusive: number },
    sourcePath: Array<string | number>,
  ): void => {
    children.forEach((node, index) => {
      const from = node.from ?? 0;
      const duration = node.duration ?? parentDuration;
      const absoluteStart = parentOrigin + from;
      const absoluteEnd = absoluteStart + duration;
      const activeStart = Math.max(0, parentActive.start, absoluteStart);
      const activeEnd = Math.max(
        activeStart,
        Math.min(scene.duration, parentActive.endExclusive, absoluteEnd),
      );
      const path = [...sourcePath, index];
      const row: TreeInspectionNode = {
        id: node.id,
        type: node.type,
        parentId,
        depth,
        documentOrder: documentOrder++,
        sourcePath: path,
        ...(options.semanticRoles?.[node.id]
          ? { semanticRole: options.semanticRoles[node.id] }
          : {}),
        localWindow: window(from, from + duration),
        absoluteWindow: window(absoluteStart, absoluteEnd),
        activeWindow: window(activeStart, activeEnd),
        clippedByAncestor:
          activeStart !== absoluteStart || activeEnd !== absoluteEnd,
      };
      nodes.push(row);
      visit(
        node.children ?? [],
        node.id,
        depth + 1,
        absoluteStart,
        duration,
        row.activeWindow,
        [...path, "children"],
      );
    });
  };

  visit(scene.nodes, null, 0, 0, scene.duration, window(0, scene.duration), [
    "nodes",
  ]);
  return {
    kind: "motionforge.tree",
    version: 1,
    fps: scene.fps,
    durationFrames: scene.duration,
    nodes,
  };
}

export type TimelineInspectionOptions = InspectionBaseOptions & {
  mediaMetrics?: MediaMetricsProvider;
};

export function inspectTimeline(
  sceneInput: unknown,
  options: TimelineInspectionOptions = {},
): TimelineInspection {
  const scene = parseScene(sceneInput);
  const tree = inspectTree(scene, options);
  const byId = new Map<string, SceneNode>();
  const visit = (nodes: Scene["nodes"]): void => {
    nodes.forEach((node) => {
      byId.set(node.id, node);
      visit(node.children ?? []);
    });
  };
  visit(scene.nodes);
  const nodes: TimelineInspectionNode[] = tree.nodes.map((row) => {
    const node = byId.get(row.id);
    const source = node
      ? timelineSource(scene, node, row, options.mediaMetrics)
      : undefined;
    return {
      ...row,
      startSeconds: row.activeWindow.start / scene.fps,
      endSeconds: row.activeWindow.endExclusive / scene.fps,
      ...(source ? { source } : {}),
    };
  });
  nodes.sort(
    (left, right) =>
      left.activeWindow.start - right.activeWindow.start ||
      left.documentOrder - right.documentOrder,
  );
  return {
    kind: "motionforge.timeline",
    version: 1,
    fps: scene.fps,
    durationFrames: scene.duration,
    nodes,
  };
}

function timelineSource(
  scene: Scene,
  node: SceneNode,
  row: TreeInspectionNode,
  provider?: MediaMetricsProvider,
): TimelineSource | undefined {
  if (
    !node.assetId ||
    (node.type !== "video" && node.type !== "audio" && node.type !== "lottie")
  ) {
    return undefined;
  }
  const asset = scene.assets[node.assetId];
  if (!asset) return undefined;
  const measured = mediaMetrics(asset, provider);
  const offset =
    node.type === "video"
      ? (node.videoStartTime ?? 0)
      : node.type === "audio"
        ? (node.audioStartTime ?? 0)
        : 0;
  const rate = node.type === "audio" ? 1 : (node.playbackRate ?? 1);
  const sourceSpan = (row.activeWindow.duration / scene.fps) * rate;
  const durationProvenance = measured.fieldMeasurements.durationSeconds ?? {
    measurement: "estimated" as const,
    reason: `${measured.reason}; intrinsic duration unavailable`,
  };
  return {
    assetId: node.assetId,
    kind: node.type,
    offset,
    rate,
    loop:
      (node.type === "audio" && node.loop === true) ||
      (node.type === "video" && node.videoEndBehavior === "loop"),
    endBehavior:
      node.type === "video" && node.videoEndBehavior === "loop"
        ? "loop"
        : node.type === "audio" && node.loop
          ? "loop"
          : node.type === "audio"
            ? "silence"
            : "hold",
    sourceStart: offset,
    sourceEndUnclamped: offset + sourceSpan,
    ...(measured.durationSeconds !== undefined
      ? { intrinsicDuration: measured.durationSeconds }
      : {}),
    ...(measured.frameRate !== undefined
      ? { frameRate: structuredClone(measured.frameRate) }
      : {}),
    measurement: durationProvenance.measurement,
    reason: durationProvenance.reason,
  };
}

export function mediaMetrics(
  asset: SceneAsset,
  provider?: MediaMetricsProvider,
): ResolvedMediaMetrics {
  return resolveMediaMetrics(asset, provider);
}
