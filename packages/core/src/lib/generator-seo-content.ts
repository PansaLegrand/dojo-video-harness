type SeoUseCase = {
  title: string;
  description: string;
};

type SeoFaq = {
  question: string;
  answer: string;
};

type SeoLink = {
  title: string;
  description: string;
  href: string;
};

type SeoPromo = {
  eyebrow: string;
  title: string;
  description: string;
  ctaLabel: string;
  href: string;
  image?: string;
};

export type GeneratorSeoContent = {
  bodyHtml?: string;
  eyebrow: string;
  title: string;
  intro: string;
  useCasesTitle: string;
  useCases: SeoUseCase[];
  featuresTitle: string;
  features: string[];
  faqTitle: string;
  faqs: SeoFaq[];
  linksTitle: string;
  links: SeoLink[];
  musicVideoPromo?: SeoPromo;
};
