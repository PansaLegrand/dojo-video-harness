import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { expect, it } from "vitest";
import {
  builtInSkills,
  createEditorToolset,
  composeToolAgentPrompt,
  type AgentProfile,
} from "../packages/agent-kit/src/index";
const legacy = JSON.parse(
  readFileSync(
    new URL("./fixtures/agent-kit-legacy-profiles.json", import.meta.url),
    "utf8",
  ),
);
function toolset(profile: AgentProfile) {
  const noop = async () => ({});
  return createEditorToolset({
    profile,
    snapshotHash: "sha256:" + "a".repeat(64),
    skills: builtInSkills(),
    proposalSchema: {
      type: "object",
      properties: { commands: { type: "array" } },
      required: ["commands"],
      additionalProperties: false,
    },
    ports: {
      inspectProject: noop,
      inspectGraphicsSchema: noop,
      searchTranscript: noop,
      prepareSvgGraphic: noop,
      prepareThreeScene: noop,
      proposeEdit: noop,
      askUser: noop,
      reviewEdit: async () => ({ checks: [] }),
      prepareCaptionPair: noop,
      listAssets: noop,
      readCaptionCues: noop,
      ...(profile.startsWith("local") ? { prepareTextOverlay: noop } : {}),
    },
  });
}
it.each(Object.keys(legacy.hashes) as AgentProfile[])(
  "preserves %s complete inventory, skill text and prompt bytes against retained kit0.1.2",
  (profile) => {
    const set = toolset(profile),
      value = {
        inventory: set.inventory,
        skills: set.skills,
        prompt: composeToolAgentPrompt({
          editingGuide: "Fixture editor guide.",
          toolNames: set.tools.map((t) => t.name),
          skills: set.skills,
        }),
      };
    expect(
      createHash("sha256").update(JSON.stringify(value)).digest("hex"),
    ).toBe(legacy.hashes[profile]);
    expect(set.tools.map((t) => t.name)).not.toContain("list_assets");
    expect(set.tools.map((t) => t.name)).not.toContain("read_caption_cues");
  },
);
it.each(["local-editor-v3", "commercial-editing-v4"] as const)(
  "advertises complete reader contracts only in %s",
  (profile) => {
    const set = toolset(profile);
    expect(set.inventory.kitVersion).toBe("0.1.3");
    expect(set.tools.map((t) => t.name)).toEqual(
      expect.arrayContaining(["list_assets", "read_caption_cues"]),
    );
    expect(set.skills.map((s) => s.name)).toContain("multi-asset-editing");
    expect(
      composeToolAgentPrompt({
        editingGuide: "",
        toolNames: set.tools.map((t) => t.name),
        skills: set.skills,
      }),
    ).toContain("coverage.nextCursor");
  },
);

it("restricts grouped-media and phrase-callout declarations to new profile contracts", async () => {
  const { parseCompletionRequirements } = await import(
    "../packages/agent-kit/src/index"
  );
  const sequence = {
    id: "sequence",
    kind: "asset_sequence",
    items: [
      {
        itemId: "clip",
        assetId: "video",
        from: 0,
        duration: 30,
        sourceStartSeconds: 1,
      },
    ],
  };
  expect(() => parseCompletionRequirements([sequence])).toThrow();
  expect(
    parseCompletionRequirements([sequence], { assetSequence: true }),
  ).toEqual([sequence]);
  for (const items of [
    [],
    [{ ...sequence.items[0], duration: 0 }],
    [...sequence.items, ...sequence.items],
    [{ ...sequence.items[0], sourceStartSeconds: -1 }],
  ])
    expect(() =>
      parseCompletionRequirements([{ ...sequence, items }], {
        assetSequence: true,
      }),
    ).toThrow();
  const callout = {
    id: "quote",
    kind: "speech_callout",
    itemId: "quote",
    bindingId: "binding",
    sourceItemId: "clip",
    evidenceId: "evidence",
    wordIds: ["word"],
    exactText: "Year over year",
    minReadableMs: 1200,
  };
  expect(() => parseCompletionRequirements([callout])).toThrow();
  expect(
    parseCompletionRequirements([callout], { speechCallout: true }),
  ).toEqual([callout]);
  const old = toolset("commercial-editing-v3"),
    current = toolset("commercial-editing-v4");
  expect(
    JSON.stringify(
      old.tools.find((tool) => tool.name === "review_edit")!.parameters,
    ),
  ).not.toContain("asset_sequence");
  expect(
    JSON.stringify(
      old.tools.find((tool) => tool.name === "review_edit")!.parameters,
    ),
  ).not.toContain("speech_callout");
  expect(
    JSON.stringify(
      current.tools.find((tool) => tool.name === "review_edit")!.parameters,
    ),
  ).toContain("asset_sequence");
  expect(
    JSON.stringify(
      current.tools.find((tool) => tool.name === "review_edit")!.parameters,
    ),
  ).toContain("speech_callout");
});
