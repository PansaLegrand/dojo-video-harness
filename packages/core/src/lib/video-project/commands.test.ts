import { describe, expect, it } from "vitest";
import { editorCaptionPresets } from "@/components/editor/motionforge/editor-caption-presets";
import { compileEditorDocument } from "@/lib/editor/document";
import {
  compileVideoProjectDocument,
  createVideoProjectDocument,
  fromEditorDocument,
  hashVideoProjectDocument,
  parseVideoProjectDocument,
  toEditorDocument,
  type VideoProjectDocument,
} from "./document";
import {
  editorCommandsToVideoCommands,
  executeVideoProjectCommands,
  rebaseVideoProjectCommands,
  type VideoProjectCommand,
} from "./commands";
import { resolveSpeechAnchor } from "./source-clock";

function fixture(): VideoProjectDocument {
  const document = createVideoProjectDocument({ durationInFrames: 600 });
  document.assets.video = {
    id: "video",
    name: "Interview",
    type: "video",
    source: "local",
    durationSeconds: 20,
  };
  document.sources.video = {
    assetId: "video",
    revision: "file-v1",
    contentHash: "a".repeat(64),
  };
  document.items.push(
    {
      id: "clip",
      name: "Clip",
      trackId: "visual",
      node: {
        id: "clip",
        type: "video",
        assetId: "video",
        from: 0,
        duration: 300,
      },
    },
    {
      id: "title",
      name: "Title",
      trackId: "visual",
      node: {
        id: "title",
        type: "div",
        from: 0,
        duration: 300,
        children: [
          {
            id: "heading",
            type: "text",
            text: "Hello",
            style: { color: "#ffffff", fontSize: 50 },
            animations: [
              {
                kind: "keyframes",
                property: "opacity",
                frames: [
                  { frame: 0, value: 0 },
                  { frame: 10, value: 1 },
                ],
              },
            ],
          },
        ],
      },
    },
  );
  return parseVideoProjectDocument(document);
}
const set = (
  nodeId: string,
  path: string[],
  value: unknown,
): VideoProjectCommand => ({
  type: "set",
  target: { kind: "node", itemId: "title", nodeId },
  path,
  value: value as never,
});
function anchored() {
  let document = fixture();
  document.evidence.speech = {
    id: "speech",
    sourceAssetId: "video",
    sourceRevision: "file-v1",
    transcriptHash: "transcript-v1",
    text: "Hello world",
    words: [
      { id: "w1", text: "Hello", startMs: 1000, endMs: 2000 },
      { id: "w2", text: "world", startMs: 2000, endMs: 4000 },
    ],
  };
  const binding = resolveSpeechAnchor(document, {
    id: "anchor",
    itemId: "title",
    sourceItemId: "clip",
    evidenceId: "speech",
    wordIds: ["w1", "w2"],
  });
  document = executeVideoProjectCommands(document, [
    { type: "bindSource", binding },
  ]).document;
  return document;
}
describe("neutral video project command kernel", () => {
  it("retains all native caption presets and generated cue source maps", () => {
    expect(Object.keys(editorCaptionPresets)).toHaveLength(14);
    for (const preset of Object.values(editorCaptionPresets)) {
      const document = fixture();
      document.items.push({
        id: "captions",
        name: "Captions",
        trackId: "visual",
        node: {
          id: "captions",
          type: "div",
          from: 30,
          duration: 120,
          style: { ...preset.style, width: 900, height: 200 },
        },
        caption: {
          cues: [
            {
              id: "cue:one",
              text: "مرحبا 你好 world",
              startMs: 0,
              endMs: 4000,
              words: [
                { text: "مرحبا", startMs: 0, endMs: 1000 },
                { text: "你好", startMs: 1000, endMs: 2000 },
                { text: "world", startMs: 2000, endMs: 4000 },
              ],
            },
          ],
          mode: preset.mode,
          highlightColor: preset.highlightColor,
          highlightStyle: preset.highlightStyle,
          motion: preset.motion,
          direction: "rtl",
        },
      });
      const result = compileVideoProjectDocument(document, {
        video: "blob:fixture",
      });
      expect(result.scene).toEqual(
        compileEditorDocument(toEditorDocument(document), {
          video: "blob:fixture",
        }),
      );
      expect(
        Object.values(result.sourceMap).filter((entry) => entry.cueId),
      ).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            itemId: "captions",
            cueId: "cue:one",
            derived: true,
          }),
        ]),
      );
      expect(() =>
        executeVideoProjectCommands(document, [
          {
            type: "set",
            target: {
              kind: "node",
              itemId: "captions",
              nodeId: "captions:cue:cue:one",
            },
            path: ["text"],
            value: "illegal",
          },
        ]),
      ).toThrow(/derived/);
    }
  });
  it("preserves full native node trees, assets, buses, markers and animations through transient adapters", () => {
    const document = fixture();
    document.audioBuses = { music: { gain: 0.7 } };
    document.markers = { intro: 12 };
    expect(fromEditorDocument(toEditorDocument(document), document)).toEqual(
      document,
    );
    const compiled = compileVideoProjectDocument(document, {
      video: "blob:fixture",
    });
    expect(compiled.sourceMap.heading).toMatchObject({
      itemId: "title",
      nodeId: "heading",
      derived: false,
    });
    expect(
      compiled.scene.nodes.find((node) => node.id === "title")?.children?.[0]
        ?.animations,
    ).toEqual(document.items[1]!.node.children![0]!.animations);
  });
  it("adapts a stale whole-node UI patch to only changed leaves", () => {
    const document = fixture(),
      item = structuredClone(document.items[1]!);
    item.node.children![0]!.style!.color = "#ff0000";
    const commands = editorCommandsToVideoCommands(document, [
      { type: "updateItem", id: item.id, patch: { node: item.node } },
    ]);
    expect(commands).toEqual([set("heading", ["style", "color"], "#ff0000")]);
    const current = executeVideoProjectCommands(document, [
      set("heading", ["text"], "Typing survives"),
    ]).document;
    const rebased = rebaseVideoProjectCommands(document, current, commands);
    expect(rebased.ok).toBe(true);
    if (rebased.ok)
      expect(rebased.document.items[1]!.node.children![0]).toMatchObject({
        text: "Typing survives",
        style: { color: "#ff0000" },
      });
  });
  it("rejects conflicts on the same property without overwriting the UI", () => {
    const base = fixture();
    const current = executeVideoProjectCommands(base, [
      set("heading", ["style", "color"], "#ff0000"),
    ]).document;
    const result = rebaseVideoProjectCommands(base, current, [
      set("heading", ["style", "color"], "#00ff00"),
    ]);
    expect(result).toMatchObject({
      ok: false,
      conflicts: ["items/title/nodes/heading/style/color"],
    });
    expect(current.items[1]!.node.children![0]!.style!.color).toBe("#ff0000");
  });
  it("validates the entire batch atomically and rejects dangerous or identity paths", () => {
    const document = fixture();
    expect(() =>
      executeVideoProjectCommands(document, [
        set("heading", ["text"], "Changed"),
        set("heading", ["style", "color"], "not-a-color"),
      ]),
    ).toThrow();
    expect(document.items[1]!.node.children![0]!.text).toBe("Hello");
    expect(() =>
      executeVideoProjectCommands(document, [set("heading", ["id"], "x")]),
    ).toThrow(/not editable/);
    expect(() =>
      executeVideoProjectCommands(document, [
        set("heading", ["style", "__proto__"], {}),
      ]),
    ).toThrow(/Unsafe/);
  });
  it("explicitly clears nested and root optional paint without clearing unrelated fields", () => {
    const base = fixture();
    base.items[1]!.node.style = {
      textShadow: "1px 2px 3px black",
      opacity: 0.5,
    };
    const result = executeVideoProjectCommands(base, [
      {
        type: "clear",
        target: { kind: "node", itemId: "title", nodeId: "title" },
        path: ["style", "textShadow"],
      },
    ]);
    expect(result.document.items[1]!.node.style).toEqual({ opacity: 0.5 });
    expect(result.document.items[0]!.node.type).toBe("video");
  });
  it("rejects source edits that indirectly modify a locked caption or visualizer track", () => {
    const document = fixture();
    document.tracks.push({
      id: "captions",
      name: "Captions",
      kind: "visual",
      muted: false,
      hidden: false,
      locked: true,
    });
    document.items.push({
      id: "cap",
      name: "Captions",
      trackId: "captions",
      node: { id: "cap", type: "div", from: 0, duration: 300 },
      caption: {
        sourceItemId: "clip",
        direction: "ltr",
        mode: "sentence",
        highlightColor: "yellow",
        cues: [{ id: "cue", text: "Hello", startMs: 0, endMs: 1000 }],
      },
    });
    for (const command of [
      { type: "moveItem", id: "clip", from: 30 },
      { type: "trimItem", id: "clip", from: 30, duration: 240 },
      { type: "removeItem", id: "clip" },
      { type: "splitItem", id: "clip", frame: 150, newId: "tail" },
    ] as VideoProjectCommand[])
      expect(() => executeVideoProjectCommands(document, [command])).toThrow(
        /dependent track/,
      );
  });
  it("permits explicit unlock then edit in a single atomic batch", () => {
    const document = fixture();
    document.tracks[0]!.locked = true;
    const result = executeVideoProjectCommands(document, [
      {
        type: "set",
        target: { kind: "track", trackId: "visual" },
        path: ["locked"],
        value: false,
      },
      set("heading", ["text"], "Unlocked"),
    ]);
    expect(result.document.items[1]!.node.children![0]!.text).toBe("Unlocked");
  });
  it("keeps immutable speech evidence separate from caption display corrections", () => {
    const document = anchored();
    const next = executeVideoProjectCommands(document, [
      set("heading", ["text"], "A better display phrase"),
    ]).document;
    expect(next.evidence).toEqual(document.evidence);
    expect(() =>
      executeVideoProjectCommands(next, [
        {
          type: "addEvidence",
          evidence: { ...document.evidence.speech!, text: "Fiction" },
        },
      ]),
    ).toThrow(/immutable/);
    expect(() =>
      executeVideoProjectCommands(next, [
        {
          type: "addSource",
          source: { ...document.sources.video!, revision: "replacement" },
        },
      ]),
    ).toThrow(/immutable/);
  });
  it("resolves word IDs in source order and rejects model-invented anchor timing", () => {
    const document = anchored();
    expect(() =>
      resolveSpeechAnchor(document, {
        id: "a",
        itemId: "title",
        sourceItemId: "clip",
        evidenceId: "speech",
        wordIds: ["w2", "w1"],
      }),
    ).toThrow(/contiguous/);
    expect(() =>
      executeVideoProjectCommands(document, [
        {
          type: "bindSource",
          binding: { ...document.bindings.anchor!, sourceStartMs: 1200 },
        },
      ]),
    ).toThrow(/timestamps/);
  });
  it("projects anchored graphics through speed and trim on the source clock", () => {
    const document = anchored();
    expect(document.items[1]!.node).toMatchObject({ from: 30, duration: 90 });
    const sped = executeVideoProjectCommands(document, [
      {
        type: "set",
        target: { kind: "node", itemId: "clip", nodeId: "clip" },
        path: ["playbackRate"],
        value: 2,
      },
    ]).document;
    expect(sped.items[1]!.node).toMatchObject({ from: 15, duration: 45 });
    const trimmed = executeVideoProjectCommands(sped, [
      { type: "trimItem", id: "clip", from: 30, duration: 200 },
    ]).document;
    expect(trimmed.items[1]!.node).toMatchObject({ from: 30, duration: 30 });
    expect(trimmed.bindings.anchor).toMatchObject({
      sourceStartMs: 1000,
      sourceEndMs: 4000,
    });
  });
  it("splits a cross-boundary speech graphic into two editable source-linked portions", () => {
    const result = executeVideoProjectCommands(anchored(), [
      { type: "splitItem", id: "clip", frame: 75, newId: "tail" },
    ]).document;
    expect(Object.values(result.bindings)).toHaveLength(2);
    const left = result.items.find((item) => item.id === "title")!;
    const right = result.items.find(
      (item) =>
        item.id !== "title" &&
        Object.values(result.bindings).some(
          (binding) => binding.itemId === item.id,
        ),
    )!;
    expect(left.node).toMatchObject({ from: 30, duration: 45 });
    expect(right.node).toMatchObject({ from: 75, duration: 45 });
    expect(right.node.children?.[0]?.text).toBe("Hello");
    expect(result.evidence.speech!.words[0]!.startMs).toBe(1000);
  });
  it("marks trimmed-out anchors unresolved and omits them from rendering without losing their content", () => {
    const result = executeVideoProjectCommands(anchored(), [
      { type: "trimItem", id: "clip", from: 150, duration: 100 },
    ]).document;
    expect(result.bindings.anchor!.status).toBe("unresolved");
    expect(
      result.items.find((item) => item.id === "title")?.node.children?.[0]
        ?.text,
    ).toBe("Hello");
    expect(
      compileVideoProjectDocument(result, {
        video: "blob:fixture",
      }).scene.nodes.some((node) => node.id === "title"),
    ).toBe(false);
  });
  it("rejects reusing a semantic proposal after its source timing changes", () => {
    const base = anchored();
    const proposal: VideoProjectCommand[] = [
      { type: "bindSource", binding: base.bindings.anchor! },
    ];
    const current = executeVideoProjectCommands(base, [
      { type: "trimItem", id: "clip", from: 30, duration: 270 },
    ]).document;
    expect(rebaseVideoProjectCommands(base, current, proposal).ok).toBe(false);
  });
  it("maintains native FPS rescaling and allows full styled insertion without undefined transport values", () => {
    const base = fixture();
    const commands = editorCommandsToVideoCommands(base, [
      { type: "updateFormat", patch: { fps: 60 } },
    ]);
    const result = executeVideoProjectCommands(base, commands).document;
    expect(result.format.durationInFrames).toBe(1200);
    expect(result.items[0]!.node.duration).toBe(600);
    const item = structuredClone(base.items[1]!);
    item.node.style = { ...editorCaptionPresets.classic!.style };
    expect(() =>
      editorCommandsToVideoCommands(base, [
        { type: "updateItem", id: item.id, patch: { node: item.node } },
      ]),
    ).not.toThrow();
  });
  it("canonical hashing is browser safe and ignores object key ordering", async () => {
    const base = fixture();
    const reordered = {
      ...base,
      sources: {
        video: {
          contentHash: "a".repeat(64),
          revision: "file-v1",
          assetId: "video",
        },
      },
    };
    expect(await hashVideoProjectDocument(base)).toMatch(
      /^sha256:[a-f0-9]{64}$/,
    );
    expect(await hashVideoProjectDocument(base)).toBe(
      await hashVideoProjectDocument(reordered),
    );
  });
});

describe("cloud binding and dependency integrity", () => {
  it("publishes a verified cloud locator without changing source identity and forbids rebind", () => {
    const document = fixture();
    const source = structuredClone(document.sources.video!);
    const commands = editorCommandsToVideoCommands(document, [
      {
        type: "addAsset",
        asset: {
          ...document.assets.video!,
          source: "project",
          assetId: "owned-cloud",
        },
      },
    ]);
    expect(commands).toEqual([
      {
        type: "bindAsset",
        id: "video",
        assetId: "owned-cloud",
        sourceRevision: "file-v1",
      },
    ]);
    const published = executeVideoProjectCommands(document, commands).document;
    expect(published.sources.video).toEqual(source);
    expect(published.assets.video).toMatchObject({
      source: "project",
      assetId: "owned-cloud",
    });
    expect(() =>
      executeVideoProjectCommands(published, [
        {
          type: "bindAsset",
          id: "video",
          assetId: "different",
          sourceRevision: "file-v1",
        },
      ]),
    ).toThrow(/rebound/);
    expect(() =>
      executeVideoProjectCommands(document, [
        {
          type: "bindAsset",
          id: "video",
          assetId: "owned-cloud",
          sourceRevision: "wrong",
        },
      ]),
    ).toThrow(/original/);
  });
  it("blocks semantic unlinking of a locked graphic even when timing would remain unchanged", () => {
    const document = anchored();
    document.tracks[0]!.locked = true;
    expect(() =>
      executeVideoProjectCommands(document, [
        { type: "removeBinding", id: "anchor" },
      ]),
    ).toThrow(/dependent track/);
  });
  it("source deletion removes dependent graphics but retains immutable evidence for reuse", () => {
    const document = anchored();
    const result = executeVideoProjectCommands(document, [
      { type: "removeItem", id: "clip" },
    ]);
    expect(result.document.items).toHaveLength(0);
    expect(result.document.bindings).toEqual({});
    expect(result.document.evidence).toEqual(document.evidence);
    expect(result.document.assets).toEqual(document.assets);
    expect(result.impact).toBe("review");
  });
  it("source map reports visible source ranges for projected word anchors", () => {
    const document = anchored();
    const result = compileVideoProjectDocument(document, {
      video: "blob:test",
    });
    expect(result.sourceMap.title).toMatchObject({
      from: 30,
      duration: 90,
      sourceStartMs: 1000,
      sourceEndMs: 4000,
      bindingId: "anchor",
      evidenceId: "speech",
    });
    expect(result.sourceMap.heading).toMatchObject({
      from: 30,
      duration: 90,
      nodeId: "heading",
      derived: false,
    });
  });
  it("permits unrelated nested edits when sibling graphics are inserted, but detects target deletion", () => {
    const base = fixture();
    const current = executeVideoProjectCommands(base, [
      {
        type: "addNode",
        itemId: "title",
        parentNodeId: "title",
        node: { id: "other", type: "text", text: "Other" },
      },
    ]).document;
    expect(
      rebaseVideoProjectCommands(base, current, [
        set("heading", ["text"], "Revised"),
      ]).ok,
    ).toBe(true);
    const deleted = executeVideoProjectCommands(current, [
      { type: "removeNode", itemId: "title", nodeId: "heading" },
    ]).document;
    expect(
      rebaseVideoProjectCommands(base, deleted, [
        set("heading", ["text"], "Revised"),
      ]).ok,
    ).toBe(false);
  });
  it("keeps speech-derived caption corrections independent of source-time words", () => {
    const base = anchored();
    base.items.push({
      id: "cap",
      name: "Captions",
      trackId: "visual",
      node: { id: "cap", type: "div", from: 0, duration: 300 },
      caption: {
        sourceItemId: "clip",
        direction: "ltr",
        mode: "karaoke",
        highlightColor: "yellow",
        cues: [
          {
            id: "cue",
            text: "Hello world",
            startMs: 1000,
            endMs: 4000,
            words: [
              { text: "Hello", startMs: 1000, endMs: 2000 },
              { text: "world", startMs: 2000, endMs: 4000 },
            ],
          },
        ],
      },
    });
    const corrected = executeVideoProjectCommands(base, [
      {
        type: "set",
        target: { kind: "cue", itemId: "cap", cueId: "cue" },
        path: ["text"],
        value: "Hello, world!",
      },
    ]).document;
    expect(corrected.evidence).toEqual(base.evidence);
    const sped = executeVideoProjectCommands(corrected, [
      {
        type: "set",
        target: { kind: "node", itemId: "clip", nodeId: "clip" },
        path: ["playbackRate"],
        value: 2,
      },
    ]).document;
    expect(
      sped.items.find((item) => item.id === "cap")!.caption!.cues[0],
    ).toMatchObject({
      text: "Hello, world!",
      startMs: 500,
      endMs: 2000,
      words: [
        { startMs: 500, endMs: 1000 },
        { startMs: 1000, endMs: 2000 },
      ],
    });
  });
});

describe("structural rebase dependency closure", () => {
  it("rejects a source deletion proposal when a new speech-linked graphic appeared", () => {
    const base = fixture(),
      current = anchored();
    const result = rebaseVideoProjectCommands(base, current, [
      { type: "removeItem", id: "clip" },
    ]);
    expect(result).toMatchObject({ ok: false });
    if (!result.ok) expect(result.conflicts).toContain("dependents/clip");
  });
  it("rejects gap closure when another tab filled the gap with a new clip", () => {
    const base = fixture();
    base.items[0]!.node.from = 90;
    base.items[1]!.trackId = "audio";
    const current = executeVideoProjectCommands(base, [
      {
        type: "addItem",
        item: {
          id: "new",
          name: "New",
          trackId: "visual",
          node: { id: "new", type: "div", from: 0, duration: 30 },
        },
      },
    ]).document;
    expect(
      rebaseVideoProjectCommands(base, current, [
        { type: "removeGap", trackId: "visual", frame: 40 },
      ]),
    ).toMatchObject({
      ok: false,
      conflicts: expect.arrayContaining(["trackItems/visual"]),
    });
  });
  it("rejects dangling caption source references", () => {
    const document = fixture();
    document.items.push({
      id: "cap",
      name: "Captions",
      trackId: "visual",
      node: { id: "cap", type: "div", from: 0, duration: 100 },
      caption: {
        mode: "sentence",
        direction: "ltr",
        highlightColor: "yellow",
        sourceItemId: "absent",
        cues: [],
      },
    });
    expect(() => parseVideoProjectDocument(document)).toThrow(/existing media/);
  });
});

describe("source property clear semantics", () => {
  it("clearing the media source offset reprojects captions from its original source clock", () => {
    const base = fixture();
    base.items[0]!.node.videoStartTime = 2;
    base.items.push({
      id: "cap",
      name: "Captions",
      trackId: "visual",
      node: { id: "cap", type: "div", from: 0, duration: 300 },
      caption: {
        sourceItemId: "clip",
        direction: "ltr",
        mode: "sentence",
        highlightColor: "yellow",
        cues: [
          {
            id: "cue",
            text: "At source three seconds",
            startMs: 1000,
            endMs: 2000,
          },
        ],
      },
    });
    const changed = executeVideoProjectCommands(base, [
      {
        type: "clear",
        target: { kind: "node", itemId: "clip", nodeId: "clip" },
        path: ["videoStartTime"],
      },
    ]).document;
    expect(changed.items[0]!.node.videoStartTime).toBeUndefined();
    expect(changed.items[2]!.caption!.cues[0]).toMatchObject({
      startMs: 3000,
      endMs: 4000,
    });
  });
});

it("rejects a raw source-duration edit when its dependent caption track is locked", () => {
  const doc = fixture();
  doc.tracks.push({
    id: "locked-captions",
    name: "Locked captions",
    kind: "visual",
    hidden: false,
    muted: false,
    locked: true,
  });
  doc.items.push({
    id: "cap",
    name: "Caption",
    trackId: "locked-captions",
    node: { id: "cap", type: "div", from: 0, duration: 300 },
    caption: {
      sourceItemId: "clip",
      mode: "sentence",
      direction: "ltr",
      highlightColor: "yellow",
      cues: [{ id: "cue", text: "Speech", startMs: 0, endMs: 1000 }],
    },
  });
  expect(() =>
    executeVideoProjectCommands(doc, [
      {
        type: "set",
        target: { kind: "node", itemId: "clip", nodeId: "clip" },
        path: ["duration"],
        value: 150,
      },
    ]),
  ).toThrow(/dependent track/);
  expect(doc.items[0]!.node.duration).toBe(300);
});
