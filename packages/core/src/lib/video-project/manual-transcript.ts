import type { VideoProjectDocument } from "./document";
import { executeVideoProjectCommands } from "./commands";
import { speechCutCommands } from "./semantic";
import { projectSourceRange, sourceWindow } from "./source-clock";

/** Caption corrections never replace these immutable, source-bound words. */
export function manualTranscriptSources(document: VideoProjectDocument) {
  const byAsset = new Map<string, VideoProjectDocument["evidence"][string]>();
  for (const evidence of Object.values(document.evidence)) {
    if (
      !byAsset.has(evidence.sourceAssetId) &&
      evidence.words.length &&
      evidence.sourceRevision ===
        document.sources[evidence.sourceAssetId]?.revision
    )
      byAsset.set(evidence.sourceAssetId, evidence);
  }
  return document.items.flatMap((item) => {
    if (
      !["video", "audio"].includes(item.node.type) ||
      !item.node.assetId ||
      item.node.loop ||
      item.node.videoEndBehavior === "loop" ||
      (item.node.playbackRate ?? 1) <= 0
    )
      return [];
    const window = sourceWindow(item, document.format.fps);
    const evidence = byAsset.get(item.node.assetId);
    if (!evidence) return [];
    let lo = 0,
      hi = evidence.words.length;
    while (lo < hi) {
      const middle = (lo + hi) >>> 1;
      if (evidence.words[middle]!.startMs < window.startMs - 0.001)
        lo = middle + 1;
      else hi = middle;
    }
    const words: typeof evidence.words = [];
    for (
      let index = lo;
      index < evidence.words.length &&
      evidence.words[index]!.startMs < window.endMs;
      index++
    ) {
      const word = evidence.words[index]!;
      if (word.endMs <= window.endMs + 0.001) words.push(word);
    }
    return words.length ? [{ item, evidenceId: evidence.id, words }] : [];
  });
}
export function manualSpeechRemoval(
  document: VideoProjectDocument,
  sourceItemId: string,
  evidenceId: string,
  wordIds: string[],
) {
  if (!wordIds.length || wordIds.length > 500)
    throw new Error("Choose between one and 500 source words.");
  const source = manualTranscriptSources(document).find(
    (source) =>
      source.item.id === sourceItemId && source.evidenceId === evidenceId,
  );
  const available = new Set(source?.words.map((word) => word.id));
  if (!source || wordIds.some((id) => !available.has(id)))
    throw new Error(
      "The selected words no longer belong to this clip. Select them again.",
    );
  const commands = speechCutCommands(document, {
    sourceItemId,
    evidenceId,
    wordIds,
    mode: "remove",
  });
  // Validate locks, linked layers, split IDs and the complete ripple before the
  // UI enables the edit. Dispatch performs the same atomic validation again.
  executeVideoProjectCommands(document, commands);
  const first = source.words.find((word) => word.id === wordIds[0])!,
    last = source.words.find((word) => word.id === wordIds.at(-1))!;
  const range = projectSourceRange(
    source.item,
    document.format.fps,
    first.startMs,
    last.endMs,
  )!;
  return { commands, range, seconds: range.duration / document.format.fps };
}
