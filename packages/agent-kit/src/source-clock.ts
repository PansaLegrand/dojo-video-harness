/** Forward source-clock projection for an already validated timeline item and
 * positive FPS. This module deliberately has no editor, renderer or host imports. */
export type SourceClockItem = {
  node: {
    type: string;
    from?: number;
    duration?: number;
    playbackRate?: number;
    videoStartTime?: number;
    audioStartTime?: number;
  };
};
export type SourceClockWindow = {
  startMs: number;
  endMs: number;
  rate: number;
  from: number;
};
export type SourceClockRange = { from: number; duration: number };
export function sourceClockWindow(
  item: SourceClockItem,
  fps: number,
): SourceClockWindow {
  const rate = item.node.type === "video" ? (item.node.playbackRate ?? 1) : 1;
  if (rate <= 0)
    throw new Error("Source-bound edits require forward playback.");
  const startMs =
    (item.node.type === "video"
      ? (item.node.videoStartTime ?? 0)
      : (item.node.audioStartTime ?? 0)) * 1000;
  return {
    startMs,
    endMs: startMs + ((item.node.duration! * 1000) / fps) * rate,
    rate,
    from: item.node.from ?? 0,
  };
}
export function projectSourceClockRange(
  item: SourceClockItem,
  fps: number,
  startMs: number,
  endMs: number,
): SourceClockRange | null {
  const window = sourceClockWindow(item, fps);
  const start = Math.max(startMs, window.startMs),
    end = Math.min(endMs, window.endMs);
  if (end <= start) return null;
  const from =
    window.from +
    Math.round((((start - window.startMs) / window.rate) * fps) / 1000);
  const until = Math.min(
    window.from + item.node.duration!,
    window.from +
      Math.round((((end - window.startMs) / window.rate) * fps) / 1000),
  );
  return until > from ? { from, duration: until - from } : null;
}
