import React, { useEffect, useState, lazy, Suspense } from "react";
import { createRoot } from "react-dom/client";
const VideoEditor = lazy(() =>
  import("../../../packages/ui/src").then((module) => ({
    default: module.VideoEditor,
  })),
);
import "./style.css";
type Project = { id: string; name: string };
type Config = {
  llm: { baseUrl: string; model: string; configured: boolean };
  asr: { baseUrl: string; model: string; configured: boolean };
};
function App() {
  const [projects, setProjects] = useState<Project[]>([]),
    [project, setProject] = useState<string | null>(
      new URLSearchParams(location.search).get("project"),
    ),
    [config, setConfig] = useState<Config | null>(null),
    [settings, setSettings] = useState(false),
    [error, setError] = useState("");
  const refresh = async () => {
    const r = await fetch("/api/projects");
    const b = await r.json();
    if (!r.ok) throw new Error(b.message);
    setProjects(b.data);
  };
  useEffect(() => {
    void refresh().catch((e) => setError(e.message));
    void fetch("/api/config")
      .then((r) => r.json())
      .then((r) => setConfig(r.data));
    const open = () => setSettings(true);
    window.addEventListener("open-provider-settings", open);
    return () => window.removeEventListener("open-provider-settings", open);
  }, []);
  const choose = (id: string) => {
    history.pushState(null, "", "?project=" + id);
    setProject(id);
  };
  async function create() {
    try {
      const r = await fetch("/api/projects", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: "Untitled video" }),
      });
      const b = await r.json();
      if (!r.ok) throw new Error(b.message);
      await refresh();
      choose(b.data.id);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not create project");
    }
  }
  return (
    <>
      {project ? (
        <>
          <Suspense fallback={<p className="harness-home">Loading editor…</p>}>
            <VideoEditor key={project} projectId={project} chatInitiallyOpen />
          </Suspense>
          <button
            className="harness-settings-float"
            onClick={() => setSettings(true)}
          >
            Providers
          </button>
        </>
      ) : (
        <main className="harness-home">
          <div className="harness-home-top">
            <span>DOJO VIDEO HARNESS</span>
            <button onClick={() => setSettings(true)}>Provider settings</button>
          </div>
          <section>
            <p className="harness-eyebrow">OPEN SOURCE · LOCAL FIRST</p>
            <h1>
              Your editor.
              <br />
              Your models.
            </h1>
            <p className="harness-intro">
              Edit by hand or ask an agent. One timeline, reversible changes,
              and your own provider keys.
            </p>
            <button className="harness-create" onClick={() => void create()}>
              Create a video <span>↗</span>
            </button>
            <p className="harness-home-note">
              No account needed. Import and export stay on your device.
            </p>
          </section>
          <section className="harness-projects">
            <h2>Your projects</h2>
            {projects.length ? (
              projects.map((p) => (
                <button key={p.id} onClick={() => choose(p.id)}>
                  <span className="harness-project-icon">▶</span>
                  <strong>{p.name}</strong>
                  <span>Open editor →</span>
                </button>
              ))
            ) : (
              <p>
                Start with an empty timeline. Add footage, text, captions, or
                motion graphics.
              </p>
            )}
          </section>
          {error && <p role="alert">{error}</p>}
        </main>
      )}
      {settings && (
        <div className="harness-settings-backdrop">
          <section
            role="dialog"
            aria-modal="true"
            aria-label="Provider settings"
            className="harness-settings"
          >
            <header>
              <h2>Bring your own providers</h2>
              <button
                onClick={() => setSettings(false)}
                aria-label="Close provider settings"
              >
                ×
              </button>
            </header>
            <p>
              Keys are read by your local Node server. They are never returned
              to the browser.
            </p>
            <dl>
              <dt>LLM</dt>
              <dd>
                {config?.llm.model} ·{" "}
                {config?.llm.configured ? "Configured" : "Key needed for chat"}
                <small>{config?.llm.baseUrl}</small>
              </dd>
              <dt>Transcription</dt>
              <dd>
                {config?.asr.model} ·{" "}
                {config?.asr.configured
                  ? "Configured"
                  : "Key needed for speech recognition"}
                <small>{config?.asr.baseUrl}</small>
              </dd>
            </dl>
            <p>
              Copy <code>.env.example</code> to <code>.env</code>, set your keys
              and models, then restart <code>npm run dev</code>.
            </p>
            <pre>
              LLM_API_KEY=your-key{"\n"}LLM_MODEL=your-model{"\n"}
              ASR_API_KEY=your-key{"\n"}ASR_MODEL=whisper-1
            </pre>
            <p>
              OpenAI-compatible endpoints are supported, including local
              servers. Transcription must return real word timestamps. Provider
              usage is billed by your provider.
            </p>
            <p className="harness-home-note">
              Manual editing, subtitle import, preview, and export work without
              provider keys.
            </p>
          </section>
        </div>
      )}
    </>
  );
}
createRoot(document.getElementById("root")!).render(<App />);
