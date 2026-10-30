import Link from "next/link";
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
        Set your keys in the local <code>.env</code> file, then restart the
        server. Keys are never returned to the browser.
      </p>
      <pre className="overflow-auto rounded border bg-muted p-5 text-sm">{`LLM_BASE_URL=https://api.openai.com/v1\nLLM_MODEL=${process.env.LLM_MODEL ?? "gpt-6-sol"}\nLLM_API_KEY=your-key\nASR_BASE_URL=https://api.openai.com/v1\nASR_MODEL=${process.env.ASR_MODEL ?? "whisper-1"}\nASR_API_KEY=your-key`}</pre>
      <p>
        Chat supports GPT models through the Responses API. For Kie, set{" "}
        <code>LLM_BASE_URL=https://api.kie.ai/codex/v1</code> and use your Kie
        key. Keep <code>LLM_MODEL=gpt-6-sol</code>.
      </p>
      <p>
        Manual editing works without keys. Chat and speech recognition use your
        configured providers.
      </p>
    </main>
  );
}
