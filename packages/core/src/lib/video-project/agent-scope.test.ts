import { describe, expect, it } from "vitest";
import {
  createVideoProjectDocument,
  parseVideoProjectDocument,
} from "./document";
import {
  executeVideoProjectCommands,
  type VideoProjectCommand,
} from "./commands";
import {
  NativeAgentScopeSession,
  validateNativeAgentScope,
} from "./agent-scope";
import type { NativeAgentScope } from "./agent-authoring";

function fixture() {
  const document = createVideoProjectDocument({
    width: 320,
    height: 180,
    durationInFrames: 180,
  });
  document.items = [
    {
      id: "a",
      name: "Title A",
      trackId: "visual",
      node: { id: "a", type: "text", text: "A", from: 0, duration: 30 },
    },
    {
      id: "b",
      name: "Title B",
      trackId: "visual",
      node: { id: "b", type: "text", text: "B", from: 20, duration: 60 },
    },
    {
      id: "group",
      name: "Group",
      trackId: "visual",
      node: {
        id: "group",
        type: "div",
        from: 0,
        duration: 90,
        children: [
          { id: "left", type: "text", text: "Left" },
          { id: "right", type: "text", text: "Right" },
        ],
      },
    },
  ];
  return parseVideoProjectDocument(document);
}
const color = (itemId: string, nodeId = itemId): VideoProjectCommand => ({
  type: "set",
  target: { kind: "node", itemId, nodeId },
  path: ["style", "color"],
  value: "#ff0000",
});
function run(document = fixture(), scope?: NativeAgentScope) {
  const session = new NativeAgentScopeSession(document, scope);
  return {
    session,
    apply(command: VideoProjectCommand) {
      const result = executeVideoProjectCommands(document, [command]);
      session.check(command, document, result);
      document = result.document;
      return result;
    },
    finish() {
      session.finish(document);
      return document;
    },
  };
}

describe("explicit native agent scopes", () => {
  it("retains legacy/project behavior while rejecting another selected item", () => {
    expect(() => run(fixture()).apply(color("b"))).not.toThrow();
    expect(() =>
      run(fixture(), { kind: "project" }).apply(color("b")),
    ).not.toThrow();
    const scoped = run(fixture(), { kind: "selection", itemIds: ["a"] });
    scoped.apply(color("a"));
    expect(() => scoped.apply(color("b"))).toThrow(/outside/);
  });

  it("pins a nested node without granting its parent or siblings", () => {
    const scope = {
      kind: "selection" as const,
      itemIds: ["group"],
      node: { itemId: "group", nodeId: "left" },
    };
    const scoped = run(fixture(), scope);
    scoped.apply(color("group", "left"));
    expect(scoped.finish().items[2]!.node.children![1]!.text).toBe("Right");
    expect(() => run(fixture(), scope).apply(color("group", "right"))).toThrow(
      /outside/,
    );
    expect(() =>
      run(fixture(), scope).apply({ type: "removeItem", id: "group" }),
    ).toThrow(/outside/);
    expect(() =>
      run(fixture(), scope).apply({
        type: "removeNode",
        itemId: "group",
        nodeId: "left",
      }),
    ).not.toThrow();
  });

  it("validates selected identities and bounded ranges against the actual snapshot", () => {
    expect(() =>
      validateNativeAgentScope(fixture(), {
        kind: "selection",
        itemIds: ["missing"],
      }),
    ).toThrow(/no longer/);
    expect(() =>
      validateNativeAgentScope(fixture(), {
        kind: "selection",
        itemIds: ["a"],
        node: { itemId: "a", nodeId: "right" },
      }),
    ).toThrow(/belong/);
    expect(() =>
      validateNativeAgentScope(fixture(), {
        kind: "range",
        fromFrame: 170,
        durationInFrames: 20,
      }),
    ).toThrow(/beyond/);
  });

  it("does not treat an intersecting clip or a moved-out clip as inside a range", () => {
    const scope = {
      kind: "range" as const,
      fromFrame: 0,
      durationInFrames: 30,
    };
    expect(() => run(fixture(), scope).apply(color("a"))).not.toThrow();
    expect(() => run(fixture(), scope).apply(color("b"))).toThrow(/outside/);
    expect(() =>
      run(fixture(), scope).apply({ type: "moveItem", id: "a", from: 10 }),
    ).toThrow(/outside/);
  });

  it("allows native source-linked timing propagation but rejects direct dependent edits", () => {
    const document = fixture();
    document.assets.video = {
      id: "video",
      name: "Source",
      type: "video",
      source: "local",
    };
    document.sources.video = { assetId: "video", revision: "original" };
    document.items[0]!.node = {
      id: "a",
      type: "video",
      assetId: "video",
      from: 0,
      duration: 60,
    };
    document.items.push({
      id: "caption",
      name: "Caption",
      trackId: "visual",
      node: { id: "caption", type: "div", from: 0, duration: 30 },
      caption: {
        sourceItemId: "a",
        mode: "sentence",
        direction: "ltr",
        highlightColor: "#ffffff",
        cues: [{ id: "cue", text: "Actual speech", startMs: 0, endMs: 1000 }],
      },
    });
    const base = parseVideoProjectDocument(document),
      before = JSON.stringify(base);
    const scoped = run(base, { kind: "selection", itemIds: ["a"] });
    scoped.apply({ type: "moveItem", id: "a", from: 30 });
    expect(
      scoped.finish().items.find((item) => item.id === "caption")!.node.from,
    ).toBe(30);
    expect([...scoped.session.propagatedItemIds]).toEqual(["caption"]);
    expect(() =>
      run(base, { kind: "selection", itemIds: ["a"] }).apply(color("caption")),
    ).toThrow(/outside/);
    expect(JSON.stringify(base)).toBe(before);
  });

  it("allows new content within a range and rejects unused tracks and global edits", () => {
    const scope = {
      kind: "range" as const,
      fromFrame: 0,
      durationInFrames: 30,
    };
    const add = (from: number): VideoProjectCommand => ({
      type: "addItem",
      item: {
        id: "new",
        name: "New",
        trackId: "visual",
        node: { id: "new", type: "text", text: "New", from, duration: 10 },
      },
    });
    const scoped = run(fixture(), scope);
    scoped.apply(add(5));
    scoped.apply(color("new"));
    expect(scoped.finish().items.at(-1)!.node.style?.color).toBe("#ff0000");
    expect(() => run(fixture(), scope).apply(add(25))).toThrow(/outside/);
    const track = run(fixture(), scope);
    track.apply({
      type: "addTrack",
      track: {
        id: "empty",
        name: "Empty",
        kind: "visual",
        hidden: false,
        muted: false,
        locked: false,
      },
    });
    expect(() => track.finish()).toThrow(/contain content/);
    expect(() =>
      run(fixture(), scope).apply({
        type: "set",
        target: { kind: "format" },
        path: ["width"],
        value: 640,
      }),
    ).toThrow(/project scope/);
    expect(() =>
      run(fixture(), scope).apply({
        type: "removeTimelineRange",
        from: 0,
        duration: 1,
      }),
    ).toThrow(/project scope/);
  });

  it("does not accept forged extra footprint changes as linked propagation", () => {
    const document = fixture(),
      result = executeVideoProjectCommands(document, [color("a"), color("b")]);
    expect(() =>
      new NativeAgentScopeSession(document, {
        kind: "selection",
        itemIds: ["a"],
      }).check(color("a"), document, result),
    ).toThrow(/outside/);
    const nested = executeVideoProjectCommands(document, [
      color("group", "left"),
      color("group", "right"),
    ]);
    expect(() =>
      new NativeAgentScopeSession(document, {
        kind: "selection",
        itemIds: ["group"],
        node: { itemId: "group", nodeId: "left" },
      }).check(color("group", "left"), document, nested),
    ).toThrow(/another part/);
  });

  it("requires every direct linked-group member and preserves scoped duplication", () => {
    const document = executeVideoProjectCommands(fixture(), [
      { type: "setLinkedGroup", group: { id: "linked", itemIds: ["a", "b"] } },
    ]).document;
    expect(() =>
      run(document, { kind: "selection", itemIds: ["a"] }).apply({
        type: "moveLinkedGroup",
        id: "linked",
        from: 10,
      }),
    ).toThrow(/every source member/);
    const scoped = run(document, { kind: "selection", itemIds: ["a", "b"] });
    scoped.apply({
      type: "duplicateLinkedGroup",
      id: "linked",
      newGroupId: "copy",
      itemIds: { a: "copy-a", b: "copy-b" },
      from: 90,
    });
    expect(scoped.finish().linkedGroups?.copy?.itemIds).toEqual([
      "copy-a",
      "copy-b",
    ]);
  });

  it("requires both transition endpoints even though their native node fields do not change", () => {
    const document = fixture();
    document.items = document.items.slice(0, 2);
    document.items.forEach((item, index) => {
      const assetId = `image-${index}`;
      document.assets[assetId] = {
        id: assetId,
        name: assetId,
        type: "image",
        source: "local",
      };
      item.node = {
        id: item.id,
        type: "img",
        assetId,
        from: index * 60,
        duration: 60,
      };
    });
    const base = parseVideoProjectDocument(document),
      command: VideoProjectCommand = {
        type: "setTransition",
        transition: {
          id: "fade",
          fromItemId: "a",
          toItemId: "b",
          kind: "dissolve",
          durationFrames: 10,
          audio: "pictureOnly",
        },
      };
    expect(() =>
      run(base, { kind: "selection", itemIds: ["a"] }).apply(command),
    ).toThrow(/outside/);
    const scoped = run(base, { kind: "selection", itemIds: ["a", "b"] });
    scoped.apply(command);
    expect(scoped.finish().transitions?.fade?.audio).toBe("pictureOnly");
  });
});
