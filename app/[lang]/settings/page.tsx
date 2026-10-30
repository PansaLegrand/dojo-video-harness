import Link from "next/link";
import ProviderSettings from "@/host/provider-settings";
export const dynamic = "force-dynamic";
export default async function Settings({
  params,
}: {
  params: Promise<{ lang: string }>;
}) {
  const { lang } = await params;
  return (
    <main className="mx-auto max-w-2xl space-y-6 px-6 py-12">
      <Link
        href={`/${lang}/applications/video-edit-ai`}
        className="text-sm text-primary"
      >
        ← Your videos
      </Link>
      <h1 className="text-3xl font-semibold">Provider settings</h1>
      <p>
        Bring your own GPT and speech-recognition providers. Provider usage is
        billed by your provider. Manual editing, preview, and export work
        without keys.
      </p>
      <ProviderSettings />
      <p className="text-sm text-muted-foreground">
        Keys are saved only on this computer, in your local data directory.
        Saved keys are never returned to the browser. These settings override
        provider values in .env and apply to new requests without a restart.
      </p>
    </main>
  );
}
