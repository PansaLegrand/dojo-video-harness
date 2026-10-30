"use client";

import * as React from "react";
import Link from "next/link";
import { useUser } from "@/host/local-user";
import { useRouter } from "next/navigation";
import { ArrowRight, ArrowUpRight, Clapperboard, HardDrive, Loader2, MessageSquare, Plus, Subtitles, WandSparkles } from "lucide-react";
import { useProjectContext } from "@/contexts/ProjectContext";
import { ProjectsDashboard } from "@/components/applications/projects-dashboard";
import { Button } from "@/components/ui/button";
import { APPLICATION_PATHS } from "@/lib/application-paths";
import { useTranslation, type Locale } from "@/lib/i18n";
import { useSignInGate } from "@/lib/use-sign-in-gate";
import { getLocalizedHref } from "@/lib/utils";
import type { GeneratorSeoContent } from "@/lib/generator-seo-content";
import { GeneratorSeoSection } from "@/components/applications/generator-seo-section";

export const VIDEO_EDIT_AI_TUTORIALS = [
  { id: "nOaUzEOVd84", titleKey: "tutorial_1_title", descriptionKey: "tutorial_1_description" },
  { id: "mYgqvAtPrXw", titleKey: "tutorial_2_title", descriptionKey: "tutorial_2_description" },
] as const;

export default function VideoEditAiHome({
  locale: localeProp,
  restyleHref = APPLICATION_PATHS.videoEditing,
  seoContent,
}: { locale?: string; restyleHref?: string | null; seoContent?: GeneratorSeoContent }) {
  const { t, locale: activeLocale } = useTranslation();
  const locale = localeProp ?? activeLocale;
  const text = (key: string) => t(`application.video_edit_ai.${key}`);
  const { isLoaded, isSignedIn } = useUser();
  const { projects } = useProjectContext();
  const hasProjects = isLoaded && isSignedIn && projects.length > 0;
  const router = useRouter();
  const promptSignIn = useSignInGate();
  const [creating, setCreating] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const creatingRef = React.useRef(false);
  const requestRef = React.useRef<AbortController | null>(null);
  React.useEffect(() => () => requestRef.current?.abort(), []);

  async function createVideo() {
    if (!isLoaded || creatingRef.current) return;
    if (!isSignedIn) { promptSignIn(); return; }
    creatingRef.current = true; setCreating(true); setError(null);
    const controller = new AbortController(); requestRef.current = controller;
    let navigating = false;
    try {
      const response = await fetch("/api/projects", { method: "POST", headers: { "Content-Type": "application/json" }, signal: controller.signal,
        body: JSON.stringify({ name: text("default_project_name"), project_kind: "video" }) });
      const payload = await response.json().catch(() => null);
      if (!response.ok || payload?.success !== true || typeof payload?.data?.id !== "string" || !payload.data.id.trim()) {
        throw new Error(typeof payload?.message === "string" ? payload.message : typeof payload?.error === "string" ? payload.error : text("create_error"));
      }
      if (!controller.signal.aborted) { router.push(getLocalizedHref(`${APPLICATION_PATHS.videoEditor}/${encodeURIComponent(payload.data.id)}?chat=1`, locale)); navigating = true; }
    } catch (cause) {
      if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : text("create_error"));
    } finally {
      if (!navigating) { creatingRef.current = false; if (!controller.signal.aborted) setCreating(false); }
    }
  }

  const tutorialSection = <section key="tutorials" aria-labelledby="video-edit-tutorials-heading" className="space-y-4">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
          <div><h2 id="video-edit-tutorials-heading" className="text-lg font-semibold tracking-tight">{text("tutorials_title")}</h2><p className="mt-1 text-sm text-slate-500">{text("tutorials_description")}</p></div>
          {restyleHref && <Link href={getLocalizedHref(restyleHref, locale)} className="group flex max-w-sm items-start gap-2.5 rounded-xl px-2 py-1.5 transition hover:bg-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40" data-testid="video-restyle-link">
            <WandSparkles size={16} className="mt-0.5 shrink-0 text-slate-400" aria-hidden="true" /><span><span className="flex items-center gap-1.5 text-xs font-semibold text-slate-700">{text("provider_tool_label")}<ArrowUpRight size={12} aria-hidden="true" /></span><span className="mt-0.5 block text-[11px] leading-4 text-slate-500">{text("provider_tool_description")}</span></span>
          </Link>}
        </div>
        <div className="grid gap-4 md:grid-cols-2">
          {VIDEO_EDIT_AI_TUTORIALS.map(item => <article key={item.id} className="min-w-0 overflow-hidden rounded-2xl border border-slate-200/90 bg-white shadow-sm" data-tutorial-id={item.id}>
            <div className="aspect-video bg-black">
              <iframe
                className="h-full w-full border-0"
                src={`https://www.youtube.com/embed/${item.id}?rel=0`}
                title={text(item.titleKey)}
                loading="lazy"
                allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
                referrerPolicy="strict-origin-when-cross-origin"
                allowFullScreen
              />
            </div>
            <div className="p-4 sm:p-5">
              <h3 className="text-sm font-semibold text-slate-800">{text(item.titleKey)}</h3>
              <p className="mt-1.5 text-xs leading-5 text-slate-500">{text(item.descriptionKey)}</p>
              <a href={`https://www.youtube.com/watch?v=${item.id}`} target="_blank" rel="noopener noreferrer" className="mt-3 inline-flex items-center gap-1.5 text-xs font-medium text-slate-600 hover:text-slate-950 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40">
                {text("watch_tutorial")} · YouTube<ArrowUpRight size={12} aria-hidden="true" />
              </a>
            </div>
          </article>)}
        </div>
      </section>;

  const projectSection = <section key="projects" aria-labelledby="video-edit-projects-heading" className="space-y-4 pb-5">
        <div><h2 id="video-edit-projects-heading" className="text-lg font-semibold tracking-tight">{text("projects_title")}</h2><p className="mt-1 text-sm text-slate-500">{text("projects_description")}</p></div>
        {!isLoaded ? <div role="status" className="flex items-center gap-2 rounded-2xl border border-slate-200 bg-white p-6 text-sm text-slate-500"><Loader2 size={16} className="animate-spin" aria-hidden="true" />{text("history_loading")}</div>
          : !isSignedIn ? <div className="flex flex-col items-start justify-between gap-4 rounded-2xl border border-slate-200 bg-white p-6 sm:flex-row sm:items-center"><p className="text-sm text-slate-500">{text("sign_in")}</p><Button type="button" variant="outline" className="rounded-full" onClick={promptSignIn}>{t("common.header.login")}</Button></div>
          : <div className="[&_article]:rounded-2xl [&_article]:border-slate-200/90 [&_article]:p-5 [&_h3]:text-slate-800"><ProjectsDashboard isSignedIn onCreateProject={() => void createVideo()} isCreatingProject={creating} hideEmptyCreate /></div>}
      </section>;

  return <div className="min-h-[calc(100dvh-65px)] bg-slate-50 text-slate-950" data-testid="video-edit-ai-home">
    <main className="mx-auto w-full max-w-6xl space-y-8 px-4 py-7 sm:px-6 sm:py-10 lg:space-y-10">
      <section className="relative overflow-hidden rounded-3xl border border-slate-200/80 bg-white p-6 shadow-[0_8px_40px_-28px_rgba(15,23,42,0.25)] sm:p-9">
        <div aria-hidden="true" className="pointer-events-none absolute -right-28 -top-40 h-80 w-80 rounded-full bg-violet-100/60 blur-3xl" />
        <div className="relative flex flex-col justify-between gap-7 sm:flex-row sm:items-center">
          <div className="max-w-2xl">
            <p className="mb-3 flex items-center gap-2 text-[10px] font-semibold uppercase tracking-[0.2em] text-slate-500"><Clapperboard size={14} aria-hidden="true" />{seoContent?.eyebrow ?? text("eyebrow")}</p>
            <h1 className="text-4xl font-semibold tracking-[-0.045em] text-slate-950 sm:text-5xl">{seoContent?.title ?? text("title")}</h1>
            <p className="mt-4 max-w-xl text-sm leading-6 text-slate-500 sm:text-base">{seoContent?.intro ?? text("description")}</p>
          </div>
          <Button type="button" onClick={() => void createVideo()} disabled={!isLoaded || creating} className="h-12 shrink-0 gap-2 rounded-full px-6 shadow-sm sm:min-w-40" data-testid="new-video-button">
            {creating ? <Loader2 size={17} className="animate-spin" aria-hidden="true" /> : <Plus size={17} aria-hidden="true" />}
            {text(creating ? "creating" : "new_video")}
            {!creating && <ArrowRight size={16} className="ml-1" aria-hidden="true" />}
          </Button>
        </div>
        <div className="relative mt-7 flex flex-wrap gap-x-5 gap-y-3 border-t border-slate-100 pt-5 text-xs text-slate-500">
          {[{ icon: MessageSquare, key: "benefit_edit" }, { icon: Subtitles, key: "benefit_captions" }, { icon: HardDrive, key: "benefit_local" }].map(({ icon: Icon, key }) => <span key={key} className="inline-flex items-center gap-2"><Icon size={14} className="text-slate-400" aria-hidden="true" />{text(key)}</span>)}
        </div>
        {error && <p role="alert" className="relative mt-5 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm leading-6 text-red-700">{error}</p>}
      </section>

      {hasProjects ? [projectSection, tutorialSection] : [tutorialSection, projectSection]}
      {!isSignedIn && seoContent && <GeneratorSeoSection locale={locale as Locale} onOpenSignIn={promptSignIn} content={seoContent} showIntro={false} />}
    </main>
  </div>;
}
