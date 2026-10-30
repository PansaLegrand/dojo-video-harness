"use client";

import React from "react";
import Link from "next/link";
import type { Locale } from "@/lib/i18n";
import { buttonVariants } from "@/components/ui/button";
import type { GeneratorSeoContent } from "@/lib/generator-seo-content";
import { cn, getLocalizedHref } from "@/lib/utils";

type GeneratorSeoSectionProps = {
  locale: Locale;
  onOpenSignIn: () => void;
  content: GeneratorSeoContent;
  includeFaqSchema?: boolean;
  showIntro?: boolean;
  className?: string;
};

const GENERATOR_SEO_UI_TEXT: Partial<
  Record<
    Locale,
    {
      createWithAccount: string;
      readMoreGuides: string;
      openArticle: string;
    }
  >
> = {
  en: {
    createWithAccount: "Sign In To Create",
    readMoreGuides: "Read More Guides",
    openArticle: "Open",
  },
  de: {
    createWithAccount: "Zum Erstellen anmelden",
    readMoreGuides: "Weitere Guides lesen",
    openArticle: "Öffnen",
  },
  es: {
    createWithAccount: "Inicia sesión para crear",
    readMoreGuides: "Leer más guías",
    openArticle: "Abrir",
  },
  fr: {
    createWithAccount: "Connectez-vous pour créer",
    readMoreGuides: "Lire plus de guides",
    openArticle: "Ouvrir",
  },
  it: {
    createWithAccount: "Accedi per creare",
    readMoreGuides: "Leggi altre guide",
    openArticle: "Apri",
  },
  pt: {
    createWithAccount: "Inicie sessão para criar",
    readMoreGuides: "Ler mais guias",
    openArticle: "Abrir",
  },
  ko: {
    createWithAccount: "로그인하고 만들기",
    readMoreGuides: "가이드 더 보기",
    openArticle: "열기",
  },
  ja: {
    createWithAccount: "ログインして作成する",
    readMoreGuides: "さらにガイドを見る",
    openArticle: "開く",
  },
  zh: {
    createWithAccount: "登录后开始创作",
    readMoreGuides: "阅读更多指南",
    openArticle: "打开",
  },
};

export function GeneratorSeoSection({
  locale,
  onOpenSignIn,
  content,
  includeFaqSchema = true,
  showIntro = true,
  className,
}: GeneratorSeoSectionProps) {
  const uiText = GENERATOR_SEO_UI_TEXT[locale] ?? GENERATOR_SEO_UI_TEXT.en!;
  const SectionHeading = showIntro ? "h3" : "h2";
  const ItemHeading = showIntro ? "h4" : "h3";

  const faqSchema = React.useMemo(
    () => ({
      "@context": "https://schema.org",
      "@type": "FAQPage",
      mainEntity: content.faqs.map((faq) => ({
        "@type": "Question",
        name: faq.question,
        acceptedAnswer: {
          "@type": "Answer",
          text: faq.answer,
        },
      })),
    }),
    [content.faqs]
  );

  return (
    <section className={cn("section-space", className)}>
      {includeFaqSchema ? (
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: JSON.stringify(faqSchema) }}
        />
      ) : null}

      {showIntro && <div className="relative overflow-hidden">
        <div className="absolute inset-x-0 top-0 -z-10 h-56 bg-[radial-gradient(circle_at_top_left,hsl(var(--brand-soft))_0,rgba(255,255,255,0.9)_38%,transparent_72%)] blur-2xl" />
        <span className="eyebrow">{content.eyebrow}</span>
        <h2 className="mt-5 max-w-5xl font-display text-4xl font-semibold tracking-[-0.05em] text-foreground sm:text-5xl lg:text-6xl">
          {content.title}
        </h2>
        <p className="mt-5 max-w-3xl text-lg leading-8 text-muted-foreground sm:text-xl sm:leading-9">
          {content.intro}
        </p>

        <div className="mt-8 flex flex-col gap-3 sm:flex-row">
          <button
            type="button"
            onClick={onOpenSignIn}
            className={cn(buttonVariants({ size: "lg" }), "rounded-lg px-6")}
          >
            {uiText.createWithAccount}
          </button>
          <Link
            href={getLocalizedHref("/blogs", locale)}
            className={cn(
              buttonVariants({ variant: "outline", size: "lg" }),
              "rounded-lg px-6"
            )}
          >
            {uiText.readMoreGuides}
          </Link>
        </div>
      </div>}

      {content.bodyHtml && (
        <div
          className="prose prose-slate mt-12 max-w-none prose-headings:tracking-normal prose-p:leading-8 prose-li:leading-8 prose-a:text-primary"
          dangerouslySetInnerHTML={{ __html: content.bodyHtml }}
        />
      )}

      <div className="mt-16 grid gap-14 lg:grid-cols-[minmax(0,1.05fr)_minmax(0,0.95fr)] lg:gap-16">
        <div className="space-y-14">
          <div className="border-t border-border/70 pt-8">
            <SectionHeading className="font-display text-3xl font-semibold tracking-[-0.04em] text-foreground sm:text-4xl">
              {content.useCasesTitle}
            </SectionHeading>
            <div className="mt-8 space-y-8">
              {content.useCases.map((useCase) => (
                <article
                  key={useCase.title}
                  className="border-b border-border/60 pb-8 last:border-b-0 last:pb-0"
                >
                  <ItemHeading className="text-xl font-semibold text-foreground sm:text-[1.45rem]">
                    {useCase.title}
                  </ItemHeading>
                  <p className="mt-3 text-base leading-8 text-muted-foreground sm:text-lg">
                    {useCase.description}
                  </p>
                </article>
              ))}
            </div>
          </div>

          <div className="border-t border-border/70 pt-8">
            <SectionHeading className="font-display text-3xl font-semibold tracking-[-0.04em] text-foreground sm:text-4xl">
              {content.linksTitle}
            </SectionHeading>
            <div className="mt-8 space-y-8">
              {content.links.map((link) => (
                <Link
                  key={link.href}
                  href={getLocalizedHref(link.href, locale)}
                  className="group block border-b border-border/60 pb-8 last:border-b-0 last:pb-0"
                >
                  <div className="text-xl font-semibold text-foreground sm:text-[1.45rem]">
                    {link.title}
                  </div>
                  <p className="mt-3 text-base leading-8 text-muted-foreground sm:text-lg">
                    {link.description}
                  </p>
                  <div className="mt-4 text-base font-semibold text-primary transition-transform duration-200 group-hover:translate-x-1">
                    {uiText.openArticle}
                  </div>
                </Link>
              ))}
            </div>
          </div>
        </div>

        <div className="space-y-14 lg:border-l lg:border-border/70 lg:pl-16">
          <div className="border-t border-border/70 pt-8">
            <SectionHeading className="font-display text-3xl font-semibold tracking-[-0.04em] text-foreground sm:text-4xl">
              {content.featuresTitle}
            </SectionHeading>
            <div className="mt-8 space-y-5">
              {content.features.map((feature) => (
                <div
                  key={feature}
                  className="flex items-start gap-4 border-b border-border/60 pb-5 last:border-b-0 last:pb-0"
                >
                  <span className="mt-3 h-2.5 w-2.5 flex-none rounded-full bg-primary" />
                  <span className="text-base leading-8 text-muted-foreground sm:text-lg">
                    {feature}
                  </span>
                </div>
              ))}
            </div>
          </div>

          <div className="border-t border-border/70 pt-8">
            <SectionHeading className="font-display text-3xl font-semibold tracking-[-0.04em] text-foreground sm:text-4xl">
              {content.faqTitle}
            </SectionHeading>
            <div className="mt-8 space-y-8">
              {content.faqs.map((faq) => (
                <article
                  key={faq.question}
                  className="border-b border-border/60 pb-8 last:border-b-0 last:pb-0"
                >
                  <ItemHeading className="text-xl font-semibold text-foreground sm:text-[1.45rem]">
                    {faq.question}
                  </ItemHeading>
                  <p className="mt-3 text-base leading-8 text-muted-foreground sm:text-lg">
                    {faq.answer}
                  </p>
                </article>
              ))}
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
