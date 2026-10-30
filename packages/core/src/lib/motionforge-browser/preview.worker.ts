import { createMotionForgePreviewWorkerHandler } from "./preview-worker-handler";

const scope = self as unknown as {
  postMessage(message: unknown, transfer?: Transferable[]): void;
  addEventListener(
    type: "message",
    listener: (event: MessageEvent) => void,
  ): void;
};
const handle = createMotionForgePreviewWorkerHandler({
  postMessage: (message, transfer) =>
    scope.postMessage(message, transfer ?? []),
});
scope.addEventListener("message", (event) => {
  void handle(event.data);
});
