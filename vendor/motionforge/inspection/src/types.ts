import type {
  SceneInspection,
  SceneLintIssue,
  SceneNode,
  SceneStyle,
} from "@motionforge/schema";
import type {
  MeasurementQuality,
  MediaMetricsProvider,
  TextMetricsProvider,
} from "@motionforge/core";

// Compatibility re-exports: MF5 moves ownership to core so layout,
// inspection, runtime, and renderer adapters share one metrics contract.
export type {
  MeasurementProvenance,
  MeasurementQuality,
  MediaMetricField,
  MediaMetrics,
  MediaMetricsProvider,
  ResolvedMeasurementProvenance,
  ResolvedMediaMetrics,
  ResolvedTextLineMetrics,
  TextLineMetrics,
  TextLineMetricsInput,
  TextMetricField,
  TextMetricsProvider,
} from "@motionforge/core";

export type SourcePath = Array<string | number>;
export type Rect = { x: number; y: number; width: number; height: number };
export type Point = { x: number; y: number };
export type Matrix2D = {
  a: number;
  b: number;
  c: number;
  d: number;
  e: number;
  f: number;
};

export type MeasuredRect = Rect & {
  measurement: MeasurementQuality;
  reason: string;
};

export type FrameWindow = {
  start: number;
  endExclusive: number;
  duration: number;
};

export type InspectionBaseOptions = {
  /** Explicit host/authoring semantics. IDs and text are never interpreted. */
  semanticRoles?: Readonly<Record<string, string>>;
  /** Pairs whose geometric overlap is deliberate. Pair order is irrelevant. */
  allowedOverlaps?: ReadonlyArray<readonly [string, string]>;
};

export type TreeInspectionNode = {
  id: string;
  type: SceneNode["type"];
  parentId: string | null;
  depth: number;
  documentOrder: number;
  sourcePath: SourcePath;
  semanticRole?: string;
  localWindow: FrameWindow;
  absoluteWindow: FrameWindow;
  activeWindow: FrameWindow;
  clippedByAncestor: boolean;
};

export type TreeInspection = {
  kind: "motionforge.tree";
  version: 1;
  fps: number;
  durationFrames: number;
  nodes: TreeInspectionNode[];
};

export type TimelineSource = {
  assetId: string;
  kind: "video" | "audio" | "lottie";
  offset: number;
  rate: number;
  loop: boolean;
  endBehavior: "hold" | "loop" | "silence";
  sourceStart: number;
  sourceEndUnclamped: number;
  intrinsicDuration?: number;
  frameRate?: { numerator: number; denominator: number };
  measurement: MeasurementQuality;
  reason: string;
};

export type TimelineInspectionNode = TreeInspectionNode & {
  startSeconds: number;
  endSeconds: number;
  source?: TimelineSource;
};

export type TimelineInspection = {
  kind: "motionforge.timeline";
  version: 1;
  fps: number;
  durationFrames: number;
  nodes: TimelineInspectionNode[];
};

export type TextLineInspection = {
  text: string;
  /** Axis-aligned world/composition bounds after ancestor/node transforms. */
  bounds: MeasuredRect;
  width: number;
  ascent: number;
  descent: number;
  measurement: MeasurementQuality;
  reason: string;
};

export type TextInspection = {
  value: string;
  lines: TextLineInspection[];
  fontFamily: string;
  fontSize: number;
  fontWeight: string | number;
  fontStyle: "normal" | "italic";
  lineHeight: number;
  direction: "ltr" | "rtl" | "inherit";
  fit: "wrap" | "shrink" | "truncate";
  overflow: "none" | "horizontal" | "vertical" | "both";
  truncated: boolean;
  measurement: MeasurementQuality;
  reason: string;
};

export type MediaInspection = {
  assetId: string;
  intrinsic: {
    width: number;
    height: number;
    durationSeconds?: number;
    frameRate?: { numerator: number; denominator: number };
  };
  fittedBounds: MeasuredRect;
  objectFit: "contain" | "cover" | "fill" | "none" | "scale-down";
  objectPosition: string;
  cropFraction: number;
  measurement: MeasurementQuality;
  reason: string;
};

export type LayoutInspectionNode = {
  id: string;
  type: SceneNode["type"];
  parentId: string | null;
  depth: number;
  documentOrder: number;
  paintOrder: number;
  zIndex: number;
  sourcePath: SourcePath;
  semanticRole?: string;
  localFrame: number;
  layoutBounds: MeasuredRect;
  contentBounds: MeasuredRect;
  transformedBounds: MeasuredRect;
  clipBounds: MeasuredRect;
  transform: Matrix2D;
  text?: TextInspection;
  media?: MediaInspection;
  flexOverflow?: { axis: "horizontal" | "vertical"; amount: number };
  style: Pick<
    SceneStyle,
    "display" | "overflow" | "opacity" | "zIndex" | "transform"
  >;
};

export type DiagnosticCode =
  | "outside_frame"
  | "zero_size"
  | "unsafe_edge"
  | "geometric_overlap"
  | "possible_occlusion"
  | "subtitle_collision"
  | "excessive_crop"
  | "flex_overflow";

export type RemediationClass =
  | "move_or_resize"
  | "adjust_timing"
  | "respect_safe_area"
  | "reorder_layers"
  | "declare_overlap_intent"
  | "adjust_media_crop"
  | "fix_flex_layout";

export type InspectionDiagnostic = {
  code: DiagnosticCode;
  severity: "info" | "warning" | "error";
  nodeId: string;
  relatedNodeIds: string[];
  frame: number;
  timeSeconds: number;
  bounds: MeasuredRect;
  sourcePath: SourcePath;
  remediation: RemediationClass;
  confidence: "high" | "medium" | "low";
  confidenceScore?: number;
  reason: string;
};

export type LayoutInspection = {
  kind: "motionforge.layout";
  version: 1;
  width: number;
  height: number;
  fps: number;
  requestedFrame: number;
  frame: number;
  timeSeconds: number;
  clamped: boolean;
  nodes: LayoutInspectionNode[];
  diagnostics: InspectionDiagnostic[];
};

export type LayoutInspectionOptions = InspectionBaseOptions & {
  textMetrics?: TextMetricsProvider;
  mediaMetrics?: MediaMetricsProvider;
  unsafeInsets?:
    | number
    | { top: number; right: number; bottom: number; left: number };
  /** Explicit semantic roles whose nodes must remain inside the safe region. */
  safeAreaRoles?: readonly string[];
  excessiveCropThreshold?: number;
};

export type HitTestOptions = LayoutInspectionOptions & {
  includeTransparent?: boolean;
};

export type HitTestResult = {
  kind: "motionforge.hit-test";
  version: 1;
  frame: number;
  timeSeconds: number;
  point: Point;
  hits: Array<{
    nodeId: string;
    sourcePath: SourcePath;
    paintOrder: number;
    zIndex: number;
    /** Point relative to the node layout-box origin; null if non-invertible. */
    localPoint: Point | null;
    measurement: MeasurementQuality;
    reason: string;
  }>;
};

export type AnalyzeCompositionOptions = LayoutInspectionOptions & {
  frames?: readonly number[];
  sampleCount?: number;
};

export type CompositionInspection = {
  kind: "motionforge.composition";
  version: 1;
  sampledFrames: number[];
  frames: LayoutInspection[];
  diagnostics: InspectionDiagnostic[];
  summary: {
    frames: number;
    nodes: number;
    diagnostics: number;
    byCode: Partial<Record<DiagnosticCode, number>>;
  };
};

export type CheckSceneOptions = AnalyzeCompositionOptions;
export type SceneCheckEnvelope =
  | {
      kind: "motionforge.check";
      version: 1;
      ok: false;
      validation: { ok: false; errors: string[] };
      structural: null;
      lint: { issues: [] };
      tree: null;
      timeline: null;
      composition: null;
      summary: {
        nodes: 0;
        activeWindows: 0;
        diagnostics: 0;
        warnings: 0;
        errors: number;
      };
    }
  | {
      kind: "motionforge.check";
      version: 1;
      ok: boolean;
      validation: { ok: true; errors: [] };
      structural: SceneInspection;
      lint: { issues: SceneLintIssue[] };
      tree: TreeInspection;
      timeline: TimelineInspection;
      composition: CompositionInspection;
      summary: {
        nodes: number;
        activeWindows: number;
        diagnostics: number;
        warnings: number;
        errors: number;
      };
    };
