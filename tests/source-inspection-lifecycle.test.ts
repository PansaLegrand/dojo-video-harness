import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { sampleOriginalSource } from "../packages/core/src/lib/video-project/source-inspection-browser";
import { browserHostValueHash } from "../packages/core/src/lib/video-project/browser-host-requests";
import hash from "fast-sha256";

const state = vi.hoisted(() => ({
  disposed: 0,
  cursorClosed: 0,
  bitmapClosed: 0,
  sampleClosed: 0,
  hdr: false,
  sampleHdr: false,
  decodeError: false,
  abortDuringFrame: null as AbortController | null,
}));
const encoded = () =>
  new Blob(
    [
      new Uint8Array([
        255, 216, 255, 192, 0, 17, 8, 0, 10, 0, 20, 3, 1, 17, 0, 2, 17, 0, 3,
        17, 0, 255, 217,
      ]),
    ],
    { type: "image/jpeg" },
  );
vi.mock("mediabunny", async (original) => ({
  ...(await original<typeof import("mediabunny")>()),
  Input: class {
    disposed = false;
    async getFormat() {
      return { mimeType: "video/mp4" };
    }
    async getPrimaryVideoTrack() {
      if (state.decodeError) throw new Error("Corrupt source");
      return {
        canDecode: async () => true,
        hasHighDynamicRange: async () => state.hdr,
        getColorSpace: async () => ({}),
        getDisplayWidth: async () => 20,
        getDisplayHeight: async () => 10,
        getRotation: async () => 90,
        getFirstTimestamp: async () => 0,
        computeDuration: async () => 2,
      };
    }
    dispose() {
      if (!this.disposed) state.disposed++;
      this.disposed = true;
    }
  },
  CanvasSink: class {},
  VideoSampleSink: class {
    async *samplesAtTimestamps(times: Iterable<number>) {
      try {
        for (const time of times) {
          if (time > 0)
            state.abortDuringFrame?.abort(
              new DOMException("Cancelled", "AbortError"),
            );
          yield {
            timestamp: Math.floor(time * 30) / 30,
            duration: 1 / 30,
            colorSpace: state.sampleHdr
              ? { primaries: "bt2020", transfer: "pq" }
              : {},
            drawWithFit() {},
            close() {
              state.sampleClosed++;
            },
          };
        }
      } finally {
        state.cursorClosed++;
      }
    }
  },
}));
vi.mock("@dojo-video-engine/renderer-canvas2d", () => ({
  disposeMediaInputSafely: (input: { dispose(): void }) => input.dispose(),
  VideoPlaybackCursor: class {
    async frameAt(time: number) {
      state.abortDuringFrame?.abort(
        new DOMException("Cancelled", "AbortError"),
      );
      return {
        timestamp: Math.floor(time * 30) / 30,
        duration: 1 / 30,
        canvas: { width: 20, height: 10, convertToBlob: async () => encoded() },
      };
    }
    async dispose() {
      state.cursorClosed++;
    }
  },
}));
const limits = {
  maxFrames: 8,
  maxDimension: 1024,
  maxFramePixels: 1_048_576,
  maxTotalPixels: 4_194_304,
  maxOutputBytes: 4 * 1024 * 1024,
  timeoutMs: 15000,
};
async function plan(type: "image" | "video" = "video") {
  const blob = encoded(),
    digest = [...hash(new Uint8Array(await blob.arrayBuffer()))]
      .map((value) => value.toString(16).padStart(2, "0"))
      .join("");
  return {
    blob,
    input: {
      source: {
        sourceId: "source",
        sourceRevision: "original",
        contentHash: digest,
        byteLength: blob.size,
        type,
      },
      momentsMs: type === "image" ? [0] : [100, 700],
      limits,
    },
  };
}
beforeEach(() => {
  Object.assign(state, {
    disposed: 0,
    cursorClosed: 0,
    bitmapClosed: 0,
    sampleClosed: 0,
    hdr: false,
    sampleHdr: false,
    decodeError: false,
    abortDuringFrame: null,
  });
  vi.stubGlobal(
    "OffscreenCanvas",
    class {
      constructor(
        readonly width: number,
        readonly height: number,
      ) {}
      getContext() {
        return { clearRect() {}, fillRect() {}, drawImage() {} };
      }
      convertToBlob() {
        return Promise.resolve(encoded());
      }
    },
  );
});
afterEach(() => vi.unstubAllGlobals());
describe("source sampler lifecycle", () => {
  it("retains actual source PTS and closes the cursor/input after success", async () => {
    const f = await plan(),
      before = browserHostValueHash(f.input),
      result = await sampleOriginalSource(f.blob, f.input);
    expect(result.frames).toHaveLength(2);
    expect(result.frames[0]!.metadata.actualMs).toBe(100);
    expect(result.provenance).toMatchObject({
      sourceKind: "original",
      rotationDegrees: 90,
      coverage: "requested-moments-only",
    });
    expect(state).toMatchObject({
      disposed: 1,
      cursorClosed: 1,
      sampleClosed: 3,
    });
    expect(browserHostValueHash(f.input)).toBe(before);
  });
  it("rejects replaced bytes before constructing a decoder", async () => {
    const f = await plan();
    f.input.source.contentHash = "b".repeat(64);
    await expect(sampleOriginalSource(f.blob, f.input)).rejects.toMatchObject({
      code: "SOURCE_CHANGED",
    });
    expect(state.disposed).toBe(0);
  });
  it.each(["HDR", "corrupt", "output limit", "end of source"])(
    "disposes sources on %s failure",
    async (kind) => {
      const f = await plan();
      if (kind === "HDR") state.hdr = true;
      if (kind === "corrupt") state.decodeError = true;
      if (kind === "output limit")
        f.input.limits = { ...limits, maxOutputBytes: 1 };
      if (kind === "end of source") f.input.momentsMs = [2000];
      await expect(sampleOriginalSource(f.blob, f.input)).rejects.toThrow();
      expect(state.disposed).toBe(1);
    },
  );
  it("cancels during frame decoding and closes both cursor and input", async () => {
    const f = await plan(),
      controller = new AbortController();
    state.abortDuringFrame = controller;
    await expect(
      sampleOriginalSource(f.blob, f.input, { signal: controller.signal }),
    ).rejects.toMatchObject({ name: "AbortError" });
    expect(state).toMatchObject({ disposed: 1, cursorClosed: 1 });
  });
  it("rejects HDR codec VUI even when container color metadata is absent", async () => {
    const f = await plan();
    state.sampleHdr = true;
    await expect(sampleOriginalSource(f.blob, f.input)).rejects.toMatchObject({
      code: "HDR_UNSUPPORTED",
    });
    expect(state).toMatchObject({
      disposed: 1,
      cursorClosed: 1,
      sampleClosed: 1,
    });
  });
  it("closes a decoded image and also closes a bitmap arriving after cancellation", async () => {
    const f = await plan("image");
    vi.stubGlobal(
      "OffscreenCanvas",
      class {
        width = 20;
        height = 10;
        getContext() {
          return { fillRect() {}, drawImage() {} };
        }
        convertToBlob() {
          return Promise.resolve(encoded());
        }
      },
    );
    vi.stubGlobal("createImageBitmap", async () => ({
      width: 20,
      height: 10,
      close: () => state.bitmapClosed++,
    }));
    await sampleOriginalSource(f.blob, f.input);
    expect(state.bitmapClosed).toBe(1);
    const controller = new AbortController();
    let release:
      | ((bitmap: { width: number; height: number; close(): void }) => void)
      | undefined;
    vi.stubGlobal(
      "createImageBitmap",
      () =>
        new Promise((resolve) => {
          release = resolve;
          controller.abort(new DOMException("Cancelled", "AbortError"));
        }),
    );
    await expect(
      sampleOriginalSource(f.blob, f.input, { signal: controller.signal }),
    ).rejects.toMatchObject({ name: "AbortError" });
    release!({ width: 20, height: 10, close: () => state.bitmapClosed++ });
    await Promise.resolve();
    expect(state.bitmapClosed).toBe(2);
  });
});
