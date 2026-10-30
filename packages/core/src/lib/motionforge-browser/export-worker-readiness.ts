import type { ExportPreflightResult } from "@motionforge/export";
import type { Scene } from "@motionforge/schema";
import type {
  PrepareExportFontsRequest,
  PrepareExportFontsEvent,
  ExportFontPreparationOptions,
} from "./export-worker-fonts";

type PreparationWorker = {
  postMessage(request: PrepareExportFontsRequest): void;
  addEventListener(type: string, listener: EventListener): void;
  removeEventListener(type: string, listener: EventListener): void;
};

/** No destination or encoder is handed to the worker until this succeeds. */
export function prepareExportWorkerFonts(
  worker: PreparationWorker,
  scene: Scene,
  options: ExportFontPreparationOptions,
  signal: AbortSignal,
  timeoutMs: number,
): Promise<ExportPreflightResult> {
  return new Promise((resolve, reject) => {
    const id = crypto.randomUUID();
    let timer: ReturnType<typeof setTimeout>;
    const cleanup = () => {
      clearTimeout(timer);
      worker.removeEventListener("message", message);
      worker.removeEventListener("error", failed);
      worker.removeEventListener("messageerror", failed);
      signal.removeEventListener("abort", aborted);
    };
    const fail = (error: unknown) => {
      cleanup();
      reject(error);
    };
    const aborted = () =>
      fail(
        signal.reason ?? new DOMException("Export cancelled.", "AbortError"),
      );
    const failed = () =>
      fail(new Error("Export worker could not prepare its fonts."));
    const message: EventListener = (event) => {
      const data = (event as MessageEvent<PrepareExportFontsEvent>).data;
      if (data?.id !== id) return;
      if (data.type === "motionforge.export.fonts-error")
        fail(new Error(data.message));
      else if (data.type === "motionforge.export.fonts-ready") {
        if (!data.preflight?.ok) {
          failed();
          return;
        }
        cleanup();
        resolve(data.preflight);
      }
    };
    if (signal.aborted) {
      aborted();
      return;
    }
    worker.addEventListener("message", message);
    worker.addEventListener("error", failed);
    worker.addEventListener("messageerror", failed);
    signal.addEventListener("abort", aborted, { once: true });
    timer = setTimeout(
      () => fail(new Error("Export worker font preparation timed out.")),
      Math.max(1, timeoutMs),
    );
    try {
      worker.postMessage({
        type: "motionforge.export.prepare-fonts",
        id,
        scene,
        ...options,
      });
    } catch (error) {
      fail(error);
    }
  });
}
