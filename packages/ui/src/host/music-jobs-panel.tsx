"use client";
import { useEffect, useRef, useState } from "react";
import type { VideoWorkspaceController } from "@/lib/video-project/client-controller";
import type { PublicMusicJob } from "../../../../apps/server/src/music-service";
async function api<T>(url: string, body?: unknown): Promise<T> {
  const response = await fetch(
    url,
    body === undefined
      ? { cache: "no-store" }
      : {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        },
  );
  const value = await response.json();
  if (!response.ok || !value.success)
    throw new Error(value.message ?? "Music request failed.");
  return value.data;
}
export function MusicJobsPanel({
  projectId,
  controller,
}: {
  projectId: string;
  controller: VideoWorkspaceController;
}) {
  const [jobs, setJobs] = useState<PublicMusicJob[]>([]),
    [error, setError] = useState(""),
    [busy, setBusy] = useState<string | null>(null);
  const [prompt, setPrompt] = useState(""),
    [taskId, setTaskId] = useState("");
  const alive = useRef(true);
  const base = `/api/projects/${encodeURIComponent(projectId)}/music-jobs`;
  useEffect(() => {
    alive.current = true;
    let stopped = false,
      timer: ReturnType<typeof setTimeout>;
    const poll = async () => {
      try {
        const values = await api<PublicMusicJob[]>(base);
        if (stopped) return;
        setJobs(values);
        const state = controller.getContentState();
        if (
          !state.pending.length &&
          !state.interactionDrafts &&
          values.some(
            (job) =>
              job.status === "completed" &&
              (job.insertedRevision ?? 0) > (state.snapshot?.revision ?? 0),
          )
        )
          await controller.refresh();
      } catch (cause) {
        if (!stopped)
          setError(
            cause instanceof Error
              ? cause.message
              : "Music status unavailable.",
          );
      } finally {
        if (!stopped) timer = setTimeout(poll, 2000);
      }
    };
    void poll();
    return () => {
      stopped = true;
      alive.current = false;
      clearTimeout(timer);
    };
  }, [base, controller]);
  async function action(job: PublicMusicJob, verb: string) {
    setBusy(job.id);
    setError("");
    try {
      if (verb === "approve") {
        if (controller.getContentState().interactionDrafts)
          throw new Error(
            "Finish the current manual edit before approving music.",
          );
        await controller.flush();
      }
      const updated = await api<PublicMusicJob>(
        `${base}/${job.id}/${verb}`,
        verb === "reconcile" ? { taskId: taskId.trim(), confirmed: true } : {},
      );
      if (alive.current)
        setJobs((values) =>
          values.map((value) => (value.id === updated.id ? updated : value)),
        );
      if (updated.status === "completed") await controller.refresh();
    } catch (cause) {
      if (alive.current)
        setError(
          cause instanceof Error ? cause.message : "Music action failed.",
        );
    } finally {
      if (alive.current) setBusy(null);
    }
  }
  async function prepare() {
    setBusy("prepare");
    setError("");
    try {
      if (controller.getContentState().interactionDrafts)
        throw new Error("Finish the current manual edit first.");
      const p = await controller.flush(),
        track = p.document.tracks.find((t) => t.kind === "audio" && !t.locked);
      if (!track) throw new Error("Add an unlocked audio track first.");
      const job = await api<PublicMusicJob>(base, {
        operationId: crypto.randomUUID(),
        baseRevision: p.revision,
        baseHash: p.documentHash,
        prompt,
        title: "Background music",
        trackId: track.id,
        fromFrame: 0,
        durationInFrames: p.document.format.durationInFrames,
        volume: 0.2,
      });
      if (alive.current) {
        setJobs((values) => [...values, job]);
        setPrompt("");
      }
    } catch (cause) {
      if (alive.current)
        setError(cause instanceof Error ? cause.message : "Music plan failed.");
    } finally {
      if (alive.current) setBusy(null);
    }
  }
  const button = "rounded border px-2 py-1 text-xs disabled:opacity-50";
  return (
    <details
      className="shrink-0 border-b border-[var(--editor-border)] p-3 text-xs"
      open={
        jobs.some(
          (j) => !["completed", "cancelled", "failed"].includes(j.status),
        ) || undefined
      }
    >
      <summary className="cursor-pointer font-medium">
        Background music {jobs.length ? `(${jobs.length})` : ""}
      </summary>
      <div className="max-h-[35vh] space-y-3 overflow-y-auto pt-3">
        <p>
          Generate instrumental music with your own Kie key. Review the plan
          before spending provider credits.
        </p>
        <label className="block">
          Music description
          <input
            aria-label="Background music description"
            maxLength={1000}
            className="mt-1 w-full rounded border bg-[var(--editor-surface)] p-2"
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            placeholder="Warm piano, gentle rhythm, no vocals"
          />
        </label>
        <button
          type="button"
          className={button}
          disabled={!!busy || !prompt.trim()}
          onClick={() => void prepare()}
        >
          Prepare music plan
        </button>
        {[...jobs]
          .reverse()
          .slice(0, 8)
          .map((job) => (
            <section
              key={job.id}
              aria-label={`Music job: ${job.request.title}`}
              className="space-y-2 rounded border p-3"
            >
              <strong>{job.request.title}</strong>
              <p>{job.request.prompt}</p>
              <p>
                Track:{" "}
                {controller
                  .getContentState()
                  .document?.tracks.find(
                    (track) => track.id === job.request.trackId,
                  )?.name ?? job.request.trackId}
              </p>
              <p>
                Instrumental · up to{" "}
                {(job.request.durationInFrames / job.fps).toFixed(1)}s · starts{" "}
                {(job.request.fromFrame / job.fps).toFixed(1)}s · volume{" "}
                {Math.round(job.request.volume * 100)}%
              </p>
              <p role="status">{job.status.replaceAll("_", " ")}</p>
              {job.error && (
                <p className="text-amber-700">{job.error.message}</p>
              )}
              {job.mediaUrl && (
                <audio
                  aria-label="Generated background music"
                  controls
                  preload="none"
                  src={job.mediaUrl}
                  className="w-full"
                />
              )}
              {job.status === "awaiting_approval" && (
                <>
                  <p>
                    Approval authorizes one paid generation and automatic
                    insertion of the first provider track into the approved
                    audio track. Undo does not refund provider charges.
                  </p>
                  <button
                    type="button"
                    className={button}
                    disabled={!!busy}
                    onClick={() => void action(job, "approve")}
                  >
                    Generate and insert music
                  </button>
                </>
              )}
              {["needs_attention", "ready_for_insertion"].includes(
                job.status,
              ) &&
                job.hasProviderTask && (
                  <button
                    type="button"
                    className={button}
                    disabled={!!busy}
                    onClick={() => void action(job, "resume")}
                  >
                    Resume existing music job
                  </button>
                )}
              {job.status === "submission_unknown" && (
                <div>
                  <label>
                    Existing provider task ID
                    <input
                      aria-label="Existing music provider task ID"
                      className="w-full rounded border p-2"
                      value={taskId}
                      onChange={(e) => setTaskId(e.target.value)}
                    />
                  </label>
                  <p>
                    Copy the original task ID from your provider history. This
                    resumes that task; it does not create a replacement.
                  </p>
                  <button
                    type="button"
                    className={button}
                    disabled={!!busy || !taskId.trim()}
                    onClick={() => void action(job, "reconcile")}
                  >
                    Reconcile existing task
                  </button>
                </div>
              )}
              {!["completed", "cancelled", "failed"].includes(job.status) && (
                <button
                  type="button"
                  className={button}
                  disabled={!!busy}
                  onClick={() => void action(job, "cancel")}
                >
                  Cancel music insertion
                </button>
              )}
            </section>
          ))}
        {error && (
          <p role="alert" className="text-red-600">
            {error}
          </p>
        )}
        <a className="underline" href="/en/settings">
          Music provider settings
        </a>
      </div>
    </details>
  );
}
