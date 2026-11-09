import { normalizeAsrResult } from "@/lib/video-agent/transcript-normalizer";
import { editorCaptionPresets } from "@/lib/editor/caption-presets";
import { getEditorFontAssets } from "@/lib/editor/fonts";
import {
  canonicalSerialize,
  type VideoProjectDocument,
  type VideoTranscriptEvidence,
} from "./document";
import {
  projectSourceRange,
  resolveSpeechAnchor,
  sourceWindow,
} from "./source-clock";
import type { VideoProjectCommand } from "./commands";

export function requiresTranscript(instruction: string) {
  return /\b(captions?|subtitles?|transcri\w*|spoken|speech|says?|said|speaks?|fillers?|silences?|translate|translation)\b|字幕|口播|说到|说出|说的|台词|转录|翻译|停顿|口癖|静音片段/i.test(
    instruction,
  );
}
export function needsSourceTranscript(
  document: VideoProjectDocument,
  instruction: string,
  selectedItemIds: string[],
) {
  if (!requiresTranscript(instruction)) return false;
  const targets = document.items.filter(
    (item) =>
      item.caption &&
      (!selectedItemIds.length || selectedItemIds.includes(item.id)),
  );
  // Existing editable caption text/timing is sufficient for styling or translating those captions.
  return (
    !targets.length ||
    /\b(spoken|speech|says?|said|fillers?|silences?|transcri\w*|regenerate)\b|说到|说出|口癖|停顿|重新识别|转录/i.test(
      instruction,
    )
  );
}
export function semanticSourceItems(
  document: VideoProjectDocument,
  selectedItemIds: string[],
) {
  const selected = new Set(selectedItemIds);
  for (const item of document.items.filter((item) => selected.has(item.id))) {
    if (item.caption?.sourceItemId) selected.add(item.caption.sourceItemId);
    if (item.visualizerSourceItemId) selected.add(item.visualizerSourceItemId);
    for (const binding of Object.values(document.bindings).filter(
      (binding) => binding.itemId === item.id,
    ))
      selected.add(binding.sourceItemId);
  }
  return document.items.filter(
    (item) =>
      ["video", "audio"].includes(item.node.type) &&
      (!selected.size || selected.has(item.id)),
  );
}
export async function semanticDigest(value: unknown) {
  const bytes = new TextEncoder().encode(canonicalSerialize(value));
  return `sha256:${[...new Uint8Array(await crypto.subtle.digest("SHA-256", bytes))].map((n) => n.toString(16).padStart(2, "0")).join("")}`;
}

/** Evidence carries immutable source timing. No model-generated timing enters this path. */
export async function transcriptEvidenceFromAsr(
  document: VideoProjectDocument,
  assetId: string,
  raw: unknown,
  asrTaskId?: string,
): Promise<VideoTranscriptEvidence> {
  const source = document.sources[assetId];
  if (!source) throw new Error("This media source has no immutable revision.");
  const transcript = normalizeAsrResult(assetId, raw);
  if (!transcript?.words.length)
    throw new Error(
      "No timestamped speech was found. Speech edits need real word timestamps.",
    );
  const hash = await semanticDigest(raw);
  const identityHash = await semanticDigest({
    sourceRevision: source.revision,
    assetId,
    transcriptHash: hash,
    asrTaskId: asrTaskId ?? null,
  });
  let cursor = 0;
  const words = transcript.words.map((word, index) => {
    const at = transcript.text
      .toLocaleLowerCase()
      .indexOf(word.text.toLocaleLowerCase(), cursor);
    const text =
      at < 0 ? word.text : transcript.text.slice(at, at + word.text.length);
    if (at >= 0) cursor = at + word.text.length;
    return {
      id: `w:${hash.slice(7, 23)}:${index}`,
      text,
      startMs: word.startMs,
      endMs: word.endMs,
    };
  });
  return {
    id: `transcript:${identityHash.slice(7, 39)}`,
    sourceAssetId: assetId,
    sourceRevision: source.revision,
    transcriptHash: hash,
    language: transcript.language ?? undefined,
    text: transcript.text,
    words,
    ...(asrTaskId ? { asrTaskId } : {}),
  };
}

function wordsText(
  evidence: VideoTranscriptEvidence,
  words: VideoTranscriptEvidence["words"],
) {
  const first = evidence.words.findIndex((word) => word.id === words[0]?.id);
  let cursor = 0,
    start = -1,
    end = -1;
  for (let index = 0; index < first + words.length; index++) {
    const word = evidence.words[index]!;
    const at = evidence.text.indexOf(word.text, cursor);
    if (at < 0) return words.map((word) => word.text).join(" ");
    if (index === first) start = at;
    cursor = at + word.text.length;
    if (index === first + words.length - 1) end = cursor;
  }
  return start >= 0 && end > start
    ? evidence.text.slice(start, end)
    : words.map((word) => word.text).join(" ");
}

export function captionSourceCommands(
  document: VideoProjectDocument,
  input: {
    sourceItemId: string;
    evidenceId: string;
    itemId: string;
    trackId: string;
    preset?: string;
  },
): VideoProjectCommand[] {
  const source = document.items.find((item) => item.id === input.sourceItemId);
  const evidence = document.evidence[input.evidenceId];
  if (!source || !evidence || source.node.assetId !== evidence.sourceAssetId)
    throw new Error("Select a clip and its source transcript.");
  const preset = editorCaptionPresets[input.preset ?? "classic"];
  if (!preset) throw new Error("Unknown caption treatment.");
  const window = sourceWindow(source, document.format.fps);
  const words = evidence.words.filter(
    (word) => word.endMs > window.startMs && word.startMs < window.endMs,
  );
  if (!words.length)
    throw new Error(
      "The selected source window contains no timestamped speech.",
    );
  const groups: (typeof words)[] = [];
  let current: typeof words = [];
  for (const word of words) {
    if (
      current.length &&
      (wordsText(evidence, [...current, word]).length > 80 ||
        word.endMs - current[0]!.startMs > 4000)
    ) {
      groups.push(current);
      current = [];
    }
    current.push(word);
    if (/[.!?。！？]$/.test(word.text)) {
      groups.push(current);
      current = [];
    }
  }
  if (current.length) groups.push(current);
  const cues = groups.flatMap((group, index) => {
    const projected = projectSourceRange(
      source,
      document.format.fps,
      group[0]!.startMs,
      group[group.length - 1]!.endMs,
    );
    if (!projected) return [];
    const startMs =
      ((projected.from - window.from) * 1000) / document.format.fps;
    return [
      {
        id: `cue:${index}`,
        text: wordsText(evidence, group),
        startMs,
        endMs: startMs + (projected.duration * 1000) / document.format.fps,
        words: group.map((word) => ({
          text: word.text,
          startMs: Math.max(0, (word.startMs - window.startMs) / window.rate),
          endMs: Math.min(
            (source.node.duration! * 1000) / document.format.fps,
            (word.endMs - window.startMs) / window.rate,
          ),
        })),
      },
    ];
  });
  const fontCommands: VideoProjectCommand[] = getEditorFontAssets(
    String(preset.style.fontFamily ?? "Inter"),
  )
    .filter((asset) => !document.assets[asset.id])
    .map((asset) => ({ type: "addAsset", asset }));
  return [
    ...fontCommands,
    {
      type: "addItem",
      item: {
        id: input.itemId,
        trackId: input.trackId,
        name: "Captions",
        node: {
          id: input.itemId,
          type: "div",
          from: source.node.from,
          duration: source.node.duration,
          style: {
            ...preset.style,
            position: "absolute",
            left: Math.round(document.format.width * 0.05),
            top: Math.round(document.format.height * 0.73),
            width: Math.round(document.format.width * 0.9),
            height: Math.round(document.format.height * 0.22),
            zIndex: 60,
          },
        },
        caption: {
          cues,
          mode: preset.mode,
          highlightColor: preset.highlightColor,
          highlightStyle: preset.highlightStyle,
          motion: preset.motion,
          direction: /^(ar|fa|he|ur)/i.test(evidence.language ?? "")
            ? "rtl"
            : "ltr",
          sourceItemId: source.id,
          language: evidence.language,
          role: "original",
        },
      },
    },
  ];
}

export function speechBindingCommand(
  document: VideoProjectDocument,
  input: {
    id: string;
    itemId: string;
    sourceItemId: string;
    evidenceId: string;
    wordIds: string[];
    holdMs?: number;
  },
): VideoProjectCommand {
  const { id, itemId, sourceItemId, evidenceId, wordIds, holdMs } = input;
  return {
    type: "bindSource",
    binding: resolveSpeechAnchor(document, {
      id,
      itemId,
      sourceItemId,
      evidenceId,
      wordIds,
      ...(holdMs === undefined ? {} : { holdMs }),
    }),
  };
}

/** Speech cut proposals name words; the host owns source/frame conversion and ripple effects. */
export function speechCutCommands(
  document: VideoProjectDocument,
  input: {
    sourceItemId: string;
    evidenceId: string;
    wordIds: string[];
    mode: "remove" | "keep";
  },
): VideoProjectCommand[] {
  const source = document.items.find((item) => item.id === input.sourceItemId);
  const evidence = document.evidence[input.evidenceId];
  if (!source || !evidence || source.node.assetId !== evidence.sourceAssetId)
    throw new Error("Speech cuts require the selected clip's own transcript.");
  const binding = resolveSpeechAnchor(document, {
    id: "cut",
    itemId: source.id,
    ...input,
  });
  const range = projectSourceRange(
    source,
    document.format.fps,
    binding.sourceStartMs,
    binding.sourceEndMs,
  );
  if (!range)
    throw new Error(
      "The selected speech has already been removed from this clip.",
    );
  if (input.mode === "remove")
    return [
      {
        type: "removeTimelineRange",
        from: range.from,
        duration: range.duration,
      },
    ];
  const end = (source.node.from ?? 0) + source.node.duration!;
  const commands: VideoProjectCommand[] = [];
  if (range.from + range.duration < end)
    commands.push({
      type: "removeTimelineRange",
      from: range.from + range.duration,
      duration: end - range.from - range.duration,
    });
  if (range.from > (source.node.from ?? 0))
    commands.push({
      type: "removeTimelineRange",
      from: source.node.from ?? 0,
      duration: range.from - (source.node.from ?? 0),
    });
  if (!commands.length)
    throw new Error("This clip already contains only the selected speech.");
  return commands;
}
