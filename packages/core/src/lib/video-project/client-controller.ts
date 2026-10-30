import {
  RecoveryJournalCodec,
  decodeWorkspaceRecovery,
  type WorkspaceRecovery,
} from "./recovery-journal";
import {
  ScheduledRecoveryWriter,
  RecoveryWriteConflict,
  RECOVERY_STORAGE_WARNING,
  type WorkspaceRecoveryStore,
} from "./recovery-storage";
import { timelineSelection, type TimelineSelectionGesture } from "./selection";
import type { EditorCommand } from "@/lib/editor/commands";
import {
  editorCommandsToVideoCommands,
  executeVideoProjectCommands,
  rebaseVideoProjectCommands,
  type VideoProjectCommand,
} from "./commands";
import {
  parseVideoProjectDocument,
  type VideoProjectDocument,
} from "./document";

import {
  classifyWorkspaceSaveFailure,
  type WorkspaceSaveFailure,
} from "./save-failure";
import type { VideoProjectSnapshot } from "./types";
export type { VideoProjectSnapshot, VideoSourceResolution } from "./types";
export type WorkspacePendingOperation = {
  operationId: string;
  commands: VideoProjectCommand[];
  baseDocument?: VideoProjectDocument;
  baseRevision?: number;
  baseHash?: string;
};
export type VideoWorkspaceState = {
  snapshot: VideoProjectSnapshot | null;
  document: VideoProjectDocument | null;
  pending: WorkspacePendingOperation[];
  status: "loading" | "saved" | "saving" | "error";
  error: string | null;
  saveFailure: WorkspaceSaveFailure | null;
  recoveryError: string | null;
  selectedItemId: string | null;
  selectedItemIds: string[];
  selectedNodeId: string | null;
  playheadFrame: number;
  interactionDrafts: number;
};
/** Document/UI state whose identity is unaffected by playback ticks. */
export type VideoWorkspaceContentState = Omit<
  VideoWorkspaceState,
  "playheadFrame"
>;
function contentState({
  playheadFrame: _frame,
  ...content
}: VideoWorkspaceState): VideoWorkspaceContentState {
  return content;
}
type Request = <T>(path: string, init?: RequestInit) => Promise<T>;
type Storage = Pick<globalThis.Storage, "getItem" | "setItem" | "removeItem">;
const closedWorkspace = () =>
  new DOMException(
    "The editor closed before its pending changes finished saving. Browser recovery keeps the same edits for reopening.",
    "AbortError",
  );
async function abortableRequest<T>(
  promise: Promise<T>,
  signal: AbortSignal,
): Promise<T> {
  if (signal.aborted) {
    void promise.catch(() => undefined);
    throw closedWorkspace();
  }
  let abort!: () => void;
  const cancelled = new Promise<never>((_resolve, reject) => {
    abort = () => reject(closedWorkspace());
    signal.addEventListener("abort", abort, { once: true });
  });
  try {
    return await Promise.race([promise, cancelled]);
  } finally {
    signal.removeEventListener("abort", abort);
  }
}

export async function videoProjectRequest<T>(
  path: string,
  init?: RequestInit,
): Promise<T> {
  const response = await fetch(path, init);
  const payload = await response.json().catch(() => null);
  if (!response.ok || !payload?.success) {
    const error = new Error(
      payload?.message ??
        (typeof payload?.error === "string"
          ? payload.error
          : payload?.error?.message) ??
        `Request failed (${response.status}).`,
    );
    Object.assign(error, {
      status: response.status,
      code: payload?.code ?? payload?.error_code ?? payload?.error?.code,
    });
    throw error;
  }
  return payload.data as T;
}

/** The single acknowledged revision and ordered command queue for both UI and chat. */
export class VideoWorkspaceController {
  private listeners = new Set<() => void>();
  private contentListeners = new Set<() => void>();
  private playheadListeners = new Set<() => void>();
  private state: VideoWorkspaceState = {
    snapshot: null,
    document: null,
    pending: [],
    status: "loading",
    error: null,
    saveFailure: null,
    recoveryError: null,
    selectedItemId: null,
    selectedItemIds: [],
    selectedNodeId: null,
    playheadFrame: 0,
    interactionDrafts: 0,
  };
  private content = contentState(this.state);
  private drain: Promise<VideoProjectSnapshot> | null = null;
  private deferredSnapshot: VideoProjectSnapshot | null = null;
  private closed = false;
  private lifecycle = 0;
  private drainLifecycle = 0;
  private drainAbort: AbortController | null = null;
  private recovering = false;
  private selectionAnchor: string | null = null;
  private readonly key: string;
  private readonly recoveryCodec = new RecoveryJournalCodec();
  private readonly recoveryWriter?: ScheduledRecoveryWriter;
  private recoveryReadFailed = false;
  private expectedResults = new WeakMap<
    WorkspacePendingOperation,
    VideoProjectDocument
  >();
  constructor(
    readonly projectId: string,
    private readonly request: Request = videoProjectRequest,
    private readonly storage?: Storage,
    private readonly recoveryStore?: WorkspaceRecoveryStore,
  ) {
    this.key = `dojoclip-video-commands:${projectId}`;
    if (recoveryStore)
      this.recoveryWriter = new ScheduledRecoveryWriter(
        this.recoveryCodec,
        recoveryStore,
        (error) => {
          this.update({
            recoveryError: error
              ? error instanceof RecoveryWriteConflict
                ? error.message
                : RECOVERY_STORAGE_WARNING
              : null,
          });
        },
      );
  }
  hasPendingRecovery = () => this.recoveryWriter?.pending ?? false;
  async settleRecovery() {
    await this.recoveryWriter?.flush();
  }
  async retryRecovery() {
    const lifetime = this.lifecycle;
    if (this.closed) throw closedWorkspace();
    if (this.recoveryReadFailed && this.recoveryStore) {
      try {
        const record = await this.recoveryStore.load();
        if (this.closed || lifetime !== this.lifecycle) return;
        if (
          record &&
          decodeWorkspaceRecovery(record, this.projectId).pending.length
        )
          throw new RecoveryWriteConflict();
        this.recoveryReadFailed = false;
      } catch (cause) {
        if (this.closed || lifetime !== this.lifecycle) return;
        this.update({
          recoveryError:
            cause instanceof RecoveryWriteConflict
              ? cause.message
              : RECOVERY_STORAGE_WARNING,
        });
        return;
      }
    }
    await this.persist();
    await this.settleRecovery();
  }
  getState = () => this.state;
  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };
  getContentState = () => this.content;
  subscribeContent = (listener: () => void) => {
    this.contentListeners.add(listener);
    return () => {
      this.contentListeners.delete(listener);
    };
  };
  getPlayheadFrame = () => this.state.playheadFrame;
  subscribePlayhead = (listener: () => void) => {
    this.playheadListeners.add(listener);
    return () => {
      this.playheadListeners.delete(listener);
    };
  };
  private update(patch: Partial<VideoWorkspaceState>) {
    const next = { ...this.state, ...patch };
    if (
      "document" in patch ||
      "selectedItemId" in patch ||
      "selectedItemIds" in patch ||
      "selectedNodeId" in patch
    ) {
      const available = new Set(
        next.document?.items.map((item) => item.id) ?? [],
      );
      const ids = [...new Set(next.selectedItemIds)].filter((id) =>
        available.has(id),
      );
      if (
        ids.length !== next.selectedItemIds.length ||
        ids.some((id, index) => id !== next.selectedItemIds[index])
      )
        next.selectedItemIds = ids;
      if (!next.selectedItemId || !ids.includes(next.selectedItemId))
        next.selectedItemId = ids.at(-1) ?? null;
      if (this.selectionAnchor && !available.has(this.selectionAnchor))
        this.selectionAnchor = next.selectedItemId;
      const item = next.document?.items.find(
        (item) => item.id === next.selectedItemId,
      );
      if (!item) {
        next.selectedItemId = null;
        next.selectedNodeId = null;
      } else {
        const nodes = [item.node];
        let found = false;
        while (nodes.length) {
          const node = nodes.pop()!;
          if (node.id === next.selectedNodeId) {
            found = true;
            break;
          }
          nodes.push(...(node.children ?? []));
        }
        if (!found) next.selectedNodeId = item.id;
      }
    }
    const playheadChanged = !Object.is(
      this.state.playheadFrame,
      next.playheadFrame,
    );
    const contentChanged = (
      Object.keys(next) as Array<keyof VideoWorkspaceState>
    ).some(
      (key) =>
        key !== "playheadFrame" && !Object.is(this.state[key], next[key]),
    );
    if (!playheadChanged && !contentChanged) return;
    this.state = next;
    if (contentChanged) this.content = contentState(next);
    // Publish every snapshot before notifications, so mixed consumers always
    // observe the same latest document, selection and frame.
    this.listeners.forEach((listener) => listener());
    if (contentChanged) this.contentListeners.forEach((listener) => listener());
    if (playheadChanged)
      this.playheadListeners.forEach((listener) => listener());
  }
  private persist(): Promise<void> | void {
    if (this.recoveryReadFailed) return;
    if (this.recoveryWriter && this.state.snapshot)
      return this.recoveryWriter.write(this.state.snapshot, this.state.pending);
    try {
      if (this.state.pending.length)
        this.storage?.setItem(
          this.key,
          JSON.stringify({
            snapshot: this.state.snapshot,
            pending: this.state.pending,
          }),
        );
      else this.storage?.removeItem(this.key);
    } catch {
      this.update({
        error:
          "Browser recovery storage is full. Keep this tab open until pending changes are saved.",
      });
    }
  }
  private project(
    snapshot: VideoProjectSnapshot,
    pending = this.state.pending,
  ) {
    let document = parseVideoProjectDocument(snapshot.document);
    if (this.recoveryWriter)
      this.recoveryCodec.alias(document, snapshot.document);
    for (const operation of pending) {
      const next = executeVideoProjectCommands(
        document,
        operation.commands,
      ).document;
      if (this.recoveryWriter) {
        this.recoveryCodec.transition(document, next, operation.commands);
        if (
          operation === pending[0] &&
          operation.baseRevision === snapshot.revision &&
          operation.baseHash === snapshot.documentHash
        )
          this.expectedResults.set(operation, next);
      }
      document = next;
    }
    if (this.recoveryWriter) this.recoveryCodec.retainHead(document);
    return document;
  }
  async open() {
    const lifetime = ++this.lifecycle;
    this.closed = false;
    this.recovering = false;
    this.drainAbort?.abort();
    this.recoveryWriter?.reopen();
    await this.drain?.catch(() => undefined);
    if (this.closed || lifetime !== this.lifecycle) return;
    let snapshot: VideoProjectSnapshot;
    try {
      snapshot = await this.request<VideoProjectSnapshot>(
        `/api/projects/${encodeURIComponent(this.projectId)}/document`,
      );
    } catch (cause) {
      if (this.closed || lifetime !== this.lifecycle) return;
      throw cause;
    }
    if (this.closed || lifetime !== this.lifecycle) return;
    let pending: WorkspacePendingOperation[] = [];
    let recovered: VideoProjectSnapshot | null = null;
    try {
      const data = this.recoveryStore
        ? await this.recoveryStore.load()
        : JSON.parse(this.storage?.getItem(this.key) ?? "null");
      if (this.closed || lifetime !== this.lifecycle) return;
      if (data) {
        const recovery = decodeWorkspaceRecovery(data, this.projectId);
        recovered = recovery.snapshot;
        pending = recovery.pending;
        if (this.recoveryWriter) this.recoveryCodec.importLegacy(recovery);
      }
      this.recoveryReadFailed = false;
      if (this.state.recoveryError) this.update({ recoveryError: null });
    } catch {
      if (this.closed || lifetime !== this.lifecycle) return;
      // Unreadable recovery never replaces an authenticated snapshot or gets deleted.
      if (this.recoveryStore) {
        this.recoveryReadFailed = true;
        this.update({ recoveryError: RECOVERY_STORAGE_WARNING });
      }
    }
    if (this.closed || lifetime !== this.lifecycle) return;
    if (pending.length && recovered) {
      this.deferredSnapshot = snapshot;
      this.update({
        snapshot: recovered,
        document: this.project(recovered, pending),
        pending,
        status: "saving",
        error: null,
        saveFailure: null,
      });
      void this.flush().catch(() => {});
    } else this.acceptSnapshot(snapshot);
  }
  acceptSnapshot(snapshot: VideoProjectSnapshot) {
    if (
      this.closed ||
      snapshot.revision < (this.state.snapshot?.revision ?? -1)
    )
      return;
    if (
      snapshot.revision === this.state.snapshot?.revision &&
      snapshot.documentHash === this.state.snapshot.documentHash
    ) {
      if (
        JSON.stringify(snapshot.sources) !==
          JSON.stringify(this.state.snapshot.sources) ||
        JSON.stringify(snapshot.history) !==
          JSON.stringify(this.state.snapshot.history)
      )
        this.update({
          snapshot: {
            ...this.state.snapshot,
            sources: snapshot.sources,
            history: snapshot.history,
          },
        });
      return;
    }
    if (
      this.state.interactionDrafts ||
      this.state.pending.length ||
      this.drain
    ) {
      this.deferredSnapshot = snapshot;
      return;
    }
    snapshot = {
      ...snapshot,
      document: parseVideoProjectDocument(snapshot.document),
    };
    if (this.recoveryWriter) this.recoveryCodec.acknowledge(snapshot.document);
    this.update({
      snapshot,
      document: this.project(snapshot, []),
      status: "saved",
      error: null,
      saveFailure: null,
    });
  }
  async refresh() {
    const lifetime = this.lifecycle;
    if (this.closed || this.state.status === "loading") return;
    const snapshot = await this.request<VideoProjectSnapshot>(
      `/api/projects/${encodeURIComponent(this.projectId)}/document`,
    );
    if (lifetime === this.lifecycle) this.acceptSnapshot(snapshot);
  }
  dispatch(commands: VideoProjectCommand[]) {
    if (this.closed || !this.state.document || !commands.length) return;
    try {
      commands = structuredClone(commands);
      const document = executeVideoProjectCommands(
        this.state.document,
        commands,
      ).document;
      const operation = {
        operationId: crypto.randomUUID(),
        commands,
        baseDocument: this.state.document,
      };
      if (this.recoveryWriter)
        this.recoveryCodec.transition(this.state.document, document, commands);
      const blocked =
        this.state.saveFailure &&
        !["offline", "retryable"].includes(this.state.saveFailure.kind);
      this.update({
        document,
        pending: [...this.state.pending, operation],
        ...(blocked ? {} : { status: "saving" as const, error: null }),
      });
      this.persist();
      if (!blocked) void this.flush().catch(() => {});
    } catch (error) {
      this.update({
        error:
          error instanceof Error
            ? error.message
            : "The change could not be applied.",
      });
    }
  }
  dispatchEditor(commands: EditorCommand | EditorCommand[]) {
    if (!this.state.document) return;
    try {
      this.dispatch(
        editorCommandsToVideoCommands(
          this.state.document,
          Array.isArray(commands) ? commands : [commands],
        ),
      );
    } catch (error) {
      this.update({
        error:
          error instanceof Error
            ? error.message
            : "The change could not be applied.",
      });
    }
  }
  async flush(): Promise<VideoProjectSnapshot> {
    if (this.closed) throw closedWorkspace();
    if (this.drain) {
      if (this.drainLifecycle === this.lifecycle) return this.drain;
      await this.drain.catch(() => undefined);
      return this.flush();
    }
    if (!this.state.snapshot) throw new Error("Project has not loaded.");
    if (!this.state.pending.length && !this.hasPendingRecovery())
      return this.state.snapshot;
    if (
      this.state.saveFailure &&
      ["conflict", "validation"].includes(this.state.saveFailure.kind)
    )
      throw Object.assign(
        new Error(this.state.saveFailure.message),
        this.state.saveFailure,
      );
    // Assign the drain before notifying subscribers or entering synchronous rebase
    // validation, so retry/recovery cannot retain a settled or duplicate drain.
    const lifetime = this.lifecycle,
      cancellation = new AbortController();
    this.drainLifecycle = lifetime;
    this.drainAbort = cancellation;
    const interrupted = () =>
      this.closed || lifetime !== this.lifecycle || cancellation.signal.aborted;
    let drain!: Promise<VideoProjectSnapshot>;
    drain = Promise.resolve().then(async () => {
      try {
        while (true) {
          if (interrupted()) throw closedWorkspace();
          if (!this.state.pending.length) {
            await this.settleRecovery();
            if (interrupted()) throw closedWorkspace();
            // An edit can arrive while the acknowledged journal is being removed.
            // Its dispatch joined this drain, so recheck both queues before returning.
            if (!this.state.pending.length && !this.hasPendingRecovery())
              return this.state.snapshot!;
            continue;
          }
          const operation = this.state.pending[0];
          if (operation.baseRevision === undefined) {
            const expectedBase =
              operation.baseDocument ?? this.state.snapshot!.document;
            const checked = rebaseVideoProjectCommands(
              expectedBase,
              this.state.snapshot!.document,
              operation.commands,
            );
            if (!checked.ok)
              throw Object.assign(
                new Error(
                  "A newer change overlaps a pending edit. Your draft is preserved; choose which version to keep.",
                ),
                { status: 409, code: "EDIT_CONFLICT" },
              );
            if (this.recoveryWriter) {
              this.recoveryCodec.transition(
                this.state.snapshot!.document,
                checked.document,
                operation.commands,
              );
              this.expectedResults.set(operation, checked.document);
              if (this.state.document)
                this.recoveryCodec.retainHead(this.state.document);
            }
          }
          // Freeze request identity and base before sending. An uncertain retry must be identical.
          operation.baseRevision ??= this.state.snapshot!.revision;
          operation.baseHash ??= this.state.snapshot!.documentHash;
          await this.persist();
          if (interrupted()) throw closedWorkspace();
          let snapshot = await abortableRequest(
            this.request<VideoProjectSnapshot>(
              `/api/projects/${encodeURIComponent(this.projectId)}/commands`,
              {
                method: "POST",
                signal: cancellation.signal,
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                  operationId: operation.operationId,
                  commands: operation.commands,
                  baseRevision: operation.baseRevision,
                  baseHash: operation.baseHash,
                }),
              },
            ),
            cancellation.signal,
          );
          if (interrupted()) throw closedWorkspace();
          if (this.recoveryWriter) {
            snapshot = {
              ...snapshot,
              document: parseVideoProjectDocument(snapshot.document),
            };
            this.recoveryCodec.acknowledge(
              snapshot.document,
              this.expectedResults.get(operation),
            );
          }
          const pending = this.state.pending.slice(1);
          this.update({
            snapshot,
            pending,
            document: this.project(snapshot, pending),
            status: pending.length ? "saving" : "saved",
            error: null,
            saveFailure: null,
          });
          this.persist();
        }
      } catch (error) {
        if (interrupted()) {
          await this.settleRecovery();
          throw closedWorkspace();
        }
        const saveFailure = classifyWorkspaceSaveFailure(error);
        this.update({
          status: "error",
          error: saveFailure.message,
          saveFailure,
        });
        throw error;
      } finally {
        if (this.drain === drain) {
          this.drain = null;
          this.drainAbort = null;
        }
        if (!interrupted()) this.adoptDeferred();
      }
    });
    this.drain = drain;
    if (this.state.pending.length)
      this.update({ status: "saving", error: null });
    return this.drain;
  }
  private adoptDeferred() {
    if (
      this.deferredSnapshot &&
      !this.state.interactionDrafts &&
      !this.state.pending.length &&
      !this.drain
    ) {
      const snapshot = this.deferredSnapshot;
      this.deferredSnapshot = null;
      this.acceptSnapshot(snapshot);
    }
  }
  beginInteraction() {
    this.update({ interactionDrafts: this.state.interactionDrafts + 1 });
  }
  endInteraction() {
    this.update({
      interactionDrafts: Math.max(0, this.state.interactionDrafts - 1),
    });
    queueMicrotask(() => this.adoptDeferred());
  }
  select(itemId: string | null, nodeId: string | null = itemId) {
    this.selectionAnchor = itemId;
    this.update({
      selectedItemId: itemId,
      selectedItemIds: itemId ? [itemId] : [],
      selectedNodeId: nodeId,
    });
  }
  selectItems(
    itemIds: readonly string[],
    primaryId: string | null = itemIds.at(-1) ?? null,
  ) {
    this.selectionAnchor = primaryId;
    this.update({
      selectedItemIds: [...itemIds],
      selectedItemId: primaryId,
      selectedNodeId: primaryId,
    });
  }
  selectTimelineItem(itemId: string, gesture: TimelineSelectionGesture = {}) {
    const document = this.state.document;
    if (!document?.items.some((item) => item.id === itemId)) return;
    const groups = new Map(
      document.tracks.map((track) => [track.id, [] as string[]]),
    );
    document.items.forEach((item) => groups.get(item.trackId)?.push(item.id));
    const order = document.tracks.flatMap((track) => groups.get(track.id)!);
    const selection = timelineSelection(
      this.state.selectedItemIds,
      this.state.selectedItemId,
      this.selectionAnchor,
      itemId,
      order,
      gesture,
    );
    this.selectionAnchor = selection.anchor;
    this.update({
      selectedItemIds: selection.ids,
      selectedItemId: selection.primary,
      selectedNodeId: selection.primary,
    });
  }
  seek(frame: number) {
    this.update({ playheadFrame: frame });
  }
  async history(direction: "undo" | "redo") {
    const lifetime = this.lifecycle;
    if (this.state.interactionDrafts)
      throw new Error("Finish the active edit before changing history.");
    const snapshot = await this.flush();
    if (this.closed || lifetime !== this.lifecycle) throw closedWorkspace();
    const next = await this.request<VideoProjectSnapshot>(
      `/api/projects/${encodeURIComponent(this.projectId)}/${direction}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          operationId: crypto.randomUUID(),
          baseRevision: snapshot.revision,
          baseHash: snapshot.documentHash,
        }),
      },
    );
    if (this.closed || lifetime !== this.lifecycle) throw closedWorkspace();
    this.acceptSnapshot(next);
  }
  async resolveConflict(choice: "saved" | "pending") {
    if (this.state.saveFailure?.kind !== "conflict")
      throw new Error(
        "Only a confirmed document conflict can replace pending edits. Retry the same save instead.",
      );
    if (this.drain || this.recovering || this.state.interactionDrafts)
      throw new Error(
        "Finish the current edit before resolving this conflict.",
      );
    const lifetime = this.lifecycle;
    this.recovering = true;
    const previous = this.state.pending;
    let replaced = false;
    this.update({ status: "saving" });
    try {
      const snapshot = await this.request<VideoProjectSnapshot>(
        `/api/projects/${encodeURIComponent(this.projectId)}/document`,
      );
      if (
        this.closed ||
        lifetime !== this.lifecycle ||
        this.state.pending !== previous ||
        this.state.interactionDrafts
      )
        throw new Error(
          "Your draft changed while preparing recovery. Review it and try again.",
        );
      // A user-selected resolution preserves the old operation list as a downloadable recovery record.
      await this.backupRecovery("conflict", {
        snapshot: this.state.snapshot!,
        pending: previous,
      });
      if (
        this.closed ||
        lifetime !== this.lifecycle ||
        this.state.pending !== previous ||
        this.state.interactionDrafts
      )
        throw new Error(
          "Your draft changed while preparing recovery. Review it and try again.",
        );
      let expectedBase = snapshot.document;
      const pending =
        choice === "pending"
          ? previous.map((operation) => {
              const replay = {
                operationId: crypto.randomUUID(),
                commands: operation.commands,
                baseDocument: expectedBase,
              };
              const next = executeVideoProjectCommands(
                expectedBase,
                operation.commands,
              ).document;
              if (this.recoveryWriter)
                this.recoveryCodec.transition(
                  expectedBase,
                  next,
                  operation.commands,
                );
              expectedBase = next;
              return replay;
            })
          : [];
      const document = this.project(snapshot, pending);
      this.deferredSnapshot = null;
      this.update({
        snapshot,
        document,
        pending,
        status: pending.length ? "saving" : "saved",
        error: null,
        saveFailure: null,
      });
      replaced = true;
      this.persist();
      if (pending.length) await this.flush();
    } catch (error) {
      if (!replaced && !this.closed && lifetime === this.lifecycle)
        this.update({ status: "error" });
      throw error;
    } finally {
      if (lifetime === this.lifecycle) this.recovering = false;
    }
  }
  async discardRejectedChanges() {
    if (this.state.saveFailure?.kind !== "validation")
      throw new Error(
        "Only rejected edits can be discarded without resolving a save outcome.",
      );
    if (this.drain || this.recovering || this.state.interactionDrafts)
      throw new Error(
        "Finish the current edit before discarding unsaved changes.",
      );
    const lifetime = this.lifecycle;
    this.recovering = true;
    const previous = this.state.pending;
    this.update({ status: "saving" });
    try {
      const snapshot = await this.request<VideoProjectSnapshot>(
        `/api/projects/${encodeURIComponent(this.projectId)}/document`,
      );
      if (
        this.closed ||
        lifetime !== this.lifecycle ||
        this.state.pending !== previous ||
        this.state.interactionDrafts
      )
        throw new Error(
          "Your draft changed while preparing recovery. Review it and try again.",
        );
      await this.backupRecovery("rejected", {
        snapshot: this.state.snapshot!,
        pending: previous,
      });
      if (
        this.closed ||
        lifetime !== this.lifecycle ||
        this.state.pending !== previous ||
        this.state.interactionDrafts
      )
        throw new Error(
          "Your draft changed while preparing recovery. Review it and try again.",
        );
      this.deferredSnapshot = null;
      this.update({
        snapshot,
        document: this.project(snapshot, []),
        pending: [],
        status: "saved",
        error: null,
        saveFailure: null,
      });
      this.persist();
    } catch (error) {
      if (!this.closed && lifetime === this.lifecycle)
        this.update({ status: "error" });
      throw error;
    } finally {
      if (lifetime === this.lifecycle) this.recovering = false;
    }
  }
  private async backupRecovery(
    reason: "conflict" | "rejected",
    recovery: WorkspaceRecovery,
  ) {
    if (this.recoveryReadFailed) throw new Error(RECOVERY_STORAGE_WARNING);
    if (this.recoveryWriter)
      await this.recoveryWriter.backup(
        reason,
        recovery.snapshot,
        recovery.pending,
      );
    else
      this.storage?.setItem(`${this.key}:${reason}`, JSON.stringify(recovery));
  }
  async retryAfterReconnect() {
    if (this.closed) return;
    if (this.state.recoveryError) void this.retryRecovery().catch(() => {});
    if (
      this.closed ||
      this.state.saveFailure?.kind !== "offline" ||
      !this.state.pending.length
    )
      return;
    await this.flush();
  }
  async prepareAgentContext() {
    if (this.state.interactionDrafts)
      throw new Error(
        "Finish the active field or drag before starting this request.",
      );
    return this.flush();
  }
  setError(error: string) {
    this.update({ error, status: "error" });
  }
  clearError() {
    this.update({ error: null });
  }
  close() {
    const lifetime = ++this.lifecycle;
    this.closed = true;
    this.drainAbort?.abort();
    void (this.drain ?? Promise.resolve())
      .catch(() => undefined)
      .finally(() => {
        if (this.closed && lifetime === this.lifecycle)
          this.recoveryWriter?.close();
      });
    this.listeners.clear();
    this.contentListeners.clear();
    this.playheadListeners.clear();
  }
}
