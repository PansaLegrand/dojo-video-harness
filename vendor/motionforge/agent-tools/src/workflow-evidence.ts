import { z } from "zod/v3";
import { zodToJsonSchema } from "zod-to-json-schema";
import type {
  WorkflowEvidenceAdapter,
  WorkflowEvidenceRequest,
} from "./workflow";
import {
  EVIDENCE_CONTRACT_VERSION,
  evidenceBudgetsSchema,
  materializeEvidenceArtifacts,
  planComparisonSheet,
  selectProofFrames,
  type EvidenceArtifactRenderer,
  type EvidenceArtifactSink,
  type EvidenceBudgets,
  type EvidenceFailure,
  type ProofFrameSelection,
} from "./evidence";

const explicitFramesSchema = z
  .array(z.number().int().nonnegative().max(100_000_000))
  .max(64)
  .optional();

export const workflowProofFramesParamsSchema = z
  .object({
    explicitFrames: explicitFramesSchema,
    budgets: evidenceBudgetsSchema.optional(),
  })
  .strict();

export const workflowProofComparisonParamsSchema = z
  .object({
    explicitFrames: explicitFramesSchema,
    title: z.string().trim().min(1).max(160).optional(),
    includeVisualDiff: z.boolean().optional(),
    budgets: evidenceBudgetsSchema.optional(),
  })
  .strict();

export type WorkflowProofComparisonResult = {
  ok: true;
  kind: "motionforge.workflow-proof-comparison";
  version: typeof EVIDENCE_CONTRACT_VERSION;
  selection: ProofFrameSelection;
  plan: Extract<ReturnType<typeof planComparisonSheet>, { ok: true }>;
};

export type WorkflowProofRenderResult = {
  ok: true;
  kind: "motionforge.workflow-proof-render";
  version: typeof EVIDENCE_CONTRACT_VERSION;
  selection: ProofFrameSelection;
  plan: Extract<ReturnType<typeof planComparisonSheet>, { ok: true }>;
  artifacts: Extract<
    Awaited<ReturnType<typeof materializeEvidenceArtifacts>>,
    { ok: true }
  >;
};

export type WorkflowEvidenceOperationResult =
  | ProofFrameSelection
  | WorkflowProofComparisonResult
  | WorkflowProofRenderResult
  | EvidenceFailure;

export type WorkflowEvidenceCleanupContext = {
  sessionId: string;
  handle?: string;
};

export type WorkflowEvidenceAdapterOptions = {
  renderer?: EvidenceArtifactRenderer;
  sink?: EvidenceArtifactSink;
  /** Request-scoped sink takes precedence over the compatibility singleton. */
  sinkForRequest?: (
    request: WorkflowEvidenceRequest,
  ) => EvidenceArtifactSink | Promise<EvidenceArtifactSink>;
  /** Optional host cancellation source, sampled for each render operation. */
  signalForRequest?: (
    request: WorkflowEvidenceRequest,
  ) => AbortSignal | undefined;
  onDisposeHandle?: (
    context: Required<WorkflowEvidenceCleanupContext>,
  ) => void | Promise<void>;
  onDisposeSession?: (
    context: Pick<WorkflowEvidenceCleanupContext, "sessionId">,
  ) => void | Promise<void>;
};

export function workflowEvidenceOperationManifests(): Array<{
  operation:
    | "proof.frames"
    | "proof.comparison.plan"
    | "proof.comparison.render";
  description: string;
  paramsSchema: Record<string, unknown>;
}> {
  const manifest = (
    operation:
      | "proof.frames"
      | "proof.comparison.plan"
      | "proof.comparison.render",
    description: string,
    schema: z.ZodTypeAny,
  ) => ({
    operation,
    description,
    paramsSchema: {
      $schema: "http://json-schema.org/draft-07/schema#",
      ...(zodToJsonSchema(schema, {
        target: "jsonSchema7",
        $refStrategy: "none",
      }) as Record<string, unknown>),
    },
  });
  return structuredClone([
    manifest(
      "proof.frames",
      "Select ranked proof frames from the latest workflow change.",
      workflowProofFramesParamsSchema,
    ),
    manifest(
      "proof.comparison.plan",
      "Plan before/after and optional visual-diff comparison artifacts.",
      workflowProofComparisonParamsSchema,
    ),
    manifest(
      "proof.comparison.render",
      "Render and persist a portable comparison proof through host ports.",
      workflowProofComparisonParamsSchema,
    ),
  ]);
}

export interface WorkflowEvidenceController extends WorkflowEvidenceAdapter {
  cancelHandle(context: { sessionId: string; handle: string }): void;
}

/**
 * Bind pure evidence planning/materialization to workflow handles. The adapter
 * consumes host-only defensive Scene snapshots but returns portable JSON only.
 */
export function createWorkflowEvidenceAdapter(
  options: WorkflowEvidenceAdapterOptions = {},
): WorkflowEvidenceController {
  const active = new Map<string, AbortController>();

  const run = async (
    request: WorkflowEvidenceRequest,
  ): Promise<WorkflowEvidenceOperationResult> => {
    try {
      if (request.operation === "proof.frames") {
        const params = parseParams(workflowProofFramesParamsSchema, request);
        if (!params.ok) return params.failure;
        return proofSelection(request, params.value);
      }

      if (
        request.operation === "proof.comparison.plan" ||
        request.operation === "proof.comparison.render"
      ) {
        const params = parseParams(
          workflowProofComparisonParamsSchema,
          request,
        );
        if (!params.ok) return params.failure;
        const selection = proofSelection(request, params.value);
        if (!selection.ok) return selection;
        const plan = planComparisonSheet({
          selection,
          ...(params.value.title === undefined
            ? {}
            : { title: params.value.title }),
          ...(params.value.includeVisualDiff === undefined
            ? {}
            : { includeVisualDiff: params.value.includeVisualDiff }),
          ...(params.value.budgets === undefined
            ? {}
            : { budgets: params.value.budgets }),
        });
        if (!plan.ok) return plan;
        if (request.operation === "proof.comparison.plan") {
          return portableClone({
            ok: true,
            kind: "motionforge.workflow-proof-comparison",
            version: EVIDENCE_CONTRACT_VERSION,
            selection,
            plan,
          });
        }

        if (!options.renderer || (!options.sink && !options.sinkForRequest)) {
          return adapterFailure(
            "invalid_request",
            "proof.comparison.render requires injected renderer and sink ports.",
          );
        }
        const key = handleKey(request.sessionId, request.handle);
        active.get(key)?.abort();
        const linked = linkedController(options.signalForRequest?.(request));
        active.set(key, linked.controller);
        try {
          const sink = options.sinkForRequest
            ? await options.sinkForRequest(request)
            : options.sink!;
          const artifacts = await materializeEvidenceArtifacts({
            before: request.beforeScene,
            after: request.afterScene,
            plan,
            renderer: options.renderer,
            sink,
            signal: linked.controller.signal,
            ...(params.value.budgets === undefined
              ? {}
              : { budgets: params.value.budgets }),
          });
          if (!artifacts.ok) {
            linked.controller.abort();
            return artifacts;
          }
          return portableClone({
            ok: true,
            kind: "motionforge.workflow-proof-render",
            version: EVIDENCE_CONTRACT_VERSION,
            selection,
            plan,
            artifacts,
          });
        } finally {
          linked.dispose();
          if (active.get(key) === linked.controller) active.delete(key);
        }
      }

      return adapterFailure(
        "invalid_request",
        `Unsupported workflow evidence operation ${JSON.stringify(request.operation)}.`,
      );
    } catch (error) {
      return adapterFailure("invalid_request", safeMessage(error));
    }
  };

  return {
    run,
    cancelHandle({ sessionId, handle }) {
      active.get(handleKey(sessionId, handle))?.abort();
    },
    async disposeHandle({ sessionId, handle }) {
      const key = handleKey(sessionId, handle);
      active.get(key)?.abort();
      active.delete(key);
      await options.onDisposeHandle?.({ sessionId, handle });
    },
    async dispose({ sessionId }) {
      for (const [key, controller] of [...active].sort(([left], [right]) =>
        left < right ? -1 : left > right ? 1 : 0,
      )) {
        if (key.startsWith(`${sessionId}\u0000`)) {
          controller.abort();
          active.delete(key);
        }
      }
      await options.onDisposeSession?.({ sessionId });
    },
  };
}

function proofSelection(
  request: WorkflowEvidenceRequest,
  params: {
    explicitFrames?: number[];
    budgets?: Partial<EvidenceBudgets>;
  },
) {
  const changes = request.history?.semanticDiff.changes.map(
    ({ kind, path }) => ({
      kind,
      path: structuredClone(path),
    }),
  );
  return selectProofFrames({
    before: request.beforeScene,
    after: request.afterScene,
    ...(changes === undefined ? {} : { changes }),
    ...(params.explicitFrames === undefined
      ? {}
      : { explicitFrames: params.explicitFrames }),
    ...(params.budgets === undefined ? {} : { budgets: params.budgets }),
  });
}

function parseParams<T extends z.ZodTypeAny>(
  schema: T,
  request: WorkflowEvidenceRequest,
): { ok: true; value: z.infer<T> } | { ok: false; failure: EvidenceFailure } {
  const parsed = schema.safeParse(request.params ?? {});
  if (parsed.success) return { ok: true, value: parsed.data };
  return {
    ok: false,
    failure: {
      ok: false,
      kind: "motionforge.evidence.failure",
      version: EVIDENCE_CONTRACT_VERSION,
      errors: parsed.error.issues.slice(0, 16).map((issue) => ({
        code: "invalid_request",
        path: issue.path.map((part) =>
          typeof part === "number" ? part : String(part),
        ),
        message: issue.message.slice(0, 512),
      })),
    },
  };
}

function adapterFailure(
  code: "aborted" | "invalid_request",
  message: string,
): EvidenceFailure {
  return {
    ok: false,
    kind: "motionforge.evidence.failure",
    version: EVIDENCE_CONTRACT_VERSION,
    errors: [
      {
        code,
        path: ["operation"],
        message: message.slice(0, 512),
      },
    ],
  };
}

function linkedController(source: AbortSignal | undefined): {
  controller: AbortController;
  dispose: () => void;
} {
  const controller = new AbortController();
  if (!source) return { controller, dispose: () => undefined };
  if (source.aborted) controller.abort(source.reason);
  const onAbort = () => controller.abort(source.reason);
  source.addEventListener("abort", onAbort, { once: true });
  return {
    controller,
    dispose: () => source.removeEventListener("abort", onAbort),
  };
}

function portableClone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function handleKey(sessionId: string, handle: string): string {
  return `${sessionId}\u0000${handle}`;
}

function safeMessage(error: unknown): string {
  try {
    return error instanceof Error && error.message.trim() !== ""
      ? error.message.slice(0, 512)
      : String(error).slice(0, 512);
  } catch {
    return "Unknown workflow evidence failure.";
  }
}
