import { expect, it } from "vitest";
import {
  editorItemKind,
  editorTimelineTracks,
  editorTimelineTrackName,
  editorTrackContentKind,
} from "../packages/core/src/lib/editor/timeline-tracks";
import { VideoWorkspaceController } from "../packages/core/src/lib/video-project/client-controller";
import { executeVideoProjectCommands } from "../packages/core/src/lib/video-project/commands";
import {
  createVideoProjectDocument,
  hashVideoProjectDocument,
} from "../packages/core/src/lib/video-project/document";
import { buildSelectionCommands } from "../packages/core/src/lib/video-project/selection-commands";
import type { VideoProjectSnapshot } from "../packages/core/src/lib/video-project/types";

function fixture() {
  const document = createVideoProjectDocument({
    width: 320,
    height: 180,
    fps: 30,
    durationInFrames: 300,
  });
  document.tracks = ["v0", "v1", "v2", "a0", "a1"].map((id) => ({
    id,
    name: id,
    kind: id.startsWith("v") ? "visual" : "audio",
    locked: false,
    muted: false,
    hidden: false,
  }));
  document.assets.tone = {
    id: "tone",
    type: "audio",
    source: "static",
    src: "/assets/tone.wav",
    name: "Tone",
    durationSeconds: 10,
  };
  document.items = document.tracks.map((track, index) => ({
    id: `item-${track.id}`,
    name: track.id,
    trackId: track.id,
    node:
      track.kind === "audio"
        ? {
            id: `item-${track.id}`,
            type: "audio",
            assetId: "tone",
            from: index * 10,
            duration: 30,
            audioStartTime: 0,
          }
        : {
            id: `item-${track.id}`,
            type: "text",
            text: track.id,
            from: index * 10,
            duration: 30,
          },
  }));
  return document;
}

it("presents overlays above footage without changing document paint order", () => {
  const document = fixture();
  expect(
    editorTimelineTracks(document.tracks).map((track) => track.id),
  ).toEqual(["v2", "v1", "v0", "a0", "a1"]);
  expect(document.tracks.map((track) => track.id)).toEqual([
    "v0",
    "v1",
    "v2",
    "a0",
    "a1",
  ]);
});

it("range-selects clips in the same row order as the timeline", async () => {
  const document = fixture();
  const snapshot: VideoProjectSnapshot = {
    projectId: "project",
    document,
    revision: 0,
    documentHash: await hashVideoProjectDocument(document),
    sources: [],
    history: { canUndo: false, canRedo: false },
  };
  const controller = new VideoWorkspaceController(
    "project",
    async <T>() => snapshot as T,
  );
  await controller.open();
  controller.select("item-v2");
  controller.selectTimelineItem("item-a0", { range: true });
  expect(controller.getState().selectedItemIds).toEqual([
    "item-v2",
    "item-v1",
    "item-v0",
    "item-a0",
  ]);
  expect(controller.getState().selectedItemId).toBe("item-a0");
  controller.close();
});

it("moves a mixed visual/audio selection by displayed rows and preserves offsets", () => {
  const document = fixture();
  const batch = buildSelectionCommands(
    document,
    ["item-v1", "item-a0"],
    "move",
    { anchorId: "item-v1", from: 20, trackId: "v0" },
  );
  const { document: moved } = executeVideoProjectCommands(
    document,
    batch.commands,
  );
  expect(moved.items.find((item) => item.id === "item-v1")).toMatchObject({
    trackId: "v0",
    node: { from: 20 },
  });
  expect(moved.items.find((item) => item.id === "item-a0")).toMatchObject({
    trackId: "a1",
    node: { from: 40 },
  });
  expect(document.items.find((item) => item.id === "item-a0")?.trackId).toBe(
    "a0",
  );
  expect(moved.tracks.map((track) => track.id)).toEqual(
    document.tracks.map((track) => track.id),
  );
});

it("labels legacy tracks from their contents while retaining named track numbers", () => {
  const document = fixture();
  const text = document.items[0]!;
  const track = { ...document.tracks[0]!, name: "Video & graphics" };
  expect(editorItemKind(text)).toBe("text");
  expect(editorTrackContentKind(track, [text])).toBe("text");
  expect(
    editorTimelineTrackName(track, [text], (label) => `localized:${label}`),
  ).toBe("localized:Text");
  expect(
    editorTimelineTrackName(
      { ...track, name: "Text 2" },
      [text],
      (label) => `localized:${label}`,
    ),
  ).toBe("localized:Text 2");
  expect(editorTrackContentKind(document.tracks[3]!, [])).toBe("audio");
});
