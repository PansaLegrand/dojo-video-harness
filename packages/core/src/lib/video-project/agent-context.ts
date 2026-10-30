import type { SceneNodeInput } from "@motionforge/schema";
import type { EditorItem } from "@/lib/editor/document";
import type { VideoProjectAgentContext } from "./agent-types";
import type { VideoProjectDocument, VideoTranscriptEvidence } from "./document";
import { sourceWindow } from "./source-clock";
import { requiresTranscript } from "./semantic";
import {
  nativeTranscriptSearchOverview,
  type NativeTranscriptSnapshot,
} from "./agent-transcript-search";

export const NATIVE_AGENT_CONTEXT_MAX_CHARS = 180_000;
const MAX_ITEMS = 48;
const MAX_INDEX_ITEMS = 300;
const MAX_EVIDENCE_SOURCES = 6;
const MAX_WORDS_PER_SOURCE = 600;
const WORD_RADIUS = 64;

type ItemSummary = {
  id: string;
  name: string;
  trackId: string;
  type: string;
  from: number;
  duration: number;
  nodeCount: number;
  text?: string;
  detailIncluded: boolean;
};
type WordWindow = {
  firstWordId: string;
  lastWordId: string;
  startIndex: number;
  endIndex: number;
  startMs: number;
  endMs: number;
};
type SourceClock = {
  itemId: string;
  sourceAssetId: string;
  sourceTimeMs: number;
  startMs: number;
  endMs: number;
};
type PromptDocument = Pick<
  VideoProjectDocument,
  | "kind"
  | "version"
  | "format"
  | "tracks"
  | "items"
  | "assets"
  | "sources"
  | "evidence"
  | "bindings"
  | "creativeContext"
  | "audioBuses"
  | "markers"
  | "transitions"
  | "linkedGroups"
>;

export type NativeAgentContextPlan = {
  document: PromptDocument;
  itemIndex: ItemSummary[];
  assetIndex: Array<{ id: string; name: string; type: string }>;
  focusedNodes: Array<{
    itemId: string;
    ancestors: string[];
    node: SceneNodeInput;
  }>;
  sourceClocks: SourceClock[];
  evidenceWindows: Record<
    string,
    { totalWords: number; omittedWords: number; windows: WordWindow[] }
  >;
  transcriptSearch: ReturnType<typeof nativeTranscriptSearchOverview>;
  omitted: {
    items: number;
    itemIndex: number;
    assets: number;
    evidence: number;
    decisions: number;
    references: number;
    bindings: number;
    focusedNodes: number;
    transitions: number;
    linkedGroups: number;
  };
};

function normalized(value: string): string {
  return value.normalize("NFKC").toLowerCase();
}

function mentions(instruction: string, value: string): boolean {
  const needle = normalized(value.trim());
  if (needle.length < 2) return false;
  let at = instruction.indexOf(needle);
  while (at >= 0) {
    const before = instruction[at - 1] ?? "";
    const after = instruction[at + needle.length] ?? "";
    // IDs/names must not match a prefix such as item-1 inside item-149.
    if (
      (!before || !/[\p{L}\p{N}_-]/u.test(before)) &&
      (!after || !/[\p{L}\p{N}_-]/u.test(after))
    )
      return true;
    // CJK phrases generally have no whitespace word boundaries.
    if (/[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}]/u.test(needle))
      return true;
    at = instruction.indexOf(needle, at + 1);
  }
  return false;
}

function nodesOf(item: EditorItem) {
  const result: Array<{ node: SceneNodeInput; ancestors: string[] }> = [];
  const visit = (node: SceneNodeInput, ancestors: string[]) => {
    result.push({ node, ancestors });
    for (const child of node.children ?? [])
      visit(child, [...ancestors, node.id]);
  };
  visit(item.node, []);
  return result;
}

function textOf(node: SceneNodeInput): string {
  return node.text ?? node.runs?.map((run) => run.text).join("") ?? "";
}

function distanceFromFrame(item: EditorItem, frame: number): number {
  const from = item.node.from ?? 0,
    end = from + item.node.duration!;
  return frame < from ? from - frame : frame >= end ? frame - end + 1 : 0;
}

const SEARCH_STOP_WORDS = new Set([
  "the",
  "and",
  "with",
  "this",
  "that",
  "from",
  "into",
  "please",
  "make",
  "change",
  "video",
  "audio",
  "clip",
  "title",
  "text",
  "remove",
  "keep",
  "cut",
  "phrase",
  "around",
  "playhead",
  "speech",
  "spoken",
  "when",
  "says",
  "said",
  "word",
  "words",
]);

function searchTerms(instruction: string) {
  const quotes = [
    ...instruction.matchAll(/["“「『]([^"”」』]{2,300})["”」』]/gu),
  ].map((match) => normalized(match[1]!));
  const tokens = [
    ...normalized(instruction).matchAll(/[\p{L}\p{N}][\p{L}\p{N}_-]{2,}/gu),
  ]
    .map((match) => match[0])
    .filter((token) => !SEARCH_STOP_WORDS.has(token));
  return {
    quotes: [...new Set(quotes)].slice(0, 4),
    tokens: [...new Set(tokens)].slice(0, 24),
  };
}

function searchWordPositions(
  evidence: VideoTranscriptEvidence,
  terms: ReturnType<typeof searchTerms>,
): number[] {
  const words = evidence.words;
  const found: number[] = [];
  // Concatenation also matches quoted CJK phrases split into several ASR words.
  if (terms.quotes.length) {
    const offsets: number[] = [];
    let compact = "";
    for (const word of words) {
      offsets.push(compact.length);
      compact += normalized(word.text).replace(/\s+/gu, "");
    }
    for (const quote of terms.quotes) {
      const needle = quote.replace(/\s+/gu, "");
      let at = compact.indexOf(needle),
        matches = 0;
      while (at >= 0 && matches++ < 3) {
        let low = 0,
          high = offsets.length;
        while (low < high) {
          const middle = (low + high) >>> 1;
          if (offsets[middle]! <= at) low = middle + 1;
          else high = middle;
        }
        found.push(Math.max(0, low - 1));
        at = compact.indexOf(needle, at + Math.max(1, needle.length));
      }
    }
  }
  if (found.length < 4 && terms.tokens.length) {
    for (let index = 0; index < words.length && found.length < 4; index++) {
      const text = normalized(words[index]!.text).replace(
        /^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu,
        "",
      );
      if (terms.tokens.includes(text)) found.push(index);
    }
  }
  return [...new Set(found)].slice(0, 4);
}

function wordAtTime(
  words: VideoTranscriptEvidence["words"],
  time: number,
): number {
  let low = 0,
    high = words.length;
  while (low < high) {
    const middle = (low + high) >>> 1;
    if (words[middle]!.startMs <= time) low = middle + 1;
    else high = middle;
  }
  return Math.max(0, Math.min(words.length - 1, low - 1));
}

function sourceClock(
  item: EditorItem,
  document: VideoProjectDocument,
  playhead: number,
): SourceClock | null {
  if (!item.node.assetId || !["audio", "video"].includes(item.node.type))
    return null;
  try {
    const window = sourceWindow(item, document.format.fps);
    let sourceTimeMs =
      window.startMs +
      (Math.max(0, Math.min(item.node.duration! - 1, playhead - window.from)) /
        document.format.fps) *
        1000 *
        window.rate;
    const durationMs =
      (document.assets[item.node.assetId]?.durationSeconds ?? 0) * 1000;
    if (item.node.type === "audio" && item.node.loop && durationMs > 0)
      sourceTimeMs %= durationMs;
    return {
      itemId: item.id,
      sourceAssetId: item.node.assetId,
      sourceTimeMs,
      startMs: window.startMs,
      endMs: window.endMs,
    };
  } catch {
    return null;
  } // Reverse playback has no trustworthy forward speech clock.
}

function evidenceExcerpt(
  evidence: VideoTranscriptEvidence,
  centers: number[],
  radius = WORD_RADIUS,
) {
  const chosen = new Set<number>();
  for (const center of centers) {
    const from = Math.max(0, center - radius),
      end = Math.min(evidence.words.length, center + radius + 1);
    for (
      let index = from;
      index < end && chosen.size < MAX_WORDS_PER_SOURCE;
      index++
    )
      chosen.add(index);
  }
  const indexes = [...chosen].sort((a, b) => a - b);
  const words = indexes.map((index) => evidence.words[index]!);
  const windows: WordWindow[] = [];
  for (let at = 0; at < indexes.length; ) {
    const startIndex = indexes[at]!,
      start = evidence.words[startIndex]!;
    let endIndex = startIndex;
    while (++at < indexes.length && indexes[at] === endIndex + 1)
      endIndex = indexes[at]!;
    const end = evidence.words[endIndex]!;
    windows.push({
      firstWordId: start.id,
      lastWordId: end.id,
      startIndex,
      endIndex,
      startMs: start.startMs,
      endMs: end.endMs,
    });
  }
  return {
    evidence: {
      ...evidence,
      text: evidence.words.length
        ? words.map((word) => word.text).join(" ")
        : evidence.text.slice(0, 6000),
      words,
    },
    window: {
      totalWords: evidence.words.length,
      omittedWords: evidence.words.length - words.length,
      windows,
    },
  };
}

/** A bounded, explicitly partial model view; never replaces the replay snapshot. */
export function planNativeAgentContext(
  input: {
    document: VideoProjectDocument;
    instruction: string;
    context: VideoProjectAgentContext;
    authoring?: NativeTranscriptSnapshot["authoring"];
  },
  options: { maxChars?: number } = {},
): NativeAgentContextPlan {
  const { document, context } = input;
  const maxChars = options.maxChars ?? NATIVE_AGENT_CONTEXT_MAX_CHARS;
  if (
    !Number.isInteger(maxChars) ||
    maxChars < 20_000 ||
    maxChars > NATIVE_AGENT_CONTEXT_MAX_CHARS
  )
    throw new Error("Unsupported native context budget.");
  const instruction = normalized(input.instruction);
  const terms = searchTerms(input.instruction);
  const speechRequest = requiresTranscript(input.instruction);
  const selected = new Set(context.selectedItemIds);
  const ranked = document.items.map((item, order) => {
    const nodes = nodesOf(item);
    const namedNodes = nodes.filter(
      ({ node }) =>
        mentions(instruction, node.id) ||
        terms.quotes.some((quote) => normalized(textOf(node)).includes(quote)),
    );
    const named =
      mentions(instruction, item.id) ||
      mentions(instruction, item.name) ||
      namedNodes.length > 0;
    const focused = nodes.some(
      ({ node }) => node.id === context.selectedNodeId,
    );
    const distance = distanceFromFrame(item, context.playheadFrame);
    return {
      item,
      nodes,
      namedNodes,
      order,
      distance,
      priority: named
        ? 1000
        : focused
          ? 950
          : selected.has(item.id)
            ? 900
            : distance === 0
              ? 200
              : 100,
    };
  });
  const priorityIds = new Set(
    ranked
      .filter((entry) => entry.priority >= 900)
      .map((entry) => entry.item.id),
  );
  for (const entry of ranked.filter((entry) =>
    priorityIds.has(entry.item.id),
  )) {
    for (const id of [
      entry.item.caption?.sourceItemId,
      entry.item.caption?.pairedItemId,
      entry.item.visualizerSourceItemId,
    ])
      if (id) priorityIds.add(id);
    for (const binding of Object.values(document.bindings))
      if (
        binding.itemId === entry.item.id ||
        binding.sourceItemId === entry.item.id
      ) {
        priorityIds.add(binding.itemId);
        priorityIds.add(binding.sourceItemId);
      }
  }
  for (const entry of ranked)
    if (priorityIds.has(entry.item.id) && entry.priority < 900)
      entry.priority = 800;
  ranked.sort(
    (a, b) =>
      b.priority - a.priority || a.distance - b.distance || a.order - b.order,
  );
  const plan: NativeAgentContextPlan = {
    document: {
      kind: document.kind,
      version: document.version,
      format: document.format,
      tracks: [],
      items: [],
      assets: {},
      sources: {},
      evidence: {},
      bindings: {},
      creativeContext: { decisions: [], references: [] },
    },
    itemIndex: [],
    assetIndex: [],
    focusedNodes: [],
    sourceClocks: [],
    evidenceWindows: {},
    transcriptSearch: [],
    omitted: {
      items: document.items.length,
      itemIndex: document.items.length,
      assets: Object.keys(document.assets).length,
      evidence: Object.keys(document.evidence).length,
      decisions: document.creativeContext.decisions.length,
      references: document.creativeContext.references.length,
      bindings: Object.keys(document.bindings).length,
      focusedNodes: 0,
      transitions: Object.keys(document.transitions ?? {}).length,
      linkedGroups: Object.keys(document.linkedGroups ?? {}).length,
    },
  };
  // Conservative accounting includes map keys/separators and final omission counts.
  let used = JSON.stringify(plan).length + 4096;
  let indexing = false;
  let itemChars = 0;
  const contentLimit = maxChars - Math.min(20_000, Math.floor(maxChars * 0.15));
  const include = (value: unknown, write: () => void) => {
    const cost = JSON.stringify(value).length + 512;
    if (used + cost > (indexing ? maxChars : contentLimit)) return false;
    used += cost;
    write();
    return true;
  };
  const detailed = new Set<string>();
  const attemptedDetails = new Set<string>();
  const addItem = (entry: (typeof ranked)[number]) => {
    if (detailed.size >= MAX_ITEMS || attemptedDetails.has(entry.item.id))
      return;
    attemptedDetails.add(entry.item.id);
    const size = JSON.stringify(entry.item).length;
    if (
      itemChars + size <= Math.min(70_000, maxChars * 0.4) &&
      include(entry.item, () => {
        plan.document.items.push(entry.item);
        detailed.add(entry.item.id);
        itemChars += size;
      })
    ) {
      for (const { node } of entry.nodes) {
        for (const assetId of [
          node.assetId,
          node.params?.audioAssetId,
          node.params?.coverAssetId,
        ])
          if (assetId) addAsset(assetId);
      }
    } else {
      const focus = entry.nodes.filter(
        ({ node }) =>
          node.id === context.selectedNodeId ||
          entry.namedNodes.some((named) => named.node.id === node.id),
      );
      for (const value of focus)
        if (
          !include({ itemId: entry.item.id, ...value }, () =>
            plan.focusedNodes.push({ itemId: entry.item.id, ...value }),
          )
        )
          plan.omitted.focusedNodes++;
    }
  };
  const addAsset = (id: string) => {
    if (plan.document.assets[id] || !document.assets[id]) return;
    include(
      { asset: document.assets[id], source: document.sources[id] },
      () => {
        plan.document.assets[id] = document.assets[id]!;
        if (document.sources[id])
          plan.document.sources[id] = document.sources[id]!;
      },
    );
  };
  for (const track of document.tracks)
    include(track, () => plan.document.tracks.push(track));
  for (const entry of ranked.filter((entry) => entry.priority >= 800))
    addItem(entry);
  for (const page of nativeTranscriptSearchOverview({
    document,
    instruction: input.instruction,
    context,
    authoring: input.authoring,
    baseHash: "",
  })) {
    if (!include(page, () => plan.transcriptSearch.push(page))) {
      const summary = { ...page, matches: [], complete: false };
      include(summary, () => plan.transcriptSearch.push(summary));
    }
  }
  const clocks = ranked
    .map((entry) => ({
      entry,
      clock: sourceClock(entry.item, document, context.playheadFrame),
    }))
    .filter((value) => value.clock !== null);
  const evidence = Object.values(document.evidence)
    .map((value) => {
      const matches = searchWordPositions(value, terms);
      const sources = clocks.filter(
        ({ clock, entry }) =>
          clock!.sourceAssetId === value.sourceAssetId &&
          (entry.priority >= 800 || speechRequest),
      );
      const namedSource =
        mentions(instruction, value.id) ||
        mentions(instruction, value.sourceAssetId) ||
        mentions(instruction, document.assets[value.sourceAssetId]?.name ?? "");
      const priority =
        Math.max(0, ...sources.map(({ entry }) => entry.priority)) +
        (matches.length ? 1100 : 0) +
        (namedSource ? 1000 : 0);
      return { value, matches, sources, priority };
    })
    .filter((entry) => entry.priority > 0)
    .sort(
      (a, b) =>
        b.priority - a.priority || a.value.id.localeCompare(b.value.id, "en"),
    );
  for (const entry of evidence.slice(0, MAX_EVIDENCE_SOURCES)) {
    const centers = [
      ...entry.matches,
      ...entry.sources
        .slice(0, 3)
        .map(({ clock }) => wordAtTime(entry.value.words, clock!.sourceTimeMs)),
    ];
    if (!centers.length && entry.value.words.length) centers.push(0);
    const accepted = [WORD_RADIUS, 16, 4, 0].some((radius) => {
      const excerpt = evidenceExcerpt(entry.value, centers, radius);
      return include(excerpt, () => {
        plan.document.evidence[entry.value.id] = excerpt.evidence;
        plan.evidenceWindows[entry.value.id] = excerpt.window;
      });
    });
    if (accepted) {
      addAsset(entry.value.sourceAssetId);
      for (const { clock } of entry.sources.slice(0, 3))
        if (!plan.sourceClocks.some((value) => value.itemId === clock!.itemId))
          include(clock, () => plan.sourceClocks.push(clock!));
    }
  }
  for (const kind of ["decisions", "references"] as const) {
    const entries = document.creativeContext[kind]
      .map((value, index) => ({
        value,
        index,
        relevant:
          value.entityIds.some((id) => priorityIds.has(id)) ||
          !value.entityIds.length,
      }))
      .sort(
        (a, b) => Number(b.relevant) - Number(a.relevant) || b.index - a.index,
      );
    for (const { value } of entries.slice(0, 20))
      include(value, () =>
        (plan.document.creativeContext[kind] as unknown[]).push(value),
      );
  }
  for (const entry of ranked) addItem(entry);
  for (const asset of Object.values(document.assets))
    if (
      mentions(instruction, asset.id) ||
      mentions(instruction, asset.name) ||
      asset.type === "font"
    )
      addAsset(asset.id);
  for (const binding of Object.values(document.bindings))
    if (detailed.has(binding.itemId) || detailed.has(binding.sourceItemId))
      include(binding, () => {
        plan.document.bindings[binding.id] = binding;
      });
  if (document.audioBuses)
    include(document.audioBuses, () => {
      plan.document.audioBuses = document.audioBuses;
    });
  if (document.markers)
    include(document.markers, () => {
      plan.document.markers = document.markers;
    });
  if (document.transitions)
    include(document.transitions, () => {
      plan.document.transitions = document.transitions;
      plan.omitted.transitions = 0;
    });
  if (document.linkedGroups)
    include(document.linkedGroups, () => {
      plan.document.linkedGroups = document.linkedGroups;
      plan.omitted.linkedGroups = 0;
    });
  indexing = true;
  for (const entry of ranked.slice(0, MAX_INDEX_ITEMS)) {
    const summary: ItemSummary = {
      id: entry.item.id,
      name: entry.item.name,
      trackId: entry.item.trackId,
      type: entry.item.node.type,
      from: entry.item.node.from ?? 0,
      duration: entry.item.node.duration!,
      nodeCount: entry.nodes.length,
      text: entry.nodes
        .map(({ node }) => textOf(node))
        .find(Boolean)
        ?.slice(0, 120),
      detailIncluded: detailed.has(entry.item.id),
    };
    include(summary, () => plan.itemIndex.push(summary));
  }
  const assets = Object.values(document.assets).sort(
    (a, b) =>
      Number(mentions(instruction, b.id) || mentions(instruction, b.name)) -
      Number(mentions(instruction, a.id) || mentions(instruction, a.name)),
  );
  for (const asset of assets.slice(0, MAX_INDEX_ITEMS))
    include({ id: asset.id, name: asset.name, type: asset.type }, () =>
      plan.assetIndex.push({
        id: asset.id,
        name: asset.name,
        type: asset.type,
      }),
    );
  plan.omitted = {
    ...plan.omitted,
    items: document.items.length - detailed.size,
    itemIndex: document.items.length - plan.itemIndex.length,
    assets:
      Object.keys(document.assets).length -
      Object.keys(plan.document.assets).length,
    evidence:
      Object.keys(document.evidence).length -
      Object.keys(plan.document.evidence).length,
    decisions:
      document.creativeContext.decisions.length -
      plan.document.creativeContext.decisions.length,
    references:
      document.creativeContext.references.length -
      plan.document.creativeContext.references.length,
    bindings:
      Object.keys(document.bindings).length -
      Object.keys(plan.document.bindings).length,
  };
  if (JSON.stringify(plan).length > maxChars)
    throw new Error(
      "Native project context exceeded its deterministic budget.",
    );
  return plan;
}
