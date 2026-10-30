import { describe, expect, it } from "vitest";
import { evaluateScene } from "@dojo-video-engine/core";
import { mixSceneAudioData } from "@dojo-video-engine/export";
import {
  createVideoProjectDocument,
  parseVideoProjectDocument,
  canonicalSerialize,
  hashVideoProjectDocument,
} from "./document";
import { compileVideoProjectDocument } from "./compilation";
import {
  executeVideoProjectCommands,
  rebaseVideoProjectCommands,
} from "./commands";
import { buildVideoProjectRevertCommands } from "./revert";
import type { EditorTransition } from "@/lib/editor/composition-schema";
const sources = { a: "blob:a", b: "blob:b" };
function fixture() {
  const document = createVideoProjectDocument({
    width: 320,
    height: 180,
    fps: 30,
    durationInFrames: 180,
    backgroundColor: "#123456",
  });
  for (const id of ["a", "b"]) {
    document.assets[id] = {
      id,
      source: "project",
      type: "video",
      name: id,
      durationSeconds: 5,
    };
    document.sources[id] = { assetId: id, revision: "source1" };
  }
  document.items = [
    {
      id: "left",
      name: "Left",
      trackId: "visual",
      node: {
        id: "left",
        type: "video",
        assetId: "a",
        from: 30,
        duration: 60,
        videoStartTime: 0.5,
        volume: 0.3,
        style: {
          position: "absolute",
          left: 0,
          top: 0,
          width: 320,
          height: 180,
          objectFit: "contain",
        },
      },
    },
    {
      id: "right",
      name: "Right",
      trackId: "visual",
      node: {
        id: "right",
        type: "video",
        assetId: "b",
        from: 90,
        duration: 60,
        videoStartTime: 1,
        volume: 0.7,
        style: {
          position: "absolute",
          left: 0,
          top: 0,
          width: 320,
          height: 180,
          objectFit: "contain",
        },
      },
    },
  ];
  return parseVideoProjectDocument(document);
}
const transition = (
  patch: Partial<EditorTransition> = {},
): EditorTransition => ({
  id: "cut",
  fromItemId: "left",
  toItemId: "right",
  kind: "dissolve",
  durationFrames: 30,
  audio: "pictureOnly",
  ...patch,
});
function withTransition(patch: Partial<EditorTransition> = {}) {
  return executeVideoProjectCommands(fixture(), [
    { type: "setTransition", transition: transition(patch) },
  ]).document;
}
function linkedFixture() {
  const document = fixture();
  document.tracks.push({
    id: "captions",
    name: "Captions",
    kind: "visual",
    muted: false,
    hidden: false,
    locked: false,
  });
  document.items.push({
    id: "caption",
    name: "Captions",
    trackId: "captions",
    node: { id: "caption", type: "div", from: 30, duration: 60 },
    caption: {
      sourceItemId: "left",
      mode: "sentence",
      direction: "ltr",
      highlightColor: "#ffff00",
      cues: [{ id: "cue", text: "Hello", startMs: 0, endMs: 2000 }],
    },
  });
  document.items.push({
    id: "translation",
    name: "Translation",
    trackId: "captions",
    node: { id: "translation", type: "div", from: 30, duration: 60 },
    caption: {
      sourceItemId: "left",
      pairedItemId: "caption",
      role: "translation",
      language: "es",
      mode: "sentence",
      direction: "ltr",
      highlightColor: "#ffff00",
      cues: [{ id: "cue", text: "Hola", startMs: 0, endMs: 2000 }],
    },
  });
  document.items.push({
    id: "badge",
    name: "Speech badge",
    trackId: "captions",
    node: { id: "badge", type: "text", text: "Hello", from: 45, duration: 15 },
  });
  document.bindings.anchor = {
    id: "anchor",
    itemId: "badge",
    sourceItemId: "left",
    sourceAssetId: "a",
    sourceRevision: "source1",
    sourceStartMs: 1000,
    sourceEndMs: 1500,
    status: "active",
  };
  return parseVideoProjectDocument(document);
}
describe("optional composition document contracts", () => {
  it("does not materialize new keys or change pre-composition hashes/compilation", async () => {
    const document = fixture(),
      serialized = canonicalSerialize(document),
      hash = await hashVideoProjectDocument(document);
    const parsed = parseVideoProjectDocument(JSON.parse(serialized));
    expect(Object.hasOwn(parsed, "transitions")).toBe(false);
    expect(Object.hasOwn(parsed, "linkedGroups")).toBe(false);
    expect(canonicalSerialize(parsed)).toBe(serialized);
    expect(await hashVideoProjectDocument(parsed)).toBe(hash);
    expect(compileVideoProjectDocument(parsed, sources).scene).toEqual(
      compileVideoProjectDocument(document, sources).scene,
    );
  });
  it("requires explicit audio semantics and rejects malformed composition membership", () => {
    const document = fixture();
    expect(() =>
      parseVideoProjectDocument({
        ...document,
        transitions: { cut: { ...transition(), audio: undefined } },
      }),
    ).toThrow();
    expect(() =>
      parseVideoProjectDocument({ ...document, transitions: {} }),
    ).toThrow(/empty transition/);
    expect(() =>
      parseVideoProjectDocument({
        ...document,
        linkedGroups: { g: { id: "other", itemIds: ["left", "right"] } },
      }),
    ).toThrow(/key and ID/);
    expect(() =>
      parseVideoProjectDocument({
        ...document,
        linkedGroups: { g: { id: "g", itemIds: ["left", "missing"] } },
      }),
    ).toThrow(/missing clip/);
  });
});
describe("persistent clip transitions", () => {
  it.each(["dissolve", "dipToBlack"] as const)(
    "keeps authoring IDs, ranges and project duration for %s",
    (kind) => {
      const before = fixture(),
        after = executeVideoProjectCommands(before, [
          { type: "setTransition", transition: transition({ kind }) },
        ]).document;
      expect(after.items).toEqual(before.items);
      expect(after.sources).toEqual(before.sources);
      expect(after.format).toEqual(before.format);
      const compiled = compileVideoProjectDocument(after, sources);
      for (const item of before.items)
        expect(
          compiled.scene.nodes.find((node) => node.id === item.id),
        ).toMatchObject({
          id: item.id,
          from: item.node.from,
          duration: item.node.duration,
          videoStartTime: item.node.videoStartTime,
          volume: item.node.volume,
        });
      expect(compiled.scene.duration).toBe(180);
    },
  );
  it("isolates the incoming flattened picture and keeps the outgoing picture opaque", () => {
    const scene = compileVideoProjectDocument(withTransition(), sources).scene;
    for (const frame of [75, 80, 89, 90, 97, 104]) {
      const active = evaluateScene(scene, frame).nodes.filter(
        (node) => node.type === "video",
      );
      expect(active).toHaveLength(2);
      const outgoing = active.find((node) => node.assetId === "a")!,
        incoming = active.find((node) => node.assetId === "b")!;
      expect(outgoing.style.opacity).toBe(1);
      expect(incoming.style.opacity).toBeCloseTo((frame - 75) / 30, 12);
      expect(incoming.style.isolation).toBe(true);
      expect(outgoing.style.isolation).toBe(true);
      expect(incoming.style.backgroundColor).toBe("#123456");
    }
    expect(
      evaluateScene(scene, 105).nodes.filter((node) => node.type === "video"),
    ).toHaveLength(1);
  });
  it("maps derived handles back to canonical endpoints and actual source windows", () => {
    const compiled = compileVideoProjectDocument(withTransition(), sources);
    const handles = Object.entries(compiled.sourceMap).filter(
      ([, value]) => value.transitionId === "cut",
    );
    expect(handles).toHaveLength(2);
    expect(handles.map(([, value]) => value)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          itemId: "left",
          nodeId: "left",
          derived: true,
          from: 90,
          duration: 15,
          sourceAssetId: "a",
          sourceStartMs: 2500,
          sourceEndMs: 3000,
        }),
        expect.objectContaining({
          itemId: "right",
          nodeId: "right",
          derived: true,
          from: 75,
          duration: 15,
          sourceAssetId: "b",
          sourceStartMs: 500,
          sourceEndMs: 1000,
        }),
      ]),
    );
    expect(compiled.assetSourceMap).toEqual({ a: "a", b: "b" });
  });
  it("keeps original picture-only audio envelopes, panning, buses and ducking intact", () => {
    const document = fixture();
    document.audioBuses = { music: { gain: 0.7 } };
    document.items[0]!.node.volumeEnvelope = [
      { frame: 0, value: 0.4 },
      { frame: 59, value: 0.8 },
    ];
    document.items[0]!.node.pan = -0.3;
    document.items[0]!.node.ducks = {
      bus: "music",
      gain: 0.2,
      attackFrames: 3,
      releaseFrames: 4,
    };
    const next = executeVideoProjectCommands(document, [
      { type: "setTransition", transition: transition() },
    ]).document;
    const scene = compileVideoProjectDocument(next, sources).scene;
    for (const item of document.items) {
      const node = scene.nodes.find((node) => node.id === item.id)!;
      for (const field of [
        "volume",
        "volumeEnvelope",
        "pan",
        "audioBus",
        "ducks",
        "videoStartTime",
        "from",
        "duration",
      ] as const)
        expect(node[field]).toEqual(item.node[field]);
    }
    const handles = scene.nodes.filter(
      (node) => node.type === "video" && !["left", "right"].includes(node.id),
    );
    handles.forEach((node) => {
      expect(node.volume).toBe(0);
      expect(node.ducks).toBeUndefined();
      expect(node.volumeEnvelope).toBeUndefined();
    });
  });
  it.each(["dissolve", "dipToBlack"] as const)(
    "adds only explicit linear audio crossfade handles for %s",
    (kind) => {
      const scene = compileVideoProjectDocument(
        withTransition({ kind, audio: "crossfade" }),
        sources,
      ).scene;
      expect(scene.nodes.find((node) => node.id === "left")!.volume).toBe(0.3);
      expect(scene.nodes.find((node) => node.id === "right")!.volume).toBe(0.7);
      expect(
        scene.nodes.find((node) => node.id === "left")!.volumeEnvelope,
      ).toEqual([
        { frame: 0, value: 1 },
        { frame: 45, value: 1 },
        { frame: 60, value: 0.5 },
      ]);
      expect(
        scene.nodes.find((node) => node.id === "right")!.volumeEnvelope,
      ).toEqual([
        { frame: 0, value: 0.5 },
        { frame: 15, value: 1 },
      ]);
      const handles = scene.nodes.filter(
        (node) => node.type === "video" && !["left", "right"].includes(node.id),
      );
      expect(handles).toHaveLength(2);
      expect(handles.map((node) => node.volume).sort()).toEqual([0.3, 0.7]);
      if (kind === "dipToBlack")
        handles.forEach((node) => expect(node.style?.opacity).toBe(0));
    },
  );
  it.each(["dissolve", "dipToBlack"] as const)(
    "matches independent PCM gain/source-time math without codec seeking for %s",
    async (kind) => {
      const scene = compileVideoProjectDocument(
        withTransition({ kind, audio: "crossfade" }),
        sources,
      ).scene;
      const sampleRate = 48000;
      const audio = (frequency: number) => ({
        duration: 5,
        sampleRate,
        numberOfChannels: 1,
        sink: {
          async *samples(start: number, end: number) {
            const numberOfFrames = Math.round((end - start) * sampleRate);
            yield {
              timestamp: start,
              numberOfFrames,
              numberOfChannels: 1,
              copyTo(values: Float32Array) {
                for (let i = 0; i < values.length; i++)
                  values[i] =
                    0.2 *
                    Math.sin(
                      (start + i / sampleRate) * Math.PI * 2 * frequency,
                    );
              },
              close() {},
            };
          },
        },
      });
      const assets = {
        videos: new Map([
          ["a", { audio: audio(220) }],
          ["b", { audio: audio(440) }],
        ]),
        audio: new Map(),
      } as unknown as Parameters<typeof mixSceneAudioData>[1];
      const actual = (await mixSceneAudioData(scene, assets, 0, 179))!
        .channels[0]!;
      let maximum = 0;
      for (let index = 0; index < actual.length; index++) {
        const time = index / sampleRate,
          t = Math.max(0, Math.min(1, time - 2.5));
        const a =
          time >= 1 && time < 3.5
            ? Math.fround(0.2 * Math.sin((time - 1 + 0.5) * Math.PI * 2 * 220))
            : 0;
        const b =
          time >= 2.5 && time < 5
            ? Math.fround(0.2 * Math.sin((time - 3 + 1) * Math.PI * 2 * 440))
            : 0;
        maximum = Math.max(
          maximum,
          Math.abs(actual[index]! - (a * 0.3 * (1 - t) + b * 0.7 * t)),
        );
      }
      expect(maximum).toBeLessThan(0.0000001);
    },
  );
  it("supports dip-to-black without unused source handles for picture-only edits", () => {
    const document = fixture();
    document.items[1]!.node.videoStartTime = 0;
    document.assets.a.durationSeconds = 2.5;
    const next = executeVideoProjectCommands(document, [
      { type: "setTransition", transition: transition({ kind: "dipToBlack" }) },
    ]).document;
    const compiled = compileVideoProjectDocument(next, sources),
      plate = Object.values(compiled.sourceMap).find(
        (value) => value.transitionId,
      )!;
    expect(
      compiled.scene.nodes.filter((node) => node.type === "video"),
    ).toHaveLength(2);
    expect(plate.sourceAssetId).toBeUndefined();
  });
  it.each([
    "head",
    "tail",
    "unknown",
    "gain",
    "mask",
    "opacity",
    "other-track",
    "overlap",
  ])("rejects unsupported %s without changing input", (problem) => {
    const document = fixture();
    let request = transition();
    if (problem === "head") document.items[1]!.node.videoStartTime = 0.1;
    if (problem === "tail") document.assets.a.durationSeconds = 2.6;
    if (problem === "unknown") delete document.assets.a.durationSeconds;
    if (problem === "gain") {
      document.items[0]!.node.volumeEnvelope = [{ frame: 0, value: 0.5 }];
      request = transition({ audio: "crossfade" });
    }
    if (problem === "mask")
      document.items[0]!.node.clip = { kind: "rect", radius: 4 };
    if (problem === "opacity") document.items[0]!.node.style!.opacity = 0.5;
    if (problem === "other-track") {
      document.tracks.push({ ...document.tracks[0]!, id: "other" });
      document.items[1]!.trackId = "other";
    }
    if (problem === "overlap")
      document.items.push({
        id: "third",
        name: "Third",
        trackId: "visual",
        node: {
          id: "third",
          type: "text",
          text: "Overlay",
          from: 40,
          duration: 10,
        },
      });
    const before = structuredClone(document);
    expect(() =>
      executeVideoProjectCommands(document, [
        { type: "setTransition", transition: request },
      ]),
    ).toThrow();
    expect(document).toEqual(before);
  });
  it("keeps a valid edge trim and common move but rejects a detached endpoint", () => {
    const original = withTransition();
    const trimmed = executeVideoProjectCommands(original, [
      { type: "trimItem", id: "left", from: 45, duration: 45 },
    ]).document;
    expect(trimmed.transitions).toEqual(original.transitions);
    expect(trimmed.items[0]!.node.videoStartTime).toBe(1);
    expect(() =>
      executeVideoProjectCommands(original, [
        { type: "moveItem", id: "right", from: 95 },
      ]),
    ).toThrow(/same cut/);
    const moved = executeVideoProjectCommands(original, [
      { type: "moveItem", id: "left", from: 0 },
      { type: "moveItem", id: "right", from: 60 },
    ]).document;
    expect(moved.transitions).toEqual(original.transitions);
    expect(moved.items.map((item) => item.id)).toEqual(["left", "right"]);
  });
  it("transfers a split outgoing edge and removes a deleted endpoint's transition", () => {
    const original = withTransition(),
      split = executeVideoProjectCommands(original, [
        { type: "splitItem", id: "left", frame: 60, newId: "tail" },
      ]).document;
    expect(split.transitions!.cut.fromItemId).toBe("tail");
    expect(split.items.find((item) => item.id === "left")!.node.from).toBe(30);
    expect(
      executeVideoProjectCommands(split, [{ type: "removeItem", id: "tail" }])
        .document.transitions,
    ).toBeUndefined();
    expect(() =>
      executeVideoProjectCommands(original, [
        { type: "splitItem", id: "left", frame: 85, newId: "tiny" },
      ]),
    ).toThrow(/longer than/);
  });
  it("moves transition pairs together during a preceding ripple removal", () => {
    const document = executeVideoProjectCommands(withTransition(), [
      { type: "removeTimelineRange", from: 0, duration: 15 },
    ]).document;
    expect(document.items.map((item) => item.node.from)).toEqual([15, 75]);
    expect(document.transitions!.cut.id).toBe("cut");
    expect(document.format.durationInFrames).toBe(165);
  });
  it("fences concurrent endpoint/edge edits when rebasing", () => {
    const base = fixture(),
      current = executeVideoProjectCommands(base, [
        { type: "moveItem", id: "right", from: 95 },
      ]).document;
    expect(
      rebaseVideoProjectCommands(base, current, [
        { type: "setTransition", transition: transition() },
      ]).ok,
    ).toBe(false);
    const existing = withTransition();
    expect(
      rebaseVideoProjectCommands(base, existing, [
        { type: "setTransition", transition: transition({ id: "second" }) },
      ]).ok,
    ).toBe(false);
  });
});
describe("persistent linked groups", () => {
  it("links native dependent families and moves them once without changing IDs/source clocks", () => {
    const original = linkedFixture(),
      grouped = executeVideoProjectCommands(original, [
        {
          type: "setLinkedGroup",
          group: {
            id: "interview",
            name: "Interview",
            itemIds: ["left", "right"],
          },
        },
      ]).document;
    expect(grouped.linkedGroups!.interview.itemIds).toEqual([
      "left",
      "right",
      "caption",
      "translation",
      "badge",
    ]);
    const moved = executeVideoProjectCommands(grouped, [
      { type: "moveLinkedGroup", id: "interview", from: 0 },
    ]).document;
    expect(moved.items.map((item) => item.id)).toEqual(
      original.items.map((item) => item.id),
    );
    expect(moved.items.map((item) => item.node.from)).toEqual([
      0, 60, 0, 0, 15,
    ]);
    expect(moved.sources).toEqual(original.sources);
    expect(moved.bindings).toEqual(original.bindings);
    expect(moved.items[0]!.node.videoStartTime).toBe(0.5);
    expect(moved.items[2]!.caption!.cues).toEqual(
      original.items[2]!.caption!.cues,
    );
  });
  it("duplicates a group, its transition, paired captions and speech binding with shared immutable media", () => {
    let document = executeVideoProjectCommands(linkedFixture(), [
      { type: "setTransition", transition: transition() },
      {
        type: "setLinkedGroup",
        group: { id: "g", itemIds: ["left", "right"] },
      },
    ]).document;
    const original = document,
      itemIds = Object.fromEntries(
        document.linkedGroups!.g.itemIds.map((id) => [id, id + "-copy"]),
      );
    document = executeVideoProjectCommands(document, [
      {
        type: "duplicateLinkedGroup",
        id: "g",
        newGroupId: "g-copy",
        itemIds,
        from: 180,
      },
    ]).document;
    expect(document.items).toHaveLength(10);
    expect(
      document.items.find((item) => item.id === "left-copy")!.node,
    ).toMatchObject({ assetId: "a", from: 180, videoStartTime: 0.5 });
    expect(
      document.items.find((item) => item.id === "translation-copy")!.caption,
    ).toMatchObject({
      sourceItemId: "left-copy",
      pairedItemId: "caption-copy",
    });
    expect(Object.values(document.bindings)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          itemId: "badge-copy",
          sourceItemId: "left-copy",
          sourceAssetId: "a",
          sourceRevision: "source1",
          sourceStartMs: 1000,
        }),
      ]),
    );
    expect(Object.values(document.transitions!)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          fromItemId: "left-copy",
          toItemId: "right-copy",
          audio: "pictureOnly",
        }),
      ]),
    );
    expect(document.assets).toEqual(original.assets);
    expect(document.sources).toEqual(original.sources);
    expect(document.evidence).toEqual(original.evidence);
    const restored = executeVideoProjectCommands(
      document,
      buildVideoProjectRevertCommands(original, document),
    ).document;
    expect(canonicalSerialize(restored)).toBe(canonicalSerialize(original));
  });
  it("retains an external imported-caption pairing when only internal group references are remapped", () => {
    const document = fixture();
    document.tracks.push({
      id: "captions",
      name: "Captions",
      kind: "visual",
      hidden: false,
      muted: false,
      locked: false,
    });
    const caption = {
      mode: "sentence" as const,
      direction: "ltr" as const,
      highlightColor: "#ffffff",
      cues: [{ id: "cue", text: "Hello", startMs: 0, endMs: 1000 }],
    };
    document.items.push({
      id: "external",
      name: "Imported original",
      trackId: "captions",
      node: { id: "external", type: "div", from: 30, duration: 30 },
      caption,
    });
    document.items.push({
      id: "translated",
      name: "Imported translation",
      trackId: "captions",
      node: { id: "translated", type: "div", from: 30, duration: 30 },
      caption: {
        ...caption,
        role: "translation",
        language: "es",
        pairedItemId: "external",
        cues: [{ id: "cue", text: "Hola", startMs: 0, endMs: 1000 }],
      },
    });
    document.items.push({
      id: "title",
      name: "Title",
      trackId: "captions",
      node: {
        id: "title",
        type: "text",
        text: "Title",
        from: 30,
        duration: 30,
      },
    });
    const grouped = executeVideoProjectCommands(document, [
      {
        type: "setLinkedGroup",
        group: { id: "g", itemIds: ["translated", "title"] },
      },
    ]).document;
    const copied = executeVideoProjectCommands(grouped, [
      {
        type: "duplicateLinkedGroup",
        id: "g",
        newGroupId: "g-copy",
        itemIds: { translated: "translated-copy", title: "title-copy" },
        from: 120,
      },
    ]).document;
    expect(
      copied.items.find((item) => item.id === "translated-copy")!.caption!
        .pairedItemId,
    ).toBe("external");
    expect(copied.items.find((item) => item.id === "external")).toEqual(
      grouped.items.find((item) => item.id === "external"),
    );
  });
  it("ungroups without moving clips and restores the original pre-feature hash through semantic undo", async () => {
    const before = fixture(),
      grouped = executeVideoProjectCommands(before, [
        {
          type: "setLinkedGroup",
          group: { id: "g", itemIds: ["left", "right"] },
        },
      ]).document;
    expect(compileVideoProjectDocument(grouped, sources).scene).toEqual(
      compileVideoProjectDocument(before, sources).scene,
    );
    const ungrouped = executeVideoProjectCommands(grouped, [
      { type: "removeLinkedGroup", id: "g" },
    ]).document;
    expect(ungrouped.linkedGroups).toBeUndefined();
    expect(await hashVideoProjectDocument(ungrouped)).toBe(
      await hashVideoProjectDocument(before),
    );
    const restored = executeVideoProjectCommands(
      grouped,
      buildVideoProjectRevertCommands(before, grouped),
    ).document;
    expect(canonicalSerialize(restored)).toBe(canonicalSerialize(before));
  });
  it("keeps groups closed through source splits and prunes them after cascading deletion", () => {
    const original = executeVideoProjectCommands(linkedFixture(), [
      {
        type: "setLinkedGroup",
        group: { id: "g", itemIds: ["left", "right"] },
      },
    ]).document;
    const split = executeVideoProjectCommands(original, [
      { type: "splitItem", id: "left", frame: 60, newId: "tail" },
    ]).document;
    expect(split.linkedGroups!.g.itemIds).toContain("tail");
    const derived = split.items.filter(
      (item) =>
        item.caption?.sourceItemId === "tail" ||
        Object.values(split.bindings).some(
          (binding) =>
            binding.sourceItemId === "tail" && binding.itemId === item.id,
        ),
    );
    derived.forEach((item) =>
      expect(split.linkedGroups!.g.itemIds).toContain(item.id),
    );
    const deleted = executeVideoProjectCommands(original, [
      { type: "removeItem", id: "left" },
    ]).document;
    expect(deleted.items.map((item) => item.id)).toEqual(["right"]);
    expect(deleted.linkedGroups).toBeUndefined();
  });
  it("rejects duplicate membership, omitted source parents and locked dependent tracks atomically", () => {
    const document = linkedFixture();
    expect(() =>
      executeVideoProjectCommands(document, [
        {
          type: "setLinkedGroup",
          group: { id: "g", itemIds: ["caption", "right"] },
        },
      ]),
    ).toThrow(/source clip/);
    const grouped = executeVideoProjectCommands(document, [
      {
        type: "setLinkedGroup",
        group: { id: "g", itemIds: ["left", "right"] },
      },
    ]).document;
    expect(() =>
      executeVideoProjectCommands(grouped, [
        {
          type: "setLinkedGroup",
          group: { id: "h", itemIds: ["left", "right"] },
        },
      ]),
    ).toThrow(/another linked group/);
    grouped.tracks.find((track) => track.id === "captions")!.locked = true;
    expect(() =>
      executeVideoProjectCommands(grouped, [
        { type: "moveLinkedGroup", id: "g", from: 0 },
      ]),
    ).toThrow(/Unlock/);
    expect(() =>
      executeVideoProjectCommands(grouped, [
        { type: "removeLinkedGroup", id: "g" },
      ]),
    ).toThrow(/Unlock/);
    expect(grouped.items[0]!.node.from).toBe(30);
  });
});
