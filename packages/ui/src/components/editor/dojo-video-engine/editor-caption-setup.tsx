"use client";
import { useEffect, useRef, useState } from "react";
import { X, Subtitles } from "lucide-react";
import { useTranslation } from "@/lib/i18n";
import type { EditorDocument, EditorItem } from "@/lib/editor/document";
import { captionLanguageLabel, captionLanguages, type CaptionProgress, type CaptionSetupOptions } from "./editor-caption-workflow";
import { EditorCaptionStylePicker } from "./editor-caption-style-picker";
import { EditorCaptionProgress } from "./editor-caption-progress";
import { useNativeEditorText } from "./native-editor-copy";

export function EditorCaptionSetup({ source, document, initialTarget, busy, progress, onStart, onClose, onOpen }: {
  source: EditorItem; document: EditorDocument; initialTarget?: string; busy: boolean; progress: CaptionProgress | null;
  onStart: (options: CaptionSetupOptions) => Promise<void>; onClose: () => void; onOpen: (id: string) => void;
}) {
  const t = useNativeEditorText(); const { locale } = useTranslation();
  const dialog = useRef<HTMLDialogElement>(null);
  const [language, setLanguage] = useState(source.caption?.language ?? "auto");
  const [translate, setTranslate] = useState(!!source.caption || !!initialTarget);
  const [target, setTarget] = useState(initialTarget ?? (locale === "en" ? "es" : locale));
  const [preset, setPreset] = useState("karaoke");
  const [translationPreset, setTranslationPreset] = useState("classic");
  const [styleTarget, setStyleTarget] = useState<"original" | "translation">("original");
  const translationStyle = !!source.caption || (translate && styleTarget === "translation");
  const [consent, setConsent] = useState(true);
  const [started, setStarted] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const uploadNeeded = !source.caption && document.assets[source.node.assetId ?? ""]?.source === "local";
  useEffect(() => { if (!dialog.current?.open) dialog.current?.showModal(); return () => dialog.current?.close(); }, []);
  async function submit() {
    setError(null); setStarted(true);
    try { await onStart({ language, translationLanguage: translate ? target : undefined, preset: source.caption ? translationPreset : preset, translationPreset: translate ? translationPreset : undefined, cloudConsent: !uploadNeeded || consent }); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "Caption creation could not start."); setStarted(false); }
  }
  return <dialog ref={dialog} className="editor-caption-dialog" role="dialog" aria-modal="true" aria-label={t(source.caption ? "Translate captions" : "Create captions")} onCancel={event => { event.preventDefault(); onClose(); }}>
    <div className="editor-caption-dialog-header"><h2><Subtitles size={20} />{t(source.caption ? "Translate captions" : "Create captions")}</h2><button type="button" aria-label={t("Close caption setup")} onClick={onClose}><X size={19} /></button></div>
    <form onSubmit={event => { event.preventDefault(); void submit(); }}>
      <div className="editor-caption-dialog-body">
        <p className="editor-caption-source-name">{source.name}</p>
        {started && progress ? <EditorCaptionProgress progress={progress} onOpen={id => { onOpen(id); onClose(); }} /> : <>
          <div className="editor-caption-setup-fields">
            <label>{t("Original language")}<select aria-label={t("Original language")} value={language} onChange={event => setLanguage(event.target.value)}><option value="auto">{t("Auto detect")}</option>{language !== "auto" && !captionLanguages.includes(language) && <option value={language}>{captionLanguageLabel(language, locale)}</option>}{captionLanguages.map(code => <option key={code} value={code}>{captionLanguageLabel(code, locale)}</option>)}</select></label>
            <div><label className="editor-caption-translation-toggle"><input type="checkbox" checked={translate} disabled={!!source.caption} onChange={event => setTranslate(event.target.checked)} />{t("Add a translation")}</label>{translate && <label>{t("Translate to")}<select aria-label={t("Translate to")} value={target} onChange={event => setTarget(event.target.value)}>{captionLanguages.map(code => <option key={code} value={code}>{captionLanguageLabel(code, locale)}</option>)}</select></label>}</div>
          </div>
          {translate && language === target && <p role="alert" className="editor-caption-error">{t("Choose a different translation language.")}</p>}
          <div className="editor-caption-style-heading">
            <h3>{t("Caption style")}</h3>
            {translate && !source.caption && <div className="editor-caption-style-target" role="group" aria-label={t("Caption style target")}>
              <button type="button" aria-pressed={!translationStyle} onClick={() => setStyleTarget("original")}>{t("Original")}</button>
              <button type="button" aria-pressed={translationStyle} onClick={() => setStyleTarget("translation")}>{t("Translation")}</button>
            </div>}
            <span>{t(translationStyle ? "Translated captions use static styles because they have no word timestamps." : "Hover or focus a dynamic style to preview its word animation.")}</span>
          </div>
          <EditorCaptionStylePicker value={translationStyle ? translationPreset : preset} onChange={translationStyle ? setTranslationPreset : setPreset} language={translationStyle ? target : language} staticOnly={translationStyle} />
        </>}
        {error && <p role="alert" className="editor-caption-error">{t(error)}</p>}
      </div>
      <div className="editor-caption-dialog-footer">
        {!started && <div className="editor-caption-consent">
          {uploadNeeded && <label><input type="checkbox" checked={consent} onChange={event => setConsent(event.target.checked)} />{t("Upload this media for cloud transcription")}</label>}
          <p>{t(source.caption ? "Translation uses credits. Your original captions are kept." : "Transcription uses credits. Translation uses additional credits when selected.")}</p>
        </div>}
        <div className="editor-caption-dialog-actions"><button type="button" className="editor-secondary-button" onClick={onClose}>{t(started ? "Close" : "Cancel")}</button>{!started && <button type="submit" className="editor-primary-button" disabled={busy || (uploadNeeded && !consent) || (translate && target === language)}>{t(source.caption ? "Translate captions" : "Generate captions")}</button>}</div>
      </div>
    </form>
  </dialog>;
}
