import {
  resolveObjectFitRect,
  type DisplayExtensionCompilationInput,
  type DisplayExtensionOperation,
} from "@motionforge/core";
import {
  compileExtensionDisplay,
  legacyExtensionRendererCapability,
  type ExtensionBackendCapability,
  type ExtensionDisplayBox,
  type ExtensionDisplayTarget,
  type ExtensionExecutionRealm,
  type ExtensionSceneNode,
  type ExtensionStandardDisplayOperation,
  type NormalizedExtensionAssetRequirement,
  type RegisteredExtensionDefinition,
  type ResolvedExtensionDisplayDecision,
} from "@motionforge/extensions";
import {
  colorValueSchema,
  extensionDescriptorSchema,
  type Scene,
  type SceneJsonValue,
} from "@motionforge/schema";

export type Canvas2DExtensionDisplayContext =
  | CanvasRenderingContext2D
  | OffscreenCanvasRenderingContext2D;

/** A decoded image which is both declared and prepared by the host. */
export type Canvas2DExtensionPreparedImage = CanvasImageSource &
  Readonly<{ width: number; height: number }>;

export type Canvas2DOpaqueExtensionOperation = Extract<
  DisplayExtensionOperation,
  { mode: "opaque" }
>;

export type Canvas2DOpaqueExtensionDrawContext = Readonly<{
  /** The context is saved and translated to the extension border-box origin. */
  context: Canvas2DExtensionDisplayContext;
  operation: Canvas2DOpaqueExtensionOperation;
  /** Scene-space bounds, provided even though the context is node-local. */
  box: ExtensionDisplayBox;
  /** Node-local bounds for capability implementations which need a viewport. */
  localBox: Readonly<{ x: 0; y: 0; width: number; height: number }>;
  preparedImages: ReadonlyMap<string, Canvas2DExtensionPreparedImage>;
  /** Native extension resources stay out of the JSON display list. */
  resolvedAssets: unknown;
  /** Native/per-frame extension data stays out of the JSON display list. */
  preparedFrame: unknown;
  realm: ExtensionExecutionRealm;
}>;

export type Canvas2DOpaqueExtensionHandler = Readonly<{
  capability: ExtensionBackendCapability;
  draw(context: Canvas2DOpaqueExtensionDrawContext): void;
}>;

export type Canvas2DOpaqueExtensionRegistry = Readonly<{
  realm: ExtensionExecutionRealm;
  capabilities: readonly ExtensionBackendCapability[];
  displayTarget(backendId?: string): ExtensionDisplayTarget;
  resolveExact(
    capability: Readonly<{ id: string; version: string }>,
  ): Canvas2DOpaqueExtensionHandler;
}>;

/**
 * Builds one realm-specific capability registry. Capabilities are advertised
 * from the same validated entries used for dispatch, so preflight and draw
 * cannot drift apart.
 */
export function createCanvas2DOpaqueExtensionRegistry(options: {
  realm: ExtensionExecutionRealm;
  handlers?: readonly Canvas2DOpaqueExtensionHandler[];
}): Canvas2DOpaqueExtensionRegistry {
  const realm = assertRealm(options.realm);
  const exact = new Map<string, Canvas2DOpaqueExtensionHandler>();
  const versionsById = new Map<string, string[]>();
  const capabilities: ExtensionBackendCapability[] = [];

  for (const handler of options.handlers ?? []) {
    if (
      typeof handler !== "object" ||
      handler === null ||
      typeof handler.draw !== "function"
    ) {
      throw new Error(
        "Canvas2D opaque extension handlers require a capability and draw function.",
      );
    }
    const capability = validateBackendCapability(handler.capability);
    if (
      capability.id === legacyExtensionRendererCapability.id &&
      capability.version === legacyExtensionRendererCapability.version
    ) {
      throw new Error(
        `${legacyExtensionRendererCapability.id}@${legacyExtensionRendererCapability.version} is reserved for the explicit legacy callback bridge.`,
      );
    }
    if (!capability.realms.includes(realm)) {
      throw new Error(
        `Canvas2D opaque capability ${capability.id}@${capability.version} does not support the registry realm ${realm}.`,
      );
    }

    const key = capabilityKey(capability.id, capability.version);
    if (exact.has(key)) {
      throw new Error(
        `Duplicate Canvas2D opaque capability ${capability.id}@${capability.version}.`,
      );
    }
    const ownedHandler = Object.freeze({
      capability,
      draw: handler.draw,
    });
    exact.set(key, ownedHandler);
    capabilities.push(capability);
    const versions = versionsById.get(capability.id) ?? [];
    versions.push(capability.version);
    versionsById.set(capability.id, versions);
  }

  capabilities.sort((left, right) =>
    left.id === right.id
      ? compareCodeUnits(left.version, right.version)
      : compareCodeUnits(left.id, right.id),
  );
  const advertised = Object.freeze([...capabilities]);
  for (const versions of versionsById.values()) versions.sort(compareCodeUnits);

  return Object.freeze({
    realm,
    capabilities: advertised,
    displayTarget(backendId = "canvas2d") {
      if (typeof backendId !== "string" || backendId.trim() === "") {
        throw new Error(
          "Canvas2D display backendId must be a non-empty string.",
        );
      }
      return Object.freeze({
        version: "1",
        backendId,
        realm,
        capabilities: advertised,
      });
    },
    resolveExact(capability) {
      assertCapabilityIdentity(capability);
      const handler = exact.get(
        capabilityKey(capability.id, capability.version),
      );
      if (handler) return handler;
      const versions = versionsById.get(capability.id);
      if (versions?.length) {
        throw new Error(
          `Canvas2D opaque capability ${capability.id}@${capability.version} is not registered for the ${realm} realm; registered version(s): ${versions.join(", ")}.`,
        );
      }
      throw new Error(
        `Canvas2D opaque capability ${capability.id}@${capability.version} is not registered for the ${realm} realm.`,
      );
    },
  });
}

export type ResolvedCanvas2DDisplayExtension = Readonly<{
  definition: RegisteredExtensionDefinition;
  params: unknown;
  requirements: readonly NormalizedExtensionAssetRequirement[];
  resolvedAssets: unknown;
  displayDecision: ResolvedExtensionDisplayDecision;
}>;

export type CompileResolvedCanvas2DDisplayExtensionOptions = Readonly<{
  scene: Scene;
  node: ExtensionSceneNode;
  box: ExtensionDisplayBox;
  runtime: ResolvedCanvas2DDisplayExtension;
  preparedFrame: unknown;
  frame: number;
  localFrame: number;
  sceneFps: number;
}>;

/**
 * Compiles a preflight-resolved portable extension into the neutral core
 * input. Legacy adapters deliberately remain absent so core emits an honest
 * legacy-opaque operation for the caller-owned compatibility callback.
 */
export function compileResolvedCanvas2DDisplayExtension(
  options: CompileResolvedCanvas2DDisplayExtensionOptions,
): DisplayExtensionCompilationInput {
  const { runtime, node } = options;
  if (runtime.displayDecision.kind === "legacy-opaque") {
    throw new Error(
      `Extension node ${JSON.stringify(node.id)} uses a legacy Canvas2D adapter and cannot compile a portable display payload.`,
    );
  }
  if (
    node.type !== "extension" ||
    !node.extension ||
    node.extension.name !== runtime.definition.name
  ) {
    throw new Error(
      `Resolved extension runtime does not match node ${JSON.stringify(node.id)}.`,
    );
  }

  const compilation = compileExtensionDisplay(runtime.definition, {
    scene: options.scene,
    node,
    box: options.box,
    params: runtime.params,
    requirements: runtime.requirements,
    resolvedAssets: runtime.resolvedAssets,
    preparedFrame: options.preparedFrame,
    frame: options.frame,
    localFrame: options.localFrame,
    sceneFps: options.sceneFps,
  } as never);

  if (runtime.displayDecision.kind === "standard") {
    if (compilation.kind !== "standard") {
      throw new Error(
        `Extension node ${JSON.stringify(node.id)} resolved as standard display but compiled an opaque payload.`,
      );
    }
    if (
      runtime.displayDecision.version !== "1" ||
      compilation.version !== runtime.displayDecision.version
    ) {
      throw new Error(
        `Extension node ${JSON.stringify(node.id)} compiled unsupported standard display version ${JSON.stringify(compilation.version)}.`,
      );
    }
    return {
      kind: "standard",
      version: compilation.version,
      operations:
        compilation.operations as unknown as readonly SceneJsonValue[],
    };
  }

  if (compilation.kind !== "opaque") {
    throw new Error(
      `Extension node ${JSON.stringify(node.id)} resolved as opaque display but compiled standard operations.`,
    );
  }
  if (
    compilation.capability.id !== runtime.displayDecision.capability.id ||
    compilation.capability.version !==
      runtime.displayDecision.capability.version
  ) {
    throw new Error(
      `Extension node ${JSON.stringify(node.id)} compiled capability ${compilation.capability.id}@${compilation.capability.version}, but preflight resolved ${runtime.displayDecision.capability.id}@${runtime.displayDecision.capability.version}.`,
    );
  }
  return {
    kind: "opaque",
    capability: compilation.capability,
    payload: compilation.payload,
  };
}

export type Canvas2DLegacyExtensionDrawContext = Readonly<{
  context: Canvas2DExtensionDisplayContext;
  operation: Extract<DisplayExtensionOperation, { mode: "legacy-opaque" }>;
  box: ExtensionDisplayBox;
  preparedImages: ReadonlyMap<string, Canvas2DExtensionPreparedImage>;
}>;

export type ExecuteCanvas2DDisplayExtensionOptions = Readonly<{
  context: Canvas2DExtensionDisplayContext;
  operation: DisplayExtensionOperation;
  /** The extension node's scene-space border box. */
  box: ExtensionDisplayBox;
  /** Only host-declared, decoded images should be exposed through this map. */
  preparedImages?: ReadonlyMap<string, Canvas2DExtensionPreparedImage>;
  /** Supplied separately from the JSON operation for opaque handlers. */
  resolvedAssets?: unknown;
  /** Supplied separately from the JSON operation for opaque handlers. */
  preparedFrame?: unknown;
  opaqueRegistry?: Canvas2DOpaqueExtensionRegistry;
  legacyDraw?: (context: Canvas2DLegacyExtensionDrawContext) => void;
}>;

/** Executes one explicit extension display operation without silent fallback. */
export function executeCanvas2DDisplayExtension(
  options: ExecuteCanvas2DDisplayExtensionOptions,
): void {
  const images = options.preparedImages ?? emptyPreparedImages;
  assertDisplayBox(options.box);

  if (options.operation.mode === "legacy-opaque") {
    if (!options.legacyDraw) {
      throw new Error(
        `Legacy Canvas2D extension ${options.operation.extension.name}@${options.operation.extension.version} has no caller-supplied draw callback.`,
      );
    }
    const result = withSavedContext(options.context, () =>
      options.legacyDraw?.({
        context: options.context,
        operation: options.operation as Extract<
          DisplayExtensionOperation,
          { mode: "legacy-opaque" }
        >,
        box: options.box,
        preparedImages: images,
      }),
    );
    assertSynchronousExtensionDraw(result, "Legacy Canvas2D extension");
    return;
  }

  if (options.operation.mode === "opaque") {
    const registry = options.opaqueRegistry;
    if (!registry) {
      throw new Error(
        `Opaque Canvas2D extension ${options.operation.extension.name}@${options.operation.extension.version} requires capability ${options.operation.capability.id}@${options.operation.capability.version}, but no registry was supplied.`,
      );
    }
    const handler = registry.resolveExact(options.operation.capability);
    const result = withNodeLocalContext(options.context, options.box, () =>
      handler.draw({
        context: options.context,
        operation: options.operation as Canvas2DOpaqueExtensionOperation,
        box: options.box,
        localBox: Object.freeze({
          x: 0,
          y: 0,
          width: options.box.width,
          height: options.box.height,
        }),
        preparedImages: images,
        resolvedAssets: options.resolvedAssets,
        preparedFrame: options.preparedFrame,
        realm: registry.realm,
      }),
    );
    assertSynchronousExtensionDraw(result, "Opaque Canvas2D extension");
    return;
  }

  if (options.operation.mode !== "standard") {
    throw new Error("Unsupported Canvas2D extension display operation mode.");
  }
  if (options.operation.displayVersion !== "1") {
    throw new Error(
      `Canvas2D does not support standard extension display version ${JSON.stringify(options.operation.displayVersion)}.`,
    );
  }

  withNodeLocalContext(options.context, options.box, () => {
    const operation = options.operation as Extract<
      DisplayExtensionOperation,
      { mode: "standard" }
    >;
    for (const raw of operation.operations) {
      const operation = parseStandardOperation(raw);
      drawStandardOperation(options.context, operation, images);
    }
  });
}

function assertSynchronousExtensionDraw(value: unknown, label: string): void {
  if (
    (typeof value === "object" || typeof value === "function") &&
    value !== null &&
    "then" in value &&
    typeof (value as { then?: unknown }).then === "function"
  ) {
    void Promise.resolve(value).catch(() => undefined);
    throw new Error(
      `${label} draw handlers must be synchronous; use prepareFrame() for asynchronous work.`,
    );
  }
}

const emptyPreparedImages = new Map<string, Canvas2DExtensionPreparedImage>();

function drawStandardOperation(
  context: Canvas2DExtensionDisplayContext,
  operation: ExtensionStandardDisplayOperation,
  images: ReadonlyMap<string, Canvas2DExtensionPreparedImage>,
): void {
  withSavedContext(context, () => {
    context.globalAlpha *= operation.opacity ?? 1;
    switch (operation.kind) {
      case "rect": {
        context.beginPath();
        addPortableRoundedRectPath(
          context,
          operation.x,
          operation.y,
          operation.width,
          operation.height,
          operation.radius ?? 0,
        );
        if (operation.fill !== undefined) {
          context.fillStyle = operation.fill;
          context.fill();
        }
        if (
          operation.stroke !== undefined &&
          (operation.strokeWidth ?? 1) > 0
        ) {
          context.strokeStyle = operation.stroke;
          context.lineWidth = operation.strokeWidth ?? 1;
          context.stroke();
        }
        break;
      }
      case "text": {
        context.font = `${operation.fontWeight ?? "normal"} ${operation.fontSize}px ${operation.fontFamily}`;
        context.fillStyle = operation.fill;
        context.textAlign = operation.align ?? "start";
        context.textBaseline = operation.baseline ?? "alphabetic";
        if (operation.maxWidth === undefined) {
          context.fillText(operation.text, operation.x, operation.y);
        } else {
          context.fillText(
            operation.text,
            operation.x,
            operation.y,
            operation.maxWidth,
          );
        }
        break;
      }
      case "image": {
        const image = images.get(operation.assetId);
        if (!image) {
          throw new Error(
            `Standard extension display operation ${JSON.stringify(operation.id)} requires declared prepared image ${JSON.stringify(operation.assetId)}.`,
          );
        }
        if (
          !Number.isFinite(image.width) ||
          !Number.isFinite(image.height) ||
          image.width <= 0 ||
          image.height <= 0
        ) {
          throw new Error(
            `Prepared extension image ${JSON.stringify(operation.assetId)} must have finite positive intrinsic dimensions.`,
          );
        }
        const fitted = resolveObjectFitRect(
          operation.fit ?? "fill",
          "center",
          { width: operation.width, height: operation.height },
          { width: image.width, height: image.height },
        );
        context.beginPath();
        context.rect(
          operation.x,
          operation.y,
          operation.width,
          operation.height,
        );
        context.clip();
        context.drawImage(
          image,
          operation.x + fitted.x,
          operation.y + fitted.y,
          fitted.width,
          fitted.height,
        );
        break;
      }
      default:
        assertNever(operation);
    }
  });
}

/** Avoids relying on the newer context.roundRect() API in worker runtimes. */
function addPortableRoundedRectPath(
  context: Canvas2DExtensionDisplayContext,
  x: number,
  y: number,
  width: number,
  height: number,
  requestedRadius: number,
): void {
  const radius = Math.min(requestedRadius, width / 2, height / 2);
  if (radius <= 0) {
    context.rect(x, y, width, height);
    return;
  }
  context.moveTo(x + radius, y);
  context.lineTo(x + width - radius, y);
  context.quadraticCurveTo(x + width, y, x + width, y + radius);
  context.lineTo(x + width, y + height - radius);
  context.quadraticCurveTo(
    x + width,
    y + height,
    x + width - radius,
    y + height,
  );
  context.lineTo(x + radius, y + height);
  context.quadraticCurveTo(x, y + height, x, y + height - radius);
  context.lineTo(x, y + radius);
  context.quadraticCurveTo(x, y, x + radius, y);
  context.closePath();
}

function parseStandardOperation(
  value: SceneJsonValue,
): ExtensionStandardDisplayOperation {
  if (!isRecord(value) || typeof value.kind !== "string") {
    throw new Error(
      "Canvas2D received an invalid standard extension operation.",
    );
  }
  const id = requiredString(value.id, "standard extension operation id");
  if (value.kind === "rect") {
    return {
      kind: "rect",
      id,
      x: coordinate(value.x, `${id}.x`),
      y: coordinate(value.y, `${id}.y`),
      width: dimension(value.width, `${id}.width`),
      height: dimension(value.height, `${id}.height`),
      ...(optionalNumber(value.opacity, `${id}.opacity`) === undefined
        ? {}
        : { opacity: opacity(value.opacity, `${id}.opacity`) }),
      ...(value.fill === undefined
        ? {}
        : { fill: displayColor(value.fill, `${id}.fill`) }),
      ...(value.stroke === undefined
        ? {}
        : { stroke: displayColor(value.stroke, `${id}.stroke`) }),
      ...(value.strokeWidth === undefined
        ? {}
        : { strokeWidth: dimension(value.strokeWidth, `${id}.strokeWidth`) }),
      ...(value.radius === undefined
        ? {}
        : { radius: dimension(value.radius, `${id}.radius`) }),
    };
  }
  if (value.kind === "text") {
    const align = optionalEnum(
      value.align,
      ["start", "center", "end"],
      `${id}.align`,
    );
    const baseline = optionalEnum(
      value.baseline,
      ["top", "middle", "alphabetic", "bottom"],
      `${id}.baseline`,
    );
    return {
      kind: "text",
      id,
      text: stringValue(value.text, `${id}.text`),
      x: coordinate(value.x, `${id}.x`),
      y: coordinate(value.y, `${id}.y`),
      ...(value.maxWidth === undefined
        ? {}
        : { maxWidth: dimension(value.maxWidth, `${id}.maxWidth`) }),
      fontFamily: requiredString(value.fontFamily, `${id}.fontFamily`),
      fontSize: positiveNumber(value.fontSize, `${id}.fontSize`),
      ...(value.fontWeight === undefined
        ? {}
        : { fontWeight: requiredString(value.fontWeight, `${id}.fontWeight`) }),
      fill: displayColor(value.fill, `${id}.fill`),
      ...(align === undefined ? {} : { align }),
      ...(baseline === undefined ? {} : { baseline }),
      ...(value.opacity === undefined
        ? {}
        : { opacity: opacity(value.opacity, `${id}.opacity`) }),
    };
  }
  if (value.kind === "image") {
    const fit = optionalEnum(
      value.fit,
      ["fill", "contain", "cover", "none", "scale-down"],
      `${id}.fit`,
    );
    return {
      kind: "image",
      id,
      assetId: requiredString(value.assetId, `${id}.assetId`),
      x: coordinate(value.x, `${id}.x`),
      y: coordinate(value.y, `${id}.y`),
      width: dimension(value.width, `${id}.width`),
      height: dimension(value.height, `${id}.height`),
      ...(fit === undefined ? {} : { fit }),
      ...(value.opacity === undefined
        ? {}
        : { opacity: opacity(value.opacity, `${id}.opacity`) }),
    };
  }
  throw new Error(
    `Canvas2D does not support standard extension operation kind ${JSON.stringify(value.kind)} for ${JSON.stringify(id)}.`,
  );
}

function withNodeLocalContext<T>(
  context: Canvas2DExtensionDisplayContext,
  box: ExtensionDisplayBox,
  draw: () => T,
): T {
  return withSavedContext(context, () => {
    context.translate(box.x, box.y);
    return draw();
  });
}

function withSavedContext<T>(
  context: Canvas2DExtensionDisplayContext,
  draw: () => T,
): T {
  context.save();
  try {
    return draw();
  } finally {
    context.restore();
  }
}

function validateBackendCapability(value: unknown): ExtensionBackendCapability {
  if (!isRecord(value)) {
    throw new Error("Canvas2D opaque handler requires a capability object.");
  }
  assertCapabilityIdentity(value);
  if (!Array.isArray(value.realms) || value.realms.length === 0) {
    throw new Error(
      `Canvas2D opaque capability ${value.id}@${value.version} must declare at least one realm.`,
    );
  }
  const realms = value.realms.map(assertRealm);
  if (new Set(realms).size !== realms.length) {
    throw new Error(
      `Canvas2D opaque capability ${value.id}@${value.version} has duplicate realms.`,
    );
  }
  return Object.freeze({
    id: value.id,
    version: value.version,
    realms: Object.freeze(realms),
  });
}

function assertCapabilityIdentity(value: unknown): asserts value is Record<
  string,
  unknown
> & {
  id: string;
  version: string;
} {
  if (!isRecord(value)) {
    throw new Error("Canvas2D opaque capability must be an object.");
  }
  const parsed = extensionDescriptorSchema.safeParse({
    name: value.id,
    version: value.version,
    params: {},
  });
  if (!parsed.success) {
    throw new Error(
      "Canvas2D opaque capabilities require a bounded namespaced id and exact semantic version.",
    );
  }
}

function assertRealm(value: unknown): ExtensionExecutionRealm {
  if (value !== "main" && value !== "worker") {
    throw new Error('Canvas2D extension realm must be "main" or "worker".');
  }
  return value;
}

function assertDisplayBox(box: ExtensionDisplayBox): void {
  for (const [name, value] of Object.entries(box)) {
    if (!Number.isFinite(value)) {
      throw new Error(`Canvas2D extension border box ${name} must be finite.`);
    }
  }
  if (box.width < 0 || box.height < 0) {
    throw new Error(
      "Canvas2D extension border box dimensions must be non-negative.",
    );
  }
}

function capabilityKey(id: string, version: string): string {
  return `${id}\u0000${version}`;
}

function coordinate(value: unknown, label: string): number {
  return finiteNumber(value, label);
}

function dimension(value: unknown, label: string): number {
  const parsed = finiteNumber(value, label);
  if (parsed < 0) throw new Error(`${label} must be non-negative.`);
  return parsed;
}

function positiveNumber(value: unknown, label: string): number {
  const parsed = finiteNumber(value, label);
  if (parsed <= 0) throw new Error(`${label} must be positive.`);
  return parsed;
}

function opacity(value: unknown, label: string): number {
  const parsed = finiteNumber(value, label);
  if (parsed < 0 || parsed > 1) {
    throw new Error(`${label} must be between 0 and 1.`);
  }
  return parsed;
}

function optionalNumber(value: unknown, label: string): number | undefined {
  return value === undefined ? undefined : finiteNumber(value, label);
}

function finiteNumber(value: unknown, label: string): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new Error(`${label} must be finite.`);
  }
  return value;
}

function requiredString(value: unknown, label: string): string {
  const parsed = stringValue(value, label);
  if (parsed.length === 0) throw new Error(`${label} must not be empty.`);
  return parsed;
}

function displayColor(value: unknown, label: string): string {
  const parsed = colorValueSchema.safeParse(value);
  if (!parsed.success) throw new Error(`${label} must be a valid color.`);
  return parsed.data;
}

function stringValue(value: unknown, label: string): string {
  if (typeof value !== "string") throw new Error(`${label} must be a string.`);
  return value;
}

function optionalEnum<const T extends string>(
  value: unknown,
  allowed: readonly T[],
  label: string,
): T | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== "string" || !allowed.includes(value as T)) {
    throw new Error(`${label} is unsupported.`);
  }
  return value as T;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function assertNever(value: never): never {
  throw new Error(
    `Canvas2D does not support standard extension operation ${JSON.stringify(value)}.`,
  );
}

function compareCodeUnits(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}
