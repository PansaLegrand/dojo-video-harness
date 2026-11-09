import { expect, it } from "vitest";
import { runAgent } from "../packages/agent/src/loop";
import {
  createVideoProjectDocument,
  hashVideoProjectDocument,
} from "../packages/core/src/lib/video-project/document";
import { builtInSkills } from "../packages/agent-kit/src/index";
it.each(["local-editor-v4", "local-editor-v5"] as const)(
  "provides the intended initial caption context for %s",
  async (profile) => {
    const document = createVideoProjectDocument({
      width: 640,
      height: 360,
      fps: 30,
      durationInFrames: 360,
    });
    document.assets.a = {
      id: "a",
      name: "Interview",
      type: "video",
      source: "local",
      durationSeconds: 12,
    };
    document.sources.a = { assetId: "a", revision: "original" };
    document.items.push({
      id: "clip",
      name: "Interview",
      trackId: "visual",
      node: { id: "clip", type: "video", assetId: "a", from: 0, duration: 360 },
    });
    document.evidence.e = {
      id: "e",
      sourceAssetId: "a",
      sourceRevision: "original",
      language: "en",
      transcriptHash: "hash",
      text: "First. Second.",
      words: [
        { id: "word-0", text: "First.", startMs: 0, endMs: 1000 },
        { id: "word-1", text: "Second.", startMs: 4000, endMs: 5000 },
      ],
    };
    const request = {
      contract: "video-project-commands" as const,
      version: 1 as const,
      baseRevision: 1,
      baseHash: await hashVideoProjectDocument(document),
      document,
      instruction: "Caption source 1..9 seconds in English and Chinese",
      context: { selectedItemIds: ["clip"], playheadFrame: 0 },
      authoring: { version: 1 as const, scope: { kind: "project" as const } },
    };
    await runAgent({
      request,
      profile,
      skills: builtInSkills(),
      signal: new AbortController().signal,
      model: {
        identity: "overview-fixture",
        complete: async (messages) => {
          const data = JSON.parse(
            String(
              messages.find((message) => message.role === "user")!.content,
            ),
          );
          expect(data.contextPlan).not.toHaveProperty("captionSources");
          if (profile === "local-editor-v5") {
            expect(data.completionCaptionSources).toMatchObject({
              overviewOnly: true,
              complete: false,
              sources: [
                {
                  sourceItemId: "clip",
                  evidenceId: "e",
                  cueCount: 2,
                  rangeReaderRequired: true,
                },
              ],
            });
            expect(data.completionCaptionSources.sources[0]).not.toHaveProperty(
              "cues",
            );
          } else
            expect(data.completionCaptionSources.sources[0].cues).toHaveLength(
              2,
            );
          return {
            text: "The requested sources are available.",
            calls: [],
            usage: { inputTokens: 1, outputTokens: 1 },
          };
        },
      },
    });
  },
);
