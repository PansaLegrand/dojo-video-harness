import { expect, it, vi } from "vitest";
import {
  builtInSkills,
  completionHash,
  composeToolAgentPrompt,
  createEditorToolset,
  type AgentProfile,
  type CompletionRequirement,
  type StageCaptionPair,
} from "../packages/agent-kit/src/index";
import { deriveCaptionPlanRequirements } from "../packages/agent-kit/src/caption-plan";

const pair: StageCaptionPair = {
  sourceItemId: "speech",
  evidenceId: "words",
  originalItemId: "english",
  translatedItemId: "chinese",
  trackId: "visual",
  originalLanguage: "en",
  translatedLanguage: "zh",
  originalColor: "#ff0000",
  translatedColor: "#ffffff",
};
const second = {
  ...pair,
  sourceItemId: "speech-2",
  evidenceId: "words-2",
  originalItemId: "english-2",
  translatedItemId: "chinese-2",
};
const other = (count: number): CompletionRequirement[] =>
  Array.from({ length: count }, (_, index) => ({
    id: `keep-${index}`,
    kind: "item_present",
    itemId: `graphic-${index}`,
  }));
function explicit(id = "requested-pair"): CompletionRequirement {
  const { trackId: _track, sourceRange: _range, ...fields } = pair;
  return { id, kind: "caption_pair", ...fields };
}

it("derives two missing checks after nine supplied outcomes with stable bounded IDs and unchanged declarations", async () => {
  const supplied = other(9),
    input = JSON.stringify({ supplied, pair, second });
  const result = await deriveCaptionPlanRequirements(supplied, [pair, second]);
  expect(result).toHaveLength(11);
  expect(result.slice(0, 9)).toEqual(supplied);
  expect(result[9]).toEqual({
    ...explicit(),
    id: expect.stringMatching(/^caption-pair:[a-f0-9]{64}$/),
  });
  const { trackId: _track, ...secondFields } = second;
  expect(result[10]).toEqual({
    ...secondFields,
    kind: "caption_pair",
    id: expect.stringMatching(/^caption-pair:[a-f0-9]{64}$/),
  });
  const repeated = await deriveCaptionPlanRequirements(supplied, [
    second,
    pair,
  ]);
  expect(repeated[9].id).toBe(result[10].id);
  expect(repeated[10].id).toBe(result[9].id);
  expect(await completionHash(result)).toBe(
    await completionHash(
      await deriveCaptionPlanRequirements(supplied, [pair, second]),
    ),
  );
  expect(JSON.stringify({ supplied, pair, second })).toBe(input);
});

it("reuses matching explicit checks verbatim and appends only missing checks", async () => {
  const declared = {
    ...explicit(),
    originalColor: "#FF0000",
    translatedColor: "#FFFFFF",
  } as CompletionRequirement;
  const supplied = [other(1)[0], declared];
  const result = await deriveCaptionPlanRequirements(supplied, [pair, second]);
  expect(result.slice(0, 2)).toEqual(supplied);
  expect(result).toHaveLength(3);
  expect(result[1].id).toBe("requested-pair");
  expect(result[2]).toMatchObject({
    kind: "caption_pair",
    sourceItemId: "speech-2",
  });
});

it("permits pair-only or general-only plans while retaining the combined twelve-check ceiling", async () => {
  expect(await deriveCaptionPlanRequirements([], [pair])).toHaveLength(1);
  expect(await deriveCaptionPlanRequirements(other(1), [])).toEqual(other(1));
  expect(
    await deriveCaptionPlanRequirements(other(10), [pair, second]),
  ).toHaveLength(12);
  await expect(
    deriveCaptionPlanRequirements(other(11), [pair, second]),
  ).rejects.toThrow(/1–12/);
  await expect(deriveCaptionPlanRequirements([], [])).rejects.toThrow(/1–12/);
});

it.each([
  ["sourceItemId", "another-source"],
  ["evidenceId", "another-evidence"],
  ["originalItemId", "another-original"],
  ["translatedItemId", "another-translation"],
  ["originalLanguage", "fr"],
  ["translatedLanguage", "ja"],
  ["originalColor", "#000000"],
  ["translatedColor", "#000000"],
])(
  "rejects conflicting explicit %s before deriving a replacement",
  async (field, value) => {
    await expect(
      deriveCaptionPlanRequirements(
        [{ ...explicit(), [field]: value } as CompletionRequirement],
        [pair],
      ),
    ).rejects.toThrow(/must match exactly one declared caption pair/);
  },
);

it("rejects unplanned explicit pairs, duplicate checks, item identities and colliding requirement IDs", async () => {
  await expect(deriveCaptionPlanRequirements([explicit()], [])).rejects.toThrow(
    /must match/,
  );
  await expect(
    deriveCaptionPlanRequirements([explicit("one"), explicit("two")], [pair]),
  ).rejects.toThrow(/exactly once/);
  await expect(deriveCaptionPlanRequirements([], [pair, pair])).rejects.toThrow(
    /IDs must be unique/,
  );
  const [derived] = await deriveCaptionPlanRequirements([], [pair]);
  await expect(
    deriveCaptionPlanRequirements([{ ...other(1)[0], id: derived.id }], [pair]),
  ).rejects.toThrow(/IDs must be unique/);
  await expect(
    deriveCaptionPlanRequirements([other(1)[0], other(1)[0]], [pair]),
  ).rejects.toThrow(/IDs must be unique/);
});

function toolset(
  profile: AgentProfile,
  deriveCaptionPlan = true,
  frozen?: CompletionRequirement[],
) {
  const plan = vi.fn(async () => "planned"),
    noop = async () => ({});
  const create = async () =>
    createEditorToolset({
      profile,
      snapshotHash: "sha256:" + "a".repeat(64),
      skills: builtInSkills(),
      proposalSchema: {
        type: "object",
        properties: { commands: { type: "array" } },
      },
      ...(frozen
        ? {
            initialCompletionState: {
              version: 1 as const,
              snapshotHash: "sha256:" + "a".repeat(64),
              requirements: frozen,
              requirementsHash: await completionHash(frozen),
            },
          }
        : {}),
      ports: {
        inspectProject: noop,
        inspectGraphicsSchema: noop,
        searchTranscript: noop,
        prepareSvgGraphic: noop,
        prepareThreeScene: noop,
        listAssets: noop,
        readCaptionCues: noop,
        reviewEdit: async () => ({ checks: [] }),
        proposeEdit: async () => "proposal",
        askUser: async () => "question",
        stages: {
          phase: "planning",
          generalEditing: true,
          deriveCaptionPlan,
          preparedCommands: false,
          planEditStages: plan,
          saveCaptionBatch: async () => "batch",
          readEditArtifact: noop,
          resolvePreparedEdit: async (value) => value,
        },
      },
    });
  return { create, plan };
}

it("exposes derivation only with the new profile and opted-in host, leaving review requirements nonempty", async () => {
  for (const [profile, enabled, minimum] of [
    ["local-editor-v13", true, 1],
    ["local-editor-v14", false, 1],
    ["local-editor-v14", true, 0],
  ] as const) {
    const f = toolset(profile, enabled),
      set = await f.create();
    const plan = set.tools.find((tool) => tool.name === "plan_edit_stages")!;
    expect(plan.parameters).toMatchObject({
      properties: { requirements: { minItems: minimum, maxItems: 12 } },
    });
    if (minimum === 0) {
      await expect(
        plan.execute(
          { requirements: [], captionPairs: [pair] },
          new AbortController().signal,
        ),
      ).resolves.toEqual({ kind: "terminal", result: "planned" });
      expect(plan.description).toContain(
        "derives a missing caption_pair check",
      );
    } else {
      await expect(
        plan.execute(
          { requirements: [], captionPairs: [pair] },
          new AbortController().signal,
        ),
      ).rejects.toThrow(/1–12/);
      expect(f.plan).not.toHaveBeenCalled();
    }
    const system = composeToolAgentPrompt({
      profile,
      phase: "planning",
      editingGuide: "Owned project",
      toolNames: set.tools.map((tool) => tool.name),
      skills: set.skills,
    });
    expect(system.includes("captionPairs are authoritative declarations")).toBe(
      profile === "local-editor-v14",
    );
  }
});

it("compares the fully derived list with prior frozen requirements before delegating a restored plan", async () => {
  const supplied = other(1),
    frozen = await deriveCaptionPlanRequirements(supplied, [pair]);
  const f = toolset("local-editor-v14", true, frozen),
    set = await f.create();
  const plan = set.tools.find((tool) => tool.name === "plan_edit_stages")!;
  await expect(
    plan.execute(
      { requirements: supplied, captionPairs: [pair] },
      new AbortController().signal,
    ),
  ).resolves.toMatchObject({ kind: "terminal" });
  await expect(
    plan.execute(
      { requirements: other(2), captionPairs: [pair] },
      new AbortController().signal,
    ),
  ).rejects.toThrow(/preserve every frozen/);
  expect(f.plan).toHaveBeenCalledTimes(1);
});
