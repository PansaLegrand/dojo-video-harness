import { expect, it } from "vitest";
import {
  assembleCaptionTranslationBatches,
  createCaptionBatchManifest,
  prepareCaptionTranslationBatch,
} from "../packages/core/src/lib/video-project/caption-batches";
import {
  prepareCaptionPair,
  prepareCaptionPairSource,
} from "../packages/core/src/lib/video-project/caption-pair";
import {
  createVideoProjectDocument,
  hashVideoProjectDocument,
} from "../packages/core/src/lib/video-project/document";
import { executeVideoProjectCommands } from "../packages/core/src/lib/video-project/commands";
import { reviewNativeCompletionEdit } from "../packages/core/src/lib/video-project/completion-preflight";
import { completionHash } from "../packages/agent-kit/src/completion";
function fixture(count = 501, fps = 30, rate = 1) {
  const document = createVideoProjectDocument({
    width: 640,
    height: 360,
    fps,
    durationInFrames: Math.ceil((count * 4 * fps) / rate),
  });
  document.assets.a = {
    id: "a",
    name: "Genuine speech",
    type: "video",
    source: "local",
    durationSeconds: count * 4,
  };
  document.sources.a = { assetId: "a", revision: "unchanged-source" };
  document.items.push({
    id: "speech",
    name: "Genuine speech",
    trackId: "visual",
    node: {
      id: "speech",
      type: "video",
      assetId: "a",
      from: 0,
      duration: document.format.durationInFrames,
      playbackRate: rate,
    },
  });
  const words = Array.from({ length: count }, (_, i) => ({
    id: `word-${i}`,
    text: `Sentence ${i}.`,
    startMs: i * 4000,
    endMs: i * 4000 + 3000,
  }));
  document.evidence.e = {
    id: "e",
    sourceAssetId: "a",
    sourceRevision: "unchanged-source",
    transcriptHash: "immutable-raw-asr",
    language: "en",
    text: words.map((word) => word.text).join(" "),
    words,
  };
  const settings = {
    sourceItemId: "speech",
    evidenceId: "e",
    originalItemId: "original",
    translatedItemId: "translated",
    trackId: "visual",
    originalLanguage: "en",
    translatedLanguage: "zh",
    originalColor: "#ff0000",
    translatedColor: "#ffffff",
  };
  return { document, settings };
}
async function translated(f: ReturnType<typeof fixture>, size = 500) {
  const manifest = await createCaptionBatchManifest(
      f.document,
      f.settings,
      size,
    ),
    cues = prepareCaptionPairSource(f.document, f.settings).cues;
  const batches = [];
  for (const batch of manifest.batches)
    batches.push(
      await prepareCaptionTranslationBatch(
        f.document,
        manifest,
        batch.id,
        cues
          .slice(batch.offset, batch.offset + batch.count)
          .map((cue) => ({ cueId: cue.id, text: `中文 ${cue.id}` })),
      ),
    );
  return { manifest, batches, cues };
}
it("assembles all 501 genuine cues from two batches into one complete guarded candidate", async () => {
  const f = fixture(),
    before = JSON.stringify(f.document),
    { manifest, batches, cues } = await translated(f);
  expect(manifest.batches.map((batch) => batch.count)).toEqual([500, 1]);
  expect(() =>
    prepareCaptionPair(
      f.document,
      {
        ...f.settings,
        translations: batches.flatMap((batch) => batch.translations),
      },
      { sourceRange: true },
    ),
  ).toThrow();
  const prepared = await assembleCaptionTranslationBatches(
    f.document,
    manifest,
    batches.slice().reverse(),
  );
  expect(await completionHash(prepared.commands)).toMatchSnapshot(
    "501-cue native commands v1",
  );
  const after = executeVideoProjectCommands(
    f.document,
    prepared.commands,
  ).document;
  const original = after.items.find((item) => item.id === "original")!,
    translatedItem = after.items.find((item) => item.id === "translated")!;
  expect(original.caption!.cues).toEqual(cues);
  expect(
    translatedItem.caption!.cues.map(({ id, startMs, endMs }) => ({
      id,
      startMs,
      endMs,
    })),
  ).toEqual(cues.map(({ id, startMs, endMs }) => ({ id, startMs, endMs })));
  expect(original.caption!.pairedItemId).toBe("translated");
  expect(translatedItem.caption!.pairedItemId).toBe("original");
  expect(prepared.coverage).toEqual({
    complete: true,
    total: 501,
    returned: 501,
  });
  const { trackId: _trackId, ...pairRequirement } = f.settings;
  const reviewed = await reviewNativeCompletionEdit(
    {
      contract: "video-project-commands",
      version: 1,
      baseRevision: 1,
      baseHash: await hashVideoProjectDocument(f.document),
      document: f.document,
      instruction: "Every source cue in English and Chinese, red and white.",
      context: { selectedItemIds: [], playheadFrame: 0 },
      authoring: { version: 1, scope: { kind: "project" } },
    },
    {
      requirements: [
        { id: "complete-pair", kind: "caption_pair", ...pairRequirement },
      ],
      edit: {
        outcome: "proposal",
        summary: "Complete both batches",
        commands: prepared.commands,
      },
    },
  );
  expect(reviewed.receipt, JSON.stringify(reviewed.checks)).toBeDefined();
  expect(JSON.stringify(f.document)).toBe(before);
});
it("rejects missing/duplicate/foreign batches and translations before final candidate assembly", async () => {
  const f = fixture(),
    { manifest, batches, cues } = await translated(f);
  for (const invalid of [
    batches.slice(0, 1),
    [batches[0], batches[0]],
    [{ ...batches[0], sourceHash: "sha256:" + "b".repeat(64) }, batches[1]],
    [{ ...batches[0], offset: 1 }, batches[1]],
    [{ ...batches[0], totalCues: 500 }, batches[1]],
  ])
    await expect(
      assembleCaptionTranslationBatches(f.document, manifest, invalid),
    ).rejects.toThrow();
  await expect(
    prepareCaptionTranslationBatch(
      f.document,
      manifest,
      manifest.batches[0].id,
      [{ cueId: cues[500].id, text: "Wrong batch" }],
    ),
  ).rejects.toThrow(/every genuine cue/);
  const duplicate = batches[0].translations.slice();
  duplicate[1] = duplicate[0];
  await expect(
    prepareCaptionTranslationBatch(
      f.document,
      manifest,
      manifest.batches[0].id,
      duplicate,
    ),
  ).rejects.toThrow(/duplicate/);
});
it("reuses ordered source IDs, preserves all evidence and rejects a changed source or manifest", async () => {
  const f = fixture(1001),
    { manifest, batches } = await translated(f);
  expect(manifest.batches.map((batch) => batch.count)).toEqual([500, 500, 1]);
  const first = await assembleCaptionTranslationBatches(
      f.document,
      manifest,
      batches,
    ),
    second = await assembleCaptionTranslationBatches(
      f.document,
      manifest,
      JSON.parse(JSON.stringify(batches)),
    );
  expect(second).toEqual(first);
  const changed = structuredClone(f.document);
  changed.sources.a.revision = "new-original";
  await expect(
    assembleCaptionTranslationBatches(changed, manifest, batches),
  ).rejects.toThrow();
  await expect(
    assembleCaptionTranslationBatches(
      f.document,
      { ...manifest, totalCues: 1000 },
      batches,
    ),
  ).rejects.toThrow(/stale/);
  await expect(
    createCaptionBatchManifest(f.document, f.settings, 1),
  ).rejects.toThrow(/exceeds/);
});
it("matches ordinary preparation exactly for a ranged, non-30fps playback source", async () => {
  const f = fixture(20, 25, 1.25),
    settings = { ...f.settings, sourceRange: { startMs: 4000, endMs: 40000 } };
  const manifest = await createCaptionBatchManifest(f.document, settings, 5),
    cues = prepareCaptionPairSource(f.document, settings).cues;
  const translations = cues.map((cue) => ({
      cueId: cue.id,
      text: `中文 ${cue.id}`,
    })),
    batches = [];
  for (const batch of manifest.batches)
    batches.push(
      await prepareCaptionTranslationBatch(
        f.document,
        manifest,
        batch.id,
        translations.slice(batch.offset, batch.offset + batch.count),
      ),
    );
  const assembled = await assembleCaptionTranslationBatches(
      f.document,
      manifest,
      batches,
    ),
    ordinary = prepareCaptionPair(
      f.document,
      { ...settings, translations },
      { sourceRange: true },
    );
  expect(assembled.commands).toEqual(ordinary.commands);
  expect(await completionHash(assembled.commands)).toMatchSnapshot(
    "trimmed-25fps-1.25x native commands v1",
  );
  expect(assembled.cues).toEqual(ordinary.cues);
  expect(JSON.stringify(f.document.evidence)).toBe(
    JSON.stringify(
      executeVideoProjectCommands(f.document, assembled.commands).document
        .evidence,
    ),
  );
});
