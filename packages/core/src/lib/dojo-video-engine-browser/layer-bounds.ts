import type { Scene } from "@dojo-video-engine/schema";
import {
  evaluateKeyframes,
  resolveAnimationFrame,
  layoutScene,
  getLayoutContentRect,
  identityAffineMatrix,
  multiplyAffineMatrices,
  resolveStyleTransformMatrix,
  transformLayoutRect,
  type ResolvedNode,
  type LayoutBox,
  type AffineMatrix2D,
} from "@dojo-video-engine/core";

/**
 * Geometry for the canvas preview's layer selection overlay.
 *
 * Selection bounds are derived from the *rendered content*, not the raw authored
 * CSS box: a text overlay authored as a full-frame centered container would
 * otherwise select as the entire frame and be impossible to grab, move, or
 * resize. Text layers are tightened to their measured glyph box; every node is
 * resolved against its parent's containing block so nested layers land in the
 * right place. These functions are pure (text measurement is injected) so they
 * can be unit-tested without a DOM.
 */

export type DojoVideoEngineLayerBounds = {
  left: number;
  top: number;
  width: number;
  height: number;
};

/** Measures a run of text at a resolved CSS `font` string, in device pixels. */
export type MeasureText = (text: string, font: string) => number;

// Minimum on-canvas size (scene px) for a tightened text selection box, so
// there is always room to grab the interior for a move drag between the corner
// resize handles. Clamped to the container box so it never exceeds it.
const MIN_INTERACTIVE_SIZE = 44;

export type SelectableNodeBounds = {
  id: string;
  /** Absolute bounds in scene coordinates, used to draw the overlay. */
  bounds: DojoVideoEngineLayerBounds;
  /**
   * The node's containing block (its parent's absolute box). `style.left/top`
   * are relative to this, so the drag writeback converts an absolute dragged
   * box back to local coordinates by subtracting this origin.
   */
  parentBlock: DojoVideoEngineLayerBounds;
};

export const MAX_CANVAS_HIT_TARGETS = 200;
export const CANVAS_KEYBOARD_HELP =
  "Use arrow keys to move or resize by one pixel. Hold Shift for ten pixels. Release the arrow keys to save. Escape cancels.";
export type ResizeHandle = "n" | "ne" | "e" | "se" | "s" | "sw" | "w" | "nw";
export type ActiveLayerBounds = SelectableNodeBounds & { editable: boolean };
type TimedNode = {
  node: Scene["nodes"][number];
  from: number;
  end: number;
  duration: number;
  order: number;
  children: TimingTree | null;
};
type TimingTree = {
  item: TimedNode;
  maxEnd: number;
  left: TimingTree | null;
  right: TimingTree | null;
};
const geometryProperties = new Set([
  "left",
  "top",
  "right",
  "bottom",
  "inset",
  "width",
  "height",
  "minWidth",
  "maxWidth",
  "minHeight",
  "maxHeight",
]);

/** Immutable timing index: inactive clips and caption intervals never reach layout/measurement. */
export class ActiveLayerBoundsIndex {
  private readonly tree: TimingTree | null;
  readonly nodes = new Map<string, Scene["nodes"][number]>();
  constructor(private readonly scene: Scene) {
    const build = (
      nodes: Scene["nodes"],
      parentDuration: number,
    ): TimingTree | null => {
      const entries = nodes
        .map((node, order): TimedNode => {
          this.nodes.set(node.id, node);
          const from = node.from ?? 0,
            duration = node.duration ?? parentDuration;
          return {
            node,
            from,
            end: from + duration,
            duration,
            order,
            children: build(node.children ?? [], duration),
          };
        })
        .sort((a, b) => a.from - b.from || a.order - b.order);
      const branch = (start: number, end: number): TimingTree | null => {
        if (start >= end) return null;
        const at = (start + end) >>> 1,
          item = entries[at]!,
          left = branch(start, at),
          right = branch(at + 1, end);
        return {
          item,
          left,
          right,
          maxEnd: Math.max(
            item.end,
            left?.maxEnd ?? -Infinity,
            right?.maxEnd ?? -Infinity,
          ),
        };
      };
      return branch(0, entries.length);
    };
    this.tree = build(scene.nodes, scene.duration);
  }
  at(
    frame: number,
    measure: MeasureText | null = defaultMeasureText(),
  ): ActiveLayerBounds[] {
    const active = (tree: TimingTree | null, time: number): ResolvedNode[] => {
      const entries: TimedNode[] = [];
      const visit = (branch: TimingTree | null) => {
        if (!branch || branch.maxEnd <= time) return;
        visit(branch.left);
        if (branch.item.from <= time) {
          if (branch.item.end > time) entries.push(branch.item);
          visit(branch.right);
        }
      };
      visit(tree);
      return entries
        .sort((a, b) => a.order - b.order)
        .map(({ node, from, children }) => {
          const localFrame = time - from,
            style = { ...node.style };
          for (const animation of node.animations ?? []) {
            const value = evaluateKeyframes(
              animation.frames,
              resolveAnimationFrame(animation, localFrame),
            );
            if (
              value !== undefined &&
              !animation.property.startsWith("mask.") &&
              (animation.property !== "transform" || typeof value === "string")
            )
              (style as Record<string, unknown>)[animation.property] = value;
          }
          return {
            ...node,
            style,
            localFrame,
            children: active(children, localFrame),
          };
        });
    };
    const time = Math.max(0, Math.min(frame, this.scene.duration - 1));
    const layout = layoutScene(
      { ...this.scene, frame: time, nodes: active(this.tree, time) },
      measure
        ? {
            measureTextLine: (text, style, size) =>
              measure(
                text,
                `${style.fontStyle ?? "normal"} ${style.fontWeight ?? 400} ${size}px ${style.fontFamily ?? "system-ui, sans-serif"}`,
              ),
          }
        : {},
    );
    const result: ActiveLayerBounds[] = [];
    const visit = (
      box: LayoutBox,
      parent: DojoVideoEngineLayerBounds,
      matrix: AffineMatrix2D,
      opacity: number,
    ) => {
      const node = box.node;
      const world = multiplyAffineMatrices(
        matrix,
        resolveStyleTransformMatrix(node.style, box),
      );
      const alpha = opacity * (node.style.opacity ?? 1);
      // Keep authored layout and transforms separate: translating a nested layer
      // must not bake its parent's animation into the persisted left/top values.
      const raw = {
        left: box.x,
        top: box.y,
        width: box.width,
        height: box.height,
      };
      const tight =
        node.type === "text" && typeof node.text === "string"
          ? (tightenTextBounds(
              node,
              raw,
              node.style.width !== undefined,
              node.style.height !== undefined,
              measure,
            ) ?? raw)
          : raw;
      const rect = transformLayoutRect(world, {
        x: tight.left,
        y: tight.top,
        width: tight.width,
        height: tight.height,
      });
      if (
        node.type !== "audio" &&
        alpha > 0 &&
        rect.width > 0 &&
        rect.height > 0 &&
        rect.x < this.scene.width &&
        rect.y < this.scene.height &&
        rect.x + rect.width > 0 &&
        rect.y + rect.height > 0
      ) {
        const translationOnly =
          Math.abs(world.a - 1) < 1e-9 &&
          Math.abs(world.d - 1) < 1e-9 &&
          Math.abs(world.b) < 1e-9 &&
          Math.abs(world.c) < 1e-9;
        result.push({
          id: node.id,
          bounds: {
            left: rect.x,
            top: rect.y,
            width: rect.width,
            height: rect.height,
          },
          parentBlock: {
            ...parent,
            left: parent.left + world.e,
            top: parent.top + world.f,
          },
          editable:
            translationOnly &&
            !(node.animations ?? []).some((animation) =>
              geometryProperties.has(animation.property),
            ),
        });
      }
      const content = getLayoutContentRect(box);
      box.children.forEach((child) =>
        visit(
          child,
          {
            left: content.x,
            top: content.y,
            width: content.width,
            height: content.height,
          },
          world,
          alpha,
        ),
      );
    };
    layout.boxes.forEach((box) =>
      visit(
        box,
        { left: 0, top: 0, width: this.scene.width, height: this.scene.height },
        identityAffineMatrix(),
        1,
      ),
    );
    return result.sort(
      (a, b) =>
        b.bounds.width * b.bounds.height - a.bounds.width * a.bounds.height,
    );
  }
}

export function resizeLayerBounds(
  bounds: DojoVideoEngineLayerBounds,
  handle: ResizeHandle,
  deltaX: number,
  deltaY: number,
): DojoVideoEngineLayerBounds {
  let { left, top } = bounds,
    right = left + bounds.width,
    bottom = top + bounds.height;
  if (handle.includes("w")) left = Math.min(left + deltaX, right - 24);
  if (handle.includes("e")) right = Math.max(right + deltaX, left + 24);
  if (handle.includes("n")) top = Math.min(top + deltaY, bottom - 24);
  if (handle.includes("s")) bottom = Math.max(bottom + deltaY, top + 24);
  return {
    left: Math.round(left),
    top: Math.round(top),
    width: Math.round(right - left),
    height: Math.round(bottom - top),
  };
}

export function keyboardLayerBounds(
  event: {
    key: string;
    defaultPrevented?: boolean;
    isComposing?: boolean;
    keyCode?: number;
    ctrlKey?: boolean;
    metaKey?: boolean;
    altKey?: boolean;
    shiftKey?: boolean;
  },
  bounds: DojoVideoEngineLayerBounds,
  handle?: ResizeHandle,
): DojoVideoEngineLayerBounds | null {
  if (
    event.defaultPrevented ||
    event.isComposing ||
    event.keyCode === 229 ||
    event.ctrlKey ||
    event.metaKey ||
    event.altKey
  )
    return null;
  const step = event.shiftKey ? 10 : 1;
  const x =
    event.key === "ArrowLeft" ? -step : event.key === "ArrowRight" ? step : 0;
  const y =
    event.key === "ArrowUp" ? -step : event.key === "ArrowDown" ? step : 0;
  if (!x && !y) return null;
  return handle
    ? resizeLayerBounds(bounds, handle, x, y)
    : { ...bounds, left: bounds.left + x, top: bounds.top + y };
}

export function getSelectableNodeBounds(
  nodes: Scene["nodes"],
  block: DojoVideoEngineLayerBounds,
  measure: MeasureText | null = defaultMeasureText(),
): SelectableNodeBounds[] {
  return nodes.flatMap((node) => {
    const bounds = getNodePreviewBounds(node, block, measure);
    // Children position against their parent's box (its containing block), not
    // the scene, so a text node with inset:0 inside an offset group resolves to
    // the group's location instead of the top-left of the frame.
    const childBlock = bounds ?? block;
    return [
      ...(bounds ? [{ id: node.id, bounds, parentBlock: block }] : []),
      ...getSelectableNodeBounds(node.children ?? [], childBlock, measure),
    ];
  });
}

export function getNodePreviewBounds(
  node: Scene["nodes"][number],
  block: DojoVideoEngineLayerBounds,
  measure: MeasureText | null = defaultMeasureText(),
): DojoVideoEngineLayerBounds | null {
  if (node.type === "audio") {
    return null;
  }

  const style = node.style ?? {};
  const inset = readLengthValue(style.inset, block.width) ?? 0;
  const left = block.left + (readLengthValue(style.left, block.width) ?? inset);
  const top = block.top + (readLengthValue(style.top, block.height) ?? inset);
  const explicitWidth = readLengthValue(style.width, block.width);
  const explicitHeight = readLengthValue(style.height, block.height);
  const containerBox: DojoVideoEngineLayerBounds = {
    left,
    top,
    width:
      explicitWidth ?? Math.max(8, block.left + block.width - left - inset),
    height:
      explicitHeight ?? Math.max(8, block.top + block.height - top - inset),
  };

  // A text layer authored as a full-frame (or otherwise unsized) centered
  // container selects as the whole frame, which is impossible to grab or move.
  // Hug the rendered glyphs so the selection box is tight and manipulable; the
  // bounds writeback bakes the tight box in on first drag.
  if (
    node.type === "text" &&
    typeof node.text === "string" &&
    node.text.trim() !== "" &&
    (explicitWidth == null || explicitHeight == null)
  ) {
    const tightened = tightenTextBounds(
      node,
      containerBox,
      explicitWidth != null,
      explicitHeight != null,
      measure,
    );
    if (tightened) {
      return tightened;
    }
  }

  return {
    left: containerBox.left,
    top: containerBox.top,
    width: Math.max(8, containerBox.width),
    height: Math.max(8, containerBox.height),
  };
}

// Shared offscreen 2D context for measuring rendered text extents. Reused across
// calls and guarded for SSR (returns null when there is no document, so bounds
// fall back to the authored container box).
let sharedMeasureContext: CanvasRenderingContext2D | null | undefined;

export function defaultMeasureText(): MeasureText | null {
  if (sharedMeasureContext === undefined) {
    sharedMeasureContext =
      typeof document === "undefined"
        ? null
        : document.createElement("canvas").getContext("2d");
  }

  const context = sharedMeasureContext;
  if (!context) {
    return null;
  }

  return (text, font) => {
    context.font = font;
    return context.measureText(text).width;
  };
}

function resolveLineHeightPx(value: unknown, fontSize: number): number {
  // CSS: a unitless number (or numeric string) is a multiplier of the font size.
  if (typeof value === "number") {
    return fontSize * value;
  }

  if (typeof value === "string" && /^-?\d+(?:\.\d+)?$/.test(value.trim())) {
    return fontSize * Number(value.trim());
  }

  return readLengthValue(value, fontSize) ?? fontSize * 1.25;
}

/**
 * Returns a selection box hugging a text node's rendered glyphs, positioned
 * within its container per text-align / flex alignment. Only the unsized axes
 * are tightened; an axis the author sized explicitly keeps the container box.
 * Mirrors the renderer's shrink-to-fit so hero text that scales down still gets
 * a tight box. Returns null when measurement is unavailable.
 */
export function tightenTextBounds(
  node: Scene["nodes"][number],
  box: DojoVideoEngineLayerBounds,
  lockWidth: boolean,
  lockHeight: boolean,
  measure: MeasureText | null,
): DojoVideoEngineLayerBounds | null {
  if (!measure) {
    return null;
  }

  const style = node.style ?? {};
  const lines = (node.text ?? "").split("\n");
  const fontFamily =
    (typeof style.fontFamily === "string" && style.fontFamily) ||
    "system-ui, sans-serif";
  const fontStyle = style.fontStyle === "italic" ? "italic" : "normal";
  const fontWeight = style.fontWeight ?? 400;
  const baseFontSize = readLengthValue(style.fontSize, box.width) ?? 24;
  const minFontSize = Math.max(
    1,
    Math.min(baseFontSize, readLengthValue(style.minFontSize, box.width) ?? 12),
  );

  const maxLineWidth = (size: number) => {
    const font = `${fontStyle} ${fontWeight} ${size}px ${fontFamily}`;
    return lines.reduce(
      (widest, line) => Math.max(widest, measure(line, font)),
      0,
    );
  };

  let fontSize = baseFontSize;
  if (style.textFit === "shrink") {
    const width = maxLineWidth(fontSize) || 1;
    const height =
      lines.length * resolveLineHeightPx(style.lineHeight, fontSize);
    const scale = Math.min(1, box.width / width, box.height / (height || 1));
    fontSize = Math.max(minFontSize, Math.floor(fontSize * scale));
  }

  const glyphWidth = maxLineWidth(fontSize);
  const glyphHeight =
    lines.length * resolveLineHeightPx(style.lineHeight, fontSize);
  if (glyphWidth <= 0 || glyphHeight <= 0) {
    return null;
  }

  // Keep the box at least a comfortable grab target: a razor-tight box around
  // small text leaves no interior between the resize handles to start a move
  // drag, forcing the user to resize before they can reposition.
  const pad = Math.max(6, Math.round(fontSize * 0.18));
  const contentWidth = Math.min(
    box.width,
    Math.max(MIN_INTERACTIVE_SIZE, glyphWidth + pad * 2),
  );
  const contentHeight = Math.min(
    box.height,
    Math.max(MIN_INTERACTIVE_SIZE, glyphHeight + pad * 2),
  );

  const width = lockWidth ? box.width : contentWidth;
  const height = lockHeight ? box.height : contentHeight;
  const aligned = alignWithinBox(box, width, height, style);
  const left = lockWidth ? box.left : aligned.left;
  const top = lockHeight ? box.top : aligned.top;

  return {
    left: Math.round(left),
    top: Math.round(top),
    width: Math.max(8, Math.round(width)),
    height: Math.max(8, Math.round(height)),
  };
}

// Positions a content box of (width × height) inside `box` using the node's
// flex alignment and text-align, matching how the renderer centers overlay text.
function alignWithinBox(
  box: DojoVideoEngineLayerBounds,
  width: number,
  height: number,
  style: NonNullable<Scene["nodes"][number]["style"]>,
): { left: number; top: number } {
  const isFlex = style.display === "flex";
  const column = style.flexDirection === "column";
  const mainAxis = style.justifyContent;
  const crossAxis = style.alignItems;
  const horizontalFlex = column ? crossAxis : mainAxis;
  const verticalFlex = column ? mainAxis : crossAxis;

  const isEnd = (value: unknown) => value === "flex-end" || value === "end";

  let hAlign: "start" | "center" | "end" = "start";
  if (isFlex && horizontalFlex === "center") hAlign = "center";
  else if (isFlex && isEnd(horizontalFlex)) hAlign = "end";
  else if (style.textAlign === "center") hAlign = "center";
  else if (style.textAlign === "right") hAlign = "end";

  let vAlign: "start" | "center" | "end" = "start";
  if (isFlex && verticalFlex === "center") vAlign = "center";
  else if (isFlex && isEnd(verticalFlex)) vAlign = "end";

  const left =
    hAlign === "center"
      ? box.left + (box.width - width) / 2
      : hAlign === "end"
        ? box.left + box.width - width
        : box.left;
  const top =
    vAlign === "center"
      ? box.top + (box.height - height) / 2
      : vAlign === "end"
        ? box.top + box.height - height
        : box.top;

  return { left, top };
}

export function readLengthValue(value: unknown, total: number): number | null {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }

  if (typeof value !== "string") {
    return null;
  }

  const trimmed = value.trim();
  const percentage = trimmed.match(/^(-?\d+(?:\.\d+)?)%$/);
  if (percentage) {
    return Math.round((Number(percentage[1]) / 100) * total);
  }

  const pixels = trimmed.match(/^(-?\d+(?:\.\d+)?)px$/);
  if (pixels) {
    return Math.round(Number(pixels[1]));
  }

  if (/^-?\d+(?:\.\d+)?$/.test(trimmed)) {
    return Math.round(Number(trimmed));
  }

  return null;
}
