export class LocalMediaError extends Error {}

export function waitForMedia(
  video: HTMLMediaElement,
  event: "loadeddata" | "seeked",
  signal: AbortSignal,
  action: () => void,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const cleanup = () => {
      clearTimeout(timer);
      video.removeEventListener(event, done);
      video.removeEventListener("error", failed);
      signal.removeEventListener("abort", aborted);
    };
    const done = () => {
      cleanup();
      resolve();
    };
    const failed = () => {
      cleanup();
      reject(new LocalMediaError("Cannot decode this video"));
    };
    const aborted = () => {
      cleanup();
      reject(new DOMException("Cancelled", "AbortError"));
    };
    const timer = setTimeout(failed, 20_000);
    video.addEventListener(event, done, { once: true });
    video.addEventListener("error", failed, { once: true });
    signal.addEventListener("abort", aborted, { once: true });
    if (signal.aborted) aborted();
    else {
      try {
        action();
      } catch {
        failed();
      }
    }
  });
}

export async function openLocalVideo(url: string, signal: AbortSignal) {
  const video = document.createElement("video");
  video.muted = true;
  video.playsInline = true;
  video.preload = "auto";
  try {
    await waitForMedia(video, "loadeddata", signal, () => {
      video.src = url;
    });
    if (
      ![video.videoWidth, video.videoHeight, video.duration].every(
        (n) => Number.isFinite(n) && n > 0,
      )
    ) {
      throw new LocalMediaError("Invalid video metadata");
    }
    return video;
  } catch (error) {
    releaseVideo(video);
    throw error;
  }
}

export function releaseVideo(video: HTMLMediaElement) {
  video.pause();
  video.removeAttribute("src");
  video.load();
}

export function downloadBaseName(name: string) {
  return (
    name
      .replace(/\.[^/.]+$/, "")
      .replace(/[^\p{L}\p{N}_-]+/gu, "-")
      .slice(0, 100) || "video"
  );
}
