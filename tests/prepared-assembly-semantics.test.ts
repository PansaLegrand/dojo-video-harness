import { expect, it } from "vitest";
import { mergePreparedAssemblyCommands } from "../packages/agent-kit/src/staged-coordinator";
import { createVideoProjectDocument } from "../packages/core/src/lib/video-project/document";
import {
  executeVideoProjectCommands,
  type VideoProjectCommand,
} from "../packages/core/src/lib/video-project/commands";

const trim = { type: "trimItem", id: "clip", from: 60, duration: 120 };
const offset = (value: number) => ({
  type: "set",
  target: { kind: "node", itemId: "clip", nodeId: "clip" },
  path: ["videoStartTime"],
  value,
});
const caption = {
  type: "addItem",
  item: {
    id: "english",
    caption: { pairedItemId: "chinese", cues: [{ text: "Original" }] },
  },
};
const link = {
  type: "set",
  target: { kind: "caption", itemId: "english" },
  path: ["pairedItemId"],
  value: "chinese",
};
function apply(prepared: unknown[], authored: unknown[]) {
  const doc = createVideoProjectDocument({
    width: 640,
    height: 360,
    fps: 30,
    durationInFrames: 600,
  });
  doc.assets.video = {
    id: "video",
    name: "Video",
    type: "video",
    source: "local",
    durationSeconds: 30,
  };
  doc.sources.video = { assetId: "video", revision: "source" };
  doc.items.push({
    id: "clip",
    name: "Video",
    trackId: "visual",
    node: {
      id: "clip",
      type: "video",
      assetId: "video",
      from: 0,
      duration: 300,
      videoStartTime: 0,
    },
  });
  return executeVideoProjectCommands(
    doc,
    mergePreparedAssemblyCommands(prepared, authored) as VideoProjectCommand[],
  ).document.items.find((item) => item.id === "clip")!.node;
}

it("deduplicates only exact prepared caption commands without mutating the inputs", () => {
  const prepared = [caption, link, trim, offset(2)],
    authored = structuredClone(prepared),
    before = JSON.stringify({ prepared, authored });
  expect(mergePreparedAssemblyCommands(prepared, authored)).toEqual(prepared);
  expect(JSON.stringify({ prepared, authored })).toBe(before);
});
it("does not silently discard revised caption text under a repeated item ID", () => {
  const changed = structuredClone(caption);
  changed.item.caption.cues[0].text = "Changed";
  expect(() => mergePreparedAssemblyCommands([caption], [changed])).toThrow(
    /conflicts with prepared captions/,
  );
});
it("does not silently discard a changed paired caption target", () => {
  expect(() =>
    mergePreparedAssemblyCommands(
      [caption, link],
      [{ ...link, value: "other" }],
    ),
  ).toThrow(/pair links/);
});
it("rejects a prepared source trim instead of silently changing it to a move", () => {
  expect(() =>
    mergePreparedAssemblyCommands([trim], [{ ...trim, from: 180 }]),
  ).toThrow(/Use moveItem/);
  expect(() =>
    mergePreparedAssemblyCommands([trim], [{ ...trim, duration: 90 }]),
  ).toThrow(/source range is frozen/);
});
it("explicit movement preserves the prepared source range", () => {
  const node = apply([trim], [{ type: "moveItem", id: "clip", from: 180 }]);
  expect(node.from).toBe(180);
  expect(node.duration).toBe(120);
  expect(node.type === "video" && node.videoStartTime).toBe(2);
});
it("a legitimate trim keeps its native source-time meaning even with an authored offset", () => {
  // The old normalizer inserted moveItem before trimItem because it saw a set
  // anywhere in the batch, changing the intended source window from 3s to 1s.
  const node = apply([], [offset(1), trim]);
  expect(node.from).toBe(60);
  expect(node.duration).toBe(120);
  expect(node.type === "video" && node.videoStartTime).toBe(3);
});
it("does not drop an offset reset after an intervening native trim", () => {
  const node = apply([offset(1)], [trim, offset(1)]);
  expect(node.type === "video" && node.videoStartTime).toBe(1);
});
it("leaves an invalid source trim for native validation rather than rescuing it as a move", () => {
  expect(() =>
    apply(
      [],
      [
        { type: "moveItem", id: "clip", from: 180 },
        offset(1),
        { ...trim, from: 0 },
      ],
    ),
  ).toThrow(/before the source/);
});
