import { z } from "zod/v3";
import { completionHash } from "../../../../agent-kit/src/index";
import type { NativeAgentRequest } from "./agent-runtime";
import {
  hashVideoProjectDocument,
  parseVideoProjectDocument,
} from "./document";
import { nativeScopeItemIds } from "./agent-scope";
import { nativeTranscriptScopedSourceItemIds } from "./agent-transcript-search";
const schema = z
  .object({
    snapshotHash: z.string().regex(/^sha256:[a-f0-9]{64}$/),
    captionItemId: z.string().min(1).max(191),
    cursor: z.string().max(160).optional(),
  })
  .strict();
const byteLength = (value: unknown) =>
  new TextEncoder().encode(JSON.stringify(value)).length;
/** Current editable display text, not source evidence or manufactured word timing. */
export async function readNativeCaptionTrack(
  request: NativeAgentRequest,
  raw: unknown,
) {
  const query = schema.parse(raw),
    document = parseVideoProjectDocument(request.document);
  if (
    query.snapshotHash !== request.baseHash ||
    (await hashVideoProjectDocument(document)) !== request.baseHash
  )
    throw new Error("Caption-track snapshot is stale.");
  const item = document.items.find((item) => item.id === query.captionItemId);
  if (!item?.caption) throw new Error("Choose an existing caption track.");
  const scope = request.authoring?.scope ?? { kind: "project" as const },
    readable = nativeScopeItemIds(document, scope),
    sources = nativeTranscriptScopedSourceItemIds({ ...request, document });
  if (
    scope.kind !== "project" &&
    !readable.includes(item.id) &&
    !(
      item.caption.sourceItemId && sources?.includes(item.caption.sourceItemId)
    ) &&
    !(item.caption.pairedItemId && readable.includes(item.caption.pairedItemId))
  )
    throw new Error("This caption track is outside the requested read scope.");
  const source = document.items.find(
      (source) => source.id === item.caption!.sourceItemId,
    ),
    sourceId = source?.node.assetId;
  const metadata = {
    captionItemId: item.id,
    trackId: item.trackId,
    language: item.caption.language,
    role: item.caption.role,
    pairedItemId: item.caption.pairedItemId,
    sourceItemId: item.caption.sourceItemId,
    ...(sourceId
      ? {
          sourceAssetId: sourceId,
          sourceRevision: document.sources[sourceId]?.revision,
        }
      : {}),
    clock: {
      fromFrame: item.node.from ?? 0,
      durationInFrames: item.node.duration,
      fps: document.format.fps,
    },
    style: Object.fromEntries(
      Object.entries(item.node.style ?? {}).filter(([key]) =>
        [
          "left",
          "top",
          "width",
          "height",
          "fontSize",
          "minFontSize",
          "fontFamily",
          "maxLines",
          "textFit",
          "lineHeight",
          "textAlign",
          "color",
          "backgroundColor",
        ].includes(key),
      ),
    ),
  };
  const binding = {
    snapshotHash: request.baseHash,
    scope,
    grouping: "current-display-v1",
    metadata,
    cuesHash: await completionHash(item.caption.cues),
  };
  let offset = 0;
  if (query.cursor) {
    const found = /^display-cues-v1:(\d+):(sha256:[a-f0-9]{64})$/.exec(
      query.cursor,
    );
    if (
      !found ||
      !Number.isSafeInteger(Number(found[1])) ||
      Number(found[1]) < 1 ||
      Number(found[1]) >= item.caption.cues.length ||
      found[2] !== (await completionHash({ binding, offset: Number(found[1]) }))
    )
      throw new Error(
        "Caption-track cursor is invalid or belongs to another snapshot/track/scope.",
      );
    offset = Number(found[1]);
  }
  const cues: Array<{
    cueId: string;
    text: string;
    startMs: number;
    endMs: number;
  }> = [];
  const packet = () => ({
    version: 1 as const,
    kind: "caption-track" as const,
    grouping: "current-display-v1" as const,
    authority: "display-only" as const,
    snapshotHash: request.baseHash,
    track: metadata,
    cues,
    coverage: {
      total: item.caption!.cues.length,
      offset,
      returned: cues.length,
      complete: false,
      nextCursor: null as string | null,
      reason: undefined as string | undefined,
    },
  });
  for (const cue of item.caption.cues.slice(offset, offset + 100)) {
    cues.push({
      cueId: cue.id,
      text: cue.text,
      startMs: cue.startMs,
      endMs: cue.endMs,
    });
    if (byteLength(packet()) > 23500) {
      cues.pop();
      break;
    }
  }
  const result = packet(),
    next = offset + cues.length;
  result.coverage.complete = next === item.caption.cues.length;
  if (next < item.caption.cues.length && cues.length)
    result.coverage.nextCursor = `display-cues-v1:${next}:${await completionHash({ binding, offset: next })}`;
  if (next < item.caption.cues.length && !cues.length)
    result.coverage.reason = "entry_exceeds_page_budget";
  if (byteLength(result) > 24000)
    throw new Error("The caption-track page exceeded its UTF-8 byte bound.");
  return result;
}
