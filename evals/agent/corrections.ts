/** Selection-free follow-ups. Expected identities live only in the grader. */
import assert from "node:assert/strict";
import {
  createVideoProjectDocument,
  parseVideoProjectDocument,
  type VideoProjectDocument,
} from "../../packages/core/src/lib/video-project/document";
import { prepareReadableOverlay } from "../../packages/core/src/lib/video-project/readable-overlay";
import type { VideoProjectCommand } from "../../packages/core/src/lib/video-project/commands";
import { compileVideoProjectDocument } from "../../packages/core/src/lib/video-project/compilation";

export const correctionPrompts = [
  'Add a title saying "Hello" for the first five seconds, with a background behind the text. Preserve everything already in the project.',
  "Make it red.",
  "Use yellow behind it.",
  "Make it bigger.",
] as const;
export function correctionFixture(distractor: boolean) {
  const document = createVideoProjectDocument({
    width: 640,
    height: 360,
    fps: 30,
    durationInFrames: 150,
    backgroundColor: "#386b82",
  });
  if (distractor)
    document.items.push({
      id: "existing-label",
      name: "Existing label",
      trackId: "visual",
      node: {
        id: "existing-label",
        type: "text",
        text: "Keep me",
        from: 0,
        duration: 150,
        style: {
          position: "absolute",
          left: 32,
          top: 300,
          width: 200,
          height: 40,
          fontSize: 24,
          color: "#ffffff",
        },
      },
    });
  return parseVideoProjectDocument(document);
}
type Node = VideoProjectDocument["items"][number]["node"];
export function allNodes(node: Node): Node[] {
  return [node, ...(node.children ?? []).flatMap(allNodes)];
}
export type CorrectionTarget = { itemId: string; textId: string };
export function gradeCorrection(
  before: VideoProjectDocument,
  after: VideoProjectDocument,
  turn: number,
  prior?: CorrectionTarget,
): CorrectionTarget {
  const added = after.items.filter(
    (item) => !before.items.some((old) => old.id === item.id),
  );
  let target = prior;
  if (turn === 0) {
    assert.equal(added.length, 1, "Create exactly one editable title");
    const texts = allNodes(added[0].node).filter(
      (node) => node.type === "text",
    );
    assert.equal(texts.length, 1, "One title text");
    target = { itemId: added[0].id, textId: texts[0].id };
    assert.equal(added[0].node.from, 0);
    assert.equal(added[0].node.duration, 150);
  } else {
    assert(target, "Missing grader target");
    assert.equal(added.length, 0, "Corrections must not duplicate the title");
    assert.deepEqual(
      after.items.map((item) => item.id),
      before.items.map((item) => item.id),
      "Keep item identity and order",
    );
  }
  assert(target);
  const item = after.items.find((item) => item.id === target.itemId);
  assert(item, "Keep original title ID");
  const text = allNodes(item.node).find((node) => node.id === target.textId);
  assert(text?.type === "text", "Keep original text node ID");
  assert.equal(text.text, "Hello", "Preserve wording");
  const withoutTarget = (document: VideoProjectDocument) => ({
    ...document,
    items: document.items.filter((item) => item.id !== target!.itemId),
  });
  assert.deepEqual(
    withoutTarget(after),
    withoutTarget(before),
    "Preserve unrelated content and canvas",
  );
  if (turn > 0) {
    const old = before.items.find((item) => item.id === target!.itemId)!;
    const allowed =
      turn === 1
        ? ["color"]
        : turn === 2
          ? ["backgroundColor"]
          : [
              "fontSize",
              "minFontSize",
              "textFit",
              "width",
              "height",
              "left",
              "top",
              "lineHeight",
              "padding",
              "transform",
            ];
    const strip = (item: typeof old) => {
      const copy = structuredClone(item);
      for (const node of allNodes(copy.node))
        for (const field of allowed)
          if (node.style) delete (node.style as Record<string, unknown>)[field];
      return copy;
    };
    assert.deepEqual(
      strip(item),
      strip(old),
      "Only requested style properties may change",
    );
    if (turn === 1) assert.notDeepEqual(item, old, "Color must change");
    if (turn === 2) assert.notDeepEqual(item, old, "Background must change");
    if (turn === 3) assert.notDeepEqual(item, old, "Visible size must change");
  }
  return target;
}
export function correctionScene(document: VideoProjectDocument) {
  return compileVideoProjectDocument(document).scene;
}
export function referenceCorrection(
  document: VideoProjectDocument,
  turn: number,
  target?: CorrectionTarget,
): Array<VideoProjectCommand | ReturnType<typeof prepareReadableOverlay>> {
  if (turn === 0)
    return [
      prepareReadableOverlay(document, {
        itemId: "new-title",
        trackId: "visual",
        kind: "title",
        text: "Hello",
        from: 0,
        duration: 150,
      }),
    ];
  assert(target);
  const item = document.items.find((item) => item.id === target.itemId)!;
  const text = allNodes(item.node).find((node) => node.id === target.textId)!;
  const set = (
    nodeId: string,
    property: string,
    value: string | number,
  ): VideoProjectCommand => ({
    type: "set",
    target: { kind: "node", itemId: target!.itemId, nodeId },
    path: ["style", property],
    value,
  });
  if (turn === 1) return [set(text.id, "color", "#ff0000")];
  if (turn === 2) return [set(item.node.id, "backgroundColor", "#ffff00")];
  const size = Number(text.style!.fontSize) * 1.3;
  return [
    set(text.id, "fontSize", size),
    set(text.id, "height", Math.ceil(size * 1.25)),
    set(
      item.node.id,
      "height",
      Math.ceil(size * 1.25) + Number(text.style!.top) * 2,
    ),
  ];
}
