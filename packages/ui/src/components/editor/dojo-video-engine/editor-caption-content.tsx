"use client";
import { useEffect, useRef, useState } from "react";
import { ArrowRightLeft, Combine, Maximize2, Plus, Search, X, Wand2 } from "lucide-react";
import { useTranslation } from "@/lib/i18n";
import type { CaptionCue, EditorDocument, EditorItem } from "@/lib/editor/document";
import { estimateCaptionWords } from "@/lib/editor/caption-words";
import { captionLanguageLabel, captionRelations, editCaptionText, editCaptionWord, mergeCaptionWithNext } from "./editor-caption-workflow";
import { EditorField, EditorTextArea } from "./editor-fields";
import { EditorCaptionStylePicker } from "./editor-caption-style-picker";
import { useNativeEditorText } from "./native-editor-copy";
import { EditorCaptionActiveCue } from "./editor-playhead";

function CaptionDialog({ title, onClose, children }: { title: string; onClose: () => void; children: React.ReactNode }) {
  const ref = useRef<HTMLDialogElement>(null);
  const t = useNativeEditorText();
  function close() { (ref.current?.ownerDocument.activeElement as HTMLElement | null)?.blur(); onClose(); }
  useEffect(() => { ref.current?.showModal(); return () => ref.current?.close(); }, []);
  return <dialog ref={ref} className="editor-caption-dialog editor-caption-edit-dialog" role="dialog" aria-modal="true" aria-label={t(title)} onCancel={event => { event.preventDefault(); close(); }}>
    <div className="editor-caption-dialog-header"><h2>{t(title)}</h2><button aria-label={t("Close caption editor")} onClick={close}><X size={18} /></button></div>
    <div className="editor-caption-dialog-body">{children}</div>
  </dialog>;
}
function CueEditor({ cue, index, language, onChange, onPreview, onRemove, onMerge, onSeek, companion, disabled, allowWords }: {
  cue: CaptionCue; index: number; language?: string; onChange: (cue: CaptionCue) => void; onPreview: (cue: CaptionCue | null) => void;
  onRemove: () => void; onMerge?: () => void; onSeek: () => void; companion?: React.ReactNode; disabled: boolean; allowWords: boolean;
}) {
  const t = useNativeEditorText(); const [wordsOpen, setWordsOpen] = useState(false);
  const words = !allowWords ? [] : cue.words?.length ? cue.words : estimateCaptionWords(cue.text, cue.startMs, cue.endMs, language);
  function updateCueTime(key: "startMs" | "endMs", seconds: string) {
    const { words: _words, ...withoutWordTiming } = cue;
    onChange({ ...withoutWordTiming, [key]: Math.round(Number(seconds) * 1000) });
  }
  return <fieldset disabled={disabled} className="editor-caption-cue" data-cue-id={cue.id}>
    <div className="editor-caption-cue-heading"><button type="button" onClick={onSeek}>{String(index + 1).padStart(2, '0')} · {(cue.startMs/1000).toFixed(2)}–{(cue.endMs/1000).toFixed(2)} s</button><button type="button" aria-label={`${t("Remove cue")} ${index + 1}`} onClick={onRemove}><X size={13} /></button></div>
    <div className={companion ? "editor-caption-bilingual-row" : undefined}>
      <EditorTextArea label={`Caption ${index + 1}`} value={cue.text} rows={2} onPreview={text => onPreview(text === null ? null : editCaptionText(cue, text))} onCommit={text => onChange(editCaptionText(cue, text))} />
      {companion}
    </div>
    <details onToggle={event => setWordsOpen(event.currentTarget.open)}><summary>{t(allowWords ? "Words & timing" : "Timing")}</summary>
      {wordsOpen && <div className="editor-caption-word-editor">
        <div className="grid grid-cols-2 gap-2">
          <EditorField label={`Cue ${index + 1} start (s)`} type="number" value={cue.startMs/1000} min={0} max={(cue.endMs-1)/1000} step={.01} decimalPlaces={2} onCommit={value => updateCueTime("startMs", value)} />
          <EditorField label={`Cue ${index + 1} end (s)`} type="number" value={cue.endMs/1000} min={(cue.startMs+1)/1000} step={.01} decimalPlaces={2} onCommit={value => updateCueTime("endMs", value)} />
        </div>
        {allowWords && !cue.words?.length && <small>{t("Estimated word timing")}</small>}
        {words.map((word, wordIndex) => <div key={wordIndex} className="editor-caption-word-row">
          <EditorField label={`${t("Word")} ${wordIndex + 1}`} value={word.text} onPreview={text => onPreview(text === null ? null : editCaptionWord({ ...cue, words }, wordIndex, text))} onCommit={value => onChange(editCaptionWord({ ...cue, words }, wordIndex, value))} />
          <EditorField label={`${t("Start")} ${wordIndex + 1}`} type="number" step={.01} decimalPlaces={2} min={cue.startMs/1000} max={(word.endMs-1)/1000} value={word.startMs/1000} onCommit={value => onChange({ ...cue, words: words.map((entry, at) => at === wordIndex ? { ...entry, startMs: Math.round(Number(value)*1000) } : entry) })} />
          <EditorField label={`${t("End")} ${wordIndex + 1}`} type="number" step={.01} decimalPlaces={2} min={(word.startMs+1)/1000} max={cue.endMs/1000} value={word.endMs/1000} onCommit={value => onChange({ ...cue, words: words.map((entry, at) => at === wordIndex ? { ...entry, endMs: Math.round(Number(value)*1000) } : entry) })} />
        </div>)}
      </div>}
    </details>
    {onMerge && <button type="button" className="editor-caption-merge" aria-label={`${t("Merge with next")}: ${t(`Caption ${index + 1}`)} + ${t(`Caption ${index + 2}`)}`} onClick={onMerge}><Combine size={13} aria-hidden="true" />{t("Merge with next")}</button>}
  </fieldset>;
}
export function EditorCaptionContent({ item, document, frame, disabled, onUpdate, onSelect, onSeek, onTranslate, onStyle, onPreviewCue }: {
  item: EditorItem; document: EditorDocument; frame: number; disabled: boolean;
  onUpdate: (id: string, patch: Partial<EditorItem>) => void; onSelect: (id: string) => void; onSeek: (frame: number) => void;
  onPreviewCue: (item: EditorItem, cue: CaptionCue | null) => void;
  onTranslate: (item: EditorItem) => void; onStyle: (item: EditorItem, key: string) => void;
}) {
  const t = useNativeEditorText(); const { locale } = useTranslation();
  const [query, setQuery] = useState(""); const [limit, setLimit] = useState(12);
  const [expanded, setExpanded] = useState(false); const [styleOpen, setStyleOpen] = useState(false);
  const [pairId, setPairId] = useState("");
  useEffect(() => { setQuery(""); setLimit(12); setPairId(""); }, [item.id]);
  const caption = item.caption!;
  const related = captionRelations(document.items, item);
  const paired = related.find(candidate => candidate.id === pairId) ?? related[0];
  function updateCues(owner: EditorItem, cues: CaptionCue[]) {
    onUpdate(owner.id, { caption: { ...owner.caption!, cues }, node: { ...owner.node, duration: Math.max(owner.node.duration ?? 1, Math.ceil(Math.max(1, ...cues.map(cue => cue.endMs)) * document.format.fps / 1000)) } });
  }
  function content() {
    return <>
      <div className="editor-caption-editor-meta"><strong>{t(caption.role === "translation" ? "Translation" : "Original")} · {captionLanguageLabel(caption.language, locale) ?? t("Language not specified")}</strong><span>{caption.cues.length} {t("captions")}</span></div>
      {!!related.length && <div className="editor-caption-relationship" data-caption-relationship={item.id}>
        <span>{t(caption.role === "translation" ? "Translated from" : "Translations")}</span>
        {related.map(other => <button key={other.id} type="button" onClick={() => onSelect(other.id)}><ArrowRightLeft size={12} />{captionLanguageLabel(other.caption?.language, locale) ?? other.name}</button>)}
      </div>}
      {!related.length && caption.role === "translation" && caption.pairedItemId && <p className="editor-muted-copy">{t("Source captions unavailable")}</p>}
      <div className="editor-caption-editor-toolbar">
        <label><Search size={14} /><input aria-label={t("Search captions")} placeholder={t("Search captions")} value={query} onChange={event => setQuery(event.target.value)} /></label>
        <button type="button" disabled={disabled} onClick={() => setStyleOpen(true)}><Wand2 size={14} />{t("Style")}</button>
        {!expanded && <button type="button" onClick={() => { setExpanded(true); setLimit(50); }}><Maximize2 size={14} />{t("Edit captions")}</button>}
      </div>
      {expanded && related.length > 1 && <select aria-label={t("Compare translation")} value={paired?.id ?? ""} onChange={event => setPairId(event.target.value)}>{related.map(other => <option key={other.id} value={other.id}>{captionLanguageLabel(other.caption?.language, locale) ?? other.name}</option>)}</select>}
      <div className="editor-caption-cues">
        {caption.cues.map((cue, index) => ({ cue, index })).filter(({ cue }) => !query || cue.text.toLocaleLowerCase().includes(query.toLocaleLowerCase())).slice(0, limit).map(({ cue, index }) => {
          const partner = paired?.caption?.cues.find(entry => entry.id === cue.id) ?? paired?.caption?.cues.find(entry => Math.abs(entry.startMs-cue.startMs) < 2 && Math.abs(entry.endMs-cue.endMs) < 2);
          return <EditorCaptionActiveCue key={`${item.id}:${cue.id}`} frame={frame} from={item.node.from ?? 0} fps={document.format.fps} startMs={cue.startMs} endMs={cue.endMs}>
            <CueEditor cue={cue} index={index} allowWords={caption.role !== "translation"} language={caption.language} disabled={disabled} onSeek={() => onSeek((item.node.from ?? 0) + Math.round(cue.startMs * document.format.fps / 1000))}
              onPreview={value => onPreviewCue(item, value)}
              onChange={value => updateCues(item, caption.cues.map(entry => entry.id === cue.id ? value : entry))} onRemove={() => updateCues(item, caption.cues.filter(entry => entry.id !== cue.id))}
              onMerge={!query && index + 1 < Math.min(limit, caption.cues.length) ? () => updateCues(item, mergeCaptionWithNext(caption.cues, cue.id, caption.language)) : undefined}
              companion={expanded && paired && partner ? <fieldset disabled={disabled || !!document.tracks.find(track => track.id === paired.trackId)?.locked}><EditorTextArea label={`${captionLanguageLabel(paired.caption?.language, locale) ?? t("Translation")} ${index+1}`} value={partner.text} rows={2} onPreview={value => onPreviewCue(paired, value === null ? null : editCaptionText(partner, value))} onCommit={value => updateCues(paired, paired.caption!.cues.map(entry => entry.id === partner.id ? editCaptionText(entry, value) : entry))} /></fieldset> : undefined} />
          </EditorCaptionActiveCue>;
        })}
      </div>
      {limit < caption.cues.length && <button type="button" className="editor-secondary-button" onClick={() => setLimit(value => value+50)}>{t("Show more captions")}</button>}
      <div className="editor-caption-editor-actions"><button disabled={disabled} type="button" onClick={() => { const startMs = Math.max(0, ...caption.cues.map(cue => cue.endMs)); updateCues(item, [...caption.cues, { id: crypto.randomUUID(), text: t("Your caption"), startMs, endMs: startMs+2000 }]); }}><Plus size={14} />{t("Add a caption")}</button><button disabled={disabled} type="button" onClick={() => onTranslate(item)}>{t("Add a translation")}</button></div>
    </>;
  }
  return <div className="editor-caption-content">
    {!expanded && content()}
    {expanded && <CaptionDialog title="Edit captions" onClose={() => setExpanded(false)}>{content()}</CaptionDialog>}
    {styleOpen && <CaptionDialog title="Caption style" onClose={() => setStyleOpen(false)}>{caption.role === "translation" && <p className="editor-muted-copy mb-3">{t("Translated captions use static styles because they have no word timestamps.")}</p>}<EditorCaptionStylePicker value="custom" staticOnly={caption.role === "translation"} language={caption.language} disabled={disabled} onChange={key => { onStyle(item, key); setStyleOpen(false); }} /></CaptionDialog>}
  </div>;
}
