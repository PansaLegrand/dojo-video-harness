import type { Locale } from "@/lib/i18n/dictionary";

const locales = ["zh", "es", "fr", "de", "it", "pt", "ja", "ko"] as const;
type Row = readonly [string, string, string, string, string, string, string, string];
const rows = {
  "Video": ["视频", "Vídeo", "Vidéo", "Video", "Video", "Vídeo", "動画", "동영상"],
  "Images": ["图片", "Imágenes", "Images", "Bilder", "Immagini", "Imagens", "画像", "이미지"],
  "Three.js scenes": ["Three.js 三维场景", "Escenas Three.js", "Scènes Three.js", "Three.js-Szenen", "Scene Three.js", "Cenas Three.js", "Three.js シーン", "Three.js 장면"],
  "SVG / Vector": ["SVG / 矢量图形", "SVG / Vector", "SVG / Vectoriel", "SVG / Vektor", "SVG / Vettoriale", "SVG / Vetor", "SVG / ベクター", "SVG / 벡터"],
  "Graphics": ["动态图形", "Gráficos", "Graphismes", "Grafiken", "Grafica", "Elementos gráficos", "グラフィックス", "그래픽"],
  "Text": ["文字", "Texto", "Texte", "Text", "Testo", "Texto", "テキスト", "텍스트"],
  "Subtitles": ["字幕", "Subtítulos", "Sous-titres", "Untertitel", "Sottotitoli", "Legendas", "字幕", "자막"],
  "Translated subtitles": ["翻译字幕", "Subtítulos traducidos", "Sous-titres traduits", "Übersetzte Untertitel", "Sottotitoli tradotti", "Legendas traduzidas", "翻訳字幕", "번역 자막"],
} satisfies Record<string, Row>;

export const editorTimelineCopy = Object.fromEntries(locales.map((locale, index) => [locale,
  Object.fromEntries(Object.entries(rows).map(([key, values]) => [key, values[index]])),
])) as Record<Exclude<Locale, "en">, Record<string, string>>;
