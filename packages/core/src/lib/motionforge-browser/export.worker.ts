import { restoreWorkerBitrate } from "./worker-bitrate";
import {
  createExportFontPreparation,
  type PrepareExportFontsRequest,
} from "./export-worker-fonts";
import {
  createExportWorkerHandler,
  type ExportWorkerRequest,
} from "@motionforge/export/worker";

const scope = self as unknown as {
  postMessage(event: unknown): void;
  addEventListener(
    type: "message",
    listener: (
      event: MessageEvent<ExportWorkerRequest | PrepareExportFontsRequest>,
    ) => void,
  ): void;
};
const handle = createExportWorkerHandler({
  postMessage: (event) => scope.postMessage(event),
});
const fonts = createExportFontPreparation((event) => scope.postMessage(event));

scope.addEventListener("message", (event) => {
  if (event.data.type === "motionforge.export.prepare-fonts") {
    void fonts.prepare(event.data);
    return;
  }
  const request = event.data;
  // A/V mixing and verification happen after the final video-frame progress.
  // Liveness is separate from progress; it never claims more work is complete.
  const timer =
    event.data.type === "motionforge.export.start"
      ? setInterval(
          () =>
            scope.postMessage({
              type: "motionforge.export.heartbeat",
              requestId: event.data.id,
            }),
          5_000,
        )
      : null;
  void Promise.resolve()
    .then(() =>
      handle(
        request.type === "motionforge.export.start"
          ? {
              ...request,
              options: {
                ...request.options,
                bitrate: restoreWorkerBitrate(request.options?.bitrate),
              },
            }
          : request,
      ),
    )
    .catch((error) =>
      scope.postMessage({
        type: "motionforge.export.error",
        id: request.id,
        error: {
          name: error instanceof Error ? error.name : "Error",
          message: error instanceof Error ? error.message : String(error),
        },
      }),
    )
    .finally(async () => {
      if (timer !== null) clearInterval(timer);
      if (request.type === "motionforge.export.start") await fonts.dispose();
    });
});
