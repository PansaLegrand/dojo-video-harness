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

it.each(["local-editor-v3", "commercial-editing-v4"] as const)(
  "preserves kit13 %s skill text, inventory and prompt bytes",
  async (profile) => {
    const fixture = JSON.parse(
      readFileSync(
        new URL("./fixtures/agent-kit-v13-profiles.json", import.meta.url),
        "utf8",
      ),
    );
    const set = toolset(profile),
      value = {
        inventory: set.inventory,
        skills: set.skills,
        prompt: composeToolAgentPrompt({
          profile,
          editingGuide: "Fixture editor guide.",
          toolNames: set.tools.map((tool) => tool.name),
          skills: set.skills,
        }),
      };
    expect(set.inventory.kitVersion).toBe("0.1.3");
    expect(
      createHash("sha256").update(JSON.stringify(value)).digest("hex"),
    ).toBe(fixture.hashes[profile]);
  },
);
it.each(["local-editor-v4", "commercial-editing-v5"] as const)(
  "uses requested-source discovery guidance only for %s",
  (profile) => {
    const set = toolset(profile);
    expect(set.inventory.kitVersion).toBe("0.1.4");
    const guide = composeToolAgentPrompt({
      profile,
      editingGuide: "Fixture editor guide.",
      toolNames: set.tools.map((tool) => tool.name),
      skills: set.skills,
    });
    expect(guide).toContain(
      "Begin preparation once the needed facts are available",
    );
    expect(guide).toContain("All requested outputs");
    expect(guide).toContain("Use list_assets name/type filters");
    expect(
      set.skills.find((skill) => skill.name === "multi-asset-editing")!
        .instructions,
    ).toContain("Unrelated imported assets");
  },
);

it("uses the frozen host snapshot for omitted hashes only in efficient reader profiles", async () => {
  const current = toolset("commercial-editing-v5"),
    old = toolset("commercial-editing-v4"),
    signal = new AbortController().signal;
  const assets = current.tools.find((tool) => tool.name === "list_assets")!,
    cues = current.tools.find((tool) => tool.name === "read_caption_cues")!;
  expect(assets.parameters.required).toEqual([]);
  expect(cues.parameters.required).toEqual(["sourceItemId", "evidenceId"]);
  await expect(assets.execute({}, signal)).resolves.toMatchObject({
    kind: "observation",
  });
  await expect(
    cues.execute({ sourceItemId: "clip", evidenceId: "e" }, signal),
  ).resolves.toMatchObject({ kind: "observation" });
  await expect(
    assets.execute({ snapshotHash: "sha256:" + "b".repeat(64) }, signal),
  ).rejects.toThrow(/frozen host snapshot/);
  await expect(
    cues.execute(
      {
        snapshotHash: "sha256:" + "b".repeat(64),
        sourceItemId: "clip",
        evidenceId: "e",
      },
      signal,
    ),
  ).rejects.toThrow(/frozen host snapshot/);
  await expect(
    old.tools.find((tool) => tool.name === "list_assets")!.execute({}, signal),
  ).rejects.toThrow(/snapshotHash/);
  expect(
    old.tools.find((tool) => tool.name === "list_assets")!.parameters.required,
  ).toEqual(["snapshotHash"]);
});

it.each([
  "local-editor-v4",
  "commercial-editing-v5",
  "local-editor-v5",
  "commercial-editing-v6",
] as const)(
  "preserves retained %s complete advertised contracts",
  (profile) => {
    const frozen = JSON.parse(
      readFileSync(
        new URL(
          profile === "local-editor-v5" || profile === "commercial-editing-v6"
            ? "./fixtures/agent-kit-v15-profiles.json"
            : "./fixtures/agent-kit-v14-profiles.json",
          import.meta.url,
        ),
        "utf8",
      ),
    );
    const set = toolset(profile),
      value = {
        inventory: set.inventory,
        skills: set.skills,
        prompt: composeToolAgentPrompt({
          profile,
          editingGuide: "Fixture editor guide.",
          toolNames: set.tools.map((tool) => tool.name),
          skills: set.skills,
        }),
      };
    expect(set.inventory.kitVersion).toBe(frozen.kitVersion);
    expect(
      createHash("sha256").update(JSON.stringify(value)).digest("hex"),
    ).toBe(frozen.hashes[profile]);
  },
);
it("removes model reader snapshot arguments entirely only in resolved-edit profiles", async () => {
  const set = toolset("commercial-editing-v6"),
    signal = new AbortController().signal;
  for (const name of ["list_assets", "read_caption_cues"]) {
    const tool = set.tools.find((value) => value.name === name)!;
    expect(tool.parameters.properties).not.toHaveProperty("snapshotHash");
    await expect(
      tool.execute(
        {
          snapshotHash: "sha256:" + "a".repeat(64),
          ...(name === "read_caption_cues"
            ? { sourceItemId: "clip", evidenceId: "e" }
            : {}),
        },
        signal,
      ),
    ).rejects.toThrow(/Unknown tool field/);
  }
  const edit = { outcome: "proposal", commands: [] };
  const result = await set.tools
    .find((tool) => tool.name === "review_edit")!
    .execute(
      {
        requirements: [
          { id: "required", kind: "item_present", itemId: "item" },
        ],
        edit,
      },
      signal,
    );
  expect(result).toMatchObject({
    kind: "observation",
    pinned: true,
    value: {
      completionPreflight: {
        status: "failed",
        requirements: [{ id: "required" }],
        checks: [
          {
            passed: false,
            message: expect.stringMatching(/Commands|commands/),
          },
        ],
      },
    },
  });
});
