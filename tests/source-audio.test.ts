import { expect, it } from "vitest";
import {
  createVideoProjectDocument,
  hashVideoProjectDocument,
  parseVideoProjectDocument,
} from "../packages/core/src/lib/video-project/document";
import {
  sourceAudioTrackPresence,
  fallbackSpeechSourceItems,
} from "../packages/core/src/lib/video-project/source-audio";
import { compileNativeAgentResult } from "../packages/core/src/lib/video-project/agent-runtime";

function fixture() {
  const document = createVideoProjectDocument();
  for (const [index, id] of ["silent", "speech", "unknown"].entries()) {
    const hash = String(index + 1).repeat(64);
    document.assets[id] = {
      id,
      name: id,
      source: "local",
      type: "video",
      mediaMetadata:
        id === "unknown"
          ? undefined
          : { hasAudio: id === "speech", contentHash: hash },
    };
    document.sources[id] = {
      assetId: id,
      revision: `sha256:${hash}`,
      contentHash: hash,
    };
    document.items.push({
      id,
      name: id,
      trackId: "visual",
      node: {
        id,
        type: "video",
        assetId: id,
        from: 0,
        duration: 90,
        volume: 0,
      },
    });
  }
  document.tracks[0]!.muted = true;
  return document;
}
it("binds track presence to original bytes and retains muted speech through reload", () => {
  const document = parseVideoProjectDocument(
    JSON.parse(JSON.stringify(fixture())),
  );
  expect(
    ["silent", "speech", "unknown"].map((id) =>
      sourceAudioTrackPresence(document, id),
    ),
  ).toEqual(["absent", "present", "unknown"]);
  document.assets.silent!.mediaMetadata!.contentHash = "f".repeat(64);
  expect(sourceAudioTrackPresence(document, "silent")).toBe("unknown");
  document.sources.speech!.revision = "different-original";
  expect(sourceAudioTrackPresence(document, "speech")).toBe("unknown");
});
it("keeps absent fields unknown and resolves duplicate instances as one speech source", () => {
  const document = fixture();
  const speech = document.items[1]!;
  expect(
    fallbackSpeechSourceItems(document, [
      document.items[0]!,
      speech,
      { ...speech, id: "duplicate" },
    ]),
  ).toHaveLength(2);
  expect(fallbackSpeechSourceItems(document, document.items)).toEqual([]);
  expect(fallbackSpeechSourceItems(document, [document.items[2]!])).toEqual([
    document.items[2],
  ]);
  delete document.assets.silent!.mediaMetadata!.contentHash;
  expect(sourceAudioTrackPresence(document, "silent")).toBe("unknown");
});
it("the local compiler accepts the existing bound metadata and preserve the same basis", async () => {
  const document = fixture(),
    baseHash = await hashVideoProjectDocument(document);
  const request = {
    contract: "video-project-commands" as const,
    version: 1 as const,
    baseRevision: 0,
    baseHash,
    document,
    context: { selectedItemIds: [], playheadFrame: 0 },
  };
  const edit = {
    outcome: "answer",
    summary: "Original audio metadata inspected",
    commands: [],
  };
  for (const compile of [compileNativeAgentResult]) {
    const result = await compile(request, edit);
    expect(result.baseHash).toBe(baseHash);
    expect(result.outcome).toBe("answer");
  }
});
it("a model cannot change the original audio fact by replacing an asset", async () => {
  const document = fixture(),
    baseHash = await hashVideoProjectDocument(document);
  await expect(
    compileNativeAgentResult(
      {
        contract: "video-project-commands",
        version: 1,
        baseRevision: 0,
        baseHash,
        document,
        context: { selectedItemIds: [], playheadFrame: 0 },
      },
      {
        outcome: "proposal",
        summary: "Fake silence",
        commands: [
          {
            type: "addAsset",
            asset: {
              ...document.assets.speech!,
              mediaMetadata: {
                hasAudio: false,
                contentHash: document.sources.speech!.contentHash,
              },
            },
          },
        ],
      },
    ),
  ).rejects.toThrow();
});
