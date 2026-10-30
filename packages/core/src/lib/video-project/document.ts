import { assertLinkedGroupBindings } from "./composition";
import { z } from "zod/v3";
import {
  editorDocumentSchema,
  createEditorDocument,
  parseEditorDocument,
  assertEditorDocumentStructure,
  type EditorDocument,
  type EditorFormat,
} from "@/lib/editor/document";

export const VIDEO_PROJECT_DOCUMENT_KIND = "video-project" as const;
export const VIDEO_PROJECT_DOCUMENT_VERSION = 1 as const;
const id = z
  .string()
  .min(1)
  .max(191)
  .refine(
    (value) => !["__proto__", "prototype", "constructor"].includes(value),
    "Reserved identity.",
  );
export const videoSourceIdentitySchema = z
  .object({
    assetId: id,
    revision: id,
    contentHash: z
      .string()
      .regex(/^[a-f0-9]{64}$/)
      .optional(),
  })
  .strict();
export const transcriptWordSchema = z
  .object({
    id,
    text: z.string().max(1000),
    startMs: z.number().finite().nonnegative(),
    endMs: z.number().finite().positive(),
  })
  .strict()
  .refine(
    (word) => word.endMs > word.startMs,
    "A word must have a positive source duration.",
  );
export const videoTranscriptEvidenceSchema = z
  .object({
    id,
    asrTaskId: id.optional(),
    sourceAssetId: id,
    sourceRevision: id,
    transcriptHash: z.string().min(1).max(191),
    language: z.string().max(64).optional(),
    text: z.string().max(500_000),
    words: z.array(transcriptWordSchema).max(50_000),
  })
  .strict();
export const videoSourceBindingSchema = z
  .object({
    id,
    itemId: id,
    sourceItemId: id,
    sourceAssetId: id,
    sourceRevision: id,
    sourceStartMs: z.number().finite().nonnegative(),
    sourceEndMs: z.number().finite().positive(),
    evidenceId: id.optional(),
    wordIds: z.array(id).max(500).optional(),
    status: z.enum(["active", "unresolved"]).default("active"),
  })
  .strict()
  .refine(
    (binding) => binding.sourceEndMs > binding.sourceStartMs,
    "An anchor must have a positive source duration.",
  );
export const videoCreativeContextSchema = z
  .object({
    decisions: z
      .array(
        z
          .object({
            id,
            text: z.string().max(2000),
            entityIds: z.array(id).max(100),
          })
          .strict(),
      )
      .max(50),
    references: z
      .array(
        z
          .object({
            id,
            entityIds: z.array(id).max(100),
            description: z.string().max(1000),
          })
          .strict(),
      )
      .max(50),
  })
  .strict();
export const videoProjectDocumentSchema = editorDocumentSchema
  .extend({
    kind: z.literal(VIDEO_PROJECT_DOCUMENT_KIND),
    version: z.literal(VIDEO_PROJECT_DOCUMENT_VERSION),
    sources: z.record(videoSourceIdentitySchema).default({}),
    evidence: z.record(videoTranscriptEvidenceSchema).default({}),
    bindings: z.record(videoSourceBindingSchema).default({}),
    creativeContext: videoCreativeContextSchema.default({
      decisions: [],
      references: [],
    }),
  })
  .strict();
export type VideoProjectDocument = z.infer<typeof videoProjectDocumentSchema>;
export type VideoSourceBinding = z.infer<typeof videoSourceBindingSchema>;
export type VideoTranscriptEvidence = z.infer<
  typeof videoTranscriptEvidenceSchema
>;

/** A transient compiler/UI view, never a second writable authority. */
export function toEditorDocument(
  document: VideoProjectDocument,
): EditorDocument {
  const {
    sources: _sources,
    evidence: _evidence,
    bindings: _bindings,
    creativeContext: _context,
    ...native
  } = document;
  return parseEditorDocument({ ...native, kind: "motionforge-editor" });
}
export function fromEditorDocument(
  document: EditorDocument,
  previous?: VideoProjectDocument,
): VideoProjectDocument {
  return parseVideoProjectDocument({
    ...document,
    kind: VIDEO_PROJECT_DOCUMENT_KIND,
    sources: previous?.sources ?? {},
    evidence: previous?.evidence ?? {},
    bindings: previous?.bindings ?? {},
    creativeContext: previous?.creativeContext ?? {
      decisions: [],
      references: [],
    },
  });
}
export function createVideoProjectDocument(
  format: Partial<EditorFormat> = {},
): VideoProjectDocument {
  return fromEditorDocument(
    createEditorDocument({ width: 1080, height: 1920, ...format }),
  );
}
/**
 * Prisma's JSON transport rounds some JS doubles on writes. Canonicalize
 * fractional values before validation and hashing so browser, worker and DB
 * snapshots agree. Integer frame/count values and all identity strings remain
 * exact; 15 significant digits is far below a visible pixel/audio-sample delta.
 */
export const VIDEO_PROJECT_NUMERIC_PRECISION = 15;
function canonicalNumber(value: number): number {
  if (!Number.isFinite(value) || Number.isInteger(value))
    return Object.is(value, -0) ? 0 : value;
  return Number(value.toPrecision(VIDEO_PROJECT_NUMERIC_PRECISION));
}
export function normalizeVideoProjectJson<T>(value: T, depth = 0): T {
  if (depth > 128)
    throw new Error(
      "The video project JSON exceeds the supported nesting depth.",
    );
  if (typeof value === "number") return canonicalNumber(value) as T;
  if (Array.isArray(value))
    return value.map((child) =>
      normalizeVideoProjectJson(child, depth + 1),
    ) as T;
  if (value && typeof value === "object")
    return Object.fromEntries(
      Object.entries(value).map(([key, child]) => [
        key,
        normalizeVideoProjectJson(child, depth + 1),
      ]),
    ) as T;
  return value;
}
export function parseVideoProjectDocument(
  input: unknown,
): VideoProjectDocument {
  const document = videoProjectDocumentSchema.parse(
    normalizeVideoProjectJson(input),
  );
  // The extended schema already checked every editor field. Repeat semantic
  // integrity checks on its transient view, without parsing the same tree twice.
  const {
    sources: _sources,
    evidence: _evidence,
    bindings: _bindings,
    creativeContext: _context,
    ...native
  } = document;
  assertEditorDocumentStructure({ ...native, kind: "motionforge-editor" });
  const unsafe = new Set(["__proto__", "prototype", "constructor"]);
  const inspectIds = (value: unknown): void => {
    if (!value || typeof value !== "object") return;
    for (const [key, child] of Object.entries(value)) {
      if (
        unsafe.has(key) ||
        ((key === "id" || key.endsWith("Id")) &&
          typeof child === "string" &&
          unsafe.has(child))
      )
        throw new Error(
          "Reserved object names cannot be used as document identities.",
        );
      inspectIds(child);
    }
  };
  inspectIds(document);
  const itemsById = new Map(document.items.map((item) => [item.id, item]));
  for (const item of document.items) {
    if (
      item.caption &&
      new Set(item.caption.cues.map((cue) => cue.id)).size !==
        item.caption.cues.length
    )
      throw new Error("Caption cue IDs must be unique within their item.");
    if (item.caption?.sourceItemId) {
      const source = itemsById.get(item.caption.sourceItemId);
      if (!source || !["video", "audio"].includes(source.node.type))
        throw new Error(
          "A caption source must reference an existing media clip.",
        );
    }
    if (
      item.caption?.pairedItemId &&
      !itemsById.get(item.caption.pairedItemId)?.caption
    )
      throw new Error(
        "A paired caption must reference an existing caption item.",
      );
  }
  if (JSON.stringify(document).length > 4_000_000)
    throw new Error("The video project exceeds 4 MB.");
  for (const [key, source] of Object.entries(document.sources)) {
    if (key !== source.assetId || !document.assets[key])
      throw new Error("A source identity must reference its declared asset.");
  }
  for (const [key, evidence] of Object.entries(document.evidence)) {
    if (key !== evidence.id) throw new Error("Evidence key and ID must match.");
    const source = document.sources[evidence.sourceAssetId];
    if (!source || source.revision !== evidence.sourceRevision)
      throw new Error(
        "Transcript evidence must match an immutable source revision.",
      );
    if (
      new Set(evidence.words.map((word) => word.id)).size !==
      evidence.words.length
    )
      throw new Error("Transcript word IDs must be unique.");
    if (
      evidence.words.some(
        (word, index) =>
          index > 0 && word.startMs < evidence.words[index - 1]!.startMs,
      )
    )
      throw new Error("Transcript words must be in source order.");
  }
  const bound = new Set<string>();
  for (const [key, binding] of Object.entries(document.bindings)) {
    if (key !== binding.id || bound.has(binding.itemId))
      throw new Error("An item may have one source binding, with a unique ID.");
    bound.add(binding.itemId);
    if (!itemsById.has(binding.itemId))
      throw new Error("An anchor target does not exist.");
    if (binding.itemId === binding.sourceItemId)
      throw new Error("A source cannot be anchored to itself.");
    const clip = itemsById.get(binding.sourceItemId);
    if (
      !clip ||
      !["video", "audio"].includes(clip.node.type) ||
      clip.node.assetId !== binding.sourceAssetId
    )
      throw new Error("An anchor requires its declared source clip.");
    if (
      document.sources[binding.sourceAssetId]?.revision !==
      binding.sourceRevision
    )
      throw new Error("The anchor source revision is stale.");
    if (binding.evidenceId) {
      const evidence = document.evidence[binding.evidenceId];
      if (
        !evidence ||
        evidence.sourceAssetId !== binding.sourceAssetId ||
        evidence.sourceRevision !== binding.sourceRevision
      )
        throw new Error("The anchor transcript is stale.");
      const words = (binding.wordIds ?? []).map((wordId) =>
        evidence.words.find((word) => word.id === wordId),
      );
      if (!words.length || words.some((word) => !word))
        throw new Error("A speech anchor requires known source word IDs.");
      const indices = (binding.wordIds ?? []).map((wordId) =>
        evidence.words.findIndex((word) => word.id === wordId),
      );
      if (indices.some((index, at) => at > 0 && index !== indices[at - 1]! + 1))
        throw new Error(
          "A speech anchor must use contiguous source words in order.",
        );
      if (
        binding.sourceStartMs !== words[0]!.startMs ||
        binding.sourceEndMs !== words[words.length - 1]!.endMs
      )
        throw new Error(
          "Speech anchor timestamps must be resolved from immutable words.",
        );
    } else if (binding.wordIds?.length)
      throw new Error("Word anchors require transcript evidence.");
  }
  const bindingByItem = new Map(
    Object.values(document.bindings).map((binding) => [
      binding.itemId,
      binding,
    ]),
  );
  for (const binding of Object.values(document.bindings)) {
    const seen = new Set<string>();
    let next: VideoSourceBinding | undefined = binding;
    while (next) {
      if (seen.has(next.itemId))
        throw new Error("Source bindings cannot form a cycle.");
      seen.add(next.itemId);
      next = bindingByItem.get(next.sourceItemId);
    }
  }
  assertLinkedGroupBindings(document);
  return document;
}

/** Stable JSON is also used by browser and server command receipts. */
export function canonicalSerialize(value: unknown): string {
  if (value === undefined) return "null";
  if (typeof value === "number") return JSON.stringify(canonicalNumber(value));
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value))
    return `[${value.map(canonicalSerialize).join(",")}]`;
  return `{${Object.entries(value)
    .filter(([, child]) => child !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(
      ([key, child]) => `${JSON.stringify(key)}:${canonicalSerialize(child)}`,
    )
    .join(",")}}`;
}
export const serializeVideoProjectDocument = (document: VideoProjectDocument) =>
  canonicalSerialize(parseVideoProjectDocument(document));
export async function hashVideoProjectDocument(
  document: VideoProjectDocument,
): Promise<string> {
  const bytes = new TextEncoder().encode(
    serializeVideoProjectDocument(document),
  );
  return (
    "sha256:" +
    [...new Uint8Array(await globalThis.crypto.subtle.digest("SHA-256", bytes))]
      .map((byte) => byte.toString(16).padStart(2, "0"))
      .join("")
  );
}

export { compileVideoProjectDocument } from "./compilation";
export type {
  VideoProjectSourceMap,
  VideoProjectSourceMapEntry,
} from "./compilation";
