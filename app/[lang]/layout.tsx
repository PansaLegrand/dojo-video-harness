import type { ReactNode } from "react";
import { notFound } from "next/navigation";
import JapaneseFontLoader from "@/components/JapaneseFontLoader";
import { dictionaryWithFallback } from "@/lib/i18n/dictionary";
import en from "../../packages/core/src/lib/i18n/locales/en.json";
import { TranslationProvider, type Locale } from "@/lib/i18n";
export default async function LanguageLayout({
  children,
  params,
}: {
  children: ReactNode;
  params: Promise<{ lang: string }>;
}) {
  const { lang } = await params;
  if (!["en", "zh", "es", "fr", "de", "it", "pt", "ja", "ko"].includes(lang))
    notFound();
  const dictionary = (
    await import(`../../packages/core/src/lib/i18n/locales/${lang}.json`)
  ).default;
  return (
    <TranslationProvider
      locale={lang as Locale}
      dictionary={dictionaryWithFallback(dictionary, en)}
    >
      {lang === "ja" ? <JapaneseFontLoader /> : null}
      {children}
    </TranslationProvider>
  );
}
