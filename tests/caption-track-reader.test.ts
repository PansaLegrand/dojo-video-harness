import { expect, it } from "vitest";
import {
  createVideoProjectDocument,
  hashVideoProjectDocument,
} from "../packages/core/src/lib/video-project/document";
import { readNativeCaptionTrack } from "../packages/core/src/lib/video-project/caption-track-reader";
import type { NativeAgentRequest } from "../packages/core/src/lib/video-project/agent-runtime";
async function fixture() {
  const document = createVideoProjectDocument({
    width: 640,
    height: 360,
    fps: 30,
    durationInFrames: 60120,
  });
  document.assets.a = {
    id: "a",
    name: "Speech",
    type: "video",
    source: "local",
    durationSeconds: 2004,
  };
  document.sources.a = { assetId: "a", revision: "original" };
  document.items.push({
    id: "speech",
    name: "Speech",
    trackId: "visual",
    node: {
      id: "speech",
      type: "video",
      assetId: "a",
      from: 0,
      duration: 60120,
    },
  });
  const cues = Array.from({ length: 501 }, (_, i) => ({
    id: `manual:${i}`,
    text: `${"字".repeat(150)} ${i}`,
    startMs: i * 4000,
    endMs: i * 4000 + 3000,
    words: [
      { text: "display-only-word", startMs: i * 4000, endMs: i * 4000 + 3000 },
    ],
  }));
  document.items.push({
    id: "en",
    name: "Manually edited English",
    trackId: "visual",
    node: {
      id: "en",
      type: "div",
      from: 0,
      duration: 60120,
      style: { fontSize: 22, color: "#ff0000" },
    },
    caption: {
      mode: "sentence",
      direction: "ltr",
      highlightColor: "#ffffff",
      sourceItemId: "speech",
      language: "en",
      role: "original",
      pairedItemId: "zh",
      cues,
    },
  });
  document.items.push({
    id: "zh",
    name: "Chinese",
    trackId: "visual",
    node: { id: "zh", type: "div", from: 0, duration: 60120 },
    caption: {
      mode: "sentence",
      direction: "ltr",
      highlightColor: "#ffffff",
      sourceItemId: "speech",
      language: "zh",
      role: "translation",
      pairedItemId: "en",
      cues: cues.map((cue) => ({ ...cue, text: `Translation ${cue.id}` })),
    },
  });
  const request: NativeAgentRequest = {
    contract: "video-project-commands",
    version: 1,
    baseRevision: 1,
    baseHash: await hashVideoProjectDocument(document),
    document,
    context: { selectedItemIds: [], playheadFrame: 0 },
    authoring: { version: 1, scope: { kind: "project" } },
  };
  return { document, request, cues };
}
it("reconstructs all 501 current-display cues within 100/24KB pages without ASR word claims", async () => {
  const f = await fixture(),
    before = JSON.stringify(f.document),
    result = [];
  let cursor: string | undefined;
  do {
    const page = await readNativeCaptionTrack(f.request, {
      snapshotHash: f.request.baseHash,
      captionItemId: "en",
      cursor,
    });
    expect(Buffer.byteLength(JSON.stringify(page))).toBeLessThanOrEqual(24000);
    expect(page.cues.length).toBeLessThanOrEqual(100);
    expect(page.authority).toBe("display-only");
    expect(page.grouping).toBe("current-display-v1");
    expect(page.track).toMatchObject({
      captionItemId: "en",
      pairedItemId: "zh",
      sourceItemId: "speech",
      sourceRevision: "original",
      language: "en",
      role: "original",
      clock: { fps: 30 },
      style: { fontSize: 22 },
    });
    for (const cue of page.cues) {
      expect(cue).not.toHaveProperty("words");
      expect(cue).not.toHaveProperty("wordIds");
    }
    result.push(...page.cues);
    cursor = page.coverage.nextCursor ?? undefined;
    if (!cursor) expect(page.coverage.complete).toBe(true);
  } while (cursor);
  expect(result).toEqual(
    f.cues.map(({ id, text, startMs, endMs }) => ({
      cueId: id,
      text,
      startMs,
      endMs,
    })),
  );
  expect(JSON.stringify(f.document)).toBe(before);
});
it("reads edited/merged cue IDs and text instead of re-grouping immutable transcript words", async () => {
  const f = await fixture();
  f.document.items.find((item) => item.id === "en")!.caption!.cues = [
    {
      id: "manual-merged",
      text: "solid pace / 人工修正",
      startMs: 0,
      endMs: 7000,
    },
  ];
  f.request = {
    ...f.request,
    document: f.document,
    baseHash: await hashVideoProjectDocument(f.document),
  };
  const page = await readNativeCaptionTrack(f.request, {
    snapshotHash: f.request.baseHash,
    captionItemId: "en",
  });
  expect(page.cues).toEqual([
    {
      cueId: "manual-merged",
      text: "solid pace / 人工修正",
      startMs: 0,
      endMs: 7000,
    },
  ]);
});
it("binds cursors to snapshot, track and scope while allowing linked readable caption families", async () => {
  const f = await fixture(),
    first = await readNativeCaptionTrack(f.request, {
      snapshotHash: f.request.baseHash,
      captionItemId: "en",
    });
  await expect(
    readNativeCaptionTrack(f.request, {
      snapshotHash: f.request.baseHash,
      captionItemId: "zh",
      cursor: first.coverage.nextCursor,
    }),
  ).rejects.toThrow(/cursor/);
  const selected = {
    ...f.request,
    authoring: {
      version: 1 as const,
      scope: { kind: "selection" as const, itemIds: ["en"] },
    },
  };
  expect(
    (
      await readNativeCaptionTrack(selected, {
        snapshotHash: f.request.baseHash,
        captionItemId: "zh",
      })
    ).track.captionItemId,
  ).toBe("zh");
  await expect(
    readNativeCaptionTrack(selected, {
      snapshotHash: f.request.baseHash,
      captionItemId: "en",
      cursor: first.coverage.nextCursor,
    }),
  ).rejects.toThrow(/cursor/);
  const empty = {
    ...f.request,
    authoring: {
      version: 1 as const,
      scope: { kind: "selection" as const, itemIds: [] },
    },
  };
  await expect(
    readNativeCaptionTrack(empty, {
      snapshotHash: f.request.baseHash,
      captionItemId: "en",
    }),
  ).rejects.toThrow(/scope/);
});
it("rejects changed manual text, malformed cursors and unavailable caption identity", async () => {
  const f = await fixture(),
    first = await readNativeCaptionTrack(f.request, {
      snapshotHash: f.request.baseHash,
      captionItemId: "en",
    });
  f.document.items.find((item) => item.id === "en")!.caption!.cues[0].text =
    "new correction";
  const changed = {
    ...f.request,
    document: f.document,
    baseHash: await hashVideoProjectDocument(f.document),
  };
  await expect(
    readNativeCaptionTrack(changed, {
      snapshotHash: changed.baseHash,
      captionItemId: "en",
      cursor: first.coverage.nextCursor,
    }),
  ).rejects.toThrow(/cursor/);
  await expect(
    readNativeCaptionTrack(changed, {
      snapshotHash: changed.baseHash,
      captionItemId: "en",
      cursor: "forged",
    }),
  ).rejects.toThrow(/cursor/);
  await expect(
    readNativeCaptionTrack(changed, {
      snapshotHash: changed.baseHash,
      captionItemId: "speech",
    }),
  ).rejects.toThrow(/caption track/);
});
