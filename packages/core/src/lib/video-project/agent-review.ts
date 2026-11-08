import {
  canonicalSerialize,
  hashVideoProjectDocument,
  parseVideoProjectDocument,
  type VideoProjectDocument,
} from "./document";
import {
  executeVideoProjectCommands,
  rebaseVideoProjectCommands,
} from "./commands";
import { generatedTrackCommands } from "./agent-tracks";
import type { VideoProjectAgentProposal } from "./agent-types";
import type { VideoProjectSnapshot } from "./types";
import type {
  NativeAffectedRange,
  NativeReviewBasis,
  NativeReviewDetails,
} from "./agent-authoring";

export class NativeReviewConflict extends Error {
  readonly code = "NATIVE_REVIEW_STALE";
  constructor(
    message = "The project changed after this comparison was prepared. Refresh the comparison before applying.",
  ) {
    super(message);
    this.name = "NativeReviewConflict";
  }
}
const equal = (left: unknown, right: unknown) =>
  canonicalSerialize(left) === canonicalSerialize(right);
const span = (item: VideoProjectDocument["items"][number] | undefined) =>
  item ? { from: item.node.from ?? 0, duration: item.node.duration! } : null;
async function digest(value: unknown): Promise<string> {
  const bytes = new TextEncoder().encode(canonicalSerialize(value));
  return (
    "sha256:" +
    [...new Uint8Array(await crypto.subtle.digest("SHA-256", bytes))]
      .map((value) => value.toString(16).padStart(2, "0"))
      .join("")
  );
}

/** Composition records affect their endpoints/members even when native node properties stay identical. */
export function nativeChangedItemIds(
  before: VideoProjectDocument,
  after: VideoProjectDocument,
  initial: readonly string[],
): string[] {
  const changed = new Set(initial);
  for (const category of ["transitions", "linkedGroups"] as const) {
    const oldRecords = before[category] ?? {},
      newRecords = after[category] ?? {};
    for (const id of [
      ...new Set([...Object.keys(oldRecords), ...Object.keys(newRecords)]),
    ].sort()) {
      if (equal(oldRecords[id], newRecords[id])) continue;
      for (const record of [oldRecords[id], newRecords[id]]) {
        if (!record) continue;
        if ("itemIds" in record)
          record.itemIds.forEach((id) => changed.add(id));
        else {
          changed.add(record.fromItemId);
          changed.add(record.toItemId);
        }
      }
    }
  }
  return [...changed];
}

/** Derived from checked documents; model prose never decides what changed. */
export function describeNativeAffectedRanges(
  before: VideoProjectDocument,
  after: VideoProjectDocument,
  changedItemIds: readonly string[],
  propagatedItemIds: readonly string[] = [],
) {
  const oldItems = new Map(before.items.map((item) => [item.id, item])),
    newItems = new Map(after.items.map((item) => [item.id, item]));
  const unique = nativeChangedItemIds(before, after, changedItemIds);
  const affected: NativeAffectedRange[] = unique
    .slice(0, 100)
    .map((itemId) => ({
      itemId,
      name: (
        newItems.get(itemId)?.name ??
        oldItems.get(itemId)?.name ??
        "Item"
      ).slice(0, 500),
      before: span(oldItems.get(itemId)),
      after: span(newItems.get(itemId)),
      propagated: propagatedItemIds.includes(itemId),
    }));
  const times = affected.flatMap((item) =>
    [
      item.before ? (item.before.from * 1000) / before.format.fps : null,
      item.after ? (item.after.from * 1000) / after.format.fps : null,
    ].filter((value): value is number => value !== null),
  );
  const transitionTimes: number[] = [];
  for (const id of [
    ...new Set([
      ...Object.keys(before.transitions ?? {}),
      ...Object.keys(after.transitions ?? {}),
    ]),
  ].sort()) {
    if (equal(before.transitions?.[id], after.transitions?.[id])) continue;
    const document = after.transitions?.[id] ? after : before,
      transition = document.transitions![id]!;
    const next = document.items.find((item) => item.id === transition.toItemId);
    if (next)
      transitionTimes.push(
        ((next.node.from ?? 0) * 1000) / document.format.fps,
      );
  }
  return {
    affected,
    omittedAffectedCount: Math.max(0, unique.length - affected.length),
    focusTimeMs: transitionTimes.length
      ? Math.min(...transitionTimes)
      : times.length
        ? Math.min(...times)
        : 0,
  };
}

export async function nativeProposalHash(
  runId: string,
  baseHash: string,
  proposal: VideoProjectAgentProposal,
): Promise<string> {
  return digest({
    runId,
    baseHash,
    commands: proposal.commands,
    previewHash: proposal.previewHash,
    propagatedItemIds: proposal.propagatedItemIds ?? [],
  });
}

/** Explicit review is a pure, revision-pinned dry run; it performs no writes or provider calls. */
export async function prepareNativeAgentReview(input: {
  runId: string;
  baseDocument: VideoProjectDocument;
  baseHash: string;
  proposal: VideoProjectAgentProposal;
  current: VideoProjectSnapshot;
  organizeTracks?: boolean;
}): Promise<{
  review: NativeReviewDetails;
  beforeDocument: VideoProjectDocument;
  afterDocument: VideoProjectDocument;
}> {
  const base = parseVideoProjectDocument(input.baseDocument),
    current = parseVideoProjectDocument(input.current.document);
  if (
    (await hashVideoProjectDocument(base)) !== input.baseHash ||
    (await hashVideoProjectDocument(current)) !== input.current.documentHash
  )
    throw new NativeReviewConflict(
      "The comparison snapshot failed its integrity check.",
    );
  const rebased = rebaseVideoProjectCommands(
    base,
    current,
    input.proposal.commands,
  );
  if (!rebased.ok) throw new NativeReviewConflict(rebased.reason);
  const placement =
    input.organizeTracks === false
      ? []
      : generatedTrackCommands(current, rebased.document);
  const commands = [...rebased.commands, ...placement];
  const result = placement.length
    ? executeVideoProjectCommands(current, commands)
    : rebased;
  const propagatedItemIds = input.proposal.propagatedItemIds ?? [];
  const basis: NativeReviewBasis = {
    baseRevision: input.current.revision,
    baseHash: input.current.documentHash,
    proposalHash: await nativeProposalHash(
      input.runId,
      input.baseHash,
      input.proposal,
    ),
    afterHash: await hashVideoProjectDocument(result.document),
  };
  return {
    beforeDocument: current,
    afterDocument: result.document,
    review: {
      basis,
      commands,
      impact: propagatedItemIds.length ? "review" : result.impact,
      ...describeNativeAffectedRanges(
        current,
        result.document,
        result.changedItemIds,
        propagatedItemIds,
      ),
      changedItemIds: nativeChangedItemIds(
        current,
        result.document,
        result.changedItemIds,
      ),
      propagatedItemIds,
      before: {
        fps: current.format.fps,
        durationInFrames: current.format.durationInFrames,
      },
      after: {
        fps: result.document.format.fps,
        durationInFrames: result.document.format.durationInFrames,
      },
    },
  };
}

export function assertNativeReviewBasis(
  expected: NativeReviewBasis,
  received: NativeReviewBasis,
): void {
  if (!equal(expected, received)) throw new NativeReviewConflict();
}
