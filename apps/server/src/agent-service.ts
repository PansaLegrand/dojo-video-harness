import { randomUUID } from "node:crypto";
import { z } from "zod/v3";
import {
  runAgent,
  type LanguageModel,
  type Skill,
} from "../../../packages/agent/src/index";
import { agentRunInputSchema } from "../../../packages/core/src/lib/video-project/agent-types";
import {
  nativeClarificationAnswerSchema,
  nativeAuthoringSchema,
} from "../../../packages/core/src/lib/video-project/agent-authoring";
import { nativeVisualFrameBasis } from "../../../packages/core/src/lib/video-project/agent-runtime";
import { validateNativeClarification } from "../../../packages/core/src/lib/video-project/agent-clarification";
import {
  validateNativeAgentScope,
  nativeScopeItemIds,
} from "../../../packages/core/src/lib/video-project/agent-scope";
import {
  prepareNativeAgentReview,
  assertNativeReviewBasis,
} from "../../../packages/core/src/lib/video-project/agent-review";
import {
  canonicalSerialize,
  hashVideoProjectDocument,
} from "../../../packages/core/src/lib/video-project/document";
import { buildVideoProjectRevertCommands } from "../../../packages/core/src/lib/video-project/revert";
import {
  executeVideoProjectCommands,
  rebaseVideoProjectCommands,
} from "../../../packages/core/src/lib/video-project/commands";
import {
  ProjectStore,
  HttpError,
  commitDocument,
  snapshot,
  message,
  publicRun,
  runOf,
  type StoredRun,
} from "./store";
import type { AgentTool } from "../../../packages/agent/src/tools";
import type { NativeAgentRequest } from "../../../packages/core/src/lib/video-project/agent-runtime";
import {
  prepareAgentSpeech,
  assertAgentSpeechEvidence,
  agentSpeechBasisMatches,
  type AgentSpeechPort,
} from "./agent-speech";
import { parseVideoProjectDocument } from "../../../packages/core/src/lib/video-project/document";
import { nativeChangedItemIds } from "../../../packages/core/src/lib/video-project/agent-review";
import {
  agentCheckpointHistory,
  createAgentCheckpointPort,
  AgentCheckpointConflict,
} from "./agent-loop-checkpoint";
export class AgentService {
  private active = new Map<string, AbortController>();
  private recovery?: Promise<void>;
  constructor(
    private store: ProjectStore,
    private model: LanguageModel | (() => LanguageModel),
    private skills: Skill[],
    private extraTools?: (
      projectId: string,
      runId: string,
      request: NativeAgentRequest,
    ) => AgentTool[],
    private applicationMode: "review" | "direct" = "review",
    private speech?: AgentSpeechPort,
  ) {}
  /** Explicit startup recovery: only durable, checked boundaries are launched.
   * In-flight provider/unsafe-tool outcomes remain failed for manual recovery. */
  recover() {
    return (this.recovery ??= this.recoverStoredRuns());
  }
  private async recoverStoredRuns() {
    await this.store.recoverInterrupted();
    for (const { id } of await this.store.list()) {
      const project = await this.store.read(id);
      for (const run of project.runs)
        if (run.status === "queued" && run.phase === "checkpoint_resume")
          this.launch(id, run.id);
    }
  }
  async start(projectId: string, raw: unknown) {
    const input = agentRunInputSchema.parse(raw),
      hash = canonicalSerialize(input);
    let created = false;
    const run = await this.store.transaction(projectId, (p) => {
      const prior = p.runs.find((r) => r.operationId === input.operationId);
      if (prior) {
        if (prior.requestHash !== hash)
          throw new HttpError("Operation ID belongs to another request.", 409);
        return prior;
      }
      if (
        input.baseHash !== p.documentHash ||
        input.baseRevision !== p.revision
      )
        throw new HttpError(
          "Save the latest edits before asking the agent.",
          409,
        );
      if (input.context.visualWitness && !input.visualConsent)
        throw new HttpError("Sending a preview image requires consent.");
      const scope = validateNativeAgentScope(
          p.document,
          input.scope ?? { kind: "project" },
        ),
        now = new Date().toISOString();
      const run: StoredRun = {
        id: randomUUID(),
        operationId: input.operationId,
        status: "queued",
        phase: "created",
        instruction: input.instruction,
        cloudConsent: input.cloudConsent,
        baseRevision: p.revision,
        baseHash: p.documentHash,
        context: input.context,
        proposal: null,
        prerequisites: null,
        error: null,
        createdAt: now,
        updatedAt: now,
        scope,
        reviewBasisRequired: true,
        events: [],
        requestHash: hash,
        request: {
          contract: "video-project-commands",
          version: 1,
          baseRevision: p.revision,
          baseHash: p.documentHash,
          document: p.document,
          context: input.context,
          instruction: input.instruction,
          authoring: { version: 1, scope },
        },
      };
      if (input.referenceRunId) {
        const prior = runOf(p, input.referenceRunId);
        run.referenceRunId = prior.id;
        run.request.authoring!.reference = {
          runId: prior.id,
          instruction: prior.instruction,
          summary: prior.proposal?.summary ?? prior.instruction,
          changedItemIds: prior.proposal?.changedItemIds ?? [],
          outcome:
            prior.status === "applied"
              ? "applied"
              : prior.proposal
                ? "proposal"
                : "answer",
          baseRevision: prior.baseRevision,
          baseHash: prior.baseHash,
        };
      }
      p.runs.push(run);
      message(p, run.id, "user", run.instruction);
      created = true;
      return run;
    });
    if (created) this.launch(projectId, run.id);
    return { run: publicRun(run) };
  }
  private launch(projectId: string, id: string) {
    if (this.active.has(id)) return;
    const controller = new AbortController();
    this.active.set(id, controller);
    const timer = setTimeout(
      () => controller.abort(new Error("Agent deadline reached.")),
      180_000,
    );
    const model = typeof this.model === "function" ? this.model() : this.model;
    void this.execute(projectId, id, controller.signal, model)
      .catch(async (cause) => {
        await this.store
          .transaction(projectId, (p) => {
            const run = runOf(p, id);
            if (!["queued", "running", "needs_evidence"].includes(run.status))
              return;
            run.status = "failed";
            run.phase = "failed";
            run.error = {
              code:
                cause instanceof AgentCheckpointConflict
                  ? cause.code
                  : "AGENT_FAILED",
              message: cause instanceof Error ? cause.message : "Agent failed",
            };
            run.updatedAt = new Date().toISOString();
            message(p, id, "assistant", run.error.message);
          })
          .catch(() => {});
      })
      .finally(() => {
        clearTimeout(timer);
        this.active.delete(id);
      });
  }
  private async execute(
    projectId: string,
    id: string,
    signal: AbortSignal,
    model: LanguageModel,
  ) {
    const initial = await this.store.read(projectId);
    const initialRun = runOf(initial, id);
    if (initialRun.status === "cancelled") return;
    const history = agentCheckpointHistory(initial, initialRun);
    // A checkpoint resume may consume only existing ASR receipts. It cannot
    // silently create a replacement paid transcription if any receipt was lost.
    const speech =
      this.speech && initialRun.loopCheckpoint
        ? {
            ...this.speech,
            start: async () => {
              throw new AgentCheckpointConflict(
                "A saved agent checkpoint cannot submit replacement transcription work.",
              );
            },
          }
        : this.speech;
    const request = speech
      ? await prepareAgentSpeech(this.store, projectId, id, speech, signal)
      : (await this.store.read(projectId)).runs.find((r) => r.id === id)!
          .request;
    if (!request) return;
    signal.throwIfAborted();
    const run = await this.store.transaction(projectId, (p) => {
      const run = runOf(p, id);
      if (run.status === "cancelled") throw new Error("Cancelled");
      run.status = "running";
      run.phase = "thinking";
      if (run.speechContinuation) run.speechContinuation.modelStarted = true;
      return run;
    });
    const project = await this.store.read(projectId);
    const result = await runAgent({
      request,
      model,
      skills: this.skills,
      extraTools: this.extraTools?.(projectId, id, request),
      signal,
      messages:
        history ??
        project.messages.slice(-12).map(({ role, text }) => ({ role, text })),
      checkpoint: ({ inventory, skills }) =>
        createAgentCheckpointPort({
          store: this.store,
          projectId,
          runId: id,
          request,
          history:
            history ??
            project.messages
              .slice(-12)
              .map(({ role, text }) => ({ role, text })),
          inventory,
          skills,
          modelIdentity: model.identity,
          signal,
        }),
      onEvent: (event) =>
        this.store.transaction(projectId, (p) => {
          const r = runOf(p, id);
          if (r.status !== "running") return;
          const previous = r.events.find(
            (saved) => saved.sequence === event.sequence,
          );
          if (previous) {
            if (canonicalSerialize(previous) !== canonicalSerialize(event))
              throw new AgentCheckpointConflict(
                "The saved agent event sequence changed.",
              );
            return;
          }
          r.events.push(event);
          r.updatedAt = new Date().toISOString();
          r.phase = event.name ?? event.type;
        }),
    });
    signal.throwIfAborted();
    await this.store.transaction(projectId, async (p) => {
      const r = runOf(p, id);
      if (r.status !== "running") return;
      // The editor applies direct runs once local drafts are saved, using the same
      // checked basis as explicit review. Never commit behind an active browser draft.
      r.proposal = result.proposal
        ? { ...result.proposal, impact: this.applicationMode }
        : null;
      if (r.proposal && r.speechContinuation?.evidenceCommands?.length) {
        const base = parseVideoProjectDocument(r.request.document);
        const commands = [
          ...r.speechContinuation.evidenceCommands,
          ...r.proposal.commands,
        ];
        const composed = executeVideoProjectCommands(base, commands);
        r.proposal = {
          ...r.proposal,
          commands,
          previewHash: await hashVideoProjectDocument(composed.document),
          changedItemIds: nativeChangedItemIds(
            base,
            composed.document,
            composed.changedItemIds,
          ),
        };
      }
      r.clarification = result.clarification;
      r.status =
        result.outcome === "proposal"
          ? this.applicationMode === "direct"
            ? "ready"
            : "awaiting_review"
          : result.outcome === "needs_input"
            ? "needs_input"
            : "completed";
      r.phase = "completed";
      r.updatedAt = new Date().toISOString();
      if (r.clarification) {
        r.clarification = validateNativeClarification(
          p.document,
          r.clarification,
        );
        r.replyState = {
          available: true,
          options: Object.fromEntries(
            (r.clarification.options ?? []).map((option) => {
              const scope =
                option.scope ??
                (option.targetItemIds
                  ? {
                      kind: "selection" as const,
                      itemIds: option.targetItemIds,
                    }
                  : (r.scope ?? { kind: "project" as const }));
              const ids = nativeScopeItemIds(p.document, scope);
              return [
                option.id,
                {
                  scope,
                  itemCount: ids.length,
                  itemNames: p.document.items
                    .filter((i) => ids.includes(i.id))
                    .slice(0, 5)
                    .map((i) => i.name),
                  fps: p.document.format.fps,
                },
              ];
            }),
          ),
        };
      }
      message(p, id, "assistant", result.summary);
    });
  }
  async resume(projectId: string, id: string, raw: unknown) {
    const input = z
      .object({
        operationId: z.string().min(1).max(191),
        baseRevision: z.number().int().nonnegative(),
        baseHash: z.string(),
        cloudConsent: z.boolean().optional(),
      })
      .strict()
      .parse(raw);
    const run = await this.store.transaction(projectId, async (p) => {
      const r = runOf(p, id);
      if (r.status !== "needs_evidence") return r;
      if (
        p.revision !== input.baseRevision ||
        p.documentHash !== input.baseHash
      )
        throw new HttpError("Refresh the project before continuing.", 409);
      if (input.cloudConsent) r.cloudConsent = true;
      if (!(await agentSpeechBasisMatches(p, r))) {
        r.status = "stale";
        r.phase = "stale";
        r.error = {
          code: "PROJECT_CHANGED",
          message: "The project changed. Start a new request.",
        };
        r.updatedAt = new Date().toISOString();
        return r;
      }
      return r;
    });
    if (run.status === "needs_evidence") this.launch(projectId, id);
    return { run: publicRun(run) };
  }
  async cancel(projectId: string, id: string) {
    await this.store.transaction(projectId, (p) => {
      const r = runOf(p, id);
      if (r.status === "applied")
        throw new HttpError("Use undo for an applied edit.", 409);
      r.status = "cancelled";
      r.phase = "cancelled";
      r.updatedAt = new Date().toISOString();
    });
    this.active.get(id)?.abort();
    return { cancelled: true };
  }
  async review(projectId: string, id: string) {
    const p = await this.store.read(projectId),
      r = runOf(p, id);
    if (!r.proposal) throw new HttpError("No proposal to review.");
    if (this.speech && r.status !== "applied")
      await assertAgentSpeechEvidence(p, r, this.speech);
    if (
      r.status !== "applied" &&
      r.context.visualWitness &&
      nativeVisualFrameBasis(
        r.request.document as typeof p.document,
        r.context.playheadFrame,
      ) !== nativeVisualFrameBasis(p.document, r.context.playheadFrame)
    )
      throw new HttpError(
        "The preview used by this request changed. Capture a new frame.",
        409,
        "VISUAL_CONTEXT_STALE",
      );
    const current =
      r.status === "applied" && r.appliedBefore
        ? {
            ...snapshot(p),
            document: r.appliedBefore,
            documentHash: await hashVideoProjectDocument(r.appliedBefore),
            revision: r.baseRevision,
          }
        : snapshot(p);
    // Historical comparisons use the actual pre-commit basis stored when applied.
    return {
      ...(await prepareNativeAgentReview({
        runId: r.id,
        baseDocument: r.request.document as typeof p.document,
        baseHash: r.baseHash,
        proposal: r.proposal,
        current,
        organizeTracks: !r.undoOfRunId,
      })),
      applied: r.status === "applied",
      run: publicRun(r),
      sources: p.sources,
    };
  }
  async apply(projectId: string, id: string, raw: unknown) {
    const input = z
      .object({
        operationId: z.string(),
        baseRevision: z.number(),
        baseHash: z.string(),
        reviewBasis: z.any(),
      })
      .parse(raw);
    return this.store.transaction(projectId, async (p) => {
      const r = runOf(p, id);
      if (r.status === "applied") return snapshot(p);
      if (
        !r.proposal ||
        !(
          r.status === "awaiting_review" ||
          (r.status === "ready" && r.proposal.impact === "direct")
        )
      )
        throw new HttpError("This proposal is no longer actionable.", 409);
      if (this.speech) await assertAgentSpeechEvidence(p, r, this.speech);
      if (
        p.revision !== input.baseRevision ||
        p.documentHash !== input.baseHash
      )
        throw new HttpError(
          "Refresh the comparison before applying.",
          409,
          "NATIVE_REVIEW_STALE",
        );
      if (
        r.context.visualWitness &&
        nativeVisualFrameBasis(
          r.request.document as typeof p.document,
          r.context.playheadFrame,
        ) !== nativeVisualFrameBasis(p.document, r.context.playheadFrame)
      )
        throw new HttpError(
          "The preview frame changed. Start a new request.",
          409,
          "VISUAL_CONTEXT_STALE",
        );
      const comparison = await prepareNativeAgentReview({
        runId: id,
        baseDocument: r.request.document as typeof p.document,
        baseHash: r.baseHash,
        proposal: r.proposal,
        current: snapshot(p),
        organizeTracks: !r.undoOfRunId,
      });
      assertNativeReviewBasis(comparison.review.basis, input.reviewBasis);
      r.appliedBefore = p.document;
      r.appliedAfter = comparison.afterDocument;
      await commitDocument(p, comparison.afterDocument);
      r.status = "applied";
      r.phase = "applied";
      r.updatedAt = new Date().toISOString();
      return snapshot(p);
    });
  }
  async answer(projectId: string, id: string, raw: unknown) {
    const input = nativeClarificationAnswerSchema.parse(raw);
    let created = false;
    const child = await this.store.transaction(projectId, async (p) => {
      const parent = runOf(p, id),
        hash = canonicalSerialize(input),
        prior = parent.answers?.[input.operationId];
      if (prior) {
        if (prior.hash !== hash)
          throw new HttpError("Answer operation changed.", 409);
        return runOf(p, prior.childId);
      }
      if (
        parent.status !== "needs_input" ||
        !parent.clarification ||
        input.questionId !== parent.clarification.id
      )
        throw new HttpError("This question is no longer active.", 409);
      if (
        input.baseHash !== p.documentHash ||
        input.baseRevision !== p.revision ||
        !(await agentSpeechBasisMatches(p, parent))
      )
        throw new HttpError(
          "The project changed. Start a new request using the current project.",
          409,
        );
      const option = parent.clarification.options?.find(
        (o) => o.id === input.optionId,
      );
      if (input.optionId && !option)
        throw new HttpError("Unknown answer choice.");
      if (input.text && parent.clarification.allowText === false)
        throw new HttpError("Select a choice.");
      const answer = input.text ?? (option!.value?.trim() || option!.label),
        scope =
          option?.scope ??
          (option?.targetItemIds
            ? { kind: "selection" as const, itemIds: option.targetItemIds }
            : parent.scope!);
      validateNativeAgentScope(p.document, scope);
      const child: StoredRun = {
        ...structuredClone(parent),
        id: randomUUID(),
        operationId: input.operationId,
        status: "queued",
        phase: "created",
        proposal: null,
        clarification: undefined,
        replyState: undefined,
        clarificationParentRunId: parent.id,
        error: null,
        events: [],
        loopCheckpoint: undefined,
        scope,
        requestHash: hash,
        answers: undefined,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };
      if (child.speechContinuation)
        child.speechContinuation.modelStarted = false;
      child.request.authoring = nativeAuthoringSchema.parse({
        ...parent.request.authoring,
        scope,
        clarification: {
          parentRunId: id,
          questionId: input.questionId,
          question: parent.clarification.question,
          answer,
          optionId: input.optionId,
        },
      });
      parent.status = "completed";
      parent.phase = "clarification_answered";
      parent.answers = { [input.operationId]: { hash, childId: child.id } };
      parent.replyState = {
        ...parent.replyState!,
        available: false,
        continuationRunId: child.id,
      };
      p.runs.push(child);
      message(p, child.id, "user", answer);
      created = true;
      return child;
    });
    if (created) this.launch(projectId, child.id);
    return { run: publicRun(child) };
  }
  async undo(projectId: string, id: string, raw: unknown) {
    return this.store.transaction(projectId, async (p) => {
      const input = z
          .object({
            operationId: z.string(),
            baseHash: z.string(),
            baseRevision: z.number(),
          })
          .parse(raw),
        r = runOf(p, id);
      const fingerprint = canonicalSerialize({
        action: "undo",
        runId: id,
        ...input,
      });
      const previous = p.receipts[input.operationId];
      if (previous) {
        if (previous.hash !== fingerprint)
          throw new HttpError("Operation ID belongs to another undo.", 409);
        return previous.snapshot;
      }
      if (
        p.documentHash !== input.baseHash ||
        p.revision !== input.baseRevision
      )
        throw new HttpError("Save before undo.", 409);
      if (!r.appliedBefore || !r.appliedAfter)
        throw new HttpError("No applied edit to undo.");
      const commands = buildVideoProjectRevertCommands(
        r.appliedBefore,
        r.appliedAfter,
      );
      const rebased = rebaseVideoProjectCommands(
        r.appliedAfter,
        p.document,
        commands,
      );
      if (!rebased.ok) throw new HttpError(rebased.reason, 409);
      const before = p.document,
        beforeHash = p.documentHash,
        beforeRevision = p.revision;
      await commitDocument(p, rebased.document);
      // The product chat derives per-card Undo state from acknowledged inverse runs.
      const undoRun: StoredRun = {
        ...structuredClone(r),
        id: randomUUID(),
        operationId: input.operationId,
        instruction: `Undo: ${r.instruction}`,
        undoOfRunId: r.id,
        status: "applied",
        phase: "applied",
        baseRevision: beforeRevision,
        baseHash: beforeHash,
        scope: { kind: "project" },
        request: {
          ...r.request,
          baseRevision: beforeRevision,
          baseHash: beforeHash,
          document: before,
          authoring: { version: 1, scope: { kind: "project" } },
        },
        requestHash: fingerprint,
        events: [],
        loopCheckpoint: undefined,
        error: null,
        clarification: undefined,
        replyState: undefined,
        clarificationReply: undefined,
        clarificationParentRunId: undefined,
        answers: undefined,
        proposal: {
          summary: "Undid the selected edit",
          commands: rebased.commands,
          changedItemIds: rebased.changedItemIds,
          impact: "review",
          previewHash: p.documentHash,
        },
        appliedBefore: before,
        appliedAfter: p.document,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };
      p.runs.push(undoRun);
      message(p, undoRun.id, "assistant", undoRun.proposal!.summary);
      const result = snapshot(p);
      p.receipts[input.operationId] = {
        hash: fingerprint,
        snapshot: result,
      };
      return result;
    });
  }
}
