import {
  resolveTextLineMetrics,
  worstMeasurementQuality,
  type MeasurementQuality,
  type ResolvedMeasurementProvenance,
  type ResolvedTextLineMetrics,
  type TextMetricsProvider,
} from "@dojo-video-engine/core";
import type { SceneNode, SceneStyle } from "@dojo-video-engine/schema";
import { LayoutCompileError } from "./types";

export const LAYOUT_TEXT_PLAN_VERSION = 1 as const;
/** Pinned table scope; changes require text-plan compatibility evidence. */
export const LAYOUT_TEXT_UNICODE_TABLE_VERSION =
  "dojo-video-engine-layout-text-1/unicode-15.1-subset" as const;

const MAX_LAYOUT_TEXT_SCALAR = 10_000_000;
const MAX_LAYOUT_TEXT_FONT_SIZE = 1_000_000;
const MIN_LAYOUT_TEXT_QUANTUM = 0.000001;

export type LayoutTextFitStatus = "fit" | "clamped" | "impossible";
export type LayoutTextBaseDirection = "ltr" | "rtl";
export type LayoutTextPhysicalAlign = "left" | "center" | "right";

export type LayoutTextSourceGrapheme = {
  text: string;
  sourceStart: number;
  sourceEnd: number;
  synthetic: false;
};

export type LayoutTextSyntheticEllipsis = {
  text: "…";
  sourceStart: null;
  sourceEnd: null;
  synthetic: "ellipsis";
  ownerSourceStart: number;
  ownerSourceEnd: number;
};

export type LayoutTextGrapheme =
  | LayoutTextSourceGrapheme
  | LayoutTextSyntheticEllipsis;

export type LayoutTextRect = {
  x: number;
  y: number;
  width: number;
  height: number;
};

export type LayoutTextLine = {
  index: number;
  text: string;
  sourceStart: number;
  sourceEnd: number;
  graphemes: LayoutTextGrapheme[];
  width: number;
  ascent: number;
  descent: number;
  baselineY: number;
  lineBox: LayoutTextRect;
  inkBounds: LayoutTextRect;
  measurement: MeasurementQuality;
  reason: string;
  fieldMeasurements: {
    width: ResolvedMeasurementProvenance;
    ascent: ResolvedMeasurementProvenance;
    descent: ResolvedMeasurementProvenance;
  };
};

export type LayoutTextDiagnostic = {
  severity: "warning";
  code: "unsafe_legacy_direction" | "unsafe_legacy_rich_text";
  message: string;
  nodeId: string;
};

export type LayoutTextFit = {
  status: LayoutTextFitStatus;
  horizontalOverflow: boolean;
  verticalOverflow: boolean;
  truncated: boolean;
  resolvedByShrink: boolean;
};

export type LayoutTextBudgets = {
  maxTextCodeUnits: number;
  maxGraphemes: number;
  maxLines: number;
  maxMeasureCalls: number;
  maxBreakSearchPasses: number;
};

export const defaultLayoutTextBudgets: Readonly<LayoutTextBudgets> =
  Object.freeze({
    maxTextCodeUnits: 1_000_000,
    maxGraphemes: 100_000,
    maxLines: 4_096,
    maxMeasureCalls: 100_000,
    maxBreakSearchPasses: 64,
  });

const layoutTextBudgetKeys = [
  "maxTextCodeUnits",
  "maxGraphemes",
  "maxLines",
  "maxMeasureCalls",
  "maxBreakSearchPasses",
] as const satisfies readonly (keyof LayoutTextBudgets)[];

const layoutTextBudgetCeilings: Readonly<LayoutTextBudgets> = Object.freeze({
  maxTextCodeUnits: MAX_LAYOUT_TEXT_SCALAR,
  maxGraphemes: 1_000_000,
  maxLines: 100_000,
  maxMeasureCalls: 1_000_000,
  maxBreakSearchPasses: 1_024,
});

export type LayoutTextMeasureOptions = {
  availableWidth?: number;
  availableHeight?: number;
  provider?: TextMetricsProvider;
  /** Rich runs need a shaping engine; unsafe mode measures concatenated text. */
  richTextPolicy?: "reject" | "legacy-unsafe";
  /** `inherit` depends on host Canvas/DOM state and is rejected by default. */
  inheritDirectionPolicy?: "reject" | "legacy-unsafe";
  budgets?: Partial<LayoutTextBudgets>;
  /** Compatibility shorthand for the original provisional compiler seam. */
  maxMeasureCalls?: number;
  /** Font sizes are resolved on this deterministic grid during shrink fitting. */
  fontSizeQuantum?: number;
};

export type LayoutTextMeasurement = {
  version: typeof LAYOUT_TEXT_PLAN_VERSION;
  nodeId: string;
  value: string;
  baseDirection: LayoutTextBaseDirection;
  physicalAlign: LayoutTextPhysicalAlign;
  width: number;
  height: number;
  minContentWidth: number;
  maxContentWidth: number;
  fontSize: number;
  lineHeight: number;
  lineCount: number;
  lines: LayoutTextLine[];
  fit: LayoutTextFit;
  measurement: MeasurementQuality;
  reason: string;
  fieldMeasurements: {
    width: ResolvedMeasurementProvenance;
    height: ResolvedMeasurementProvenance;
  };
  measureCalls: number;
  graphemeCount: number;
  diagnostics: LayoutTextDiagnostic[];
};

export type LayoutTextSceneProjectionOptions = {
  /** Impossible plans normally cannot truthfully promise bounded Scene output. */
  allowImpossible?: boolean;
};

/**
 * Projects a completed v2 plain-text plan into stable Scene v1 paint inputs.
 * Explicit newlines and the resolved font/direction prevent Scene v1 from
 * repeating shrink/truncate decisions. Geometry remains owned by the solver.
 */
export function projectLayoutTextToSceneV1(
  node: Pick<SceneNode, "id" | "text" | "runs" | "style">,
  measurement: LayoutTextMeasurement,
  options: LayoutTextSceneProjectionOptions = {},
): Pick<SceneNode, "id" | "type" | "text" | "style"> {
  const value = node.text ?? node.runs?.map((run) => run.text).join("") ?? "";
  assertBoundedNumericTree(measurement, node.id, "text plan");
  if (
    measurement.version !== LAYOUT_TEXT_PLAN_VERSION ||
    measurement.nodeId !== node.id ||
    measurement.value !== value
  ) {
    throw new LayoutCompileError(
      "invalid_geometry",
      `Layout text plan does not match node ${JSON.stringify(node.id)}.`,
      ["items", node.id],
      { id: node.id },
    );
  }
  if ((node.runs?.length ?? 0) > 0) {
    throw textError(
      node.id,
      "rich_text_unsafe",
      `Layout v2 cannot project shaped rich runs for ${JSON.stringify(node.id)} into Scene v1 plain text.`,
    );
  }
  if (measurement.fit.status === "impossible" && !options.allowImpossible) {
    throw new LayoutCompileError(
      "constraint_unsatisfied",
      `Layout text ${JSON.stringify(node.id)} has an impossible fit and cannot be projected as bounded Scene v1 text.`,
      ["items", node.id],
      { id: node.id },
    );
  }
  const {
    maxLines: _maxLines,
    minFontSize: _minFontSize,
    textFit: _textFit,
    textOverflow: _textOverflow,
    ...style
  } = structuredClone(node.style ?? {});
  const projection: Pick<SceneNode, "id" | "type" | "text" | "style"> = {
    id: node.id,
    type: "text",
    text: measurement.lines.map((line) => line.text).join("\n"),
    style: {
      ...style,
      direction: measurement.baseDirection,
      textAlign: measurement.physicalAlign,
      fontSize: measurement.fontSize,
      lineHeight: `${measurement.lineHeight}px`,
    },
  };
  assertBoundedNumericTree(projection, node.id, "Scene text projection");
  return projection;
}

type SourceCluster = LayoutTextSourceGrapheme;
type PlannedCluster = LayoutTextGrapheme;

type TextTokenKind =
  | "closing-punctuation"
  | "nonbreaking-group"
  | "nonbreaking-space"
  | "opening-punctuation"
  | "space"
  | "word"
  | "wrap-unit";

type TextToken = {
  kind: TextTokenKind;
  graphemes: SourceCluster[];
};

type Paragraph = {
  graphemes: SourceCluster[];
  emptyOffset: number;
};

type RawLine = {
  graphemes: PlannedCluster[];
  emptyOffset: number;
};

type RawLayout = {
  lines: RawLine[];
  complete: boolean;
  horizontalOverflow: boolean;
};

type RawLineLimit = {
  limit: number;
  enforceBudget: boolean;
};

type MetricState = {
  calls: number;
  cache: Map<string, ResolvedTextLineMetrics>;
  reasons: Set<string>;
  quality: MeasurementQuality;
  widthReasons: Set<string>;
  widthQuality: MeasurementQuality;
};

type PlannerContext = {
  nodeId: string;
  style: SceneStyle;
  provider?: TextMetricsProvider;
  direction: LayoutTextBaseDirection;
  budgets: LayoutTextBudgets;
  state: MetricState;
};

type CodePointRange = readonly [start: number, end: number];

// Pinned ranges cover base-plus-mark clusters for Latin/Greek/Cyrillic,
// Hebrew/Arabic, major Indic and Southeast Asian scripts, Tibetan, Mongolian,
// symbol marks, and supplementary music marks. This deliberately is not full
// UAX #29: modern Indic conjunct chains without explicit ZWJ and decomposed
// Hangul Jamo syllables are outside table v1; use shaped/precomposed text.
const combiningMarkRanges: readonly CodePointRange[] = [
  [0x0300, 0x036f],
  [0x0483, 0x0489],
  [0x0591, 0x05bd],
  [0x05bf, 0x05bf],
  [0x05c1, 0x05c2],
  [0x05c4, 0x05c5],
  [0x05c7, 0x05c7],
  [0x0610, 0x061a],
  [0x064b, 0x065f],
  [0x0670, 0x0670],
  [0x06d6, 0x06dc],
  [0x06df, 0x06e4],
  [0x06e7, 0x06e8],
  [0x06ea, 0x06ed],
  [0x0711, 0x0711],
  [0x0730, 0x074a],
  [0x07a6, 0x07b0],
  [0x07eb, 0x07f3],
  [0x0816, 0x0819],
  [0x081b, 0x0823],
  [0x0825, 0x0827],
  [0x0829, 0x082d],
  [0x0859, 0x085b],
  [0x08d3, 0x08e1],
  [0x08e3, 0x0903],
  [0x093a, 0x093c],
  [0x093e, 0x094f],
  [0x0951, 0x0957],
  [0x0962, 0x0963],
  [0x0981, 0x0983],
  [0x09bc, 0x09bc],
  [0x09be, 0x09c4],
  [0x09c7, 0x09c8],
  [0x09cb, 0x09cd],
  [0x09d7, 0x09d7],
  [0x09e2, 0x09e3],
  [0x0a01, 0x0a03],
  [0x0a3c, 0x0a3c],
  [0x0a3e, 0x0a42],
  [0x0a47, 0x0a48],
  [0x0a4b, 0x0a4d],
  [0x0a51, 0x0a51],
  [0x0a70, 0x0a71],
  [0x0a75, 0x0a75],
  [0x0a81, 0x0a83],
  [0x0abc, 0x0abc],
  [0x0abe, 0x0ac5],
  [0x0ac7, 0x0ac9],
  [0x0acb, 0x0acd],
  [0x0ae2, 0x0ae3],
  [0x0b01, 0x0b03],
  [0x0b3c, 0x0b3c],
  [0x0b3e, 0x0b44],
  [0x0b47, 0x0b48],
  [0x0b4b, 0x0b4d],
  [0x0b55, 0x0b57],
  [0x0b62, 0x0b63],
  [0x0b82, 0x0b82],
  [0x0bbe, 0x0bc2],
  [0x0bc6, 0x0bc8],
  [0x0bca, 0x0bcd],
  [0x0bd7, 0x0bd7],
  [0x0c00, 0x0c04],
  [0x0c3c, 0x0c44],
  [0x0c46, 0x0c48],
  [0x0c4a, 0x0c4d],
  [0x0c55, 0x0c56],
  [0x0c62, 0x0c63],
  [0x0c81, 0x0c83],
  [0x0cbc, 0x0cbc],
  [0x0cbe, 0x0cc4],
  [0x0cc6, 0x0cc8],
  [0x0cca, 0x0ccd],
  [0x0cd5, 0x0cd6],
  [0x0ce2, 0x0ce3],
  [0x0d00, 0x0d03],
  [0x0d3b, 0x0d44],
  [0x0d46, 0x0d48],
  [0x0d4a, 0x0d4d],
  [0x0d57, 0x0d57],
  [0x0d62, 0x0d63],
  [0x0e31, 0x0e31],
  [0x0e34, 0x0e3a],
  [0x0e47, 0x0e4e],
  [0x0eb1, 0x0eb1],
  [0x0eb4, 0x0ebc],
  [0x0ec8, 0x0ecd],
  [0x0f18, 0x0f19],
  [0x0f35, 0x0f35],
  [0x0f37, 0x0f37],
  [0x0f39, 0x0f39],
  [0x0f3e, 0x0f3f],
  [0x0f71, 0x0f84],
  [0x0f86, 0x0f87],
  [0x0f8d, 0x0fbc],
  [0x102b, 0x103e],
  [0x1056, 0x1059],
  [0x105e, 0x1060],
  [0x1062, 0x1064],
  [0x1067, 0x106d],
  [0x1071, 0x1074],
  [0x1082, 0x108d],
  [0x108f, 0x108f],
  [0x109a, 0x109d],
  [0x17b4, 0x17d3],
  [0x17dd, 0x17dd],
  [0x180b, 0x180d],
  [0x1885, 0x1886],
  [0x1ab0, 0x1aff],
  [0x1dc0, 0x1dff],
  [0x20d0, 0x20ff],
  [0xfe20, 0xfe2f],
  [0x1d165, 0x1d169],
  [0x1d16d, 0x1d172],
  [0x1d17b, 0x1d182],
  [0x1d185, 0x1d18b],
  [0x1d1aa, 0x1d1ad],
];

const ltrLetterRanges: readonly CodePointRange[] = [
  [0x0041, 0x005a],
  [0x0061, 0x007a],
  [0x00c0, 0x02e4],
  [0x0370, 0x052f],
  [0x0531, 0x0588],
  [0x0904, 0x0dff],
  [0x0e01, 0x0e46],
  [0x0e81, 0x0ec6],
  [0x0f40, 0x0f6c],
  [0x1000, 0x102a],
  [0x10a0, 0x10ff],
  [0x1200, 0x137c],
  [0x1780, 0x17b3],
  [0x1e00, 0x1fff],
];

const rtlLetterRanges: readonly CodePointRange[] = [
  [0x05d0, 0x05ea],
  [0x05ef, 0x05f2],
  [0x0620, 0x063f],
  [0x0641, 0x064a],
  [0x066e, 0x066f],
  [0x0671, 0x06d3],
  [0x06d5, 0x06d5],
  [0x06e5, 0x06e6],
  [0x06ee, 0x06ef],
  [0x06fa, 0x06fc],
  [0x06ff, 0x06ff],
  [0x0710, 0x0710],
  [0x0712, 0x072f],
  [0x074d, 0x07a5],
  [0x07b1, 0x07b1],
  [0x07ca, 0x07ea],
  [0x0800, 0x0815],
  [0x0840, 0x0858],
  [0x0860, 0x086a],
  [0x0870, 0x0887],
  [0x08a0, 0x08c9],
  [0xfb1d, 0xfdff],
  [0xfe70, 0xfefc],
  [0x10840, 0x10fff],
  [0x1e800, 0x1eeff],
];

const pictographicRanges: readonly CodePointRange[] = [
  [0x00a9, 0x00a9],
  [0x00ae, 0x00ae],
  [0x203c, 0x203c],
  [0x2049, 0x2049],
  [0x2122, 0x2122],
  [0x2139, 0x2139],
  [0x2194, 0x21ff],
  [0x2300, 0x23ff],
  [0x24c2, 0x24c2],
  [0x25aa, 0x27bf],
  [0x2934, 0x2935],
  [0x2b05, 0x2bff],
  [0x3030, 0x3030],
  [0x303d, 0x303d],
  [0x3297, 0x3297],
  [0x3299, 0x3299],
  [0x1f000, 0x1faff],
];

const openingPunctuation = new Set(
  Array.from("([{（［｛〈《「『【〔〖〘〚‘“«‹"),
);
const closingPunctuation = new Set(
  Array.from(")]}｝）］〉》」』】〕〗〙〛、。，．！？：；％‰’”»›…"),
);

/**
 * Bundled, single-pass segmentation for the table-v1 scope above. It does not
 * call Intl.Segmenter, whose Unicode data/version is host-dependent. UTF-16
 * source ranges make edits and ellipsis ownership exact. Modern Indic
 * conjunct chains without explicit ZWJ and decomposed Hangul Jamo are not
 * claimed as atomic clusters by this version.
 */
export function segmentLayoutTextGraphemes(
  text: string,
): LayoutTextSourceGrapheme[] {
  const output: LayoutTextSourceGrapheme[] = [];
  let index = 0;

  while (index < text.length) {
    const start = index;
    const first = readCodePoint(text, index);
    index = first.end;

    if (first.value === 0x0d && text.charCodeAt(index) === 0x0a) {
      index += 1;
    } else {
      if (isRegionalIndicator(first.value)) {
        const next = index < text.length ? readCodePoint(text, index) : null;
        if (next && isRegionalIndicator(next.value)) index = next.end;
      }
      index = consumeClusterExtenders(text, index);
      while (index < text.length) {
        const joiner = readCodePoint(text, index);
        if (joiner.value !== 0x200d) break;
        index = joiner.end;
        if (index >= text.length) break;
        index = readCodePoint(text, index).end;
        index = consumeClusterExtenders(text, index);
      }
    }

    output.push({
      text: text.slice(start, index),
      sourceStart: start,
      sourceEnd: index,
      synthetic: false,
    });
  }

  return output;
}

/** Resolves explicit direction or a deterministic Unicode first-strong value. */
export function resolveLayoutTextBaseDirection(
  text: string,
  requested: SceneStyle["direction"],
): LayoutTextBaseDirection {
  if (requested === "ltr" || requested === "rtl") return requested;
  for (const { text: grapheme } of segmentLayoutTextGraphemes(text)) {
    for (const character of grapheme) {
      const value = character.codePointAt(0) ?? 0;
      if (isRtlStrong(value)) return "rtl";
      if (isLtrLetter(value) || isCjkCodePoint(value)) return "ltr";
    }
  }
  return "ltr";
}

/**
 * Compile-time text planner for Layout Contract v1. It is intentionally not
 * used by core's Scene v1 layout path, so evolving this contract cannot alter
 * existing Scene pixels.
 */
export function measureLayoutText(
  node: Pick<SceneNode, "id" | "text" | "runs" | "style">,
  options: LayoutTextMeasureOptions = {},
): LayoutTextMeasurement {
  const style = structuredClone(node.style ?? {});
  const diagnostics: LayoutTextDiagnostic[] = [];
  const hasRichText = (node.runs?.length ?? 0) > 0;
  if (hasRichText && (options.richTextPolicy ?? "reject") !== "legacy-unsafe") {
    throw textError(
      node.id,
      "rich_text_unsafe",
      `Layout v2 cannot fit rich text node ${JSON.stringify(node.id)} without a shaping engine; independent Canvas runs do not preserve graphemes, bidi, or ligatures.`,
    );
  }
  if (hasRichText) {
    diagnostics.push({
      severity: "warning",
      code: "unsafe_legacy_rich_text",
      message:
        "Rich runs were concatenated for intrinsic measurement; rendered run geometry may differ.",
      nodeId: node.id,
    });
  }

  const value = node.text ?? node.runs?.map((run) => run.text).join("") ?? "";
  if (
    style.direction === "inherit" &&
    (options.inheritDirectionPolicy ?? "reject") !== "legacy-unsafe"
  ) {
    throw textError(
      node.id,
      "text_direction_required",
      `Layout v2 text ${JSON.stringify(node.id)} cannot inherit direction from host Canvas or DOM state. Use "ltr", "rtl", or omit direction for deterministic first-strong resolution.`,
    );
  }
  if (style.direction === "inherit") {
    diagnostics.push({
      severity: "warning",
      code: "unsafe_legacy_direction",
      message:
        "Inherited direction was replaced by Layout v2 first-strong direction for measurement.",
      nodeId: node.id,
    });
  }

  const budgets = resolveTextBudgets(options, node.id);
  if (value.length > budgets.maxTextCodeUnits) {
    throw budgetError(
      node.id,
      "text code units",
      value.length,
      budgets.maxTextCodeUnits,
    );
  }
  const graphemes = segmentLayoutTextGraphemes(value);
  if (graphemes.length > budgets.maxGraphemes) {
    throw budgetError(
      node.id,
      "graphemes",
      graphemes.length,
      budgets.maxGraphemes,
    );
  }

  const direction = resolveLayoutTextBaseDirection(
    value,
    style.direction === "inherit" ? undefined : style.direction,
  );
  style.direction = direction;
  const physicalAlign =
    style.textAlign ?? (direction === "rtl" ? "right" : "left");
  const availableWidth = optionalDimension(
    options.availableWidth,
    "availableWidth",
    node.id,
  );
  const availableHeight = optionalDimension(
    options.availableHeight,
    "availableHeight",
    node.id,
  );
  const baseFontSize = readFontSize(style.fontSize, node.id);
  const minFontSize = Math.min(
    baseFontSize,
    readMinFontSize(style.minFontSize, node.id),
  );
  const quantum = Math.min(
    resolveQuantum(options.fontSizeQuantum, node.id),
    baseFontSize,
    minFontSize,
  );
  const paragraphs = splitParagraphs(graphemes, value.length);
  const context: PlannerContext = {
    nodeId: node.id,
    style,
    provider: options.provider,
    direction,
    budgets,
    state: {
      calls: 0,
      cache: new Map(),
      reasons: new Set(),
      quality: "exact",
      widthReasons: new Set(),
      widthQuality: "exact",
    },
  };

  const fitMode = style.textFit ?? "wrap";
  let resolvedFontSize = quantizeDown(baseFontSize, quantum, node.id);
  let raw = layoutAtSize(
    fitMode,
    paragraphs,
    resolvedFontSize,
    availableWidth,
    rawLineLimit(style, availableHeight, resolvedFontSize, budgets, node.id),
    context,
  );
  let resolvedByShrink = false;

  if (
    fitMode === "shrink" &&
    !rawFits(
      raw,
      style,
      availableWidth,
      availableHeight,
      resolvedFontSize,
      node.id,
    )
  ) {
    const minTick = Math.ceil(minFontSize / quantum - 1e-9);
    let low = minTick;
    let high = Math.floor(baseFontSize / quantum + 1e-9);
    let best: { tick: number; raw: RawLayout } | undefined;
    const minSize = tickSize(minTick, quantum, node.id);
    const minRaw = layoutAtSize(
      "wrap",
      paragraphs,
      minSize,
      availableWidth,
      rawLineLimit(style, availableHeight, minSize, budgets, node.id),
      context,
    );
    if (
      rawFits(minRaw, style, availableWidth, availableHeight, minSize, node.id)
    ) {
      best = { tick: minTick, raw: minRaw };
      let shrinkPasses = 0;
      while (low <= high) {
        shrinkPasses = takeSearchPass(shrinkPasses, context);
        const middle = Math.floor((low + high) / 2);
        const size = tickSize(middle, quantum, node.id);
        const candidate = layoutAtSize(
          "wrap",
          paragraphs,
          size,
          availableWidth,
          rawLineLimit(style, availableHeight, size, budgets, node.id),
          context,
        );
        if (
          rawFits(
            candidate,
            style,
            availableWidth,
            availableHeight,
            size,
            node.id,
          )
        ) {
          best = { tick: middle, raw: candidate };
          low = middle + 1;
        } else {
          high = middle - 1;
        }
      }
    }
    if (best) {
      resolvedFontSize = tickSize(best.tick, quantum, node.id);
      raw = best.raw;
      resolvedByShrink =
        resolvedFontSize < quantizeDown(baseFontSize, quantum, node.id);
    } else {
      resolvedFontSize = minSize;
      raw = minRaw;
      resolvedByShrink =
        resolvedFontSize < quantizeDown(baseFontSize, quantum, node.id);
    }
  }

  const lineHeight = resolveLineHeight(
    style.lineHeight,
    resolvedFontSize,
    node.id,
  );
  const constrained = constrainRawLines(
    raw,
    style,
    fitMode,
    availableWidth,
    availableHeight,
    lineHeight,
    resolvedFontSize,
    context,
  );
  const measuredLines = buildMeasuredLines(
    constrained.lines,
    resolvedFontSize,
    lineHeight,
    availableWidth,
    physicalAlign,
    context,
  );
  const maxLineWidth = measuredLines.reduce(
    (maximum, line) => Math.max(maximum, line.width),
    0,
  );
  const horizontalOverflow =
    raw.horizontalOverflow ||
    (availableWidth !== undefined &&
      measuredLines.some((line) => line.width > availableWidth + 1e-7));
  const verticalOverflow =
    availableHeight !== undefined &&
    measuredLines.length * lineHeight > availableHeight + 1e-7;
  const impossible =
    horizontalOverflow ||
    verticalOverflow ||
    (value.length > 0 &&
      availableHeight !== undefined &&
      lineHeight > availableHeight);
  const truncated = constrained.truncated || !raw.complete;
  const status: LayoutTextFitStatus = impossible
    ? "impossible"
    : truncated
      ? "clamped"
      : "fit";
  const content = measureIntrinsicWidths(paragraphs, resolvedFontSize, context);
  const width =
    availableWidth === undefined
      ? maxLineWidth
      : Math.min(availableWidth, maxLineWidth);
  const height = measuredLines.length * lineHeight;
  const measurement = measuredLines.reduce<MeasurementQuality>(
    (quality, line) => worstMeasurementQuality(quality, line.measurement),
    context.state.quality,
  );
  const reason =
    Array.from(
      new Set([
        ...context.state.reasons,
        ...measuredLines.map((line) => line.reason),
      ]),
    )
      .sort()
      .join("; ") || "empty text; deterministic Layout v2 metrics";
  const widthReason =
    Array.from(context.state.widthReasons).sort().join("; ") || reason;

  const result: LayoutTextMeasurement = {
    version: LAYOUT_TEXT_PLAN_VERSION,
    nodeId: node.id,
    value,
    baseDirection: direction,
    physicalAlign,
    width,
    height,
    minContentWidth: content.min,
    maxContentWidth: content.max,
    fontSize: resolvedFontSize,
    lineHeight,
    lineCount: measuredLines.length,
    lines: measuredLines,
    fit: {
      status,
      horizontalOverflow,
      verticalOverflow,
      truncated,
      resolvedByShrink,
    },
    measurement,
    reason,
    fieldMeasurements: {
      width: {
        measurement: context.state.widthQuality,
        reason: widthReason,
      },
      height: {
        measurement,
        reason: `${reason}; deterministic Layout v2 line-height`,
      },
    },
    measureCalls: context.state.calls,
    graphemeCount: graphemes.length,
    diagnostics,
  };
  assertBoundedNumericTree(result, node.id, "text plan");
  return result;
}

function layoutAtSize(
  mode: "wrap" | "shrink" | "truncate",
  paragraphs: Paragraph[],
  fontSize: number,
  availableWidth: number | undefined,
  lineLimit: RawLineLimit,
  context: PlannerContext,
): RawLayout {
  if (mode === "truncate") {
    const joined = joinParagraphs(paragraphs);
    if (availableWidth === undefined) {
      return {
        lines: [{ graphemes: joined, emptyOffset: 0 }],
        complete: true,
        horizontalOverflow: false,
      };
    }
    const fitted = fitClusterPrefix(joined, availableWidth, fontSize, context);
    return {
      lines: [{ graphemes: fitted.prefix, emptyOffset: 0 }],
      complete: fitted.complete,
      horizontalOverflow: fitted.horizontalOverflow,
    };
  }

  const lines: RawLine[] = [];
  let complete = true;
  let horizontalOverflow = false;
  for (const paragraph of paragraphs) {
    if (lines.length >= lineLimit.limit) {
      complete = false;
      break;
    }
    if (paragraph.graphemes.length === 0) {
      lines.push({ graphemes: [], emptyOffset: paragraph.emptyOffset });
      continue;
    }
    if (availableWidth === undefined) {
      lines.push({
        graphemes: trimOuterSpaces(
          normalizeParagraphWhitespace(paragraph.graphemes),
        ),
        emptyOffset: paragraph.emptyOffset,
      });
      continue;
    }
    const wrapped = wrapParagraph(
      paragraph,
      availableWidth,
      fontSize,
      Math.max(1, lineLimit.limit - lines.length),
      context,
    );
    lines.push(...wrapped.lines);
    complete &&= wrapped.complete;
    horizontalOverflow ||= wrapped.horizontalOverflow;
  }
  if (
    lineLimit.enforceBudget &&
    (lines.length > context.budgets.maxLines || !complete)
  ) {
    throw budgetError(
      context.nodeId,
      "planned lines",
      Math.max(lines.length, context.budgets.maxLines + 1),
      context.budgets.maxLines,
    );
  }
  return { lines, complete, horizontalOverflow };
}

function wrapParagraph(
  paragraph: Paragraph,
  maxWidth: number,
  fontSize: number,
  lineLimit: number,
  context: PlannerContext,
): RawLayout {
  const tokens = tokenizeParagraph(paragraph.graphemes);
  if (tokens.every((token) => token.kind === "space")) {
    return {
      lines: [
        {
          graphemes: [],
          emptyOffset:
            paragraph.graphemes[0]?.sourceStart ?? paragraph.emptyOffset,
        },
      ],
      complete: true,
      horizontalOverflow: false,
    };
  }
  const legalEnds = tokens
    .map((_token, index) => index + 1)
    .filter((end) => canBreakTokens(tokens, end));
  const lines: RawLine[] = [];
  let tokenIndex = 0;
  let clusterOffset = 0;
  let horizontalOverflow = false;

  while (tokenIndex < tokens.length && lines.length < lineLimit) {
    while (tokens[tokenIndex]?.kind === "space") tokenIndex += 1;
    if (tokenIndex >= tokens.length) break;
    const first = tokens[tokenIndex]!;
    if (clusterOffset > 0) {
      const split = fitClusterRange(
        first.graphemes,
        clusterOffset,
        maxWidth,
        fontSize,
        context,
      );
      const prefix = first.graphemes.slice(clusterOffset, split.end);
      const width = measureText(clusterText(prefix), fontSize, context).width;
      horizontalOverflow ||= width > maxWidth + 1e-7;
      lines.push({ graphemes: prefix, emptyOffset: paragraph.emptyOffset });
      clusterOffset += prefix.length;
      if (clusterOffset >= first.graphemes.length) {
        tokenIndex += 1;
        clusterOffset = 0;
      }
      continue;
    }
    const firstWidth = measureText(
      clusterText(first.graphemes),
      fontSize,
      context,
    ).width;
    if (
      first.kind === "word" &&
      firstWidth > maxWidth + 1e-7 &&
      first.graphemes.length > 1
    ) {
      const split = fitClusterRange(
        first.graphemes,
        0,
        maxWidth,
        fontSize,
        context,
      );
      const prefix = first.graphemes.slice(0, split.end);
      const width = measureText(clusterText(prefix), fontSize, context).width;
      horizontalOverflow ||= width > maxWidth + 1e-7;
      lines.push({ graphemes: prefix, emptyOffset: paragraph.emptyOffset });
      clusterOffset = prefix.length;
      if (clusterOffset >= first.graphemes.length) {
        tokenIndex += 1;
        clusterOffset = 0;
      }
      continue;
    }

    const end = fitTokenEnd(
      tokens,
      legalEnds,
      tokenIndex,
      maxWidth,
      fontSize,
      context,
    );
    const candidate = trimTrailingSpaces(
      collectTokenClusters(tokens, tokenIndex, end),
    );
    if (candidate.length === 0) {
      tokenIndex = Math.max(tokenIndex + 1, end);
      continue;
    }
    const candidateWidth = measureText(
      clusterText(candidate),
      fontSize,
      context,
    ).width;
    horizontalOverflow ||= candidateWidth > maxWidth + 1e-7;
    lines.push({ graphemes: candidate, emptyOffset: paragraph.emptyOffset });
    tokenIndex = Math.max(tokenIndex + 1, end);
  }

  return {
    lines,
    complete: tokenIndex >= tokens.length,
    horizontalOverflow,
  };
}

function constrainRawLines(
  raw: RawLayout,
  style: SceneStyle,
  fitMode: "wrap" | "shrink" | "truncate",
  availableWidth: number | undefined,
  availableHeight: number | undefined,
  lineHeight: number,
  fontSize: number,
  context: PlannerContext,
): { lines: RawLine[]; truncated: boolean } {
  const heightLines =
    availableHeight === undefined
      ? Number.POSITIVE_INFINITY
      : Math.max(0, Math.floor((availableHeight + 1e-7) / lineHeight));
  const configuredLines =
    fitMode === "truncate" ? 1 : (style.maxLines ?? Infinity);
  const visibleCount = Math.min(raw.lines.length, configuredLines, heightLines);
  let lines = raw.lines.slice(0, visibleCount).map((line) => ({
    graphemes: [...line.graphemes],
    emptyOffset: line.emptyOffset,
  }));
  const truncated = !raw.complete || visibleCount < raw.lines.length;
  if (
    truncated &&
    style.textOverflow === "ellipsis" &&
    lines.length > 0 &&
    availableWidth !== undefined
  ) {
    const last = lines.at(-1)!;
    lines = [
      ...lines.slice(0, -1),
      {
        ...last,
        graphemes: appendOwnedEllipsis(
          last.graphemes,
          availableWidth,
          fontSize,
          context,
        ),
      },
    ];
  }
  return { lines, truncated };
}

function buildMeasuredLines(
  rawLines: RawLine[],
  fontSize: number,
  lineHeight: number,
  availableWidth: number | undefined,
  align: LayoutTextPhysicalAlign,
  context: PlannerContext,
): LayoutTextLine[] {
  const pending = rawLines.map((line) => ({
    line,
    metrics: measureText(clusterText(line.graphemes), fontSize, context),
  }));
  const measuredWidth = pending.reduce(
    (maximum, entry) => Math.max(maximum, entry.metrics.width),
    0,
  );
  const boxWidth = availableWidth ?? measuredWidth;
  return pending.map(({ line, metrics }, index) => {
    const vertical = normalizeVerticalMetrics(metrics, fontSize);
    const x =
      align === "center"
        ? (boxWidth - metrics.width) / 2
        : align === "right"
          ? boxWidth - metrics.width
          : 0;
    const baselineY = index * lineHeight + lineHeight / 2;
    const source = sourceRange(line.graphemes, line.emptyOffset);
    return {
      index,
      text: clusterText(line.graphemes),
      sourceStart: source.start,
      sourceEnd: source.end,
      graphemes: line.graphemes.map((cluster) => ({ ...cluster })),
      width: metrics.width,
      ascent: vertical.ascent,
      descent: vertical.descent,
      baselineY,
      lineBox: {
        x: 0,
        y: index * lineHeight,
        width: boxWidth,
        height: lineHeight,
      },
      inkBounds: {
        x,
        y: baselineY - vertical.ascent,
        width: metrics.width,
        height: vertical.ascent + vertical.descent,
      },
      measurement: vertical.measurement,
      reason: vertical.reason,
      fieldMeasurements: {
        width: { ...metrics.fieldMeasurements.width },
        ascent: { ...vertical.ascentProvenance },
        descent: { ...vertical.descentProvenance },
      },
    };
  });
}

function measureIntrinsicWidths(
  paragraphs: Paragraph[],
  fontSize: number,
  context: PlannerContext,
): { min: number; max: number } {
  let min = 0;
  let max = 0;
  for (const paragraph of paragraphs) {
    const normalized = normalizeParagraphWhitespace(paragraph.graphemes);
    max = Math.max(
      max,
      measureText(clusterText(normalized), fontSize, context).width,
    );
    for (const token of tokenizeParagraph(paragraph.graphemes)) {
      if (token.kind === "space") continue;
      if (token.kind === "word" && token.graphemes.length > 1) {
        for (const cluster of token.graphemes) {
          min = Math.max(
            min,
            measureText(cluster.text, fontSize, context).width,
          );
        }
      } else {
        min = Math.max(
          min,
          measureText(clusterText(token.graphemes), fontSize, context).width,
        );
      }
    }
  }
  return { min, max };
}

function appendOwnedEllipsis(
  graphemes: PlannedCluster[],
  maxWidth: number,
  fontSize: number,
  context: PlannerContext,
): PlannedCluster[] {
  const source = graphemes.filter(isSourceCluster);
  const ellipsisWidth = measureText("…", fontSize, context).width;
  if (ellipsisWidth > maxWidth + 1e-7) return [];
  let low = 0;
  let high = source.length;
  let passes = 0;
  while (low < high) {
    passes = takeSearchPass(passes, context);
    const middle = Math.ceil((low + high) / 2);
    const candidate = `${clusterText(source.slice(0, middle))}…`;
    if (measureText(candidate, fontSize, context).width <= maxWidth + 1e-7) {
      low = middle;
    } else {
      high = middle - 1;
    }
  }
  const kept = source.slice(0, low);
  const owner = kept.at(-1) ?? source[0];
  const boundary = owner?.sourceEnd ?? 0;
  return [
    ...kept,
    {
      text: "…",
      sourceStart: null,
      sourceEnd: null,
      synthetic: "ellipsis",
      ownerSourceStart: owner?.sourceStart ?? boundary,
      ownerSourceEnd: owner?.sourceEnd ?? boundary,
    },
  ];
}

function fitClusterPrefix(
  graphemes: SourceCluster[],
  maxWidth: number,
  fontSize: number,
  context: PlannerContext,
): {
  prefix: SourceCluster[];
  complete: boolean;
  horizontalOverflow: boolean;
} {
  const fitted = fitClusterRange(graphemes, 0, maxWidth, fontSize, context);
  return {
    prefix: graphemes.slice(0, fitted.end),
    complete: fitted.end === graphemes.length,
    horizontalOverflow: fitted.horizontalOverflow,
  };
}

function fitClusterRange(
  graphemes: SourceCluster[],
  start: number,
  maxWidth: number,
  fontSize: number,
  context: PlannerContext,
): { end: number; horizontalOverflow: boolean } {
  if (start >= graphemes.length) {
    return { end: start, horizontalOverflow: false };
  }
  const fitsCount = (count: number) =>
    measureText(
      clusterText(graphemes.slice(start, start + count)),
      fontSize,
      context,
    ).width <=
    maxWidth + 1e-7;
  let passes = takeSearchPass(0, context);
  if (!fitsCount(1)) {
    return { end: start + 1, horizontalOverflow: true };
  }
  const remaining = graphemes.length - start;
  let lowCount = 1;
  let step = 2;
  let highCount = 1;
  while (lowCount < remaining) {
    passes = takeSearchPass(passes, context);
    const candidate = Math.min(remaining, step);
    if (!fitsCount(candidate)) {
      highCount = candidate;
      break;
    }
    lowCount = candidate;
    if (candidate === remaining) {
      return { end: graphemes.length, horizontalOverflow: false };
    }
    step *= 2;
  }
  let low = lowCount + 1;
  let high = highCount - 1;
  let best = lowCount;
  while (low <= high) {
    passes = takeSearchPass(passes, context);
    const middle = Math.floor((low + high) / 2);
    if (fitsCount(middle)) {
      best = middle;
      low = middle + 1;
    } else {
      high = middle - 1;
    }
  }
  return { end: start + best, horizontalOverflow: false };
}

function measureText(
  value: string,
  fontSize: number,
  context: PlannerContext,
): ResolvedTextLineMetrics {
  const key = `${fontSize}\u0000${context.direction}\u0000${value}`;
  const cached = context.state.cache.get(key);
  if (cached) return structuredClone(cached);
  context.state.calls += 1;
  if (context.state.calls > context.budgets.maxMeasureCalls) {
    throw budgetError(
      context.nodeId,
      "text metric calls",
      context.state.calls,
      context.budgets.maxMeasureCalls,
    );
  }
  let result: ResolvedTextLineMetrics;
  if (context.provider) {
    result = resolveTextLineMetrics(
      {
        nodeId: context.nodeId,
        text: value,
        style: context.style,
        fontSize,
      },
      context.provider,
    );
  } else {
    const reason = "Layout v2 portable code-point upper-bound heuristic";
    const provenance = { measurement: "estimated" as const, reason };
    result = {
      width: Array.from(value).length * fontSize * 0.58,
      ascent: fontSize / 2,
      descent: fontSize / 2,
      measurement: "estimated",
      reason,
      fieldMeasurements: {
        width: { ...provenance },
        ascent: { ...provenance },
        descent: { ...provenance },
      },
    };
  }
  assertMetricScalar(result.width, "width", context.nodeId);
  if (result.ascent !== undefined) {
    assertMetricScalar(result.ascent, "ascent", context.nodeId);
  }
  if (result.descent !== undefined) {
    assertMetricScalar(result.descent, "descent", context.nodeId);
  }
  context.state.quality = worstMeasurementQuality(
    context.state.quality,
    result.measurement,
  );
  context.state.reasons.add(result.reason);
  context.state.widthQuality = worstMeasurementQuality(
    context.state.widthQuality,
    result.fieldMeasurements.width.measurement,
  );
  context.state.widthReasons.add(result.fieldMeasurements.width.reason);
  context.state.cache.set(key, structuredClone(result));
  return structuredClone(result);
}

function normalizeVerticalMetrics(
  metrics: ResolvedTextLineMetrics,
  fontSize: number,
): {
  ascent: number;
  descent: number;
  ascentProvenance: ResolvedMeasurementProvenance;
  descentProvenance: ResolvedMeasurementProvenance;
  measurement: MeasurementQuality;
  reason: string;
} {
  const fallback = {
    measurement: "estimated" as const,
    reason: "Layout v2 middle-baseline font-size fallback",
  };
  const ascent = metrics.ascent ?? fontSize / 2;
  const descent = metrics.descent ?? fontSize / 2;
  const ascentProvenance = metrics.fieldMeasurements.ascent ?? fallback;
  const descentProvenance = metrics.fieldMeasurements.descent ?? fallback;
  const measurement = worstMeasurementQuality(
    metrics.fieldMeasurements.width.measurement,
    ascentProvenance.measurement,
    descentProvenance.measurement,
  );
  const reason = Array.from(
    new Set([
      metrics.fieldMeasurements.width.reason,
      ascentProvenance.reason,
      descentProvenance.reason,
    ]),
  )
    .sort()
    .join("; ");
  return {
    ascent,
    descent,
    ascentProvenance,
    descentProvenance,
    measurement,
    reason,
  };
}

function tokenizeParagraph(graphemes: SourceCluster[]): TextToken[] {
  const normalized = normalizeParagraphWhitespace(graphemes);
  const tokens: TextToken[] = [];
  for (const grapheme of normalized) {
    const kind = classifyTokenGrapheme(grapheme.text);
    const previous = tokens.at(-1);
    if (kind === "word" && previous?.kind === "word") {
      previous.graphemes.push(grapheme);
    } else {
      tokens.push({ kind, graphemes: [grapheme] });
    }
  }
  const boundBoundaries = new Set<number>();
  for (let boundary = 1; boundary < tokens.length; boundary += 1) {
    const left = tokens[boundary - 1]!;
    const right = tokens[boundary]!;
    if (
      (left.kind === "nonbreaking-space" && right.kind !== "space") ||
      (right.kind === "nonbreaking-space" && left.kind !== "space")
    ) {
      boundBoundaries.add(boundary);
    }
  }
  const consolidated: TextToken[] = [];
  let start = 0;
  while (start < tokens.length) {
    let end = start + 1;
    while (boundBoundaries.has(end)) end += 1;
    const component = tokens.slice(start, end);
    if (component.some((token) => token.kind === "nonbreaking-space")) {
      consolidated.push({
        kind: "nonbreaking-group",
        graphemes: component.flatMap((token) => token.graphemes),
      });
    } else {
      consolidated.push(...component);
    }
    start = end;
  }
  return consolidated;
}

function normalizeParagraphWhitespace(
  graphemes: SourceCluster[],
): SourceCluster[] {
  const output: SourceCluster[] = [];
  for (const grapheme of graphemes) {
    if (!isWhitespace(grapheme.text)) {
      output.push({ ...grapheme });
      continue;
    }
    const previous = output.at(-1);
    if (previous?.text === " ") {
      previous.sourceEnd = grapheme.sourceEnd;
    } else {
      output.push({ ...grapheme, text: " " });
    }
  }
  return output;
}

function splitParagraphs(
  graphemes: SourceCluster[],
  textLength: number,
): Paragraph[] {
  const paragraphs: Paragraph[] = [];
  let current: SourceCluster[] = [];
  let emptyOffset = 0;
  for (const grapheme of graphemes) {
    if (!isNewline(grapheme.text)) {
      current.push(grapheme);
      continue;
    }
    paragraphs.push({ graphemes: current, emptyOffset });
    current = [];
    emptyOffset = grapheme.sourceEnd;
  }
  paragraphs.push({
    graphemes: current,
    emptyOffset: current[0]?.sourceStart ?? emptyOffset,
  });
  if (paragraphs.length === 0) {
    paragraphs.push({ graphemes: [], emptyOffset: textLength });
  }
  return paragraphs;
}

function joinParagraphs(paragraphs: Paragraph[]): SourceCluster[] {
  const output: SourceCluster[] = [];
  paragraphs.forEach((paragraph, index) => {
    if (index > 0) {
      const previous = output.at(-1);
      const next = paragraph.graphemes[0];
      const start = previous?.sourceEnd ?? paragraph.emptyOffset;
      const end = next?.sourceStart ?? paragraph.emptyOffset;
      output.push({
        text: " ",
        sourceStart: start,
        sourceEnd: Math.max(start, end),
        synthetic: false,
      });
    }
    output.push(...normalizeParagraphWhitespace(paragraph.graphemes));
  });
  return trimOuterSpaces(output);
}

function classifyTokenGrapheme(value: string): TextTokenKind {
  if (value === " ") return "space";
  if (isNonbreakingSpace(value)) return "nonbreaking-space";
  if (openingPunctuation.has(value)) return "opening-punctuation";
  if (closingPunctuation.has(value)) return "closing-punctuation";
  if (isCjk(value) || isPictographic(value)) {
    return "wrap-unit";
  }
  return "word";
}

function canBreakTokens(tokens: TextToken[], end: number): boolean {
  if (end <= 0 || end >= tokens.length) return true;
  const left = tokens[end - 1]!;
  const right = tokens[end]!;
  if (left.kind === "opening-punctuation") return false;
  if (right.kind === "closing-punctuation") return false;
  return (
    left.kind === "space" ||
    left.kind === "wrap-unit" ||
    left.kind === "closing-punctuation" ||
    right.kind === "wrap-unit" ||
    right.kind === "opening-punctuation"
  );
}

function collectTokenClusters(
  tokens: TextToken[],
  start: number,
  end: number,
): SourceCluster[] {
  const output: SourceCluster[] = [];
  for (let index = start; index < end; index += 1) {
    output.push(...tokens[index]!.graphemes);
  }
  return output;
}

function fitTokenEnd(
  tokens: TextToken[],
  legalEnds: number[],
  start: number,
  maxWidth: number,
  fontSize: number,
  context: PlannerContext,
): number {
  const firstPosition = lowerBound(legalEnds, start + 1, context);
  const firstEnd = legalEnds[firstPosition] ?? tokens.length;
  const fits = (end: number) =>
    measureText(
      clusterText(trimTrailingSpaces(collectTokenClusters(tokens, start, end))),
      fontSize,
      context,
    ).width <=
    maxWidth + 1e-7;
  let passes = takeSearchPass(0, context);
  if (!fits(firstEnd)) return firstEnd;
  let lowPosition = firstPosition;
  let step = 1;
  let highPosition = firstPosition;
  while (highPosition < legalEnds.length - 1) {
    passes = takeSearchPass(passes, context);
    const candidatePosition = Math.min(
      legalEnds.length - 1,
      firstPosition + step,
    );
    const candidateEnd = legalEnds[candidatePosition]!;
    if (!fits(candidateEnd)) {
      highPosition = candidatePosition;
      break;
    }
    lowPosition = candidatePosition;
    if (candidatePosition === legalEnds.length - 1) return candidateEnd;
    step *= 2;
  }
  if (highPosition === lowPosition) return legalEnds[lowPosition]!;
  let low = lowPosition + 1;
  let high = highPosition - 1;
  let best = lowPosition;
  while (low <= high) {
    passes = takeSearchPass(passes, context);
    const middle = Math.floor((low + high) / 2);
    if (fits(legalEnds[middle]!)) {
      best = middle;
      low = middle + 1;
    } else {
      high = middle - 1;
    }
  }
  return legalEnds[best]!;
}

function lowerBound(
  values: number[],
  target: number,
  context: PlannerContext,
): number {
  let low = 0;
  let high = values.length;
  let passes = 0;
  while (low < high) {
    passes = takeSearchPass(passes, context);
    const middle = Math.floor((low + high) / 2);
    if (values[middle]! < target) low = middle + 1;
    else high = middle;
  }
  return low;
}

function rawFits(
  raw: RawLayout,
  style: SceneStyle,
  _availableWidth: number | undefined,
  availableHeight: number | undefined,
  fontSize: number,
  nodeId: string,
): boolean {
  if (!raw.complete || raw.horizontalOverflow) return false;
  const lineHeight = resolveLineHeight(style.lineHeight, fontSize, nodeId);
  if (style.maxLines !== undefined && raw.lines.length > style.maxLines) {
    return false;
  }
  return !(
    availableHeight !== undefined &&
    raw.lines.length * lineHeight > availableHeight + 1e-7
  );
}

function rawLineLimit(
  style: SceneStyle,
  availableHeight: number | undefined,
  fontSize: number,
  budgets: LayoutTextBudgets,
  nodeId: string,
): RawLineLimit {
  const lineHeight = resolveLineHeight(style.lineHeight, fontSize, nodeId);
  const heightLimit =
    availableHeight === undefined
      ? Infinity
      : Math.floor((availableHeight + 1e-7) / lineHeight) + 1;
  const semanticLimit = (style.maxLines ?? Infinity) + 1;
  const semanticSentinel = Math.min(heightLimit, semanticLimit);
  const budgetSentinel = budgets.maxLines + 1;
  return {
    // One sentinel line distinguishes semantic truncation from exhausting the
    // planner's structural budget. Semantic sentinels do not count as output.
    limit: Math.max(1, Math.min(budgetSentinel, semanticSentinel)),
    enforceBudget: semanticSentinel > budgetSentinel,
  };
}

function sourceRange(
  graphemes: PlannedCluster[],
  emptyOffset: number,
): { start: number; end: number } {
  const source = graphemes.filter(isSourceCluster);
  return {
    start: source[0]?.sourceStart ?? emptyOffset,
    end: source.at(-1)?.sourceEnd ?? emptyOffset,
  };
}

function isSourceCluster(grapheme: PlannedCluster): grapheme is SourceCluster {
  return grapheme.synthetic === false;
}

function clusterText(graphemes: readonly PlannedCluster[]): string {
  return graphemes.map((grapheme) => grapheme.text).join("");
}

function trimTrailingSpaces<T extends SourceCluster>(graphemes: T[]): T[] {
  let end = graphemes.length;
  while (end > 0 && graphemes[end - 1]?.text === " ") end -= 1;
  return graphemes.slice(0, end);
}

function trimOuterSpaces(graphemes: SourceCluster[]): SourceCluster[] {
  let start = 0;
  let end = graphemes.length;
  while (start < end && graphemes[start]?.text === " ") start += 1;
  while (end > start && graphemes[end - 1]?.text === " ") end -= 1;
  return graphemes.slice(start, end);
}

function isWhitespace(value: string): boolean {
  if (isNewline(value)) return false;
  const codePoint = value.codePointAt(0) ?? -1;
  return (
    codePoint === 0x0009 ||
    codePoint === 0x000b ||
    codePoint === 0x000c ||
    codePoint === 0x0020 ||
    codePoint === 0x1680 ||
    (codePoint >= 0x2000 && codePoint <= 0x200a) ||
    codePoint === 0x205f ||
    codePoint === 0x3000 ||
    codePoint === 0xfeff
  );
}

function isNewline(value: string): boolean {
  return (
    value === "\n" ||
    value === "\r" ||
    value === "\r\n" ||
    value === "\u2028" ||
    value === "\u2029"
  );
}

function isNonbreakingSpace(value: string): boolean {
  return value === "\u00a0" || value === "\u202f";
}

function isCjk(value: string): boolean {
  const codePoint = value.codePointAt(0) ?? 0;
  return isCjkCodePoint(codePoint);
}

function isCjkCodePoint(codePoint: number): boolean {
  return (
    (codePoint >= 0x2e80 && codePoint <= 0x2fff) ||
    (codePoint >= 0x3040 && codePoint <= 0x30ff) ||
    (codePoint >= 0x3100 && codePoint <= 0x312f) ||
    (codePoint >= 0x31a0 && codePoint <= 0x31bf) ||
    (codePoint >= 0x3400 && codePoint <= 0x4dbf) ||
    (codePoint >= 0x4e00 && codePoint <= 0x9fff) ||
    (codePoint >= 0xac00 && codePoint <= 0xd7af) ||
    (codePoint >= 0xf900 && codePoint <= 0xfaff) ||
    (codePoint >= 0x20000 && codePoint <= 0x323af)
  );
}

function consumeClusterExtenders(text: string, start: number): number {
  let index = start;
  while (index < text.length) {
    const next = readCodePoint(text, index);
    if (
      !isCombiningMark(next.value) &&
      !isVariationSelector(next.value) &&
      !isEmojiModifier(next.value) &&
      !isEmojiTag(next.value)
    ) {
      break;
    }
    index = next.end;
  }
  return index;
}

function readCodePoint(
  text: string,
  index: number,
): { value: number; end: number } {
  const value = text.codePointAt(index);
  if (value === undefined) return { value: 0, end: index };
  return { value, end: index + (value > 0xffff ? 2 : 1) };
}

function isVariationSelector(value: number): boolean {
  return (
    (value >= 0xfe00 && value <= 0xfe0f) ||
    (value >= 0xe0100 && value <= 0xe01ef)
  );
}

function isEmojiModifier(value: number): boolean {
  return value >= 0x1f3fb && value <= 0x1f3ff;
}

function isEmojiTag(value: number): boolean {
  return value >= 0xe0020 && value <= 0xe007f;
}

function isRegionalIndicator(value: number): boolean {
  return value >= 0x1f1e6 && value <= 0x1f1ff;
}

function isRtlStrong(value: number): boolean {
  return inCodePointRanges(value, rtlLetterRanges);
}

function isLtrLetter(value: number): boolean {
  if (value === 0x00d7 || value === 0x00f7) return false;
  return inCodePointRanges(value, ltrLetterRanges);
}

function isCombiningMark(value: number): boolean {
  return inCodePointRanges(value, combiningMarkRanges);
}

function isPictographic(value: string): boolean {
  return inCodePointRanges(value.codePointAt(0) ?? 0, pictographicRanges);
}

function inCodePointRanges(
  value: number,
  ranges: readonly CodePointRange[],
): boolean {
  return ranges.some(([start, end]) => value >= start && value <= end);
}

function resolveTextBudgets(
  options: LayoutTextMeasureOptions,
  nodeId: string,
): LayoutTextBudgets {
  const supplied = options.budgets as unknown;
  if (
    supplied !== undefined &&
    (typeof supplied !== "object" ||
      supplied === null ||
      Array.isArray(supplied))
  ) {
    throw new LayoutCompileError(
      "invalid_geometry",
      "Layout v2 text budgets must be a strict object.",
      ["items", nodeId],
      { id: nodeId },
    );
  }
  if (supplied !== undefined) {
    const prototype = Object.getPrototypeOf(supplied);
    if (prototype !== Object.prototype && prototype !== null) {
      throw new LayoutCompileError(
        "invalid_geometry",
        "Layout v2 text budgets must be a plain strict object.",
        ["items", nodeId],
        { id: nodeId },
      );
    }
  }
  const record = (supplied ?? {}) as Record<string, unknown>;
  const ownKeys = Reflect.ownKeys(record);
  const unknownKeys = ownKeys
    .filter(
      (key) =>
        typeof key !== "string" ||
        !(layoutTextBudgetKeys as readonly string[]).includes(key),
    )
    .map(String);
  if (unknownKeys.length > 0) {
    throw new LayoutCompileError(
      "invalid_geometry",
      `Layout v2 text budgets contain unsupported keys: ${unknownKeys.sort().join(", ")}.`,
      ["items", nodeId],
      { id: nodeId, keys: unknownKeys.sort() },
    );
  }
  const merged: LayoutTextBudgets = {
    maxTextCodeUnits:
      (record.maxTextCodeUnits as number | undefined) ??
      defaultLayoutTextBudgets.maxTextCodeUnits,
    maxGraphemes:
      (record.maxGraphemes as number | undefined) ??
      defaultLayoutTextBudgets.maxGraphemes,
    maxLines:
      (record.maxLines as number | undefined) ??
      defaultLayoutTextBudgets.maxLines,
    maxMeasureCalls:
      options.maxMeasureCalls ??
      (record.maxMeasureCalls as number | undefined) ??
      defaultLayoutTextBudgets.maxMeasureCalls,
    maxBreakSearchPasses:
      (record.maxBreakSearchPasses as number | undefined) ??
      defaultLayoutTextBudgets.maxBreakSearchPasses,
  };
  for (const name of layoutTextBudgetKeys) {
    const value = merged[name];
    const ceiling = layoutTextBudgetCeilings[name];
    if (!Number.isSafeInteger(value) || value < 1 || value > ceiling) {
      throw new LayoutCompileError(
        "invalid_geometry",
        `Layout v2 text budget ${name} must be a positive safe integer no greater than ${ceiling}.`,
        ["items", nodeId],
        { id: nodeId },
      );
    }
  }
  return merged;
}

function optionalDimension(
  value: number | undefined,
  name: string,
  nodeId: string,
): number | undefined {
  if (value === undefined) return undefined;
  if (!Number.isFinite(value) || value < 0 || value > MAX_LAYOUT_TEXT_SCALAR) {
    throw new LayoutCompileError(
      "invalid_geometry",
      `Layout v2 text ${name} for ${JSON.stringify(nodeId)} must be finite, non-negative, and no greater than ${MAX_LAYOUT_TEXT_SCALAR}.`,
      ["items", nodeId],
      { id: nodeId },
    );
  }
  return value;
}

function readFontSize(value: SceneStyle["fontSize"], id: string): number {
  return readAbsoluteSize(value, 24, "fontSize", id);
}

function readMinFontSize(value: SceneStyle["minFontSize"], id: string): number {
  return readAbsoluteSize(value, 12, "minFontSize", id);
}

function readAbsoluteSize(
  value: string | number | undefined,
  fallback: number,
  property: string,
  id: string,
): number {
  if (value === undefined) return fallback;
  const parsed =
    typeof value === "number"
      ? value
      : value.endsWith("px")
        ? Number.parseFloat(value)
        : Number.NaN;
  if (
    Number.isFinite(parsed) &&
    parsed >= MIN_LAYOUT_TEXT_QUANTUM &&
    parsed <= MAX_LAYOUT_TEXT_FONT_SIZE
  ) {
    return parsed;
  }
  throw new LayoutCompileError(
    "invalid_geometry",
    `Layout v2 intrinsic text ${JSON.stringify(id)} needs an absolute positive ${property}; percentages are cyclic before the text box exists.`,
    ["items", id, "style", property],
    { id },
  );
}

function resolveLineHeight(
  value: SceneStyle["lineHeight"],
  fontSize: number,
  id: string,
): number {
  let result: number;
  if (value === undefined) result = fontSize * 1.25;
  else if (typeof value === "number") result = value * fontSize;
  else if (value.endsWith("px")) result = Number.parseFloat(value);
  else if (value.endsWith("%")) {
    result = (Number.parseFloat(value) / 100) * fontSize;
  } else result = Number.NaN;
  if (
    Number.isFinite(result) &&
    result > 0 &&
    result <= MAX_LAYOUT_TEXT_SCALAR
  ) {
    return result;
  }
  throw new LayoutCompileError(
    "invalid_geometry",
    `Layout v2 text ${JSON.stringify(id)} has an invalid lineHeight.`,
    ["items", id, "style", "lineHeight"],
    { id },
  );
}

function resolveQuantum(value: number | undefined, id: string): number {
  const quantum = value ?? 1 / 64;
  if (
    !Number.isFinite(quantum) ||
    quantum < MIN_LAYOUT_TEXT_QUANTUM ||
    quantum > 1000
  ) {
    throw new LayoutCompileError(
      "invalid_geometry",
      `Layout v2 text ${JSON.stringify(id)} has an invalid fontSizeQuantum.`,
      ["items", id],
      { id },
    );
  }
  return quantum;
}

function quantizeDown(value: number, quantum: number, nodeId: string): number {
  return tickSize(
    Math.max(1, Math.floor(value / quantum + 1e-9)),
    quantum,
    nodeId,
  );
}

function tickSize(tick: number, quantum: number, nodeId: string): number {
  if (!Number.isSafeInteger(tick) || tick < 1) {
    throw new LayoutCompileError(
      "invalid_geometry",
      `Layout v2 text ${JSON.stringify(nodeId)} exceeds the safe font-size tick range.`,
      ["items", nodeId],
      { id: nodeId },
    );
  }
  const size = Number((tick * quantum).toFixed(9));
  if (
    !Number.isFinite(size) ||
    size < MIN_LAYOUT_TEXT_QUANTUM ||
    size > MAX_LAYOUT_TEXT_FONT_SIZE
  ) {
    throw new LayoutCompileError(
      "invalid_geometry",
      `Layout v2 text ${JSON.stringify(nodeId)} resolved an out-of-bounds font size.`,
      ["items", nodeId],
      { id: nodeId },
    );
  }
  return size;
}

function textError(
  id: string,
  code: "rich_text_unsafe" | "text_direction_required",
  message: string,
): LayoutCompileError {
  return new LayoutCompileError(code, message, ["items", id], { id });
}

function budgetError(
  id: string,
  subject: string,
  actual: number,
  limit: number,
): LayoutCompileError {
  return new LayoutCompileError(
    "budget_exceeded",
    `Layout v2 text ${JSON.stringify(id)} has ${actual} ${subject}, exceeding the ${limit} limit.`,
    ["items", id],
    { id, actual, limit },
  );
}

function takeSearchPass(current: number, context: PlannerContext): number {
  const next = current + 1;
  if (next > context.budgets.maxBreakSearchPasses) {
    throw budgetError(
      context.nodeId,
      "break search passes",
      next,
      context.budgets.maxBreakSearchPasses,
    );
  }
  return next;
}

function assertMetricScalar(
  value: number,
  field: string,
  nodeId: string,
): void {
  if (!Number.isFinite(value) || value < 0 || value > MAX_LAYOUT_TEXT_SCALAR) {
    throw new LayoutCompileError(
      "invalid_geometry",
      `TextMetricsProvider ${field} for ${JSON.stringify(nodeId)} must be finite, non-negative, and no greater than ${MAX_LAYOUT_TEXT_SCALAR}.`,
      ["items", nodeId],
      { id: nodeId, field },
    );
  }
}

function assertBoundedNumericTree(
  value: unknown,
  nodeId: string,
  label: string,
  path: string[] = [],
  seen = new Set<object>(),
): void {
  if (typeof value === "number") {
    if (!Number.isFinite(value) || Math.abs(value) > MAX_LAYOUT_TEXT_SCALAR) {
      throw new LayoutCompileError(
        "invalid_geometry",
        `Layout v2 ${label} numeric field ${path.join(".") || "<root>"} for ${JSON.stringify(nodeId)} is outside the finite ${MAX_LAYOUT_TEXT_SCALAR} bound.`,
        ["items", nodeId],
        { id: nodeId, field: path.join(".") || "<root>" },
      );
    }
    return;
  }
  if (typeof value !== "object" || value === null) return;
  if (seen.has(value)) {
    throw new LayoutCompileError(
      "invalid_geometry",
      `Layout v2 ${label} for ${JSON.stringify(nodeId)} contains a cycle.`,
      ["items", nodeId],
      { id: nodeId },
    );
  }
  seen.add(value);
  if (Array.isArray(value)) {
    value.forEach((entry, index) =>
      assertBoundedNumericTree(
        entry,
        nodeId,
        label,
        [...path, String(index)],
        seen,
      ),
    );
  } else {
    for (const [key, entry] of Object.entries(value)) {
      assertBoundedNumericTree(entry, nodeId, label, [...path, key], seen);
    }
  }
  seen.delete(value);
}
