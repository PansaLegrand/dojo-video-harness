import { createHash } from "node:crypto";
import { expect, it } from "vitest";
import {
  AGENT_KIT_VERSION as v24Version,
  builtInSkills as v24Skills,
  composeToolAgentPrompt as v24Prompt,
  createEditorHostTools as v24HostTools,
  createEditorToolset as v24Tools,
} from "@dojo-video/agent-kit-v24";
import {
  AGENT_KIT_VERSION,
  builtInSkills,
  composeToolAgentPrompt,
  createEditorHostTools,
  createEditorToolset,
  profileKitVersion,
  profileSkills,
  usesAuthoringContracts,
  usesCompletionPreflight,
  usesEfficientReaders,
  usesInstalledGraphicsGrammar,
  usesPagedReaders,
  usesPhaseScopedTools,
  usesPreviewRepair,
  usesResolvedEditSchema,
  usesReviewedEditReferences,
  usesStagedEditing,
  type AgentProfile,
  type EditorHostToolPorts,
  type EditorStagePhase,
  type EditorStagePorts,
  type EditorToolPorts,
} from "../packages/agent-kit/src/index";
import { createVideoToolset } from "../packages/agent/src/tools";
import {
  nativeAgentGraphicsSchema,
  nativeAgentResponseSchema,
} from "../packages/core/src/lib/video-project/agent-schema";
import {
  createVideoProjectDocument,
  hashVideoProjectDocument,
} from "../packages/core/src/lib/video-project/document";
import type { NativeAgentResult } from "../packages/core/src/lib/video-project/agent-runtime";

const oldProfiles = ["local-editor-v10", "commercial-editing-v11"] as const;
const profilePairs = [
  ["local-editor-v10", "local-editor-v11"],
  ["commercial-editing-v11", "commercial-editing-v12"],
] as const;
const phases = ["planning", "caption_batch", "assemble"] as const;
const names = (tools: readonly { name: string }[]) =>
  tools.map((tool) => tool.name);
const hash = (value: unknown) =>
  createHash("sha256").update(JSON.stringify(value)).digest("hex");

function ports(phase: EditorStagePhase): EditorToolPorts<string> {
  return {
    inspectProject: () => ({}),
    inspectGraphicsSchema: () => ({}),
    searchTranscript: () => ({}),
    prepareSvgGraphic: () => ({}),
    prepareThreeScene: () => ({}),
    prepareTextOverlay: () => ({}),
    prepareCaptionPair: () => ({}),
    listAssets: () => ({}),
    readCaptionCues: () => ({}),
    readCaptionTrack: () => ({}),
    reviewEdit: async () => ({ checks: [] }),
    proposeEdit: async () => "edit",
    askUser: async () => "question",
    previewEvidence: async () => {
      throw new Error("No browser work in profile compatibility tests");
    },
    stages: {
      phase,
      generalEditing: true,
      preparedCommands: false,
      planEditStages: async () => "plan",
      saveCaptionBatch: async () => "batch",
      readEditArtifact: async () => ({}),
      resolvePreparedEdit: async (value) => value,
    },
  };
}

const hostPorts: EditorHostToolPorts = {
  inspect_image: async () => ({ kind: "observation", value: {} }),
  sample_video_frames: async () => ({ kind: "observation", value: {} }),
  prepare_generated_media: async () => ({ kind: "observation", value: {} }),
  request_project_preview: async () => ({ kind: "observation", value: {} }),
  request_project_export: async () => ({ kind: "observation", value: {} }),
};

it("retains exact 0.2.4 tool metadata, inventory, skills and prompt bytes for accepted profiles in every phase", () => {
  expect(v24Version).toBe("0.2.4");
  for (const profile of oldProfiles) {
    expect(usesInstalledGraphicsGrammar(profile)).toBe(false);
    expect(profileKitVersion(profile)).toBe("0.2.4");
    for (const phase of phases) {
      const common = {
        profile,
        snapshotHash: "sha256:" + "a".repeat(64),
        previewSnapshotHash: "sha256:" + "a".repeat(64),
        ports: ports(phase),
        proposalSchema: nativeAgentResponseSchema({
          clarification: true,
          composition: true,
          anchorHold: true,
        }),
      };
      const current = createEditorToolset({
        ...common,
        skills: builtInSkills(),
        extraTools: createEditorHostTools({ profile, ports: hostPorts }),
      });
      const archived = v24Tools({
        ...common,
        skills: v24Skills(),
        extraTools: v24HostTools({ profile, ports: hostPorts }),
      });
      expect(JSON.stringify(current.tools)).toBe(
        JSON.stringify(archived.tools),
      );
      expect(JSON.stringify(current.inventory)).toBe(
        JSON.stringify(archived.inventory),
      );
      expect(JSON.stringify(current.skills)).toBe(
        JSON.stringify(archived.skills),
      );
      expect(current.inventory.kitVersion).toBe("0.2.4");
      const prompt = {
        profile,
        phase,
        editingGuide: "Frozen host editing guide",
        toolNames: names(current.tools),
        skills: current.skills,
      };
      expect(composeToolAgentPrompt(prompt)).toBe(v24Prompt(prompt));
    }
  }
});

it("new profiles inherit prior reader, staging and preview features while selecting the current kit version", () => {
  const priorFeatures = [
    usesCompletionPreflight,
    usesPagedReaders,
    usesEfficientReaders,
    usesResolvedEditSchema,
    usesStagedEditing,
    usesAuthoringContracts,
    usesReviewedEditReferences,
    usesPhaseScopedTools,
    usesPreviewRepair,
  ];
  expect(AGENT_KIT_VERSION).toBe("0.2.5");
  for (const [previous, profile] of profilePairs) {
    expect(usesInstalledGraphicsGrammar(profile)).toBe(true);
    expect(profileKitVersion(profile)).toBe(AGENT_KIT_VERSION);
    expect(profileKitVersion(previous)).toBe("0.2.4");
    expect(profileSkills[profile]).toEqual(profileSkills[previous]);
    for (const feature of priorFeatures) {
      expect(feature(previous)).toBe(true);
      expect(feature(profile)).toBe(true);
    }
    for (const phase of phases) {
      const make = (selected: AgentProfile) =>
        createEditorToolset({
          profile: selected,
          ports: ports(phase),
          skills: builtInSkills(),
          snapshotHash: "sha256:" + "a".repeat(64),
          proposalSchema: nativeAgentResponseSchema({
            clarification: true,
            composition: true,
            anchorHold: true,
          }),
          extraTools: createEditorHostTools({
            profile: selected,
            ports: hostPorts,
          }),
        });
      const current = make(profile);
      const previousTools = make(previous);
      expect(names(current.tools)).toEqual(names(previousTools.tools));
      expect(JSON.stringify(current.skills)).toBe(
        JSON.stringify(previousTools.skills),
      );
      expect(current.inventory.kitVersion).toBe("0.2.5");
      expect(names(current.inventory.tools)).toEqual(names(current.tools));
    }
  }
});

async function nativeSession(profile: AgentProfile) {
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
    instruction: "Create one editable animated graphic",
  };
  const stages: EditorStagePorts<NativeAgentResult> = {
    phase: "assemble",
    generalEditing: true,
    preparedCommands: false,
    planEditStages: async () => {
      throw new Error("No planning writes in discovery tests");
    },
    saveCaptionBatch: async () => {
      throw new Error("No caption writes in discovery tests");
    },
    readEditArtifact: async () => ({}),
    resolvePreparedEdit: async (value) => value,
  };
  const session = createVideoToolset(request, builtInSkills(), [], {
    profile,
    stages,
  });
  return {
    session,
    async inspect(args: unknown = {}) {
      const tool = session.tools.find(
        (tool) => tool.name === "inspect_graphics_schema",
      );
      expect(tool).toBeDefined();
      const result = await tool!.execute(args, new AbortController().signal);
      if (result.kind !== "observation")
        throw new Error("Graphics discovery must return an observation");
      return result.value;
    },
  };
}

it("the actual local tool wrapper preserves old observation bytes and gates installed grammar metadata to new profiles", async () => {
  for (const [previous, profile] of profilePairs) {
    const oldSession = await nativeSession(previous);
    const oldValue = await oldSession.inspect();
    expect(hash(oldValue)).toBe(
      "952b64d3875dd364a1de1a2c88414425df51eaa9de5dd4c581a2d7fe1d477153",
    );
    expect(JSON.stringify(oldValue)).toBe(
      JSON.stringify(nativeAgentGraphicsSchema()),
    );
    expect(oldSession.session.inventory.kitVersion).toBe("0.2.4");
    await expect(
      oldSession.inspect({ installedGrammar: true }),
    ).rejects.toThrow();
    const currentSession = await nativeSession(profile);
    const currentValue = await currentSession.inspect();
    expect(currentValue).toEqual(
      nativeAgentGraphicsSchema({}, { installedGrammar: true }),
    );
    expect(currentValue).toMatchObject({
      node: {
        properties: {
          style: {
            properties: {
              transformOrigin: {
                description:
                  "Expected horizontal left/center/right/px/% and optional vertical top/center/bottom/px/% origin components.",
                format: "dojo-video-engine-transform-origin",
              },
            },
          },
        },
      },
      examples: {
        animatedGroup: {
          style: { transformOrigin: "center bottom" },
        },
      },
    });
    expect(JSON.stringify(currentValue).length).toBeLessThan(32768);
    expect(currentSession.session.inventory.kitVersion).toBe("0.2.5");
    expect(hash(currentValue)).not.toBe(hash(oldValue));
    await expect(
      currentSession.inspect({ installedGrammar: true }),
    ).rejects.toThrow();
  }
});
