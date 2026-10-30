import { redirect } from "next/navigation";
export default async function Home({
  searchParams,
}: {
  searchParams: Promise<{ project?: string; lang?: string }>;
}) {
  const query = await searchParams;
  const lang = ["en", "zh", "es", "fr", "de", "it", "pt", "ja", "ko"].includes(
    query.lang ?? "",
  )
    ? query.lang
    : "en";
  redirect(
    query.project
      ? `/${lang}/applications/editor/${encodeURIComponent(query.project)}?chat=1`
      : `/${lang}/applications/video-edit-ai`,
  );
}
