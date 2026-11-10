import { describe, expect, it } from "vitest";
import Ajv from "ajv";
import {
  createEditorToolset as createLegacyToolset,
  builtInSkills as legacyBuiltins,
  composeToolAgentPrompt as legacyPrompt,
} from "@dojo-video/agent-kit-v20";
import {
  authoringCompletionRequirementsSchema,
  createEditorToolset,
  type EditorToolPorts,
  pagedCompletionRequirementsSchema,
  parseCompletionRequirements,
  builtInSkills,
  composeToolAgentPrompt,
  selectSkills,
  type EditorStagePorts,
} from "../packages/agent-kit/src/index";
import { createVideoToolset } from "../packages/agent/src/tools";
import {
  createVideoProjectDocument,
  hashVideoProjectDocument,
} from "../packages/core/src/lib/video-project/document";
import {
  nativeAgentGraphicsSchema,
  nativeAgentResponseSchema,
} from "../packages/core/src/lib/video-project/agent-schema";
import {
  compileNativeAgentResult,
  type NativeAgentResult,
} from "../packages/core/src/lib/video-project/agent-runtime";

const signal = () => new AbortController().signal;
const stages: EditorStagePorts<NativeAgentResult> = {
  generalEditing: true,
  preparedCommands: false,
  planEditStages: async () => {
    throw new Error("No planning write in contract fixture");
  },
  saveCaptionBatch: async () => {
    throw new Error("No translation in contract fixture");
  },
  readEditArtifact: async () => ({}),
  resolvePreparedEdit: async (value) => value,
};
async function fixture(
  profile: "local-editor-v6" | "local-editor-v7" = "local-editor-v7",
) {
  const document = createVideoProjectDocument({
    width: 1280,
    height: 720,
    fps: 30,
    durationInFrames: 360,
  });
  const request = {
    contract: "video-project-commands" as const,
    version: 1 as const,
    baseRevision: 0,
    baseHash: await hashVideoProjectDocument(document),
    document,
    context: { selectedItemIds: [], playheadFrame: 0 },
    instruction: "Create an editable animated heading",
  };
  const { tools } = createVideoToolset(request, builtInSkills(), [], {
    profile,
    stages,
  });
  return {
    request,
    tools,
    invoke: (name: string, value: unknown) =>
      tools.find((tool) => tool.name === name)!.execute(value, signal()),
  };
}
const edit = {
  summary: "Animated heading",
  outcome: "proposal",
  commands: [
    {
      type: "insertGraphic",
      itemId: "heading",
      trackId: "visual",
      name: "Heading",
      node: {
        macro: "kineticText",
        text: "Explanation",
        from: 0,
        duration: 120,
        look: "wordPop",
        palette: "berry",
      },
    },
  ],
};
const requirements = [
  { id: "heading", kind: "item_present", itemId: "heading" },
];

describe("new authoring contracts reuse the existing validators and tools", () => {
  it("serializes authoritative kinds and exact native targets; invented semantic/type declarations fail", () => {
    const validate = new Ajv({ strict: false }).compile(
      authoringCompletionRequirementsSchema,
    );
    const legal = [
      ...requirements,
      {
        id: "format",
        kind: "property",
        target: { kind: "format" },
        path: ["width"],
        equals: 1280,
      },
      {
        id: "node",
        kind: "property_absent",
        target: { kind: "node", itemId: "heading", nodeId: "heading" },
        path: ["style", "filter"],
      },
      {
        id: "cue",
        kind: "property",
        target: { kind: "cue", itemId: "captions", cueId: "c1" },
        path: ["text"],
        equals: "A caption",
      },
      {
        id: "phrase",
        kind: "speech_callout",
        itemId: "callout",
        bindingId: "binding",
        sourceItemId: "audio",
        evidenceId: "evidence",
        wordIds: ["word1"],
        exactText: "$1 billion",
        minReadableMs: 1200,
      },
    ];
    expect(validate(legal)).toBe(true);
    expect(
      parseCompletionRequirements(legal, {
        assetSequence: true,
        speechCallout: true,
      }),
    ).toEqual(legal);
    for (const invalid of [
      [{ id: "wrong", type: "animated_chapters", minimum: 8 }],
      [{ id: "wrong", kind: "preserve_source", itemId: "audio" }],
      [
        {
          id: "wrong",
          kind: "property",
          target: { kind: "node", itemId: "heading" },
          path: ["text"],
          equals: "A",
        },
      ],
      [
        {
          id: "wrong",
          kind: "property",
          target: { kind: "format", itemId: "heading" },
          path: ["width"],
          equals: 1280,
        },
      ],
    ]) {
      expect(validate(invalid)).toBe(false);
      expect(() =>
        parseCompletionRequirements(invalid, { speechCallout: true }),
      ).toThrow();
    }
    expect(JSON.stringify(pagedCompletionRequirementsSchema)).not.toContain(
      "Exact native property target",
    );
  });
  it("uses scoped discovery on the same tool and compiles its installed examples through the real kernel", async () => {
    const { request, invoke } = await fixture();
    const native = await invoke("inspect_graphics_schema", {});
    if (native.kind !== "observation")
      throw new Error("Expected schema observation");
    const value = native.value as ReturnType<typeof nativeAgentGraphicsSchema>;
    expect(value).toMatchObject({ kind: "native", version: 1 });
    expect(value).not.toHaveProperty("three");
    expect(JSON.stringify(value).length).toBeLessThan(16000);
    if (!("examples" in value) || !value.examples || !("node" in value))
      throw new Error("Native examples required");
    expect(
      new Ajv({ strict: false }).compile(value.node as object)(
        value.examples.animatedGroup,
      ),
    ).toBe(true);
    await expect(
      compileNativeAgentResult(request, {
        summary: "Valid native example",
        outcome: "proposal",
        commands: [
          {
            type: "insertGraphic",
            itemId: "native-chart",
            trackId: "visual",
            name: "Native chart",
            node: value.examples.animatedGroup,
          },
        ],
      }),
    ).resolves.toMatchObject({ outcome: "proposal" });
    const macro = await invoke("inspect_graphics_schema", {
      kind: "macro",
      macro: "kineticText",
    });
    if (macro.kind !== "observation")
      throw new Error("Expected macro observation");
    const details = macro.value as { example: unknown; parameters: unknown };
    expect(
      new Ajv({ strict: false }).compile(details.parameters as object)(
        details.example,
      ),
    ).toBe(true);
    await expect(
      compileNativeAgentResult(request, {
        ...edit,
        commands: [{ ...edit.commands[0], node: details.example }],
      }),
    ).resolves.toMatchObject({ outcome: "proposal" });
    await expect(
      invoke("inspect_graphics_schema", { kind: "macro", macro: "fakeChart" }),
    ).rejects.toThrow(/Unknown installed graphic macro.*kineticText/);
    await expect(
      invoke("inspect_graphics_schema", {
        kind: "native",
        macro: "kineticText",
      }),
    ).rejects.toThrow();
  });
  it("a rejected proposal saves no draft; complete review followed by exact proposal succeeds without mutations", async () => {
    const { request, invoke } = await fixture(),
      before = JSON.stringify(request);
    await expect(invoke("propose_edit", edit)).rejects.toThrow(
      /saved and applied nothing/,
    );
    const empty = await invoke("review_edit", {
      requirements,
      edit: { ...edit, commands: [] },
    });
    expect(empty).toMatchObject({
      kind: "observation",
      value: {
        completionPreflight: { status: "failed" },
        nextAction: expect.stringContaining("complete command list"),
      },
    });
    const review = await invoke("review_edit", { requirements, edit });
    expect(review, JSON.stringify(review)).toMatchObject({
      kind: "observation",
      value: {
        completionPreflight: { status: "passed" },
        nextAction: expect.stringContaining("exact edit object"),
      },
    });
    await expect(invoke("propose_edit", edit)).resolves.toMatchObject({
      kind: "terminal",
      result: { outcome: "proposal" },
    });
    expect(JSON.stringify(request)).toBe(before);
  });
  it("reports native graphic field paths and correct installed syntax without weakening failed checks", async () => {
    const { invoke } = await fixture();
    const rejected = {
      ...edit,
      commands: [
        {
          ...edit.commands[0],
          node: {
            type: "kineticText",
            params: { text: "Wrong schema" },
            animations: [{ preset: "fadeIn" }],
          },
        },
      ],
    };
    const review = await invoke("review_edit", {
      requirements,
      edit: rejected,
    });
    expect(review).toMatchObject({
      kind: "observation",
      value: {
        completionPreflight: {
          status: "failed",
          checks: [
            {
              passed: false,
              message: expect.stringContaining("inspect_graphics_schema"),
            },
          ],
        },
      },
    });
    if (review.kind === "observation")
      expect(JSON.stringify(review.value)).toMatch(/params|animations/);
    const legacy = await fixture("local-editor-v6");
    const old = await legacy.invoke("inspect_graphics_schema", {});
    expect(old).toMatchObject({
      kind: "observation",
      value: { three: expect.any(Object), extension: expect.any(Object) },
    });
    if (old.kind === "observation")
      expect(old.value).not.toHaveProperty("kind");
    await expect(
      legacy.invoke("inspect_graphics_schema", { kind: "native" }),
    ).rejects.toThrow(/Unknown tool field/);
    const oldReview = await legacy.invoke("review_edit", {
      requirements,
      edit: rejected,
    });
    if (oldReview.kind === "observation")
      expect(JSON.stringify(oldReview.value)).not.toContain("nextAction");
  });
  it("preserves old skills/prompts while new guidance explains exact review and in-duration endings", () => {
    const toolNames = [
      "review_edit",
      "propose_edit",
      "inspect_graphics_schema",
      "plan_edit_stages",
      "save_caption_batch",
      "read_edit_artifact",
      "prepare_svg_graphic",
      "prepare_three_scene",
      "inspect_project",
    ];
    const current = selectSkills(builtInSkills(), toolNames, "local-editor-v7");
    const old = selectSkills(builtInSkills(), toolNames, "local-editor-v6");
    expect(
      current.find((skill) => skill.name === "motion-design")!.instructions,
    ).toContain('kind:"keyframes"');
    expect(
      old.find((skill) => skill.name === "motion-design")!.instructions,
    ).not.toContain('kind:"keyframes"');
    const guide = composeToolAgentPrompt({
      profile: "local-editor-v7",
      editingGuide: "Host guide",
      toolNames,
      skills: current,
    });
    expect(guide).toContain("kind rather than type");
    expect(guide).toContain("inside existing narration");
    expect(guide).toContain("EXACT edit object");
    const legacy = composeToolAgentPrompt({
      profile: "local-editor-v6",
      editingGuide: "Host guide",
      toolNames,
      skills: old,
    });
    expect(legacy).not.toContain("AUTHORING_EXECUTION_GUIDE");
    expect(legacy).not.toContain("Monolingual captions use captionSource");
  });
  it("keeps accepted 0.2 profile inventories, skills and prompt bytes equal to the immutable kit archive", () => {
    const ports: EditorToolPorts<string> = {
      inspectProject: () => ({}),
      inspectGraphicsSchema: () => ({}),
      searchTranscript: () => ({}),
      prepareSvgGraphic: () => ({}),
      prepareThreeScene: () => ({}),
      readCaptionTrack: () => ({}),
      readCaptionCues: () => ({}),
      listAssets: () => ({}),
      prepareCaptionPair: () => ({}),
      reviewEdit: async () => ({ checks: [] }),
      proposeEdit: async () => "edit",
      askUser: async () => "question",
      stages: {
        generalEditing: true,
        preparedCommands: false,
        resolvePreparedEdit: async (value) => value,
        planEditStages: async () => "plan",
        saveCaptionBatch: async () => "batch",
        readEditArtifact: async () => ({}),
      },
    };
    for (const profile of [
      "local-editor-v6",
      "commercial-editing-v7",
    ] as const) {
      const common = {
        profile,
        ports,
        snapshotHash: "sha256:" + "a".repeat(64),
        proposalSchema: nativeAgentResponseSchema({
          clarification: true,
          composition: true,
          anchorHold: true,
        }),
      };
      const current = createEditorToolset({
        ...common,
        skills: builtInSkills(),
      });
      const previous = createLegacyToolset({
        ...common,
        skills: legacyBuiltins(),
      });
      expect(current.inventory).toEqual(previous.inventory);
      expect(current.skills).toEqual(previous.skills);
      const input = {
        profile,
        editingGuide: "Frozen host guide",
        toolNames: current.tools.map((tool) => tool.name),
        skills: current.skills,
      };
      expect(composeToolAgentPrompt(input)).toBe(legacyPrompt(input));
    }
  });
});
