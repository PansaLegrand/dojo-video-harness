import {
  isAudioReactiveEffect,
  type Scene,
  type SceneEffectParams,
} from "@dojo-video-engine/schema";

export type AudioReactiveSourceRange = { start: number; end: number };

/** Source seconds for an effect-local frame; moving the effect does not retime its source. */
export function audioReactiveSourceTime(
  params: Pick<SceneEffectParams, "audioStartTime" | "audioPlaybackRate">,
  localFrame: number,
  sceneFps: number,
): number {
  return (
    (params.audioStartTime ?? 0) +
    (localFrame / sceneFps) * (params.audioPlaybackRate ?? 1)
  );
}

/** Ancestor-clipped source coverage shared by all effects using each audio asset. */
export function collectAudioReactiveSourceRanges(
  scene: Scene,
): Map<string, AudioReactiveSourceRange> {
  const ranges = new Map<string, AudioReactiveSourceRange>();
  const visit = (
    nodes: Scene["nodes"],
    origin: number,
    parentStart: number,
    parentEnd: number,
    parentDuration: number,
  ): void => {
    for (const node of nodes) {
      const start = origin + (node.from ?? 0);
      const duration = node.duration ?? parentDuration;
      const activeStart = Math.max(start, parentStart);
      const activeEnd = Math.min(start + duration, parentEnd);
      if (activeStart >= activeEnd) continue;
      if (
        node.type === "effect" &&
        isAudioReactiveEffect(node.effect) &&
        node.params?.audioAssetId
      ) {
        const sourceStart = audioReactiveSourceTime(
          node.params,
          activeStart - start,
          scene.fps,
        );
        const sourceEnd = audioReactiveSourceTime(
          node.params,
          activeEnd - start,
          scene.fps,
        );
        const previous = ranges.get(node.params.audioAssetId);
        ranges.set(node.params.audioAssetId, {
          start: Math.min(previous?.start ?? Infinity, sourceStart),
          end: Math.max(previous?.end ?? -Infinity, sourceEnd),
        });
      }
      visit(node.children ?? [], start, activeStart, activeEnd, duration);
    }
  };
  visit(scene.nodes, 0, 0, scene.duration, scene.duration);
  return ranges;
}

/** Pad to an absolute analysis-frame grid so equal source times keep equal FFT windows. */
export function audioReactiveAnalysisWindow(
  range: AudioReactiveSourceRange,
  sourceDuration: number,
  spectrumFps: number,
): AudioReactiveSourceRange {
  const start = Math.min(
    sourceDuration,
    Math.max(0, (Math.floor(range.start * spectrumFps) - 1) / spectrumFps),
  );
  const end = Math.max(
    start,
    Math.min(
      sourceDuration,
      (Math.ceil(range.end * spectrumFps) + 1) / spectrumFps,
    ),
  );
  return { start, end };
}
