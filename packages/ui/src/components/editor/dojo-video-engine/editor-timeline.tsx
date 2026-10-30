"use client";

import { type CSSProperties, useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from "react";
import { Eye, EyeOff, Lock, Unlock, Volume2, VolumeX, Trash2 } from "lucide-react";
import type {
  EditorDocument,
  EditorItem,
  EditorTrack,
} from "@/lib/editor/document";
import { useEditorInteraction } from "./editor-interaction";
import { useNativeEditorText } from "./native-editor-copy";
import { TIMELINE_SELECTION_HELP, type TimelineSelectionGesture } from "@/lib/video-project/selection";
import type { EditorMediaPreview } from "./editor-media-previews";
import { TIMELINE_KEYBOARD_HELP, timelineKeyboardAdjustment } from "./editor-keyboard";
import { createTimelineIndex, snapTimelineMove, visibleTimelineItems, visibleTimelineTicks, visibleTimelineTracks } from "./timeline-window";
import { EditorPlayheadTime, EditorTimelinePlayhead, useEditorPlayheadReader } from "./editor-playhead";

type Drag = {
  id: string;
  mode: "move" | "start" | "end";
  x: number;
  y: number;
  scrollLeft: number;
  scrollTop: number;
  from: number;
  duration: number;
  trackId: string;
  nextFrom: number;
  nextDuration: number;
  nextTrackId: string;
  timeLocked: boolean;
  ids: readonly string[];
  minFrom: number;
};
const ROW_HEIGHT = 58;
const TRACK_LABEL_WIDTH = 144;

export function EditorTimeline({
  document,
  frame = 0,
  selectedId,
  selectedIds,
  moveDisabledReason,
  deleteDisabledReason,
  onSelectMany,
  disabled,
  previews = {},
  timingLockedIds = new Set<string>(),
  onSelect,
  onSeek,
  onMove,
  onTrim,
  onUpdateTrack,
  onRemoveGap,
  onDeleteItem,
  onDeleteTrack,
}: {
  document: EditorDocument;
  frame?: number;
  selectedId: string | null;
  selectedIds?: readonly string[];
  moveDisabledReason?: string | null;
  deleteDisabledReason?: string | null;
  onSelectMany?: (ids: readonly string[], primaryId: string | null) => void;
  disabled?: boolean;
  previews?: Record<string, EditorMediaPreview>;
  timingLockedIds?: ReadonlySet<string>;
  onSelect: (id: string, gesture?: TimelineSelectionGesture) => void;
  onSeek: (frame: number) => void;
  onMove: (id: string, from: number, trackId: string, selectedIds?: readonly string[]) => void;
  onTrim: (id: string, from: number, duration: number) => void;
  onUpdateTrack: (id: string, patch: Partial<EditorTrack>) => void;
  onRemoveGap: (trackId: string, frame: number) => void;
  onDeleteItem: (id: string) => void;
  onDeleteTrack: (id: string) => void;
}) {
  const t = useNativeEditorText();
  const interaction = useEditorInteraction();
  const readPlayhead = useEditorPlayheadReader(frame);
  const keyboardHelpId = useId();
  const selectedSet = useMemo(() => new Set(selectedIds ?? (selectedId ? [selectedId] : [])), [selectedIds, selectedId]);
  const [zoom, setZoom] = useState(70);
  const viewportRef = useRef<HTMLDivElement>(null);
  const [viewport, setViewport] = useState({ width: 800, height: 280, left: 0, top: 0 });
  const [focusedItemId, setFocusedItemId] = useState<string | null>(null);
  const [focusedTrackId, setFocusedTrackId] = useState<string | null>(null);
  const itemElements = useRef(new Map<string, HTMLDivElement>());
  const trackElements = useRef(new Map<string, HTMLDivElement>());
  const pendingTrackFocus = useRef<{ id: string; last: boolean } | null>(null);
  const pendingFocus = useRef<{ id: string; last: boolean } | null>(null);
  const pointer = useRef<{ x: number; y: number } | null>(null);
  useEffect(() => {
    const element = viewportRef.current;
    if (!element) return;
    let frame = 0;
    const measure = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        const next = { width: element.clientWidth, height: element.clientHeight, left: element.scrollLeft, top: element.scrollTop };
        setViewport(current => Object.keys(next).every(key => current[key as keyof typeof next] === next[key as keyof typeof next]) ? current : next);
      });
    };
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    element.addEventListener("scroll", measure, { passive: true });
    measure();
    return () => { cancelAnimationFrame(frame); observer.disconnect(); element.removeEventListener("scroll", measure); };
  }, []);
  const [drag, setDrag] = useState<Drag | null>(null);
  const dragRef = useRef<Drag | null>(null);
  const { fps, durationInFrames } = document.format;
  const index = useMemo(() => createTimelineIndex(document.items), [document.items]);
  const trackIndices = useMemo(() => new Map(document.tracks.map((track, index) => [track.id, index])), [document.tracks]);
  const orderedIds = useMemo(() => {
    const groups = new Map(document.tracks.map(track => [track.id, [] as string[]]));
    document.items.forEach(item => groups.get(item.trackId)?.push(item.id));
    return document.tracks.flatMap(track => groups.get(track.id)!);
  }, [document.items, document.tracks]);
  const itemOrder = useMemo(() => new Map(orderedIds.map((id, index) => [id, index])), [orderedIds]);
  const selectedTrackId = drag?.nextTrackId ?? index.byId.get(selectedId ?? "")?.item.trackId;
  const pxPerFrame = zoom / fps;
  const end = Math.max(durationInFrames, index.maxEnd);
  const visibleWidth = Math.max(1, viewport.width - TRACK_LABEL_WIDTH);
  const width = Math.max(visibleWidth, 680, (end / fps + 3) * zoom);
  const tickSeconds = zoom >= 70 ? 1 : zoom >= 30 ? 2 : 5;
  const ticks = visibleTimelineTicks(viewport.left, visibleWidth, width, zoom * tickSeconds).map(index => index * tickSeconds);
  const pinnedIds = [selectedId, focusedItemId, drag?.id].filter((id): id is string => !!id);
  const pinnedTracks = [...pinnedIds.map(id => index.byId.get(id)?.item.trackId), focusedTrackId, drag?.nextTrackId]
    .flatMap(id => id && trackIndices.has(id) ? [trackIndices.get(id)!] : []);
  const movingIds = useMemo(() => new Set(drag?.mode === "move" ? drag.ids : []), [drag?.mode, drag?.ids]);
  const moveDelta = drag?.mode === "move" ? drag.nextFrom - drag.from : 0;
  const trackDelta = drag?.mode === "move" ? (trackIndices.get(drag.nextTrackId) ?? 0) - (trackIndices.get(drag.trackId) ?? 0) : 0;
  const windowRows = visibleTimelineTracks(document.tracks.length, viewport.top, viewport.height - 28, ROW_HEIGHT);
  const originRows = drag?.mode === "move" ? windowRows.map(row => row - trackDelta) : [];
  const renderedTrackIndices = visibleTimelineTracks(document.tracks.length, viewport.top, viewport.height - 28, ROW_HEIGHT, [...pinnedTracks, ...originRows]);
  const renderedTracks = renderedTrackIndices.map(index => document.tracks[index]!);
  const visibleFrom = Math.max(0, (viewport.left - 240) / pxPerFrame);
  const visibleEnd = (viewport.left + visibleWidth + 240) / pxPerFrame;

  function requestItemFocus(id: string, last = false) {
    const entry = index.byId.get(id), element = viewportRef.current;
    if (!entry || !element) return;
    pendingFocus.current = { id, last };
    setFocusedItemId(id);
    const itemLeft = entry.from * pxPerFrame, itemRight = entry.end * pxPerFrame;
    const availableWidth = Math.max(1, element.clientWidth - TRACK_LABEL_WIDTH);
    if (itemLeft < element.scrollLeft || itemRight - itemLeft > availableWidth) element.scrollLeft = itemLeft;
    else if (itemRight > element.scrollLeft + availableWidth) element.scrollLeft = itemRight - availableWidth;
    const rowTop = (trackIndices.get(entry.item.trackId) ?? 0) * ROW_HEIGHT;
    const availableHeight = Math.max(ROW_HEIGHT, element.clientHeight - 28);
    if (rowTop < element.scrollTop) element.scrollTop = rowTop;
    else if (rowTop + ROW_HEIGHT > element.scrollTop + availableHeight) element.scrollTop = rowTop + ROW_HEIGHT - availableHeight;
  }
  function requestTrackFocus(id: string, last = false) {
    const row = trackIndices.get(id), element = viewportRef.current;
    if (row === undefined || !element) return;
    pendingTrackFocus.current = { id, last };
    setFocusedTrackId(id);
    setFocusedItemId(null);
    const top = row * ROW_HEIGHT;
    const height = Math.max(ROW_HEIGHT, element.clientHeight - 28);
    if (top < element.scrollTop) element.scrollTop = top;
    else if (top + ROW_HEIGHT > element.scrollTop + height) element.scrollTop = top + ROW_HEIGHT - height;
  }
  useLayoutEffect(() => {
    const trackFocus = pendingTrackFocus.current;
    const label = trackFocus && trackElements.current.get(trackFocus.id);
    if (trackFocus && label) {
      pendingTrackFocus.current = null;
      const controls = label.querySelectorAll<HTMLElement>("button:not(:disabled)");
      controls.item(trackFocus.last ? controls.length - 1 : 0)?.focus({ preventScroll: true });
    }
    const focus = pendingFocus.current;
    const element = focus && itemElements.current.get(focus.id);
    if (!focus || !element) return;
    pendingFocus.current = null;
    const controls = element.querySelectorAll<HTMLElement>("button:not(:disabled),[tabindex='0']");
    (focus.last ? controls.item(controls.length - 1) ?? element : element).focus({ preventScroll: true });
  });
  function navigateTab(event: React.KeyboardEvent<HTMLDivElement>) {
    if (!event.nativeEvent.isComposing && onSelectMany && event.key.toLowerCase() === "a" && (event.metaKey || event.ctrlKey) && !event.altKey) {
      event.preventDefault(); event.stopPropagation(); onSelectMany(orderedIds, selectedId ?? orderedIds[0] ?? null); return;
    }
    if (event.key === "Escape" && onSelectMany && !dragRef.current) {
      event.preventDefault(); event.stopPropagation(); onSelectMany([], null); return;
    }
    if (event.key !== "Tab" || event.altKey || event.metaKey || event.ctrlKey) return;
    const target = event.target as HTMLElement;
    const clip = target.closest<HTMLElement>("[data-timeline-item]");
    const id = clip?.dataset.timelineItem;
    if (!clip || !id) {
      const label = target.closest<HTMLElement>("[data-track-label]");
      const trackId = label?.dataset.trackLabel;
      if (!label || !trackId) return;
      const controls = label.querySelectorAll<HTMLElement>("button:not(:disabled)");
      if (target !== controls.item(event.shiftKey ? 0 : controls.length - 1)) return;
      const row = trackIndices.get(trackId)! + (event.shiftKey ? -1 : 1);
      const nextTrack = document.tracks[row];
      if (nextTrack) { event.preventDefault(); requestTrackFocus(nextTrack.id, event.shiftKey); }
      else if (!event.shiftKey && orderedIds[0]) { event.preventDefault(); requestItemFocus(orderedIds[0]); }
      return;
    }
    const controls = clip.querySelectorAll<HTMLElement>("button:not(:disabled),[tabindex='0']");
    const boundary = event.shiftKey ? clip : controls.item(controls.length - 1) ?? clip;
    if (target !== boundary) return;
    const ordinal = itemOrder.get(id);
    if (ordinal === undefined) return;
    const next = orderedIds[ordinal + (event.shiftKey ? -1 : 1)];
    if (!next) {
      const lastTrack = document.tracks.at(-1);
      if (event.shiftKey && lastTrack) { event.preventDefault(); requestTrackFocus(lastTrack.id, true); }
      return;
    }
    event.preventDefault();
    requestItemFocus(next, event.shiftKey);
  }

  function begin(
    event: React.PointerEvent,
    item: EditorItem,
    mode: Drag["mode"],
  ) {
    const track = document.tracks.find(
      (candidate) => candidate.id === item.trackId,
    );
    if (event.button !== 0) return;
    if (mode === "move" && (event.shiftKey || event.metaKey || event.ctrlKey)) {
      event.preventDefault(); event.stopPropagation();
      onSelect(item.id, { range: event.shiftKey, toggle: event.metaKey || event.ctrlKey });
      return;
    }
    const ids = mode === "move" && selectedSet.has(item.id) ? [...selectedSet] : [item.id];
    onSelect(item.id, mode === "move" && ids.length > 1 ? { preserve: true } : undefined);
    if (disabled || track?.locked || item.visualizerSourceItemId || (timingLockedIds.has(item.id) && mode !== "move") || (ids.length > 1 && moveDisabledReason)) return;
    if (ids.some(id => !index.byId.has(id))) return;
    event.preventDefault();
    event.stopPropagation();
    event.currentTarget.setPointerCapture(event.pointerId);
    const state: Drag = {
      id: item.id,
      mode,
      x: event.clientX,
      y: event.clientY,
      scrollLeft: viewportRef.current?.scrollLeft ?? 0,
      scrollTop: viewportRef.current?.scrollTop ?? 0,
      from: item.node.from ?? 0,
      duration: item.node.duration ?? 1,
      trackId: item.trackId,
      nextFrom: item.node.from ?? 0,
      nextDuration: item.node.duration ?? 1,
      nextTrackId: item.trackId,
      timeLocked: timingLockedIds.has(item.id),
      ids,
      minFrom: Math.min(...ids.map(id => index.byId.get(id)!.from)),
    };
    interaction?.beginInteraction();
    pointer.current = { x: event.clientX, y: event.clientY };
    dragRef.current = state;
    setDrag(state);
  }

  function updateDragPosition(clientX: number, clientY: number) {
    const current = dragRef.current;
    if (!current) return;
    const scrollLeft = viewportRef.current?.scrollLeft ?? current.scrollLeft;
    const scrollTop = viewportRef.current?.scrollTop ?? current.scrollTop;
    const delta = Math.round((clientX - current.x + scrollLeft - current.scrollLeft) / pxPerFrame);
    const next = { ...current };
    if (current.mode === "move") {
      next.nextFrom = current.timeLocked ? current.from : current.from + Math.max(-current.minFrom, delta);
      const trackIndex = document.tracks.findIndex(
        (track) => track.id === current.trackId,
      );
      const target =
        document.tracks[
          Math.max(
            0,
            Math.min(
              document.tracks.length - 1,
              trackIndex + Math.round((clientY - current.y + scrollTop - current.scrollTop) / ROW_HEIGHT),
            ),
          )
        ];
      if (
        target &&
        !target.locked &&
        target.kind === document.tracks[trackIndex]?.kind &&
        current.ids.every(id => {
          const original = trackIndices.get(index.byId.get(id)!.item.trackId)!;
          const destination = document.tracks[original + document.tracks.indexOf(target) - trackIndex];
          return destination && !destination.locked && destination.kind === document.tracks[original]!.kind;
        })
      )
        next.nextTrackId = target.id;
      const snap = snapTimelineMove(index, current.id, next.nextFrom, current.duration, readPlayhead(), pxPerFrame, new Set(current.ids));
      if (snap !== null && !current.timeLocked && snap >= current.from - current.minFrom) next.nextFrom = snap;
    } else if (current.mode === "start") {
      next.nextFrom = Math.max(
        0,
        Math.min(current.from + current.duration - 1, current.from + delta),
      );
      next.nextDuration = current.duration + current.from - next.nextFrom;
    } else {
      next.nextDuration = Math.max(1, current.duration + delta);
    }
    if (next.nextFrom === current.nextFrom && next.nextDuration === current.nextDuration && next.nextTrackId === current.nextTrackId) return;
    dragRef.current = next;
    setDrag(next);
  }
  function move(event: React.PointerEvent) {
    pointer.current = { x: event.clientX, y: event.clientY };
    updateDragPosition(event.clientX, event.clientY);
  }
  useEffect(() => {
    if (!drag?.id) return;
    let animation = 0;
    const tick = () => {
      const element = viewportRef.current, point = pointer.current;
      if (!element || !point || !dragRef.current) return;
      const bounds = element.getBoundingClientRect();
      const dx = point.x < bounds.left + TRACK_LABEL_WIDTH + 20 ? -16 : point.x > bounds.right - 20 ? 16 : 0;
      const dy = point.y < bounds.top + 48 ? -12 : point.y > bounds.bottom - 20 ? 12 : 0;
      if (dx || dy) {
        element.scrollLeft += dx; element.scrollTop += dy;
        updateDragPosition(point.x, point.y);
      }
      animation = requestAnimationFrame(tick);
    };
    animation = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(animation);
    // During a drag the source item stays in its original row to retain capture.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [drag?.id, document.items, document.tracks, pxPerFrame]);

  function finish(event: React.PointerEvent) {
    const before = dragRef.current;
    if (before && (event.clientX !== before.x || event.clientY !== before.y || viewportRef.current?.scrollLeft !== before.scrollLeft || viewportRef.current?.scrollTop !== before.scrollTop)) updateDragPosition(event.clientX, event.clientY);
    const current = dragRef.current;
    if (!current) return;
    if (current.nextTrackId !== current.trackId && viewportRef.current?.ownerDocument.activeElement?.closest<HTMLElement>("[data-timeline-item]")?.dataset.timelineItem === current.id) {
      pendingFocus.current = { id: current.id, last: false };
    }
    dragRef.current = null;
    setDrag(null);
    if (event.currentTarget.hasPointerCapture(event.pointerId))
      event.currentTarget.releasePointerCapture(event.pointerId);
    if (current.mode === "move") {
      if (
        current.nextFrom !== current.from ||
        current.nextTrackId !== current.trackId
      )
        onMove(current.id, current.nextFrom, current.nextTrackId, current.ids);
    } else if (
      current.nextFrom !== current.from ||
      current.nextDuration !== current.duration
    ) {
      onTrim(current.id, current.nextFrom, current.nextDuration);
    }
    interaction?.endInteraction();
  }

  function keyboardTrim(event: React.KeyboardEvent<HTMLButtonElement>, item: EditorItem, mode: "start" | "end") {
    if (event.nativeEvent.isComposing || event.nativeEvent.keyCode === 229) return;
    if (disabled || document.tracks.find(track => track.id === item.trackId)?.locked || item.visualizerSourceItemId || timingLockedIds.has(item.id)) return;
    const range = timelineKeyboardAdjustment(event, mode, { from: item.node.from ?? 0, duration: item.node.duration ?? 1, fps });
    if (!range) return;
    event.preventDefault();
    event.stopPropagation();
    onSelect(item.id);
    onTrim(item.id, range.from, range.duration);
  }

  function seek(event: React.PointerEvent<HTMLElement>) {
    if (event.button !== 0) return;
    const rect = event.currentTarget.getBoundingClientRect();
    onSeek(
      Math.max(
        0,
        Math.min(end - 1, Math.round((event.clientX - rect.left) / pxPerFrame)),
      ),
    );
  }

  return (
    <section
      className="editor-timeline border-t border-[var(--editor-border)] bg-[var(--editor-panel)]"
      aria-label="Timeline"
    >
      <p id={keyboardHelpId} className="sr-only">{t(TIMELINE_KEYBOARD_HELP)} {t(TIMELINE_SELECTION_HELP)}</p>
      <div className="flex h-10 shrink-0 items-center justify-between border-b border-[var(--editor-border)] px-3 text-xs text-[var(--editor-muted)]">
        <EditorPlayheadTime fps={fps} endFrame={end} frame={frame} />
        <label className="flex items-center gap-2">
          {t("Zoom")}{" "}
          <input
            aria-label="Timeline zoom"
            type="range"
            min={15}
            max={180}
            value={zoom}
            onChange={(event) => setZoom(Number(event.target.value))}
            className="w-28 accent-violet-500"
          />
        </label>
      </div>
      <div ref={viewportRef}
        onKeyDownCapture={navigateTab}
        onFocusCapture={event => {
          const target = event.target as HTMLElement;
          setFocusedItemId(target.closest<HTMLElement>("[data-timeline-item]")?.dataset.timelineItem ?? null);
          setFocusedTrackId(target.closest<HTMLElement>("[data-track-label],[data-track-lane]")?.dataset.trackLabel ?? target.closest<HTMLElement>("[data-track-lane]")?.dataset.trackLane ?? null);
        }}
        onBlurCapture={event => { if (!event.currentTarget.contains(event.relatedTarget as Node | null)) { setFocusedItemId(null); setFocusedTrackId(null); } }}
        className="editor-timeline-scroll" style={{ "--editor-track-label-width": `${TRACK_LABEL_WIDTH}px` } as CSSProperties}>
        <div className="editor-timeline-labels sticky left-0 z-30 shrink-0 border-r border-[var(--editor-border)] bg-[var(--editor-panel)]" style={{ width: TRACK_LABEL_WIDTH }}>
          <div className="sticky top-0 z-30 h-7 border-b border-[var(--editor-border)] bg-[var(--editor-panel)]" />
          <div className="relative" style={{ height: document.tracks.length * ROW_HEIGHT }}>
          {renderedTracks.map((track) => (
            <div
              key={track.id}
              data-track-label={track.id}
              ref={element => { if (element) trackElements.current.set(track.id, element); else trackElements.current.delete(track.id); }}
              data-selected={track.id === selectedTrackId}
              style={{ height: ROW_HEIGHT, top: trackIndices.get(track.id)! * ROW_HEIGHT, width: "100%", position: "absolute" }}
              className="flex flex-col justify-center gap-1 border-b border-[var(--editor-border)] px-2"
            >
              <span className="truncate text-xs text-[var(--editor-text)]">
                {t(track.name)}
              </span>
              <div className="flex gap-2 text-[var(--editor-muted)]">
                <button
                  title={track.hidden ? "Show track" : "Hide track"}
                  aria-label={`${track.hidden ? "Show" : "Hide"} ${track.name}`}
                  disabled={disabled}
                  onClick={() =>
                    onUpdateTrack(track.id, { hidden: !track.hidden })
                  }
                >
                  {track.hidden ? <EyeOff size={13} /> : <Eye size={13} />}
                </button>
                <button
                  title={track.muted ? "Unmute track" : "Mute track"}
                  aria-label={`${track.muted ? "Unmute" : "Mute"} ${track.name}`}
                  disabled={disabled}
                  onClick={() =>
                    onUpdateTrack(track.id, { muted: !track.muted })
                  }
                >
                  {track.muted ? <VolumeX size={13} /> : <Volume2 size={13} />}
                </button>
                <button
                  title={track.locked ? "Unlock track" : "Lock track"}
                  aria-label={`${track.locked ? "Unlock" : "Lock"} ${track.name}`}
                  disabled={disabled}
                  onClick={() =>
                    onUpdateTrack(track.id, { locked: !track.locked })
                  }
                >
                  {track.locked ? <Lock size={13} /> : <Unlock size={13} />}
                </button>
                {!index.tracks.has(track.id) && <button
                  type="button"
                  className="editor-track-delete"
                  aria-label={`${t("Delete empty track")}: ${t(track.name)}`}
                  title={t(track.locked ? "Unlock the track to delete it" : document.tracks.length < 2 ? "Keep at least one track" : "Delete empty track")}
                  disabled={disabled || !!drag || track.locked || document.tracks.length < 2}
                  onPointerDown={event => event.stopPropagation()}
                  onKeyDown={event => event.stopPropagation()}
                  onClick={event => { event.stopPropagation(); onDeleteTrack(track.id); }}
                ><Trash2 size={13} /></button>}
              </div>
            </div>
          ))}
          </div>
        </div>
        <div className="shrink-0">
          <div style={{ width }} className="relative select-none">
            <div
              className="editor-timeline-ruler sticky top-0 z-20 h-7 cursor-crosshair border-b border-[var(--editor-border)] bg-[var(--editor-panel)]"
              onPointerDown={seek}
            >
              {ticks.map((seconds) => (
                <span
                  key={seconds}
                  className="absolute top-1 border-l border-[var(--editor-border)] pl-1 text-[10px] text-[var(--editor-muted)]"
                  style={{ left: seconds * zoom }}
                >
                  {seconds}s
                </span>
              ))}
              <EditorTimelinePlayhead pxPerFrame={pxPerFrame} frame={frame} head />
            </div>
            <div className="relative" style={{ height: document.tracks.length * ROW_HEIGHT }}>
            {renderedTracks.map((track) => {
              const normal = visibleTimelineItems(index, track.id, visibleFrom, visibleEnd, pinnedIds);
              const moving = movingIds.size ? visibleTimelineItems(index, track.id, visibleFrom - moveDelta, visibleEnd - moveDelta).filter(item => movingIds.has(item.id)) : [];
              const merged = new Map(normal.filter(item => !movingIds.has(item.id) || pinnedIds.includes(item.id)).map(item => [item.id, item]));
              moving.forEach(item => merged.set(item.id, item));
              const items = [...merged.values()].sort((a, b) => index.byId.get(a.id)!.order - index.byId.get(b.id)!.order);
              return (
                <div
                  key={track.id}
                  data-track-lane={track.id}
                  data-selected={track.id === selectedTrackId}
                  style={{ height: ROW_HEIGHT, top: trackIndices.get(track.id)! * ROW_HEIGHT, width: "100%", position: "absolute" }}
                  className="border-b border-[var(--editor-border)]"
                  onPointerDown={seek}
                >
                  {items.map((item) => {
                    const from = movingIds.has(item.id) ? (item.node.from ?? 0) + moveDelta
                      : drag?.id === item.id ? drag.nextFrom : (item.node.from ?? 0);
                    const duration =
                      drag?.id === item.id
                        ? drag.nextDuration
                        : (item.node.duration ?? 1);
                    const preview = previews[item.node.assetId ?? ""];
                    const assetDuration =
                      document.assets[item.node.assetId ?? ""]
                        ?.durationSeconds ?? duration / fps;
                    const asset = document.assets[item.node.assetId ?? ""];
                    const thumbnailWidth = Math.max(12, Math.min(176, 44 * (asset?.width && asset.height ? asset.width / asset.height : 16 / 9)));
                    const tileCount = Math.min(
                      50,
                      Math.max(1, Math.ceil((duration * pxPerFrame) / thumbnailWidth)),
                    );
                    return (
                      <div
                        key={item.id}
                        data-timeline-item={item.id}
                        ref={element => { if (element) itemElements.current.set(item.id, element); else itemElements.current.delete(item.id); }}
                        role="button"
                        tabIndex={0}
                        aria-label={`${item.name}, ${(from / fps).toFixed(2)} seconds, ${(duration / fps).toFixed(2)} seconds long`}
                        aria-pressed={selectedSet.has(item.id)}
                        className={`editor-timeline-item absolute top-1.5 flex h-11 touch-none items-center rounded border px-3 text-xs text-white shadow-sm border-white/10 ${item.caption ? "bg-amber-800" : item.node.type === "audio" ? "bg-emerald-800" : item.node.type === "text" ? "bg-indigo-800" : item.node.type === "effect" ? "bg-pink-800" : "bg-violet-800"} ${track.hidden ? "opacity-40" : ""} ${track.locked ? "cursor-not-allowed" : "cursor-grab"}`}
                        style={{
                          left: from * pxPerFrame,
                          top: movingIds.has(item.id) ? 6 + trackDelta * ROW_HEIGHT : undefined,
                          width: Math.max(8, duration * pxPerFrame),
                        }}
                        onPointerDown={(event) => begin(event, item, "move")}
                        onPointerMove={move}
                        onPointerUp={finish}
                        onPointerCancel={() => {
                          if (dragRef.current) interaction?.endInteraction();
                          dragRef.current = null;
                          setDrag(null);
                        }}
                        aria-describedby={keyboardHelpId}
                        aria-keyshortcuts="Enter Space ArrowLeft ArrowRight Shift+ArrowLeft Shift+ArrowRight Delete"
                        onKeyDown={(event) => {
                          if (event.target !== event.currentTarget || event.nativeEvent.isComposing || event.nativeEvent.keyCode === 229) return;
                          if (event.key === "Enter" || event.key === " ") {
                            event.preventDefault();
                            event.stopPropagation();
                            onSelect(item.id, { range: event.shiftKey, toggle: event.metaKey || event.ctrlKey });
                            return;
                          }
                          if (disabled || track.locked) return;
                          if ((event.key === "Delete" || event.key === "Backspace") && !event.metaKey && !event.ctrlKey && !event.altKey) {
                            event.preventDefault();
                            event.stopPropagation();
                            if (!selectedSet.has(item.id) || !deleteDisabledReason) onDeleteItem(item.id);
                            return;
                          }
                          if (item.visualizerSourceItemId || timingLockedIds.has(item.id) || (selectedSet.has(item.id) && selectedSet.size > 1 && moveDisabledReason)) return;
                          const range = timelineKeyboardAdjustment(event, "move", { from, duration, fps });
                          if (range) {
                            event.preventDefault();
                            event.stopPropagation();
                            onMove(item.id, range.from, track.id, selectedSet.has(item.id) ? [...selectedSet] : [item.id]);
                          }
                        }}
                      >
                        <button
                          aria-label={`Trim start of ${item.name}`}
                          aria-describedby={keyboardHelpId}
                          aria-keyshortcuts="ArrowLeft ArrowRight Shift+ArrowLeft Shift+ArrowRight"
                          onKeyDown={event => keyboardTrim(event, item, "start")}
                          onClick={() => onSelect(item.id)}
                          data-trim-handle="start"
                          disabled={disabled || track.locked || !!item.visualizerSourceItemId || timingLockedIds.has(item.id)}
                          className="absolute inset-y-0 left-0 w-2 cursor-ew-resize bg-black/20 hover:bg-white/40"
                          onPointerDown={(event) => begin(event, item, "start")}
                          onPointerMove={move}
                          onPointerUp={finish}
                        />
                        {preview?.frames?.length ? (
                          <div className="pointer-events-none absolute inset-0 flex overflow-hidden rounded opacity-55">
                            {Array.from({ length: tileCount }, (_, index) => {
                              const seconds =
                                (item.node.videoStartTime ?? 0) +
                                (((index / tileCount) * duration) / fps) *
                                  (item.node.playbackRate ?? 1);
                              const thumb = preview.frames!.reduce(
                                (best, candidate) =>
                                  Math.abs(candidate.seconds - seconds) <
                                  Math.abs(best.seconds - seconds)
                                    ? candidate
                                    : best,
                              );
                              return (
                                <img
                                  key={index}
                                  alt=""
                                  src={thumb.src}
                                  className="h-full shrink-0 object-contain"
                                  style={{ width: Math.max(thumbnailWidth, duration * pxPerFrame / tileCount) }}
                                />
                              );
                            })}
                          </div>
                        ) : null}
                        {preview?.peaks?.length ? (
                          <svg
                            viewBox="0 0 240 40"
                            preserveAspectRatio="none"
                            className="pointer-events-none absolute inset-0 h-full w-full opacity-60"
                            aria-hidden="true"
                          >
                            {Array.from({ length: 120 }, (_, index) => {
                              const source =
                                (item.node.audioStartTime ?? 0) +
                                ((index / 120) * duration) / fps;
                              const peak =
                                preview.peaks![
                                  Math.min(
                                    preview.peaks!.length - 1,
                                    Math.max(
                                      0,
                                      Math.floor(
                                        (source / assetDuration) *
                                          preview.peaks!.length,
                                      ),
                                    ),
                                  )
                                ] ?? 0;
                              return (
                                <rect
                                  key={index}
                                  x={index * 2}
                                  y={20 - Math.max(1, peak * 19)}
                                  width={1.4}
                                  height={Math.max(2, peak * 38)}
                                  fill="#86efac"
                                />
                              );
                            })}
                          </svg>
                        ) : null}
                        {duration * pxPerFrame >= 96 && <button
                          type="button"
                          className="editor-clip-delete"
                          aria-label={`${t("Delete")} ${item.name}`}
                          title={t("Delete")}
                          disabled={disabled || track.locked || (selectedSet.has(item.id) && !!deleteDisabledReason)}
                          onPointerDown={event => event.stopPropagation()}
                          onKeyDown={event => event.stopPropagation()}
                          onClick={event => { event.stopPropagation(); onDeleteItem(item.id); }}
                        ><Trash2 size={14} /></button>}
                        <span className="editor-clip-name pointer-events-none relative z-10 ml-1.5 min-w-0 truncate rounded bg-black/40 px-1">
                          {item.name}
                        </span>
                        <button
                          aria-label={`Trim end of ${item.name}`}
                          aria-describedby={keyboardHelpId}
                          aria-keyshortcuts="ArrowLeft ArrowRight Shift+ArrowLeft Shift+ArrowRight"
                          onKeyDown={event => keyboardTrim(event, item, "end")}
                          onClick={() => onSelect(item.id)}
                          data-trim-handle="end"
                          disabled={disabled || track.locked || !!item.visualizerSourceItemId || timingLockedIds.has(item.id)}
                          className="absolute inset-y-0 right-0 w-2 cursor-ew-resize bg-black/20 hover:bg-white/40"
                          onPointerDown={(event) => begin(event, item, "end")}
                          onPointerMove={move}
                          onPointerUp={finish}
                        />
                      </div>
                    );
                  })}
                  {index.tracks.has(track.id) && !disabled && !track.locked && (
                    <button
                      className="absolute right-2 top-4 text-[10px] text-[var(--editor-muted)] hover:text-[var(--editor-text)]"
                      onPointerDown={(event) => event.stopPropagation()}
                      onClick={() => onRemoveGap(track.id, readPlayhead())}
                      title="Close the gap at the playhead"
                    >
                      {t("Close gap")}
                    </button>
                  )}
                </div>
              );
            })}
            </div>
            <EditorTimelinePlayhead pxPerFrame={pxPerFrame} frame={frame} />
          </div>
        </div>
      </div>
    </section>
  );
}
