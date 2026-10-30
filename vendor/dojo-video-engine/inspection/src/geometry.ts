import {
  normalizeLayoutCornerRadii,
  pointInRoundedLayoutRect,
} from "@dojo-video-engine/core";
import type { SceneShapeGeometry } from "@dojo-video-engine/schema";
import type { Point, Rect } from "./types";

export function intersectRect(left: Rect, right: Rect): Rect {
  const x = Math.max(left.x, right.x);
  const y = Math.max(left.y, right.y);
  const rightEdge = Math.min(left.x + left.width, right.x + right.width);
  const bottom = Math.min(left.y + left.height, right.y + right.height);
  return {
    x,
    y,
    width: Math.max(0, rightEdge - x),
    height: Math.max(0, bottom - y),
  };
}

export function rectIntersectionArea(left: Rect, right: Rect): number {
  const intersection = intersectRect(left, right);
  return intersection.width * intersection.height;
}

export const pointInRect = (point: Point, rect: Rect): boolean =>
  point.x >= rect.x &&
  point.y >= rect.y &&
  point.x <= rect.x + rect.width &&
  point.y <= rect.y + rect.height;

export function shapeBounds(
  shape: SceneShapeGeometry,
  box: Rect,
): { bounds: Rect; estimated: boolean } {
  if (
    shape.kind === "rect" ||
    shape.kind === "ellipse" ||
    shape.kind === "path"
  ) {
    return {
      bounds: box,
      estimated:
        shape.kind !== "rect" ||
        (shape.radius !== undefined &&
          readLength(shape.radius, Math.min(box.width, box.height), 0) > 0),
    };
  }
  const points = shape.points.map((point) => ({
    x: box.x + point.x * box.width,
    y: box.y + point.y * box.height,
  }));
  if (points.length === 0) return { bounds: box, estimated: true };
  const xs = points.map((point) => point.x);
  const ys = points.map((point) => point.y);
  return {
    bounds: {
      x: Math.min(...xs),
      y: Math.min(...ys),
      width: Math.max(...xs) - Math.min(...xs),
      height: Math.max(...ys) - Math.min(...ys),
    },
    estimated: shape.kind === "line" || shape.kind === "polyline",
  };
}

export function pointInShape(
  point: Point,
  shape: SceneShapeGeometry,
  box: Rect,
  options: { strokeWidth?: number } = {},
): { hit: boolean; estimated: boolean } {
  if (shape.kind === "rect") {
    const radius = readLength(shape.radius, Math.min(box.width, box.height), 0);
    if (radius <= 0) return { hit: pointInRect(point, box), estimated: false };
    return {
      hit: pointInRoundedLayoutRect(
        point,
        box,
        normalizeLayoutCornerRadii(radius, box.width, box.height),
      ),
      // Canvas uses a quadratic rounded path; the circular test is a safe,
      // close geometry approximation rather than a pixel-exact claim.
      estimated: true,
    };
  }
  if (shape.kind === "path") {
    return { hit: pointInRect(point, box), estimated: true };
  }
  if (shape.kind === "ellipse") {
    const rx = box.width / 2;
    const ry = box.height / 2;
    if (rx <= 0 || ry <= 0) return { hit: false, estimated: false };
    const dx = (point.x - (box.x + rx)) / rx;
    const dy = (point.y - (box.y + ry)) / ry;
    return { hit: dx * dx + dy * dy <= 1, estimated: false };
  }
  if (shape.kind === "line" || shape.kind === "polyline") {
    const vertices = shape.points.map((entry) => ({
      x: box.x + entry.x * box.width,
      y: box.y + entry.y * box.height,
    }));
    const threshold = Math.max(0.5, (options.strokeWidth ?? 1) / 2);
    let distance = Number.POSITIVE_INFINITY;
    for (let index = 1; index < vertices.length; index += 1) {
      const start = vertices[index - 1];
      const end = vertices[index];
      if (start && end) {
        distance = Math.min(distance, distanceToSegment(point, start, end));
      }
    }
    return {
      hit: distance <= threshold,
      // End caps, joins, and miter limits affect the final Canvas stroke, so
      // segment-distance geometry is explicitly estimated.
      estimated: true,
    };
  }
  const vertices = shape.points.map((entry) => ({
    x: box.x + entry.x * box.width,
    y: box.y + entry.y * box.height,
  }));
  let inside = false;
  for (
    let index = 0, previous = vertices.length - 1;
    index < vertices.length;
    previous = index++
  ) {
    const a = vertices[index];
    const b = vertices[previous];
    if (!a || !b) continue;
    if (
      a.y > point.y !== b.y > point.y &&
      point.x < ((b.x - a.x) * (point.y - a.y)) / (b.y - a.y) + a.x
    ) {
      inside = !inside;
    }
  }
  return { hit: inside, estimated: false };
}

function distanceToSegment(point: Point, start: Point, end: Point): number {
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const lengthSquared = dx * dx + dy * dy;
  if (lengthSquared === 0) {
    return Math.hypot(point.x - start.x, point.y - start.y);
  }
  const t = Math.max(
    0,
    Math.min(
      1,
      ((point.x - start.x) * dx + (point.y - start.y) * dy) / lengthSquared,
    ),
  );
  return Math.hypot(point.x - (start.x + t * dx), point.y - (start.y + t * dy));
}

export function plainRectCoversBox(
  shape: SceneShapeGeometry,
  box: Rect,
): boolean {
  return (
    shape.kind === "rect" &&
    readLength(shape.radius, Math.min(box.width, box.height), 0) <= 0 &&
    box.width > 0 &&
    box.height > 0
  );
}

export function readLength(
  value: number | string | undefined,
  reference: number,
  fallback: number,
): number {
  if (typeof value === "number") return value;
  if (typeof value !== "string") return fallback;
  const parsed = Number.parseFloat(value);
  if (!Number.isFinite(parsed)) return fallback;
  return value.trim().endsWith("%") ? (parsed / 100) * reference : parsed;
}
