import { z } from "zod/v3";
import {
  executeVideoProjectCommands,
  type VideoProjectCommand,
} from "./commands";
import {
  parseVideoProjectDocument,
  type VideoProjectDocument,
  type VideoTranscriptEvidence,
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

/** Neighbor times bound uncertainty for coverage only. Raw omission times and
 * source words retain their provider values. Unknown token mappings stay explicit. */
export function captionTimingDiagnostics(
  document: VideoProjectDocument,
  sourceItemId: string,
  evidence: VideoTranscriptEvidence,
) {
  if (!evidence.timingOmissions?.length) return undefined;
  const source = document.items.find((item) => item.id === sourceItemId);
  if (!source) throw new Error("Caption source is missing.");
  const window = sourceWindow(source, document.format.fps);
  const prefix = /^sha256:[a-f0-9]{64}$/.test(evidence.transcriptHash)
    ? `w:${evidence.transcriptHash.slice(7, 23)}:`
    : undefined;
  const indexed = evidence.words.map((word) => ({
    word,
    index:
      prefix &&
      word.id.startsWith(prefix) &&
      /^(0|[1-9]\d*)$/.test(word.id.slice(prefix.length))
        ? Number(word.id.slice(prefix.length))
        : -1,
  }));
  const mapped = indexed.every(
    (entry, index) =>
      Number.isSafeInteger(entry.index) &&
      entry.index >= 0 &&
      (index === 0 || entry.index > indexed[index - 1]!.index),
  );
  const omissions = evidence.timingOmissions.filter((token) => {
    let low = 0,
      high = indexed.length;
    if (mapped) {
      while (low < high) {
        const middle = (low + high) >>> 1;
        if (indexed[middle]!.index < token.tokenIndex) low = middle + 1;
        else high = middle;
      }
    } else if (token.tokenIndex !== 0) return true;
    const previous = mapped ? indexed[low - 1]?.word : undefined;
    const next = mapped ? indexed[low]?.word : evidence.words[0];
    let start = previous?.endMs ?? 0;
    let end =
      next?.startMs ??
      (document.assets[evidence.sourceAssetId]?.durationSeconds ??
        window.endMs / 1000) * 1000;
    if (end < start) {
      start = Math.min(previous?.startMs ?? start, next?.startMs ?? start);
      end = Math.max(previous?.endMs ?? end, next?.endMs ?? end);
    }
    return start < window.endMs && end >= window.startMs;
  });
  if (!omissions.length) return undefined;
  return {
    count: omissions.length,
    examples: omissions
      .slice(0, 3)
      .map((token) => ({ ...token, text: token.text.slice(0, 160) })),
    omittedExamples: Math.max(0, omissions.length - 3),
  };
}
