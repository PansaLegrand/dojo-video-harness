import { EDITOR_MEDIA_ADMISSION, inspectEditorVideo, probeOriginalAudioTrack, type AdmittedEditorVideo } from "@/lib/dojo-video-engine-browser/media-admission";

export const EDITOR_MEDIA_ACCEPT = "video/*,audio/*,image/*";
export const EDITOR_MAX_FILE_BYTES = EDITOR_MEDIA_ADMISSION.maxFileBytes;

export async function editorRequest<T>(
  url: string,
  init?: RequestInit,
): Promise<T> {
  const response = await fetch(url, init);
  const body = await response.json().catch(() => null);
  if (!response.ok || !body?.success) {
    const error = new Error(
      body?.message || body?.error || `Request failed (${response.status}).`,
    );
    Object.assign(error, { status: response.status });
    throw error;
  }
  return body.data as T;
}

export async function probeEditorMedia(
  file: File,
  signal?: AbortSignal,
): Promise<{
  type: "video" | "audio" | "image";
  duration?: number;
  width?: number;
  height?: number;
  mediaMetadata?: AdmittedEditorVideo["mediaMetadata"];
  requiresProxy?: boolean;
}> {
  signal?.throwIfAborted();
  const type = file.type.startsWith("video/")
    ? "video"
    : file.type.startsWith("audio/")
      ? "audio"
      : file.type.startsWith("image/")
        ? "image"
        : null;
  if (!type) throw new Error("Choose a video, audio or image file.");
  if (file.size > EDITOR_MAX_FILE_BYTES)
    throw new Error("Choose a file smaller than 250 MB.");
  if (type === "video") return inspectEditorVideo(file, signal);
  const url = URL.createObjectURL(file);
  try {
    if (type === "image") {
      const image = new Image();
      try {
        await new Promise<void>((resolve, reject) => {
          const cleanup = () => { clearTimeout(timeout); signal?.removeEventListener("abort", abort); };
          const abort = () => { cleanup(); image.removeAttribute("src"); reject(signal?.reason ?? new DOMException("Import cancelled.", "AbortError")); };
          const timeout = setTimeout(() => { cleanup(); image.removeAttribute("src"); reject(new Error("This browser could not read the image file.")); }, 15000);
          signal?.addEventListener("abort", abort, { once: true });
          if (signal?.aborted) { abort(); return; }
          image.src = url;
          Promise.resolve().then(() => { signal?.throwIfAborted(); return image.decode(); }).then(() => { cleanup(); resolve(); }, error => { cleanup(); reject(error); });
        });
        signal?.throwIfAborted();
        return { type, width: image.naturalWidth, height: image.naturalHeight };
      } finally { image.removeAttribute("src"); }
    }
    return await new Promise((resolve, reject) => {
      const media = document.createElement(type);
      const cleanup = () => {
        clearTimeout(timeout);
        media.onloadedmetadata = null;
        media.onerror = null;
        signal?.removeEventListener("abort", abort);
        media.removeAttribute("src");
        media.load();
      };
      const abort = () => { cleanup(); reject(signal?.reason ?? new DOMException("Import cancelled.", "AbortError")); };
      const timeout = setTimeout(() => {
        cleanup();
        reject(new Error("This browser could not read the media file."));
      }, 15000);
      media.preload = "metadata";
      signal?.addEventListener("abort", abort, { once: true });
      if (signal?.aborted) { abort(); return; }
      media.onloadedmetadata = async () => {
        const duration = media.duration;
        const width =
          media instanceof HTMLVideoElement ? media.videoWidth : undefined;
        const height =
          media instanceof HTMLVideoElement ? media.videoHeight : undefined;
        cleanup();
        if (!Number.isFinite(duration) || duration <= 0) {
          reject(new Error("The media file has no readable duration."));
          return;
        }
        try {
          const hasAudio = await probeOriginalAudioTrack(file, signal);
          signal?.throwIfAborted();
          resolve({ type, duration, ...(width ? { width, height } : {}), ...(hasAudio === undefined ? {} : { mediaMetadata: { hasAudio } }) });
        } catch (error) { reject(error); }
      };
      media.onerror = () => {
        cleanup();
        reject(
          new Error("This media format cannot be played in your browser."),
        );
      };
      media.src = url;
    });
  } finally {
    URL.revokeObjectURL(url);
  }
}
