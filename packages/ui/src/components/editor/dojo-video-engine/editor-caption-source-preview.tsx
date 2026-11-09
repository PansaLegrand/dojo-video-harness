"use client";
import { useEffect, useRef, useState } from "react";
import type { EditorAsset } from "@/lib/editor/document";
import type { CaptionSourceMoment } from "./editor-caption-source";
import { useNativeEditorText } from "./native-editor-copy";

/** Local audition only. It neither uploads media nor requests model/provider work. */
export function EditorCaptionSourcePreview({ asset, source, moment, mainPreviewPlaying = false, onPauseMain, onRelink, onClose }: {
  asset: EditorAsset; source?: string; moment: CaptionSourceMoment; mainPreviewPlaying?: boolean; onPauseMain?: () => void; onRelink?: () => void; onClose: () => void;
}) {
  const t = useNativeEditorText(), media = useRef<HTMLMediaElement | null>(null), [ready, setReady] = useState(false), [playing, setPlaying] = useState(false), [error, setError] = useState(false);
  const generation = useRef(0);
  useEffect(() => {
    generation.current++; setPlaying(false); setError(false);
    const player = media.current; player?.pause();
    setReady(!!player && player.readyState >= 1);
    if (player && player.readyState >= 1) { player.currentTime = moment.sourceStartSeconds; player.playbackRate = moment.rate; }
    return () => { generation.current++; player?.pause(); player?.removeAttribute("src"); player?.load(); };
  }, [source]);
  useEffect(() => { generation.current++; const player = media.current; player?.pause(); setPlaying(false); if (player && player.readyState >= 1) { player.currentTime = moment.sourceStartSeconds; player.playbackRate = moment.rate; } }, [moment.sourceStartSeconds, moment.sourceEndSeconds, moment.rate]);
  useEffect(() => { if (mainPreviewPlaying) { generation.current++; media.current?.pause(); setPlaying(false); } }, [mainPreviewPlaying]);
  const listeners = { onLoadedMetadata: (event: React.SyntheticEvent<HTMLMediaElement>) => { const player = event.currentTarget; player.currentTime = moment.sourceStartSeconds; player.playbackRate = moment.rate; setReady(true); },
    onTimeUpdate: () => { const player = media.current; if (player && player.currentTime >= moment.sourceEndSeconds) { player.pause(); setPlaying(false); } }, onPause: () => setPlaying(false), onEnded: () => setPlaying(false), onError: () => { generation.current++; media.current?.pause(); setError(true); setPlaying(false); } };
  async function play() {
    const player = media.current; if (!player || !ready) return;
    if (playing) { generation.current++; player.pause(); setPlaying(false); return; }
    const token = ++generation.current; onPauseMain?.(); player.currentTime = moment.sourceStartSeconds; player.playbackRate = moment.rate;
    try { await player.play(); if (generation.current !== token) return; setPlaying(true); }
    catch { if (generation.current === token) setError(true); }
  }
  return <section className="editor-caption-source-preview" aria-label={t("Linked source moment")} data-caption-source={moment.assetId}>
    <header><strong>{asset.name}</strong><button type="button" aria-label={t("Close source moment")} onClick={onClose}>×</button></header>
    <small>{moment.sourceStartSeconds.toFixed(3)}–{moment.sourceEndSeconds.toFixed(3)} s</small>
    {source && !error ? <>{asset.type === "video" ? <video key={source} ref={element => { media.current = element; }} src={source} playsInline preload="metadata" {...listeners} /> : <audio key={source} ref={element => { media.current = element; }} src={source} preload="metadata" {...listeners} />}
      <button type="button" className="editor-secondary-button" disabled={!ready} onClick={() => void play()}>{t(playing ? "Pause source moment" : "Play source moment")}</button></> : <p role="status">{t(source ? "Source preview unavailable." : "Relink the original media to inspect this moment.")}{asset.source === "local" && onRelink && <button type="button" onClick={onRelink}>{t("Choose original file")}</button>}</p>}
    {moment.clipped && <p role="status">{t("This caption extends beyond the linked source clip.")}</p>}
  </section>;
}
