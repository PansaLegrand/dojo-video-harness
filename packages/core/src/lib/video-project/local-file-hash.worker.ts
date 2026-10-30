import { hashLocalFileChunks, throttledHashProgress } from "./local-file-hash";

type HashRequest = { id: string; file: Blob };
const scope = self as unknown as {
  addEventListener(
    type: "message",
    listener: (event: MessageEvent<HashRequest>) => void,
  ): void;
  postMessage(event: unknown): void;
};
scope.addEventListener("message", (event) => {
  const { id, file } = event.data;
  if (!(file instanceof Blob) || typeof id !== "string") return;
  const onProgress = throttledHashProgress((fraction) =>
    scope.postMessage({ type: "progress", id, fraction }),
  );
  void hashLocalFileChunks(file, { onProgress }).then(
    (fingerprint) => scope.postMessage({ type: "complete", id, fingerprint }),
    (error) =>
      scope.postMessage({
        type: "error",
        id,
        message:
          error instanceof Error ? error.message : "Could not read local file.",
      }),
  );
});
