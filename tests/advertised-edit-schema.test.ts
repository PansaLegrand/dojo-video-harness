import Ajv from "ajv";
import { expect, it } from "vitest";
import { nativeAgentResponseSchema } from "../packages/core/src/lib/video-project/agent-schema";
import {
  createVideoProjectDocument,
  hashVideoProjectDocument,
} from "../packages/core/src/lib/video-project/document";
import { createVideoToolset } from "../packages/agent/src/tools";
import {
  builtInSkills,
  embedEditingSchema,
  editingOnlyProposalSchema,
} from "../packages/agent-kit/src/index";
import type { NativeAgentRequest } from "../packages/core/src/lib/video-project/agent-runtime";
function references(root: unknown) {
  const result: string[] = [];
  const visit = (v: unknown) => {
    if (!v || typeof v !== "object") return;
    if (Array.isArray(v)) {
      v.forEach(visit);
      return;
    }
    const row = v as Record<string, unknown>;
    if (typeof row.$ref === "string") result.push(row.$ref);
    Object.values(row).forEach(visit);
  };
  visit(root);
  return result;
}
function pointer(root: unknown, reference: string) {
  if (reference === "#") return root;
  if (!reference.startsWith("#/"))
    throw new Error("Expected a local tool-schema reference.");
  let result = root;
  for (const key of reference.slice(2).split("/")) {
    if (!result || typeof result !== "object") return undefined;
    result = (result as Record<string, unknown>)[
      decodeURIComponent(key).replace(/~1/g, "/").replace(/~0/g, "~")
    ];
  }
  return result;
}
async function fixture(
  profile:
    | "local-editor-v5"
    | "commercial-editing-v6"
    | "commercial-editing-v5",
) {
  const document = createVideoProjectDocument({
    width: 640,
    height: 360,
    fps: 30,
    durationInFrames: 1080,
  });
  for (let i = 0; i < 8; i++)
    document.assets[`asset-${i}`] = {
      id: `asset-${i}`,
      name: `Media ${i}`,
      type: i < 3 ? "video" : "image",
      source: "local",
      ...(i < 3 ? { durationSeconds: 12 } : { width: 640, height: 360 }),
    };
  const request: NativeAgentRequest = {
    contract: "video-project-commands",
    version: 1,
    baseRevision: 1,
    baseHash: await hashVideoProjectDocument(document),
    document,
    context: { selectedItemIds: [], playheadFrame: 0 },
    authoring: { version: 1, scope: { kind: "project" } },
  };
  const tools = createVideoToolset(request, builtInSkills(), [], { profile });
  const commands: unknown[] = [];
  for (let i = 0; i < 8; i++)
    commands.push({
      type: "addItem",
      item: {
        id: `item-${i}`,
        name: `Media ${i}`,
        trackId: "visual",
        node: {
          id: `item-${i}`,
          type: i < 3 ? "video" : "img",
          assetId: `asset-${i}`,
          from: i * 90,
          duration: 90,
          ...(i < 3 ? { videoStartTime: 1 } : {}),
          style: {
            position: "absolute",
            left: 0,
            top: 0,
            width: 640,
            height: 360,
            objectFit: "contain",
          },
        },
      },
    });
  for (let i = 0; i < 2; i++) {
    commands.push({
      type: "trimItem",
      id: `item-${i}`,
      from: i * 90,
      duration: 90,
    });
    commands.push({
      type: "set",
      target: { kind: "node", itemId: `item-${i}`, nodeId: `item-${i}` },
      path: ["videoStartTime"],
      value: 1,
    });
    const originalCaption = {
      type: "addItem",
      item: {
        id: `captions-${i}`,
        name: "Captions",
        trackId: "visual",
        node: {
          id: `captions-${i}`,
          type: "div",
          from: i * 90,
          duration: 90,
          style: {
            position: "absolute",
            left: 32,
            top: 280,
            width: 576,
            height: 44,
            fontSize: 18,
            color: "#ff0000",
          },
        },
        caption: {
          mode: "sentence",
          direction: "ltr",
          highlightColor: "#ffffff",
          sourceItemId: `item-${i}`,
          language: "en",
          role: "original",
          pairedItemId: `translation-${i}`,
          cues: [
            {
              id: "cue:0",
              text: "Exact source words.",
              startMs: 0,
              endMs: 1000,
            },
          ],
        },
      },
    };
    commands.push(originalCaption, {
      type: "addItem",
      item: {
        ...originalCaption.item,
        id: `translation-${i}`,
        name: "Chinese captions",
        node: {
          ...originalCaption.item.node,
          id: `translation-${i}`,
          style: {
            ...originalCaption.item.node.style,
            top: 320,
            color: "#ffffff",
          },
        },
        caption: {
          ...originalCaption.item.caption,
          language: "zh",
          role: "translation",
          pairedItemId: `captions-${i}`,
          cues: originalCaption.item.caption.cues.map((cue) => ({
            ...cue,
            text: "准确的原文。",
          })),
        },
      },
    });
    commands.push({
      type: "insertGraphic",
      itemId: `quote-${i}`,
      trackId: "visual",
      name: "Quote",
      node: {
        type: "text",
        text: "Exact source words",
        from: i * 90,
        duration: 45,
        style: {
          position: "absolute",
          left: 40,
          top: 40,
          width: 560,
          height: 60,
          fontSize: 32,
          color: "#ffffff",
        },
      },
    });
    commands.push({
      type: "anchorSpeech",
      id: `quote-binding-${i}`,
      itemId: `quote-${i}`,
      sourceItemId: `item-${i}`,
      evidenceId: `evidence-${i}`,
      wordIds: [`word-${i}-0`, `word-${i}-1`, `word-${i}-2`],
      holdMs: 1500,
    });
  }
  commands.push(
    {
      type: "set",
      target: { kind: "format" },
      path: ["durationInFrames"],
      value: 810,
    },
    {
      type: "insertGraphic",
      itemId: "ending",
      trackId: "visual",
      name: "Ending",
      node: {
        macro: "titleCard",
        title: "Made by DojoClip.com",
        from: 720,
        duration: 90,
      },
    },
  );
  return {
    request,
    tools,
    edit: {
      summary:
        "Complete three-video five-image edit with source captions and callouts",
      outcome: "proposal",
      commands,
    },
    requirements: [
      {
        id: "media",
        kind: "asset_sequence",
        items: Array.from({ length: 8 }, (_, i) => ({
          itemId: `item-${i}`,
          assetId: `asset-${i}`,
          from: i * 90,
          duration: 90,
          ...(i < 3 ? { sourceStartSeconds: 1 } : {}),
        })),
      },
      ...Array.from({ length: 2 }, (_, i) => ({
        id: `pair-${i}`,
        kind: "caption_pair",
        sourceItemId: `item-${i}`,
        evidenceId: `evidence-${i}`,
        originalItemId: `captions-${i}`,
        translatedItemId: `translation-${i}`,
        originalLanguage: "en",
        translatedLanguage: "zh",
        originalColor: "#ff0000",
        translatedColor: "#ffffff",
      })),
      ...Array.from({ length: 2 }, (_, i) => ({
        id: `callout-${i}`,
        kind: "speech_callout",
        itemId: `quote-${i}`,
        bindingId: `quote-binding-${i}`,
        sourceItemId: `item-${i}`,
        evidenceId: `evidence-${i}`,
        wordIds: [`word-${i}-0`, `word-${i}-1`, `word-${i}-2`],
        exactText: "Exact source words",
        minReadableMs: 1000,
      })),
      {
        id: "ending",
        kind: "appended_ending",
        itemId: "ending",
        exactText: "Made by DojoClip.com",
        minDurationMs: 1000,
        animated: true,
      },
    ],
  };
}
it.each(["local-editor-v5", "commercial-editing-v6"] as const)(
  "resolves every local reference in every advertised %s tool schema",
  async (profile) => {
    const { tools } = await fixture(profile);
    const ajv = new Ajv({ strict: false, allErrors: true });
    let total = 0;
    for (const tool of tools.tools) {
      const refs = references(tool.parameters);
      total += refs.length;
      for (const ref of refs)
        expect(
          pointer(tool.parameters, ref),
          `${tool.name}: ${ref}`,
        ).toBeDefined();
      expect(() => ajv.compile(tool.parameters), tool.name).not.toThrow();
    }
    expect(total).toBeGreaterThan(100);
  },
);
it("validates a full mixed-media command payload against the actual nested review and terminal schemas", async () => {
  const f = await fixture("commercial-editing-v6"),
    ajv = new Ajv({ strict: false, allErrors: true });
  const review = ajv.compile(
    f.tools.tools.find((tool) => tool.name === "review_edit")!.parameters,
  );
  const propose = ajv.compile(
    f.tools.tools.find((tool) => tool.name === "propose_edit")!.parameters,
  );
  expect(
    review({ requirements: f.requirements, edit: f.edit }),
    JSON.stringify(review.errors),
  ).toBe(true);
  expect(propose(f.edit), JSON.stringify(propose.errors)).toBe(true);
  for (const edit of [
    { ...f.edit, commands: [] },
    { ...f.edit, outcome: "answer" },
    { ...f.edit, outcome: "retrieve_context" },
    { ...f.edit, clarification: { id: "q", question: "Why?" } },
    { ...f.edit, retrieval: { query: "words" } },
  ]) {
    expect(review({ requirements: f.requirements, edit })).toBe(false);
    expect(propose(edit)).toBe(false);
  }
  const invalid = {
    ...f.edit,
    commands: [
      {
        type: "set",
        target: { kind: "node" },
        path: ["text"],
        value: "Missing target IDs",
      },
    ],
  };
  expect(review({ requirements: f.requirements, edit: invalid })).toBe(false);
});
it("retains the earlier nested-reference failure as a regression while leaving source/proposal schemas intact", async () => {
  const old = await fixture("commercial-editing-v5"),
    schema = old.tools.tools.find(
      (tool) => tool.name === "review_edit",
    )!.parameters;
  expect(
    references(schema).some((ref) => pointer(schema, ref) === undefined),
  ).toBe(true);
  const original = nativeAgentResponseSchema({
      clarification: true,
      composition: true,
      anchorHold: true,
    }),
    before = JSON.stringify(original);
  editingOnlyProposalSchema(original);
  embedEditingSchema(original);
  expect(JSON.stringify(original)).toBe(before);
});
it("rebases self and escaped local pointers inside an embedded editing schema", () => {
  const original = {
    type: "object",
    properties: {
      outcome: { type: "string" },
      commands: { $ref: "#/definitions/a~1b" },
    },
    definitions: { "a/b": { type: "array", items: { $ref: "#" } } },
  };
  const root = {
    type: "object",
    properties: { edit: embedEditingSchema(original) },
  };
  for (const ref of references(root)) expect(pointer(root, ref)).toBeDefined();
});
