import { useCallback, useEffect, useRef, useState } from "react";
import {
  MediaPreviewAttempts,
  readEditorAudioPeaks,
} from "@/lib/motionforge-browser/media-peaks";
import type { EditorAsset, EditorDocument } from "@/lib/editor/document";
import { requiresLocalVideoProxy } from "@/lib/motionforge-browser/preview-proxy-policy";
import {
  retainReadyPreviewProxy,
  subscribePreviewProxyReady,
} from "@/lib/motionforge-browser/preview-proxy-client";

export type EditorMediaPreview = {
  frames?: Array<{ seconds: number; src: string }>;
  peaks?: number[];
  error?: string;
  retry?: () => void;
};

async function videoFilmstrip(src: string, signal: AbortSignal) {
  const video = document.createElement("video");
  video.crossOrigin = "anonymous";
  video.muted = true;
  video.preload = "auto";
  function wait(event: "loadedmetadata" | "seeked") {
    return new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(
        () => finish(new Error("Thumbnail timed out.")),
        10000,
      );
      const cleanup = () => {
        clearTimeout(timeout);
        video.removeEventListener(event, success);
        video.removeEventListener("error", failure);
        signal.removeEventListener("abort", abort);
      };
      const finish = (error?: Error) => {
        cleanup();
        error ? reject(error) : resolve();
      };
      const success = () => finish();
      const failure = () => finish(new Error("Thumbnail unavailable."));
      const abort = () => finish(new DOMException("Aborted", "AbortError"));
      video.addEventListener(event, success, { once: true });
      video.addEventListener("error", failure, { once: true });
      signal.addEventListener("abort", abort, { once: true });
      if (signal.aborted) abort();
    });
  }
  try {
    const loaded = wait("loadedmetadata");
    video.src = src;
    await loaded;
    if (!Number.isFinite(video.duration)) return [];
    const canvas = document.createElement("canvas");
    if (!video.videoWidth || !video.videoHeight) return [];
    const scale = Math.min(
      1,
      160 / Math.max(video.videoWidth, video.videoHeight),
    );
    canvas.width = Math.max(1, Math.round(video.videoWidth * scale));
    canvas.height = Math.max(1, Math.round(video.videoHeight * scale));
    const context = canvas.getContext("2d");
    if (!context) return [];
    const result: Array<{ seconds: number; src: string }> = [];
    for (let i = 0; i < 6; i++) {
      if (signal.aborted) break;
      const seconds = Math.min(
        Math.max(0.01, (video.duration * (i + 0.1)) / 6),
        video.duration - 0.001,
      );
      const sought = wait("seeked");
      video.currentTime = seconds;
      await sought;
      context.drawImage(video, 0, 0, canvas.width, canvas.height);
      result.push({ seconds, src: canvas.toDataURL("image/jpeg", 0.65) });
    }
    return result;
  } finally {
    video.pause();
    video.removeAttribute("src");
    video.load();
  }
}

/** Thumbnails borrow an existing verified 4K proxy; they never compete with its
 * converter or silently open an original high-resolution video element. */
export async function readEditorVideoFilmstrip(
  asset: EditorAsset,
  src: string,
  signal: AbortSignal,
) {
  if (!requiresLocalVideoProxy(asset)) return videoFilmstrip(src, signal);
  const proxy = retainReadyPreviewProxy(asset.id, src);
  if (!proxy) return undefined;
  try {
    return await videoFilmstrip(proxy.url, signal);
  } finally {
    proxy.release();
  }
}

export function useEditorMediaPreviews(
  document: EditorDocument | null,
  sources: Record<string, string>,
) {
  const [previews, setPreviews] = useState<Record<string, EditorMediaPreview>>(
    {},
  );
  const attempts = useRef(new MediaPreviewAttempts<EditorMediaPreview>());
  const [retryVersion, setRetryVersion] = useState(0);
  const retry = useCallback((id: string) => {
    attempts.current.retry(id);
    setRetryVersion((value) => value + 1);
  }, []);
  const media = Object.values(document?.assets ?? {}).filter(
    (asset) => asset.type === "video" || asset.type === "audio",
  );
  const signature = media
    .map(
      (asset) =>
        `${asset.id}:${sources[asset.id] ?? sources[asset.assetId ?? asset.id] ?? ""}`,
    )
    .join("|");
  useEffect(() => {
    const abort = new AbortController();
    const unsubscribe = subscribePreviewProxyReady((request) => {
      if (
        media.some(
          (asset) =>
            asset.id === request.assetId &&
            requiresLocalVideoProxy(asset) &&
            (sources[asset.id] ?? sources[asset.assetId ?? asset.id]) ===
              request.src,
        )
      )
        retry(request.assetId);
    });
    const ids = new Set(media.map((asset) => asset.id));
    attempts.current.retain(ids);
    setPreviews((current) =>
      Object.fromEntries(Object.entries(current).filter(([id]) => ids.has(id))),
    );
    void (async () => {
      // Serialize thumbnail work so importing several files never opens a decoder storm.
      for (const asset of media) {
        const src = sources[asset.id] ?? sources[asset.assetId ?? asset.id];
        if (!src || attempts.current.get(asset.id, src)) continue;
        setPreviews((current) => ({ ...current, [asset.id]: {} }));
        try {
          let preview: EditorMediaPreview;
          if (asset.type === "video") {
            const frames = await readEditorVideoFilmstrip(
              asset,
              src,
              abort.signal,
            );
            if (!frames) continue;
            preview = { frames };
          } else
            preview = { peaks: await readEditorAudioPeaks(src, abort.signal) };
          if (abort.signal.aborted) return;
          attempts.current.set(asset.id, {
            source: src,
            status: "ready",
            value: preview,
          });
          setPreviews((current) => ({ ...current, [asset.id]: preview }));
        } catch (cause) {
          if (abort.signal.aborted) return;
          const error =
            cause instanceof Error ? cause.message : "Preview unavailable.";
          attempts.current.set(asset.id, {
            source: src,
            status: "failed",
            error,
          });
          setPreviews((current) => ({
            ...current,
            [asset.id]: { error, retry: () => retry(asset.id) },
          }));
        }
      }
    })();
    return () => {
      abort.abort();
      unsubscribe();
    };
    // Asset edits never regenerate thumbnails; only the source inventory changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [signature, retryVersion, retry]);
  return previews;
}
