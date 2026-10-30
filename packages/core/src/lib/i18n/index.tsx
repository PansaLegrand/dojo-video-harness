"use client";
import { createContext, useContext, useMemo, type ReactNode } from "react";
export type Locale =
  | "en"
  | "zh"
  | "es"
  | "fr"
  | "de"
  | "it"
  | "pt"
  | "ja"
  | "ko";
export type Dictionary = Record<string, unknown>;
const Context = createContext<{ locale: Locale; dictionary: Dictionary }>({
  locale: "en",
  dictionary: {},
});
export function TranslationProvider({
  locale,
  dictionary,
  children,
}: {
  locale: Locale;
  dictionary: Dictionary;
  children: ReactNode;
}) {
  const value = useMemo(() => ({ locale, dictionary }), [locale, dictionary]);
  return <Context.Provider value={value}>{children}</Context.Provider>;
}
export function useTranslation() {
  const { locale, dictionary } = useContext(Context);
  return {
    locale,
    t: (key: string) => {
      let value: unknown = dictionary[key];
      if (value === undefined) {
        value = dictionary;
        for (const part of key.split("."))
          value =
            value && typeof value === "object"
              ? (value as Dictionary)[part]
              : undefined;
      }
      return typeof value === "string" ? value : key;
    },
  };
}
