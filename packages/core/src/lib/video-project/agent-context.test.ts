import { describe, expect, it } from "vitest";
import { buildNativeAgentPrompts } from "./agent-runtime";
import {
  NATIVE_AGENT_CONTEXT_MAX_CHARS,
  planNativeAgentContext,
} from "./agent-context";
import {
  createVideoProjectDocument,
  parseVideoProjectDocument,
  type VideoProjectDocument,
} from "./document";

function titles(count = 150) {
  const document = createVideoProjectDocument({
    width: 640,
    height: 360,
    fps: 30,
    durationInFrames: 90_000,
  });
  for (let index = 0; index < count; index++)
    document.items.push({
      id: `item-${index}`,
      name: `Item ${index}`,
      trackId: "visual",
      node: {
        id: `item-${index}`,
        type: "text",
        text: `Title ${index}`,
        from: index * 30,
        duration: 30,
        style: { color: "#ffffff" },
      },
    });
  return document;
}

function speech(document = titles(1), count = 1) {
  for (let source = 0; source < count; source++) {
    const id = `speech-${source}`;
    document.assets[id] = {
      id,
      name: `Interview ${source}`,
      type: "video",
      source: "local",
    };
    document.sources[id] = { assetId: id, revision: "source-v1" };
    document.items.push({
      id: `clip-${source}`,
      name: `Speaker ${source}`,
      trackId: "visual",
      node: {
        id: `clip-${source}`,
        type: "video",
        assetId: id,
        from: 0,
        duration: 90_000,
      },
    });
    const words = Array.from({ length: 5000 }, (_, index) => ({
      id: `word-${source}-${index}`,
      text: `word${index}`,
      startMs: index * 400,
      endMs: index * 400 + 350,
    }));
    document.evidence[`evidence-${source}`] = {
      id: `evidence-${source}`,
      sourceAssetId: id,
      sourceRevision: "source-v1",
      transcriptHash: "immutable-transcript",
      text: words.map((word) => word.text).join(" "),
      words,
    };
  }
  return document;
}

function plan(
  document: VideoProjectDocument,
  instruction: string,
  selectedItemIds: string[] = [],
  playheadFrame = 0,
  selectedNodeId?: string,
) {
  return planNativeAgentContext({
    document: parseVideoProjectDocument(document),
    instruction,
    context: { selectedItemIds, playheadFrame, selectedNodeId },
  });
}

describe("native agent context planning", () => {
  it("finds a requested late item instead of truncating to the first hundred", () => {
    const document = titles();
    const before = JSON.stringify(document);
    const result = plan(document, "Make item-149 blue", ["item-2"]);
    expect(result.document.items[0]?.id).toBe("item-149");
    expect(result.document.items.some((item) => item.id === "item-2")).toBe(
      true,
    );
    expect(result.itemIndex).toHaveLength(150);
    expect(
      result.itemIndex.find((item) => item.id === "item-100")?.detailIncluded,
    ).toBe(false);
    expect(result.omitted.items).toBe(150 - result.document.items.length);
    expect(JSON.stringify(document)).toBe(before);
  });

  it("resolves named or selected descendants to their original full group", () => {
    const document = titles();
    const item = document.items[149]!;
    item.node = {
      ...item.node,
      type: "div",
      text: undefined,
      children: [
        { id: "unique-subtitle", type: "text", text: "Exact original text" },
      ],
    };
    for (const result of [
      plan(document, "Make unique-subtitle blue"),
      plan(document, "Make this blue", [], 0, "unique-subtitle"),
    ]) {
      expect(result.document.items[0]?.id).toBe(item.id);
      expect(result.document.items[0]?.node.children?.[0]).toEqual(
        parseVideoProjectDocument(document).items[149]!.node.children![0],
      );
    }
  });

  it("uses the playhead and neighboring timeline items when nothing is selected", () => {
    const result = plan(titles(), "Make a transition here", [], 120 * 30 + 10);
    expect(result.document.items[0]?.id).toBe("item-120");
    expect(result.document.items.slice(0, 3).map((item) => item.id)).toContain(
      "item-119",
    );
    expect(result.document.items.slice(0, 3).map((item) => item.id)).toContain(
      "item-121",
    );
  });

  it("includes genuine source words at minute 25 rather than only the transcript prefix", () => {
    const document = speech();
    const result = plan(
      document,
      "Cut the phrase at the playhead",
      ["clip-0"],
      45_000,
    );
    const excerpt = result.document.evidence["evidence-0"]!;
    expect(excerpt.words.find((word) => word.id === "word-0-3750")).toEqual(
      document.evidence["evidence-0"]!.words[3750],
    );
    expect(excerpt.words.length).toBeLessThan(600);
    expect(excerpt.words[0]?.id).not.toBe("word-0-0");
    expect(result.sourceClocks[0]?.sourceTimeMs).toBe(1_500_000);
    expect(result.evidenceWindows["evidence-0"]?.totalWords).toBe(5000);
    expect(document.evidence["evidence-0"]!.words).toHaveLength(5000);
  });

  it("maps trim offsets, playback speed, and item placement to the source clock", () => {
    const document = speech();
    const item = document.items.find((item) => item.id === "clip-0")!;
    item.node = {
      ...item.node,
      from: 90,
      duration: 89_910,
      videoStartTime: 100,
      playbackRate: 2,
    };
    const result = plan(document, "Find the spoken words here", [item.id], 390);
    expect(result.sourceClocks[0]?.sourceTimeMs).toBe(120_000);
    expect(
      result.document.evidence["evidence-0"]!.words.some(
        (word) => word.id === "word-0-300",
      ),
    ).toBe(true);
  });

  it("retrieves a quoted phrase outside the playhead window and labels the gap", () => {
    const document = speech();
    const words = document.evidence["evidence-0"]!.words;
    words[4200]!.text = "purple";
    words[4201]!.text = "elephant";
    const result = plan(document, 'Remove "purple elephant"', ["clip-0"], 0);
    const excerpt = result.document.evidence["evidence-0"]!;
    expect(excerpt.words.find((word) => word.id === "word-0-4200")).toEqual(
      words[4200],
    );
    expect(excerpt.words.find((word) => word.id === "word-0-4201")).toEqual(
      words[4201],
    );
    const windows = result.evidenceWindows["evidence-0"]!.windows;
    expect(windows).toHaveLength(2);
    expect(windows[0]!.endIndex).toBeLessThan(windows[1]!.startIndex - 1);
    expect(excerpt.transcriptHash).toBe("immutable-transcript");
  });

  it("retrieves quoted CJK phrases split across source words", () => {
    const document = speech();
    document.evidence["evidence-0"]!.words[4200]!.text = "你好";
    document.evidence["evidence-0"]!.words[4201]!.text = "世界";
    const result = plan(document, "强调「你好世界」", ["clip-0"]);
    expect(
      result.document.evidence["evidence-0"]!.words.some(
        (word) => word.id === "word-0-4201",
      ),
    ).toBe(true);
  });

  it("keeps large multi-transcript projects within a deterministic total budget", () => {
    const document = speech(titles(), 3);
    const input = {
      document: parseVideoProjectDocument(document),
      instruction: "Remove the spoken phrase here",
      context: { selectedItemIds: ["clip-2"], playheadFrame: 45_000 },
    };
    const first = planNativeAgentContext(input),
      second = planNativeAgentContext(input);
    expect(first).toEqual(second);
    expect(JSON.stringify(first).length).toBeLessThanOrEqual(
      NATIVE_AGENT_CONTEXT_MAX_CHARS,
    );
    expect(
      first.document.evidence["evidence-2"]!.words.some(
        (word) => word.id === "word-2-3750",
      ),
    ).toBe(true);
    const prompts = buildNativeAgentPrompts({ ...input, messages: [] });
    expect(prompts.userPrompt.length).toBeLessThan(240_000);
    expect(
      JSON.parse(prompts.userPrompt).contextPlan.evidenceWindows["evidence-2"]
        .omittedWords,
    ).toBeGreaterThan(0);
  });

  it("budgets the serialized conversation together with the model context", () => {
    const document = parseVideoProjectDocument(speech(titles(), 3));
    const messages = Array.from({ length: 12 }, (_, index) => ({
      role: "user",
      text: `message-${index}:` + "\u0001".repeat(2000),
    }));
    const prompts = buildNativeAgentPrompts({
      document,
      instruction: "Find the spoken phrase",
      context: { selectedItemIds: ["clip-2"], playheadFrame: 45_000 },
      messages,
    });
    const user = JSON.parse(prompts.userPrompt);
    expect(prompts.userPrompt.length).toBeLessThanOrEqual(240_000);
    expect(JSON.stringify(user.conversation).length).toBeLessThanOrEqual(
      24_002,
    );
    expect(user.conversation.at(-1).text).toContain("message-11:");
    expect(
      user.document.evidence["evidence-2"].words.some(
        (word: { id: string }) => word.id === "word-2-3750",
      ),
    ).toBe(true);
  });

  it("reserves summary space and selected subtree detail when a group cannot fit", () => {
    const document = titles(1);
    const children = Array.from({ length: 2000 }, (_, index) => ({
      id: `nested-${index}`,
      type: "text" as const,
      text: "A long original title that must not be silently rewritten",
    }));
    document.items[0]!.node = {
      id: "item-0",
      type: "div",
      from: 0,
      duration: 30,
      children,
    };
    const result = planNativeAgentContext(
      {
        document: parseVideoProjectDocument(document),
        instruction: "Change the selected text color",
        context: {
          selectedItemIds: ["item-0"],
          selectedNodeId: "nested-1999",
          playheadFrame: 0,
        },
      },
      { maxChars: 20_000 },
    );
    expect(JSON.stringify(result).length).toBeLessThanOrEqual(20_000);
    expect(result.document.items).toHaveLength(0);
    expect(result.focusedNodes[0]).toEqual({
      itemId: "item-0",
      ancestors: ["item-0"],
      node: parseVideoProjectDocument(document).items[0]!.node.children![1999],
    });
    expect(result.focusedNodes).toHaveLength(1);
    expect(result.itemIndex[0]?.detailIncluded).toBe(false);
    expect(result.itemIndex[0]?.nodeCount).toBe(2001);
  });

  it("includes a selected caption's source while omitting unrelated transcripts for text styling", () => {
    const document = speech(titles(1), 3);
    const unrelated = plan(document, "Make item-0 blue", ["item-0"]);
    expect(Object.keys(unrelated.document.evidence)).toEqual([]);
    document.items.push({
      id: "captions",
      name: "Captions",
      trackId: "visual",
      node: { id: "captions", type: "div", from: 0, duration: 90_000 },
      caption: {
        sourceItemId: "clip-2",
        mode: "sentence",
        highlightColor: "#ffffff",
        direction: "ltr",
        cues: [{ id: "cue", text: "Hello", startMs: 0, endMs: 1000 }],
      },
    });
    const result = plan(
      document,
      "Update the selected captions",
      ["captions"],
      45_000,
    );
    expect(result.document.items.some((item) => item.id === "clip-2")).toBe(
      true,
    );
    expect(
      result.document.evidence["evidence-2"]!.words.some(
        (word) => word.id === "word-2-3750",
      ),
    ).toBe(true);
  });
});
