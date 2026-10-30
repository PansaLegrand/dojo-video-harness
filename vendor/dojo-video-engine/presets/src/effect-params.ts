/**
 * Single source of truth for DojoVideoEngine effect param normalization: key
 * aliases and value coercions shared by macro expansion and downstream raw
 * effect-node adapters. Callers may keep different policies for unknown keys,
 * but the same synonym must resolve to the same canonical parameter and value.
 */

export const effectParamAliases: ReadonlyMap<string, string> = new Map([
  ["amount", "intensity"],
  ["strength", "intensity"],
  ["power", "intensity"],
  ["color", "colors"],
  ["colour", "colors"],
  ["palette", "colors"],
  ["particles", "particleCount"],
  ["particle_count", "particleCount"],
  ["count", "particleCount"],
  ["size", "scale"],
  ["largeness", "scale"],
  ["bigness", "scale"],
  ["blur", "softness"],
  ["blurAmount", "softness"],
  ["feather", "softness"],
  ["soft", "softness"],
  ["fuzziness", "softness"],
  ["lineWidth", "strokeWidth"],
  ["ringRadius", "radius"],
  ["roundness", "radius"],
  ["jitter", "wobble"],
  ["roughness", "wobble"],
  ["wave", "wobble"],
  ["pulseStrength", "pulse"],
  ["pulsing", "pulse"],
  ["glowIntensity", "glow"],
  ["aura", "glow"],
  ["auraIntensity", "glow"],
  ["distance", "spread"],
  ["placement", "scope"],
  ["around", "scope"],
]);

export const canonicalEffectParamKeys: ReadonlySet<string> = new Set([
  "intensity",
  "seed",
  "colors",
  "particleCount",
  "shockwave",
  "emoji",
  "direction",
  "density",
  "loops",
  "strokeWidth",
  "radius",
  "wobble",
  "pulse",
  "scale",
  "spread",
  "softness",
  "glow",
  "scope",
]);

export const numericEffectParamKeys: ReadonlySet<string> = new Set([
  "seed",
  "particleCount",
  "loops",
  "strokeWidth",
  "radius",
  "wobble",
  "pulse",
  "scale",
  "spread",
  "softness",
  "glow",
]);

export function canonicalEffectParamKey(key: string): string {
  return effectParamAliases.get(key) ?? key;
}

function bandLevelNumber(value: number): "low" | "medium" | "high" {
  return value < 0.34 ? "low" : value < 0.67 ? "medium" : "high";
}

export function normalizeEffectLevelValue(value: unknown): unknown {
  if (typeof value === "number" && Number.isFinite(value)) {
    return bandLevelNumber(value);
  }

  if (typeof value !== "string") {
    return value;
  }

  const text = value.trim().toLowerCase();
  const numeric = Number(text);

  if (text !== "" && Number.isFinite(numeric)) {
    return bandLevelNumber(numeric);
  }

  if (
    ["low", "subtle", "restrained", "small", "light", "soft"].includes(text)
  ) {
    return "low";
  }

  if (["medium", "normal", "moderate"].includes(text)) {
    return "medium";
  }

  if (
    [
      "high",
      "strong",
      "stronger",
      "bold",
      "intense",
      "huge",
      "big",
      "large",
    ].includes(text)
  ) {
    return "high";
  }

  return value;
}

export function normalizeEffectScaleValue(value: unknown): unknown {
  if (typeof value !== "string") {
    return value;
  }

  const text = value.trim().toLowerCase();
  const numeric = Number(text);

  if (text !== "" && Number.isFinite(numeric)) {
    return numeric;
  }

  if (["tiny", "small", "subtle"].includes(text)) {
    return 0.8;
  }

  if (["medium", "normal"].includes(text)) {
    return 1;
  }

  if (["large", "big", "bigger", "strong"].includes(text)) {
    return 1.35;
  }

  if (["huge", "giant", "massive"].includes(text)) {
    return 1.75;
  }

  return value;
}

export function normalizeEffectUnitValue(value: unknown): unknown {
  if (typeof value === "boolean") {
    return value ? 0.75 : 0;
  }

  if (typeof value !== "string") {
    return value;
  }

  const text = value.trim().toLowerCase();
  const numeric = Number(text);

  if (text !== "" && Number.isFinite(numeric)) {
    return numeric;
  }

  if (["none", "off", "low", "small", "subtle", "light"].includes(text)) {
    return 0.25;
  }

  if (["medium", "normal", "moderate"].includes(text)) {
    return 0.55;
  }

  if (["high", "strong", "intense", "large", "big", "soft"].includes(text)) {
    return 0.8;
  }

  return value;
}

export function normalizeEffectDirectionValue(value: unknown): unknown {
  if (typeof value !== "string") {
    return value;
  }

  const text = value.trim().toLowerCase();

  if (
    [
      "inward",
      "inwards",
      "inside",
      "center",
      "centre",
      "toward-center",
      "towards-center",
    ].includes(text)
  ) {
    return "in";
  }

  if (
    ["outward", "outwards", "outside", "away", "away-from-center"].includes(
      text,
    )
  ) {
    return "out";
  }

  if (
    [
      "diagonal",
      "diagonally",
      "diagonal-in",
      "diagonal-inward",
      "diagonal-inwards",
      "diagonal-out",
      "diagonal-outward",
      "diagonal-outwards",
    ].includes(text)
  ) {
    return "diagonal";
  }

  return value;
}

export function normalizeEffectScopeValue(value: unknown): unknown {
  if (typeof value !== "string") {
    return value;
  }

  const text = value.trim().toLowerCase();

  if (
    [
      "text",
      "word",
      "headline",
      "subject",
      "around-text",
      "around-word",
    ].includes(text)
  ) {
    return "text";
  }

  if (
    ["frame", "full", "full-frame", "fullscreen", "background"].includes(text)
  ) {
    return "frame";
  }

  return value;
}

export function normalizeEffectColorsValue(value: unknown): unknown {
  if (typeof value === "string") {
    const text = value.trim();
    return text === "" ? undefined : [text];
  }

  if (Array.isArray(value)) {
    const colors = value
      .map((entry) => (typeof entry === "string" ? entry.trim() : ""))
      .filter((entry) => entry !== "");

    return colors.length > 0 ? colors : undefined;
  }

  return value;
}

/**
 * Normalizes a value for a canonical effect param key. Returns `undefined`
 * when the value should be dropped entirely (e.g. an empty colors list).
 * Values that cannot be normalized are returned unchanged so the zod schema
 * reports them.
 */
export function normalizeEffectParamValue(
  key: string,
  value: unknown,
): unknown {
  switch (key) {
    case "colors":
      return normalizeEffectColorsValue(value);
    case "intensity":
    case "density":
      return normalizeEffectLevelValue(value);
    case "scale":
      return normalizeEffectScaleValue(value);
    case "direction":
      return normalizeEffectDirectionValue(value);
    case "scope":
      return normalizeEffectScopeValue(value);
    case "wobble":
    case "pulse":
    case "spread":
    case "softness":
    case "glow":
      return normalizeEffectUnitValue(value);
    default:
      if (
        numericEffectParamKeys.has(key) &&
        typeof value === "string" &&
        value.trim() !== ""
      ) {
        const numeric = Number(value);
        return Number.isFinite(numeric) ? numeric : value;
      }
      return value;
  }
}
