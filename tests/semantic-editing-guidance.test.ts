import { expect, it } from "vitest";
import {
  builtInSkills,
  composeToolAgentPrompt,
  type EditorStagePorts,
} from "../packages/agent-kit/src/index";
import { createVideoToolset } from "../packages/agent/src/tools";
import {
  buildNativeAgentPrompts,
  type NativeAgentResult,
} from "../packages/core/src/lib/video-project/agent-runtime";
import {
  createVideoProjectDocument,
  hashVideoProjectDocument,
} from "../packages/core/src/lib/video-project/document";

async function fixture() {
  const document = createVideoProjectDocument({
    width: 640,
    height: 360,
    fps: 30,
    durationInFrames: 120,
  });
  document.assets.voice = {
    id: "voice",
    type: "audio",
    name: "Synthetic speech fixture",
    source: "local",
    durationSeconds: 4,
  };
  document.sources.voice = { assetId: "voice", revision: "synthetic-source" };
  document.items.push({
    id: "voice",
    name: "Voice",
    trackId: "audio",
    node: {
      id: "voice",
      type: "audio",
      assetId: "voice",
      from: 0,
      duration: 120,
    },
  });
  document.evidence.words = {
    id: "words",
    sourceAssetId: "voice",
    sourceRevision: "synthetic-source",
    transcriptHash: "synthetic-transcript",
    language: "en",
    text: "A clear explanation.",
    words: [
      { id: "w0", text: "A", startMs: 0, endMs: 200 },
      { id: "w1", text: "clear", startMs: 300, endMs: 600 },
      { id: "w2", text: "explanation.", startMs: 700, endMs: 1300 },
    ],
  };
  const request = {
    contract: "video-project-commands" as const,
    version: 1 as const,
    baseRevision: 0,
    baseHash: await hashVideoProjectDocument(document),
    document,
    context: { selectedItemIds: [], playheadFrame: 0 },
    instruction: "Quote the supplied source words and preserve caption meaning",
  };
  const requirements = [
    {
      id: "quote",
      kind: "speech_callout",
      itemId: "quote",
      bindingId: "quote-anchor",
      sourceItemId: "voice",
      evidenceId: "words",
      wordIds: ["w0", "w1", "w2"],
      exactText: "A clear explanation.",
      minReadableMs: 1000,
    },
  ];
  const edit = {
    outcome: "proposal",
    summary: "Synthetic quoted source words",
    commands: [
      {
        type: "insertGraphic",
        itemId: "quote",
        trackId: "visual",
        name: "Quote",
        node: {
          id: "quote",
          type: "text",
          from: 0,
          duration: 39,
          text: "A clear explanation. — context",
          style: {
            position: "absolute",
            left: 20,
            top: 20,
            width: 520,
            height: 80,
            fontSize: 32,
            color: "#ffffff",
          },
        },
      },
      {
        type: "anchorSpeech",
        id: "quote-anchor",
        itemId: "quote",
        sourceItemId: "voice",
        evidenceId: "words",
        wordIds: ["w0", "w1", "w2"],
      },
    ],
  };
  const stages: EditorStagePorts<NativeAgentResult> = {
    phase: "assemble",
    preparedCommands: false,
    planEditStages: async () => {
      throw Error("No planning writes in guidance tests");
    },
    saveCaptionBatch: async () => {
      throw Error("No translation writes in guidance tests");
    },
    readEditArtifact: async () => ({}),
    resolvePreparedEdit: async (edit) => edit,
  };
  return { request, requirements, edit, stages };
}

it.each(["local-editor-v12", "local-editor-v13"] as const)(
  "%s native session selects only its versioned speech diagnostics and guidance",
  async (profile) => {
    const f = await fixture(),
      before = JSON.stringify(f.request);
    const session = createVideoToolset(f.request, builtInSkills(), [], {
      profile,
      stages: f.stages,
    });
    const system = composeToolAgentPrompt({
      profile,
      phase: "assemble",
      editingGuide: buildNativeAgentPrompts({
        ...f.request,
        messages: [],
        responseMode: "tools",
      }).systemPrompt,
      toolNames: session.tools.map((tool) => tool.name),
      skills: session.skills,
    });
    const result = await session.tools
      .find((tool) => tool.name === "review_edit")!
      .execute(
        { requirements: f.requirements, edit: f.edit },
        new AbortController().signal,
      );
    expect(result).toMatchObject({
      kind: "observation",
      value: { completionPreflight: { status: "failed" } },
    });
    const observation = JSON.stringify(result);
    if (profile === "local-editor-v13") {
      expect(observation).toContain("display differs from frozen exactText");
      expect(observation).toContain("labels outside the checked item");
      expect(observation).not.toContain("holdMs");
      expect(system).toContain("THAT source cue");
      expect(system).toContain("recognized numeric word IDs");
      expect(system).toContain(
        "Before plan_edit_stages or the first review freezes requirements",
      );
    } else {
      expect(observation).toContain(
        "Highlight text/start/readable duration does not meet the declaration",
      );
      expect(observation).toContain("holdMs");
      expect(system).not.toContain("THAT source cue");
    }
    expect(JSON.stringify(f.request)).toBe(before);
  },
);
