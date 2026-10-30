"use client";

import { useEffect, useMemo, useState } from "react";
import type { VideoProjectDocument } from "@/lib/video-project/document";
import { manualSpeechRemoval, manualTranscriptSources } from "@/lib/video-project/manual-transcript";
import { useNativeEditorText } from "./native-editor-copy";

export type EditorSpeechSelection = { sourceItemId: string; evidenceId: string; wordIds: string[] };
const PAGE_WORDS = 120;
export function EditorTranscriptPanel({ document, selectedItemId, disabled, onSeek, onRemove }: {
  document: VideoProjectDocument; selectedItemId: string | null; disabled: boolean;
  onSeek: (frame: number) => void;
  onRemove: (selection: EditorSpeechSelection, basis: VideoProjectDocument) => void;
}) {
  const t = useNativeEditorText();
  const sources = useMemo(() => manualTranscriptSources(document), [document]);
  const [sourceId, setSourceId] = useState(selectedItemId ?? "");
  const source = sources.find(source => source.item.id === sourceId) ?? sources[0];
  const [selection, setSelection] = useState<{ first: number; last: number; complete: boolean } | null>(null);
  const [page, setPage] = useState(0), [search, setSearch] = useState("");
  useEffect(() => { setSelection(null); setPage(0); }, [document, source?.item.id]);
  const ids = useMemo(() => source && selection ? source.words.slice(Math.min(selection.first, selection.last), Math.max(selection.first, selection.last) + 1).map(word => word.id) : [], [source, selection]);
  const prepared = useMemo(() => {
    if (!source || !ids.length) return { edit: null, error: null };
    try { return { edit: manualSpeechRemoval(document, source.item.id, source.evidenceId, ids), error: null }; }
    catch (cause) { return { edit: null, error: cause instanceof Error ? cause.message : "The speech selection could not be edited." }; }
  }, [document, source, ids]);
  if (!source) return <p className="editor-muted-copy">{t("Generate a transcript with word timing to edit speech. Caption corrections stay separate.")}</p>;
  const chooseWord = (index: number) => setSelection(current => !current || current.complete ? { first: index, last: index, complete: false } : { ...current, last: index, complete: true });
  const pages = Math.ceil(source.words.length / PAGE_WORDS);
  return <section className="editor-transcript-panel" aria-label={t("Edit speech")}>
    <label>{t("Source clip")}<select aria-label={t("Source clip")} value={source.item.id} onChange={event => setSourceId(event.target.value)}>{sources.map(source => <option key={source.item.id} value={source.item.id}>{source.item.name}</option>)}</select></label>
    <p>{t("Choose the first and last word to select a passage.")}</p>
    <input aria-label={t("Find a word")} placeholder={t("Find a word")} value={search} onChange={event => {
      const query = event.target.value; setSearch(query);
      const index = source.words.findIndex(word => word.text.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase()));
      if (index >= 0) setPage(Math.floor(index / PAGE_WORDS));
    }} />
    {search.trim() && !source.words.some(word => word.text.toLocaleLowerCase().includes(search.trim().toLocaleLowerCase())) && <p role="status">{t("No matching words.")}</p>}
    <div className="editor-transcript-words" dir="auto">{source.words.slice(page * PAGE_WORDS, (page + 1) * PAGE_WORDS).map((word, offset) => {
      const index = page * PAGE_WORDS + offset, selected = !!selection && index >= Math.min(selection.first, selection.last) && index <= Math.max(selection.first, selection.last);
      return <button key={word.id} type="button" disabled={disabled} aria-pressed={selected} data-word-id={word.id} data-search-match={!!search.trim() && word.text.toLocaleLowerCase().includes(search.trim().toLocaleLowerCase())} onClick={() => chooseWord(index)}>{word.text}</button>;
    })}</div>
    {pages > 1 && <div className="editor-source-points"><button disabled={page === 0} onClick={() => setPage(page - 1)}>{t("Previous")}</button><span className="text-center">{page + 1} / {pages}</span><button disabled={page + 1 >= pages} onClick={() => setPage(page + 1)}>{t("Next")}</button></div>}
    {!!ids.length && <>
      <div className="editor-source-points"><button onClick={() => setSelection(null)}>{t("Clear selection")}</button><button disabled={!prepared.edit} onClick={() => { if (prepared.edit) onSeek(prepared.edit.range.from); }}>{t("Preview passage")}</button></div>
      <p>{t("Removing speech cuts picture and sound across all tracks and closes the gap. Undo restores it.")}</p>
      {prepared.error && <p role="status">{t(prepared.error)}</p>}
      <button className="editor-primary-button editor-wide-button" disabled={disabled || !prepared.edit} onClick={() => onRemove({ sourceItemId: source.item.id, evidenceId: source.evidenceId, wordIds: ids }, document)}>{t("Remove speech and close gap")}{prepared.edit ? ` · ${prepared.edit.seconds.toFixed(2)}s` : ""}</button>
    </>}
  </section>;
}
