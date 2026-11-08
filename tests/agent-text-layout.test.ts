import { expect, it } from "vitest";
import { createVideoProjectDocument, hashVideoProjectDocument } from "../packages/core/src/lib/video-project/document";
import { compileNativeAgentResult } from "../packages/core/src/lib/video-project/agent-runtime";
function fixture() {
  const document = createVideoProjectDocument({ width: 640, height: 360, fps: 30, durationInFrames: 180 });
  document.items.push({ id: "title", name: "Title", trackId: "visual", node: { id: "title", type: "div", from: 0, duration: 180, children: [{ id: "words", type: "text", text: "Hello", style: { width: 500, height: 150 } }] } });
  return document;
}
async function request(document = fixture()) {
  return { contract: "video-project-commands" as const, version: 1 as const, document, baseRevision: 0, baseHash: await hashVideoProjectDocument(document), context: { selectedItemIds: [], playheadFrame: 0 } };
}
  it("rejects an impossible multiline graphic before returning a proposal", async () => {
    const base = await request();
    await expect(compileNativeAgentResult(base, { summary: "Add takeoff explanation", commands: [{
      type: "insertGraphic", itemId: "takeoff", trackId: "visual", name: "Takeoff", node: {
        type: "text", text: "Engines push forward.\nWings create lift.\nThe plane rises.",
        from: 0, duration: 90, style: { textFit: "shrink", maxLines: 2, fontSize: 42, minFontSize: 22 },
      },
    }] })).rejects.toThrow(/takeoff.*3 explicit lines.*maxLines is 2/);
    expect(base.document.items).toHaveLength(1);
  });
  it("validates final text constraints after a complete edit batch", async () => {
    const document = fixture();
    document.items[0]!.node.children![0]!.style = { textFit: "shrink", maxLines: 2, fontSize: 42, minFontSize: 22 };
    const base = await request(document);
    const text = { type: "set", target: { kind: "node", itemId: "title", nodeId: "words" }, path: ["text"], value: "First\nSecond\nThird" };
    await expect(compileNativeAgentResult(base, { summary: "Change text", commands: [text] })).rejects.toThrow(/3 explicit lines/);
    const result = await compileNativeAgentResult(base, { summary: "Change text and fit", commands: [text,
      { type: "set", target: text.target, path: ["style", "maxLines"], value: 3 },
    ] });
    expect(result.proposal?.commands).toHaveLength(2);
  });
  it("allows unrelated edits and repairs in projects with an existing line conflict", async () => {
    const document = fixture();
    const node = document.items[0]!.node.children![0]!;
    node.text = "First\nSecond\nThird";
    node.style = { textFit: "shrink", maxLines: 2, fontSize: 42, minFontSize: 22 };
    const base = await request(document);
    for (const [property, value] of [["color", "#ff0000"], ["maxLines", 3], ["textFit", "truncate"]]) {
      const result = await compileNativeAgentResult(base, { summary: "Edit text style", commands: [
        { type: "set", target: { kind: "node", itemId: "title", nodeId: "words" }, path: ["style", property], value },
      ] });
      expect(result.proposal?.commands).toHaveLength(1);
    }
  });
