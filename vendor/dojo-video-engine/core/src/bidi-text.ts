/// <reference path="./bidi-js.d.ts" />
import bidiFactory from "bidi-js";
import type { SceneTextRun } from "@dojo-video-engine/schema";

// bidi-js 1.0.3 is MIT-licensed, pure JavaScript Unicode UBA 13.0/UAX-C1.
// It determines visual ordering only; the renderer shapes the complete line.
const bidi = bidiFactory();
export type LogicalTextSegment = { text: string; run: SceneTextRun };

export function positionBidiTextSegments(
  text: string,
  segments: LogicalTextSegment[],
  direction: "ltr" | "rtl",
  lineX: number,
  lineWidth: number,
  measure: (text: string, direction: "ltr" | "rtl") => number,
): Array<LogicalTextSegment & { x: number; width: number }> {
  if (!text || segments.length === 0) return [];
  const embedding = bidi.getEmbeddingLevels(text, direction);
  const blocks: Array<{
    start: number;
    end: number;
    level: number;
    width: number;
    x: number;
  }> = [];
  const blockAt = new Int32Array(text.length);
  for (let start = 0; start < text.length; ) {
    const level = embedding.levels[start] ?? 0;
    let end = start + 1;
    while (end < text.length && embedding.levels[end] === level) end += 1;
    const index = blocks.length;
    blocks.push({
      start,
      end,
      level,
      width: measure(text.slice(start, end), level % 2 ? "rtl" : "ltr"),
      x: 0,
    });
    blockAt.fill(index, start, end);
    start = end;
  }
  const visualOrder = [
    ...new Set(
      bidi.getReorderedIndices(text, embedding).map((index) => blockAt[index]!),
    ),
  ];
  const totalWidth = blocks.reduce((sum, block) => sum + block.width, 0);
  const scale = totalWidth > 0 ? lineWidth / totalWidth : 0;
  let x = lineX;
  for (const index of visualOrder) {
    blocks[index]!.x = x;
    x += blocks[index]!.width * scale;
  }
  let offset = 0;
  return segments.flatMap((segment) => {
    const start = offset;
    const end = start + segment.text.length;
    offset = end;
    return blocks.flatMap((block) => {
      const from = Math.max(start, block.start),
        until = Math.min(end, block.end);
      if (until <= from) return [];
      const blockDirection = block.level % 2 ? "rtl" : "ltr";
      const before = Math.min(
        block.width,
        measure(text.slice(block.start, from), blockDirection),
      );
      const after = Math.max(
        before,
        Math.min(
          block.width,
          measure(text.slice(block.start, until), blockDirection),
        ),
      );
      return [
        {
          text: text.slice(from, until),
          run: segment.run,
          x:
            block.x +
            (blockDirection === "rtl" ? block.width - after : before) * scale,
          width: (after - before) * scale,
        },
      ];
    });
  });
}
