import type { SceneAnimation } from "@motionforge/schema";
import {
  compileMotionPreset,
  fadeUp,
  motionPresetNames,
  popIn,
  pulse,
  slideIn,
  type MotionPresetName,
} from "@motionforge/presets";

/**
 * Server-side expansion of named animation presets emitted by the model.
 *
 * The model may put `{"preset":"popIn","delay":3}` entries inside a node's
 * `animations` array instead of raw keyframe tracks. Expanding them here keeps
 * model output small (fewer tokens, fewer bracket-balance mistakes) while the
 * scene schema keeps receiving plain keyframe animations.
 */

export type AnimationPresetTiming = {
  from: number;
  duration?: number;
};

type AnimationPresetSpec = {
  name: string;
  delay: number;
  durationFrames?: number;
  distance?: number;
  fromScale?: number;
  peak?: number;
  easing?: string;
};

const DEFAULT_ENTER_FRAMES = 12;
const DEFAULT_EXIT_FRAMES = 12;
const DEFAULT_SPARKLE_FRAMES = 14;
const MAX_PRESET_FRAMES = 900;

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function readFrameCount(value: unknown): number | undefined {
  const parsed =
    typeof value === "number"
      ? value
      : typeof value === "string"
        ? Number.parseFloat(value)
        : NaN;

  if (!Number.isFinite(parsed) || parsed <= 0) {
    return undefined;
  }

  return Math.min(MAX_PRESET_FRAMES, Math.max(1, Math.round(parsed)));
}

function readFiniteNumber(value: unknown): number | undefined {
  const parsed =
    typeof value === "number"
      ? value
      : typeof value === "string"
        ? Number.parseFloat(value)
        : NaN;

  return Number.isFinite(parsed) ? parsed : undefined;
}

function readDelayFrames(value: unknown): number {
  const parsed = readFiniteNumber(value);
  if (parsed === undefined || parsed <= 0) {
    return 0;
  }

  return Math.min(MAX_PRESET_FRAMES, Math.round(parsed));
}

export function readAnimationPresetSpec(
  entry: unknown,
): AnimationPresetSpec | null {
  if (!isRecord(entry)) {
    return null;
  }

  const name = entry.preset ?? (entry.kind === "preset" ? entry.name : null);
  if (typeof name !== "string" || !name.trim()) {
    return null;
  }

  return {
    name: name.trim(),
    delay: readDelayFrames(entry.delay ?? entry.startFrame),
    durationFrames: readFrameCount(
      entry.durationFrames ?? entry.durationInFrames ?? entry.frames,
    ),
    distance: readFiniteNumber(entry.distance),
    fromScale: readFiniteNumber(entry.fromScale),
    peak: readFiniteNumber(entry.peak ?? entry.scale ?? entry.intensity),
    easing: typeof entry.easing === "string" ? entry.easing : undefined,
  };
}

function animation(
  property: SceneAnimation["property"],
  frames: SceneAnimation["frames"],
): SceneAnimation {
  return { kind: "keyframes", property, frames };
}

/** Shifts frames by `delay`, holding the first value from frame 0. */
function delayed(
  frames: SceneAnimation["frames"],
  delay: number,
): SceneAnimation["frames"] {
  if (delay <= 0) {
    return frames;
  }

  const first = frames[0];
  const shifted = frames.map((entry) => ({
    ...entry,
    frame: entry.frame + delay,
  }));

  return first ? [{ frame: 0, value: first.value }, ...shifted] : shifted;
}

function fadeIn(spec: AnimationPresetSpec): SceneAnimation[] {
  const duration = spec.durationFrames ?? DEFAULT_ENTER_FRAMES;

  return [
    animation(
      "opacity",
      delayed(
        [
          { frame: 0, value: 0 },
          { frame: duration, value: 1, easing: spec.easing ?? "easeOut" },
        ],
        spec.delay,
      ),
    ),
  ];
}

function exitWindow(
  spec: AnimationPresetSpec,
  timing: AnimationPresetTiming | undefined,
) {
  const lengthFrames = spec.durationFrames ?? DEFAULT_EXIT_FRAMES;
  const end =
    timing?.duration && timing.duration > 1
      ? timing.duration - 1
      : spec.delay + lengthFrames;
  const start = Math.max(0, end - lengthFrames);

  return { start, end: Math.max(start + 1, end) };
}

function fadeOut(
  spec: AnimationPresetSpec,
  timing: AnimationPresetTiming | undefined,
): SceneAnimation[] {
  const { start, end } = exitWindow(spec, timing);
  const easing = spec.easing ?? "easeIn";
  const frames: SceneAnimation["frames"] =
    start > 0
      ? [
          { frame: 0, value: 1 },
          { frame: start, value: 1 },
          { frame: end, value: 0, easing },
        ]
      : [
          { frame: 0, value: 1 },
          { frame: end, value: 0, easing },
        ];

  return [animation("opacity", frames)];
}

function popOut(
  spec: AnimationPresetSpec,
  timing: AnimationPresetTiming | undefined,
): SceneAnimation[] {
  const { start, end } = exitWindow(spec, timing);
  const toScale = spec.fromScale ?? 0.8;
  const easing = spec.easing ?? "easeIn";
  const transformFrames: SceneAnimation["frames"] =
    start > 0
      ? [
          { frame: 0, value: "scale(1)" },
          { frame: start, value: "scale(1)" },
          { frame: end, value: `scale(${toScale})`, easing },
        ]
      : [
          { frame: 0, value: "scale(1)" },
          { frame: end, value: `scale(${toScale})`, easing },
        ];

  return [
    animation("transform", transformFrames),
    ...fadeOut({ ...spec, easing: spec.easing }, timing),
  ];
}

function sparkle(spec: AnimationPresetSpec): SceneAnimation[] {
  const duration = spec.durationFrames ?? DEFAULT_SPARKLE_FRAMES;
  const mid = Math.max(1, Math.round(duration / 2));
  const end = Math.max(mid + 1, duration);

  return [
    animation(
      "opacity",
      delayed(
        [
          { frame: 0, value: 0 },
          { frame: mid, value: 1, easing: "easeOut" },
          { frame: end, value: 0, easing: "easeIn" },
        ],
        spec.delay,
      ),
    ),
    animation(
      "transform",
      delayed(
        [
          { frame: 0, value: "scale(0.6)" },
          {
            frame: mid,
            value: `scale(${spec.peak ?? 1.25})`,
            easing: "easeOut",
          },
          { frame: end, value: "scale(0.6)", easing: "easeIn" },
        ],
        spec.delay,
      ),
    ),
  ];
}

function expandPreset(
  spec: AnimationPresetSpec,
  timing: AnimationPresetTiming | undefined,
): SceneAnimation[] {
  const options = {
    durationInFrames: spec.durationFrames,
    delay: spec.delay,
    easing: spec.easing,
  };

  switch (spec.name) {
    case "fadeIn":
      return fadeIn(spec);
    case "fadeOut":
      return fadeOut(spec, timing);
    case "fadeUp":
    case "fadeInUp":
      return fadeUp({ ...options, distance: spec.distance });
    case "popIn":
    case "zoomIn":
      return popIn({ ...options, fromScale: spec.fromScale });
    case "popOut":
    case "zoomOut":
      return popOut(spec, timing);
    case "slideInLeft":
      return slideIn("left", { ...options, distance: spec.distance });
    case "slideInRight":
      return slideIn("right", { ...options, distance: spec.distance });
    case "slideInUp":
      return slideIn("up", { ...options, distance: spec.distance });
    case "slideInDown":
      return slideIn("down", { ...options, distance: spec.distance });
    case "pulse":
      return pulse({ ...options, peak: spec.peak });
    case "sparkle":
    case "twinkle":
      return sparkle(spec);
    default:
      if (motionPresetNameSet.has(spec.name)) {
        return compileMotionPreset(spec.name as MotionPresetName, {
          ...(spec.durationFrames
            ? { durationInFrames: spec.durationFrames }
            : {}),
          delay: spec.delay,
          ...(spec.distance !== undefined ? { distance: spec.distance } : {}),
          ...(spec.peak !== undefined ? { intensity: spec.peak } : {}),
          ...(spec.easing ? { easing: spec.easing } : {}),
        });
      }
      // Unknown preset names degrade to a fade-in instead of failing the
      // whole patch on schema validation.
      return fadeIn(spec);
  }
}

const motionPresetNameSet = new Set<string>(motionPresetNames());

export const supportedAnimationPresetNames = [
  ...motionPresetNames(),
  "sparkle",
] as const;

/**
 * Replaces preset spec entries inside a model-provided animations array with
 * expanded keyframe animations. Non-preset entries pass through untouched.
 */
export function expandAnimationPresets(
  input: unknown[],
  timing?: AnimationPresetTiming,
): unknown[] {
  return input.flatMap((entry) => {
    const spec = readAnimationPresetSpec(entry);
    if (!spec) {
      return [entry];
    }

    return expandPreset(spec, timing);
  });
}
