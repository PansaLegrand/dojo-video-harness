import { useEffect, useMemo, useRef, useState } from "react";
import {
  DojoVideoEngineCanvasPreview,
  type DojoVideoEngineCanvasPreviewHandle,
} from "@/components/dojo-video-engine/dojo-video-engine-canvas-preview";
import {
  compileVideoProjectDocument,
  type VideoProjectDocument,
} from "@/lib/video-project/document";
import type { Scene, SceneNodeInput } from "@dojo-video-engine/schema";
import type { NativeReviewDetails } from "@/lib/video-project/agent-authoring";
import type { VideoSourceResolution } from "@/lib/video-project/types";
import type { VideoProjectAgentRun } from "@/lib/video-project/agent-types";
import { useNativeEditorText } from "./native-editor-copy";

export type NativeAgentComparison = {
  review: NativeReviewDetails;
  beforeDocument: VideoProjectDocument;
  afterDocument: VideoProjectDocument;
  applied: boolean;
  run: VideoProjectAgentRun;
  sources: VideoSourceResolution[];
};
function silence(scene: Scene): Scene {
  const mute = (node: SceneNodeInput): SceneNodeInput => ({
    ...node,
    ...(["video", "audio"].includes(node.type) ? { volume: 0 } : {}),
    children: node.children?.map(mute),
  });
  return { ...scene, nodes: scene.nodes.map(mute) } as Scene;
}
const seconds = (scene: Scene) => scene.duration / scene.fps;
const frameAt = (scene: Scene, ms: number) =>
  Math.max(
    0,
    Math.min(scene.duration - 1, Math.round((ms * scene.fps) / 1000)),
  );

/** The two immutable review versions share composition time; one is always silent. */
export function EditorAgentReview({
  comparison,
  sources,
  stale,
  applying,
  onClose,
  onRefresh,
  onApply,
  onSeekFrame,
  onPausePreview,
  mainPreviewPlaying = false,
}: {
  comparison: NativeAgentComparison;
  sources: Record<string, string>;
  stale: boolean;
  applying: boolean;
  onClose: () => void;
  onRefresh: () => void;
  onApply: () => void;
  onSeekFrame?: (frame: number) => void;
  onPausePreview?: () => void;
  mainPreviewPlaying?: boolean;
}) {
  const t = useNativeEditorText(),
    dialog = useRef<HTMLDialogElement>(null),
    before = useRef<DojoVideoEngineCanvasPreviewHandle>(null),
    after = useRef<DojoVideoEngineCanvasPreviewHandle>(null);
  const [audible, setAudible] = useState<"before" | "after">("after");
  const [timeMs, setTimeMs] = useState(comparison.review.focusTimeMs),
    [playing, setPlaying] = useState(false);
  const [wantPlay, setWantPlay] = useState(false);
  const [ready, setReady] = useState({ before: false, after: false }),
    [painted, setPainted] = useState({ before: 0, after: 0 });
  const playingRef = useRef(false),
    audibleRef = useRef(audible);
  audibleRef.current = audible;
  const desiredTime = useRef(comparison.review.focusTimeMs),
    basis = useRef(comparison.review.basis);
  if (basis.current !== comparison.review.basis) {
    basis.current = comparison.review.basis;
    desiredTime.current = comparison.review.focusTimeMs;
  }
  const scenePair = useMemo<
    { before: Scene; after: Scene } | { error: string }
  >(() => {
    try {
      const resolved = {
        ...Object.fromEntries(
          comparison.sources
            .filter((source) => source.url)
            .map((source) => [source.sourceId, source.url!]),
        ),
        ...sources,
      };
      const old = compileVideoProjectDocument(
        comparison.beforeDocument,
        resolved,
        { sourceMap: false },
      ).scene;
      const next = compileVideoProjectDocument(
        comparison.afterDocument,
        resolved,
        { sourceMap: false },
      ).scene;
      return {
        before: audible === "before" ? old : silence(old),
        after: audible === "after" ? next : silence(next),
      };
    } catch (cause) {
      return {
        error:
          cause instanceof Error
            ? cause.message
            : "Review is unavailable for this request.",
      };
    }
  }, [comparison, sources, audible]);
  const pause = () => {
    playingRef.current = false;
    setPlaying(false);
    setWantPlay(false);
    before.current?.pause();
    after.current?.pause();
  };
  const seek = (ms: number) => {
    pause();
    desiredTime.current = ms;
    setTimeMs(ms);
    if (!("error" in scenePair)) {
      before.current?.seek(frameAt(scenePair.before, ms));
      after.current?.seek(frameAt(scenePair.after, ms));
    }
  };
  useEffect(() => {
    onPausePreview?.();
    dialog.current?.showModal();
    return () => {
      before.current?.pause();
      after.current?.pause();
    };
  }, []);
  useEffect(() => {
    if (stale || mainPreviewPlaying) pause();
  }, [stale, mainPreviewPlaying]);
  useEffect(() => {
    if (ready.before && ready.after) seek(desiredTime.current);
  }, [ready.before, ready.after, scenePair]);
  useEffect(() => {
    seek(comparison.review.focusTimeMs);
  }, [comparison]);
  useEffect(() => {
    if (
      !wantPlay ||
      stale ||
      !ready.before ||
      !ready.after ||
      "error" in scenePair
    )
      return;
    if (
      painted.before !== frameAt(scenePair.before, desiredTime.current) ||
      painted.after !== frameAt(scenePair.after, desiredTime.current)
    )
      return;
    onPausePreview?.();
    playingRef.current = true;
    setPlaying(true);
    setWantPlay(false);
    (audible === "before" ? before : after).current?.play();
  }, [wantPlay, stale, ready, painted, scenePair, audible]);
  const maximum =
    "error" in scenePair
      ? 0
      : Math.max(seconds(scenePair.before), seconds(scenePair.after)) * 1000;
  const frame = (side: "before" | "after", value: number) => {
    setPainted((current) =>
      current[side] === value ? current : { ...current, [side]: value },
    );
    if (
      !playingRef.current ||
      side !== audibleRef.current ||
      "error" in scenePair
    )
      return;
    const ms = (value * 1000) / scenePair[side].fps;
    desiredTime.current = ms;
    setTimeMs(ms);
    const other = side === "before" ? "after" : "before";
    (other === "before" ? before : after).current?.seek(
      frameAt(scenePair[other], ms),
    );
  };
  return (
    <dialog
      role="dialog"
      ref={dialog}
      className="editor-agent-review"
      aria-label={t("Review this edit")}
      onKeyDown={(event) => {
        if (event.code === "Space" || event.key === " ")
          event.stopPropagation();
      }}
      onKeyUp={(event) => {
        if (event.code === "Space" || event.key === " ")
          event.stopPropagation();
      }}
      onCancel={(event) => {
        event.preventDefault();
        pause();
        onClose();
      }}
    >
      <header>
        <div>
          <h2>{t("Review this edit")}</h2>
          <p>{comparison.run.proposal?.summary}</p>
        </div>
        <button
          type="button"
          className="editor-secondary-button"
          aria-label={t("Close comparison")}
          onClick={() => {
            pause();
            onClose();
          }}
        >
          ×
        </button>
      </header>
      {stale && (
        <p role="status" className="editor-authoring-notice">
          {t("This comparison changed. Refresh it before applying.")}{" "}
          <button type="button" onClick={onRefresh}>
            {t("Refresh comparison")}
          </button>
        </p>
      )}
      {"error" in scenePair ? (
        <p role="alert">{t(scenePair.error)}</p>
      ) : (
        <>
          <div className="editor-agent-review-pair">
            {(["before", "after"] as const).map((side) => (
              <section
                key={side}
                data-review-side={side}
                data-review-frame={painted[side]}
              >
                <h3>{t(side === "before" ? "Before" : "After")}</h3>
                <div className="editor-agent-review-canvas">
                  <DojoVideoEngineCanvasPreview
                    ref={side === "before" ? before : after}
                    scene={scenePair[side]}
                    title={t(side === "before" ? "Before" : "After")}
                    compact
                    showControls={false}
                    onFrame={(value) => frame(side, value)}
                    onPlaybackStateChange={(state) => {
                      const loaded =
                        state.status === "ready" || state.status === "playing";
                      setReady((current) =>
                        current[side] === loaded
                          ? current
                          : { ...current, [side]: loaded },
                      );
                      if (
                        playingRef.current &&
                        audibleRef.current === side &&
                        state.status === "ready" &&
                        !state.playing
                      )
                        pause();
                    }}
                  />
                  {timeMs >= seconds(scenePair[side]) * 1000 && (
                    <div className="editor-agent-review-empty">
                      {t("No content at this time")}
                    </div>
                  )}
                </div>
              </section>
            ))}
          </div>
          <div className="editor-agent-review-controls">
            <button
              type="button"
              className="editor-secondary-button"
              disabled={!ready.before || !ready.after || stale || wantPlay}
              onClick={() => {
                if (playing) {
                  pause();
                  return;
                }
                if (
                  timeMs >=
                  ((scenePair[audible].duration - 1) * 1000) /
                    scenePair[audible].fps
                )
                  seek(
                    Math.min(
                      comparison.review.focusTimeMs,
                      Math.max(
                        0,
                        seconds(scenePair[audible]) * 1000 -
                          1000 / scenePair[audible].fps,
                      ),
                    ),
                  );
                setWantPlay(true);
              }}
            >
              {t(playing ? "Pause comparison" : "Play comparison")}
            </button>
            <input
              aria-label={t("Comparison position")}
              type="range"
              min={0}
              max={Math.max(0, maximum - 1)}
              step={Math.max(
                1,
                1000 / Math.max(scenePair.before.fps, scenePair.after.fps),
              )}
              value={Math.min(timeMs, Math.max(0, maximum - 1))}
              onChange={(event) => seek(Number(event.target.value))}
            />
            <output>{(timeMs / 1000).toFixed(2)} s</output>
          </div>
          <div className="editor-agent-review-actions">
            <button
              type="button"
              className="editor-secondary-button"
              aria-pressed={audible === "before"}
              onClick={() => {
                pause();
                setAudible("before");
              }}
            >
              {t("Listen to before")}
            </button>
            <button
              type="button"
              className="editor-secondary-button"
              aria-pressed={audible === "after"}
              onClick={() => {
                pause();
                setAudible("after");
              }}
            >
              {t("Listen to after")}
            </button>
            <button
              type="button"
              className="editor-secondary-button"
              onClick={() => {
                seek(comparison.review.focusTimeMs);
                onSeekFrame?.(
                  Math.round(
                    (comparison.review.focusTimeMs *
                      comparison.review.before.fps) /
                      1000,
                  ),
                );
              }}
            >
              {t("Preview changed moment")}
            </button>
          </div>
        </>
      )}
      <footer>
        <span>
          {t("Affected clips")}: {comparison.review.changedItemIds.length}
          {comparison.review.propagatedItemIds.length
            ? ` · ${t("Linked changes")}: ${comparison.review.propagatedItemIds.length}`
            : ""}
        </span>
        {!comparison.applied && (
          <button
            type="button"
            className="editor-primary-button"
            disabled={stale || applying || "error" in scenePair}
            onClick={onApply}
          >
            {t("Apply changes")}
          </button>
        )}
      </footer>
    </dialog>
  );
}
