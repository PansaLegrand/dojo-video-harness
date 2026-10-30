import type { EditorAsset } from "@/lib/editor/document";
import type { SceneStyle } from "@motionforge/schema";

const variableFonts: Record<string, { path: string; range: string }> = {
  Inter: { path: "/fonts/inter-latin-wght-normal.woff2", range: "100 900" },
  Lora: { path: "/fonts/lora/lora-latin-wght-normal.woff2", range: "400 700" },
  Nunito: {
    path: "/fonts/nunito/nunito-latin-wght-normal.woff2",
    range: "200 1000",
  },
  Caveat: {
    path: "/fonts/caveat/caveat-latin-wght-normal.woff2",
    range: "400 700",
  },
  "Space Grotesk": {
    path: "/fonts/space-grotesk/space-grotesk-latin-wght-normal.woff2",
    range: "300 700",
  },
  Fraunces: {
    path: "/fonts/fraunces/fraunces-latin-wght-normal.woff2",
    range: "100 900",
  },
};
const fixedFonts: Record<string, Array<{ weight: number; path: string }>> = {
  Anton: [{ weight: 400, path: "/fonts/anton/anton-latin-400-normal.woff2" }],
  "Noto Sans Arabic": [400, 500, 700].map((weight) => ({
    weight,
    path: `/fonts/noto-sans-arabic/noto-sans-arabic-arabic-${weight}-normal.woff2`,
  })),
  "IBM Plex Mono": [400, 500, 700].map((weight) => ({
    weight,
    path: `/fonts/ibm-plex-mono/ibm-plex-mono-latin-${weight}-normal.woff2`,
  })),
  "Noto Sans SC": [400, 500, 700].map((weight) => ({
    weight,
    path: `/fonts/noto-sans-sc/noto-sans-sc-chinese-simplified-${weight}-normal.woff2`,
  })),
  "Noto Sans JP": [400, 500, 700].map((weight) => ({
    weight,
    path: `/fonts/noto-sans-jp/noto-sans-jp-japanese-${weight}-normal.woff2`,
  })),
  "Noto Sans KR": [400, 500, 700].map((weight) => ({
    weight,
    path: `/fonts/noto-sans-kr/noto-sans-kr-korean-${weight}-normal.woff2`,
  })),
};

const scriptSpecimens: Record<string, string> = {
  "Noto Sans Arabic": "أبجد هوز ١٢٣",
  "Noto Sans SC": "你好，视频 123",
  "Noto Sans JP": "こんにちは 動画 123",
  "Noto Sans KR": "안녕하세요 영상 123",
};
export const editorFontSpecimen = (family: string) =>
  scriptSpecimens[family] ?? "Aa Bb 123";
/** Large CJK faces load when focused, not merely when the menu opens. */
export const editorFontLazySpecimen = (family: string) =>
  /^Noto Sans (SC|JP|KR)$/.test(family);

export const editorFontFamilies = [
  ...Object.keys(variableFonts),
  ...Object.keys(fixedFonts),
  "system-ui",
];
export function bundledEditorFontMetadata(source: string | undefined) {
  const variable = Object.values(variableFonts).find(
    (font) => font.path === source,
  );
  if (variable)
    return { fontWeight: variable.range, fontStyle: "normal" as const };
  const fixed = Object.values(fixedFonts)
    .flat()
    .find((face) => face.path === source);
  return fixed
    ? { fontWeight: fixed.weight, fontStyle: "normal" as const }
    : {};
}
export function editorFontWeights(family: string): number[] {
  const fixed = fixedFonts[family];
  if (fixed) return fixed.map((face) => face.weight);
  const range = variableFonts[family]?.range.split(" ").map(Number) ?? [
    100, 900,
  ];
  return [400, 500, 600, 700, 800].filter(
    (weight) => weight >= range[0]! && weight <= range[1]!,
  );
}
/** A family switch must choose a weight the bundled face can render. */
export function editorFontStyle(
  style: Partial<SceneStyle> | undefined,
  family: string,
): Partial<SceneStyle> {
  const weights = editorFontWeights(family);
  return {
    fontFamily: family,
    fontWeight: weights.includes(Number(style?.fontWeight ?? 700))
      ? (style?.fontWeight ?? 700)
      : (weights.at(-1) ?? 400),
  };
}
export function getEditorFontAssets(family: string): EditorAsset[] {
  const variable = variableFonts[family];
  if (variable)
    return [
      {
        id: family,
        name: family,
        type: "font",
        source: "static",
        src: variable.path,
        mediaMetadata: {
          fontFamily: family,
          fontWeight: variable.range,
          fontStyle: "normal",
        },
      },
    ];
  return (fixedFonts[family] ?? []).map((face) => ({
    id: `${family}:${face.weight}`,
    name: `${family} ${face.weight}`,
    type: "font",
    source: "static",
    src: face.path,
    mediaMetadata: {
      fontFamily: family,
      fontWeight: face.weight,
      fontStyle: "normal" as const,
    },
  }));
}
