export const TIMELINE_KEYBOARD_HELP =
  "Use Left and Right to move a clip or adjust a focused trim handle by one frame. Hold Shift for one second. Enter or Space selects the clip.";

type KeyInput = {
  key: string;
  code?: string;
  defaultPrevented?: boolean;
  isComposing?: boolean;
  keyCode?: number;
  metaKey?: boolean;
  ctrlKey?: boolean;
  altKey?: boolean;
  shiftKey?: boolean;
  target?: EventTarget | null;
};

export type EditorShortcut =
  | "undo"
  | "redo"
  | "save"
  | "togglePlayback"
  | "deleteSelection";
const TEXT_TARGETS =
  'input,textarea,select,[contenteditable]:not([contenteditable="false"]),[role="dialog"]';
const CONTROL_TARGETS =
  'button,a[href],summary,[role="button"],[role="checkbox"],[role="switch"],[role="slider"],[role="menuitem"],[role="tab"],[role="option"],[role="combobox"],[role="listbox"],[role="spinbutton"],[role="textbox"]';

/** Keep native control activation and already-consumed timeline keys local. */
export function editorShortcut(event: KeyInput): EditorShortcut | null {
  if (
    event.defaultPrevented ||
    event.isComposing ||
    event.keyCode === 229 ||
    event.altKey
  )
    return null;
  const target = event.target as
    | (EventTarget & { closest?: (selector: string) => unknown })
    | null;
  if (target?.closest?.(TEXT_TARGETS)) return null;
  if (event.metaKey || event.ctrlKey) {
    if (event.key.toLowerCase() === "z")
      return event.shiftKey ? "redo" : "undo";
    if (event.key.toLowerCase() === "s" && !event.shiftKey) return "save";
    return null;
  }
  if (target?.closest?.(CONTROL_TARGETS)) return null;
  if (event.code === "Space" || event.key === " ") return "togglePlayback";
  if (event.key === "Delete" || event.key === "Backspace")
    return "deleteSelection";
  return null;
}

/** The pointer and keyboard paths share the same one-frame minimum and origin. */
export function timelineKeyboardAdjustment(
  event: KeyInput,
  mode: "move" | "start" | "end",
  range: { from: number; duration: number; fps: number },
): { from: number; duration: number } | null {
  if (
    event.defaultPrevented ||
    event.isComposing ||
    event.keyCode === 229 ||
    event.metaKey ||
    event.ctrlKey ||
    event.altKey
  )
    return null;
  if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return null;
  const delta =
    (event.key === "ArrowLeft" ? -1 : 1) *
    (event.shiftKey ? Math.max(1, Math.round(range.fps)) : 1);
  const from =
    mode === "move"
      ? Math.max(0, range.from + delta)
      : mode === "start"
        ? Math.max(
            0,
            Math.min(range.from + range.duration - 1, range.from + delta),
          )
        : range.from;
  const duration =
    mode === "start"
      ? range.duration + range.from - from
      : mode === "end"
        ? Math.max(1, range.duration + delta)
        : range.duration;
  return from === range.from && duration === range.duration
    ? null
    : { from, duration };
}
