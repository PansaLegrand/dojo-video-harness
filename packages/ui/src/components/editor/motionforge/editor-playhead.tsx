import {
  createContext,
  useCallback,
  useContext,
  useSyncExternalStore,
  type ReactNode,
} from "react";
import type { VideoWorkspaceController } from "@/lib/video-project/client-controller";

type PlayheadSource = Pick<
  VideoWorkspaceController,
  "getPlayheadFrame" | "subscribePlayhead"
>;
const PlayheadContext = createContext<PlayheadSource | null>(null);
const noSubscription = () => () => {};

export function EditorPlayheadProvider({
  controller,
  children,
}: {
  controller: PlayheadSource;
  children: ReactNode;
}) {
  return (
    <PlayheadContext.Provider value={controller}>
      {children}
    </PlayheadContext.Provider>
  );
}

/** Actions read the current frame without subscribing their entire UI. */
export function useEditorPlayheadReader(fallbackFrame = 0) {
  const source = useContext(PlayheadContext);
  return useCallback(
    () => source?.getPlayheadFrame() ?? fallbackFrame,
    [source, fallbackFrame],
  );
}

function usePlayheadSnapshot<Value>(
  select: (frame: number) => Value,
  fallbackFrame: number,
) {
  const source = useContext(PlayheadContext);
  const readFrame = useEditorPlayheadReader(fallbackFrame);
  const snapshot = useCallback(() => select(readFrame()), [select, readFrame]);
  return useSyncExternalStore(
    source?.subscribePlayhead ?? noSubscription,
    snapshot,
    snapshot,
  );
}

const identityFrame = (frame: number) => frame;

export function EditorPlayheadTime({
  fps,
  endFrame,
  className,
  frame = 0,
}: {
  fps: number;
  endFrame?: number;
  className?: string;
  frame?: number;
}) {
  const current = usePlayheadSnapshot(identityFrame, frame);
  return (
    <span className={className}>
      {endFrame === undefined
        ? `${(current / fps).toFixed(2)} s`
        : `${(current / fps).toFixed(2)}s / ${(endFrame / fps).toFixed(2)}s · ${fps} fps`}
    </span>
  );
}

export function EditorTimelinePlayhead({
  pxPerFrame,
  head = false,
  frame = 0,
}: {
  pxPerFrame: number;
  head?: boolean;
  frame?: number;
}) {
  const current = usePlayheadSnapshot(identityFrame, frame);
  return (
    <div
      className={
        head
          ? "pointer-events-none absolute top-0 h-3 w-3 rotate-45 bg-rose-400"
          : "pointer-events-none absolute inset-y-0 z-10 w-px bg-rose-400"
      }
      style={{ left: current * pxPerFrame - (head ? 6 : 0) }}
    />
  );
}

/** Only cue boundary crossings update this wrapper; its form children stay stable. */
export function EditorCaptionActiveCue({
  from,
  fps,
  startMs,
  endMs,
  frame = 0,
  children,
}: {
  from: number;
  fps: number;
  startMs: number;
  endMs: number;
  frame?: number;
  children: ReactNode;
}) {
  const select = useCallback(
    (current: number) => {
      const at = ((current - from) * 1000) / fps;
      return at >= startMs && at < endMs;
    },
    [from, fps, startMs, endMs],
  );
  const active = usePlayheadSnapshot(select, frame);
  return <div data-active={active}>{children}</div>;
}
