import { parseScene, type Scene } from "@dojo-video-engine/schema";

export type Rotation = 0 | 90 | 180 | 270;
export type LocalVideo = {
  url: string;
  width: number;
  height: number;
  duration: number;
};

/** Rotate around the source centre, then mirror along the output canvas axes. */
export function buildRotatedVideoScene(
  video: LocalVideo,
  rotation: Rotation,
  mirrorX = false,
  mirrorY = false,
): Scene {
  if (
    ![video.width, video.height, video.duration].every(
      (n) => Number.isFinite(n) && n > 0,
    ) ||
    ![0, 90, 180, 270].includes(rotation)
  )
    throw new Error("Invalid video geometry");
  const swap = rotation === 90 || rotation === 270;
  // H.264 needs even dimensions. Pad by at most one pixel, without stretching.
  const width = Math.ceil((swap ? video.height : video.width) / 2) * 2;
  const height = Math.ceil((swap ? video.width : video.height) / 2) * 2;
  const duration = Math.max(1, Math.ceil(video.duration * 30));
  return parseScene({
    schemaVersion: 1,
    width,
    height,
    fps: 30,
    duration,
    assets: { source: { id: "source", type: "video", src: video.url } },
    nodes: [
      {
        id: "orientation",
        type: "div",
        duration,
        style: {
          position: "absolute",
          inset: 0,
          width,
          height,
          backgroundColor: "#000000",
          transform: `scale(${mirrorX ? -1 : 1}, ${mirrorY ? -1 : 1})`,
          transformOrigin: "center center",
        },
        children: [
          {
            id: "video",
            type: "video",
            assetId: "source",
            duration,
            volume: 1,
            style: {
              position: "absolute",
              left: (width - video.width) / 2,
              top: (height - video.height) / 2,
              width: video.width,
              height: video.height,
              objectFit: "fill",
              transform: `rotate(${rotation}deg)`,
              transformOrigin: "center center",
            },
          },
        ],
      },
    ],
  });
}
