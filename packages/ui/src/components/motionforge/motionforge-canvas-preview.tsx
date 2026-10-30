import React from "react";
import { Pause, Play, RotateCcw } from "lucide-react";
import type { Player } from "@motionforge/player";
import { MotionForgePreviewSession } from "@/lib/motionforge-browser/preview-session";
import { PreviewSeekQueue } from "@/lib/motionforge-browser/preview-seek";
import { previewResolution } from "@/lib/motionforge-browser/preview-resolution";
import { MotionForgePreviewProxyManager } from "@/lib/motionforge-browser/preview-proxy-client";
import {
  assertPreviewCaptureBasis,
  captureOriginalMotionForgeFrame,
} from "@/lib/motionforge-browser/preview-proxy-capture";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { Scene } from "@motionforge/schema";
import {
  ActiveLayerBoundsIndex,
  CANVAS_KEYBOARD_HELP,
  MAX_CANVAS_HIT_TARGETS,
  keyboardLayerBounds,
  resizeLayerBounds,
  type ResizeHandle,
  type MotionForgeLayerBounds,
} from "@/lib/motionforge-browser/layer-bounds";

export type { MotionForgeLayerBounds };

export type PlaybackStatus = "loading" | "ready" | "playing" | "error";

const PLAYBACK_STATE_UPDATE_INTERVAL_MS = 125;

export type MotionForgeCanvasPreviewHandle = {
  togglePlayback: () => void;
  play: () => void;
  pause: () => void;
  seek: (frame: number) => void;
  restart: () => void;
  captureFrame: (
    frame: number,
  ) => Promise<{ frame: number; imageDataUrl: string }>;
};

export type MotionForgeCanvasPreviewProps = {
  labels?: Partial<MotionForgePreviewLabels>;
  /** Product-owned names for selection overlays and accessible controls. */
  getLayerName?: (id: string) => string;
  isLayerSelectable?: (id: string) => boolean;
  /** Every rendered frame, without the controls' React-state throttle. */
  onFrame?: (frame: number) => void;
  scene: Scene;
  title: string;
  showControls?: boolean;
  /** Fit lightweight utility previews without the editor's minimum stage height. */
  compact?: boolean;
  selectedLayerId?: string | null;
  boundsLocked?: boolean;
  onSelectLayer?: (id: string) => void;
  onLayerBoundsChange?: (id: string, bounds: MotionForgeLayerBounds) => void;
  onLayerBoundsPreview?: (
    id: string,
    bounds: MotionForgeLayerBounds | null,
  ) => void;
  /** Keeps remote document adoption outside a held keyboard gesture. */
  onLayerKeyboardInteraction?: (active: boolean) => void;
  onPreviewError?: (message: string | null) => void;
  onPlaybackStateChange?: (state: {
    frame: number;
    playing: boolean;
    status: PlaybackStatus;
  }) => void;
};

export type MotionForgePreviewLabels = {
  loading: string;
  canvasUnavailable: string;
  playerUnavailable: string;
  play: string;
  pause: string;
  restart: string;
  frameStatus: (frame: number, total: number) => string;
  selectLayer: (name: string) => string;
  resizeLayer: (name: string) => string;
  resizeLayerHandle: (name: string, handle: string) => string;
  moveLayer?: (name: string) => string;
  keyboardHelp?: string;
  advancedBounds?: string;
  moreLayers?: string;
};

const DEFAULT_LABELS: Required<MotionForgePreviewLabels> = {
  loading: "Preparing preview…",
  canvasUnavailable: "Canvas preview is unavailable in this browser.",
  playerUnavailable: "The preview could not be prepared.",
  play: "Play",
  pause: "Pause",
  restart: "Restart preview",
  frameStatus: (frame, total) => `Frame ${frame} / ${total}`,
  selectLayer: (name) => `Select ${name}`,
  resizeLayer: (name) => `Resize ${name}`,
  resizeLayerHandle: (name, handle) => `Resize ${name}: ${handle}`,
  moveLayer: (name) => `Move ${name}`,
  keyboardHelp: CANVAS_KEYBOARD_HELP,
  advancedBounds:
    "Use the inspector to edit animated or transformed dimensions.",
  moreLayers: "More layers are available in the inspector.",
};

export const MotionForgeCanvasPreview = React.forwardRef<
  MotionForgeCanvasPreviewHandle,
  MotionForgeCanvasPreviewProps
>(function MotionForgeCanvasPreview(
  {
    scene,
    title,
    labels,
    getLayerName,
    isLayerSelectable,
    onFrame,
    showControls = true,
    compact = false,
    selectedLayerId = null,
    boundsLocked = false,
    onSelectLayer,
    onLayerBoundsChange,
    onLayerBoundsPreview,
    onLayerKeyboardInteraction,
    onPreviewError,
    onPlaybackStateChange,
  },
  ref,
) {
  const messages = React.useMemo(
    () => ({ ...DEFAULT_LABELS, ...labels }),
    [labels],
  );
  const layerName = (id: string) => getLayerName?.(id) || id;
  const canvasRef = React.useRef<HTMLCanvasElement | null>(null);
  // Player preparation and frame-zero initialization must never clear the visible frame.
  const renderCanvasRef = React.useRef<HTMLCanvasElement | null>(null);
  const hasPaintedRef = React.useRef(false);
  const [hasPainted, setHasPainted] = React.useState(false);
  const stageRef = React.useRef<HTMLDivElement | null>(null);
  const previewFrameRef = React.useRef<HTMLDivElement | null>(null);
  const playerRef = React.useRef<Player | null>(null);
  const seekQueueRef = React.useRef<PreviewSeekQueue | null>(null);
  const sessionRef = React.useRef<MotionForgePreviewSession | null>(null);
  const onFrameRef = React.useRef(onFrame);
  onFrameRef.current = onFrame;
  const playbackSnapshotRef = React.useRef({
    frame: 0,
    playing: false,
  });
  const proxyManagerRef = React.useRef<MotionForgePreviewProxyManager | null>(
    null,
  );
  const originalSceneRef = React.useRef(scene);
  originalSceneRef.current = scene;
  const captureInProgressRef = React.useRef(false);
  const [proxyRevision, setProxyRevision] = React.useState(0);
  const playbackStatusRef = React.useRef<PlaybackStatus>("loading");
  const onPlaybackStateChangeRef = React.useRef(onPlaybackStateChange);
  const onPreviewErrorRef = React.useRef(onPreviewError);
  const lastPlaybackStateUpdateRef = React.useRef(0);
  const pendingPlaybackStateUpdateRef = React.useRef<number | null>(null);
  const [status, setStatus] = React.useState<PlaybackStatus>("loading");
  const [frame, setFrame] = React.useState(0);
  React.useEffect(() => {
    const manager = new MotionForgePreviewProxyManager(() => {
      if (!playbackSnapshotRef.current.playing && !captureInProgressRef.current)
        setProxyRevision(manager.revision);
    });
    proxyManagerRef.current = manager;
    return () => {
      proxyManagerRef.current = null;
      manager.dispose();
    };
  }, []);
  React.useEffect(() => {
    const manager = proxyManagerRef.current;
    manager?.updateScene(scene, playbackSnapshotRef.current.playing);
    if (
      manager &&
      !playbackSnapshotRef.current.playing &&
      !captureInProgressRef.current
    )
      setProxyRevision(manager.revision);
  }, [scene, status]);
  const previewScene = React.useMemo(
    () => proxyManagerRef.current?.scene(scene) ?? scene,
    [scene, proxyRevision],
  );
  // The selection overlay is derived from client-only canvas text measurement,
  // so its geometry (and z-order) differs from the server render. Gate it behind
  // mount to avoid a hydration mismatch; it is an interactive, client-only layer
  // anyway (measurement + pointer drag).
  const [mounted, setMounted] = React.useState(false);
  const [stageSize, setStageSize] = React.useState({
    width: 0,
    height: 0,
  });
  const [previewViewport, setPreviewViewport] = React.useState({
    width: 0,
    height: 0,
  });
  const backingSize = previewResolution(
    scene,
    previewViewport,
    typeof window === "undefined" ? 1 : window.devicePixelRatio,
  );
  React.useEffect(() => {
    const element = previewFrameRef.current;
    if (!element) return;
    let timer: ReturnType<typeof setTimeout>;
    const measure = () => {
      clearTimeout(timer);
      timer = setTimeout(() => {
        const { width, height } = element.getBoundingClientRect();
        setPreviewViewport((previous) =>
          previous.width === Math.round(width) &&
          previous.height === Math.round(height)
            ? previous
            : { width: Math.round(width), height: Math.round(height) },
        );
      }, 100);
    };
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    measure();
    return () => {
      clearTimeout(timer);
      observer.disconnect();
    };
  }, []);
  const [dragState, setDragState] = React.useState<{
    id: string;
    mode: "move" | "resize";
    handle?: ResizeHandle;
    pointerId: number;
    startClientX: number;
    startClientY: number;
    initialBounds: MotionForgeLayerBounds;
    previewBounds: MotionForgeLayerBounds;
  } | null>(null);
  const needsLayerOverlays = Boolean(
    onSelectLayer || selectedLayerId || onLayerBoundsChange,
  );
  const layerIndex = React.useMemo(
    () => (needsLayerOverlays ? new ActiveLayerBoundsIndex(scene) : null),
    [scene, needsLayerOverlays],
  );
  const selectedNode = selectedLayerId
    ? (layerIndex?.nodes.get(selectedLayerId) ?? null)
    : null;
  const selectableBounds = React.useMemo(
    () => (layerIndex && status !== "playing" ? layerIndex.at(frame) : []),
    [layerIndex, frame, status],
  );
  const boundsById = React.useMemo(
    () => new Map(selectableBounds.map((value) => [value.id, value])),
    [selectableBounds],
  );
  const hitTargets = selectableBounds.filter(
    (value) =>
      value.id !== selectedLayerId &&
      (!isLayerSelectable || isLayerSelectable(value.id)),
  );
  const selectedLayer = selectedLayerId
    ? boundsById.get(selectedLayerId)
    : undefined;
  const selectedBounds = selectedLayer?.bounds ?? null;
  const [keyboardBounds, setKeyboardBounds] =
    React.useState<MotionForgeLayerBounds | null>(null);
  const keyboardGesture = React.useRef<{
    id: string;
    initial: MotionForgeLayerBounds;
    preview: MotionForgeLayerBounds;
    parent: MotionForgeLayerBounds;
    keys: Set<string>;
  } | null>(null);
  const keyboardHelpId = React.useId();
  const moveSurfaceRef = React.useRef<HTMLDivElement>(null);
  const focusSelectedRef = React.useRef<string | null>(null);
  const displayedBounds =
    dragState?.previewBounds ?? keyboardBounds ?? selectedBounds;
  const canEditBounds = Boolean(
    !boundsLocked &&
      selectedLayerId &&
      selectedNode &&
      selectedNode.type !== "audio" &&
      selectedLayer?.editable &&
      onLayerBoundsChange,
  );
  const parentBlockById = React.useMemo(
    () =>
      new Map(selectableBounds.map((value) => [value.id, value.parentBlock])),
    [selectableBounds],
  );
  const overlayVisible =
    mounted && hasPainted && status !== "playing" && status !== "error";

  React.useEffect(() => {
    if (focusSelectedRef.current && selectedLayer) {
      moveSurfaceRef.current?.focus();
      focusSelectedRef.current = null;
    }
  }, [selectedLayerId, selectedLayer]);

  React.useEffect(() => {
    setMounted(true);
  }, []);

  React.useEffect(() => {
    onPlaybackStateChangeRef.current = onPlaybackStateChange;
  }, [onPlaybackStateChange]);

  React.useEffect(() => {
    onPreviewErrorRef.current = onPreviewError;
  }, [onPreviewError]);

  const reportPreviewError = React.useCallback((message: string | null) => {
    onPreviewErrorRef.current?.(message);
  }, []);

  const clearPendingPlaybackStateUpdate = React.useCallback(() => {
    if (pendingPlaybackStateUpdateRef.current === null) {
      return;
    }

    window.clearTimeout(pendingPlaybackStateUpdateRef.current);
    pendingPlaybackStateUpdateRef.current = null;
  }, []);

  const publishPlaybackState = React.useCallback(
    (immediate = false) => {
      const flush = () => {
        pendingPlaybackStateUpdateRef.current = null;
        lastPlaybackStateUpdateRef.current = performance.now();
        const latestFrame = playbackSnapshotRef.current.frame;

        setFrame((currentFrame) =>
          currentFrame === latestFrame ? currentFrame : latestFrame,
        );
        onPlaybackStateChangeRef.current?.({
          frame: latestFrame,
          playing:
            playbackStatusRef.current === "loading"
              ? playbackSnapshotRef.current.playing
              : playbackStatusRef.current === "playing",
          status: playbackStatusRef.current,
        });
      };

      if (immediate) {
        clearPendingPlaybackStateUpdate();
        flush();
        return;
      }

      const now = performance.now();
      const elapsed = now - lastPlaybackStateUpdateRef.current;

      if (elapsed >= PLAYBACK_STATE_UPDATE_INTERVAL_MS) {
        clearPendingPlaybackStateUpdate();
        flush();
        return;
      }

      if (pendingPlaybackStateUpdateRef.current !== null) {
        return;
      }

      pendingPlaybackStateUpdateRef.current = window.setTimeout(
        flush,
        PLAYBACK_STATE_UPDATE_INTERVAL_MS - elapsed,
      );
    },
    [clearPendingPlaybackStateUpdate],
  );

  const updateStatus = React.useCallback(
    (nextStatus: PlaybackStatus, immediate = true) => {
      playbackStatusRef.current = nextStatus;
      setStatus(nextStatus);
      publishPlaybackState(immediate);
    },
    [publishPlaybackState],
  );

  React.useEffect(() => {
    const stageElement = stageRef.current;
    if (!stageElement) return;

    let animationFrame = 0;

    const updateStageSize = () => {
      window.cancelAnimationFrame(animationFrame);
      animationFrame = window.requestAnimationFrame(() => {
        const bounds = stageElement.getBoundingClientRect();
        const nextSize = {
          width: Math.max(0, Math.floor(bounds.width)),
          height: Math.max(0, Math.floor(bounds.height)),
        };
        setStageSize((currentSize) =>
          currentSize.width === nextSize.width &&
          currentSize.height === nextSize.height
            ? currentSize
            : nextSize,
        );
      });
    };

    updateStageSize();
    const resizeObserver = new ResizeObserver(updateStageSize);
    resizeObserver.observe(stageElement);
    window.addEventListener("resize", updateStageSize);
    return () => {
      window.cancelAnimationFrame(animationFrame);
      resizeObserver.disconnect();
      window.removeEventListener("resize", updateStageSize);
    };
  }, [showControls]);

  React.useEffect(() => {
    let cancelled = false;
    const canvas = canvasRef.current;

    async function setupPlayer() {
      if (!canvas) return;

      const previousPlayer = playerRef.current;
      const restoreFrame = Math.max(
        0,
        Math.min(scene.duration - 1, playbackSnapshotRef.current.frame),
      );
      updateStatus("loading");
      reportPreviewError(null);
      seekQueueRef.current?.dispose();
      seekQueueRef.current = null;
      previousPlayer?.dispose();
      playerRef.current = null;

      const requiredProxy = proxyManagerRef.current?.readiness(scene);
      if (requiredProxy && requiredProxy.status !== "ready") {
        playbackSnapshotRef.current.playing = false;
        proxyManagerRef.current?.setPlaying(false);
        // Release superseded decoder/cache pins before preparing another large
        // original. A failed derivative must never silently decode 4K here.
        const previousSession = sessionRef.current;
        sessionRef.current = null;
        await previousSession?.disposeAsync();
        if (cancelled) return;
        if (requiredProxy.status === "error") {
          reportPreviewError(
            requiredProxy.message ?? messages.playerUnavailable,
          );
          updateStatus("error");
        } else updateStatus("loading");
        publishPlaybackState(true);
        return;
      }

      const renderCanvas =
        renderCanvasRef.current ?? canvas.ownerDocument.createElement("canvas");
      renderCanvasRef.current = renderCanvas;
      if (renderCanvas.width !== backingSize.width)
        renderCanvas.width = backingSize.width;
      if (renderCanvas.height !== backingSize.height)
        renderCanvas.height = backingSize.height;
      const context = renderCanvas.getContext("2d");
      const displayContext = canvas.getContext("2d");

      if (!context || !displayContext) {
        reportPreviewError(messages.canvasUnavailable);
        updateStatus("error");
        return;
      }

      context.setTransform(
        backingSize.width / scene.width,
        0,
        0,
        backingSize.height / scene.height,
        0,
        0,
      );

      try {
        const session =
          sessionRef.current ??
          new MotionForgePreviewSession({
            context,
            loop: true,
          });
        sessionRef.current = session;
        const player = await session.setScene(
          previewScene,
          proxyManagerRef.current?.retainScene(previewScene),
        );
        if (cancelled || !player) return;

        playerRef.current = player;
        seekQueueRef.current = new PreviewSeekQueue((frame) =>
          player.seek(frame),
        );

        player.on("frame", (nextFrame) => {
          if (cancelled || playerRef.current !== player) return;
          // Resize and present synchronously, only after the requested frame is complete.
          if (canvas.width !== renderCanvas.width)
            canvas.width = renderCanvas.width;
          if (canvas.height !== renderCanvas.height)
            canvas.height = renderCanvas.height;
          displayContext.save();
          displayContext.setTransform(1, 0, 0, 1, 0, 0);
          displayContext.globalCompositeOperation = "copy";
          displayContext.drawImage(renderCanvas, 0, 0);
          displayContext.restore();
          if (!hasPaintedRef.current) {
            hasPaintedRef.current = true;
            setHasPainted(true);
          }
          playbackSnapshotRef.current.frame = nextFrame;
          onFrameRef.current?.(nextFrame);
          publishPlaybackState();
        });
        player.on("play", () => {
          if (cancelled || playerRef.current !== player) return;
          playbackSnapshotRef.current.playing = true;
          proxyManagerRef.current?.setPlaying(true);
          updateStatus("playing");
        });
        player.on("pause", () => {
          if (cancelled || playerRef.current !== player) return;
          playbackSnapshotRef.current.playing = false;
          proxyManagerRef.current?.setPlaying(false);
          updateStatus("ready");
        });
        player.on("ended", () => {
          if (cancelled || playerRef.current !== player) return;
          playbackSnapshotRef.current.playing = false;
          proxyManagerRef.current?.setPlaying(false);
          updateStatus("ready");
        });

        player.onError((cause) => {
          if (cancelled) return;
          if (previewScene !== scene && proxyManagerRef.current) {
            proxyManagerRef.current.rejectScene(previewScene);
            setProxyRevision(proxyManagerRef.current.revision);
            return;
          }
          reportPreviewError(cause.message);
          updateStatus("error");
        });
        await player.seek(restoreFrame);
        if (cancelled) {
          player.dispose();
          return;
        }

        playbackSnapshotRef.current.frame = restoreFrame;
        publishPlaybackState(true);
        if (playbackSnapshotRef.current.playing) {
          player.play();
        } else {
          playbackSnapshotRef.current.playing = false;
          updateStatus("ready");
        }
      } catch (cause) {
        if (cancelled) return;
        if (previewScene !== scene && proxyManagerRef.current) {
          proxyManagerRef.current.rejectScene(previewScene);
          setProxyRevision(proxyManagerRef.current.revision);
          return;
        }
        reportPreviewError(
          cause instanceof Error ? cause.message : messages.playerUnavailable,
        );
        updateStatus("error");
      }
    }

    void setupPlayer();

    return () => {
      cancelled = true;
      clearPendingPlaybackStateUpdate();
      const player = playerRef.current;
      // A superseded player may still be at its offscreen initialization frame.
      // Only presented-frame events may replace the user's retained playhead.
      seekQueueRef.current?.dispose();
      seekQueueRef.current = null;
      player?.dispose();
      playerRef.current = null;
      sessionRef.current?.cancelPending();
    };
  }, [
    clearPendingPlaybackStateUpdate,
    publishPlaybackState,
    reportPreviewError,
    scene,
    previewScene,
    proxyRevision,
    backingSize.width,
    backingSize.height,
    messages.canvasUnavailable,
    messages.playerUnavailable,
    updateStatus,
  ]);

  React.useEffect(
    () => () => {
      const session = sessionRef.current;
      sessionRef.current = null;
      const renderCanvas = renderCanvasRef.current;
      renderCanvasRef.current = null;
      void session
        ?.disposeAsync()
        .catch(() => undefined)
        .finally(() => {
          if (renderCanvas) {
            renderCanvas.width = 0;
            renderCanvas.height = 0;
          }
        });
    },
    [],
  );

  const togglePlayback = React.useCallback(() => {
    const player = playerRef.current;
    if (!player || status === "loading" || status === "error") return;

    if (player.playing) {
      player.pause();
      return;
    }

    playbackSnapshotRef.current.playing = true;
    player.play();
  }, [status]);

  const seek = React.useCallback(
    (nextFrame: number) => {
      const player = playerRef.current;
      if (!player || status === "loading" || status === "error") return;

      const clampedFrame = Math.max(
        0,
        Math.min(scene.duration - 1, Math.round(nextFrame)),
      );
      void seekQueueRef
        .current!.seek(clampedFrame)
        .then((presented) => {
          if (!presented || playerRef.current !== player) return;
          playbackSnapshotRef.current.frame = clampedFrame;
          publishPlaybackState(true);
        })
        .catch((cause) => {
          if (playerRef.current !== player) return;
          reportPreviewError(
            cause instanceof Error ? cause.message : messages.playerUnavailable,
          );
          updateStatus("error");
        });
    },
    [
      publishPlaybackState,
      scene.duration,
      status,
      reportPreviewError,
      messages.playerUnavailable,
      updateStatus,
    ],
  );

  const restart = React.useCallback(() => {
    const player = playerRef.current;
    if (!player || status === "loading" || status === "error") return;

    void (seekQueueRef.current?.clearPending() ?? Promise.resolve())
      .then(() => {
        if (playerRef.current !== player) return;
        return player.seek(0);
      })
      .then(() => {
        if (playerRef.current !== player) return;
        playbackSnapshotRef.current = {
          frame: 0,
          playing: true,
        };
        publishPlaybackState(true);
        player.play();
      })
      .catch((cause) => {
        if (playerRef.current !== player) return;
        reportPreviewError(
          cause instanceof Error ? cause.message : messages.playerUnavailable,
        );
        updateStatus("error");
      });
  }, [
    publishPlaybackState,
    status,
    reportPreviewError,
    messages.playerUnavailable,
    updateStatus,
  ]);

  const progress =
    scene.duration > 1
      ? Math.min(100, (frame / (scene.duration - 1)) * 100)
      : 0;
  const sceneAspectRatio = scene.width / Math.max(1, scene.height);
  const frameStyle: React.CSSProperties = showControls
    ? {
        aspectRatio: `${scene.width} / ${scene.height}`,
        ...(compact
          ? { width: "100%", maxWidth: `calc(60vh * ${sceneAspectRatio})` }
          : {}),
      }
    : {
        aspectRatio: `${scene.width} / ${scene.height}`,
        width:
          stageSize.width > 0 && stageSize.height > 0
            ? Math.min(stageSize.width, stageSize.height * sceneAspectRatio)
            : undefined,
        height:
          stageSize.width > 0 && stageSize.height > 0
            ? Math.min(stageSize.height, stageSize.width / sceneAspectRatio)
            : "100%",
      };

  React.useImperativeHandle(
    ref,
    () => ({
      togglePlayback,
      play: () => {
        playbackSnapshotRef.current.playing = true;
        if (playbackStatusRef.current !== "loading") playerRef.current?.play();
      },
      pause: () => {
        playbackSnapshotRef.current.playing = false;
        playerRef.current?.pause();
      },
      seek,
      restart,
      captureFrame: async (frame: number) => {
        const player = playerRef.current;
        const canvas = canvasRef.current;
        if (!player || !canvas)
          throw new Error(
            "Wait for the preview to finish preparing before including its frame.",
          );
        const original = originalSceneRef.current;
        const assertBasis = () =>
          assertPreviewCaptureBasis(
            { scene: original, player },
            { scene: originalSceneRef.current, player: playerRef.current },
          );
        captureInProgressRef.current = true;
        try {
          player.pause();
          await seekQueueRef.current?.clearPending();
          assertBasis();
          await player.seek(frame);
          assertBasis();
          let captured: { frame: number; imageDataUrl: string };
          if (Object.values(player.scene.assets).some((asset) => asset.proxy)) {
            captured = await captureOriginalMotionForgeFrame(
              original,
              frame,
              canvas.ownerDocument,
            );
          } else {
            const thumbnail = canvas.ownerDocument.createElement("canvas");
            const ratio = Math.min(
              1,
              640 / Math.max(canvas.width, canvas.height),
            );
            thumbnail.width = Math.max(1, Math.round(canvas.width * ratio));
            thumbnail.height = Math.max(1, Math.round(canvas.height * ratio));
            const target = thumbnail.getContext("2d");
            if (!target)
              throw new Error("This browser cannot capture a preview frame.");
            target.drawImage(canvas, 0, 0, thumbnail.width, thumbnail.height);
            captured = {
              frame: player.currentFrame,
              imageDataUrl: thumbnail.toDataURL("image/jpeg", 0.8),
            };
            if (captured.imageDataUrl.length > 500_000)
              throw new Error(
                "The preview image is too large to include in this request.",
              );
          }
          assertBasis();
          return captured;
        } finally {
          captureInProgressRef.current = false;
          if (proxyManagerRef.current)
            setProxyRevision(proxyManagerRef.current.revision);
        }
      },
    }),
    [restart, seek, togglePlayback],
  );

  const toLocalBounds = (
    bounds: MotionForgeLayerBounds,
    parent: MotionForgeLayerBounds,
  ) => ({
    ...bounds,
    left: bounds.left - parent.left,
    top: bounds.top - parent.top,
  });
  const finishKeyboardGesture = React.useCallback(
    (commit: boolean) => {
      const gesture = keyboardGesture.current;
      if (!gesture) return;
      keyboardGesture.current = null;
      setKeyboardBounds(null);
      if (
        commit &&
        !boundsLocked &&
        gesture.id === selectedLayerId &&
        Object.keys(gesture.initial).some(
          (key) =>
            gesture.initial[key as keyof MotionForgeLayerBounds] !==
            gesture.preview[key as keyof MotionForgeLayerBounds],
        )
      ) {
        onLayerBoundsChange?.(
          gesture.id,
          toLocalBounds(gesture.preview, gesture.parent),
        );
      }
      onLayerBoundsPreview?.(gesture.id, null);
      onLayerKeyboardInteraction?.(false);
    },
    [
      onLayerKeyboardInteraction,
      boundsLocked,
      selectedLayerId,
      onLayerBoundsChange,
      onLayerBoundsPreview,
    ],
  );
  const cancelBoundsGesture = React.useCallback(() => {
    finishKeyboardGesture(false);
    if (dragState) onLayerBoundsPreview?.(dragState.id, null);
    setDragState(null);
  }, [finishKeyboardGesture, dragState, selectedLayerId, onLayerBoundsPreview]);
  React.useEffect(() => {
    if (
      keyboardGesture.current &&
      (keyboardGesture.current.id !== selectedLayerId ||
        !canEditBounds ||
        status === "playing")
    )
      finishKeyboardGesture(false);
    if (
      dragState &&
      (dragState.id !== selectedLayerId ||
        !canEditBounds ||
        status === "playing")
    )
      cancelBoundsGesture();
  }, [
    selectedLayerId,
    canEditBounds,
    status,
    finishKeyboardGesture,
    cancelBoundsGesture,
    dragState,
  ]);
  const boundsKeyDown = (
    event: React.KeyboardEvent<HTMLElement>,
    handle?: ResizeHandle,
  ) => {
    if (
      event.target !== event.currentTarget ||
      event.defaultPrevented ||
      event.nativeEvent.isComposing ||
      event.keyCode === 229
    )
      return;
    if (event.key === "Escape" && (keyboardGesture.current || dragState)) {
      event.preventDefault();
      event.stopPropagation();
      cancelBoundsGesture();
      return;
    }
    if (event.key === "Enter" && keyboardGesture.current) {
      event.preventDefault();
      event.stopPropagation();
      finishKeyboardGesture(true);
      return;
    }
    if (
      !canEditBounds ||
      !displayedBounds ||
      !selectedLayerId ||
      !selectedLayer ||
      dragState
    )
      return;
    const bounds = keyboardLayerBounds(
      { ...event, isComposing: event.nativeEvent.isComposing },
      keyboardGesture.current?.preview ?? displayedBounds,
      handle,
    );
    if (!bounds) return;
    event.preventDefault();
    event.stopPropagation();
    playerRef.current?.pause();
    if (!keyboardGesture.current) onLayerKeyboardInteraction?.(true);
    const gesture = keyboardGesture.current ?? {
      id: selectedLayerId,
      initial: displayedBounds,
      preview: displayedBounds,
      parent: selectedLayer.parentBlock,
      keys: new Set<string>(),
    };
    gesture.preview = bounds;
    gesture.keys.add(event.key);
    keyboardGesture.current = gesture;
    setKeyboardBounds(bounds);
    onLayerBoundsPreview?.(gesture.id, toLocalBounds(bounds, gesture.parent));
  };
  const gestureCleanup = React.useRef({
    onLayerBoundsPreview,
    onLayerKeyboardInteraction,
  });
  gestureCleanup.current = { onLayerBoundsPreview, onLayerKeyboardInteraction };
  React.useEffect(
    () => () => {
      const gesture = keyboardGesture.current;
      if (gesture) {
        keyboardGesture.current = null;
        gestureCleanup.current.onLayerBoundsPreview?.(gesture.id, null);
        gestureCleanup.current.onLayerKeyboardInteraction?.(false);
      }
    },
    [],
  );
  React.useEffect(() => {
    const finish = () => finishKeyboardGesture(true);
    window.addEventListener("blur", finish);
    return () => window.removeEventListener("blur", finish);
  }, [finishKeyboardGesture]);
  const boundsKeyUp = (event: React.KeyboardEvent<HTMLElement>) => {
    const gesture = keyboardGesture.current;
    if (
      event.target !== event.currentTarget ||
      !gesture ||
      !gesture.keys.has(event.key)
    )
      return;
    event.preventDefault();
    event.stopPropagation();
    gesture.keys.delete(event.key);
    if (!gesture.keys.size) finishKeyboardGesture(true);
  };

  const beginBoundsDrag = React.useCallback(
    (
      event: React.PointerEvent<HTMLElement>,
      mode: "move" | "resize",
      handle?: ResizeHandle,
    ) => {
      if (event.button !== 0 || !canEditBounds || !displayedBounds) return;

      event.preventDefault();
      event.stopPropagation();
      finishKeyboardGesture(true);
      event.currentTarget.focus();
      playerRef.current?.pause();
      event.currentTarget.setPointerCapture(event.pointerId);
      setDragState({
        id: selectedLayerId!,
        mode,
        handle,
        pointerId: event.pointerId,
        startClientX: event.clientX,
        startClientY: event.clientY,
        initialBounds: displayedBounds,
        previewBounds: displayedBounds,
      });
    },
    [canEditBounds, displayedBounds, finishKeyboardGesture, selectedLayerId],
  );

  const updateBoundsDrag = React.useCallback(
    (event: React.PointerEvent<HTMLElement>) => {
      if (!dragState || dragState.pointerId !== event.pointerId) return;

      event.preventDefault();
      event.stopPropagation();
      const frameElement = previewFrameRef.current;
      if (!frameElement) return;

      const rect = frameElement.getBoundingClientRect();
      const deltaX =
        ((event.clientX - dragState.startClientX) / rect.width) * scene.width;
      const deltaY =
        ((event.clientY - dragState.startClientY) / rect.height) * scene.height;
      const nextBounds =
        dragState.mode === "resize" && dragState.handle
          ? resizeLayerBounds(
              dragState.initialBounds,
              dragState.handle,
              deltaX,
              deltaY,
            )
          : {
              ...dragState.initialBounds,
              left: Math.round(dragState.initialBounds.left + deltaX),
              top: Math.round(dragState.initialBounds.top + deltaY),
            };

      setDragState({
        ...dragState,
        previewBounds: nextBounds,
      });
      if (selectedLayerId) {
        const parent = parentBlockById.get(selectedLayerId);
        onLayerBoundsPreview?.(
          selectedLayerId,
          parent
            ? {
                ...nextBounds,
                left: nextBounds.left - parent.left,
                top: nextBounds.top - parent.top,
              }
            : nextBounds,
        );
      }
    },
    [
      dragState,
      scene.height,
      scene.width,
      selectedLayerId,
      parentBlockById,
      onLayerBoundsPreview,
    ],
  );

  const endBoundsDrag = React.useCallback(
    (event: React.PointerEvent<HTMLElement>) => {
      if (!dragState || dragState.pointerId !== event.pointerId) return;

      event.preventDefault();
      event.stopPropagation();
      if (event.currentTarget.hasPointerCapture(event.pointerId)) {
        event.currentTarget.releasePointerCapture(event.pointerId);
      }

      if (selectedLayerId) {
        // previewBounds is absolute (scene) space; style.left/top are relative
        // to the node's parent, so convert back before writing or a nested node
        // jumps by its parent's offset.
        const parent = parentBlockById.get(selectedLayerId);
        const preview = dragState.previewBounds;
        const localBounds = parent
          ? {
              left: preview.left - parent.left,
              top: preview.top - parent.top,
              width: preview.width,
              height: preview.height,
            }
          : preview;
        if (
          canEditBounds &&
          dragState.id === selectedLayerId &&
          Object.keys(preview).some(
            (key) =>
              preview[key as keyof MotionForgeLayerBounds] !==
              dragState.initialBounds[key as keyof MotionForgeLayerBounds],
          )
        )
          onLayerBoundsChange?.(selectedLayerId, localBounds);
        onLayerBoundsPreview?.(dragState.id, null);
      }

      setDragState(null);
    },
    [
      canEditBounds,
      dragState,
      onLayerBoundsChange,
      onLayerBoundsPreview,
      parentBlockById,
      selectedLayerId,
    ],
  );

  return (
    <div
      className={cn(
        "flex w-full min-h-0 flex-col gap-3",
        showControls && compact ? "h-auto" : "h-full",
      )}
    >
      <div
        ref={stageRef}
        className="flex min-h-0 flex-1 items-center justify-center"
      >
        <div
          ref={previewFrameRef}
          className={cn(
            "relative overflow-hidden border border-border/80 bg-[#f4f3ee] shadow-soft",
            showControls
              ? compact
                ? "w-full rounded-lg"
                : "h-full max-h-[78vh] min-h-[500px] rounded-lg"
              : "max-h-full max-w-full rounded-[4px]",
          )}
          style={frameStyle}
        >
          <canvas
            ref={canvasRef}
            aria-label={title}
            className="absolute inset-0 h-full w-full bg-[#f4f3ee] object-contain"
          />
          <span id={keyboardHelpId} className="sr-only">
            {messages.keyboardHelp}
          </span>
          {overlayVisible && hitTargets.length > MAX_CANVAS_HIT_TARGETS && (
            <span
              role="status"
              className="pointer-events-none absolute bottom-1 left-1 z-[1001] rounded bg-background/90 px-2 py-1 text-xs text-muted-foreground"
            >
              {messages.moreLayers}
            </span>
          )}
          {overlayVisible &&
            onSelectLayer &&
            hitTargets
              .slice(-MAX_CANVAS_HIT_TARGETS)
              .map(({ id, bounds }, index) =>
                // The selected layer is driven by the selection overlay below;
                // rendering its click target here would sit over the move surface
                // and steal the drag.
                id === selectedLayerId ? null : (
                  <button
                    key={id}
                    type="button"
                    aria-label={messages.selectLayer(layerName(id))}
                    title={messages.selectLayer(layerName(id))}
                    className="absolute cursor-pointer bg-transparent outline-none transition focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 focus-visible:ring-offset-[#f4f3ee]"
                    style={{
                      left: `${(bounds.left / scene.width) * 100}%`,
                      top: `${(bounds.top / scene.height) * 100}%`,
                      width: `${(bounds.width / scene.width) * 100}%`,
                      height: `${(bounds.height / scene.height) * 100}%`,
                      // Kept below the selection overlay (z 1000) so a selected
                      // layer's move/resize surface always wins the pointer.
                      zIndex: Math.min(5 + index, 900),
                    }}
                    data-layer-target={id}
                    onClick={() => {
                      focusSelectedRef.current = id;
                      onSelectLayer(id);
                    }}
                  />
                ),
              )}
          {overlayVisible &&
            selectedLayerId &&
            selectedNode &&
            displayedBounds &&
            selectedNode.type !== "audio" && (
              <div className="pointer-events-none absolute inset-0 z-[1000]">
                <div
                  className="absolute rounded-sm bg-primary px-1.5 py-0.5 text-[10px] font-semibold text-primary-foreground shadow-sm"
                  style={{
                    left: `${(displayedBounds.left / scene.width) * 100}%`,
                    top: `${Math.max(0, (displayedBounds.top / scene.height) * 100 - 4)}%`,
                  }}
                >
                  {layerName(selectedLayerId)}
                </div>
                <div
                  ref={moveSurfaceRef}
                  role="group"
                  tabIndex={canEditBounds ? 0 : -1}
                  aria-label={messages.moveLayer(layerName(selectedLayerId))}
                  aria-disabled={!canEditBounds}
                  aria-describedby={keyboardHelpId}
                  aria-keyshortcuts="ArrowLeft ArrowRight ArrowUp ArrowDown Shift+ArrowLeft Shift+ArrowRight Shift+ArrowUp Shift+ArrowDown Escape"
                  data-layer-selection={selectedLayerId}
                  title={
                    canEditBounds
                      ? messages.keyboardHelp
                      : messages.advancedBounds
                  }
                  onKeyDown={(event) => boundsKeyDown(event)}
                  onKeyUp={boundsKeyUp}
                  onBlur={(event) => {
                    if (event.target === event.currentTarget)
                      finishKeyboardGesture(true);
                  }}
                  className={cn(
                    "absolute border-2 border-primary shadow-[0_0_0_1px_rgba(0,0,0,0.28)]",
                    canEditBounds &&
                      "pointer-events-auto cursor-move touch-none",
                  )}
                  style={{
                    left: `${(displayedBounds.left / scene.width) * 100}%`,
                    top: `${(displayedBounds.top / scene.height) * 100}%`,
                    width: `${(displayedBounds.width / scene.width) * 100}%`,
                    height: `${(displayedBounds.height / scene.height) * 100}%`,
                  }}
                  onPointerDown={(event) => beginBoundsDrag(event, "move")}
                  onPointerMove={updateBoundsDrag}
                  onPointerUp={endBoundsDrag}
                  onPointerCancel={cancelBoundsGesture}
                >
                  {canEditBounds &&
                    RESIZE_HANDLES.map(({ handle, className }) => (
                      <button
                        key={handle}
                        type="button"
                        aria-label={messages.resizeLayerHandle(
                          layerName(selectedLayerId),
                          handle,
                        )}
                        title={messages.resizeLayer(layerName(selectedLayerId))}
                        data-layer-resize={handle}
                        aria-describedby={keyboardHelpId}
                        onKeyDown={(event) => boundsKeyDown(event, handle)}
                        onKeyUp={boundsKeyUp}
                        onBlur={() => finishKeyboardGesture(true)}
                        className={cn(
                          "absolute z-10 h-3 w-3 rounded-sm border border-background bg-primary shadow touch-none",
                          className,
                        )}
                        onPointerDown={(event) =>
                          beginBoundsDrag(event, "resize", handle)
                        }
                        onPointerMove={updateBoundsDrag}
                        onPointerUp={endBoundsDrag}
                        onPointerCancel={cancelBoundsGesture}
                      />
                    ))}
                </div>
              </div>
            )}
          {status === "loading" && !hasPainted && (
            <div className="absolute inset-0 grid place-items-center bg-background/70 text-sm font-medium text-muted-foreground backdrop-blur-sm">
              {messages.loading}
            </div>
          )}
        </div>
      </div>

      {showControls && (
        <div className="rounded-lg border border-border/80 bg-background p-3">
          <div className="mb-3 h-2 overflow-hidden rounded-full bg-muted">
            <div
              className="h-full rounded-full bg-primary transition-[width]"
              style={{ width: `${progress}%` }}
            />
          </div>
          <div className="flex items-center justify-between gap-3">
            <p className="text-xs font-medium text-muted-foreground">
              {messages.frameStatus(frame, Math.max(scene.duration - 1, 0))}
            </p>
            <div className="flex items-center gap-2">
              <Button
                type="button"
                size="icon"
                variant="outline"
                onClick={restart}
                disabled={status === "loading" || status === "error"}
                aria-label={messages.restart}
              >
                <RotateCcw className="h-4 w-4" />
              </Button>
              <Button
                type="button"
                size="sm"
                onClick={togglePlayback}
                disabled={status === "loading" || status === "error"}
              >
                {status === "playing" ? (
                  <Pause className="h-4 w-4" />
                ) : (
                  <Play className="h-4 w-4" />
                )}
                {status === "playing" ? messages.pause : messages.play}
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
});

const RESIZE_HANDLES: Array<{ handle: ResizeHandle; className: string }> = [
  { handle: "nw", className: "-left-1.5 -top-1.5 cursor-nwse-resize" },
  {
    handle: "n",
    className: "left-1/2 -top-1.5 -translate-x-1/2 cursor-ns-resize",
  },
  { handle: "ne", className: "-right-1.5 -top-1.5 cursor-nesw-resize" },
  {
    handle: "e",
    className: "-right-1.5 top-1/2 -translate-y-1/2 cursor-ew-resize",
  },
  { handle: "se", className: "-bottom-1.5 -right-1.5 cursor-nwse-resize" },
  {
    handle: "s",
    className: "bottom-[-6px] left-1/2 -translate-x-1/2 cursor-ns-resize",
  },
  { handle: "sw", className: "-bottom-1.5 -left-1.5 cursor-nesw-resize" },
  {
    handle: "w",
    className: "-left-1.5 top-1/2 -translate-y-1/2 cursor-ew-resize",
  },
];
