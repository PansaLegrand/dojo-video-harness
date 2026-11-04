import { it, expect } from "vitest";
import {
  evaluateScene,
  layoutScene,
  type LayoutBox,
} from "@dojo-video-engine/core";
import {
  createVideoProjectDocument,
  parseVideoProjectDocument,
  hashVideoProjectDocument,
} from "../packages/core/src/lib/video-project/document";
import { compileNativeAgentResult } from "../packages/core/src/lib/video-project/agent-runtime";
import { executeVideoProjectCommands } from "../packages/core/src/lib/video-project/commands";
import { compileVideoProjectDocument } from "../packages/core/src/lib/video-project/compilation";

async function sequence(side: "before" | "after") {
  const d = createVideoProjectDocument({
    width: 640,
    height: 360,
    fps: 30,
    durationInFrames: 120,
  });
  d.assets.original = {
    id: "original",
    name: "Original.mp4",
    type: "video",
    source: "local",
    durationSeconds: 4,
    width: 640,
    height: 360,
  };
  d.sources.original = { assetId: "original", revision: "original-v1" };
  d.items.push({
    id: "footage",
    name: "Original",
    trackId: "visual",
    node: {
      id: "footage",
      type: "video",
      assetId: "original",
      from: 0,
      duration: 120,
      videoStartTime: 0,
      volume: 0.7,
    },
  });
  const before = parseVideoProjectDocument(d);
  const result = await compileNativeAgentResult(
    {
      contract: "video-project-commands",
      version: 1,
      baseRevision: 0,
      baseHash: await hashVideoProjectDocument(before),
      document: before,
      context: { selectedItemIds: [], playheadFrame: 0 },
      authoring: { version: 1, scope: { kind: "project" } },
    },
    {
      summary: "Add a separate countdown segment",
      commands: [
        {
          type: "set",
          target: { kind: "format" },
          path: ["durationInFrames"],
          value: 210,
        },
        ...(side === "before"
          ? [{ type: "moveItem", id: "footage", from: 90 }]
          : []),
        {
          type: "insertGraphic",
          itemId: "countdown",
          trackId: "visual",
          name: "Countdown",
          node: {
            macro: "countdown",
            start: 3,
            end: 1,
            from: side === "before" ? 0 : 120,
            duration: 90,
          },
        },
      ],
    },
  );
  return {
    before,
    after: executeVideoProjectCommands(before, result.proposal!.commands)
      .document,
  };
}
function visibleText(
  document: Awaited<ReturnType<typeof sequence>>["after"],
  frame: number,
) {
  const scene = compileVideoProjectDocument(document, {
    original: "/original.mp4",
  }).scene;
  const texts: string[] = [];
  const visit = (box: LayoutBox, visible = true) => {
    visible = visible && box.node.style.opacity !== 0;
    if (visible && box.node.type === "text") texts.push(box.node.text ?? "");
    box.children.forEach((child) => visit(child, visible));
  };
  layoutScene(evaluateScene(scene, frame)).boxes.forEach((box) => visit(box));
  return texts;
}
it.each(["before", "after"] as const)(
  "creates a separate editable countdown %s footage without another video asset",
  async (side) => {
    const { before, after } = await sequence(side);
    expect(after.items).toHaveLength(2);
    expect(
      Object.values(after.assets).filter((asset) => asset.type === "video"),
    ).toEqual(Object.values(before.assets));
    expect(after.sources).toEqual(before.sources);
    const graphic = after.items.find((item) => item.id === "countdown")!,
      footage = after.items.find((item) => item.id === "footage")!;
    expect(graphic.node.type).toBe("div");
    expect(graphic.node.assetId).toBeUndefined();
    expect(graphic.node.children?.map((child) => child.text)).toEqual([
      "3",
      "2",
      "1",
    ]);
    expect(footage.node).toEqual({
      ...before.items[0].node,
      from: side === "before" ? 90 : 0,
    });
    const start = side === "before" ? 0 : 120;
    for (const [offset, text] of [
      [15, "3"],
      [45, "2"],
      [75, "1"],
    ] as const)
      expect(visibleText(after, start + offset)).toEqual([text]);
    expect(visibleText(after, side === "before" ? 105 : 15)).toEqual([]);
  },
);
it("moves, trims, splits and edits the graphic using normal commands while preserving footage", async () => {
  const { after } = await sequence("after");
  const footage = after.items[0];
  const moved = executeVideoProjectCommands(after, [
    { type: "moveItem", id: "countdown", from: 30 },
  ]).document;
  expect(moved.items[0]).toEqual(footage);
  expect(moved.items[1].node.children).toEqual(after.items[1].node.children);
  expect(visibleText(moved, 45)).toEqual(["3"]);
  const tail = executeVideoProjectCommands(after, [
    { type: "trimItem", id: "countdown", from: 120, duration: 60 },
  ]).document;
  expect(visibleText(tail, 165)).toEqual(["2"]);
  expect(visibleText(tail, 195)).toEqual([]);
  const head = executeVideoProjectCommands(after, [
    { type: "trimItem", id: "countdown", from: 150, duration: 60 },
  ]).document;
  expect(visibleText(head, 165)).toEqual(["2"]);
  expect(visibleText(head, 195)).toEqual(["1"]);
  expect(head.items[0]).toEqual(footage);
  const split = executeVideoProjectCommands(after, [
    { type: "splitItem", id: "countdown", frame: 150, newId: "countdown-tail" },
  ]).document;
  expect(visibleText(split, 135)).toEqual(["3"]);
  expect(visibleText(split, 165)).toEqual(["2"]);
  expect(split.items.filter((item) => item.node.type === "video")).toEqual([
    footage,
  ]);
  const edited = executeVideoProjectCommands(after, [
    {
      type: "set",
      target: {
        kind: "node",
        itemId: "countdown",
        nodeId: after.items[1].node.children![0].id,
      },
      path: ["text"],
      value: "Ready",
    },
  ]).document;
  expect(visibleText(edited, 135)).toEqual(["Ready"]);
});
