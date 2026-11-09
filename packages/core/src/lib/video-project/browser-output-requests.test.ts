import { afterEach, describe, expect, it, vi } from "vitest";
import type { ExportVerificationResult } from "@dojo-video-engine/export";
import { completionHash, completionCanonical } from "@dojo-video/agent-kit";
import { browserHostValueHash } from "./browser-host-requests";
import {
  createProjectPreviewRequest,
  OUTPUT_PREVIEW_LIMITS,
  projectExportIntentSchema,
  bindProjectExportIntent,
  assertProjectExportPublication,
  preparedOutputCandidateRefSchema,
  type ProjectExportReceipt,
  type ProjectPreviewReceipt,
} from "./browser-output-requests";
import {
  fulfillProjectPreview,
  fulfillProjectExport,
  reverifySavedProjectExportFile,
  type OutputBrowserState,
  type ProjectExportHostPorts,
  type BrowserExportResult,
} from "./browser-output-host";

const format = {
    width: 320,
    height: 180,
    fps: 30,
    durationInFrames: 60,
    hasAudio: true,
    requireAudibleAudio: false,
  },
  snapshot = { revision: 3, documentHash: "sha256:current" };
const jpeg = new Uint8Array([
    255, 216, 255, 192, 0, 17, 8, 0, 180, 1, 64, 3, 1, 17, 0, 2, 17, 0, 3, 17,
    0, 255, 217,
  ]),
  imageDataUrl = `data:image/jpeg;base64,${btoa(String.fromCharCode(...jpeg))}`;
const state = (): OutputBrowserState => ({
  ...snapshot,
  pendingCommands: 0,
  interactionDrafts: 0,
  renderHash: snapshot.documentHash,
});
function preview() {
  const request = createProjectPreviewRequest(
    {
      version: 1,
      kind: "project-preview",
      projectId: "project",
      runId: "run",
      snapshot,
      renderHash: snapshot.documentHash,
      format,
      frames: [0, 30],
      limits: OUTPUT_PREVIEW_LIMITS,
    },
    "preview",
  );
  const grant = {
    version: 1,
    id: "grant",
    scopeHash: request.scopeHash,
    mode: "cloud-visual-analysis",
    authorizedAt: "2026-11-10T00:00:00.000Z",
  };
  let current = state();
  const ports = {
    getState: () => current,
    capture: vi.fn(async (frame: number) => ({
      frame,
      imageDataUrl,
      renderHash: request.renderHash,
    })),
    loadSaved: vi.fn(
      async () =>
        null as
          | Awaited<ReturnType<typeof fulfillProjectPreview>>["receipt"]
          | null,
    ),
    persist: vi.fn(async (_receipt: ProjectPreviewReceipt) => ({})),
  };
  return {
    request,
    grant,
    ports,
    get current() {
      return current;
    },
    set current(value: OutputBrowserState) {
      current = value;
    },
  };
}
const required = [
  "container_readable",
  "video_track_present",
  "video_dimensions_match",
  "video_duration_match",
  "video_frames_decoded",
  "resources_disposed",
  "audio_track_presence_match",
  "audio_video_sync",
  "audio_samples_decoded",
] as const;
const verification = (): ExportVerificationResult => ({
  mode: "sampled",
  status: "verified",
  expectation: {
    width: 320,
    height: 180,
    fps: 30,
    durationSeconds: 2,
    hasAudio: true,
  },
  requestMetadata: { source: "blob", byteLength: 10, mimeType: "video/mp4" },
  checks: required.map((id) => ({ id, status: "passed", message: id })),
  issues: [],
});
function exported() {
  const intent = projectExportIntentSchema.parse({
    version: 1,
    kind: "project-export",
    id: "export",
    projectId: "project",
    runId: "run",
    target: "final-application",
    destination: "download",
    output: { container: "mp4", resolution: "source" },
    maxBytes: 1000000,
  });
  const request = bindProjectExportIntent(
    intent,
    { runId: "run", operationId: "applied-operation", snapshot },
    format,
  );
  let current = state();
  const blob = new Blob(["verified fixture output"], { type: "video/mp4" });
  const ports: ProjectExportHostPorts = {
    getState: () => current,
    onExport: vi.fn(async () => ({
      ...snapshot,
      exportId: "browser-export",
      blob,
      ...format,
      download: {
        state: "started" as const,
        method: "browser-download" as const,
      },
    })),
    loadSaved: vi.fn(async () => null),
    persist: vi.fn(async () => ({})),
    verify: vi.fn(async () => verification()),
  };
  return {
    intent,
    request,
    blob,
    ports,
    get current() {
      return current;
    },
    set current(value: OutputBrowserState) {
      current = value;
    },
  };
}
afterEach(() => vi.useRealTimers());
describe("revision-bound browser output requests", () => {
  it("accepts genuine shared artifact hashes with fractional canonical payloads", async () => {
    const payload = {
      kind: "editing-review",
      edit: {
        summary: "Fractional geometry",
        outcome: "proposal",
        commands: [
          {
            type: "set",
            target: { kind: "node", itemId: "title", nodeId: "title" },
            path: ["style", "left"],
            value: 1 / 3,
          },
        ],
      },
    };
    const ref = preparedOutputCandidateRefSchema.parse({
      version: 1,
      id: "owned-ref",
      runId: "run",
      bindingHash: await completionHash({
        runId: "run",
        baseHash: snapshot.documentHash,
      }),
      kind: "verification",
      sha256: await completionHash(payload),
      sizeBytes: new TextEncoder().encode(completionCanonical(payload))
        .byteLength,
    });
    const request = createProjectPreviewRequest(
      {
        version: 1,
        kind: "project-preview",
        projectId: "project",
        runId: "run",
        snapshot,
        renderHash: await completionHash({ after: true }),
        format,
        candidateRef: ref,
        frames: [0],
        limits: OUTPUT_PREVIEW_LIMITS,
      },
      "fractional-preview",
    );
    expect(request.candidateRef).toEqual(ref);
    expect(request.scopeHash).toMatch(/^[a-f0-9]{64}$/);
    expect(ref.sha256).toMatch(/^sha256:[a-f0-9]{64}$/);
    expect(() =>
      preparedOutputCandidateRefSchema.parse({
        ...ref,
        sha256: ref.sha256.slice(7),
      }),
    ).toThrow();
    expect(await completionHash(JSON.parse(completionCanonical(payload)))).toBe(
      ref.sha256,
    );
  });
  it("requires exact visual consent before preview reading/capture", async () => {
    const f = preview();
    await expect(
      fulfillProjectPreview(
        f.request,
        { ...f.grant, scopeHash: "a".repeat(64) },
        f.ports,
      ),
    ).rejects.toMatchObject({ code: "CONSENT_REQUIRED" });
    expect(f.ports.capture).not.toHaveBeenCalled();
    expect(f.ports.loadSaved).not.toHaveBeenCalled();
  });
  it.each(["revision", "hash", "pending", "draft", "renderer"])(
    "rejects %s mismatches before rendering",
    async (kind) => {
      const f = preview();
      if (kind === "revision") f.current = { ...f.current, revision: 4 };
      if (kind === "hash")
        f.current = { ...f.current, documentHash: "another" };
      if (kind === "pending") f.current = { ...f.current, pendingCommands: 1 };
      if (kind === "draft") f.current = { ...f.current, interactionDrafts: 1 };
      if (kind === "renderer")
        f.current = { ...f.current, renderHash: "old-renderer" };
      await expect(
        fulfillProjectPreview(f.request, f.grant, f.ports),
      ).rejects.toMatchObject({ code: "STALE_OUTPUT" });
      expect(f.ports.capture).not.toHaveBeenCalled();
    },
  );
  it("verifies exact timeline frames and remains honest about audio/semantic coverage", async () => {
    const f = preview(),
      result = await fulfillProjectPreview(f.request, f.grant, f.ports);
    expect(
      result.receipt.frames.map((frame) => [
        frame.frame,
        frame.sceneTimestampUs,
      ]),
    ).toEqual([
      [0, 0],
      [30, 1000000],
    ]);
    expect(result.receipt).toMatchObject({
      semanticCoverage: "unknown",
      audio: "not-inspected",
      coverage: "requested-frames-only",
    });
  });
  it("reuses saved approved preview without a renderer or fresh capture", async () => {
    const f = preview(),
      first = await fulfillProjectPreview(f.request, f.grant, f.ports);
    f.ports.loadSaved.mockResolvedValue(first.receipt);
    f.current = { ...f.current, renderHash: null };
    f.ports.capture.mockRejectedValue(new Error("No second capture"));
    expect(
      (await fulfillProjectPreview(f.request, f.grant, f.ports)).reused,
    ).toBe(true);
    expect(f.ports.capture).toHaveBeenCalledTimes(2);
  });
  it("rejects manual edits/cancellation while capturing before persistence", async () => {
    const f = preview();
    f.ports.capture.mockImplementation(async (frame) => {
      f.current = { ...f.current, revision: 4 };
      return { frame, imageDataUrl, renderHash: f.request.renderHash };
    });
    await expect(
      fulfillProjectPreview(f.request, f.grant, f.ports),
    ).rejects.toMatchObject({ code: "STALE_OUTPUT" });
    expect(f.ports.persist).not.toHaveBeenCalled();
    const g = preview(),
      controller = new AbortController();
    g.ports.capture.mockImplementation(async (frame) => {
      controller.abort(new DOMException("Cancelled", "AbortError"));
      return { frame, imageDataUrl, renderHash: g.request.renderHash };
    });
    await expect(
      fulfillProjectPreview(g.request, g.grant, g.ports, controller.signal),
    ).rejects.toMatchObject({ name: "AbortError" });
    expect(g.ports.persist).not.toHaveBeenCalled();
  });
  it.each(["frame", "render hash", "image bytes"])(
    "rejects mismatched returned %s",
    async (field) => {
      const f = preview();
      f.ports.capture.mockImplementation(async (frame) => ({
        frame: field === "frame" ? frame + 1 : frame,
        renderHash: field === "render hash" ? "other" : f.request.renderHash,
        imageDataUrl:
          field === "image bytes" ? "data:image/png;base64,AAAA" : imageDataUrl,
      }));
      await expect(
        fulfillProjectPreview(f.request, f.grant, f.ports),
      ).rejects.toThrow();
      expect(f.ports.persist).not.toHaveBeenCalled();
    },
  );
  it("reconciles a preview lost acknowledgment without re-rendering", async () => {
    const f = preview();
    let saved:
      | Awaited<ReturnType<typeof fulfillProjectPreview>>["receipt"]
      | null = null;
    f.ports.loadSaved.mockImplementation(async () => saved);
    f.ports.persist.mockImplementation(async (receipt) => {
      saved = receipt;
      throw new TypeError("Lost ack");
    });
    expect(
      (await fulfillProjectPreview(f.request, f.grant, f.ports)).reused,
    ).toBe(true);
    expect(f.ports.capture).toHaveBeenCalledTimes(2);
    expect(f.ports.persist).toHaveBeenCalledOnce();
  });
  it("retains export intent until the actual run application and disallows rebinding", () => {
    const f = exported();
    expect(
      bindProjectExportIntent(
        f.intent,
        { runId: "run", operationId: "applied-operation", snapshot },
        format,
        f.request,
      ),
    ).toEqual(f.request);
    expect(() =>
      bindProjectExportIntent(
        f.intent,
        { runId: "another", operationId: "op", snapshot },
        format,
      ),
    ).toThrow();
    expect(() =>
      bindProjectExportIntent(
        f.intent,
        {
          runId: "run",
          operationId: "later-apply",
          snapshot: { ...snapshot, revision: 4 },
        },
        format,
        f.request,
      ),
    ).toThrow();
  });
  it("verifies actual Blob identity but never claims local download was published", async () => {
    const f = exported(),
      result = await fulfillProjectExport(f.request, f.ports);
    expect(result.receipt).toMatchObject({
      download: { state: "started" },
      publication: "not-published",
      semanticCoverage: "unknown",
    });
    expect(result.receipt.file.sha256).toMatch(/^[a-f0-9]{64}$/);
    expect(f.ports.verify).toHaveBeenCalledOnce();
  });
  it("re-verifies a saved export with new export/encoding forbidden", async () => {
    const f = exported(),
      first = await fulfillProjectExport(f.request, f.ports);
    f.ports.loadSaved = vi.fn(async () => ({
      receipt: first.receipt,
      blob: f.blob,
    }));
    f.ports.onExport = vi.fn(async () => {
      throw new Error("No new export");
    });
    expect((await fulfillProjectExport(f.request, f.ports)).reused).toBe(true);
    expect(f.ports.onExport).not.toHaveBeenCalled();
    expect(f.ports.verify).toHaveBeenCalledTimes(2);
  });
  it("does not regenerate a saved export when its local bytes need relinking", async () => {
    const f = exported(),
      first = await fulfillProjectExport(f.request, f.ports);
    f.ports.loadSaved = vi.fn(async () => ({
      receipt: first.receipt,
      blob: null,
    }));
    f.ports.onExport = vi.fn(async () => {
      throw new Error("No regeneration");
    });
    await expect(
      fulfillProjectExport(f.request, f.ports),
    ).rejects.toMatchObject({ code: "MISSING_SAVED_EXPORT" });
    expect(f.ports.onExport).not.toHaveBeenCalled();
  });
  it.each(["encoder", "wrong revision", "manual edit", "invalid verification"])(
    "rejects export %s before fulfillment",
    async (kind) => {
      const f = exported();
      if (kind === "encoder") f.ports.onExport = vi.fn(async () => undefined);
      if (kind === "wrong revision")
        f.ports.onExport = vi.fn(async () => ({
          ...snapshot,
          revision: 4,
          exportId: "e",
          blob: f.blob,
          ...format,
        }));
      if (kind === "manual edit")
        f.ports.onExport = vi.fn(async () => {
          f.current = { ...f.current, revision: 4 };
          return { ...snapshot, exportId: "e", blob: f.blob, ...format };
        });
      if (kind === "invalid verification")
        f.ports.verify = vi.fn(async () => ({
          ...verification(),
          mode: "none" as const,
        }));
      await expect(fulfillProjectExport(f.request, f.ports)).rejects.toThrow();
      expect(f.ports.persist).not.toHaveBeenCalled();
    },
  );
  it("requires the host's actual audible-audio checks when requested", async () => {
    const f = exported();
    f.request.format.requireAudibleAudio = true;
    await expect(
      fulfillProjectExport(f.request, f.ports),
    ).rejects.toMatchObject({ code: "INVALID_OUTPUT" });
  });
  it("reconciles a locally pending verified receipt without encoding again", async () => {
    const f = exported(),
      receipt = (await fulfillProjectExport(f.request, f.ports)).receipt;
    f.ports.loadSaved = vi.fn(async () => ({
      receipt,
      blob: f.blob,
      persisted: false,
    }));
    f.ports.onExport = vi.fn(async () => {
      throw new Error("No second encode");
    });
    f.ports.persist = vi.fn(async () => ({}));
    expect((await fulfillProjectExport(f.request, f.ports)).reused).toBe(true);
    expect(f.ports.persist).toHaveBeenCalledExactlyOnceWith(receipt);
    expect(f.ports.onExport).not.toHaveBeenCalled();
  });
  it("does not mistake a local pending manifest for an acknowledged server receipt", async () => {
    const f = exported(),
      receipt = (await fulfillProjectExport(f.request, f.ports)).receipt;
    f.ports.loadSaved = vi.fn(async () => ({
      receipt,
      blob: f.blob,
      persisted: false,
    }));
    f.ports.persist = vi.fn(async () => {
      throw new TypeError("Unknown POST outcome");
    });
    f.ports.onExport = vi.fn(async () => {
      throw new Error("No second encode");
    });
    await expect(
      fulfillProjectExport(f.request, f.ports),
    ).rejects.toMatchObject({ reconciliationRequired: true });
    expect(f.ports.onExport).not.toHaveBeenCalled();
  });
  it("reverifies the original saved file after manual edits without consulting current state", async () => {
    const f = exported(),
      receipt = (await fulfillProjectExport(f.request, f.ports)).receipt;
    f.current = { ...f.current, revision: 999, documentHash: "sha256:manual" };
    f.ports.getState = vi.fn(() => {
      throw new Error("Saved reverify must not consult current state");
    });
    f.ports.onExport = vi.fn(async () => {
      throw new Error("No second encode");
    });
    expect(
      (
        await reverifySavedProjectExportFile(
          f.request,
          receipt,
          f.blob,
          undefined,
          f.ports.verify,
        )
      ).receipt,
    ).toEqual(receipt);
    expect(f.ports.getState).not.toHaveBeenCalled();
    expect(f.ports.onExport).not.toHaveBeenCalled();
  });
  it("stops a hung browser callback at its frozen request deadline", async () => {
    vi.useFakeTimers();
    const f = exported();
    f.request.maxRuntimeMs = 10;
    f.ports.onExport = vi.fn(
      () => new Promise<BrowserExportResult | undefined>(() => {}),
    );
    const pending = fulfillProjectExport(f.request, f.ports),
      assertion = expect(pending).rejects.toMatchObject({
        name: "TimeoutError",
      });
    await vi.advanceTimersByTimeAsync(10);
    await assertion;
    expect(f.ports.persist).not.toHaveBeenCalled();
  });
  it.each(["owner", "file hash", "revision", "storage", "export identity"])(
    "requires canonical owned publication: %s",
    async (mismatch) => {
      const f = exported(),
        receipt = (await fulfillProjectExport(f.request, f.ports)).receipt;
      const output = {
        id: "database-output",
        browserExportId: receipt.exportId,
        userId: "owner",
        projectId: "project",
        status: "completed",
        assetId: "owned-asset",
        canonicalStorageVerified: true,
        snapshot,
        fileHash: receipt.file.sha256,
        byteLength: receipt.file.byteLength,
      };
      if (mismatch === "owner") output.userId = "foreign";
      if (mismatch === "file hash") output.fileHash = "a".repeat(64);
      if (mismatch === "revision")
        output.snapshot = { ...snapshot, revision: 4 };
      if (mismatch === "storage") output.canonicalStorageVerified = false;
      if (mismatch === "export identity") output.browserExportId = "another";
      expect(() =>
        assertProjectExportPublication(f.request, receipt, "owner", output),
      ).toThrow();
    },
  );
  it("qualifies publication only from the separately verified owned output record", async () => {
    const f = exported(),
      receipt: ProjectExportReceipt = (
        await fulfillProjectExport(f.request, f.ports)
      ).receipt;
    expect(
      assertProjectExportPublication(f.request, receipt, "owner", {
        id: "database-output",
        browserExportId: receipt.exportId,
        userId: "owner",
        projectId: "project",
        status: "completed",
        assetId: "owned-asset",
        canonicalStorageVerified: true,
        snapshot,
        fileHash: receipt.file.sha256,
        byteLength: receipt.file.byteLength,
      }),
    ).toEqual({
      state: "published",
      outputId: "database-output",
      assetId: "owned-asset",
    });
    expect(receipt.publication).toBe("not-published");
  });
});
