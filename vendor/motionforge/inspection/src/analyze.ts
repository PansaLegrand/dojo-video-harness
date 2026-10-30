import {
  inspectScene,
  lintScene,
  parseScene,
  validateScene,
} from "@motionforge/schema";
import { inspectLayout } from "./layout";
import { inspectTimeline, inspectTree } from "./tree";
import type {
  AnalyzeCompositionOptions,
  CheckSceneOptions,
  CompositionInspection,
  DiagnosticCode,
  LayoutInspectionOptions,
  SceneCheckEnvelope,
} from "./types";

export function analyzeComposition(
  sceneInput: unknown,
  frames: readonly number[],
  options?: LayoutInspectionOptions,
): CompositionInspection;
export function analyzeComposition(
  sceneInput: unknown,
  options?: AnalyzeCompositionOptions,
): CompositionInspection;
export function analyzeComposition(
  sceneInput: unknown,
  framesOrOptions: readonly number[] | AnalyzeCompositionOptions = {},
  explicitOptions: LayoutInspectionOptions = {},
): CompositionInspection {
  const scene = parseScene(sceneInput);
  const frameArray = Array.isArray(framesOrOptions);
  const optionObject = frameArray
    ? undefined
    : (framesOrOptions as AnalyzeCompositionOptions);
  const options = frameArray ? explicitOptions : (optionObject ?? {});
  const requested = frameArray
    ? (framesOrOptions as readonly number[])
    : optionObject?.frames;
  if (
    !frameArray &&
    optionObject?.frames !== undefined &&
    optionObject.sampleCount !== undefined
  ) {
    throw new RangeError("Use either frames or sampleCount, not both.");
  }
  const frames = normalizeFrames(
    scene.duration,
    requested,
    frameArray ? undefined : optionObject?.sampleCount,
  );
  const snapshots = frames.map((frame) => inspectLayout(scene, frame, options));
  const diagnostics = snapshots.flatMap((snapshot) => snapshot.diagnostics);
  const byCode: Partial<Record<DiagnosticCode, number>> = {};
  diagnostics.forEach((diagnostic) => {
    byCode[diagnostic.code] = (byCode[diagnostic.code] ?? 0) + 1;
  });
  return {
    kind: "motionforge.composition",
    version: 1,
    sampledFrames: frames,
    frames: snapshots,
    diagnostics,
    summary: {
      frames: frames.length,
      nodes: Math.max(0, ...snapshots.map((snapshot) => snapshot.nodes.length)),
      diagnostics: diagnostics.length,
      byCode,
    },
  };
}

function normalizeFrames(
  duration: number,
  requested?: readonly number[],
  sampleCount = 3,
): number[] {
  if (!Number.isInteger(sampleCount) || sampleCount < 1 || sampleCount > 100) {
    throw new RangeError("sampleCount must be an integer from 1 through 100.");
  }
  const boundedCount = sampleCount;
  if (requested && requested.length > 0) {
    if (requested.length > 100) {
      throw new RangeError("At most 100 explicit sample frames are allowed.");
    }
    const explicit = requested;
    for (const frame of explicit) {
      if (!Number.isInteger(frame) || frame < 0 || frame >= duration) {
        throw new RangeError(
          `Sample frame ${String(frame)} is outside [0, ${duration - 1}].`,
        );
      }
    }
    return Array.from(new Set(explicit)).sort((left, right) => left - right);
  }
  const source = Array.from({ length: boundedCount }, (_, index) =>
    boundedCount === 1
      ? 0
      : Math.round((index / (boundedCount - 1)) * (duration - 1)),
  );
  return Array.from(
    new Set(
      source.map((frame) =>
        Math.max(0, Math.min(duration - 1, Math.round(frame))),
      ),
    ),
  ).sort((left, right) => left - right);
}

export function checkScene(
  sceneInput: unknown,
  options: CheckSceneOptions = {},
): SceneCheckEnvelope {
  const validation = validateScene(sceneInput);
  if (!validation.ok) {
    return {
      kind: "motionforge.check",
      version: 1,
      ok: false,
      validation: { ok: false, errors: validation.errors },
      structural: null,
      lint: { issues: [] },
      tree: null,
      timeline: null,
      composition: null,
      summary: {
        nodes: 0,
        activeWindows: 0,
        diagnostics: 0,
        warnings: 0,
        errors: validation.errors.length,
      },
    };
  }
  const scene = validation.scene;
  const tree = inspectTree(scene, options);
  const timeline = inspectTimeline(scene, options);
  const composition = analyzeComposition(scene, options);
  const lint = lintScene(scene);
  const lintIssues = lint.ok ? lint.issues : [];
  const warnings =
    composition.diagnostics.filter(
      (diagnostic) => diagnostic.severity === "warning",
    ).length + lintIssues.length;
  const errors = composition.diagnostics.filter(
    (diagnostic) => diagnostic.severity === "error",
  ).length;
  return {
    kind: "motionforge.check",
    version: 1,
    ok: errors === 0,
    validation: { ok: true, errors: [] },
    structural: inspectScene(scene),
    lint: { issues: lintIssues },
    tree,
    timeline,
    composition,
    summary: {
      nodes: tree.nodes.length,
      activeWindows: tree.nodes.filter((node) => node.activeWindow.duration > 0)
        .length,
      diagnostics: composition.diagnostics.length,
      warnings,
      errors,
    },
  };
}
