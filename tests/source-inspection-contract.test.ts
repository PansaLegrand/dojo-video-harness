import { describe, expect, it } from "vitest";
import { SOURCE_INSPECTION_LIMITS, inspectionImageDimensions, inspectionOutputSize, inspectionSourceMoment, sourceInspectionPlanSchema } from "../packages/core/src/lib/video-project/source-inspection";
import { browserInspectionScopeHash, browserHostValueHash, createBrowserInspectionRequest, assertBrowserInspectionGrant, validateBrowserInspectionReceipt, type BrowserInspectionScope } from "../packages/core/src/lib/video-project/browser-host-requests";
import hash from "fast-sha256";

const limits = { maxFrames: 8, maxDimension: 1024, maxFramePixels: 1_048_576, maxTotalPixels: 4_194_304, maxOutputBytes: 4 * 1024 * 1024, timeoutMs: 15000 };
const scope = (): BrowserInspectionScope => ({ version: 1, kind: "source-inspection", projectId: "project", runId: "run", snapshot: { revision: 2, documentHash: "sha256:doc" },
  source: { sourceId: "local-document-source", sourceRevision: "sha256:source", contentHash: "a".repeat(64), byteLength: 100, type: "video" }, momentsMs: [100, 700], limits });
function jpegBytes(width = 20, height = 10) {
  return new Uint8Array([255,216,255,192,0,17,8,height >> 8,height & 255,width >> 8,width & 255,3,1,17,0,2,17,0,3,17,0,255,217]);
}
function fixture() {
  const request = createBrowserInspectionRequest(scope(), "request"), grant = { version: 1 as const, id: "grant", scopeHash: request.scopeHash, mode: "cloud-visual-analysis" as const, authorizedAt: "2026-11-10T00:00:00.000Z" };
  const bytes = jpegBytes(), sha256 = [...hash(bytes)].map(value => value.toString(16).padStart(2, "0")).join("");
  return { request, grant, receipt: { version: 1, requestId: request.id, requestHash: browserHostValueHash(request), scopeHash: request.scopeHash, authorizationId: grant.id,
    provenance: { algorithm: "dojo-source-inspection-v1", engineVersion: "1.2.3", sourceKind: "original", source: request.source, displayWidth: 100, displayHeight: 50, orientation: "display-oriented", rotationDegrees: 0, sourceMimeType: "video/mp4", colorMetadata: { primaries: "bt709", transfer: "bt709", matrix: "bt709", fullRange: false }, colorPolicy: "browser-sdr-to-srgb-v1", firstTimestampMs: 0, sourceEndMs: 1000, coverage: "requested-moments-only" },
    frames: request.momentsMs.map(time => ({ requestedMs: time, actualMs: time - 10, durationMs: 33, width: 20, height: 10, byteLength: bytes.length, sha256, mimeType: "image/jpeg", dataUrl: `data:image/jpeg;base64,${btoa(String.fromCharCode(...bytes))}` })) } };
}
describe("bounded source inspection", () => {
  it("maps trims and nonunit playback rates without confusing timeline and source clocks", () => {
    expect(inspectionSourceMoment({ frame: 150, from: 120, duration: 60, fps: 30, sourceStartMs: 2000, playbackRate: 2 })).toBe(4000);
    expect(() => inspectionSourceMoment({ frame: 180, from: 120, duration: 60, fps: 30, sourceStartMs: 2000, playbackRate: 2 })).toThrow();
    expect(() => inspectionSourceMoment({ frame: 150, from: 120, duration: 60, fps: 30, sourceStartMs: 2000, playbackRate: -1 })).toThrow();
  });
  it("bounds all output pixels and preserves aspect ratio", () => {
    const size = inspectionOutputSize(3840, 2160, limits, 8);
    expect(size.width * size.height * 8).toBeLessThanOrEqual(limits.maxTotalPixels);
    expect(size.width / size.height).toBeCloseTo(16 / 9, 2);
    expect(() => inspectionOutputSize(32000, 32000, limits, 1)).toThrow();
    expect(inspectionOutputSize(640, 360, limits, 1)).toEqual({ width: 640, height: 360 });
  });
  it("rejects unordered/duplicate moments, oversized allowances and image time intervals", () => {
    for (const momentsMs of [[700, 100], [100, 100], [], Array.from({ length: 9 }, (_, i) => i)]) expect(sourceInspectionPlanSchema.safeParse({ source: scope().source, momentsMs, limits }).success).toBe(false);
    expect(sourceInspectionPlanSchema.safeParse({ source: scope().source, momentsMs: [0], limits: { ...limits, maxFrames: 99 } }).success).toBe(false);
    expect(sourceInspectionPlanSchema.safeParse({ source: { ...scope().source, type: "image" }, momentsMs: [100], limits }).success).toBe(false);
  });
  it("reads image dimensions before decoding and rejects corrupt/unqualified headers", () => {
    expect(inspectionImageDimensions(jpegBytes(713, 960))).toEqual({ width: 713, height: 960 });
    expect(() => inspectionImageDimensions(new Uint8Array([1, 2, 3]))).toThrow();
    expect(SOURCE_INSPECTION_LIMITS.maxInputPixels).toBeLessThan(32_000_000);
  });
});
describe("browser request/grant/receipt identity", () => {
  it("validates every requested frame and retains exact point-only coverage", () => {
    const f = fixture(); expect(validateBrowserInspectionReceipt(f.request, f.grant, f.receipt).frames).toHaveLength(2);
  });
  it.each(["run", "snapshot", "source", "moment", "limits"])("changes authorization scope when %s changes", field => {
    const current = scope(), old = browserInspectionScopeHash(current);
    if (field === "run") current.runId = "other";
    if (field === "snapshot") current.snapshot.revision++;
    if (field === "source") current.source.contentHash = "b".repeat(64);
    if (field === "moment") current.momentsMs[0] = 101;
    if (field === "limits") current.limits = { ...limits, maxDimension: 512 };
    expect(browserInspectionScopeHash(current)).not.toBe(old);
    const f = fixture(); expect(() => assertBrowserInspectionGrant(createBrowserInspectionRequest(current, "other"), f.grant)).toThrow();
  });
  it.each(["wrong run receipt", "missing frame", "wrong source", "reordered moments", "wrong frame time", "wrong bytes", "wrong dimensions", "proxy claim", "wrong media type", "byte allowance", "pixel allowance"])("rejects %s", change => {
    const f = fixture(), r = f.receipt;
    if (change === "wrong run receipt") r.requestId = "other";
    if (change === "missing frame") r.frames.pop();
    if (change === "wrong source") r.provenance.source = { ...r.provenance.source, sourceId: "other" };
    if (change === "reordered moments") r.frames.reverse();
    if (change === "wrong frame time") r.frames[0]!.actualMs = 150;
    if (change === "wrong bytes") r.frames[0]!.sha256 = "b".repeat(64);
    if (change === "wrong dimensions") r.frames[0]!.width++;
    if (change === "proxy claim") r.provenance.sourceKind = "proxy";
    if (change === "wrong media type") r.provenance.sourceMimeType = "image/jpeg";
    if (change === "byte allowance") {
      f.request = createBrowserInspectionRequest({ ...scope(), limits: { ...limits, maxOutputBytes: 1 } }, "request");
      f.grant.scopeHash = f.request.scopeHash; r.scopeHash = f.request.scopeHash; r.requestHash = browserHostValueHash(f.request);
    }
    if (change === "pixel allowance") r.frames[0]!.height = 2000;
    expect(() => validateBrowserInspectionReceipt(f.request, f.grant, r)).toThrow();
  });
});
