import { editorTimelineTracks } from "@/lib/editor/timeline-tracks";
import type { VideoProjectDocument } from "./document";
import type { VideoProjectCommand } from "./commands";

export type SelectionAction = "move" | "delete" | "duplicate";
export const selectionMessages = {
  missing: "The selection contains a clip that is no longer available.",
  locked:
    "Unlock every selected clip and its dependent tracks before using this batch action.",
  linked:
    "Select source clips without linked captions or graphics for batch timing edits.",
  source:
    "Unlink the source-bound clip before changing its timing or duplicating it.",
  many: "Select 500 clips or fewer for a single batch edit.",
  duplicateMany: "Select 250 clips or fewer to duplicate in one step.",
  target:
    "Every selected clip must move to an unlocked track of the same type.",
} as const;

function parentIds(document: VideoProjectDocument): Map<string, string[]> {
  const result = new Map<string, string[]>();
  document.items.forEach((item) => {
    const parents = [
      item.caption?.sourceItemId,
      item.visualizerSourceItemId,
    ].filter((id): id is string => !!id);
    if (parents.length) result.set(item.id, parents);
  });
  Object.values(document.bindings).forEach((binding) =>
    result.set(binding.itemId, [
      ...(result.get(binding.itemId) ?? []),
      binding.sourceItemId,
    ]),
  );
  return result;
}

/** Cheap UI eligibility; the command kernel still validates the entire batch. */
export function selectionActionIssue(
  document: VideoProjectDocument,
  ids: readonly string[],
  action: SelectionAction,
): string | null {
  const selected = new Set(ids),
    byId = new Map(document.items.map((item) => [item.id, item]));
  if (!selected.size || [...selected].some((id) => !byId.has(id)))
    return selectionMessages.missing;
  if (selected.size > (action === "duplicate" ? 250 : 500))
    return action === "duplicate"
      ? selectionMessages.duplicateMany
      : selectionMessages.many;
  const locked = new Set(
    document.tracks.filter((track) => track.locked).map((track) => track.id),
  );
  if ([...selected].some((id) => locked.has(byId.get(id)!.trackId)))
    return selectionMessages.locked;
  const parents = parentIds(document);
  const bound = new Set(
    Object.values(document.bindings).map((binding) => binding.itemId),
  );
  const children = new Map<string, string[]>();
  parents.forEach((sources, child) =>
    sources.forEach((source) =>
      children.set(source, [...(children.get(source) ?? []), child]),
    ),
  );
  const affected = new Set(selected),
    queue = [...selected];
  for (let cursor = 0; cursor < queue.length; cursor++) {
    for (const child of children.get(queue[cursor]!) ?? [])
      if (!affected.has(child)) {
        affected.add(child);
        queue.push(child);
      }
  }
  if (
    [...affected].some(
      (id) => byId.has(id) && locked.has(byId.get(id)!.trackId),
    )
  )
    return selectionMessages.locked;
  if (action !== "delete") {
    if (selected.size > 1 && [...selected].some((id) => parents.has(id)))
      return selectionMessages.linked;
    if (
      [...selected].some(
        (id) => byId.get(id)!.visualizerSourceItemId || bound.has(id),
      )
    )
      return selectionMessages.source;
  }
  return null;
}

export function buildSelectionCommands(
  document: VideoProjectDocument,
  idsInput: readonly string[],
  action: SelectionAction,
  options: {
    anchorId?: string;
    from?: number;
    trackId?: string;
    createId?: () => string;
  } = {},
): {
  commands: VideoProjectCommand[];
  selectedIds: string[];
  primaryId: string | null;
} {
  const ids = [...new Set(idsInput)];
  const issue = selectionActionIssue(document, ids, action);
  const byId = new Map(document.items.map((item) => [item.id, item]));
  // A linked item may keep its timing and move vertically on its own, as before.
  const verticalBoundMove =
    action === "move" &&
    ids.length === 1 &&
    issue === selectionMessages.source &&
    !byId.get(ids[0]!)?.visualizerSourceItemId &&
    options.from === (byId.get(ids[0]!)?.node.from ?? 0);
  const verticalSourceMove =
    action === "move" &&
    ids.length === 1 &&
    issue === selectionMessages.locked &&
    options.from === (byId.get(ids[0]!)?.node.from ?? 0) &&
    !document.tracks.find((track) => track.id === byId.get(ids[0]!)?.trackId)
      ?.locked;
  if (issue && !verticalBoundMove && !verticalSourceMove)
    throw new Error(issue);
  if (action === "delete") {
    const parents = parentIds(document);
    const children = new Map<string, string[]>(),
      degrees = new Map<string, number>(),
      depths = new Map<string, number>();
    document.items.forEach((item) => degrees.set(item.id, 0));
    parents.forEach((sources, child) =>
      sources.forEach((source) => {
        if (!byId.has(source)) return;
        degrees.set(child, (degrees.get(child) ?? 0) + 1);
        children.set(source, [...(children.get(source) ?? []), child]);
      }),
    );
    const queue = [...degrees]
      .filter(([, degree]) => degree === 0)
      .map(([id]) => id);
    for (let cursor = 0; cursor < queue.length; cursor++) {
      const id = queue[cursor]!;
      for (const child of children.get(id) ?? []) {
        depths.set(
          child,
          Math.max(depths.get(child) ?? 0, (depths.get(id) ?? 0) + 1),
        );
        degrees.set(child, degrees.get(child)! - 1);
        if (degrees.get(child) === 0) queue.push(child);
      }
    }
    // Delete selected dependents first, so source cascades cannot leave stale IDs.
    const ordered = ids
      .map((id, order) => ({ id, order, depth: depths.get(id) ?? 0 }))
      .sort((a, b) => b.depth - a.depth || a.order - b.order);
    return {
      commands: ordered.map(({ id }) => ({ type: "removeItem", id })),
      selectedIds: [],
      primaryId: null,
    };
  }
  if (action === "move") {
    const anchor = byId.get(options.anchorId ?? ids[0]!)!;
    if (!anchor || !ids.includes(anchor.id) || !Number.isInteger(options.from))
      throw new Error(selectionMessages.missing);
    const delta = Math.max(
      -Math.min(...ids.map((id) => byId.get(id)!.node.from ?? 0)),
      options.from! - (anchor.node.from ?? 0),
    );
    const tracks = editorTimelineTracks(document.tracks);
    const originalTrack = tracks.findIndex(
      (track) => track.id === anchor.trackId,
    );
    const targetTrack = tracks.findIndex(
      (track) => track.id === (options.trackId ?? anchor.trackId),
    );
    if (targetTrack < 0) throw new Error(selectionMessages.target);
    const trackDelta = targetTrack - originalTrack;
    if (delta === 0 && trackDelta === 0)
      return { commands: [], selectedIds: ids, primaryId: anchor.id };
    const commands: VideoProjectCommand[] = ids.map((id) => {
      const item = byId.get(id)!;
      const sourceIndex = tracks.findIndex(
        (track) => track.id === item.trackId,
      );
      const target = tracks[sourceIndex + trackDelta];
      if (!target || target.locked || target.kind !== tracks[sourceIndex]!.kind)
        throw new Error(selectionMessages.target);
      return {
        type: "moveItem",
        id,
        from: (item.node.from ?? 0) + delta,
        trackId: target.id,
      };
    });
    return { commands, selectedIds: ids, primaryId: anchor.id };
  }
  const from = Math.min(...ids.map((id) => byId.get(id)!.node.from ?? 0));
  const end = Math.max(
    ...ids.map(
      (id) => (byId.get(id)!.node.from ?? 0) + byId.get(id)!.node.duration!,
    ),
  );
  const offset = end - from;
  const createId = options.createId ?? (() => crypto.randomUUID());
  const commands: VideoProjectCommand[] = [],
    selectedIds: string[] = [];
  let primaryId: string | null = null;
  for (const id of ids) {
    const item = byId.get(id)!,
      newId = createId();
    commands.push({ type: "duplicateItem", id, newId });
    if (offset !== item.node.duration)
      commands.push({
        type: "moveItem",
        id: newId,
        from: (item.node.from ?? 0) + offset,
        trackId: item.trackId,
      });
    selectedIds.push(newId);
    if (id === (options.anchorId ?? ids.at(-1))) primaryId = newId;
  }
  return {
    commands,
    selectedIds,
    primaryId: primaryId ?? selectedIds.at(-1) ?? null,
  };
}
