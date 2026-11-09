import { z } from "zod/v3";
import {
  completionCanonical,
  completionHash,
} from "../../../../agent-kit/src/completion";
import {
  hashVideoProjectDocument,
  type VideoProjectDocument,
} from "./document";
import {
  captionPairSettingsSchema,
  prepareCaptionPairSource,
  prepareCaptionPairForBatchAssembly,
  type CaptionPairSettings,
} from "./caption-pair";
import { captionTimingDiagnostics } from "./caption-source-range";

const hash = z.string().regex(/^sha256:[a-f0-9]{64}$/),
  id = z.string().min(1).max(191);
const batchDescriptorSchema = z
  .object({
    id,
    offset: z.number().int().min(0).max(4999),
    count: z.number().int().min(1).max(500),
    cuesHash: hash,
  })
  .strict();
export const captionBatchManifestSchema = z
  .object({
    version: z.literal(1),
    grouping: z.literal("phrase-safe-v1"),
    snapshotHash: hash,
    sourceHash: hash,
    manifestHash: hash,
    settings: captionPairSettingsSchema,
    totalCues: z.number().int().min(1).max(5000),
    batchSize: z.number().int().min(1).max(500),
    batches: z.array(batchDescriptorSchema).min(1).max(64),
  })
  .strict();
export type CaptionBatchManifest = z.infer<typeof captionBatchManifestSchema>;
export const captionTranslationBatchSchema = z
  .object({
    version: z.literal(1),
    manifestHash: hash,
    sourceHash: hash,
    batchId: id,
    offset: z.number().int().min(0).max(4999),
    count: z.number().int().min(1).max(500),
    totalCues: z.number().int().min(1).max(5000),
    translations: z
      .array(
        z
          .object({ cueId: id, text: z.string().trim().min(1).max(1000) })
          .strict(),
      )
      .min(1)
      .max(500),
  })
  .strict();
export type CaptionTranslationBatch = z.infer<
  typeof captionTranslationBatchSchema
>;

/** The complete source-derived plan is immutable before the first translation. */
export async function createCaptionBatchManifest(
  document: VideoProjectDocument,
  rawSettings: unknown,
  batchSize = 500,
): Promise<CaptionBatchManifest> {
  const settings = captionPairSettingsSchema.parse(rawSettings);
  z.number().int().min(1).max(500).parse(batchSize);
  const prepared = prepareCaptionPairSource(document, settings);
  const evidence = prepared.document.evidence[settings.evidenceId];
  if (
    captionTimingDiagnostics(prepared.document, settings.sourceItemId, evidence)
  )
    throw new Error(
      "Caption batches require complete genuine timing in the requested source window.",
    );
  const totalCues = prepared.cues.length;
  if (!totalCues || totalCues > 5000 || Math.ceil(totalCues / batchSize) > 64)
    throw new Error(
      "The complete caption plan exceeds the staged cue/batch policy. Narrow the requested source window explicitly.",
    );
  const snapshotHash = await hashVideoProjectDocument(document);
  const sourceHash = await completionHash({
    settings,
    grouping: "phrase-safe-v1",
    format: document.format,
    source: prepared.document.items.find(
      (item) => item.id === settings.sourceItemId,
    ),
    evidence,
    sourceRevision: prepared.document.sources[evidence.sourceAssetId],
    cues: prepared.cues,
  });
  const batches: CaptionBatchManifest["batches"] = [];
  for (let offset = 0; offset < totalCues; offset += batchSize) {
    const cues = prepared.cues.slice(offset, offset + batchSize),
      cuesHash = await completionHash(cues);
    batches.push({
      id: `batch:${(await completionHash({ sourceHash, offset, cuesHash })).slice(7, 39)}`,
      offset,
      count: cues.length,
      cuesHash,
    });
  }
  const body = {
    version: 1 as const,
    grouping: "phrase-safe-v1" as const,
    snapshotHash,
    sourceHash,
    settings,
    totalCues,
    batchSize,
    batches,
  };
  return captionBatchManifestSchema.parse({
    ...body,
    manifestHash: await completionHash(body),
  });
}
async function checkedManifest(document: VideoProjectDocument, raw: unknown) {
  const manifest = captionBatchManifestSchema.parse(raw),
    expected = await createCaptionBatchManifest(
      document,
      manifest.settings,
      manifest.batchSize,
    );
  if (completionCanonical(manifest) !== completionCanonical(expected))
    throw new Error(
      "Caption manifest is stale or its source, range, grouping or batch coverage changed.",
    );
  return manifest;
}
/** Persist this returned artifact once; translated display text never replaces evidence. */
export async function prepareCaptionTranslationBatch(
  document: VideoProjectDocument,
  rawManifest: unknown,
  batchId: string,
  rawTranslations: unknown,
): Promise<CaptionTranslationBatch> {
  const manifest = await checkedManifest(document, rawManifest),
    batch = manifest.batches.find((value) => value.id === batchId);
  if (!batch)
    throw new Error("Choose a batch from the immutable complete caption plan.");
  const translations =
      captionTranslationBatchSchema.shape.translations.parse(rawTranslations),
    byId = new Map(translations.map((cue) => [cue.cueId, cue.text]));
  const prepared = prepareCaptionPairSource(document, manifest.settings),
    expected = prepared.cues.slice(batch.offset, batch.offset + batch.count);
  if (
    byId.size !== translations.length ||
    translations.length !== batch.count ||
    expected.some((cue) => !byId.has(cue.id))
  )
    throw new Error(
      "Provide exactly one translation for every genuine cue in this batch; no duplicate, missing or foreign cues.",
    );
  return captionTranslationBatchSchema.parse({
    version: 1,
    manifestHash: manifest.manifestHash,
    sourceHash: manifest.sourceHash,
    batchId,
    offset: batch.offset,
    count: batch.count,
    totalCues: manifest.totalCues,
    translations: expected.map((cue) => ({
      cueId: cue.id,
      text: byId.get(cue.id)!,
    })),
  });
}
/** Missing/duplicate/stale batches cannot yield a partial final caption pair. */
export async function assembleCaptionTranslationBatches(
  document: VideoProjectDocument,
  rawManifest: unknown,
  rawBatches: unknown[],
) {
  const manifest = await checkedManifest(document, rawManifest);
  if (
    !Array.isArray(rawBatches) ||
    rawBatches.length !== manifest.batches.length
  )
    throw new Error(
      "The final caption pair requires every completed translation batch.",
    );
  const batches = rawBatches.map((value) =>
      captionTranslationBatchSchema.parse(value),
    ),
    byId = new Map(batches.map((batch) => [batch.batchId, batch]));
  if (byId.size !== batches.length)
    throw new Error(
      "Duplicate caption batches cannot satisfy complete coverage.",
    );
  const translations: CaptionTranslationBatch["translations"] = [],
    receipts: Array<{ batchId: string; sha256: string }> = [];
  for (const expected of manifest.batches) {
    const batch = byId.get(expected.id);
    if (
      !batch ||
      batch.manifestHash !== manifest.manifestHash ||
      batch.sourceHash !== manifest.sourceHash ||
      batch.offset !== expected.offset ||
      batch.count !== expected.count ||
      batch.totalCues !== manifest.totalCues
    )
      throw new Error(
        "A translation batch does not match its exact source/range/offset manifest.",
      );
    const checked = await prepareCaptionTranslationBatch(
      document,
      manifest,
      expected.id,
      batch.translations,
    );
    if (completionCanonical(checked) !== completionCanonical(batch))
      throw new Error(
        "A translation batch changed its ordered source coverage.",
      );
    translations.push(...checked.translations);
    receipts.push({
      batchId: checked.batchId,
      sha256: await completionHash(checked),
    });
  }
  if (translations.length !== manifest.totalCues)
    throw new Error("Caption batch coverage is incomplete.");
  return {
    ...prepareCaptionPairForBatchAssembly(document, {
      ...manifest.settings,
      translations,
    }),
    coverage: {
      complete: true,
      total: manifest.totalCues,
      returned: translations.length,
    },
    provenance: {
      version: 1 as const,
      grouping: manifest.grouping,
      manifestHash: manifest.manifestHash,
      sourceHash: manifest.sourceHash,
      batches: receipts,
    },
  };
}
export function captionBatchModelContext(
  manifest: CaptionBatchManifest,
  batchId: string,
) {
  const batch = manifest.batches.find((value) => value.id === batchId);
  if (!batch) throw new Error("Unknown caption batch.");
  return {
    kind: "caption_batch" as const,
    sourceItemId: manifest.settings.sourceItemId,
    evidenceId: manifest.settings.evidenceId,
    sourceRange: manifest.settings.sourceRange,
    grouping: manifest.grouping,
    totalCues: manifest.totalCues,
    batch,
    settings: manifest.settings,
    instruction:
      "Read only this exact batch's source cues. Preserve every genuine cue ID and translate display text only. Save exactly this batch; completed siblings remain authoritative artifacts. The host assembles and verifies the complete pair after all batches exist.",
  };
}
