import type {
  ExportVerificationExpectation,
  ExportVerificationResult,
} from "@dojo-video-engine/export";
import { browserHostValueHash } from "./browser-host-requests";
import { abortableLocalRead } from "./local-file-hash-utils";
import { fingerprintLocalFile } from "./local-file-fingerprint";
import {
  assertProjectPreviewGrant,
  parseOutputJpeg,
  projectPreviewRequestSchema,
  projectExportRequestSchema,
  validateProjectPreviewReceipt,
  validateProjectExportReceipt,
  OutputHostError,
  type ProjectPreviewRequest,
  type ProjectPreviewReceipt,
  type ProjectExportRequest,
  type ProjectExportReceipt,
} from "./browser-output-requests";

export type OutputBrowserState = {
  revision: number;
  documentHash: string;
  pendingCommands: number;
  interactionDrafts: number;
  renderHash: string | null;
};
export function assertOutputBrowserState(
  expected: { revision: number; documentHash: string },
  actual: OutputBrowserState,
) {
  if (
    actual.revision !== expected.revision ||
    actual.documentHash !== expected.documentHash ||
    actual.pendingCommands !== 0 ||
    actual.interactionDrafts !== 0
  )
    throw new OutputHostError(
      "STALE_OUTPUT",
      "Save the exact requested revision and finish active edits before rendering this output.",
    );
}
export type ProjectPreviewHostPorts = {
  getState: () => OutputBrowserState;
  capture: (
    frame: number,
    request: ProjectPreviewRequest,
    signal?: AbortSignal,
  ) => Promise<{ frame: number; imageDataUrl: string; renderHash: string }>;
  loadSaved: () => Promise<ProjectPreviewReceipt | null>;
  persist: (receipt: ProjectPreviewReceipt) => Promise<unknown>;
  /** Only an owned offscreen capture lease; never the main editor. */
  disposeCapture?: () => Promise<void>;
};
/** No pixel capture/read/transfer until the exact visual scope is approved. */
async function fulfillProjectPreviewBound(
  request: ProjectPreviewRequest,
  grant: unknown,
  ports: ProjectPreviewHostPorts,
  signal?: AbortSignal,
) {
  projectPreviewRequestSchema.parse(request);
  const authorization = assertProjectPreviewGrant(request, grant);
  const current = (renderer = false) => {
    signal?.throwIfAborted();
    const state = ports.getState();
    assertOutputBrowserState(request.snapshot, state);
    if (renderer && state.renderHash !== request.renderHash)
      throw new OutputHostError(
        "STALE_OUTPUT",
        "Wait for the exact requested output preview to be prepared.",
      );
  };
  current();
  const saved = await abortableLocalRead(ports.loadSaved(), signal);
  current();
  if (saved)
    return {
      receipt: validateProjectPreviewReceipt(request, authorization, saved),
      reused: true,
    };
  const frames: ProjectPreviewReceipt["frames"] = [];
  for (const frame of request.frames) {
    current(true);
    const captured = await abortableLocalRead(
      ports.capture(frame, request, signal),
      signal,
    );
    current(true);
    if (captured.renderHash !== request.renderHash || captured.frame !== frame)
      throw new OutputHostError(
        "STALE_OUTPUT",
        "The renderer returned another preview revision or frame.",
      );
    const image = parseOutputJpeg(captured.imageDataUrl);
    frames.push({
      ...image,
      frame,
      sceneTimestampUs: Math.round((frame * 1e6) / request.format.fps),
      mimeType: "image/jpeg",
      dataUrl: captured.imageDataUrl,
    });
  }
  const receipt = validateProjectPreviewReceipt(request, authorization, {
    version: 1,
    kind: "project-preview",
    requestId: request.id,
    requestHash: browserHostValueHash(request),
    scopeHash: request.scopeHash,
    authorizationId: authorization.id,
    snapshot: request.snapshot,
    renderHash: request.renderHash,
    engineVersion: "1.2.3",
    frames,
    coverage: "requested-frames-only",
    semanticCoverage: "unknown",
    audio: "not-inspected",
  });
  current();
  try {
    await ports.persist(receipt);
  } catch (error) {
    const recovered = await ports.loadSaved().catch(() => null);
    if (recovered) {
      current();
      return {
        receipt: validateProjectPreviewReceipt(
          request,
          authorization,
          recovered,
        ),
        reused: true,
      };
    }
    throw Object.assign(
      error instanceof Error
        ? error
        : new Error("Preview submission needs reconciliation."),
      { reconciliationRequired: true },
    );
  }
  return { receipt, reused: false };
}
export type BrowserExportResult = {
  revision: number;
  documentHash: string;
  exportId: string;
  blob: Blob;
  width: number;
  height: number;
  fps: number;
  durationInFrames: number;
  download?: ProjectExportReceipt["download"];
};
export type ProjectExportHostPorts = {
  getState: () => OutputBrowserState;
  onExport: (
    request: ProjectExportRequest,
    signal?: AbortSignal,
  ) => Promise<BrowserExportResult | undefined>;
  loadSaved: () => Promise<{
    receipt: ProjectExportReceipt;
    blob: Blob | null;
    /** false means only a local pending manifest exists; HTTP may need exact resubmission. */
    persisted?: boolean;
  } | null>;
  persist: (receipt: ProjectExportReceipt) => Promise<unknown>;
  verify?: (
    blob: Blob,
    expectation: ExportVerificationExpectation,
    signal?: AbortSignal,
  ) => Promise<ExportVerificationResult>;
};
async function verifyMp4Output(
  blob: Blob,
  expectation: ExportVerificationExpectation,
  signal?: AbortSignal,
): Promise<ExportVerificationResult> {
  signal?.throwIfAborted();
  const [
    { Input, BlobSource, MP4 },
    { disposeMediaInputSafely },
    { verifyExportBlob },
  ] = await Promise.all([
    import("mediabunny"),
    import("@dojo-video-engine/renderer-canvas2d"),
    import("@dojo-video-engine/export"),
  ]);
  const input = new Input({ formats: [MP4], source: new BlobSource(blob) }),
    close = () => disposeMediaInputSafely(input);
  signal?.addEventListener("abort", close, { once: true });
  try {
    if ((await abortableLocalRead(input.getFormat(), signal)) !== MP4)
      throw new OutputHostError(
        "INVALID_OUTPUT",
        "The file bytes are not an MP4 container.",
      );
  } catch (error) {
    signal?.throwIfAborted();
    if (error instanceof OutputHostError) throw error;
    throw new OutputHostError(
      "INVALID_OUTPUT",
      "The file bytes are not a readable MP4 container.",
    );
  } finally {
    signal?.removeEventListener("abort", close);
    close();
  }
  return verifyExportBlob(blob, expectation, "sampled", signal);
}
/** Retained export verification never invokes export/provider work again. A
 * missing local Blob needs relinking; a metadata receipt cannot recreate bytes. */
async function fulfillProjectExportBound(
  request: ProjectExportRequest,
  ports: ProjectExportHostPorts,
  signal?: AbortSignal,
) {
  projectExportRequestSchema.parse(request);
  const current = () => {
    signal?.throwIfAborted();
    assertOutputBrowserState(request.snapshot, ports.getState());
  };
  current();
  const expectation: ExportVerificationExpectation = {
    width: request.format.width,
    height: request.format.height,
    fps: request.format.fps,
    durationSeconds: request.format.durationInFrames / request.format.fps,
    hasAudio: request.format.hasAudio,
    requireAudibleAudio: request.format.requireAudibleAudio,
  };
  const verify = ports.verify ?? verifyMp4Output;
  const saved = await abortableLocalRead(ports.loadSaved(), signal);
  current();
  if (saved) {
    const receipt = validateProjectExportReceipt(request, saved.receipt);
    if (!saved.blob)
      throw new OutputHostError(
        "MISSING_SAVED_EXPORT",
        "Relink the verified local export or reopen its owned publication before verifying it again.",
      );
    await reverifySavedProjectExportFile(
      request,
      receipt,
      saved.blob,
      signal,
      ports.verify,
    );
    current();
    if (saved.persisted === false) {
      try {
        await ports.persist(receipt);
      } catch (error) {
        const known = await ports.loadSaved().catch(() => null);
        if (!known || known.persisted === false)
          throw Object.assign(
            error instanceof Error
              ? error
              : new Error("Export receipt submission needs reconciliation."),
            { reconciliationRequired: true },
          );
        const authoritative = validateProjectExportReceipt(
          request,
          known.receipt,
        );
        if (authoritative.file.sha256 !== receipt.file.sha256)
          throw new OutputHostError(
            "INVALID_OUTPUT",
            "The server owns a different verified export file.",
          );
      }
    }
    return { receipt, blob: saved.blob, reused: true };
  }
  const output = await abortableLocalRead(
    ports.onExport(request, signal),
    signal,
  );
  current();
  if (!output)
    throw new OutputHostError(
      "UNSUPPORTED",
      "The browser export is unavailable or already busy.",
    );
  if (
    output.revision !== request.snapshot.revision ||
    output.documentHash !== request.snapshot.documentHash ||
    output.width !== request.format.width ||
    output.height !== request.format.height ||
    output.fps !== request.format.fps ||
    output.durationInFrames !== request.format.durationInFrames
  )
    throw new OutputHostError(
      "STALE_OUTPUT",
      "The export callback returned another revision or output specification.",
    );
  if (
    output.blob.type !== "video/mp4" ||
    !output.blob.size ||
    output.blob.size > request.maxBytes
  )
    throw new OutputHostError(
      "OUTPUT_BYTES",
      "The export exceeds the requested MP4 byte allowance.",
    );
  const verified = await verify(output.blob, expectation, signal);
  current();
  if (
    verified.status !== "verified" ||
    !["sampled", "full"].includes(verified.mode)
  )
    throw new OutputHostError(
      "INVALID_OUTPUT",
      "The export needs successful bounded media decode verification.",
    );
  const receipt = validateProjectExportReceipt(request, {
    version: 1,
    kind: "project-export",
    requestId: request.id,
    requestHash: browserHostValueHash(request),
    snapshot: request.snapshot,
    exportId: output.exportId,
    file: {
      ...request.format,
      mimeType: "video/mp4",
      byteLength: output.blob.size,
      sha256: await fingerprintLocalFile(output.blob, { signal }),
    },
    verification: {
      mode: verified.mode,
      status: verified.status,
      checks: verified.checks.map(({ id, status }) => ({ id, status })),
    },
    download: output.download ?? { state: "not-started", method: "none" },
    publication: "not-published",
    semanticCoverage: "unknown",
  });
  current();
  try {
    await ports.persist(receipt);
  } catch (error) {
    const recovered = await ports.loadSaved().catch(() => null);
    if (recovered && recovered.persisted !== false) {
      current();
      const prior = validateProjectExportReceipt(request, recovered.receipt);
      if (prior.file.sha256 !== receipt.file.sha256)
        throw new OutputHostError(
          "INVALID_OUTPUT",
          "Another verified file already fulfills this export. Reopen the saved file before continuing.",
        );
      return { receipt: prior, blob: output.blob, reused: true };
    }
    throw Object.assign(
      error instanceof Error
        ? error
        : new Error("Export submission needs reconciliation."),
      { reconciliationRequired: true },
    );
  }
  return { receipt, blob: output.blob, reused: false };
}

async function outputDeadline<T>(
  maximumMs: number,
  parent: AbortSignal | undefined,
  run: (signal: AbortSignal) => Promise<T>,
): Promise<T> {
  const controller = new AbortController(),
    abort = () =>
      controller.abort(
        parent?.reason ??
          new DOMException("Output request cancelled.", "AbortError"),
      );
  parent?.addEventListener("abort", abort, { once: true });
  if (parent?.aborted) abort();
  const timer = setTimeout(
    () =>
      controller.abort(
        new DOMException("Browser output deadline reached.", "TimeoutError"),
      ),
    maximumMs,
  );
  try {
    return await abortableLocalRead(run(controller.signal), controller.signal);
  } finally {
    clearTimeout(timer);
    parent?.removeEventListener("abort", abort);
  }
}
export async function fulfillProjectPreview(
  request: ProjectPreviewRequest,
  grant: unknown,
  ports: ProjectPreviewHostPorts,
  signal?: AbortSignal,
) {
  const normalized = projectPreviewRequestSchema.parse(request);
  try {
    return await outputDeadline(normalized.limits.timeoutMs, signal, (child) =>
      fulfillProjectPreviewBound(normalized, grant, ports, child),
    );
  } finally {
    await ports.disposeCapture?.();
  }
}
export async function fulfillProjectExport(
  request: ProjectExportRequest,
  ports: ProjectExportHostPorts,
  signal?: AbortSignal,
) {
  const normalized = projectExportRequestSchema.parse(request);
  return outputDeadline(normalized.maxRuntimeMs, signal, (child) =>
    fulfillProjectExportBound(normalized, ports, child),
  );
}

/** Previously produced files remain pinned to their original receipt even after
 * unrelated later authoring. This never reads current state or invokes encoding. */
export async function reverifySavedProjectExportFile(
  request: ProjectExportRequest,
  raw: ProjectExportReceipt,
  blob: Blob,
  signal?: AbortSignal,
  verify?: ProjectExportHostPorts["verify"],
) {
  const normalized = projectExportRequestSchema.parse(request),
    receipt = validateProjectExportReceipt(normalized, raw);
  return outputDeadline(normalized.maxRuntimeMs, signal, async (child) => {
    if (
      blob.size !== receipt.file.byteLength ||
      (await fingerprintLocalFile(blob, { signal: child })) !==
        receipt.file.sha256
    )
      throw new OutputHostError(
        "INVALID_OUTPUT",
        "The saved export file changed.",
      );
    const expectation: ExportVerificationExpectation = {
      width: normalized.format.width,
      height: normalized.format.height,
      fps: normalized.format.fps,
      durationSeconds:
        normalized.format.durationInFrames / normalized.format.fps,
      hasAudio: normalized.format.hasAudio,
      requireAudibleAudio: normalized.format.requireAudibleAudio,
    };
    const inspect = verify ?? verifyMp4Output;
    const result = await inspect(blob, expectation, child);
    child.throwIfAborted();
    if (
      result.status !== "verified" ||
      !["sampled", "full"].includes(result.mode)
    )
      throw new OutputHostError(
        "INVALID_OUTPUT",
        "The saved export no longer passes bounded decode verification.",
      );
    validateProjectExportReceipt(normalized, {
      ...receipt,
      verification: {
        mode: result.mode,
        status: result.status,
        checks: result.checks.map(({ id, status }) => ({ id, status })),
      },
    });
    return { receipt, blob };
  });
}
