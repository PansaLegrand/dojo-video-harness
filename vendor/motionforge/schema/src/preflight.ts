import { validateScene, type Scene } from "./index";
import { sceneIngestionHardLimits } from "./ingestion";

export { sceneIngestionHardLimits } from "./ingestion";

/** Host execution policy. These limits never change canonical Scene validity. */
export type SceneComplexityLimits = {
  /** Total JSON values (root, object properties, and array entries). */
  maxDocumentValues: number;
  /** Maximum nesting across the complete document, including extension params. */
  maxDocumentDepth: number;
  maxCanvasPixels: number;
  maxDimension: number;
  maxFrames: number;
  maxNodes: number;
  maxDepth: number;
  maxAssets: number;
  maxPathDataCharacters: number;
  maxShapePoints: number;
  maxAnimations: number;
  /** Animation frames plus audio/video volume-envelope points. */
  maxKeyframes: number;
};

export const defaultSceneComplexityLimits: Readonly<SceneComplexityLimits> =
  Object.freeze({
    maxDocumentValues: 250_000,
    maxDocumentDepth: 256,
    maxCanvasPixels: 7680 * 4320,
    maxDimension: 16_384,
    maxFrames: 60 * 60 * 60,
    maxNodes: 10_000,
    maxDepth: 64,
    maxAssets: 1_000,
    maxPathDataCharacters: 2_000_000,
    maxShapePoints: 100_000,
    maxAnimations: 25_000,
    maxKeyframes: 250_000,
  });

export type SceneComplexityUsage = {
  documentValues: number;
  maxDocumentDepth: number;
  width: number;
  height: number;
  canvasPixels: number;
  frames: number;
  nodes: number;
  maxDepth: number;
  assets: number;
  pathDataCharacters: number;
  shapePoints: number;
  animations: number;
  keyframes: number;
};

export type SceneComplexityIssueCode =
  | "asset_count_exceeded"
  | "canvas_dimension_exceeded"
  | "canvas_pixels_exceeded"
  | "frame_count_exceeded"
  | "document_depth_exceeded"
  | "document_value_count_exceeded"
  | "keyframe_count_exceeded"
  | "node_count_exceeded"
  | "node_depth_exceeded"
  | "non_tree_document_reference"
  | "non_tree_node_reference"
  | "path_data_exceeded"
  | "scene_invalid"
  | "scene_shape_points_exceeded"
  | "animation_count_exceeded";

export type SceneComplexityIssue = {
  severity: "error";
  code: SceneComplexityIssueCode;
  path: Array<string | number>;
  message: string;
  actual?: number;
  limit?: number;
};

export type SceneComplexityPreflightResult =
  | {
      ok: true;
      scene: Scene;
      limits: SceneComplexityLimits;
      usage: SceneComplexityUsage;
      issues: [];
    }
  | {
      ok: false;
      limits: SceneComplexityLimits;
      usage: SceneComplexityUsage;
      issues: SceneComplexityIssue[];
    };

/**
 * Applies host resource policy before evaluation/render/export. Raw scene-like
 * input is scanned iteratively and with bounded traversal before canonical
 * validation, so excessive depth/counts fail without recursing through them.
 */
export function preflightScene(
  input: unknown,
  overrides: Partial<SceneComplexityLimits> = {},
): SceneComplexityPreflightResult {
  const limits = resolveComplexityLimits(overrides);
  const { usage, referenceIssues } = scanSceneComplexity(input, limits);
  const referenceCodes = new Set(referenceIssues.map((issue) => issue.code));
  const issues = [
    ...referenceIssues,
    ...complexityIssues(usage, limits).filter(
      (issue) => !referenceCodes.has(issue.code),
    ),
  ];

  if (issues.length > 0) {
    return { ok: false, limits, usage, issues };
  }

  const validated = validateScene(input);
  if (!validated.ok) {
    return {
      ok: false,
      limits,
      usage,
      issues: [
        {
          severity: "error",
          code: "scene_invalid",
          path: [],
          message: `Scene must be canonically valid before execution:\n${validated.errors.join("\n")}`,
        },
      ],
    };
  }

  return { ok: true, scene: validated.scene, limits, usage, issues: [] };
}

function resolveComplexityLimits(
  overrides: Partial<SceneComplexityLimits>,
): SceneComplexityLimits {
  const limits = { ...defaultSceneComplexityLimits, ...overrides };
  for (const [name, value] of Object.entries(limits)) {
    if (!Number.isSafeInteger(value) || value <= 0) {
      throw new Error(
        `Scene complexity limit ${name} must be a positive safe integer, received ${String(value)}.`,
      );
    }
  }
  if (limits.maxDocumentValues > sceneIngestionHardLimits.maxDocumentValues) {
    throw new Error(
      `Scene complexity limit maxDocumentValues cannot exceed the hard ingestion ceiling ${sceneIngestionHardLimits.maxDocumentValues}, received ${limits.maxDocumentValues}.`,
    );
  }
  if (limits.maxDocumentDepth > sceneIngestionHardLimits.maxDocumentDepth) {
    throw new Error(
      `Scene complexity limit maxDocumentDepth cannot exceed the hard ingestion ceiling ${sceneIngestionHardLimits.maxDocumentDepth}, received ${limits.maxDocumentDepth}.`,
    );
  }
  return limits;
}

function scanSceneComplexity(
  input: unknown,
  limits: SceneComplexityLimits,
): {
  usage: SceneComplexityUsage;
  referenceIssues: SceneComplexityIssue[];
} {
  const root = isRecord(input) ? input : {};
  const document = scanDocumentStructure(input, limits);
  const width = finiteNonnegativeNumber(root.width);
  const height = finiteNonnegativeNumber(root.height);
  const canvasPixels = safeProduct(width, height);
  const usage: SceneComplexityUsage = {
    documentValues: document.values,
    maxDocumentDepth: document.maxDepth,
    width,
    height,
    canvasPixels,
    frames: finiteNonnegativeNumber(root.duration),
    nodes: 0,
    maxDepth: 0,
    assets: countRecordEntries(root.assets, limits.maxAssets + 1),
    pathDataCharacters: 0,
    shapePoints: 0,
    animations: 0,
    keyframes: 0,
  };
  const referenceIssues: SceneComplexityIssue[] = [...document.issues];
  if (document.issues.length > 0) {
    return { usage, referenceIssues };
  }
  const roots = Array.isArray(root.nodes) ? root.nodes : [];
  const traversalNodeCap =
    Math.max(limits.maxNodes, defaultSceneComplexityLimits.maxNodes) + 1;
  const stack: Array<{
    value: unknown;
    depth: number;
    path: Array<string | number>;
  }> = [];
  const seenNodes = new WeakSet<object>();
  const animationInspectionCap = limits.maxAnimations + 1;
  let inspectedAnimations = 0;

  pushChildrenBounded(stack, roots, 1, ["nodes"], traversalNodeCap);

  while (stack.length > 0 && usage.nodes < traversalNodeCap) {
    const entry = stack.pop();
    if (!entry) break;
    usage.nodes += 1;
    usage.maxDepth = Math.max(usage.maxDepth, entry.depth);

    if (!isRecord(entry.value)) continue;
    if (seenNodes.has(entry.value)) {
      referenceIssues.push({
        severity: "error",
        code: "non_tree_node_reference",
        path: entry.path,
        message: `${entry.path.join(".")}: node objects must form a JSON tree without cycles or shared object references.`,
      });
      continue;
    }
    seenNodes.add(entry.value);

    const animations = Array.isArray(entry.value.animations)
      ? entry.value.animations
      : [];
    usage.animations = boundedAdd(
      usage.animations,
      animations.length,
      limits.maxAnimations + 1,
    );
    const inspectCount = Math.min(
      animations.length,
      Math.max(0, animationInspectionCap - inspectedAnimations),
    );
    for (
      let animationIndex = 0;
      animationIndex < inspectCount;
      animationIndex += 1
    ) {
      const animation = animations[animationIndex];
      if (!isRecord(animation) || !Array.isArray(animation.frames)) continue;
      usage.keyframes = boundedAdd(
        usage.keyframes,
        animation.frames.length,
        limits.maxKeyframes + 1,
      );
    }
    inspectedAnimations += inspectCount;
    if (Array.isArray(entry.value.volumeEnvelope)) {
      usage.keyframes = boundedAdd(
        usage.keyframes,
        entry.value.volumeEnvelope.length,
        limits.maxKeyframes + 1,
      );
    }

    for (const geometry of nodeGeometries(entry.value)) {
      if (!isRecord(geometry)) continue;
      if (geometry.kind === "path" && typeof geometry.d === "string") {
        usage.pathDataCharacters = boundedAdd(
          usage.pathDataCharacters,
          geometry.d.length,
          limits.maxPathDataCharacters + 1,
        );
      }
      if (Array.isArray(geometry.points)) {
        usage.shapePoints = boundedAdd(
          usage.shapePoints,
          geometry.points.length,
          limits.maxShapePoints + 1,
        );
      }
    }

    if (entry.depth <= limits.maxDepth && Array.isArray(entry.value.children)) {
      pushChildrenBounded(
        stack,
        entry.value.children,
        entry.depth + 1,
        [...entry.path, "children"],
        Math.max(0, traversalNodeCap - usage.nodes - stack.length),
      );
    }
  }

  return { usage, referenceIssues };
}

function scanDocumentStructure(
  input: unknown,
  limits: SceneComplexityLimits,
): {
  values: number;
  maxDepth: number;
  issues: SceneComplexityIssue[];
} {
  const stack: Array<{
    value: unknown;
    depth: number;
    path: Array<string | number>;
  }> = [{ value: input, depth: 0, path: [] }];
  const seen = new WeakSet<object>();
  let values = 0;
  let maxDepth = 0;

  while (stack.length > 0) {
    const entry = stack.pop();
    if (!entry) break;
    values += 1;
    maxDepth = Math.max(maxDepth, entry.depth);

    if (values > limits.maxDocumentValues) {
      return {
        values: limits.maxDocumentValues + 1,
        maxDepth,
        issues: [
          documentLimitIssue(
            "document_value_count_exceeded",
            entry.path,
            limits.maxDocumentValues + 1,
            limits.maxDocumentValues,
            "Document value count",
          ),
        ],
      };
    }
    if (entry.depth > limits.maxDocumentDepth) {
      return {
        values,
        maxDepth: limits.maxDocumentDepth + 1,
        issues: [
          documentLimitIssue(
            "document_depth_exceeded",
            entry.path,
            limits.maxDocumentDepth + 1,
            limits.maxDocumentDepth,
            "Document depth",
          ),
        ],
      };
    }
    if (typeof entry.value !== "object" || entry.value === null) continue;
    if (seen.has(entry.value)) {
      return {
        values,
        maxDepth,
        issues: [
          {
            severity: "error",
            code: "non_tree_document_reference",
            path: entry.path,
            message: `${formatPath(entry.path)}: Scene input must form a JSON tree without cycles or shared object references.`,
          },
        ],
      };
    }
    seen.add(entry.value);

    const remaining = limits.maxDocumentValues + 1 - values - stack.length;
    if (remaining <= 0) {
      return {
        values: limits.maxDocumentValues + 1,
        maxDepth,
        issues: [
          documentLimitIssue(
            "document_value_count_exceeded",
            entry.path,
            limits.maxDocumentValues + 1,
            limits.maxDocumentValues,
            "Document value count",
          ),
        ],
      };
    }

    if (Array.isArray(entry.value)) {
      if (entry.value.length > remaining) {
        return {
          values: limits.maxDocumentValues + 1,
          maxDepth,
          issues: [
            documentLimitIssue(
              "document_value_count_exceeded",
              entry.path,
              limits.maxDocumentValues + 1,
              limits.maxDocumentValues,
              "Document value count",
            ),
          ],
        };
      }
      for (let index = entry.value.length - 1; index >= 0; index -= 1) {
        stack.push({
          value: entry.value[index],
          depth: entry.depth + 1,
          path: [...entry.path, index],
        });
      }
      continue;
    }

    const record = entry.value as Record<string, unknown>;
    let pushed = 0;
    for (const key in record) {
      if (!Object.hasOwn(record, key)) continue;
      pushed += 1;
      if (pushed > remaining) {
        return {
          values: limits.maxDocumentValues + 1,
          maxDepth,
          issues: [
            documentLimitIssue(
              "document_value_count_exceeded",
              [...entry.path, key],
              limits.maxDocumentValues + 1,
              limits.maxDocumentValues,
              "Document value count",
            ),
          ],
        };
      }
      stack.push({
        value: record[key],
        depth: entry.depth + 1,
        path: [...entry.path, key],
      });
    }
  }

  return { values, maxDepth, issues: [] };
}

function documentLimitIssue(
  code: "document_depth_exceeded" | "document_value_count_exceeded",
  path: Array<string | number>,
  actual: number,
  limit: number,
  label: string,
): SceneComplexityIssue {
  return {
    severity: "error",
    code,
    path,
    actual,
    limit,
    message: `${label} ${actual} exceeds the host execution limit ${limit}. Raise the explicit preflight limit or reduce the Scene before validation.`,
  };
}

function formatPath(path: ReadonlyArray<string | number>): string {
  return path.length > 0 ? path.join(".") : "scene";
}

function pushChildrenBounded(
  stack: Array<{
    value: unknown;
    depth: number;
    path: Array<string | number>;
  }>,
  children: unknown[],
  depth: number,
  path: Array<string | number>,
  capacity: number,
): void {
  const count = Math.min(children.length, Math.max(0, capacity));
  for (let index = count - 1; index >= 0; index -= 1) {
    stack.push({
      value: children[index],
      depth,
      path: [...path, index],
    });
  }
}

function nodeGeometries(node: Record<string, unknown>): unknown[] {
  const mask = isRecord(node.mask) ? node.mask.shape : undefined;
  return [node.shape, node.clip, mask];
}

function complexityIssues(
  usage: SceneComplexityUsage,
  limits: SceneComplexityLimits,
): SceneComplexityIssue[] {
  const issues: SceneComplexityIssue[] = [];
  addLimitIssue(
    issues,
    "document_value_count_exceeded",
    [],
    usage.documentValues,
    limits.maxDocumentValues,
    "Document value count",
  );
  addLimitIssue(
    issues,
    "document_depth_exceeded",
    [],
    usage.maxDocumentDepth,
    limits.maxDocumentDepth,
    "Document depth",
  );
  addLimitIssue(
    issues,
    "canvas_pixels_exceeded",
    ["width", "height"],
    usage.canvasPixels,
    limits.maxCanvasPixels,
    "Canvas pixel count",
  );
  addLimitIssue(
    issues,
    "canvas_dimension_exceeded",
    usage.width >= usage.height ? ["width"] : ["height"],
    Math.max(usage.width, usage.height),
    limits.maxDimension,
    "Canvas dimension",
  );
  addLimitIssue(
    issues,
    "frame_count_exceeded",
    ["duration"],
    usage.frames,
    limits.maxFrames,
    "Scene frame count",
  );
  addLimitIssue(
    issues,
    "node_count_exceeded",
    ["nodes"],
    usage.nodes,
    limits.maxNodes,
    "Node count",
  );
  addLimitIssue(
    issues,
    "node_depth_exceeded",
    ["nodes"],
    usage.maxDepth,
    limits.maxDepth,
    "Node depth",
  );
  addLimitIssue(
    issues,
    "asset_count_exceeded",
    ["assets"],
    usage.assets,
    limits.maxAssets,
    "Asset count",
  );
  addLimitIssue(
    issues,
    "path_data_exceeded",
    ["nodes"],
    usage.pathDataCharacters,
    limits.maxPathDataCharacters,
    "SVG path-data characters",
  );
  addLimitIssue(
    issues,
    "scene_shape_points_exceeded",
    ["nodes"],
    usage.shapePoints,
    limits.maxShapePoints,
    "Shape point count",
  );
  addLimitIssue(
    issues,
    "animation_count_exceeded",
    ["nodes"],
    usage.animations,
    limits.maxAnimations,
    "Animation count",
  );
  addLimitIssue(
    issues,
    "keyframe_count_exceeded",
    ["nodes"],
    usage.keyframes,
    limits.maxKeyframes,
    "Keyframe/envelope-point count",
  );
  return issues;
}

function addLimitIssue(
  issues: SceneComplexityIssue[],
  code: SceneComplexityIssueCode,
  path: Array<string | number>,
  actual: number,
  limit: number,
  label: string,
): void {
  if (actual <= limit) return;
  issues.push({
    severity: "error",
    code,
    path,
    actual,
    limit,
    message: `${label} ${actual} exceeds the host execution limit ${limit}. Raise the explicit preflight limit or reduce the Scene before rendering/export.`,
  });
}

function countRecordEntries(value: unknown, cap: number): number {
  if (!isRecord(value)) return 0;
  let count = 0;
  for (const _key in value) {
    if (!Object.hasOwn(value, _key)) continue;
    count += 1;
    if (count >= cap) return cap;
  }
  return count;
}

function boundedAdd(current: number, amount: number, cap: number): number {
  return Math.min(cap, current + Math.max(0, amount));
}

function finiteNonnegativeNumber(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0
    ? value
    : 0;
}

function safeProduct(left: number, right: number): number {
  const product = left * right;
  return Number.isSafeInteger(product) ? product : Number.MAX_SAFE_INTEGER;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
