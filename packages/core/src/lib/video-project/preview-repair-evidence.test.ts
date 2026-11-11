import { expect, it, vi } from "vitest";
import { completionHash } from "../../../../agent-kit/src/index";
import { previewRepairEvidence } from "./preview-repair-evidence";
import {
  createProjectPreviewRequest,
  OUTPUT_PREVIEW_LIMITS,
} from "./browser-output-requests";
import { fulfillProjectPreview } from "./browser-output-host";
async function fixture() {
  const hash = "sha256:" + "a".repeat(64);
  const bytes = new Uint8Array([
    255, 216, 255, 192, 0, 17, 8, 0, 180, 1, 64, 3, 1, 17, 0, 2, 17, 0, 3, 17,
    0, 255, 217,
  ]);
  const request = createProjectPreviewRequest(
    {
      version: 1,
      kind: "project-preview",
      projectId: "project",
      runId: "run",
      snapshot: { revision: 3, documentHash: hash },
      renderHash: "sha256:" + "b".repeat(64),
      candidateRef: {
        version: 1,
        id: "review",
        runId: "run",
        bindingHash: hash,
        kind: "verification",
        sha256: hash,
        sizeBytes: 120,
      },
      format: {
        width: 320,
        height: 180,
        fps: 30,
        durationInFrames: 60,
        hasAudio: true,
        requireAudibleAudio: false,
      },
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
    authorizedAt: "2026-11-11T00:00:00.000Z",
  };
  const captured = vi.fn(async (frame: number) => ({
    frame,
    renderHash: request.renderHash,
    imageDataUrl: `data:image/jpeg;base64,${btoa(String.fromCharCode(...bytes))}`,
  }));
  const result = await fulfillProjectPreview(request, grant, {
    getState: () => ({
      ...request.snapshot,
      pendingCommands: 0,
      interactionDrafts: 0,
      renderHash: request.renderHash,
    }),
    capture: captured,
    loadSaved: async () => null,
    persist: async () => ({}),
  });
  return { request, grant, receipt: result.receipt, captured };
}
it("derives small correction evidence only from exact validated candidate pixels and revision", async () => {
  const f = await fixture();
  const before = await completionHash(f.receipt);
  const evidence = previewRepairEvidence(f);
  expect(evidence).toMatchObject({
    requestId: f.request.id,
    candidateRef: f.request.candidateRef,
    snapshotHash: f.request.snapshot.documentHash,
    renderHash: f.request.renderHash,
    frames: [0, 30],
    audio: "not-inspected",
  });
  expect(JSON.stringify(evidence)).not.toContain("data:image");
  expect(await completionHash(f.receipt)).toBe(before);
  expect(f.captured).toHaveBeenCalledTimes(2);
});
it.each(["snapshot", "render", "pixels", "grant"])(
  "rejects a changed %s receipt before authorizing correction",
  async (mode) => {
    const f = await fixture();
    if (mode === "snapshot") f.receipt.snapshot.revision++;
    if (mode === "render") f.receipt.renderHash = "sha256:" + "c".repeat(64);
    if (mode === "pixels") f.receipt.frames[0].sha256 = "c".repeat(64);
    if (mode === "grant") f.grant.scopeHash = "c".repeat(64);
    expect(() => previewRepairEvidence(f)).toThrow();
  },
);
