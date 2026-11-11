import type { EditorExternalJobSummary } from "@/lib/video-project/external-job-types";
import type { EditorGenerationPlacement } from "./editor-generation-state";
export type EditorGenerationAction = "approve" | "reconcile" | "cancel" | "insert" | "requote";
export type EditorGenerationActionResult = { job: EditorExternalJobSummary; replayed: boolean; runId?: string };
export type EditorGenerationActionInput = { placement?: EditorGenerationPlacement; reuseSavedResult?: boolean; videoModel?: string };
/** One pending body per action: a lost acknowledgement retries the approved attempt.
 * The server remains the authority for charges, canonical storage and insertion. */
export class EditorGenerationActions {
  private attempts = new Map<EditorGenerationAction, { body: Record<string, unknown>; choice: string }>();
  private pending: Promise<EditorGenerationActionResult> | null = null;
  constructor(private ports: {
    endpoint: string;
    request: (path: string, init: RequestInit) => Promise<EditorGenerationActionResult>;
    prepareContext: () => Promise<{ revision: number; documentHash: string }>;
    authorizeReference: (sourceId: string) => Promise<void>;
  }) {}
  hasPending(action: EditorGenerationAction) { return this.attempts.has(action); }
  run(action: EditorGenerationAction, job: EditorExternalJobSummary, input: EditorGenerationActionInput = {}): Promise<EditorGenerationActionResult> {
    if (this.pending) return this.pending;
    const perform = async () => {
      const choice = JSON.stringify(action === "insert" || action === "requote" ? input : action === "approve" ? job.quote.quoteHash : null);
      let attempt = this.attempts.get(action);
      if (attempt && attempt.choice !== choice) throw Object.assign(new Error("Retry the pending generation action before changing its placement."), { code: "EDITOR_GENERATION_PENDING" });
      if (!attempt) {
        // This user gesture explicitly authorizes the exact quoted reference only.
        // Upload failure cannot reach the funding endpoint.
        if (action === "approve" && job.referenceSourceId) {
          try { await this.ports.authorizeReference(job.referenceSourceId); }
          catch (cause) { throw Object.assign(new Error(cause instanceof Error ? cause.message : "Reference upload failed."), { code: "EDITOR_GENERATION_REFERENCE_UPLOAD" }); }
        }
        const basis = action === "insert" ? await this.ports.prepareContext() : undefined;
        attempt = { choice, body: { operationId: crypto.randomUUID(), ...(action === "approve" ? { quoteHash: job.quote.quoteHash } : {}), ...(action === "requote" ? { videoModel: input.videoModel } : {}),
          ...(basis ? { baseRevision: basis.revision, baseHash: basis.documentHash, ...input } : {}) } };
        this.attempts.set(action, attempt);
      }
      try {
        const result = await this.ports.request(this.ports.endpoint + "/" + action, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(attempt.body) });
        this.attempts.delete(action); return result;
      } catch (cause) {
        const status = cause && typeof cause === "object" && "status" in cause ? Number(cause.status) : 0;
        if ([400, 401, 402, 403, 404, 409, 413, 422].includes(status)) this.attempts.delete(action);
        throw cause;
      }
    };
    this.pending = perform().finally(() => { this.pending = null; }); return this.pending;
  }
}
