import type { SceneEffectName } from "@motionforge/schema";
import type { MusicVisualizerLayerTemplateKey } from "@/types/music-visualizer";

// Which canvas effect renders each template, plus where its box sits.
// Bottom-anchored templates grow up from a baseline; centered ones are
// symmetric around the vertical middle.
export const MUSIC_VISUALIZER_TEMPLATE_RENDER_CONFIG: Record<
  MusicVisualizerLayerTemplateKey,
  {
    effect: SceneEffectName;
    widthRatio: number;
    heightRatio: number;
    topRatio: number;
  }
> = {
  "spectrum-bars-basic": {
    effect: "spectrumBars",
    widthRatio: 0.86,
    heightRatio: 0.22,
    topRatio: 0.62,
  },
  "cassette-vu-meter": {
    effect: "cassetteVuMeter",
    widthRatio: 0.86,
    heightRatio: 0.42,
    topRatio: 0.35,
  },
  // Centered overlays: kept compact so they sit over the media without
  // dominating it. topRatio = (1 - heightRatio) / 2 keeps them vertically centered.
  "waveform-line": {
    effect: "waveformLine",
    widthRatio: 0.6,
    heightRatio: 0.16,
    topRatio: 0.42,
  },
  "mirror-bars": {
    effect: "mirrorBars",
    widthRatio: 0.66,
    heightRatio: 0.26,
    topRatio: 0.37,
  },
  "circular-spectrum": {
    effect: "circularSpectrum",
    widthRatio: 0.78,
    heightRatio: 0.78,
    topRatio: 0.11,
  },
  "neon-waveform": {
    effect: "neonWaveform",
    widthRatio: 0.9,
    heightRatio: 0.38,
    topRatio: 0.31,
  },
  "pulse-rings": {
    effect: "pulseRings",
    widthRatio: 0.78,
    heightRatio: 0.78,
    topRatio: 0.11,
  },
  "particle-galaxy": {
    effect: "particleGalaxy",
    widthRatio: 0.9,
    heightRatio: 0.72,
    topRatio: 0.14,
  },
  "album-cover-pulse": {
    effect: "albumCoverPulse",
    widthRatio: 0.82,
    heightRatio: 0.78,
    topRatio: 0.11,
  },
  "audio-blob": {
    effect: "audioBlob",
    widthRatio: 0.82,
    heightRatio: 0.78,
    topRatio: 0.11,
  },
  "starfield-tunnel": {
    effect: "starfieldTunnel",
    widthRatio: 0.9,
    heightRatio: 0.78,
    topRatio: 0.11,
  },
  "equalizer-grid": {
    effect: "equalizerGrid",
    widthRatio: 0.9,
    heightRatio: 0.58,
    topRatio: 0.21,
  },
  "liquid-gradient": {
    effect: "liquidGradient",
    widthRatio: 0.9,
    heightRatio: 0.78,
    topRatio: 0.11,
  },
  kaleidoscope: {
    effect: "kaleidoscope",
    widthRatio: 0.82,
    heightRatio: 0.78,
    topRatio: 0.11,
  },
  "vinyl-record": {
    effect: "vinylRecord",
    widthRatio: 0.86,
    heightRatio: 0.78,
    topRatio: 0.11,
  },
  "audio-terrain": {
    effect: "audioTerrain",
    widthRatio: 0.9,
    heightRatio: 0.78,
    topRatio: 0.11,
  },
  "lightning-arc": {
    effect: "lightningArc",
    widthRatio: 0.88,
    heightRatio: 0.78,
    topRatio: 0.11,
  },
  "minimal-line-art": {
    effect: "minimalLineArt",
    widthRatio: 0.9,
    heightRatio: 0.42,
    topRatio: 0.29,
  },
};
