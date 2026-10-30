import { positionBidiTextSegments } from "./bidi-text";
import type {
  SceneEffectName,
  SceneEffectParams,
  SceneJsonValue,
  SceneMaskDescriptor,
  SceneNode,
  SceneShapeGeometry,
  SceneStyle,
  SceneTextRun,
} from "@motionforge/schema";
import {
  parseBorderValue,
  parsePaintValue,
  parseShadowListValue,
  parseTextStrokeValue,
  resolveGradientStopOffsets,
} from "@motionforge/schema/values";
import {
  getLayoutContentRect,
  identityAffineMatrix,
  multiplyAffineMatrices,
  normalizeLayoutCornerRadii,
  prepareTextLayout,
  resolveLayoutCornerRadii,
  resolveMediaMetrics,
  resolveObjectFitRect,
  resolveStyleTransformMatrix,
  resolveTextLineMetrics,
  transformLayoutRect,
  type AffineMatrix2D,
  type LayoutBox,
  type LayoutCornerRadii,
  type LayoutRect,
  type LayoutScene,
  type MeasureTextLine,
  type MediaMetricsProvider,
  type ResolvedNode,
  type ResolvedTextLineMetrics,
  type TextMetricsProvider,
} from "./index";

/**
 * Display lists are evaluated, ephemeral frame artifacts. Scene remains the
 * only canonical and persistable MotionForge document format.
 */
export type DisplayList = {
  kind: "motionforge.display-list";
  version: 1;
  ephemeral: true;
  composition: {
    schemaVersion: 1;
    width: number;
    height: number;
    fps: number;
    duration: number;
    frame: number;
  };
  groups: DisplayGroup[];
  requirements: DisplayCapabilityRequirement[];
  stats: DisplayListStats;
};

export type DisplayListStats = {
  nodes: number;
  operations: number;
  maxDepth: number;
  textCharacters: number;
  opaqueBytes: number;
};

export type DisplayCapabilityRequirement = {
  id: string;
  version: string;
  nodeIds: string[];
};

export type DisplayGroup = {
  kind: "group";
  /** Engine-owned, deterministic identity. It is never read from Scene data. */
  engineId: string;
  nodeId: string;
  nodeType: SceneNode["type"];
  /**
   * JSON-safe defensive snapshot used by compatibility painters/extensions.
   * Hierarchy is authoritative in DisplayGroup.children, so this is shallow
   * in the tree dimension and always carries node.children = [].
   */
  node: ResolvedNode;
  /** Stable node traversal order after sibling z-index sorting. */
  paintOrder: number;
  depth: number;
  box: DisplayRect;
  contentBox: DisplayRect;
  transform: AffineMatrix2D;
  worldTransform: AffineMatrix2D;
  transformedBounds: DisplayRect;
  composite: DisplayComposite;
  clip: DisplayGeometry | null;
  /** Applied after background paint, matching Scene v1 overflow semantics. */
  overflowClip: DisplayGeometry | null;
  mask: DisplayMask | null;
  background: DisplayBackgroundOperation | null;
  content: DisplayContentOperation | null;
  border: DisplayBorderOperation | null;
  /** Already sorted by z-index, stably by source order for ties. */
  children: DisplayGroup[];
};

export type DisplayRect = {
  x: number;
  y: number;
  width: number;
  height: number;
};

export type DisplayComposite = {
  opacity: number;
  blendMode: NonNullable<SceneStyle["blendMode"]>;
  filter: string | null;
  isolation: boolean;
  strategy: "direct" | "isolated";
};

export type DisplayMask = {
  geometry: DisplayGeometry;
  inverted: boolean;
  opacity: number;
  feather: number;
  strategy: "hard-clip" | "soft-raster";
};

export type DisplayGeometry =
  | {
      kind: "rounded-rect";
      rect: DisplayRect;
      radii: LayoutCornerRadii;
      fillRule: "nonzero";
      open: false;
    }
  | {
      kind: "ellipse";
      rect: DisplayRect;
      fillRule: "nonzero";
      open: false;
    }
  | {
      kind: "polyline";
      points: Array<{ x: number; y: number }>;
      closed: boolean;
      fillRule: "nonzero";
      open: boolean;
    }
  | {
      kind: "svg-path";
      d: string;
      viewBox: DisplayRect;
      matrix: AffineMatrix2D;
      bounds: DisplayRect;
      fillRule: "nonzero" | "evenodd";
      open: false;
    };

export type DisplayPaint =
  | { kind: "color"; source: string }
  | {
      kind: "linear-gradient";
      source: string;
      angleDeg: number;
      stops: DisplayGradientStop[];
    }
  | {
      kind: "radial-gradient";
      source: string;
      centerX: number;
      centerY: number;
      stops: DisplayGradientStop[];
    }
  | {
      kind: "conic-gradient";
      source: string;
      angleDeg: number;
      centerX: number;
      centerY: number;
      stops: DisplayGradientStop[];
    };

export type DisplayGradientStop = { color: string; offset: number };

export type DisplayShadow = {
  offsetX: number;
  offsetY: number;
  blur: number;
  color: string;
};

type DisplayOperationBase = {
  engineId: string;
  nodeId: string;
  /** Global leaf paint order for this frame. */
  paintOrder: number;
  /** Nominal geometry bounds. Opaque operations use the whole composition. */
  bounds: DisplayRect;
};

export type DisplayBackgroundOperation = DisplayOperationBase & {
  kind: "background";
  geometry: DisplayGeometry;
  paint: DisplayPaint;
  shadows: DisplayShadow[];
  shadowStrategy: "none" | "fill-with-shadow" | "layers-then-fill";
};

export type DisplayBorderOperation = DisplayOperationBase & {
  kind: "border";
  geometry: DisplayGeometry;
  paint: DisplayPaint;
  width: number;
};

export type DisplayStroke = {
  paint: DisplayPaint;
  width: number;
  lineCap: "butt" | "round" | "square";
  lineJoin: "bevel" | "round" | "miter";
  dash: number[];
};

export type DisplayShapeOperation = DisplayOperationBase & {
  kind: "shape";
  geometry: DisplayGeometry;
  fill: DisplayPaint | null;
  stroke: DisplayStroke | null;
};

export type DisplayTextStroke = { width: number; color: string };

export type DisplayTextBackground = {
  color: string;
  paddingX: number;
  paddingY: number;
  radius: number;
};

export type DisplayTextRun = {
  engineId: string;
  text: string;
  x: number;
  width: number;
  fill: string;
  opacity: number;
  stroke: DisplayTextStroke | null;
  backgroundColor: string | null;
  /** Fitted plate geometry; optional for older DisplayList v1 producers. */
  background?: DisplayTextBackground | null;
};

export type DisplayTextLine = {
  engineId: string;
  text: string;
  x: number;
  y: number;
  width: number;
  maxWidth: number | null;
  background: DisplayTextBackground | null;
  runs: DisplayTextRun[];
  metrics: {
    width: number;
    ascent: number;
    descent: number;
    measurement: ResolvedTextLineMetrics["measurement"];
    reason: string;
  };
};

export type DisplayTextOperation = DisplayOperationBase & {
  kind: "text";
  value: string;
  font: {
    family: string;
    size: number;
    weight: string | number;
    style: "normal" | "italic";
  };
  direction: "ltr" | "rtl" | "inherit";
  align: "left" | "center" | "right";
  baseline: "middle";
  lineHeight: number;
  letterSpacing: number;
  fill: string;
  stroke: DisplayTextStroke | null;
  shadow: DisplayShadow | null;
  lines: DisplayTextLine[];
};

export type DisplayMediaReference =
  | { kind: "image"; assetId: string }
  | {
      kind: "prepared-video";
      assetId: string;
      nodeId: string;
      sceneFrame: number;
    }
  | {
      kind: "prepared-lottie";
      assetId: string;
      nodeId: string;
      sceneFrame: number;
    };

export type DisplayMediaOperation = DisplayOperationBase & {
  kind: "media";
  resource: DisplayMediaReference;
  clip: DisplayGeometry;
  objectFit: "contain" | "cover" | "fill" | "none" | "scale-down";
  objectPosition: string;
  intrinsic: {
    width: number;
    height: number;
    measurement: "exact" | "declared" | "estimated";
    reason: string;
  } | null;
  fittedBox: DisplayRect | null;
  sampling:
    | { kind: "smooth"; quality: "high" }
    | { kind: "pixelated"; pixelSize: number };
};

export type DisplayEffectOperation = DisplayOperationBase & {
  kind: "effect";
  effect: SceneEffectName;
  params: SceneEffectParams;
  localFrame: number;
  duration: number;
  sceneFps: number;
  capability: { id: "motionforge.effect"; version: "1" };
};

export type DisplayExtensionCompilationInput =
  | {
      kind: "standard";
      version: string;
      operations: readonly SceneJsonValue[];
    }
  | {
      kind: "opaque";
      capability: { id: string; version: string };
      payload: SceneJsonValue;
    };

export type DisplayExtensionOperation = DisplayOperationBase &
  (
    | {
        kind: "extension";
        mode: "legacy-opaque";
        extension: { name: string; version: string; params: SceneJsonValue };
        capability: {
          id: "motionforge.legacy.renderer-adapter";
          version: "1.0.0";
        };
      }
    | {
        kind: "extension";
        mode: "standard";
        extension: { name: string; version: string; params: SceneJsonValue };
        displayVersion: string;
        operations: SceneJsonValue[];
      }
    | {
        kind: "extension";
        mode: "opaque";
        extension: { name: string; version: string; params: SceneJsonValue };
        capability: { id: string; version: string };
        payload: SceneJsonValue;
      }
  );

export type DisplayContentOperation =
  | DisplayShapeOperation
  | DisplayTextOperation
  | DisplayMediaOperation
  | DisplayEffectOperation
  | DisplayExtensionOperation;

export type DisplayListCompilerBudgets = {
  maxNodes: number;
  maxOperations: number;
  maxDepth: number;
  maxTextCharacters: number;
  maxOpaqueBytes: number;
  maxPayloadDepth: number;
  maxPayloadNodes: number;
};

export const defaultDisplayListCompilerBudgets: DisplayListCompilerBudgets = {
  maxNodes: 10_000,
  maxOperations: 30_000,
  maxDepth: 64,
  maxTextCharacters: 2_000_000,
  maxOpaqueBytes: 4 * 1024 * 1024,
  maxPayloadDepth: 64,
  maxPayloadNodes: 100_000,
};

export type DisplayListCompileOptions = {
  /** Legacy callback takes precedence over the shared metrics provider. */
  measureTextLine?: MeasureTextLine;
  textMetrics?: TextMetricsProvider;
  mediaMetrics?: MediaMetricsProvider;
  /** Host bridge output keyed by extension node id. */
  extensionCompilations?: Readonly<
    Record<string, DisplayExtensionCompilationInput>
  >;
  budgets?: Partial<DisplayListCompilerBudgets>;
};

type CompileState = {
  budgets: DisplayListCompilerBudgets;
  stats: DisplayListStats;
  nodeIds: Set<string>;
  matchedExtensionIds: Set<string>;
  requirements: Map<
    string,
    { id: string; version: string; nodeIds: Set<string> }
  >;
  measure: MeasureTextLine;
  options: DisplayListCompileOptions;
  nodePaintOrder: number;
  operationPaintOrder: number;
};

/**
 * Compiles one already-evaluated/layout-resolved frame into deterministic,
 * renderer-neutral paint intent. The input is never mutated or retained.
 */
export function compileDisplayList(
  layout: LayoutScene,
  options: DisplayListCompileOptions = {},
): DisplayList {
  validateLayoutHeader(layout);
  const budgets = resolveCompilerBudgets(options.budgets);
  const state: CompileState = {
    budgets,
    stats: {
      nodes: 0,
      operations: 0,
      maxDepth: 0,
      textCharacters: 0,
      opaqueBytes: 0,
    },
    nodeIds: new Set(),
    matchedExtensionIds: new Set(),
    requirements: new Map(),
    measure: createCompilerMeasurer(options),
    options,
    nodePaintOrder: 0,
    operationPaintOrder: 0,
  };
  const groups = sortedBoxes(layout.boxes).map((box) =>
    compileGroup(box, layout, state, 0, identityAffineMatrix()),
  );
  for (const nodeId of Object.keys(
    options.extensionCompilations ?? {},
  ).sort()) {
    if (!state.matchedExtensionIds.has(nodeId)) {
      throw new Error(
        `Display-list extension compilation targets unknown or inactive node ${JSON.stringify(nodeId)}.`,
      );
    }
  }
  const requirements = Array.from(state.requirements.values())
    .sort(
      (left, right) =>
        compareCodeUnits(left.id, right.id) ||
        compareCodeUnits(left.version, right.version),
    )
    .map(({ id, version, nodeIds }) => ({
      id,
      version,
      nodeIds: Array.from(nodeIds).sort(compareCodeUnits),
    }));
  const result: DisplayList = {
    kind: "motionforge.display-list",
    version: 1,
    ephemeral: true,
    composition: {
      schemaVersion: 1,
      width: layout.width,
      height: layout.height,
      fps: layout.fps,
      duration: layout.duration,
      frame: layout.frame,
    },
    groups,
    requirements,
    stats: { ...state.stats },
  };
  // This is an executable contract invariant, not a claim that the artifact
  // should be persisted. It catches accidental native objects/functions.
  // Group/object + children/array consume two JSON levels per scene depth;
  // extension/effect payloads were already cloned under the stricter payload
  // ceiling, so the whole-artifact walk needs a structural allowance.
  assertJsonSafe(
    result,
    {
      ...budgets,
      maxPayloadDepth: Math.max(
        budgets.maxPayloadDepth,
        budgets.maxDepth * 2 + 16,
      ),
    },
    "display list",
  );
  return result;
}

function compileGroup(
  box: LayoutBox,
  layout: LayoutScene,
  state: CompileState,
  depth: number,
  parentTransform: AffineMatrix2D,
): DisplayGroup {
  countNode(state, box, depth);
  const engineId = nodeEngineId(box.id);
  const rect = copyRect(box);
  const contentBox = copyRect(getLayoutContentRect(box));
  const transform = resolveStyleTransformMatrix(box.node.style, rect);
  const worldTransform = multiplyAffineMatrices(parentTransform, transform);
  const style = box.node.style;
  const softMask =
    box.node.mask !== undefined &&
    ((box.node.mask.feather ?? 0) > 0 || (box.node.mask.opacity ?? 1) < 1);
  const composite: DisplayComposite = {
    opacity: style.opacity ?? 1,
    blendMode: style.blendMode ?? "source-over",
    filter:
      style.filter !== undefined && style.filter !== "none"
        ? style.filter
        : null,
    isolation: style.isolation ?? false,
    strategy: style.isolation || softMask ? "isolated" : "direct",
  };
  if (composite.filter) {
    requireCapability(state, "motionforge.filter", "1", box.id);
  }
  const clip = box.node.clip ? compileGeometry(box.node.clip, rect) : null;
  const overflowClip =
    style.overflow === "hidden"
      ? roundedRectGeometry(rect, resolveLayoutCornerRadii(style, rect))
      : null;
  const mask = box.node.mask ? compileMask(box.node.mask, rect) : null;
  if (mask?.strategy === "soft-raster") {
    requireCapability(state, "motionforge.mask.soft", "1", box.id);
  }
  const group: DisplayGroup = {
    kind: "group",
    engineId,
    nodeId: box.id,
    nodeType: box.node.type,
    node: cloneResolvedNode(box.node, state),
    paintOrder: state.nodePaintOrder++,
    depth,
    box: rect,
    contentBox,
    transform,
    worldTransform,
    transformedBounds: copyRect(transformLayoutRect(worldTransform, rect)),
    composite,
    clip,
    overflowClip,
    mask,
    background: compileBackground(box, state),
    content: compileContent(box, layout, state),
    border: compileBorder(box, state),
    children: [],
  };
  group.children = sortedBoxes(box.children).map((child) =>
    compileGroup(child, layout, state, depth + 1, worldTransform),
  );
  return group;
}

function compileBackground(
  box: LayoutBox,
  state: CompileState,
): DisplayBackgroundOperation | null {
  const source = box.node.style.background ?? box.node.style.backgroundColor;
  if (!source) return null;
  const paint = compilePaint(source, state, box.id);
  const shadows = (
    box.node.style.boxShadow
      ? parseShadowListValue(box.node.style.boxShadow)
      : []
  )?.map((shadow) => ({
    offsetX: shadow.offsetX,
    offsetY: shadow.offsetY,
    blur: shadow.blur,
    color: shadow.color.source,
  }));
  if (!shadows) {
    throw new Error(`Invalid box shadow on node ${JSON.stringify(box.id)}.`);
  }
  return operation(state, {
    kind: "background",
    engineId: `${nodeEngineId(box.id)}/background`,
    nodeId: box.id,
    bounds: copyRect(box),
    geometry: roundedRectGeometry(
      box,
      resolveLayoutCornerRadii(box.node.style, box),
    ),
    paint,
    shadows,
    shadowStrategy:
      shadows.length === 0
        ? "none"
        : shadows.length === 1
          ? "fill-with-shadow"
          : "layers-then-fill",
  });
}

function compileBorder(
  box: LayoutBox,
  state: CompileState,
): DisplayBorderOperation | null {
  const parsed = box.node.style.border
    ? parseBorderValue(box.node.style.border)
    : null;
  if (!parsed || parsed.width <= 0) return null;
  const inset = parsed.width / 2;
  const rect = {
    x: box.x + inset,
    y: box.y + inset,
    width: box.width - parsed.width,
    height: box.height - parsed.width,
  };
  const radii = resolveLayoutCornerRadii(box.node.style, box);
  return operation(state, {
    kind: "border",
    engineId: `${nodeEngineId(box.id)}/border`,
    nodeId: box.id,
    bounds: copyRect(box),
    geometry: roundedRectGeometry(rect, {
      topLeft: Math.max(0, radii.topLeft - inset),
      topRight: Math.max(0, radii.topRight - inset),
      bottomRight: Math.max(0, radii.bottomRight - inset),
      bottomLeft: Math.max(0, radii.bottomLeft - inset),
    }),
    paint: { kind: "color", source: parsed.color.source },
    width: parsed.width,
  });
}

function compileContent(
  box: LayoutBox,
  layout: LayoutScene,
  state: CompileState,
): DisplayContentOperation | null {
  const { node } = box;
  if (node.type === "text" && (node.text !== undefined || node.runs)) {
    return compileText(box, state);
  }
  if (
    (node.type === "img" || node.type === "video" || node.type === "lottie") &&
    node.assetId
  ) {
    return compileMedia(box, layout, state);
  }
  if (node.type === "shape" && node.shape) {
    return compileShape(box, state);
  }
  if (node.type === "effect" && node.effect) {
    requireCapability(state, "motionforge.effect", "1", node.id);
    return operation(state, {
      kind: "effect",
      engineId: `${nodeEngineId(node.id)}/effect`,
      nodeId: node.id,
      bounds: compositionRect(layout),
      effect: node.effect,
      params: cloneJson(
        node.params ?? {},
        state,
        `effect ${node.id} params`,
      ) as SceneEffectParams,
      localFrame: node.localFrame,
      duration: node.duration ?? 30,
      sceneFps: layout.fps,
      capability: { id: "motionforge.effect", version: "1" },
    });
  }
  if (node.type === "extension" && node.extension) {
    return compileExtension(box, layout, state);
  }
  return null;
}

function compileShape(
  box: LayoutBox,
  state: CompileState,
): DisplayShapeOperation {
  const geometry = compileGeometry(
    box.node.shape as SceneShapeGeometry,
    box,
    resolveLayoutCornerRadii(box.node.style, box),
  );
  const open = geometry.open;
  const fillSource = box.node.style.fill ?? (open ? undefined : "#000000");
  const strokeSource = box.node.style.stroke ?? (open ? "#000000" : undefined);
  const strokeWidth = box.node.style.strokeWidth ?? 1;
  return operation(state, {
    kind: "shape",
    engineId: `${nodeEngineId(box.id)}/shape`,
    nodeId: box.id,
    bounds: copyRect(box),
    geometry,
    fill: fillSource ? compilePaint(fillSource, state, box.id) : null,
    stroke:
      strokeSource && strokeWidth > 0
        ? {
            paint: compilePaint(strokeSource, state, box.id),
            width: strokeWidth,
            lineCap: box.node.style.strokeLineCap ?? "butt",
            lineJoin: box.node.style.strokeLineJoin ?? "miter",
            dash: [...(box.node.style.strokeDash ?? [])],
          }
        : null,
  });
}

function compileText(
  box: LayoutBox,
  state: CompileState,
): DisplayTextOperation {
  const style = box.node.style;
  const content = getLayoutContentRect(box);
  const textBox = { ...box, ...content };
  const value =
    box.node.text ?? box.node.runs?.map((run) => run.text).join("") ?? "";
  countText(state, value.length, box.id);
  const baseFontSize = readLength(style.fontSize, box.height, 24);
  const layout = prepareTextLayout(
    value,
    content.width,
    baseFontSize,
    (line, size) => state.measure(line, style, size, box.id),
    {
      maxLines: style.maxLines,
      minFontSize: readLength(style.minFontSize, box.height, 12),
      textFit: style.textFit,
      textOverflow: style.textOverflow,
      height: content.height,
      lineHeight: style.lineHeight,
    },
  );
  const align = style.textAlign ?? "left";
  const anchorX =
    align === "center"
      ? content.x + content.width / 2
      : align === "right"
        ? content.x + content.width
        : content.x;
  const firstLineY =
    content.y +
    content.height / 2 -
    ((layout.lines.length - 1) * layout.lineHeight) / 2;
  // Scene v1 resolves these three against the pre-shrink font size. Keeping
  // that detail here preserves current pixels while exposing it explicitly.
  const letterSpacing = readLength(style.letterSpacing, baseFontSize, 0);
  const nodeStroke = compileTextStroke(style.textStroke, baseFontSize);
  const nodeBackground = compileTextBackground(style, baseFontSize);
  const styledLines = box.node.runs
    ? richSegmentsByLine(box.node.runs, layout.lines)
    : null;
  const lines = layout.lines.map((line, lineIndex): DisplayTextLine => {
    const metrics = measureTextMetrics(
      state,
      box.id,
      line,
      style,
      layout.fontSize,
    );
    const width = box.node.runs
      ? metrics.width
      : Math.min(metrics.width, content.width);
    const y = firstLineY + lineIndex * layout.lineHeight;
    const lineX = textLineStart(align, textBox, anchorX, width);
    const positioned = positionBidiTextSegments(
      line,
      styledLines?.[lineIndex] ?? [],
      style.direction === "rtl" ? "rtl" : "ltr",
      lineX,
      width,
      (value, direction) =>
        state.measure(value, { ...style, direction }, layout.fontSize, box.id),
    );
    const runs = positioned.map((segment, runIndex): DisplayTextRun => {
      const runStyle = segment.run.style ?? {};
      const run: DisplayTextRun = {
        engineId: `${nodeEngineId(box.id)}/text/line:${lineIndex}/run:${runIndex}`,
        text: segment.text,
        x: segment.x,
        width: segment.width,
        fill: runStyle.color ?? style.color ?? "#ffffff",
        opacity: runStyle.opacity ?? 1,
        stroke: runStyle.textStroke
          ? compileTextStroke(runStyle.textStroke, layout.fontSize)
          : nodeStroke,
        backgroundColor: runStyle.textBackgroundColor ?? null,
        background: runStyle.textBackgroundColor
          ? compileTextBackground({ ...style, ...runStyle }, layout.fontSize)
          : null,
      };
      return run;
    });
    return {
      engineId: `${nodeEngineId(box.id)}/text/line:${lineIndex}`,
      text: line,
      x: box.node.runs ? lineX : anchorX,
      y,
      width,
      maxWidth: box.node.runs ? null : content.width,
      background: nodeBackground,
      runs,
      metrics: {
        width: metrics.width,
        ascent: metrics.ascent ?? layout.fontSize * 0.8,
        descent: metrics.descent ?? layout.fontSize * 0.2,
        measurement: metrics.measurement,
        reason: metrics.reason,
      },
    };
  });
  return operation(state, {
    kind: "text",
    engineId: `${nodeEngineId(box.id)}/text`,
    nodeId: box.id,
    bounds: copyRect(content),
    value,
    font: {
      family: style.fontFamily ?? "system-ui, sans-serif",
      size: layout.fontSize,
      weight: style.fontWeight ?? 400,
      style: style.fontStyle ?? "normal",
    },
    direction: style.direction ?? "inherit",
    align,
    baseline: "middle",
    lineHeight: layout.lineHeight,
    letterSpacing,
    fill: style.color ?? "#ffffff",
    stroke: nodeStroke,
    shadow: compileSingleShadow(style.textShadow),
    lines,
  });
}

function compileMedia(
  box: LayoutBox,
  layout: LayoutScene,
  state: CompileState,
): DisplayMediaOperation {
  const node = box.node;
  const assetId = node.assetId as string;
  const resource: DisplayMediaReference =
    node.type === "img"
      ? { kind: "image", assetId }
      : node.type === "video"
        ? {
            kind: "prepared-video",
            assetId,
            nodeId: node.id,
            sceneFrame: layout.frame,
          }
        : {
            kind: "prepared-lottie",
            assetId,
            nodeId: node.id,
            sceneFrame: layout.frame,
          };
  const asset = layout.assets[assetId];
  const metrics = asset
    ? resolveMediaMetrics(asset, state.options.mediaMetrics)
    : null;
  const hasSize = metrics?.width !== undefined && metrics.height !== undefined;
  const relative = hasSize
    ? resolveObjectFitRect(
        node.style.objectFit,
        node.style.objectPosition,
        box,
        { width: metrics.width as number, height: metrics.height as number },
      )
    : null;
  const radius = resolveLayoutCornerRadii(node.style, box);
  return operation(state, {
    kind: "media",
    engineId: `${nodeEngineId(node.id)}/media`,
    nodeId: node.id,
    bounds: copyRect(box),
    resource,
    clip: roundedRectGeometry(box, radius),
    objectFit: node.style.objectFit ?? "fill",
    objectPosition: node.style.objectPosition ?? "center",
    intrinsic:
      hasSize && metrics
        ? {
            width: metrics.width!,
            height: metrics.height!,
            measurement: metrics.measurement,
            reason: metrics.reason,
          }
        : null,
    fittedBox: relative
      ? {
          x: box.x + relative.x,
          y: box.y + relative.y,
          width: relative.width,
          height: relative.height,
        }
      : null,
    sampling:
      node.style.imageRendering === "pixelated"
        ? {
            kind: "pixelated",
            pixelSize: Math.max(1, Math.round(node.style.pixelSize ?? 12)),
          }
        : { kind: "smooth", quality: "high" },
  });
}

function compileExtension(
  box: LayoutBox,
  layout: LayoutScene,
  state: CompileState,
): DisplayExtensionOperation {
  const descriptor = box.node.extension;
  if (!descriptor) {
    throw new Error(
      `Extension node ${JSON.stringify(box.id)} has no descriptor.`,
    );
  }
  state.matchedExtensionIds.add(box.id);
  const extension = {
    name: descriptor.name,
    version: descriptor.version,
    params: cloneJson(descriptor.params, state, `extension ${box.id} params`),
  };
  const supplied = state.options.extensionCompilations?.[box.id];
  const opaqueBounds = compositionRect(layout);
  if (!supplied) {
    countOpaqueBytes(state, extension.params, box.id);
    requireCapability(
      state,
      "motionforge.legacy.renderer-adapter",
      "1.0.0",
      box.id,
    );
    return operation(state, {
      kind: "extension",
      mode: "legacy-opaque",
      engineId: `${nodeEngineId(box.id)}/extension`,
      nodeId: box.id,
      bounds: opaqueBounds,
      extension,
      capability: {
        id: "motionforge.legacy.renderer-adapter",
        version: "1.0.0",
      },
    });
  }
  if (supplied.kind === "standard") {
    if (supplied.version.trim() === "" || supplied.version.length > 64) {
      throw new Error(
        `Standard extension compilation for ${JSON.stringify(box.id)} needs a non-empty version of at most 64 characters.`,
      );
    }
    const operations = cloneJson(
      supplied.operations,
      state,
      `extension ${box.id} standard operations`,
      true,
    ) as SceneJsonValue[];
    countOpaqueBytes(state, operations, box.id);
    return operation(state, {
      kind: "extension",
      mode: "standard",
      engineId: `${nodeEngineId(box.id)}/extension`,
      nodeId: box.id,
      bounds: opaqueBounds,
      extension,
      displayVersion: supplied.version,
      operations,
    });
  }
  validateCapability(supplied.capability, box.id);
  const payload = cloneJson(
    supplied.payload,
    state,
    `extension ${box.id} opaque payload`,
    true,
  );
  countOpaqueBytes(state, payload, box.id);
  requireCapability(
    state,
    supplied.capability.id,
    supplied.capability.version,
    box.id,
  );
  return operation(state, {
    kind: "extension",
    mode: "opaque",
    engineId: `${nodeEngineId(box.id)}/extension`,
    nodeId: box.id,
    bounds: opaqueBounds,
    extension,
    capability: { ...supplied.capability },
    payload,
  });
}

function compileMask(mask: SceneMaskDescriptor, box: DisplayRect): DisplayMask {
  const opacity = mask.opacity ?? 1;
  const feather = mask.feather ?? 0;
  return {
    geometry: compileGeometry(mask.shape, box),
    inverted: mask.inverted ?? false,
    opacity,
    feather,
    strategy: feather > 0 || opacity < 1 ? "soft-raster" : "hard-clip",
  };
}

function compileGeometry(
  geometry: SceneShapeGeometry,
  box: DisplayRect,
  rectFallbackRadius: LayoutCornerRadii = zeroRadii(),
): DisplayGeometry {
  if (geometry.kind === "rect") {
    const radius =
      geometry.radius === undefined
        ? rectFallbackRadius
        : readLength(geometry.radius, Math.min(box.width, box.height), 0);
    return roundedRectGeometry(box, radius);
  }
  if (geometry.kind === "ellipse") {
    return {
      kind: "ellipse",
      rect: copyRect(box),
      fillRule: "nonzero",
      open: false,
    };
  }
  if (
    geometry.kind === "line" ||
    geometry.kind === "polyline" ||
    geometry.kind === "polygon"
  ) {
    return {
      kind: "polyline",
      points: geometry.points.map((point) => ({
        x: box.x + point.x * box.width,
        y: box.y + point.y * box.height,
      })),
      closed: geometry.kind === "polygon",
      fillRule: "nonzero",
      open: geometry.kind !== "polygon",
    };
  }
  return {
    kind: "svg-path",
    d: geometry.d,
    viewBox: copyRect(geometry.viewBox),
    matrix: {
      a: box.width / geometry.viewBox.width,
      b: 0,
      c: 0,
      d: box.height / geometry.viewBox.height,
      e: box.x - geometry.viewBox.x * (box.width / geometry.viewBox.width),
      f: box.y - geometry.viewBox.y * (box.height / geometry.viewBox.height),
    },
    bounds: copyRect(box),
    fillRule: geometry.fillRule ?? "nonzero",
    open: false,
  };
}

function roundedRectGeometry(
  rect: DisplayRect,
  radii: number | LayoutCornerRadii,
): DisplayGeometry {
  return {
    kind: "rounded-rect",
    rect: copyRect(rect),
    radii: normalizeLayoutCornerRadii(radii, rect.width, rect.height),
    fillRule: "nonzero",
    open: false,
  };
}

function compilePaint(
  source: string,
  state: CompileState,
  nodeId: string,
): DisplayPaint {
  const parsed = parsePaintValue(source);
  if (!parsed) {
    throw new Error(`Invalid paint on node ${JSON.stringify(nodeId)}.`);
  }
  if (parsed.kind === "rgba" || parsed.kind === "named") {
    return { kind: "color", source: parsed.source };
  }
  const stops = resolveGradientStopOffsets(parsed.stops);
  if (parsed.kind === "linear-gradient") {
    return {
      kind: "linear-gradient",
      source,
      angleDeg: parsed.angleDeg,
      stops,
    };
  }
  if (parsed.kind === "radial-gradient") {
    return {
      kind: "radial-gradient",
      source,
      centerX: parsed.centerX,
      centerY: parsed.centerY,
      stops,
    };
  }
  requireCapability(state, "motionforge.paint.conic", "1", nodeId);
  return {
    kind: "conic-gradient",
    source,
    angleDeg: parsed.angleDeg,
    centerX: parsed.centerX,
    centerY: parsed.centerY,
    stops,
  };
}

function compileTextStroke(
  source: string | undefined,
  fontSize: number,
): DisplayTextStroke | null {
  if (!source) return null;
  const parsed = parseTextStrokeValue(source);
  if (!parsed) return null;
  return {
    width:
      parsed.width.unit === "%"
        ? (parsed.width.value / 100) * fontSize
        : parsed.width.value,
    color: parsed.color.source,
  };
}

function compileTextBackground(
  style: SceneStyle,
  fontSize: number,
): DisplayTextBackground | null {
  if (!style.textBackgroundColor) return null;
  const padding = readLength(style.textBackgroundPadding, fontSize, 0);
  return {
    color: style.textBackgroundColor,
    paddingX: Math.max(
      0,
      readLength(style.textBackgroundPaddingX, fontSize, padding),
    ),
    paddingY: Math.max(
      0,
      readLength(style.textBackgroundPaddingY, fontSize, padding),
    ),
    radius: Math.max(0, readLength(style.textBackgroundRadius, fontSize, 0)),
  };
}

function compileSingleShadow(source: string | undefined): DisplayShadow | null {
  if (!source) return null;
  const parsed = parseShadowListValue(source);
  const shadow = parsed?.[0];
  return shadow
    ? {
        offsetX: shadow.offsetX,
        offsetY: shadow.offsetY,
        blur: shadow.blur,
        color: shadow.color.source,
      }
    : null;
}

type RichSegment = { text: string; run: SceneTextRun };

function richSegmentsByLine(
  runs: SceneTextRun[],
  lines: string[],
): RichSegment[][] {
  const source = runs.flatMap((run) =>
    Array.from(run.text).map((character) => ({ character, run })),
  );
  let sourceIndex = 0;
  const fallbackRun = runs[runs.length - 1] ?? { text: "", style: {} };
  return lines.map((line) => {
    const segments: RichSegment[] = [];
    for (const character of Array.from(line)) {
      let matchedIndex = sourceIndex;
      while (
        matchedIndex < source.length &&
        source[matchedIndex]?.character !== character
      ) {
        matchedIndex += 1;
      }
      const matched = source[matchedIndex];
      const run = matched?.run ?? fallbackRun;
      if (matched) sourceIndex = matchedIndex + 1;
      const previous = segments[segments.length - 1];
      if (previous?.run === run) previous.text += character;
      else segments.push({ text: character, run });
    }
    return segments;
  });
}

function createCompilerMeasurer(
  options: DisplayListCompileOptions,
): MeasureTextLine {
  if (options.measureTextLine) {
    return (text, style, fontSize, nodeId) => {
      const width = options.measureTextLine!(text, style, fontSize, nodeId);
      if (!Number.isFinite(width) || width < 0) {
        throw new TypeError(
          `Display-list text measurer returned invalid width for node ${JSON.stringify(nodeId ?? "__unknown__")}.`,
        );
      }
      return width;
    };
  }
  return (text, style, fontSize, nodeId) =>
    resolveTextLineMetrics(
      { nodeId: nodeId ?? "__unknown__", text, style, fontSize },
      options.textMetrics,
    ).width;
}

function measureTextMetrics(
  state: CompileState,
  nodeId: string,
  text: string,
  style: SceneStyle,
  fontSize: number,
): ResolvedTextLineMetrics {
  if (state.options.textMetrics) {
    return resolveTextLineMetrics(
      { nodeId, text, style, fontSize },
      state.options.textMetrics,
    );
  }
  if (state.options.measureTextLine) {
    const width = state.options.measureTextLine(text, style, fontSize, nodeId);
    if (!Number.isFinite(width) || width < 0) {
      throw new TypeError(
        `Display-list text measurer returned invalid width for node ${JSON.stringify(nodeId)}.`,
      );
    }
    return {
      width,
      ascent: fontSize * 0.8,
      descent: fontSize * 0.2,
      measurement: "estimated",
      reason: "legacy width-only text measurer; vertical metrics estimated",
      fieldMeasurements: {
        width: { measurement: "exact", reason: "legacy width-only callback" },
        ascent: { measurement: "estimated", reason: "font-size heuristic" },
        descent: { measurement: "estimated", reason: "font-size heuristic" },
      },
    };
  }
  return resolveTextLineMetrics(
    { nodeId, text, style, fontSize },
    state.options.textMetrics,
  );
}

function cloneResolvedNode(
  node: ResolvedNode,
  state: CompileState,
): ResolvedNode {
  return cloneJson(
    { ...node, children: [] },
    state,
    `resolved node ${node.id}`,
  ) as ResolvedNode;
}

function cloneJson(
  value: unknown,
  state: CompileState,
  label: string,
  strictJsonProperties = false,
): SceneJsonValue {
  const seen = new Set<object>();
  let nodes = 0;
  const visit = (
    current: unknown,
    depth: number,
    path: string,
  ): SceneJsonValue => {
    nodes += 1;
    if (nodes > state.budgets.maxPayloadNodes) {
      throw new RangeError(
        `${label} exceeds display-list payload node budget ${state.budgets.maxPayloadNodes}.`,
      );
    }
    if (depth > state.budgets.maxPayloadDepth) {
      throw new RangeError(
        `${label} exceeds display-list payload depth budget ${state.budgets.maxPayloadDepth}.`,
      );
    }
    if (
      current === null ||
      typeof current === "string" ||
      typeof current === "boolean"
    ) {
      return current;
    }
    if (typeof current === "number") {
      if (!Number.isFinite(current)) {
        throw new TypeError(
          `${label} contains a non-finite number at ${path}.`,
        );
      }
      return current;
    }
    if (typeof current !== "object") {
      throw new TypeError(`${label} contains a non-JSON value at ${path}.`);
    }
    if (seen.has(current)) {
      throw new TypeError(
        `${label} contains a cycle or shared reference at ${path}.`,
      );
    }
    seen.add(current);
    try {
      if (Array.isArray(current)) {
        for (const key of Reflect.ownKeys(current)) {
          if (key === "length") continue;
          if (
            typeof key === "symbol" ||
            !/^(0|[1-9]\d*)$/.test(key) ||
            Number(key) >= current.length
          ) {
            throw new TypeError(
              `${label} contains a non-JSON array property at ${path}.`,
            );
          }
          const descriptor = Object.getOwnPropertyDescriptor(current, key);
          if (!descriptor?.enumerable || descriptor.get || descriptor.set) {
            throw new TypeError(
              `${label} contains an invalid array property at ${path}[${key}].`,
            );
          }
        }
        const output: SceneJsonValue[] = [];
        for (let index = 0; index < current.length; index += 1) {
          if (!Object.hasOwn(current, index)) {
            throw new TypeError(`${label} contains a sparse array at ${path}.`);
          }
          output.push(visit(current[index], depth + 1, `${path}[${index}]`));
        }
        return output;
      }
      const prototype = Object.getPrototypeOf(current);
      if (prototype !== Object.prototype && prototype !== null) {
        throw new TypeError(`${label} contains a non-plain object at ${path}.`);
      }
      for (const key of Reflect.ownKeys(current)) {
        if (typeof key === "symbol") {
          throw new TypeError(`${label} contains a symbol key at ${path}.`);
        }
        const descriptor = Object.getOwnPropertyDescriptor(current, key);
        if (!descriptor?.enumerable) {
          throw new TypeError(
            `${label} contains a non-enumerable property at ${path}.${key}.`,
          );
        }
        if (descriptor.get || descriptor.set) {
          throw new TypeError(
            `${label} contains an accessor property at ${path}.${key}.`,
          );
        }
      }
      const output: Record<string, SceneJsonValue> = {};
      for (const key of Object.keys(current as Record<string, unknown>).sort(
        compareCodeUnits,
      )) {
        const child = (current as Record<string, unknown>)[key];
        if (child === undefined && !strictJsonProperties) continue;
        Object.defineProperty(output, key, {
          value: visit(child, depth + 1, `${path}.${key}`),
          enumerable: true,
          configurable: true,
          writable: true,
        });
      }
      return output;
    } finally {
      seen.delete(current);
    }
  };
  return visit(value, 0, "$input");
}

function assertJsonSafe(
  value: unknown,
  budgets: DisplayListCompilerBudgets,
  label: string,
): void {
  const state = {
    budgets,
    stats: {
      nodes: 0,
      operations: 0,
      maxDepth: 0,
      textCharacters: 0,
      opaqueBytes: 0,
    },
  } as CompileState;
  cloneJson(value, state, label, true);
}

function operation<const T extends Omit<DisplayOperationBase, "paintOrder">>(
  state: CompileState,
  value: T,
): T & Pick<DisplayOperationBase, "paintOrder"> {
  state.stats.operations += 1;
  if (state.stats.operations > state.budgets.maxOperations) {
    throw new RangeError(
      `Display list exceeds operation budget ${state.budgets.maxOperations}.`,
    );
  }
  return { ...value, paintOrder: state.operationPaintOrder++ };
}

function countNode(state: CompileState, box: LayoutBox, depth: number): void {
  if (box.id !== box.node.id) {
    throw new Error(
      `Layout box id ${JSON.stringify(box.id)} does not match resolved node id ${JSON.stringify(box.node.id)}.`,
    );
  }
  if (state.nodeIds.has(box.id)) {
    throw new Error(
      `Duplicate display-list node id ${JSON.stringify(box.id)}.`,
    );
  }
  state.nodeIds.add(box.id);
  state.stats.nodes += 1;
  state.stats.maxDepth = Math.max(state.stats.maxDepth, depth);
  if (state.stats.nodes > state.budgets.maxNodes) {
    throw new RangeError(
      `Display list exceeds node budget ${state.budgets.maxNodes}.`,
    );
  }
  if (depth > state.budgets.maxDepth) {
    throw new RangeError(
      `Display list exceeds depth budget ${state.budgets.maxDepth}.`,
    );
  }
  for (const [name, value] of Object.entries({
    x: box.x,
    y: box.y,
    width: box.width,
    height: box.height,
  })) {
    if (!Number.isFinite(value)) {
      throw new TypeError(
        `Layout box ${JSON.stringify(box.id)} has non-finite ${name}.`,
      );
    }
  }
}

function countText(state: CompileState, count: number, nodeId: string): void {
  state.stats.textCharacters += count;
  if (state.stats.textCharacters > state.budgets.maxTextCharacters) {
    throw new RangeError(
      `Display-list text budget ${state.budgets.maxTextCharacters} exceeded at node ${JSON.stringify(nodeId)}.`,
    );
  }
}

function countOpaqueBytes(
  state: CompileState,
  value: SceneJsonValue,
  nodeId: string,
): void {
  const bytes = new TextEncoder().encode(JSON.stringify(value)).byteLength;
  state.stats.opaqueBytes += bytes;
  if (state.stats.opaqueBytes > state.budgets.maxOpaqueBytes) {
    throw new RangeError(
      `Display-list opaque payload budget ${state.budgets.maxOpaqueBytes} bytes exceeded at node ${JSON.stringify(nodeId)}.`,
    );
  }
}

function requireCapability(
  state: CompileState,
  id: string,
  version: string,
  nodeId: string,
): void {
  validateCapability({ id, version }, nodeId);
  const key = `${id}\u0000${version}`;
  const requirement = state.requirements.get(key) ?? {
    id,
    version,
    nodeIds: new Set<string>(),
  };
  requirement.nodeIds.add(nodeId);
  state.requirements.set(key, requirement);
}

function validateCapability(
  capability: { id: string; version: string },
  nodeId: string,
): void {
  if (
    capability.id.trim() === "" ||
    capability.version.trim() === "" ||
    capability.id.length > 191 ||
    capability.version.length > 64 ||
    !/^[A-Za-z0-9][A-Za-z0-9._/-]*$/.test(capability.id)
  ) {
    throw new TypeError(
      `Invalid display capability for node ${JSON.stringify(nodeId)}.`,
    );
  }
}

function resolveCompilerBudgets(
  input: Partial<DisplayListCompilerBudgets> | undefined,
): DisplayListCompilerBudgets {
  const budgets = { ...defaultDisplayListCompilerBudgets, ...input };
  for (const [name, value] of Object.entries(budgets)) {
    if (!Number.isSafeInteger(value) || value < 1) {
      throw new RangeError(`${name} must be a positive safe integer.`);
    }
  }
  return budgets;
}

function validateLayoutHeader(layout: LayoutScene): void {
  for (const [name, value] of Object.entries({
    width: layout.width,
    height: layout.height,
    fps: layout.fps,
    duration: layout.duration,
    frame: layout.frame,
  })) {
    if (!Number.isFinite(value)) {
      throw new TypeError(`Display-list layout ${name} must be finite.`);
    }
  }
  if (layout.width <= 0 || layout.height <= 0 || layout.fps <= 0) {
    throw new RangeError("Display-list dimensions and fps must be positive.");
  }
  if (!Number.isInteger(layout.duration) || layout.duration <= 0) {
    throw new RangeError("Display-list duration must be a positive integer.");
  }
  if (layout.frame < 0) {
    throw new RangeError("Display-list frame must be non-negative.");
  }
  if (layout.frame >= layout.duration) {
    throw new RangeError("Display-list frame must be inside the composition.");
  }
}

function sortedBoxes(boxes: readonly LayoutBox[]): LayoutBox[] {
  return boxes
    .map((box, index) => ({ box, index }))
    .sort((left, right) => {
      const z =
        (left.box.node.style.zIndex ?? 0) - (right.box.node.style.zIndex ?? 0);
      return z || left.index - right.index;
    })
    .map(({ box }) => box);
}

function nodeEngineId(nodeId: string): string {
  return `mf:node:${nodeId.length}:${nodeId}`;
}

function copyRect(
  rect: Pick<LayoutRect, "x" | "y" | "width" | "height">,
): DisplayRect {
  return { x: rect.x, y: rect.y, width: rect.width, height: rect.height };
}

function compositionRect(layout: LayoutScene): DisplayRect {
  return { x: 0, y: 0, width: layout.width, height: layout.height };
}

function zeroRadii(): LayoutCornerRadii {
  return { topLeft: 0, topRight: 0, bottomRight: 0, bottomLeft: 0 };
}

function textLineStart(
  align: "left" | "center" | "right",
  box: DisplayRect,
  anchorX: number,
  width: number,
): number {
  if (align === "center") return anchorX - width / 2;
  if (align === "right") return anchorX - width;
  return box.x;
}

function readLength(
  value: string | number | undefined,
  parent: number,
  fallback: number,
): number {
  if (typeof value === "number") return value;
  if (typeof value !== "string") return fallback;
  if (value.endsWith("%")) return (Number.parseFloat(value) / 100) * parent;
  if (value.endsWith("px")) return Number.parseFloat(value);
  const parsed = Number.parseFloat(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function compareCodeUnits(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}
