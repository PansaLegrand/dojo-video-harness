"use client";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { VideoProjectAgentRun } from "@/lib/video-project/agent-types";
import type { EditorExternalJobSummary } from "@/lib/video-project/external-job-types";
import { VideoWorkspaceController, videoProjectRequest } from "@/lib/video-project/client-controller";
import { EditorGenerationActions, type EditorGenerationAction, type EditorGenerationActionInput } from "./editor-generation-actions";
import { editorGenerationAssetUsed, editorGenerationCurrentPlacement, editorGenerationPlacement, editorGenerationState } from "./editor-generation-state";
import { startEditorPolling } from "./editor-polling";
import { useNativeEditorText } from "./native-editor-copy";
const statusLabels: Record<string, string> = { quoted: "Waiting for approval", submitting: "Submitting approved job", running: "Generating media", reconciliation_required: "Checking the existing job", storage_pending: "Saving generated media", probing: "Checking generated media", ready: "Saved result ready", needs_review: "Saved output needs review", failed: "Generation needs attention", cancelled: "Cancelled" };
const placementLabels: Record<string, string> = { applied: "Applied to project", removed: "Removed from timeline; saved media is retained", attention: "Needs attention", pending: "Placement ready for the usual edit review", not_added: "Not added to timeline" };
function SavedMediaPreview({ assetId, kind, title, onPausePreview, mainPreviewPlaying }: { assetId: string; kind: string; title: string; onPausePreview?: () => void; mainPreviewPlaying: boolean }) {
  const t = useNativeEditorText(), [url, setUrl] = useState<string | null>(null), [failed, setFailed] = useState(false), ref = useRef<HTMLMediaElement | null>(null);
  const setMediaRef = useCallback((node: HTMLMediaElement | null) => { const previous = ref.current; if (previous && previous !== node) { previous.pause(); previous.removeAttribute("src"); previous.load(); } ref.current = node; }, []);
  useEffect(() => {
    const abort = new AbortController(); let current = true; setUrl(null); setFailed(false);
    void videoProjectRequest<{ download_url: string }>("/api/assets/" + encodeURIComponent(assetId) + "/download-url", { signal: abort.signal }).then(result => {
      const parsed = new URL(result.download_url, location.origin);
      if (parsed.protocol !== "https:" && !(parsed.protocol === "http:" && ["localhost", "127.0.0.1", "[::1]"].includes(parsed.hostname))) throw new Error("Unsafe media location");
      if (current) setUrl(parsed.href);
    }).catch(() => { if (current) setFailed(true); });
    return () => { current = false; abort.abort(); const media = ref.current; if (media) { media.pause(); media.removeAttribute("src"); media.load(); } };
  }, [assetId]);
  useEffect(() => { if (mainPreviewPlaying) ref.current?.pause(); }, [mainPreviewPlaying]);
  return <div className="editor-generation-preview">{failed ? <p role="status">{t("Saved media preview unavailable. The stored result is retained.")}</p> : !url ? <p role="status">{t("Preparing preview…")}</p> : kind === "image" ? <img src={url} alt={title} onError={() => setFailed(true)} /> : kind === "audio" ? <audio ref={setMediaRef} src={url} controls preload="metadata" onPlay={onPausePreview} onError={() => setFailed(true)} /> : <video ref={setMediaRef} src={url} controls playsInline preload="metadata" onPlay={onPausePreview} onError={() => setFailed(true)} />}</div>;
}
export function EditorGenerationCard({ job, run, runs, controller, disabled, active, onChanged, onAuthorizeSources, onRelinkSource, onPausePreview, mainPreviewPlaying = false }: {
  job: EditorExternalJobSummary; run: VideoProjectAgentRun; runs: VideoProjectAgentRun[]; controller: VideoWorkspaceController; disabled: boolean; active: boolean;
  onChanged: () => Promise<void>; onAuthorizeSources: (sourceIds: string[]) => Promise<void>; onRelinkSource?: (sourceId: string) => void; onPausePreview?: () => void; mainPreviewPlaying?: boolean;
}) {
  const t = useNativeEditorText(), document = controller.getState().document, [busy, setBusy] = useState<EditorGenerationAction | null>(null), [error, setError] = useState<string | null>(null);
  const [videoModel, setVideoModel] = useState(job.model);
  useEffect(() => setVideoModel(job.model), [job.id, job.model]);
  const [referenceFailure, setReferenceFailure] = useState(false), [preview, setPreview] = useState(false), [editingPlacement, setEditingPlacement] = useState(false), [autoFailed, setAutoFailed] = useState(false);
  const latest = useRef({ onChanged, onAuthorizeSources }); latest.current = { onChanged, onAuthorizeSources };
  const mounted = useRef(true), inFlight = useRef(false), attemptedAuto = useRef(false), retryAction = useRef<{ action: EditorGenerationAction; input: EditorGenerationActionInput } | null>(null);
  const api = useMemo(() => new EditorGenerationActions({ endpoint: "/api/projects/" + encodeURIComponent(controller.projectId) + "/agent-runs/" + encodeURIComponent(run.id) + "/external-jobs/" + encodeURIComponent(job.id),
    request: videoProjectRequest, prepareContext: () => controller.prepareAgentContext(), authorizeReference: async sourceId => {
      const source = controller.getState().document?.assets[sourceId]; if (!source || source.type !== "image") throw new Error("Reference image unavailable. Relink the original file before approving.");
      await latest.current.onAuthorizeSources([sourceId]); await controller.flush();
    } }), [controller, run.id, job.id]);
  const activeApi = useRef(api); activeApi.current = api;
  const child = runs.find(candidate => candidate.id === job.insertionRunId), used = editorGenerationAssetUsed(job, document), state = editorGenerationState(job, run.status, child?.status, used);
  const initial = document ? editorGenerationCurrentPlacement(job, document) : null, kind = job.kind === "music" ? "audio" : "visual";
  const [trackId, setTrackId] = useState(initial?.trackId ?? ""), [from, setFrom] = useState(String((initial?.fromFrame ?? 0) / (document?.format.fps ?? 30))), [duration, setDuration] = useState(String((initial?.durationInFrames ?? 1) / (document?.format.fps ?? 30))), [volume, setVolume] = useState(String(initial?.volume ?? .2));
  const tracks = document?.tracks.filter(track => track.kind === kind && !track.locked) ?? [];
  const parsedPlacement = document ? editorGenerationPlacement({ trackId, fromFrame: Math.round(Number(from) * document.format.fps), durationInFrames: Math.round(Number(duration) * document.format.fps), volume: Number(volume) }) : null;
  const placementValid = !!parsedPlacement && tracks.some(track => track.id === parsedPlacement.trackId) && from.trim() !== "" && duration.trim() !== "" && volume.trim() !== "";
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, [api]);
  const refresh = async () => { await latest.current.onChanged(); };
  async function perform(action: EditorGenerationAction, input: EditorGenerationActionInput = {}, automatic = false) {
    if (inFlight.current || (action === "insert" || action === "approve") && disabled) return;
    const owner = api; inFlight.current = true; setBusy(action); if (!automatic) { setError(null); setReferenceFailure(false); }
    try {
      retryAction.current = { action, input }; await api.run(action, job, input); retryAction.current = null;
      if (mounted.current && activeApi.current === owner) { setError(null); setEditingPlacement(false); await refresh(); }
    } catch (cause) {
      if (!mounted.current || activeApi.current !== owner) return;
      const code = cause && typeof cause === "object" && "code" in cause ? String(cause.code) : "";
      const failedReference = ["EDITOR_GENERATION_REFERENCE_UPLOAD", "SOURCE_CHANGED", "SOURCE_MISSING"].includes(code) && action === "approve" && !!job.referenceSourceId;
      setReferenceFailure(failedReference);
      if (automatic) setAutoFailed(true);
      setError(code === "EDITOR_GENERATION_PENDING" ? "Retry the pending generation action before changing its placement." : failedReference ? "Reference image unavailable. Relink the original file before approving." : cause && typeof cause === "object" && "status" in cause && cause.status === 402 ? "Not enough credits. Add credits before approving." : "Generation action needs attention. Check the same job before trying again.");
      await refresh().catch(() => {});
    } finally { if (activeApi.current === owner) { inFlight.current = false; if (mounted.current) setBusy(null); } }
  }
  const performRef = useRef(perform); performRef.current = perform;
  useEffect(() => {
    if (!state.active) return;
    return startEditorPolling(async () => { await performRef.current("reconcile", {}, true); }, 5000);
  }, [api, state.active]);
  useEffect(() => { if (!active) setPreview(false); }, [active]);
  useEffect(() => {
    if (disabled || busy || !state.canAutoPlace || attemptedAuto.current || inFlight.current) return;
    attemptedAuto.current = true; void performRef.current("insert", {}, true);
  }, [disabled, busy, state.canAutoPlace, api]);
  const reference = job.referenceSourceId ? document?.assets[job.referenceSourceId] : undefined;
  const placement = editorGenerationPlacement(job.placement), spec = job.specification;
  const quotedSpec = [spec.aspectRatio, spec.resolution, spec.format, spec.durationSeconds !== null ? `${spec.durationSeconds} s` : null, job.kind === "music" ? t("Instrumental music") : job.kind !== "image" ? t(spec.generateAudio ? "Generated audio enabled" : "Generated audio muted") : null].filter(Boolean).join(" · ");
  const blocked = disabled || !!busy;
  const modelChoices = job.modelChoices ?? [];
  const chooseVideoModel = job.status === "quoted" && modelChoices.length > 1 && modelChoices.some(choice => choice.value === job.model);
  const modelChanged = chooseVideoModel && videoModel !== job.model;
  return <section className="editor-generation-card" data-generation-job={job.id} data-generation-status={job.status} aria-label={t(job.kind === "music" ? "Generated music" : job.kind === "image" ? "Generated image" : "Generated video")}>
    <h3>{job.title || t(job.kind === "music" ? "Generated music" : job.kind === "image" ? "Generated image" : "Generated video")}</h3>
    <dl className="editor-agent-progress-states"><div><dt>{t("Generation")}</dt><dd>{t(statusLabels[job.status] ?? "Generation needs attention")}</dd></div><div><dt>{t("Timeline placement")}</dt><dd data-generation-placement={state.placement}>{t(placementLabels[state.placement])}</dd></div></dl>
    <p className="editor-generation-prompt" dir="auto">{job.prompt}</p>
    <p className="editor-generation-spec"><span>{job.model}</span><span>{t("Requested output")}: {quotedSpec}</span>{reference && <span>{t("Reference image")}: {reference.name}</span>}{placement && <span>{t("Timeline placement")}: {document?.tracks.find(track => track.id === placement.trackId)?.name ?? t("Track")} · {Number.isFinite(job.placementFps) && job.placementFps > 0 ? `${(placement.fromFrame / job.placementFps).toFixed(2)}–${((placement.fromFrame + placement.durationInFrames) / job.placementFps).toFixed(2)} s` : "—"}</span>}</p>
    {chooseVideoModel && <label>{t("Model")}<select aria-label={t("Video generation model")} value={videoModel} disabled={blocked} onChange={event => setVideoModel(event.target.value)}>{modelChoices.map(choice => <option key={choice.value} value={choice.value}>{choice.label}</option>)}</select>{modelChanged && <button type="button" disabled={blocked} onClick={() => void perform("requote", { videoModel })}>{t("Update quote")}</button>}</label>}
    {job.status === "quoted" && <><p className="editor-generation-price" data-generation-price>{state.credits !== null ? `${state.credits} ${t("credits")}` : t("Price unavailable. Approval is disabled.")}</p>{!state.quoteValid && <p role="status">{t(state.quoteExpired ? "Quote expired. Ask for a new quote before approving." : "Price unavailable. Approval is disabled.")}</p>}{job.referenceSourceId && <p>{t("Approval uploads this original reference image to project storage and the generation provider.")}</p>}<button type="button" disabled={blocked || !state.canApprove || modelChanged} onClick={() => void perform("approve")}>{t(job.referenceSourceId ? "Approve and upload reference" : "Approve generation")}</button></>}
    {job.cancellationRequested && <p role="status">{t("Cancellation requested. A paid job may still finish; its saved result remains available.")}</p>}
    {job.status === "needs_review" && <p role="status">{t("The saved output differs from the requested settings. Review it before using it.")}</p>}
    {state.outputAvailable && job.output && <><p className="editor-generation-spec">{t("Stored output")}: {job.output.width && job.output.height ? `${job.output.width}×${job.output.height} · ` : ""}{job.output.durationSeconds ? `${job.output.durationSeconds.toFixed(2)} s · ` : ""}{Math.ceil(job.output.byteLength / 1024)} KB · {job.output.mimeType}</p><button type="button" onClick={() => { if (!preview) onPausePreview?.(); setPreview(value => !value); }}>{t(preview ? "Close media preview" : "Preview saved media")}</button>{preview && job.assetId && <SavedMediaPreview assetId={job.assetId} kind={job.output.kind} title={job.title} onPausePreview={onPausePreview} mainPreviewPlaying={mainPreviewPlaying} />}</>}
    {(state.canPlace && (state.mustReuse || autoFailed) || editingPlacement) && <details open={editingPlacement} onToggle={event => setEditingPlacement(event.currentTarget.open)}><summary>{t("Use saved result")}</summary><fieldset disabled={blocked} className="editor-generation-placement-fields"><label>{t("Track")}<select aria-label={t("Track")} value={trackId} onChange={event => setTrackId(event.target.value)}><option value="">{t("Track")}</option>{tracks.map(track => <option key={track.id} value={track.id}>{track.name}</option>)}</select></label><label>{t("Start (s)")}<input aria-label={t("Start (s)")} type="number" min="0" step="0.01" value={from} onChange={event => setFrom(event.target.value)} /></label><label>{t("Maximum placement duration (s)")}<input aria-label={t("Maximum placement duration (s)")} type="number" min="0.01" step="0.01" value={duration} onChange={event => setDuration(event.target.value)} /></label>{job.kind === "music" && <label>{t("Volume")}<input aria-label={t("Volume")} type="number" min="0" max="1" step="0.05" value={volume} onChange={event => setVolume(event.target.value)} /></label>}<button type="button" disabled={!placementValid} onClick={() => parsedPlacement && void perform("insert", { placement: parsedPlacement, reuseSavedResult: true })}>{t("Use saved result")}</button>{!placementValid && <p>{t("Choose an unlocked compatible track and valid placement times.")}</p>}</fieldset></details>}
    {busy && <p role="status">{t(busy === "insert" ? "Preparing timeline placement…" : busy === "reconcile" ? "Checking the existing job" : busy === "approve" ? "Submitting approved job" : busy === "requote" ? "Updating quote" : "Cancellation requested")}</p>}
    {(error || job.status === "failed") && <p role="alert">{t(error ?? "Generation needs attention")}</p>}
    {error && retryAction.current && <button type="button" disabled={blocked} onClick={() => { const retry = retryAction.current; if (retry) void perform(retry.action, retry.input); }}>{t("Retry pending action")}</button>}
    {referenceFailure && job.referenceSourceId && onRelinkSource && reference?.source === "local" && <button type="button" disabled={blocked} onClick={() => onRelinkSource(job.referenceSourceId!)}>{t("Choose original file")}</button>}
    <div className="editor-agent-card-actions">{state.canReconcile && <button type="button" disabled={!!busy} onClick={() => void perform("reconcile")}>{t("Check progress")}</button>}{state.canCancel && <button type="button" disabled={!!busy} onClick={() => void perform("cancel")}>{t("Cancel generation")}</button>}</div>
    <p className="editor-generation-saved-hint">{t("No replacement generation is started when you check or place this saved result.")}</p>
  </section>;
}
