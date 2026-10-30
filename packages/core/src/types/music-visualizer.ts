export const MUSIC_VISUALIZER_SPEC_VERSION = 1;
export const MUSIC_VISUALIZER_MAX_AUDIO_DURATION_SECONDS = 30 * 60;
export const MUSIC_VISUALIZER_AUDIO_DURATION_ERROR = "Audio file is too long.";

export const MUSIC_VISUALIZER_ASPECT_RATIOS = ["16:9", "9:16", "1:1"] as const;
export type MusicVisualizerAspectRatio =
  (typeof MUSIC_VISUALIZER_ASPECT_RATIOS)[number];

export const MUSIC_VISUALIZER_DIMENSIONS: Record<
  MusicVisualizerAspectRatio,
  { width: number; height: number }
> = {
  "16:9": { width: 1920, height: 1080 },
  "9:16": { width: 1080, height: 1920 },
  "1:1": { width: 1440, height: 1440 },
};

export const MUSIC_VISUALIZER_PALETTES = {
  neon: {
    label: "Neon",
    background: "#07080d",
    foreground: "#f8fbff",
    accent: "#00e676",
    secondary: "#7c3aed",
    glow: "rgba(0, 230, 118, 0.62)",
  },
  vinyl: {
    label: "Vinyl",
    background: "#17120f",
    foreground: "#fff7ed",
    accent: "#f59e0b",
    secondary: "#ec4899",
    glow: "rgba(245, 158, 11, 0.5)",
  },
  chroma: {
    label: "Chroma",
    background: "#060814",
    foreground: "#f8fbff",
    accent: "#14f195",
    secondary: "#7c3aed",
    glow: "rgba(20, 241, 149, 0.56)",
  },
  tape: {
    label: "Tape",
    background: "#111827",
    foreground: "#f8fafc",
    accent: "#fb7185",
    secondary: "#facc15",
    glow: "rgba(251, 113, 133, 0.48)",
  },
  ember: {
    label: "Ember",
    background: "#100809",
    foreground: "#fff7ed",
    accent: "#ff4d6d",
    secondary: "#ffb703",
    glow: "rgba(255, 77, 109, 0.62)",
  },
  prism: {
    label: "Prism",
    background: "#061216",
    foreground: "#f7f7ff",
    accent: "#22d3ee",
    secondary: "#f472b6",
    glow: "rgba(34, 211, 238, 0.58)",
  },
  mono: {
    label: "Mono",
    background: "#0b0b0d",
    foreground: "#ffffff",
    accent: "#ffffff",
    secondary: "#a3a3a3",
    glow: "rgba(255, 255, 255, 0.42)",
  },
} as const;

export type MusicVisualizerPaletteKey = keyof typeof MUSIC_VISUALIZER_PALETTES;

export const MUSIC_VISUALIZER_SPECTRUM_BAR_COUNTS = [32, 64, 128] as const;
export type MusicVisualizerSpectrumBarCount =
  (typeof MUSIC_VISUALIZER_SPECTRUM_BAR_COUNTS)[number];

export const MUSIC_VISUALIZER_LAYER_TEMPLATES = [
  {
    key: "spectrum-bars-basic",
    aliases: ["spectrum", "spectrum-bars"],
    label: "Spectrum Bars",
    description: "Clean glowing bars for fast, flexible exports.",
    defaultPalette: "neon",
    background: "transparent",
    foreground: "#f8fbff",
    accent: "#00e676",
    secondary: "#7c3aed",
    glow: "rgba(0, 230, 118, 0.62)",
  },
  {
    key: "cassette-vu-meter",
    aliases: [],
    label: "Cassette VU",
    description: "Retro tape deck with reactive reels, LEDs, and VU needles.",
    defaultPalette: "tape",
    background: "#111827",
    foreground: "#f8fafc",
    accent: "#fb7185",
    secondary: "#facc15",
    glow: "rgba(251, 113, 133, 0.48)",
  },
  {
    key: "waveform-line",
    aliases: ["waveform", "oscilloscope"],
    label: "Waveform Line",
    description:
      "A glowing oscilloscope ribbon that flexes around a center line.",
    defaultPalette: "ember",
    background: "transparent",
    foreground: "#fff7ed",
    accent: "#ff4d6d",
    secondary: "#ffb703",
    glow: "rgba(255, 77, 109, 0.62)",
  },
  {
    key: "mirror-bars",
    aliases: ["mirror", "reflected-bars"],
    label: "Mirror Bars",
    description:
      "Spectrum bars mirrored above and below the center for a symmetric look.",
    defaultPalette: "prism",
    background: "transparent",
    foreground: "#f7f7ff",
    accent: "#22d3ee",
    secondary: "#f472b6",
    glow: "rgba(34, 211, 238, 0.58)",
  },
  {
    key: "circular-spectrum",
    aliases: ["radial-spectrum", "circle-spectrum"],
    label: "Circular Spectrum",
    description:
      "A radiant 360-degree spectrum wrapped around a pulsing center.",
    defaultPalette: "chroma",
    background: "transparent",
    foreground: "#f8fbff",
    accent: "#14f195",
    secondary: "#7c3aed",
    glow: "rgba(20, 241, 149, 0.56)",
  },
  {
    key: "neon-waveform",
    aliases: ["neon-oscilloscope"],
    label: "Neon Waveform",
    description: "Layered electric ribbons with a bright oscilloscope glow.",
    defaultPalette: "ember",
    background: "transparent",
    foreground: "#fff7ed",
    accent: "#ff4d6d",
    secondary: "#ffb703",
    glow: "rgba(255, 77, 109, 0.62)",
  },
  {
    key: "pulse-rings",
    aliases: ["beat-rings", "ripple-rings"],
    label: "Pulse Rings",
    description:
      "Concentric neon ripples expand and flash with every low-end hit.",
    defaultPalette: "prism",
    background: "transparent",
    foreground: "#f7f7ff",
    accent: "#22d3ee",
    secondary: "#f472b6",
    glow: "rgba(34, 211, 238, 0.58)",
  },
  {
    key: "particle-galaxy",
    aliases: ["galaxy", "particle-orbit"],
    label: "Particle Galaxy",
    description:
      "Orbiting particles accelerate, scatter, and sparkle across the mix.",
    defaultPalette: "chroma",
    background: "transparent",
    foreground: "#f8fbff",
    accent: "#14f195",
    secondary: "#7c3aed",
    glow: "rgba(20, 241, 149, 0.56)",
  },
  {
    key: "album-cover-pulse",
    aliases: ["cover-pulse", "artwork-pulse"],
    label: "Album Cover Pulse",
    description:
      "Your artwork breathes with the bass inside a glowing record-style frame.",
    defaultPalette: "vinyl",
    background: "transparent",
    foreground: "#fff7ed",
    accent: "#f59e0b",
    secondary: "#ec4899",
    glow: "rgba(245, 158, 11, 0.5)",
  },
  {
    key: "audio-blob",
    aliases: ["blob", "organic-blob"],
    label: "Audio Blob",
    description:
      "A soft organic form stretches, ripples, and changes shape with the mix.",
    defaultPalette: "prism",
    background: "transparent",
    foreground: "#f7f7ff",
    accent: "#22d3ee",
    secondary: "#f472b6",
    glow: "rgba(34, 211, 238, 0.58)",
  },
  {
    key: "starfield-tunnel",
    aliases: ["starfield", "space-tunnel"],
    label: "Starfield Tunnel",
    description:
      "Stars rush toward the viewer as the track grows louder and faster.",
    defaultPalette: "chroma",
    background: "transparent",
    foreground: "#f8fbff",
    accent: "#14f195",
    secondary: "#7c3aed",
    glow: "rgba(20, 241, 149, 0.56)",
  },
  {
    key: "equalizer-grid",
    aliases: ["led-grid", "audio-grid"],
    label: "Equalizer Grid",
    description:
      "A wall of luminous tiles maps every frequency band into color.",
    defaultPalette: "neon",
    background: "transparent",
    foreground: "#f8fbff",
    accent: "#00e676",
    secondary: "#7c3aed",
    glow: "rgba(0, 230, 118, 0.62)",
  },
  {
    key: "liquid-gradient",
    aliases: ["liquid", "fluid-gradient"],
    label: "Liquid Gradient",
    description:
      "Flowing color fields blend, drift, and swell with the song's energy.",
    defaultPalette: "prism",
    background: "transparent",
    foreground: "#f7f7ff",
    accent: "#22d3ee",
    secondary: "#f472b6",
    glow: "rgba(34, 211, 238, 0.58)",
  },
  {
    key: "kaleidoscope",
    aliases: ["kaleidoscope-prism", "prism-wheel"],
    label: "Kaleidoscope",
    description:
      "Mirrored geometric color slices rotate and bloom with each frequency layer.",
    defaultPalette: "prism",
    background: "transparent",
    foreground: "#f7f7ff",
    accent: "#22d3ee",
    secondary: "#f472b6",
    glow: "rgba(34, 211, 238, 0.58)",
  },
  {
    key: "vinyl-record",
    aliases: ["vinyl", "record-player"],
    label: "Vinyl Record",
    description:
      "A spinning record, glowing groove, and tonearm move with the beat.",
    defaultPalette: "vinyl",
    background: "#17120f",
    foreground: "#fff7ed",
    accent: "#f59e0b",
    secondary: "#ec4899",
    glow: "rgba(245, 158, 11, 0.5)",
  },
  {
    key: "audio-terrain",
    aliases: ["terrain", "spectrum-landscape"],
    label: "Audio Terrain",
    description:
      "Frequency history becomes a rolling neon landscape with depth and motion.",
    defaultPalette: "chroma",
    background: "transparent",
    foreground: "#f8fbff",
    accent: "#14f195",
    secondary: "#7c3aed",
    glow: "rgba(20, 241, 149, 0.56)",
  },
  {
    key: "lightning-arc",
    aliases: ["lightning", "electric-arc"],
    label: "Lightning Arc",
    description:
      "Electric branches snap across the frame on percussion and bright frequencies.",
    defaultPalette: "prism",
    background: "transparent",
    foreground: "#f7f7ff",
    accent: "#22d3ee",
    secondary: "#f472b6",
    glow: "rgba(34, 211, 238, 0.58)",
  },
  {
    key: "minimal-line-art",
    aliases: ["line-art", "flowing-lines"],
    label: "Minimal Line Art",
    description:
      "Elegant flowing lines trace bass, mids, and treble with a restrained look.",
    defaultPalette: "mono",
    background: "transparent",
    foreground: "#ffffff",
    accent: "#ffffff",
    secondary: "#a3a3a3",
    glow: "rgba(255, 255, 255, 0.42)",
  },
] as const;

export type MusicVisualizerLayerTemplate =
  (typeof MUSIC_VISUALIZER_LAYER_TEMPLATES)[number];
export type MusicVisualizerLayerTemplateKey =
  MusicVisualizerLayerTemplate["key"];

export function normalizeMusicVisualizerLayerTemplate(
  value: unknown,
): MusicVisualizerLayerTemplateKey {
  const normalized = typeof value === "string" ? value : "";
  const match = MUSIC_VISUALIZER_LAYER_TEMPLATES.find(
    (template) =>
      template.key === normalized ||
      template.aliases.some((alias) => alias === normalized),
  );

  return match?.key ?? "spectrum-bars-basic";
}

export function getMusicVisualizerLayerTemplate(value: unknown) {
  const key = normalizeMusicVisualizerLayerTemplate(value);
  return MUSIC_VISUALIZER_LAYER_TEMPLATES.find(
    (template) => template.key === key,
  )!;
}

export type MusicVisualizerAudioSource = {
  assetId?: string | null;
  url: string;
  durationS: number;
  originalFilename?: string | null;
  mediaType?: "audio" | "video";
  /** Verified original-file identity for optional local beat analysis. */
  sourceSha256?: string;
};

export type MusicVisualizerBackgroundImage = {
  assetId?: string | null;
  url: string;
  originalFilename?: string | null;
  fit: "contain";
};

export type MusicVisualizerLyricsMode =
  | "off"
  | "classic"
  | "karaoke"
  | "lyricPulse";

export type MusicVisualizerLyricWord = {
  text: string;
  startMs: number;
  endMs: number;
  confidence?: number | null;
};

export type MusicVisualizerLyricLine = {
  text: string;
  startMs: number;
  endMs: number;
  words: MusicVisualizerLyricWord[];
};

export type MusicVisualizerLyricsSpec = {
  mode: Exclude<MusicVisualizerLyricsMode, "off">;
  presetKey: string;
  lines: MusicVisualizerLyricLine[];
  language?: string | null;
  source: "asr" | "manual" | "sample";
};

export type MusicVisualizerSpectrumSettings = {
  barCount: MusicVisualizerSpectrumBarCount;
  sensitivity: number;
  mirror: boolean;
  smoothing: boolean;
};

export type MusicVisualizerTheme = {
  palette: MusicVisualizerPaletteKey;
  background: string;
  foreground: string;
  accent: string;
  secondary: string;
  glow: string;
  title?: string | null;
};

export type MusicVisualizerBeatTiming = {
  version: 1;
  sourceSha256: string;
  durationSeconds: number;
  beats: number[];
};

/** Reject detached, unbounded or malformed timing rather than inventing a BPM grid. */
export function validateMusicVisualizerBeatTiming(
  value: unknown,
  audio: MusicVisualizerAudioSource,
): MusicVisualizerBeatTiming {
  const fail = (): never => {
    throw new Error("Invalid source-bound beat timing.");
  };
  if (!value || typeof value !== "object") return fail();
  const timing = value as Partial<MusicVisualizerBeatTiming>;
  if (
    timing.version !== 1 ||
    typeof timing.sourceSha256 !== "string" ||
    !/^[a-f0-9]{64}$/.test(timing.sourceSha256) ||
    timing.sourceSha256 !== audio.sourceSha256 ||
    typeof timing.durationSeconds !== "number" ||
    !Number.isFinite(timing.durationSeconds) ||
    timing.durationSeconds <= 0 ||
    timing.durationSeconds > 600 ||
    !Number.isFinite(audio.durationS) ||
    Math.abs(timing.durationSeconds - audio.durationS) > 0.25 ||
    !Array.isArray(timing.beats) ||
    !timing.beats.length ||
    timing.beats.length > 4000
  )
    return fail();
  let previous = -1;
  for (const beat of timing.beats) {
    if (
      typeof beat !== "number" ||
      !Number.isFinite(beat) ||
      beat < 0 ||
      beat >= Math.min(timing.durationSeconds, audio.durationS) ||
      beat <= previous
    )
      return fail();
    previous = beat;
  }
  return {
    version: 1,
    sourceSha256: timing.sourceSha256,
    durationSeconds: timing.durationSeconds,
    beats: [...timing.beats],
  };
}

export type MusicVisualizerSpectrumSpec = {
  version: typeof MUSIC_VISUALIZER_SPEC_VERSION;
  visualizerType: "spectrum";
  beatTiming?: MusicVisualizerBeatTiming;
  visualizerTemplate: MusicVisualizerLayerTemplateKey;
  aspectRatio: MusicVisualizerAspectRatio;
  width: number;
  height: number;
  fps: number;
  durationInFrames: number;
  audio: MusicVisualizerAudioSource;
  backgroundImage?: MusicVisualizerBackgroundImage | null;
  lyrics?: MusicVisualizerLyricsSpec | null;
  spectrum: MusicVisualizerSpectrumSettings;
  theme: MusicVisualizerTheme;
};

export type MusicVisualizerCreditUsageSummary = {
  feature_type: string;
  credits_used: number;
  credits_refunded: number;
  net_credits_used: number;
  usage_count: number;
};

export type MusicVisualizerHistoryExport = {
  id: string;
  render_task_id?: string | null;
  status: string;
  title?: string | null;
  original_filename?: string | null;
  source_type: string;
  version: number;
  download_url?: string | null;
  created_at: string;
  completed_at?: string | null;
};

export type MusicVisualizerHistoryItem = {
  project_id: string;
  title: string;
  created_at: string;
  updated_at: string;
  source_audio_name?: string | null;
  duration_seconds?: number | null;
  aspect_ratio?: MusicVisualizerAspectRatio | null;
  visualizer_template?: MusicVisualizerLayerTemplateKey | null;
  lyric_mode: MusicVisualizerLyricsMode;
  has_background_image: boolean;
  asr_task_count: number;
  latest_asr_status?: string | null;
  total_credits_used: number;
  total_credits_refunded: number;
  credit_usages: MusicVisualizerCreditUsageSummary[];
  latest_export?: MusicVisualizerHistoryExport | null;
};

export function getMusicVisualizerDimensions(
  aspectRatio: MusicVisualizerAspectRatio,
) {
  return MUSIC_VISUALIZER_DIMENSIONS[aspectRatio];
}

export function getMusicVisualizerPalette(palette: MusicVisualizerPaletteKey) {
  return MUSIC_VISUALIZER_PALETTES[palette];
}

export function normalizeMusicVisualizerBarCount(
  value: number,
): MusicVisualizerSpectrumBarCount {
  let nearest: MusicVisualizerSpectrumBarCount =
    MUSIC_VISUALIZER_SPECTRUM_BAR_COUNTS[0];
  let nearestDistance = Math.abs(value - nearest);

  for (const option of MUSIC_VISUALIZER_SPECTRUM_BAR_COUNTS) {
    const distance = Math.abs(value - option);
    if (distance < nearestDistance) {
      nearest = option;
      nearestDistance = distance;
    }
  }

  return nearest;
}

export function createMusicVisualizerSpectrumSpec(params: {
  audio: MusicVisualizerAudioSource;
  aspectRatio?: MusicVisualizerAspectRatio;
  fps?: number;
  palette?: MusicVisualizerPaletteKey;
  visualizerTemplate?: MusicVisualizerLayerTemplateKey | string | null;
  barCount?: number;
  sensitivity?: number;
  mirror?: boolean;
  smoothing?: boolean;
  title?: string | null;
  backgroundImage?: MusicVisualizerBackgroundImage | null;
  lyrics?: MusicVisualizerLyricsSpec | null;
  beatTiming?: MusicVisualizerBeatTiming | null;
}): MusicVisualizerSpectrumSpec {
  const aspectRatio = params.aspectRatio ?? "16:9";
  const fps = params.fps ?? 30;
  const dimensions = getMusicVisualizerDimensions(aspectRatio);
  const template = getMusicVisualizerLayerTemplate(params.visualizerTemplate);
  const palette = params.palette ?? template.defaultPalette;
  const colors = getMusicVisualizerPalette(palette);
  const durationInFrames = Math.max(1, Math.ceil(params.audio.durationS * fps));

  return {
    version: MUSIC_VISUALIZER_SPEC_VERSION,
    visualizerType: "spectrum",
    visualizerTemplate: template.key,
    aspectRatio,
    width: dimensions.width,
    height: dimensions.height,
    fps,
    durationInFrames,
    audio: params.audio,
    ...(params.beatTiming
      ? {
          beatTiming: validateMusicVisualizerBeatTiming(
            params.beatTiming,
            params.audio,
          ),
        }
      : {}),
    backgroundImage: params.backgroundImage ?? null,
    lyrics: params.lyrics ?? null,
    spectrum: {
      barCount: normalizeMusicVisualizerBarCount(params.barCount ?? 64),
      sensitivity: Math.max(0.4, Math.min(10, params.sensitivity ?? 2.4)),
      mirror: params.mirror ?? true,
      smoothing: params.smoothing ?? true,
    },
    theme: {
      palette,
      background: colors.background,
      foreground: colors.foreground,
      accent: colors.accent,
      secondary: colors.secondary,
      glow: colors.glow,
      title: params.title ?? null,
    },
  };
}
