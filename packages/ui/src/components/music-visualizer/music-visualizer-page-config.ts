import {
  MUSIC_VISUALIZER_ASPECT_RATIOS,
  MUSIC_VISUALIZER_LAYER_TEMPLATES,
  type MusicVisualizerAspectRatio,
  type MusicVisualizerLayerTemplateKey,
  type MusicVisualizerLyricsMode,
} from "@/types/music-visualizer";

export const MUSIC_VISUALIZER_PREVIEW_FPS = 30;
export const MUSIC_VISUALIZER_DEFAULT_LANGUAGE = "en";
export const MUSIC_VISUALIZER_MAX_BACKGROUND_IMAGE_BYTES = 20 * 1024 * 1024;

export type MusicVisualizerAspectRatioOption = {
  value: MusicVisualizerAspectRatio;
  label: string;
  description: string;
};

export type MusicVisualizerTemplateOption = {
  value: MusicVisualizerLayerTemplateKey;
  label: string;
  description: string;
};

export type MusicVisualizerLyricModeOption = {
  value: MusicVisualizerLyricsMode;
  label: string;
  description: string;
  presetKey?: "classic-static" | "karaoke-highlight" | "lyric-pulse";
};

type MusicVisualizerTranslate = (
  key: string,
  params?: Record<string, string>,
) => string;

function translated(
  translate: MusicVisualizerTranslate | undefined,
  key: string,
  fallback: string,
) {
  const value = translate?.(key);
  return value && value !== key ? value : fallback;
}

export function getMusicVisualizerAspectRatioOptions(
  translate?: MusicVisualizerTranslate,
): MusicVisualizerAspectRatioOption[] {
  const descriptions: Record<MusicVisualizerAspectRatio, string> = {
    "16:9": translated(
      translate,
      "application.music_visualizer.option.aspect_16_9.description",
      "YouTube and landscape players",
    ),
    "9:16": translated(
      translate,
      "application.music_visualizer.option.aspect_9_16.description",
      "Shorts, Reels, and TikTok",
    ),
    "1:1": translated(
      translate,
      "application.music_visualizer.option.aspect_1_1.description",
      "Square social posts",
    ),
  };

  return MUSIC_VISUALIZER_ASPECT_RATIOS.map((value) => ({
    value,
    label: value,
    description: descriptions[value],
  }));
}

export function getMusicVisualizerTemplateOptions(
  translate?: MusicVisualizerTranslate,
): MusicVisualizerTemplateOption[] {
  return MUSIC_VISUALIZER_LAYER_TEMPLATES.map((template) => ({
    value: template.key,
    label: translated(
      translate,
      `application.music_visualizer.option.template.${template.key}.label`,
      template.label,
    ),
    description: translated(
      translate,
      `application.music_visualizer.option.template.${template.key}.description`,
      template.description,
    ),
  }));
}

const MUSIC_VISUALIZER_LYRIC_MODE_OPTION_CONFIG = [
  {
    value: "off",
    labelKey: "application.music_visualizer.option.lyrics.off.label",
    descriptionKey:
      "application.music_visualizer.option.lyrics.off.description",
    fallbackLabel: "No lyrics",
    fallbackDescription: "Best for instrumentals",
  },
  {
    value: "classic",
    labelKey: "application.music_visualizer.option.lyrics.classic.label",
    descriptionKey:
      "application.music_visualizer.option.lyrics.classic.description",
    fallbackLabel: "Classic",
    fallbackDescription: "Static centered lyric line",
    presetKey: "classic-static",
  },
  {
    value: "karaoke",
    labelKey: "application.music_visualizer.option.lyrics.karaoke.label",
    descriptionKey:
      "application.music_visualizer.option.lyrics.karaoke.description",
    fallbackLabel: "Karaoke",
    fallbackDescription: "Word highlight sing-along",
    presetKey: "karaoke-highlight",
  },
  {
    value: "lyricPulse",
    labelKey: "pages.videoEditor.captionStyle.templates.lyricPulse.name",
    descriptionKey:
      "pages.videoEditor.captionStyle.templates.lyricPulse.preview",
    fallbackLabel: "Lyric Pulse",
    fallbackDescription: "Words move with your song",
    presetKey: "lyric-pulse",
  },
] satisfies Array<
  Omit<MusicVisualizerLyricModeOption, "label" | "description"> & {
    labelKey: string;
    descriptionKey: string;
    fallbackLabel: string;
    fallbackDescription: string;
  }
>;

export function getMusicVisualizerLyricModeOptions(
  translate?: MusicVisualizerTranslate,
): MusicVisualizerLyricModeOption[] {
  return MUSIC_VISUALIZER_LYRIC_MODE_OPTION_CONFIG.map((option) => ({
    value: option.value,
    label: translated(translate, option.labelKey, option.fallbackLabel),
    description: translated(
      translate,
      option.descriptionKey,
      option.fallbackDescription,
    ),
    presetKey: option.presetKey,
  }));
}

export function getMusicVisualizerLyricModeOption(
  mode: MusicVisualizerLyricsMode,
  translate?: MusicVisualizerTranslate,
) {
  return getMusicVisualizerLyricModeOptions(translate).find(
    (option) => option.value === mode,
  );
}
