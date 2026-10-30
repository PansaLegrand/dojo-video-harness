/** Portable, dependency-free helpers shared with the independently deployed worker.
 * Callers must validate the immutable native snapshot before invoking these helpers.
 */
export const NATIVE_TRANSCRIPT_SEARCH_VERSION = 1;
export const NATIVE_TRANSCRIPT_SEARCH_LIMITS = {
  pageMatches: 8,
  pageBytes: 16_000,
  calls: 4,
  totalBytes: 64_000,
  queryChars: 160,
  matchWords: 100,
} as const;
type Word = { id: string; text: string; startMs: number; endMs: number };
type Item = {
  id: string;
  name: string;
  caption?: { sourceItemId?: string };
  visualizerSourceItemId?: string;
  node: {
    type: string;
    assetId?: string;
    from?: number;
    duration?: number;
    videoStartTime?: number;
    audioStartTime?: number;
    playbackRate?: number;
    loop?: boolean;
    videoEndBehavior?: string;
  };
};
export type NativeTranscriptSnapshot = {
  baseHash: string;
  instruction?: string;
  context: { selectedItemIds: string[] };
  authoring?: {
    scope?:
      | { kind: "project" }
      | { kind: "selection"; itemIds: string[] }
      | { kind: "range"; fromFrame: number; durationInFrames: number };
  };
  document: {
    format: { fps: number };
    items: Item[];
    assets: Record<string, { name: string }>;
    sources: Record<string, { revision: string }>;
    evidence: Record<
      string,
      {
        id: string;
        sourceAssetId: string;
        sourceRevision: string;
        transcriptHash: string;
        words: Word[];
      }
    >;
    bindings?: Record<string, { itemId: string; sourceItemId: string }>;
  };
};
export type NativeTranscriptSearchQuery = {
  snapshotHash: string;
  query: string;
  sourceItemIds?: string[];
  cursor?: string;
};
export type NativeTranscriptMatch = {
  sourceItemId: string;
  evidenceId: string;
  sourceAssetId: string;
  sourceRevision: string;
  transcriptHash: string;
  wordIds: string[];
  text: string;
  startMs: number;
  endMs: number;
};
export type NativeTranscriptSearchPage = {
  version: 1;
  snapshotHash: string;
  query: string;
  matches: NativeTranscriptMatch[];
  coverage: {
    totalMatches: number;
    returnedMatches: number;
    offset: number;
    totalSources: number;
    unavailableSources: number;
    complete: boolean;
    nextCursor: string | null;
    reason?: string;
  };
};
const object = (value: unknown): Record<string, unknown> | null =>
  value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
const normalize = (value: string) => value.normalize("NFKC").toLowerCase();
const compact = (value: string) =>
  normalize(value).replace(/[^\p{L}\p{N}]/gu, "");
const lexicalWords = (value: string) =>
  [...normalize(value).matchAll(/[\p{L}\p{N}]+(?:['’][\p{L}\p{N}]+)*/gu)].map(
    (match) => compact(match[0]),
  );
const isUnspacedCjk = (value: string) =>
  /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}]/u.test(value) &&
  /^[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{N}]+$/u.test(value);
const bytes = (value: unknown) =>
  new TextEncoder().encode(JSON.stringify(value)).byteLength;
const hashPattern = /^sha256:[a-f0-9]{64}$/;
const quotePattern = /["“「『«]([^"”」』»]+)["”」』»]/gu;
const withoutQuotes = (value: string) =>
  value.replace(/["“「『«][^"”」』»]*["”」』»]/gu, " ");

export function nativeTranscriptQuotedPhrases(instruction: string): string[] {
  return [
    ...new Set(
      [...instruction.matchAll(quotePattern)]
        .map((match) => match[1]!.trim())
        .filter((value) => compact(value)),
    ),
  ].slice(0, 4);
}

export function nativeTranscriptWholeRemovalQueries(
  instruction: string,
): string[] {
  const outsideQuotes = withoutQuotes(instruction);
  const all =
    /\b(all|every|each|tous|toutes|chaque|todos|todas|cada|alle|jede\w*|tutti|tutte|ogni|todas|todos|cada)\b|所有|全部|每个|每次|すべて|全て|毎回|모든|전부/iu;
  const remove =
    /\b(remov\w*|delet\w*|cut|supprim\w*|enlev\w*|retir\w*|elimin\w*|borr\w*|quit\w*|entfern\w*|l[oö]sch\w*|rimuov\w*|togli\w*|cancell\w*|remov\w*|apagu\w*)\b|删除|删掉|去掉|去除|移除|取り除|削除|消して|제거|삭제|지워/iu;
  // A repeated label/title is a visual edit, not a request to cut spoken words.
  const visual =
    /\b(titles?|headings?|overlays?|graphics?|stickers?|labels?|captions?|subtitles?|titres?|t[ií]tulos?|untertitel|sottotitoli|legendas?)\b|标题|標題|贴纸|貼紙|字幕|タイトル|見出し|제목|자막/iu;
  const speech =
    /\b(spoken|speech|says?|said|speaks?|fillers?|utterances?|prononc\w*|parol\w*|gesproch\w*)\b|说到|说出|口播|口癖|発言|話した|말한|발화/iu;
  if (visual.test(outsideQuotes) && !speech.test(outsideQuotes)) return [];
  return all.test(outsideQuotes) && remove.test(outsideQuotes)
    ? nativeTranscriptQuotedPhrases(instruction)
    : [];
}

function qualifiedRemovalScope(snapshot: NativeTranscriptSnapshot): boolean {
  const instruction = snapshot.instruction ?? "";
  const outsideQuotes = withoutQuotes(instruction);
  const quotes = separatedQuotes(snapshot);
  if (quotes.ambiguous || quotes.phrases.length > 4 || !quotes.phrases.length)
    return true;
  return (
    (nativeTranscriptQuotedPhrases(instruction).length > 1 &&
      /\b(add|insert|create|ajout\w*|a[nñ]ad\w*|aggiung\w*|adicion\w*)\b|添加|追加|추가/iu.test(
        outsideQuotes,
      )) ||
    /\b(don['’]t|do\s+not|never|not|no|only|just|first|last|keep|leave|before|after|between|until|unless|during|when|where|pas|seulement|uniquement|gard\w*|premi[eè]r\w*|derni[eè]r\w*|avant|apr[eè]s|solo|s[oó]lo|[uú]nicamente|primer\w*|[uú]ltim\w*|antes|despu[eé]s|nicht|kein\w*|nur|erst\w*|letzt\w*|behalt\w*|vor|nach|non|soltanto|mantien\w*|prim\w*|ultim\w*|dopo|n[aã]o|apenas|manten\w*|depois)\b|不要|别|不删|不删除|只|仅|保留|之前|之后|以外|ない|しない|だけ|最初|最後|残して|하지|말고|않|만\s|첫|마지막|유지/iu.test(
      outsideQuotes,
    ) ||
    /\b(except|excluding|apart\s+from|sauf|except[eé]|excepto|salvo|au[sß]er|ausgenommen|tranne|eccetto|exceto|menos)\b|除了|除外|제외/iu.test(
      outsideQuotes,
    ) ||
    /\b\d+(?:[.,]\d+)?\s*(seconds?|secs?|minutes?|mins?|secondes?|secondi|secondo|segundos?|minuti|minuten|sekunden|s|m)\b|\b\d+:\d{2}\b|\d+\s*(秒|分钟|分鐘|分|초)|\b(first|last|premi[eè]re?|derni[eè]re?|primer\w*|[uú]ltim\w*|erst\w*|letzt\w*|prim\w*|ultim\w*)\s+(minute|second|segundo|minuto|sekunde)/iu.test(
      outsideQuotes,
    )
  );
}

function mentions(text: string, value: string): boolean {
  const needle = normalize(value.trim());
  if (needle.length < 2) return false;
  let at = text.indexOf(needle);
  while (at >= 0) {
    if (
      /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}]/u.test(needle) ||
      (!/[\p{L}\p{N}_-]/u.test(text[at - 1] ?? "") &&
        !/[\p{L}\p{N}_-]/u.test(text[at + needle.length] ?? ""))
    )
      return true;
    at = text.indexOf(needle, at + 1);
  }
  return false;
}

function separatedQuotes(snapshot: NativeTranscriptSnapshot): {
  phrases: string[];
  sourceItemIds: string[];
  ambiguous: boolean;
} {
  const instruction = snapshot.instruction ?? "";
  const phrases = new Set<string>(),
    sourceItemIds = new Set<string>();
  let ambiguous = false;
  const media = snapshot.document.items.filter((item) =>
    ["video", "audio"].includes(item.node.type),
  );
  for (const quote of instruction.matchAll(quotePattern)) {
    const value = quote[1]!.trim();
    if (!compact(value)) continue;
    const targets = media.filter((item) =>
      [
        item.id,
        item.name,
        snapshot.document.assets[item.node.assetId!]?.name,
      ].some((name) => name && normalize(name.trim()) === normalize(value)),
    );
    if (!targets.length) {
      if (value.length > NATIVE_TRANSCRIPT_SEARCH_LIMITS.queryChars)
        ambiguous = true;
      else phrases.add(value);
      continue;
    }
    const prefix = instruction.slice(
      Math.max(0, quote.index! - 50),
      quote.index!,
    );
    const suffix = instruction.slice(
      quote.index! + quote[0].length,
      quote.index! + quote[0].length + 8,
    );
    const sourceRole =
      /(?:\b(?:from|in|within|dans|de|en|aus|von|im|nel|da|do|no|na|em)\s+(?:(?:source|clip|video|audio)\s+)?|[从在於]\s*)$/iu.test(
        prefix,
      ) || /^(?:の|에서)/u.test(suffix);
    if (!sourceRole || targets.length !== 1) {
      ambiguous = true;
      continue;
    }
    sourceItemIds.add(targets[0]!.id);
  }
  return {
    phrases: [...phrases],
    sourceItemIds: [...sourceItemIds],
    ambiguous,
  };
}

function wholeRemovalQueries(snapshot: NativeTranscriptSnapshot): string[] {
  return nativeTranscriptWholeRemovalQueries(snapshot.instruction ?? "").length
    ? separatedQuotes(snapshot).phrases.slice(0, 4)
    : [];
}

/** null means legacy selection semantics; [] is an explicitly empty scoped source set. */
export function nativeTranscriptScopedSourceItemIds(
  snapshot: NativeTranscriptSnapshot,
): string[] | null {
  const scope = snapshot.authoring?.scope;
  if (!scope) return null;
  const media = snapshot.document.items.filter((item) =>
    ["video", "audio"].includes(item.node.type),
  );
  if (scope.kind === "project") return media.map((item) => item.id);
  const selected = new Set(
    scope.kind === "selection"
      ? scope.itemIds
      : snapshot.document.items
          .filter(
            (item) =>
              (item.node.from ?? 0) >= scope.fromFrame &&
              (item.node.from ?? 0) + item.node.duration! <=
                scope.fromFrame + scope.durationInFrames,
          )
          .map((item) => item.id),
  );
  // Source parents are readable evidence for an owned caption/visualizer/anchor;
  // this does not grant write permission to those parents.
  for (const item of snapshot.document.items.filter((item) =>
    selected.has(item.id),
  )) {
    if (item.caption?.sourceItemId) selected.add(item.caption.sourceItemId);
    if (item.visualizerSourceItemId) selected.add(item.visualizerSourceItemId);
    for (const binding of Object.values(snapshot.document.bindings ?? {}))
      if (binding.itemId === item.id) selected.add(binding.sourceItemId);
  }
  return media.filter((item) => selected.has(item.id)).map((item) => item.id);
}

function sourceItems(
  snapshot: NativeTranscriptSnapshot,
  explicit?: string[],
): Item[] {
  const media = snapshot.document.items.filter((item) =>
    ["video", "audio"].includes(item.node.type),
  );
  const scopedIds = nativeTranscriptScopedSourceItemIds(snapshot),
    bounded = scopedIds !== null;
  const available = bounded
    ? media.filter((item) => scopedIds.includes(item.id))
    : media;
  if (explicit?.length) {
    if (explicit.some((id) => !media.some((item) => item.id === id)))
      throw new Error("Transcript search requires existing source item IDs.");
    if (bounded && explicit.some((id) => !scopedIds.includes(id)))
      throw new Error(
        "This speech source is outside the requested edit scope. Select it or broaden the scope first.",
      );
    return available.filter((item) => explicit.includes(item.id));
  }
  const quoted = separatedQuotes(snapshot);
  if (quoted.sourceItemIds.length) {
    if (bounded && quoted.sourceItemIds.some((id) => !scopedIds.includes(id)))
      throw new Error(
        "A named speech source is outside the requested edit scope.",
      );
    return available.filter((item) => quoted.sourceItemIds.includes(item.id));
  }
  const instruction = normalize(withoutQuotes(snapshot.instruction ?? ""));
  const named = media.filter(
    (item) =>
      mentions(instruction, item.id) ||
      mentions(instruction, item.name) ||
      mentions(
        instruction,
        snapshot.document.assets[item.node.assetId!]?.name ?? "",
      ),
  );
  if (named.length) {
    if (bounded && named.some((item) => !scopedIds.includes(item.id)))
      throw new Error(
        "A named speech source is outside the requested edit scope.",
      );
    return named;
  }
  if (bounded) return available;
  const selected = new Set(snapshot.context.selectedItemIds);
  for (const item of snapshot.document.items)
    if (selected.has(item.id)) {
      if (item.caption?.sourceItemId) selected.add(item.caption.sourceItemId);
      if (item.visualizerSourceItemId)
        selected.add(item.visualizerSourceItemId);
    }
  return selected.size ? media.filter((item) => selected.has(item.id)) : media;
}

function queryInput(value: unknown): NativeTranscriptSearchQuery {
  const input = object(value);
  if (
    !input ||
    Object.keys(input).some(
      (key) =>
        !["snapshotHash", "query", "sourceItemIds", "cursor"].includes(key),
    ) ||
    typeof input.snapshotHash !== "string" ||
    !hashPattern.test(input.snapshotHash) ||
    typeof input.query !== "string" ||
    !compact(input.query) ||
    input.query.length > NATIVE_TRANSCRIPT_SEARCH_LIMITS.queryChars ||
    (input.sourceItemIds !== undefined &&
      (!Array.isArray(input.sourceItemIds) ||
        input.sourceItemIds.length > 24 ||
        input.sourceItemIds.some(
          (id) => typeof id !== "string" || !id.length || id.length > 191,
        ))) ||
    (input.cursor !== undefined &&
      (typeof input.cursor !== "string" || input.cursor.length > 100))
  )
    throw new Error("Invalid bounded transcript search request.");
  return input as NativeTranscriptSearchQuery;
}

/** Scans the complete immutable source, while retaining only the requested page. */
export function scanNativeTranscript(
  snapshot: NativeTranscriptSnapshot,
  query: string,
  sourceItemIds?: string[],
  offset = 0,
  limit: number = NATIVE_TRANSCRIPT_SEARCH_LIMITS.pageMatches,
): {
  matches: NativeTranscriptMatch[];
  totalMatches: number;
  totalSources: number;
  unavailableSources: number;
  evidenceIdentity: string[];
} {
  const matches: NativeTranscriptMatch[] = [];
  const items = sourceItems(snapshot, sourceItemIds).sort((a, b) =>
    a.id.localeCompare(b.id, "en"),
  );
  const needle = compact(query);
  const queryWords = lexicalWords(query);
  const unspacedCjk = isUnspacedCjk(needle);
  if (!needle) throw new Error("Transcript search needs a word or phrase.");
  let totalMatches = 0,
    unavailableSources = 0;
  const evidenceIdentity: string[] = [];
  const sourceEvidence = new Map<
    string,
    (typeof snapshot.document.evidence)[string][]
  >();
  // Cut clips often share one long transcript. Keep only source-word index
  // pairs for this query/invocation; clocks, overlaps and output stay per clip.
  const evidenceMatches = new Map<
    (typeof snapshot.document.evidence)[string],
    Array<readonly [number, number]>
  >();
  for (const evidence of Object.values(snapshot.document.evidence)) {
    const entries = sourceEvidence.get(evidence.sourceAssetId) ?? [];
    entries.push(evidence);
    sourceEvidence.set(evidence.sourceAssetId, entries);
  }
  for (const item of items) {
    const assetId = item.node.assetId!;
    const candidates = sourceEvidence.get(assetId) ?? [];
    // Multiple transcripts need an explicit source/evidence decision; do not silently choose one.
    if (
      candidates.length !== 1 ||
      candidates[0]!.sourceRevision !==
        snapshot.document.sources[assetId]?.revision ||
      (item.node.playbackRate ?? 1) <= 0 ||
      item.node.loop ||
      item.node.videoEndBehavior === "loop"
    ) {
      unavailableSources++;
      continue;
    }
    const evidence = candidates[0]!;
    evidenceIdentity.push(
      `${item.id}:${evidence.id}:${evidence.sourceRevision}:${evidence.transcriptHash}`,
    );
    const rate = item.node.type === "video" ? (item.node.playbackRate ?? 1) : 1;
    const startMs =
      (item.node.type === "video"
        ? (item.node.videoStartTime ?? 0)
        : (item.node.audioStartTime ?? 0)) * 1000;
    const endMs =
      startMs +
      ((item.node.duration! * 1000) / snapshot.document.format.fps) * rate;
    let indexed = evidenceMatches.get(evidence);
    if (!indexed) {
      indexed = [];
      const starts = new Map<number, number>(),
        ends = new Map<number, number>();
      let text = "";
      evidence.words.forEach((word, index) => {
        const value = compact(word.text);
        if (value) {
          starts.set(text.length, index);
          text += value;
          ends.set(text.length, index);
        }
      });
      let at = text.indexOf(needle);
      while (at >= 0) {
        const first = starts.get(at),
          last = ends.get(at + needle.length);
        const lexicalMatch =
          first !== undefined &&
          last !== undefined &&
          (unspacedCjk ||
            JSON.stringify(
              evidence.words
                .slice(first, last + 1)
                .flatMap((word) => lexicalWords(word.text)),
            ) === JSON.stringify(queryWords));
        if (first !== undefined && last !== undefined && lexicalMatch)
          indexed.push([first, last]);
        at = text.indexOf(needle, at + 1);
      }
      evidenceMatches.set(evidence, indexed);
    }
    let previousEnd = -1,
      overlapping = false;
    for (const [first, last] of indexed) {
      if (
        evidence.words[first]!.startMs >= startMs &&
        evidence.words[last]!.endMs <= endMs
      ) {
        if (first <= previousEnd) overlapping = true;
        previousEnd = last;
        const index = totalMatches++;
        if (index >= offset && matches.length < limit) {
          const words = evidence.words.slice(first, last + 1);
          matches.push({
            sourceItemId: item.id,
            evidenceId: evidence.id,
            sourceAssetId: assetId,
            sourceRevision: evidence.sourceRevision,
            transcriptHash: evidence.transcriptHash,
            wordIds: words.map((word) => word.id),
            text: words.map((word) => word.text).join(" "),
            startMs: words[0]!.startMs,
            endMs: words.at(-1)!.endMs,
          });
        }
      }
    }
    if (overlapping) unavailableSources++;
  }
  return {
    matches,
    totalMatches,
    totalSources: items.length,
    unavailableSources,
    evidenceIdentity,
  };
}

async function fingerprint(value: unknown): Promise<string> {
  return [
    ...new Uint8Array(
      await globalThis.crypto.subtle.digest(
        "SHA-256",
        new TextEncoder().encode(JSON.stringify(value)),
      ),
    ),
  ]
    .map((value) => value.toString(16).padStart(2, "0"))
    .join("");
}

export async function searchNativeTranscript(
  snapshot: NativeTranscriptSnapshot,
  value: unknown,
): Promise<NativeTranscriptSearchPage> {
  const input = queryInput(value);
  if (input.snapshotHash !== snapshot.baseHash)
    throw new Error("Transcript search snapshot hash mismatch.");
  const parsedCursor = input.cursor?.match(/^v1:(\d{1,8}):([a-f0-9]{64})$/);
  if (input.cursor && !parsedCursor)
    throw new Error("Invalid transcript search cursor.");
  const offset = parsedCursor ? Number(parsedCursor[1]) : 0;
  const found = scanNativeTranscript(
    snapshot,
    input.query,
    input.sourceItemIds,
    offset,
  );
  const queryIdentity = isUnspacedCjk(compact(input.query))
    ? ["cjk", compact(input.query)]
    : ["words", lexicalWords(input.query)];
  const identity: unknown[] = [
    snapshot.baseHash,
    queryIdentity,
    [...(input.sourceItemIds ?? [])].sort(),
    found.evidenceIdentity,
  ];
  if (snapshot.authoring?.scope) identity.push(snapshot.authoring.scope);
  const token = await fingerprint(identity);
  if (
    parsedCursor &&
    (parsedCursor[2] !== token || offset > found.totalMatches)
  )
    throw new Error(
      "Transcript search cursor belongs to another snapshot, source or query.",
    );
  const page: NativeTranscriptSearchPage = {
    version: 1,
    snapshotHash: snapshot.baseHash,
    query: input.query,
    matches: [],
    coverage: {
      totalMatches: found.totalMatches,
      returnedMatches: 0,
      offset,
      totalSources: found.totalSources,
      unavailableSources: found.unavailableSources,
      complete: false,
      nextCursor: null,
    },
  };
  for (const match of found.matches) {
    if (
      match.wordIds.length > NATIVE_TRANSCRIPT_SEARCH_LIMITS.matchWords ||
      bytes({ ...page, matches: [...page.matches, match] }) >
        NATIVE_TRANSCRIPT_SEARCH_LIMITS.pageBytes - 512
    )
      break;
    page.matches.push(match);
  }
  const next = offset + page.matches.length;
  page.coverage.returnedMatches = page.matches.length;
  page.coverage.complete =
    next === found.totalMatches &&
    found.unavailableSources === 0 &&
    found.totalSources > 0;
  if (next < found.totalMatches && page.matches.length)
    page.coverage.nextCursor = `v1:${next}:${token}`;
  if (
    nativeTranscriptWholeRemovalQueries(snapshot.instruction ?? "").length &&
    qualifiedRemovalScope(snapshot)
  ) {
    page.coverage.complete = false;
    page.coverage.reason =
      "The request has a qualified or ambiguous removal scope. Clarify the source, exception or time window before removing matches; never broaden it.";
  } else if (found.unavailableSources)
    page.coverage.reason =
      "Some sources lack one current transcript, use reverse/loop playback or have overlapping matches; ask for a narrower supported source selection.";
  else if (!found.totalSources)
    page.coverage.reason = "Select a source video or audio item.";
  else if (next < found.totalMatches && !page.matches.length)
    page.coverage.reason =
      "A match exceeds the bounded tool result; ask for a shorter phrase.";
  return page;
}

/** Initial context describes every occurrence count, even when excerpt words are omitted. */
export function nativeTranscriptSearchOverview(
  snapshot: NativeTranscriptSnapshot,
): Array<{
  query: string;
  totalMatches: number;
  totalSources: number;
  unavailableSources: number;
  matches: NativeTranscriptMatch[];
  complete: boolean;
  requiresCompleteRemoval: boolean;
  scopeNeedsClarification: boolean;
}> {
  return separatedQuotes(snapshot)
    .phrases.slice(0, 4)
    .map((query) => {
      const found = scanNativeTranscript(snapshot, query);
      const matches: NativeTranscriptMatch[] = [];
      for (const match of found.matches) {
        if (
          match.wordIds.length > NATIVE_TRANSCRIPT_SEARCH_LIMITS.matchWords ||
          bytes([...matches, match]) >
            NATIVE_TRANSCRIPT_SEARCH_LIMITS.pageBytes - 1024
        )
          break;
        matches.push(match);
      }
      const scopeNeedsClarification =
        nativeTranscriptWholeRemovalQueries(snapshot.instruction ?? "").length >
          0 && qualifiedRemovalScope(snapshot);
      return {
        query,
        totalMatches: found.totalMatches,
        totalSources: found.totalSources,
        unavailableSources: found.unavailableSources,
        matches,
        scopeNeedsClarification,
        complete:
          !scopeNeedsClarification &&
          matches.length === found.totalMatches &&
          found.unavailableSources === 0 &&
          found.totalSources > 0,
        requiresCompleteRemoval:
          !scopeNeedsClarification &&
          wholeRemovalQueries(snapshot).includes(query),
      };
    });
}

/** Whole-phrase removal must cover every real occurrence, with no extra words. */
export function assertNativeTranscriptCoverage(
  snapshot: NativeTranscriptSnapshot,
  output: unknown,
): void {
  const result = object(output);
  if (
    !result ||
    (result.outcome !== undefined && result.outcome !== "proposal")
  )
    return;
  if (!nativeTranscriptWholeRemovalQueries(snapshot.instruction ?? "").length)
    return;
  if (qualifiedRemovalScope(snapshot))
    throw new Error(
      "The phrase-removal scope is qualified or ambiguous. Use needs_input with no commands to clarify the source, exception or time window; do not broaden the removal.",
    );
  const queries = wholeRemovalQueries(snapshot);
  const commands = Array.isArray(result.commands)
    ? result.commands.map(object)
    : [];
  const expected = new Set<string>();
  for (const query of queries) {
    const found = scanNativeTranscript(snapshot, query, undefined, 0, 101);
    if (
      !found.totalSources ||
      found.unavailableSources ||
      found.totalMatches > 100
    )
      throw new Error(
        "Complete transcript coverage is unavailable within this edit budget. Use needs_input with no commands to narrow the source or phrase.",
      );
    for (const match of found.matches)
      expected.add(
        JSON.stringify([match.sourceItemId, match.evidenceId, match.wordIds]),
      );
  }
  if (expected.size > 100)
    throw new Error(
      "Complete phrase removal exceeds the operation budget. Use needs_input with no commands to narrow the request.",
    );
  const actual = new Set<string>();
  for (const command of commands) {
    if (command?.type === "cutSpeech") {
      if (command.mode !== "remove")
        throw new Error(
          "All-occurrence removal requires cutSpeech remove, or needs_input with no commands.",
        );
      actual.add(
        JSON.stringify([
          command.sourceItemId,
          command.evidenceId,
          command.wordIds,
        ]),
      );
    } else if (
      ["trimItem", "splitItem", "removeItem", "removeTimelineRange"].includes(
        String(command?.type),
      ) ||
      (command?.type === "set" &&
        Array.isArray(command.path) &&
        ["from", "duration", "videoStartTime", "audioStartTime"].includes(
          String(command.path[0]),
        ))
    )
      throw new Error(
        "Complete phrase removal must use the exact retrieved source words through cutSpeech.",
      );
  }
  if (
    expected.size !== actual.size ||
    [...expected].some((match) => !actual.has(match))
  )
    throw new Error(
      "Incomplete transcript removal: retrieve every match and remove each exact source-word range, or use needs_input with no commands. Apply cuts in descending source time.",
    );
}

export function parseNativeTranscriptRetrieval(
  value: unknown,
): NativeTranscriptSearchQuery | null {
  const result = object(value);
  if (result?.outcome !== "retrieve_context") return null;
  if (
    Object.keys(result).some(
      (key) => !["summary", "outcome", "commands", "retrieval"].includes(key),
    ) ||
    typeof result.summary !== "string" ||
    result.summary.length > 4000 ||
    !Array.isArray(result.commands) ||
    result.commands.length
  )
    throw new Error("Retrieval turns cannot contain editing commands.");
  return queryInput(result.retrieval);
}
