import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { createHash, randomUUID } from "node:crypto";
import path from "node:path";
import { z } from "zod/v3";
import { estimateExport } from "@dojo-video-engine/export";
import { browserHostValueHash } from "../../../packages/core/src/lib/video-project/browser-host-requests";
import { compileVideoProjectDocument } from "../../../packages/core/src/lib/video-project/compilation";
import { editorExportDimensions } from "../../../packages/core/src/lib/editor/export-resolution";
import { hashVideoProjectDocument } from "../../../packages/core/src/lib/video-project/document";
import {
  projectExportIntentSchema,
  bindProjectExportIntent,
  validateProjectExportReceipt,
  OUTPUT_EXPORT_MAX_BYTES,
  type ProjectExportIntent,
  type ProjectExportRequest,
  type ProjectExportReceipt,
} from "../../../packages/core/src/lib/video-project/browser-output-requests";
import {
  ProjectStore,
  runOf,
  HttpError,
  identifier,
  type Project,
} from "./store";

export type LocalAgentExport = {
  kind: "project-export";
  intent: ProjectExportIntent;
  request: ProjectExportRequest | null;
  status:
    | "waiting_application"
    | "waiting_consent"
    | "waiting_browser"
    | "fulfilled"
    | "failed"
    | "cancelled";
  grant: {
    version: 1;
    id: string;
    scopeHash: string;
    mode: "local-export" | "cloud-publication";
    authorizedAt: string;
  } | null;
  receipt?: ProjectExportReceipt;
  error: { code: string; message: string } | null;
};
const operation = z
  .object({ operationId: z.string().min(1).max(191) })
  .strict();
const authorization = operation
  .extend({
    scopeHash: z.string().regex(/^[a-f0-9]{64}$/),
    mode: z.enum(["local-export", "cloud-publication"]),
  })
  .strict();
function rows(
  project: Project,
  runId: string,
): Record<string, LocalAgentExport> {
  return Object.fromEntries(
    Object.entries(project.browserRequests?.[runId] ?? {}).filter(
      (entry): entry is [string, LocalAgentExport] =>
        entry[1].kind === "project-export",
    ),
  );
}
function enabled(project: Project, runId: string) {
  const run = runOf(project, runId);
  if (!run.browserToolsEnabled)
    throw new HttpError(
      "Browser exports are unavailable for this saved run.",
      404,
    );
  return run;
}
function saved(project: Project, runId: string, id: string) {
  enabled(project, runId);
  const all = rows(project, runId);
  const row = Object.hasOwn(all, id) ? all[id] : undefined;
  if (!row || row.intent.runId !== runId || row.intent.projectId !== project.id)
    throw new HttpError("Output request not found.", 404);
  return row;
}
export function localExportSummary(row: LocalAgentExport) {
  const { receipt, ...value } = row;
  return { ...value, hasReceipt: !!receipt };
}
export function updateLocalExportHint(project: Project, runId: string) {
  const output = Object.values(project.browserRequests?.[runId] ?? {}).filter(
    (row) => row.kind === "project-preview",
  );
  const exported = Object.values(rows(project, runId));
  runOf(project, runId).outputRequests = {
    count: output.length + exported.length,
    pending:
      output.filter((row) =>
        ["waiting_consent", "waiting_browser"].includes(row.status),
      ).length +
      exported.filter((row) =>
        ["waiting_application", "waiting_consent", "waiting_browser"].includes(
          row.status,
        ),
      ).length,
    waitingForApplication: exported.filter(
      (row) => row.status === "waiting_application",
    ).length,
  };
}
async function reconcile(project: Project, runId: string) {
  const run = enabled(project, runId);
  for (const row of Object.values(rows(project, runId))) {
    if (run.status === "cancelled" && !row.receipt) {
      row.status = "cancelled";
      continue;
    }
    if (
      row.status !== "waiting_application" ||
      run.status !== "applied" ||
      !run.appliedReceipt ||
      !run.appliedAfter
    )
      continue;
    const application = run.appliedReceipt;
    if (
      (await hashVideoProjectDocument(run.appliedAfter)) !==
      application.documentHash
    )
      throw new HttpError("The applied export basis changed.", 409);
    const document = run.appliedAfter;
    const urls = Object.fromEntries(
      Object.keys(document.assets).map((id) => [
        id,
        `https://owned.invalid/${encodeURIComponent(id)}`,
      ]),
    );
    const format = {
      ...document.format,
      ...editorExportDimensions(document.format, row.intent.output.resolution),
      hasAudio: estimateExport(
        compileVideoProjectDocument(document, urls).scene,
      ).hasAudio,
      requireAudibleAudio: false,
    };
    row.request = bindProjectExportIntent(
      row.intent,
      {
        runId,
        operationId: application.operationId,
        snapshot: {
          revision: application.revision,
          documentHash: application.documentHash,
        },
      },
      {
        width: format.width,
        height: format.height,
        fps: format.fps,
        durationInFrames: format.durationInFrames,
        hasAudio: format.hasAudio,
        requireAudibleAudio: false,
      },
    );
    row.status = "waiting_consent";
  }
  updateLocalExportHint(project, runId);
}
function active(project: Project, runId: string, row: LocalAgentExport) {
  const run = enabled(project, runId);
  if (run.status === "cancelled" || row.status === "cancelled")
    throw new HttpError("This export was cancelled.", 409);
  if (
    !row.request ||
    !run.appliedReceipt ||
    !run.appliedAfter ||
    run.appliedReceipt.operationId !== row.request.applicationOperationId ||
    run.appliedReceipt.documentHash !== row.request.snapshot.documentHash
  )
    throw new HttpError(
      "Apply the final edit before exporting it.",
      409,
      "WAITING_APPLICATION",
    );
}
export async function prepareLocalAgentExport(
  store: ProjectStore,
  projectId: string,
  runId: string,
  input: Record<string, unknown>,
) {
  return store.transaction(projectId, async (project) => {
    const run = enabled(project, runId);
    if (["cancelled", "failed", "completed"].includes(run.status))
      throw new HttpError("This editing run is stopped.", 409);
    const value = {
      version: 1 as const,
      kind: "project-export" as const,
      projectId,
      runId,
      target: "final-application" as const,
      destination: input.destination,
      output: input.output,
      maxBytes: OUTPUT_EXPORT_MAX_BYTES,
      maxRuntimeMs: 180000,
    };
    const id = `export:${browserHostValueHash(value)}`;
    const intent = projectExportIntentSchema.parse({ ...value, id });
    project.browserRequests ??= {};
    project.browserRequests[runId] ??= {};
    let row = rows(project, runId)[id];
    if (!row) {
      if (Object.keys(rows(project, runId)).length >= 4)
        throw new HttpError(
          "Choose at most four output destinations per run.",
          409,
        );
      row = {
        kind: "project-export",
        intent,
        request: null,
        status: "waiting_application",
        grant: null,
        error: null,
      };
      project.browserRequests[runId]![id] = row;
    }
    await reconcile(project, runId);
    return {
      kind: "observation" as const,
      value: {
        projectExport: {
          requestRef: {
            kind: "project-export",
            id,
            hash: "sha256:" + browserHostValueHash(intent),
          },
          status: row.status,
          hasReceipt: !!row.receipt,
          applicationRequired: row.status === "waiting_application",
        },
      },
    };
  });
}
export async function listLocalAgentExports(
  store: ProjectStore,
  projectId: string,
  runId: string,
) {
  return store.transaction(projectId, async (project) => {
    await reconcile(project, runId);
    return Object.values(rows(project, runId)).map(localExportSummary);
  });
}
export async function authorizeLocalAgentExport(
  store: ProjectStore,
  projectId: string,
  runId: string,
  id: string,
  raw: unknown,
) {
  const input = authorization.parse(raw);
  return store.transaction(projectId, async (project) => {
    await reconcile(project, runId);
    const row = saved(project, runId, id);
    active(project, runId, row);
    const request = row.request!;
    if (
      input.scopeHash !== browserHostValueHash(request) ||
      input.mode !==
        (request.destination === "project"
          ? "cloud-publication"
          : "local-export")
    )
      throw new HttpError(
        "Approve this exact applied revision and output destination.",
        409,
      );
    row.grant ??= {
      version: 1,
      id: `grant:${randomUUID()}`,
      scopeHash: input.scopeHash,
      mode: input.mode,
      authorizedAt: new Date().toISOString(),
    };
    if (!row.receipt) row.status = "waiting_browser";
    updateLocalExportHint(project, runId);
    return { record: localExportSummary(row), grant: row.grant };
  });
}
export async function fulfillLocalAgentExport(
  store: ProjectStore,
  projectId: string,
  runId: string,
  id: string,
  raw: unknown,
) {
  return store.transaction(projectId, async (project) => {
    const row = saved(project, runId, id);
    active(project, runId, row);
    if (
      !row.grant ||
      row.grant.scopeHash !== browserHostValueHash(row.request!)
    )
      throw new HttpError("Approve this exact export before encoding.", 403);
    const receipt = validateProjectExportReceipt(row.request!, raw);
    identifier.parse(receipt.exportId);
    if (
      row.receipt &&
      browserHostValueHash(row.receipt) !== browserHostValueHash(receipt)
    )
      throw new HttpError("A verified export receipt cannot be replaced.", 409);
    const replayed = !!row.receipt;
    row.receipt = receipt;
    row.status = "fulfilled";
    row.error = null;
    updateLocalExportHint(project, runId);
    return {
      record: localExportSummary(row),
      replayed,
      receiptHash: browserHostValueHash(receipt),
    };
  });
}
export async function readLocalAgentExport(
  store: ProjectStore,
  projectId: string,
  runId: string,
  id: string,
) {
  const project = await store.read(projectId),
    row = saved(project, runId, id);
  if (!row.receipt || !row.request || !row.grant)
    throw new HttpError(
      "This export has no verified file receipt yet.",
      409,
      "BROWSER_INPUT_PENDING",
    );
  const receipt = validateProjectExportReceipt(row.request, row.receipt),
    exported = project.exports?.[receipt.exportId];
  if (exported?.status !== "completed") return { receipt };
  const expected = receipt.file;
  const same =
    exported.documentHash === row.request.snapshot.documentHash &&
    exported.profile.documentRevision === row.request.snapshot.revision &&
    exported.profile.width === expected.width &&
    exported.profile.height === expected.height &&
    exported.profile.fps === expected.fps &&
    exported.profile.durationInFrames === expected.durationInFrames &&
    exported.contentHash === expected.sha256 &&
    exported.byteLength === expected.byteLength;
  try {
    if (!same)
      throw Error("Stored output metadata differs from its verified file");
    const file = path.join(
      store.directory,
      "media",
      identifier.parse(projectId),
      identifier.parse(receipt.exportId) + ".mp4",
    );
    if ((await stat(file)).size !== expected.byteLength)
      throw Error("Stored output size changed");
    const digest = createHash("sha256");
    for await (const bytes of createReadStream(file)) digest.update(bytes);
    if (digest.digest("hex") !== expected.sha256)
      throw Error("Stored output bytes changed");
    return {
      receipt,
      publication: {
        state: "published" as const,
        outputId: receipt.exportId,
        assetId: `local-export:${receipt.exportId}`,
      },
    };
  } catch {
    return {
      receipt,
      publicationError: {
        code: "PUBLICATION_UNVERIFIED",
        message:
          "The saved local copy needs verification. The verified browser file remains available.",
      },
    };
  }
}
export async function failLocalAgentExport(
  store: ProjectStore,
  projectId: string,
  runId: string,
  id: string,
  raw: unknown,
) {
  const failure = z
    .object({
      code: z.string().min(1).max(64),
      message: z.string().min(1).max(500),
    })
    .strict()
    .parse(raw);
  return store.transaction(projectId, (project) => {
    const row = saved(project, runId, id);
    active(project, runId, row);
    if (!row.receipt) {
      row.status = "failed";
      row.error = failure;
    }
    updateLocalExportHint(project, runId);
    return { record: localExportSummary(row) };
  });
}
export async function retryLocalAgentExport(
  store: ProjectStore,
  projectId: string,
  runId: string,
  id: string,
  raw: unknown,
) {
  operation.parse(raw);
  return store.transaction(projectId, (project) => {
    const row = saved(project, runId, id);
    active(project, runId, row);
    if (!row.receipt) {
      row.status = row.grant ? "waiting_browser" : "waiting_consent";
      row.error = null;
    }
    updateLocalExportHint(project, runId);
    return { record: localExportSummary(row) };
  });
}
export async function cancelLocalAgentExports(
  store: ProjectStore,
  projectId: string,
  runId: string,
) {
  return store.transaction(projectId, (project) => {
    for (const row of Object.values(rows(project, runId)))
      if (!row.receipt) row.status = "cancelled";
    updateLocalExportHint(project, runId);
  });
}
