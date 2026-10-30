import { z, type ZodType } from "zod/v3";
import { zodToJsonSchema } from "zod-to-json-schema";
import {
  applyScenePatch,
  effectNames,
  inspectScene,
  lintScene,
  migrateScene,
  parseScene,
  supportedStyleKeys,
  validateScene,
  type Scene,
  type ScenePatch,
} from "@dojo-video-engine/schema";
import {
  motionPresetDefinitions,
  type MotionPresetDefinition,
} from "@dojo-video-engine/presets";
import { macroNames, macroPromptGuide } from "@dojo-video-engine/presets/macros";
import {
  createExtensionRegistry,
  type ExtensionRegistry,
} from "@dojo-video-engine/extensions";
import {
  disposeAssetsAsync,
  prepareFrame,
  renderStill,
  resolveAssets,
  type ResolveAssetsOptions,
  type ResolvedAssets,
} from "@dojo-video-engine/renderer-canvas2d";
import {
  detectExportCapability,
  estimateExport,
  exportVideo,
  preflightExport,
  type ExportVideoOptions,
  type ExportVideoResult,
} from "@dojo-video-engine/export";
import {
  analyzeComposition,
  checkScene,
  hitTest,
  inspectLayout,
  inspectTimeline,
  inspectTree,
} from "@dojo-video-engine/inspection";
import type {
  AnalyzeCompositionOptions,
  CheckSceneOptions,
  CompositionInspection,
  DiagnosticCode,
  FrameWindow,
  HitTestOptions,
  HitTestResult,
  InspectionBaseOptions,
  InspectionDiagnostic,
  LayoutInspection,
  LayoutInspectionNode,
  LayoutInspectionOptions,
  Matrix2D,
  MeasuredRect,
  MeasurementQuality,
  MediaMetrics,
  MediaMetricsProvider,
  Point,
  Rect,
  RemediationClass,
  SceneCheckEnvelope,
  SourcePath,
  TextInspection,
  TextLineInspection,
  TextLineMetrics,
  TextLineMetricsInput,
  TextMetricsProvider,
  TimelineInspection,
  TimelineInspectionNode,
  TimelineSource,
  TreeInspection,
  TreeInspectionNode,
} from "@dojo-video-engine/inspection";
import {
  applySceneCommands,
  sceneCommandJsonSchema,
  sceneCommandsSchema,
  type CompileSceneCommandsContext,
} from "@dojo-video-engine/commands";

export type SceneChange = {
  kind: "add" | "remove" | "change";
  path: Array<string | number>;
  before?: unknown;
  after?: unknown;
};

export type SceneDiff = {
  equal: boolean;
  summary: { added: number; removed: number; changed: number };
  changes: SceneChange[];
};

export function diffScenes(
  beforeInput: unknown,
  afterInput: unknown,
): SceneDiff {
  const before = parseScene(beforeInput);
  const after = parseScene(afterInput);
  const changes: SceneChange[] = [];
  diffValue(before, after, [], changes);
  return {
    equal: changes.length === 0,
    summary: {
      added: changes.filter((change) => change.kind === "add").length,
      removed: changes.filter((change) => change.kind === "remove").length,
      changed: changes.filter((change) => change.kind === "change").length,
    },
    changes,
  };
}

function diffValue(
  before: unknown,
  after: unknown,
  path: Array<string | number>,
  changes: SceneChange[],
): void {
  if (Object.is(before, after)) return;
  if (Array.isArray(before) && Array.isArray(after)) {
    if (isIdArray(before) && isIdArray(after)) {
      const beforeOrder = before.map((value) => value.id);
      const afterOrder = after.map((value) => value.id);
      if (JSON.stringify(beforeOrder) !== JSON.stringify(afterOrder)) {
        changes.push({
          kind: "change",
          path: [...path, "$order"],
          before: beforeOrder,
          after: afterOrder,
        });
      }
      const beforeMap = new Map(before.map((value) => [value.id, value]));
      const afterMap = new Map(after.map((value) => [value.id, value]));
      const ids = Array.from(
        new Set([...beforeMap.keys(), ...afterMap.keys()]),
      ).sort();
      ids.forEach((id) =>
        diffOptional(
          beforeMap.get(id),
          afterMap.get(id),
          [...path, id],
          changes,
        ),
      );
      return;
    }
    const length = Math.max(before.length, after.length);
    for (let index = 0; index < length; index += 1) {
      diffOptional(before[index], after[index], [...path, index], changes);
    }
    return;
  }
  if (isRecord(before) && isRecord(after)) {
    const keys = Array.from(
      new Set([...Object.keys(before), ...Object.keys(after)]),
    ).sort();
    keys.forEach((key) =>
      diffOptional(before[key], after[key], [...path, key], changes),
    );
    return;
  }
  changes.push({ kind: "change", path, before, after });
}

function diffOptional(
  before: unknown,
  after: unknown,
  path: Array<string | number>,
  changes: SceneChange[],
): void {
  if (before === undefined && after !== undefined) {
    changes.push({ kind: "add", path, after });
  } else if (before !== undefined && after === undefined) {
    changes.push({ kind: "remove", path, before });
  } else {
    diffValue(before, after, path, changes);
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isIdArray(
  value: unknown[],
): value is Array<Record<string, unknown> & { id: string }> {
  return value.every(
    (entry) => isRecord(entry) && typeof entry.id === "string",
  );
}

export type CapabilityCatalog = ReturnType<typeof discoverCapabilities>;

export function discoverCapabilities(
  options: {
    extensions?: ExtensionRegistry;
    globalObject?: Partial<typeof globalThis>;
  } = {},
) {
  const extensions = options.extensions ?? createExtensionRegistry();
  const globalObject = options.globalObject ?? globalThis;
  return {
    scene: {
      schemaVersion: 1,
      nodeTypes: [
        "div",
        "text",
        "img",
        "video",
        "audio",
        "lottie",
        "effect",
        "extension",
        "shape",
      ],
      styleKeys: [...supportedStyleKeys],
      effects: [...effectNames],
    },
    motionPresets: motionPresetDefinitions.map(motionPresetManifest),
    macros: {
      names: macroNames(),
      promptGuide: macroPromptGuide(),
    },
    extensions: extensions.manifests(),
    export: detectExportCapability(globalObject),
  };
}

function motionPresetManifest(definition: MotionPresetDefinition) {
  return {
    name: definition.name,
    label: definition.label,
    description: definition.description,
    category: definition.category,
    thumbnail: definition.thumbnail,
    paramsSchema: zodToJsonSchema(definition.paramsSchema, {
      target: "jsonSchema7",
      $refStrategy: "none",
    }),
  };
}

type Canvas = HTMLCanvasElement | OffscreenCanvas;
type Canvas2DContext =
  | CanvasRenderingContext2D
  | OffscreenCanvasRenderingContext2D;

function createCanvas(width: number, height: number): Canvas {
  if (typeof OffscreenCanvas !== "undefined")
    return new OffscreenCanvas(width, height);
  if (typeof document !== "undefined") {
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    return canvas;
  }
  throw new Error(
    "Still/contact-sheet rendering needs OffscreenCanvas or document.createElement.",
  );
}

function canvas2DContext(canvas: Canvas): Canvas2DContext {
  const context = canvas.getContext("2d") as Canvas2DContext | null;
  if (!context) throw new Error("Canvas2D unavailable.");
  return context;
}

export async function renderSceneStill(options: {
  scene: unknown;
  frame: number;
  assets?: ResolvedAssets;
  resolve?: ResolveAssetsOptions;
}): Promise<Canvas> {
  const scene = parseScene(options.scene);
  const canvas = createCanvas(scene.width, scene.height);
  const context = canvas2DContext(canvas);
  const ownsAssets = options.assets === undefined;
  const assets =
    options.assets ?? (await resolveAssets(scene, options.resolve));
  try {
    const resolvedScene = await prepareFrame(scene, options.frame, assets);
    renderStill(context, scene, options.frame, { assets, resolvedScene });
  } finally {
    if (ownsAssets) await disposeAssetsAsync(assets);
  }
  return canvas;
}

export async function renderContactSheet(options: {
  scene: unknown;
  frames: number[];
  columns?: number;
  cellWidth?: number;
  assets?: ResolvedAssets;
  resolve?: ResolveAssetsOptions;
}): Promise<Canvas> {
  const scene = parseScene(options.scene);
  if (options.frames.length === 0)
    throw new Error("Contact sheet needs at least one frame.");
  const columns = Math.max(1, Math.floor(options.columns ?? 4));
  const cellWidth = Math.max(1, Math.floor(options.cellWidth ?? 320));
  const cellHeight = Math.max(
    1,
    Math.round((cellWidth * scene.height) / scene.width),
  );
  const rows = Math.ceil(options.frames.length / columns);
  const canvas = createCanvas(cellWidth * columns, cellHeight * rows);
  const context = canvas2DContext(canvas);
  const frameCanvas = createCanvas(scene.width, scene.height);
  const frameContext = canvas2DContext(frameCanvas);
  const ownsAssets = options.assets === undefined;
  const assets =
    options.assets ?? (await resolveAssets(scene, options.resolve));
  try {
    for (let index = 0; index < options.frames.length; index += 1) {
      const frame = options.frames[index] ?? 0;
      const resolvedScene = await prepareFrame(scene, frame, assets);
      renderStill(frameContext, scene, frame, { assets, resolvedScene });
      context.drawImage(
        frameCanvas,
        (index % columns) * cellWidth,
        Math.floor(index / columns) * cellHeight,
        cellWidth,
        cellHeight,
      );
    }
  } finally {
    if (ownsAssets) await disposeAssetsAsync(assets);
  }
  return canvas;
}

export async function exportSceneVideo(
  options: ExportVideoOptions,
): Promise<ExportVideoResult> {
  return exportVideo(options);
}

export type AgentToolDefinition = {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
};

type RegisteredTool = AgentToolDefinition & {
  execute(input: unknown): unknown | Promise<unknown>;
};

function tool(
  name: string,
  description: string,
  schema: ZodType,
  execute: (input: unknown) => unknown | Promise<unknown>,
): RegisteredTool {
  return {
    name,
    description,
    inputSchema: zodToJsonSchema(schema, {
      target: "jsonSchema7",
      $refStrategy: "none",
    }) as Record<string, unknown>,
    execute,
  };
}

export class AgentToolRegistry {
  private readonly tools: Map<string, RegisteredTool>;

  constructor(tools: RegisteredTool[]) {
    this.tools = new Map(tools.map((entry) => [entry.name, entry]));
  }

  list(): AgentToolDefinition[] {
    return Array.from(this.tools.values())
      .map(({ execute: _execute, ...definition }) => definition)
      .sort((left, right) =>
        left.name < right.name ? -1 : left.name > right.name ? 1 : 0,
      );
  }

  async call(name: string, input: unknown): Promise<unknown> {
    const entry = this.tools.get(name);
    if (!entry)
      throw new Error(
        `Unknown DojoVideoEngine agent tool ${JSON.stringify(name)}.`,
      );
    return entry.execute(input);
  }
}

export function createAgentToolRegistry(
  options: {
    extensions?: ExtensionRegistry;
    globalObject?: Partial<typeof globalThis>;
    commandContext?: CompileSceneCommandsContext;
  } = {},
): AgentToolRegistry {
  const sceneValueSchema = z.unknown().refine((value) => value !== undefined, {
    message: "scene is required.",
  });
  const sceneSchema = z.object({ scene: sceneValueSchema });
  const nodeIdSchema = z.string().min(1).max(191);
  const semanticRolesSchema = z
    .record(nodeIdSchema, z.string().min(1).max(128))
    .refine((roles) => Object.keys(roles).length <= 100, {
      message: "semanticRoles may contain at most 100 node roles.",
    });
  const allowedOverlapsSchema = z
    .array(z.tuple([nodeIdSchema, nodeIdSchema]))
    .max(100);
  const inspectionBaseShape = {
    semanticRoles: semanticRolesSchema.optional(),
    allowedOverlaps: allowedOverlapsSchema.optional(),
  };
  const insetSchema = z.union([
    z.number().finite().nonnegative().max(1_000_000),
    z
      .object({
        top: z.number().finite().nonnegative().max(1_000_000),
        right: z.number().finite().nonnegative().max(1_000_000),
        bottom: z.number().finite().nonnegative().max(1_000_000),
        left: z.number().finite().nonnegative().max(1_000_000),
      })
      .strict(),
  ]);
  const layoutOptionsShape = {
    ...inspectionBaseShape,
    unsafeInsets: insetSchema.optional(),
    safeAreaRoles: z.array(z.string().min(1).max(128)).max(100).optional(),
    excessiveCropThreshold: z.number().finite().min(0).max(1).optional(),
  };
  const treeInputSchema = z
    .object({ scene: sceneValueSchema, ...inspectionBaseShape })
    .strict();
  const layoutInputSchema = z
    .object({
      scene: sceneValueSchema,
      frame: z.number().int().nonnegative(),
      ...layoutOptionsShape,
    })
    .strict();
  const hitTestInputSchema = z
    .object({
      scene: sceneValueSchema,
      frame: z.number().int().nonnegative(),
      point: z
        .object({
          x: z.number().finite().min(-1_000_000_000).max(1_000_000_000),
          y: z.number().finite().min(-1_000_000_000).max(1_000_000_000),
        })
        .strict(),
      includeTransparent: z.boolean().optional(),
      ...layoutOptionsShape,
    })
    .strict();
  const checkInputSchema = z
    .object({
      scene: sceneValueSchema,
      frames: z.array(z.number().int().nonnegative()).max(100).optional(),
      sampleCount: z.number().int().positive().max(100).optional(),
      ...layoutOptionsShape,
    })
    .strict()
    .refine(
      (input) => input.frames === undefined || input.sampleCount === undefined,
      {
        message: "Use either frames or sampleCount, not both.",
        path: ["sampleCount"],
      },
    );
  const commandApplyInputSchema = z
    .object({
      scene: sceneValueSchema,
      commands: sceneCommandsSchema,
    })
    .strict();
  const strictSchemaTool = (
    name: string,
    description: string,
    schema: ZodType,
    execute: (input: unknown) => unknown | Promise<unknown>,
    required: string[],
    mutuallyExclusiveSamples = false,
  ): RegisteredTool => {
    const entry = tool(name, description, schema, execute);
    entry.inputSchema.required = required;
    const properties = entry.inputSchema.properties as
      | Record<string, Record<string, unknown>>
      | undefined;
    if (properties?.semanticRoles) {
      properties.semanticRoles.maxProperties = 100;
    }
    if (mutuallyExclusiveSamples) {
      entry.inputSchema.allOf = [
        { not: { required: ["frames", "sampleCount"] } },
      ];
    }
    return entry;
  };
  const commandApplyTool = strictSchemaTool(
    "dojo-video-engine.commands.apply",
    "Compile typed non-recursive edit commands and apply them as one transactional Scene patch.",
    commandApplyInputSchema,
    (input) => {
      const parsed = commandApplyInputSchema.parse(input);
      return applySceneCommands(
        parsed.scene,
        parsed.commands,
        options.commandContext,
      );
    },
    ["scene", "commands"],
  );
  const commandDocument = sceneCommandJsonSchema();
  const commandRoot = (
    commandDocument.definitions as
      | Record<string, Record<string, unknown>>
      | undefined
  )?.DojoVideoEngineSceneCommands;
  const commandToolProperties = commandApplyTool.inputSchema.properties as
    | Record<string, Record<string, unknown>>
    | undefined;
  if (!commandRoot || !commandToolProperties?.commands) {
    throw new Error(
      "DojoVideoEngine internal error: command JSON Schema root is unavailable.",
    );
  }
  commandToolProperties.commands = structuredClone(commandRoot);
  return new AgentToolRegistry([
    tool(
      "dojo-video-engine.validate",
      "Validate and normalize a scene.",
      sceneSchema,
      (input) => validateScene(sceneSchema.parse(input).scene),
    ),
    tool(
      "dojo-video-engine.migrate",
      "Migrate a scene to canonical Scene v1.",
      sceneSchema,
      (input) => migrateScene(sceneSchema.parse(input).scene),
    ),
    tool(
      "dojo-video-engine.inspect",
      "Inspect scene capabilities and resource declarations.",
      sceneSchema,
      (input) => inspectScene(sceneSchema.parse(input).scene),
    ),
    strictSchemaTool(
      "dojo-video-engine.inspect.tree",
      "Inspect the canonical node tree with source paths, parent/depth metadata, and local/absolute active windows.",
      treeInputSchema,
      (input) => {
        const parsed = treeInputSchema.parse(input);
        return inspectTree(parsed.scene, inspectionBaseOptions(parsed));
      },
      ["scene"],
    ),
    strictSchemaTool(
      "dojo-video-engine.inspect.timeline",
      "Inspect absolute node timing and source-media windows without rendering pixels.",
      treeInputSchema,
      (input) => {
        const parsed = treeInputSchema.parse(input);
        return inspectTimeline(parsed.scene, inspectionBaseOptions(parsed));
      },
      ["scene"],
    ),
    strictSchemaTool(
      "dojo-video-engine.inspect.layout",
      "Inspect renderer-neutral layout, transforms, clipping, z-order, text/media geometry, and diagnostics at one frame.",
      layoutInputSchema,
      (input) => {
        const parsed = layoutInputSchema.parse(input);
        const scene = assertInspectionFrames(parsed.scene, [parsed.frame]);
        return inspectLayout(
          scene,
          parsed.frame,
          layoutInspectionOptions(parsed),
        );
      },
      ["scene", "frame"],
    ),
    strictSchemaTool(
      "dojo-video-engine.hitTest",
      "Return topmost-first geometry hits for a scene point at one frame.",
      hitTestInputSchema,
      (input) => {
        const parsed = hitTestInputSchema.parse(input);
        const scene = assertInspectionFrames(parsed.scene, [parsed.frame]);
        return hitTest(scene, parsed.frame, parsed.point, {
          ...layoutInspectionOptions(parsed),
          ...(parsed.includeTransparent === undefined
            ? {}
            : { includeTransparent: parsed.includeTransparent }),
        });
      },
      ["scene", "frame", "point"],
    ),
    strictSchemaTool(
      "dojo-video-engine.check",
      "Return one bounded validation, tree, timeline, sampled-layout, and diagnostics envelope.",
      checkInputSchema,
      (input) => {
        const parsed = checkInputSchema.parse(input);
        const validation = validateScene(parsed.scene);
        const sceneInput = validation.ok ? validation.scene : parsed.scene;
        if (validation.ok) {
          assertInspectionFrames(validation.scene, parsed.frames ?? []);
        }
        return checkScene(sceneInput, {
          ...layoutInspectionOptions(parsed),
          ...(parsed.frames === undefined ? {} : { frames: parsed.frames }),
          ...(parsed.sampleCount === undefined
            ? {}
            : { sampleCount: parsed.sampleCount }),
        });
      },
      ["scene"],
      true,
    ),
    commandApplyTool,
    tool(
      "dojo-video-engine.lint",
      "Find valid-but-suspicious scene data.",
      sceneSchema,
      (input) => lintScene(sceneSchema.parse(input).scene),
    ),
    tool(
      "dojo-video-engine.patch",
      "Apply a transactional id-addressed scene patch.",
      z.object({ scene: z.unknown(), patch: z.unknown() }),
      (input) => {
        const parsed = z
          .object({ scene: z.unknown(), patch: z.unknown() })
          .parse(input);
        return applyScenePatch(parsed.scene, parsed.patch);
      },
    ),
    tool(
      "dojo-video-engine.diff",
      "Produce a stable semantic scene diff.",
      z.object({ before: z.unknown(), after: z.unknown() }),
      (input) => {
        const parsed = z
          .object({ before: z.unknown(), after: z.unknown() })
          .parse(input);
        return diffScenes(parsed.before, parsed.after);
      },
    ),
    tool(
      "dojo-video-engine.capabilities",
      "Discover scene, preset, macro, extension, and export capabilities.",
      z.object({}),
      () => discoverCapabilities(options),
    ),
    tool(
      "dojo-video-engine.export.estimate",
      "Estimate export work and output size.",
      sceneSchema,
      (input) => estimateExport(parseScene(sceneSchema.parse(input).scene)),
    ),
    tool(
      "dojo-video-engine.export.preflight",
      "Preflight renderer, resource, worker, and encoder capabilities.",
      sceneSchema,
      (input) =>
        preflightExport(
          parseScene(sceneSchema.parse(input).scene),
          options.globalObject ?? globalThis,
          { extensions: options.extensions },
        ),
    ),
    tool(
      "dojo-video-engine.render.still",
      "Render one scene frame to a browser canvas.",
      z.object({ scene: z.unknown(), frame: z.number().int().nonnegative() }),
      (input) => {
        const parsed = z
          .object({ scene: z.unknown(), frame: z.number().int().nonnegative() })
          .parse(input);
        return renderSceneStill({
          scene: parsed.scene,
          frame: parsed.frame,
          resolve: { extensions: options.extensions },
        });
      },
    ),
    tool(
      "dojo-video-engine.render.contactSheet",
      "Render selected frames into a browser contact-sheet canvas.",
      z.object({
        scene: z.unknown(),
        frames: z.array(z.number().int().nonnegative()).min(1),
        columns: z.number().int().positive().optional(),
        cellWidth: z.number().int().positive().optional(),
      }),
      (input) => {
        const parsed = z
          .object({
            scene: z.unknown(),
            frames: z.array(z.number().int().nonnegative()).min(1),
            columns: z.number().int().positive().optional(),
            cellWidth: z.number().int().positive().optional(),
          })
          .parse(input);
        return renderContactSheet({
          scene: parsed.scene,
          frames: parsed.frames,
          columns: parsed.columns,
          cellWidth: parsed.cellWidth,
          resolve: { extensions: options.extensions },
        });
      },
    ),
    tool(
      "dojo-video-engine.export",
      "Export a scene to an MP4 Blob in a WebCodecs runtime.",
      z.object({
        scene: z.unknown(),
        startFrame: z.number().int().nonnegative().optional(),
        endFrame: z.number().int().nonnegative().optional(),
      }),
      (input) => {
        const parsed = z
          .object({
            scene: z.unknown(),
            startFrame: z.number().int().nonnegative().optional(),
            endFrame: z.number().int().nonnegative().optional(),
          })
          .parse(input);
        return exportVideo({
          scene: parseScene(parsed.scene),
          startFrame: parsed.startFrame,
          endFrame: parsed.endFrame,
          extensions: options.extensions,
        });
      },
    ),
  ]);
}

function inspectionBaseOptions(input: {
  semanticRoles?: Record<string, string>;
  allowedOverlaps?: Array<[string, string]>;
}): InspectionBaseOptions {
  return {
    ...(input.semanticRoles === undefined
      ? {}
      : { semanticRoles: input.semanticRoles }),
    ...(input.allowedOverlaps === undefined
      ? {}
      : { allowedOverlaps: input.allowedOverlaps }),
  };
}

function assertInspectionFrames(
  sceneInput: unknown,
  frames: readonly number[],
): Scene {
  const scene = parseScene(sceneInput);
  for (const frame of frames) {
    if (frame >= scene.duration) {
      throw new Error(
        `Inspection frame ${frame} is outside Scene duration ${scene.duration}.`,
      );
    }
  }
  return scene;
}

function layoutInspectionOptions(input: {
  semanticRoles?: Record<string, string>;
  allowedOverlaps?: Array<[string, string]>;
  unsafeInsets?:
    | number
    | { top: number; right: number; bottom: number; left: number };
  safeAreaRoles?: string[];
  excessiveCropThreshold?: number;
}): LayoutInspectionOptions {
  return {
    ...inspectionBaseOptions(input),
    ...(input.unsafeInsets === undefined
      ? {}
      : { unsafeInsets: input.unsafeInsets }),
    ...(input.safeAreaRoles === undefined
      ? {}
      : { safeAreaRoles: input.safeAreaRoles }),
    ...(input.excessiveCropThreshold === undefined
      ? {}
      : { excessiveCropThreshold: input.excessiveCropThreshold }),
  };
}

export {
  applySceneCommands,
  applyScenePatch,
  analyzeComposition,
  checkScene,
  hitTest,
  inspectLayout,
  inspectScene,
  inspectTimeline,
  inspectTree,
  lintScene,
  migrateScene,
  validateScene,
};
export {
  capabilityManifests,
  compileSceneCommands,
  createSceneWorkspace,
  diffSceneSemantics,
  getMacroManifest,
  getMotionPresetManifest,
  invertScenePatch,
  macroManifests,
  motionPresetManifests,
  sceneCommandJsonSchema,
  sceneCommandSchema,
  sceneCommandsSchema,
} from "@dojo-video-engine/commands";
export type { Scene, ScenePatch };
export type {
  AnalyzeCompositionOptions,
  CheckSceneOptions,
  CompositionInspection,
  DiagnosticCode,
  FrameWindow,
  HitTestOptions,
  HitTestResult,
  InspectionBaseOptions,
  InspectionDiagnostic,
  LayoutInspection,
  LayoutInspectionNode,
  LayoutInspectionOptions,
  Matrix2D,
  MeasuredRect,
  MeasurementQuality,
  MediaMetrics,
  MediaMetricsProvider,
  Point,
  Rect,
  RemediationClass,
  SceneCheckEnvelope,
  SourcePath,
  TextInspection,
  TextLineInspection,
  TextLineMetrics,
  TextLineMetricsInput,
  TextMetricsProvider,
  TimelineInspection,
  TimelineInspectionNode,
  TimelineSource,
  TreeInspection,
  TreeInspectionNode,
};
export type {
  ApplySceneCommandsResult,
  CapabilityManifest,
  CommandDiagnostic,
  CommandError,
  CompileSceneCommandsContext,
  CompileSceneCommandsResult,
  MacroManifest,
  MotionPresetManifest,
  SceneCommand,
  SceneCommands,
  SceneWorkspaceOptions,
  SceneWorkspaceSnapshot,
  WorkspaceDraft,
  WorkspaceHistoryEntry,
  WorkspaceSemanticChange,
  WorkspaceSemanticDiff,
} from "@dojo-video-engine/commands";

export * from "./browser-evidence";
export * from "./evidence";
export * from "./workflow";
export * from "./workflow-evidence";
