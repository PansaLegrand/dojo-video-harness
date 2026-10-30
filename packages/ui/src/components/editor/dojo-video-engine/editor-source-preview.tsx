"use client";

import { useEffect, useRef, useState } from "react";
import { X } from "lucide-react";
import type { EditorAsset } from "@/lib/editor/document";
import { requiresLocalVideoProxy } from "@/lib/dojo-video-engine-browser/preview-proxy-policy";
import { editorSourceInsertion, type EditorSourceRange } from "./editor-source-range";
import { useNativeEditorText } from "./native-editor-copy";

/** Source audition never changes the timeline until Add is pressed. */
export function EditorSourcePreview({ asset, source, poster, fps, disabled, onAdd, onClose }: {
  asset: EditorAsset; source: string; poster?: string; fps: number; disabled: boolean;
  onAdd: (range?: EditorSourceRange) => void; onClose: () => void;
}) {
  const t = useNativeEditorText();
  const player = useRef<HTMLMediaElement | null>(null);
  const panel = useRef<HTMLElement | null>(null);
  const [start, setStart] = useState("0"), [end, setEnd] = useState(String(asset.durationSeconds ?? 0));
  const [playbackError, setPlaybackError] = useState(false);
  useEffect(() => { const media = player.current; return () => { if (media) { media.pause(); media.removeAttribute("src"); media.load(); } }; }, []);
  useEffect(() => { panel.current?.scrollIntoView({ block: "nearest" }); }, []);
  const timed = ["video", "audio"].includes(asset.type) && !!asset.durationSeconds;
  const range = { startSeconds: Number(start), endSeconds: Number(end) };
  let issue: string | null = null;
  if (timed) {
    try { if (!start.trim() || !end.trim()) throw new Error("Choose an in and out point inside this source."); editorSourceInsertion(asset, fps, range); }
    catch (cause) { issue = cause instanceof Error ? cause.message : "Choose an in and out point inside this source."; }
  }
  const requiresProxy = requiresLocalVideoProxy(asset);
  const mark = (point: "in" | "out") => {
    const time = player.current?.currentTime;
    if (time === undefined || !Number.isFinite(time)) return;
    (point === "in" ? setStart : setEnd)(Math.min(asset.durationSeconds ?? time, Math.max(0, time)).toFixed(3));
  };
  return <section ref={panel} className="editor-source-preview" aria-label={t("Source preview")}>
    <div className="flex items-center justify-between gap-2"><strong className="min-w-0 truncate">{asset.name}</strong><button aria-label={t("Close source preview")} onClick={onClose}><X size={15} /></button></div>
    {asset.type === "image" ? <img src={source} alt={asset.name} /> : requiresProxy ? <>{poster && <img src={poster} alt={asset.name} />}<p>{t("Add to the timeline to use the smaller local preview.")}</p></>
      : asset.type === "video" ? <video ref={element => { player.current = element; }} src={source} poster={poster} controls playsInline preload="metadata" onError={() => setPlaybackError(true)} />
        : <audio ref={element => { player.current = element; }} src={source} controls preload="metadata" onError={() => setPlaybackError(true)} />}
    {playbackError && <p role="status">{t("Source preview unavailable. You can still add the media to the timeline.")}</p>}
    {timed && <>
      <div className="editor-source-points"><label>{t("In point (s)")}<input aria-label={t("In point (s)")} type="number" min={0} max={asset.durationSeconds} step={1 / fps} value={start} onChange={event => setStart(event.target.value)} /></label>
        <label>{t("Out point (s)")}<input aria-label={t("Out point (s)")} type="number" min={0} max={asset.durationSeconds} step={1 / fps} value={end} onChange={event => setEnd(event.target.value)} /></label></div>
      {!requiresProxy && <div className="editor-source-points"><button onClick={() => mark("in")}>{t("Set in here")}</button><button onClick={() => mark("out")}>{t("Set out here")}</button></div>}
      {issue && <p role="status">{t(issue)}</p>}
    </>}
    <button className="editor-primary-button editor-wide-button" disabled={disabled || !!issue} onClick={() => { player.current?.pause(); onAdd(timed ? range : undefined); }}>{t(timed ? "Add selected range" : "Add to timeline")}</button>
  </section>;
}
