import type { EditorAsset } from "@/lib/editor/document";

export type EditorSourceRange = { startSeconds: number; endSeconds: number };
/** A source range only chooses an insertion window; the immutable asset remains whole. */
export function editorSourceInsertion(
  asset: EditorAsset,
  fps: number,
  range?: EditorSourceRange,
) {
  if (!Number.isFinite(fps) || fps <= 0)
    throw new Error("Choose a valid project frame rate.");
  if (!range)
    return {
      duration: Math.max(1, Math.round((asset.durationSeconds ?? 5) * fps)),
    };
  if (asset.type !== "video" && asset.type !== "audio")
    throw new Error(
      "Choose a video or audio source to set an in and out point.",
    );
  const { startSeconds, endSeconds } = range;
  if (
    ![startSeconds, endSeconds, asset.durationSeconds].every(
      (value) => typeof value === "number" && Number.isFinite(value),
    ) ||
    startSeconds < 0 ||
    endSeconds > asset.durationSeconds! ||
    endSeconds <= startSeconds
  )
    throw new Error("Choose an in and out point inside this source.");
  // Round down so a partial final frame never reads beyond the selected source.
  const duration = Math.floor((endSeconds - startSeconds) * fps + 1e-7);
  if (duration < 1)
    throw new Error("Choose a source range at least one frame long.");
  return {
    duration,
    ...(asset.type === "video"
      ? { videoStartTime: startSeconds }
      : { audioStartTime: startSeconds }),
  };
}

export type EditorMediaFilter = "all" | "video" | "audio" | "image";
export function filterEditorLibrary(
  assets: readonly EditorAsset[],
  search: string,
  type: EditorMediaFilter,
) {
  const query = search.trim().normalize("NFKC").toLocaleLowerCase();
  return assets.filter(
    (asset) =>
      (type === "all" || asset.type === type) &&
      (!query ||
        asset.name.normalize("NFKC").toLocaleLowerCase().includes(query)),
  );
}
