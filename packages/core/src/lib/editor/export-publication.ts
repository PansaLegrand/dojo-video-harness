import { fingerprintLocalFile } from "../video-project/local-file-fingerprint";
type ExportProfile = { exportId: string; [key: string]: unknown };
/** Browser export remains local; Save copies the completed file to the local host. */
export function createEditorExportPublication(
  projectId: string,
  profile: ExportProfile,
) {
  let pending: Promise<unknown> | null = null;
  return {
    prepare: (signal?: AbortSignal) => phase("prepare", signal),
    cancel: (signal?: AbortSignal) => phase("cancel", signal),
    publish(blob: Blob, signal?: AbortSignal) {
      if (pending) return pending;
      pending = (async () => {
        const hash = await fingerprintLocalFile(blob, { signal });
        const r = await fetch(
          `/api/projects/${encodeURIComponent(projectId)}/exports/${encodeURIComponent(profile.exportId)}`,
          {
            method: "PUT",
            headers: {
              "Content-Type": "video/mp4",
              "X-Content-SHA256": hash,
              "X-Content-Bytes": String(blob.size),
            },
            body: blob,
            signal,
          },
        );
        const payload = await r.json();
        if (!r.ok)
          throw new Error(payload.message ?? "Could not save the file.");
        return payload.data;
      })().catch((cause) => {
        pending = null;
        throw cause;
      });
      return pending;
    },
  };
  async function phase(phase: "prepare" | "cancel", signal?: AbortSignal) {
    const r = await fetch(
      `/api/projects/${encodeURIComponent(projectId)}/exports`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...profile, phase }),
        signal,
      },
    );
    const value = await r.json();
    if (!r.ok)
      throw new Error(value.message ?? "Export could not be prepared.");
    return value.data;
  }
}
