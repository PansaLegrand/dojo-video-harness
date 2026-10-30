import type { EditorItem } from "@/lib/editor/document";

type Interval = { item: EditorItem; from: number; end: number; order: number };
type IntervalNode = {
  entry: Interval;
  left: IntervalNode | null;
  right: IntervalNode | null;
  minStart: number;
  maxEnd: number;
};
type SnapEdge = { frame: number; itemId: string; order: number };
export type TimelineIndex = {
  byId: ReadonlyMap<string, Interval>;
  tracks: ReadonlyMap<string, IntervalNode | null>;
  snapEdges: readonly SnapEdge[];
  maxEnd: number;
};

export function createTimelineIndex(
  items: readonly EditorItem[],
): TimelineIndex {
  const groups = new Map<string, Interval[]>();
  const byId = new Map<string, Interval>();
  const snapEdges: SnapEdge[] = [];
  let maxEnd = 0;
  items.forEach((item, order) => {
    const from = item.node.from ?? 0;
    const end = from + (item.node.duration ?? 1);
    const entry = { item, from, end, order };
    byId.set(item.id, entry);
    const group = groups.get(item.trackId);
    if (group) group.push(entry);
    else groups.set(item.trackId, [entry]);
    snapEdges.push(
      { frame: from, itemId: item.id, order: order * 2 },
      { frame: end, itemId: item.id, order: order * 2 + 1 },
    );
    maxEnd = Math.max(maxEnd, end);
  });
  const build = (
    entries: Interval[],
    from: number,
    end: number,
  ): IntervalNode | null => {
    if (from >= end) return null;
    const middle = (from + end) >>> 1;
    const entry = entries[middle]!;
    const left = build(entries, from, middle),
      right = build(entries, middle + 1, end);
    return {
      entry,
      left,
      right,
      minStart: left?.minStart ?? entry.from,
      maxEnd: Math.max(entry.end, left?.maxEnd ?? 0, right?.maxEnd ?? 0),
    };
  };
  const tracks = new Map<string, IntervalNode | null>();
  groups.forEach((entries, id) => {
    entries.sort((a, b) => a.from - b.from || a.order - b.order);
    tracks.set(id, build(entries, 0, entries.length));
  });
  snapEdges.sort((a, b) => a.frame - b.frame || a.order - b.order);
  return { byId, tracks, snapEdges, maxEnd };
}

/** Includes spanning clips and explicit focus/drag pins; preserves paint order. */
export function visibleTimelineItems(
  index: TimelineIndex,
  trackId: string,
  from: number,
  end: number,
  pinned: readonly string[] = [],
): EditorItem[] {
  const result = new Map<string, Interval>();
  const visit = (node: IntervalNode | null | undefined) => {
    if (!node || node.maxEnd < from || node.minStart > end) return;
    visit(node.left);
    if (node.entry.from <= end && node.entry.end >= from)
      result.set(node.entry.item.id, node.entry);
    visit(node.right);
  };
  visit(index.tracks.get(trackId));
  for (const id of pinned) {
    const entry = index.byId.get(id);
    if (entry?.item.trackId === trackId) result.set(id, entry);
  }
  return [...result.values()]
    .sort((a, b) => a.order - b.order)
    .map((entry) => entry.item);
}

export function visibleTimelineTracks(
  count: number,
  top: number,
  height: number,
  rowHeight: number,
  pinned: readonly number[] = [],
  overscan = 2,
): number[] {
  const first = Math.max(0, Math.floor(top / rowHeight) - overscan);
  const last = Math.min(
    count,
    Math.ceil((top + Math.max(rowHeight, height)) / rowHeight) + overscan,
  );
  const result = new Set<number>();
  for (let index = first; index < last; index++) result.add(index);
  for (const index of pinned)
    if (index >= 0 && index < count) result.add(index);
  return [...result].sort((a, b) => a - b);
}

export function visibleTimelineTicks(
  left: number,
  viewportWidth: number,
  width: number,
  step: number,
  overscan = 240,
): number[] {
  const first = Math.max(0, Math.floor((left - overscan) / step));
  const last = Math.min(
    Math.ceil(width / step),
    Math.ceil((left + viewportWidth + overscan) / step),
  );
  return Array.from(
    { length: Math.max(0, last - first) },
    (_, index) => first + index,
  );
}

function lowerEdge(edges: readonly SnapEdge[], frame: number): number {
  let low = 0,
    high = edges.length;
  while (low < high) {
    const middle = (low + high) >>> 1;
    if (edges[middle]!.frame < frame) low = middle + 1;
    else high = middle;
  }
  return low;
}

/** Preserve the existing playhead, origin, then document-order snap priority. */
export function snapTimelineMove(
  index: TimelineIndex,
  itemId: string,
  from: number,
  duration: number,
  playhead: number,
  pxPerFrame: number,
  excludedIds?: ReadonlySet<string>,
): number | null {
  const tolerance = 6 / pxPerFrame;
  const eligible = (candidate: number) =>
    candidate >= 0 && Math.abs(candidate - from) < tolerance;
  for (const frame of [playhead, 0]) {
    if (eligible(frame)) return frame;
    if (eligible(frame - duration)) return frame - duration;
  }
  let best: { frame: number; order: number } | undefined;
  for (const offset of [0, duration]) {
    const target = from + offset;
    for (
      let cursor = lowerEdge(index.snapEdges, target - tolerance);
      cursor < index.snapEdges.length;
      cursor++
    ) {
      const edge = index.snapEdges[cursor]!;
      if (edge.frame > target + tolerance) break;
      const candidate = edge.frame - offset;
      const order = edge.order * 2 + (offset === 0 ? 0 : 1);
      if (
        edge.itemId !== itemId &&
        !excludedIds?.has(edge.itemId) &&
        eligible(candidate) &&
        (!best || order < best.order)
      )
        best = { frame: candidate, order };
    }
  }
  return best?.frame ?? null;
}
