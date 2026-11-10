import type { VideoProjectDocument } from "./document";
import type { BrowserSourceInspection } from "./source-inspection-browser";
import { abortableLocalRead } from "./local-file-hash-utils";
import {
  assertBrowserInspectionGrant,
  browserHostValueHash,
  browserInspectionRequestSchema,
  validateBrowserInspectionReceipt,
  type BrowserInspectionGrant,
  type BrowserInspectionReceipt,
  type BrowserInspectionRequest,
  type BrowserInspectionFailureCode,
} from "./browser-host-requests";

export type BrowserInspectionRecord = {
  request: BrowserInspectionRequest;
  status:
    | "waiting_consent"
    | "waiting_browser"
    | "fulfilled"
    | "failed"
    | "cancelled";
  grant: BrowserInspectionGrant | null;
  hasReceipt: boolean;
  error: { code: string; message: string } | null;
};
export const MODEL_INSPECTION_DEFAULT_LIMITS = Object.freeze({
  maxFrames: 4,
  maxDimension: 768,
  maxFramePixels: 768 * 768,
  maxTotalPixels: 4 * 768 * 768,
  maxOutputBytes: 512 * 1024,
  timeoutMs: 15000,
});
export function browserInspectionFailureCode(error: {
  code?: string;
  name?: string;
}): BrowserInspectionFailureCode {
  if (error.code === "MISSING_LOCAL_SOURCE" || error.code === "SOURCE_MISSING")
    return "SOURCE_MISSING";
  if (error.code === "SOURCE_CHANGED") return "SOURCE_CHANGED";
  if (error.code === "UNSUPPORTED" || error.code === "HDR_UNSUPPORTED")
    return "UNSUPPORTED";
  if (error.code === "LIMIT") return "BUDGET_EXHAUSTED";
  // Canceling a local capture interrupts this attempt; the existing exact grant
  // remains reusable. Terminal run/request cancellation is a different action.
  return "DECODE_FAILED";
}

/** Unrelated manual edits are allowed; source deletion/relink/replacement is not. */
export function browserInspectionSourceIsCurrent(
  request: BrowserInspectionRequest,
  document: VideoProjectDocument,
) {
  const source = document.sources[request.source.sourceId],
    asset = document.assets[request.source.sourceId];
  return (
    !!source &&
    !!asset &&
    source.revision === request.source.sourceRevision &&
    source.contentHash === request.source.contentHash &&
    asset.type === request.source.type &&
    (asset.byteLength === undefined ||
      asset.byteLength === request.source.byteLength)
  );
}
function dataUrl(blob: Blob, signal?: AbortSignal): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader(),
      cleanup = () => signal?.removeEventListener("abort", abort);
    const abort = () => {
      reader.abort();
      cleanup();
      reject(
        signal?.reason ??
          new DOMException("Inspection cancelled.", "AbortError"),
      );
    };
    reader.onload = () => {
      cleanup();
      typeof reader.result === "string"
        ? resolve(reader.result)
        : reject(new Error("Could not encode the inspected frame."));
    };
    reader.onerror = () => {
      cleanup();
      reject(reader.error);
    };
    signal?.addEventListener("abort", abort, { once: true });
    if (signal?.aborted) {
      abort();
      return;
    }
    reader.readAsDataURL(blob);
  });
}
export type BrowserInspectionFulfillmentPorts = {
  getSource: () => Promise<Blob | null>;
  isCurrentSource: () => boolean | Promise<boolean>;
  loadSavedReceipt: () => Promise<BrowserInspectionReceipt | null>;
  submitReceipt: (receipt: BrowserInspectionReceipt) => Promise<unknown>;
  sample?: typeof import("./source-inspection-browser").sampleOriginalSource;
  encode?: (blob: Blob, signal?: AbortSignal) => Promise<string>;
};
/** One explicit approved attempt. A lost acknowledgment only triggers a saved-result read. */
export async function fulfillBrowserInspection(
  raw: BrowserInspectionRequest,
  rawGrant: BrowserInspectionGrant,
  ports: BrowserInspectionFulfillmentPorts,
  signal?: AbortSignal,
) {
  const request = browserInspectionRequestSchema.parse(raw),
    grant = assertBrowserInspectionGrant(request, rawGrant);
  const current = async () => {
    signal?.throwIfAborted();
    if (!(await ports.isCurrentSource()))
      throw new Error(
        "The selected source changed. Request inspection of the current source.",
      );
    signal?.throwIfAborted();
  };
  await current();
  const saved = await abortableLocalRead(ports.loadSavedReceipt(), signal);
  if (saved) {
    await current();
    return {
      receipt: validateBrowserInspectionReceipt(request, grant, saved),
      reused: true,
    };
  }
  const source = await abortableLocalRead(ports.getSource(), signal);
  await current();
  if (!source)
    throw Object.assign(
      new Error("Relink the original local file to fulfill this inspection."),
      { code: "MISSING_LOCAL_SOURCE" },
    );
  const sampler =
    ports.sample ??
    (await import("./source-inspection-browser")).sampleOriginalSource;
  const sampled: BrowserSourceInspection = await sampler(
    source,
    {
      source: request.source,
      momentsMs: request.momentsMs,
      limits: request.limits,
    },
    { signal },
  );
  await current();
  const frames = await Promise.all(
    sampled.frames.map(async (frame) => ({
      ...frame.metadata,
      dataUrl: await (ports.encode ?? dataUrl)(frame.blob, signal),
    })),
  );
  const receipt = validateBrowserInspectionReceipt(request, grant, {
    version: 1,
    requestId: request.id,
    requestHash: browserHostValueHash(request),
    scopeHash: request.scopeHash,
    authorizationId: grant.id,
    provenance: sampled.provenance,
    frames,
  });
  await current();
  try {
    await ports.submitReceipt(receipt);
  } catch (error) {
    // Never resample or resubmit after an unknown accepted outcome.
    const recovered = await ports.loadSavedReceipt().catch(() => null);
    if (recovered)
      return {
        receipt: validateBrowserInspectionReceipt(request, grant, recovered),
        reused: true,
      };
    const status =
      error && typeof error === "object" && "status" in error
        ? Number(error.status)
        : null;
    if (status !== null && status >= 400 && status < 500 && status !== 408)
      throw error;
    throw Object.assign(
      error instanceof Error
        ? error
        : new Error("Inspection submission needs reconciliation."),
      { reconciliationRequired: true },
    );
  }
  return { receipt, reused: false };
}

export function browserInspectionApi(
  projectId: string,
  runId: string,
  fetcher: typeof fetch = fetch,
) {
  const base = `/api/projects/${encodeURIComponent(projectId)}/agent-runs/${encodeURIComponent(runId)}/host-requests`;
  const call = async <T,>(path: string, body?: unknown): Promise<T> => {
    const response = await fetcher(
      base + path,
      body === undefined
        ? undefined
        : {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(body),
          },
    );
    const value: unknown = await response.json();
    if (
      !response.ok ||
      !value ||
      typeof value !== "object" ||
      !("success" in value) ||
      !value.success ||
      !("data" in value)
    )
      throw Object.assign(
        new Error(
          value && typeof value === "object" && "message" in value
            ? String(value.message)
            : "Inspection request failed.",
        ),
        {
          status: response.status,
          code:
            value && typeof value === "object" && "error_code" in value
              ? String(value.error_code)
              : undefined,
        },
      );
    return value.data as T;
  };
  const prefix = (id: string) => `/${encodeURIComponent(id)}`;
  return {
    list: () => call<{ requests: BrowserInspectionRecord[] }>(""),
    authorize: (request: BrowserInspectionRequest, operationId: string) =>
      call<{ record: BrowserInspectionRecord; grant: BrowserInspectionGrant }>(
        prefix(request.id) + "/authorize",
        { operationId, scopeHash: request.scopeHash },
      ),
    receipt: async (id: string) => {
      try {
        return (
          await call<{ receipt: BrowserInspectionReceipt }>(
            prefix(id) + "/receipt",
          )
        ).receipt;
      } catch (error) {
        const failure = error as { status?: number; code?: string };
        if (failure.status === 409 && failure.code === "BROWSER_INPUT_PENDING")
          return null;
        throw error;
      }
    },
    fulfill: (id: string, receipt: BrowserInspectionReceipt) =>
      call<{
        record: BrowserInspectionRecord;
        replayed: boolean;
        receiptHash: string;
      }>(prefix(id) + "/fulfill", { receipt }),
    fail: (id: string, code: BrowserInspectionFailureCode, message: string) =>
      call<{ record: BrowserInspectionRecord }>(prefix(id) + "/fail", {
        code,
        message,
      }),
    retry: (id: string, operationId: string) =>
      call<{ record: BrowserInspectionRecord }>(prefix(id) + "/retry", {
        operationId,
      }),
  };
}
