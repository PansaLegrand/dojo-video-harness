"use client";
import { useEffect, useState, type FormEvent } from "react";
type PublicProvider = {
  baseUrl: string;
  model: string;
  configured: boolean;
  keyConfigured: boolean;
};
type Settings = { llm: PublicProvider; asr: PublicProvider };
export default function ProviderSettings() {
  const [settings, setSettings] = useState<Settings | null>(null),
    [error, setError] = useState("");
  useEffect(() => {
    fetch("/api/config")
      .then((r) => r.json())
      .then((p) => {
        if (!p.success) throw new Error(p.message);
        setSettings(p.data);
      })
      .catch((e) => setError(e.message));
  }, []);
  if (error) return <p role="alert">{error}</p>;
  if (!settings) return <p role="status">Loading provider settings…</p>;
  return (
    <div className="space-y-6">
      {(["llm", "asr"] as const).map((kind) => (
        <ProviderForm
          key={kind}
          kind={kind}
          initial={settings[kind]}
          onSave={setSettings}
        />
      ))}
    </div>
  );
}
function ProviderForm({
  kind,
  initial,
  onSave,
}: {
  kind: "llm" | "asr";
  initial: PublicProvider;
  onSave: (settings: Settings) => void;
}) {
  const [baseUrl, setBaseUrl] = useState(initial.baseUrl),
    [model, setModel] = useState(initial.model),
    [apiKey, setApiKey] = useState(""),
    [clearKey, setClearKey] = useState(false),
    [busy, setBusy] = useState(false),
    [message, setMessage] = useState(""),
    [error, setError] = useState("");
  const title =
    kind === "llm" ? "GPT chat and translation" : "Speech recognition";
  const inputClass =
    "mt-1 w-full rounded-lg border bg-background px-3 py-2 text-sm";
  async function save(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError("");
    setMessage("");
    try {
      const r = await fetch("/api/provider-settings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          kind,
          baseUrl,
          model,
          ...(apiKey ? { apiKey } : {}),
          clearKey,
        }),
      });
      const payload = await r.json();
      if (!r.ok || !payload.success)
        throw new Error(payload.message ?? "Settings could not be saved.");
      onSave(payload.data);
      setApiKey("");
      setClearKey(false);
      setMessage(
        "Saved. New requests use these settings; current requests keep their original provider.",
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : "Settings could not be saved.");
    } finally {
      setBusy(false);
    }
  }
  return (
    <form
      onSubmit={save}
      aria-label={title}
      className="space-y-4 rounded-xl border bg-card p-6"
    >
      <h2 className="text-lg font-semibold">{title}</h2>
      <p className="text-sm text-muted-foreground">
        {initial.configured
          ? "Configured. A successful edit or transcription verifies provider access."
          : "Optional. Manual editing works without a key."}
      </p>
      {kind === "llm" && (
        <div className="flex gap-3 text-sm">
          <button
            type="button"
            className="text-primary underline"
            onClick={() => {
              setBaseUrl("https://api.openai.com/v1");
              setModel("gpt-6-sol");
            }}
          >
            Use OpenAI
          </button>
          <button
            type="button"
            className="text-primary underline"
            onClick={() => {
              setBaseUrl("https://api.kie.ai/codex/v1");
              setModel("gpt-6-sol");
            }}
          >
            Use Kie
          </button>
        </div>
      )}
      <label className="block text-sm">
        Base URL
        <input
          required
          type="url"
          value={baseUrl}
          onChange={(e) => setBaseUrl(e.target.value)}
          className={inputClass}
        />
      </label>
      <label className="block text-sm">
        Model
        <input
          required
          value={model}
          onChange={(e) => setModel(e.target.value)}
          className={inputClass}
        />
      </label>
      <label className="block text-sm">
        API key
        <input
          type="password"
          autoComplete="off"
          value={apiKey}
          onChange={(e) => setApiKey(e.target.value)}
          placeholder={
            initial.keyConfigured
              ? "Saved key — leave blank to keep it"
              : "Enter your provider key"
          }
          className={inputClass}
        />
      </label>
      {initial.keyConfigured && (
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={clearKey}
            onChange={(e) => setClearKey(e.target.checked)}
          />
          Clear saved key
        </label>
      )}
      {kind === "asr" && (
        <p className="text-sm text-muted-foreground">
          Use an OpenAI-compatible transcription endpoint with word timestamps,
          such as whisper-1. Your GPT key does not automatically configure
          speech recognition.
        </p>
      )}
      <button
        disabled={busy}
        className="rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground disabled:opacity-50"
      >
        {busy ? "Saving…" : "Save settings"}
      </button>
      {message && (
        <p role="status" className="text-sm">
          {message}
        </p>
      )}
      {error && (
        <p role="alert" className="text-sm text-red-600">
          {error}
        </p>
      )}
    </form>
  );
}
