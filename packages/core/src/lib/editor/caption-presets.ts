import type { SceneStyle, SceneTextRun } from "@dojo-video-engine/schema";

export type EditorCaptionPreset = {
  label: string;
  style: Partial<SceneStyle>;
  mode: "sentence" | "word" | "karaoke";
  highlightColor: string;
  highlightStyle?: Omit<NonNullable<SceneTextRun["style"]>, "color">;
  motion?: "lyricPulse";
};

/**
 * Native caption treatments, including timing-driven lyric motion.
 * This is a preset catalog, not a reader for retired editor documents.
 * Sizes are composition pixels; the shared fitter keeps long cues inside their box.
 */
const base: Partial<SceneStyle> = {
  fontFamily: "Inter", fontSize: 64, fontWeight: 700, fontStyle: "normal",
  color: "#ffffff", textAlign: "center", lineHeight: 1.3, letterSpacing: 0,
  backgroundColor: "transparent", padding: 0, borderRadius: 0,
  textStroke: undefined, textShadow: "none",
  textBackgroundColor: "transparent", textBackgroundPaddingX: 0,
  textBackgroundPaddingY: 0, textBackgroundRadius: 0,
  textFit: "shrink", minFontSize: 20, maxLines: 3,
};
function sentence(label: string, style: Partial<SceneStyle>): EditorCaptionPreset {
  return { label, mode: "sentence", highlightColor: "#facc15", style: { ...base, ...style } };
}
function karaoke(label: string, style: Partial<SceneStyle>, highlightColor: string,
  highlightStyle?: EditorCaptionPreset["highlightStyle"]): EditorCaptionPreset {
  return { label, mode: "karaoke", highlightColor, highlightStyle, style: { ...base, ...style } };
}

export const editorCaptionPresets: Record<string, EditorCaptionPreset> = {
  classic: sentence("Classic", {
    fontSize: 64, lineHeight: 1.4, letterSpacing: 1.92,
    textStroke: "4px rgba(15,23,42,0.92)", textShadow: "2px 2px 4px rgba(0,0,0,0.6)",
  }),
  minimalBar: sentence("Minimal Bar", {
    fontSize: 56, fontWeight: 600, letterSpacing: 3.36,
    textBackgroundColor: "rgba(17,24,39,0.72)", textBackgroundPaddingX: 20,
    textBackgroundPaddingY: 10, textBackgroundRadius: 999,
    textShadow: "0px 2px 8px rgba(0,0,0,0.35)",
  }),
  handwritten: sentence("Handwritten", {
    fontFamily: "Caveat", fontSize: 72, fontWeight: 400, lineHeight: 1.4,
    textShadow: "1px 1px 2px rgba(0,0,0,0.6)",
  }),
  retro: sentence("Retro", {
    fontFamily: "Anton", fontSize: 60, fontWeight: 400, lineHeight: 1.2,
    color: "#ffd700", letterSpacing: 1.2, textShadow: "3px 3px 0px #ff4500",
  }),
  cinematic: sentence("Cinematic", {
    fontFamily: "Lora", fontSize: 70, color: "#f8fafc", letterSpacing: 2.8,
    textBackgroundColor: "rgba(15,23,42,0.58)", textBackgroundPaddingX: 18,
    textBackgroundPaddingY: 8, textBackgroundRadius: 6,
    textShadow: "0px 4px 18px rgba(0,0,0,0.45)",
  }),
  storyteller: sentence("Storyteller", {
    fontFamily: "Lora", fontSize: 62, fontWeight: 600, lineHeight: 1.45,
    color: "#fef3c7", letterSpacing: 1.24, textShadow: "0px 2px 10px rgba(0,0,0,0.55)",
  }),
  hustle: karaoke("Hustle", {
    fontFamily: "Inter", fontSize: 72, fontWeight: 800, lineHeight: 1.25, letterSpacing: -0.72,
    textStroke: "4px rgba(0,0,0,0.9)", textShadow: "0px 3px 12px rgba(0,0,0,0.45)",
    textBackgroundPaddingX: 12, textBackgroundPaddingY: 4, textBackgroundRadius: 6,
  }, "#ffffff", { textBackgroundColor: "#ff3b30", textStroke: "none" }),
  spotlight: karaoke("Spotlight", {
    fontFamily: "Nunito", fontSize: 76, fontWeight: 800, lineHeight: 1.25,
    textStroke: "6px rgba(15,23,42,0.92)", textShadow: "0px 6px 18px rgba(0,0,0,0.35)",
    textBackgroundPaddingX: 14, textBackgroundPaddingY: 4, textBackgroundRadius: 999,
  }, "#0f172a", { textBackgroundColor: "#facc15", textStroke: "none" }),
  karaoke: karaoke("Karaoke", {
    fontFamily: "Nunito", fontSize: 70, fontWeight: 800,
    textStroke: "4px rgba(2,6,23,0.9)", textShadow: "0px 4px 14px rgba(0,0,0,0.4)",
    textBackgroundPaddingX: 14, textBackgroundPaddingY: 4, textBackgroundRadius: 999,
  }, "#ffffff", { textBackgroundColor: "rgba(236,72,153,0.95)", textStroke: "none" }),
  lyricPulse: {
    ...karaoke("Lyric Pulse", {
      fontFamily: "Inter", fontSize: 72, fontWeight: 800, lineHeight: 1.25, letterSpacing: -0.5,
      textStroke: "3px rgba(2,6,23,0.92)", textShadow: "0px 3px 12px rgba(0,0,0,0.55)",
      textBackgroundPaddingX: 10, textBackgroundPaddingY: 4, textBackgroundRadius: 8,
    }, "#ffffff", { textBackgroundColor: "#e52e88", textStroke: "none" }),
    motion: "lyricPulse",
  },
  neon: karaoke("Neon", {
    fontFamily: "Nunito", fontSize: 72, lineHeight: 1.25, letterSpacing: 3.6,
    textBackgroundColor: "rgba(3,7,18,0.55)", textBackgroundPaddingX: 12,
    textBackgroundPaddingY: 4, textBackgroundRadius: 10,
    textShadow: "0px 0px 16px rgba(56,189,248,0.85)",
  }, "#e0f2fe", { textBackgroundColor: "rgba(125,211,252,0.22)" }),
  future: karaoke("Future", {
    fontFamily: "Space Grotesk", fontSize: 68, color: "#e2e8f0", letterSpacing: 5.44,
    textBackgroundColor: "rgba(15,23,42,0.72)", textBackgroundPaddingX: 12,
    textBackgroundPaddingY: 4, textBackgroundRadius: 8,
    textStroke: "1px rgba(56,189,248,0.55)", textShadow: "0px 0px 15px rgba(148,163,184,0.35)",
  }, "#38bdf8", { textBackgroundColor: "rgba(14,165,233,0.22)", textStroke: "none" }),
  terminal: karaoke("Terminal", {
    fontFamily: "IBM Plex Mono", fontSize: 60, color: "#86efac", lineHeight: 1.35, letterSpacing: 2.4,
    textBackgroundColor: "rgba(2,6,23,0.85)", textBackgroundPaddingX: 8,
    textBackgroundPaddingY: 3, textBackgroundRadius: 4,
    textShadow: "0px 0px 10px rgba(34,197,94,0.35)",
  }, "#dcfce7", { textBackgroundColor: "rgba(34,197,94,0.22)" }),
  colorShift: karaoke("Color Shift", {
    fontFamily: "Nunito", fontSize: 70, fontWeight: 800, letterSpacing: 2.8,
    textStroke: "4px rgba(2,6,23,0.9)", textShadow: "0px 4px 14px rgba(0,0,0,0.42)",
  }, "#ff4fa3", { textStroke: "1px rgba(190,24,93,0.75)" }),
};

/** Translation styles have cue timing, never source-language word timing. */
export function editorCaptionPresetEntries(staticOnly = false) {
  return Object.entries(editorCaptionPresets).filter(([, preset]) => !staticOnly || preset.mode === "sentence");
}
export function staticEditorCaptionPreset(key?: string): string {
  return key && editorCaptionPresets[key]?.mode === "sentence" ? key : "classic";
}

export const editorCaptionPresetDifferences = [
  "Bundled fonts replace platform-dependent families: Anton replaces Rubik Mono One; Lora replaces Georgia; Inter replaces Montserrat; Nunito replaces Poppins and Outfit; IBM Plex Mono replaces Courier New.",
  "Font sizes and letter spacing use composition pixels and bounded native text fitting instead of CSS rem/em sizing.",
  "Multiple CSS text shadows are represented by one native shadow or glow.",
  "Active word emphasis changes paint only; former per-word scale/font-weight changes are not applied because they reflow the timed line.",
  "Lyric Pulse animates the complete phrase on word onsets without changing text metrics; its motion can be disabled independently.",
  "Text-fitted plates and active word pills use native textBackground fields; line wrapping and word timing share the preview/export layout.",
] as const;
