import { describe, expect, it } from "vitest";
import {
  createVideoProjectDocument,
  parseVideoProjectDocument,
} from "./document";
import {
  buildVideoProjectRevertCommands,
  executeVideoProjectCommands,
  rebaseVideoProjectCommands,
  type VideoProjectCommand,
} from "./commands";

function fixture() {
  const doc = createVideoProjectDocument({ durationInFrames: 600 });
  doc.assets.video = {
    id: "video",
    name: "Video",
    source: "local",
    type: "video",
  };
  doc.sources.video = { assetId: "video", revision: "original" };
  doc.items = [
    {
      id: "clip",
      trackId: "visual",
      name: "Clip",
      node: {
        id: "clip",
        type: "video",
        assetId: "video",
        from: 30,
        duration: 300,
        playbackRate: 2,
      },
    },
    {
      id: "title",
      trackId: "visual",
      name: "Title",
      node: {
        id: "title",
        type: "div",
        from: 0,
        duration: 300,
        children: [
          { id: "a", type: "text", text: "A", style: { color: "white" } },
          { id: "b", type: "text", text: "B" },
        ],
      },
    },
  ];
  return parseVideoProjectDocument(doc);
}
const color: VideoProjectCommand = {
  type: "set",
  target: { kind: "node", itemId: "title", nodeId: "a" },
  path: ["style", "color"],
  value: "red",
};
describe("targeted edit reversal", () => {
  it("undoes the agent color edit while preserving intervening manual typing", () => {
    const before = fixture(),
      after = executeVideoProjectCommands(before, [color]).document;
    const current = executeVideoProjectCommands(after, [
      {
        type: "set",
        target: { kind: "node", itemId: "title", nodeId: "a" },
        path: ["text"],
        value: "Manual typing",
      },
    ]).document;
    const inverse = buildVideoProjectRevertCommands(before, after);
    const result = rebaseVideoProjectCommands(after, current, inverse);
    expect(result.ok).toBe(true);
    if (result.ok)
      expect(result.document.items[1]!.node.children![0]).toMatchObject({
        text: "Manual typing",
        style: { color: "white" },
      });
  });
  it("declines an inverse if the user has subsequently edited the same property", () => {
    const before = fixture(),
      after = executeVideoProjectCommands(before, [color]).document;
    const current = executeVideoProjectCommands(after, [
      { ...color, value: "blue" },
    ]).document;
    expect(
      rebaseVideoProjectCommands(
        after,
        current,
        buildVideoProjectRevertCommands(before, after),
      ).ok,
    ).toBe(false);
  });
  it.each<VideoProjectCommand[]>([
    [{ type: "splitItem", id: "clip", frame: 180, newId: "tail" }],
    [{ type: "trimItem", id: "clip", from: 60, duration: 240 }],
    [{ type: "removeItem", id: "clip" }],
    [{ type: "duplicateItem", id: "clip", newId: "copy" }],
    [
      {
        type: "addNode",
        itemId: "title",
        parentNodeId: "title",
        index: 1,
        node: { id: "new", type: "text", text: "Inserted" },
      },
    ],
    [{ type: "removeNode", itemId: "title", nodeId: "a" }],
    [
      {
        type: "reorderNodes",
        itemId: "title",
        parentNodeId: "title",
        ids: ["b", "a"],
      },
    ],
    [{ type: "reorderItems", ids: ["title", "clip"] }],
    [{ type: "set", target: { kind: "format" }, path: ["fps"], value: 60 }],
    [
      {
        type: "addTrack",
        track: {
          id: "other",
          name: "Other",
          kind: "visual",
          hidden: false,
          locked: false,
          muted: false,
        },
      },
      { type: "moveItem", id: "title", from: 60, trackId: "other" },
    ],
  ])(
    "restores precise native editing content for a structural operation %j",
    (...commands) => {
      const before = fixture(),
        after = executeVideoProjectCommands(before, commands).document;
      const inverse = buildVideoProjectRevertCommands(before, after);
      const result = executeVideoProjectCommands(after, inverse).document;
      expect(result.items).toEqual(before.items);
      expect(result.tracks).toEqual(before.tracks);
      expect(result.format).toEqual(before.format);
    },
  );
  it("keeps imported media and transcript evidence available instead of reversing completed work", () => {
    const before = fixture();
    const after = executeVideoProjectCommands(before, [
      {
        type: "addAsset",
        asset: { id: "new", name: "New", type: "image", source: "local" },
      },
      { type: "addSource", source: { assetId: "new", revision: "hash" } },
      {
        type: "addEvidence",
        evidence: {
          id: "e",
          sourceAssetId: "video",
          sourceRevision: "original",
          transcriptHash: "t",
          text: "Hi",
          words: [{ id: "w", text: "Hi", startMs: 0, endMs: 100 }],
        },
      },
      color,
    ]).document;
    const restored = executeVideoProjectCommands(
      after,
      buildVideoProjectRevertCommands(before, after),
    ).document;
    expect(restored.items).toEqual(before.items);
    expect(restored.assets.new).toEqual(after.assets.new);
    expect(restored.evidence.e).toEqual(after.evidence.e);
  });
});

describe("speech and translated-caption edit reversal", () => {
  function linked() {
    const doc = fixture();
    doc.items.push(
      {
        id: "caption",
        trackId: "visual",
        name: "Captions",
        node: { id: "caption", type: "div", from: 30, duration: 300 },
        caption: {
          sourceItemId: "clip",
          pairedItemId: "translated",
          mode: "karaoke",
          direction: "ltr",
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
      },
      {
        id: "translated",
        trackId: "visual",
        name: "Translated",
        node: { id: "translated", type: "div", from: 30, duration: 300 },
        caption: {
          sourceItemId: "clip",
          pairedItemId: "caption",
          mode: "sentence",
          direction: "ltr",
          highlightColor: "yellow",
          role: "translation",
          cues: [{ id: "zh", text: "你好世界", startMs: 1000, endMs: 4000 }],
        },
      },
    );
    doc.evidence.speech = {
      id: "speech",
      sourceAssetId: "video",
      sourceRevision: "original",
      transcriptHash: "t",
      text: "Hello world",
      words: [{ id: "w", text: "Hello", startMs: 2000, endMs: 8000 }],
    };
    return executeVideoProjectCommands(doc, [
      {
        type: "bindSource",
        binding: {
          id: "anchor",
          itemId: "title",
          sourceItemId: "clip",
          sourceAssetId: "video",
          sourceRevision: "original",
          evidenceId: "speech",
          wordIds: ["w"],
          sourceStartMs: 2000,
          sourceEndMs: 8000,
          status: "active",
        },
      },
    ]).document;
  }
  it.each<VideoProjectCommand[]>([
    [{ type: "splitItem", id: "clip", frame: 105, newId: "tail" }],
    [{ type: "trimItem", id: "clip", from: 90, duration: 120 }],
    [{ type: "removeItem", id: "clip" }],
    [
      {
        type: "set",
        target: { kind: "node", itemId: "clip", nodeId: "clip" },
        path: ["playbackRate"],
        value: 1,
      },
    ],
  ])(
    "restores source words, translated cue clocks and bound graphics for %j",
    (...commands) => {
      const before = linked(),
        after = executeVideoProjectCommands(before, commands).document;
      const restored = executeVideoProjectCommands(
        after,
        buildVideoProjectRevertCommands(before, after),
      ).document;
      expect(restored.items).toEqual(before.items);
      expect(restored.bindings).toEqual(before.bindings);
      expect(restored.evidence).toEqual(before.evidence);
    },
  );
});
