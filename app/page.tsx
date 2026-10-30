import { redirect } from "next/navigation";
export default async function Home({
  searchParams,
}: {
  searchParams: Promise<{ project?: string }>;
}) {
  const query = await searchParams;
  redirect(
    query.project
      ? `/en/applications/editor/${encodeURIComponent(query.project)}?chat=1`
      : "/en/applications/video-edit-ai",
  );
}
