import { z } from "zod/v3";
import { sceneNodeSchema } from "@dojo-video-engine/schema";
import type { VideoProjectDocument } from "./document";

export const readableOverlaySchema = z
  .object({
    itemId: z.string().min(1).max(191),
    trackId: z.string().min(1).max(191),
    kind: z.enum(["title", "lowerThird", "caption"]),
    text: z.string().trim().min(1).max(240),
    subtitle: z.string().trim().min(1).max(120).optional(),
    from: z.number().int().nonnegative(),
    duration: z.number().int().positive(),
  })
  .strict();

// Conservative line budgeting; browser textFit handles actual glyph metrics.
// Reject excess copy instead of silently dropping or ellipsizing user text.
function wrap(text: string, width: number, size: number, maxLines: number) {
  const lines: string[] = [];
  let line = "",
    used = 0;
  for (const word of text.split(/(\s+)/u)) {
    const units = (value: string) =>
      Array.from(value).reduce(
        (sum, c) =>
          sum + (/[^\u0000-\u007f]/u.test(c) || /[MW@]/u.test(c) ? 1 : 0.65),
        0,
      ) * size;
    if (line && used + units(word) > width) {
      lines.push(line.trimEnd());
      line = "";
      used = 0;
    }
    for (const char of word) {
      if (!line && /\s/u.test(char)) continue;
      const advance = units(char);
      if (used + advance > width && line) {
        lines.push(line.trimEnd());
        line = "";
        used = 0;
      }
      line += char;
      used += advance;
    }
  }
  if (line) lines.push(line.trimEnd());
  if (lines.length > maxLines)
    throw new Error(
      `Text needs ${lines.length} lines; this overlay allows ${maxLines}. Ask for shorter copy or separate cards.`,
    );
  return lines.join("\n");
}

export function prepareReadableOverlay(
  document: VideoProjectDocument,
  raw: unknown,
) {
  const input = readableOverlaySchema.parse(raw);
  const track = document.tracks.find((track) => track.id === input.trackId);
  if (!track || track.locked || track.hidden || track.kind === "audio")
    throw new Error("Choose an unlocked visible visual track.");
  if (document.items.some((item) => item.id === input.itemId))
    throw new Error("Choose a new overlay item ID.");
  if (input.from + input.duration > document.format.durationInFrames)
    throw new Error("Overlay must fit the existing timeline.");
  if (input.kind === "caption" && input.subtitle)
    throw new Error("Caption overlays use one text field.");
  const { width, height } = document.format;
  const short = Math.min(width, height);
  if (short < 240)
    throw new Error(
      "Readable overlay presets require at least 240 pixels per dimension.",
    );
  const margin = Math.round(short * 0.06),
    padding = Math.round(short * 0.025);
  const boxWidth = width - 2 * margin,
    contentWidth = boxWidth - 2 * padding;
  const fontSize = Math.max(
    16,
    Math.round(short * (input.kind === "title" ? 0.065 : 0.055)),
  );
  const text = wrap(
    input.text,
    contentWidth,
    fontSize,
    input.kind === "title" ? 3 : 2,
  );
  const lineHeight = Math.ceil(fontSize * 1.25),
    textHeight = text.split("\n").length * lineHeight;
  const subSize = Math.max(14, Math.round(fontSize * 0.75));
  const subtitle = input.subtitle
    ? wrap(input.subtitle, contentWidth, subSize, 2)
    : undefined;
  const subHeight = subtitle
    ? subtitle.split("\n").length * Math.ceil(subSize * 1.25)
    : 0;
  const boxHeight = textHeight + subHeight + padding * (subtitle ? 3 : 2);
  if (boxHeight > height * (input.kind === "title" ? 0.5 : 0.32))
    throw new Error(
      "This copy would cover too much footage. Shorten it or use a title card.",
    );
  const bottom =
    input.kind === "lowerThird"
      ? Math.max(
          Math.round(height * 0.16),
          margin + 2 * lineHeight + 3 * padding,
        )
      : margin;
  const top = input.kind === "title" ? margin : height - bottom - boxHeight;
  const textStyle = (size: number, top: number, height: number) => ({
    position: "absolute" as const,
    left: padding,
    top,
    width: contentWidth,
    height,
    fontFamily: "Arial, sans-serif",
    fontSize: size,
    lineHeight: 1.25,
    color: "#ffffff",
    textFit: "shrink" as const,
    minFontSize: Math.floor(size * 0.85),
  });
  const node = sceneNodeSchema.parse({
    id: input.itemId,
    type: "div",
    from: input.from,
    duration: input.duration,
    style: {
      position: "absolute",
      left: margin,
      top,
      width: boxWidth,
      height: boxHeight,
      backgroundColor: "rgba(15,23,42,0.88)",
      borderRadius: padding,
    },
    children: [
      {
        id: `${input.itemId}:text`,
        type: "text",
        text,
        style: textStyle(fontSize, padding, textHeight),
      },
      ...(subtitle
        ? [
            {
              id: `${input.itemId}:subtitle`,
              type: "text",
              text: subtitle,
              style: textStyle(subSize, textHeight + 2 * padding, subHeight),
            },
          ]
        : []),
    ],
  });
  return {
    type: "insertGraphic" as const,
    itemId: input.itemId,
    trackId: input.trackId,
    name: input.kind,
    node,
  };
}
