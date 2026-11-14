import { savedAgentKitVersion, sourceRequirementValidation } from "../../../packages/agent/src/runtime-build";
import { randomUUID } from "node:crypto";
import { parseLoopCheckpoint } from "../../../packages/agent-loop/src/index";
import { z } from "zod/v3";
import { estimateExport } from "@dojo-video-engine/export";
import {
  createEditorHostTools,
  completionHash,
  completionCanonical,
  EDITOR_HOST_TOOL_POLICY,
  parseEditArtifactRef,
  usesAppendPreviewRepair,
  usesSemanticEditingGuidance,
  type EditorVisualInputRef,
} from "../../../packages/agent-kit/src/index";
import {
  browserHostValueHash,
  createBrowserInspectionRequest,
  validateBrowserInspectionReceipt,
  browserInspectionGrantSchema,
  browserInspectionFailureSchema,
  type BrowserInspectionRequest,
  type BrowserInspectionGrant,
  type BrowserInspectionReceipt,
} from "../../../packages/core/src/lib/video-project/browser-host-requests";
import {
  createProjectPreviewRequest,
  validateProjectPreviewReceipt,
  OUTPUT_PREVIEW_LIMITS,
  type ProjectPreviewRequest,
  type ProjectPreviewReceipt,
} from "../../../packages/core/src/lib/video-project/browser-output-requests";
import { previewRepairEvidence } from "../../../packages/core/src/lib/video-project/preview-repair-evidence";
import { hashVideoProjectDocument } from "../../../packages/core/src/lib/video-project/document";
import { compileVideoProjectDocument } from "../../../packages/core/src/lib/video-project/compilation";
import {
  type NativeAgentRequest,
  type NativeAgentResult,
} from "../../../packages/core/src/lib/video-project/agent-runtime";
import { compileNativeCompletionResponse } from "../../../packages/core/src/lib/video-project/completion-preflight";
import { executeVideoProjectCommands } from "../../../packages/core/src/lib/video-project/commands";
import { nativeScopeItemIds } from "../../../packages/core/src/lib/video-project/agent-scope";
import {
  ProjectStore,
  HttpError,
  runOf,
  type Project,
  type StoredRun,
} from "./store";
import type { AgentTool } from "../../../packages/agent/src/tools";
import {
  prepareLocalAgentExport,
  listLocalAgentExports,
  authorizeLocalAgentExport,
  fulfillLocalAgentExport,
  readLocalAgentExport,
  failLocalAgentExport,
  retryLocalAgentExport,
  cancelLocalAgentExports,
  updateLocalExportHint,
} from "./local-agent-exports";

// Bound model inputs before creating an authorized browser request.
const MODEL_INSPECTION_DEFAULT_LIMITS = Object.freeze({
  maxFrames: EDITOR_HOST_TOOL_POLICY.framesPerRequest,
  maxDimension: 768,
  maxFramePixels: 768 * 768,
  maxTotalPixels: 4 * 768 * 768,
  maxOutputBytes: 512 * 1024,
  timeoutMs: 15000,
});

export type LocalBrowserRecord = {
  kind: "source-inspection" | "project-preview";
  request: BrowserInspectionRequest | ProjectPreviewRequest;
  status:
    | "waiting_consent"
    | "waiting_browser"
    | "fulfilled"
    | "failed"
    | "cancelled";
  grant: BrowserInspectionGrant | null;
  error: { code: string; message: string } | null;
  receipt?: BrowserInspectionReceipt | ProjectPreviewReceipt;
};
export type LocalBrowserRequestState = Record<
  string,
  Record<
    string,
    LocalBrowserRecord | import("./local-agent-exports").LocalAgentExport
  >
>;
const authorization = z
  .object({
    operationId: z.string().min(1).max(191),
    scopeHash: z.string().regex(/^[a-f0-9]{64}$/),
  })
  .strict();
const retryInput = z
  .object({ operationId: z.string().min(1).max(191) })
  .strict();
const stopped = (run: StoredRun) =>
  [
    "cancelled",
    "failed",
    "applied",
    "completed",
    "ready",
    "awaiting_review",
  ].includes(run.status);
function enabled(project: Project, runId: string, allowStopped = false) {
  const run = runOf(project, runId);
  if (!run.browserToolsEnabled)
    throw new HttpError(
      "Browser requests are unavailable for this saved run.",
      404,
    );
  if (!allowStopped && stopped(run))
    throw new HttpError(
      "This editing run is stopped. Its saved receipts remain available.",
      409,
    );
  return run;
}
function entries(project: Project, runId: string) {
  return Object.fromEntries(
    Object.entries(project.browserRequests?.[runId] ?? {}).filter(
      (entry): entry is [string, LocalBrowserRecord] =>
        entry[1].kind !== "project-export",
    ),
  );
}
function owned(project: Project, runId: string, requestId: string) {
  enabled(project, runId, true);
  const all = entries(project, runId);
  const value = Object.hasOwn(all, requestId) ? all[requestId] : undefined;
  if (
    !value ||
    value.request.projectId !== project.id ||
    value.request.runId !== runId
  )
    throw new HttpError("Browser request not found.", 404);
  return value;
}
function summary(row: LocalBrowserRecord) {
  const { receipt, ...record } = row;
  return { ...record, hasReceipt: !!receipt };
}
function hints(project: Project, runId: string) {
  const run = runOf(project, runId),
    all = Object.values(entries(project, runId));
  const sources = all.filter((row) => row.kind === "source-inspection");
  const pending = (rows: LocalBrowserRecord[]) =>
    rows.filter((row) =>
      ["waiting_consent", "waiting_browser"].includes(row.status),
    ).length;
  run.hostRequests = { count: sources.length, pending: pending(sources) };
  updateLocalExportHint(project, runId);
}
function current(project: Project, run: StoredRun, row: LocalBrowserRecord) {
  if (row.kind === "source-inspection") {
    const request = row.request as BrowserInspectionRequest;
    const source = project.document.sources[request.source.sourceId];
    const asset = project.document.assets[request.source.sourceId];
    if (
      !source ||
      !asset ||
      source.revision !== request.source.sourceRevision ||
      source.contentHash !== request.source.contentHash ||
      asset.type !== request.source.type ||
      (asset.byteLength !== undefined &&
        asset.byteLength !== request.source.byteLength)
    )
      throw new HttpError(
        "The original source changed. Start a new inspection.",
        409,
        "SOURCE_CHANGED",
      );
  } else if (
    project.revision !== row.request.snapshot.revision ||
    project.documentHash !== row.request.snapshot.documentHash ||
    run.baseHash !== row.request.snapshot.documentHash
  )
    throw new HttpError(
      "The preview belongs to another saved revision.",
      409,
      "STALE_OUTPUT",
    );
}
function validate(row: LocalBrowserRecord, raw: unknown) {
  if (!row.grant)
    throw new HttpError(
      "Approve these exact frames before sending pixels.",
      403,
      "CONSENT_REQUIRED",
    );
  return row.kind === "source-inspection"
    ? validateBrowserInspectionReceipt(
        row.request as BrowserInspectionRequest,
        row.grant,
        raw,
      )
    : validateProjectPreviewReceipt(
        row.request as ProjectPreviewRequest,
        row.grant,
        raw,
      );
}
function budget(project: Project, runId: string, frames: number) {
  const all = Object.values(entries(project, runId));
  const used = all.reduce(
    (sum, row) =>
      sum +
      (row.kind === "source-inspection"
        ? (row.request as BrowserInspectionRequest).momentsMs.length
        : (row.request as ProjectPreviewRequest).frames.length),
    0,
  );
  if (all.length >= 64 || used + frames > EDITOR_HOST_TOOL_POLICY.framesPerRun)
    throw new HttpError(
      "This run has used its original visual frame allowance.",
      409,
      "BUDGET_EXHAUSTED",
    );
}
const requestRef = (row: LocalBrowserRecord) => ({
  kind: row.kind,
  id: row.request.id,
  hash: "sha256:" + browserHostValueHash(row.request),
});
function visual(row: LocalBrowserRecord): EditorVisualInputRef {
  const receipt = validate(row, row.receipt);
  const frames =
    row.kind === "source-inspection"
      ? (receipt as BrowserInspectionReceipt).frames.map(
          ({
            sha256,
            byteLength,
            mimeType,
            width,
            height,
            requestedMs,
            actualMs,
          }) => ({
            sha256,
            byteLength,
            mimeType,
            width,
            height,
            sourceId: (row.request as BrowserInspectionRequest).source.sourceId,
            sourceRevision: (row.request as BrowserInspectionRequest).source
              .sourceRevision,
            requestedMs,
            actualMs,
          }),
        )
      : (receipt as ProjectPreviewReceipt).frames.map(
          ({ sha256, byteLength, width, height, frame, sceneTimestampUs }) => ({
            sha256,
            byteLength,
            mimeType: "image/jpeg" as const,
            width,
            height,
            frame,
            sceneTimestampUs,
            renderHash: (row.request as ProjectPreviewRequest).renderHash,
          }),
        );
  return {
    version: 1,
    requestRef: requestRef(row),
    receiptHash: browserHostValueHash(receipt),
    frames,
  };
}
async function candidate(project: Project, run: StoredRun, raw: unknown) {
  const ref = parseEditArtifactRef(raw),
    state = project.editStagePlans?.[run.id],
    saved = state?.artifacts[ref.id];
  if (
    ref.kind !== "verification" ||
    ref.runId !== run.id ||
    !state ||
    ref.bindingHash !== state.plan.bindingHash ||
    !saved ||
    completionCanonical(ref) !== completionCanonical(saved.ref) ||
    (await completionHash(saved.value)) !== ref.sha256 ||
    new TextEncoder().encode(completionCanonical(saved.value)).length !==
      ref.sizeBytes
  )
    throw new HttpError(
      "Preview requires this run's immutable successful review.",
      409,
    );
  if (state.plan.binding.profile !== (run.agentProfile ?? "local-editor-v1"))
    throw new HttpError(
      "The saved preview belongs to another editing profile. Continue its original run.",
      409,
    );
  const review = saved.value as {
    edit: unknown;
    requirements: unknown;
    receipt?: { previewHash: string };
  };
  if (!review.receipt)
    throw new HttpError("This candidate did not pass native review.", 409);
  let request = run.request;
  if (run.speechContinuation?.evidenceCommands?.length) {
    const document = executeVideoProjectCommands(
      run.request.document as Project["document"],
      run.speechContinuation.evidenceCommands,
    ).document;
    request = {
      ...run.request,
      document,
      baseHash: await hashVideoProjectDocument(document),
      visualDocumentHash: run.baseHash,
    };
  }
  const profile = run.agentProfile ?? "local-editor-v1";
  const result = await compileNativeCompletionResponse(
    request,
    {
      ...(review.edit as object),
      completion: {
        requirements: review.requirements,
        receipt: review.receipt,
      },
    },
    {
      validateSourceRequirements: sourceRequirementValidation(profile, savedAgentKitVersion(run)),
      ...(usesAppendPreviewRepair(profile)
        ? { preserveAuthoredPaintOrder: true }
        : {}),
      ...(usesSemanticEditingGuidance(profile)
        ? { preciseSpeechDiagnostics: true }
        : {}),
    },
  );
  if (!result.proposal)
    throw new HttpError("Preview requires a native editing proposal.", 409);
  const document = executeVideoProjectCommands(
    request.document as Project["document"],
    result.proposal.commands,
  ).document;
  if ((await hashVideoProjectDocument(document)) !== review.receipt.previewHash)
    throw new HttpError(
      "The saved candidate differs from its native review.",
      409,
    );
  return {
    document,
    renderHash: review.receipt.previewHash,
    ref: { ...ref, kind: "verification" as const },
  };
}
function previewFormat(document: Project["document"]) {
  const urls = Object.fromEntries(
    Object.keys(document.assets).map((id) => [
      id,
      `https://owned.invalid/${encodeURIComponent(id)}`,
    ]),
  );
  return {
    width: document.format.width,
    height: document.format.height,
    fps: document.format.fps,
    durationInFrames: document.format.durationInFrames,
    hasAudio: estimateExport(compileVideoProjectDocument(document, urls).scene)
      .hasAudio,
    requireAudibleAudio: false,
  };
}

/** Local HTTP authority for the existing browser request contracts. */
export class LocalBrowserRequests {
  constructor(private store: ProjectStore) {}
  tools(
    projectId: string,
    runId: string,
    _request: NativeAgentRequest,
  ): AgentTool[] {
    const prepare = async (
      kind: "source-inspection" | "project-preview",
      input: Record<string, unknown>,
    ) => {
      const row = await this.prepare(projectId, runId, kind, input);
      if (row.status === "failed")
        return {
          kind: "observation" as const,
          value: {
            browserRequest: {
              requestRef: requestRef(row),
              status: "failed",
              error: row.error,
            },
          },
        };
      return row.receipt
        ? { kind: "observation" as const, value: { visualInput: visual(row) } }
        : { kind: "waiting" as const, requestRef: requestRef(row) };
    };
    return createEditorHostTools<NativeAgentResult>({
      profile: "local-editor-v10",
      ports: {
        inspect_image: (input) =>
          prepare("source-inspection", {
            sourceId: input.sourceId,
            momentsMs: [0],
            expectedType: "image",
          }),
        sample_video_frames: (input) =>
          prepare("source-inspection", { ...input, expectedType: "video" }),
        request_project_preview: (input) => prepare("project-preview", input),
        request_project_export: (input) =>
          prepareLocalAgentExport(this.store, projectId, runId, input),
      },
    }).map((tool) => ({ ...tool, replaySafe: true, compactionSafe: true }));
  }
  private async prepare(
    projectId: string,
    runId: string,
    kind: LocalBrowserRecord["kind"],
    input: Record<string, unknown>,
  ) {
    return this.store.transaction(projectId, async (project) => {
      const run = enabled(project, runId);
      let request: LocalBrowserRecord["request"];
      if (kind === "source-inspection") {
        const id = String(input.sourceId),
          basis = run.request.document as Project["document"],
          asset = basis.assets[id],
          source = basis.sources[id];
        if (asset?.type !== input.expectedType)
          throw new HttpError(
            "Choose a source matching this inspection tool.",
            400,
          );
        const registered = project.sources.find((row) => row.sourceId === id);
        if (
          !asset ||
          !["image", "video"].includes(asset.type) ||
          !source?.contentHash ||
          !registered ||
          registered.scheme !== "sha256" ||
          registered.fingerprint !== source.contentHash ||
          source.revision !== `sha256:${registered.fingerprint}`
        )
          throw new HttpError(
            "Choose an owned original image or video with its fingerprint.",
            409,
            "SOURCE_MISSING",
          );
        const scope = run.request.authoring?.scope;
        if (
          scope &&
          scope.kind !== "project" &&
          !nativeScopeItemIds(basis, scope).some(
            (itemId) =>
              basis.items.find((item) => item.id === itemId)?.node.assetId ===
              id,
          )
        )
          throw new HttpError(
            "This source is outside the requested edit scope.",
            403,
          );
        const value = {
          version: 1 as const,
          kind,
          projectId,
          runId,
          snapshot: { revision: run.baseRevision, documentHash: run.baseHash },
          source: {
            sourceId: id,
            sourceRevision: source.revision,
            contentHash: source.contentHash,
            byteLength: registered.byteLength,
            type: asset.type as "image" | "video",
          },
          momentsMs: input.momentsMs as number[],
          limits: MODEL_INSPECTION_DEFAULT_LIMITS,
        };
        request = createBrowserInspectionRequest(
          value,
          `inspection:${browserHostValueHash(value)}`,
        );
      } else {
        const rendered = await candidate(project, run, input.candidateRef);
        const value = {
          version: 1 as const,
          kind,
          projectId,
          runId,
          snapshot: { revision: run.baseRevision, documentHash: run.baseHash },
          renderHash: rendered.renderHash,
          candidateRef: rendered.ref,
          format: previewFormat(rendered.document),
          frames: input.frames as number[],
          limits: OUTPUT_PREVIEW_LIMITS,
        };
        request = createProjectPreviewRequest(
          value,
          `preview:${browserHostValueHash(value)}`,
        );
      }
      const previous = entries(project, runId)[request.id];
      if (previous) {
        current(project, run, previous);
        if (previous.status === "cancelled")
          throw new HttpError("This request was cancelled.", 409);
        return previous;
      }
      budget(
        project,
        runId,
        kind === "source-inspection"
          ? (request as BrowserInspectionRequest).momentsMs.length
          : (request as ProjectPreviewRequest).frames.length,
      );
      const row: LocalBrowserRecord = {
        kind,
        request,
        status: "waiting_consent",
        grant: null,
        error: null,
      };
      current(project, run, row);
      project.browserRequests ??= {};
      project.browserRequests[runId] ??= {};
      project.browserRequests[runId]![request.id] = row;
      hints(project, runId);
      return row;
    });
  }
  async list(
    projectId: string,
    runId: string,
    kind: LocalBrowserRecord["kind"],
  ) {
    const listed = await this.store.transaction(projectId, (project) => {
      const run = enabled(project, runId, true);
      const all = Object.values(entries(project, runId));
      if (run.status === "cancelled")
        for (const row of all) if (!row.receipt) row.status = "cancelled";
      hints(project, runId);
      return { requests: all.filter((row) => row.kind === kind).map(summary) };
    });
    return kind === "project-preview"
      ? {
          requests: [
            ...listed.requests,
            ...(await listLocalAgentExports(this.store, projectId, runId)),
          ],
        }
      : listed;
  }
  async authorize(projectId: string, runId: string, id: string, raw: unknown) {
    if (id.startsWith("export:"))
      return authorizeLocalAgentExport(this.store, projectId, runId, id, raw);
    const input = authorization.parse(raw);
    return this.store.transaction(projectId, (project) => {
      const run = enabled(project, runId),
        row = owned(project, runId, id);
      current(project, run, row);
      if (
        row.status === "cancelled" ||
        row.request.scopeHash !== input.scopeHash
      )
        throw new HttpError("Approve the exact saved frame scope.", 409);
      row.grant ??= {
        version: 1,
        id: `grant:${randomUUID()}`,
        scopeHash: input.scopeHash,
        mode: "cloud-visual-analysis",
        authorizedAt: new Date().toISOString(),
      };
      if (!row.receipt) row.status = "waiting_browser";
      hints(project, runId);
      return { record: summary(row), grant: row.grant };
    });
  }
  async fulfill(projectId: string, runId: string, id: string, raw: unknown) {
    if (id.startsWith("export:"))
      return fulfillLocalAgentExport(this.store, projectId, runId, id, raw);
    return this.store.transaction(projectId, (project) => {
      const row = owned(project, runId, id),
        receipt = validate(row, raw);
      if (row.receipt) {
        if (browserHostValueHash(row.receipt) !== browserHostValueHash(receipt))
          throw new HttpError(
            "A saved browser receipt cannot be replaced.",
            409,
          );
        return {
          record: summary(row),
          replayed: true,
          receiptHash: browserHostValueHash(receipt),
        };
      }
      const run = enabled(project, runId);
      current(project, run, row);
      if (row.status !== "waiting_browser")
        throw new HttpError(
          "This browser request is not ready for capture.",
          409,
        );
      const all = Object.values(entries(project, runId));
      const bytes =
        all.reduce(
          (sum, value) =>
            sum +
            (value.receipt?.frames.reduce(
              (n, frame) => n + frame.byteLength,
              0,
            ) ?? 0),
          0,
        ) + receipt.frames.reduce((n, frame) => n + frame.byteLength, 0);
      if (bytes > EDITOR_HOST_TOOL_POLICY.visualBytesPerRun)
        throw new HttpError(
          "This run has used its visual byte allowance.",
          409,
        );
      row.receipt = receipt;
      row.status = "fulfilled";
      row.error = null;
      hints(project, runId);
      return {
        record: summary(row),
        replayed: false,
        receiptHash: browserHostValueHash(receipt),
      };
    });
  }
  async receipt(projectId: string, runId: string, id: string) {
    if (id.startsWith("export:"))
      return readLocalAgentExport(this.store, projectId, runId, id);
    const project = await this.store.read(projectId),
      row = owned(project, runId, id);
    if (!row.receipt)
      throw new HttpError(
        "This browser input is still pending.",
        409,
        "BROWSER_INPUT_PENDING",
      );
    return { receipt: validate(row, row.receipt) };
  }
  async renderInput(projectId: string, runId: string, id: string) {
    const project = await this.store.read(projectId),
      row = owned(project, runId, id),
      run = enabled(project, runId);
    if (row.kind !== "project-preview" || !row.grant)
      throw new HttpError(
        "Approve this exact preview before rendering it.",
        403,
      );
    browserInspectionGrantSchema.parse(row.grant);
    current(project, run, row);
    const rendered = await candidate(
      project,
      run,
      (row.request as ProjectPreviewRequest).candidateRef,
    );
    return {
      request: row.request,
      grant: row.grant,
      ...rendered,
      sources: project.sources,
    };
  }
  async fail(projectId: string, runId: string, id: string, raw: unknown) {
    if (id.startsWith("export:"))
      return failLocalAgentExport(this.store, projectId, runId, id, raw);
    const failure = z
      .object({
        code: z.string().min(1).max(64),
        message: z.string().min(1).max(500),
      })
      .strict()
      .parse(raw);
    return this.store.transaction(projectId, (project) => {
      enabled(project, runId);
      const row = owned(project, runId, id);
      if (row.kind === "source-inspection")
        browserInspectionFailureSchema.parse(failure);
      if (!row.receipt && row.status !== "cancelled") {
        row.status = "failed";
        row.error = failure;
      }
      hints(project, runId);
      return { record: summary(row) };
    });
  }
  async retry(projectId: string, runId: string, id: string, raw: unknown) {
    if (id.startsWith("export:"))
      return retryLocalAgentExport(this.store, projectId, runId, id, raw);
    retryInput.parse(raw);
    return this.store.transaction(projectId, (project) => {
      const run = enabled(project, runId),
        row = owned(project, runId, id);
      current(project, run, row);
      if (row.status === "cancelled")
        throw new HttpError("A cancelled request cannot restart.", 409);
      if (!row.receipt) {
        row.status = row.grant ? "waiting_browser" : "waiting_consent";
        row.error = null;
      }
      hints(project, runId);
      return { record: summary(row) };
    });
  }
  async cancel(projectId: string, runId: string) {
    await this.store.transaction(projectId, (project) => {
      for (const row of Object.values(entries(project, runId)))
        if (!row.receipt) row.status = "cancelled";
      hints(project, runId);
    });
    await cancelLocalAgentExports(this.store, projectId, runId);
  }
  async previewEvidence(projectId: string, runId: string, id: string) {
    const project = await this.store.read(projectId),
      row = owned(project, runId, id);
    if (row.kind !== "project-preview" || !row.receipt)
      throw new HttpError(
        "The exact candidate preview has no saved receipt.",
        409,
      );
    return previewRepairEvidence({
      request: row.request,
      grant: row.grant,
      receipt: row.receipt,
    });
  }
  async modelFrames(
    projectId: string,
    runId: string,
    ref: EditorVisualInputRef,
    signal: AbortSignal,
  ) {
    signal.throwIfAborted();
    const project = await this.store.read(projectId),
      run = enabled(project, runId),
      row = owned(project, runId, ref.requestRef.id);
    current(project, run, row);
    if (
      !row.receipt ||
      completionCanonical(visual(row)) !== completionCanonical(ref)
    )
      throw new HttpError("The saved visual reference changed.", 409);
    const receipt = validate(row, row.receipt);
    return receipt.frames.map((frame) => ({
      dataUrl: frame.dataUrl,
      sha256: frame.sha256,
      byteLength: frame.byteLength,
      label:
        row.kind === "source-inspection"
          ? {
              source: (row.request as BrowserInspectionRequest).source,
              requestedMs: (frame as BrowserInspectionReceipt["frames"][number])
                .requestedMs,
              actualMs: (frame as BrowserInspectionReceipt["frames"][number])
                .actualMs,
            }
          : {
              renderHash: (row.request as ProjectPreviewRequest).renderHash,
              frame: (frame as ProjectPreviewReceipt["frames"][number]).frame,
            },
    }));
  }
  /** A fulfilled exact wait resumes through the existing guarded agent entry. */
  async resumeReady(
    resume: (
      projectId: string,
      runId: string,
      revision: number,
      hash: string,
    ) => Promise<unknown>,
    projectId?: string,
    runId?: string,
  ) {
    const projects = projectId
      ? [await this.store.read(projectId)]
      : await Promise.all(
          (await this.store.list()).map((value) => this.store.read(value.id)),
        );
    for (const project of projects)
      for (const run of project.runs) {
        if (
          (runId && run.id !== runId) ||
          !run.browserToolsEnabled ||
          run.status !== "needs_evidence" ||
          run.phase !== "waiting_for_host"
        )
          continue;
        const saved = project.editStagePlans?.[run.id],
          active = saved?.plan.stages.find((stage) =>
            ["running", "waiting"].includes(stage.status),
          );
        const raw = active?.attemptId
          ? saved!.checkpoints[active.attemptId]
          : run.loopCheckpoint?.checkpoint;
        if (!raw) continue;
        const wait = parseLoopCheckpoint(raw).hostWait?.requestRef;
        const row = wait ? entries(project, run.id)[wait.id] : undefined;
        if (
          (row?.receipt || row?.status === "failed") &&
          completionCanonical(requestRef(row)) === completionCanonical(wait)
        )
          await resume(
            project.id,
            run.id,
            project.revision,
            project.documentHash,
          );
      }
  }
}
