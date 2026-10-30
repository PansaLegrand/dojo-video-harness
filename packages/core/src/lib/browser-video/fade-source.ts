import { openLocalVideo, releaseVideo, waitForMedia } from "./local-media";
import type { LocalVideo } from "./rotate-video";

export type FadeSource =
  | { kind: "video"; media: LocalVideo }
  | { kind: "audio"; buffer: AudioBuffer; duration: number };

export async function readFadeSource(
  file: File,
  url: string,
  signal: AbortSignal,
): Promise<FadeSource> {
  const isVideo =
    file.type.startsWith("video/") ||
    (!file.type.startsWith("audio/") &&
      /\.(mp4|mov|webm|mkv|m4v)$/i.test(file.name));
  if (file.size > (isVideo ? 250 : 50) * 1024 * 1024)
    throw new Error("File too large");
  if (isVideo) {
    const element = await openLocalVideo(url, signal);
    try {
      if (element.duration > 600) throw new Error("Video too long");
      const { Input, BlobSource, ALL_FORMATS } = await import("mediabunny");
      const input = new Input({
        formats: ALL_FORMATS,
        source: new BlobSource(file),
      });
      try {
        if (!(await input.getPrimaryAudioTrack()))
          throw new Error("No audio track");
      } finally {
        input.dispose();
      }
      return {
        kind: "video",
        media: {
          url,
          width: element.videoWidth,
          height: element.videoHeight,
          duration: element.duration,
        },
      };
    } finally {
      releaseVideo(element);
    }
  }
  const element = document.createElement("audio");
  element.preload = "auto";
  try {
    await waitForMedia(element, "loadeddata", signal, () => {
      element.src = url;
    });
    if (
      !Number.isFinite(element.duration) ||
      element.duration <= 0 ||
      element.duration > 600
    )
      throw new Error("Invalid audio duration");
  } finally {
    releaseVideo(element);
  }
  if (signal.aborted) throw new DOMException("Cancelled", "AbortError");
  const { Input, BlobSource, ALL_FORMATS } = await import("mediabunny");
  const input = new Input({
    formats: ALL_FORMATS,
    source: new BlobSource(file),
  });
  try {
    const track = await input.getPrimaryAudioTrack();
    if (
      !track ||
      (await track.getNumberOfChannels()) > 2 ||
      (await track.getSampleRate()) > 96000
    )
      throw new Error("Unsupported audio format");
  } finally {
    input.dispose();
  }
  if (signal.aborted) throw new DOMException("Cancelled", "AbortError");
  const context = new AudioContext({ sampleRate: 48000 });
  try {
    const bytes = await file.arrayBuffer();
    if (signal.aborted) throw new DOMException("Cancelled", "AbortError");
    const buffer = await new Promise<AudioBuffer>((resolve, reject) => {
      const cleanup = () => {
        clearTimeout(timer);
        signal.removeEventListener("abort", aborted);
      };
      const aborted = () => {
        cleanup();
        reject(new DOMException("Cancelled", "AbortError"));
      };
      const timer = setTimeout(() => {
        cleanup();
        reject(new Error("Audio decode timed out"));
      }, 30_000);
      signal.addEventListener("abort", aborted, { once: true });
      if (signal.aborted) {
        aborted();
        return;
      }
      context.decodeAudioData(bytes).then(
        (buffer) => {
          cleanup();
          resolve(buffer);
        },
        (error) => {
          cleanup();
          reject(error);
        },
      );
    });
    if (buffer.duration > 600 || buffer.numberOfChannels > 2)
      throw new Error("Unsupported audio size");
    return { kind: "audio", buffer, duration: buffer.duration };
  } finally {
    await context.close();
  }
}
