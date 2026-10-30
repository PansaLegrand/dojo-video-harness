import { preparePreviewProxy } from "./preview-proxy-media";
import {
  PREVIEW_PROXY_CREATION_LOCK,
  previewProxyEntryName,
  previewProxyLockName,
  type PreviewProxyRequest,
} from "./preview-proxy-policy";

const scope = self as unknown as {
  postMessage(message: unknown): void;
  addEventListener(
    type: "message",
    listener: (event: MessageEvent) => void,
  ): void;
};
let acknowledge: (() => void) | undefined;
let started = false;
scope.addEventListener("message", (event) => {
  if (event.data?.type === "accepted") {
    acknowledge?.();
    return;
  }
  if (started || event.data?.type !== "prepare") return;
  started = true;
  const controller = new AbortController();
  void navigator.locks
    .request(PREVIEW_PROXY_CREATION_LOCK, async () => {
      const result = await preparePreviewProxy(
        event.data.request as PreviewProxyRequest,
        controller.signal,
      );
      if (!result) {
        scope.postMessage({ type: "skipped" });
        return;
      }
      await navigator.locks.request(
        previewProxyLockName(previewProxyEntryName(result.manifest.sourceHash)),
        { mode: "shared" },
        async () => {
          const accepted = new Promise<void>((resolve) => {
            acknowledge = resolve;
          });
          scope.postMessage({ type: "complete", result });
          await accepted;
        },
      );
    })
    .catch((error) =>
      scope.postMessage({
        type: "skipped",
        reason: error instanceof Error ? error.message : "Proxy unavailable.",
      }),
    );
});
