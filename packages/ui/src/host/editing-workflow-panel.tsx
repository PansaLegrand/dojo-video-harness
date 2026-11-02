"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  videoProjectRequest,
  type VideoWorkspaceController,
} from "@/lib/video-project/client-controller";
import { uploadLocalVideoSource } from "@/lib/video-project/local-assets";
import type { EditingWorkflow } from "../../../../apps/server/src/editing-workflow";

type Plan = EditingWorkflow & {
  runStatus: string;
  applied?: { revision: number; documentHash: string };
};
type ExportResult = {
  revision: number;
  documentHash: string;
  exportId: string;
  blob: Blob;
  width: number;
  height: number;
  fps: number;
  durationInFrames: number;
  resolution: string;
};
export type EditingWorkflowPanelProps = {
  projectId: string;
  controller: VideoWorkspaceController;
  sources: Record<string, string>;
  onAuthorizeSources?: (ids: string[]) => Promise<void>;
  onExportSaved?: (exportId: string) => void;
  onExport: (expected: {
    revision: number;
    documentHash: string;
  }) => Promise<ExportResult>;
};
const request = <T,>(url: string, body: unknown, signal?: AbortSignal) =>
  videoProjectRequest<T>(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    signal,
  });
const wait = (signal: AbortSignal) =>
  new Promise<void>((resolve, reject) => {
    const abort = () => {
      clearTimeout(timer);
      reject(signal.reason ?? new Error("Cancelled"));
    };
    const timer = setTimeout(() => {
      signal.removeEventListener("abort", abort);
      resolve();
    }, 700);
    if (signal.aborted) abort();
    else signal.addEventListener("abort", abort, { once: true });
  });

/** Browser-owned media access/export, with server-owned plans and provider receipts. */
export function EditingWorkflowPanel({
  projectId,
  controller,
  onExport,
  onExportSaved,
}: EditingWorkflowPanelProps) {
  const [plans, setPlans] = useState<Plan[]>([]),
    [consent, setConsent] = useState<Record<string, boolean>>({}),
    [busy, setBusy] = useState<string | null>(null),
    [progress, setProgress] = useState(""),
    [error, setError] = useState<string | null>(null);
  const active = useRef<AbortController | null>(null);
  const base = `/api/projects/${encodeURIComponent(projectId)}/editing-workflows`;
  const refresh = useCallback(async () => {
    setPlans(await videoProjectRequest<Plan[]>(base));
  }, [base]);
  useEffect(() => {
    let current = true;
    const poll = () =>
      videoProjectRequest<Plan[]>(base)
        .then((value) => {
          if (current) setPlans(value);
        })
        .catch(() => {});
    void poll();
    const timer = setInterval(poll, 1800);
    return () => {
      current = false;
      clearInterval(timer);
      active.current?.abort();
    };
  }, [base]);
  const operate = async (plan: Plan) => {
    if (active.current) return;
    const abort = new AbortController();
    active.current = abort;
    setBusy(plan.id);
    setError(null);
    try {
      if (plan.status === "awaiting_approval") {
        if (!consent[plan.id])
          throw new Error("Confirm the media/provider permission first.");
        const current = await controller.flush();
        await request(
          `${base}/${plan.id}/approve`,
          {
            baseRevision: current.revision,
            baseHash: current.documentHash,
            sourceConsent: true,
          },
          abort.signal,
        );
      }
      const asr: Array<{ assetId: string; taskId: string }> = [];
      for (const source of plan.sources) {
        setProgress(`Preparing ${source.name} for your ASR provider…`);
        await uploadLocalVideoSource(
          projectId,
          source.sourceId,
          () => {},
          abort.signal,
        );
        const submitted = await request<{ task_id: string }>(
          "/api/asr/tasks",
          {
            project_id: projectId,
            asset_id: source.sourceId,
            request_id: source.requestId,
            language: plan.input.sourceLanguage,
          },
          abort.signal,
        );
        setProgress(`Transcribing ${source.name}…`);
        for (;;) {
          const task = await videoProjectRequest<{
            status: string;
            error_message?: string;
          }>(`/api/asr/tasks/${submitted.task_id}`, { signal: abort.signal });
          if (task.status === "completed") break;
          if (task.status === "failed")
            throw new Error(
              task.error_message ??
                "Transcription failed; this request will not be silently repeated.",
            );
          await wait(abort.signal);
        }
        asr.push({ assetId: source.assetId, taskId: submitted.task_id });
      }
      const prepared = await request<{
        captions: Array<{
          itemId: string;
          cues: Array<{ text: string; startMs: number; endMs: number }>;
        }>;
      }>(`${base}/${plan.id}/captions`, { asr }, abort.signal);
      const translations: Array<{ itemId: string; taskId: string }> = [];
      if (plan.input.translationLanguage)
        for (const caption of prepared.captions) {
          setProgress(
            `Translating captions to ${plan.input.translationLanguage}…`,
          );
          const translated = await request<{ task_id: string }>(
            "/api/subtitle-translation",
            {
              project_id: projectId,
              request_id: plan.translations[caption.itemId],
              target_language: plan.input.translationLanguage,
              utterances: caption.cues.map((cue, index) => ({
                text: cue.text,
                index,
                start_time_ms: Math.round(cue.startMs),
                end_time_ms: Math.round(cue.endMs),
              })),
            },
            abort.signal,
          );
          translations.push({
            itemId: caption.itemId,
            taskId: translated.task_id,
          });
        }
      await request(
        `${base}/${plan.id}/complete`,
        { asr, translations },
        abort.signal,
      );
      setProgress(
        "Ready to compare and apply in chat. Your saved project is unchanged.",
      );
      await controller.refresh();
      await refresh();
    } catch (cause) {
      if (!abort.signal.aborted)
        setError(cause instanceof Error ? cause.message : "Workflow failed.");
    } finally {
      active.current = null;
      setBusy(null);
    }
  };
  const exportPlan = async (plan: Plan) => {
    if (active.current || !plan.applied) return;
    const abort = new AbortController();
    active.current = abort;
    setBusy(plan.id);
    setError(null);
    try {
      setProgress("Exporting the applied workflow revision…");
      const result = await onExport(plan.applied);
      abort.signal.throwIfAborted();
      if (
        result.revision !== plan.applied.revision ||
        result.documentHash !== plan.applied.documentHash
      )
        throw new Error(
          "The export revision differs from the approved workflow.",
        );
      const hash = [
        ...new Uint8Array(
          await crypto.subtle.digest(
            "SHA-256",
            await result.blob.arrayBuffer(),
          ),
        ),
      ]
        .map((x) => x.toString(16).padStart(2, "0"))
        .join("");
      const response = await fetch(
        `/api/projects/${projectId}/exports/${result.exportId}`,
        {
          method: "PUT",
          headers: {
            "Content-Type": "video/mp4",
            "x-content-sha256": hash,
            "x-content-bytes": String(result.blob.size),
          },
          body: result.blob,
          signal: abort.signal,
        },
      );
      if (!response.ok)
        throw new Error(
          "Video downloaded, but saving the pinned export failed. Retry saving from the editor.",
        );
      await request(
        `${base}/${plan.id}/exported`,
        { exportId: result.exportId },
        abort.signal,
      );
      onExportSaved?.(result.exportId);
      setProgress("Workflow export is saved and ready.");
      await refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Export failed.");
    } finally {
      active.current = null;
      setBusy(null);
    }
  };
  const cancel = async (plan: Plan) => {
    active.current?.abort();
    await request(`${base}/${plan.id}/cancel`, {});
    await refresh();
  };
  const visible = plans.filter(
    (p) =>
      p.status !== "cancelled" &&
      !["cancelled", "failed", "stale"].includes(p.runStatus),
  );
  if (!visible.length) return null;
  return (
    <section
      aria-label="Editing workflows"
      className="max-h-[45vh] shrink-0 space-y-3 overflow-y-auto border-b border-[var(--editor-border)] p-3 text-xs"
    >
      {visible.map((plan) => (
        <article
          key={plan.id}
          className="space-y-2 rounded border border-[var(--editor-border)] p-3"
          aria-label="Editing workflow plan"
        >
          <strong>Editing workflow</strong>
          <p>
            Join {plan.input.clipIds.length} clips in the requested order
            {plan.input.logoAssetId ? ", overlay the imported logo" : ""}
            {plan.input.generateCaptions ? ", generate captions" : ""}
            {plan.input.translationLanguage
              ? `, translate to ${plan.input.translationLanguage}`
              : ""}
            {plan.input.exportVideo ? ", then export after review" : ""}.
          </p>
          {plan.status === "awaiting_approval" && (
            <>
              <p>
                Speech sources:{" "}
                {plan.sources
                  .map(
                    (x) =>
                      `${x.name} (${(x.byteLength / 1048576).toFixed(1)} MiB)`,
                  )
                  .join(", ") || "None"}
                . Provider calls may incur charges. The full edit remains a
                proposal until you compare and apply it. Cancelling stops later
                stages; provider calls already accepted may still complete and
                incur charges.
              </p>
              <label className="flex gap-2">
                <input
                  type="checkbox"
                  checked={!!consent[plan.id]}
                  onChange={(e) =>
                    setConsent((v) => ({ ...v, [plan.id]: e.target.checked }))
                  }
                />
                Allow this workflow to send the listed sources to my ASR
                provider and captions to my GPT provider.
              </label>
              <button
                className="rounded bg-violet-600 px-3 py-2 text-white disabled:opacity-40"
                disabled={
                  !!busy ||
                  !consent[plan.id] ||
                  ["queued", "running"].includes(plan.runStatus)
                }
                onClick={() => void operate(plan)}
              >
                Approve workflow preparation
              </button>
            </>
          )}
          {plan.status === "approved" && (
            <button
              disabled={!!busy}
              onClick={() => void operate(plan)}
              className="underline"
            >
              Resume approved workflow
            </button>
          )}
          {plan.status === "awaiting_review" &&
            plan.runStatus !== "applied" && (
              <p>
                Preparation finished. Use Compare and Apply in the chat proposal
                before exporting.
              </p>
            )}
          {plan.status === "awaiting_review" &&
            plan.runStatus === "applied" &&
            plan.input.exportVideo && (
              <button
                disabled={!!busy || !plan.applied}
                className="rounded bg-violet-600 px-3 py-2 text-white disabled:opacity-40"
                onClick={() => void exportPlan(plan)}
              >
                Export approved workflow
              </button>
            )}
          {plan.status === "exported" && (
            <a
              className="underline"
              href={`/en/applications/editor/${projectId}/outputs`}
            >
              Workflow complete · view saved video
            </a>
          )}
          {plan.runStatus !== "applied" && plan.status !== "exported" && (
            <button
              className="ml-3 underline"
              onClick={() => void cancel(plan)}
            >
              Cancel workflow
            </button>
          )}
          {busy === plan.id && <p role="status">{progress}</p>}
        </article>
      ))}
      {error && (
        <p role="alert" className="text-red-600">
          {error}
        </p>
      )}
    </section>
  );
}
