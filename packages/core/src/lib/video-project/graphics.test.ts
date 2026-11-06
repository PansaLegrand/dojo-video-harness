import { describe, expect, it } from "vitest";
import {
  createVideoProjectDocument,
  hashVideoProjectDocument,
  parseVideoProjectDocument,
} from "./document";
import { compileNativeAgentResult } from "./agent-runtime";
import { executeVideoProjectCommands } from "./commands";
import {
  parseThreeScene,
  THREE_EXTENSION,
  evaluateThreeTransform,
} from "@dojo-video-engine/three/schema";

const params = {
  camera: {
    kind: "perspective",
    position: { x: 0, y: 1, z: 7 },
    target: { x: 0, y: 0, z: 0 },
  },
  materials: { red: { color: "#ff0000" } },
  objects: {
    wheel: {
      kind: "mesh",
      materialId: "red",
      geometry: { kind: "torus", radius: 1, tube: 0.1 },
      spin: { x: 0, y: 0, z: 180 },
    },
  },
};
const base = () =>
  createVideoProjectDocument({
    width: 640,
    height: 360,
    fps: 30,
    durationInFrames: 180,
  });
async function propose(document: ReturnType<typeof base>, commands: unknown[]) {
  return compileNativeAgentResult(
    {
      contract: "video-project-commands",
      version: 1,
      baseRevision: 0,
      baseHash: await hashVideoProjectDocument(document),
      document,
      context: { selectedItemIds: [], playheadFrame: 0 },
      authoring: { version: 1, scope: { kind: "project" } },
    },
    { summary: "Edit original graphics", commands },
  );
}
describe("editable SVG and Three.js commands", () => {
  it("imports SVG as one editable item, then corrects a part without replacing its neighbors", async () => {
    const doc = base();
    const proposal = await propose(doc, [
      {
        type: "insertSvg",
        itemId: "bird",
        trackId: "visual",
        name: "Bird",
        from: 0,
        duration: 150,
        svg: '<svg viewBox="0 0 200 100"><circle id="body" cx="50" cy="50" r="30" fill="white"/><path id="beak" fill="yellow" d="M70 40 L150 50 L70 60 Z"/></svg>',
      },
    ]);
    const inserted = executeVideoProjectCommands(
      doc,
      proposal.proposal!.commands,
    ).document;
    expect(inserted.items).toHaveLength(1);
    const before = structuredClone(inserted.items[0]!.node.children![0]);
    const edited = executeVideoProjectCommands(inserted, [
      {
        type: "set",
        target: { kind: "node", itemId: "bird", nodeId: "bird:svg:id:beak" },
        path: ["style", "fill"],
        value: "orange",
      },
    ]);
    expect(edited.document.items[0]!.node.children![1]!.style!.fill).toBe(
      "orange",
    );
    expect(edited.document.items[0]!.node.children![0]).toEqual(before);
    expect(
      parseVideoProjectDocument(JSON.parse(JSON.stringify(edited.document))),
    ).toEqual(edited.document);
    expect(Object.keys(edited.document.assets)).toHaveLength(0);
  });
  it("preserves 3D source phase through head trim, split, movement and reload", async () => {
    const doc = base();
    const result = await propose(doc, [
      {
        type: "insertGraphic",
        itemId: "three",
        trackId: "visual",
        name: "Bike",
        node: {
          type: "extension",
          from: 0,
          duration: 150,
          style: { position: "absolute", inset: 0 },
          extension: { ...THREE_EXTENSION, params },
        },
      },
    ]);
    const inserted = executeVideoProjectCommands(
      doc,
      result.proposal!.commands,
    ).document;
    const trimmed = executeVideoProjectCommands(inserted, [
      { type: "trimItem", id: "three", from: 30, duration: 120 },
      { type: "splitItem", id: "three", frame: 60, newId: "tail" },
      { type: "moveItem", id: "tail", from: 90 },
    ]).document;
    const left = parseThreeScene(
      trimmed.items.find((item) => item.id === "three")!.node.extension!.params,
    );
    const right = parseThreeScene(
      trimmed.items.find((item) => item.id === "tail")!.node.extension!.params,
    );
    expect(left.timeOffset).toBe(1);
    expect(right.timeOffset).toBe(2);
    expect(
      evaluateThreeTransform(right.objects.wheel!, right.timeOffset).rotation.z,
    ).toBe(360);
    expect(
      parseVideoProjectDocument(JSON.parse(JSON.stringify(trimmed))),
    ).toEqual(trimmed);
    const recolored = executeVideoProjectCommands(trimmed, [
      {
        type: "set",
        target: { kind: "node", itemId: "tail", nodeId: "tail" },
        path: ["extension", "params", "materials", "red", "color"],
        value: "#00ff00",
      },
    ]).document;
    expect(recolored.items.find((item) => item.id === "three")).toEqual(
      trimmed.items.find((item) => item.id === "three"),
    );
    expect(() =>
      executeVideoProjectCommands(trimmed, [
        {
          type: "set",
          target: { kind: "node", itemId: "tail", nodeId: "tail" },
          path: ["extension", "params", "objects", "wheel", "parentId"],
          value: "wheel",
        },
      ]),
    ).toThrow(/cycle/);
  });
  it("rejects hostile SVG and malformed 3D before committing any command", async () => {
    const doc = base(),
      hash = await hashVideoProjectDocument(doc);
    await expect(
      propose(doc, [
        {
          type: "insertSvg",
          itemId: "bad",
          trackId: "visual",
          name: "Bad",
          from: 0,
          duration: 30,
          svg: '<svg viewBox="0 0 100 100"><script>alert(1)</script></svg>',
        },
      ]),
    ).rejects.toThrow();
    await expect(
      propose(doc, [
        {
          type: "insertGraphic",
          itemId: "bad",
          trackId: "visual",
          name: "Bad",
          node: {
            type: "extension",
            from: 0,
            duration: 30,
            extension: {
              ...THREE_EXTENSION,
              params: {
                ...params,
                objects: {
                  wheel: { ...params.objects.wheel, materialId: "missing" },
                },
              },
            },
          },
        },
      ]),
    ).rejects.toThrow(/material/);
    expect(await hashVideoProjectDocument(doc)).toBe(hash);
  });
});
