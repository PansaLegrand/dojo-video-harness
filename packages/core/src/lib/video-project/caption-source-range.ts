import { z } from "zod/v3";
import {
  executeVideoProjectCommands,
  type VideoProjectCommand,
} from "./commands";
import {
  parseVideoProjectDocument,
  type VideoProjectDocument,
} from "./document";
import { sourceWindow } from "./source-clock";

export const captionSourceRangeSchema = z
  .object({
    startMs: z.number().finite().nonnegative(),
    endMs: z.number().finite().positive(),
  })
  .strict()
  .refine(
    (range) => range.endMs > range.startMs,
    "Source range must have positive duration.",
  );
export type CaptionSourceRange = z.infer<typeof captionSourceRangeSchema>;

/** Projects a narrower source window in a fresh candidate. Source evidence and
 * source identity remain intact; the returned commands are applied by the host. */
export function prepareCaptionSourceRange(
  inputDocument: VideoProjectDocument,
  sourceItemId: string,
  raw: unknown,
) {
  const document = parseVideoProjectDocument(inputDocument),
    range = captionSourceRangeSchema.parse(raw);
  const item = document.items.find((item) => item.id === sourceItemId);
  if (!item || !["audio", "video"].includes(item.node.type) || item.node.loop)
    throw new Error("Choose a forward, non-looping video/audio source range.");
  const window = sourceWindow(item, document.format.fps);
  if (
    range.startMs < window.startMs - 0.001 ||
    range.endMs > window.endMs + 0.001
  )
    throw new Error(
      "Caption source range must narrow the current source window.",
    );
  const duration = Math.floor(
    (((range.endMs - range.startMs) / window.rate) * document.format.fps) /
      1000 +
      1e-8,
  );
  if (duration < 1)
    throw new Error(
      "Caption source range is shorter than one composition frame.",
    );
  const field =
    item.node.type === "video" ? "videoStartTime" : "audioStartTime";
  const commands: VideoProjectCommand[] = [];
  if ((item.node[field] ?? 0) !== range.startMs / 1000)
    commands.push({
      type: "set",
      target: { kind: "node", itemId: item.id, nodeId: item.node.id },
      path: [field],
      value: range.startMs / 1000,
    });
  if (item.node.duration !== duration)
    commands.push({
      type: "trimItem",
      id: item.id,
      from: item.node.from ?? 0,
      duration,
    });
  const candidate = commands.length
    ? executeVideoProjectCommands(document, commands).document
    : document;
  return {
    document: candidate,
    commands,
    sourceRange: {
      ...range,
      effectiveEndMs:
        range.startMs + ((duration * 1000) / document.format.fps) * window.rate,
    },
  };
}
