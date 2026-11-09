import { disposeMediaInputSafely } from "@dojo-video-engine/renderer-canvas2d";
import {
  MP4,
  WEBM,
  QTFF,
  BlobSource,
  Input,
  VideoSampleSink,
  type VideoSample,
} from "mediabunny";
import { unsupportedVideoColor } from "@/lib/dojo-video-engine-browser/media-admission";
import { fingerprintLocalFile } from "./local-file-fingerprint";
import { abortableLocalRead } from "./local-file-hash-utils";
import {
  SOURCE_INSPECTION_LIMITS,
  SourceInspectionError,
  inspectionImageDimensions,
  inspectionOutputSize,
  sourceInspectionPlanSchema,
  sourceInspectionMimeSchema,
  type SourceInspectionPlan,
  type SourceInspectionFrame,
  type SourceInspectionProvenance,
} from "./source-inspection";

export type BrowserSourceInspection = {
  provenance: SourceInspectionProvenance;
  frames: Array<{ metadata: SourceInspectionFrame; blob: Blob }>;
};
const check = (signal: AbortSignal) => signal.throwIfAborted();
async function jpeg(
  canvas: HTMLCanvasElement | OffscreenCanvas,
  signal: AbortSignal,
) {
  check(signal);
  const blob =
    "convertToBlob" in canvas
      ? await canvas.convertToBlob({ type: "image/jpeg", quality: 0.82 })
      : await new Promise<Blob>((resolve, reject) =>
          canvas.toBlob(
            (value) =>
              value
                ? resolve(value)
                : reject(
                    new SourceInspectionError(
                      "UNSUPPORTED",
                      "Image encoding failed.",
                    ),
                  ),
            "image/jpeg",
            0.82,
          ),
        );
  check(signal);
  if (blob.type !== "image/jpeg")
    throw new SourceInspectionError(
      "UNSUPPORTED",
      "JPEG encoding is unavailable.",
    );
  return blob;
}
/** Local only: accepts a Blob, never resolves a URL, uploads, or contacts a model. */
export async function sampleOriginalSource(
  blob: Blob,
  raw: SourceInspectionPlan,
  options: { signal?: AbortSignal } = {},
): Promise<BrowserSourceInspection> {
  const plan = sourceInspectionPlanSchema.parse(raw),
    controller = new AbortController();
  const cancel = () => controller.abort(options.signal?.reason);
  options.signal?.addEventListener("abort", cancel, { once: true });
  if (options.signal?.aborted) cancel();
  const timer = setTimeout(
      () =>
        controller.abort(
          new DOMException("Source inspection timed out.", "TimeoutError"),
        ),
      plan.limits.timeoutMs,
    ),
    signal = controller.signal;
  let input: Input | undefined,
    iterator: AsyncGenerator<VideoSample | null, void, unknown> | undefined,
    bitmap: ImageBitmap | undefined;
  const frames: BrowserSourceInspection["frames"] = [];
  let bytes = 0;
  try {
    check(signal);
    if (
      blob.size !== plan.source.byteLength ||
      blob.size > SOURCE_INSPECTION_LIMITS.maxSourceBytes ||
      (await fingerprintLocalFile(blob, { signal })) !== plan.source.contentHash
    )
      throw new SourceInspectionError(
        "SOURCE_CHANGED",
        "The original file no longer matches its source fingerprint.",
      );
    const add = async (
      canvas: HTMLCanvasElement | OffscreenCanvas,
      requestedMs: number,
      actualMs: number,
      durationMs: number | null,
    ) => {
      const encoded = await jpeg(canvas, signal);
      bytes += encoded.size;
      if (bytes > plan.limits.maxOutputBytes)
        throw new SourceInspectionError(
          "LIMIT",
          "Inspection output exceeds its approved byte allowance.",
        );
      frames.push({
        blob: encoded,
        metadata: {
          requestedMs,
          actualMs,
          durationMs,
          width: canvas.width,
          height: canvas.height,
          byteLength: encoded.size,
          sha256: await fingerprintLocalFile(encoded, { signal }),
          mimeType: "image/jpeg",
        },
      });
    };
    let width: number,
      height: number,
      sourceMimeType: SourceInspectionProvenance["sourceMimeType"],
      colorMetadata: SourceInspectionProvenance["colorMetadata"] = null,
      rotation: 0 | 90 | 180 | 270 | null = null,
      firstMs = 0,
      endMs: number | null = null;
    if (plan.source.type === "image") {
      const header = new Uint8Array(
          await abortableLocalRead(
            blob.slice(0, 256 * 1024).arrayBuffer(),
            signal,
          ),
        ),
        dimensions = inspectionImageDimensions(header);
      sourceMimeType =
        header[0] === 0xff
          ? "image/jpeg"
          : header[0] === 0x89
            ? "image/png"
            : "image/webp";
      inspectionOutputSize(dimensions.width, dimensions.height, plan.limits, 1);
      const pending = createImageBitmap(blob, {
        imageOrientation: "from-image",
        colorSpaceConversion: "default",
      }).then((value) => {
        if (signal.aborted) {
          value.close();
          check(signal);
        }
        return value;
      });
      bitmap = await abortableLocalRead(pending, signal);
      width = bitmap.width;
      height = bitmap.height;
      const size = inspectionOutputSize(width, height, plan.limits, 1),
        canvas = new OffscreenCanvas(size.width, size.height),
        context = canvas.getContext("2d", { colorSpace: "srgb" });
      if (!context)
        throw new SourceInspectionError(
          "UNSUPPORTED",
          "A browser canvas is required.",
        );
      context.fillStyle = "#000000";
      context.fillRect(0, 0, size.width, size.height);
      context.drawImage(bitmap, 0, 0, size.width, size.height);
      await add(canvas, 0, 0, null);
    } else {
      input = new Input({
        formats: [MP4, WEBM, QTFF],
        source: new BlobSource(blob),
      });
      const abortInput = () => {
        if (input) disposeMediaInputSafely(input);
      };
      signal.addEventListener("abort", abortInput, { once: true });
      try {
        sourceMimeType = sourceInspectionMimeSchema.parse(
          (await abortableLocalRead(input.getFormat(), signal)).mimeType,
        );
        const track = await abortableLocalRead(
          input.getPrimaryVideoTrack(),
          signal,
        );
        if (!track)
          throw new SourceInspectionError(
            "UNSUPPORTED",
            "No source video track is available.",
          );
        if (await abortableLocalRead(track.hasHighDynamicRange(), signal))
          throw new SourceInspectionError(
            "HDR_UNSUPPORTED",
            "HDR source sampling is outside the qualified color policy.",
          );
        if (!(await abortableLocalRead(track.canDecode(), signal)))
          throw new SourceInspectionError(
            "UNSUPPORTED",
            "The browser cannot decode this video codec.",
          );
        const color = await track.getColorSpace();
        colorMetadata = {
          primaries: color.primaries ?? null,
          transfer: color.transfer ?? null,
          matrix: color.matrix ?? null,
          fullRange: color.fullRange ?? null,
        };
        width = await track.getDisplayWidth();
        height = await track.getDisplayHeight();
        rotation = await track.getRotation();
        firstMs = (await track.getFirstTimestamp()) * 1000;
        endMs = (await track.computeDuration()) * 1000;
        if (
          ![firstMs, endMs].every(Number.isFinite) ||
          plan.momentsMs.some((time) => time >= endMs!)
        )
          throw new SourceInspectionError(
            "TIMING",
            "A requested source moment is outside the available media.",
          );
        const size = inspectionOutputSize(
          width,
          height,
          plan.limits,
          plan.momentsMs.length,
        );
        // One public sparse-access pipeline preserves the actual PTS and avoids
        // reopening a decoder for every far-forward inspection moment. Include
        // the first source sample for the existing codec-VUI admission check.
        const targets = [
          ...new Set([
            firstMs,
            ...plan.momentsMs.map((time) => Math.max(time, firstMs)),
          ]),
        ];
        iterator = new VideoSampleSink(track).samplesAtTimestamps(
          targets.map((time) => time / 1000),
        );
        const canvas = new OffscreenCanvas(size.width, size.height),
          context = canvas.getContext("2d", {
            alpha: false,
            colorSpace: "srgb",
          });
        if (!context)
          throw new SourceInspectionError(
            "UNSUPPORTED",
            "A browser canvas is required.",
          );
        let targetIndex = 0;
        while (targetIndex < targets.length) {
          const next = await abortableLocalRead(
            iterator.next().then((value) => {
              if (signal.aborted) {
                value.value?.close();
                check(signal);
              }
              return value;
            }),
            signal,
          );
          if (next.done || !next.value)
            throw new SourceInspectionError(
              "MISSING_FRAME",
              "A requested source sample is unavailable.",
            );
          const sample = next.value,
            targetMs = targets[targetIndex++]!;
          try {
            check(signal);
            if (unsupportedVideoColor(sample.colorSpace))
              throw new SourceInspectionError(
                "HDR_UNSUPPORTED",
                "HDR codec color is outside the qualified color policy.",
              );
            if (targetIndex === 1) {
              const actual = sample.colorSpace;
              colorMetadata = {
                primaries: actual.primaries ?? null,
                transfer: actual.transfer ?? null,
                matrix: actual.matrix ?? null,
                fullRange: actual.fullRange ?? null,
              };
            }
            if (
              ![sample.timestamp, sample.duration].every(Number.isFinite) ||
              sample.duration <= 0 ||
              sample.timestamp * 1000 > targetMs + 0.05 ||
              sample.timestamp * 1000 + sample.duration * 1000 <=
                targetMs - 0.05
            )
              throw new SourceInspectionError(
                "MISSING_FRAME",
                "Decoded frame does not cover the requested source moment.",
              );
            const requested = plan.momentsMs.filter(
              (time) => Math.max(time, firstMs) === targetMs,
            );
            if (!requested.length) continue;
            context.clearRect(0, 0, size.width, size.height);
            sample.drawWithFit(context, { fit: "contain" });
            for (const requestedMs of requested)
              await add(
                canvas,
                requestedMs,
                sample.timestamp * 1000,
                sample.duration * 1000,
              );
          } finally {
            sample.close();
          }
        }
      } finally {
        signal.removeEventListener("abort", abortInput);
      }
    }
    check(signal);
    return {
      provenance: {
        algorithm: "dojo-source-inspection-v1",
        engineVersion: "1.2.3",
        sourceKind: "original",
        source: plan.source,
        displayWidth: width,
        displayHeight: height,
        orientation: "display-oriented",
        rotationDegrees: rotation,
        sourceMimeType,
        colorMetadata,
        colorPolicy: "browser-sdr-to-srgb-v1",
        firstTimestampMs: firstMs,
        sourceEndMs: endMs,
        coverage: "requested-moments-only",
      },
      frames,
    };
  } finally {
    clearTimeout(timer);
    options.signal?.removeEventListener("abort", cancel);
    try {
      await iterator?.return();
    } finally {
      if (input) disposeMediaInputSafely(input);
      bitmap?.close();
    }
  }
}
