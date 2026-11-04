import { describe, it, expect } from "vitest";
import {
  evaluateScene,
  layoutScene,
  type LayoutBox,
} from "@dojo-video-engine/core";
import { prepareReadableOverlay } from "../packages/core/src/lib/video-project/readable-overlay";
import {
  createVideoProjectDocument,
  hashVideoProjectDocument,
} from "../packages/core/src/lib/video-project/document";
import { compileNativeAgentResult } from "../packages/core/src/lib/video-project/agent-runtime";
import { executeVideoProjectCommands } from "../packages/core/src/lib/video-project/commands";
import { compileVideoProjectDocument } from "../packages/core/src/lib/video-project/compilation";
import { createVideoTools } from "../packages/agent/src/tools";

const variants = [
  [640, 360],
  [360, 640],
  [1080, 1920],
  [1920, 1080],
  [1080, 1080],
];
describe("readable overlay proposals", () => {
  it("rejects a zero-area macro before review and accepts a usable prepared replacement", async () => {
    const document = createVideoProjectDocument({
      width: 640,
      height: 360,
      fps: 30,
      durationInFrames: 300,
    });
    const request = {
      contract: "video-project-commands" as const,
      version: 1 as const,
      baseRevision: 0,
      baseHash: await hashVideoProjectDocument(document),
      document,
      context: { selectedItemIds: [], playheadFrame: 0 },
    };
    await expect(
      compileNativeAgentResult(request, {
        summary: "Introduce Sarah",
        commands: [
          {
            type: "insertGraphic",
            itemId: "lower",
            trackId: "visual",
            name: "Name",
            node: {
              macro: "lowerThird",
              title: "Sarah Chen",
              subtitle: "Product Designer",
              from: 0,
              duration: 150,
              palette: "slate",
              look: "solid",
              align: "left",
              tempo: "calm",
            },
          },
        ],
      }),
    ).rejects.toThrow(/no usable layout area/);
    expect(document.items).toHaveLength(0);
    const replacement = prepareReadableOverlay(document, {
      itemId: "lower",
      trackId: "visual",
      kind: "lowerThird",
      text: "Sarah Chen",
      subtitle: "Product Designer",
      from: 0,
      duration: 150,
    });
    const result = await compileNativeAgentResult(request, {
      summary: "Introduce Sarah",
      commands: [replacement],
    });
    expect(result.outcome).toBe("proposal");
    expect(document.items).toHaveLength(0);
  });
  for (const [width, height] of variants)
    for (const kind of ["title", "lowerThird", "caption"] as const) {
      it(`${kind} remains bounded on ${width}x${height} and applies through review commands`, async () => {
        const document = createVideoProjectDocument({
          width,
          height,
          fps: 30,
          durationInFrames: 120,
        });
        const original = structuredClone(document);
        const command = prepareReadableOverlay(document, {
          itemId: "overlay",
          trackId: "visual",
          kind,
          text: "Clear words, readable video",
          from: 15,
          duration: 60,
        });
        const result = await compileNativeAgentResult(
          {
            contract: "video-project-commands",
            version: 1,
            baseRevision: 0,
            baseHash: await hashVideoProjectDocument(document),
            document,
            context: { selectedItemIds: [], playheadFrame: 15 },
          },
          { summary: "Add readable overlay", commands: [command] },
        );
        expect(document).toEqual(original);
        const edited = executeVideoProjectCommands(
          document,
          result.proposal!.commands,
        ).document;
        const { scene } = compileVideoProjectDocument(edited);
        const boxes: LayoutBox[] = [];
        const visit = (box: LayoutBox) => {
          boxes.push(box);
          box.children.forEach(visit);
        };
        layoutScene(evaluateScene(scene, 30)).boxes.forEach(visit);
        const plate = boxes.find((box) => box.node.id === "overlay")!;
        expect(plate).toBeDefined();
        expect(plate.x).toBeGreaterThan(0);
        expect(plate.y).toBeGreaterThan(0);
        expect(plate.x + plate.width).toBeLessThan(width);
        expect(plate.y + plate.height).toBeLessThan(height);
        expect(plate.height).toBeLessThan(
          height * (kind === "title" ? 0.5 : 0.32),
        );
        expect(JSON.stringify(edited)).toContain("Clear words");
      });
    }
  it("preserves CJK and long tokens without truncating text", () => {
    const document = createVideoProjectDocument({
      width: 720,
      height: 1280,
      fps: 30,
      durationInFrames: 120,
    });
    for (const text of [
      "让每一帧都清晰可读，保留完整的文字内容。",
      "Supercalifragilisticexpialidocious",
    ]) {
      const result = prepareReadableOverlay(document, {
        itemId: "overlay",
        trackId: "visual",
        kind: "title",
        text,
        from: 0,
        duration: 60,
      });
      expect(result.node.children?.[0]?.text?.replace(/\n/g, "")).toBe(text);
    }
  });
  it("rejects excess copy, stale targets and out-of-timeline placement", () => {
    const document = createVideoProjectDocument({
      width: 360,
      height: 640,
      fps: 30,
      durationInFrames: 120,
    });
    const input = {
      itemId: "overlay",
      trackId: "visual",
      kind: "caption",
      text: "A title",
      from: 0,
      duration: 60,
    };
    expect(() =>
      prepareReadableOverlay(document, { ...input, text: "Words ".repeat(35) }),
    ).toThrow(/shorter|copy/i);
    expect(() =>
      prepareReadableOverlay(document, { ...input, from: 100 }),
    ).toThrow(/timeline/);
    document.tracks[0].locked = true;
    expect(() => prepareReadableOverlay(document, input)).toThrow(/unlocked/);
  });
  it("tool preparation returns a command without committing a proposal", async () => {
    const document = createVideoProjectDocument({
      width: 640,
      height: 360,
      fps: 30,
      durationInFrames: 120,
    });
    const request = {
      contract: "video-project-commands" as const,
      version: 1 as const,
      baseRevision: 0,
      baseHash: await hashVideoProjectDocument(document),
      document,
      context: { selectedItemIds: [], playheadFrame: 0 },
    };
    const before = structuredClone(document);
    const tool = createVideoTools(request, []).find(
      (tool) => tool.name === "prepare_text_overlay",
    )!;
    const result = await tool.execute(
      {
        itemId: "new",
        trackId: "visual",
        kind: "lowerThird",
        text: "Ada Lovelace",
        subtitle: "Analyst",
        from: 0,
        duration: 90,
      },
      new AbortController().signal,
    );
    expect(result.kind).toBe("observation");
    expect(document).toEqual(before);
  });
});
