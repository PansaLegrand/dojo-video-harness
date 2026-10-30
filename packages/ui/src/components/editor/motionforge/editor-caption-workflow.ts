import type {
  CaptionCue,
  EditorDocument,
  EditorItem,
} from "@/lib/editor/document";
import type { EditorCommand } from "@/lib/editor/commands";
import { estimateCaptionWords } from "@/lib/editor/caption-words";
import { getEditorFontAssets, editorFontWeights } from "@/lib/editor/fonts";
import {
  editorCaptionPresets,
  staticEditorCaptionPreset,
} from "./editor-caption-presets";

export type CaptionSetupOptions = {
  language: string;
  translationLanguage?: string;
  preset: string;
  translationPreset?: string;
  cloudConsent: boolean;
};
export type CaptionPhase =
  | "preparing"
  | "uploading"
  | "transcribing"
  | "styling"
  | "translating"
  | "saving"
  | "complete"
  | "error"
  | "ready";
export type CaptionProgress = {
  phase: CaptionPhase;
  sourceName: string;
  percent?: number;
  message?: string;
  resultIds?: string[];
  translation?: boolean;
  translationOnly?: boolean;
};
export const captionLanguages = [
  "en",
  "zh",
  "ja",
  "ko",
  "es",
  "fr",
  "de",
  "it",
  "pt",
  "ar",
  "hi",
  "ru",
  "he",
  "fa",
  "ur",
];
export function captionLanguageLabel(
  language: string | undefined,
  locale: string,
): string | null {
  if (!language || ["auto", "und"].includes(language)) return null;
  try {
    return (
      new Intl.DisplayNames([locale], { type: "language" }).of(language) ??
      language
    );
  } catch {
    return language;
  }
}
export function captionRelations(
  items: EditorItem[],
  item: EditorItem,
): EditorItem[] {
  return items.filter(
    (candidate) =>
      candidate.id !== item.id &&
      !!candidate.caption &&
      (candidate.id === item.caption?.pairedItemId ||
        candidate.caption?.pairedItemId === item.id),
  );
}
export function captionGroups(items: EditorItem[]) {
  const captions = items.filter((item) => !!item.caption);
  const groups = new Map<
    string,
    { original: EditorItem; translations: EditorItem[] }
  >();
  for (const item of captions) {
    let root = item;
    const visited = new Set<string>();
    while (
      root.caption?.role === "translation" &&
      root.caption.pairedItemId &&
      !visited.has(root.id)
    ) {
      visited.add(root.id);
      const parent = captions.find(
        (candidate) => candidate.id === root.caption!.pairedItemId,
      );
      if (!parent || visited.has(parent.id)) break;
      root = parent;
    }
    const group = groups.get(root.id) ?? { original: root, translations: [] };
    if (
      root.id !== item.id &&
      !group.translations.some((candidate) => candidate.id === item.id)
    )
      group.translations.push(item);
    groups.set(root.id, group);
  }
  return [...groups.values()];
}

export function buildCaptionTrack(
  document: EditorDocument,
  input: {
    id: string;
    trackId: string;
    cues: CaptionCue[];
    from: number;
    name: string;
    language?: string;
    sourceItemId?: string;
    paired?: EditorItem;
    preset?: string;
  },
): { item: EditorItem; commands: EditorCommand[] } {
  const preset = input.paired
    ? editorCaptionPresets[staticEditorCaptionPreset(input.preset)]
    : input.preset
      ? editorCaptionPresets[input.preset]
      : undefined;
  const rtl = /^(ar|he|fa|ur)(-|$)/i.test(input.language ?? "");
  const family = rtl
    ? "Noto Sans Arabic"
    : (preset?.style.fontFamily ??
      input.paired?.node.style?.fontFamily ??
      "Inter");
  const style = {
    position: "absolute" as const,
    left: Math.round(document.format.width * 0.1),
    top: Math.round(document.format.height * (input.paired ? 0.64 : 0.8)),
    width: Math.round(document.format.width * 0.8),
    height: Math.round(document.format.height * 0.15),
    fontSize: Math.round(document.format.height / 22),
    fontWeight: 700,
    color: "#ffffff",
    textAlign: "center" as const,
    textStroke: "2px #000000",
    ...input.paired?.node.style,
    ...preset?.style,
    ...(input.paired ? { top: Math.round(document.format.height * 0.64) } : {}),
    fontFamily: family,
  };
  if (!editorFontWeights(family).includes(Number(style.fontWeight)))
    style.fontWeight = editorFontWeights(family).at(-1) ?? 400;
  const item: EditorItem = {
    id: input.id,
    trackId: input.trackId,
    name: input.name,
    caption: {
      cues: input.paired
        ? input.cues.map(({ words: _words, ...cue }) => cue)
        : input.cues,
      mode: input.paired ? "sentence" : (preset?.mode ?? "karaoke"),
      highlightColor:
        preset?.highlightColor ??
        input.paired?.caption?.highlightColor ??
        "#facc15",
      highlightStyle: input.paired ? undefined : preset?.highlightStyle,
      motion: input.paired ? undefined : preset?.motion,
      direction: rtl ? "rtl" : "ltr",
      role: input.paired ? "translation" : "original",
      language:
        input.language && input.language !== "auto"
          ? input.language
          : undefined,
      sourceItemId: input.paired?.caption?.sourceItemId ?? input.sourceItemId,
      pairedItemId: input.paired?.id,
    },
    node: {
      id: input.id,
      type: "div",
      from: input.from,
      duration: Math.max(
        1,
        Math.ceil(
          (Math.max(1, ...input.cues.map((cue) => cue.endMs)) *
            document.format.fps) /
            1000,
        ),
      ),
      animations: [],
      children: [],
      style,
    },
  };
  const commands: EditorCommand[] = getEditorFontAssets(family)
    .filter((asset) => !document.assets[asset.id])
    .map((asset) => ({ type: "addAsset", asset }));
  if (!document.tracks.some((track) => track.id === input.trackId))
    commands.push({
      type: "addTrack",
      track: {
        id: input.trackId,
        name: input.name,
        kind: "visual",
        muted: false,
        hidden: false,
        locked: false,
      },
    });
  commands.push({ type: "addItem", item });
  // Reverse links support multiple target languages; retain the established primary pair.
  if (
    input.paired?.caption &&
    input.paired.caption.role !== "translation" &&
    !document.tracks.find((track) => track.id === input.paired!.trackId)
      ?.locked &&
    !document.items.some(
      (candidate) => candidate.id === input.paired!.caption!.pairedItemId,
    )
  ) {
    commands.push({
      type: "updateItem",
      id: input.paired.id,
      patch: {
        caption: {
          ...input.paired.caption,
          pairedItemId: input.id,
          role: input.paired.caption.role ?? "original",
        },
      },
    });
  }
  return { item, commands };
}

export function editCaptionWord(
  cue: CaptionCue,
  index: number,
  text: string,
): CaptionCue {
  if (!cue.words?.[index] || !text.trim()) return cue;
  let cursor = 0;
  const spans = cue.words.map((word) => {
    const start = cue.text.indexOf(word.text, cursor);
    if (start < 0) return null;
    cursor = start + word.text.length;
    return { start, end: cursor };
  });
  const span = spans[index];
  if (!span || spans.some((value) => !value)) return cue;
  const value = text.trim();
  return {
    ...cue,
    text: cue.text.slice(0, span.start) + value + cue.text.slice(span.end),
    words: cue.words.map((word, at) =>
      at === index ? { ...word, text: value } : word,
    ),
  };
}
export function editCaptionText(cue: CaptionCue, text: string): CaptionCue {
  if (text === cue.text) return cue;
  const tokens = text.trim().split(/\s+/u);
  const old = cue.text.trim().split(/\s+/u);
  const canPreserve =
    cue.words?.length === tokens.length &&
    old.length === tokens.length &&
    cue.words?.every((word, index) => word.text === old[index]);
  return {
    ...cue,
    text,
    words: canPreserve
      ? cue.words!.map((word, index) => ({ ...word, text: tokens[index]! }))
      : undefined,
  };
}
/** Merge adjacent display cues without retiming their supplied source words. */
export function mergeCaptionWithNext(
  cues: CaptionCue[],
  cueId: string,
  language?: string,
): CaptionCue[] {
  const index = cues.findIndex((cue) => cue.id === cueId);
  if (index < 0 || index === cues.length - 1) return cues;
  const first = cues[index];
  const next = cues[index + 1];
  const singleLine = (text: string) => text.trim().replace(/\s+/gu, " ");
  const left = singleLine(first.text);
  const right = singleLine(next.text);
  const cjkBoundary =
    /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}，。！？；：、」』】》]$/u.test(
      left,
    ) && /^[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}]/u.test(right);
  const separator =
    !left ||
    !right ||
    /^[,.;:!?%…，。！？；：、)\]}»”’」』】》]/u.test(right) ||
    /[(\[{«“‘「『【《]$/u.test(left) ||
    cjkBoundary
      ? ""
      : " ";
  const hasWords = Boolean(first.words?.length || next.words?.length);
  const words = (cue: CaptionCue) =>
    cue.words?.length
      ? cue.words.map((word) => {
          const text = singleLine(word.text);
          return text === word.text ? word : { ...word, text };
        })
      : estimateCaptionWords(
          singleLine(cue.text),
          cue.startMs,
          cue.endMs,
          language,
        );
  const { words: _firstWords, ...retained } = first;
  const merged: CaptionCue = {
    ...retained,
    text: left + separator + right,
    startMs: Math.min(first.startMs, next.startMs),
    endMs: Math.max(first.endMs, next.endMs),
    ...(hasWords ? { words: [...words(first), ...words(next)] } : {}),
  };
  return [...cues.slice(0, index), merged, ...cues.slice(index + 2)];
}
/** Keep translation cue identity and follow subsequent timing-only edits of the source captions. */
export function alignTranslatedCues(
  cues: CaptionCue[],
  before: EditorItem,
  current: EditorItem,
): CaptionCue[] {
  if (!before.caption || !current.caption)
    throw new Error("The source captions are no longer available.");
  const result: CaptionCue[] = [];
  for (const cue of current.caption.cues) {
    const index = before.caption.cues.findIndex((old) => old.id === cue.id);
    if (index < 0 || before.caption.cues[index].text !== cue.text)
      throw new Error(
        "The source caption text changed during translation. The translated result is preserved for download.",
      );
    if (cues[index])
      result.push({
        ...cues[index],
        id: cue.id,
        startMs: cue.startMs,
        endMs: cue.endMs,
        words: undefined,
      });
  }
  if (!result.length)
    throw new Error(
      "The source captions were removed during translation. The translated result is preserved for download.",
    );
  return result;
}
