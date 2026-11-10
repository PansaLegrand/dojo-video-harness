import type { CaptionCue, EditorItem } from "@/lib/editor/document";
export const CAPTION_READABILITY_LIMITS = Object.freeze({ strandedMs: 800, strandedCharacters: 16, longCharacters: 80, explicitLines: 2 });
/** Product cues for manual correction, not a transcript or translation grader. */
export function captionReadability(cue: CaptionCue): Array<"short" | "long" | "lines"> {
  const length = Array.from(cue.text.replace(/\s+/gu, "")).length, result: Array<"short" | "long" | "lines"> = [];
  if (cue.endMs - cue.startMs < CAPTION_READABILITY_LIMITS.strandedMs && length <= CAPTION_READABILITY_LIMITS.strandedCharacters) result.push("short");
  if (length > CAPTION_READABILITY_LIMITS.longCharacters) result.push("long");
  if (cue.text.split(/\r?\n/u).length > CAPTION_READABILITY_LIMITS.explicitLines) result.push("lines");
  return result;
}
function displayParts(text: string): { before: string; after: string } {
  const points = Array.from(text.trim()); if (points.length < 2) return { before: text.trim(), after: "" };
  const middle = points.length / 2;
  const spaces = points.map((point, index) => /\s/u.test(point) && index > 0 && index < points.length - 1 ? index : -1).filter(index => index >= 0);
  const at = spaces.length ? spaces.reduce((best, index) => Math.abs(index - middle) < Math.abs(best - middle) ? index : best) : Math.floor(middle);
  return { before: points.slice(0, at).join("").trim(), after: points.slice(at).join("").trim() };
}
/** Original timed words choose the common clock. Translation text is an explicit
 * editable suggestion; no translated word timings or new ASR work are created. */
export function captionSplitDraft(items: readonly EditorItem[], cueId: string, fps: number) {
  const original = items[0]?.caption?.cues.find(cue => cue.id === cueId);
  if (!original) throw new Error("The selected caption cue no longer exists.");
  const minimum = 1000 / fps, middle = (original.startMs + original.endMs) / 2;
  const boundaries = original.words?.map(word => word.endMs).filter(time => time >= original.startMs + minimum && time <= original.endMs - minimum);
  if (original.words?.length && !boundaries?.length) throw new Error("This cue has no interior timed word boundary.");
  const splitMs = boundaries?.length ? boundaries.reduce((best, time) => Math.abs(time - middle) < Math.abs(best - middle) ? time : best) : Math.round(middle * fps / 1000) * 1000 / fps;
  if (splitMs <= original.startMs || splitMs >= original.endMs) throw new Error("This caption is too short to split.");
  const texts: Record<string, { before: string; after: string }> = {};
  for (const item of items) {
    const cue = item.caption?.cues.find(cue => cue.id === cueId); if (!cue) throw new Error("The linked caption cue no longer exists.");
    let parts = displayParts(cue.text);
    if (item === items[0] && original.words?.length) {
      let cursor = 0, at = -1;
      for (const word of original.words) {
        const found = original.text.indexOf(word.text, cursor); if (found < 0) { at = -1; break; }
        if (word.startMs >= splitMs && at < 0) at = found;
        cursor = found + word.text.length;
      }
      if (at > 0) parts = { before: original.text.slice(0, at).trim(), after: original.text.slice(at).trim() };
    }
    texts[item.id] = parts;
  }
  return { splitMs, texts };
}
