import { createHash } from "node:crypto";
import Ajv from "ajv";
import { expect, it } from "vitest";
import {
  registerDojoVideoEngineJsonSchemaFormats,
  sceneJsonSchema,
  sceneNodeSchema,
} from "@dojo-video-engine/schema";
import { nativeAgentGraphicsSchema } from "../packages/core/src/lib/video-project/agent-schema";
import { compileNativeAgentResult } from "../packages/core/src/lib/video-project/agent-runtime";
import {
  createVideoProjectDocument,
  hashVideoProjectDocument,
} from "../packages/core/src/lib/video-project/document";

type Schema = Record<string, unknown>;
function at(value: unknown, path: readonly string[]): Schema {
  let current = value;
  for (const key of path) current = (current as Schema)[key];
  return current as Schema;
}
function graphics(installedGrammar = true) {
  const value = nativeAgentGraphicsSchema(
    {},
    installedGrammar ? { installedGrammar: true } : {},
  );
  if (!("node" in value) || !value.node || !value.examples || !value.animation)
    throw new Error("Native discovery required");
  return value;
}
async function requestFixture() {
  const document = createVideoProjectDocument({
    width: 1280,
    height: 720,
    fps: 30,
    durationInFrames: 360,
  });
  return {
    contract: "video-project-commands" as const,
    version: 1 as const,
    baseRevision: 0,
    baseHash: await hashVideoProjectDocument(document),
    document,
    context: { selectedItemIds: [], playheadFrame: 0 },
    instruction: "Create an editable animated group",
  };
}
function edit(node: unknown) {
  return {
    summary: "Editable group",
    outcome: "proposal",
    commands: [
      {
        type: "insertGraphic",
        itemId: "native-chart",
        trackId: "visual",
        name: "Native chart",
        node,
      },
    ],
  };
}
function references(value: unknown): string[] {
  if (!value || typeof value !== "object") return [];
  if (Array.isArray(value)) return value.flatMap(references);
  const record = value as Schema;
  return [
    ...(typeof record.$ref === "string" ? [record.$ref] : []),
    ...Object.values(record).flatMap(references),
  ];
}

it("preserves the exact old discovery bytes and returns bounded installed metadata only when requested", () => {
  const old = JSON.stringify(graphics(false));
  expect(old.length).toBe(12674);
  expect(createHash("sha256").update(old).digest("hex")).toBe(
    "952b64d3875dd364a1de1a2c88414425df51eaa9de5dd4c581a2d7fe1d477153",
  );
  expect(
    at(graphics(false).node, [
      "properties",
      "style",
      "properties",
      "transformOrigin",
    ]),
  ).toEqual({ type: "string", maxLength: 8192 });
  const value = graphics();
  expect(Buffer.byteLength(JSON.stringify(value))).toBeLessThan(32768);
  expect(references(value.node)).toEqual(["#"]);
  expect(references(value.animation)).toEqual([]);
  expect(value.animation).not.toHaveProperty("allOf");
  expect(
    nativeAgentGraphicsSchema(
      { kind: "macro", macro: "kineticText" },
      { installedGrammar: true },
    ),
  ).toEqual(nativeAgentGraphicsSchema({ kind: "macro", macro: "kineticText" }));
});

it("copies authoritative refined metadata including referenced siblings and nested union leaves", () => {
  const published = sceneJsonSchema();
  const source = at(published, [
    "definitions",
    "DojoVideoEngineScene",
    "properties",
    "nodes",
    "items",
    "properties",
    "style",
    "properties",
  ]);
  const actual = at(graphics().node, ["properties", "style", "properties"]);
  for (const key of [
    "transformOrigin",
    "transform",
    "color",
    "fill",
    "filter",
    "fontFamily",
    "objectPosition",
  ]) {
    const declared = source[key] as Schema;
    expect(actual[key]).toMatchObject({
      description: declared.description,
      format: declared.format,
    });
  }
  expect(at(actual.width, ["anyOf", "1"])).toMatchObject({
    format: "dojo-video-engine-length",
    description: expect.stringContaining("px or %"),
  });
  expect(at(actual.fontWeight, ["anyOf", "1"])).toMatchObject({
    format: "dojo-video-engine-font-weight",
    description: expect.stringContaining("font weight"),
  });
  const animation = graphics().animation;
  expect(
    at(animation, ["properties", "frames", "items", "properties", "easing"]),
  ).toMatchObject({
    format: "dojo-video-engine-easing",
    description: expect.stringContaining("cubic-bezier"),
  });
  const animatedValue = at(animation, [
    "properties",
    "frames",
    "items",
    "properties",
    "value",
  ]);
  expect(animatedValue.description).toContain("named animation.property");
  expect(animatedValue.description).toContain(
    "node.properties.style.properties",
  );
  expect(animatedValue).not.toHaveProperty("format");
  expect(at(graphics().node, ["properties", "animations", "items"])).toEqual(
    animation,
  );
  (actual.transformOrigin as Schema).description = "Changed caller copy";
  expect(
    at(graphics().node, [
      "properties",
      "style",
      "properties",
      "transformOrigin",
    ]).description,
  ).toBe((source.transformOrigin as Schema).description);
});

it("the discovered canonical origin example validates through registered engine formats and the actual native compiler", async () => {
  const value = graphics();
  const example = value.examples.animatedGroup;
  expect(example.style.transformOrigin).toBe("center bottom");
  const validator = registerDojoVideoEngineJsonSchemaFormats(
    new Ajv({ strict: false }),
  );
  const validate = validator.compile(value.node);
  expect(validate(example)).toBe(true);
  expect(sceneNodeSchema.safeParse(example).success).toBe(true);
  const request = await requestFixture(),
    before = JSON.stringify(request);
  await expect(
    compileNativeAgentResult(request, edit(example)),
  ).resolves.toMatchObject({ outcome: "proposal" });
  expect(JSON.stringify(request)).toBe(before);
  const validateAnimation = validator.compile(value.animation as Schema);
  expect(
    validateAnimation({
      kind: "keyframes",
      property: "transform",
      frames: [{ frame: 0, value: "scale(1)", easing: "banana" }],
    }),
  ).toBe(false);
});

it.each([
  "bottom center",
  "left right",
  "top bottom",
  "1em 50%",
  "center banana",
])(
  "retains native rejection of invalid static and animated origin %s",
  async (transformOrigin) => {
    const value = graphics();
    const example = value.examples.animatedGroup;
    const invalid = {
      ...example,
      style: { ...example.style, transformOrigin },
    };
    const validator = registerDojoVideoEngineJsonSchemaFormats(
      new Ajv({ strict: false }),
    ).compile(value.node);
    expect(validator(invalid)).toBe(false);
    expect(sceneNodeSchema.safeParse(invalid).success).toBe(false);
    const animated = {
      ...example,
      animations: [
        {
          kind: "keyframes",
          property: "transformOrigin",
          frames: [{ frame: 0, value: transformOrigin }],
        },
      ],
    };
    expect(sceneNodeSchema.safeParse(animated).success).toBe(false);
    const request = await requestFixture();
    await expect(
      compileNativeAgentResult(request, edit(invalid)),
    ).rejects.toThrow();
    await expect(
      compileNativeAgentResult(request, edit(animated)),
    ).rejects.toThrow();
  },
);
