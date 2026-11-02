import { expect, it } from "vitest";
import { runAgent } from "../packages/agent/src/loop";
import { createVideoTools } from "../packages/agent/src/tools";
import {
  createVideoProjectDocument,
  hashVideoProjectDocument,
} from "../packages/core/src/lib/video-project/document";
import { transcriptEvidenceFromAsr } from "../packages/core/src/lib/video-project/semantic";
import { executeVideoProjectCommands } from "../packages/core/src/lib/video-project/commands";
import { compileNativeAgentResult } from "../packages/core/src/lib/video-project/agent-runtime";
async function fixture() {
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
    name: "Speech",
    durationSeconds: 10,
  };
  document.sources.speech = { assetId: "speech", revision: "owned-source-1" };
  document.items = [
    {
      id: "speech-clip",
      name: "Speech",
      trackId: "visual",
      node: {
        id: "speech-clip",
        type: "video",
        assetId: "speech",
        from: 0,
        duration: 180,
        videoStartTime: 2,
      },
    },
  ];
  const evidence = await transcriptEvidenceFromAsr(
    document,
    "speech",
    {
      text: "Start um finish",
      language: "en",
      utterances: [
        {
          text: "Start um finish",
          start_time_ms: 2100,
          end_time_ms: 3900,
          words: [
            { text: "Start", start_time_ms: 2100, end_time_ms: 2600 },
            { text: "um", start_time_ms: 3000, end_time_ms: 3200 },
            { text: "finish", start_time_ms: 3500, end_time_ms: 3900 },
          ],
        },
      ],
    },
    "owned-asr-receipt",
  );
  document.evidence[evidence.id] = evidence;
  return {
    document,
    evidence,
    request: {
      contract: "video-project-commands" as const,
      version: 1 as const,
      baseRevision: 0,
      baseHash: await hashVideoProjectDocument(document),
      document,
      context: { selectedItemIds: ["speech-clip"], playheadFrame: 0 },
      instruction:
        'Remove the spoken filler "um" from the speech clip, closing the gap.',
      authoring: { version: 1 as const, scope: { kind: "project" as const } },
    },
  };
}
it("speech tool retrieves genuine word IDs and cuts the independently specified source interval", async () => {
  const f = await fixture(),
    before = structuredClone(f.document);
  let calls = 0;
  const result = await runAgent({
    request: f.request,
    skills: [],
    signal: new AbortController().signal,
    model: {
      complete: async (messages) => {
        calls++;
        if (calls === 1)
          return {
            text: "",
            calls: [
              {
                id: "search",
                name: "search_transcript",
                arguments: JSON.stringify({
                  snapshotHash: f.request.baseHash,
                  query: "um",
                  sourceItemIds: ["speech-clip"],
                }),
              },
            ],
          };
        const result = JSON.parse(String(messages.at(-1)!.content)),
          match = result.matches[0];
        return {
          text: "",
          calls: [
            {
              id: `edit-${calls}`,
              name: "propose_edit",
              arguments: JSON.stringify({
                outcome: "proposal",
                summary: "Remove the source-bound filler",
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
      },
    },
  });
  expect(calls).toBe(2);
  expect(f.document).toEqual(before);
  const after = executeVideoProjectCommands(
    f.document,
    result.proposal!.commands,
  ).document;
  expect(after.format.durationInFrames).toBe(174);
  expect(
    after.items.map((item) => ({
      from: item.node.from,
      duration: item.node.duration,
      source: item.node.videoStartTime,
    })),
  ).toEqual([
    { from: 0, duration: 30, source: 2 },
    { from: 30, duration: 144, source: 3.2 },
  ]);
  expect(after.evidence).toEqual(f.document.evidence);
});
it("invented speech word IDs cannot authorize a cut", async () => {
  const f = await fixture();
  await expect(
    compileNativeAgentResult(f.request, {
      outcome: "proposal",
      summary: "Guessed cut",
      commands: [
        {
          type: "cutSpeech",
          sourceItemId: "speech-clip",
          evidenceId: f.evidence.id,
          wordIds: ["invented-word"],
          mode: "remove",
        },
      ],
    }),
  ).rejects.toThrow();
});
it("project inspection exposes bounded unused imported assets without private asset metadata", async () => {
  const f = await fixture();
  f.document.assets.logo = {
    id: "logo",
    type: "image",
    source: "local",
    name: "Imported logo",
    width: 32,
    height: 24,
    mimeType: "image/must-not-leak",
  };
  const tool = createVideoTools(f.request, []).find(
    (x) => x.name === "inspect_project",
  )!;
  const response = await tool.execute({}, new AbortController().signal);
  expect(response.kind).toBe("observation");
  if (response.kind !== "observation") throw new Error("Expected inventory");
  expect(response.value).toMatchObject({
    assets: expect.arrayContaining([
      expect.objectContaining({
        id: "logo",
        name: "Imported logo",
        type: "image",
        width: 32,
        height: 24,
      }),
    ]),
  });
  expect(JSON.stringify(response)).not.toContain("must-not-leak");
});
