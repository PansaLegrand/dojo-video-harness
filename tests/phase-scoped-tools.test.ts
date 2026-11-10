import { expect, it, vi } from "vitest";
import {
  builtInSkills,
  completionHash,
  composeToolAgentPrompt,
  createEditorToolset,
  type EditorStagePhase,
  type EditorStagePorts,
  type EditorToolPorts,
} from "../packages/agent-kit/src/index";
import {
  createEditorToolset as v22Tools,
  builtInSkills as v22Skills,
  composeToolAgentPrompt as v22Prompt,
} from "@dojo-video/agent-kit-v22";
import { runToolLoop } from "../packages/agent-loop/src/index";
import { createVideoToolset } from "../packages/agent/src/tools";
import {
  createVideoProjectDocument,
  hashVideoProjectDocument,
} from "../packages/core/src/lib/video-project/document";
import { nativeAgentResponseSchema } from "../packages/core/src/lib/video-project/agent-schema";
import { type NativeAgentResult } from "../packages/core/src/lib/video-project/agent-runtime";

const signal = () => new AbortController().signal;
async function fixture(
  phase: EditorStagePhase,
  profile: "local-editor-v8" | "local-editor-v9" = "local-editor-v9",
) {
  const document = createVideoProjectDocument({
    width: 640,
    height: 360,
    fps: 30,
    durationInFrames: 120,
  });
  document.assets.audio = {
    id: "audio",
    type: "audio",
    source: "local",
    name: "Synthetic speech for tool contract test",
    durationSeconds: 4,
  };
  document.sources.audio = { assetId: "audio", revision: "synthetic-original" };
  document.items.push({
    id: "voice",
    name: "Voice",
    trackId: "audio",
    node: {
      id: "voice",
      type: "audio",
      assetId: "audio",
      from: 0,
      duration: 120,
      audioStartTime: 0,
      volume: 1,
    },
  });
  document.evidence.words = {
    id: "words",
    sourceAssetId: "audio",
    sourceRevision: "synthetic-original",
    transcriptHash: "synthetic-contract-words",
    language: "en",
    text: "A clear explanation.",
    words: [
      { id: "w0", text: "A", startMs: 0, endMs: 300 },
      { id: "w1", text: "clear", startMs: 400, endMs: 700 },
      { id: "w2", text: "explanation.", startMs: 800, endMs: 1400 },
    ],
  };
  const request = {
    contract: "video-project-commands" as const,
    version: 1 as const,
    baseRevision: 0,
    baseHash: await hashVideoProjectDocument(document),
    document,
    context: { selectedItemIds: [], playheadFrame: 0 },
    instruction: "Caption the speech and add an editable graphic",
  };
  const requirements = [
    { id: "caption", kind: "item_present" as const, itemId: "captions" },
    { id: "graphic", kind: "item_present" as const, itemId: "bar" },
  ];
  const stages: EditorStagePorts<NativeAgentResult> = {
    phase,
    generalEditing: true,
    preparedCommands: false,
    planEditStages: vi.fn(async () => {
      throw Error("Unexpected replanning");
    }),
    saveCaptionBatch: vi.fn(
      async (): Promise<NativeAgentResult> => ({
        contract: "video-project-commands",
        version: 1,
        baseRevision: 0,
        baseHash: request.baseHash,
        outcome: "answer",
        summary: "Saved",
        proposal: null,
      }),
    ),
    readEditArtifact: vi.fn(async () => ({ summary: "Owned source facts" })),
    resolvePreparedEdit: async (edit) => edit,
    completionState: {
      version: 1,
      snapshotHash: request.baseHash,
      requirements,
      requirementsHash: await completionHash(requirements),
    },
  };
  const session = createVideoToolset(request, builtInSkills(), [], {
    profile,
    stages,
  });
  return { session, request, requirements, stages };
}
const names = (tools: Array<{ name: string }>) =>
  tools.map((tool) => tool.name);

it("new tool menus follow the host phase before skill selection and inventory", async () => {
  for (const phase of ["planning", "caption_batch", "assemble"] as const) {
    const { session } = await fixture(phase),
      available = names(session.tools);
    expect(available.includes("plan_edit_stages")).toBe(phase === "planning");
    expect(available.includes("save_caption_batch")).toBe(
      phase === "caption_batch",
    );
    for (const tool of ["review_edit", "propose_edit"])
      expect(available.includes(tool)).toBe(phase !== "caption_batch");
    expect(available).toEqual(
      expect.arrayContaining(["read_edit_artifact", "ask_user"]),
    );
    expect(names(session.inventory.tools)).toEqual(available);
    for (const skill of session.inventory.skills)
      expect(
        skill.requiredTools.every((tool) => available.includes(tool)),
      ).toBe(true);
    // Reconstructing a session for the same persisted stage advertises the same
    // inventory, rather than restoring tools from a different phase.
    expect((await fixture(phase)).session.inventory).toEqual(session.inventory);
  }
});
it("the actual replanning trace cannot execute a plan during assembly; the existing loop can finish the full edit", async () => {
  const { session, request, stages } = await fixture("assemble"),
    before = JSON.stringify(request);
  const edit = {
    outcome: "proposal",
    summary: "Captions and graphic",
    commands: [
      {
        type: "captionSource",
        sourceItemId: "voice",
        evidenceId: "words",
        itemId: "captions",
        trackId: "visual",
      },
      {
        type: "insertGraphic",
        itemId: "bar",
        trackId: "visual",
        name: "Editable chart primitive",
        node: {
          type: "shape",
          from: 0,
          duration: 120,
          shape: { kind: "rect" },
          style: {
            position: "absolute",
            left: 40,
            top: 40,
            width: 120,
            height: 80,
            fill: "#22d3ee",
          },
        },
      },
    ],
  };
  let calls = 0;
  const result = await runToolLoop({
    tools: session.tools,
    messages: [],
    signal: signal(),
    answer: async () => {
      throw Error("Editing must finish with a proposal");
    },
    model: {
      complete: async (messages) => {
        calls++;
        if (calls === 2)
          expect(JSON.stringify(messages)).toMatch(
            /unknown|not.*available|not.*registered|not found/i,
          );
        return {
          text: "",
          calls: [
            {
              id: `c${calls}`,
              name:
                calls === 1
                  ? "plan_edit_stages"
                  : calls === 2
                    ? "review_edit"
                    : "propose_edit",
              arguments: JSON.stringify(
                calls === 1
                  ? { requirements: [], captionPairs: [] }
                  : calls === 2
                    ? { edit }
                    : edit,
              ),
            },
          ],
        };
      },
    },
  });
  expect(result.result).toMatchObject({ outcome: "proposal" });
  expect(
    result.result.proposal?.commands.filter(
      (command) => command.type === "addItem",
    ),
  ).toHaveLength(2);
  expect(stages.planEditStages).not.toHaveBeenCalled();
  expect(calls).toBe(3);
  expect(JSON.stringify(request)).toBe(before);
});
it("caption-batch sessions cannot review or propose a partial project but can save the exact batch", async () => {
  const { session, stages } = await fixture("caption_batch");
  expect(
    session.tools.find((tool) => tool.name === "review_edit"),
  ).toBeUndefined();
  expect(
    session.tools.find((tool) => tool.name === "propose_edit"),
  ).toBeUndefined();
  expect(
    session.tools.find((tool) => tool.name === "plan_edit_stages"),
  ).toBeUndefined();
  const save = session.tools.find(
    (tool) => tool.name === "save_caption_batch",
  )!;
  expect(
    await save.execute(
      { translations: [{ cueId: "actual-cue", text: "Translation" }] },
      signal(),
    ),
  ).toMatchObject({ kind: "terminal" });
  expect(stages.saveCaptionBatch).toHaveBeenCalledTimes(1);
});
it("phase-specific system guidance stops assembly replanning and preserves the complete original request", async () => {
  for (const phase of ["planning", "caption_batch", "assemble"] as const) {
    const { session } = await fixture(phase);
    const prompt = composeToolAgentPrompt({
      profile: "local-editor-v9",
      phase,
      editingGuide: "UNCHANGED HOST GUIDE",
      toolNames: names(session.tools),
      skills: session.skills,
    });
    expect(prompt.startsWith("UNCHANGED HOST GUIDE")).toBe(true);
    if (phase === "assemble") {
      expect(prompt).toContain("ALREADY FROZEN");
      expect(prompt).toContain("FULL original user instruction");
      expect(prompt).toContain("OMIT requirements");
      expect(prompt).not.toContain("call plan_edit_stages");
      expect(prompt).not.toContain("plan_edit_stages accepts captionPairs");
    } else if (phase === "caption_batch") {
      expect(prompt).toContain("save_caption_batch");
      expect(prompt).not.toContain("Review before proposing");
    } else expect(prompt).toContain("plan_edit_stages");
  }
});
it("old 0.2.2 phase menus, skills, descriptions and prompts are byte-identical to their archive", () => {
  const ports: EditorToolPorts<string> = {
    inspectProject: () => ({}),
    inspectGraphicsSchema: () => ({}),
    searchTranscript: () => ({}),
    prepareSvgGraphic: () => ({}),
    prepareThreeScene: () => ({}),
    listAssets: () => ({}),
    readCaptionCues: () => ({}),
    readCaptionTrack: () => ({}),
    reviewEdit: async () => ({ checks: [] }),
    proposeEdit: async () => "edit",
    askUser: async () => "question",
    stages: {
      phase: "assemble",
      generalEditing: true,
      preparedCommands: false,
      planEditStages: async () => "plan",
      saveCaptionBatch: async () => "batch",
      readEditArtifact: async () => ({}),
      resolvePreparedEdit: async (value) => value,
    },
  };
  for (const profile of ["local-editor-v8", "commercial-editing-v9"] as const) {
    const common = {
      profile,
      snapshotHash: "sha256:" + "a".repeat(64),
      proposalSchema: nativeAgentResponseSchema({
        clarification: true,
        composition: true,
        anchorHold: true,
      }),
    };
    const current = createEditorToolset({
      ...common,
      ports,
      skills: builtInSkills(),
    });
    const old = v22Tools({ ...common, ports, skills: v22Skills() });
    expect(current.inventory).toEqual(old.inventory);
    expect(current.skills).toEqual(old.skills);
    const prompt = {
      profile,
      phase: "assemble" as const,
      editingGuide: "Same guide",
      toolNames: names(current.tools),
      skills: current.skills,
    };
    expect(composeToolAgentPrompt(prompt)).toBe(v22Prompt(prompt));
  }
});
