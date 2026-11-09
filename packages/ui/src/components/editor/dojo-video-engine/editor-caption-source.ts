import type { CaptionCue, EditorDocument, EditorItem } from "@/lib/editor/document";
import { sourceWindow } from "@/lib/video-project/source-clock";
export type CaptionSourceMoment = { sourceItemId: string; assetId: string; sourceStartSeconds: number; sourceEndSeconds: number; compositionFrame: number; rate: number; clipped: boolean };
/** Cue times are local to their caption container; playback offsets and source
 * speed are applied exactly once when inspecting the original owned media. */
export function captionSourceMoment(document: EditorDocument, caption: EditorItem, cue: CaptionCue): CaptionSourceMoment | null {
  const source = document.items.find(item => item.id === caption.caption?.sourceItemId);
  if (!source?.node.assetId || !["video", "audio"].includes(source.node.type) || source.node.loop) return null;
  const asset = document.assets[source.node.assetId]; if (!asset) return null;
  let window: ReturnType<typeof sourceWindow>; try { window = sourceWindow(source, document.format.fps); } catch { return null; }
  const offsetMs = ((caption.node.from ?? 0) - window.from) * 1000 / document.format.fps;
  const startMs = window.startMs + (offsetMs + cue.startMs) * window.rate, endMs = window.startMs + (offsetMs + cue.endMs) * window.rate;
  const maximum = Math.min(window.endMs, asset.durationSeconds === undefined ? window.endMs : asset.durationSeconds * 1000);
  if (!Number.isFinite(startMs) || !Number.isFinite(endMs) || endMs <= window.startMs || startMs >= maximum) return null;
  const start = Math.max(window.startMs, startMs), end = Math.min(maximum, endMs);
  if (end <= start) return null;
  return { sourceItemId: source.id, assetId: source.node.assetId, sourceStartSeconds: start / 1000, sourceEndSeconds: end / 1000,
    compositionFrame: (caption.node.from ?? 0) + Math.round(cue.startMs * document.format.fps / 1000), rate: window.rate, clipped: start !== startMs || end !== endMs };
}
