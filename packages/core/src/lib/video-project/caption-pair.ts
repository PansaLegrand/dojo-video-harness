import { z } from "zod/v3";
import { captionSourceCommands } from "./semantic";
import {
  parseVideoProjectDocument,
  type VideoProjectDocument,
} from "./document";
import type { VideoProjectCommand } from "./commands";
const id = z.string().min(1).max(191);
export function normalizeCaptionLanguage(language: string) {
  const [first, ...tail] = language.toLowerCase().split("-");
  const aliases: Record<string, string> = {
    eng: "en",
    zho: "zh",
    chi: "zh",
    cmn: "zh",
    spa: "es",
    fra: "fr",
    fre: "fr",
    deu: "de",
    ger: "de",
    jpn: "ja",
    kor: "ko",
    ara: "ar",
    por: "pt",
    rus: "ru",
  };
  return [aliases[first!] ?? first, ...tail].join("-");
}
export const captionPairSchema = z
  .object({
    sourceItemId: id,
    evidenceId: id,
    originalItemId: id,
    translatedItemId: id,
    trackId: id,
    originalLanguage: z.string().regex(/^[a-z]{2,3}(?:-[A-Za-z0-9]{2,8})*$/),
    translatedLanguage: z.string().regex(/^[a-z]{2,3}(?:-[A-Za-z0-9]{2,8})*$/),
    originalColor: z.string().regex(/^#[a-f0-9]{6}$/i),
    translatedColor: z.string().regex(/^#[a-f0-9]{6}$/i),
    translations: z
      .array(
        z
          .object({ cueId: id, text: z.string().trim().min(1).max(1000) })
          .strict(),
      )
      .min(1)
      .max(500),
  })
  .strict();
/** Translation changes display text only. Cue IDs and timing come from the
 * source-bound host caption builder, never model-authored timestamps. */
export function prepareCaptionPair(
  inputDocument: VideoProjectDocument,
  raw: unknown,
) {
  const document = parseVideoProjectDocument(inputDocument),
    input = captionPairSchema.parse(raw);
  if (
    input.originalItemId === input.translatedItemId ||
    document.items.some((item) =>
      [input.originalItemId, input.translatedItemId].includes(item.id),
    )
  )
    throw new Error("Choose two distinct new caption item IDs.");
  const track = document.tracks.find((track) => track.id === input.trackId);
  if (!track || track.kind !== "visual" || track.locked || track.hidden)
    throw new Error("Choose an unlocked visible visual caption track.");
  const evidence = document.evidence[input.evidenceId];
  if (
    !evidence ||
    document.sources[evidence.sourceAssetId]?.revision !==
      evidence.sourceRevision ||
    (evidence.language &&
      normalizeCaptionLanguage(evidence.language).split("-")[0] !==
        normalizeCaptionLanguage(input.originalLanguage).split("-")[0])
  )
    throw new Error(
      "The original caption language/source must match the immutable transcript.",
    );
  const commands = captionSourceCommands(document, {
    sourceItemId: input.sourceItemId,
    evidenceId: input.evidenceId,
    itemId: input.originalItemId,
    trackId: input.trackId,
  });
  const original = commands.find(
    (command): command is Extract<VideoProjectCommand, { type: "addItem" }> =>
      command.type === "addItem",
  )!.item;
  const cues = original.caption!.cues;
  const translations = new Map(
    input.translations.map((cue) => [cue.cueId, cue.text]),
  );
  if (
    translations.size !== input.translations.length ||
    translations.size !== cues.length ||
    cues.some((cue) => !translations.has(cue.id))
  )
    throw new Error(
      `Provide exactly one translation for every host cue ID: ${cues.map((cue) => cue.id).join(", ")}.`,
    );
  const { width, height } = document.format;
  if (Math.min(width, height) < 240)
    throw new Error(
      "Bilingual captions require at least 240 pixels per dimension.",
    );
  const fontSize = Math.max(16, Math.round(Math.min(width, height) * 0.05));
  const style = {
    position: "absolute" as const,
    left: Math.round(width * 0.05),
    width: Math.round(width * 0.9),
    height: Math.round(height * 0.12),
    fontSize,
    minFontSize: 16,
    textFit: "shrink" as const,
    maxLines: 2,
    lineHeight: 1.15,
    textAlign: "center" as const,
    zIndex: 60,
  };
  original.node.style = {
    ...original.node.style,
    ...style,
    top: Math.round(height * 0.7),
    color: input.originalColor,
  };
  original.caption = {
    ...original.caption!,
    mode: "sentence",
    role: "original",
    language: normalizeCaptionLanguage(input.originalLanguage),
  };
  original.name = `Captions (${input.originalLanguage})`;
  const translated = structuredClone(original);
  translated.id = translated.node.id = input.translatedItemId;
  translated.name = `Captions (${input.translatedLanguage})`;
  translated.node.style = {
    ...translated.node.style,
    top: Math.round(height * 0.85),
    color: input.translatedColor,
  };
  translated.caption = {
    ...translated.caption!,
    role: "translation",
    language: normalizeCaptionLanguage(input.translatedLanguage),
    pairedItemId: input.originalItemId,
    cues: cues.map((cue) => ({
      id: cue.id,
      text: translations.get(cue.id)!,
      startMs: cue.startMs,
      endMs: cue.endMs,
    })),
  };
  return {
    commands: [
      ...commands,
      { type: "addItem" as const, item: translated },
      {
        type: "set" as const,
        target: { kind: "caption" as const, itemId: input.originalItemId },
        path: ["pairedItemId"],
        value: input.translatedItemId,
      },
    ],
    cues: cues.map(({ id, text, startMs, endMs }) => ({
      cueId: id,
      text,
      startMs,
      endMs,
    })),
    next: "Include all prepared commands unchanged in review_edit, together with the remaining requested outputs. Original evidence is unchanged.",
  };
}
