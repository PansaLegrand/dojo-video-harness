import {
  preflightExport,
  type ExportVideoOptions,
  type ExportPreflightResult,
} from "@motionforge/export";
import {
  collectReachableAssetIds,
  disposeAssetsAsync,
  resolveAssets,
  type ResolvedAssets,
} from "@motionforge/renderer-canvas2d";
import { parseScene, type Scene } from "@motionforge/schema";
import { getFirstEncodableVideoCodec, Mp4OutputFormat } from "mediabunny";
import { restoreWorkerBitrate } from "./worker-bitrate";

export type ExportFontPreparationOptions = Pick<
  ExportVideoOptions,
  "budget" | "startFrame" | "endFrame" | "bitrate" | "codecs"
>;
export type PrepareExportFontsRequest = {
  type: "motionforge.export.prepare-fonts";
  id: string;
  scene: Scene;
} & ExportFontPreparationOptions;
export type PrepareExportFontsEvent =
  | {
      type: "motionforge.export.fonts-ready";
      id: string;
      preflight: ExportPreflightResult;
    }
  | {
      type: "motionforge.export.fonts-error";
      id: string;
      message: string;
    };

/** Runs inside the actual worker. Leases keep the same loaded font faces alive
 * until encoding ends; the engine borrows them from its shared font cache. */
export function createExportFontPreparation(
  postMessage: (event: PrepareExportFontsEvent) => void,
) {
  let fonts: ResolvedAssets | undefined;
  return {
    async prepare(request: PrepareExportFontsRequest) {
      try {
        const scene = parseScene(request.scene);
        const preflight = preflightExport(scene, globalThis, {
          worker: true,
          budget: request.budget,
          startFrame: request.startFrame,
          endFrame: request.endFrame,
          bitrate: restoreWorkerBitrate(request.bitrate),
        });
        if (!preflight.ok)
          throw new Error(
            preflight.issues
              .filter((issue) => issue.severity === "error")
              .map((issue) => issue.message)
              .join(" "),
          );
        // Match the encoder's ordered choice, including nondefault MP4 codecs.
        // Synchronous preflight alone does not inspect codec configurations.
        const codec = await getFirstEncodableVideoCodec(
          request.codecs ?? new Mp4OutputFormat().getSupportedVideoCodecs(),
          { width: scene.width, height: scene.height },
        );
        if (!codec)
          throw new Error(
            "Export worker cannot encode the requested video codecs at this resolution.",
          );
        const ids = [...collectReachableAssetIds(scene)].filter(
          (id) => scene.assets[id]?.type === "font",
        );
        const fontScene = parseScene({
          ...scene,
          assets: Object.fromEntries(ids.map((id) => [id, scene.assets[id]])),
          nodes: ids.map((id, index) => ({
            id: `font-preparation-${index}`,
            type: "text",
            text: "M",
            style: {
              fontFamily: JSON.stringify(
                scene.assets[id]!.metadata?.fontFamily ?? id,
              ),
            },
          })),
        });
        fonts = await resolveAssets(fontScene, {
          worker: true,
          budget: request.budget,
        });
        postMessage({
          type: "motionforge.export.fonts-ready",
          id: request.id,
          preflight,
        });
      } catch (error) {
        postMessage({
          type: "motionforge.export.fonts-error",
          id: request.id,
          message: error instanceof Error ? error.message : String(error),
        });
      }
    },
    async dispose() {
      const previous = fonts;
      fonts = undefined;
      if (previous) await disposeAssetsAsync(previous);
    },
  };
}
