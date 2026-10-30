import type { ReactNode } from "react";
import { notFound } from "next/navigation";
import { flattenTranslations } from "@/lib/i18n/dictionary";
import en from "../../packages/core/src/lib/i18n/locales/en.json";
import { TranslationProvider } from "@/lib/i18n";
export default async function LanguageLayout({
  children,
  params,
}: {
  children: ReactNode;
  params: Promise<{ lang: string }>;
}) {
  const { lang } = await params;
  if (lang !== "en") notFound();
  return (
    <TranslationProvider locale="en" dictionary={flattenTranslations(en)}>
      {children}
    </TranslationProvider>
  );
}
