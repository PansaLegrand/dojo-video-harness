import en from "./en.json";
export function useTranslation() {
  return {
    locale: "en" as
      | "en"
      | "zh"
      | "es"
      | "fr"
      | "de"
      | "it"
      | "pt"
      | "ja"
      | "ko",
    t: (key: string) =>
      String(
        (en as Record<string, unknown>)[key] ??
          key.split(".").reduce((v: any, k) => v?.[k], en) ??
          key,
      ),
  };
}
