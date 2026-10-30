export const TIMELINE_SELECTION_HELP =
  "Shift-click selects a range. ⌘/Ctrl-click toggles clips. ⌘/Ctrl+A selects all. Escape clears selection.";

export type TimelineSelectionGesture = {
  toggle?: boolean;
  range?: boolean;
  preserve?: boolean;
};

export function timelineSelection(
  current: readonly string[],
  primary: string | null,
  anchor: string | null,
  target: string,
  orderedIds: readonly string[],
  gesture: TimelineSelectionGesture = {},
): { ids: string[]; primary: string | null; anchor: string } {
  if (gesture.preserve && current.includes(target))
    return { ids: [...current], primary: target, anchor: anchor ?? target };
  if (gesture.range) {
    const start = orderedIds.indexOf(anchor ?? primary ?? target),
      end = orderedIds.indexOf(target);
    const range =
      start < 0 || end < 0
        ? [target]
        : orderedIds.slice(Math.min(start, end), Math.max(start, end) + 1);
    return {
      ids: [...new Set(gesture.toggle ? [...current, ...range] : range)],
      primary: target,
      anchor: anchor ?? primary ?? target,
    };
  }
  if (gesture.toggle) {
    const ids = current.includes(target)
      ? current.filter((id) => id !== target)
      : [...current, target];
    return {
      ids,
      primary: ids.includes(target)
        ? target
        : primary && ids.includes(primary)
          ? primary
          : (ids.at(-1) ?? null),
      anchor: target,
    };
  }
  return { ids: [target], primary: target, anchor: target };
}
