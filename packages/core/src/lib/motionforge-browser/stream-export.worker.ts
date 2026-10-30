import { restoreWorkerBitrate } from "./worker-bitrate";
import {
  createExportFontPreparation,
  type PrepareExportFontsRequest,
  type PrepareExportFontsEvent,
} from "./export-worker-fonts";
import { exportVideoToStream } from "@motionforge/export";
import type { StreamExportEvent, StreamExportRequest } from "./stream-export";

const scope = self as unknown as {
  postMessage(event: StreamExportEvent | PrepareExportFontsEvent): void;
  addEventListener(
    type: "message",
    listener: (
      event: MessageEvent<StreamExportRequest | PrepareExportFontsRequest>,
    ) => void,
  ): void;
};
const fonts = createExportFontPreparation((event) => scope.postMessage(event));
let active: { id: string; controller: AbortController } | null = null;
scope.addEventListener("message", (event) => {
  const request = event.data;
  if (request.type === "motionforge.export.prepare-fonts") {
    void fonts.prepare(request);
    return;
  }
  if (request.type === "cancel") {
    if (active?.id === request.id)
      active.controller.abort(
        new DOMException("Export cancelled.", "AbortError"),
      );
    return;
  }
  if (active) {
    scope.postMessage({
      type: "error",
      id: request.id,
      error: { name: "Error", message: "An export is already running." },
    });
    return;
  }
  const controller = new AbortController();
  active = { id: request.id, controller };
  const timer = setInterval(
    () => scope.postMessage({ type: "heartbeat", id: request.id }),
    5000,
  );
  void Promise.resolve()
    .then(() =>
      exportVideoToStream(
        {
          ...request.options,
          bitrate: restoreWorkerBitrate(request.options.bitrate),
          worker: true,
          signal: controller.signal,
          onProgress: (progress) =>
            scope.postMessage({ type: "progress", id: request.id, progress }),
        },
        request.writable,
        request.streamOptions,
      ),
    )
    .then(
      (result) =>
        scope.postMessage({ type: "complete", id: request.id, result }),
      (error) =>
        scope.postMessage({
          type: "error",
          id: request.id,
          error: {
            name: error instanceof Error ? error.name : "Error",
            message: error instanceof Error ? error.message : String(error),
          },
        }),
    )
    .finally(async () => {
      clearInterval(timer);
      active = null;
      await fonts.dispose();
    });
});
