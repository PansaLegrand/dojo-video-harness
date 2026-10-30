"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import { Play } from "lucide-react";
import { useTranslation } from "@/lib/i18n";
import { compileEditorDocument, createEditorDocument } from "@/lib/editor/document";
import { estimateCaptionWords } from "@/lib/editor/caption-words";
import { DojoVideoEngineCanvasPreview, type DojoVideoEngineCanvasPreviewHandle } from "@/components/dojo-video-engine/dojo-video-engine-canvas-preview";
import { editorCaptionPresetEntries } from "./editor-caption-presets";
import { buildCaptionTrack } from "./editor-caption-workflow";
import { useNativeEditorText } from "./native-editor-copy";

const samples: Record<string, string> = { en: "Make every word count", zh: "让每个字都精彩", ja: "言葉をもっと鮮やかに", ko: "모든 말을 빛나게", es: "Cada palabra cuenta", fr: "Chaque mot compte", de: "Jedes Wort zählt", it: "Ogni parola conta", pt: "Cada palavra importa", ar: "اجعل كل كلمة مؤثرة", he: "לכל מילה יש משמעות", fa: "هر واژه ارزش دارد", ur: "ہر لفظ اہم ہے", hi: "हर शब्द मायने रखता है", ru: "Каждое слово важно" };
function CaptionPresetPreview({ presetKey, language, active }: { presetKey: string; language: string; active: boolean }) {
  const slot = useRef<HTMLDivElement>(null);
  const player = useRef<DojoVideoEngineCanvasPreviewHandle>(null);
  const activeRef = useRef(active); activeRef.current = active;
  const [visible, setVisible] = useState(false);
  const scene = useMemo(() => {
    const document = createEditorDocument({ width: 480, height: 240, durationInFrames: 72, fps: 30, backgroundColor: "#161320" });
    const text = samples[language.split('-')[0]] ?? samples.en;
    const built = buildCaptionTrack(document, { id: "caption-preview", trackId: "visual", cues: [{ id: "sample", text, startMs: 0, endMs: 2400, words: estimateCaptionWords(text, 0, 2400, language) }], from: 0, name: "Preview", language, preset: presetKey });
    for (const command of built.commands) if (command.type === "addAsset") document.assets[command.asset.id] = command.asset;
    built.item.node.style = { ...built.item.node.style, left: 16, top: 16, width: 448, height: 208 };
    document.items = [built.item];
    return compileEditorDocument(document, {});
  }, [presetKey, language]);
  useEffect(() => {
    if (!slot.current) return;
    const observer = new IntersectionObserver(entries => { if (entries.some(entry => entry.isIntersecting)) { setVisible(true); observer.disconnect(); } });
    observer.observe(slot.current); return () => observer.disconnect();
  }, []);
  useEffect(() => { if (active) player.current?.play(); else player.current?.pause(); }, [active]);
  return <div ref={slot} className="editor-caption-style-art" aria-hidden="true">
    {visible && <DojoVideoEngineCanvasPreview ref={player} scene={scene} title={`Caption style ${presetKey}`} showControls={false} compact
      onPlaybackStateChange={state => { if (activeRef.current && state.status === "ready" && !state.playing) player.current?.play(); }} />}
  </div>;
}
export function EditorCaptionStylePicker({ value, onChange, language, disabled, staticOnly = false }: { value: string; onChange: (key: string) => void; language?: string; disabled?: boolean; staticOnly?: boolean }) {
  const t = useNativeEditorText();
  const { locale } = useTranslation();
  const [hovered, setHovered] = useState<string | null>(null);
  return <div className="editor-caption-style-grid" data-caption-style-scope={staticOnly ? "translation" : "original"} role="group" aria-label={t("Caption style")}>
    {editorCaptionPresetEntries(staticOnly).map(([key, preset]) => <button key={key} type="button" data-caption-preset={key} aria-label={t(preset.label)} aria-pressed={key === value} disabled={disabled}
      className="editor-caption-style-card" onClick={() => onChange(key)} onMouseEnter={() => setHovered(key)} onMouseLeave={() => setHovered(null)} onFocus={() => setHovered(key)} onBlur={() => setHovered(null)}>
      <CaptionPresetPreview presetKey={key} language={language && language !== "auto" ? language : locale} active={preset.mode !== "sentence" && (hovered === key || value === key)} />
      <span className="editor-caption-style-name">{t(preset.label)}<small>{preset.mode === "sentence" ? t("Static") : <><Play size={10} />{t("Dynamic")}</>}</small></span>
    </button>)}
  </div>;
}
