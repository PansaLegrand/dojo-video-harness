import {
  createBoundedTextMetricsProvider,
  evaluateScene,
  getLayoutContentRect,
  identityAffineMatrix,
  invertAffineMatrix,
  layoutScene,
  multiplyAffineMatrices,
  pointInRoundedLayoutRect,
  prepareTextLayout,
  resolveLayoutCornerRadii,
  resolveObjectFitRect,
  resolveStyleTransformMatrix,
  resolveTextLineMetrics,
  transformLayoutPoint,
  transformLayoutRect,
  type LayoutBox,
  type ResolvedNode,
  type ResolvedMeasurementProvenance,
  type ResolvedTextLineMetrics,
  type TextMetricsProvider,
} from "@dojo-video-engine/core";
import {
  parseScene,
  type Scene,
  type SceneAsset,
  type SceneStyle,
} from "@dojo-video-engine/schema";
import {
  intersectRect,
  plainRectCoversBox,
  pointInRect,
  pointInShape,
  readLength,
  rectIntersectionArea,
  shapeBounds,
} from "./geometry";
import { inspectTree, mediaMetrics } from "./tree";
import type {
  DiagnosticCode,
  HitTestOptions,
  HitTestResult,
  InspectionDiagnostic,
  LayoutInspection,
  LayoutInspectionNode,
  LayoutInspectionOptions,
  Matrix2D,
  MeasuredRect,
  MeasurementQuality,
  Point,
  Rect,
  RemediationClass,
  TextInspection,
} from "./types";

type WorkingNode = LayoutInspectionNode & {
  node: ResolvedNode;
  parentIds: string[];
  inverse: Matrix2D | null;
  effectiveVisibility: {
    visible: boolean;
    measurement: MeasurementQuality;
    reason: string;
  };
};

const measured = (
  rect: Rect,
  measurement: MeasurementQuality,
  reason: string,
): MeasuredRect => ({ ...rect, measurement, reason });

const measurementRank: Record<MeasurementQuality, number> = {
  exact: 0,
  declared: 1,
  estimated: 2,
};

function worstMeasurement(
  ...qualities: MeasurementQuality[]
): MeasurementQuality {
  return qualities.reduce<MeasurementQuality>(
    (worst, quality) =>
      measurementRank[quality] > measurementRank[worst] ? quality : worst,
    "exact",
  );
}

function measurementReasons(
  provenance: ResolvedMeasurementProvenance[],
  quality: MeasurementQuality,
): string {
  return Array.from(
    new Set(
      provenance
        .filter((entry) => entry.measurement === quality)
        .map((entry) => entry.reason),
    ),
  ).join("; ");
}

export function inspectLayout(
  sceneInput: unknown,
  requestedFrame: number,
  options: LayoutInspectionOptions = {},
): LayoutInspection {
  if (!Number.isFinite(requestedFrame)) {
    throw new RangeError("Inspection frame must be a finite number.");
  }
  validateLayoutOptions(options);
  const scene = parseScene(sceneInput);
  const frame = Math.max(0, Math.min(requestedFrame, scene.duration - 1));
  const tree = inspectTree(scene, options);
  const treeById = new Map(tree.nodes.map((node) => [node.id, node]));
  const textMetrics = options.textMetrics
    ? createBoundedTextMetricsProvider(options.textMetrics, {
        maxEntries: 4096,
      })
    : undefined;
  let observedTextQuality: MeasurementQuality = "exact";
  let observedTextReason = "no text measurement affected layout";
  const measureLine = (
    line: string,
    style: SceneStyle,
    fontSize: number,
    nodeId?: string,
  ): number => {
    const metric = textLineMetric(
      nodeId ?? "__unknown__",
      line,
      style,
      fontSize,
      textMetrics,
    );
    const widthProvenance = metric.fieldMeasurements.width;
    const quality = widthProvenance.measurement;
    if (observedTextReason === "no text measurement affected layout") {
      observedTextReason = widthProvenance.reason;
    }
    if (
      quality === "estimated" ||
      (quality === "declared" && observedTextQuality === "exact")
    ) {
      observedTextQuality = quality;
      observedTextReason = widthProvenance.reason;
    }
    return metric.width;
  };
  const resolved = evaluateScene(scene, frame);
  const layout = layoutScene(resolved, { measureTextLine: measureLine });
  const hasText = containsText(resolved.nodes);
  const layoutQuality: MeasurementQuality = hasText
    ? observedTextQuality
    : "exact";
  const layoutReason = hasText
    ? observedTextReason
    : "core layout without text-dependent measurement";
  const working: WorkingNode[] = [];
  let paintOrder = 0;
  const sceneRect: Rect = {
    x: 0,
    y: 0,
    width: scene.width,
    height: scene.height,
  };

  const visit = (
    boxes: LayoutBox[],
    parentId: string | null,
    parentIds: string[],
    parentMatrix: Matrix2D,
    parentClip: Rect,
    parentClipEstimated: boolean,
    parentVisibility: WorkingNode["effectiveVisibility"],
  ): void => {
    const sorted = boxes
      .map((box, index) => ({ box, index }))
      .sort((left, right) => {
        const leftZ = left.box.node.style.zIndex ?? 0;
        const rightZ = right.box.node.style.zIndex ?? 0;
        return leftZ - rightZ || left.index - right.index;
      });
    for (const { box } of sorted) {
      const treeNode = treeById.get(box.id);
      if (!treeNode) continue;
      const border: Rect = {
        x: box.x,
        y: box.y,
        width: box.width,
        height: box.height,
      };
      const detailedContent = box.content;
      const content = getLayoutContentRect(box);
      const ownMatrix = resolveStyleTransformMatrix(box.node.style, border);
      const globalMatrix = multiplyAffineMatrices(parentMatrix, ownMatrix);
      const transformed = transformLayoutRect(globalMatrix, border);
      const transformedAxisAligned = matrixPreservesAxisAlignment(globalMatrix);
      const transformedQuality = transformedAxisAligned
        ? layoutQuality
        : "estimated";
      const transformedReason = transformedAxisAligned
        ? layoutReason
        : `${layoutReason}; axis-aligned bounds conservatively enclose rotated geometry`;
      let clip = parentClip;
      let clipEstimated = parentClipEstimated;
      if (box.node.style.overflow === "hidden") {
        clip = intersectRect(clip, transformed);
        clipEstimated ||= hasCornerRadii(
          resolveLayoutCornerRadii(box.node.style, border),
        );
      }
      if (box.node.clip) {
        const geometry = shapeBounds(box.node.clip, border);
        clip = intersectRect(
          clip,
          transformLayoutRect(globalMatrix, geometry.bounds),
        );
        clipEstimated ||= geometry.estimated;
        clipEstimated ||= !transformedAxisAligned;
      }
      if (
        box.node.mask &&
        box.node.mask.inverted !== true &&
        (box.node.mask.feather ?? 0) === 0
      ) {
        const geometry = shapeBounds(box.node.mask.shape, border);
        clip = intersectRect(
          clip,
          transformLayoutRect(globalMatrix, geometry.bounds),
        );
        clipEstimated ||= geometry.estimated;
        clipEstimated ||= !transformedAxisAligned;
      }
      if (
        box.node.mask &&
        (box.node.mask.inverted === true ||
          (box.node.mask.feather ?? 0) > 0 ||
          (box.node.mask.opacity ?? 1) < 1)
      ) {
        clipEstimated = true;
      }
      const ownVisibility = inspectNodeVisibility(box.node, border);
      const effectiveVisibility = parentVisibility.visible
        ? {
            visible: ownVisibility.visible,
            measurement: worstMeasurement(
              parentVisibility.measurement,
              ownVisibility.measurement,
            ),
            reason:
              parentVisibility.measurement === "exact"
                ? ownVisibility.reason
                : `ancestor visibility: ${parentVisibility.reason}; ${ownVisibility.reason}`,
          }
        : {
            visible: false,
            measurement: parentVisibility.measurement,
            reason: `ancestor visibility: ${parentVisibility.reason}`,
          };
      const row: WorkingNode = {
        id: box.id,
        type: box.node.type,
        parentId,
        depth: treeNode.depth,
        documentOrder: treeNode.documentOrder,
        paintOrder: paintOrder++,
        zIndex: box.node.style.zIndex ?? 0,
        sourcePath: treeNode.sourcePath,
        ...(treeNode.semanticRole
          ? { semanticRole: treeNode.semanticRole }
          : {}),
        localFrame: box.node.localFrame,
        layoutBounds: measured(border, layoutQuality, layoutReason),
        contentBounds: measured(
          content,
          layoutQuality,
          detailedContent
            ? "core detailed content rect"
            : `${layoutReason}; content rect reconstructed from Scene padding`,
        ),
        transformedBounds: measured(
          transformed,
          transformedQuality,
          transformedReason,
        ),
        clipBounds: measured(
          clip,
          clipEstimated ? "estimated" : layoutQuality,
          clipEstimated
            ? "SVG/open/soft clip represented by conservative bounds"
            : "intersection of Scene, overflow, and closed clip bounds",
        ),
        transform: globalMatrix,
        style: {
          ...(box.node.style.display
            ? { display: box.node.style.display }
            : {}),
          ...(box.node.style.overflow
            ? { overflow: box.node.style.overflow }
            : {}),
          ...(box.node.style.opacity !== undefined
            ? { opacity: box.node.style.opacity }
            : {}),
          ...(box.node.style.zIndex !== undefined
            ? { zIndex: box.node.style.zIndex }
            : {}),
          ...(box.node.style.transform
            ? { transform: box.node.style.transform }
            : {}),
        },
        node: box.node,
        parentIds,
        inverse: invertAffineMatrix(globalMatrix),
        effectiveVisibility,
      };
      if (box.node.type === "text") {
        row.text = inspectText(box, globalMatrix, options, textMetrics);
      }
      if (
        box.node.assetId &&
        (box.node.type === "img" ||
          box.node.type === "video" ||
          box.node.type === "lottie")
      ) {
        const asset = scene.assets[box.node.assetId];
        if (asset) row.media = inspectMedia(asset, box, globalMatrix, options);
      }
      working.push(row);
      visit(
        box.children,
        box.id,
        [...parentIds, box.id],
        globalMatrix,
        clip,
        clipEstimated,
        effectiveVisibility,
      );
    }
  };
  visit(layout.boxes, null, [], identityAffineMatrix(), sceneRect, false, {
    visible: true,
    measurement: "exact",
    reason: "composition root is visible",
  });
  attachFlexOverflow(working);
  const diagnostics = diagnosticsFor(scene, frame, working, options);
  return {
    kind: "dojo-video-engine.layout",
    version: 1,
    width: scene.width,
    height: scene.height,
    fps: scene.fps,
    requestedFrame,
    frame,
    timeSeconds: frame / scene.fps,
    clamped: requestedFrame !== frame,
    nodes: working.map(
      ({
        node: _node,
        parentIds: _parents,
        inverse: _inverse,
        effectiveVisibility: _visibility,
        ...row
      }) => row,
    ),
    diagnostics,
  };
}

function containsText(nodes: ResolvedNode[]): boolean {
  return nodes.some(
    (node) => node.type === "text" || containsText(node.children),
  );
}

function validateLayoutOptions(options: LayoutInspectionOptions): void {
  const insets = options.unsafeInsets;
  const values =
    typeof insets === "number"
      ? [insets]
      : insets
        ? [insets.top, insets.right, insets.bottom, insets.left]
        : [];
  if (values.some((value) => !Number.isFinite(value) || value < 0)) {
    throw new RangeError(
      "unsafeInsets values must be finite and non-negative.",
    );
  }
  if (
    options.excessiveCropThreshold !== undefined &&
    (!Number.isFinite(options.excessiveCropThreshold) ||
      options.excessiveCropThreshold < 0 ||
      options.excessiveCropThreshold > 1)
  ) {
    throw new RangeError("excessiveCropThreshold must be between 0 and 1.");
  }
  if (
    options.safeAreaRoles &&
    options.safeAreaRoles.some(
      (role) => typeof role !== "string" || role === "",
    )
  ) {
    throw new TypeError("safeAreaRoles must contain non-empty strings.");
  }
}

function hasCornerRadii(
  radii: ReturnType<typeof resolveLayoutCornerRadii>,
): boolean {
  return (
    radii.topLeft > 0 ||
    radii.topRight > 0 ||
    radii.bottomRight > 0 ||
    radii.bottomLeft > 0
  );
}

function matrixPreservesAxisAlignment(matrix: Matrix2D): boolean {
  const epsilon = 1e-10;
  return (
    (Math.abs(matrix.b) <= epsilon && Math.abs(matrix.c) <= epsilon) ||
    (Math.abs(matrix.a) <= epsilon && Math.abs(matrix.d) <= epsilon)
  );
}

function inspectNodeVisibility(
  node: ResolvedNode,
  box: Rect,
): WorkingNode["effectiveVisibility"] {
  if ((node.style.opacity ?? 1) <= 0) {
    return {
      visible: false,
      measurement: "exact",
      reason: "node opacity is zero",
    };
  }
  const clip = node.clip;
  if (clip) {
    const bounds = shapeBounds(clip, box).bounds;
    if (bounds.width <= 0 || bounds.height <= 0) {
      return {
        visible: false,
        measurement: clip.kind === "path" ? "estimated" : "exact",
        reason: "clip has no positive-area bounds",
      };
    }
  }
  const mask = node.mask;
  if (!mask) {
    return {
      visible: true,
      measurement: "exact",
      reason: "no zero-alpha constraint",
    };
  }
  const opacity = mask.opacity ?? 1;
  const feather = mask.feather ?? 0;
  if (!mask.inverted && opacity <= 0) {
    return {
      visible: false,
      measurement: "exact",
      reason: "non-inverted mask opacity is zero",
    };
  }
  if (
    mask.inverted &&
    opacity >= 1 &&
    feather === 0 &&
    plainRectCoversBox(mask.shape, box)
  ) {
    return {
      visible: false,
      measurement: "exact",
      reason: "inverted full-rectangle mask removes the node box",
    };
  }
  return {
    visible: true,
    measurement:
      feather > 0 || mask.inverted || shapeBounds(mask.shape, box).estimated
        ? "estimated"
        : "exact",
    reason:
      feather > 0
        ? "feathered mask visibility is conservative"
        : mask.inverted
          ? "inverted mask retains some box geometry"
          : "mask retains positive-area geometry",
  };
}

function textLineMetric(
  nodeId: string,
  text: string,
  style: SceneStyle,
  fontSize: number,
  provider?: TextMetricsProvider,
): ResolvedTextLineMetrics {
  return resolveTextLineMetrics({ nodeId, text, style, fontSize }, provider);
}

function inspectText(
  box: LayoutBox,
  matrix: Matrix2D,
  options: LayoutInspectionOptions,
  provider?: TextMetricsProvider,
): TextInspection {
  const node = box.node;
  const style = node.style;
  const value = node.text ?? node.runs?.map((run) => run.text).join("") ?? "";
  const initialSize = readLength(style.fontSize, box.height, 24);
  const measureWidth = (line: string, size: number) =>
    textLineMetric(node.id, line, style, size, provider).width;
  const common = {
    minFontSize: readLength(style.minFontSize, box.height, 12),
    textFit: style.textFit,
    textOverflow: style.textOverflow,
    height: box.height,
    lineHeight: style.lineHeight,
  };
  const unbounded = prepareTextLayout(
    value,
    box.width,
    initialSize,
    measureWidth,
    { textFit: "wrap", lineHeight: style.lineHeight },
  );
  const prepared = prepareTextLayout(
    value,
    box.width,
    initialSize,
    measureWidth,
    { ...common, maxLines: style.maxLines },
  );
  const firstY =
    box.y +
    box.height / 2 -
    ((prepared.lines.length - 1) * prepared.lineHeight) / 2;
  let measurement: MeasurementQuality = "exact";
  let reason = "no text lines measured";
  const lines = prepared.lines.map((line, index) => {
    const metric = textLineMetric(
      node.id,
      line,
      style,
      prepared.fontSize,
      provider,
    );
    const width = metric.width;
    const drawnWidth = Math.min(width, box.width);
    const x =
      style.textAlign === "center"
        ? box.x + (box.width - drawnWidth) / 2
        : style.textAlign === "right"
          ? box.x + box.width - drawnWidth
          : box.x;
    const ascent = metric.ascent ?? prepared.fontSize * 0.8;
    const descent = metric.descent ?? prepared.fontSize * 0.2;
    const widthProvenance = metric.fieldMeasurements.width;
    const missingVerticalReason =
      metric.fieldMeasurements.ascent === undefined &&
      metric.fieldMeasurements.descent === undefined
        ? "ascent/descent use portable font-size ratios"
        : undefined;
    const ascentProvenance = metric.fieldMeasurements.ascent ?? {
      measurement: "estimated" as const,
      reason: missingVerticalReason ?? "ascent uses portable font-size ratio",
    };
    const descentProvenance = metric.fieldMeasurements.descent ?? {
      measurement: "estimated" as const,
      reason: missingVerticalReason ?? "descent uses portable font-size ratio",
    };
    const metricMeasurement = worstMeasurement(
      widthProvenance.measurement,
      ascentProvenance.measurement,
      descentProvenance.measurement,
    );
    const transformedLineEstimated = !matrixPreservesAxisAlignment(matrix);
    const lineMeasurement = transformedLineEstimated
      ? worstMeasurement(metricMeasurement, "estimated")
      : metricMeasurement;
    const metricReason = measurementReasons(
      [widthProvenance, ascentProvenance, descentProvenance],
      metricMeasurement,
    );
    const lineReason = transformedLineEstimated
      ? `${metricReason}; world bounds conservatively enclose rotated text geometry`
      : metricReason;
    if (measurementRank[lineMeasurement] > measurementRank[measurement]) {
      measurement = lineMeasurement;
      reason = lineReason;
    } else if (reason === "no text lines measured") {
      reason = lineReason;
    }
    const lineBounds = {
      x,
      y: firstY + index * prepared.lineHeight - prepared.lineHeight / 2,
      width: drawnWidth,
      height: prepared.lineHeight,
    };
    return {
      text: line,
      bounds: measured(
        transformLayoutRect(matrix, lineBounds),
        lineMeasurement,
        lineReason,
      ),
      width,
      ascent,
      descent,
      measurement: lineMeasurement,
      reason: lineReason,
    };
  });
  const horizontal = lines.some((line) => line.width > box.width + 1e-6);
  const vertical =
    unbounded.lines.length * unbounded.lineHeight > box.height + 1e-6 ||
    unbounded.lines.length > prepared.lines.length;
  return {
    value,
    lines,
    fontFamily: style.fontFamily ?? "system-ui, sans-serif",
    fontSize: prepared.fontSize,
    fontWeight: style.fontWeight ?? 400,
    fontStyle: style.fontStyle ?? "normal",
    lineHeight: prepared.lineHeight,
    direction: style.direction ?? "inherit",
    fit: style.textFit ?? "wrap",
    overflow:
      horizontal && vertical
        ? "both"
        : horizontal
          ? "horizontal"
          : vertical
            ? "vertical"
            : "none",
    truncated:
      unbounded.lines.length > prepared.lines.length ||
      unbounded.lines.join("\n") !== prepared.lines.join("\n"),
    measurement,
    reason,
  };
}

function inspectMedia(
  asset: SceneAsset,
  box: LayoutBox,
  matrix: Matrix2D,
  options: LayoutInspectionOptions,
) {
  const metrics = mediaMetrics(asset, options.mediaMetrics);
  const width = metrics.width ?? box.width;
  const height = metrics.height ?? box.height;
  const widthProvenance = metrics.fieldMeasurements.width ?? {
    measurement: "estimated" as const,
    reason: `${metrics.reason}; missing intrinsic width uses the layout box`,
  };
  const heightProvenance = metrics.fieldMeasurements.height ?? {
    measurement: "estimated" as const,
    reason: `${metrics.reason}; missing intrinsic height uses the layout box`,
  };
  const intrinsicMeasurement = worstMeasurement(
    widthProvenance.measurement,
    heightProvenance.measurement,
  );
  const intrinsicReason = measurementReasons(
    [widthProvenance, heightProvenance],
    intrinsicMeasurement,
  );
  const transformedMediaEstimated = !matrixPreservesAxisAlignment(matrix);
  const mediaMeasurement = transformedMediaEstimated
    ? worstMeasurement(intrinsicMeasurement, "estimated")
    : intrinsicMeasurement;
  const mediaReason = transformedMediaEstimated
    ? `${intrinsicReason}; fitted bounds conservatively enclose rotated media geometry`
    : intrinsicReason;
  const fit = box.node.style.objectFit ?? "fill";
  const position = box.node.style.objectPosition ?? "center";
  const fitted = resolveObjectFitRect(fit, position, box, { width, height });
  const absolute = {
    x: box.x + fitted.x,
    y: box.y + fitted.y,
    width: fitted.width,
    height: fitted.height,
  };
  const visible = intersectRect(absolute, box);
  const area = Math.abs(absolute.width * absolute.height);
  const cropFraction =
    area <= 0
      ? 0
      : Math.max(0, Math.min(1, 1 - (visible.width * visible.height) / area));
  return {
    assetId: asset.id,
    intrinsic: {
      width,
      height,
      ...(metrics.durationSeconds !== undefined
        ? { durationSeconds: metrics.durationSeconds }
        : {}),
      ...(metrics.frameRate !== undefined
        ? { frameRate: structuredClone(metrics.frameRate) }
        : {}),
    },
    fittedBounds: measured(
      transformLayoutRect(matrix, absolute),
      mediaMeasurement,
      mediaReason,
    ),
    objectFit: fit,
    objectPosition: position,
    cropFraction,
    measurement: mediaMeasurement,
    reason: mediaReason,
  };
}

function attachFlexOverflow(nodes: WorkingNode[]): void {
  const byParent = new Map<string, WorkingNode[]>();
  nodes.forEach((node) => {
    if (node.parentId) {
      const children = byParent.get(node.parentId) ?? [];
      children.push(node);
      byParent.set(node.parentId, children);
    }
  });
  nodes.forEach((node) => {
    if (node.node.style.display !== "flex") return;
    const children = byParent.get(node.id) ?? [];
    const axis =
      node.node.style.flexDirection === "column" ? "vertical" : "horizontal";
    const content = node.contentBounds;
    const end = children.reduce(
      (maximum, child) =>
        Math.max(
          maximum,
          axis === "horizontal"
            ? child.layoutBounds.x + child.layoutBounds.width
            : child.layoutBounds.y + child.layoutBounds.height,
        ),
      axis === "horizontal" ? content.x : content.y,
    );
    const limit =
      axis === "horizontal"
        ? content.x + content.width
        : content.y + content.height;
    const start = children.reduce(
      (minimum, child) =>
        Math.min(
          minimum,
          axis === "horizontal" ? child.layoutBounds.x : child.layoutBounds.y,
        ),
      axis === "horizontal" ? content.x : content.y,
    );
    const contentStart = axis === "horizontal" ? content.x : content.y;
    const amount = Math.max(contentStart - start, end - limit, 0);
    if (amount > 1e-6) node.flexOverflow = { axis, amount };
  });
}

function diagnosticsFor(
  scene: Scene,
  frame: number,
  nodes: WorkingNode[],
  options: LayoutInspectionOptions,
): InspectionDiagnostic[] {
  const result: InspectionDiagnostic[] = [];
  const sceneRect = { x: 0, y: 0, width: scene.width, height: scene.height };
  const insets =
    typeof options.unsafeInsets === "number"
      ? {
          top: options.unsafeInsets,
          right: options.unsafeInsets,
          bottom: options.unsafeInsets,
          left: options.unsafeInsets,
        }
      : (options.unsafeInsets ?? {
          top: scene.height * 0.05,
          right: scene.width * 0.05,
          bottom: scene.height * 0.05,
          left: scene.width * 0.05,
        });
  const safe = {
    x: insets.left,
    y: insets.top,
    width: Math.max(0, scene.width - insets.left - insets.right),
    height: Math.max(0, scene.height - insets.top - insets.bottom),
  };
  const add = (
    node: WorkingNode,
    code: DiagnosticCode,
    remediation: RemediationClass,
    baseConfidence: "high" | "medium" | "low",
    baseConfidenceScore: number,
    reason: string,
    relatedNodes: WorkingNode[] = [],
    severity: "info" | "warning" = "warning",
    extraMeasurements: Array<{
      measurement: MeasurementQuality;
      reason: string;
    }> = [],
  ) => {
    const evidence = [node, ...relatedNodes].flatMap((entry) => [
      {
        measurement: entry.transformedBounds.measurement,
        reason: entry.transformedBounds.reason,
      },
      {
        measurement: entry.clipBounds.measurement,
        reason: entry.clipBounds.reason,
      },
      entry.effectiveVisibility,
    ]);
    evidence.push(...extraMeasurements);
    const quality = worstMeasurement(
      ...evidence.map((entry) => entry.measurement),
    );
    const qualityConfidence =
      quality === "exact" ? "high" : quality === "declared" ? "medium" : "low";
    const confidence = lowerConfidence(baseConfidence, qualityConfidence);
    const qualityScore =
      quality === "exact" ? 1 : quality === "declared" ? 0.75 : 0.5;
    const limitingReasons = Array.from(
      new Set(
        evidence
          .filter(
            (entry) => entry.measurement === quality && quality !== "exact",
          )
          .map((entry) => entry.reason),
      ),
    );
    result.push({
      code,
      severity,
      nodeId: node.id,
      relatedNodeIds: relatedNodes.map((entry) => entry.id),
      frame,
      timeSeconds: frame / scene.fps,
      bounds: node.transformedBounds,
      sourcePath: node.sourcePath,
      remediation,
      confidence,
      confidenceScore: Math.min(baseConfidenceScore, qualityScore),
      reason:
        limitingReasons.length === 0
          ? reason
          : `${reason}; ${quality} evidence: ${limitingReasons.join("; ")}`,
    });
  };
  nodes.forEach((node) => {
    if (
      node.transformedBounds.width <= 0 ||
      node.transformedBounds.height <= 0
    ) {
      add(
        node,
        "zero_size",
        "move_or_resize",
        "high",
        1,
        "transformed bounds have zero area",
      );
    } else if (rectIntersectionArea(node.transformedBounds, sceneRect) === 0) {
      add(
        node,
        "outside_frame",
        "move_or_resize",
        "high",
        1,
        "bounds do not intersect the composition frame",
      );
    }
    if (
      node.semanticRole &&
      options.safeAreaRoles?.includes(node.semanticRole) &&
      (node.transformedBounds.x < safe.x ||
        node.transformedBounds.y < safe.y ||
        node.transformedBounds.x + node.transformedBounds.width >
          safe.x + safe.width ||
        node.transformedBounds.y + node.transformedBounds.height >
          safe.y + safe.height)
    ) {
      add(
        node,
        "unsafe_edge",
        "respect_safe_area",
        "high",
        0.95,
        `explicit safe-area role "${node.semanticRole}" crosses the configured safe region`,
      );
    }
    if (
      node.media &&
      node.media.cropFraction > (options.excessiveCropThreshold ?? 0.5)
    ) {
      add(
        node,
        "excessive_crop",
        "adjust_media_crop",
        node.media.measurement === "exact" ? "high" : "medium",
        node.media.measurement === "exact" ? 0.95 : 0.75,
        `${Math.round(node.media.cropFraction * 100)}% of fitted media lies outside its box`,
        [],
        "warning",
        [node.media],
      );
    }
    if (node.flexOverflow) {
      add(
        node,
        "flex_overflow",
        "fix_flex_layout",
        "high",
        0.95,
        `flex children exceed the ${node.flexOverflow.axis} content extent by ${node.flexOverflow.amount.toFixed(2)}px`,
      );
    }
  });
  for (let leftIndex = 0; leftIndex < nodes.length; leftIndex += 1) {
    const left = nodes[leftIndex];
    if (
      !left ||
      left.type === "audio" ||
      isDisplayNone(left.style) ||
      !left.effectiveVisibility.visible
    )
      continue;
    for (
      let rightIndex = leftIndex + 1;
      rightIndex < nodes.length;
      rightIndex += 1
    ) {
      const right = nodes[rightIndex];
      if (
        !right ||
        right.type === "audio" ||
        isDisplayNone(right.style) ||
        !right.effectiveVisibility.visible
      )
        continue;
      if (
        left.parentIds.includes(right.id) ||
        right.parentIds.includes(left.id)
      )
        continue;
      if (overlapAllowed(left.id, right.id, options.allowedOverlaps)) continue;
      const leftVisible = intersectRect(
        left.transformedBounds,
        left.clipBounds,
      );
      const rightVisible = intersectRect(
        right.transformedBounds,
        right.clipBounds,
      );
      const area = rectIntersectionArea(leftVisible, rightVisible);
      if (area <= 0) continue;
      const overlapQuality = worstMeasurement(
        left.transformedBounds.measurement,
        left.clipBounds.measurement,
        right.transformedBounds.measurement,
        right.clipBounds.measurement,
      );
      const overlapReason =
        overlapQuality === "exact"
          ? `geometry intersects by ${area.toFixed(2)} square pixels; explicit overlap intent was not supplied`
          : `conservative ${overlapQuality} bounds intersect by approximately ${area.toFixed(2)} square pixels; explicit overlap intent was not supplied`;
      add(
        right,
        "geometric_overlap",
        "declare_overlap_intent",
        "high",
        0.9,
        overlapReason,
        [left],
        "info",
      );
      const top = left.paintOrder > right.paintOrder ? left : right;
      const bottom = top === left ? right : left;
      add(
        bottom,
        "possible_occlusion",
        "reorder_layers",
        "medium",
        0.65,
        `higher paint-order node "${top.id}" intersects this node; pixel opacity was not inspected`,
        [top],
        "info",
      );
      if (
        left.semanticRole === "subtitle" ||
        right.semanticRole === "subtitle"
      ) {
        const subtitle = left.semanticRole === "subtitle" ? left : right;
        const other = subtitle === left ? right : left;
        if (other.paintOrder > subtitle.paintOrder) {
          add(
            subtitle,
            "subtitle_collision",
            "move_or_resize",
            "high",
            0.95,
            `explicit subtitle role intersects node "${other.id}"`,
            [other],
          );
        }
      }
    }
  }
  result.sort(
    (left, right) =>
      left.frame - right.frame ||
      compareCodeUnits(left.nodeId, right.nodeId) ||
      compareCodeUnits(left.code, right.code) ||
      compareCodeUnits(
        left.relatedNodeIds.join("\u0000"),
        right.relatedNodeIds.join("\u0000"),
      ),
  );
  return result;
}

function lowerConfidence(
  left: "high" | "medium" | "low",
  right: "high" | "medium" | "low",
): "high" | "medium" | "low" {
  const rank = { high: 0, medium: 1, low: 2 } as const;
  return rank[left] >= rank[right] ? left : right;
}

function compareCodeUnits(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function overlapAllowed(
  left: string,
  right: string,
  pairs: LayoutInspectionOptions["allowedOverlaps"],
): boolean {
  return Boolean(
    pairs?.some(
      ([first, second]) =>
        (first === left && second === right) ||
        (first === right && second === left),
    ),
  );
}

export function hitTest(
  sceneInput: unknown,
  frame: number,
  point: Point,
  options: HitTestOptions = {},
): HitTestResult {
  if (!Number.isFinite(point.x) || !Number.isFinite(point.y)) {
    throw new RangeError("Hit-test point coordinates must be finite numbers.");
  }
  const snapshot = inspectLayout(sceneInput, frame, options);
  const scene = parseScene(sceneInput);
  const resolved = evaluateScene(scene, snapshot.frame);
  const nodeById = new Map<string, ResolvedNode>();
  const visit = (nodes: ResolvedNode[]): void => {
    nodes.forEach((node) => {
      nodeById.set(node.id, node);
      visit(node.children);
    });
  };
  visit(resolved.nodes);
  const layoutById = new Map(snapshot.nodes.map((node) => [node.id, node]));
  const isEffectivelyVisible = (node: LayoutInspectionNode): boolean => {
    for (
      let current: LayoutInspectionNode | undefined = node;
      current;
      current = current.parentId ? layoutById.get(current.parentId) : undefined
    ) {
      const resolvedNode = nodeById.get(current.id);
      if (
        !resolvedNode ||
        !inspectNodeVisibility(resolvedNode, current.layoutBounds).visible
      ) {
        return false;
      }
    }
    return true;
  };
  const hits = snapshot.nodes
    .filter((node) => {
      if (node.type === "audio" || isDisplayNone(node.style)) return false;
      if (!options.includeTransparent && !isEffectivelyVisible(node))
        return false;
      return (
        node.clipBounds.width > 0 &&
        node.clipBounds.height > 0 &&
        pointInRect(point, node.transformedBounds) &&
        pointInRect(point, node.clipBounds)
      );
    })
    .map((node) => {
      const inverse = invertAffineMatrix(node.transform);
      const layoutPoint = inverse ? transformLayoutPoint(inverse, point) : null;
      const localPoint = layoutPoint
        ? {
            x: layoutPoint.x - node.layoutBounds.x,
            y: layoutPoint.y - node.layoutBounds.y,
          }
        : null;
      const source = nodeById.get(node.id);
      let measurement: MeasurementQuality = inverse
        ? worstMeasurement(
            node.transformedBounds.measurement,
            node.clipBounds.measurement,
          )
        : "estimated";
      let reason = inverse
        ? measurement === "exact"
          ? "point transformed into node-local coordinates"
          : `point transformed through ${measurement} bounds`
        : "non-invertible transform; conservative bounds hit";
      const markEstimated = (value: string): void => {
        measurement = "estimated";
        reason = value;
      };
      if (layoutPoint && source?.shape) {
        const hit = pointInShape(layoutPoint, source.shape, node.layoutBounds, {
          strokeWidth: source.style.strokeWidth,
        });
        if (!hit.hit) return null;
        if (hit.estimated) {
          markEstimated("shape uses conservative path/stroke geometry");
        }
      }
      for (
        let constrained: typeof node | undefined = node;
        constrained;
        constrained = constrained.parentId
          ? layoutById.get(constrained.parentId)
          : undefined
      ) {
        const constraintNode = nodeById.get(constrained.id);
        const constraintInverse = invertAffineMatrix(constrained.transform);
        const constraintPoint = constraintInverse
          ? transformLayoutPoint(constraintInverse, point)
          : null;
        if (!constraintNode || !constraintPoint) {
          markEstimated(
            "non-invertible ancestor constraint uses conservative bounds",
          );
          continue;
        }
        if (constraintNode.style.overflow === "hidden") {
          const radii = resolveLayoutCornerRadii(
            constraintNode.style,
            constrained.layoutBounds,
          );
          if (
            !pointInRoundedLayoutRect(
              constraintPoint,
              constrained.layoutBounds,
              radii,
            )
          ) {
            return null;
          }
          if (hasCornerRadii(radii)) {
            markEstimated(
              "rounded overflow constraint uses renderer-parity geometry, not pixel coverage",
            );
          }
        }
        if (constraintNode.clip) {
          const clipHit = pointInShape(
            constraintPoint,
            constraintNode.clip,
            constrained.layoutBounds,
          );
          if (!clipHit.hit) return null;
          if (clipHit.estimated) {
            markEstimated("clip path uses conservative geometry");
          }
        }
        if (constraintNode.mask) {
          const mask = constraintNode.mask;
          const maskHit = pointInShape(
            constraintPoint,
            mask.shape,
            constrained.layoutBounds,
          );
          const opacity = mask.opacity ?? 1;
          const feather = mask.feather ?? 0;
          if (feather > 0) {
            markEstimated("feathered mask hit is conservative");
          } else if (mask.inverted) {
            if (opacity >= 1 && maskHit.hit && !maskHit.estimated) return null;
            if (opacity > 0 && opacity < 1) {
              markEstimated(
                "partially opaque inverted mask retains nonzero alpha",
              );
            }
          } else if (!maskHit.hit) {
            return null;
          }
          if (maskHit.estimated) {
            markEstimated("mask edge uses conservative geometry");
          }
        }
      }
      return {
        nodeId: node.id,
        sourcePath: node.sourcePath,
        paintOrder: node.paintOrder,
        zIndex: node.zIndex,
        localPoint,
        measurement,
        reason,
      };
    })
    .filter((value): value is NonNullable<typeof value> => value !== null)
    .sort((left, right) => right.paintOrder - left.paintOrder);
  return {
    kind: "dojo-video-engine.hit-test",
    version: 1,
    frame: snapshot.frame,
    timeSeconds: snapshot.timeSeconds,
    point,
    hits,
  };
}

function isDisplayNone(style: LayoutInspectionNode["style"]): boolean {
  return (style as Record<string, unknown>).display === "none";
}
