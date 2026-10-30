import {
  type Scene,
  type SceneAnimation,
  type SceneAudioBus,
  type SceneAsset,
  type SceneEffectName,
  type SceneEffectParams,
  type SceneDucking,
  type SceneExtensionDescriptor,
  type SceneMaskDescriptor,
  type SceneNode,
  type SceneShapeGeometry,
  type SceneStyle,
  type SceneTextRun,
  type VolumeEnvelope,
  parseScene,
} from "@dojo-video-engine/schema";
import {
  parseColorValue,
  parseEasingValue,
  parseFilterValue,
  parseObjectPositionValue,
  parseTransformOriginValue,
  parseTransformValue,
} from "@dojo-video-engine/schema/values";

export * from "./display-list";

export type CompositionOptions = {
  width: number;
  height: number;
  fps: number;
  duration: number;
};

export type NodeOptions = {
  id?: string;
  from?: number;
  duration?: number;
  style?: SceneStyle;
  assetId?: string;
  clip?: SceneShapeGeometry;
  mask?: SceneMaskDescriptor;
};

export type VideoNodeOptions = NodeOptions & {
  /** Source trim offset in seconds. */
  videoStartTime?: number;
  /** Playback speed multiplier (1 = natural speed). */
  playbackRate?: number;
  /** Gain from 0 to 1 for the clip soundtrack. */
  volume?: number;
  /** Node-local gain curve multiplied by `volume`. */
  volumeEnvelope?: VolumeEnvelope;
  audioBus?: string;
  pan?: number;
  ducks?: SceneDucking;
  videoEndBehavior?: "hold" | "loop";
};

export type AudioNodeOptions = Omit<NodeOptions, "style"> & {
  /** Source trim offset in seconds. */
  audioStartTime?: number;
  /** Gain from 0 (silent) to 1 (natural), default 1. */
  volume?: number;
  /** Node-local gain curve multiplied by `volume`. */
  volumeEnvelope?: VolumeEnvelope;
  /** Wrap source playback through the node's active window. */
  loop?: boolean;
  audioBus?: string;
  pan?: number;
  ducks?: SceneDucking;
};

export type LottieNodeOptions = NodeOptions & {
  /** Playback speed multiplier (1 = natural speed). */
  playbackRate?: number;
};

export type EffectNodeOptions = NodeOptions & {
  /** Bounded effect-specific parameters from the scene contract. */
  params?: SceneEffectParams;
};

export type ExtensionNodeOptions = NodeOptions & {
  /** Trusted host extension identity and JSON-only parameters. */
  extension: SceneExtensionDescriptor;
};

export type ShapeNodeOptions = NodeOptions;

type InternalNodeOptions = NodeOptions & {
  text?: string;
  runs?: SceneTextRun[];
  videoStartTime?: number;
  playbackRate?: number;
  audioStartTime?: number;
  volume?: number;
  volumeEnvelope?: VolumeEnvelope;
  loop?: boolean;
  audioBus?: string;
  pan?: number;
  ducks?: SceneDucking;
  videoEndBehavior?: "hold" | "loop";
  effect?: SceneEffectName;
  params?: SceneEffectParams;
  extension?: SceneExtensionDescriptor;
  shape?: SceneShapeGeometry;
};

type IdCounter = { next: number };

export class SceneBuilder {
  private readonly options: CompositionOptions;
  private readonly assets: Record<string, SceneAsset> = {};
  private readonly childBuilders: NodeBuilder[] = [];
  private readonly markers: Record<string, number> = {};
  private readonly audioBuses: Record<string, SceneAudioBus> = {};

  constructor(options: CompositionOptions) {
    this.options = options;
  }

  asset(asset: SceneAsset): this {
    this.assets[asset.id] = asset;
    return this;
  }

  children(...nodes: NodeBuilder[]): this {
    this.childBuilders.push(...nodes);
    return this;
  }

  marker(name: string, frame: number): this {
    this.markers[name] = frame;
    return this;
  }

  audioBus(name: string, bus: SceneAudioBus): this {
    this.audioBuses[name] = bus;
    return this;
  }

  toJSON(): Scene {
    const counter: IdCounter = { next: 0 };

    return parseScene({
      schemaVersion: 1,
      width: this.options.width,
      height: this.options.height,
      fps: this.options.fps,
      duration: this.options.duration,
      assets: structuredClone(this.assets),
      ...(Object.keys(this.markers).length > 0
        ? {
            markers: Object.fromEntries(
              Object.entries(this.markers).sort(([left], [right]) =>
                left.localeCompare(right),
              ),
            ),
          }
        : {}),
      ...(Object.keys(this.audioBuses).length > 0
        ? { audioBuses: structuredClone(this.audioBuses) }
        : {}),
      nodes: this.childBuilders.map((node) => node.build(counter)),
    });
  }
}

export class NodeBuilder {
  private readonly type: SceneNode["type"];
  private readonly id?: string;
  private readonly text?: string;
  private readonly runs?: SceneTextRun[];
  private readonly assetId?: string;
  private readonly videoStartTime?: number;
  private readonly playbackRate?: number;
  private readonly audioStartTime?: number;
  private readonly volume?: number;
  private readonly volumeEnvelope?: VolumeEnvelope;
  private readonly loop?: boolean;
  private readonly audioBus?: string;
  private readonly pan?: number;
  private readonly ducks?: SceneDucking;
  private readonly videoEndBehavior?: "hold" | "loop";
  private readonly effect?: SceneEffectName;
  private readonly params?: SceneEffectParams;
  private readonly extension?: SceneExtensionDescriptor;
  private readonly shape?: SceneShapeGeometry;
  private readonly clip?: SceneShapeGeometry;
  private readonly mask?: SceneMaskDescriptor;
  private from: number;
  private duration?: number;
  private readonly style: SceneStyle;
  private readonly animations: SceneAnimation[] = [];
  private readonly childBuilders: NodeBuilder[] = [];

  constructor(type: SceneNode["type"], options: InternalNodeOptions = {}) {
    this.type = type;
    this.id = options.id;
    this.text = options.text;
    this.runs = options.runs;
    this.assetId = options.assetId;
    this.videoStartTime = options.videoStartTime;
    this.playbackRate = options.playbackRate;
    this.audioStartTime = options.audioStartTime;
    this.volume = options.volume;
    this.volumeEnvelope = options.volumeEnvelope;
    this.loop = options.loop;
    this.audioBus = options.audioBus;
    this.pan = options.pan;
    this.ducks = options.ducks;
    this.videoEndBehavior = options.videoEndBehavior;
    this.effect = options.effect;
    this.params = options.params;
    this.extension = options.extension;
    this.shape = options.shape;
    this.clip = options.clip;
    this.mask = options.mask;
    this.from = options.from ?? 0;
    this.duration = options.duration;
    this.style = options.style ?? {};
  }

  children(...nodes: NodeBuilder[]): this {
    this.childBuilders.push(...nodes);
    return this;
  }

  at(from: number, duration?: number): this {
    this.from = from;
    this.duration = duration;
    return this;
  }

  animate(animation: SceneAnimation): this;
  animate(
    property: SceneAnimation["property"],
    frames: SceneAnimation["frames"],
    playback?: Pick<SceneAnimation, "repeat" | "yoyo">,
  ): this;
  animate(
    animationOrProperty: SceneAnimation | SceneAnimation["property"],
    frames?: SceneAnimation["frames"],
    playback: Pick<SceneAnimation, "repeat" | "yoyo"> = {},
  ): this {
    const animation: SceneAnimation =
      typeof animationOrProperty === "object"
        ? structuredClone(animationOrProperty)
        : {
            kind: "keyframes",
            property: animationOrProperty,
            frames: structuredClone(frames ?? []),
            ...(playback.repeat === undefined
              ? {}
              : { repeat: playback.repeat }),
            ...(playback.yoyo === undefined ? {} : { yoyo: playback.yoyo }),
          };
    this.animations.push(animation);
    return this;
  }

  toJSON(): SceneNode {
    return this.build({ next: 0 });
  }

  /**
   * Serializes the builder tree. Auto ids are assigned in document order from
   * the shared counter, so the same builder program always emits the same JSON.
   */
  build(counter: IdCounter): SceneNode {
    return structuredClone({
      id: this.id ?? `${this.type}-${counter.next++}`,
      type: this.type,
      text: this.text,
      runs: this.runs,
      assetId: this.assetId,
      videoStartTime: this.videoStartTime,
      playbackRate: this.playbackRate,
      audioStartTime: this.audioStartTime,
      volume: this.volume,
      volumeEnvelope: this.volumeEnvelope,
      loop: this.loop,
      audioBus: this.audioBus,
      pan: this.pan,
      ducks: this.ducks,
      videoEndBehavior: this.videoEndBehavior,
      effect: this.effect,
      params: this.params,
      extension: this.extension,
      shape: this.shape,
      clip: this.clip,
      mask: this.mask,
      from: this.from,
      duration: this.duration,
      style: this.style,
      animations: this.animations,
      children: this.childBuilders.map((child) => child.build(counter)),
    });
  }
}

export function composition(options: CompositionOptions): SceneBuilder {
  return new SceneBuilder(options);
}

export function div(options: NodeOptions = {}): NodeBuilder {
  return new NodeBuilder("div", options);
}

export function text(value: string, options: NodeOptions = {}): NodeBuilder {
  return new NodeBuilder("text", { ...options, text: value });
}

export function richText(
  runs: SceneTextRun[],
  options: NodeOptions = {},
): NodeBuilder {
  return new NodeBuilder("text", { ...options, runs });
}

export function img(assetId: string, options: NodeOptions = {}): NodeBuilder {
  return new NodeBuilder("img", { ...options, assetId });
}

export function video(
  assetId: string,
  options: VideoNodeOptions = {},
): NodeBuilder {
  return new NodeBuilder("video", { ...options, assetId });
}

export function audio(
  assetId: string,
  options: AudioNodeOptions = {},
): NodeBuilder {
  return new NodeBuilder("audio", { ...options, assetId });
}

export function lottie(
  assetId: string,
  options: LottieNodeOptions = {},
): NodeBuilder {
  return new NodeBuilder("lottie", { ...options, assetId });
}

export function effect(
  name: SceneEffectName,
  options: EffectNodeOptions = {},
): NodeBuilder {
  return new NodeBuilder("effect", {
    ...options,
    effect: name,
    params: options.params,
  });
}

export function extension(options: ExtensionNodeOptions): NodeBuilder {
  return new NodeBuilder("extension", options);
}

export function shape(
  geometry: SceneShapeGeometry,
  options: ShapeNodeOptions = {},
): NodeBuilder {
  return new NodeBuilder("shape", { ...options, shape: geometry });
}

export type ResolvedNode = Omit<SceneNode, "children"> & {
  style: SceneStyle;
  /** Frames since this node became active (0 on its first visible frame). */
  localFrame: number;
  children: ResolvedNode[];
};

export type ResolvedScene = Omit<Scene, "nodes"> & {
  frame: number;
  nodes: ResolvedNode[];
};

export function evaluateScene(sceneInput: Scene, frame: number): ResolvedScene {
  const scene = parseScene(sceneInput);
  const clampedFrame = Math.max(0, Math.min(frame, scene.duration - 1));

  return {
    ...scene,
    frame: clampedFrame,
    nodes: scene.nodes.flatMap((node) =>
      evaluateNode(node, clampedFrame, scene.duration),
    ),
  };
}

function evaluateNode(
  node: SceneNode,
  absoluteFrame: number,
  parentDuration: number,
): ResolvedNode[] {
  const from = node.from ?? 0;
  const duration = node.duration ?? parentDuration;
  const localFrame = absoluteFrame - from;

  if (localFrame < 0 || localFrame >= duration) {
    return [];
  }

  const style = { ...(node.style ?? {}) };
  const mask = node.mask ? { ...node.mask } : undefined;

  for (const animation of node.animations ?? []) {
    if (animation.kind === "keyframes") {
      const value = evaluateKeyframes(
        animation.frames,
        resolveAnimationFrame(animation, localFrame),
      );
      if (value !== undefined) {
        if (animation.property === "transform" && typeof value !== "string") {
          continue;
        }

        if (animation.property === "mask.opacity" && mask) {
          mask.opacity = clampNumber(value, 0, 1, mask.opacity ?? 1);
        } else if (animation.property === "mask.feather" && mask) {
          mask.feather = clampNumber(value, 0, 256, mask.feather ?? 0);
        } else if (
          animation.property === "mask.radius" &&
          mask?.shape.kind === "rect"
        ) {
          mask.shape = { ...mask.shape, radius: value };
        } else {
          (style as Record<string, unknown>)[animation.property] = value;
        }
      }
    }
  }

  const children = (node.children ?? []).flatMap((child) =>
    evaluateNode(child, localFrame, duration),
  );

  return [
    {
      ...node,
      style,
      ...(mask ? { mask } : {}),
      localFrame,
      children,
    },
  ];
}

export function resolveAnimationFrame(
  animation: SceneAnimation,
  frame: number,
): number {
  const first = animation.frames[0];
  const last = animation.frames[animation.frames.length - 1];
  if (!first || !last || frame <= first.frame) return frame;
  const span = last.frame - first.frame;
  if (span <= 0) return last.frame;
  const repeat = animation.repeat ?? 0;
  const elapsed = frame - first.frame;
  const cycles = repeat === "infinite" ? Number.POSITIVE_INFINITY : repeat + 1;
  const total = span * cycles;
  if (elapsed >= total) {
    return animation.yoyo && repeat !== "infinite" && repeat % 2 === 1
      ? first.frame
      : last.frame;
  }
  const iteration = Math.floor(elapsed / span);
  const within = elapsed % span;
  return (
    first.frame +
    (animation.yoyo && iteration % 2 === 1 ? span - within : within)
  );
}

function clampNumber(
  value: string | number,
  min: number,
  max: number,
  fallback: number,
): number {
  return typeof value === "number" && Number.isFinite(value)
    ? Math.min(max, Math.max(min, value))
    : fallback;
}

/**
 * Resolves an animated value at a node-local frame. Frames must be in strictly
 * increasing order (the schema enforces this). Numeric values interpolate;
 * string values interpolate when both parse as colors (RGBA space) or as
 * transform lists with matching function sequences; anything else steps.
 */
export function evaluateKeyframes(
  frames: SceneAnimation["frames"],
  frame: number,
): string | number | undefined {
  const first = frames[0];
  const last = frames[frames.length - 1];

  if (!first || !last) {
    return undefined;
  }

  if (frame <= first.frame) {
    return first.value;
  }

  if (frame >= last.frame) {
    return last.value;
  }

  const nextIndex = frames.findIndex((entry) => entry.frame >= frame);
  const next = frames[nextIndex];
  const prev = frames[nextIndex - 1];

  if (!prev || !next) {
    return last.value;
  }

  const span = next.frame - prev.frame;
  const rawT = span === 0 ? 1 : (frame - prev.frame) / span;
  const t = applyEasing(rawT, next.easing ?? "linear");

  if (typeof prev.value === "number" && typeof next.value === "number") {
    return prev.value + (next.value - prev.value) * t;
  }

  if (typeof prev.value === "string" && typeof next.value === "string") {
    const from = parseColor(prev.value);
    const to = parseColor(next.value);

    if (from && to) {
      return mixColors(from, to, t);
    }

    const fromTransform = parseTransform(prev.value);
    const toTransform = parseTransform(next.value);

    if (fromTransform && toTransform) {
      const mixed = mixTransforms(fromTransform, toTransform, t);

      if (mixed !== null) {
        return mixed;
      }
    }

    const fromFilter = parseFilter(prev.value);
    const toFilter = parseFilter(next.value);
    if (fromFilter && toFilter) {
      const mixedFilter = mixFilters(fromFilter, toFilter, t);
      if (mixedFilter !== null) return mixedFilter;
    }
  }

  // Non-interpolatable values step at the next keyframe.
  return frame < next.frame ? prev.value : next.value;
}

export type TransformFunction = {
  name: "translate" | "scale" | "rotate";
  args: Array<{ value: number; unit: "px" | "%" | "deg" | "" }>;
};

export type FilterFunction = {
  name:
    | "brightness"
    | "contrast"
    | "saturate"
    | "grayscale"
    | "sepia"
    | "invert"
    | "opacity"
    | "hue-rotate"
    | "blur";
  value: number;
  unit: "" | "%" | "deg" | "px";
};

export function parseFilter(value: string): FilterFunction[] | null {
  const parsed = parseFilterValue(value);
  return parsed?.kind === "filter-list"
    ? parsed.functions.map((fn) => ({
        name: fn.kind,
        value: fn.value,
        unit: fn.unit,
      }))
    : null;
}

function mixFilters(
  from: FilterFunction[],
  to: FilterFunction[],
  t: number,
): string | null {
  if (from.length !== to.length) return null;
  const parts: string[] = [];
  for (let index = 0; index < from.length; index += 1) {
    const left = from[index];
    const right = to[index];
    if (
      !left ||
      !right ||
      left.name !== right.name ||
      left.unit !== right.unit
    ) {
      return null;
    }
    const value = left.value + (right.value - left.value) * t;
    parts.push(`${left.name}(${formatInterpolatedNumber(value)}${left.unit})`);
  }
  return parts.join(" ");
}

function formatInterpolatedNumber(value: number): string {
  return String(Number(value.toFixed(5)));
}

/**
 * Parses a transform list of translate()/scale()/rotate() into normalized
 * functions: translate gets two length args (unitless = px), scale two
 * unitless args (sy defaults to sx), rotate one deg arg. Returns null for
 * anything that is not purely such a list, which makes the value step.
 */
export function parseTransform(value: string): TransformFunction[] | null {
  const parsed = parseTransformValue(value);
  if (parsed?.kind !== "transform-list") return null;
  return parsed.functions.map((fn): TransformFunction => {
    if (fn.kind === "translate") {
      return { name: "translate", args: [fn.x, fn.y] };
    }
    if (fn.kind === "scale") {
      return {
        name: "scale",
        args: [
          { value: fn.x, unit: "" },
          { value: fn.y, unit: "" },
        ],
      };
    }
    return {
      name: "rotate",
      args: [{ value: fn.degrees, unit: "deg" }],
    };
  });
}

/**
 * Tweens two parsed transform lists. Returns null when the function
 * sequences or units do not match slot-for-slot (mismatches step instead,
 * like CSS between non-interpolable transforms).
 */
function mixTransforms(
  from: TransformFunction[],
  to: TransformFunction[],
  t: number,
): string | null {
  if (from.length !== to.length) {
    return null;
  }

  const parts: string[] = [];

  for (let index = 0; index < from.length; index += 1) {
    const start = from[index];
    const end = to[index];

    if (!start || !end || start.name !== end.name) {
      return null;
    }

    const args: string[] = [];

    for (let slot = 0; slot < start.args.length; slot += 1) {
      const a = start.args[slot];
      const b = end.args[slot];

      if (!a || !b || a.unit !== b.unit) {
        return null;
      }

      args.push(`${a.value + (b.value - a.value) * t}${a.unit}`);
    }

    parts.push(`${start.name}(${args.join(", ")})`);
  }

  return parts.join(" ");
}

export type RgbaColor = { r: number; g: number; b: number; a: number };

/**
 * Parses #rgb/#rgba/#rrggbb/#rrggbbaa hex and rgb()/rgba() color strings.
 * Returns null for anything else (named colors, gradients, hsl, ...), which
 * makes the value step instead of interpolate.
 */
export function parseColor(value: string): RgbaColor | null {
  const parsed = parseColorValue(value);
  return parsed?.kind === "rgba"
    ? {
        r: parsed.red,
        g: parsed.green,
        b: parsed.blue,
        a: parsed.alpha,
      }
    : null;
}

function mixColors(from: RgbaColor, to: RgbaColor, t: number): string {
  const channel = (start: number, end: number): number =>
    Math.round(Math.min(255, Math.max(0, start + (end - start) * t)));
  const alpha = Math.min(1, Math.max(0, from.a + (to.a - from.a) * t));

  return `rgba(${channel(from.r, to.r)}, ${channel(from.g, to.g)}, ${channel(from.b, to.b)}, ${Number(alpha.toFixed(4))})`;
}

export function applyEasing(t: number, easing: string): number {
  switch (easing) {
    case "easeIn":
      return t * t;
    case "easeOut":
      return 1 - (1 - t) * (1 - t);
    case "easeInOut":
      return t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
    case "linear":
      return t;
    default:
      break;
  }

  const parsed = parseEasingValue(easing);
  if (parsed?.kind === "cubic-bezier") {
    return cubicBezierEasing(t, parsed.x1, parsed.y1, parsed.x2, parsed.y2);
  }

  if (parsed?.kind === "spring") {
    return springEasing(t, parsed.bounce);
  }

  // Unknown expressions cannot pass validation; degrade to linear.
  return t;
}

/**
 * CSS cubic-bezier easing with control points (x1, y1) and (x2, y2):
 * solves the curve parameter for x = t (Newton with bisection fallback,
 * fixed iteration counts so the result is deterministic), then samples y.
 */
export function cubicBezierEasing(
  t: number,
  x1: number,
  y1: number,
  x2: number,
  y2: number,
): number {
  if (t <= 0) {
    return 0;
  }

  if (t >= 1) {
    return 1;
  }

  const sample = (a: number, b: number, u: number): number =>
    3 * (1 - u) * (1 - u) * u * a + 3 * (1 - u) * u * u * b + u * u * u;
  const sampleDerivative = (a: number, b: number, u: number): number =>
    3 * (1 - u) * (1 - u) * a + 6 * (1 - u) * u * (b - a) + 3 * u * u * (1 - b);

  let u = t;

  for (let iteration = 0; iteration < 8; iteration += 1) {
    const error = sample(x1, x2, u) - t;
    const slope = sampleDerivative(x1, x2, u);

    if (Math.abs(error) < 1e-7 || Math.abs(slope) < 1e-7) {
      break;
    }

    u = Math.min(1, Math.max(0, u - error / slope));
  }

  if (Math.abs(sample(x1, x2, u) - t) > 1e-7) {
    let lower = 0;
    let upper = 1;

    for (let iteration = 0; iteration < 32; iteration += 1) {
      u = (lower + upper) / 2;

      if (sample(x1, x2, u) < t) {
        lower = u;
      } else {
        upper = u;
      }
    }
  }

  return sample(y1, y2, u);
}

/**
 * Deterministic spring easing. bounce = 0 is critically damped (no
 * overshoot); larger bounce (< 1) overshoots and oscillates before settling
 * at 1. The final keyframe value is exact because the evaluator returns it
 * directly at and beyond the last frame.
 */
export function springEasing(t: number, bounce = 0.25): number {
  if (t <= 0) {
    return 0;
  }

  if (t >= 1) {
    return 1;
  }

  if (bounce <= 0) {
    const damping = 10;
    return 1 - (1 + damping * t) * Math.exp(-damping * t);
  }

  const damping = 10 * (1 - bounce);
  const frequency = Math.PI * (2 + 4 * bounce);
  return 1 - Math.exp(-damping * t) * Math.cos(frequency * t);
}

export type LayoutRect = {
  x: number;
  y: number;
  width: number;
  height: number;
};

export type LayoutCornerRadii = {
  topLeft: number;
  topRight: number;
  bottomRight: number;
  bottomLeft: number;
};

export function normalizeLayoutCornerRadii(
  radius: number | LayoutCornerRadii,
  width: number,
  height: number,
): LayoutCornerRadii {
  const raw =
    typeof radius === "number"
      ? {
          topLeft: radius,
          topRight: radius,
          bottomRight: radius,
          bottomLeft: radius,
        }
      : radius;
  const nonnegative = {
    topLeft: Math.max(0, raw.topLeft),
    topRight: Math.max(0, raw.topRight),
    bottomRight: Math.max(0, raw.bottomRight),
    bottomLeft: Math.max(0, raw.bottomLeft),
  };
  const scale = Math.min(
    1,
    Math.abs(width) / Math.max(1, nonnegative.topLeft + nonnegative.topRight),
    Math.abs(width) /
      Math.max(1, nonnegative.bottomLeft + nonnegative.bottomRight),
    Math.abs(height) /
      Math.max(1, nonnegative.topLeft + nonnegative.bottomLeft),
    Math.abs(height) /
      Math.max(1, nonnegative.topRight + nonnegative.bottomRight),
  );
  return {
    topLeft: nonnegative.topLeft * scale,
    topRight: nonnegative.topRight * scale,
    bottomRight: nonnegative.bottomRight * scale,
    bottomLeft: nonnegative.bottomLeft * scale,
  };
}

/** Resolves the same per-corner radii used by Canvas overflow clipping. */
export function resolveLayoutCornerRadii(
  style: Pick<
    SceneStyle,
    | "borderRadius"
    | "borderTopLeftRadius"
    | "borderTopRightRadius"
    | "borderBottomRightRadius"
    | "borderBottomLeftRadius"
  >,
  box: Pick<LayoutRect, "width" | "height">,
): LayoutCornerRadii {
  const reference = Math.min(box.width, box.height);
  const radius = readLength(style.borderRadius, reference, 0);
  return normalizeLayoutCornerRadii(
    {
      topLeft: readLength(style.borderTopLeftRadius, reference, radius),
      topRight: readLength(style.borderTopRightRadius, reference, radius),
      bottomRight: readLength(style.borderBottomRightRadius, reference, radius),
      bottomLeft: readLength(style.borderBottomLeftRadius, reference, radius),
    },
    box.width,
    box.height,
  );
}

/** Circular corner containment used by renderer-neutral geometry inspection. */
export function pointInRoundedLayoutRect(
  point: { x: number; y: number },
  rect: LayoutRect,
  radii: LayoutCornerRadii,
): boolean {
  if (
    point.x < rect.x ||
    point.y < rect.y ||
    point.x > rect.x + rect.width ||
    point.y > rect.y + rect.height
  ) {
    return false;
  }
  const corners = [
    {
      radius: radii.topLeft,
      applies:
        point.x < rect.x + radii.topLeft && point.y < rect.y + radii.topLeft,
      centerX: rect.x + radii.topLeft,
      centerY: rect.y + radii.topLeft,
    },
    {
      radius: radii.topRight,
      applies:
        point.x > rect.x + rect.width - radii.topRight &&
        point.y < rect.y + radii.topRight,
      centerX: rect.x + rect.width - radii.topRight,
      centerY: rect.y + radii.topRight,
    },
    {
      radius: radii.bottomRight,
      applies:
        point.x > rect.x + rect.width - radii.bottomRight &&
        point.y > rect.y + rect.height - radii.bottomRight,
      centerX: rect.x + rect.width - radii.bottomRight,
      centerY: rect.y + rect.height - radii.bottomRight,
    },
    {
      radius: radii.bottomLeft,
      applies:
        point.x < rect.x + radii.bottomLeft &&
        point.y > rect.y + rect.height - radii.bottomLeft,
      centerX: rect.x + radii.bottomLeft,
      centerY: rect.y + rect.height - radii.bottomLeft,
    },
  ];
  for (const corner of corners) {
    if (!corner.applies || corner.radius <= 0) continue;
    const dx = point.x - corner.centerX;
    const dy = point.y - corner.centerY;
    return dx * dx + dy * dy <= corner.radius * corner.radius;
  }
  return true;
}

/** A renderer-neutral 2D affine transform using the Canvas/CSS matrix order. */
export type AffineMatrix2D = {
  a: number;
  b: number;
  c: number;
  d: number;
  e: number;
  f: number;
};

export const identityAffineMatrix = (): AffineMatrix2D => ({
  a: 1,
  b: 0,
  c: 0,
  d: 1,
  e: 0,
  f: 0,
});

export function multiplyAffineMatrices(
  left: AffineMatrix2D,
  right: AffineMatrix2D,
): AffineMatrix2D {
  return {
    a: left.a * right.a + left.c * right.b,
    b: left.b * right.a + left.d * right.b,
    c: left.a * right.c + left.c * right.d,
    d: left.b * right.c + left.d * right.d,
    e: left.a * right.e + left.c * right.f + left.e,
    f: left.b * right.e + left.d * right.f + left.f,
  };
}

export function transformLayoutPoint(
  matrix: AffineMatrix2D,
  point: { x: number; y: number },
): { x: number; y: number } {
  return {
    x: matrix.a * point.x + matrix.c * point.y + matrix.e,
    y: matrix.b * point.x + matrix.d * point.y + matrix.f,
  };
}

export function invertAffineMatrix(
  matrix: AffineMatrix2D,
): AffineMatrix2D | null {
  const determinant = matrix.a * matrix.d - matrix.b * matrix.c;
  if (Math.abs(determinant) < 1e-12) return null;
  return {
    a: matrix.d / determinant,
    b: -matrix.b / determinant,
    c: -matrix.c / determinant,
    d: matrix.a / determinant,
    e: (matrix.c * matrix.f - matrix.d * matrix.e) / determinant,
    f: (matrix.b * matrix.e - matrix.a * matrix.f) / determinant,
  };
}

export function transformLayoutRect(
  matrix: AffineMatrix2D,
  rect: LayoutRect,
): LayoutRect {
  const points = [
    transformLayoutPoint(matrix, { x: rect.x, y: rect.y }),
    transformLayoutPoint(matrix, { x: rect.x + rect.width, y: rect.y }),
    transformLayoutPoint(matrix, {
      x: rect.x + rect.width,
      y: rect.y + rect.height,
    }),
    transformLayoutPoint(matrix, { x: rect.x, y: rect.y + rect.height }),
  ];
  const xs = points.map((point) => point.x);
  const ys = points.map((point) => point.y);
  return {
    x: Math.min(...xs),
    y: Math.min(...ys),
    width: Math.max(...xs) - Math.min(...xs),
    height: Math.max(...ys) - Math.min(...ys),
  };
}

/**
 * Resolves a node's transform into an absolute-coordinate affine matrix.
 * The operation order matches Canvas2D and DojoVideoEngine's CSS-like transform
 * list, so inspection and rendering can share the same geometry semantics.
 */
export function resolveStyleTransformMatrix(
  style: Pick<SceneStyle, "transform" | "transformOrigin">,
  box: LayoutRect,
): AffineMatrix2D {
  if (typeof style.transform !== "string") return identityAffineMatrix();

  const origin = parseTransformOriginValue(style.transformOrigin ?? "center");
  type OriginPart = NonNullable<typeof origin>["x"];
  const resolveOrigin = (
    part: OriginPart | undefined,
    size: number,
  ): number => {
    if (!part) return size / 2;
    if (part.kind === "length") {
      return part.value.unit === "%"
        ? (part.value.value / 100) * size
        : part.value.value;
    }
    if (part.value === "left" || part.value === "top") return 0;
    if (part.value === "right" || part.value === "bottom") return size;
    return size / 2;
  };

  const translate = (x: number, y: number): AffineMatrix2D => ({
    a: 1,
    b: 0,
    c: 0,
    d: 1,
    e: x,
    f: y,
  });
  const scale = (x: number, y: number): AffineMatrix2D => ({
    a: x,
    b: 0,
    c: 0,
    d: y,
    e: 0,
    f: 0,
  });
  const rotate = (degrees: number): AffineMatrix2D => {
    const radians = (degrees * Math.PI) / 180;
    return {
      a: Math.cos(radians),
      b: Math.sin(radians),
      c: -Math.sin(radians),
      d: Math.cos(radians),
      e: 0,
      f: 0,
    };
  };

  const originX = box.x + resolveOrigin(origin?.x, box.width);
  const originY = box.y + resolveOrigin(origin?.y, box.height);
  let matrix = translate(originX, originY);
  const parsed = parseTransformValue(style.transform);
  if (parsed?.kind === "transform-list") {
    for (const fn of parsed.functions) {
      if (fn.kind === "translate") {
        matrix = multiplyAffineMatrices(
          matrix,
          translate(
            fn.x.unit === "%" ? (fn.x.value / 100) * box.width : fn.x.value,
            fn.y.unit === "%" ? (fn.y.value / 100) * box.height : fn.y.value,
          ),
        );
      } else if (fn.kind === "scale") {
        matrix = multiplyAffineMatrices(matrix, scale(fn.x, fn.y));
      } else {
        matrix = multiplyAffineMatrices(matrix, rotate(fn.degrees));
      }
    }
  }
  return multiplyAffineMatrices(matrix, translate(-originX, -originY));
}

/** Geometry for object-fit/object-position, relative to the containing box. */
export function resolveObjectFitRect(
  fit: SceneStyle["objectFit"],
  position: string | undefined,
  box: Pick<LayoutRect, "width" | "height">,
  natural: Pick<LayoutRect, "width" | "height">,
): LayoutRect {
  const containScale =
    natural.width > 0 && natural.height > 0
      ? Math.min(box.width / natural.width, box.height / natural.height)
      : 1;
  const coverScale =
    natural.width > 0 && natural.height > 0
      ? Math.max(box.width / natural.width, box.height / natural.height)
      : 1;
  let width = box.width;
  let height = box.height;
  if (fit === "contain") {
    width = natural.width * containScale;
    height = natural.height * containScale;
  } else if (fit === "cover") {
    width = natural.width * coverScale;
    height = natural.height * coverScale;
  } else if (fit === "none") {
    width = natural.width;
    height = natural.height;
  } else if (fit === "scale-down") {
    const scale = Math.min(1, containScale);
    width = natural.width * scale;
    height = natural.height * scale;
  }

  const parsed =
    parseObjectPositionValue(position ?? "center") ??
    parseObjectPositionValue("center");
  if (!parsed) {
    throw new Error(
      "DojoVideoEngine internal error: center object position failed to parse.",
    );
  }
  type PositionPart = typeof parsed.x;
  const resolvePosition = (
    part: PositionPart,
    boxSize: number,
    drawnSize: number,
  ): number => {
    if (part.kind === "length") {
      return part.value.unit === "%"
        ? (boxSize - drawnSize) * (part.value.value / 100)
        : part.value.value;
    }
    if (part.value === "left" || part.value === "top") return 0;
    if (part.value === "right" || part.value === "bottom") {
      return boxSize - drawnSize;
    }
    return (boxSize - drawnSize) / 2;
  };
  return {
    x: resolvePosition(parsed.x, box.width, width),
    y: resolvePosition(parsed.y, box.height, height),
    width,
    height,
  };
}

export type LayoutBox = LayoutRect & {
  id: string;
  /**
   * Inner content rectangle after resolved padding. `layoutScene()` always
   * supplies it; optionality preserves source compatibility for consumers
   * that construct LayoutBox fixtures directly.
   */
  content?: LayoutRect;
  node: ResolvedNode;
  children: LayoutBox[];
};

/** Returns the resolved content rectangle, with a 1.x fixture fallback. */
export function getLayoutContentRect(box: LayoutBox): LayoutRect {
  return (
    box.content ?? {
      x: box.x,
      y: box.y,
      width: box.width,
      height: box.height,
    }
  );
}

export type LayoutScene = Omit<ResolvedScene, "nodes"> & {
  boxes: LayoutBox[];
};

/** Provenance attached to renderer-neutral intrinsic measurements. */
export type MeasurementQuality = "exact" | "declared" | "estimated";

export type MeasurementProvenance = {
  measurement: MeasurementQuality;
  /** Required for declared/estimated values; optional exact reasons are normalized. */
  reason?: string;
};

export type ResolvedMeasurementProvenance = {
  measurement: MeasurementQuality;
  reason: string;
};

export type TextLineMetricsInput = {
  nodeId: string;
  text: string;
  style: SceneStyle;
  fontSize: number;
};

export type TextMetricField = "width" | "ascent" | "descent";

/**
 * Synchronous text metrics supplied after fonts are prepared. The legacy
 * aggregate measurement/reason fields remain supported; fieldMeasurements
 * lets a provider qualify width and vertical metrics independently.
 */
export type TextLineMetrics = {
  width: number;
  ascent?: number;
  descent?: number;
  measurement?: MeasurementQuality;
  reason?: string;
  fieldMeasurements?: Partial<Record<TextMetricField, MeasurementProvenance>>;
};

export interface TextMetricsProvider {
  measureLine(input: TextLineMetricsInput): TextLineMetrics;
}

export type ResolvedTextLineMetrics = Omit<
  TextLineMetrics,
  "measurement" | "reason" | "fieldMeasurements"
> & {
  measurement: MeasurementQuality;
  reason: string;
  fieldMeasurements: {
    width: ResolvedMeasurementProvenance;
    ascent?: ResolvedMeasurementProvenance;
    descent?: ResolvedMeasurementProvenance;
  };
};

export type MediaMetricField =
  | "width"
  | "height"
  | "durationSeconds"
  | "frameRate";

/**
 * Intrinsic technical media metrics. Providers are synchronous views over
 * already-prepared resources; they must never fetch or decode on demand.
 */
export type MediaMetrics = {
  width?: number;
  height?: number;
  durationSeconds?: number;
  frameRate?: { numerator: number; denominator: number };
  measurement?: MeasurementQuality;
  reason?: string;
  fieldMeasurements?: Partial<Record<MediaMetricField, MeasurementProvenance>>;
};

export interface MediaMetricsProvider {
  measure(asset: SceneAsset): MediaMetrics | undefined;
}

export type ResolvedMediaMetrics = Omit<
  MediaMetrics,
  "measurement" | "reason" | "fieldMeasurements"
> & {
  measurement: MeasurementQuality;
  reason: string;
  fieldMeasurements: Partial<
    Record<MediaMetricField, ResolvedMeasurementProvenance>
  >;
};

const measurementRank: Record<MeasurementQuality, number> = {
  exact: 0,
  declared: 1,
  estimated: 2,
};

export function worstMeasurementQuality(
  ...qualities: MeasurementQuality[]
): MeasurementQuality {
  qualities.forEach(validateMeasurementQuality);
  return qualities.reduce<MeasurementQuality>(
    (worst, quality) =>
      measurementRank[quality] > measurementRank[worst] ? quality : worst,
    "exact",
  );
}

/** Validates and normalizes one provider result or the portable heuristic. */
export function resolveTextLineMetrics(
  input: TextLineMetricsInput,
  provider?: TextMetricsProvider,
): ResolvedTextLineMetrics {
  validateTextMetricsInput(input);
  const supplied = provider?.measureLine(frozenMetricClone(input));
  if (supplied === undefined) {
    const reason = "portable average-glyph heuristic";
    const provenance: ResolvedMeasurementProvenance = {
      measurement: "estimated",
      reason,
    };
    return {
      width: input.text.length * input.fontSize * 0.58,
      ascent: input.fontSize * 0.8,
      descent: input.fontSize * 0.2,
      measurement: "estimated",
      reason,
      fieldMeasurements: {
        width: { ...provenance },
        ascent: { ...provenance },
        descent: { ...provenance },
      },
    };
  }
  return normalizeProviderTextMetrics(input, supplied);
}

function validateTextMetricsInput(input: TextLineMetricsInput): void {
  if (!Number.isFinite(input.fontSize) || input.fontSize < 0) {
    throw new TypeError(
      `Text metrics fontSize must be finite and non-negative for node ${JSON.stringify(input.nodeId)}.`,
    );
  }
}

/**
 * Merges exact prepared metrics with declared Scene metadata field-by-field.
 * A partial provider therefore cannot hide a declared duration or frame rate.
 */
export function resolveMediaMetrics(
  asset: SceneAsset,
  provider?: MediaMetricsProvider,
): ResolvedMediaMetrics {
  const supplied = provider?.measure(frozenMetricClone(asset));
  const normalized = supplied
    ? normalizeProviderMediaMetrics(asset, supplied)
    : undefined;
  const fields: ResolvedMediaMetrics["fieldMeasurements"] = {
    ...(normalized?.fieldMeasurements ?? {}),
  };
  const result: ResolvedMediaMetrics = {
    ...(normalized?.width !== undefined ? { width: normalized.width } : {}),
    ...(normalized?.height !== undefined ? { height: normalized.height } : {}),
    ...(normalized?.durationSeconds !== undefined
      ? { durationSeconds: normalized.durationSeconds }
      : {}),
    ...(normalized?.frameRate !== undefined
      ? { frameRate: cloneMetricValue(normalized.frameRate) }
      : {}),
    measurement: "estimated",
    reason: "intrinsic media metrics unavailable",
    fieldMeasurements: fields,
  };
  const declared = asset.metadata;
  const addDeclared = <K extends MediaMetricField>(
    key: K,
    value: ResolvedMediaMetrics[K] | undefined,
  ): void => {
    if (value === undefined) return;
    const current = fields[key];
    if (
      result[key] !== undefined &&
      current !== undefined &&
      current.measurement !== "estimated"
    ) {
      return;
    }
    (result as Record<string, unknown>)[key] = cloneMetricValue(value);
    fields[key] = {
      measurement: "declared",
      reason: "Scene asset metadata",
    };
  };
  addDeclared("width", declared?.width);
  addDeclared("height", declared?.height);
  addDeclared("durationSeconds", declared?.duration);
  addDeclared("frameRate", declared?.frameRate);
  const provenance = Object.values(fields);
  if (provenance.length > 0) {
    result.measurement = worstMeasurementQuality(
      ...provenance.map((entry) => entry.measurement),
    );
    result.reason = joinedMeasurementReasons(provenance, result.measurement);
  }
  return result;
}

function normalizeProviderTextMetrics(
  input: TextLineMetricsInput,
  supplied: TextLineMetrics,
): ResolvedTextLineMetrics {
  if (typeof supplied.width !== "number") {
    throw new TypeError(
      `TextMetricsProvider returned invalid width for node ${JSON.stringify(input.nodeId)}.`,
    );
  }
  const aggregate = normalizeProviderProvenance(
    supplied.measurement,
    supplied.reason,
    "host text metrics provider",
  );
  const fields = validateFieldMeasurementKeys(
    supplied.fieldMeasurements,
    ["width", "ascent", "descent"],
    "TextMetricsProvider",
  );
  for (const [name, value] of [
    ["width", supplied.width],
    ["ascent", supplied.ascent],
    ["descent", supplied.descent],
  ] as const) {
    if (value !== undefined && (!Number.isFinite(value) || value < 0)) {
      throw new TypeError(
        `TextMetricsProvider returned invalid ${name} for node ${JSON.stringify(input.nodeId)}.`,
      );
    }
  }
  const fieldMeasurements: ResolvedTextLineMetrics["fieldMeasurements"] = {
    width: normalizeFieldProvenance(
      fields.width,
      aggregate,
      `TextMetricsProvider width for node ${JSON.stringify(input.nodeId)}`,
    ),
  };
  if (supplied.ascent !== undefined) {
    fieldMeasurements.ascent = normalizeFieldProvenance(
      fields.ascent,
      aggregate,
      `TextMetricsProvider ascent for node ${JSON.stringify(input.nodeId)}`,
    );
  } else if (fields.ascent) {
    throw new TypeError(
      `TextMetricsProvider supplied ascent provenance without an ascent value for node ${JSON.stringify(input.nodeId)}.`,
    );
  }
  if (supplied.descent !== undefined) {
    fieldMeasurements.descent = normalizeFieldProvenance(
      fields.descent,
      aggregate,
      `TextMetricsProvider descent for node ${JSON.stringify(input.nodeId)}`,
    );
  } else if (fields.descent) {
    throw new TypeError(
      `TextMetricsProvider supplied descent provenance without a descent value for node ${JSON.stringify(input.nodeId)}.`,
    );
  }
  const provenance = Object.values(fieldMeasurements);
  const measurement = worstMeasurementQuality(
    ...provenance.map((entry) => entry.measurement),
  );
  return {
    width: supplied.width,
    ...(supplied.ascent !== undefined ? { ascent: supplied.ascent } : {}),
    ...(supplied.descent !== undefined ? { descent: supplied.descent } : {}),
    measurement,
    reason: joinedMeasurementReasons(provenance, measurement),
    fieldMeasurements,
  };
}

function normalizeProviderMediaMetrics(
  asset: SceneAsset,
  supplied: MediaMetrics,
): ResolvedMediaMetrics {
  const aggregate = normalizeProviderProvenance(
    supplied.measurement,
    supplied.reason,
    "host media metrics provider",
  );
  const providedFields = validateFieldMeasurementKeys(
    supplied.fieldMeasurements,
    ["width", "height", "durationSeconds", "frameRate"],
    "MediaMetricsProvider",
  );
  for (const [name, value] of [
    ["width", supplied.width],
    ["height", supplied.height],
    ["durationSeconds", supplied.durationSeconds],
  ] as const) {
    if (value !== undefined && (!Number.isFinite(value) || value <= 0)) {
      throw new TypeError(
        `MediaMetricsProvider returned invalid ${name} for asset ${JSON.stringify(asset.id)}.`,
      );
    }
  }
  if (supplied.frameRate !== undefined) {
    validateFrameRate(supplied.frameRate, asset.id, "MediaMetricsProvider");
  }
  const result: ResolvedMediaMetrics = {
    ...(supplied.width !== undefined ? { width: supplied.width } : {}),
    ...(supplied.height !== undefined ? { height: supplied.height } : {}),
    ...(supplied.durationSeconds !== undefined
      ? { durationSeconds: supplied.durationSeconds }
      : {}),
    ...(supplied.frameRate !== undefined
      ? { frameRate: cloneMetricValue(supplied.frameRate) }
      : {}),
    measurement: "estimated",
    reason: "intrinsic media metrics unavailable",
    fieldMeasurements: {},
  };
  for (const key of [
    "width",
    "height",
    "durationSeconds",
    "frameRate",
  ] as const) {
    if (result[key] !== undefined) {
      result.fieldMeasurements[key] = normalizeFieldProvenance(
        providedFields[key],
        aggregate,
        `MediaMetricsProvider ${key} for asset ${JSON.stringify(asset.id)}`,
      );
    } else if (providedFields[key]) {
      throw new TypeError(
        `MediaMetricsProvider supplied ${key} provenance without a ${key} value for asset ${JSON.stringify(asset.id)}.`,
      );
    }
  }
  const provenance = Object.values(result.fieldMeasurements);
  if (provenance.length > 0) {
    result.measurement = worstMeasurementQuality(
      ...provenance.map((entry) => entry.measurement),
    );
    result.reason = joinedMeasurementReasons(provenance, result.measurement);
  }
  return result;
}

function normalizeProviderProvenance(
  measurement: MeasurementQuality | undefined,
  reason: string | undefined,
  fallbackReason: string,
): ResolvedMeasurementProvenance {
  const quality = measurement ?? "exact";
  validateMeasurementQuality(quality);
  const normalizedReason =
    typeof reason === "string" && reason.trim() !== "" ? reason : undefined;
  if (quality !== "exact" && !normalizedReason) {
    throw new TypeError(
      `Metrics provider must explain ${quality} measurements.`,
    );
  }
  return { measurement: quality, reason: normalizedReason ?? fallbackReason };
}

function normalizeFieldProvenance(
  field: MeasurementProvenance | undefined,
  aggregate: ResolvedMeasurementProvenance,
  fallbackReason: string,
): ResolvedMeasurementProvenance {
  if (!field) return { ...aggregate };
  validateMeasurementQuality(field.measurement);
  const fieldReason =
    typeof field.reason === "string" && field.reason.trim() !== ""
      ? field.reason
      : undefined;
  const reason =
    fieldReason ??
    (field.measurement === aggregate.measurement
      ? aggregate.reason
      : undefined);
  if (field.measurement !== "exact" && !reason) {
    throw new TypeError(
      `Metrics provider must explain ${field.measurement} field measurements.`,
    );
  }
  return {
    measurement: field.measurement,
    reason: reason ?? fallbackReason,
  };
}

function validateMeasurementQuality(
  value: unknown,
): asserts value is MeasurementQuality {
  if (value !== "exact" && value !== "declared" && value !== "estimated") {
    throw new TypeError(
      `Metrics provider returned invalid measurement label ${JSON.stringify(value)}.`,
    );
  }
}

function validateFieldMeasurementKeys<K extends string>(
  value: Partial<Record<K, MeasurementProvenance>> | undefined,
  allowed: readonly K[],
  provider: string,
): Partial<Record<K, MeasurementProvenance>> {
  if (!value) return {};
  const allowedSet = new Set<string>(allowed);
  for (const key of Object.keys(value)) {
    if (!allowedSet.has(key)) {
      throw new TypeError(
        `${provider} returned unknown field provenance ${JSON.stringify(key)}.`,
      );
    }
  }
  return value;
}

function joinedMeasurementReasons(
  provenance: ResolvedMeasurementProvenance[],
  quality: MeasurementQuality,
): string {
  return Array.from(
    new Set(
      provenance
        .filter((entry) => entry.measurement === quality)
        .map((entry) => entry.reason),
    ),
  ).join("; ");
}

function validateFrameRate(
  value: { numerator: number; denominator: number },
  assetId: string,
  provider: string,
): void {
  if (
    !Number.isInteger(value.numerator) ||
    value.numerator <= 0 ||
    !Number.isInteger(value.denominator) ||
    value.denominator <= 0
  ) {
    throw new TypeError(
      `${provider} returned invalid frameRate for asset ${JSON.stringify(assetId)}.`,
    );
  }
}

export type MetricsProviderCacheOptions = { maxEntries?: number };
export type MetricsProviderCacheStats = {
  entries: number;
  maxEntries: number;
  hits: number;
  misses: number;
};

export type BoundedTextMetricsProvider = TextMetricsProvider & {
  clearCache(): void;
  cacheStats(): MetricsProviderCacheStats;
};

export type BoundedMediaMetricsProvider = MediaMetricsProvider & {
  clearCache(): void;
  cacheStats(): MetricsProviderCacheStats;
};

/** Bounded LRU wrapper. One wrapper owns one provider, preventing cache bleed. */
export function createBoundedTextMetricsProvider(
  provider: TextMetricsProvider,
  options: MetricsProviderCacheOptions = {},
): BoundedTextMetricsProvider {
  const cache = new MetricsLru<TextLineMetrics>(
    checkedMetricsCacheSize(options.maxEntries, 2048),
  );
  return {
    measureLine(input) {
      validateTextMetricsInput(input);
      const key = stableMetricKey(input);
      if (key.length > 65_536) {
        const supplied = provider.measureLine(frozenMetricClone(input));
        return cloneMetricValue(
          supplied === undefined
            ? resolveTextLineMetrics(input)
            : normalizeProviderTextMetrics(input, supplied),
        );
      }
      const cached = cache.get(key);
      if (cached.hit) return cloneMetricValue(cached.value);
      const supplied = provider.measureLine(frozenMetricClone(input));
      const value =
        supplied === undefined
          ? resolveTextLineMetrics(input)
          : normalizeProviderTextMetrics(input, supplied);
      cache.set(key, value);
      return cloneMetricValue(value);
    },
    clearCache: () => cache.clear(),
    cacheStats: () => cache.stats(),
  };
}

/** Bounded LRU wrapper keyed by the complete asset declaration. */
export function createBoundedMediaMetricsProvider(
  provider: MediaMetricsProvider,
  options: MetricsProviderCacheOptions = {},
): BoundedMediaMetricsProvider {
  const cache = new MetricsLru<MediaMetrics | undefined>(
    checkedMetricsCacheSize(options.maxEntries, 512),
  );
  return {
    measure(asset) {
      const key = stableMetricKey(asset);
      if (key.length > 65_536) {
        const supplied = provider.measure(frozenMetricClone(asset));
        return cloneMetricValue(
          supplied ? normalizeProviderMediaMetrics(asset, supplied) : undefined,
        );
      }
      const cached = cache.get(key);
      if (cached.hit) return cloneMetricValue(cached.value);
      const supplied = provider.measure(frozenMetricClone(asset));
      const value = supplied
        ? normalizeProviderMediaMetrics(asset, supplied)
        : undefined;
      cache.set(key, value);
      return cloneMetricValue(value);
    },
    clearCache: () => cache.clear(),
    cacheStats: () => cache.stats(),
  };
}

class MetricsLru<T> {
  private readonly values = new Map<string, T>();
  private hits = 0;
  private misses = 0;

  constructor(private readonly maxEntries: number) {}

  get(key: string): { hit: true; value: T } | { hit: false } {
    if (!this.values.has(key)) {
      this.misses += 1;
      return { hit: false };
    }
    const value = this.values.get(key) as T;
    this.values.delete(key);
    this.values.set(key, value);
    this.hits += 1;
    return { hit: true, value };
  }

  set(key: string, value: T): void {
    this.values.delete(key);
    this.values.set(key, cloneMetricValue(value));
    while (this.values.size > this.maxEntries) {
      const oldest = this.values.keys().next().value as string | undefined;
      if (oldest === undefined) break;
      this.values.delete(oldest);
    }
  }

  clear(): void {
    this.values.clear();
    this.hits = 0;
    this.misses = 0;
  }

  stats(): MetricsProviderCacheStats {
    return {
      entries: this.values.size,
      maxEntries: this.maxEntries,
      hits: this.hits,
      misses: this.misses,
    };
  }
}

function checkedMetricsCacheSize(
  value: number | undefined,
  fallback: number,
): number {
  const size = value ?? fallback;
  if (!Number.isInteger(size) || size < 1 || size > 100_000) {
    throw new RangeError(
      "Metrics cache maxEntries must be an integer from 1 through 100000.",
    );
  }
  return size;
}

function stableMetricKey(value: unknown): string {
  if (value === null) return "null";
  if (value === undefined) return "undefined";
  if (typeof value === "string") return `string:${JSON.stringify(value)}`;
  if (typeof value === "number") return `number:${JSON.stringify(value)}`;
  if (typeof value === "boolean") return `boolean:${String(value)}`;
  if (typeof value !== "object") {
    throw new TypeError(
      "Metrics cache keys must contain JSON-compatible values.",
    );
  }
  if (Array.isArray(value)) {
    return `[${value.map(stableMetricKey).join(",")}]`;
  }
  return `{${Object.keys(value as Record<string, unknown>)
    .sort((left, right) => (left < right ? -1 : left > right ? 1 : 0))
    .map(
      (key) =>
        `${JSON.stringify(key)}:${stableMetricKey((value as Record<string, unknown>)[key])}`,
    )
    .join(",")}}`;
}

function cloneMetricValue<T>(value: T): T {
  return value === undefined ? value : structuredClone(value);
}

function frozenMetricClone<T>(value: T): T {
  return deepFreezeMetricValue(structuredClone(value));
}

function deepFreezeMetricValue<T>(value: T): T {
  if (typeof value !== "object" || value === null || Object.isFrozen(value)) {
    return value;
  }
  Object.freeze(value);
  for (const child of Object.values(value as Record<string, unknown>)) {
    deepFreezeMetricValue(child);
  }
  return value;
}

/**
 * Measures the width of a single already-broken line of text. `fontSize` is
 * pre-resolved by layout; implementations must honor it plus the style's
 * family/weight/style/letterSpacing so layout and paint agree on wrapping.
 */
export type MeasureTextLine = (
  line: string,
  style: SceneStyle,
  fontSize: number,
  /** Optional stable node identity for provider-specific font/locale lookup. */
  nodeId?: string,
) => number;

export type LayoutOptions = {
  /**
   * Real text measurement (e.g. canvas measureText). Without it, layout falls
   * back to a character-count heuristic that over/under-estimates by font.
   */
  measureTextLine?: MeasureTextLine;
  /** Shared provider; legacy measureTextLine takes precedence when both exist. */
  textMetrics?: TextMetricsProvider;
};

/**
 * The renderer-free fallback: average glyph width as a fontSize ratio. Kept as
 * the default so layout stays usable in plain Node, but renderers should pass
 * their own measurement for wrap-exact boxes.
 */
const heuristicMeasureTextLine: MeasureTextLine = (line, _style, fontSize) =>
  line.length * fontSize * 0.58;

/**
 * Splits text into rendered lines: explicit "\n" always breaks, and words
 * wrap when a line would exceed maxWidth. A single run wider than maxWidth
 * (CJK text has no spaces, so a whole paragraph is one "word") breaks by
 * grapheme cluster so every script wraps instead of being condensed; only a
 * single grapheme wider than the box is clamped by fillText at draw time.
 */
export function wrapTextLines(
  text: string,
  maxWidth: number,
  measure: (line: string) => number,
): string[] {
  const lines: string[] = [];

  for (const paragraph of text.split("\n")) {
    const words = paragraph.split(/\s+/).filter((word) => word.length > 0);

    if (words.length === 0) {
      lines.push("");
      continue;
    }

    let current = "";

    for (const word of words) {
      const candidate = current === "" ? word : `${current} ${word}`;

      if (current !== "" && measure(candidate) > maxWidth) {
        lines.push(current);
        current = word;
      } else {
        current = candidate;
      }

      // The line so far may exceed the box on its own (spaceless scripts,
      // long URLs): emit grapheme-fitted lines until the remainder fits.
      while (measure(current) > maxWidth) {
        const broken = breakByGrapheme(current, maxWidth, measure);

        if (broken === null) {
          break; // single grapheme wider than the box: clamp at draw time
        }

        lines.push(broken.fit);
        current = broken.rest;
      }
    }

    lines.push(current);
  }

  return lines;
}

/**
 * Largest grapheme-cluster prefix of `text` that fits `maxWidth` (at least
 * one cluster), plus the remainder. Returns null when the text cannot be
 * split further. Grapheme segmentation keeps emoji and combining marks
 * intact; falls back to code points where Intl.Segmenter is unavailable.
 */
function breakByGrapheme(
  text: string,
  maxWidth: number,
  measure: (line: string) => number,
): { fit: string; rest: string } | null {
  const clusters = splitGraphemes(text);

  if (clusters.length <= 1) {
    return null;
  }

  let fit = clusters[0] ?? "";
  let index = 1;

  while (index < clusters.length) {
    const candidate = fit + clusters[index];

    if (measure(candidate) > maxWidth) {
      break;
    }

    fit = candidate;
    index += 1;
  }

  if (index >= clusters.length) {
    return null; // everything fits after all (measurement settled)
  }

  return { fit, rest: clusters.slice(index).join("") };
}

function splitGraphemes(text: string): string[] {
  if (typeof Intl !== "undefined" && "Segmenter" in Intl) {
    const segmenter = new Intl.Segmenter(undefined, {
      granularity: "grapheme",
    });
    return Array.from(segmenter.segment(text), (entry) => entry.segment);
  }

  return Array.from(text);
}

export type PrepareTextLinesOptions = {
  maxLines?: number;
  textOverflow?: SceneStyle["textOverflow"];
};

export type PrepareTextLayoutOptions = PrepareTextLinesOptions & {
  textFit?: SceneStyle["textFit"];
  minFontSize?: number;
  height?: number;
  lineHeight?: SceneStyle["lineHeight"];
};

export type PreparedTextLayout = {
  fontSize: number;
  lines: string[];
  lineHeight: number;
};

/** Shrink fitting never discards text when the authored minimum cannot fit. */
export class TextFitError extends Error {
  readonly code = "TEXT_DOES_NOT_FIT";
  constructor(
    readonly constraints: {
      width: number;
      height?: number;
      maxLines?: number;
      minFontSize: number;
    },
  ) {
    super(
      `The complete text cannot fit at the minimum font size of ${constraints.minFontSize}px. Enlarge the text box, lower the minimum font size, increase the line limit, or choose explicit truncation.`,
    );
    this.name = "TextFitError";
  }
}

export function prepareTextLines(
  text: string,
  maxWidth: number,
  measure: (line: string) => number,
  options: PrepareTextLinesOptions = {},
): string[] {
  const lines = wrapTextLines(text, maxWidth, measure);
  const maxLines = options.maxLines;

  if (maxLines === undefined || lines.length <= maxLines) {
    return lines;
  }

  const visible = lines.slice(0, maxLines);

  if (options.textOverflow === "ellipsis" && visible.length > 0) {
    const lastIndex = visible.length - 1;
    visible[lastIndex] = ellipsizeLine(
      visible[lastIndex] ?? "",
      maxWidth,
      measure,
    );
  }

  return visible;
}

export function prepareTextLayout(
  text: string,
  maxWidth: number,
  fontSize: number,
  measure: (line: string, fontSize: number) => number,
  options: PrepareTextLayoutOptions = {},
): PreparedTextLayout {
  const textFit = options.textFit ?? "wrap";
  const baseOptions = {
    maxLines: textFit === "truncate" ? 1 : options.maxLines,
    textOverflow: options.textOverflow,
  };
  const makeLines = (size: number) =>
    prepareTextLines(
      text,
      maxWidth,
      (line) => measure(line, size),
      // Fitting a clipped prefix makes an overflowing caption look as if it
      // fits. Shrink must inspect every source line throughout the search.
      textFit === "shrink" ? {} : baseOptions,
    );
  const makeLayout = (size: number): PreparedTextLayout => ({
    fontSize: size,
    lines: makeLines(size),
    lineHeight: resolveLineHeight(options.lineHeight, size),
  });

  if (textFit !== "shrink") {
    return makeLayout(fontSize);
  }

  const minFontSize = Math.max(
    1,
    Math.min(fontSize, options.minFontSize ?? 12),
  );
  const fits = (size: number): boolean => {
    const lines = makeLines(size);
    const lineHeight = resolveLineHeight(options.lineHeight, size);
    const heightFits =
      options.height === undefined ||
      lines.length * lineHeight <= options.height;
    const widthFits = lines.every((line) => measure(line, size) <= maxWidth);
    const lineCountFits =
      options.maxLines === undefined || lines.length <= options.maxLines;

    return heightFits && widthFits && lineCountFits;
  };

  if (fits(fontSize)) {
    return makeLayout(fontSize);
  }

  if (!fits(minFontSize)) {
    throw new TextFitError({
      width: maxWidth,
      height: options.height,
      maxLines: options.maxLines,
      minFontSize,
    });
  }

  let low = minFontSize;
  let high = fontSize;

  for (let pass = 0; pass < 10; pass += 1) {
    const mid = (low + high) / 2;

    if (fits(mid)) {
      low = mid;
    } else {
      high = mid;
    }
  }

  return makeLayout(low);
}

function ellipsizeLine(
  line: string,
  maxWidth: number,
  measure: (line: string) => number,
): string {
  const ellipsis = "…";

  if (measure(ellipsis) > maxWidth) {
    return "";
  }

  if (measure(`${line}${ellipsis}`) <= maxWidth) {
    return `${line}${ellipsis}`;
  }

  const clusters = splitGraphemes(line);

  while (clusters.length > 0) {
    const candidate = `${clusters.join("")}${ellipsis}`;

    if (measure(candidate) <= maxWidth) {
      return candidate;
    }

    clusters.pop();
  }

  return ellipsis;
}

export function layoutScene(
  scene: ResolvedScene,
  options: LayoutOptions = {},
): LayoutScene {
  const root = { x: 0, y: 0, width: scene.width, height: scene.height };
  const measure =
    options.measureTextLine ??
    (options.textMetrics
      ? (line: string, style: SceneStyle, fontSize: number, nodeId?: string) =>
          resolveTextLineMetrics(
            { nodeId: nodeId ?? "__unknown__", text: line, style, fontSize },
            options.textMetrics,
          ).width
      : heuristicMeasureTextLine);

  return {
    ...scene,
    boxes: scene.nodes.map((node) => layoutNode(node, root, measure)),
  };
}

function layoutNode(
  node: ResolvedNode,
  containingBlock: { x: number; y: number; width: number; height: number },
  measure: MeasureTextLine,
  // Flex parents size their children during distribution; the child box must
  // keep that assigned height instead of re-deriving an intrinsic one.
  sizedByParent = false,
): LayoutBox {
  const style = node.style ?? {};
  if (style.safeArea) {
    containingBlock = insetContainingBlock(containingBlock, style.safeArea);
  }
  const inset = readLength(style.inset, containingBlock.width, 0);
  // Per-side values override the shorthand. Vertical percentages intentionally
  // resolve against containing width, matching CSS spacing semantics.
  const margin = readLength(style.margin, containingBlock.width, 0);
  const marginTop = readLength(style.marginTop, containingBlock.width, margin);
  const marginRight = readLength(
    style.marginRight,
    containingBlock.width,
    margin,
  );
  const marginBottom = readLength(
    style.marginBottom,
    containingBlock.width,
    margin,
  );
  const marginLeft = readLength(
    style.marginLeft,
    containingBlock.width,
    margin,
  );
  const left = readLength(style.left, containingBlock.width, inset);
  const top = readLength(style.top, containingBlock.height, inset);
  const right =
    style.right === undefined
      ? undefined
      : readLength(style.right, containingBlock.width, 0);
  const bottom =
    style.bottom === undefined
      ? undefined
      : readLength(style.bottom, containingBlock.height, 0);
  const widthFallback =
    (style.position === "absolute" &&
    right !== undefined &&
    style.width === undefined
      ? containingBlock.width - left - right
      : containingBlock.width - inset * 2) -
    marginLeft -
    marginRight;
  const heightFallback =
    (style.position === "absolute" &&
    bottom !== undefined &&
    style.height === undefined
      ? containingBlock.height - top - bottom
      : containingBlock.height - inset * 2) -
    marginTop -
    marginBottom;
  let width = clampLength(
    resolveLength(style.width, containingBlock.width, widthFallback),
    style.minWidth,
    style.maxWidth,
    containingBlock.width,
  );
  // Text with auto height gets its intrinsic height (wrapped lines ×
  // lineHeight) instead of filling the containing block — CSS block
  // semantics, and what keeps `top`-anchored text from centering off-canvas.
  // Absolute nodes with both top and bottom set stay inset-constrained.
  const intrinsicHeight =
    node.type === "text" &&
    style.height === undefined &&
    !sizedByParent &&
    !(
      style.position === "absolute" &&
      style.top !== undefined &&
      style.bottom !== undefined
    )
      ? textIntrinsicHeight(node, width, measure)
      : undefined;
  const aspectRatio = parseAspectRatio(style.aspectRatio);
  const ratioHeight = aspectRatio ? width / aspectRatio : undefined;
  let height = clampLength(
    resolveLength(
      style.height,
      containingBlock.height,
      ratioHeight ?? intrinsicHeight ?? heightFallback,
    ),
    style.minHeight,
    style.maxHeight,
    containingBlock.height,
  );

  if (aspectRatio && style.width === undefined && style.height !== undefined) {
    width = clampLength(
      height * aspectRatio,
      style.minWidth,
      style.maxWidth,
      containingBlock.width,
    );
  }

  const x =
    containingBlock.x +
    (style.position === "absolute" &&
    style.left === undefined &&
    right !== undefined
      ? containingBlock.width - right - width - marginRight
      : left + marginLeft);
  const y =
    containingBlock.y +
    (style.position === "absolute" &&
    style.top === undefined &&
    bottom !== undefined
      ? containingBlock.height - bottom - height - marginBottom
      : top + marginTop);

  const paddingReference = Math.min(width, height);
  const padding = readLength(style.padding, paddingReference, 0);
  const paddingTop = readLength(style.paddingTop, paddingReference, padding);
  const paddingRight = readLength(
    style.paddingRight,
    paddingReference,
    padding,
  );
  const paddingBottom = readLength(
    style.paddingBottom,
    paddingReference,
    padding,
  );
  const paddingLeft = readLength(style.paddingLeft, paddingReference, padding);
  const content = {
    x: x + paddingLeft,
    y: y + paddingTop,
    width: Math.max(0, width - paddingLeft - paddingRight),
    height: Math.max(0, height - paddingTop - paddingBottom),
  };

  const children =
    style.display === "flex"
      ? layoutFlexChildren(node.children, content, style, measure)
      : node.children.map((child) => layoutNode(child, content, measure));

  return {
    id: node.id,
    x,
    y,
    width,
    height,
    content,
    node,
    children,
  };
}

function insetContainingBlock(
  containingBlock: { x: number; y: number; width: number; height: number },
  safeArea: NonNullable<SceneStyle["safeArea"]>,
): { x: number; y: number; width: number; height: number } {
  const top = readLength(safeArea.top, containingBlock.height, 0);
  const right = readLength(safeArea.right, containingBlock.width, 0);
  const bottom = readLength(safeArea.bottom, containingBlock.height, 0);
  const left = readLength(safeArea.left, containingBlock.width, 0);
  return {
    x: containingBlock.x + left,
    y: containingBlock.y + top,
    width: Math.max(0, containingBlock.width - left - right),
    height: Math.max(0, containingBlock.height - top - bottom),
  };
}

function layoutFlexChildren(
  children: ResolvedNode[],
  content: { x: number; y: number; width: number; height: number },
  style: SceneStyle,
  measure: MeasureTextLine,
): LayoutBox[] {
  const direction = style.flexDirection ?? "row";
  const gap = readLength(
    style.gap,
    direction === "row" ? content.width : content.height,
    0,
  );
  const childBoxes = children.map((child) => {
    const estimatedWidth = estimateNodeWidth(child, measure);
    let childWidth = resolveLength(
      child.style.width,
      content.width,
      Math.min(content.width, estimatedWidth),
    );
    // Height is estimated after the width is known so wrapped text reserves
    // one slot per rendered line, not per explicit "\n".
    const estimatedHeight =
      child.type === "text"
        ? textIntrinsicHeight(child, childWidth, measure)
        : 0;
    let childHeight = resolveLength(
      child.style.height,
      content.height,
      Math.min(content.height, estimatedHeight),
    );
    const childAspectRatio = parseAspectRatio(child.style.aspectRatio);
    if (childAspectRatio) {
      if (child.style.height === undefined && child.style.width !== undefined) {
        childHeight = childWidth / childAspectRatio;
      } else if (
        child.style.width === undefined &&
        child.style.height !== undefined
      ) {
        childWidth = childHeight * childAspectRatio;
      }
    }

    if (style.alignItems === "stretch") {
      // Stretch fills the cross axis for children without an explicit size.
      if (direction === "row" && child.style.height === undefined) {
        childHeight = content.height;
      }

      if (direction === "column" && child.style.width === undefined) {
        childWidth = content.width;
      }
    }

    return { child, width: childWidth, height: childHeight };
  });

  const mainTotal =
    childBoxes.reduce(
      (total, child) =>
        total + (direction === "row" ? child.width : child.height),
      0,
    ) +
    Math.max(0, childBoxes.length - 1) * gap;
  const mainSpace = direction === "row" ? content.width : content.height;
  const crossSpace = direction === "row" ? content.height : content.width;
  // space-between distributes leftover main-axis space on top of `gap`.
  const betweenGap =
    style.justifyContent === "space-between" && childBoxes.length > 1
      ? Math.max(0, mainSpace - mainTotal) / (childBoxes.length - 1)
      : 0;
  let cursor =
    style.justifyContent === "center" ? (mainSpace - mainTotal) / 2 : 0;

  if (style.justifyContent === "flex-end") {
    cursor = mainSpace - mainTotal;
  }

  return childBoxes.map(({ child, width, height }) => {
    const crossSize = direction === "row" ? height : width;
    let crossOffset = 0;

    if (style.alignItems === "center") {
      crossOffset = (crossSpace - crossSize) / 2;
    } else if (style.alignItems === "flex-end") {
      crossOffset = crossSpace - crossSize;
    }

    const box =
      direction === "row"
        ? layoutNode(
            child,
            {
              x: content.x + cursor,
              y: content.y + crossOffset,
              width,
              height,
            },
            measure,
            true,
          )
        : layoutNode(
            child,
            {
              x: content.x + crossOffset,
              y: content.y + cursor,
              width,
              height,
            },
            measure,
            true,
          );

    cursor += (direction === "row" ? width : height) + gap + betweenGap;
    return box;
  });
}

function clampLength(
  value: number,
  min: string | number | undefined,
  max: string | number | undefined,
  parent: number,
): number {
  let clamped = value;

  if (max !== undefined) {
    clamped = Math.min(clamped, readLength(max, parent, clamped));
  }

  // CSS semantics: min wins over max when they conflict.
  if (min !== undefined) {
    clamped = Math.max(clamped, readLength(min, parent, clamped));
  }

  return clamped;
}

export function parseAspectRatio(
  value: SceneStyle["aspectRatio"],
): number | null {
  if (typeof value === "number") {
    return Number.isFinite(value) && value > 0 ? value : null;
  }
  if (typeof value !== "string") return null;
  const match = value.match(/^\s*(\d+(?:\.\d+)?)\s*\/\s*(\d+(?:\.\d+)?)\s*$/);
  if (!match) return null;
  const width = Number.parseFloat(match[1] ?? "0");
  const height = Number.parseFloat(match[2] ?? "0");
  return width > 0 && height > 0 ? width / height : null;
}

function estimateNodeWidth(
  node: ResolvedNode,
  measure: MeasureTextLine,
): number {
  if (node.type === "text") {
    const fontSize = readLength(node.style.fontSize, 0, 24);
    return (textNodeContent(node) || " ")
      .split("\n")
      .reduce(
        (longest, line) =>
          Math.max(longest, measure(line, node.style, fontSize, node.id)),
        0,
      );
  }

  return 0;
}

/**
 * Intrinsic height of a text node when wrapped to `width`: rendered line
 * count × lineHeight, using the same line breaking the renderer paints with.
 * Percent fontSize has no stable basis before the box exists and resolves
 * against zero — use absolute font sizes on auto-height text.
 */
function textIntrinsicHeight(
  node: ResolvedNode,
  width: number,
  measure: MeasureTextLine,
): number {
  const fontSize = readLength(node.style.fontSize, 0, 24);
  let height = fontSize;
  // Resolve percentage padding against the same min(width,height) reference
  // used by layoutNode; fixed padding converges on the first extra pass.
  for (let pass = 0; pass < 12; pass += 1) {
    const reference = Math.min(width, height);
    const padding = readLength(node.style.padding, reference, 0);
    const left = readLength(node.style.paddingLeft, reference, padding);
    const right = readLength(node.style.paddingRight, reference, padding);
    const top = readLength(node.style.paddingTop, reference, padding);
    const bottom = readLength(node.style.paddingBottom, reference, padding);
    const layout = prepareTextLayout(
      textNodeContent(node),
      Math.max(0, width - left - right),
      fontSize,
      (line, size) => measure(line, node.style, size, node.id),
      {
        maxLines: node.style.maxLines,
        minFontSize: readLength(node.style.minFontSize, 0, 12),
        textFit: node.style.textFit,
        textOverflow: node.style.textOverflow,
        lineHeight: node.style.lineHeight,
      },
    );
    const nextHeight = layout.lines.length * layout.lineHeight + top + bottom;
    if (Math.abs(nextHeight - height) < 1e-6) return nextHeight;
    height = nextHeight;
  }
  return height;
}

function textNodeContent(node: Pick<ResolvedNode, "text" | "runs">): string {
  return node.text ?? node.runs?.map((run) => run.text).join("") ?? "";
}

function resolveLineHeight(
  value: number | string | undefined,
  fontSize: number,
): number {
  // CSS semantics: a unitless number is a multiplier of the font size.
  if (typeof value === "number") {
    return fontSize * value;
  }

  return readLength(value, fontSize, fontSize * 1.25);
}

function resolveLength(
  value: string | number | undefined,
  parent: number,
  fallback: number,
): number {
  if (value === undefined) {
    return fallback;
  }

  return readLength(value, parent, fallback);
}

function readLength(
  value: string | number | undefined,
  parent: number,
  fallback: number,
): number {
  if (typeof value === "number") {
    return value;
  }

  if (typeof value !== "string") {
    return fallback;
  }

  if (value.endsWith("%")) {
    return (Number.parseFloat(value) / 100) * parent;
  }

  if (value.endsWith("px")) {
    return Number.parseFloat(value);
  }

  const parsed = Number.parseFloat(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

// Inline SVG badge so the sample scene exercises image assets without any
// network dependency. Kept tiny and deterministic.
const sampleBadgeSvg = `<svg xmlns="http://www.w3.org/2000/svg" width="160" height="160" viewBox="0 0 160 160"><circle cx="80" cy="80" r="72" fill="#ffd166"/><circle cx="80" cy="80" r="56" fill="#101820"/><path d="M52 96 80 44l28 52H92l-12-24-12 24z" fill="#ffd166"/></svg>`;

export function sampleScene(): Scene {
  return composition({ width: 1080, height: 1920, fps: 30, duration: 120 })
    .asset({
      id: "badge",
      type: "image",
      src: `data:image/svg+xml;base64,${toBase64(sampleBadgeSvg)}`,
    })
    .children(
      div({
        id: "background",
        duration: 120,
        style: {
          width: "100%",
          height: "100%",
          background: "linear-gradient(180deg, #101820 0%, #244f46 100%)",
        },
      }),
      img("badge", {
        id: "badge-mark",
        duration: 120,
        style: {
          position: "absolute",
          left: 460,
          top: 360,
          width: 160,
          height: 160,
          objectFit: "contain",
        },
      }).animate("opacity", [
        { frame: 0, value: 0 },
        { frame: 18, value: 1, easing: "easeOut" },
      ]),
      div({
        id: "subtitle-wrap",
        duration: 120,
        style: {
          position: "absolute",
          left: 64,
          right: 64,
          bottom: 160,
          height: 180,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          padding: 32,
        },
      }).children(
        text("Forge motion in the browser", {
          id: "subtitle",
          duration: 120,
          style: {
            fontFamily: "Inter, system-ui, sans-serif",
            fontSize: 76,
            fontWeight: 800,
            color: "#ffffff",
            textAlign: "center",
            textShadow: "0 6px 28px rgba(0,0,0,0.45)",
          },
        }).animate("opacity", [
          { frame: 0, value: 0 },
          { frame: 12, value: 1, easing: "easeOut" },
          { frame: 100, value: 1 },
          { frame: 119, value: 0, easing: "easeIn" },
        ]),
      ),
    )
    .toJSON();
}

/** Base64 that works in browsers (btoa) and Node (Buffer) without DOM types. */
function toBase64(value: string): string {
  const globalScope = globalThis as {
    btoa?: (data: string) => string;
    Buffer?: {
      from(
        data: string,
        encoding: string,
      ): { toString(encoding: string): string };
    };
  };

  if (typeof globalScope.btoa === "function") {
    return globalScope.btoa(value);
  }

  if (globalScope.Buffer) {
    return globalScope.Buffer.from(value, "utf-8").toString("base64");
  }

  throw new Error("No base64 encoder available in this environment.");
}
