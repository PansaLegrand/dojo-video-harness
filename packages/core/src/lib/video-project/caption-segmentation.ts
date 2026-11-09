import { z } from "zod/v3";
import { completionCanonical, completionHash } from "@dojo-video/agent-kit";
import { captionCueSchema, type CaptionCue } from "@/lib/editor/document";
import { parseVideoProjectDocument, type VideoProjectDocument } from "./document";
import { videoProjectCommandsSchema, type VideoProjectCommand } from "./commands";
import { sourceWindow } from "./source-clock";

const id = z.string().min(1).max(191).refine(value => !["__proto__", "prototype", "constructor"].includes(value), "Choose a valid caption identity.");
const hash = z.string().regex(/^sha256:[a-f0-9]{64}$/);
const words = z.string().trim().min(1).max(10000);
const base = { itemId: id, cueId: id };
const inputSchema = z.discriminatedUnion("operation", [
  z.object({ ...base, operation: z.literal("merge") }).strict(),
  z.object({ ...base, operation: z.literal("split"), splitMs: z.number().finite().nonnegative(), newCueId: id,
    texts: z.record(z.object({ before: words, after: words }).strict()) }).strict(),
]);
export type CaptionSegmentationInput = z.input<typeof inputSchema>;
export const captionSegmentationReceiptSchema = z.object({ version: z.literal(1), kind: z.literal("caption-segmentation"), grouping: z.literal("manual-paired-v1"),
  operation: z.enum(["merge", "split"]), sourceItemId: id.nullable(), sourceRevision: id.nullable(), inputCueIds: z.array(id).min(1).max(2), outputCueIds: z.array(id).min(1).max(2),
  affectedItemIds: z.array(id).min(1).max(500), commandsHash: hash, sourceClockHash: hash }).strict();
export type CaptionSegmentationReceipt = z.infer<typeof captionSegmentationReceiptSchema>;
export type CaptionSegmentationPlan = { commands: VideoProjectCommand[]; receipt: CaptionSegmentationReceipt };
export class CaptionSegmentationConflict extends Error {
  readonly code = "CAPTION_SEGMENTATION_STALE";
  constructor(message = "The linked captions or source timing changed. Prepare this caption edit again.") { super(message); this.name = "CaptionSegmentationConflict"; }
}
type Item = VideoProjectDocument["items"][number];
function family(document: VideoProjectDocument, itemId: string): Item[] {
  const selected = document.items.find(item => item.id === itemId);
  if (!selected?.caption) throw new Error("Choose a caption track.");
  const root = selected.caption.role === "translation" ? document.items.find(item => item.id === selected.caption!.pairedItemId) : selected;
  if (!root?.caption || root.caption.role === "translation") throw new Error("Restore the original caption link before changing cue structure.");
  const translations = document.items.filter(item => item.id !== root.id && item.caption?.pairedItemId === root.id).sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
  if (translations.some(item => item.caption!.role !== "translation") || root.caption.pairedItemId && !translations.some(item => item.id === root.caption!.pairedItemId) || selected.id !== root.id && !translations.some(item => item.id === selected.id)) {
    throw new Error("Restore the original caption link before changing cue structure.");
  }
  const members = [root, ...translations];
  if (members.length > 500) throw new Error("A caption edit can update at most 500 linked tracks.");
  for (const item of members) {
    const track = document.tracks.find(track => track.id === item.trackId);
    if (!track || track.locked) throw new Error("Unlock every linked caption track before changing cue structure.");
    if (item.caption!.sourceItemId !== root.caption.sourceItemId || (item.node.from ?? 0) !== (root.node.from ?? 0) ||
      item.caption!.cues.length !== root.caption.cues.length || item.caption!.cues.some((cue, index) => {
        const original = root.caption!.cues[index];
        return cue.id !== original.id || Math.abs(cue.startMs - original.startMs) > .001 || Math.abs(cue.endMs - original.endMs) > .001;
      })) throw new Error("Align linked caption cue identities and timing before changing cue structure.");
  }
  return members;
}
export function captionSegmentationItems(document: VideoProjectDocument, itemId: string): Item[] {
  return family(parseVideoProjectDocument(document), itemId);
}
function clock(document: VideoProjectDocument, members: Item[]) {
  const sourceId = members[0].caption!.sourceItemId, source = sourceId ? document.items.find(item => item.id === sourceId) : undefined;
  if (sourceId && (!source || !["video", "audio"].includes(source.node.type) || source.node.loop)) throw new Error("The linked source clip is unavailable or looping.");
  return { fps: document.format.fps,
    source: source ? { itemId: source.id, assetId: source.node.assetId, revision: document.sources[source.node.assetId!]?.revision ?? null, window: sourceWindow(source, document.format.fps) } : null,
    captions: members.map(item => ({ id: item.id, trackId: item.trackId, from: item.node.from ?? 0, duration: item.node.duration,
      role: item.caption!.role, language: item.caption!.language, sourceItemId: item.caption!.sourceItemId, pairedItemId: item.caption!.pairedItemId, cues: item.caption!.cues })) };
}
/** Display joining preserves writing-system boundaries and supplied source words. */
export function joinCaptionDisplayText(left: string, right: string): string {
  const a = left.trim().replace(/\s+/gu, " "), b = right.trim().replace(/\s+/gu, " ");
  const cjk = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}，。！？；：、」』】》]$/u.test(a) && /^[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}]/u.test(b);
  const separator = !a || !b || /^[,.;:!?%…，。！？；：、)\]}»”’」』】》]/u.test(b) || /[(\[{«“‘「『【《]$/u.test(a) || cjk ? "" : " ";
  return a + separator + b;
}
function merge(first: CaptionCue, second: CaptionCue): CaptionCue {
  const { words: _words, ...retained } = first;
  const genuine = first.words?.length && second.words?.length ? [...first.words, ...second.words] : undefined;
  if (genuine && genuine.length > 500) throw new Error("The merged caption exceeds 500 timed words.");
  return captionCueSchema.parse({ ...retained, text: joinCaptionDisplayText(first.text, second.text), startMs: Math.min(first.startMs, second.startMs), endMs: Math.max(first.endMs, second.endMs), ...(genuine ? { words: genuine } : {}) });
}
function split(cue: CaptionCue, at: number, newCueId: string, text: { before: string; after: string }, translation: boolean): CaptionCue[] {
  if (at <= cue.startMs || at >= cue.endMs) throw new Error("Choose a split strictly inside this caption.");
  if (cue.words?.some(word => word.startMs < at && word.endMs > at)) throw new Error("Choose a split between complete timed words.");
  const partitions = [cue.words?.filter(word => word.endMs <= at), cue.words?.filter(word => word.startMs >= at)];
  const values = [text.before, text.after];
  let cursor = 0;
  const spans = cue.words?.map(word => { const start = cue.text.indexOf(word.text, cursor); if (start < 0) return null; cursor = start + word.text.length; return { start, end: cursor }; });
  return values.map((value, index) => {
    const words = partitions[index], first = words?.[0], last = words?.at(-1);
    const start = first ? spans?.[cue.words!.indexOf(first)] : undefined, end = last ? spans?.[cue.words!.indexOf(last)] : undefined;
    const exact = !translation && start && end && value.trim().replace(/\s+/gu, " ") === cue.text.slice(start.start, end.end).trim().replace(/\s+/gu, " ");
    return captionCueSchema.parse({ id: index === 0 ? cue.id : newCueId, text: value,
      startMs: index === 0 ? cue.startMs : at, endMs: index === 0 ? at : cue.endMs, ...(exact ? { words } : {}) });
  });
}
/** One command batch changes display segmentation in every linked language.
 * Immutable transcript evidence and all appearance/source properties are untouched. */
export async function prepareCaptionSegmentation(rawDocument: VideoProjectDocument, raw: CaptionSegmentationInput): Promise<CaptionSegmentationPlan> {
  const document = parseVideoProjectDocument(rawDocument), input = inputSchema.parse(raw), members = family(document, input.itemId);
  if (input.operation === "split") input.splitMs = Number(input.splitMs.toPrecision(15));
  const root = members[0], index = root.caption!.cues.findIndex(cue => cue.id === input.cueId);
  if (index < 0) throw new Error("The selected caption cue no longer exists.");
  const original = root.caption!.cues[index], next = root.caption!.cues[index + 1];
  if (input.operation === "merge" && !next) throw new Error("Choose a caption with a following cue.");
  if (input.operation === "split") {
    if (new Set(Object.keys(input.texts)).size !== members.length || members.some(item => !input.texts[item.id])) throw new Error("Provide both displayed text parts for every linked language.");
    if (members.some(item => item.caption!.cues.some(cue => cue.id === input.newCueId))) throw new Error("Choose a new cue identity for this split.");
    if (root.caption!.cues.length >= 5000) throw new Error("A caption track can contain up to 5,000 cues.");
  }
  const commands: VideoProjectCommand[] = members.map(item => {
    const cues = item.caption!.cues, replacement = input.operation === "merge" ? [merge(cues[index], cues[index + 1])] : split(cues[index], input.splitMs, input.newCueId, input.texts[item.id], item.caption!.role === "translation");
    return { type: "set", target: { kind: "caption", itemId: item.id }, path: ["cues"], value: [...cues.slice(0, index), ...replacement, ...cues.slice(index + (input.operation === "merge" ? 2 : 1))] };
  });
  const sourceId = root.caption!.sourceItemId ?? null, source = sourceId ? document.items.find(item => item.id === sourceId) : undefined;
  const receipt: CaptionSegmentationReceipt = { version: 1, kind: "caption-segmentation", grouping: "manual-paired-v1", operation: input.operation,
    sourceItemId: sourceId, sourceRevision: source?.node.assetId ? document.sources[source.node.assetId]?.revision ?? null : null,
    inputCueIds: input.operation === "merge" ? [original.id, next.id] : [original.id], outputCueIds: input.operation === "merge" ? [original.id] : [original.id, input.newCueId],
    affectedItemIds: members.map(item => item.id), commandsHash: await completionHash(commands), sourceClockHash: await completionHash(clock(document, members)) };
  return { commands, receipt };
}
/** Validate the entire receipt and exact command effect before persisting audit
 * metadata. Hash equality alone cannot authorize other fields or a forged edit. */
export async function validateCaptionSegmentationReceipt(rawDocument: VideoProjectDocument, rawCommands: readonly VideoProjectCommand[], rawReceipt: unknown): Promise<CaptionSegmentationReceipt> {
  const receipt = captionSegmentationReceiptSchema.parse(rawReceipt), commands = videoProjectCommandsSchema.parse(rawCommands);
  if (new Set(receipt.affectedItemIds).size !== receipt.affectedItemIds.length) throw new CaptionSegmentationConflict();
  const document = parseVideoProjectDocument(rawDocument), members = family(document, receipt.affectedItemIds[0]);
  if (completionCanonical(members.map(item => item.id)) !== completionCanonical(receipt.affectedItemIds) || await completionHash(clock(document, members)) !== receipt.sourceClockHash) throw new CaptionSegmentationConflict();
  let input: CaptionSegmentationInput;
  if (receipt.operation === "merge") input = { operation: "merge", itemId: members[0].id, cueId: receipt.inputCueIds[0] };
  else {
    const texts: Record<string, { before: string; after: string }> = {};
    let splitMs: number | undefined;
    for (const item of members) {
      const command = commands.find(command => command.type === "set" && command.target.kind === "caption" && command.target.itemId === item.id && command.path.length === 1 && command.path[0] === "cues");
      if (!command || command.type !== "set") throw new CaptionSegmentationConflict();
      const cues = z.array(captionCueSchema).max(5000).parse(command.value), first = cues.find(cue => cue.id === receipt.outputCueIds[0]), second = cues.find(cue => cue.id === receipt.outputCueIds[1]);
      if (!first || !second || first.endMs !== second.startMs || splitMs !== undefined && splitMs !== first.endMs) throw new CaptionSegmentationConflict();
      splitMs = first.endMs; texts[item.id] = { before: first.text, after: second.text };
    }
    input = { operation: "split", itemId: members[0].id, cueId: receipt.inputCueIds[0], splitMs: splitMs!, newCueId: receipt.outputCueIds[1], texts };
  }
  const expected = await prepareCaptionSegmentation(document, input);
  if (completionCanonical(expected.receipt) !== completionCanonical(receipt) || completionCanonical(expected.commands) !== completionCanonical(commands)) throw new CaptionSegmentationConflict();
  return receipt;
}
