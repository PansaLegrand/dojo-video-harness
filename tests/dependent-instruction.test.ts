import { expect, it } from "vitest";
import {
  evaluateScene,
  layoutScene,
  type LayoutBox,
} from "@dojo-video-engine/core";
import { runAgent } from "../packages/agent/src/loop";
import {
  buildNativeAgentPrompts,
  compileNativeAgentResult,
  type NativeAgentRequest,
} from "../packages/core/src/lib/video-project/agent-runtime";
import {
  createVideoProjectDocument,
  canonicalSerialize,
  hashVideoProjectDocument,
  parseVideoProjectDocument,
  type VideoProjectDocument,
} from "../packages/core/src/lib/video-project/document";
import {
  captionSourceCommands,
  transcriptEvidenceFromAsr,
} from "../packages/core/src/lib/video-project/semantic";
import { executeVideoProjectCommands } from "../packages/core/src/lib/video-project/commands";
import { compileVideoProjectDocument } from "../packages/core/src/lib/video-project/compilation";
import { buildVideoProjectRevertCommands } from "../packages/core/src/lib/video-project/revert";

const instruction =
  'Add English subtitles and Chinese translations. Use red English text and white Chinese text. Each time the speaker mentions a growth rate, highlight the growth number. Finally append an animated, editable outro saying "Made by DojoClip.com".';

async function fixture() {
  let document = createVideoProjectDocument({
    width: 640,
    height: 360,
    fps: 30,
    durationInFrames: 900,
  });
  document.assets.speech = {
    id: "speech",
    name: "Owned speech.mp4",
    type: "video",
    source: "local",
    durationSeconds: 34,
    width: 640,
    height: 360,
  };
  document.sources.speech = { assetId: "speech", revision: "owned-source-v1" };
  document.items.push({
    id: "speech-clip",
    name: "Speech",
    trackId: "visual",
    node: {
      id: "speech-clip",
      type: "video",
      assetId: "speech",
      from: 0,
      duration: 900,
      videoStartTime: 2,
    },
  });
  const phrase = (value: string, start: number) =>
    ["The", "growth", "rate", "is", value].map((text, index) => ({
      text,
      start_time_ms: start + index * 200,
      end_time_ms: start + index * 200 + (index === 4 ? 400 : 200),
    }));
  // Separated mentions exceed the initial 600-word evidence excerpt. This is
  // synthetic ASR: it proves source/cue mechanics, not transcription accuracy.
  const words = [
    ...phrase("20%", 3000),
    ...Array.from({ length: 700 }, (_, index) => ({
      text: "context",
      start_time_ms: 5000 + index * 20,
      end_time_ms: 5020 + index * 20,
    })),
    ...phrase("35%", 25000),
  ];
  const evidence = await transcriptEvidenceFromAsr(
    document,
    "speech",
    {
      text: words.map((word) => word.text).join(" "),
      language: "en",
      utterances: [
        {
          text: words.map((word) => word.text).join(" "),
          start_time_ms: 3000,
          end_time_ms: 26200,
          words,
        },
      ],
    },
    "owned-asr-receipt",
  );
  document.evidence[evidence.id] = evidence;
  document = parseVideoProjectDocument(document);
  const request: NativeAgentRequest = {
    contract: "video-project-commands",
    version: 1,
    baseRevision: 0,
    baseHash: await hashVideoProjectDocument(document),
    document,
    instruction,
    context: { selectedItemIds: ["speech-clip"], playheadFrame: 0 },
    authoring: { version: 1, scope: { kind: "project" } },
  };
  const sourceCaption = captionSourceCommands(document, {
    sourceItemId: "speech-clip",
    evidenceId: evidence.id,
    itemId: "english",
    trackId: "visual",
  }).find((command) => command.type === "addItem");
  if (sourceCaption?.type !== "addItem" || !sourceCaption.item.caption)
    throw new Error("Fixture needs host-timed source captions");
  const chinese = structuredClone(sourceCaption.item);
  chinese.id = chinese.node.id = "chinese";
  chinese.node.style = {
    ...chinese.node.style,
    color: "#ffffff",
    top: 310,
    height: 40,
  };
  chinese.caption = {
    ...sourceCaption.item.caption,
    role: "translation",
    language: "zh",
    pairedItemId: "english",
    cues: sourceCaption.item.caption.cues.map((cue) => ({
      id: cue.id,
      startMs: cue.startMs,
      endMs: cue.endMs,
      text: cue.text.includes("20%")
        ? "增长率是20%"
        : cue.text.includes("35%")
          ? "增长率是35%"
          : "背景说明",
    })),
  };
  return { document, evidence, request, sourceCaption, chinese };
}

type Fixture = Awaited<ReturnType<typeof fixture>>;
type Match = {
  sourceItemId: string;
  evidenceId: string;
  wordIds: string[];
};
function graphic(itemId: string, text: string, from: number, duration: number) {
  return {
    type: "insertGraphic",
    itemId,
    trackId: "visual",
    name: text,
    node: {
      type: "text",
      text,
      from,
      duration,
      style: {
        position: "absolute",
        left: 40,
        top: 80,
        width: 560,
        height: 100,
        fontSize: 40,
        color: "#ffff00",
        zIndex: 70,
      },
      animations: [{ preset: "popIn" }],
    },
  };
}
function proposal(f: Fixture, matches: Match[]) {
  return {
    outcome: "proposal",
    summary:
      "Add bilingual captions, both source-bound growth numbers and outro",
    commands: [
      {
        type: "captionSource",
        sourceItemId: "speech-clip",
        evidenceId: f.evidence.id,
        itemId: "english",
        trackId: "visual",
      },
      {
        type: "set",
        target: { kind: "node", itemId: "english", nodeId: "english" },
        path: ["style", "color"],
        value: "#ff0000",
      },
      {
        type: "set",
        target: { kind: "node", itemId: "english", nodeId: "english" },
        path: ["style", "top"],
        value: 260,
      },
      {
        type: "set",
        target: { kind: "node", itemId: "english", nodeId: "english" },
        path: ["style", "height"],
        value: 40,
      },
      { type: "addItem", item: f.chinese },
      {
        type: "set",
        target: { kind: "caption", itemId: "english" },
        path: ["pairedItemId"],
        value: "chinese",
      },
      ...matches.flatMap((match, index) => [
        graphic(`growth-${index}`, index === 0 ? "20%" : "35%", 0, 30),
        {
          type: "anchorSpeech",
          id: `growth-anchor-${index}`,
          itemId: `growth-${index}`,
          ...match,
        },
      ]),
      {
        type: "set",
        target: { kind: "format" },
        path: ["durationInFrames"],
        value: 990,
      },
      graphic("outro", "Made by DojoClip.com", 900, 90),
    ],
  };
}

function visibleText(document: VideoProjectDocument, frame: number) {
  const { scene } = compileVideoProjectDocument(document, {
    speech: "/owned-speech.mp4",
  });
  const texts: string[] = [];
  const visit = (box: LayoutBox, visible = true) => {
    visible = visible && box.node.style.opacity !== 0;
    if (visible && box.node.type === "text") texts.push(box.node.text ?? "");
    box.children.forEach((child) => visit(child, visible));
  };
  layoutScene(evaluateScene(scene, frame)).boxes.forEach((box) => visit(box));
  return texts;
}

// A scenario oracle checks independent requested outcomes. The production
// command validator validates safety, not whether arbitrary prose was fulfilled.
function assertComplete(f: Fixture, after: VideoProjectDocument) {
  const english = after.items.find((item) => item.id === "english"),
    chinese = after.items.find((item) => item.id === "chinese");
  if (!english?.caption || !chinese?.caption)
    throw new Error("Missing bilingual captions");
  expect(english.node.style?.color).toBe("#ff0000");
  expect(chinese.node.style?.color).toBe("#ffffff");
  expect(english.node.style?.top).not.toBe(chinese.node.style?.top);
  expect(
    Number(english.node.style?.top) + Number(english.node.style?.height),
  ).toBeLessThanOrEqual(Number(chinese.node.style?.top));
  expect(canonicalSerialize(english.caption.cues)).toBe(
    canonicalSerialize(f.sourceCaption.item.caption!.cues),
  );
  expect(
    chinese.caption.cues.map(({ id, startMs, endMs }) => ({
      id,
      startMs,
      endMs,
    })),
  ).toEqual(
    english.caption.cues.map(({ id, startMs, endMs }) => ({
      id,
      startMs,
      endMs,
    })),
  );
  expect(chinese.caption.cues.every((cue) => !cue.words)).toBe(true);
  for (const [index, text, from, startMs] of [
    [0, "20%", 54, 3800],
    [1, "35%", 714, 25800],
  ] as const) {
    const item = after.items.find((item) => item.id === `growth-${index}`);
    if (!item) throw new Error(`Missing growth mention ${text}`);
    expect(item.node).toMatchObject({ text, from, duration: 12 });
    expect(after.bindings[`growth-anchor-${index}`]).toMatchObject({
      itemId: item.id,
      sourceItemId: "speech-clip",
      evidenceId: f.evidence.id,
      sourceStartMs: startMs,
      sourceEndMs: startMs + 400,
    });
  }
  const outro = after.items.find((item) => item.id === "outro");
  if (!outro) throw new Error("Missing outro");
  expect(outro.node).toMatchObject({
    type: "text",
    text: "Made by DojoClip.com",
    from: 900,
    duration: 90,
  });
  expect(outro.node.animations?.length).toBeGreaterThan(0);
  expect(visibleText(after, 915)).toEqual(["Made by DojoClip.com"]);
  expect(visibleText(after, 885)).not.toContain("Made by DojoClip.com");
  expect(after.items.find((item) => item.id === "speech-clip")).toEqual(
    f.document.items[0],
  );
  expect(after.evidence).toEqual(f.document.evidence);
  expect(after.sources).toEqual(f.document.sources);
  expect(after.assets.speech).toEqual(f.document.assets.speech);
  expect(
    Object.values(after.assets).filter((asset) => asset.type !== "font"),
  ).toEqual(Object.values(f.document.assets));
}

it("retrieves separated genuine number anchors and applies the full dependent request in one reversible proposal", async () => {
  const f = await fixture(),
    before = structuredClone(f.document);
  let step = 0;
  const result = await runAgent({
    request: f.request,
    skills: [],
    signal: new AbortController().signal,
    model: {
      complete: async (messages) => {
        step++;
        if (step === 1)
          return {
            text: "",
            calls: ["20%", "35%"].map((query, index) => ({
              id: `number-${index}`,
              name: "search_transcript",
              arguments: JSON.stringify({
                snapshotHash: f.request.baseHash,
                query,
                sourceItemIds: ["speech-clip"],
              }),
            })),
          };
        const responses = messages
          .filter((message) => message.role === "tool")
          .map((message) => JSON.parse(String(message.content)));
        expect(responses).toHaveLength(2);
        expect(responses.every((response) => response.coverage.complete)).toBe(
          true,
        );
        return {
          text: "",
          calls: [
            {
              id: "full-edit",
              name: "propose_edit",
              arguments: JSON.stringify(
                proposal(
                  f,
                  responses.map((response) => {
                    const { sourceItemId, evidenceId, wordIds } =
                      response.matches[0];
                    return { sourceItemId, evidenceId, wordIds };
                  }),
                ),
              ),
            },
          ],
        };
      },
    },
  });
  expect(step).toBe(2);
  expect(f.document).toEqual(before);
  const after = executeVideoProjectCommands(
    f.document,
    result.proposal!.commands,
  ).document;
  assertComplete(f, after);
  const inverse = buildVideoProjectRevertCommands(before, after);
  expect(executeVideoProjectCommands(after, inverse).document).toEqual({
    ...before,
    assets: after.assets,
  });
  // The outro remains ordinary editable native text after model application.
  const changed = executeVideoProjectCommands(after, [
    {
      type: "set",
      target: { kind: "node", itemId: "outro", nodeId: "outro" },
      path: ["text"],
      value: "Made by the team",
    },
  ]).document;
  expect(visibleText(changed, 915)).toEqual(["Made by the team"]);
});

it("supplies every source caption cue for translation beyond the word excerpt limit", async () => {
  const f = await fixture();
  const { userPrompt } = buildNativeAgentPrompts({
    ...f.request,
    instruction,
    document: f.document,
    messages: [],
  });
  const context = JSON.parse(userPrompt).contextPlan;
  expect(context.evidenceWindows[f.evidence.id].omittedWords).toBeGreaterThan(
    0,
  );
  expect(
    context.captionSources.sources[0].cues.map(
      (cue: { text: string }) => cue.text,
    ),
  ).toEqual(f.sourceCaption.item.caption!.cues.map((cue) => cue.text));
  expect(context.captionSources.sources[0].cues.at(-1).text).toContain("35%");
});

it("rejects guessed source words instead of silently accepting numeric timing", async () => {
  const f = await fixture();
  await expect(
    compileNativeAgentResult(f.request, {
      outcome: "proposal",
      summary: "Highlight a number",
      commands: [
        graphic("guessed-growth", "35%", 0, 30),
        {
          type: "anchorSpeech",
          id: "guessed-anchor",
          itemId: "guessed-growth",
          sourceItemId: "speech-clip",
          evidenceId: f.evidence.id,
          wordIds: ["invented-35-percent"],
        },
      ],
    }),
  ).rejects.toThrow();
});

it("the scenario oracle detects an omitted translation, second growth mention, or outro", async () => {
  const f = await fixture();
  const matches = ["20%", "35%"].map((text) => ({
    sourceItemId: "speech-clip",
    evidenceId: f.evidence.id,
    wordIds: [f.evidence.words.find((word) => word.text === text)!.id],
  }));
  const result = await compileNativeAgentResult(
    f.request,
    proposal(f, matches),
  );
  const after = executeVideoProjectCommands(
    f.document,
    result.proposal!.commands,
  ).document;
  assertComplete(f, after);
  for (const [id, reason] of [
    ["chinese", "Missing bilingual captions"],
    ["growth-1", "Missing growth mention 35%"],
    ["outro", "Missing outro"],
  ]) {
    const incomplete = structuredClone(after);
    incomplete.items = incomplete.items.filter((item) => item.id !== id);
    expect(() => assertComplete(f, incomplete)).toThrow(reason);
  }
});
