"use client";
import "./editor-authoring.css";
import { startEditorPolling } from "./editor-polling";
import { type ReactNode, Fragment, useCallback, useEffect, useId, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { Loader2, Send, Sparkles, X } from "lucide-react";
import { VideoWorkspaceController, videoProjectRequest, type VideoProjectSnapshot } from "@/lib/video-project/client-controller";
import type { VideoProjectAgentRun as WorkspaceAgentRun, VideoProjectAgentMessage } from "@/lib/video-project/agent-types";
import { editorCapabilityDescriptors, editorLookId, type EditorCapabilityInput } from "@/lib/video-project/capabilities";
import { editorMediaFilters } from "@/lib/editor/presets";
import { useNativeEditorText } from "./native-editor-copy";
import { EditorAuthoringScope, resolveEditorAuthoringScope, type EditorAuthoringScopeChoice } from "./editor-authoring-scope";
import { EditorClarification } from "./editor-clarification";
import { EditorAgentReview, type NativeAgentComparison } from "./editor-agent-review";
import { editorQuickActions, editorComparisonIsStale } from "./editor-agent-actions";

type AgentState = { runs: WorkspaceAgentRun[]; messages: VideoProjectAgentMessage[] };
const definitiveStatuses = new Set([400, 401, 402, 403, 404, 409, 413, 422]);
function definitiveRejection(cause: unknown) { return !!cause && typeof cause === "object" && ("code" in cause && cause.code === "NATIVE_RUNTIME_UNAVAILABLE" || "status" in cause && definitiveStatuses.has(Number(cause.status))); }
function messageFor(cause: unknown, fallback: string) {
  const code = cause && typeof cause === "object" && "code" in cause ? cause.code : undefined;
  return code === "NATIVE_REVIEW_STALE" ? "The project is changing. Finish your current edit, then retry the saved result." : code === "VISUAL_CONTEXT_STALE" ? "The preview frame changed. Revise the request with a new frame." : cause instanceof Error ? cause.message : fallback;
}
const button = "rounded border border-[var(--editor-border)] px-3 py-2 text-xs text-[var(--editor-text)] hover:bg-[var(--editor-hover)] disabled:opacity-40";
const initialScope: EditorAuthoringScopeChoice = { kind: "automatic", fromSeconds: "0", toSeconds: "5" };
const catalog = editorCapabilityDescriptors();
export function VideoWorkspaceChat({ extensions, resizeHandle, controller, sources, onAuthorizeSources, onCaptureVisualContext, onClose, onCapabilityAction, onSeekFrame, onPausePreview, mainPreviewPlaying = false, hidden = false }: {
  resizeHandle?: ReactNode;
  extensions?: ReactNode;
  controller: VideoWorkspaceController; sources: Record<string, string>; onAuthorizeSources: (assetIds: string[]) => Promise<void>;
  onCaptureVisualContext: (snapshot: VideoProjectSnapshot, itemId: string, frame: number) => Promise<unknown>; onClose: () => void; hidden?: boolean;
  onCapabilityAction?: (action: EditorCapabilityInput) => void | Promise<void>; onSeekFrame?: (frame: number) => void; onPausePreview?: () => void; mainPreviewPlaying?: boolean;
}) {
  const t = useNativeEditorText(), workspace = useSyncExternalStore(controller.subscribeContent, controller.getContentState, controller.getContentState);
  const [data, setData] = useState<AgentState>({ runs: [], messages: [] }), [instruction, setInstruction] = useState("");
  const [includeFrame, setIncludeFrame] = useState(false), [error, setError] = useState<string | null>(null), [busy, setBusy] = useState<string | null>(null);
  const [scopeChoice, setScopeChoice] = useState<EditorAuthoringScopeChoice>(initialScope), [referenceId, setReferenceId] = useState<string | null>(null);
  const [comparison, setComparison] = useState<NativeAgentComparison | null>(null), [reviewingId, setReviewingId] = useState<string | null>(null);
  const [actionNotice, setActionNotice] = useState<string | null>(null), [answers, setAnswers] = useState<Record<string, string>>({});
  const scrollRef = useRef<HTMLDivElement>(null), composerRef = useRef<HTMLTextAreaElement>(null), followMessages = useRef(true), composing = useRef(false);
  const shortcutHintId = useId(), generation = useRef(0), liveController = useRef(controller); liveController.current = controller;
  const inFlight = useRef(new Set<string>()), attemptedApply = useRef(new Set<string>());
  const sendAttempt = useRef<{ instruction: string; body: unknown } | null>(null), applyAttempts = useRef(new Map<string, unknown>());
  const recoveryAttempts = useRef(new Map<string, unknown>()), undoAttempts = useRef(new Map<string, unknown>());
  const answerAttempts = useRef(new Map<string, { choice: string; body: unknown }>());
  const reviewSequence = useRef(0), attemptedUploads = useRef(new Set<string>());
  const endpoint = "/api/projects/" + encodeURIComponent(controller.projectId) + "/agent-runs";
  const current = (epoch: number) => generation.current === epoch && liveController.current === controller;
  useEffect(() => {
    generation.current++; setData({ runs: [], messages: [] }); setInstruction(""); setReferenceId(null); setComparison(null); setReviewingId(null); setError(null); setBusy(null); setScopeChoice(initialScope); setActionNotice(null); setAnswers({});
    inFlight.current.clear(); attemptedApply.current.clear(); attemptedUploads.current.clear(); applyAttempts.current.clear(); recoveryAttempts.current.clear(); undoAttempts.current.clear(); answerAttempts.current.clear(); sendAttempt.current = null;
    return () => { generation.current++; reviewSequence.current++; };
  }, [controller]);
  const refresh = useCallback(async () => {
    const epoch = generation.current;
    try { const next = await videoProjectRequest<AgentState>(endpoint); if (generation.current === epoch && liveController.current === controller) setData(next); }
    catch (cause) { if (generation.current === epoch && liveController.current === controller) throw cause; }
  }, [controller, endpoint]);
  const hasActiveRun = data.runs.some(run => ["queued", "running", "needs_evidence"].includes(run.status) || run.phase === "cancellation_pending");
  useEffect(() => startEditorPolling(refresh, hasActiveRun ? 2500 : 30_000, cause => setError(messageFor(cause, "Could not refresh edit status."))), [refresh, hasActiveRun]);
  useEffect(() => { if (!hidden && followMessages.current) scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight }); }, [data, hidden, busy, comparison]);
  useEffect(() => { if (hidden) { reviewSequence.current++; setComparison(null); setReviewingId(null); } }, [hidden]);
  useEffect(() => {
    const attempt = sendAttempt.current;
    if (attempt && data.runs.some(run => run.operationId === (attempt.body as { operationId?: string }).operationId)) {
      sendAttempt.current = null; setInstruction(value => value === attempt.instruction ? "" : value); setReferenceId(null);
    }
  }, [data.runs]);
  useEffect(() => {
    for (const run of data.runs) {
      const pending = answerAttempts.current.get(run.id), childId = run.clarificationReply?.continuationRunId;
      if (!pending || !childId) continue;
      const child = data.runs.find(candidate => candidate.id === childId);
      if (child?.operationId === (pending.body as { operationId?: string }).operationId) {
        answerAttempts.current.delete(run.id); setAnswers(values => ({ ...values, [run.id]: "" })); setError(null);
      }
    }
  }, [data.runs]);
  const resolvedScope = useMemo(() => resolveEditorAuthoringScope(workspace.document, workspace.selectedItemIds, workspace.selectedNodeId, scopeChoice), [workspace.document, workspace.selectedItemIds, workspace.selectedNodeId, scopeChoice]);
  const quick = useMemo(() => editorQuickActions(workspace.document, workspace.selectedItemId, workspace.selectedNodeId, resolvedScope.scope), [workspace.document, workspace.selectedItemId, workspace.selectedNodeId, resolvedScope]);
  const selected = workspace.document?.items.find(item => item.id === workspace.selectedItemId);
  const suggestions = referenceId ? ["Make this shorter", "Try a different style"] : selected && ["video", "audio"].includes(selected.node.type)
    ? ["Add captions to this clip", "Find a phrase in this clip"] : selected?.node.type === "text" ? ["Make this shorter", "Try a different style"] : ["Create an opening title", "Create a motion graphic"];

  const applyRun = useCallback(async (run: WorkspaceAgentRun, reviewed?: NativeAgentComparison) => {
    if (inFlight.current.has(run.id) || controller.getState().interactionDrafts) return;
    const epoch = generation.current; inFlight.current.add(run.id); setBusy(run.id); setError(null);
    let interruptedByDraft = false;
    try {
      for (let attempt = 0; attempt < 2; attempt++) {
        try {
          const snapshot = await controller.prepareAgentContext(); if (!current(epoch)) return;
          if (!applyAttempts.current.has(run.id)) {
            const prepared = reviewed ?? await videoProjectRequest<NativeAgentComparison>(endpoint + "/" + encodeURIComponent(run.id) + "/review", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ baseRevision: snapshot.revision, baseHash: snapshot.documentHash }) });
            if (!current(epoch)) return;
            const latest = controller.getState();
            if (latest.interactionDrafts || latest.pending.length || latest.snapshot?.documentHash !== snapshot.documentHash) { interruptedByDraft = true; return; }
            if (prepared.run.id !== run.id) throw new Error("The saved edit could not be matched to this request.");
            if (prepared.applied) { await controller.refresh(); await refresh(); return; }
            if (editorComparisonIsStale(prepared.review.basis, snapshot, 0, 0)) throw Object.assign(new Error("The project is changing. Finish your current edit, then retry the saved result."), { status: 409, code: "NATIVE_REVIEW_STALE" });
            applyAttempts.current.set(run.id, { operationId: crypto.randomUUID(), baseRevision: snapshot.revision, baseHash: snapshot.documentHash, reviewBasis: prepared.review.basis });
          }
          const result = await videoProjectRequest<VideoProjectSnapshot | { snapshot: VideoProjectSnapshot }>(endpoint + "/" + encodeURIComponent(run.id) + "/apply", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(applyAttempts.current.get(run.id)) });
          if (!current(epoch)) return;
          applyAttempts.current.delete(run.id); controller.acceptSnapshot("snapshot" in result ? result.snapshot : result);
          await controller.refresh(); await refresh(); if (current(epoch)) setComparison(null);
          return;
        } catch (cause) {
          const code = cause && typeof cause === "object" && "code" in cause ? cause.code : undefined;
          if (reviewed || attempt > 0 || code !== "NATIVE_REVIEW_STALE") throw cause;
          // A rejected basis has made no document change. Refresh and reuse the same saved result.
          applyAttempts.current.delete(run.id);
          await controller.refresh();
          if (!current(epoch)) return;
        }
      }
    } catch (cause) {
      if (!current(epoch)) return;
      if (definitiveRejection(cause)) { applyAttempts.current.delete(run.id); await controller.refresh().catch(() => {}); }
      if (current(epoch)) setError(messageFor(cause, "The proposal could not be applied.")); await refresh().catch(() => {});
    } finally { if (current(epoch)) { if (interruptedByDraft) attemptedApply.current.delete(run.id); setBusy(null); inFlight.current.delete(run.id); } }
  }, [controller, endpoint, refresh]);
  useEffect(() => {
    if (workspace.interactionDrafts || workspace.pending.length || workspace.status !== "saved" || busy || inFlight.current.size || reviewingId) return;
    const run = data.runs.slice().reverse().find(candidate => ["ready", "awaiting_review"].includes(candidate.status) && candidate.proposal && !attemptedApply.current.has(candidate.id));
    if (run) { attemptedApply.current.add(run.id); void applyRun(run); }
  }, [workspace.interactionDrafts, workspace.pending.length, workspace.status, data.runs, busy, reviewingId, applyRun]);

  async function openReview(run: WorkspaceAgentRun) {
    const epoch = generation.current, sequence = ++reviewSequence.current;
    setReviewingId(run.id); setError(null); onPausePreview?.();
    try {
      const snapshot = await controller.prepareAgentContext();
      if (!current(epoch)) return;
      const result = await videoProjectRequest<NativeAgentComparison>(endpoint + "/" + encodeURIComponent(run.id) + "/review", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ baseRevision: snapshot.revision, baseHash: snapshot.documentHash }) });
      if (!current(epoch) || sequence !== reviewSequence.current) return;
      const latest = controller.getState();
      if (latest.interactionDrafts || latest.pending.length) throw new Error("Finish the current edit before reviewing changes.");
      setComparison(result);
    } catch (cause) { if (current(epoch) && sequence === reviewSequence.current) setError(messageFor(cause, "Review is unavailable for this request.")); }
    finally { if (current(epoch) && sequence === reviewSequence.current) setReviewingId(null); }
  }
  async function send() {
    if (!instruction.trim() || busy === "send") return;
    const epoch = generation.current, text = instruction.trim(); setBusy("send"); setError(null);
    try {
      const snapshot = await controller.prepareAgentContext(); if (!current(epoch)) return;
      const state = controller.getState(), scoped = resolveEditorAuthoringScope(snapshot.document, state.selectedItemIds, state.selectedNodeId, scopeChoice);
      if (!sendAttempt.current && !scoped.scope) throw new Error(scoped.error ?? "Choose a scope");
      if (!sendAttempt.current && state.selectedItemIds.length > 24) throw new Error("Select 24 clips or fewer before asking the video agent.");
      const visualWitness = includeFrame && !sendAttempt.current ? await onCaptureVisualContext(snapshot, state.selectedItemId ?? "", state.playheadFrame) : undefined;
      if (!current(epoch)) return;
      if (sendAttempt.current && sendAttempt.current.instruction !== text) throw new Error("Retry the previous request before starting a different one; its submission is still uncertain.");
      sendAttempt.current ??= { instruction: text, body: { operationId: crypto.randomUUID(), instruction: text, baseRevision: snapshot.revision, baseHash: snapshot.documentHash,
        scope: scoped.scope, ...(referenceId ? { referenceRunId: referenceId } : {}), visualConsent: includeFrame, cloudConsent: true,
        context: { ...(visualWitness ? { visualWitness } : {}), selectedItemIds: state.selectedItemIds, selectedNodeId: state.selectedNodeId ?? undefined, playheadFrame: state.playheadFrame } } };
      await videoProjectRequest(endpoint, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(sendAttempt.current.body) });
      if (!current(epoch)) return;
      sendAttempt.current = null; setInstruction(""); setReferenceId(null); await refresh();
    } catch (cause) { if (!current(epoch)) return; if (definitiveRejection(cause)) { sendAttempt.current = null; await controller.refresh().catch(() => {}); } if (current(epoch)) setError(messageFor(cause, "The request could not be started.")); }
    finally { if (current(epoch)) setBusy(null); }
  }
  function handleComposerKeyDown(event: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key !== "Enter" || composing.current || event.nativeEvent.isComposing || event.nativeEvent.keyCode === 229) return;
    if ((event.shiftKey || event.altKey) && !event.metaKey && !event.ctrlKey) return;
    event.preventDefault();
    if (event.metaKey || event.ctrlKey) { const input = event.currentTarget; input.setRangeText("\n", input.selectionStart, input.selectionEnd, "end"); setInstruction(input.value); return; }
    if (event.repeat || !instruction.trim() || busy === "send" || workspace.interactionDrafts) return;
    void send();
  }
  async function resume(run: WorkspaceAgentRun, consent = false) {
    if (inFlight.current.has(run.id)) return;
    const epoch = generation.current; inFlight.current.add(run.id); setBusy(run.id); setError(null);
    try {
      if (consent && run.prerequisites?.assetIds.length) await onAuthorizeSources(run.prerequisites.assetIds);
      const snapshot = await controller.prepareAgentContext(); if (!current(epoch)) return;
      await videoProjectRequest(endpoint + "/" + encodeURIComponent(run.id) + "/resume", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ operationId: "resume:" + run.id, baseRevision: snapshot.revision, baseHash: snapshot.documentHash, ...(consent ? { cloudConsent: true } : {}) }) });
      await refresh();
    } catch (cause) { if (current(epoch)) setError(messageFor(cause, "Could not resume this request.")); }
    finally { if (current(epoch)) { inFlight.current.delete(run.id); setBusy(null); } }
  }
  async function recoverGraphic(run: WorkspaceAgentRun) {
    if (inFlight.current.has(run.id)) return;
    const epoch = generation.current; inFlight.current.add(run.id); setBusy(run.id); setError(null);
    try {
      const snapshot = await controller.prepareAgentContext(); if (!current(epoch)) return;
      const state = controller.getState(), selected = snapshot.document.items.find(item => item.id === state.selectedItemId);
      const track = snapshot.document.tracks.find(track => track.id === selected?.trackId && track.kind === "visual" && !track.locked) ?? snapshot.document.tracks.find(track => track.kind === "visual" && !track.locked);
      if (!recoveryAttempts.current.has(run.id)) recoveryAttempts.current.set(run.id, { operationId: crypto.randomUUID(), baseRevision: snapshot.revision, baseHash: snapshot.documentHash, playheadFrame: state.playheadFrame, ...(track ? { trackId: track.id } : {}) });
      await videoProjectRequest(endpoint + "/" + encodeURIComponent(run.id) + "/recover", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(recoveryAttempts.current.get(run.id)) });
      if (!current(epoch)) return; recoveryAttempts.current.delete(run.id); await refresh();
    } catch (cause) { if (!current(epoch)) return; if (definitiveRejection(cause)) recoveryAttempts.current.delete(run.id); setError(messageFor(cause, "The saved graphic could not be prepared for review.")); }
    finally { if (current(epoch)) { inFlight.current.delete(run.id); setBusy(null); } }
  }
  function reference(run: WorkspaceAgentRun, prefill = false) {
    const document = controller.getState().document;
    const directIds = (run.proposal?.changedItemIds ?? []).filter(id => !run.proposal?.propagatedItemIds?.includes(id));
    const requested = prefill && run.scope?.kind === "selection" ? run.scope.itemIds : directIds;
    const ids = requested.filter(id => document?.items.some(item => item.id === id)).slice(0, 24);
    const pin = run.scope?.kind === "selection" ? run.scope.node : undefined;
    const pinned = pin && ids.includes(pin.itemId) ? resolveEditorAuthoringScope(document, [pin.itemId], pin.nodeId, { ...initialScope, kind: "selection" }).scope : undefined;
    if (run.scope?.kind === "project") controller.select(null);
    else if (pin && !pinned) controller.select(null);
    else if (pinned?.kind === "selection" && pinned.node) controller.select(pinned.node.itemId, pinned.node.nodeId);
    else if (ids.length) controller.selectItems(ids);
    else controller.select(null);
    setScopeChoice({ ...initialScope, kind: run.scope?.kind === "project" ? "project" : "selection" });
    setReferenceId(run.id); setInstruction(prefill ? run.instruction : "");
    setError(run.scope?.kind !== "project" && (!ids.length || pin && !pinned) ? "The selected reference is no longer available." : null); composerRef.current?.focus();
  }
  async function cancel(run: WorkspaceAgentRun, revise = false) {
    const epoch = generation.current; setBusy(run.id); setError(null);
    try { await videoProjectRequest(endpoint + "/" + encodeURIComponent(run.id) + "/cancel", { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" });
      if (!current(epoch)) return; await refresh(); if (revise && current(epoch)) reference(run, true);
    } catch (cause) { if (current(epoch)) setError(messageFor(cause, "The request could not be cancelled.")); }
    finally { if (current(epoch)) setBusy(null); }
  }
  async function undo(run: WorkspaceAgentRun) {
    const epoch = generation.current; if (inFlight.current.has(run.id)) return;
    inFlight.current.add(run.id); setBusy(run.id); setError(null);
    try {
      const snapshot = await controller.prepareAgentContext(); if (!current(epoch)) return;
      if (!undoAttempts.current.has(run.id)) undoAttempts.current.set(run.id, { operationId: crypto.randomUUID(), baseRevision: snapshot.revision, baseHash: snapshot.documentHash });
      await videoProjectRequest(endpoint + "/" + encodeURIComponent(run.id) + "/undo", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(undoAttempts.current.get(run.id)) });
      if (!current(epoch)) return; undoAttempts.current.delete(run.id); await controller.refresh(); await refresh();
    } catch (cause) { if (!current(epoch)) return; if (definitiveRejection(cause)) undoAttempts.current.delete(run.id); setError(messageFor(cause, "The proposal could not be applied.")); }
    finally { if (current(epoch)) { setBusy(null); inFlight.current.delete(run.id); } }
  }
  async function answer(run: WorkspaceAgentRun, optionId?: string, retry = false) {
    if (!run.clarification || inFlight.current.has(run.id)) return;
    const prior = answerAttempts.current.get(run.id), text = answers[run.id]?.trim();
    const choice = retry && prior ? prior.choice : optionId ? "option:" + optionId : "text:" + (text ?? "");
    if (!prior && (run.clarificationReply?.remaining !== 1 || !optionId && !text)) return;
    const epoch = generation.current; inFlight.current.add(run.id); setBusy(run.id); setError(null);
    try {
      const snapshot = await controller.prepareAgentContext(); if (!current(epoch)) return;
      if (prior && prior.choice !== choice) throw new Error("An included reply is already being submitted. Retry it before choosing another.");
      if (!prior && snapshot.documentHash !== run.baseHash) throw new Error("The project changed after this question. Revise the request using the current project.");
      if (!prior) answerAttempts.current.set(run.id, { choice, body: { operationId: crypto.randomUUID(), questionId: run.clarification.id,
        ...(optionId ? { optionId } : { text }), baseRevision: snapshot.revision, baseHash: snapshot.documentHash } });
      await videoProjectRequest(endpoint + "/" + encodeURIComponent(run.id) + "/answer", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(answerAttempts.current.get(run.id)!.body) });
      if (!current(epoch)) return; answerAttempts.current.delete(run.id); setAnswers(values => ({ ...values, [run.id]: "" })); await refresh();
    } catch (cause) {
      if (!current(epoch)) return;
      if (definitiveRejection(cause)) answerAttempts.current.delete(run.id);
      setError(messageFor(cause, "The request could not be started.")); await refresh().catch(() => {});
    } finally { if (current(epoch)) { inFlight.current.delete(run.id); setBusy(null); } }
  }
  async function applyCapability(label: string, action: EditorCapabilityInput) {
    if (!onCapabilityAction) return;
    const epoch = generation.current; setBusy("capability"); setError(null); setActionNotice(null);
    try { await onCapabilityAction(action); if (current(epoch)) setActionNotice(label); }
    catch (cause) { if (current(epoch)) setError(messageFor(cause, "The action could not be applied.")); }
    finally { if (current(epoch)) setBusy(null); }
  }

  const pendingUploadRun = data.runs.find(run => run.status === "needs_evidence" && run.cloudConsent && run.prerequisites?.status === "consent_required" && !attemptedUploads.current.has(run.id));
  useEffect(() => {
    if (!pendingUploadRun || busy || inFlight.current.size || workspace.interactionDrafts) return;
    attemptedUploads.current.add(pendingUploadRun.id);
    void resume(pendingUploadRun, true);
    // Persisted send consent authorizes only the sources required by this run.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pendingUploadRun?.id, busy, workspace.interactionDrafts]);
  const pendingEvidenceRun = data.runs.find(run => run.status === "needs_evidence" && run.prerequisites?.status === "running");
  useEffect(() => {
    if (!pendingEvidenceRun || busy || inFlight.current.size || workspace.interactionDrafts) return;
    const timer = setTimeout(() => void resume(pendingEvidenceRun), 3000); return () => clearTimeout(timer);
    // Readiness checks retain their server operation identity.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pendingEvidenceRun?.id, busy, workspace.interactionDrafts]);
  const staleComparison = !!comparison && !comparison.applied && editorComparisonIsStale(comparison.review.basis, workspace.snapshot, workspace.pending.length, workspace.interactionDrafts);
  const visibleRuns = data.runs.filter(run => !!run.proposal || !!run.clarification || !["applied", "completed", "cancelled"].includes(run.status) || run.phase === "cancellation_pending");
  const runById = new Map(visibleRuns.map(run => [run.id, run])), lastMessage = new Map<string, string>();
  data.messages.forEach(message => { if (message.runId) lastMessage.set(message.runId, message.id); });
  const disabled = !!busy || !!workspace.interactionDrafts || workspace.pending.length > 0;
  const renderRun = (run: WorkspaceAgentRun) => {
    const undone = data.runs.some(candidate => candidate.status === "applied" && candidate.undoOfRunId === run.id);
    const applied = run.status === "applied", answered = run.phase === "clarification_answered";
    const status = applied ? "Applied" : run.status === "ready" || run.status === "awaiting_review" ? "Changes ready" : run.status === "needs_input" ? "Reply to this question"
      : run.status === "stale" ? "Needs revision" : run.status === "failed" ? "Needs attention" : run.status === "cancelled" ? "Cancelled" : run.status === "needs_evidence" ? "Speech context needed" : run.status === "running" ? "Working on your edit…" : "Preparing your request…";
    const names = run.proposal?.changedItemIds.map(id => workspace.document?.items.find(item => item.id === id)?.name).filter(Boolean).slice(0, 3).join(", ");
    return <article key={run.id} className="editor-agent-change" data-run-id={run.id} data-run-status={run.status}>
      <small>{["queued", "running"].includes(run.status) && <Loader2 size={12} className="animate-spin" />}{t(answered ? "Question answered" : status)}</small>
      <p>{run.clarification?.question ?? run.proposal?.summary ?? run.instruction}</p>
      {run.scope && <span className="editor-agent-scope-label">{t(run.scope.kind === "selection" ? "Selected items" : run.scope.kind === "range" ? "Time range" : "Whole project")}{names ? " · " + names : ""}</span>}
      {!!run.proposal?.propagatedItemIds?.length && <span className="editor-agent-scope-label">{t("Linked changes")}: {run.proposal.propagatedItemIds.length}</span>}
      {run.error && <><p className="text-amber-700 dark:text-amber-300">{t(run.error.message)}</p><details className="text-xs break-all"><summary>{t("Error details")}</summary><p>{t("Error code")} · {run.error.code}</p><p>{t("Run ID")} · {run.id}</p></details></>}
      {run.clarificationParentRunId && <span className="editor-agent-scope-label">{t("Included reply")}</span>}
      {run.clarification && !answered && run.status === "needs_input" && <EditorClarification run={run} value={answers[run.id] ?? ""} disabled={disabled}
        stale={workspace.snapshot?.documentHash !== run.baseHash} retryPending={answerAttempts.current.has(run.id)}
        onChange={value => setAnswers(values => ({ ...values, [run.id]: value }))} onAnswer={optionId => void answer(run, optionId)} onRetry={() => void answer(run, undefined, true)} />}
      {(run.phase === "cancellation_pending" || run.status === "running" && Date.now() - Date.parse(run.updatedAt) > 60_000) && <button className={button} disabled={!!busy} onClick={() => void resume(run)}>{t("Check progress")}</button>}
      {["submit_uncertain", "preparation_retry"].includes(run.phase) && <button className={button} disabled={!!busy} onClick={() => void resume(run)}>{t("Retry same request")}</button>}
      {run.prerequisites?.status === "consent_required" && (!run.cloudConsent || attemptedUploads.current.has(run.id) && !busy) && <><p className="editor-authoring-notice">{t("This request needs cloud transcription. Selected local media will be uploaded to storage and the speech provider. Standard transcription credits apply.")}</p><button className={button} disabled={!!busy} onClick={() => void resume(run, true)}>{t(run.cloudConsent ? "Retry same request" : "Upload and continue")}</button></>}
      {run.recoverableOutput && run.proposal?.commands.some(command => command.type === "addItem" && !workspace.document?.items.some(item => item.id === command.item.id)) && <button className={button} disabled={disabled} onClick={() => void recoverGraphic(run)}>{t("Recover saved graphic")}</button>}
      {run.proposal && ["ready", "awaiting_review", "stale", "applied"].includes(run.status) && <div className="editor-agent-card-actions">
        {applied && <button className={button} disabled={disabled || reviewingId === run.id} onClick={() => void openReview(run)}>{t(reviewingId === run.id ? "Preparing comparison…" : "Compare")}</button>}
        {!applied && attemptedApply.current.has(run.id) && !busy && <button className={button} disabled={disabled || run.status === "stale"} onClick={() => void applyRun(run)}>{t("Retry same request")}</button>}
        {applied && !run.undoOfRunId && !undone && <button className={button} disabled={disabled} onClick={() => void undo(run)}>{t("Undo this edit")}</button>}
        {applied && <button className={button} disabled={!!busy} onClick={() => reference(run)}>{t("Revise this edit")}</button>}
        {["ready", "awaiting_review"].includes(run.status) && <button className={button} disabled={disabled} onClick={() => void cancel(run, true)}>{t("Cancel and revise")}</button>}
      </div>}
      {["stale", "failed"].includes(run.status) && !run.clarificationParentRunId && <button className={button} onClick={() => reference(run, true)}>{t("Revise request")}</button>}
      {(run.status === "needs_input" || !!run.clarificationParentRunId && ["failed", "stale"].includes(run.status)) && <div><button className={button} disabled={!!busy || answerAttempts.current.has(run.id)} onClick={() => reference(run, true)}>{t("Start a new edit")}</button><p className="mt-1 text-[10px] text-[var(--editor-muted)]">{t("Uses standard edit credits when you send.")}</p></div>}
      {["queued", "running", "needs_evidence", "needs_input", "ready", "awaiting_review"].includes(run.status) && <button className="text-[var(--editor-muted)] underline" disabled={!!busy} onClick={() => void cancel(run)}>{t("Cancel")}</button>}
    </article>;
  };
  const capabilityTarget = workspace.selectedItemId && workspace.selectedNodeId ? { itemId: workspace.selectedItemId, nodeId: workspace.selectedNodeId } : null;
  const quickIds = new Set(quick.map(entry => entry.action.capability)), fontChoices = catalog.find(entry => entry.id === "text.font")?.choices ?? [];
  return <aside aria-label="Video agent chat" aria-hidden={hidden} style={hidden ? { display: "none" } : undefined} className="editor-chat">
    {resizeHandle}
    <div className="editor-panel-heading"><h2 className="editor-chat-title"><Sparkles size={18} />{t("Video agent")}</h2><button aria-label="Close chat" onClick={onClose}><X size={16} /></button></div>
    {extensions && <div className="editor-agent-extensions">{extensions}</div>}
    <div ref={scrollRef} onScroll={event => { const element = event.currentTarget; followMessages.current = element.scrollHeight - element.scrollTop - element.clientHeight < 80; }} className="min-h-0 flex-1 space-y-3 overflow-y-auto p-4" aria-live="polite">
      {!data.messages.length && <div className="editor-chat-welcome"><Sparkles size={29} strokeWidth={1.5} /><h3>{t("What would you like to create?")}</h3><p>{t("Describe an edit, ask about the selected clip, or create a motion graphic. Chat and manual controls share one history.")}</p></div>}
      {data.messages.map(message => {
        const run = message.runId ? runById.get(message.runId) : undefined, card = run && lastMessage.get(run.id) === message.id;
        return <Fragment key={message.id}>{(message.role === "user" || !run?.proposal && !run?.clarification && !run?.error) && <div className={"break-words whitespace-pre-wrap rounded-lg p-3 text-xs leading-5 " + (message.role === "user" ? "ml-5 bg-[var(--editor-accent-soft)] text-[var(--editor-accent-text)]" : "mr-2 bg-[var(--editor-surface)] text-[var(--editor-text)]")}>{message.text}</div>}{card && renderRun(run)}</Fragment>;
      })}
      {visibleRuns.filter(run => !lastMessage.has(run.id)).slice().reverse().map(renderRun)}
      {error && <p role="alert" className="text-xs leading-5 text-[var(--editor-danger-text)]">{t(error)}</p>}
      {onCapabilityAction && quick.length > 0 && <div className="editor-agent-quick"><h3>{t("Quick edits")} <small>{t("Free action")}</small></h3><div>{quick.slice(0, 4).map(choice => <button className={button} key={choice.label} disabled={disabled || workspace.status !== "saved"} onClick={() => void applyCapability(choice.label, choice.action)}>{t(choice.label)}</button>)}</div>
        <details><summary>{t("More quick edits")}</summary><div>{quick.slice(4).map(choice => <button className={button} key={choice.label} disabled={disabled || workspace.status !== "saved"} onClick={() => void applyCapability(choice.label, choice.action)}>{t(choice.label)}</button>)}</div>
          {capabilityTarget && quickIds.has("text.color") && <label>{t("Font")}<select aria-label={t("Quick font")} value="" disabled={disabled} onChange={event => { if (event.target.value) void applyCapability("Font", { version: 1, capability: "text.font", target: capabilityTarget, parameters: { family: event.target.value } }); }}><option value="">{t("Font")}</option>{fontChoices.map(family => <option key={family} value={family}>{family === "system-ui" ? t("System UI") : family}</option>)}</select></label>}
          {capabilityTarget && quickIds.has("media.fit") && <label>{t("Video look")}<select aria-label={t("Quick look")} value="" disabled={disabled} onChange={event => { if (event.target.value) void applyCapability("Video look", { version: 1, capability: "media.look", target: capabilityTarget, parameters: { preset: event.target.value } }); }}><option value="">{t("Video look")}</option>{editorMediaFilters.map(filter => <option key={filter.label} value={editorLookId(filter.label)}>{t(filter.label)}</option>)}</select></label>}
        </details>{actionNotice && <p role="status">{t("Applied locally")}: {t(actionNotice)}</p>}
      </div>}
    </div>
    <form className="editor-chat-composer space-y-3" onSubmit={event => { event.preventDefault(); void send(); }}>
      <EditorAuthoringScope document={workspace.document} itemIds={workspace.selectedItemIds} nodeId={workspace.selectedNodeId} getPlayheadFrame={controller.getPlayheadFrame} choice={scopeChoice} onChange={setScopeChoice} disabled={busy === "send" || !!sendAttempt.current} />
      {referenceId && <div className="editor-agent-reference"><span>{t("Referring to")}: {data.runs.find(run => run.id === referenceId)?.proposal?.summary ?? t("Previous edit")}</span><button type="button" aria-label={t("Clear reference")} disabled={!!sendAttempt.current} onClick={() => setReferenceId(null)}>×</button></div>}
      <div className="editor-agent-suggestions">{suggestions.map(prompt => <button key={prompt} type="button" disabled={busy === "send"} onClick={() => { setInstruction(t(prompt)); composerRef.current?.focus(); }}>{t(prompt)}</button>)}</div>
      <textarea ref={composerRef} aria-label="Message video agent" value={instruction} onChange={event => setInstruction(event.target.value)} placeholder={t("Describe your edit…")} rows={3} className="w-full resize-y rounded-lg border border-[var(--editor-border)] bg-[var(--editor-surface)] p-3 text-xs outline-none focus:border-violet-500" aria-describedby={shortcutHintId} onCompositionStart={() => { composing.current = true; }} onCompositionEnd={() => { composing.current = false; }} onKeyDown={handleComposerKeyDown} />
      <p id={shortcutHintId} className="text-[10px] leading-4 text-[var(--editor-muted)]">{t("Enter to send · ⌘/Ctrl+Enter for a new line")}</p>
      <label className="flex items-start gap-2 text-[10px] leading-4 text-[var(--editor-muted)]"><input type="checkbox" checked={includeFrame} disabled={!!sendAttempt.current} onChange={event => setIncludeFrame(event.target.checked)} className="mt-0.5 accent-violet-500" />{t("Include current preview frame · sends this image to the model")}</label>
      <p className="text-[10px] leading-4 text-[var(--editor-muted)]">{t("Send applies edits automatically. Required media is uploaded for cloud transcription. Standard edit and transcription credits apply.")}</p>
      <div className="flex items-center justify-end"><button className={button} type="submit" disabled={!instruction.trim() || busy === "send" || !!workspace.interactionDrafts || !resolvedScope.scope}><Send size={13} className="mr-2 inline" />{t("Send")}</button></div>
    </form>
    {!hidden && comparison && <EditorAgentReview mainPreviewPlaying={mainPreviewPlaying} comparison={comparison} sources={sources} stale={staleComparison} applying={busy === comparison.run.id} onPausePreview={onPausePreview} onSeekFrame={onSeekFrame}
      onClose={() => { reviewSequence.current++; setComparison(null); }} onRefresh={() => void openReview(comparison.run)} onApply={() => void applyRun(comparison.run, comparison)} />}
  </aside>;
}
