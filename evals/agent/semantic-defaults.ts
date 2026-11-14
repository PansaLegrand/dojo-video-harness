import type { VideoProjectDocument } from "../../packages/core/src/lib/video-project/document";

export const EVALUATION_GRADER_VERSION = 2;
/** Engine media clocks default an absent source start to zero. Normalize only
 * that representation: explicit null, nonzero offsets, unrelated node fields,
 * timing and playback rate remain untouched. This does not execute commands. */
export function canonicalEvaluationDocument(document: VideoProjectDocument): VideoProjectDocument {
  const copy = structuredClone(document);
  const visit = (node: VideoProjectDocument["items"][number]["node"]) => {
    const asset = typeof node.assetId === "string" ? copy.assets[node.assetId] : undefined;
    if (node.type === "video" && asset?.type === "video" && node.videoStartTime === undefined) node.videoStartTime = 0;
    if (node.type === "audio" && asset && ["audio", "video"].includes(asset.type) && node.audioStartTime === undefined) node.audioStartTime = 0;
    for (const child of node.children ?? []) visit(child);
  };
  for (const item of copy.items) visit(item.node);
  return copy;
}
