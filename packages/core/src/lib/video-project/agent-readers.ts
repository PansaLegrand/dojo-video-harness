import { z } from "zod/v3";
import { completionHash } from "../../../../agent-kit/src/index";
import type { NativeAgentRequest } from "./agent-runtime";
import {
  hashVideoProjectDocument,
  parseVideoProjectDocument,
} from "./document";
import { nativeTranscriptScopedSourceItemIds } from "./agent-transcript-search";
import { captionSourceCommands } from "./semantic";
import { sourceWindow } from "./source-clock";
import {
  captionTimingDiagnostics,
  captionSourceRangeSchema,
  prepareCaptionSourceRange,
} from "./caption-source-range";

export const NATIVE_READER_LIMITS = Object.freeze({
  assets: 50,
  assetBytes: 16_000,
  cues: 100,
  cueBytes: 24_000,
});
const hash = z.string().regex(/^sha256:[a-f0-9]{64}$/);
const id = z.string().min(1).max(191);
const cursor = z.string().max(160).optional();
export const nativeAssetQuerySchema = z
  .object({
    snapshotHash: hash,
    name: z.string().max(128).optional(),
    type: z.enum(["video", "audio", "image", "font", "lottie"]).optional(),
    usage: z.enum(["all", "used", "unused"]).default("all"),
    cursor,
  })
  .strict();
export const nativeCaptionCueQuerySchema = z
  .object({
    snapshotHash: hash,
    sourceItemId: id,
    evidenceId: id,
    sourceRange: captionSourceRangeSchema.optional(),
    cursor,
  })
  .strict();
export type NativeAssetQuery = z.input<typeof nativeAssetQuerySchema>;
export type NativeCaptionCueQuery = z.input<typeof nativeCaptionCueQuerySchema>;
const bytes = (value: unknown) =>
  new TextEncoder().encode(JSON.stringify(value)).byteLength;
const normalized = (value: string) => value.normalize("NFKC").toLowerCase();
function scopeBinding(request: NativeAgentRequest) {
  return (
    request.authoring?.scope ?? {
      selectedItemIds: request.context.selectedItemIds,
      selectedNodeId: request.context.selectedNodeId,
    }
  );
}
async function snapshot(request: NativeAgentRequest, snapshotHash: string) {
  if (snapshotHash !== request.baseHash)
    throw new Error("Reader snapshot changed.");
  const document = parseVideoProjectDocument(request.document);
  if ((await hashVideoProjectDocument(document)) !== snapshotHash)
    throw new Error("Reader document differs from its immutable snapshot.");
  return document;
}
async function offsetOf(
  raw: string | undefined,
  kind: string,
  binding: unknown,
  total: number,
) {
  if (raw === undefined) return 0;
  const match = /^([a-z]+)-v1:(0|[1-9]\d{0,6}):(sha256:[a-f0-9]{64})$/.exec(
    raw,
  );
  if (!match || match[1] !== kind) throw new Error("Invalid reader cursor.");
  const offset = Number(match[2]);
  if (
    offset < 1 ||
    offset >= total ||
    (await completionHash({ binding, offset })) !== match[3]
  )
    throw new Error(
      "Reader cursor belongs to another snapshot, query, scope or source.",
    );
  return offset;
}
async function nextCursor(kind: string, binding: unknown, offset: number) {
  return `${kind}-v1:${offset}:${await completionHash({ binding, offset })}`;
}
async function boundedPage<
  T,
  P extends {
    coverage: {
      total: number;
      returned: number;
      offset: number;
      complete: boolean;
      nextCursor: string | null;
      reason?: string;
    };
  },
>(
  values: readonly T[],
  offset: number,
  kind: string,
  binding: unknown,
  limits: { count: number; bytes: number },
  build: (items: T[]) => P,
) {
  const accepted: T[] = [];
  // Leave space for the final cursor and coverage fields before admitting rows.
  for (const value of values.slice(offset, offset + limits.count)) {
    const candidate = build([...accepted, value]);
    if (bytes(candidate) > limits.bytes - 512) break;
    accepted.push(value);
  }
  const page = build(accepted),
    next = offset + accepted.length;
  page.coverage.returned = accepted.length;
  page.coverage.complete = next === values.length;
  if (next < values.length && accepted.length)
    page.coverage.nextCursor = await nextCursor(kind, binding, next);
  if (next < values.length && !accepted.length)
    page.coverage.reason = "entry_exceeds_page_budget";
  if (bytes(page) > limits.bytes)
    throw new Error("Reader page exceeds its byte budget.");
  return page;
}

/** Reads owned project metadata. Edit scope binds the cursor but unused owned
 * assets remain discoverable for insertions into an authorized editing scope. */
export async function listNativeAssets(
  request: NativeAgentRequest,
  raw: unknown,
) {
  const input = nativeAssetQuerySchema.parse(raw),
    document = await snapshot(request, input.snapshotHash);
  const query = {
    name: normalized(input.name ?? ""),
    type: input.type,
    usage: input.usage,
  };
  const usedBy = new Map<string, Set<string>>();
  const addUse = (assetId: unknown, itemId: string) => {
    if (typeof assetId !== "string" || !document.assets[assetId]) return;
    const ids = usedBy.get(assetId) ?? new Set<string>();
    ids.add(itemId);
    usedBy.set(assetId, ids);
  };
  const visit = (
    node: (typeof document.items)[number]["node"],
    itemId: string,
  ) => {
    addUse(node.assetId, itemId);
    addUse(node.params?.audioAssetId, itemId);
    addUse(node.params?.coverAssetId, itemId);
    node.children?.forEach((child) => visit(child, itemId));
  };
  document.items.forEach((item) => visit(item.node, item.id));
  const values = Object.values(document.assets)
    .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
    .filter(
      (asset) =>
        (!input.type || asset.type === input.type) &&
        (!query.name || normalized(asset.name).includes(query.name)) &&
        (query.usage === "all" ||
          (query.usage === "used"
            ? usedBy.has(asset.id)
            : !usedBy.has(asset.id))),
    )
    .map((asset) => {
      const usage = [...(usedBy.get(asset.id) ?? [])].sort();
      const source = document.sources[asset.id];
      return {
        id: asset.id,
        name: asset.name,
        type: asset.type,
        ...(asset.width === undefined ? {} : { width: asset.width }),
        ...(asset.height === undefined ? {} : { height: asset.height }),
        ...(asset.durationSeconds === undefined
          ? {}
          : { durationSeconds: asset.durationSeconds }),
        ...(asset.byteLength === undefined
          ? {}
          : { byteLength: asset.byteLength }),
        ...(asset.mimeType === undefined ? {} : { mimeType: asset.mimeType }),
        source: {
          kind: asset.source,
          status:
            asset.source === "static"
              ? "static"
              : source
                ? asset.source === "project" || asset.assetId
                  ? "cloud_registered"
                  : "local_required"
                : "unregistered",
          ...(source ? { revision: source.revision } : {}),
        },
        used: usage.length > 0,
        usageCount: usage.length,
        usedInItemIds: usage.slice(0, 8),
        omittedUsageItems: Math.max(0, usage.length - 8),
      };
    });
  const binding = {
    kind: "assets-v1",
    snapshotHash: input.snapshotHash,
    scope: scopeBinding(request),
    query,
  };
  const offset = await offsetOf(input.cursor, "assets", binding, values.length);
  return boundedPage(
    values,
    offset,
    "assets",
    binding,
    {
      count: NATIVE_READER_LIMITS.assets,
      bytes: NATIVE_READER_LIMITS.assetBytes,
    },
    (assets) => ({
      version: 1 as const,
      kind: "assets" as const,
      snapshotHash: input.snapshotHash,
      query,
      assets,
      coverage: {
        total: values.length,
        returned: 0,
        offset,
        complete: false,
        nextCursor: null as string | null,
        reason: undefined as string | undefined,
      },
    }),
  );
}

/** Exact host-derived cue pages, with genuine word IDs and immutable evidence. */
export async function readNativeCaptionCues(
  request: NativeAgentRequest,
  raw: unknown,
) {
  const input = nativeCaptionCueQuerySchema.parse(raw),
    original = await snapshot(request, input.snapshotHash);
  const narrowed = input.sourceRange
    ? prepareCaptionSourceRange(original, input.sourceItemId, input.sourceRange)
    : undefined;
  const document = narrowed?.document ?? original;
  const allowed = nativeTranscriptScopedSourceItemIds({ ...request, document });
  if (allowed !== null && !allowed.includes(input.sourceItemId))
    throw new Error("Caption source is outside the requested scope.");
  const source = document.items.find((item) => item.id === input.sourceItemId);
  const evidence = document.evidence[input.evidenceId];
  if (
    !source ||
    !["video", "audio"].includes(source.node.type) ||
    !evidence ||
    evidence.sourceAssetId !== source.node.assetId ||
    evidence.sourceRevision !==
      document.sources[evidence.sourceAssetId]?.revision
  )
    throw new Error(
      "Caption source/evidence identity is unavailable or changed.",
    );
  const command = captionSourceCommands(document, {
    sourceItemId: source.id,
    evidenceId: evidence.id,
    itemId: "reader-cues",
    trackId:
      document.tracks.find((track) => track.kind === "visual")?.id ??
      "reader-track",
    phraseSafe: true,
  }).find((command) => command.type === "addItem");
  if (command?.type !== "addItem")
    throw new Error("No host-derived caption cues are available.");
  const window = sourceWindow(source, document.format.fps);
  const words = evidence.words.filter(
    (word) => word.endMs > window.startMs && word.startMs < window.endMs,
  );
  let wordAt = 0;
  const values = command.item.caption!.cues.map((cue) => {
    const wordIds = (cue.words ?? []).map((word) => {
      while (wordAt < words.length) {
        const original = words[wordAt++]!;
        if (
          word.text === original.text &&
          Math.abs(
            word.startMs -
              Math.max(0, (original.startMs - window.startMs) / window.rate),
          ) < 0.001 &&
          Math.abs(
            word.endMs -
              Math.min(
                (source.node.duration! * 1000) / document.format.fps,
                (original.endMs - window.startMs) / window.rate,
              ),
          ) < 0.001
        )
          return original.id;
      }
      throw new Error("Host caption words differ from their immutable source.");
    });
    return {
      cueId: cue.id,
      text: cue.text,
      startMs: cue.startMs,
      endMs: cue.endMs,
      wordIds,
    };
  });
  const timingOmissions = captionTimingDiagnostics(
    document,
    source.id,
    evidence,
  );
  const identity = {
    sourceItemId: source.id,
    evidenceId: evidence.id,
    sourceAssetId: evidence.sourceAssetId,
    sourceRevision: evidence.sourceRevision,
    transcriptHash: evidence.transcriptHash,
    ...(evidence.language ? { language: evidence.language } : {}),
    from: source.node.from ?? 0,
    duration: source.node.duration!,
    fps: document.format.fps,
    ...(narrowed ? { sourceRange: narrowed.sourceRange } : {}),
    ...(timingOmissions ? { timingOmissions } : {}),
  };
  const binding = {
    kind: "cues-v1",
    snapshotHash: input.snapshotHash,
    scope: scopeBinding(request),
    grouping: "phrase-safe-v1",
    source: identity,
  };
  const offset = await offsetOf(input.cursor, "cues", binding, values.length);
  const page = await boundedPage(
    values,
    offset,
    "cues",
    binding,
    { count: NATIVE_READER_LIMITS.cues, bytes: NATIVE_READER_LIMITS.cueBytes },
    (cues) => ({
      version: 1 as const,
      kind: "caption-cues" as const,
      snapshotHash: input.snapshotHash,
      grouping: "phrase-safe-v1",
      source: identity,
      cues,
      coverage: {
        total: values.length,
        returned: 0,
        offset,
        complete: false,
        nextCursor: null as string | null,
        reason: undefined as string | undefined,
      },
    }),
  );
  if (timingOmissions) {
    const cuesComplete = page.coverage.complete;
    page.coverage.complete = false;
    page.coverage.reason = "untimed_source_tokens";
    return { ...page, coverage: { ...page.coverage, cuesComplete } };
  }
  return page;
}
