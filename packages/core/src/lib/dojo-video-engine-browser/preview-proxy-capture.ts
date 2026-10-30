import type { Scene } from "@dojo-video-engine/schema";
import { DojoVideoEnginePreviewSession } from "./preview-session";
import { canScalePreview } from "./preview-resolution";

export function assertPreviewCaptureBasis(
  expected: { scene: Scene; player: object },
  current: { scene: Scene; player: object | null },
) {
  if (current.scene !== expected.scene || current.player !== expected.player)
    throw new Error(
      "The preview changed while capturing. Retry with the latest frame.",
    );
}

/** Explicit evidence capture always resolves original media, never a preview derivative. */
export async function captureOriginalDojoVideoEngineFrame(
  scene: Scene,
  frame: number,
  ownerDocument: Document = document,
) {
  const scaleRender = canScalePreview(scene);
  if (
    !scaleRender &&
    (scene.width > 4096 ||
      scene.height > 4096 ||
      scene.width * scene.height > 4096 * 4096)
  )
    throw new Error(
      "This scene is too large to capture its effects faithfully.",
    );
  const canvas = ownerDocument.createElement("canvas");
  const ratio = Math.min(1, 640 / Math.max(scene.width, scene.height));
  canvas.width = Math.max(1, Math.round(scene.width * ratio));
  canvas.height = Math.max(1, Math.round(scene.height * ratio));
  // Shadows and filters use device pixels. Render those once at authored size,
  // then downsample the evidence image instead of changing their appearance.
  const renderCanvas = scaleRender
    ? canvas
    : ownerDocument.createElement("canvas");
  if (!scaleRender) {
    renderCanvas.width = scene.width;
    renderCanvas.height = scene.height;
  }
  const context = renderCanvas.getContext("2d");
  if (!context) {
    renderCanvas.width = 0;
    renderCanvas.height = 0;
    canvas.width = 0;
    canvas.height = 0;
    throw new Error("This browser cannot capture a preview frame.");
  }
  const assets = Object.fromEntries(
    Object.entries(scene.assets).map(([id, asset]) => {
      const { proxy: _preview, ...original } = asset;
      return [id, original];
    }),
  );
  const session = new DojoVideoEnginePreviewSession({ context, audio: false });
  try {
    const player = await session.setScene({ ...scene, assets });
    if (!player) throw new Error("The source frame could not be prepared.");
    await player.seek(frame);
    if (renderCanvas !== canvas) {
      const target = canvas.getContext("2d");
      if (!target)
        throw new Error("This browser cannot capture a preview frame.");
      target.drawImage(renderCanvas, 0, 0, canvas.width, canvas.height);
    }
    const imageDataUrl = canvas.toDataURL("image/jpeg", 0.8);
    if (imageDataUrl.length > 500_000)
      throw new Error(
        "The preview image is too large to include in this request.",
      );
    return { frame: player.currentFrame, imageDataUrl };
  } finally {
    try {
      await session.disposeAsync();
    } finally {
      renderCanvas.width = 0;
      renderCanvas.height = 0;
      canvas.width = 0;
      canvas.height = 0;
    }
  }
}
