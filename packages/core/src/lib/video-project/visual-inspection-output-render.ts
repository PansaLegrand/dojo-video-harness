import type { Scene } from "@dojo-video-engine/schema";
import {
  createCanvas2DSceneRuntime,
  type Canvas2DSceneRuntime,
} from "@dojo-video-engine/renderer-canvas2d/runtime";
import { graphicsRuntimeOptions } from "@/lib/dojo-video-engine-browser/graphics-runtime";
import {
  OutputHostError,
  type ProjectPreviewRequest,
} from "./browser-output-requests";

/** Host compiler + owned source resolver supply the Scene. Model text and
 * arbitrary URLs never enter this adapter. The controller is never mutated. */
export function createOwnedOutputCapture(scene: Scene, renderHash: string) {
  let runtime: Promise<Canvas2DSceneRuntime> | null = null,
    closed = false;
  let surface: OffscreenCanvas | null = null,
    thumbnail: OffscreenCanvas | null = null;
  const original = {
    ...scene,
    assets: Object.fromEntries(
      Object.entries(scene.assets).map(([id, asset]) => {
        const { proxy: _proxy, ...source } = asset;
        return [id, source];
      }),
    ),
  };
  return {
    async capture(
      frame: number,
      request: ProjectPreviewRequest,
      signal?: AbortSignal,
    ) {
      signal?.throwIfAborted();
      if (
        closed ||
        renderHash !== request.renderHash ||
        scene.width !== request.format.width ||
        scene.height !== request.format.height ||
        scene.fps !== request.format.fps ||
        scene.duration !== request.format.durationInFrames
      )
        throw new OutputHostError(
          "STALE_OUTPUT",
          "The owned render input differs from the requested output.",
        );
      if (!runtime)
        runtime = createCanvas2DSceneRuntime({
          scene: original,
          signal,
          resolve: { ...graphicsRuntimeOptions(), preferProxy: false },
        });
      const prepared = await runtime;
      signal?.throwIfAborted();
      surface ??= new OffscreenCanvas(scene.width, scene.height);
      const context = surface.getContext("2d", {
        alpha: false,
        colorSpace: "srgb",
      });
      if (!context)
        throw new OutputHostError(
          "UNSUPPORTED",
          "This browser cannot render output inspection frames.",
        );
      await prepared.renderFrame(frame, context, { signal });
      signal?.throwIfAborted();
      const ratio = Math.min(
        1,
        request.limits.maxDimension / Math.max(scene.width, scene.height),
      );
      thumbnail ??= new OffscreenCanvas(
        Math.max(1, Math.round(scene.width * ratio)),
        Math.max(1, Math.round(scene.height * ratio)),
      );
      const target = thumbnail.getContext("2d", {
        alpha: false,
        colorSpace: "srgb",
      });
      if (!target)
        throw new OutputHostError(
          "UNSUPPORTED",
          "This browser cannot encode output inspection frames.",
        );
      target.drawImage(surface, 0, 0, thumbnail.width, thumbnail.height);
      const blob = await thumbnail.convertToBlob({
        type: "image/jpeg",
        quality: 0.8,
      });
      signal?.throwIfAborted();
      if (
        blob.type !== "image/jpeg" ||
        blob.size > request.limits.maxOutputBytes
      )
        throw new OutputHostError(
          "OUTPUT_BYTES",
          "Output preview exceeds its JPEG allowance.",
        );
      const bytes = new Uint8Array(await blob.arrayBuffer());
      signal?.throwIfAborted();
      const chunks = [];
      for (let offset = 0; offset < bytes.length; offset += 32768)
        chunks.push(
          String.fromCharCode(...bytes.subarray(offset, offset + 32768)),
        );
      return {
        frame,
        imageDataUrl: `data:image/jpeg;base64,${btoa(chunks.join(""))}`,
        renderHash,
      };
    },
    async dispose() {
      if (closed) return;
      closed = true;
      try {
        const prepared = await runtime?.catch(() => null);
        await prepared?.disposeAsync();
      } finally {
        if (surface) {
          surface.width = 0;
          surface.height = 0;
        }
        if (thumbnail) {
          thumbnail.width = 0;
          thumbnail.height = 0;
        }
      }
    },
  };
}
