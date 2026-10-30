import {
  evaluateScene,
  getLayoutContentRect,
  layoutScene,
  parseAspectRatio,
  resolveMediaMetrics,
  worstMeasurementQuality,
  type LayoutBox,
  type MeasurementQuality,
  type ResolvedMeasurementProvenance,
} from "@motionforge/core";
import {
  validateScene,
  type Scene,
  type SceneAsset,
  type SceneNode,
  type SceneStyle,
} from "@motionforge/schema";
import { parseFontFamilyListValue } from "@motionforge/schema/values";
import {
  LAYOUT_ROOT,
  validateLayoutPlan,
  type GridLayout,
  type LayoutConstraint,
  type LayoutInsetsInput,
  type LayoutItem,
  type LayoutLength,
  type LayoutPlan,
  type LayoutSizing,
  type LayoutTrack,
  type OverlayLayout,
  type StackLayout,
} from "./schema";
import {
  measureLayoutText,
  projectLayoutTextToSceneV1,
  type LayoutTextMeasurement,
} from "./text";
import {
  LayoutCompileError,
  defaultLayoutCompilerBudgets,
  validationIssueError,
  type CompileLayoutOptions,
  type LayoutCompileResult,
  type LayoutCompilerBudgets,
  type LayoutDiagnostic,
  type LayoutItemMeasurement,
  type LayoutRect,
  type TryCompileLayoutResult,
} from "./types";

const EPSILON = 1e-7;
const layoutOwnedAnimationTargets = new Set([
  "width",
  "height",
  "minWidth",
  "minHeight",
  "maxWidth",
  "maxHeight",
  "aspectRatio",
  "position",
  "left",
  "right",
  "top",
  "bottom",
  "inset",
  "margin",
  "marginTop",
  "marginRight",
  "marginBottom",
  "marginLeft",
  "padding",
  "paddingTop",
  "paddingRight",
  "paddingBottom",
  "paddingLeft",
  "safeArea",
  "display",
  "flexDirection",
  "justifyContent",
  "alignItems",
  "gap",
]);
const textPlanningAnimationTargets = new Set([
  "fontSize",
  "lineHeight",
  "letterSpacing",
  "maxLines",
  "minFontSize",
  "textFit",
  "textOverflow",
  "direction",
  "textAlign",
]);

type Insets = { top: number; right: number; bottom: number; left: number };
type Axis = "x" | "y";
type Dimension = "width" | "height";

type Intrinsic = {
  width: number;
  height: number;
  widthMeasurement: ResolvedMeasurementProvenance;
  heightMeasurement: ResolvedMeasurementProvenance;
  textMeasureCalls: number;
  textPlan?: LayoutTextMeasurement;
  font?: NonNullable<LayoutItemMeasurement["font"]>;
};

type WorkItem = {
  index: number;
  item: LayoutItem;
  node: SceneNode;
  widthSizing: LayoutSizing;
  heightSizing: LayoutSizing;
  widthAuto: boolean;
  heightAuto: boolean;
  margins: Insets;
  intrinsic: Intrinsic;
  width: number;
  height: number;
  minWidth: number;
  minHeight: number;
  maxWidth: number;
  maxHeight: number;
  aspectRatio: number | null;
  aspectRatioIsHard: boolean;
  x: number;
  y: number;
};

type SolverState = {
  scene: Scene;
  plan: LayoutPlan;
  options: CompileLayoutOptions;
  budgets: LayoutCompilerBudgets;
  bounds: LayoutRect;
  diagnostics: LayoutDiagnostic[];
  steps: number;
  lines: number;
  tracks: number;
  constraints: number;
  dependencyDepth: number;
  textCharacters: number;
  measuredTextIds: Set<string>;
};

/** Compiles one flat semantic layout plan into ordinary Scene v1 geometry. */
export function compileLayout(
  sceneInput: Scene,
  planInput: unknown,
  options: CompileLayoutOptions = {},
): LayoutCompileResult {
  const planValidation = validateLayoutPlan(planInput);
  if (!planValidation.ok) {
    const first = planValidation.issues[0]!;
    throw new LayoutCompileError("invalid_plan", first.message, first.path, {
      issueCode: first.code,
    });
  }
  return compileValidatedLayout(sceneInput, planValidation.plan, options);
}

export function tryCompileLayout(
  sceneInput: Scene,
  planInput: unknown,
  options: CompileLayoutOptions = {},
): TryCompileLayoutResult {
  const planValidation = validateLayoutPlan(planInput);
  if (!planValidation.ok) {
    return {
      ok: false,
      errors: planValidation.issues.map(validationIssueError),
    };
  }
  try {
    return {
      ok: true,
      result: compileValidatedLayout(sceneInput, planValidation.plan, options),
    };
  } catch (error) {
    if (error instanceof LayoutCompileError) {
      return { ok: false, errors: [error.toJSON()] };
    }
    throw error;
  }
}

function compileValidatedLayout(
  sceneInput: Scene,
  plan: LayoutPlan,
  options: CompileLayoutOptions,
): LayoutCompileResult {
  const sceneValidation = validateScene(sceneInput);
  if (!sceneValidation.ok) {
    throw new LayoutCompileError(
      "invalid_scene",
      `Layout input is not a valid Scene: ${sceneValidation.errors.join(" ")}`,
      [],
      { errors: sceneValidation.errors.slice(0, 16) },
    );
  }
  const scene = sceneValidation.scene;
  const budgets = resolveBudgets(options.budgets);
  if (plan.items.length > budgets.maxItems) {
    budgetError("items", plan.items.length, budgets.maxItems);
  }

  const target = findTarget(scene, plan.containerId);
  const visualChildren = target.children.filter(
    (node) => node.type !== "audio",
  );
  const childById = new Map(visualChildren.map((node) => [node.id, node]));
  for (const [index, item] of plan.items.entries()) {
    const node = childById.get(item.id);
    if (!node) {
      throw new LayoutCompileError(
        "non_child_item",
        `Layout item ${JSON.stringify(item.id)} is not a direct visual child of ${JSON.stringify(plan.containerId)}.`,
        ["items", index, "id"],
        { id: item.id, containerId: plan.containerId },
      );
    }
    rejectLayoutAnimations(node, ["items", index]);
  }
  const plannedIds = new Set(plan.items.map((item) => item.id));
  const unlisted = visualChildren.filter((node) => !plannedIds.has(node.id));
  if (unlisted.length > 0) {
    throw new LayoutCompileError(
      "unlisted_child",
      `Layout plan must list every direct visual child; missing ${unlisted.map((node) => JSON.stringify(node.id)).join(", ")}.`,
      ["items"],
      { ids: unlisted.map((node) => node.id) },
    );
  }
  if (target.container)
    rejectLayoutAnimations(target.container, ["containerId"]);

  const baseBounds = resolveContainerBounds(scene, plan.containerId, options);
  const bounds = insetRect(
    insetRect(baseBounds, resolveInsets(plan.layout.safeArea, baseBounds)),
    resolveInsets(plan.layout.padding, baseBounds),
  );
  if (bounds.width < 0 || bounds.height < 0) {
    throw new LayoutCompileError(
      "invalid_geometry",
      "Safe-area and padding insets exceed the available container.",
      ["layout"],
    );
  }
  const constraintCount = plan.items.reduce(
    (sum, item) => sum + (item.constraints?.length ?? 0),
    0,
  );
  if (constraintCount > budgets.maxConstraints) {
    budgetError("constraints", constraintCount, budgets.maxConstraints);
  }

  const state: SolverState = {
    scene,
    plan,
    options,
    budgets,
    bounds,
    diagnostics: [],
    steps: 0,
    lines: 0,
    tracks: 0,
    constraints: constraintCount,
    dependencyDepth: 0,
    textCharacters: 0,
    measuredTextIds: new Set(),
  };
  const work = plan.items.map((item, index) =>
    prepareWorkItem(item, childById.get(item.id)!, index, state),
  );

  switch (plan.layout.kind) {
    case "stack":
      solveStack(work, plan.layout, state);
      break;
    case "grid":
      solveGrid(work, plan.layout, state);
      break;
    case "overlay":
      solveOverlay(work, plan.layout, state);
      break;
  }
  for (const entry of work) finalizeTextPlan(entry, state);
  work.forEach((entry) => {
    assertFiniteRect(entry, state);
    assertAspectRatio(entry);
    if (!containsRect(state.bounds, entry)) {
      throw new LayoutCompileError(
        "insufficient_space",
        `Layout item ${JSON.stringify(entry.item.id)} escapes the bounded container; reduce its size/offset or increase available space.`,
        ["items", entry.index],
        { id: entry.item.id },
      );
    }
  });

  const replacements = new Map(
    work.map((entry) => [entry.node.id, compiledNode(entry, state)]),
  );
  if (
    target.container &&
    legacyContainerLayoutKeys.some(
      (key) => target.container?.style?.[key] !== undefined,
    )
  ) {
    state.diagnostics.push({
      severity: "info",
      code: "layout_style_replaced",
      message: `Semantic layout replaced legacy flex fields on container ${JSON.stringify(target.container.id)}.`,
      path: ["containerId"],
      itemId: target.container.id,
    });
  }
  replaceTargetChildren(scene, plan.containerId, replacements);
  const outputValidation = validateScene(scene);
  if (!outputValidation.ok) {
    throw new LayoutCompileError(
      "invalid_geometry",
      `Layout compiler produced an invalid Scene: ${outputValidation.errors.join(" ")}`,
      [],
      { errors: outputValidation.errors.slice(0, 16) },
    );
  }
  const measurements = work.map(toMeasurement);
  const result: LayoutCompileResult = {
    scene: outputValidation.scene,
    plan: structuredClone(plan),
    container: { ...bounds },
    measurements,
    diagnostics: state.diagnostics.map((diagnostic) => ({
      ...diagnostic,
      path: [...diagnostic.path],
    })),
    stats: {
      items: work.length,
      tracks: state.tracks,
      lines: state.lines,
      constraints: state.constraints,
      dependencyDepth: state.dependencyDepth,
      textCharacters: state.textCharacters,
      estimatedMeasurements: measurements.filter(
        (measurement) => measurement.measurement === "estimated",
      ).length,
    },
  };
  assertStrictJson(result);
  return result;
}

function prepareWorkItem(
  item: LayoutItem,
  node: SceneNode,
  index: number,
  state: SolverState,
): WorkItem {
  const style = node.style ?? {};
  const widthSizing = item.width ?? style.width ?? "hug";
  const heightSizing = item.height ?? style.height ?? "hug";
  const widthAuto = item.width === undefined && style.width === undefined;
  const heightAuto = item.height === undefined && style.height === undefined;
  const authoredRatio = item.aspectRatio ?? parseAspectRatio(style.aspectRatio);
  const visualMedia =
    node.type === "img" || node.type === "video" || node.type === "lottie";
  const margins = item.margin
    ? resolveInsets(item.margin, state.bounds)
    : resolveSceneMargins(style, state.bounds);
  const needsIntrinsicWidth =
    widthSizing === "hug" &&
    !(visualMedia && authoredRatio && heightSizing !== "hug");
  const needsIntrinsicHeight =
    heightSizing === "hug" &&
    !(visualMedia && authoredRatio && widthSizing !== "hug");
  const intrinsic = measureIntrinsic(
    node,
    needsIntrinsicWidth,
    needsIntrinsicHeight,
    undefined,
    state,
  );
  assertIntrinsicBounds(intrinsic, item.id, index, state);
  const minWidth = resolveLength(
    item.minWidth ?? style.minWidth,
    state.bounds.width,
    0,
  );
  const minHeight = resolveLength(
    item.minHeight ?? style.minHeight,
    state.bounds.height,
    0,
  );
  const maxWidth = resolveLength(
    item.maxWidth ?? style.maxWidth,
    state.bounds.width,
    Number.POSITIVE_INFINITY,
  );
  const maxHeight = resolveLength(
    item.maxHeight ?? style.maxHeight,
    state.bounds.height,
    Number.POSITIVE_INFINITY,
  );
  if (minWidth > maxWidth || minHeight > maxHeight) {
    throw new LayoutCompileError(
      "invalid_geometry",
      `Layout item ${JSON.stringify(item.id)} has min size greater than max size.`,
      ["items", index],
      { id: item.id },
    );
  }
  let width = sizingBase(widthSizing, state.bounds.width, intrinsic.width);
  let height = sizingBase(heightSizing, state.bounds.height, intrinsic.height);
  const ratio =
    authoredRatio ??
    (intrinsic.width > 0 && intrinsic.height > 0
      ? intrinsic.width / intrinsic.height
      : null);
  if (ratio) {
    if (widthSizing !== "hug" && heightSizing === "hug") height = width / ratio;
    else if (heightSizing !== "hug" && widthSizing === "hug")
      width = height * ratio;
    else if (widthSizing === "hug" && heightSizing === "hug" && authoredRatio) {
      if (width > 0) height = width / ratio;
      else if (height > 0) width = height * ratio;
    }
  }
  width = clamp(width, minWidth, maxWidth);
  height = clamp(height, minHeight, maxHeight);
  return {
    index,
    item,
    node,
    widthSizing,
    heightSizing,
    widthAuto,
    heightAuto,
    margins,
    intrinsic,
    width,
    height,
    minWidth,
    minHeight,
    maxWidth,
    maxHeight,
    aspectRatio: ratio,
    aspectRatioIsHard: authoredRatio !== null,
    x: 0,
    y: 0,
  };
}

function measureIntrinsic(
  node: SceneNode,
  needsWidth: boolean,
  needsHeight: boolean,
  availableWidth: number | undefined,
  state: SolverState,
  availableHeight?: number,
): Intrinsic {
  const declared: ResolvedMeasurementProvenance = {
    measurement: "declared",
    reason: "explicit Scene/Layout size",
  };
  if (!needsWidth && !needsHeight) {
    return {
      width: 0,
      height: 0,
      widthMeasurement: declared,
      heightMeasurement: declared,
      textMeasureCalls: 0,
    };
  }
  if (node.type === "text") {
    if (node.runs && (state.options.richTextPolicy ?? "reject") === "reject") {
      throw new LayoutCompileError(
        "rich_text_unsafe",
        `Layout v2 cannot intrinsically plan rich text node ${JSON.stringify(node.id)} without the explicit legacy-unsafe policy.`,
        ["items", node.id],
        { id: node.id },
      );
    }
    const text = node.text ?? node.runs?.map((run) => run.text).join("") ?? "";
    if (!state.measuredTextIds.has(node.id)) {
      state.measuredTextIds.add(node.id);
      state.textCharacters += text.length;
    }
    if (state.textCharacters > state.budgets.maxTextCharacters) {
      budgetError(
        "text characters",
        state.textCharacters,
        state.budgets.maxTextCharacters,
      );
    }
    const font = resolveTextFont(node, state);
    let measured: ReturnType<typeof measureLayoutText>;
    try {
      measured = measureLayoutText(font.node, {
        ...(availableWidth === undefined ? {} : { availableWidth }),
        ...(availableHeight === undefined ? {} : { availableHeight }),
        provider: state.options.textMetrics,
        richTextPolicy: state.options.richTextPolicy ?? "reject",
        maxMeasureCalls: Math.max(
          16,
          Math.min(16_384, state.budgets.maxSolverSteps - state.steps),
        ),
      });
    } catch (error) {
      if (error instanceof LayoutCompileError) throw error;
      throw new LayoutCompileError(
        "invalid_geometry",
        `Text metrics failed for layout item ${JSON.stringify(node.id)}: ${safeErrorMessage(error)}.`,
        ["items", node.id],
        { id: node.id },
      );
    }
    step(state, measured.measureCalls);
    if (measured.fit.status === "clamped") {
      state.diagnostics.push({
        severity: "warning",
        code: "text_fit_clamped",
        message: `Text item ${JSON.stringify(node.id)} reached its configured fitting boundary.`,
        path: ["items", node.id],
        itemId: node.id,
      });
    } else if (measured.fit.status === "impossible") {
      state.diagnostics.push({
        severity: "warning",
        code: "text_fit_impossible",
        message: `Text item ${JSON.stringify(node.id)} cannot fully fit even at its configured minimum.`,
        path: ["items", node.id],
        itemId: node.id,
      });
    }
    if (measured.fit.truncated) {
      state.diagnostics.push({
        severity: "warning",
        code: "text_truncated",
        message: `Text item ${JSON.stringify(node.id)} was deterministically truncated by its fit policy.`,
        path: ["items", node.id],
        itemId: node.id,
      });
    }
    for (const diagnostic of measured.diagnostics) {
      state.diagnostics.push({
        severity: "warning",
        code: "unsafe_text_planning",
        message: diagnostic.message,
        path: ["items", node.id],
        itemId: node.id,
      });
    }
    if (measured.measurement === "estimated") {
      estimatedDiagnostic(node.id, measured.reason, state);
    }
    return {
      width: measured.width,
      height: measured.height,
      widthMeasurement: measured.fieldMeasurements.width,
      heightMeasurement: measured.fieldMeasurements.height,
      textMeasureCalls: measured.measureCalls,
      textPlan: measured,
      font: font.evidence,
    };
  }
  if (node.type === "img" || node.type === "video" || node.type === "lottie") {
    const asset = state.scene.assets[node.assetId!];
    return mediaIntrinsic(node, asset!, state);
  }
  const box = intrinsicChildUnion(node);
  const estimated: ResolvedMeasurementProvenance = {
    measurement: "estimated",
    reason: box.reason,
  };
  estimatedDiagnostic(node.id, box.reason, state);
  return {
    width: box.width,
    height: box.height,
    widthMeasurement: estimated,
    heightMeasurement: estimated,
    textMeasureCalls: 0,
  };
}

function finalizeTextPlan(entry: WorkItem, state: SolverState): void {
  if (entry.node.type !== "text") return;
  entry.intrinsic = measureIntrinsic(
    entry.node,
    true,
    true,
    entry.width,
    state,
    entry.height,
  );
}

function mediaIntrinsic(
  node: SceneNode,
  asset: SceneAsset,
  state: SolverState,
): Intrinsic {
  let metrics: ReturnType<typeof resolveMediaMetrics>;
  try {
    metrics = resolveMediaMetrics(asset, state.options.mediaMetrics);
  } catch (error) {
    throw new LayoutCompileError(
      "missing_intrinsic_metrics",
      `Media metrics failed for layout item ${JSON.stringify(node.id)}: ${safeErrorMessage(error)}.`,
      ["items", node.id],
      { id: node.id, assetId: asset.id },
    );
  }
  let width = metrics.width;
  let height = metrics.height;
  let widthMeasurement = metrics.fieldMeasurements.width;
  let heightMeasurement = metrics.fieldMeasurements.height;
  if (width === undefined || height === undefined) {
    const policy = state.options.missingMediaMetrics ?? { mode: "error" };
    if (policy.mode === "error") {
      throw new LayoutCompileError(
        "missing_intrinsic_metrics",
        `Intrinsic ${asset.type} dimensions are unavailable for layout item ${JSON.stringify(node.id)}. Supply prepared/declared metrics, fixed dimensions, or an explicit fallback policy.`,
        ["items", node.id],
        { id: node.id, assetId: asset.id, assetType: asset.type },
      );
    }
    const fallback =
      asset.type === "image" ||
      asset.type === "video" ||
      asset.type === "lottie"
        ? policy.sizes[asset.type]
        : undefined;
    if (!fallback) {
      throw new LayoutCompileError(
        "missing_intrinsic_metrics",
        `Fallback policy has no ${asset.type} size for layout item ${JSON.stringify(node.id)}.`,
        ["items", node.id],
        { id: node.id, assetId: asset.id, assetType: asset.type },
      );
    }
    if (
      !Number.isFinite(fallback.width) ||
      fallback.width <= 0 ||
      !Number.isFinite(fallback.height) ||
      fallback.height <= 0
    ) {
      throw new LayoutCompileError(
        "invalid_geometry",
        `Fallback dimensions for ${asset.type} must be finite and positive.`,
        ["options", "missingMediaMetrics", "sizes", asset.type],
        { assetType: asset.type },
      );
    }
    const fallbackProvenance: ResolvedMeasurementProvenance = {
      measurement: "estimated",
      reason: `explicit host ${asset.type} fallback`,
    };
    width ??= fallback.width;
    height ??= fallback.height;
    widthMeasurement ??= fallbackProvenance;
    heightMeasurement ??= fallbackProvenance;
  }
  widthMeasurement ??= {
    measurement: "estimated",
    reason: "intrinsic width unavailable",
  };
  heightMeasurement ??= {
    measurement: "estimated",
    reason: "intrinsic height unavailable",
  };
  if (
    widthMeasurement.measurement === "estimated" ||
    heightMeasurement.measurement === "estimated"
  ) {
    estimatedDiagnostic(
      node.id,
      `${widthMeasurement.reason}; ${heightMeasurement.reason}`,
      state,
    );
  }
  return {
    width,
    height,
    widthMeasurement,
    heightMeasurement,
    textMeasureCalls: 0,
  };
}

function resolveTextFont(
  node: SceneNode,
  state: SolverState,
): {
  node: SceneNode;
  evidence: NonNullable<LayoutItemMeasurement["font"]>;
} {
  const authored = node.style?.fontFamily ?? "system-ui, sans-serif";
  const families = parseFontFamilyListValue(authored);
  if (!families) {
    throw new LayoutCompileError(
      "invalid_geometry",
      `Text item ${JSON.stringify(node.id)} has an invalid font-family list.`,
      ["items", node.id, "style", "fontFamily"],
      { id: node.id },
    );
  }
  const fontAssets = new Map(
    Object.values(state.scene.assets)
      .filter((asset) => asset.type === "font")
      .map((asset) => [asset.id, asset]),
  );
  const selected = families.find((entry) => fontAssets.has(entry.family));
  const policy = state.options.fontFallbackPolicy ?? "require-prepared";
  if (selected) {
    const exactFamily = parseFontFamilyListValue(selected.family);
    if (
      exactFamily?.length !== 1 ||
      exactFamily[0]?.family !== selected.family
    ) {
      throw new LayoutCompileError(
        "missing_prepared_font",
        `Declared font asset id ${JSON.stringify(selected.family)} cannot be represented as one exact Scene font family. Use a single-family-safe asset id without comma or quote escapes.`,
        ["items", node.id, "style", "fontFamily"],
        { id: node.id, assetId: selected.family },
      );
    }
    if (!state.options.textMetrics && policy === "require-prepared") {
      throw new LayoutCompileError(
        "missing_prepared_font",
        `Text item ${JSON.stringify(node.id)} selected declared font asset ${JSON.stringify(selected.family)} but no prepared TextMetricsProvider was supplied.`,
        ["items", node.id, "style", "fontFamily"],
        { id: node.id, assetId: selected.family },
      );
    }
    pushDiagnosticOnce(state, {
      severity: "info",
      code: "prepared_font_selected",
      message: `Text item ${JSON.stringify(node.id)} selected declared font asset ${JSON.stringify(selected.family)}.`,
      path: ["items", node.id, "style", "fontFamily"],
      itemId: node.id,
    });
    return {
      node: {
        ...node,
        style: { ...(node.style ?? {}), fontFamily: selected.family },
      },
      evidence: {
        family: selected.family,
        assetId: selected.family,
        measurement: "declared",
        reason: "first declared font asset in authored family order",
      },
    };
  }
  if (policy === "require-prepared") {
    throw new LayoutCompileError(
      "missing_prepared_font",
      `Text item ${JSON.stringify(node.id)} has no declared font asset in ${JSON.stringify(authored)}. Add a font asset/family or explicitly allow system fallback.`,
      ["items", node.id, "style", "fontFamily"],
      { id: node.id, fontFamily: authored },
    );
  }
  pushDiagnosticOnce(state, {
    severity: "warning",
    code: "system_font_fallback",
    message: `Text item ${JSON.stringify(node.id)} uses host system font fallback ${JSON.stringify(authored)}; cross-host pixels may differ.`,
    path: ["items", node.id, "style", "fontFamily"],
    itemId: node.id,
  });
  return {
    node,
    evidence: {
      family: authored,
      assetId: null,
      measurement: "estimated",
      reason: "explicit allow-system fallback policy",
    },
  };
}

function solveStack(
  work: WorkItem[],
  layout: StackLayout,
  state: SolverState,
): void {
  const row = layout.axis === "row";
  const mainSpace = row ? state.bounds.width : state.bounds.height;
  const crossSpace = row ? state.bounds.height : state.bounds.width;
  const mainGap = resolveLength(
    row ? (layout.columnGap ?? layout.gap) : (layout.rowGap ?? layout.gap),
    mainSpace,
    0,
  );
  const crossGap = resolveLength(
    row ? (layout.rowGap ?? layout.gap) : (layout.columnGap ?? layout.gap),
    crossSpace,
    0,
  );

  // Column text must know its cross-axis width before intrinsic height is a
  // meaningful main-axis basis.
  for (const entry of work) {
    const crossSizing = row ? entry.heightSizing : entry.widthSizing;
    const align = entry.item.alignSelf ?? layout.align ?? "start";
    if (crossSizing === "fill") {
      setCrossSize(
        entry,
        row,
        layout.wrap === "wrap"
          ? row
            ? entry.intrinsic.height
            : entry.intrinsic.width
          : Math.max(0, crossSpace - crossMargins(entry, row)),
      );
    } else if (
      layout.wrap !== "wrap" &&
      align === "stretch" &&
      (row ? entry.heightAuto : entry.widthAuto)
    ) {
      setCrossSize(
        entry,
        row,
        Math.max(0, crossSpace - crossMargins(entry, row)),
      );
    }
    refreshMainFromAvailableCross(entry, row, crossSpace);
    if (!row) refreshTextHeight(entry, entry.width, state);
  }

  const lines: WorkItem[][] = [];
  let current: WorkItem[] = [];
  let used = 0;
  for (const entry of work) {
    const outer = mainSize(entry, row) + mainMargins(entry, row);
    const next = current.length === 0 ? outer : used + mainGap + outer;
    if (
      layout.wrap === "wrap" &&
      current.length > 0 &&
      next > mainSpace + EPSILON
    ) {
      lines.push(current);
      current = [entry];
      used = outer;
    } else {
      current.push(entry);
      used = next;
    }
  }
  if (current.length > 0) lines.push(current);
  state.lines += lines.length;

  type Line = { entries: WorkItem[]; crossSize: number; crossStart: number };
  const solvedLines: Line[] = [];
  for (const entries of lines) {
    distributeMain(
      entries,
      row,
      mainSpace,
      mainGap,
      layout.justify ?? "start",
      state,
    );
    if (row) {
      for (const entry of entries) refreshTextHeight(entry, entry.width, state);
    } else {
      for (const entry of entries) refreshWidthFromHeight(entry);
    }
    const naturalCross = entries.reduce(
      (max, entry) =>
        Math.max(max, crossSize(entry, row) + crossMargins(entry, row)),
      0,
    );
    solvedLines.push({
      entries,
      crossSize: layout.wrap === "wrap" ? naturalCross : crossSpace,
      crossStart: 0,
    });
  }
  distributeCrossLines(
    solvedLines,
    crossSpace,
    crossGap,
    layout.alignContent ?? (layout.wrap === "wrap" ? "stretch" : "start"),
    state,
  );

  if (
    layout.wrap === "wrap" &&
    layout.alignContent !== undefined &&
    layout.alignContent !== "stretch"
  ) {
    const collapsed = solvedLines.find(
      (line) =>
        line.crossSize <= EPSILON &&
        line.entries.some(
          (entry) => (row ? entry.heightSizing : entry.widthSizing) === "fill",
        ),
    );
    if (collapsed) {
      throw new LayoutCompileError(
        "insufficient_space",
        "Wrapped cross-axis fill has no intrinsic line size under the selected alignContent; use stretch or provide a cross size.",
        ["layout", "alignContent"],
      );
    }
  }

  for (const line of solvedLines) {
    for (const entry of line.entries) {
      const align = entry.item.alignSelf ?? layout.align ?? "start";
      const margins = crossMarginPair(entry, row);
      if (
        (row ? entry.heightSizing : entry.widthSizing) === "fill" ||
        (align === "stretch" && (row ? entry.heightAuto : entry.widthAuto))
      ) {
        setCrossSize(
          entry,
          row,
          Math.max(0, line.crossSize - margins.start - margins.end),
        );
        if (!row) refreshTextHeight(entry, entry.width, state);
      }
      const available =
        line.crossSize - crossSize(entry, row) - margins.start - margins.end;
      const offset =
        align === "center" ? available / 2 : align === "end" ? available : 0;
      setCrossPosition(
        entry,
        row,
        crossOrigin(state.bounds, row) +
          line.crossStart +
          margins.start +
          offset,
      );
    }
  }
}

function distributeMain(
  entries: WorkItem[],
  row: boolean,
  mainSpace: number,
  gap: number,
  justify: StackLayout["justify"] extends infer T ? NonNullable<T> : never,
  state: SolverState,
): void {
  const gaps = Math.max(0, entries.length - 1) * gap;
  const margins = entries.reduce(
    (sum, entry) => sum + mainMargins(entry, row),
    0,
  );
  const availableForSizes = Math.max(0, mainSpace - gaps - margins);
  distributeSizes(entries, row, availableForSizes, state);
  const usedSizes = entries.reduce(
    (sum, entry) => sum + mainSize(entry, row),
    0,
  );
  let leftover = mainSpace - gaps - margins - usedSizes;
  if (leftover < -EPSILON) {
    throw new LayoutCompileError(
      "insufficient_space",
      `Stack needs ${formatNumber(-leftover)} more pixels on its ${row ? "row" : "column"} axis after bounded shrink.`,
      ["layout"],
    );
  }
  leftover = Math.max(0, leftover);
  let start = 0;
  let extraGap = 0;
  if (justify === "center") start = leftover / 2;
  else if (justify === "end") start = leftover;
  else if (justify === "space-between" && entries.length > 1)
    extraGap = leftover / (entries.length - 1);
  else if (justify === "space-around" && entries.length > 0) {
    extraGap = leftover / entries.length;
    start = extraGap / 2;
  } else if (justify === "space-evenly" && entries.length > 0) {
    extraGap = leftover / (entries.length + 1);
    start = extraGap;
  }
  let cursor = mainOrigin(state.bounds, row) + start;
  for (const entry of entries) {
    const marginsForItem = mainMarginPair(entry, row);
    cursor += marginsForItem.start;
    setMainPosition(entry, row, cursor);
    cursor += mainSize(entry, row) + marginsForItem.end + gap + extraGap;
  }
}

function distributeSizes(
  entries: WorkItem[],
  row: boolean,
  available: number,
  state: SolverState,
): void {
  let total = entries.reduce((sum, entry) => sum + mainSize(entry, row), 0);
  if (total < available - EPSILON) {
    let free = available - total;
    let active = entries.filter(
      (entry) =>
        growWeight(entry, row) > 0 &&
        mainSize(entry, row) < mainMax(entry, row) - EPSILON,
    );
    while (free > EPSILON && active.length > 0) {
      step(state, active.length);
      const totalWeight = active.reduce(
        (sum, entry) => sum + growWeight(entry, row),
        0,
      );
      let consumed = 0;
      for (const entry of active) {
        const before = mainSize(entry, row);
        const after = clampMain(
          entry,
          row,
          before + free * (growWeight(entry, row) / totalWeight),
        );
        setMainSize(entry, row, after);
        consumed += after - before;
      }
      if (consumed <= EPSILON) break;
      free -= consumed;
      active = active.filter(
        (entry) => mainSize(entry, row) < mainMax(entry, row) - EPSILON,
      );
    }
    return;
  }
  let deficit = total - available;
  let active = entries.filter(
    (entry) =>
      shrinkWeight(entry, row) > 0 &&
      mainSize(entry, row) > mainMin(entry, row) + EPSILON,
  );
  while (deficit > EPSILON && active.length > 0) {
    step(state, active.length);
    const weighted = active.map(
      (entry) => shrinkWeight(entry, row) * Math.max(1, mainSize(entry, row)),
    );
    const totalWeight = weighted.reduce((sum, value) => sum + value, 0);
    let consumed = 0;
    active.forEach((entry, index) => {
      const share = deficit * ((weighted[index] ?? 0) / totalWeight);
      const before = mainSize(entry, row);
      const after = Math.max(mainMin(entry, row), before - share);
      setMainSize(entry, row, after);
      consumed += before - after;
    });
    if (consumed <= EPSILON) break;
    deficit -= consumed;
    active = active.filter(
      (entry) => mainSize(entry, row) > mainMin(entry, row) + EPSILON,
    );
  }
  total = entries.reduce((sum, entry) => sum + mainSize(entry, row), 0);
  if (total > available + EPSILON) {
    throw new LayoutCompileError(
      "insufficient_space",
      `Layout cannot shrink ${formatNumber(total)} pixels of content into ${formatNumber(available)} pixels without violating fixed/min sizes.`,
      ["items"],
    );
  }
}

function distributeCrossLines(
  lines: Array<{ crossSize: number; crossStart: number }>,
  space: number,
  gap: number,
  align: NonNullable<StackLayout["alignContent"]>,
  state: SolverState,
): void {
  const base = lines.reduce((sum, line) => sum + line.crossSize, 0);
  const gaps = Math.max(0, lines.length - 1) * gap;
  let free = space - base - gaps;
  if (free < -EPSILON) {
    throw new LayoutCompileError(
      "insufficient_space",
      `Wrapped stack lines exceed the cross axis by ${formatNumber(-free)} pixels.`,
      ["layout", "alignContent"],
    );
  }
  free = Math.max(0, free);
  let start = 0;
  let extraGap = 0;
  if (align === "stretch" && lines.length > 0) {
    const addition = free / lines.length;
    lines.forEach((line) => (line.crossSize += addition));
    free = 0;
  } else if (align === "center") start = free / 2;
  else if (align === "end") start = free;
  else if (align === "space-between" && lines.length > 1)
    extraGap = free / (lines.length - 1);
  else if (align === "space-around" && lines.length > 0) {
    extraGap = free / lines.length;
    start = extraGap / 2;
  } else if (align === "space-evenly" && lines.length > 0) {
    extraGap = free / (lines.length + 1);
    start = extraGap;
  }
  let cursor = start;
  for (const line of lines) {
    line.crossStart = cursor;
    cursor += line.crossSize + gap + extraGap;
  }
  step(state, lines.length);
}

type GridPlacement = {
  item: WorkItem;
  row: number;
  column: number;
  rowSpan: number;
  columnSpan: number;
};

function solveGrid(
  work: WorkItem[],
  layout: GridLayout,
  state: SolverState,
): void {
  const placements = placeGridItems(work, layout, state);
  const rowCount = placements.reduce(
    (max, placement) => Math.max(max, placement.row + placement.rowSpan),
    layout.rows?.length ?? 0,
  );
  const projectedTracks =
    layout.columns.length + (layout.rows?.length ?? rowCount);
  if (projectedTracks > state.budgets.maxTracks) {
    budgetError("tracks", projectedTracks, state.budgets.maxTracks);
  }
  const rows = layout.rows
    ? layout.rows.map((track) => ({ ...track }))
    : Array.from({ length: rowCount }, () => ({ size: "fill" as const }));
  const columns = layout.columns.map((track) => ({ ...track }));
  state.tracks += rows.length + columns.length;
  if (state.tracks > state.budgets.maxTracks) {
    budgetError("tracks", state.tracks, state.budgets.maxTracks);
  }
  const columnGap = resolveLength(
    layout.columnGap ?? layout.gap,
    state.bounds.width,
    0,
  );
  const rowGap = resolveLength(
    layout.rowGap ?? layout.gap,
    state.bounds.height,
    0,
  );
  const columnSizes = solveTracks(
    columns,
    state.bounds.width,
    columnGap,
    placements.map((placement) => ({
      start: placement.column,
      span: placement.columnSpan,
      intrinsic:
        Math.max(placement.item.intrinsic.width, placement.item.width) +
        placement.item.margins.left +
        placement.item.margins.right,
    })),
    state,
    "columns",
  );
  for (const placement of placements) {
    const cellWidth = spanSize(
      columnSizes,
      placement.column,
      placement.columnSpan,
      columnGap,
    );
    const item = placement.item;
    const horizontalMargins = item.margins.left + item.margins.right;
    if (item.widthSizing === "fill") {
      item.width = clamp(
        Math.max(0, cellWidth - horizontalMargins),
        item.minWidth,
        item.maxWidth,
      );
    }
    refreshTextHeight(item, item.width, state);
  }
  const rowSizes = solveTracks(
    rows,
    state.bounds.height,
    rowGap,
    placements.map((placement) => ({
      start: placement.row,
      span: placement.rowSpan,
      intrinsic:
        Math.max(placement.item.intrinsic.height, placement.item.height) +
        placement.item.margins.top +
        placement.item.margins.bottom,
    })),
    state,
    "rows",
  );
  const columnStarts = trackStarts(columnSizes, columnGap, state.bounds.x);
  const rowStarts = trackStarts(rowSizes, rowGap, state.bounds.y);
  for (const placement of placements) {
    const item = placement.item;
    const cell: LayoutRect = {
      x: columnStarts[placement.column]!,
      y: rowStarts[placement.row]!,
      width: spanSize(
        columnSizes,
        placement.column,
        placement.columnSpan,
        columnGap,
      ),
      height: spanSize(rowSizes, placement.row, placement.rowSpan, rowGap),
    };
    placeInCell(
      item,
      cell,
      item.item.justifySelf ?? layout.justifyItems ?? "stretch",
      item.item.alignSelf ?? layout.alignItems ?? "stretch",
      state,
    );
    if (!containsRect(cell, item)) {
      throw new LayoutCompileError(
        "insufficient_space",
        `Grid item ${JSON.stringify(item.item.id)} does not fit its assigned cell.`,
        ["items", item.index],
        { id: item.item.id, row: placement.row, column: placement.column },
      );
    }
  }
  state.lines += rows.length;
}

function placeGridItems(
  work: WorkItem[],
  layout: GridLayout,
  state: SolverState,
): GridPlacement[] {
  const columnCount = layout.columns.length;
  const fixedRows = layout.rows?.length;
  const maxRows = Math.max(0, state.budgets.maxTracks - columnCount);
  const occupied = new Set<string>();
  const placementById = new Map<string, GridPlacement>();
  let cursor = 0;
  const flow = layout.autoFlow ?? "row";
  const fits = (
    row: number,
    column: number,
    rowSpan: number,
    columnSpan: number,
  ) => {
    if (column + columnSpan > columnCount) return false;
    if (fixedRows !== undefined && row + rowSpan > fixedRows) return false;
    if (row + rowSpan > maxRows) return false;
    for (let y = row; y < row + rowSpan; y += 1) {
      for (let x = column; x < column + columnSpan; x += 1) {
        if (occupied.has(`${y}:${x}`)) return false;
      }
    }
    return true;
  };

  const reserve = (placement: GridPlacement): void => {
    for (let y = placement.row; y < placement.row + placement.rowSpan; y += 1) {
      for (
        let x = placement.column;
        x < placement.column + placement.columnSpan;
        x += 1
      ) {
        occupied.add(`${y}:${x}`);
      }
    }
    placementById.set(placement.item.item.id, placement);
  };

  // Explicit cells reserve their complete spans before auto placement. This
  // is stable, prevents an earlier auto item from stealing a later declared
  // cell, and remains deliberately non-dense for the remaining items.
  for (const item of work) {
    const rowSpan = item.item.grid?.rowSpan ?? 1;
    const columnSpan = item.item.grid?.columnSpan ?? 1;
    const row = item.item.grid?.row;
    const column = item.item.grid?.column;
    if ((row === undefined) !== (column === undefined)) {
      throw new LayoutCompileError(
        "grid_out_of_bounds",
        `Grid item ${JSON.stringify(item.item.id)} must specify both row and column or neither.`,
        ["items", item.index, "grid"],
      );
    }
    if (row === undefined || column === undefined) {
      continue;
    }
    if (row + rowSpan > maxRows) {
      budgetError(
        "tracks",
        columnCount + row + rowSpan,
        state.budgets.maxTracks,
      );
    }
    if (!fits(row, column, rowSpan, columnSpan)) {
      const out =
        column + columnSpan > columnCount ||
        (fixedRows !== undefined && row + rowSpan > fixedRows);
      throw new LayoutCompileError(
        out ? "grid_out_of_bounds" : "grid_collision",
        `Grid placement for ${JSON.stringify(item.item.id)} ${out ? "exceeds declared tracks" : "overlaps an occupied cell"}.`,
        ["items", item.index, "grid"],
        {
          id: item.item.id,
          row,
          column,
          rowSpan,
          columnSpan,
        },
      );
    }
    reserve({ item, row, column, rowSpan, columnSpan });
  }

  for (const item of work) {
    if (placementById.has(item.item.id)) continue;
    const rowSpan = item.item.grid?.rowSpan ?? 1;
    const columnSpan = item.item.grid?.columnSpan ?? 1;
    let found: GridPlacement | undefined;
    const rowCapacity = Math.max(1, fixedRows ?? work.length);
    for (let scan = cursor; scan < state.budgets.maxSolverSteps; scan += 1) {
      step(state);
      const row =
        flow === "row" ? Math.floor(scan / columnCount) : scan % rowCapacity;
      const column =
        flow === "row" ? scan % columnCount : Math.floor(scan / rowCapacity);
      if (fits(row, column, rowSpan, columnSpan)) {
        found = { item, row, column, rowSpan, columnSpan };
        cursor = scan + 1;
        break;
      }
    }
    if (!found) {
      budgetError(
        "grid placement steps",
        state.steps,
        state.budgets.maxSolverSteps,
      );
    }
    reserve(found);
  }
  return work.map((item) => placementById.get(item.item.id)!);
}

function solveTracks(
  tracks: LayoutTrack[],
  space: number,
  gap: number,
  contributions: Array<{ start: number; span: number; intrinsic: number }>,
  state: SolverState,
  path: "columns" | "rows",
): number[] {
  tracks.forEach((track, index) => {
    const min = resolveLength(track.min, space, 0);
    const max = resolveLength(track.max, space, Number.POSITIVE_INFINITY);
    if (min > max) {
      throw new LayoutCompileError(
        "invalid_geometry",
        `Grid ${path} track ${index} has min greater than max.`,
        ["layout", path, index],
        { index, min, max },
      );
    }
  });
  const sizes = tracks.map((track) =>
    track.size === "hug" || track.size === "fill"
      ? 0
      : resolveLength(track.size, space, 0),
  );
  for (const contribution of contributions.filter(
    (entry) => entry.span === 1,
  )) {
    const track = tracks[contribution.start];
    if (!track || track.size !== "hug") continue;
    sizes[contribution.start] = Math.max(
      sizes[contribution.start]!,
      contribution.intrinsic,
    );
  }
  for (const contribution of contributions.filter((entry) => entry.span > 1)) {
    const current = spanSize(sizes, contribution.start, contribution.span, gap);
    const deficit = contribution.intrinsic - current;
    if (deficit <= EPSILON) continue;
    const candidates: number[] = [];
    for (
      let index = contribution.start;
      index < contribution.start + contribution.span;
      index += 1
    ) {
      const track = tracks[index];
      if (track?.size === "hug" || track?.size === "fill")
        candidates.push(index);
    }
    if (candidates.length === 0) continue;
    const addition = deficit / candidates.length;
    candidates.forEach((index) => (sizes[index] = sizes[index]! + addition));
  }
  tracks.forEach((track, index) => {
    sizes[index] = clamp(
      sizes[index]!,
      resolveLength(track.min, space, 0),
      resolveLength(track.max, space, Number.POSITIVE_INFINITY),
    );
  });
  const gaps = Math.max(0, tracks.length - 1) * gap;
  const available = Math.max(0, space - gaps);
  let total = sizes.reduce((sum, value) => sum + value, 0);
  if (total < available - EPSILON) {
    const weights = tracks.map(
      (track) => track.grow ?? (track.size === "fill" ? 1 : 0),
    );
    let free = available - total;
    let activeGrow = tracks
      .map((track, index) => ({ track, index }))
      .filter(
        ({ track, index }) =>
          (weights[index] ?? 0) > 0 &&
          sizes[index]! <
            resolveLength(track.max, space, Number.POSITIVE_INFINITY) - EPSILON,
      );
    while (free > EPSILON && activeGrow.length > 0) {
      step(state, activeGrow.length);
      const sum = activeGrow.reduce(
        (acc, { index }) => acc + (weights[index] ?? 0),
        0,
      );
      let consumed = 0;
      for (const { track, index } of activeGrow) {
        const before = sizes[index]!;
        sizes[index] = clamp(
          before + free * ((weights[index] ?? 0) / sum),
          resolveLength(track.min, space, 0),
          resolveLength(track.max, space, Number.POSITIVE_INFINITY),
        );
        consumed += sizes[index]! - before;
      }
      if (consumed <= EPSILON) break;
      free -= consumed;
      activeGrow = activeGrow.filter(
        ({ track, index }) =>
          sizes[index]! <
          resolveLength(track.max, space, Number.POSITIVE_INFINITY) - EPSILON,
      );
    }
  }
  total = sizes.reduce((sum, value) => sum + value, 0);
  let deficit = total - available;
  let active = tracks
    .map((track, index) => ({ track, index }))
    .filter(
      ({ track, index }) =>
        (track.shrink ??
          (track.size === "hug" || track.size === "fill" ? 1 : 0)) > 0 &&
        sizes[index]! > resolveLength(track.min, space, 0) + EPSILON,
    );
  while (deficit > EPSILON && active.length > 0) {
    step(state, active.length);
    const weightSum = active.reduce(
      (sum, { track, index }) =>
        sum +
        (track.shrink ??
          (track.size === "hug" || track.size === "fill" ? 1 : 0)) *
          Math.max(1, sizes[index]!),
      0,
    );
    let consumed = 0;
    for (const { track, index } of active) {
      const weight =
        (track.shrink ??
          (track.size === "hug" || track.size === "fill" ? 1 : 0)) *
        Math.max(1, sizes[index]!);
      const before = sizes[index]!;
      sizes[index] = Math.max(
        resolveLength(track.min, space, 0),
        before - deficit * (weight / weightSum),
      );
      consumed += before - sizes[index]!;
    }
    if (consumed <= EPSILON) break;
    deficit -= consumed;
    active = active.filter(
      ({ track, index }) =>
        sizes[index]! > resolveLength(track.min, space, 0) + EPSILON,
    );
  }
  if (sizes.reduce((sum, value) => sum + value, 0) > available + EPSILON) {
    throw new LayoutCompileError(
      "insufficient_space",
      "Grid tracks cannot fit without violating fixed/min track sizes.",
      ["layout"],
    );
  }
  return sizes;
}

function solveOverlay(
  work: WorkItem[],
  layout: OverlayLayout,
  state: SolverState,
): void {
  const byId = new Map(work.map((entry) => [entry.item.id, entry]));
  const dependencies = new Map<string, Set<string>>();
  for (const entry of work) {
    const deps = new Set<string>();
    const coordinateWrites = new Set<Axis>();
    const dimensionWrites = new Set<Dimension>();
    for (const [constraintIndex, constraint] of (
      entry.item.constraints ?? []
    ).entries()) {
      if (!byId.has(constraint.target)) {
        throw new LayoutCompileError(
          "unknown_constraint_target",
          `Constraint on ${JSON.stringify(entry.item.id)} references unknown sibling ${JSON.stringify(constraint.target)}.`,
          ["items", entry.index, "constraints", constraintIndex, "target"],
          { id: entry.item.id, target: constraint.target },
        );
      }
      deps.add(constraint.target);
      const write = constraintWrite(constraint);
      const set = write.kind === "axis" ? coordinateWrites : dimensionWrites;
      if (set.has(write.value as never)) {
        throw new LayoutCompileError(
          "constraint_conflict",
          `Multiple constraints write ${write.value} on ${JSON.stringify(entry.item.id)}.`,
          ["items", entry.index, "constraints", constraintIndex],
          { id: entry.item.id, field: write.value },
        );
      }
      set.add(write.value as never);
    }
    dependencies.set(entry.item.id, deps);
  }
  const ordered = stableTopologicalOrder(work, dependencies, state);
  for (const entry of ordered) {
    if (entry.widthSizing === "fill")
      entry.width = clamp(
        state.bounds.width - entry.margins.left - entry.margins.right,
        entry.minWidth,
        entry.maxWidth,
      );
    if (entry.heightSizing === "fill")
      entry.height = clamp(
        state.bounds.height - entry.margins.top - entry.margins.bottom,
        entry.minHeight,
        entry.maxHeight,
      );
    refreshWidthFromHeight(entry);
    let matchedWidth = false;
    let matchedHeight = false;
    for (const [constraintIndex, constraint] of (
      entry.item.constraints ?? []
    ).entries()) {
      if (constraint.kind !== "match") continue;
      const target = byId.get(constraint.target)!;
      const desired =
        constraint.dimension === "width" ? target.width : target.height;
      const resolved =
        constraint.dimension === "width"
          ? clamp(desired, entry.minWidth, entry.maxWidth)
          : clamp(desired, entry.minHeight, entry.maxHeight);
      if (Math.abs(resolved - desired) > EPSILON) {
        throw new LayoutCompileError(
          "constraint_unsatisfied",
          `Match constraint on ${JSON.stringify(entry.item.id)} cannot equal ${JSON.stringify(constraint.target)} without violating ${constraint.dimension} min/max.`,
          ["items", entry.index, "constraints", constraintIndex],
          {
            id: entry.item.id,
            target: constraint.target,
            dimension: constraint.dimension,
            desired,
            resolved,
          },
        );
      }
      if (constraint.dimension === "width") {
        entry.width = resolved;
        matchedWidth = true;
      } else {
        entry.height = resolved;
        matchedHeight = true;
      }
    }
    deriveAspectFromMatches(entry, matchedWidth, matchedHeight);
    if (!matchedWidth && !matchedHeight) refreshWidthFromHeight(entry);
    const aspectOwnsHeight =
      matchedWidth &&
      !matchedHeight &&
      entry.aspectRatio !== null &&
      entry.heightSizing === "hug";
    refreshTextHeight(
      entry,
      entry.width,
      state,
      !matchedHeight && !aspectOwnsHeight,
    );
    anchorOverlay(
      entry,
      entry.item.anchor ?? layout.defaultAnchor ?? "center",
      state.bounds,
    );
    entry.x += resolveOffset(entry.item.offsetX, state.bounds.width);
    entry.y += resolveOffset(entry.item.offsetY, state.bounds.height);
    for (const constraint of entry.item.constraints ?? []) {
      if (constraint.kind === "match") continue;
      const target = byId.get(constraint.target)!;
      applyCoordinateConstraint(entry, target, constraint, state.bounds);
    }
    if (
      (entry.item.constraints?.length ?? 0) > 0 &&
      !containsRect(state.bounds, entry)
    ) {
      throw new LayoutCompileError(
        "constraint_unsatisfied",
        `Sibling constraints place ${JSON.stringify(entry.item.id)} outside the bounded overlay.`,
        ["items", entry.index, "constraints"],
        { id: entry.item.id },
      );
    }
  }
  state.lines += work.length > 0 ? 1 : 0;
}

function stableTopologicalOrder(
  work: WorkItem[],
  dependencies: Map<string, Set<string>>,
  state: SolverState,
): WorkItem[] {
  const remaining = new Map(
    [...dependencies].map(([id, values]) => [id, new Set(values)]),
  );
  const depths = new Map<string, number>();
  const output: WorkItem[] = [];
  while (output.length < work.length) {
    const next = work.find(
      (entry) =>
        !output.includes(entry) && remaining.get(entry.item.id)?.size === 0,
    );
    if (!next) {
      const cycle = work
        .filter((entry) => !output.includes(entry))
        .map((entry) => entry.item.id);
      throw new LayoutCompileError(
        "constraint_cycle",
        `Sibling constraints contain a cycle: ${cycle.map((id) => JSON.stringify(id)).join(" -> ")}.`,
        ["items"],
        { ids: cycle },
      );
    }
    output.push(next);
    const deps = dependencies.get(next.item.id) ?? new Set();
    const depth =
      deps.size === 0
        ? 0
        : 1 + Math.max(...[...deps].map((id) => depths.get(id) ?? 0));
    depths.set(next.item.id, depth);
    state.dependencyDepth = Math.max(state.dependencyDepth, depth);
    for (const values of remaining.values()) values.delete(next.item.id);
    step(state);
  }
  return output;
}

function applyCoordinateConstraint(
  entry: WorkItem,
  target: WorkItem,
  constraint: Exclude<LayoutConstraint, { kind: "match" }>,
  bounds: LayoutRect,
): void {
  if (constraint.kind === "align") {
    if (constraint.axis === "x") {
      entry.x =
        constraint.edge === "start"
          ? target.x
          : constraint.edge === "center"
            ? target.x + (target.width - entry.width) / 2
            : target.x + target.width - entry.width;
    } else {
      entry.y =
        constraint.edge === "start"
          ? target.y
          : constraint.edge === "center"
            ? target.y + (target.height - entry.height) / 2
            : target.y + target.height - entry.height;
    }
    return;
  }
  const basis = constraint.axis === "x" ? bounds.width : bounds.height;
  const gap = resolveLength(constraint.gap, basis, 0);
  if (constraint.axis === "x") {
    entry.x =
      constraint.kind === "after"
        ? target.x + target.width + gap
        : target.x - entry.width - gap;
  } else {
    entry.y =
      constraint.kind === "after"
        ? target.y + target.height + gap
        : target.y - entry.height - gap;
  }
}

function constraintWrite(
  constraint: LayoutConstraint,
): { kind: "axis"; value: Axis } | { kind: "dimension"; value: Dimension } {
  return constraint.kind === "match"
    ? { kind: "dimension", value: constraint.dimension }
    : { kind: "axis", value: constraint.axis };
}

function anchorOverlay(
  entry: WorkItem,
  anchor: LayoutItem["anchor"] extends infer T ? NonNullable<T> : never,
  bounds: LayoutRect,
): void {
  const [vertical, horizontal] =
    anchor === "center"
      ? ["center", "center"]
      : (anchor.split("-") as [
          "top" | "center" | "bottom",
          "left" | "center" | "right",
        ]);
  const horizontalSpace =
    bounds.width - entry.width - entry.margins.left - entry.margins.right;
  const verticalSpace =
    bounds.height - entry.height - entry.margins.top - entry.margins.bottom;
  entry.x =
    bounds.x +
    entry.margins.left +
    (horizontal === "center"
      ? horizontalSpace / 2
      : horizontal === "right"
        ? horizontalSpace
        : 0);
  entry.y =
    bounds.y +
    entry.margins.top +
    (vertical === "center"
      ? verticalSpace / 2
      : vertical === "bottom"
        ? verticalSpace
        : 0);
}

function placeInCell(
  item: WorkItem,
  cell: LayoutRect,
  horizontal: "start" | "center" | "end" | "stretch",
  vertical: "start" | "center" | "end" | "stretch",
  state: SolverState,
): void {
  const hMargins = item.margins.left + item.margins.right;
  const vMargins = item.margins.top + item.margins.bottom;
  if (
    item.widthSizing === "fill" ||
    (horizontal === "stretch" && item.widthAuto)
  ) {
    item.width = clamp(
      Math.max(0, cell.width - hMargins),
      item.minWidth,
      item.maxWidth,
    );
    refreshTextHeight(item, item.width, state);
  }
  if (
    item.heightSizing === "fill" ||
    (vertical === "stretch" && item.heightAuto)
  ) {
    item.height = clamp(
      Math.max(0, cell.height - vMargins),
      item.minHeight,
      item.maxHeight,
    );
    refreshWidthFromHeight(item);
  }
  const freeX = cell.width - item.width - hMargins;
  const freeY = cell.height - item.height - vMargins;
  item.x =
    cell.x +
    item.margins.left +
    (horizontal === "center" ? freeX / 2 : horizontal === "end" ? freeX : 0);
  item.y =
    cell.y +
    item.margins.top +
    (vertical === "center" ? freeY / 2 : vertical === "end" ? freeY : 0);
}

function refreshTextHeight(
  entry: WorkItem,
  width: number,
  state: SolverState,
  applyHeight = true,
): void {
  if (entry.node.type === "text") {
    if (entry.heightSizing !== "hug") return;
    const measured = measureIntrinsic(entry.node, true, true, width, state);
    entry.intrinsic = measured;
    if (applyHeight) {
      entry.height = clamp(measured.height, entry.minHeight, entry.maxHeight);
    }
  } else if (
    entry.heightSizing === "hug" &&
    entry.aspectRatio &&
    entry.widthSizing !== "hug"
  ) {
    entry.height = clamp(
      width / entry.aspectRatio,
      entry.minHeight,
      entry.maxHeight,
    );
  }
}

function refreshWidthFromHeight(entry: WorkItem): void {
  if (
    entry.widthSizing === "hug" &&
    entry.heightSizing !== "hug" &&
    entry.aspectRatio
  ) {
    entry.width = clamp(
      entry.height * entry.aspectRatio,
      entry.minWidth,
      entry.maxWidth,
    );
  }
}

function deriveAspectFromMatches(
  entry: WorkItem,
  matchedWidth: boolean,
  matchedHeight: boolean,
): void {
  const ratio = entry.aspectRatio;
  if (!ratio || (!matchedWidth && !matchedHeight)) return;
  if (matchedWidth && matchedHeight) {
    if (
      entry.height <= EPSILON ||
      Math.abs(entry.width / entry.height - ratio) > EPSILON
    ) {
      throw new LayoutCompileError(
        "constraint_unsatisfied",
        `Matched width and height on ${JSON.stringify(entry.item.id)} conflict with its aspect ratio.`,
        ["items", entry.index, "constraints"],
        { id: entry.item.id, ratio },
      );
    }
    return;
  }
  if (matchedWidth && entry.heightSizing === "hug") {
    const desired = entry.width / ratio;
    const resolved = clamp(desired, entry.minHeight, entry.maxHeight);
    if (Math.abs(desired - resolved) > EPSILON) {
      throw new LayoutCompileError(
        "constraint_unsatisfied",
        `Matched width on ${JSON.stringify(entry.item.id)} cannot derive an aspect-correct height within min/max.`,
        ["items", entry.index, "constraints"],
        { id: entry.item.id, desired, resolved },
      );
    }
    entry.height = resolved;
  } else if (matchedHeight && entry.widthSizing === "hug") {
    const desired = entry.height * ratio;
    const resolved = clamp(desired, entry.minWidth, entry.maxWidth);
    if (Math.abs(desired - resolved) > EPSILON) {
      throw new LayoutCompileError(
        "constraint_unsatisfied",
        `Matched height on ${JSON.stringify(entry.item.id)} cannot derive an aspect-correct width within min/max.`,
        ["items", entry.index, "constraints"],
        { id: entry.item.id, desired, resolved },
      );
    }
    entry.width = resolved;
  }
}

function refreshMainFromAvailableCross(
  entry: WorkItem,
  row: boolean,
  crossSpace: number,
): void {
  if (!entry.aspectRatio) return;
  if (row && entry.widthSizing === "hug" && entry.heightSizing === "fill") {
    entry.width = clamp(
      Math.max(0, crossSpace - crossMargins(entry, true)) * entry.aspectRatio,
      entry.minWidth,
      entry.maxWidth,
    );
  } else if (
    !row &&
    entry.heightSizing === "hug" &&
    entry.widthSizing === "fill"
  ) {
    entry.height = clamp(
      Math.max(0, crossSpace - crossMargins(entry, false)) / entry.aspectRatio,
      entry.minHeight,
      entry.maxHeight,
    );
  }
}

function compiledNode(entry: WorkItem, state: SolverState): SceneNode {
  let projected = entry.node;
  if (entry.intrinsic.textPlan) {
    const conflicting = (entry.node.animations ?? [])
      .filter((animation) =>
        textPlanningAnimationTargets.has(animation.property),
      )
      .map((animation) => animation.property);
    if (conflicting.length > 0) {
      throw new LayoutCompileError(
        "animation_conflict",
        `Layout v2 planned text ${JSON.stringify(entry.node.id)} cannot animate planning-owned fields ${[...new Set(conflicting)].join(", ")}.`,
        ["items", entry.index, "animations"],
        { id: entry.node.id, properties: [...new Set(conflicting)] },
      );
    }
    if (entry.node.runs && state.options.richTextPolicy === "legacy-unsafe") {
      projected = {
        ...entry.node,
        style: {
          ...(entry.node.style ?? {}),
          direction: entry.intrinsic.textPlan.baseDirection,
          textAlign: entry.intrinsic.textPlan.physicalAlign,
          fontSize: entry.intrinsic.textPlan.fontSize,
          lineHeight: `${entry.intrinsic.textPlan.lineHeight}px`,
          ...(entry.intrinsic.font?.assetId
            ? { fontFamily: entry.intrinsic.font.family }
            : {}),
        },
      };
    } else {
      const textProjection = projectLayoutTextToSceneV1(
        entry.node,
        entry.intrinsic.textPlan,
      );
      const { runs: _runs, ...source } = entry.node;
      projected = { ...source, ...textProjection };
      if (entry.intrinsic.font?.assetId) {
        projected.style = {
          ...(projected.style ?? {}),
          fontFamily: entry.intrinsic.font.family,
        };
      }
    }
  }
  const style: SceneStyle = { ...(projected.style ?? {}) };
  const owned: Array<keyof SceneStyle> = [
    "position",
    "left",
    "right",
    "top",
    "bottom",
    "inset",
    "width",
    "height",
    "minWidth",
    "minHeight",
    "maxWidth",
    "maxHeight",
    "aspectRatio",
    "safeArea",
    "margin",
    "marginTop",
    "marginRight",
    "marginBottom",
    "marginLeft",
  ];
  const replaced = owned.some((key) => style[key] !== undefined);
  for (const key of owned) delete style[key];
  Object.assign(style, {
    position: "absolute" as const,
    left: finiteNumber(entry.x),
    top: finiteNumber(entry.y),
    width: finiteNumber(entry.width),
    height: finiteNumber(entry.height),
  });
  if (replaced) {
    state.diagnostics.push({
      severity: "info",
      code: "layout_style_replaced",
      message: `Semantic layout replaced geometry-owned style fields on ${JSON.stringify(entry.node.id)}.`,
      path: ["items", entry.index],
      itemId: entry.node.id,
    });
  }
  return { ...projected, style };
}

function toMeasurement(entry: WorkItem): LayoutItemMeasurement {
  const qualities = [
    entry.intrinsic.widthMeasurement.measurement,
    entry.intrinsic.heightMeasurement.measurement,
  ];
  if (entry.intrinsic.font?.measurement === "estimated") {
    qualities.push("estimated");
  }
  const measurement = worstMeasurementQuality(...qualities);
  const reasons = [
    entry.intrinsic.widthMeasurement.reason,
    entry.intrinsic.heightMeasurement.reason,
  ];
  if (entry.intrinsic.font) reasons.push(entry.intrinsic.font.reason);
  return {
    id: entry.item.id,
    intrinsic: {
      width: finiteNumber(entry.intrinsic.width),
      height: finiteNumber(entry.intrinsic.height),
    },
    resolved: {
      x: finiteNumber(entry.x),
      y: finiteNumber(entry.y),
      width: finiteNumber(entry.width),
      height: finiteNumber(entry.height),
    },
    fieldMeasurements: {
      width: { ...entry.intrinsic.widthMeasurement },
      height: { ...entry.intrinsic.heightMeasurement },
    },
    measurement,
    reason: [...new Set(reasons)].sort().join("; "),
    ...(entry.intrinsic.textPlan
      ? { textPlan: structuredClone(entry.intrinsic.textPlan) }
      : {}),
    ...(entry.intrinsic.font ? { font: { ...entry.intrinsic.font } } : {}),
  };
}

function findTarget(
  scene: Scene,
  containerId: string,
): { container?: SceneNode; children: SceneNode[] } {
  if (containerId === LAYOUT_ROOT) return { children: scene.nodes };
  const stack = [...scene.nodes];
  while (stack.length > 0) {
    const node = stack.pop()!;
    if (node.id === containerId) {
      return { container: node, children: node.children ?? [] };
    }
    stack.push(...(node.children ?? []));
  }
  throw new LayoutCompileError(
    "missing_container",
    `No Scene node has layout container id ${JSON.stringify(containerId)}.`,
    ["containerId"],
    { containerId },
  );
}

function resolveContainerBounds(
  scene: Scene,
  containerId: string,
  options: CompileLayoutOptions,
): LayoutRect {
  if (containerId === LAYOUT_ROOT) {
    return { x: 0, y: 0, width: scene.width, height: scene.height };
  }
  const frame = options.frame ?? 0;
  if (!Number.isFinite(frame) || frame < 0) {
    throw new LayoutCompileError(
      "invalid_geometry",
      "Layout compile frame must be finite and non-negative.",
      ["options", "frame"],
    );
  }
  let layout: ReturnType<typeof layoutScene>;
  try {
    layout = layoutScene(evaluateScene(scene, frame), {
      textMetrics: options.textMetrics,
    });
  } catch (error) {
    if (error instanceof LayoutCompileError) throw error;
    throw new LayoutCompileError(
      "invalid_geometry",
      `Could not resolve container ${JSON.stringify(containerId)} at frame ${frame}: ${safeErrorMessage(error)}.`,
      ["containerId"],
      { containerId, frame },
    );
  }
  const box = findLayoutBox(layout.boxes, containerId);
  if (!box) {
    throw new LayoutCompileError(
      "missing_container",
      `Container ${JSON.stringify(containerId)} is not active at compile frame ${frame}.`,
      ["containerId"],
      { containerId, frame },
    );
  }
  const content = getLayoutContentRect(box);
  // Child coordinates in Scene are relative to this content box, not global.
  return { x: 0, y: 0, width: content.width, height: content.height };
}

function findLayoutBox(boxes: LayoutBox[], id: string): LayoutBox | undefined {
  const stack = [...boxes];
  while (stack.length > 0) {
    const box = stack.pop()!;
    if (box.id === id) return box;
    stack.push(...box.children);
  }
  return undefined;
}

function replaceTargetChildren(
  scene: Scene,
  containerId: string,
  replacements: Map<string, SceneNode>,
): void {
  const replace = (nodes: SceneNode[]): boolean => {
    for (let index = 0; index < nodes.length; index += 1) {
      const node = nodes[index]!;
      if (node.id === containerId) {
        const style: SceneStyle = { ...(node.style ?? {}) };
        for (const key of legacyContainerLayoutKeys) delete style[key];
        node.style = style;
        node.children = (node.children ?? []).map(
          (child) => replacements.get(child.id) ?? child,
        );
        return true;
      }
      if (replace(node.children ?? [])) return true;
    }
    return false;
  };
  if (containerId === LAYOUT_ROOT) {
    scene.nodes = scene.nodes.map((node) => replacements.get(node.id) ?? node);
  } else if (!replace(scene.nodes)) {
    throw new LayoutCompileError(
      "missing_container",
      "Layout container disappeared during compilation.",
    );
  }
}

const legacyContainerLayoutKeys = [
  "display",
  "flexDirection",
  "justifyContent",
  "alignItems",
  "gap",
] as const satisfies ReadonlyArray<keyof SceneStyle>;

function rejectLayoutAnimations(
  node: SceneNode,
  path: Array<string | number>,
): void {
  const conflicting = (node.animations ?? [])
    .filter((animation) => layoutOwnedAnimationTargets.has(animation.property))
    .map((animation) => animation.property);
  if (conflicting.length > 0) {
    throw new LayoutCompileError(
      "animation_conflict",
      `Layout v2 compiles a static target-size snapshot; ${JSON.stringify(node.id)} animates layout-owned fields ${[...new Set(conflicting)].join(", ")}. A retained/animated semantic layout requires a future Scene version.`,
      path,
      { id: node.id, properties: [...new Set(conflicting)] },
    );
  }
}

function intrinsicChildUnion(node: SceneNode): {
  width: number;
  height: number;
  reason: string;
} {
  let width = 0;
  let height = 0;
  let measured = 0;
  for (const child of node.children ?? []) {
    const style = child.style ?? {};
    const childWidth = absoluteLength(style.width);
    const childHeight = absoluteLength(style.height);
    if (childWidth === undefined || childHeight === undefined) continue;
    const left = absoluteLength(style.left) ?? 0;
    const top = absoluteLength(style.top) ?? 0;
    width = Math.max(width, left + childWidth);
    height = Math.max(height, top + childHeight);
    measured += 1;
  }
  return {
    width,
    height,
    reason:
      measured > 0
        ? "estimated union of explicitly-sized child boxes"
        : "no intrinsic metrics; empty generic-node fallback",
  };
}

function resolveSceneMargins(style: SceneStyle, bounds: LayoutRect): Insets {
  const all = resolveLength(style.margin, bounds.width, 0);
  return {
    top: resolveLength(style.marginTop, bounds.width, all),
    right: resolveLength(style.marginRight, bounds.width, all),
    bottom: resolveLength(style.marginBottom, bounds.width, all),
    left: resolveLength(style.marginLeft, bounds.width, all),
  };
}

function resolveInsets(
  input: LayoutInsetsInput | undefined,
  basis: LayoutRect,
): Insets {
  if (input === undefined) return { top: 0, right: 0, bottom: 0, left: 0 };
  if (typeof input === "number" || typeof input === "string") {
    const horizontal = resolveLength(input, basis.width, 0);
    const vertical = resolveLength(input, basis.height, 0);
    return {
      top: vertical,
      right: horizontal,
      bottom: vertical,
      left: horizontal,
    };
  }
  const x = resolveLength(input.x, basis.width, 0);
  const y = resolveLength(input.y, basis.height, 0);
  return {
    top: resolveLength(input.top, basis.height, y),
    right: resolveLength(input.right, basis.width, x),
    bottom: resolveLength(input.bottom, basis.height, y),
    left: resolveLength(input.left, basis.width, x),
  };
}

function insetRect(rect: LayoutRect, insets: Insets): LayoutRect {
  return {
    x: rect.x + insets.left,
    y: rect.y + insets.top,
    width: rect.width - insets.left - insets.right,
    height: rect.height - insets.top - insets.bottom,
  };
}

function resolveLength(
  value: LayoutLength | SceneStyle["width"] | undefined,
  basis: number,
  fallback: number,
): number {
  if (value === undefined) return fallback;
  if (typeof value === "number") return value;
  if (value === "hug" || value === "fill") return fallback;
  const parsed = Number.parseFloat(value);
  if (!Number.isFinite(parsed)) return fallback;
  return value.endsWith("%") ? (parsed / 100) * basis : parsed;
}

function resolveOffset(value: LayoutItem["offsetX"], basis: number): number {
  if (value === undefined) return 0;
  if (typeof value === "number") return value;
  const parsed = Number.parseFloat(value);
  return value.endsWith("%") ? (parsed / 100) * basis : parsed;
}

function absoluteLength(value: SceneStyle["width"]): number | undefined {
  if (typeof value === "number") return value;
  if (typeof value === "string" && value.endsWith("px")) {
    const parsed = Number.parseFloat(value);
    return Number.isFinite(parsed) ? parsed : undefined;
  }
  return undefined;
}

function sizingBase(
  sizing: LayoutSizing,
  basis: number,
  intrinsic: number,
): number {
  if (sizing === "hug") return intrinsic;
  if (sizing === "fill") return 0;
  return resolveLength(sizing, basis, intrinsic);
}

function resolveBudgets(
  input: CompileLayoutOptions["budgets"],
): LayoutCompilerBudgets {
  const allowed = new Set(Object.keys(defaultLayoutCompilerBudgets));
  for (const name of Object.keys(input ?? {})) {
    if (!allowed.has(name)) {
      throw new LayoutCompileError(
        "invalid_geometry",
        `Unknown layout compiler budget ${JSON.stringify(name)}.`,
        ["options", "budgets", name],
        { budget: name },
      );
    }
  }
  const budgets = { ...defaultLayoutCompilerBudgets, ...input };
  for (const [name, value] of Object.entries(budgets)) {
    if (!Number.isSafeInteger(value) || value < 1) {
      throw new LayoutCompileError(
        "invalid_geometry",
        `${name} must be a positive safe integer.`,
        ["options", "budgets", name],
      );
    }
  }
  return budgets;
}

function budgetError(name: string, actual: number, limit: number): never {
  throw new LayoutCompileError(
    "budget_exceeded",
    `Layout ${name} budget ${limit} exceeded.`,
    [],
    { actual, limit, budget: name },
  );
}

function step(state: SolverState, count = 1): void {
  state.steps += count;
  if (state.steps > state.budgets.maxSolverSteps) {
    budgetError("solver steps", state.steps, state.budgets.maxSolverSteps);
  }
}

function estimatedDiagnostic(
  id: string,
  reason: string,
  state: SolverState,
): void {
  if (
    state.diagnostics.some(
      (entry) =>
        entry.code === "estimated_intrinsic_metrics" && entry.itemId === id,
    )
  )
    return;
  state.diagnostics.push({
    severity: "warning",
    code: "estimated_intrinsic_metrics",
    message: `Layout item ${JSON.stringify(id)} uses estimated intrinsic metrics: ${reason}.`,
    path: ["items", id],
    itemId: id,
  });
}

function pushDiagnosticOnce(
  state: SolverState,
  diagnostic: LayoutDiagnostic,
): void {
  if (
    state.diagnostics.some(
      (entry) =>
        entry.code === diagnostic.code && entry.itemId === diagnostic.itemId,
    )
  ) {
    return;
  }
  state.diagnostics.push(diagnostic);
}

function assertFiniteRect(entry: WorkItem, state: SolverState): void {
  for (const [field, value] of Object.entries({
    x: entry.x,
    y: entry.y,
    width: entry.width,
    height: entry.height,
  })) {
    if (
      !Number.isFinite(value) ||
      value <
        (field === "width" || field === "height"
          ? 0
          : -state.budgets.maxCoordinate) ||
      value > state.budgets.maxCoordinate
    ) {
      throw new LayoutCompileError(
        "invalid_geometry",
        `Layout item ${JSON.stringify(entry.item.id)} produced invalid ${field}=${String(value)}.`,
        ["items", entry.index],
        { id: entry.item.id, field, value },
      );
    }
  }
}

function assertAspectRatio(entry: WorkItem): void {
  if (!entry.aspectRatio || !entry.aspectRatioIsHard) return;
  if (
    entry.width <= EPSILON ||
    entry.height <= EPSILON ||
    Math.abs(entry.width / entry.height - entry.aspectRatio) > EPSILON
  ) {
    throw new LayoutCompileError(
      "constraint_unsatisfied",
      `Layout item ${JSON.stringify(entry.item.id)} cannot satisfy aspect ratio ${formatNumber(entry.aspectRatio)} within its resolved sizing/min/max constraints.`,
      ["items", entry.index, "aspectRatio"],
      {
        id: entry.item.id,
        ratio: entry.aspectRatio,
        width: entry.width,
        height: entry.height,
      },
    );
  }
}

function finiteNumber(value: number): number {
  if (Math.abs(value) > Number.MAX_SAFE_INTEGER / 1_000_000) return value;
  const rounded = Math.round(value * 1_000_000) / 1_000_000;
  return Object.is(rounded, -0) ? 0 : rounded;
}

function assertIntrinsicBounds(
  intrinsic: Intrinsic,
  id: string,
  index: number,
  state: SolverState,
): void {
  for (const [field, value] of Object.entries({
    width: intrinsic.width,
    height: intrinsic.height,
  })) {
    if (
      !Number.isFinite(value) ||
      value < 0 ||
      value > state.budgets.maxCoordinate
    ) {
      throw new LayoutCompileError(
        "invalid_geometry",
        `Intrinsic ${field} for ${JSON.stringify(id)} must be finite, non-negative, and at most ${state.budgets.maxCoordinate}.`,
        ["items", index],
        { id, field, value },
      );
    }
  }
}

function assertStrictJson(value: unknown): void {
  const stack: unknown[] = [value];
  const seen = new WeakSet<object>();
  let visited = 0;
  while (stack.length > 0) {
    const current = stack.pop();
    visited += 1;
    if (visited > 1_000_000) {
      throw new LayoutCompileError(
        "budget_exceeded",
        "Layout result exceeds the strict JSON verification budget.",
      );
    }
    if (
      current === null ||
      typeof current === "string" ||
      typeof current === "boolean"
    )
      continue;
    if (typeof current === "number") {
      if (!Number.isFinite(current)) {
        throw new LayoutCompileError(
          "invalid_geometry",
          "Layout result contains a non-finite number.",
        );
      }
      continue;
    }
    if (typeof current !== "object") {
      throw new LayoutCompileError(
        "invalid_geometry",
        "Layout result must contain only strict JSON values.",
      );
    }
    if (seen.has(current)) {
      throw new LayoutCompileError(
        "invalid_geometry",
        "Layout result must be a JSON tree without shared references.",
      );
    }
    seen.add(current);
    if (Array.isArray(current)) {
      stack.push(...current);
      continue;
    }
    const prototype = Object.getPrototypeOf(current);
    if (prototype !== Object.prototype && prototype !== null) {
      throw new LayoutCompileError(
        "invalid_geometry",
        "Layout result contains a non-plain object.",
      );
    }
    stack.push(...Object.values(current as Record<string, unknown>));
  }
}

function formatNumber(value: number): string {
  return finiteNumber(value).toString();
}

function safeErrorMessage(error: unknown): string {
  if (error instanceof Error && error.message.trim() !== "") {
    return error.message.slice(0, 512);
  }
  return "unknown provider failure";
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function containsRect(bounds: LayoutRect, rect: WorkItem): boolean {
  return (
    rect.x >= bounds.x - EPSILON &&
    rect.y >= bounds.y - EPSILON &&
    rect.x + rect.width <= bounds.x + bounds.width + EPSILON &&
    rect.y + rect.height <= bounds.y + bounds.height + EPSILON
  );
}

function spanSize(
  sizes: number[],
  start: number,
  span: number,
  gap: number,
): number {
  return (
    sizes.slice(start, start + span).reduce((sum, value) => sum + value, 0) +
    Math.max(0, span - 1) * gap
  );
}

function trackStarts(sizes: number[], gap: number, origin: number): number[] {
  const starts: number[] = [];
  let cursor = origin;
  for (const size of sizes) {
    starts.push(cursor);
    cursor += size + gap;
  }
  return starts;
}

function mainSize(entry: WorkItem, row: boolean): number {
  return row ? entry.width : entry.height;
}
function crossSize(entry: WorkItem, row: boolean): number {
  return row ? entry.height : entry.width;
}
function setMainSize(entry: WorkItem, row: boolean, value: number): void {
  if (row) entry.width = value;
  else entry.height = value;
}
function setCrossSize(entry: WorkItem, row: boolean, value: number): void {
  if (row) entry.height = clamp(value, entry.minHeight, entry.maxHeight);
  else entry.width = clamp(value, entry.minWidth, entry.maxWidth);
}
function setMainPosition(entry: WorkItem, row: boolean, value: number): void {
  if (row) entry.x = value;
  else entry.y = value;
}
function setCrossPosition(entry: WorkItem, row: boolean, value: number): void {
  if (row) entry.y = value;
  else entry.x = value;
}
function mainOrigin(bounds: LayoutRect, row: boolean): number {
  return row ? bounds.x : bounds.y;
}
function crossOrigin(bounds: LayoutRect, row: boolean): number {
  return row ? bounds.y : bounds.x;
}
function mainMargins(entry: WorkItem, row: boolean): number {
  const pair = mainMarginPair(entry, row);
  return pair.start + pair.end;
}
function crossMargins(entry: WorkItem, row: boolean): number {
  const pair = crossMarginPair(entry, row);
  return pair.start + pair.end;
}
function mainMarginPair(
  entry: WorkItem,
  row: boolean,
): { start: number; end: number } {
  return row
    ? { start: entry.margins.left, end: entry.margins.right }
    : { start: entry.margins.top, end: entry.margins.bottom };
}
function crossMarginPair(
  entry: WorkItem,
  row: boolean,
): { start: number; end: number } {
  return row
    ? { start: entry.margins.top, end: entry.margins.bottom }
    : { start: entry.margins.left, end: entry.margins.right };
}
function mainMin(entry: WorkItem, row: boolean): number {
  return row ? entry.minWidth : entry.minHeight;
}
function mainMax(entry: WorkItem, row: boolean): number {
  return row ? entry.maxWidth : entry.maxHeight;
}
function clampMain(entry: WorkItem, row: boolean, value: number): number {
  return clamp(value, mainMin(entry, row), mainMax(entry, row));
}
function growWeight(entry: WorkItem, row: boolean): number {
  const sizing = row ? entry.widthSizing : entry.heightSizing;
  return entry.item.grow ?? (sizing === "fill" ? 1 : 0);
}
function shrinkWeight(entry: WorkItem, row: boolean): number {
  const sizing = row ? entry.widthSizing : entry.heightSizing;
  return entry.item.shrink ?? (sizing === "hug" || sizing === "fill" ? 1 : 0);
}
