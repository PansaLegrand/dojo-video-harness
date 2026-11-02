/** Controlled transcript semantics only. --live permits at most 12 paid GPT calls. */
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { createHash, randomUUID } from "node:crypto";
import { execFileSync } from "node:child_process";
import path from "node:path";
import assert from "node:assert/strict";
import { runAgent } from "../packages/agent/src/loop";
import { GptResponsesModel } from "../packages/adapters/src/gpt-responses";
import { loadLocalSkills } from "../apps/server/src/skill-loader";
import {
  canonicalSerialize,
  createVideoProjectDocument,
  parseVideoProjectDocument,
  hashVideoProjectDocument,
} from "../packages/core/src/lib/video-project/document";
import { transcriptEvidenceFromAsr } from "../packages/core/src/lib/video-project/semantic";
import { executeVideoProjectCommands } from "../packages/core/src/lib/video-project/commands";
import type { ModelReply } from "../packages/agent/src/types";
const args = process.argv.slice(2);
if (args.some((x) => x !== "--live"))
  throw new Error("Use only --live to permit at most 12 paid GPT calls.");
const live = args.includes("--live"),
  apiKey = process.env.LLM_API_KEY ?? "";
if (live && !apiKey)
  throw new Error("Set LLM_API_KEY privately before --live.");
const modelId = process.env.LLM_MODEL ?? "gpt-6-sol",
  baseUrl = process.env.LLM_BASE_URL ?? "https://api.openai.com/v1";
const provider = live
  ? new GptResponsesModel({ baseUrl, model: modelId, apiKey })
  : null;
const skills = await loadLocalSkills("skills");
const files = [
  "scripts/evaluate-speech-semantics.ts",
  "packages/agent/src/loop.ts",
  "packages/agent/src/tools.ts",
  "packages/adapters/src/gpt-responses.ts",
  "packages/core/src/lib/video-project/agent-runtime.ts",
  "packages/core/src/lib/video-project/agent-transcript-search.ts",
  "packages/core/src/lib/video-project/semantic.ts",
  "packages/core/src/lib/video-project/source-clock.ts",
  "packages/core/src/lib/video-project/commands.ts",
  "package-lock.json",
  ...skills.map((s) => `skills/${s.name}.md`),
];
const hashes = async () =>
  Object.fromEntries(
    await Promise.all(
      files.map(async (file) => [
        file,
        createHash("sha256")
          .update(await readFile(file))
          .digest("hex"),
      ]),
    ),
  );
const implementationBefore = await hashes();
const prompts = [
  "Remove the spoken filler from the speech clip and close its gap. Preserve all meaningful words and the rest of the footage.",
  "Clean up the hesitation between Today and we, closing the timeline gap without cutting any meaningful content or extra silence.",
  "Make the speech flow without its non-lexical hesitation. Remove only that filler word, keep Today we launch the product, and ripple close the cut.",
];
const document = createVideoProjectDocument({
  width: 320,
  height: 180,
  fps: 30,
  durationInFrames: 180,
});
document.assets.speech = {
  id: "speech",
  type: "video",
  source: "local",
  name: "English announcement",
  durationSeconds: 10,
};
document.sources.speech = {
  assetId: "speech",
  revision: "controlled-source-revision-1",
};
document.items = [
  {
    id: "speech-clip",
    name: "Speech clip",
    trackId: "visual",
    node: {
      id: "speech-clip",
      type: "video",
      assetId: "speech",
      from: 0,
      duration: 180,
      videoStartTime: 2,
      volume: 0.75,
    },
  },
];
const evidence = await transcriptEvidenceFromAsr(
  document,
  "speech",
  {
    text: "Today um we launch the product",
    language: "en",
    utterances: [
      {
        text: "Today um we launch the product",
        start_time_ms: 2100,
        end_time_ms: 5300,
        words: [
          { text: "Today", start_time_ms: 2100, end_time_ms: 2600 },
          { text: "um", start_time_ms: 3000, end_time_ms: 3200 },
          { text: "we", start_time_ms: 3500, end_time_ms: 3800 },
          { text: "launch", start_time_ms: 4000, end_time_ms: 4400 },
          { text: "the", start_time_ms: 4500, end_time_ms: 4700 },
          { text: "product", start_time_ms: 4800, end_time_ms: 5300 },
        ],
      },
    ],
  },
  "controlled-asr-receipt",
);
document.evidence[evidence.id] = evidence;
const before = structuredClone(document),
  baseHash = await hashVideoProjectDocument(document),
  filler = evidence.words.find((word) => word.text === "um")!;
const output = path.resolve(
  `test-results/speech-semantics/${new Date().toISOString().replace(/[:.]/g, "-")}.json`,
);
await mkdir(path.dirname(output), { recursive: true });
await writeFile(output, "", { flag: "wx", mode: 0o600 });
const commit = execFileSync("git", ["rev-parse", "HEAD"], {
    encoding: "utf8",
  }).trim(),
  dirty = !!execFileSync("git", ["status", "--porcelain"], {
    encoding: "utf8",
  }).trim();
const trials: Array<Record<string, unknown>> = [];
let totalRequests = 0,
  unchanged = true;
for (const prompt of prompts) {
  let calls = 0,
    genuineChoice = false,
    inputTokens = 0,
    outputTokens = 0,
    missingUsage = 0;
  const toolNames: string[] = [];
  try {
    const result = await runAgent({
      request: {
        contract: "video-project-commands",
        version: 1,
        baseRevision: 0,
        baseHash,
        document,
        context: { selectedItemIds: ["speech-clip"], playheadFrame: 0 },
        instruction: prompt,
        authoring: { version: 1, scope: { kind: "project" } },
      },
      skills,
      signal: AbortSignal.timeout(180000),
      maxSteps: 4,
      maxToolCalls: 12,
      model: {
        complete: async (messages, tools, signal) => {
          if (calls >= 4 || totalRequests >= 12)
            throw new Error("Speech evaluation request budget exhausted.");
          calls++;
          totalRequests++;
          let reply: ModelReply;
          if (provider)
            reply = await provider.complete(messages, tools, signal);
          else if (calls === 1)
            reply = {
              text: "",
              calls: [
                {
                  id: randomUUID(),
                  name: "search_transcript",
                  arguments: JSON.stringify({
                    snapshotHash: baseHash,
                    query: "um",
                    sourceItemIds: ["speech-clip"],
                  }),
                },
              ],
            };
          else {
            const match = JSON.parse(String(messages.at(-1)!.content))
              .matches[0];
            reply = {
              text: "",
              calls: [
                {
                  id: randomUUID(),
                  name: "propose_edit",
                  arguments: JSON.stringify({
                    outcome: "proposal",
                    summary: "Remove the hesitation",
                    commands: [
                      {
                        type: "cutSpeech",
                        sourceItemId: match.sourceItemId,
                        evidenceId: match.evidenceId,
                        wordIds: match.wordIds,
                        mode: "remove",
                      },
                    ],
                  }),
                },
              ],
            };
          }
          if (provider && !reply.usage) missingUsage++;
          inputTokens += reply.usage?.inputTokens ?? 0;
          outputTokens += reply.usage?.outputTokens ?? 0;
          for (const call of reply.calls) {
            toolNames.push(call.name);
            if (call.name === "propose_edit") {
              try {
                const proposal = JSON.parse(call.arguments);
                genuineChoice ||= proposal.commands?.some(
                  (command: {
                    type?: string;
                    sourceItemId?: string;
                    evidenceId?: string;
                    wordIds?: string[];
                    mode?: string;
                  }) =>
                    command.type === "cutSpeech" &&
                    command.sourceItemId === "speech-clip" &&
                    command.evidenceId === evidence.id &&
                    command.mode === "remove" &&
                    canonicalSerialize(command.wordIds) ===
                      canonicalSerialize([filler.id]),
                );
              } catch {}
            }
          }
          return reply;
        },
      },
    });
    assert.equal(result.outcome, "proposal");
    assert(result.proposal);
    assert(
      genuineChoice,
      "The model must select only the genuine filler word identity.",
    );
    assert.deepEqual(
      document,
      before,
      "Model/tool processing mutated the original project",
    );
    const after = executeVideoProjectCommands(
      document,
      result.proposal.commands,
    ).document;
    assert.equal(after.format.durationInFrames, 174);
    // Independent source-clock oracle: remove source 3.0–3.2s from a clip starting
    // at source 2s. At30fps this removes timeline frames30–35, preserving both sides.
    assert.deepEqual(
      after.items.map((item) => ({
        from: item.node.from,
        duration: item.node.duration,
        source: item.node.videoStartTime,
        asset: item.node.assetId,
        volume: item.node.volume,
      })),
      [
        { from: 0, duration: 30, source: 2, asset: "speech", volume: 0.75 },
        { from: 30, duration: 144, source: 3.2, asset: "speech", volume: 0.75 },
      ],
    );
    const expected = structuredClone(before);
    expected.format.durationInFrames = 174;
    expected.items[0].node.duration = 30;
    const tail = structuredClone(before.items[0]);
    tail.id = after.items[1].id;
    tail.name = after.items[1].name;
    tail.node.id = tail.id;
    Object.assign(tail.node, { from: 30, duration: 144, videoStartTime: 3.2 });
    expected.items.push(tail);
    assert.equal(
      canonicalSerialize(after),
      canonicalSerialize(parseVideoProjectDocument(expected)),
      "The complete resulting document must match the independently authored cut, with only generated tail identity normalized.",
    );
    assert.deepEqual(after.evidence, before.evidence);
    assert.deepEqual(after.assets, before.assets);
    assert.deepEqual(after.sources, before.sources);
    trials.push({
      prompt,
      passed: true,
      modelCalls: calls,
      toolNames,
      genuineWordChoice: true,
      expectedSourceCutMs: [3000, 3200],
      outputFrames: 174,
      sourceOffsetsSeconds: [2, 3.2],
      resultHash: await hashVideoProjectDocument(after),
      inputTokens: missingUsage ? null : inputTokens,
      outputTokens: missingUsage ? null : outputTokens,
      usageUnavailableCalls: missingUsage,
    });
  } catch (error) {
    const text =
      error instanceof Error ? error.message : "Speech evaluation failed";
    trials.push({
      prompt,
      passed: false,
      modelCalls: calls,
      toolNames,
      error: (apiKey ? text.replaceAll(apiKey, "[redacted]") : text).slice(
        0,
        700,
      ),
    });
  }
  const implementationAfter = await hashes();
  unchanged =
    canonicalSerialize(implementationBefore) ===
    canonicalSerialize(implementationAfter);
  await writeFile(
    output,
    JSON.stringify(
      {
        mode: live ? "live-controlled-transcript" : "reference-fixture",
        scope:
          "Meaning-based filler selection over one controlled transcript and exact source-bound edit execution. No live ASR, audio-quality, audiovisual understanding or broad speech-quality claim.",
        commit,
        dirty,
        model: live ? modelId : null,
        providerOrigin: live ? new URL(baseUrl).origin : null,
        fixtureHash: baseHash,
        implementationBefore,
        implementationAfter,
        sourceUnchanged: unchanged,
        requests: totalRequests,
        maxRequests: 12,
        trials,
        passed:
          trials.length === prompts.length &&
          trials.every((t) => t.passed) &&
          unchanged,
      },
      null,
      2,
    ),
  );
}
console.log(
  JSON.stringify({
    output,
    mode: live ? "live-controlled-transcript" : "reference-fixture",
    passed: trials.filter((t) => t.passed).length,
    total: trials.length,
    requests: totalRequests,
    maxRequests: 12,
    sourceUnchanged: unchanged,
  }),
);
if (!unchanged || trials.some((t) => !t.passed)) process.exitCode = 1;
