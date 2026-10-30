import {
  isEasingExpression,
  type SceneAnimation,
  type SceneAnimationTarget,
} from "@dojo-video-engine/schema";
import { z } from "zod/v3";

export const motionPresetParamsSchema = z
  .object({
    durationInFrames: z.number().int().min(1).max(600).optional(),
    delay: z.number().int().min(0).max(600).optional(),
    distance: z.number().min(0).max(4000).optional(),
    intensity: z.number().min(0).max(4).optional(),
    easing: z.string().refine(isEasingExpression).optional(),
    repeat: z
      .union([z.number().int().min(0).max(1000), z.literal("infinite")])
      .optional(),
    yoyo: z.boolean().optional(),
  })
  .strict();

export type MotionPresetParams = z.infer<typeof motionPresetParamsSchema>;
export type MotionPresetCategory = "entrance" | "exit" | "emphasis" | "ambient";

type MotionSpec = {
  name: string;
  label: string;
  description: string;
  category: MotionPresetCategory;
  kind: string;
};

const motionSpecs = [
  ["fadeIn", "Fade in", "Gentle opacity entrance.", "entrance", "fade-in"],
  ["fadeOut", "Fade out", "Gentle opacity exit.", "exit", "fade-out"],
  ["fadeUp", "Fade up", "Fade while drifting upward.", "entrance", "in-up"],
  [
    "fadeDown",
    "Fade down",
    "Fade while drifting downward.",
    "entrance",
    "in-down",
  ],
  ["fadeLeft", "Fade left", "Fade while drifting left.", "entrance", "in-left"],
  [
    "fadeRight",
    "Fade right",
    "Fade while drifting right.",
    "entrance",
    "in-right",
  ],
  [
    "slideInLeft",
    "Slide in left",
    "Fast entrance from the left.",
    "entrance",
    "slide-in-left",
  ],
  [
    "slideInRight",
    "Slide in right",
    "Fast entrance from the right.",
    "entrance",
    "slide-in-right",
  ],
  [
    "slideInUp",
    "Slide in up",
    "Fast entrance from above.",
    "entrance",
    "slide-in-up",
  ],
  [
    "slideInDown",
    "Slide in down",
    "Fast entrance from below.",
    "entrance",
    "slide-in-down",
  ],
  [
    "slideOutLeft",
    "Slide out left",
    "Exit toward the left.",
    "exit",
    "slide-out-left",
  ],
  [
    "slideOutRight",
    "Slide out right",
    "Exit toward the right.",
    "exit",
    "slide-out-right",
  ],
  [
    "slideOutUp",
    "Slide out up",
    "Exit toward the top.",
    "exit",
    "slide-out-up",
  ],
  [
    "slideOutDown",
    "Slide out down",
    "Exit toward the bottom.",
    "exit",
    "slide-out-down",
  ],
  ["popIn", "Pop in", "Spring scale-and-fade entrance.", "entrance", "pop-in"],
  ["popOut", "Pop out", "Compact scale-and-fade exit.", "exit", "pop-out"],
  ["zoomIn", "Zoom in", "Subtle zoom entrance.", "entrance", "zoom-in"],
  ["zoomOut", "Zoom out", "Subtle zoom exit.", "exit", "zoom-out"],
  ["spinIn", "Spin in", "Rotating scale entrance.", "entrance", "spin-in"],
  ["spinOut", "Spin out", "Rotating scale exit.", "exit", "spin-out"],
  ["flipXIn", "Flip X in", "Horizontal squash reveal.", "entrance", "flip-x"],
  ["flipYIn", "Flip Y in", "Vertical squash reveal.", "entrance", "flip-y"],
  [
    "bounceIn",
    "Bounce in",
    "Overshooting scale entrance.",
    "entrance",
    "bounce",
  ],
  [
    "elasticIn",
    "Elastic in",
    "Elastic multi-step entrance.",
    "entrance",
    "elastic",
  ],
  ["pulse", "Pulse", "One controlled scale pulse.", "emphasis", "pulse"],
  ["breathe", "Breathe", "Slow repeating scale breath.", "ambient", "breathe"],
  ["float", "Float", "Slow vertical yoyo drift.", "ambient", "float"],
  [
    "wobble",
    "Wobble",
    "Playful rotate/translate wobble.",
    "emphasis",
    "wobble",
  ],
  ["shake", "Shake", "Short horizontal attention shake.", "emphasis", "shake"],
  ["swing", "Swing", "Damped pendulum rotation.", "emphasis", "swing"],
  ["heartbeat", "Heartbeat", "Double scale beat.", "emphasis", "heartbeat"],
  ["flash", "Flash", "Brief opacity flash.", "emphasis", "flash"],
  ["blurIn", "Blur in", "Blur-to-sharp entrance.", "entrance", "blur-in"],
  ["blurOut", "Blur out", "Sharp-to-blur exit.", "exit", "blur-out"],
  ["revealUp", "Reveal up", "Compact upward reveal.", "entrance", "reveal-up"],
  [
    "revealLeft",
    "Reveal left",
    "Compact left reveal.",
    "entrance",
    "reveal-left",
  ],
  ["drift", "Drift", "Long diagonal ambient drift.", "ambient", "drift"],
  ["pendulum", "Pendulum", "Continuous yoyo rotation.", "ambient", "pendulum"],
] as const;

export type MotionPresetName = (typeof motionSpecs)[number][0];

export type MotionPresetDefinition = {
  name: MotionPresetName;
  label: string;
  description: string;
  category: MotionPresetCategory;
  paramsSchema: typeof motionPresetParamsSchema;
  thumbnail: { frame: number; background: string };
  compile(params?: MotionPresetParams): SceneAnimation[];
  compileReducedMotion(params?: MotionPresetParams): SceneAnimation[];
};

export const motionPresetDefinitions: readonly MotionPresetDefinition[] =
  motionSpecs.map(([name, label, description, category, kind]) => ({
    name,
    label,
    description,
    category,
    paramsSchema: motionPresetParamsSchema,
    thumbnail: {
      frame: 8,
      background:
        category === "exit"
          ? "#3f1d2e"
          : category === "ambient"
            ? "#172554"
            : category === "emphasis"
              ? "#422006"
              : "#083344",
    },
    compile: (params = {}) => compileSpec(kind, params),
    compileReducedMotion: (params = {}) => reducedMotion(kind, params),
  }));

const definitionsByName = new Map(
  motionPresetDefinitions.map((definition) => [definition.name, definition]),
);

export function motionPresetNames(): MotionPresetName[] {
  return motionPresetDefinitions.map((definition) => definition.name);
}

export function getMotionPresetDefinition(
  name: MotionPresetName,
): MotionPresetDefinition {
  const definition = definitionsByName.get(name);
  if (!definition)
    throw new Error(`Unknown motion preset ${JSON.stringify(name)}.`);
  return definition;
}

export function compileMotionPreset(
  name: MotionPresetName,
  params: MotionPresetParams = {},
  options: { reducedMotion?: boolean } = {},
): SceneAnimation[] {
  const definition = getMotionPresetDefinition(name);
  const checked = definition.paramsSchema.parse(params);
  return options.reducedMotion
    ? definition.compileReducedMotion(checked)
    : definition.compile(checked);
}

function compileSpec(
  kind: string,
  params: MotionPresetParams,
): SceneAnimation[] {
  const duration =
    params.durationInFrames ?? (kind.includes("ambient") ? 60 : 16);
  const delay = params.delay ?? 0;
  const distance = params.distance ?? (kind.startsWith("slide") ? 180 : 44);
  const intensity = params.intensity ?? 1;
  const easing = params.easing ?? "cubic-bezier(0.22, 1, 0.36, 1)";
  const playback = { repeat: params.repeat, yoyo: params.yoyo };
  const at = (progress: number) => delay + Math.round(duration * progress);
  const track = (
    property: SceneAnimationTarget,
    values: Array<[number, string | number, string?]>,
  ): SceneAnimation => ({
    kind: "keyframes",
    property,
    frames: values.map(([progress, value, frameEasing]) => ({
      frame: at(progress),
      value,
      ...(frameEasing ? { easing: frameEasing } : {}),
    })),
    ...(playback.repeat !== undefined ? { repeat: playback.repeat } : {}),
    ...(playback.yoyo !== undefined ? { yoyo: playback.yoyo } : {}),
  });
  const direction = kind.endsWith("left")
    ? [-distance, 0]
    : kind.endsWith("right")
      ? [distance, 0]
      : kind.endsWith("up")
        ? [0, -distance]
        : [0, distance];
  const x = direction[0] ?? 0;
  const y = direction[1] ?? 0;

  if (kind === "fade-in")
    return [
      track("opacity", [
        [0, 0],
        [1, 1, easing],
      ]),
    ];
  if (kind === "fade-out")
    return [
      track("opacity", [
        [0, 1],
        [1, 0, easing],
      ]),
    ];
  if (kind.startsWith("in-") || kind.startsWith("slide-in-")) {
    return [
      track("transform", [
        [0, `translate(${x}px, ${y}px)`],
        [1, "translate(0px, 0px)", easing],
      ]),
      track("opacity", [
        [0, 0],
        [0.65, 1, "easeOut"],
      ]),
    ];
  }
  if (kind.startsWith("slide-out-")) {
    return [
      track("transform", [
        [0, "translate(0px, 0px)"],
        [1, `translate(${x}px, ${y}px)`, easing],
      ]),
      track("opacity", [
        [0, 1],
        [1, 0, "easeIn"],
      ]),
    ];
  }
  if (kind === "pop-in" || kind === "zoom-in") {
    return [
      track("transform", [
        [0, `scale(${kind === "pop-in" ? 0.72 : 0.9})`],
        [1, "scale(1)", params.easing ?? "spring(0.35)"],
      ]),
      track("opacity", [
        [0, 0],
        [0.65, 1, "easeOut"],
      ]),
    ];
  }
  if (kind === "pop-out" || kind === "zoom-out") {
    return [
      track("transform", [
        [0, "scale(1)"],
        [1, `scale(${kind === "pop-out" ? 0.72 : 1.12})`, easing],
      ]),
      track("opacity", [
        [0, 1],
        [1, 0, "easeIn"],
      ]),
    ];
  }
  if (kind === "spin-in" || kind === "spin-out") {
    const exiting = kind === "spin-out";
    return [
      track("transform", [
        [0, exiting ? "scale(1) rotate(0deg)" : "scale(0.5) rotate(-180deg)"],
        [
          1,
          exiting ? "scale(0.5) rotate(180deg)" : "scale(1) rotate(0deg)",
          easing,
        ],
      ]),
      track("opacity", [
        [0, exiting ? 1 : 0],
        [1, exiting ? 0 : 1, easing],
      ]),
    ];
  }
  if (kind === "flip-x" || kind === "flip-y") {
    return [
      track("transform", [
        [0, kind === "flip-x" ? "scale(0.08, 1)" : "scale(1, 0.08)"],
        [1, "scale(1, 1)", easing],
      ]),
      track("opacity", [
        [0, 0],
        [0.4, 1, "easeOut"],
      ]),
    ];
  }
  if (kind === "bounce" || kind === "elastic") {
    return [
      track(
        "transform",
        kind === "bounce"
          ? [
              [0, "scale(0.4)"],
              [0.65, "scale(1.12)", "easeOut"],
              [1, "scale(1)", "easeInOut"],
            ]
          : [
              [0, "scale(0.25)"],
              [0.55, "scale(1.18)", "easeOut"],
              [0.78, "scale(0.94)", "easeInOut"],
              [1, "scale(1)", "easeOut"],
            ],
      ),
      track("opacity", [
        [0, 0],
        [0.35, 1, "easeOut"],
      ]),
    ];
  }
  if (kind === "pulse" || kind === "breathe" || kind === "heartbeat") {
    const peak = 1 + 0.08 * intensity;
    const values: Array<[number, string, string?]> =
      kind === "heartbeat"
        ? [
            [0, "scale(1)"],
            [0.22, `scale(${peak})`, "easeOut"],
            [0.42, "scale(1)"],
            [0.62, `scale(${1 + 0.05 * intensity})`, "easeOut"],
            [1, "scale(1)"],
          ]
        : [
            [0, "scale(1)"],
            [0.5, `scale(${peak})`, "easeInOut"],
            [1, "scale(1)", "easeInOut"],
          ];
    const result = track("transform", values);
    if (kind === "breathe" && params.repeat === undefined) {
      result.repeat = "infinite";
    }
    return [result];
  }
  if (kind === "float" || kind === "drift") {
    const transform =
      kind === "float"
        ? `translate(0px, ${-distance * 0.3}px)`
        : `translate(${distance * 0.45}px, ${-distance * 0.3}px)`;
    const result = track("transform", [
      [0, "translate(0px, 0px)"],
      [1, transform, "easeInOut"],
    ]);
    result.repeat = params.repeat ?? "infinite";
    result.yoyo = params.yoyo ?? true;
    return [result];
  }
  if (
    kind === "wobble" ||
    kind === "shake" ||
    kind === "swing" ||
    kind === "pendulum"
  ) {
    const amount = (kind === "shake" ? distance * 0.12 : 8) * intensity;
    const values: Array<[number, string, string?]> =
      kind === "shake"
        ? [
            [0, "translate(0px, 0px)"],
            [0.2, `translate(${-amount}px, 0px)`],
            [0.4, `translate(${amount}px, 0px)`],
            [0.6, `translate(${-amount * 0.6}px, 0px)`],
            [0.8, `translate(${amount * 0.4}px, 0px)`],
            [1, "translate(0px, 0px)"],
          ]
        : [
            [0, "rotate(0deg)"],
            [0.25, `rotate(${-amount}deg)`],
            [0.5, `rotate(${amount}deg)`],
            [0.75, `rotate(${-amount * 0.45}deg)`],
            [1, "rotate(0deg)"],
          ];
    const result = track("transform", values);
    if (kind === "pendulum") {
      result.repeat = params.repeat ?? "infinite";
      result.yoyo = params.yoyo ?? true;
    }
    return [result];
  }
  if (kind === "flash") {
    return [
      track("opacity", [
        [0, 1],
        [0.3, 0.15],
        [0.55, 1],
        [0.75, 0.25],
        [1, 1],
      ]),
    ];
  }
  if (kind === "blur-in" || kind === "blur-out") {
    const exiting = kind === "blur-out";
    return [
      track("filter", [
        [0, exiting ? "blur(0px)" : "blur(18px)"],
        [1, exiting ? "blur(18px)" : "blur(0px)", easing],
      ]),
      track("opacity", [
        [0, exiting ? 1 : 0],
        [1, exiting ? 0 : 1, easing],
      ]),
    ];
  }
  // reveal-up / reveal-left
  return [
    track("transform", [
      [0, `translate(${x * 0.55}px, ${y * 0.55}px) scale(0.96)`],
      [1, "translate(0px, 0px) scale(1)", easing],
    ]),
    track("opacity", [
      [0, 0],
      [0.7, 1, "easeOut"],
    ]),
  ];
}

function reducedMotion(
  kind: string,
  params: MotionPresetParams,
): SceneAnimation[] {
  const exit =
    kind.includes("out") || kind === "fade-out" || kind === "blur-out";
  const duration = Math.min(params.durationInFrames ?? 8, 12);
  return [
    {
      kind: "keyframes",
      property: "opacity",
      frames: [
        { frame: params.delay ?? 0, value: exit ? 1 : 0 },
        {
          frame: (params.delay ?? 0) + duration,
          value: exit ? 0 : 1,
          easing: "easeOut",
        },
      ],
    },
  ];
}

export type MotionPathPoint = { x: number; y: number };

export function motionPath(
  points: readonly MotionPathPoint[],
  options: {
    durationInFrames?: number;
    delay?: number;
    easing?: string;
    orientToPath?: boolean;
    repeat?: number | "infinite";
    yoyo?: boolean;
  } = {},
): SceneAnimation[] {
  if (points.length < 2)
    throw new Error("motionPath() needs at least two points.");
  points.forEach((point) => {
    if (!Number.isFinite(point.x) || !Number.isFinite(point.y)) {
      throw new Error("motionPath() points must be finite numbers.");
    }
  });
  const lengths = points
    .slice(1)
    .map((point, index) =>
      Math.hypot(
        point.x - (points[index]?.x ?? 0),
        point.y - (points[index]?.y ?? 0),
      ),
    );
  const total = lengths.reduce((sum, length) => sum + length, 0) || 1;
  let traveled = 0;
  const duration = options.durationInFrames ?? 30;
  const delay = options.delay ?? 0;
  const frames: SceneAnimation["frames"] = [];
  points.forEach((point, index) => {
    const next = points[Math.min(points.length - 1, index + 1)] ?? point;
    const previous = points[Math.max(0, index - 1)] ?? point;
    const angle =
      (Math.atan2(next.y - previous.y, next.x - previous.x) * 180) / Math.PI;
    const frame = delay + Math.round((traveled / total) * duration);
    const value = `translate(${point.x}px, ${point.y}px)${options.orientToPath ? ` rotate(${angle}deg)` : ""}`;
    const entry = {
      frame,
      value,
      ...(index > 0 ? { easing: options.easing ?? "linear" } : {}),
    };
    const last = frames[frames.length - 1];
    if (last?.frame === frame) frames[frames.length - 1] = entry;
    else frames.push(entry);
    traveled += lengths[index] ?? 0;
  });
  return [
    {
      kind: "keyframes",
      property: "transform",
      frames,
      ...(options.repeat !== undefined ? { repeat: options.repeat } : {}),
      ...(options.yoyo !== undefined ? { yoyo: options.yoyo } : {}),
    },
  ];
}

export function seededSignal(
  property: SceneAnimationTarget,
  options: {
    seed: number;
    durationInFrames: number;
    every?: number;
    center?: number;
    amplitude?: number;
    easing?: string;
  },
): SceneAnimation[] {
  const every = Math.max(1, Math.floor(options.every ?? 2));
  const center = options.center ?? 0;
  const amplitude = options.amplitude ?? 1;
  let state = options.seed >>> 0 || 0x9e3779b9;
  const random = () => {
    state ^= state << 13;
    state ^= state >>> 17;
    state ^= state << 5;
    return (state >>> 0) / 0xffffffff;
  };
  const frames: SceneAnimation["frames"] = [];
  for (let frame = 0; frame <= options.durationInFrames; frame += every) {
    frames.push({
      frame,
      value: center + (random() * 2 - 1) * amplitude,
      ...(frame > 0 ? { easing: options.easing ?? "easeInOut" } : {}),
    });
  }
  if (frames[frames.length - 1]?.frame !== options.durationInFrames) {
    frames.push({
      frame: options.durationInFrames,
      value: center + (random() * 2 - 1) * amplitude,
      easing: options.easing ?? "easeInOut",
    });
  }
  return [{ kind: "keyframes", property, frames }];
}

export function maskReveal(
  options: { durationInFrames?: number; feather?: number; delay?: number } = {},
): SceneAnimation[] {
  const duration = options.durationInFrames ?? 18;
  const delay = options.delay ?? 0;
  return [
    {
      kind: "keyframes",
      property: "mask.opacity",
      frames: [
        { frame: delay, value: 0 },
        { frame: delay + duration, value: 1, easing: "easeOut" },
      ],
    },
    {
      kind: "keyframes",
      property: "mask.feather",
      frames: [
        { frame: delay, value: options.feather ?? 28 },
        { frame: delay + duration, value: 0, easing: "easeOut" },
      ],
    },
  ];
}
