import { describe, expect, it } from "vitest";
import {
  createVideoProjectDocument,
  hashVideoProjectDocument,
  parseVideoProjectDocument,
} from "./document";
import {
  compileNativeAgentResult,
  buildNativeAgentPrompts,
  validateNativeVisualWitness,
} from "./agent-runtime";
import { executeVideoProjectCommands } from "./commands";
import {
  transcriptEvidenceFromAsr,
  captionSourceCommands,
  speechBindingCommand,
  speechCutCommands,
} from "./semantic";
import { videoAgentLottieLibrary } from "@/lib/video-agent/lottie-library";
import { editorCaptionPresets } from "@/components/editor/dojo-video-engine/editor-caption-presets";

function fixture() {
  const document = createVideoProjectDocument({
    width: 640,
    height: 360,
    fps: 30,
    durationInFrames: 180,
  });
  document.items.push({
    id: "title",
    trackId: "visual",
    name: "Title",
    node: {
      id: "title",
      type: "div",
      from: 0,
      duration: 180,
      children: [
        {
          id: "words",
          type: "text",
          text: "Old title",
          style: { fontSize: 30, color: "#ffffff" },
        },
      ],
    },
  });
  return parseVideoProjectDocument(document);
}
async function request(document = fixture()) {
  return {
    contract: "video-project-commands",
    version: 1,
    baseRevision: 3,
    baseHash: await hashVideoProjectDocument(document),
    document,
    context: {
      selectedItemIds: ["title"],
      selectedNodeId: "words",
      playheadFrame: 20,
    },
  };
}
function speechFixture() {
  const document = fixture();
  document.assets.video = {
    id: "video",
    name: "Speech",
    type: "video",
    source: "local",
  };
  document.sources.video = { assetId: "video", revision: "immutable-source-1" };
  document.items.push({
    id: "clip",
    name: "Clip",
    trackId: "visual",
    node: {
      id: "clip",
      type: "video",
      assetId: "video",
      from: 0,
      duration: 180,
    },
  });
  return document;
}
const rawAsr = {
  text: "你好，世界！",
  language: "zh",
  duration_ms: 5000,
  utterances: [
    {
      text: "你好，世界！",
      start_time_ms: 1000,
      end_time_ms: 2000,
      words: [
        { text: "你好", start_time_ms: 1000, end_time_ms: 1300 },
        {
          text: "，",
          type: "punctuation",
          start_time_ms: 1300,
          end_time_ms: 1400,
        },
        { text: "世界", start_time_ms: 1400, end_time_ms: 1800 },
        {
          text: "！",
          type: "punctuation",
          start_time_ms: 1800,
          end_time_ms: 2000,
        },
      ],
    },
  ],
};

describe("native agent command proposals", () => {
  it("changes selected nested text without replacing its native group", async () => {
    const base = await request();
    const result = await compileNativeAgentResult(base, {
      summary: "Updated title",
      commands: [
        {
          type: "set",
          target: { kind: "node", itemId: "title", nodeId: "words" },
          path: ["text"],
          value: "New title",
        },
      ],
    });
    expect(result.proposal!.impact).toBe("direct");
    expect(
      executeVideoProjectCommands(base.document, result.proposal!.commands)
        .document.items[0]!.node.children![0]!.text,
    ).toBe("New title");
    expect(base.document.items[0]!.node.children![0]!.text).toBe("Old title");
    expect(result).not.toHaveProperty("scene");
  });
  it("rejects complete Scene/document output and snapshot tampering", async () => {
    const base = await request();
    await expect(
      compileNativeAgentResult(base, { scene: {}, summary: "Replaced" }),
    ).rejects.toThrow();
    await expect(
      compileNativeAgentResult(
        { ...base, baseHash: `sha256:${"0".repeat(64)}` },
        { summary: "Edit", commands: [] },
      ),
    ).rejects.toThrow(/hash/);
  });
  it("retains installed macro generation and editable native children", async () => {
    const base = await request();
    const result = await compileNativeAgentResult(base, {
      summary: "Added title graphic",
      commands: [
        {
          type: "insertGraphic",
          itemId: "graphic",
          trackId: "visual",
          name: "Graphic",
          node: {
            macro: "textOverlay",
            template: "titleCard",
            title: "HELLO",
            from: 10,
            duration: 80,
          },
        },
      ],
    });
    const edited = executeVideoProjectCommands(
      base.document,
      result.proposal!.commands,
    ).document;
    expect(edited.items.some((item) => item.id === "graphic")).toBe(true);
    expect(
      JSON.stringify(edited.items.find((item) => item.id === "graphic")!.node),
    ).toContain("HELLO");
    expect(edited.items.find((item) => item.id === "title")!.node).toEqual(
      base.document.items[0]!.node,
    );
  });
  it("does not allow fabricated model evidence or source identity", async () => {
    const base = await request();
    await expect(
      compileNativeAgentResult(base, {
        summary: "Evidence",
        commands: [
          {
            type: "addSource",
            source: { assetId: "video", revision: "guess" },
          },
        ],
      }),
    ).rejects.toThrow(/host-resolved/);
  });
  it("supports a clarification or project answer without modifying the document", async () => {
    const result = await compileNativeAgentResult(await request(), {
      summary: "Which phrase should I emphasize?",
      outcome: "needs_input",
      commands: [],
    });
    expect(result.outcome).toBe("needs_input");
    expect(result.proposal).toBeNull();
  });
  it("binds consented preview context to the selected source clock and keeps image bytes out of text prompts", async () => {
    const document = speechFixture();
    const hash = await hashVideoProjectDocument(document);
    const witness = {
      itemId: "clip",
      documentHash: hash,
      frame: 30,
      sourceId: "video",
      sourceRevision: "immutable-source-1",
      sourceTimeMs: 1000,
      imageDataUrl: "data:image/png;base64,AAAA",
    };
    const context = {
      selectedItemIds: ["clip"],
      playheadFrame: 30,
      visualWitness: witness,
    };
    expect(() =>
      validateNativeVisualWitness(document, hash, context),
    ).not.toThrow();
    expect(() =>
      validateNativeVisualWitness(document, hash, {
        ...context,
        visualWitness: { ...witness, sourceRevision: "wrong" },
      }),
    ).toThrow(/revision/);
    expect(() =>
      validateNativeVisualWitness(document, hash, {
        ...context,
        visualWitness: { ...witness, documentHash: `sha256:${"0".repeat(64)}` },
      }),
    ).toThrow(/document/);
    expect(() =>
      validateNativeVisualWitness(document, hash, {
        ...context,
        visualWitness: { ...witness, sourceTimeMs: 2000 },
      }),
    ).toThrow(/clock/);
    const prompt = buildNativeAgentPrompts({
      instruction: "Match the visible color",
      document,
      context,
      messages: [],
    });
    expect(prompt.userPrompt).not.toContain("data:image");
    expect(prompt.userPrompt).toContain("user-captured-preview-frame");
  });
  it("preserves selected context and bounded conversation in model prompts", () => {
    const prompts = buildNativeAgentPrompts({
      instruction: "Make that word green",
      document: fixture(),
      context: {
        selectedItemIds: ["title"],
        selectedNodeId: "words",
        playheadFrame: 44,
      },
      messages: Array.from({ length: 30 }, (_, index) => ({
        role: "user",
        text: `instruction ${index}`,
      })),
    });
    const user = JSON.parse(prompts.userPrompt);
    expect(user.context.selectedNodeId).toBe("words");
    expect(user.conversation).toHaveLength(12);
    expect(prompts.systemPrompt).toContain("Never return a Scene");
    expect(prompts.systemPrompt).toContain("countdown");
  });
  it("preserves the exact built-in Lottie library as editable native graphics and rejects invented static paths", async () => {
    const base = await request();
    const entry = videoAgentLottieLibrary[0]!;
    const asset = {
      id: entry.id,
      type: "lottie",
      source: "static",
      src: entry.src,
      name: entry.label,
    };
    const result = await compileNativeAgentResult(base, {
      summary: "Added a bundled sparkle",
      commands: [
        { type: "addAsset", asset },
        {
          type: "insertGraphic",
          itemId: "sticker",
          trackId: "visual",
          name: "Sparkle",
          node: {
            macro: "lottieOverlay",
            assetId: entry.id,
            from: 0,
            duration: 60,
          },
        },
      ],
    });
    const next = executeVideoProjectCommands(
      base.document,
      result.proposal!.commands,
    ).document;
    expect(next.assets[entry.id]?.src).toBe(entry.src);
    expect(
      JSON.stringify(next.items.find((item) => item.id === "sticker")),
    ).toContain(entry.id);
    await expect(
      compileNativeAgentResult(base, {
        summary: "Unknown static asset",
        commands: [{ type: "addAsset", asset: { ...asset, id: "invented" } }],
      }),
    ).rejects.toThrow();
  });
});

describe("speech semantics in native authoring", () => {
  it("preserves CJK punctuation and genuine source word IDs in all caption presets", async () => {
    let document = speechFixture();
    const evidence = await transcriptEvidenceFromAsr(document, "video", rawAsr);
    document = executeVideoProjectCommands(document, [
      { type: "addEvidence", evidence },
    ]).document;
    for (const preset of Object.keys(editorCaptionPresets)) {
      const commands = captionSourceCommands(document, {
        sourceItemId: "clip",
        evidenceId: evidence.id,
        itemId: "captions",
        trackId: "visual",
        preset,
      });
      const next = executeVideoProjectCommands(document, commands).document;
      const captions = next.items.find(
        (item) => item.id === "captions",
      )!.caption!;
      expect(captions.cues[0]!.text).toBe("你好，世界！");
      expect(captions.sourceItemId).toBe("clip");
      expect(captions.cues[0]!.words![0]!.startMs).toBe(1000);
    }
  });
  it("uses the same UI treatments for Arabic display text without mutating source evidence", async () => {
    let document = speechFixture();
    const raw = {
      text: "مرحباً بالعالم!",
      language: "ar",
      utterances: [
        {
          text: "مرحباً بالعالم!",
          start_time_ms: 0,
          end_time_ms: 2000,
          words: [
            { text: "مرحباً", start_time_ms: 0, end_time_ms: 800 },
            { text: "بالعالم!", start_time_ms: 900, end_time_ms: 2000 },
          ],
        },
      ],
    };
    const evidence = await transcriptEvidenceFromAsr(document, "video", raw);
    document = executeVideoProjectCommands(document, [
      { type: "addEvidence", evidence },
    ]).document;
    for (const [preset, treatment] of Object.entries(editorCaptionPresets)) {
      const next = executeVideoProjectCommands(
        document,
        captionSourceCommands(document, {
          sourceItemId: "clip",
          evidenceId: evidence.id,
          itemId: "arabic",
          trackId: "visual",
          preset,
        }),
      ).document;
      const item = next.items.find((item) => item.id === "arabic")!;
      expect(item.caption?.direction).toBe("rtl");
      expect(item.caption?.cues[0]?.text).toBe(raw.text);
      expect(item.caption?.motion).toBe(treatment.motion);
      expect(item.caption?.mode).toBe(treatment.mode);
      expect(item.caption?.highlightStyle).toEqual(treatment.highlightStyle);
      expect(item.node.style?.fontFamily).toBe(treatment.style.fontFamily);
      expect(item.node.style?.textStroke).toBe(treatment.style.textStroke);
      expect(next.evidence).toEqual(document.evidence);
    }
  });
  it("resolves speech anchors from contiguous words and retains source identity through a trim", async () => {
    let document = speechFixture();
    const evidence = await transcriptEvidenceFromAsr(document, "video", rawAsr);
    document = executeVideoProjectCommands(document, [
      { type: "addEvidence", evidence },
    ]).document;
    const command = speechBindingCommand(document, {
      id: "binding",
      itemId: "title",
      sourceItemId: "clip",
      evidenceId: evidence.id,
      wordIds: evidence.words.map((word) => word.id),
    });
    document = executeVideoProjectCommands(document, [command]).document;
    expect(document.items.find((item) => item.id === "title")!.node.from).toBe(
      30,
    );
    const changed = executeVideoProjectCommands(document, [
      {
        type: "set",
        target: { kind: "node", itemId: "clip", nodeId: "clip" },
        path: ["videoStartTime"],
        value: 1,
      },
    ]).document;
    expect(changed.bindings.binding!.sourceStartMs).toBe(1000);
    expect(changed.items.find((item) => item.id === "title")!.node.from).toBe(
      0,
    );
    expect(() =>
      speechBindingCommand(document, {
        id: "bad",
        itemId: "title",
        sourceItemId: "clip",
        evidenceId: evidence.id,
        wordIds: ["invented"],
      }),
    ).toThrow();
  });
  it("replays a tagged model anchorSpeech candidate without leaking its transport tag into the binding", async () => {
    let document = speechFixture();
    const evidence = await transcriptEvidenceFromAsr(document, "video", rawAsr);
    document = executeVideoProjectCommands(document, [
      { type: "addEvidence", evidence },
    ]).document;
    const result = await compileNativeAgentResult(await request(document), {
      summary: "Timed the title to speech",
      commands: [
        {
          type: "anchorSpeech",
          id: "model-anchor",
          itemId: "title",
          sourceItemId: "clip",
          evidenceId: evidence.id,
          wordIds: evidence.words.map((word) => word.id),
        },
      ],
    });
    const command = result.proposal!.commands[0]!;
    expect(command.type).toBe("bindSource");
    if (command.type !== "bindSource")
      throw new Error("Expected a native source binding");
    expect(command.binding).not.toHaveProperty("type");
    expect(
      executeVideoProjectCommands(document, result.proposal!.commands).document
        .bindings["model-anchor"]!.sourceStartMs,
    ).toBe(1000);
  });
  it("resolves word-based cuts into reviewed ripple commands and rejects invented speech frame edits", async () => {
    let document = speechFixture();
    const evidence = await transcriptEvidenceFromAsr(document, "video", rawAsr);
    document = executeVideoProjectCommands(document, [
      { type: "addEvidence", evidence },
    ]).document;
    const commands = speechCutCommands(document, {
      sourceItemId: "clip",
      evidenceId: evidence.id,
      wordIds: evidence.words.map((word) => word.id),
      mode: "remove",
    });
    expect(commands).toEqual([
      { type: "removeTimelineRange", from: 30, duration: 30 },
    ]);
    const result = executeVideoProjectCommands(document, commands);
    expect(result.impact).toBe("review");
    expect(result.document.format.durationInFrames).toBe(150);
    const base = {
      ...(await request(document)),
      instruction: "Remove the spoken words",
    };
    await expect(
      compileNativeAgentResult(base, {
        summary: "Cut speech",
        commands: [{ type: "trimItem", id: "clip", from: 10, duration: 20 }],
      }),
    ).rejects.toThrow(/source word IDs/);
  });
});
