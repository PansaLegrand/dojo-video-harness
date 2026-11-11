import type { VideoProjectDocument } from "./document";

export type SourceAudioTrackPresence = "present" | "absent" | "unknown";

/** Original container tracks, independent of timeline mute, volume or proxies. */
export function sourceAudioTrackPresence(
  document: VideoProjectDocument,
  assetId: string,
): SourceAudioTrackPresence {
  const asset = document.assets[assetId],
    source = document.sources[assetId],
    metadata = asset?.mediaMetadata;
  if (
    !asset ||
    !["video", "audio"].includes(asset.type) ||
    !source?.contentHash ||
    source.revision !== `sha256:${source.contentHash}` ||
    metadata?.contentHash !== source.contentHash ||
    typeof metadata.hasAudio !== "boolean"
  )
    return "unknown";
  return metadata.hasAudio ? "present" : "absent";
}

/** A failed classifier can resolve an explicit single source or known audio.
 * Multiple unprobed sources need the ordinary planner's target clarification. */
export function fallbackSpeechSourceItems(
  document: VideoProjectDocument,
  items: VideoProjectDocument["items"],
) {
  const audible = items.filter(
    (item) =>
      sourceAudioTrackPresence(document, item.node.assetId!) !== "absent",
  );
  const ids = new Set(audible.map((item) => item.node.assetId));
  return ids.size <= 1 ||
    audible.every(
      (item) =>
        sourceAudioTrackPresence(document, item.node.assetId!) === "present",
    )
    ? audible
    : [];
}
