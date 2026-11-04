import assert from "node:assert/strict";
import {
  evaluateScene,
  layoutScene,
  type LayoutBox,
} from "@dojo-video-engine/core";
import {
  createVideoProjectDocument,
  parseVideoProjectDocument,
  type VideoProjectDocument,
} from "../../packages/core/src/lib/video-project/document";
import { compileVideoProjectDocument } from "../../packages/core/src/lib/video-project/compilation";

export const lowerThirdCases = [
  {
    id: "landscape",
    width: 640,
    height: 360,
    prompt:
      "Introduce Sarah Chen as Product Designer on the interview clip for its first five seconds. Add a readable lower-third and preserve everything already in the project.",
    text: ["Sarah Chen", "Product Designer"],
    clarification: false,
  },
  {
    id: "portrait-long",
    width: 360,
    height: 640,
    prompt:
      "Add a lower-third for the first five seconds: Dr. Alexandra Montgomery, Director of Research and Community Partnerships at the International Center for Sustainable Urban Innovation. Keep the complete wording readable on this portrait video. If it cannot fit, ask me to shorten it rather than dropping words.",
    text: [
      "Dr. Alexandra Montgomery",
      "Director of Research and Community Partnerships at the International Center for Sustainable Urban Innovation",
    ],
    clarification: true,
  },
  {
    id: "existing-captions",
    width: 640,
    height: 360,
    prompt:
      "Introduce Sarah Chen as Product Designer during the first five seconds. Keep the existing subtitles exactly as they are, and place the lower-third clear of them.",
    text: ["Sarah Chen", "Product Designer"],
    clarification: false,
  },
  {
    id: "ambiguous",
    width: 640,
    height: 360,
    prompt:
      "Put a lower-third saying Sarah Chen, Product Designer on the interview take for five seconds.",
    text: ["Sarah Chen", "Product Designer"],
    clarification: true,
  },
] as const;
export type LowerThirdCase = (typeof lowerThirdCases)[number];
export function lowerThirdFixture(test: LowerThirdCase) {
  const d = createVideoProjectDocument({
    width: test.width,
    height: test.height,
    fps: 30,
    durationInFrames: test.id === "ambiguous" ? 600 : 300,
  });
  for (const [index, id] of (test.id === "ambiguous"
    ? ["a", "b"]
    : ["a"]
  ).entries()) {
    d.assets[id] = {
      id,
      type: "video",
      source: "local",
      name:
        test.id === "ambiguous"
          ? `Interview take ${index + 1}.mp4`
          : "Interview.mp4",
      durationSeconds: 10,
      width: 640,
      height: 360,
    };
    d.sources[id] = { assetId: id, revision: `controlled-${id}-v1` };
    d.items.push({
      id: `clip-${id}`,
      name:
        test.id === "ambiguous"
          ? `Interview take ${index + 1}`
          : "Interview clip",
      trackId: "visual",
      node: {
        id: `clip-${id}`,
        type: "video",
        assetId: id,
        from: index * 300,
        duration: 300,
        volume: 0.7,
        style: { width: "100%", height: "100%", objectFit: "contain" },
      },
    });
  }
  if (test.id === "existing-captions")
    d.items.push({
      id: "captions",
      name: "Existing subtitles",
      trackId: "visual",
      node: {
        id: "captions",
        type: "div",
        from: 0,
        duration: 300,
        style: {
          position: "absolute",
          left: 20,
          top: 250,
          width: 600,
          height: 90,
          fontSize: 30,
          color: "#ffffff",
          backgroundColor: "#111827",
        },
      },
      caption: {
        cues: [
          {
            id: "cue-1",
            text: "Existing subtitle line",
            startMs: 0,
            endMs: 10000,
          },
        ],
        mode: "sentence",
        highlightColor: "#ffff00",
        direction: "ltr",
      },
    });
  return parseVideoProjectDocument(d);
}
function boxes(document: VideoProjectDocument, frame: number) {
  const { scene } = compileVideoProjectDocument(
    document,
    Object.fromEntries(
      Object.values(document.assets)
        .filter((asset) => asset.source === "local")
        .map((asset) => [asset.id, `/${asset.id}.mp4`]),
    ),
  );
  const result: LayoutBox[] = [];
  const visit = (box: LayoutBox) => {
    result.push(box);
    box.children.forEach(visit);
  };
  layoutScene(evaluateScene(scene, frame)).boxes.forEach(visit);
  return { scene, boxes: result };
}
export function gradeLowerThird(
  test: LowerThirdCase,
  before: VideoProjectDocument,
  after: VideoProjectDocument,
) {
  assert.notEqual(
    test.id,
    "ambiguous",
    "Ambiguous targets require clarification, not a guessed edit",
  );
  const originalIds = new Set(before.items.map((item) => item.id));
  const originalTracks = new Set(before.tracks.map((track) => track.id));
  for (const asset of Object.values(after.assets).filter(
    (asset) => !before.assets[asset.id],
  )) {
    assert(
      asset.type === "font" &&
        asset.source === "static" &&
        asset.src?.startsWith("/fonts/"),
      "Only bundled fonts needed by the graphic may be registered",
    );
  }
  const newTracks = after.tracks.filter(
    (track) => !originalTracks.has(track.id),
  );
  assert(
    newTracks.length <= 1 &&
      newTracks.every(
        (track) => track.kind === "visual" && !track.locked && !track.hidden,
      ),
    "Unexpected new tracks",
  );
  assert.deepEqual(
    {
      ...after,
      items: after.items.filter((item) => originalIds.has(item.id)),
      tracks: after.tracks.filter((track) => originalTracks.has(track.id)),
      assets: Object.fromEntries(
        Object.entries(after.assets).filter(([id]) => before.assets[id]),
      ),
    },
    before,
    "Existing items, captions, assets and all unrelated state must survive",
  );
  const added = after.items.filter((item) => !originalIds.has(item.id));
  assert(added.length > 0 && added.length <= 3, "Expected one small graphic");
  let copy = "";
  const text = (node: (typeof added)[number]["node"]) => {
    if (node.text) copy += " " + node.text;
    node.children?.forEach(text);
  };
  added.forEach((item) => text(item.node));
  const normalized = copy.replace(/\s+/gu, " ");
  for (const phrase of test.text)
    assert(normalized.includes(phrase), `Missing or changed copy: ${phrase}`);
  for (const item of added) {
    assert.equal(item.node.from ?? 0, 0, "Wrong start");
    assert.equal(item.node.duration, 150, "Requested five seconds at 30 fps");
  }
  const geometries = [];
  for (const frame of [15, 75, 135]) {
    const layout = boxes(after, frame);
    const ids = new Set<string>();
    const visit = (node: (typeof added)[number]["node"]) => {
      ids.add(node.id);
      node.children?.forEach(visit);
    };
    added.forEach((item) => visit(item.node));
    const ink = layout.boxes.filter(
      (box) =>
        ids.has(box.node.id) &&
        (box.node.type === "text" || box.node.style.backgroundColor),
    );
    assert(ink.length > 0, "Graphic must have visible content");
    for (const box of ink) {
      assert(
        box.x >= 0 &&
          box.y >= 0 &&
          box.x + box.width <= test.width + 0.5 &&
          box.y + box.height <= test.height + 0.5,
        "Graphic leaves canvas",
      );
      if (box.node.type === "text") {
        assert(Number(box.node.style.fontSize) >= 14, "Text too small");
        assert(
          box.width > 0 && box.height > 0,
          "Text has no usable layout area",
        );
      }
    }
    const textBoxes = ink.filter((box) => box.node.type === "text");
    assert(
      textBoxes.every((box) => box.y >= test.height * 0.4),
      "Requested lower-third, not opening title",
    );
    if (test.id === "existing-captions")
      for (const box of ink) {
        assert(
          box.y + box.height <= 246 || box.x + box.width <= 20 || box.x >= 620,
          "Graphic overlaps the preserved subtitle area",
        );
      }
    geometries.push({
      frame,
      boxes: ink.map((box) => ({
        id: box.node.id,
        x: box.x,
        y: box.y,
        width: box.width,
        height: box.height,
      })),
    });
  }
  return {
    addedItemIds: added.map((item) => item.id),
    geometries,
    scene: boxes(after, 75).scene,
  };
}
