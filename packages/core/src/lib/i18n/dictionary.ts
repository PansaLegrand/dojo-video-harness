export type Locale = "en" | "es" | "fr" | "de" | "it" | "pt" | "ko" | "zh" | "ja";
export interface Translation { [key: string]: string | Translation | string[] }

export function getTranslation(obj: Translation, path: string): string | undefined {
  if (typeof obj[path] === "string") return obj[path] as string;
  const value = path.split(".").reduce<string | Translation | string[] | undefined>((acc, part) => acc && typeof acc === "object" && !Array.isArray(acc) ? acc[part] : undefined, obj);
  return typeof value === "string" ? value : undefined;
}

/** Flatten on the server so only the active language plus missing-key fallback crosses the boundary. */
export function flattenTranslations(dictionary: Translation): Record<string, string> {
  const result: Record<string, string> = {};
  const visit = (value: Translation, prefix: string) => {
    for (const [key, child] of Object.entries(value)) {
      if (child && typeof child === "object" && !Array.isArray(child)) visit(child, prefix ? `${prefix}.${key}` : key);
    }
    for (const [key, child] of Object.entries(value)) {
      if (typeof child === "string") result[prefix ? `${prefix}.${key}` : key] = child;
    }
  };
  visit(dictionary, "");
  return result;
}

export function dictionaryWithFallback(dictionary: Translation, fallback: Translation) {
  return { ...flattenTranslations(fallback), ...flattenTranslations(dictionary) };
}
