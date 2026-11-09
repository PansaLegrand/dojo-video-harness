import { expect, it } from "vitest";
import {
  buildNativeAgentPrompts,
  compileNativeAgentResult,
} from "../packages/core/src/lib/video-project/agent-runtime";
import {
  createVideoProjectDocument,
  hashVideoProjectDocument,
} from "../packages/core/src/lib/video-project/document";
import { planNativeAgentContext } from "../packages/core/src/lib/video-project/agent-context";
import { completionHash } from "../packages/agent-kit/src/completion";
import { prepareCaptionSourceOverview } from "../packages/core/src/lib/video-project/completion-caption-context";
function fixture() {
  const document = createVideoProjectDocument({
    width: 640,
    height: 360,
    fps: 30,
    durationInFrames: 900,
  });
  document.assets.a = {
    id: "a",
    name: "Interview",
    type: "video",
    source: "local",
    durationSeconds: 30,
  };
  document.sources.a = { assetId: "a", revision: "original-identity" };
  document.items.push({
    id: "clip",
    name: "Interview",
    trackId: "visual",
    node: { id: "clip", type: "video", assetId: "a", from: 0, duration: 900 },
  });
  document.items.push({
    id: "captions",
    name: "Existing captions",
    trackId: "visual",
    node: { id: "captions", type: "div", from: 0, duration: 900 },
    caption: {
      mode: "sentence",
      direction: "ltr",
      highlightColor: "#ffffff",
      sourceItemId: "clip",
      language: "en",
      role: "original",
      cues: [
        {
          id: "caption-outside",
          text: "OUTSIDE_CAPTION_CONTENT_912",
          startMs: 24000,
          endMs: 26000,
        },
      ],
    },
  });
  document.evidence.e = {
    id: "e",
    sourceAssetId: "a",
    sourceRevision: "original-identity",
    transcriptHash: "original-asr-hash",
    language: "en",
    text: "EARLY_TEXT_123 Exact in range. FUTURE_TEXT_789",
    words: [
      {
        id: "EARLY_WORD_ID_123",
        text: "EARLY_TEXT_123",
        startMs: 0,
        endMs: 1000,
      },
      {
        id: "in-range-id",
        text: "Exact in range.",
        startMs: 4000,
        endMs: 5000,
      },
      {
        id: "FUTURE_WORD_ID_789",
        text: "FUTURE_TEXT_789",
        startMs: 24000,
        endMs: 26000,
      },
    ],
  };
  return {
    document,
    instruction:
      "Add English and Chinese captions for source 2..10 seconds, red and white.",
    baseHash: "sha256:" + "a".repeat(64),
    context: { selectedItemIds: ["clip"], playheadFrame: 120 },
    authoring: { version: 1 as const, scope: { kind: "project" as const } },
    messages: [
      { role: "user", text: "Keep the current red and white styles." },
    ],
    responseMode: "tools" as const,
  };
}
it("preserves the legacy default prompt bytes", async () => {
  const input = fixture(),
    prompts = buildNativeAgentPrompts(input);
  expect(await completionHash(prompts)).toMatchSnapshot(
    "legacy default full-evidence prompt v1",
  );
  expect(buildNativeAgentPrompts(input, {})).toEqual(prompts);
  expect(prompts.userPrompt).toContain("FUTURE_TEXT_789");
});
it("uses references/counts/clocks without initial source text, word IDs or caption cues", async () => {
  const input = fixture(),
    original = JSON.stringify(input.document),
    beforeHash = await hashVideoProjectDocument(input.document);
  const prompts = buildNativeAgentPrompts(input, {
      evidenceMode: "reference-only",
    }),
    context = JSON.parse(prompts.userPrompt);
  for (const text of [
    "EARLY_TEXT_123",
    "EARLY_WORD_ID_123",
    "FUTURE_TEXT_789",
    "FUTURE_WORD_ID_789",
    "OUTSIDE_CAPTION_CONTENT_912",
    "caption-outside",
    "Exact in range.",
  ])
    expect(prompts.userPrompt).not.toContain(text);
  expect(context.document.evidence).toEqual({});
  expect(context.contextPlan.sourceReferences).toMatchObject({
    mode: "reference-only",
    coverage: "metadata-only",
    evidence: [
      {
        evidenceId: "e",
        sourceAssetId: "a",
        sourceRevision: "original-identity",
        wordCount: 3,
      },
    ],
    captions: [{ itemId: "captions", sourceItemId: "clip", cueCount: 1 }],
  });
  expect(context.contextPlan.sourceClocks).toContainEqual(
    expect.objectContaining({
      itemId: "clip",
      sourceAssetId: "a",
      startMs: 0,
      endMs: 30000,
    }),
  );
  expect(context.contextPlan.captionSources).toMatchObject({
    referenceOnly: true,
    sources: [],
  });
  expect(prompts.userPrompt.length).toBeLessThan(240000);
  expect(JSON.stringify(input.document)).toBe(original);
  expect(await hashVideoProjectDocument(input.document)).toBe(beforeHash);
  const {
    messages: _messages,
    responseMode: _responseMode,
    ...nativeInput
  } = input;
  const result = await compileNativeAgentResult(
    {
      ...nativeInput,
      contract: "video-project-commands",
      version: 1,
      baseRevision: 1,
      baseHash: beforeHash,
    },
    {
      outcome: "proposal",
      summary: "Retain full compiler evidence",
      commands: [
        {
          type: "set",
          target: { kind: "format" },
          path: ["backgroundColor"],
          value: "#112233",
        },
      ],
    },
  );
  expect(result.outcome).toBe("proposal");
  expect(JSON.stringify(input.document)).toBe(original);
});
it("keeps reference-only context bounded for multilingual cue and word collections", () => {
  const input = fixture();
  input.document.evidence.e.text = "未来的文字".repeat(10000);
  input.document.evidence.e.words = Array.from({ length: 5000 }, (_, i) => ({
    id: `word-${i}`,
    text: "未来的文字",
    startMs: i * 10,
    endMs: i * 10 + 8,
  }));
  const context = planNativeAgentContext(input, {
    maxChars: 20000,
    evidenceMode: "reference-only",
  });
  expect(JSON.stringify(context).length).toBeLessThanOrEqual(20000);
  expect(JSON.stringify(context)).not.toContain("未来的文字");
  expect(context.sourceReferences?.evidence[0].wordCount).toBe(5000);
});
it("keeps timing-omission counts without leaking example source words", () => {
  const input = fixture();
  input.document.evidence.e.timingOmissions = [
    {
      tokenIndex: 0,
      text: "UNREAD_OMITTED_TOKEN_456",
      startMs: 0,
      endMs: 0,
      reason: "nonpositive-duration",
    },
  ];
  const old = prepareCaptionSourceOverview(input.document, ["clip"]),
    current = prepareCaptionSourceOverview(input.document, ["clip"], {
      referenceOnly: true,
    });
  expect(JSON.stringify(old)).toContain("UNREAD_OMITTED_TOKEN_456");
  expect(JSON.stringify(current)).not.toContain("UNREAD_OMITTED_TOKEN_456");
  expect(current.sources[0].timingOmissions).toMatchObject({
    count: 1,
    examples: [],
  });
});
