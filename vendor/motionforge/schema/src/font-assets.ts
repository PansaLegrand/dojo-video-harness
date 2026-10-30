import type { SceneAsset } from "./index";

export function isFontWeightDescriptor(value: string): boolean {
  if (value === "normal" || value === "bold") return true;
  if (!/^\d{1,4}(?:\s+\d{1,4})?$/.test(value)) return false;
  const weights = value.split(/\s+/).map(Number);
  return (
    weights.every((weight) => weight >= 1 && weight <= 1000) &&
    (weights.length === 1 || weights[0]! <= weights[1]!)
  );
}

/** Split CSS family fallback lists without splitting quoted family names. */
export function fontFamilyNames(value: string): string[] {
  return (value.match(/(?:[^,"']+|"[^"]*"|'[^']*')+/g) ?? [])
    .map((family) => family.trim().replace(/^(["'])(.*)\1$/, "$2"))
    .filter(Boolean);
}

/** Every declared face in a referenced family is needed for weight/style matching. */
export function fontAssetIdsForFamily(
  assets: Record<string, SceneAsset>,
  family: string,
): string[] {
  const names = new Set(fontFamilyNames(family));
  return Object.values(assets)
    .filter(
      (asset) =>
        asset.type === "font" &&
        names.has(asset.metadata?.fontFamily ?? asset.id),
    )
    .map((asset) => asset.id);
}
