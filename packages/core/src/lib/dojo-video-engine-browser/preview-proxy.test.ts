import { describe, expect, it, vi } from "vitest";
import { parseScene } from "@dojo-video-engine/schema";
import {
  applyPreviewProxies,
  highResolutionInsertionIssue,
  previewProxyCandidates,
  previewProxyDimensions,
  previewProxyEntryName,
  previewProxyUsesOriginalAudio,
  validatePreviewProxyManifest,
  type PreviewProxyManifest,
} from "./preview-proxy-policy";
import {
  DojoVideoEnginePreviewProxyManager,
  PreviewProxyPool,
} from "./preview-proxy-client";
import { assertPreviewCaptureBasis } from "./preview-proxy-capture";
import {
  assertPreviewProxyTimeline,
  preparePreviewProxy,
} from "./preview-proxy-media";
import { readPreviewProxyCache } from "./preview-proxy-cache";

const hash = "a".repeat(64),
  id = `local:${hash}`;
const scene = parseScene({
  schemaVersion: 1,
  width: 1920,
  height: 1080,
  fps: 30,
  duration: 90,
  assets: {
    [id]: {
      id,
      type: "video",
      src: "blob:https://example.test/source",
      metadata: { width: 1920, height: 1080, byteLength: 100 },
    },
  },
  nodes: [
    {
      id: "clip",
      type: "video",
      assetId: id,
      from: 0,
      duration: 90,
      style: { width: "100%", height: "100%", objectFit: "contain" },
    },
  ],
});
const request = previewProxyCandidates(scene)[0]!;
const manifest: PreviewProxyManifest = {
  version: 2,
  sourceHash: hash,
  sourceBytes: 100,
  proxyHash: "b".repeat(64),
  proxyBytes: 3,
  width: 960,
  height: 540,
  sourceWidth: 1920,
  sourceHeight: 1080,
  duration: 3,
  videoDuration: 3,
  audioFromOriginal: false,
  videoFrames: 90,
  videoTimingHash: "c".repeat(64),
  audioHash: null,
  audioPackets: 0,
  createdAt: 1,
};

describe("preview-only proxy eligibility", () => {
  it("preflights a fifth distinct 4K source without rejecting another use of an existing source", () => {
    const assets = Object.fromEntries(
      [1, 2, 3, 4, 5].map((value) => {
        const id = `local:${String(value).repeat(64)}`;
        return [id, { id, type: "video", width: 3840, height: 2160 }];
      }),
    );
    const ids = Object.keys(assets),
      document = {
        assets,
        items: ids.slice(0, 4).map((assetId, index) => ({
          node: { id: `clip-${index}`, type: "video" as const, assetId },
        })),
      };
    expect(highResolutionInsertionIssue(document, assets[ids[4]!]!)).toContain(
      "four",
    );
    expect(highResolutionInsertionIssue(document, assets[ids[0]!]!)).toBeNull();
    expect(
      highResolutionInsertionIssue(
        { ...document, items: document.items.slice(0, 3) },
        assets[ids[4]!]!,
      ),
    ).toBeNull();
  });
  it("rejects capture after a player is replaced even when scene identity is unchanged", () => {
    const player = {};
    expect(() =>
      assertPreviewCaptureBasis({ scene, player }, { scene, player }),
    ).not.toThrow();
    expect(() =>
      assertPreviewCaptureBasis({ scene, player }, { scene, player: {} }),
    ).toThrow("preview changed");
    expect(() =>
      assertPreviewCaptureBasis({ scene, player }, { scene, player: null }),
    ).toThrow("preview changed");
  });
  it("keeps exact aspect ratio with bounded even encoder dimensions", () => {
    expect(previewProxyDimensions(1920, 1080)).toEqual({
      width: 960,
      height: 540,
    });
    expect(previewProxyDimensions(1080, 1920)).toEqual({
      width: 540,
      height: 960,
    });
    expect(previewProxyDimensions(4096, 2160)).toEqual({
      width: 512,
      height: 270,
    });
    expect(previewProxyDimensions(1919, 1079)).toBeNull();
    expect(previewProxyDimensions(960, 540)).toBeNull();
    expect(previewProxyDimensions(7680, 4320)).toBeNull();
  });
  it("accepts only local hash-bound blobs with fixed-size video layout", () => {
    expect(request.sourceHash).toBe(hash);
    for (const source of [
      "https://example.test/source.mp4",
      "data:video/mp4;base64,AAAA",
    ]) {
      expect(
        previewProxyCandidates({
          ...scene,
          assets: { [id]: { ...scene.assets[id]!, src: source } },
        }),
      ).toEqual([]);
    }
    for (const style of [
      { width: "100%" },
      { width: "100%", height: "100%", objectFit: "none" as const },
      { width: "100%", height: "100%", objectFit: "scale-down" as const },
    ]) {
      expect(
        previewProxyCandidates({
          ...scene,
          nodes: [{ ...scene.nodes[0]!, style }],
        }),
      ).toEqual([]);
    }
    expect(
      previewProxyCandidates({
        ...scene,
        assets: {
          [id]: {
            ...scene.assets[id]!,
            metadata: {
              width: 1920,
              height: 1080,
              byteLength: 250 * 1024 * 1024,
            },
          },
        },
      }),
    ).toHaveLength(1);
    expect(
      previewProxyCandidates({
        ...scene,
        assets: {
          [id]: {
            ...scene.assets[id]!,
            metadata: {
              width: 1920,
              height: 1080,
              byteLength: 251 * 1024 * 1024,
            },
          },
        },
      }),
    ).toEqual([]);
    expect(
      previewProxyCandidates({
        ...scene,
        nodes: [
          {
            ...scene.nodes[0]!,
            animations: [
              {
                kind: "keyframes",
                property: "objectFit",
                frames: [
                  { frame: 0, value: "contain" },
                  { frame: 30, value: "none" },
                ],
              },
            ],
          },
        ],
      }),
    ).toEqual([]);
    expect(
      previewProxyCandidates({
        ...scene,
        nodes: [
          {
            ...scene.nodes[0]!,
            style: { ...scene.nodes[0]!.style, imageRendering: "pixelated" },
          },
        ],
      }),
    ).toEqual([]);
    expect(
      previewProxyCandidates({
        ...scene,
        nodes: [
          {
            ...scene.nodes[0]!,
            style: { ...scene.nodes[0]!.style, filter: "blur(4px)" },
          },
        ],
      }),
    ).toHaveLength(1);
    expect(
      previewProxyCandidates(
        parseScene({
          ...scene,
          nodes: [
            ...scene.nodes,
            {
              id: "caption",
              type: "text",
              text: "Ordinary caption",
              style: { textShadow: "2px 2px 4px black", fontSize: 32 },
            },
          ],
        }),
      ),
    ).toHaveLength(1);
  });
  it("changes only the transient proxy declaration and rejects stale URL bindings", () => {
    const before = JSON.stringify(scene);
    const map = new Map([
      [
        id,
        {
          originalSrc: request.src,
          proxy: { src: "blob:proxy", width: 960, height: 540 },
        },
      ],
    ]);
    const preview = applyPreviewProxies(scene, map);
    expect(preview.assets[id]?.src).toBe(request.src);
    expect(preview.assets[id]?.proxy?.src).toBe("blob:proxy");
    expect(preview.nodes).toBe(scene.nodes);
    expect(JSON.stringify(scene)).toBe(before);
    const relinked = {
      ...scene,
      assets: { [id]: { ...scene.assets[id]!, src: "blob:replacement" } },
    };
    expect(applyPreviewProxies(relinked, map)).toBe(relinked);
  });
  it("rejects cache metadata from another source or altered output geometry", () => {
    expect(validatePreviewProxyManifest(manifest, request)).toBe(manifest);
    expect(() =>
      validatePreviewProxyManifest(
        { ...manifest, sourceHash: "d".repeat(64) },
        request,
      ),
    ).toThrow();
    expect(() =>
      validatePreviewProxyManifest({ ...manifest, width: 958 }, request),
    ).toThrow();
    expect(() =>
      validatePreviewProxyManifest(
        { ...manifest, proxyBytes: 40 * 1024 * 1024 },
        request,
      ),
    ).toThrow();
    expect(() =>
      validatePreviewProxyManifest({ ...manifest, version: 1 }, request),
    ).toThrow();
    expect(() =>
      validatePreviewProxyManifest(
        { ...manifest, audioFromOriginal: true },
        request,
      ),
    ).toThrow();
    expect(() =>
      validatePreviewProxyManifest({ ...manifest, videoDuration: 4 }, request),
    ).toThrow();
  });
  it("allows a picture-only high-resolution proxy only with exact original video timing", () => {
    const original = {
      width: 3840,
      height: 2160,
      rotation: 0,
      duration: 3.02,
      videoDuration: 3,
      videoFrames: 90,
      videoTimingHash: "v",
      audioHash: "original-aac-with-negative-priming",
      audioPackets: 142,
      audioBytes: 1000,
      audioChannels: 2,
      audioSampleRate: 48000,
      audioFirstTimestamp: -0.021,
    };
    const proxy = {
      ...original,
      width: 960,
      height: 540,
      duration: 3,
      audioHash: null,
      audioPackets: 0,
      audioBytes: 0,
      audioChannels: 0,
      audioSampleRate: 0,
      audioFirstTimestamp: null,
    };
    expect(() =>
      assertPreviewProxyTimeline(original, proxy, true),
    ).not.toThrow();
    expect(() => assertPreviewProxyTimeline(original, proxy)).toThrow();
    for (const change of [
      { videoTimingHash: "changed" },
      { videoFrames: 89 },
      { videoDuration: 2.99 },
      { audioHash: "unexpected" },
      { audioPackets: 1 },
      { duration: 3.02 },
    ]) {
      expect(() =>
        assertPreviewProxyTimeline(original, { ...proxy, ...change }, true),
      ).toThrow();
    }
  });
  it("keeps v2 rules immutable while v3 binds low-resolution AAC priming to original audio", () => {
    expect(previewProxyEntryName(hash)).toBe(`v3-${hash}`);
    expect(previewProxyUsesOriginalAudio(1280, 720, -0.044)).toBe(true);
    expect(previewProxyUsesOriginalAudio(1280, 720, 0)).toBe(false);
    expect(previewProxyUsesOriginalAudio(1280, 720, null)).toBe(false);
    expect(previewProxyUsesOriginalAudio(3840, 2160, null)).toBe(true);
    expect(validatePreviewProxyManifest(manifest, request)).toBe(manifest);
    const primed = {
      ...manifest,
      version: 3 as const,
      audioPackets: 100,
      audioHash: "d".repeat(64),
      audioFirstTimestamp: -0.044,
      audioFromOriginal: true,
    };
    expect(validatePreviewProxyManifest(primed, request)).toEqual(primed);
    for (const change of [
      { audioFromOriginal: false },
      { audioFirstTimestamp: null },
      { audioFirstTimestamp: 0 },
      { audioFirstTimestamp: -3 },
      { audioFirstTimestamp: Infinity },
      { version: 2 },
      { version: 4 },
    ])
      expect(() =>
        validatePreviewProxyManifest({ ...primed, ...change }, request),
      ).toThrow();
    expect(() =>
      validatePreviewProxyManifest(
        { ...manifest, version: 3, audioFirstTimestamp: null },
        request,
      ),
    ).not.toThrow();
  });
  it("does not read a legacy manifest through a new-version cache lock", async () => {
    const legacyMetadata = new Blob([JSON.stringify(manifest)]),
      open = vi.fn(async () => ({
        getFileHandle: async () => ({ getFile: async () => legacyMetadata }),
      }));
    const root = {
      getDirectoryHandle: open,
    } as unknown as FileSystemDirectoryHandle;
    await expect(readPreviewProxyCache(root, request)).rejects.toThrow(
      "namespace changed",
    );
    expect(open).toHaveBeenCalledExactlyOnceWith(`v3-${hash}`);
    expect(validatePreviewProxyManifest(manifest, request)).toEqual(manifest);
  });
  it("rejects oversized blob responses before materializing their body", async () => {
    const blob = vi.fn(),
      fetcher = vi.fn(async () => ({
        ok: true,
        headers: new Headers({ "content-length": String(251 * 1024 * 1024) }),
        blob,
      }));
    vi.stubGlobal("location", { origin: "https://example.test" });
    vi.stubGlobal("fetch", fetcher);
    try {
      await expect(
        preparePreviewProxy(request, new AbortController().signal),
      ).rejects.toThrow("byte budget");
      expect(blob).not.toHaveBeenCalled();
      fetcher.mockClear();
      await expect(
        preparePreviewProxy(
          { ...request, src: "https://example.test/video.mp4" },
          new AbortController().signal,
        ),
      ).rejects.toThrow("local hash-bound");
      expect(fetcher).not.toHaveBeenCalled();
    } finally {
      vi.unstubAllGlobals();
    }
  });
});

describe("background proxy lifecycle", () => {
  function fixture() {
    const jobs: Array<{
      signal: AbortSignal;
      complete: (
        value: {
          file: Blob;
          manifest: PreviewProxyManifest;
          cached: boolean;
          releasePin: () => void;
        } | null,
      ) => void;
    }> = [];
    const prepare = vi.fn(
      (_request, signal: AbortSignal) =>
        new Promise<any>((resolve) => {
          jobs.push({ signal, complete: resolve });
        }),
    );
    const revokeUrl = vi.fn(),
      createUrl = vi.fn(() => "blob:proxy"),
      releasePin = vi.fn();
    const pool = new PreviewProxyPool({
      prepare,
      revokeUrl,
      createUrl,
      delayMs: 0,
    });
    const complete = (index = 0) =>
      jobs[index]!.complete({
        file: new Blob(["mp4"]),
        manifest,
        cached: false,
        releasePin,
      });
    return { pool, jobs, prepare, revokeUrl, releasePin, complete };
  }
  const highScene = parseScene({
    ...scene,
    assets: {
      [id]: {
        ...scene.assets[id]!,
        metadata: { ...scene.assets[id]!.metadata, width: 3840, height: 2160 },
      },
    },
    nodes: [
      ...scene.nodes,
      {
        id: "caption",
        type: "text",
        text: "Caption with shadow",
        style: { textShadow: "2px 2px 4px black", fontSize: 32 },
      },
    ],
  });
  it("requires a ready proxy for local 4K even with ordinary caption shadows", async () => {
    const f = fixture(),
      manager = new DojoVideoEnginePreviewProxyManager(() => {}, f.pool);
    manager.updateScene(highScene, false);
    expect(manager.readiness(highScene).status).toBe("preparing");
    await vi.waitFor(() => expect(f.prepare).toHaveBeenCalledOnce());
    f.complete();
    await vi.waitFor(() =>
      expect(manager.readiness(highScene).status).toBe("ready"),
    );
    const rendered = manager.scene(highScene);
    expect(rendered.assets[id]?.proxy).toBeDefined();
    manager.rejectScene(rendered);
    manager.updateScene(highScene, false);
    expect(manager.readiness(highScene)).toMatchObject({
      status: "error",
      reason: "failed",
    });
    expect(f.prepare).toHaveBeenCalledOnce();
    manager.dispose();
  });
  it("publishes required-proxy failure instead of silently falling back to the 4K original", async () => {
    const f = fixture(),
      changed = vi.fn(),
      manager = new DojoVideoEnginePreviewProxyManager(changed, f.pool);
    manager.updateScene(highScene, false);
    await vi.waitFor(() => expect(f.prepare).toHaveBeenCalledOnce());
    f.jobs[0]!.complete(null);
    await vi.waitFor(() => expect(changed).toHaveBeenCalledOnce());
    expect(manager.readiness(highScene)).toMatchObject({
      status: "error",
      reason: "failed",
    });
    expect(manager.scene(highScene)).toBe(highScene);
    manager.dispose();
  });
  it("requests relinking for evicted local 4K bytes without breaking ordinary cloud scenes", () => {
    const manager = new DojoVideoEnginePreviewProxyManager(() => {});
    const cloudLocal = {
      ...highScene,
      assets: {
        [id]: { ...highScene.assets[id]!, src: "https://owned.test/video.mp4" },
      },
    };
    expect(manager.readiness(cloudLocal)).toMatchObject({
      status: "error",
      reason: "relink",
      assetIds: [id],
    });
    const cloud = parseScene({
      ...highScene,
      assets: {
        cloud: {
          ...highScene.assets[id]!,
          id: "cloud",
          src: "https://owned.test/video.mp4",
        },
      },
      nodes: [{ ...highScene.nodes[0]!, assetId: "cloud" }],
    });
    expect(manager.readiness(cloud).status).toBe("ready");
    manager.dispose();
  });
  it("deduplicates identical sources and permits only one conversion at a time", async () => {
    const f = fixture();
    const first = f.pool.acquire(request),
      same = f.pool.acquire(request);
    const next = f.pool.acquire({
      ...request,
      src: "blob:second",
      sourceHash: "d".repeat(64),
    });
    await vi.waitFor(() => expect(f.prepare).toHaveBeenCalledTimes(1));
    expect(first.result).toBe(same.result);
    f.complete();
    await first.result;
    await vi.waitFor(() => expect(f.prepare).toHaveBeenCalledTimes(2));
    f.complete(1);
    await next.result;
    first.release();
    expect(f.revokeUrl).not.toHaveBeenCalled();
    same.release();
    next.release();
    expect(f.releasePin).toHaveBeenCalledTimes(2);
  });
  it("lets thumbnails borrow ready proxies without allocating work or releasing the renderer's file", async () => {
    const f = fixture(),
      ready = vi.fn();
    expect(f.pool.retainReady(request.assetId, request.src)).toBeNull();
    expect(f.prepare).not.toHaveBeenCalled();
    const unsubscribe = f.pool.subscribeReady(ready),
      renderer = f.pool.acquire(request);
    await vi.waitFor(() => expect(f.prepare).toHaveBeenCalledOnce());
    f.complete();
    await renderer.result;
    expect(ready).toHaveBeenCalledExactlyOnceWith(request);
    const thumbnail = f.pool.retainReady(request.assetId, request.src)!;
    expect(thumbnail.url).toBe("blob:proxy");
    renderer.release();
    expect(f.revokeUrl).not.toHaveBeenCalled();
    expect(f.releasePin).not.toHaveBeenCalled();
    thumbnail.release();
    expect(f.revokeUrl).toHaveBeenCalledOnce();
    expect(f.releasePin).toHaveBeenCalledOnce();
    unsubscribe();
  });
  it("keeps a source job through edits and pins the active renderer after UI release", async () => {
    const f = fixture(),
      ready = vi.fn(),
      manager = new DojoVideoEnginePreviewProxyManager(ready, f.pool);
    manager.updateScene(scene, false);
    await vi.waitFor(() => expect(f.prepare).toHaveBeenCalledOnce());
    manager.updateScene(
      {
        ...scene,
        nodes: [
          { ...scene.nodes[0]!, style: { ...scene.nodes[0]!.style, left: 20 } },
        ],
      },
      false,
    );
    expect(f.jobs[0]!.signal.aborted).toBe(false);
    expect(f.prepare).toHaveBeenCalledOnce();
    f.complete();
    await vi.waitFor(() => expect(ready).toHaveBeenCalledOnce());
    const preview = manager.scene(scene),
      releaseRenderer = manager.retainScene(preview);
    expect(preview.assets[id]?.proxy?.src).toBe("blob:proxy");
    manager.dispose();
    expect(f.revokeUrl).not.toHaveBeenCalled();
    expect(f.releasePin).not.toHaveBeenCalled();
    releaseRenderer();
    expect(f.revokeUrl).toHaveBeenCalledOnce();
    expect(f.releasePin).toHaveBeenCalledOnce();
  });
  it("does not start queued work during playback and cancels removed sources", async () => {
    const f = fixture(),
      manager = new DojoVideoEnginePreviewProxyManager(() => {}, f.pool);
    manager.updateScene(scene, true);
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(f.prepare).not.toHaveBeenCalled();
    manager.updateScene(scene, false);
    await vi.waitFor(() => expect(f.prepare).toHaveBeenCalledOnce());
    manager.updateScene({ ...scene, assets: {}, nodes: [] }, false);
    expect(f.jobs[0]!.signal.aborted).toBe(true);
    f.complete();
    await vi.waitFor(() => expect(f.releasePin).toHaveBeenCalledOnce());
    expect(f.revokeUrl).not.toHaveBeenCalled();
    manager.dispose();
  });
  it("falls back to the original when a generated proxy fails without retry loops", async () => {
    const f = fixture(),
      ready = vi.fn(),
      manager = new DojoVideoEnginePreviewProxyManager(ready, f.pool);
    manager.updateScene(scene, false);
    await vi.waitFor(() => expect(f.prepare).toHaveBeenCalledOnce());
    f.complete();
    await vi.waitFor(() => expect(ready).toHaveBeenCalledOnce());
    const preview = manager.scene(scene);
    manager.rejectScene(preview);
    manager.updateScene(scene, false);
    expect(manager.scene(scene)).toBe(scene);
    expect(f.prepare).toHaveBeenCalledOnce();
    manager.dispose();
  });
  it("holds a proxy completed during playback across edits until pause, then retains it during playback", async () => {
    const f = fixture(),
      ready = vi.fn(),
      manager = new DojoVideoEnginePreviewProxyManager(ready, f.pool);
    manager.updateScene(scene, false);
    await vi.waitFor(() => expect(f.prepare).toHaveBeenCalledOnce());
    manager.setPlaying(true);
    f.complete();
    await vi.waitFor(() => expect(ready).toHaveBeenCalledOnce());
    const edited = { ...scene, duration: 120 };
    manager.updateScene(edited, true);
    expect(manager.scene(edited)).toBe(edited);
    manager.setPlaying(false);
    expect(manager.scene(edited).assets[id]?.proxy?.src).toBe("blob:proxy");
    manager.setPlaying(true);
    manager.updateScene(edited, true);
    expect(manager.scene(edited).assets[id]?.proxy?.src).toBe("blob:proxy");
    manager.dispose();
  });
});
