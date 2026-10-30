import "./editor-authoring.css";
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import { Sparkles, X, Send, Loader2 } from "lucide-react";
import {
  VideoWorkspaceController,
  videoProjectRequest,
  type VideoProjectSnapshot,
} from "@/lib/video-project/client-controller";
import type {
  VideoProjectAgentRun,
  VideoProjectAgentMessage,
} from "@/lib/video-project/agent-types";
import type { EditorCapabilityInput } from "@/lib/video-project/capabilities";
import {
  EditorAuthoringScope,
  resolveEditorAuthoringScope,
  type EditorAuthoringScopeChoice,
} from "./editor-authoring-scope";
import {
  EditorAgentReview,
  type NativeAgentComparison,
} from "./editor-agent-review";
import { editorComparisonIsStale } from "./editor-agent-actions";
type Run = VideoProjectAgentRun & {
  events?: Array<{
    sequence: number;
    type: string;
    name?: string;
    summary?: string;
  }>;
};
type State = { runs: Run[]; messages: VideoProjectAgentMessage[] };
const button = "editor-secondary-button";
export function VideoWorkspaceChat({
  controller,
  sources,
  onCaptureVisualContext,
  onClose,
  onSeekFrame,
  onPausePreview,
  mainPreviewPlaying = false,
  hidden = false,
}: {
  controller: VideoWorkspaceController;
  sources: Record<string, string>;
  onAuthorizeSources: (ids: string[]) => Promise<void>;
  onCaptureVisualContext: (
    snapshot: VideoProjectSnapshot,
    itemId: string,
    frame: number,
  ) => Promise<unknown>;
  onClose: () => void;
  hidden?: boolean;
  onCapabilityAction?: (action: EditorCapabilityInput) => void | Promise<void>;
  onSeekFrame?: (frame: number) => void;
  onPausePreview?: () => void;
  mainPreviewPlaying?: boolean;
}) {
  const workspace = useSyncExternalStore(
    controller.subscribeContent,
    controller.getContentState,
    controller.getContentState,
  );
  const [data, setData] = useState<State>({ runs: [], messages: [] }),
    [text, setText] = useState(""),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  const [scope, setScope] = useState<EditorAuthoringScopeChoice>({
      kind: "automatic",
      fromSeconds: "0",
      toSeconds: "5",
    }),
    [includeFrame, setIncludeFrame] = useState(false);
  const [comparison, setComparison] = useState<NativeAgentComparison | null>(
      null,
    ),
    [replyId, setReplyId] = useState<string | null>(null),
    [newRequest, setNewRequest] = useState(false),
    [reference, setReference] = useState<string | null>(null);
  const seq = useRef(0),
    epoch = useRef(0),
    list = useRef<HTMLDivElement>(null),
    follow = useRef(true),
    attempts = useRef(
      new Map<string, { fingerprint: string; body: unknown }>(),
    );
  const endpoint = `/api/projects/${encodeURIComponent(controller.projectId)}/agent-runs`;
  const refresh = useCallback(async () => {
    const request = ++seq.current;
    const state = await videoProjectRequest<State>(endpoint);
    if (request === seq.current) setData(state);
  }, [endpoint]);
  useEffect(() => {
    epoch.current++;
    setData({ runs: [], messages: [] });
    setText("");
    setComparison(null);
    setReplyId(null);
    setNewRequest(false);
    attempts.current.clear();
    return () => {
      epoch.current++;
      seq.current++;
    };
  }, [controller]);
  useEffect(() => {
    if (hidden) return;
    let active = true,
      timer: ReturnType<typeof setTimeout>;
    const poll = async () => {
      try {
        await refresh();
      } catch (e) {
        if (active)
          setError(e instanceof Error ? e.message : "Connection interrupted");
      }
      if (active) timer = setTimeout(poll, 1500);
    };
    void poll();
    return () => {
      active = false;
      seq.current++;
      clearTimeout(timer);
    };
  }, [hidden, refresh]);
  useEffect(() => {
    if (!newRequest && !replyId) {
      const question = data.runs.find(
        (r) => r.status === "needs_input" && r.clarification,
      );
      if (question) setReplyId(question.id);
    }
  }, [data, newRequest, replyId]);
  useEffect(() => {
    if (follow.current)
      list.current?.scrollTo({ top: list.current.scrollHeight });
  }, [data]);
  const reply = data.runs.find(
      (r) => r.id === replyId && r.status === "needs_input",
    ),
    staleReply = !!reply && reply.baseHash !== workspace.snapshot?.documentHash;
  const disabled =
    busy || !!workspace.interactionDrafts || !!workspace.pending.length;
  const action = async (fn: () => Promise<void>) => {
    if (busy) return;
    const current = epoch.current;
    setBusy(true);
    setError("");
    try {
      await fn();
      if (current === epoch.current) await refresh();
    } catch (e) {
      if (current === epoch.current)
        setError(e instanceof Error ? e.message : "Request failed");
    } finally {
      if (current === epoch.current) setBusy(false);
    }
  };
  async function post<T>(path: string, body: unknown): Promise<T> {
    return videoProjectRequest<T>(path, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
  }
  // Retain exact request identity after an uncertain response. Never silently replace paid work.
  function attempt(
    key: string,
    fingerprint: string,
    body: Record<string, unknown>,
  ) {
    const previous = attempts.current.get(key);
    if (previous) {
      if (previous.fingerprint !== fingerprint)
        throw new Error(
          "A previous submission is unconfirmed. Retry the same input before changing it.",
        );
      return previous.body;
    }
    const value = { ...body, operationId: crypto.randomUUID() };
    attempts.current.set(key, { fingerprint, body: value });
    return value;
  }
  async function send(optionId?: string) {
    await action(async () => {
      const snapshot = await controller.prepareAgentContext();
      if (reply) {
        if (staleReply)
          throw new Error(
            "The project changed. Start a new request with the current project.",
          );
        const value = optionId ? { optionId } : { text: text.trim() };
        const body = attempt("answer:" + reply.id, JSON.stringify(value), {
          ...value,
          questionId: reply.clarification!.id,
          baseRevision: snapshot.revision,
          baseHash: snapshot.documentHash,
        });
        await post(endpoint + "/" + reply.id + "/answer", body);
        attempts.current.delete("answer:" + reply.id);
        setReplyId(null);
        setNewRequest(false);
        setText("");
        return;
      }
      if (!text.trim()) return;
      const state = controller.getState(),
        resolved = resolveEditorAuthoringScope(
          snapshot.document,
          state.selectedItemIds,
          state.selectedNodeId,
          scope,
        );
      if (!resolved.scope)
        throw new Error(resolved.error ?? "Choose an edit scope.");
      const witness = includeFrame
        ? await onCaptureVisualContext(
            snapshot,
            state.selectedItemId ?? "",
            state.playheadFrame,
          )
        : undefined;
      const body = attempt("send", text.trim(), {
        instruction: text.trim(),
        baseRevision: snapshot.revision,
        baseHash: snapshot.documentHash,
        context: {
          selectedItemIds: state.selectedItemIds,
          selectedNodeId: state.selectedNodeId ?? undefined,
          playheadFrame: state.playheadFrame,
          ...(witness ? { visualWitness: witness } : {}),
        },
        scope: resolved.scope,
        referenceRunId: reference ?? undefined,
        visualConsent: includeFrame,
      });
      await post(endpoint, body);
      attempts.current.delete("send");
      setText("");
      setReference(null);
      setNewRequest(false);
    });
  }
  async function review(run: Run) {
    await action(async () => {
      onPausePreview?.();
      const snapshot = await controller.prepareAgentContext();
      setComparison(
        await post<NativeAgentComparison>(endpoint + "/" + run.id + "/review", {
          baseHash: snapshot.documentHash,
          baseRevision: snapshot.revision,
        }),
      );
    });
  }
  const staleComparison =
    !!comparison &&
    !comparison.applied &&
    editorComparisonIsStale(
      comparison.review.basis,
      workspace.snapshot,
      workspace.pending.length,
      workspace.interactionDrafts,
    );
  const latestByRun = new Map<string, string>();
  data.messages.forEach((m) => {
    if (m.runId) latestByRun.set(m.runId, m.id);
  });
  function card(run: Run) {
    return (
      <article
        className="editor-agent-change"
        key={run.id}
        data-run-id={run.id}
        data-run-status={run.status}
      >
        <small>
          {["running", "queued"].includes(run.status) && (
            <Loader2 size={12} className="animate-spin" />
          )}
          {(
            {
              awaiting_review: "Ready for review",
              needs_input: "Waiting for your answer",
              applied: "Applied",
              failed: "Needs attention",
              running: "Working on your edit",
              queued: "Preparing",
              completed: "Completed",
              cancelled: "Cancelled",
            } as Record<string, string>
          )[run.status] ?? run.status}
        </small>
        <p>
          {run.clarification?.question ??
            run.proposal?.summary ??
            run.instruction}
        </p>
        {run.scope && (
          <span className="editor-agent-scope-label">
            {run.scope.kind === "selection"
              ? `${run.scope.itemIds.length} selected items`
              : run.scope.kind === "range"
                ? "Selected time range"
                : "Whole project"}
          </span>
        )}
        {run.error && <p role="alert">{run.error.message}</p>}
        <div className="editor-agent-card-actions">
          {run.proposal &&
            ["awaiting_review", "applied"].includes(run.status) && (
              <button
                className={button}
                disabled={disabled}
                onClick={() => void review(run)}
              >
                {run.status === "applied" ? "Compare" : "Review changes"}
              </button>
            )}
          {run.status === "needs_input" && (
            <button
              className={button}
              onClick={() => {
                setReplyId(run.id);
                setNewRequest(false);
                setText("");
              }}
            >
              Reply
            </button>
          )}
          {run.status === "applied" && (
            <button
              className={button}
              disabled={disabled}
              onClick={() =>
                void action(async () => {
                  const s = await controller.prepareAgentContext();
                  const result = await post<VideoProjectSnapshot>(
                    endpoint + "/" + run.id + "/undo",
                    attempt("undo:" + run.id, "undo", {
                      baseHash: s.documentHash,
                      baseRevision: s.revision,
                    }),
                  );
                  controller.acceptSnapshot(result);
                  attempts.current.delete("undo:" + run.id);
                })
              }
            >
              Undo this edit
            </button>
          )}
          {["applied", "failed"].includes(run.status) && (
            <button
              className={button}
              onClick={() => {
                setReference(run.id);
                setNewRequest(true);
                setReplyId(null);
                setText(run.status === "failed" ? run.instruction : "");
              }}
            >
              Revise request
            </button>
          )}
          {["queued", "running", "needs_input", "awaiting_review"].includes(
            run.status,
          ) && (
            <button
              className={button}
              disabled={busy}
              onClick={() =>
                void action(async () => {
                  await post(endpoint + "/" + run.id + "/cancel", {});
                  if (replyId === run.id) setReplyId(null);
                })
              }
            >
              Cancel
            </button>
          )}
        </div>
        {!!run.events?.length && (
          <details className="harness-trace">
            <summary>
              Tool activity ·{" "}
              {run.events.filter((e) => e.type === "tool.started").length} calls
            </summary>
            {run.events.map((e) => (
              <div key={e.sequence}>
                {e.type}
                {e.name ? " · " + e.name : ""}
              </div>
            ))}
          </details>
        )}
      </article>
    );
  }
  return (
    <aside
      className="editor-chat"
      aria-label="Video agent chat"
      style={hidden ? { display: "none" } : undefined}
    >
      <div className="editor-panel-heading">
        <h2 className="editor-chat-title">
          <Sparkles size={18} />
          Video agent
        </h2>
        <button aria-label="Close chat" onClick={onClose}>
          <X size={16} />
        </button>
      </div>
      <div
        ref={list}
        className="min-h-0 flex-1 overflow-y-auto p-4 space-y-3"
        aria-live="polite"
        onScroll={(e) => {
          follow.current =
            e.currentTarget.scrollHeight -
              e.currentTarget.scrollTop -
              e.currentTarget.clientHeight <
            80;
        }}
      >
        {!data.messages.length && (
          <div className="editor-chat-welcome">
            <h3>Make an edit together</h3>
            <p>
              Describe a change. Review the proposal, then apply it to the same
              timeline you edit manually.
            </p>
            <p>Chat uses your configured LLM. Manual editing needs no key.</p>
          </div>
        )}
        {data.messages.map((m) => {
          const run = data.runs.find((r) => r.id === m.runId);
          return (
            <div key={m.id}>
              {m.role === "user" && (
                <p className="harness-user-message">{m.text}</p>
              )}
              {m.role === "assistant" &&
                !run?.proposal &&
                !run?.clarification && (
                  <p className="harness-assistant-message">{m.text}</p>
                )}
              {run && latestByRun.get(run.id) === m.id && card(run)}
            </div>
          );
        })}
        {error && (
          <p role="alert" className="harness-error">
            {error}
          </p>
        )}
      </div>
      <form
        className="editor-chat-composer space-y-3"
        onSubmit={(e) => {
          e.preventDefault();
          void send();
        }}
      >
        {reply ? (
          <section className="harness-decision" aria-label="Pending question">
            <strong>{reply.clarification!.question}</strong>
            <p>Replying to your existing request</p>
            {staleReply ? (
              <p role="status">
                The project changed. Start a new request using the latest edit.
              </p>
            ) : (
              reply.clarification!.options?.map((option) => (
                <button
                  key={option.id}
                  type="button"
                  className={button}
                  disabled={disabled}
                  onClick={() => void send(option.id)}
                >
                  {option.label}
                  {reply.replyState?.options[option.id] && (
                    <small className="block">
                      Scope: {reply.replyState.options[option.id].scope.kind} ·{" "}
                      {reply.replyState.options[option.id].itemCount} items
                    </small>
                  )}
                </button>
              ))
            )}
            <button
              type="button"
              className="harness-link"
              onClick={() => {
                setReplyId(null);
                setNewRequest(true);
                setText("");
              }}
            >
              New request
            </button>
          </section>
        ) : (
          <EditorAuthoringScope
            document={workspace.document}
            itemIds={workspace.selectedItemIds}
            nodeId={workspace.selectedNodeId}
            getPlayheadFrame={controller.getPlayheadFrame}
            choice={scope}
            onChange={setScope}
            disabled={busy}
          />
        )}
        {reference && (
          <div className="editor-agent-reference">
            Referring to a previous edit{" "}
            <button type="button" onClick={() => setReference(null)}>
              ×
            </button>
          </div>
        )}
        {(!reply || reply.clarification!.allowText !== false) && (
          <textarea
            aria-label={reply ? "Your reply" : "Message video agent"}
            placeholder={
              reply ? "Answer this question…" : "Describe your edit…"
            }
            value={text}
            maxLength={reply ? 1000 : 4000}
            onChange={(e) => setText(e.target.value)}
            rows={3}
            disabled={busy || staleReply}
            onKeyDown={(e) => {
              if (
                e.key === "Enter" &&
                !e.shiftKey &&
                !e.nativeEvent.isComposing
              ) {
                e.preventDefault();
                void send();
              }
            }}
          />
        )}
        {!reply && (
          <label className="harness-preview-consent">
            <input
              type="checkbox"
              checked={includeFrame}
              onChange={(e) => setIncludeFrame(e.target.checked)}
            />{" "}
            Include the current preview image · sends it to your LLM provider
          </label>
        )}
        <div className="flex justify-end">
          <button
            type="submit"
            className="editor-primary-button"
            disabled={disabled || !text.trim() || staleReply}
          >
            <Send size={13} />
            {reply ? "Send answer" : "Send"}
          </button>
        </div>
      </form>
      {!hidden && comparison && (
        <EditorAgentReview
          comparison={comparison}
          sources={sources}
          stale={staleComparison}
          applying={busy}
          onClose={() => setComparison(null)}
          onRefresh={() => void review(comparison.run)}
          onPausePreview={onPausePreview}
          mainPreviewPlaying={mainPreviewPlaying}
          onSeekFrame={onSeekFrame}
          onApply={() =>
            void action(async () => {
              const basis = comparison.review.basis;
              const result = await post<VideoProjectSnapshot>(
                endpoint + "/" + comparison.run.id + "/apply",
                attempt("apply:" + comparison.run.id, JSON.stringify(basis), {
                  baseRevision: basis.baseRevision,
                  baseHash: basis.baseHash,
                  reviewBasis: basis,
                }),
              );
              controller.acceptSnapshot(result);
              attempts.current.delete("apply:" + comparison.run.id);
              setComparison(null);
            })
          }
        />
      )}
    </aside>
  );
}
