import { canEncodeVideo, QUALITY_HIGH } from "mediabunny";
import { assertEditorCanvasDimensions } from "./canvas-format";

export const EDITOR_VIDEO_ENCODING = {
  codecs: ["avc" as const],
  bitrate: QUALITY_HIGH,
};
export const EDITOR_VIDEO_ENCODING_ERROR =
  "This browser cannot export H.264 video at this resolution. Choose a lower export resolution or use a browser and device with H.264 encoding support.";

/** Probe the selected size and export quality before allocating an output publication. */
export async function requireEditorExportSupport(format: {
  width: number;
  height: number;
}): Promise<void> {
  assertEditorCanvasDimensions(format);
  if (
    !(await canEncodeVideo("avc", {
      width: format.width,
      height: format.height,
      bitrate: EDITOR_VIDEO_ENCODING.bitrate,
    }))
  ) {
    throw new Error(EDITOR_VIDEO_ENCODING_ERROR);
  }
}
