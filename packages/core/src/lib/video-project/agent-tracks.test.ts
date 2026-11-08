import { describe, expect, it } from "vitest";
import {
  editorItemKind,
  editorTimelineTracks,
} from "@/lib/editor/timeline-tracks";
import type { EditorItem } from "@/lib/editor/document";
import {
  createVideoProjectDocument,
  parseVideoProjectDocument,
  hashVideoProjectDocument,
} from "./document";
import {
  executeVideoProjectCommands,
  type VideoProjectCommand,
} from "./commands";
import { buildVideoProjectRevertCommands } from "./revert";
import { prepareNativeAgentReview } from "./agent-review";
import { generatedTrackCommands } from "./agent-tracks";

function text(id: string, from = 0): EditorItem {
  return {
    id,
    name: id,
    trackId: "visual",
    node: { id, type: "text", text: id, from, duration: 60 },
  };
}
function caption(id: string, translated = false): EditorItem {
  return {
    ...text(id),
    node: { id, type: "div", from: 0, duration: 60 },
    caption: {
      role: translated ? "translation" : "original",
      language: translated ? "zh" : "en",
      mode: "sentence",
      direction: "ltr",
      highlightColor: "#ffff00",
      cues: [{ id: "cue", text: id, startMs: 0, endMs: 2000 }],
    },
  };
}
const vector = (): EditorItem => ({
  ...text("vector"),
  node: {
    id: "vector",
    type: "shape",
    from: 0,
    duration: 60,
    shape: { kind: "rect" },
    style: { width: 100, height: 100, fill: "#ff0000" },
  },
});
const three = (): EditorItem => ({
  ...text("three"),
  node: {
    id: "three",
    type: "extension",
    from: 0,
    duration: 60,
    extension: {
      name: "dojo.three-scene",
      version: "1.0.0",
      params: {
        camera: {
          kind: "perspective",
          position: { x: 0, y: 0, z: 6 },
          target: { x: 0, y: 0, z: 0 },
        },
        materials: { blue: { color: "#0000ff" } },
        objects: {
          cube: {
            kind: "mesh",
            materialId: "blue",
            geometry: { kind: "box", width: 1, height: 1, depth: 1 },
          },
        },
      },
    },
  },
});

describe("generated timeline track placement", () => {
  it("keeps sequential split footage on its existing mixed lane while separating a new overlay", () => {
    const base = createVideoProjectDocument();
    base.assets.video = {
      id: "video",
      type: "video",
      name: "Video",
      source: "local",
    };
    base.items.push(
      {
        ...text("clip"),
        node: {
          id: "clip",
          type: "video",
          assetId: "video",
          from: 0,
          duration: 180,
          playbackRate: 2,
        },
      },
      text("existing"),
    );
    const split = executeVideoProjectCommands(base, [
      { type: "splitItem", id: "clip", frame: 60, newId: "middle" },
      { type: "splitItem", id: "middle", frame: 120, newId: "tail" },
    ]).document;
    expect(generatedTrackCommands(base, split)).toEqual([]);
    const discontinuous = structuredClone(split);
    discontinuous.items.find(
      (item) => item.id === "tail",
    )!.node.videoStartTime! += 0.1;
    expect(
      generatedTrackCommands(base, discontinuous).some(
        (command) =>
          command.type === "set" &&
          command.target.kind === "item" &&
          command.target.itemId === "tail" &&
          command.path[0] === "trackId",
      ),
    ).toBe(true);
    const proposed = executeVideoProjectCommands(split, [
      { type: "addItem", item: text("overlay") },
    ]).document;
    const arranged = executeVideoProjectCommands(
      proposed,
      generatedTrackCommands(base, proposed),
    ).document;
    expect(
      arranged.items
        .filter((item) => item.node.type === "video")
        .map((item) => item.trackId),
    ).toEqual(["visual", "visual", "visual"]);
    expect(
      arranged.items.find((item) => item.id === "overlay")?.trackId,
    ).not.toBe("visual");
    expect(arranged.items.find((item) => item.id === "existing")).toEqual(
      split.items.find((item) => item.id === "existing"),
    );
  });

  it("replays an Undo comparison without reorganizing the original track arrangement", async () => {
    const original = createVideoProjectDocument();
    original.items.push(text("title"));
    const changed = executeVideoProjectCommands(original, [
      { type: "removeItem", id: "title" },
      {
        type: "addItem",
        item: {
          ...three(),
          id: "title",
          node: { ...three().node, id: "title" },
        },
      },
    ]).document;
    const arranged = executeVideoProjectCommands(
      changed,
      generatedTrackCommands(original, changed),
    ).document;
    const commands = buildVideoProjectRevertCommands(original, arranged);
    const hash = await hashVideoProjectDocument(arranged);
    const review = await prepareNativeAgentReview({
      runId: "undo",
      baseDocument: arranged,
      baseHash: hash,
      proposal: {
        summary: "Undid the selected edit",
        commands,
        changedItemIds: ["title"],
        previewHash: await hashVideoProjectDocument(original),
        impact: "review",
      },
      current: {
        projectId: "project",
        document: arranged,
        revision: 1,
        documentHash: hash,
        sources: [],
        history: { canUndo: true, canRedo: false },
      },
      organizeTracks: false,
    });
    expect(review.afterDocument).toEqual(parseVideoProjectDocument(original));
    expect(
      executeVideoProjectCommands(arranged, review.review.commands).document,
    ).toEqual(review.afterDocument);
  });

  it("separates mixed generated items and binds review, replay and Undo to the same arrangement", async () => {
    const base = createVideoProjectDocument();
    base.assets.video = {
      id: "video",
      type: "video",
      name: "Flight.mp4",
      source: "local",
    };
    base.items.push({
      ...text("footage"),
      node: {
        id: "footage",
        type: "video",
        assetId: "video",
        from: 0,
        duration: 180,
      },
    });
    const commands: VideoProjectCommand[] = [
      caption("original"),
      caption("translated", true),
      text("title"),
      vector(),
      three(),
    ].map((item) => ({ type: "addItem", item }));
    const proposed = executeVideoProjectCommands(base, commands).document;
    const hash = await hashVideoProjectDocument(base);
    const input = {
      runId: "generated",
      baseDocument: base,
      baseHash: hash,
      proposal: {
        commands,
        summary: "Generated scene",
        impact: "direct" as const,
        changedItemIds: proposed.items.slice(1).map((item) => item.id),
        previewHash: await hashVideoProjectDocument(proposed),
      },
      current: {
        projectId: "project",
        document: base,
        revision: 1,
        documentHash: hash,
        sources: [],
        history: { canUndo: true, canRedo: false },
      },
    };
    const first = await prepareNativeAgentReview(input),
      retry = await prepareNativeAgentReview(input);
    expect(first.review.basis).toEqual(retry.review.basis);
    expect(
      executeVideoProjectCommands(base, first.review.commands).document,
    ).toEqual(first.afterDocument);
    const items = first.afterDocument.items;
    expect(new Set(items.map((item) => item.trackId)).size).toBe(6);
    expect(
      editorTimelineTracks(first.afterDocument.tracks).map(
        (track) => track.name,
      ),
    ).toEqual([
      "Translated subtitles",
      "Subtitles",
      "Text",
      "SVG / Vector",
      "Three.js scenes",
      "Video & graphics",
      "Audio",
    ]);
    expect(items[0]).toEqual(parseVideoProjectDocument(base).items[0]);
    expect(items.slice(1).map((item) => item.node)).toEqual(
      proposed.items.slice(1).map((item) => item.node),
    );
    expect(first.afterDocument.format).toEqual(base.format);
    const inverse = buildVideoProjectRevertCommands(base, first.afterDocument);
    expect(
      executeVideoProjectCommands(first.afterDocument, inverse).document,
    ).toEqual(parseVideoProjectDocument(base));
    expect(await hashVideoProjectDocument(base)).toBe(hash);
  });

  it("reuses sequential lanes while separating simultaneous layers and translated languages", () => {
    const base = createVideoProjectDocument();
    const items = [
      text("first"),
      text("next", 60),
      text("overlay"),
      caption("chinese", true),
      {
        ...caption("french", true),
        caption: { ...caption("french", true).caption!, language: "fr" },
        node: { id: "french", type: "div" as const, from: 60, duration: 60 },
      },
    ];
    const proposed = executeVideoProjectCommands(
      base,
      items.map((item) => ({ type: "addItem", item })),
    ).document;
    const result = executeVideoProjectCommands(
      proposed,
      generatedTrackCommands(base, proposed),
    ).document;
    expect(result.items[0]!.trackId).toBe(result.items[1]!.trackId);
    expect(result.items[2]!.trackId).not.toBe(result.items[0]!.trackId);
    expect(result.items[3]!.trackId).not.toBe(result.items[4]!.trackId);
  });

  it("keeps existing mixed tracks, custom edits, and locked rows stable", () => {
    const base = createVideoProjectDocument();
    base.items.push(text("existing"));
    base.tracks[1]!.locked = true;
    const proposed = executeVideoProjectCommands(base, [
      { type: "addItem", item: vector() },
    ]).document;
    const commands = generatedTrackCommands(base, proposed);
    const result = executeVideoProjectCommands(proposed, commands).document;
    expect(result.items[0]).toEqual(parseVideoProjectDocument(base).items[0]);
    expect(result.tracks[1]).toEqual(base.tracks[1]);
    expect(commands.some((command) => command.type === "reorderTracks")).toBe(
      false,
    );
    expect(generatedTrackCommands(base, base)).toEqual([]);
  });

  it("recognizes saved nested vector and Three.js layers independently of filenames", () => {
    expect(
      editorItemKind({
        ...text("nested"),
        node: { id: "nested", type: "div", children: [three().node] },
      }),
    ).toBe("three");
    expect(
      editorItemKind({
        ...text("nested"),
        node: { id: "nested", type: "div", children: [vector().node] },
      }),
    ).toBe("svg");
    expect(editorItemKind({ ...text("label"), name: "three.js.mp4" })).toBe(
      "text",
    );
  });

  it("moves an existing item to its new content type while keeping its identity", () => {
    const base = createVideoProjectDocument();
    base.items.push(text("title"), text("other", 60));
    const replacement = {
      ...three(),
      id: "title",
      node: { ...three().node, id: "title" },
    };
    const proposed = executeVideoProjectCommands(base, [
      { type: "removeItem", id: "title" },
      { type: "addItem", item: replacement },
    ]).document;
    const result = executeVideoProjectCommands(
      proposed,
      generatedTrackCommands(base, proposed),
    ).document;
    expect(result.items.find((item) => item.id === "title")?.trackId).toBe(
      "track:three",
    );
    expect(result.items.find((item) => item.id === "other")).toEqual(
      parseVideoProjectDocument(base).items[1],
    );
  });
});
