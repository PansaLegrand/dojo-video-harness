import { z, type ZodType } from "zod/v3";
import { zodToJsonSchema } from "zod-to-json-schema";
import {
  colorValueSchema,
  extensionDescriptorSchema,
  parseScene,
  type Scene,
  type SceneAsset,
  type SceneExtensionDescriptor,
  type SceneJsonValue,
  type SceneNode,
} from "@dojo-video-engine/schema";

export type ExtensionSceneNode = SceneNode & {
  type: "extension";
  extension: SceneExtensionDescriptor;
};

export const extensionAssetRequirementSchema = z
  .object({
    assetId: z.string().min(1),
    type: z.enum(["image", "video", "audio", "font", "lottie"]).optional(),
    optional: z.boolean().default(false),
    purpose: z.string().min(1).max(160).optional(),
  })
  .strict();

export type ExtensionAssetRequirement = z.input<
  typeof extensionAssetRequirementSchema
>;
export type NormalizedExtensionAssetRequirement = z.output<
  typeof extensionAssetRequirementSchema
>;

export type ExtensionResolveContext<P> = {
  scene: Scene;
  node: ExtensionSceneNode;
  params: P;
  requirements: readonly NormalizedExtensionAssetRequirement[];
  assets: ReadonlyMap<string, SceneAsset>;
  signal?: AbortSignal;
};

/**
 * Deterministic inputs used to decide whether node-scoped extension resources
 * may survive a Scene revision. Cancellation is deliberately excluded: a
 * reuse identity must depend on Scene data, not transient host state.
 */
export type ExtensionReuseContext<P> = Omit<
  ExtensionResolveContext<P>,
  "signal"
>;

/** Maximum opaque reuse-key length accepted from a trusted extension hook. */
export const MAX_EXTENSION_REUSE_KEY_LENGTH = 512;

export type ExtensionPrepareContext<P, ResolvedAssets> = {
  scene: Scene;
  node: ExtensionSceneNode;
  params: P;
  resolvedAssets: ResolvedAssets;
  frame: number;
  localFrame: number;
  signal?: AbortSignal;
};

export const extensionDisplayLimits = Object.freeze({
  maxOperations: 1_024,
  maxStableIdLength: 512,
  maxLocalIdLength: 128,
  maxTextLength: 16_384,
  maxStringLength: 16_384,
  maxPayloadValues: 16_384,
  maxPayloadDepth: 32,
  maxPayloadBytes: 256 * 1_024,
  maxStandardOutputBytes: 512 * 1_024,
  maxCoordinateMagnitude: 10_000_000,
});

export const legacyExtensionRendererCapability = Object.freeze({
  id: "dojo-video-engine.legacy.renderer-adapter" as const,
  version: "1.0.0" as const,
});

export type ExtensionExecutionRealm = "main" | "worker";

/** Resolved scene-space border box. Standard operation coordinates are local to it. */
export type ExtensionDisplayBox = Readonly<{
  x: number;
  y: number;
  width: number;
  height: number;
}>;

export type ExtensionDisplayCompileContext<P, ResolvedAssets, PreparedFrame> =
  Readonly<{
    scene: Scene;
    node: ExtensionSceneNode;
    box: ExtensionDisplayBox;
    params: P;
    requirements: readonly NormalizedExtensionAssetRequirement[];
    resolvedAssets: ResolvedAssets;
    preparedFrame: PreparedFrame;
    frame: number;
    localFrame: number;
    sceneFps: number;
  }>;

type ExtensionDisplayGeometry = Readonly<{
  /** Node-local coordinate: (0, 0) is the extension border-box origin. */
  x: number;
  y: number;
  width: number;
  height: number;
  opacity?: number;
}>;

export type ExtensionRectDisplayOperation = ExtensionDisplayGeometry &
  Readonly<{
    kind: "rect";
    id: string;
    fill?: string;
    stroke?: string;
    strokeWidth?: number;
    radius?: number;
  }>;

export type ExtensionTextDisplayOperation = Readonly<{
  kind: "text";
  id: string;
  text: string;
  x: number;
  y: number;
  maxWidth?: number;
  fontFamily: string;
  fontSize: number;
  fontWeight?: string;
  fill: string;
  align?: "start" | "center" | "end";
  baseline?: "top" | "middle" | "alphabetic" | "bottom";
  opacity?: number;
}>;

export type ExtensionImageDisplayOperation = ExtensionDisplayGeometry &
  Readonly<{
    kind: "image";
    id: string;
    assetId: string;
    fit?: "fill" | "contain" | "cover" | "none" | "scale-down";
  }>;

/** The deliberately small renderer-neutral operation subset exposed in ABI v1. */
export type ExtensionStandardDisplayOperation =
  | ExtensionRectDisplayOperation
  | ExtensionTextDisplayOperation
  | ExtensionImageDisplayOperation;

export type ExtensionRectDisplayInput = Omit<
  ExtensionRectDisplayOperation,
  "kind" | "id"
>;
export type ExtensionTextDisplayInput = Omit<
  ExtensionTextDisplayOperation,
  "kind" | "id"
>;
export type ExtensionImageDisplayInput = Omit<
  ExtensionImageDisplayOperation,
  "kind" | "id"
>;

/**
 * A node-scoped writer. It owns ids, asset allowlisting, and output budgets.
 * Every x/y accepted by it is local to the extension node's border box.
 */
export type ExtensionStandardDisplayBuilder = {
  readonly size: number;
  rect(localId: string, input: ExtensionRectDisplayInput): void;
  text(localId: string, input: ExtensionTextDisplayInput): void;
  image(localId: string, input: ExtensionImageDisplayInput): void;
};

export type ExtensionOpaqueCapability = Readonly<{
  id: string;
  version: string;
  realms: readonly ExtensionExecutionRealm[];
}>;

export type ExtensionStandardDisplayContract<P, ResolvedAssets, PreparedFrame> =
  Readonly<{
    kind: "standard";
    version: "1";
    compile(
      context: ExtensionDisplayCompileContext<P, ResolvedAssets, PreparedFrame>,
      output: ExtensionStandardDisplayBuilder,
    ): void;
  }>;

export type ExtensionOpaqueDisplayContract<
  P,
  ResolvedAssets,
  PreparedFrame,
  Payload extends SceneJsonValue,
> = Readonly<{
  kind: "opaque";
  capability: ExtensionOpaqueCapability;
  payloadSchema: ZodType<Payload>;
  compile(
    context: ExtensionDisplayCompileContext<P, ResolvedAssets, PreparedFrame>,
  ): Payload;
}>;

export type ExtensionDisplayContract<
  P,
  ResolvedAssets,
  PreparedFrame,
  Payload extends SceneJsonValue = SceneJsonValue,
> =
  | ExtensionStandardDisplayContract<P, ResolvedAssets, PreparedFrame>
  | ExtensionOpaqueDisplayContract<P, ResolvedAssets, PreparedFrame, Payload>;

export type ExtensionStandardDisplayCompilation = Readonly<{
  kind: "standard";
  version: "1";
  operations: readonly ExtensionStandardDisplayOperation[];
}>;

export type ExtensionOpaqueDisplayCompilation = Readonly<{
  kind: "opaque";
  capability: Readonly<{ id: string; version: string }>;
  payload: SceneJsonValue;
}>;

export type ExtensionDisplayCompilation =
  | ExtensionStandardDisplayCompilation
  | ExtensionOpaqueDisplayCompilation;

// Definitions are registered heterogeneously, so hooks use the same
// intentional bivariance pattern as event-handler APIs. Runtime safety comes
// from paramsSchema validation before any hook is called.
type ExtensionHook<Context, Result> = {
  bivarianceHack(context: Context): Result;
}["bivarianceHack"];

export type DojoVideoEngineExtensionDefinition<
  P,
  ResolvedAssets = undefined,
  PreparedFrame = undefined,
  DisplayPayload extends SceneJsonValue = SceneJsonValue,
> = {
  name: string;
  version: string;
  displayName?: string;
  description?: string;
  compatibleVersions?: readonly string[];
  paramsSchema: ZodType<P>;
  deterministic: true;
  workerCompatible: boolean;
  /**
   * Legacy renderer adapters remain supported for the complete 1.x line. New
   * portable definitions use `display` and receive an empty normalized map.
   */
  renderers: Readonly<Record<string, unknown>>;
  display?: ExtensionDisplayContract<
    P,
    ResolvedAssets,
    PreparedFrame,
    DisplayPayload
  >;
  assets?: ExtensionHook<
    { scene: Scene; node: ExtensionSceneNode; params: P },
    readonly ExtensionAssetRequirement[]
  >;
  resolveAssets?: ExtensionHook<
    ExtensionResolveContext<P>,
    ResolvedAssets | Promise<ResolvedAssets>
  >;
  /**
   * Opts node-scoped resolved assets into cross-revision reuse. Return null to
   * reacquire for this context. The renderer additionally checks definition,
   * adapter, execution mode, and every required asset's resolved identity.
   * Requires reuseSafety: "immutable": resolvedAssets may be read by live
   * revisions concurrently and must never carry mutable per-frame state.
   */
  reuseKey?: ExtensionHook<ExtensionReuseContext<P>, string | null>;
  reuseSafety?: "immutable";
  prepareFrame?: ExtensionHook<
    ExtensionPrepareContext<P, ResolvedAssets>,
    PreparedFrame | Promise<PreparedFrame>
  >;
  disposeAssets?: ExtensionHook<ResolvedAssets, void | Promise<void>>;
};

export type DojoVideoEngineExtensionInput<
  P,
  ResolvedAssets = undefined,
  PreparedFrame = undefined,
  DisplayPayload extends SceneJsonValue = SceneJsonValue,
> = Omit<
  DojoVideoEngineExtensionDefinition<
    P,
    ResolvedAssets,
    PreparedFrame,
    DisplayPayload
  >,
  "renderers" | "display"
> &
  (
    | {
        renderers: Readonly<Record<string, unknown>>;
        display?: undefined;
      }
    | {
        renderers?: Readonly<Record<string, unknown>>;
        display: ExtensionDisplayContract<
          P,
          ResolvedAssets,
          PreparedFrame,
          DisplayPayload
        >;
      }
  );

export type RegisteredExtensionDefinition = DojoVideoEngineExtensionDefinition<
  unknown,
  unknown,
  unknown,
  SceneJsonValue
>;

export type ExtensionDisplayManifest =
  | Readonly<{ kind: "standard"; version: "1" }>
  | Readonly<{
      kind: "opaque";
      capability: ExtensionOpaqueCapability;
      payloadSchema: ReturnType<typeof zodToJsonSchema>;
    }>
  | Readonly<{
      kind: "legacy-opaque";
      capabilities: readonly Readonly<{
        renderer: string;
        id: "dojo-video-engine.legacy.renderer-adapter";
        version: "1.0.0";
        realms: readonly ExtensionExecutionRealm[];
      }>[];
    }>;

export type ExtensionManifest = {
  name: string;
  version: string;
  displayName?: string;
  description?: string;
  compatibleVersions: string[];
  deterministic: true;
  workerCompatible: boolean;
  renderers: string[];
  display: ExtensionDisplayManifest;
  reuseSafety?: "immutable";
  paramsSchema: ReturnType<typeof zodToJsonSchema>;
};

/** Serializable metadata hosts and agents can use for capability discovery. */
export function extensionManifest<
  P,
  ResolvedAssets,
  PreparedFrame,
  DisplayPayload extends SceneJsonValue,
>(
  definition: DojoVideoEngineExtensionDefinition<
    P,
    ResolvedAssets,
    PreparedFrame,
    DisplayPayload
  >,
): ExtensionManifest {
  return {
    name: definition.name,
    version: definition.version,
    ...(definition.displayName ? { displayName: definition.displayName } : {}),
    ...(definition.description ? { description: definition.description } : {}),
    compatibleVersions: [...(definition.compatibleVersions ?? [])],
    deterministic: true,
    workerCompatible: definition.workerCompatible,
    renderers: Object.keys(definition.renderers).sort(compareCodeUnits),
    display: extensionDisplayManifest(definition),
    ...(definition.reuseSafety ? { reuseSafety: definition.reuseSafety } : {}),
    paramsSchema: zodToJsonSchema(definition.paramsSchema, {
      target: "jsonSchema7",
      $refStrategy: "none",
    }),
  };
}

function extensionDisplayManifest(
  definition: RegisteredExtensionDefinition,
): ExtensionDisplayManifest {
  if (definition.display?.kind === "standard") {
    return { kind: "standard", version: "1" };
  }
  if (definition.display?.kind === "opaque") {
    return {
      kind: "opaque",
      capability: {
        id: definition.display.capability.id,
        version: definition.display.capability.version,
        realms: [...definition.display.capability.realms],
      },
      payloadSchema: zodToJsonSchema(definition.display.payloadSchema, {
        target: "jsonSchema7",
        $refStrategy: "none",
      }),
    };
  }
  const realms: readonly ExtensionExecutionRealm[] = definition.workerCompatible
    ? ["main", "worker"]
    : ["main"];
  return {
    kind: "legacy-opaque",
    capabilities: Object.keys(definition.renderers)
      .sort(compareCodeUnits)
      .map((renderer) => ({
        renderer,
        id: "dojo-video-engine.legacy.renderer-adapter" as const,
        version: "1.0.0" as const,
        realms: [...realms],
      })),
  };
}

export function defineExtension<
  P,
  ResolvedAssets = undefined,
  PreparedFrame = undefined,
  DisplayPayload extends SceneJsonValue = SceneJsonValue,
>(
  definition: DojoVideoEngineExtensionInput<
    P,
    ResolvedAssets,
    PreparedFrame,
    DisplayPayload
  >,
): DojoVideoEngineExtensionDefinition<
  P,
  ResolvedAssets,
  PreparedFrame,
  DisplayPayload
> {
  const normalized = normalizeExtensionDefinition(definition);
  const runtimeDefinition = asRegisteredDefinition(normalized);
  const identity = extensionDescriptorSchema.safeParse({
    name: runtimeDefinition.name,
    version: runtimeDefinition.version,
    params: {},
  });
  if (!identity.success) {
    throw new Error(
      `Invalid extension identity: ${identity.error.issues
        .map((issue) => issue.message)
        .join("; ")}`,
    );
  }
  if (runtimeDefinition.deterministic !== true) {
    throw new Error(
      `Extension "${runtimeDefinition.name}" must be deterministic.`,
    );
  }
  if (typeof runtimeDefinition.workerCompatible !== "boolean") {
    throw new Error(
      `Extension "${runtimeDefinition.name}" workerCompatible must be a boolean.`,
    );
  }
  if (
    runtimeDefinition.display === undefined &&
    Object.keys(runtimeDefinition.renderers).length === 0
  ) {
    throw new Error(
      `Extension "${runtimeDefinition.name}" must declare at least one renderer adapter.`,
    );
  }
  validateExtensionDisplayContract(runtimeDefinition);
  if (
    runtimeDefinition.reuseKey !== undefined &&
    typeof runtimeDefinition.reuseKey !== "function"
  ) {
    throw new Error(
      `Extension "${runtimeDefinition.name}" reuseKey must be a function.`,
    );
  }
  if (
    runtimeDefinition.reuseKey !== undefined &&
    runtimeDefinition.reuseSafety !== "immutable"
  ) {
    throw new Error(
      `Extension "${runtimeDefinition.name}" reuseKey requires reuseSafety: "immutable".`,
    );
  }
  if (
    runtimeDefinition.reuseKey === undefined &&
    runtimeDefinition.reuseSafety !== undefined
  ) {
    throw new Error(
      `Extension "${runtimeDefinition.name}" reuseSafety requires reuseKey.`,
    );
  }
  if (
    runtimeDefinition.displayName !== undefined &&
    (typeof runtimeDefinition.displayName !== "string" ||
      runtimeDefinition.displayName.trim().length === 0 ||
      runtimeDefinition.displayName.length > 80)
  ) {
    throw new Error(
      `Extension "${runtimeDefinition.name}" displayName must be a non-empty string of at most 80 characters.`,
    );
  }
  if (
    runtimeDefinition.description !== undefined &&
    (typeof runtimeDefinition.description !== "string" ||
      runtimeDefinition.description.trim().length === 0 ||
      runtimeDefinition.description.length > 500)
  ) {
    throw new Error(
      `Extension "${runtimeDefinition.name}" description must be a non-empty string of at most 500 characters.`,
    );
  }

  if (
    runtimeDefinition.compatibleVersions !== undefined &&
    !Array.isArray(runtimeDefinition.compatibleVersions)
  ) {
    throw new Error(
      `Extension "${runtimeDefinition.name}" compatibleVersions must be an array.`,
    );
  }

  const compatible = new Set<string>();
  for (const version of runtimeDefinition.compatibleVersions ?? []) {
    const parsed = extensionDescriptorSchema.safeParse({
      name: runtimeDefinition.name,
      version,
      params: {},
    });
    if (!parsed.success) {
      throw new Error(
        `Extension "${runtimeDefinition.name}" has invalid compatible version ${JSON.stringify(version)}.`,
      );
    }
    if (version === runtimeDefinition.version || compatible.has(version)) {
      throw new Error(
        `Extension "${runtimeDefinition.name}" repeats compatible version ${JSON.stringify(version)}.`,
      );
    }
    compatible.add(version);
  }

  return normalized;
}

function normalizeExtensionDefinition<
  P,
  ResolvedAssets,
  PreparedFrame,
  DisplayPayload extends SceneJsonValue,
>(
  definition: DojoVideoEngineExtensionInput<
    P,
    ResolvedAssets,
    PreparedFrame,
    DisplayPayload
  >,
): DojoVideoEngineExtensionDefinition<
  P,
  ResolvedAssets,
  PreparedFrame,
  DisplayPayload
> {
  if (definition.display === undefined) {
    return definition as DojoVideoEngineExtensionDefinition<
      P,
      ResolvedAssets,
      PreparedFrame,
      DisplayPayload
    >;
  }
  if (
    definition.renderers !== undefined &&
    Object.keys(definition.renderers).length > 0
  ) {
    throw new Error(
      `Extension "${definition.name}" must choose either a display contract or legacy renderer adapters, not both.`,
    );
  }
  return {
    ...definition,
    renderers: Object.freeze({}),
  } as DojoVideoEngineExtensionDefinition<
    P,
    ResolvedAssets,
    PreparedFrame,
    DisplayPayload
  >;
}

function validateExtensionDisplayContract(
  definition: RegisteredExtensionDefinition,
): void {
  const display = definition.display;
  if (!display) return;
  if (display.kind === "standard") {
    if (display.version !== "1" || typeof display.compile !== "function") {
      throw new Error(
        `Extension "${definition.name}" standard display contract requires version "1" and a synchronous compile function.`,
      );
    }
    return;
  }
  if (display.kind !== "opaque") {
    throw new Error(
      `Extension "${definition.name}" display contract kind must be "standard" or "opaque".`,
    );
  }
  if (typeof display.compile !== "function") {
    throw new Error(
      `Extension "${definition.name}" opaque display contract requires a synchronous compile function.`,
    );
  }
  const payloadSchema = display.payloadSchema as { safeParse?: unknown };
  if (typeof payloadSchema?.safeParse !== "function") {
    throw new Error(
      `Extension "${definition.name}" opaque display contract requires a payloadSchema.`,
    );
  }
  assertExactCapabilityIdentity(display.capability, definition.name);
  if (
    display.capability.realms.includes("worker") &&
    !definition.workerCompatible
  ) {
    throw new Error(
      `Extension "${definition.name}" cannot declare an opaque worker capability when workerCompatible is false.`,
    );
  }
}

function assertExactCapabilityIdentity(
  capability: unknown,
  extensionName: string,
): asserts capability is ExtensionOpaqueCapability {
  if (typeof capability !== "object" || capability === null) {
    throw new Error(
      `Extension "${extensionName}" opaque display contract requires a capability object.`,
    );
  }
  const candidate = capability as Record<string, unknown>;
  const parsed = extensionDescriptorSchema.safeParse({
    name: candidate.id,
    version: candidate.version,
    params: {},
  });
  if (!parsed.success) {
    throw new Error(
      `Extension "${extensionName}" opaque capability requires a bounded namespaced id and exact semantic version.`,
    );
  }
  if (!Array.isArray(candidate.realms) || candidate.realms.length === 0) {
    throw new Error(
      `Extension "${extensionName}" opaque capability must declare at least one execution realm.`,
    );
  }
  const realms = candidate.realms as unknown[];
  if (
    realms.some((realm) => realm !== "main" && realm !== "worker") ||
    new Set(realms).size !== realms.length
  ) {
    throw new Error(
      `Extension "${extensionName}" opaque capability realms must be unique "main" or "worker" values.`,
    );
  }
}

const coordinateSchema = z
  .number()
  .finite()
  .min(-extensionDisplayLimits.maxCoordinateMagnitude)
  .max(extensionDisplayLimits.maxCoordinateMagnitude);
const dimensionSchema = z
  .number()
  .finite()
  .min(0)
  .max(extensionDisplayLimits.maxCoordinateMagnitude);
const opacitySchema = z.number().finite().min(0).max(1);
const displayStringSchema = z
  .string()
  .min(1)
  .max(extensionDisplayLimits.maxStringLength);

const rectDisplayInputSchema = z
  .object({
    x: coordinateSchema,
    y: coordinateSchema,
    width: dimensionSchema,
    height: dimensionSchema,
    opacity: opacitySchema.optional(),
    fill: colorValueSchema.optional(),
    stroke: colorValueSchema.optional(),
    strokeWidth: dimensionSchema.optional(),
    radius: dimensionSchema.optional(),
  })
  .strict();

const textDisplayInputSchema = z
  .object({
    text: z.string().max(extensionDisplayLimits.maxTextLength),
    x: coordinateSchema,
    y: coordinateSchema,
    maxWidth: dimensionSchema.optional(),
    fontFamily: displayStringSchema,
    fontSize: z
      .number()
      .finite()
      .positive()
      .max(extensionDisplayLimits.maxCoordinateMagnitude),
    fontWeight: displayStringSchema.optional(),
    fill: colorValueSchema,
    align: z.enum(["start", "center", "end"]).optional(),
    baseline: z.enum(["top", "middle", "alphabetic", "bottom"]).optional(),
    opacity: opacitySchema.optional(),
  })
  .strict();

const imageDisplayInputSchema = z
  .object({
    assetId: z.string().min(1).max(191),
    x: coordinateSchema,
    y: coordinateSchema,
    width: dimensionSchema,
    height: dimensionSchema,
    fit: z.enum(["fill", "contain", "cover", "none", "scale-down"]).optional(),
    opacity: opacitySchema.optional(),
  })
  .strict();

const localDisplayIdPattern = /^[A-Za-z0-9][A-Za-z0-9._/-]*$/;

/**
 * Compiles one explicit display extension into an owned, deeply frozen value.
 * Legacy renderer adapters deliberately stay on their compatibility backend.
 */
export function compileExtensionDisplay<
  P,
  ResolvedAssets,
  PreparedFrame,
  DisplayPayload extends SceneJsonValue,
>(
  definition: DojoVideoEngineExtensionDefinition<
    P,
    ResolvedAssets,
    PreparedFrame,
    DisplayPayload
  >,
  context: ExtensionDisplayCompileContext<P, ResolvedAssets, PreparedFrame>,
): ExtensionDisplayCompilation {
  const display = definition.display;
  if (!display) {
    throw new Error(
      `Extension ${definition.name}@${definition.version} uses legacy renderer adapters and cannot be compiled as a portable display contract.`,
    );
  }
  validateDisplayCompileContext(context);
  const safeContext = Object.freeze({
    ...context,
    scene: cloneFrozenCompileJson(context.scene, "compile scene"),
    node: cloneFrozenCompileJson(context.node, "compile node"),
    params: cloneFrozenCompileJson(context.params, "compile params"),
    requirements: cloneFrozenCompileJson(
      context.requirements,
      "compile requirements",
    ),
    // These two values are explicit trusted-native seams and are not cloned.
    resolvedAssets: context.resolvedAssets,
    preparedFrame: context.preparedFrame,
  }) as ExtensionDisplayCompileContext<P, ResolvedAssets, PreparedFrame>;
  if (display.kind === "standard") {
    const operations: ExtensionStandardDisplayOperation[] = [];
    const builder = createStandardDisplayBuilder(
      safeContext.node.id,
      safeContext.requirements,
      operations,
    );
    let result: unknown;
    try {
      result = display.compile(safeContext, builder.output);
    } finally {
      builder.seal();
    }
    if (isPromiseLike(result)) {
      void Promise.resolve(result).catch(() => undefined);
      throw new Error(
        `Extension ${definition.name}@${definition.version} display compilation must be synchronous; use prepareFrame for asynchronous work.`,
      );
    }
    assertEncodedDisplaySize(
      operations,
      extensionDisplayLimits.maxStandardOutputBytes,
      "standard display output",
    );
    return Object.freeze({
      kind: "standard",
      version: "1",
      operations: Object.freeze([...operations]),
    });
  }

  const capability = Object.freeze({
    id: display.capability.id,
    version: display.capability.version,
  });
  const payloadSchema = display.payloadSchema;
  const rawPayload: unknown = display.compile(safeContext);
  if (isPromiseLike(rawPayload)) {
    void Promise.resolve(rawPayload).catch(() => undefined);
    throw new Error(
      `Extension ${definition.name}@${definition.version} display compilation must be synchronous; use prepareFrame for asynchronous work.`,
    );
  }
  const parsed = payloadSchema.safeParse(rawPayload);
  if (!parsed.success) {
    throw new Error(
      `Extension ${definition.name}@${definition.version} emitted an invalid opaque payload: ${parsed.error.issues
        .map(
          (issue) => `${issue.path.join(".") || "payload"}: ${issue.message}`,
        )
        .join("; ")}`,
    );
  }
  const payload = cloneBoundedDisplayJson(parsed.data, "opaque payload");
  return Object.freeze({
    kind: "opaque",
    capability,
    payload,
  });
}

function validateDisplayCompileContext(
  context: ExtensionDisplayCompileContext<unknown, unknown, unknown>,
): void {
  for (const [name, value] of Object.entries({
    x: context.box.x,
    y: context.box.y,
    width: context.box.width,
    height: context.box.height,
    frame: context.frame,
    localFrame: context.localFrame,
    sceneFps: context.sceneFps,
  })) {
    if (!Number.isFinite(value)) {
      throw new Error(`Extension display context ${name} must be finite.`);
    }
  }
  if (
    context.box.width < 0 ||
    context.box.height < 0 ||
    context.sceneFps <= 0
  ) {
    throw new Error(
      "Extension display context requires non-negative box dimensions and a positive sceneFps.",
    );
  }
}

function createStandardDisplayBuilder(
  nodeId: string,
  requirements: readonly NormalizedExtensionAssetRequirement[],
  operations: ExtensionStandardDisplayOperation[],
): { output: ExtensionStandardDisplayBuilder; seal(): void } {
  const ids = new Set<string>();
  const allowedAssets = new Set(
    requirements.map((requirement) => requirement.assetId),
  );
  let sealed = false;

  const stableId = (localId: string): string => {
    if (sealed) throw new Error("Extension display builder is already sealed.");
    if (
      typeof localId !== "string" ||
      localId.length === 0 ||
      localId.length > extensionDisplayLimits.maxLocalIdLength ||
      !localDisplayIdPattern.test(localId)
    ) {
      throw new Error(
        `Extension display operation local ids must be namespaced-safe strings of at most ${extensionDisplayLimits.maxLocalIdLength} characters.`,
      );
    }
    if (operations.length >= extensionDisplayLimits.maxOperations) {
      throw new Error(
        `Extension display output exceeds the ${extensionDisplayLimits.maxOperations}-operation budget.`,
      );
    }
    const id = `${nodeId}::${localId}`;
    if (id.length > extensionDisplayLimits.maxStableIdLength) {
      throw new Error(
        `Extension display operation id exceeds ${extensionDisplayLimits.maxStableIdLength} characters.`,
      );
    }
    if (ids.has(id)) {
      throw new Error(
        `Duplicate extension display operation id ${JSON.stringify(id)}.`,
      );
    }
    ids.add(id);
    return id;
  };

  const output: ExtensionStandardDisplayBuilder = {
    get size() {
      return operations.length;
    },
    rect(localId, input) {
      const id = stableId(localId);
      const parsed = parseDisplayInput(rectDisplayInputSchema, input, id);
      operations.push(Object.freeze({ kind: "rect", id, ...parsed }));
    },
    text(localId, input) {
      const id = stableId(localId);
      const parsed = parseDisplayInput(textDisplayInputSchema, input, id);
      operations.push(Object.freeze({ kind: "text", id, ...parsed }));
    },
    image(localId, input) {
      const id = stableId(localId);
      const parsed = parseDisplayInput(imageDisplayInputSchema, input, id);
      if (!allowedAssets.has(parsed.assetId)) {
        throw new Error(
          `Extension display operation ${JSON.stringify(id)} references undeclared asset ${JSON.stringify(parsed.assetId)}. Return it from the extension assets hook first.`,
        );
      }
      operations.push(Object.freeze({ kind: "image", id, ...parsed }));
    },
  };
  Object.freeze(output);

  return {
    output,
    seal() {
      sealed = true;
    },
  };
}

function parseDisplayInput<T>(
  schema: ZodType<T>,
  input: unknown,
  id: string,
): T {
  const parsed = schema.safeParse(input);
  if (!parsed.success) {
    throw new Error(
      `Invalid extension display operation ${JSON.stringify(id)}: ${parsed.error.issues
        .map(
          (issue) => `${issue.path.join(".") || "operation"}: ${issue.message}`,
        )
        .join("; ")}`,
    );
  }
  return parsed.data;
}

function isPromiseLike(value: unknown): value is PromiseLike<unknown> {
  return (
    (typeof value === "object" || typeof value === "function") &&
    value !== null &&
    typeof (value as { then?: unknown }).then === "function"
  );
}

function cloneBoundedDisplayJson(
  value: unknown,
  label: string,
): SceneJsonValue {
  let values = 0;
  const seen = new WeakSet<object>();
  const clone = (entry: unknown, depth: number): SceneJsonValue => {
    values += 1;
    if (values > extensionDisplayLimits.maxPayloadValues) {
      throw new Error(
        `Extension ${label} exceeds ${extensionDisplayLimits.maxPayloadValues} JSON values.`,
      );
    }
    if (depth > extensionDisplayLimits.maxPayloadDepth) {
      throw new Error(
        `Extension ${label} exceeds JSON depth ${extensionDisplayLimits.maxPayloadDepth}.`,
      );
    }
    if (entry === null || typeof entry === "boolean") return entry;
    if (typeof entry === "number") {
      if (!Number.isFinite(entry)) {
        throw new Error(`Extension ${label} contains a non-finite number.`);
      }
      return Object.is(entry, -0) ? 0 : entry;
    }
    if (typeof entry === "string") {
      if (entry.length > extensionDisplayLimits.maxStringLength) {
        throw new Error(
          `Extension ${label} contains a string longer than ${extensionDisplayLimits.maxStringLength} characters.`,
        );
      }
      return entry;
    }
    if (typeof entry !== "object") {
      throw new Error(
        `Extension ${label} must contain plain JSON values only.`,
      );
    }
    if (seen.has(entry)) {
      throw new Error(
        `Extension ${label} must be a JSON tree without cyclic or shared references.`,
      );
    }
    seen.add(entry);
    if (Array.isArray(entry)) {
      if (entry.length + values > extensionDisplayLimits.maxPayloadValues) {
        throw new Error(
          `Extension ${label} exceeds ${extensionDisplayLimits.maxPayloadValues} JSON values.`,
        );
      }
      const keys = Reflect.ownKeys(entry);
      if (
        keys.some((key) => {
          if (key === "length") return false;
          if (typeof key !== "string" || !/^(?:0|[1-9]\d*)$/.test(key)) {
            return true;
          }
          const index = Number(key);
          return !Number.isSafeInteger(index) || index >= entry.length;
        })
      ) {
        throw new Error(
          `Extension ${label} arrays cannot contain symbols or custom properties.`,
        );
      }
      const items: SceneJsonValue[] = [];
      for (let index = 0; index < entry.length; index += 1) {
        if (!Object.hasOwn(entry, index)) {
          throw new Error(`Extension ${label} arrays cannot be sparse.`);
        }
        const descriptor = Object.getOwnPropertyDescriptor(entry, index);
        if (!descriptor || !("value" in descriptor) || !descriptor.enumerable) {
          throw new Error(
            `Extension ${label} arrays must contain ordinary JSON elements.`,
          );
        }
        items.push(clone(descriptor.value, depth + 1));
      }
      Object.freeze(items);
      return items;
    }
    const prototype = Object.getPrototypeOf(entry);
    if (prototype !== Object.prototype && prototype !== null) {
      throw new Error(
        `Extension ${label} must contain plain JSON objects only.`,
      );
    }
    const result: Record<string, SceneJsonValue> = Object.create(null);
    for (const key of Reflect.ownKeys(entry)) {
      if (typeof key !== "string") {
        throw new Error(`Extension ${label} cannot contain symbol keys.`);
      }
      if (key.length > extensionDisplayLimits.maxStringLength) {
        throw new Error(`Extension ${label} contains an oversized object key.`);
      }
      const descriptor = Object.getOwnPropertyDescriptor(entry, key);
      if (!descriptor || !("value" in descriptor) || !descriptor.enumerable) {
        throw new Error(
          `Extension ${label} requires enumerable data properties.`,
        );
      }
      Object.defineProperty(result, key, {
        value: clone(descriptor.value, depth + 1),
        enumerable: true,
        writable: false,
        configurable: false,
      });
    }
    return Object.freeze(result);
  };

  const owned = clone(value, 0);
  assertEncodedDisplaySize(
    owned,
    extensionDisplayLimits.maxPayloadBytes,
    label,
  );
  return owned;
}

function cloneFrozenCompileJson<T>(value: T, label: string): T {
  const ancestors = new Set<object>();
  let values = 0;
  const clone = (entry: unknown, depth: number): unknown => {
    values += 1;
    if (values > 1_000_000 || depth > 256) {
      throw new Error(`Extension ${label} exceeds compile snapshot bounds.`);
    }
    if (
      entry === null ||
      typeof entry === "string" ||
      typeof entry === "boolean"
    ) {
      return entry;
    }
    if (typeof entry === "number") {
      if (!Number.isFinite(entry)) {
        throw new Error(`Extension ${label} requires finite JSON numbers.`);
      }
      return entry;
    }
    if (typeof entry !== "object") {
      throw new Error(`Extension ${label} must contain JSON values only.`);
    }
    if (ancestors.has(entry)) {
      throw new Error(`Extension ${label} cannot contain cycles.`);
    }
    ancestors.add(entry);
    try {
      if (Array.isArray(entry)) {
        const result: unknown[] = [];
        for (const key of Reflect.ownKeys(entry)) {
          if (key === "length") continue;
          if (
            typeof key !== "string" ||
            !/^(0|[1-9]\d*)$/.test(key) ||
            Number(key) >= entry.length
          ) {
            throw new Error(
              `Extension ${label} arrays cannot contain custom properties.`,
            );
          }
        }
        for (let index = 0; index < entry.length; index += 1) {
          if (!Object.hasOwn(entry, index)) {
            throw new Error(`Extension ${label} arrays cannot be sparse.`);
          }
          const descriptor = Object.getOwnPropertyDescriptor(entry, index);
          if (
            !descriptor ||
            !("value" in descriptor) ||
            !descriptor.enumerable
          ) {
            throw new Error(
              `Extension ${label} arrays require ordinary data elements.`,
            );
          }
          result.push(clone(descriptor.value, depth + 1));
        }
        return Object.freeze(result);
      }
      const prototype = Object.getPrototypeOf(entry);
      if (prototype !== Object.prototype && prototype !== null) {
        throw new Error(`Extension ${label} requires plain JSON objects.`);
      }
      const result: Record<string, unknown> = Object.create(null);
      for (const key of Reflect.ownKeys(entry).sort((left, right) =>
        compareCodeUnits(String(left), String(right)),
      )) {
        if (typeof key !== "string") {
          throw new Error(`Extension ${label} cannot contain symbol keys.`);
        }
        const descriptor = Object.getOwnPropertyDescriptor(entry, key);
        if (!descriptor || !("value" in descriptor) || !descriptor.enumerable) {
          throw new Error(
            `Extension ${label} requires enumerable data properties.`,
          );
        }
        Object.defineProperty(result, key, {
          value: clone(descriptor.value, depth + 1),
          enumerable: true,
          writable: false,
          configurable: false,
        });
      }
      return Object.freeze(result);
    } finally {
      ancestors.delete(entry);
    }
  };
  return clone(value, 0) as T;
}

function assertEncodedDisplaySize(
  value: unknown,
  maximum: number,
  label: string,
): void {
  const encoded = new TextEncoder().encode(JSON.stringify(value));
  if (encoded.byteLength > maximum) {
    throw new Error(`Extension ${label} exceeds ${maximum} encoded bytes.`);
  }
}

/** Calls and validates an extension's opt-in resource-reuse identity. */
export function extensionResourceReuseKey<P, ResolvedAssets, PreparedFrame>(
  definition: DojoVideoEngineExtensionDefinition<P, ResolvedAssets, PreparedFrame>,
  context: ExtensionReuseContext<P>,
): string | null {
  if (!definition.reuseKey) return null;
  if (definition.reuseSafety !== "immutable") {
    throw new Error(
      `Extension ${definition.name}@${definition.version} cannot reuse resources without reuseSafety: "immutable".`,
    );
  }
  const value = definition.reuseKey(context);
  if (value === null) return null;
  if (
    typeof value !== "string" ||
    value.trim().length === 0 ||
    value.length > MAX_EXTENSION_REUSE_KEY_LENGTH
  ) {
    throw new Error(
      `Extension ${definition.name}@${definition.version} reuseKey must return null or a non-empty string of at most ${MAX_EXTENSION_REUSE_KEY_LENGTH} characters.`,
    );
  }
  return value;
}

export class ExtensionRegistry {
  readonly #definitions = new Map<string, RegisteredExtensionDefinition>();

  constructor(
    definitions: readonly DojoVideoEngineExtensionDefinition<
      unknown,
      unknown,
      unknown
    >[] = [],
  ) {
    definitions.forEach((definition) =>
      this.register(asRegisteredDefinition(definition)),
    );
  }

  register<P, ResolvedAssets, PreparedFrame>(
    definition: DojoVideoEngineExtensionDefinition<
      P,
      ResolvedAssets,
      PreparedFrame
    >,
  ): this {
    const checked = defineExtension(definition);
    const key = extensionKey(checked.name, checked.version);
    if (this.#definitions.has(key)) {
      throw new Error(`Extension ${key} is already registered.`);
    }
    this.#definitions.set(
      key,
      checked as unknown as RegisteredExtensionDefinition,
    );
    return this;
  }

  list(): RegisteredExtensionDefinition[] {
    return Array.from(this.#definitions.values()).sort(
      (left, right) =>
        compareCodeUnits(left.name, right.name) ||
        compareCodeUnits(left.version, right.version),
    );
  }

  manifests(): ExtensionManifest[] {
    return this.list().map(extensionManifest);
  }

  versions(name: string): string[] {
    return this.list()
      .filter((definition) => definition.name === name)
      .map((definition) => definition.version);
  }

  resolve(
    name: string,
    requiredVersion: string,
  ): RegisteredExtensionDefinition | null {
    const exact = this.#definitions.get(extensionKey(name, requiredVersion));
    if (exact) return exact;

    const compatible = this.list().filter(
      (definition) =>
        definition.name === name &&
        definition.compatibleVersions?.includes(requiredVersion),
    );
    if (compatible.length > 1) {
      throw new Error(
        `Extension ${name}@${requiredVersion} is ambiguously provided by ${compatible
          .map((definition) => definition.version)
          .join(", ")}.`,
      );
    }
    return compatible[0] ?? null;
  }
}

export function createExtensionRegistry(
  definitions: readonly DojoVideoEngineExtensionDefinition<
    unknown,
    unknown,
    unknown
  >[] = [],
): ExtensionRegistry {
  return new ExtensionRegistry(definitions);
}

function asRegisteredDefinition(value: unknown): RegisteredExtensionDefinition {
  if (typeof value !== "object" || value === null) {
    throw new Error("An extension definition must be an object.");
  }
  const candidate = value as Record<string, unknown>;
  const paramsSchema = candidate.paramsSchema as
    | { safeParse?: unknown }
    | undefined;
  if (
    typeof candidate.name !== "string" ||
    typeof candidate.version !== "string" ||
    typeof candidate.renderers !== "object" ||
    candidate.renderers === null ||
    typeof paramsSchema?.safeParse !== "function"
  ) {
    throw new Error(
      "An extension definition requires name, version, paramsSchema, and renderers.",
    );
  }
  return value as RegisteredExtensionDefinition;
}

export type ExtensionPreflightIssue = {
  severity: "error";
  code:
    | "extension_asset_invalid"
    | "extension_asset_missing"
    | "extension_asset_type_mismatch"
    | "extension_display_capability_missing"
    | "extension_display_capability_version_unsupported"
    | "extension_display_realm_unsupported"
    | "extension_display_target_invalid"
    | "extension_display_version_unsupported"
    | "extension_not_installed"
    | "extension_params_invalid"
    | "extension_renderer_unsupported"
    | "extension_version_incompatible"
    | "extension_worker_unsupported";
  nodeId: string;
  extensionName: string;
  message: string;
};

export type ExtensionBackendCapability = Readonly<{
  id: string;
  version: string;
  realms: readonly ExtensionExecutionRealm[];
}>;

export type ExtensionDisplayTarget = Readonly<{
  version: string;
  backendId: string;
  realm: ExtensionExecutionRealm;
  capabilities: readonly ExtensionBackendCapability[];
}>;

export type ExtensionPreflightOptions = Readonly<{
  /** Legacy renderer selection retained unchanged for 1.x callers. */
  renderer?: string;
  worker?: boolean;
  /** Explicit display-list target for standard and opaque contracts. */
  displayTarget?: ExtensionDisplayTarget;
}>;

export type ResolvedExtensionDisplayDecision =
  | Readonly<{ kind: "standard"; version: "1" }>
  | Readonly<{
      kind: "opaque";
      capability: Readonly<{ id: string; version: string }>;
      realm: ExtensionExecutionRealm;
    }>
  | Readonly<{
      kind: "legacy-opaque";
      renderer: string;
      capability: typeof legacyExtensionRendererCapability;
      realm: ExtensionExecutionRealm;
    }>;

export type ResolvedExtensionNode = {
  node: ExtensionSceneNode;
  definition: RegisteredExtensionDefinition;
  params: unknown;
  requirements: NormalizedExtensionAssetRequirement[];
  rendererAdapter: unknown;
  displayDecision: ResolvedExtensionDisplayDecision;
};

export type ExtensionPreflightResult = {
  ok: boolean;
  nodes: ResolvedExtensionNode[];
  issues: ExtensionPreflightIssue[];
};

export function preflightExtensions(
  sceneInput: unknown,
  registry: ExtensionRegistry,
  options: ExtensionPreflightOptions,
): ExtensionPreflightResult {
  const scene = parseScene(sceneInput);
  const issues: ExtensionPreflightIssue[] = [];
  const nodes: ResolvedExtensionNode[] = [];
  const visit = (items: Scene["nodes"]): void => {
    for (const node of items) {
      if (node.type === "extension" && node.extension) {
        const extensionNode = node as ExtensionSceneNode;
        preflightNode(scene, extensionNode, registry, options, nodes, issues);
      }
      visit(node.children ?? []);
    }
  };
  visit(scene.nodes);
  return { ok: issues.length === 0, nodes, issues };
}

function preflightNode(
  scene: Scene,
  node: ExtensionSceneNode,
  registry: ExtensionRegistry,
  options: ExtensionPreflightOptions,
  resolvedNodes: ResolvedExtensionNode[],
  issues: ExtensionPreflightIssue[],
): void {
  const descriptor = node.extension;
  let definition: RegisteredExtensionDefinition | null;
  try {
    definition = registry.resolve(descriptor.name, descriptor.version);
  } catch (error) {
    issues.push(
      issue(
        node,
        "extension_version_incompatible",
        error instanceof Error ? error.message : String(error),
      ),
    );
    return;
  }

  if (!definition) {
    const installedVersions = registry.versions(descriptor.name);
    issues.push(
      issue(
        node,
        installedVersions.length === 0
          ? "extension_not_installed"
          : "extension_version_incompatible",
        installedVersions.length === 0
          ? `Extension ${descriptor.name}@${descriptor.version} is not installed.`
          : `Extension ${descriptor.name}@${descriptor.version} is incompatible with installed version(s): ${installedVersions.join(", ")}.`,
      ),
    );
    return;
  }

  const parsedParams = definition.paramsSchema.safeParse(descriptor.params);
  if (!parsedParams.success) {
    issues.push(
      issue(
        node,
        "extension_params_invalid",
        `Extension ${descriptor.name}@${descriptor.version} params are invalid: ${parsedParams.error.issues
          .map(
            (entry) => `${entry.path.join(".") || "params"}: ${entry.message}`,
          )
          .join("; ")}`,
      ),
    );
    return;
  }

  const realm =
    options.displayTarget?.realm ?? (options.worker ? "worker" : "main");
  if (
    options.displayTarget &&
    options.worker !== undefined &&
    options.worker !== (options.displayTarget.realm === "worker")
  ) {
    issues.push(
      issue(
        node,
        "extension_display_target_invalid",
        "Display target realm conflicts with the legacy worker option.",
      ),
    );
    return;
  }
  if (realm === "worker" && !definition.workerCompatible) {
    issues.push(
      issue(
        node,
        "extension_worker_unsupported",
        `Extension ${descriptor.name}@${definition.version} cannot run in a worker.`,
      ),
    );
    return;
  }

  const resolvedDisplay = resolveExtensionDisplayDecision(
    node,
    definition,
    options,
    realm,
    issues,
  );
  if (!resolvedDisplay) return;

  let requirements: NormalizedExtensionAssetRequirement[] = [];
  try {
    const rawRequirements =
      definition.assets?.({
        scene,
        node,
        params: parsedParams.data,
      }) ?? [];
    const parsedRequirements = z
      .array(extensionAssetRequirementSchema)
      .safeParse(rawRequirements);
    if (!parsedRequirements.success) {
      issues.push(
        issue(
          node,
          "extension_asset_invalid",
          `Extension ${descriptor.name}@${definition.version} returned invalid asset requirements: ${parsedRequirements.error.issues
            .map((entry) => entry.message)
            .join("; ")}`,
        ),
      );
      return;
    }
    requirements = parsedRequirements.data;
  } catch (error) {
    issues.push(
      issue(
        node,
        "extension_asset_invalid",
        `Extension ${descriptor.name}@${definition.version} asset discovery failed: ${error instanceof Error ? error.message : String(error)}`,
      ),
    );
    return;
  }

  for (const requirement of requirements) {
    const asset = scene.assets[requirement.assetId];
    if (!asset && !requirement.optional) {
      issues.push(
        issue(
          node,
          "extension_asset_missing",
          `Extension ${descriptor.name}@${definition.version} requires missing asset "${requirement.assetId}"${requirement.purpose ? ` for ${requirement.purpose}` : ""}.`,
        ),
      );
      continue;
    }
    if (asset && requirement.type && asset.type !== requirement.type) {
      issues.push(
        issue(
          node,
          "extension_asset_type_mismatch",
          `Extension ${descriptor.name}@${definition.version} requires asset "${requirement.assetId}" to be ${requirement.type}, but it is ${asset.type}.`,
        ),
      );
    }
  }
  if (issues.some((entry) => entry.nodeId === node.id)) return;

  resolvedNodes.push({
    node,
    definition,
    params: parsedParams.data,
    requirements,
    rendererAdapter: resolvedDisplay.rendererAdapter,
    displayDecision: resolvedDisplay.displayDecision,
  });
}

function resolveExtensionDisplayDecision(
  node: ExtensionSceneNode,
  definition: RegisteredExtensionDefinition,
  options: ExtensionPreflightOptions,
  realm: ExtensionExecutionRealm,
  issues: ExtensionPreflightIssue[],
): {
  rendererAdapter: unknown;
  displayDecision: ResolvedExtensionDisplayDecision;
} | null {
  const target = options.displayTarget;
  if (!target) {
    if (!options.renderer) {
      issues.push(
        issue(
          node,
          "extension_display_target_invalid",
          "Extension preflight requires either renderer or displayTarget.",
        ),
      );
      return null;
    }
    const rendererAdapter = definition.renderers[options.renderer];
    if (!rendererAdapter) {
      issues.push(
        issue(
          node,
          "extension_renderer_unsupported",
          definition.display
            ? `Extension ${node.extension.name}@${definition.version} uses an explicit display contract; preflight it with displayTarget instead of legacy renderer ${JSON.stringify(options.renderer)}.`
            : `Extension ${node.extension.name}@${definition.version} does not support renderer ${JSON.stringify(options.renderer)}.`,
        ),
      );
      return null;
    }
    return {
      rendererAdapter,
      displayDecision: {
        kind: "legacy-opaque",
        renderer: options.renderer,
        capability: legacyExtensionRendererCapability,
        realm,
      },
    };
  }

  if (target.version !== "1") {
    issues.push(
      issue(
        node,
        "extension_display_version_unsupported",
        `Extension display-list target version ${JSON.stringify(target.version)} is unsupported; this package implements version "1".`,
      ),
    );
    return null;
  }

  if (definition.display?.kind === "standard") {
    return {
      rendererAdapter: undefined,
      displayDecision: { kind: "standard", version: "1" },
    };
  }

  if (definition.display?.kind === "opaque") {
    const required = definition.display.capability;
    if (!required.realms.includes(realm)) {
      issues.push(
        issue(
          node,
          "extension_display_realm_unsupported",
          `Opaque capability ${required.id}@${required.version} does not support the ${realm} realm.`,
        ),
      );
      return null;
    }
    const sameId = target.capabilities.filter(
      (capability) => capability.id === required.id,
    );
    const exact = sameId.find(
      (capability) => capability.version === required.version,
    );
    if (!exact) {
      issues.push(
        issue(
          node,
          sameId.length > 0
            ? "extension_display_capability_version_unsupported"
            : "extension_display_capability_missing",
          sameId.length > 0
            ? `Backend ${target.backendId} does not provide exact opaque capability ${required.id}@${required.version}.`
            : `Backend ${target.backendId} does not provide opaque capability ${required.id}@${required.version}.`,
        ),
      );
      return null;
    }
    if (!exact.realms.includes(realm)) {
      issues.push(
        issue(
          node,
          "extension_display_realm_unsupported",
          `Backend ${target.backendId} capability ${required.id}@${required.version} cannot execute in the ${realm} realm.`,
        ),
      );
      return null;
    }
    return {
      rendererAdapter: undefined,
      displayDecision: {
        kind: "opaque",
        capability: Object.freeze({
          id: required.id,
          version: required.version,
        }),
        realm,
      },
    };
  }

  const rendererAdapter = definition.renderers[target.backendId];
  if (!rendererAdapter) {
    issues.push(
      issue(
        node,
        "extension_renderer_unsupported",
        `Legacy extension ${node.extension.name}@${definition.version} does not support backend ${JSON.stringify(target.backendId)}.`,
      ),
    );
    return null;
  }
  const legacyHandler = target.capabilities.find(
    (capability) =>
      capability.id === legacyExtensionRendererCapability.id &&
      capability.version === legacyExtensionRendererCapability.version,
  );
  if (!legacyHandler) {
    issues.push(
      issue(
        node,
        "extension_display_capability_missing",
        `Backend ${target.backendId} must declare ${legacyExtensionRendererCapability.id}@${legacyExtensionRendererCapability.version} to bridge a legacy extension adapter.`,
      ),
    );
    return null;
  }
  if (!legacyHandler.realms.includes(realm)) {
    issues.push(
      issue(
        node,
        "extension_display_realm_unsupported",
        `Backend ${target.backendId} legacy extension bridge cannot execute in the ${realm} realm.`,
      ),
    );
    return null;
  }
  return {
    rendererAdapter,
    displayDecision: {
      kind: "legacy-opaque",
      renderer: target.backendId,
      capability: legacyExtensionRendererCapability,
      realm,
    },
  };
}

function issue(
  node: ExtensionSceneNode,
  code: ExtensionPreflightIssue["code"],
  message: string,
): ExtensionPreflightIssue {
  return {
    severity: "error",
    code,
    nodeId: node.id,
    extensionName: node.extension.name,
    message,
  };
}

export function extensionKey(name: string, version: string): string {
  return `${name}@${version}`;
}

function compareCodeUnits(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}
