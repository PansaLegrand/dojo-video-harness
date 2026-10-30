import {
  Quality,
  QUALITY_VERY_LOW,
  QUALITY_LOW,
  QUALITY_MEDIUM,
  QUALITY_HIGH,
  QUALITY_VERY_HIGH,
} from "mediabunny";

/** Structured cloning preserves Quality's data but drops its prototype. */
export function restoreWorkerBitrate(
  value: unknown,
): number | Quality | undefined {
  if (
    value === undefined ||
    typeof value === "number" ||
    value instanceof Quality
  )
    return value;
  if (
    value &&
    typeof value === "object" &&
    Object.keys(value).length === 1 &&
    "_factor" in value &&
    typeof value._factor === "number" &&
    Number.isFinite(value._factor) &&
    value._factor > 0
  ) {
    // Restore only public quality presets; Quality has no public numeric constructor.
    const preset = [
      QUALITY_VERY_LOW,
      QUALITY_LOW,
      QUALITY_MEDIUM,
      QUALITY_HIGH,
      QUALITY_VERY_HIGH,
    ].find((quality) => JSON.stringify(quality) === JSON.stringify(value));
    if (preset) return preset;
  }
  throw new Error("Invalid worker export quality.");
}
