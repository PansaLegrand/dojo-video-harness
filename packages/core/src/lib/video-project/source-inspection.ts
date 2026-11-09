import { z } from "zod/v3";

export const SOURCE_INSPECTION_LIMITS = Object.freeze({ maxFrames: 8, maxDimension: 1024, maxFramePixels: 1_048_576,
  maxTotalPixels: 4_194_304, maxOutputBytes: 4 * 1024 * 1024, maxSourceBytes: 250 * 1024 * 1024, maxInputPixels: 16_777_216, timeoutMs: 15_000 });
const positive = z.number().int().positive();
export const sourceInspectionMimeSchema = z.enum(["image/png", "image/jpeg", "image/webp", "video/mp4", "video/webm", "video/quicktime"]);
export const inspectionSourceSchema = z.object({ sourceId: z.string().min(1).max(191), sourceRevision: z.string().min(1).max(300),
  contentHash: z.string().regex(/^[a-f0-9]{64}$/), byteLength: positive.max(SOURCE_INSPECTION_LIMITS.maxSourceBytes), type: z.enum(["image", "video"]) }).strict();
export const sourceInspectionLimitsSchema = z.object({ maxFrames: positive.max(SOURCE_INSPECTION_LIMITS.maxFrames), maxDimension: positive.max(SOURCE_INSPECTION_LIMITS.maxDimension),
  maxFramePixels: positive.max(SOURCE_INSPECTION_LIMITS.maxFramePixels), maxTotalPixels: positive.max(SOURCE_INSPECTION_LIMITS.maxTotalPixels),
  maxOutputBytes: positive.max(SOURCE_INSPECTION_LIMITS.maxOutputBytes), timeoutMs: positive.max(SOURCE_INSPECTION_LIMITS.timeoutMs) }).strict();
export const sourceInspectionPlanSchema = z.object({ source: inspectionSourceSchema, momentsMs: z.array(z.number().finite().min(0).max(86_400_000)).min(1).max(8),
  limits: sourceInspectionLimitsSchema }).strict().superRefine((value, context) => {
  if (value.momentsMs.length > value.limits.maxFrames || value.momentsMs.some((time, index) => index > 0 && time <= value.momentsMs[index - 1]!)) context.addIssue({ code: "custom", message: "Source moments must be unique, ascending and within the frame allowance." });
  if (value.source.type === "image" && (value.momentsMs.length !== 1 || value.momentsMs[0] !== 0)) context.addIssue({ code: "custom", message: "An image has one inspection moment at zero." });
});
export type InspectionSource = z.infer<typeof inspectionSourceSchema>;
export type SourceInspectionPlan = z.infer<typeof sourceInspectionPlanSchema>;
export type SourceInspectionFrame = Readonly<{ requestedMs: number; actualMs: number; durationMs: number | null; width: number; height: number; byteLength: number; sha256: string; mimeType: "image/jpeg" }>;
export type SourceInspectionProvenance = Readonly<{ algorithm: "dojo-source-inspection-v1"; engineVersion: "1.2.3"; sourceKind: "original";
  source: InspectionSource; displayWidth: number; displayHeight: number; orientation: "display-oriented"; rotationDegrees: 0 | 90 | 180 | 270 | null;
  sourceMimeType: z.infer<typeof sourceInspectionMimeSchema>; colorMetadata: { primaries: string | null; transfer: string | null; matrix: string | null; fullRange: boolean | null } | null;
  colorPolicy: "browser-sdr-to-srgb-v1"; firstTimestampMs: number; sourceEndMs: number | null; coverage: "requested-moments-only" }>;
export type SourceInspectionResult = Readonly<{ provenance: SourceInspectionProvenance; frames: readonly SourceInspectionFrame[] }>;
export class SourceInspectionError extends Error {
  constructor(readonly code: "SOURCE_CHANGED" | "UNSUPPORTED" | "HDR_UNSUPPORTED" | "LIMIT" | "MISSING_FRAME" | "TIMING", message: string) { super(message); this.name = "SourceInspectionError"; }
}
export function inspectionOutputSize(width: number, height: number, limits: SourceInspectionPlan["limits"], frameCount: number) {
  if (![width, height].every(value => Number.isSafeInteger(value) && value > 0) || width * height > SOURCE_INSPECTION_LIMITS.maxInputPixels) throw new SourceInspectionError("LIMIT", "The source exceeds the qualified decoded-pixel limit.");
  const scale = Math.min(1, limits.maxDimension / Math.max(width, height), Math.sqrt(limits.maxFramePixels / (width * height)), Math.sqrt(limits.maxTotalPixels / (width * height * frameCount)));
  return { width: Math.max(1, Math.floor(width * scale)), height: Math.max(1, Math.floor(height * scale)) };
}
/** Converts only the selected node's half-open timeline window; no proxy clock. */
export function inspectionSourceMoment(input: { frame: number; from: number; duration: number; fps: number; sourceStartMs: number; playbackRate: number }) {
  if (!Object.values(input).every(Number.isFinite) || input.fps <= 0 || input.playbackRate <= 0 || input.sourceStartMs < 0 || input.frame < input.from || input.frame >= input.from + input.duration) throw new SourceInspectionError("TIMING", "Choose a frame inside the forward-playing source clip.");
  return input.sourceStartMs + (input.frame - input.from) * 1000 / input.fps * input.playbackRate;
}

/** Bounded header read prevents an image decoder from admitting an image bomb. */
export function inspectionImageDimensions(bytes: Uint8Array): { width: number; height: number } {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength), text = (offset: number, length: number) => String.fromCharCode(...bytes.subarray(offset, offset + length));
  if (bytes.length >= 24 && text(1, 3) === "PNG" && view.getUint32(0) === 0x89504e47 && text(12, 4) === "IHDR") return { width: view.getUint32(16), height: view.getUint32(20) };
  if (bytes.length >= 30 && text(0, 4) === "RIFF" && text(8, 4) === "WEBP") {
    if (text(12, 4) === "VP8X") return { width: 1 + bytes[24]! + (bytes[25]! << 8) + (bytes[26]! << 16), height: 1 + bytes[27]! + (bytes[28]! << 8) + (bytes[29]! << 16) };
    if (text(12, 4) === "VP8 " && bytes[23] === 0x9d && bytes[24] === 1 && bytes[25] === 0x2a) return { width: view.getUint16(26, true) & 0x3fff, height: view.getUint16(28, true) & 0x3fff };
    if (text(12, 4) === "VP8L" && bytes[20] === 0x2f) return { width: 1 + bytes[21]! + ((bytes[22]! & 0x3f) << 8), height: 1 + (bytes[22]! >> 6) + (bytes[23]! << 2) + ((bytes[24]! & 0xf) << 10) };
  }
  if (bytes[0] === 0xff && bytes[1] === 0xd8) {
    for (let offset = 2; offset + 8 < bytes.length;) {
      if (bytes[offset++] !== 0xff) break;
      while (bytes[offset] === 0xff) offset++;
      const marker = bytes[offset++]!; if (marker === 0xda || marker === 0xd9) break;
      if (marker === 0x01 || marker >= 0xd0 && marker <= 0xd7) continue;
      if (offset + 2 > bytes.length) break;
      const length = view.getUint16(offset); if (length < 2 || offset + length > bytes.length) break;
      if ([0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf].includes(marker) && length >= 7) return { width: view.getUint16(offset + 5), height: view.getUint16(offset + 3) };
      offset += length;
    }
  }
  throw new SourceInspectionError("UNSUPPORTED", "Source inspection currently admits bounded PNG, JPEG and WebP headers only.");
}
