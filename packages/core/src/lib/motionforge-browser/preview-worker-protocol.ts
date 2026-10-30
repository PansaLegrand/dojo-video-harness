import { fontFamilyNames, inspectScene, type Scene } from "@motionforge/schema";

export type MotionForgePreviewWorkerRequest =
  | {
      type: "init" | "update";
      requestId: number;
      revision: number;
      scene: Scene;
      width: number;
      height: number;
    }
  | { type: "render"; requestId: number; revision: number; frame: number }
  | { type: "cancel"; requestId: number }
  | { type: "dispose" };

export type MotionForgePreviewWorkerResponse =
  | { type: "ready"; requestId: number; revision: number }
  | {
      type: "frame";
      requestId: number;
      revision: number;
      frame: number;
      bitmap: ImageBitmap;
    }
  | { type: "cancelled"; requestId: number }
  | { type: "error"; requestId: number; message: string; name: string };

/**
 * Audio stays on the established main-thread player until its assets/mixer can
 * be shared with a worker without opening the media twice. Never silently drop
 * sound merely because a video does not declare whether it has an audio track.
 */
export function motionForgePreviewWorkerSceneBlockers(scene: Scene): string[] {
  const inspection = inspectScene(scene);
  const reasons: string[] = [];
  if (inspection.capabilities.hasFonts)
    reasons.push("font_loading_requires_main_thread");
  if (inspection.capabilities.hasLottie)
    reasons.push("lottie_requires_main_thread");
  if (inspection.capabilities.hasExtensions)
    reasons.push("extension_registry_requires_main_thread");
  const nodes = [...scene.nodes];
  while (nodes.length) {
    const node = nodes.pop()!;
    const fontFamilies = [
      node.style?.fontFamily,
      ...(node.animations ?? [])
        .filter((animation) => animation.property === "fontFamily")
        .flatMap((animation) => animation.frames.map((frame) => frame.value)),
    ];
    if (
      !reasons.includes("font_loading_requires_main_thread") &&
      fontFamilies.some(
        (family) =>
          typeof family === "string" &&
          fontFamilyNames(family).some(
            (name) => !GENERIC_FONT_FAMILIES.has(name.toLowerCase()),
          ),
      )
    )
      reasons.push("font_loading_requires_main_thread");
    if (
      node.type === "audio" ||
      (node.type === "video" &&
        node.volume !== 0 &&
        scene.assets[node.assetId ?? ""]?.metadata?.hasAudio !== false)
    ) {
      reasons.push("audio_preview_requires_main_thread");
      break;
    }
    nodes.push(...(node.children ?? []));
  }
  return reasons;
}

// Document-loaded CSS fonts are invisible in a fresh worker, even when no
// Scene font asset declares them. Start conservatively with generic families.
const GENERIC_FONT_FAMILIES = new Set([
  "serif",
  "sans-serif",
  "monospace",
  "cursive",
  "fantasy",
  "system-ui",
  "ui-serif",
  "ui-sans-serif",
  "ui-monospace",
  "ui-rounded",
  "math",
  "fangsong",
]);

export function planMotionForgeWorkerPreview(
  scene: Scene,
  runtime: Partial<typeof globalThis> = globalThis,
): { eligible: boolean; reasons: string[] } {
  const reasons = motionForgePreviewWorkerSceneBlockers(scene);
  if (typeof runtime.Worker !== "function") reasons.push("worker_unavailable");
  if (typeof runtime.OffscreenCanvas !== "function")
    reasons.push("offscreen_canvas_unavailable");
  else if (
    typeof runtime.OffscreenCanvas.prototype?.transferToImageBitmap !==
    "function"
  )
    reasons.push("transferable_bitmap_unavailable");
  return { eligible: reasons.length === 0, reasons };
}

export function previewAbortError(message: string): Error {
  return new DOMException(message, "AbortError");
}
