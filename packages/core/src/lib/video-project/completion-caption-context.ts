import type { VideoProjectDocument } from "./document";
import { captionTimingDiagnostics } from "./caption-source-range";
import { captionSourceCommands } from "./semantic";
import { normalizeCaptionLanguage } from "./caption-pair";
/** Exact, bounded new-profile cue manifest. Legacy grouping/prompt stays intact. */
export function prepareCompletionCaptionCuePacket(
  document: VideoProjectDocument,
  sourceItemIds?: readonly string[],
  options: { pagedReaders?: boolean } = {},
) {
  const selected =
    sourceItemIds === undefined ? undefined : new Set(sourceItemIds);
  const candidates = document.items.filter(
    (item) =>
      ["audio", "video"].includes(item.node.type) &&
      (!selected || selected.has(item.id)),
  );
  const sources: Array<{
    sourceItemId: string;
    evidenceId: string;
    language?: string;
    cueCount: number;
    complete: boolean;
    issue?: string;
    timingOmissions?: ReturnType<typeof captionTimingDiagnostics>;
    cuesComplete?: boolean;
    cues: Array<{
      cueId: string;
      text: string;
      startMs: number;
      endMs: number;
    }>;
  }> = [];
  let totalCues = 0,
    omittedSources = Math.max(0, candidates.length - 12);
  const packet = () => ({
    version: 1 as const,
    grouping: "phrase-safe-v1",
    instruction: options.pagedReaders
      ? "Use these exact initial cue IDs/text/times. For complete source coverage beyond this packet, use read_caption_cues and follow coverage.nextCursor. list_assets discovers all owned imported assets. Preserve every retrieved cue and genuine word ID."
      : "Use THESE exact cue IDs/text/times with prepare_caption_pair; this new-profile manifest supersedes legacy contextPlan.captionSources grouping. If incomplete, inspect a specific source or ask to narrow; never invent/omit cues.",
    complete:
      omittedSources === 0 && sources.every((source) => source.complete),
    omittedSources,
    sources,
  });
  const bytes = () =>
    new TextEncoder().encode(JSON.stringify(packet())).byteLength;
  for (const source of candidates.slice(0, 12)) {
    const evidence = Object.values(document.evidence).find(
      (e) =>
        e.sourceAssetId === source.node.assetId &&
        e.sourceRevision === document.sources[e.sourceAssetId]?.revision,
    );
    if (!evidence) {
      omittedSources++;
      continue;
    }
    const timingOmissions = options.pagedReaders
      ? captionTimingDiagnostics(document, source.id, evidence)
      : undefined;
    const entry: (typeof sources)[number] = {
      sourceItemId: source.id,
      evidenceId: evidence.id,
      ...(evidence.language
        ? { language: normalizeCaptionLanguage(evidence.language) }
        : {}),
      cueCount: 0,
      complete: false,
      cues: [],
      ...(timingOmissions ? { timingOmissions } : {}),
    };
    sources.push(entry);
    // Reserve room for final complete/omitted flags. Metadata itself is bounded.
    if (bytes() > 31936) {
      sources.pop();
      omittedSources++;
      continue;
    }
    try {
      const command = captionSourceCommands(document, {
        sourceItemId: source.id,
        evidenceId: evidence.id,
        itemId: "completion-cue-manifest",
        trackId:
          document.tracks.find((track) => track.kind === "visual")?.id ??
          "completion-manifest-track",
        phraseSafe: true,
      }).find((command) => command.type === "addItem");
      if (command?.type !== "addItem")
        throw new Error("No source cues available.");
      const all = command.item.caption!.cues;
      entry.cueCount = all.length;
      for (const cue of all) {
        if (totalCues >= 200) break;
        entry.cues.push({
          cueId: cue.id,
          text: cue.text,
          startMs: cue.startMs,
          endMs: cue.endMs,
        });
        if (bytes() > 31936) {
          entry.cues.pop();
          break;
        }
        totalCues++;
      }
      entry.complete = entry.cues.length === all.length && !timingOmissions;
      if (timingOmissions)
        entry.cuesComplete = entry.cues.length === all.length;
    } catch (error) {
      entry.issue = (
        error instanceof Error ? error.message : "Source cue preparation failed"
      ).slice(0, 160);
      if (bytes() > 31936) delete entry.issue;
    }
  }
  const result = packet();
  if (new TextEncoder().encode(JSON.stringify(result)).byteLength > 32000)
    throw new Error("Caption cue packet exceeds its byte budget.");
  return result;
}
