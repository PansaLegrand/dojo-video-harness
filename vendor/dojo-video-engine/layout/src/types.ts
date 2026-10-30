import type {
  MediaMetricsProvider,
  MeasurementQuality,
  ResolvedMeasurementProvenance,
  TextMetricsProvider,
} from "@dojo-video-engine/core";
import type { Scene, SceneAsset } from "@dojo-video-engine/schema";
import type { LayoutPlan, LayoutPlanValidationIssue } from "./schema";
import type { LayoutTextMeasurement } from "./text";

export type LayoutErrorCode =
  | "animation_conflict"
  | "budget_exceeded"
  | "constraint_conflict"
  | "constraint_cycle"
  | "constraint_unsatisfied"
  | "duplicate_item"
  | "grid_collision"
  | "grid_out_of_bounds"
  | "insufficient_space"
  | "invalid_geometry"
  | "invalid_plan"
  | "invalid_scene"
  | "missing_container"
  | "missing_intrinsic_metrics"
  | "missing_prepared_font"
  | "non_child_item"
  | "rich_text_unsafe"
  | "text_direction_required"
  | "unlisted_child"
  | "unknown_constraint_target";

export type LayoutErrorDetails = Record<
  string,
  string | number | boolean | null | string[] | number[]
>;

export class LayoutCompileError extends Error {
  readonly name = "LayoutCompileError";

  constructor(
    readonly code: LayoutErrorCode,
    message: string,
    readonly path: Array<string | number> = [],
    readonly details: LayoutErrorDetails = {},
  ) {
    super(message);
  }

  toJSON(): {
    name: "LayoutCompileError";
    code: LayoutErrorCode;
    message: string;
    path: Array<string | number>;
    details: LayoutErrorDetails;
  } {
    return {
      name: "LayoutCompileError",
      code: this.code,
      message: this.message,
      path: [...this.path],
      details: structuredClone(this.details),
    };
  }
}

export type LayoutDiagnosticSeverity = "info" | "warning";

export type LayoutDiagnostic = {
  severity: LayoutDiagnosticSeverity;
  code:
    | "estimated_intrinsic_metrics"
    | "intrinsic_clamped"
    | "layout_style_replaced"
    | "text_fit_clamped"
    | "text_fit_impossible"
    | "text_truncated"
    | "unsafe_text_planning"
    | "prepared_font_selected"
    | "system_font_fallback"
    | "unused_free_space";
  message: string;
  path: Array<string | number>;
  itemId?: string;
};

export type LayoutRect = {
  x: number;
  y: number;
  width: number;
  height: number;
};

export type LayoutItemMeasurement = {
  id: string;
  intrinsic: { width: number; height: number };
  resolved: LayoutRect;
  fieldMeasurements: {
    width: ResolvedMeasurementProvenance;
    height: ResolvedMeasurementProvenance;
  };
  measurement: MeasurementQuality;
  reason: string;
  textPlan?: LayoutTextMeasurement;
  font?: {
    family: string;
    assetId: string | null;
    measurement: "declared" | "estimated";
    reason: string;
  };
};

export type LayoutCompileStats = {
  items: number;
  tracks: number;
  lines: number;
  constraints: number;
  dependencyDepth: number;
  textCharacters: number;
  estimatedMeasurements: number;
};

export type MediaFallbackSize = { width: number; height: number };

export type MissingMediaMetricsPolicy =
  | { mode: "error" }
  | {
      mode: "fallback";
      sizes: Partial<
        Record<
          Extract<SceneAsset["type"], "image" | "video" | "lottie">,
          MediaFallbackSize
        >
      >;
    };

export type LayoutCompilerBudgets = {
  maxItems: number;
  maxTracks: number;
  maxConstraints: number;
  maxTextCharacters: number;
  maxSolverSteps: number;
  maxCoordinate: number;
};

export const defaultLayoutCompilerBudgets: Readonly<LayoutCompilerBudgets> =
  Object.freeze({
    maxItems: 1_024,
    maxTracks: 128,
    maxConstraints: 4_096,
    maxTextCharacters: 1_000_000,
    maxSolverSteps: 100_000,
    maxCoordinate: 10_000_000,
  });

export type CompileLayoutOptions = {
  frame?: number;
  textMetrics?: TextMetricsProvider;
  mediaMetrics?: MediaMetricsProvider;
  missingMediaMetrics?: MissingMediaMetricsPolicy;
  richTextPolicy?: "reject" | "legacy-unsafe";
  /** Defaults to require-prepared for deterministic v2 text layout. */
  fontFallbackPolicy?: "require-prepared" | "allow-system";
  budgets?: Partial<LayoutCompilerBudgets>;
};

export type LayoutCompileResult = {
  scene: Scene;
  plan: LayoutPlan;
  container: LayoutRect;
  measurements: LayoutItemMeasurement[];
  diagnostics: LayoutDiagnostic[];
  stats: LayoutCompileStats;
};

export type TryCompileLayoutResult =
  | { ok: true; result: LayoutCompileResult }
  | {
      ok: false;
      errors: Array<
        | ReturnType<LayoutCompileError["toJSON"]>
        | {
            name: "LayoutPlanValidationError";
            code: "invalid_plan";
            message: string;
            path: Array<string | number>;
            details: { issueCode: string };
          }
      >;
    };

export function validationIssueError(issue: LayoutPlanValidationIssue) {
  return {
    name: "LayoutPlanValidationError" as const,
    code: "invalid_plan" as const,
    message: issue.message,
    path: [...issue.path],
    details: { issueCode: issue.code },
  };
}
