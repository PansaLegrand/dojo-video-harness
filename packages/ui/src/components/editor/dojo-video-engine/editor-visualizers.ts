import type { EditorFormat, EditorItem } from "@/lib/editor/document";
import { MUSIC_VISUALIZER_TEMPLATE_RENDER_CONFIG } from "@/components/music-visualizer/music-visualizer-template-config";
import { MUSIC_VISUALIZER_LAYER_TEMPLATES, getMusicVisualizerLayerTemplate, type MusicVisualizerLayerTemplateKey } from "@/types/music-visualizer";

export function editorVisualizerTemplateKey(effect: EditorItem["node"]["effect"]) {
  return MUSIC_VISUALIZER_LAYER_TEMPLATES.find(template => MUSIC_VISUALIZER_TEMPLATE_RENDER_CONFIG[template.key].effect === effect)?.key;
}

/** Changing a look preserves its source clock, placement and authored motion. */
export function applyEditorVisualizerPreset(node: EditorItem["node"], key: MusicVisualizerLayerTemplateKey): EditorItem["node"] {
  const template = getMusicVisualizerLayerTemplate(key);
  return {
    ...node,
    effect: MUSIC_VISUALIZER_TEMPLATE_RENDER_CONFIG[key].effect,
    params: {
      ...node.params,
      colors: [template.accent, template.secondary, template.foreground],
      barCount: node.params?.barCount ?? 64,
      sensitivity: node.params?.sensitivity ?? 1,
      smoothing: node.params?.smoothing ?? true,
    },
  };
}

export function createEditorVisualizerNode(id: string, source: EditorItem, format: EditorFormat, key: MusicVisualizerLayerTemplateKey = "spectrum-bars-basic"): EditorItem["node"] {
  const config = MUSIC_VISUALIZER_TEMPLATE_RENDER_CONFIG[key];
  const width = Math.round(format.width * config.widthRatio);
  return applyEditorVisualizerPreset({
    id, type: "effect", effect: config.effect,
    from: source.node.from ?? 0,
    duration: source.node.duration ?? format.durationInFrames,
    params: {
      audioAssetId: source.node.assetId,
      audioStartTime: source.node.videoStartTime ?? source.node.audioStartTime ?? 0,
      audioPlaybackRate: source.node.playbackRate ?? 1,
    },
    animations: [], children: [],
    style: {
      position: "absolute", left: Math.round((format.width - width) / 2),
      top: Math.round(format.height * config.topRatio), width,
      height: Math.round(format.height * config.heightRatio),
    },
  }, key);
}
