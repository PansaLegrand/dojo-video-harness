import type { SceneStyle, SceneNodeInput } from "@dojo-video-engine/schema";
import { editorFontStyle } from "./fonts";

const textTreatmentDefaults: Partial<SceneStyle> = {
  padding: 0,
  borderRadius: 0,
  letterSpacing: 0,
  textStroke: undefined,
  textShadow: undefined,
  backgroundColor: "transparent",
  fontStyle: "normal",
  textBackgroundColor: undefined,
  textBackgroundPaddingX: 0,
  textBackgroundPaddingY: 0,
  textBackgroundRadius: 0,
};

/** Match the inspector's existing text-plate versus full-box background behavior. */
export function editorTextBackgroundProperty(
  style: Partial<SceneStyle>,
): "textBackgroundColor" | "backgroundColor" {
  return style.textBackgroundColor &&
    style.textBackgroundColor !== "transparent"
    ? "textBackgroundColor"
    : "backgroundColor";
}

/** Update static controls and the native enter/exit animation together. */
export function updateEditorNodeStyle(
  node: SceneNodeInput,
  patch: Partial<SceneStyle>,
): SceneNodeInput {
  const old = node.style ?? {};
  const animations = node.animations?.map((animation) => {
    if (patch.opacity !== undefined && animation.property === "opacity") {
      const maximum = Math.max(
        0,
        ...animation.frames.map((point) => Number(point.value)),
      );
      return {
        ...animation,
        frames: animation.frames.map((point, index, all) => ({
          ...point,
          value:
            maximum > 0
              ? (Number(point.value) * patch.opacity!) / maximum
              : index === 0 || index === all.length - 1
                ? 0
                : patch.opacity!,
        })),
      };
    }
    if (patch.transform !== undefined && animation.property === "transform") {
      const previous =
        old.transform && old.transform !== "none" ? old.transform : "";
      const next = patch.transform === "none" ? "" : patch.transform;
      return {
        ...animation,
        frames: animation.frames.map((point) => {
          const value = String(point.value);
          const motion =
            previous && value.startsWith(previous)
              ? value.slice(previous.length).trim()
              : value;
          return {
            ...point,
            value:
              `${next} ${motion === "none" ? "" : motion}`.trim() || "none",
          };
        }),
      };
    }
    return animation;
  });
  return { ...node, style: { ...old, ...patch }, animations };
}

export const editorMediaFilters = [
  { label: "Original", value: "none" },
  { label: "Punchy", value: "contrast(112%) saturate(120%) brightness(102%)" },
  {
    label: "Soft contrast",
    value: "contrast(90%) saturate(90%) brightness(104%)",
  },
  { label: "Clean monochrome", value: "grayscale(100%) contrast(110%)" },
  {
    label: "Retro",
    value:
      "contrast(130%) sepia(45%) brightness(85%) saturate(160%) hue-rotate(5deg)",
  },
  {
    label: "Vintage",
    value: "contrast(95%) brightness(95%) saturate(70%) sepia(15%)",
  },
  {
    label: "Wes Anderson",
    value: "contrast(135%) brightness(110%) saturate(190%) hue-rotate(345deg)",
  },
  {
    label: "Film Noir",
    value: "grayscale(100%) contrast(150%) brightness(90%)",
  },
  {
    label: "Polaroid",
    value: "sepia(15%) contrast(95%) brightness(105%) saturate(80%)",
  },
  {
    label: "Cinematic",
    value: "contrast(115%) brightness(95%) saturate(110%)",
  },
  {
    label: "Cool",
    value: "brightness(100%) sepia(20%) hue-rotate(180deg) saturate(90%)",
  },
  {
    label: "Warm",
    value: "brightness(105%) sepia(30%) saturate(130%) hue-rotate(350deg)",
  },
  {
    label: "Expired Film",
    value:
      "contrast(110%) brightness(100%) saturate(85%) sepia(20%) hue-rotate(5deg)",
  },
  {
    label: "Kodak",
    value:
      "contrast(120%) brightness(105%) saturate(120%) sepia(10%) hue-rotate(355deg)",
  },
  {
    label: "Super 8",
    value:
      "contrast(125%) brightness(95%) saturate(70%) sepia(30%) hue-rotate(340deg)",
  },
];

/** Editable native treatments. Every property goes through the Scene schema. */
export const editorTextStyles: Record<
  string,
  { label: string; style: Partial<SceneStyle>; captionHighlightColor: string }
> = {
  clean: {
    label: "Clean title",
    captionHighlightColor: "#a5b4fc",
    style: {
      ...textTreatmentDefaults,
      fontWeight: 600,
      color: "#ffffff",
      letterSpacing: 0.5,
      textShadow: "0px 2px 4px #000000",
    },
  },
  soft: {
    label: "Soft plate",
    captionHighlightColor: "#a5b4fc",
    style: {
      ...textTreatmentDefaults,
      fontWeight: 500,
      color: "#ffffff",
      textBackgroundColor: "rgba(15, 23, 42, 0.8)",
      textBackgroundPaddingX: 14,
      textBackgroundPaddingY: 8,
      textBackgroundRadius: 10,
    },
  },
  outline: {
    label: "Outline",
    captionHighlightColor: "#facc15",
    style: {
      ...textTreatmentDefaults,
      fontWeight: 800,
      color: "#ffffff",
      textStroke: "3px #111827",
      letterSpacing: 0,
    },
  },
  heading: {
    label: "Heading",
    captionHighlightColor: "#facc15",
    style: {
      ...textTreatmentDefaults,
      fontWeight: 800,
      color: "#ffffff",
      backgroundColor: "transparent",
      fontStyle: "normal",
    },
  },
  subtitle: {
    label: "Subtitle",
    captionHighlightColor: "#facc15",
    style: {
      ...textTreatmentDefaults,
      fontWeight: 700,
      color: "#ffffff",
      backgroundColor: "transparent",
      textStroke: "2px #000000",
      textShadow: "1px 2px 3px #000000",
      fontStyle: "normal",
    },
  },
  label: {
    label: "Label",
    captionHighlightColor: "#6d28d9",
    style: {
      ...textTreatmentDefaults,
      fontWeight: 700,
      color: "#111827",
      backgroundColor: "#facc15",
      padding: 12,
      borderRadius: 8,
      fontStyle: "normal",
    },
  },
  neon: {
    label: "Neon",
    captionHighlightColor: "#67e8f9",
    style: {
      ...textTreatmentDefaults,
      fontWeight: 700,
      color: "#ffffff",
      backgroundColor: "transparent",
      textStroke: "1px #a855f7",
      textShadow: "0px 0px 8px #d946ef",
      fontStyle: "normal",
    },
  },
  editorial: {
    label: "Editorial",
    captionHighlightColor: "#fbbf24",
    style: {
      ...textTreatmentDefaults,
      fontWeight: 500,
      color: "#fef3c7",
      backgroundColor: "#1c1917",
      padding: 12,
      fontStyle: "italic",
    },
  },
  terminal: {
    label: "Terminal",
    captionHighlightColor: "#ffffff",
    style: {
      ...textTreatmentDefaults,
      fontWeight: 600,
      color: "#4ade80",
      backgroundColor: "#052e16",
      padding: 12,
      borderRadius: 4,
      fontStyle: "normal",
    },
  },
};

/** Presets preserve the selected family and use a weight its bundled faces support. */
export function editorTextStylePatch(
  node: SceneNodeInput,
  preset: string,
): Partial<SceneStyle> {
  const treatment = editorTextStyles[preset];
  if (!treatment) throw new Error("Choose an existing text style.");
  const patch = { ...treatment.style };
  if (patch.fontWeight !== undefined || patch.fontFamily) {
    const family = patch.fontFamily ?? node.style?.fontFamily ?? "Inter";
    patch.fontWeight = editorFontStyle(
      { ...node.style, ...patch },
      family,
    ).fontWeight;
  }
  return patch;
}
