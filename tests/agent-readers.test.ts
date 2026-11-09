import { expect, it } from "vitest";
import {
  createVideoProjectDocument,
  hashVideoProjectDocument,
  parseVideoProjectDocument,
} from "../packages/core/src/lib/video-project/document";
import type { NativeAgentRequest } from "../packages/core/src/lib/video-project/agent-runtime";
import {
  listNativeAssets,
  readNativeCaptionCues,
  NATIVE_READER_LIMITS,
} from "../packages/core/src/lib/video-project/agent-readers";
import { captionSourceCommands } from "../packages/core/src/lib/video-project/semantic";
import { createVideoToolset } from "../packages/agent/src/tools";
import { builtInSkills } from "../packages/agent-kit/src/index";
const byteLength = (v: unknown) =>
  new TextEncoder().encode(JSON.stringify(v)).byteLength;
async function request(
  document: ReturnType<typeof createVideoProjectDocument>,
): Promise<NativeAgentRequest> {
  document = parseVideoProjectDocument(document);
  return {
    contract: "video-project-commands",
    version: 1,
    baseRevision: 1,
    baseHash: await hashVideoProjectDocument(document),
    document,
    context: { selectedItemIds: [], playheadFrame: 0 },
    authoring: { version: 1, scope: { kind: "project" } },
  };
}
async function assets(count: number, longNames = false) {
  const document = createVideoProjectDocument({
    width: 640,
    height: 360,
    fps: 30,
    durationInFrames: 600,
  });
  for (let i = count - 1; i >= 0; i--) {
    const id = `asset-${String(i).padStart(4, "0")}`;
    document.assets[id] = {
      id,
      name: longNames
        ? "图".repeat(500)
        : i < 2
          ? "Repeated photo.jpg"
          : `Photo ${i}.jpg`,
      type: "image",
      source: "local",
      width: 1920,
      height: 1080,
    };
    if (i % 2 === 0)
      document.sources[id] = { assetId: id, revision: `original-${i}` };
  }
  if (count)
    document.items.push({
      id: "used",
      name: "Used photo",
      trackId: "visual",
      node: {
        id: "used",
        type: "img",
        assetId: "asset-0000",
        from: 0,
        duration: 60,
      },
    });
  return request(document);
}
async function speech(count: number, sources = 1, cjk = false) {
  const document = createVideoProjectDocument({
    width: 640,
    height: 360,
    fps: 30,
    durationInFrames: Math.max(1, count * 120 * sources),
  });
  for (let s = 0; s < sources; s++) {
    const asset = `speech-${s}`,
      clip = `clip-${s}`,
      evidence = `evidence-${s}`;
    document.assets[asset] = {
      id: asset,
      name: `Interview ${s}`,
      type: "video",
      source: "local",
      durationSeconds: count * 4,
    };
    document.sources[asset] = { assetId: asset, revision: `original-${s}` };
    document.items.push({
      id: clip,
      name: `Interview ${s}`,
      trackId: "visual",
      node: {
        id: clip,
        type: "video",
        assetId: asset,
        from: s * count * 120,
        duration: count * 120,
      },
    });
    const words = Array.from({ length: count }, (_, i) => ({
      id: `word-${s}-${i}`,
      text: cjk ? `${"字".repeat(150)}。` : `Sentence${i}.`,
      startMs: i * 4000,
      endMs: i * 4000 + 3000,
    }));
    document.evidence[evidence] = {
      id: evidence,
      sourceAssetId: asset,
      sourceRevision: `original-${s}`,
      transcriptHash: `transcript-${s}`,
      language: cjk ? "zh" : "en",
      text: words.map((w) => w.text).join(" "),
      words,
    };
  }
  return request(document);
}
async function allAssets(r: NativeAgentRequest, filter: object = {}) {
  const result: Awaited<ReturnType<typeof listNativeAssets>>["assets"] = [];
  let cursor: string | undefined,
    calls = 0;
  do {
    const page = await listNativeAssets(r, {
      snapshotHash: r.baseHash,
      ...filter,
      ...(cursor ? { cursor } : {}),
    });
    expect(byteLength(page)).toBeLessThanOrEqual(
      NATIVE_READER_LIMITS.assetBytes,
    );
    expect(page.coverage.offset).toBe(result.length);
    expect(page.coverage.returned).toBe(page.assets.length);
    result.push(...page.assets);
    cursor = page.coverage.nextCursor ?? undefined;
    expect(page.coverage.complete).toBe(!cursor);
    expect(++calls).toBeLessThan(100);
  } while (cursor);
  return result;
}
async function allCues(r: NativeAgentRequest, source = 0) {
  const result: Awaited<ReturnType<typeof readNativeCaptionCues>>["cues"] = [];
  let cursor: string | undefined,
    calls = 0;
  do {
    const page = await readNativeCaptionCues(r, {
      snapshotHash: r.baseHash,
      sourceItemId: `clip-${source}`,
      evidenceId: `evidence-${source}`,
      ...(cursor ? { cursor } : {}),
    });
    expect(byteLength(page)).toBeLessThanOrEqual(NATIVE_READER_LIMITS.cueBytes);
    expect(page.coverage.offset).toBe(result.length);
    result.push(...page.cues);
    cursor = page.coverage.nextCursor ?? undefined;
    expect(page.coverage.complete).toBe(!cursor);
    expect(++calls).toBeLessThan(100);
  } while (cursor);
  return result;
}

it.each([0, 1, 50, 51, 300, 301])(
  "pages all %s imported assets exactly once in stable ID order",
  async (count) => {
    const r = await assets(count),
      before = JSON.stringify(r);
    const result = await allAssets(r);
    expect(result.map((a) => a.id)).toEqual(
      Array.from(
        { length: count },
        (_, i) => `asset-${String(i).padStart(4, "0")}`,
      ),
    );
    expect(new Set(result.map((a) => a.id)).size).toBe(count);
    expect(JSON.stringify(result)).not.toMatch(
      /private.invalid|credential|secret|src/,
    );
    expect(JSON.stringify(r)).toBe(before);
  },
);
it("filters exact metadata without conflating duplicate names and retains unused assets under selection scope", async () => {
  const r = await assets(52);
  r.authoring!.scope = { kind: "selection", itemIds: ["used"] };
  const repeated = await allAssets(r, {
    name: "REPEATED PHOTO",
    type: "image",
  });
  expect(repeated.map((a) => a.id)).toEqual(["asset-0000", "asset-0001"]);
  expect(repeated[0]).toMatchObject({
    used: true,
    usageCount: 1,
    source: { status: "local_required" },
  });
  expect(repeated[1]).toMatchObject({
    used: false,
    usageCount: 0,
    source: { status: "unregistered" },
  });
  expect((await allAssets(r, { usage: "unused" })).length).toBe(51);
  expect((await allAssets(r, { usage: "used" })).map((a) => a.id)).toEqual([
    "asset-0000",
  ]);
  expect(await allAssets(r, { name: "another owner's asset" })).toEqual([]);
});
it("counts nested media uses and reports bounded per-asset usage references", async () => {
  const r = await assets(1),
    doc = parseVideoProjectDocument(r.document);
  for (let i = 0; i < 15; i++)
    doc.items.push({
      id: `nested-${i}`,
      name: "Nested",
      trackId: "visual",
      node: {
        id: `nested-${i}`,
        type: "div",
        from: 0,
        duration: 30,
        children: [
          { id: `nested-image-${i}`, type: "img", assetId: "asset-0000" },
        ],
      },
    });
  const rows = await allAssets(await request(doc));
  expect(rows[0]).toMatchObject({ usageCount: 16, omittedUsageItems: 8 });
  expect(rows[0]!.usedInItemIds.length).toBe(8);
});
it("enforces UTF-8 page bounds while making progress through long CJK asset names", async () => {
  const r = await assets(51, true),
    first = await listNativeAssets(r, { snapshotHash: r.baseHash });
  expect(first.assets.length).toBeGreaterThan(0);
  expect(first.assets.length).toBeLessThan(50);
  expect((await allAssets(r)).length).toBe(51);
});
it("rejects malformed, cross-filter, cross-scope and stale asset cursors", async () => {
  const r = await assets(51),
    page = await listNativeAssets(r, { snapshotHash: r.baseHash });
  const cursor = page.coverage.nextCursor!;
  for (const patch of [
    { cursor: "invented" },
    { cursor: cursor.replace("assets", "cues") },
    { cursor, name: "Photo" },
    { cursor, usage: "unused" },
    { snapshotHash: "sha256:" + "0".repeat(64) },
  ])
    await expect(
      listNativeAssets(r, { snapshotHash: r.baseHash, ...patch }),
    ).rejects.toThrow();
  await expect(
    listNativeAssets(
      {
        ...r,
        authoring: {
          version: 1,
          scope: { kind: "selection", itemIds: ["used"] },
        },
      },
      { snapshotHash: r.baseHash, cursor },
    ),
  ).rejects.toThrow(/cursor/);
  const doc = parseVideoProjectDocument(r.document);
  doc.assets["asset-0000"]!.name = "Changed";
  const changed = await request(doc);
  await expect(
    listNativeAssets(changed, { snapshotHash: changed.baseHash, cursor }),
  ).rejects.toThrow(/cursor/);
  await expect(
    listNativeAssets({ ...r, document: doc }, { snapshotHash: r.baseHash }),
  ).rejects.toThrow(/snapshot/);
});
it.each([199, 200, 201, 500, 501])(
  "retrieves all %s host cues and genuine word IDs exactly",
  async (count) => {
    const r = await speech(count),
      before = JSON.stringify(r),
      result = await allCues(r);
    expect(result.map((c) => c.cueId)).toEqual(
      Array.from({ length: count }, (_, i) => `cue:${i}`),
    );
    expect(result.flatMap((c) => c.wordIds)).toEqual(
      Array.from({ length: count }, (_, i) => `word-0-${i}`),
    );
    const doc = parseVideoProjectDocument(r.document);
    const expected = captionSourceCommands(doc, {
      sourceItemId: "clip-0",
      evidenceId: "evidence-0",
      itemId: "expected",
      trackId: "visual",
      phraseSafe: true,
    }).find((c) => c.type === "addItem");
    if (expected?.type !== "addItem") throw new Error("fixture");
    expect(result.map(({ wordIds, ...cue }) => cue)).toEqual(
      expected.item.caption!.cues.map(({ id, text, startMs, endMs }) => ({
        cueId: id,
        text,
        startMs,
        endMs,
      })),
    );
    expect(JSON.stringify(r)).toBe(before);
  },
);
it("retrieves source thirteen independently of the initial twelve-source packet", async () => {
  const r = await speech(2, 13),
    result = await allCues(r, 12);
  expect(result.flatMap((c) => c.wordIds)).toEqual(["word-12-0", "word-12-1"]);
});
it("pages CJK text under byte bounds with complete source coverage", async () => {
  const r = await speech(201, 1, true),
    first = await readNativeCaptionCues(r, {
      snapshotHash: r.baseHash,
      sourceItemId: "clip-0",
      evidenceId: "evidence-0",
    });
  expect(first.cues.length).toBeGreaterThan(0);
  expect(first.cues.length).toBeLessThan(100);
  expect((await allCues(r)).length).toBe(201);
});
it("enforces source/evidence/scope bindings and readable caption-parent access", async () => {
  const r = await speech(201, 2),
    page = await readNativeCaptionCues(r, {
      snapshotHash: r.baseHash,
      sourceItemId: "clip-0",
      evidenceId: "evidence-0",
    });
  const cursor = page.coverage.nextCursor!;
  await expect(
    readNativeCaptionCues(r, {
      snapshotHash: r.baseHash,
      sourceItemId: "clip-1",
      evidenceId: "evidence-1",
      cursor,
    }),
  ).rejects.toThrow(/cursor/);
  await expect(
    readNativeCaptionCues(r, {
      snapshotHash: r.baseHash,
      sourceItemId: "clip-0",
      evidenceId: "evidence-1",
    }),
  ).rejects.toThrow(/identity/);
  const restricted = {
    ...r,
    authoring: {
      version: 1 as const,
      scope: { kind: "selection" as const, itemIds: ["clip-1"] },
    },
  };
  await expect(
    readNativeCaptionCues(restricted, {
      snapshotHash: r.baseHash,
      sourceItemId: "clip-0",
      evidenceId: "evidence-0",
    }),
  ).rejects.toThrow(/scope/);
  const doc = parseVideoProjectDocument(r.document);
  doc.items.push({
    id: "captions",
    name: "Captions",
    trackId: "visual",
    node: { id: "captions", type: "div", from: 0, duration: 24120 },
    caption: {
      mode: "sentence",
      highlightColor: "#ffffff",
      direction: "ltr",
      sourceItemId: "clip-0",
      cues: [{ id: "c", text: "Hello", startMs: 0, endMs: 1000 }],
    },
  });
  const linked = await request(doc);
  linked.authoring!.scope = { kind: "selection", itemIds: ["captions"] };
  expect(
    (
      await readNativeCaptionCues(linked, {
        snapshotHash: linked.baseHash,
        sourceItemId: "clip-0",
        evidenceId: "evidence-0",
      })
    ).cues.length,
  ).toBe(100);
  await expect(
    readNativeCaptionCues(linked, {
      snapshotHash: linked.baseHash,
      sourceItemId: "clip-0",
      evidenceId: "evidence-0",
      cursor,
    }),
  ).rejects.toThrow(/cursor/);
});
it("uses trimmed/rate-adjusted source clocks while preserving original word identities", async () => {
  const r = await speech(8),
    doc = parseVideoProjectDocument(r.document);
  doc.items[0]!.node.videoStartTime = 4;
  doc.items[0]!.node.playbackRate = 2;
  doc.items[0]!.node.duration = 180;
  const trimmed = await request(doc),
    rows = await allCues(trimmed);
  expect(rows.flatMap((c) => c.wordIds)).toEqual([
    "word-0-1",
    "word-0-2",
    "word-0-3",
  ]);
  expect(rows[0]).toMatchObject({ startMs: 0, endMs: 1500 });
});
it("runs both readers through the actual registered new-profile tool path and preserves partial coverage", async () => {
  const r = await speech(201),
    tools = createVideoToolset(r, builtInSkills(), [], {
      profile: "local-editor-v3",
    });
  expect(tools.inventory).toMatchObject({
    kitVersion: "0.1.3",
    profile: "local-editor-v3",
  });
  const read = tools.tools.find((t) => t.name === "read_caption_cues")!;
  const first = await read.execute(
    {
      snapshotHash: r.baseHash,
      sourceItemId: "clip-0",
      evidenceId: "evidence-0",
    },
    new AbortController().signal,
  );
  expect(first).toMatchObject({
    kind: "observation",
    pinned: true,
    value: { coverage: { total: 201, returned: 100, complete: false } },
  });
  if (first.kind !== "observation") throw new Error("fixture");
  const final = await read.execute(
    {
      snapshotHash: r.baseHash,
      sourceItemId: "clip-0",
      evidenceId: "evidence-0",
      cursor: (
        await readNativeCaptionCues(r, {
          snapshotHash: r.baseHash,
          sourceItemId: "clip-0",
          evidenceId: "evidence-0",
          cursor: (first.value as { coverage: { nextCursor: string } }).coverage
            .nextCursor,
        })
      ).coverage.nextCursor,
    },
    new AbortController().signal,
  );
  expect(final).toMatchObject({
    kind: "observation",
    value: { cues: [{ cueId: "cue:200" }], coverage: { complete: true } },
  });
  await expect(
    read.execute(
      {
        snapshotHash: r.baseHash,
        sourceItemId: "clip-0",
        evidenceId: "evidence-0",
        unexpected: true,
      },
      new AbortController().signal,
    ),
  ).rejects.toThrow(/Unknown tool field/);
});
