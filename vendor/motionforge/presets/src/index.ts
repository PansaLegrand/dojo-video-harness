import type {
  SceneAnimation,
  SceneAnimationTarget,
  SceneDucking,
  SceneNode,
  SceneStyle,
  VolumeEnvelope,
} from "@motionforge/schema";

export * from "./motion";

export type MotionPresetOptions = {
  /** Length of the motion in frames (default 10). */
  durationInFrames?: number;
  /** Node-local frames to wait before the motion starts (default 0). */
  delay?: number;
  /** Easing expression for the arriving keyframe (per-preset default). */
  easing?: string;
};

type Keyframes = SceneAnimation["frames"];

/** Shifts frames by `delay`, holding the first value from frame 0. */
function delayed(frames: Keyframes, delay: number): Keyframes {
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

function animation(
  property: SceneAnimationTarget,
  frames: Keyframes,
): SceneAnimation {
  return { kind: "keyframes", property, frames };
}

/** Scale-up entrance with a fade: scale(fromScale) → scale(1), opacity 0 → 1. */
export function popIn(
  options: MotionPresetOptions & { fromScale?: number } = {},
): SceneAnimation[] {
  const duration = options.durationInFrames ?? 10;
  const delay = options.delay ?? 0;
  const easing = options.easing ?? "spring(0.3)";
  const fromScale = options.fromScale ?? 0.8;

  return [
    animation(
      "transform",
      delayed(
        [
          { frame: 0, value: `scale(${fromScale})` },
          { frame: duration, value: "scale(1)", easing },
        ],
        delay,
      ),
    ),
    animation(
      "opacity",
      delayed(
        [
          { frame: 0, value: 0 },
          {
            frame: Math.max(1, Math.round(duration * 0.6)),
            value: 1,
            easing: "easeOut",
          },
        ],
        delay,
      ),
    ),
  ];
}

/** Fade in while drifting up from `distance` pixels below. */
export function fadeUp(
  options: MotionPresetOptions & { distance?: number } = {},
): SceneAnimation[] {
  const duration = options.durationInFrames ?? 12;
  const delay = options.delay ?? 0;
  const easing = options.easing ?? "easeOut";
  const distance = options.distance ?? 40;

  return [
    animation(
      "transform",
      delayed(
        [
          { frame: 0, value: `translate(0px, ${distance}px)` },
          { frame: duration, value: "translate(0px, 0px)", easing },
        ],
        delay,
      ),
    ),
    animation(
      "opacity",
      delayed(
        [
          { frame: 0, value: 0 },
          { frame: duration, value: 1, easing },
        ],
        delay,
      ),
    ),
  ];
}

/** Slide in from a screen edge direction over `distance` pixels. */
export function slideIn(
  direction: "left" | "right" | "up" | "down",
  options: MotionPresetOptions & { distance?: number } = {},
): SceneAnimation[] {
  const duration = options.durationInFrames ?? 12;
  const delay = options.delay ?? 0;
  const easing = options.easing ?? "cubic-bezier(0.22, 1, 0.36, 1)";
  const distance = options.distance ?? 120;
  const offsets: Record<typeof direction, [number, number]> = {
    left: [-distance, 0],
    right: [distance, 0],
    up: [0, -distance],
    down: [0, distance],
  };
  const [x, y] = offsets[direction];

  return [
    animation(
      "transform",
      delayed(
        [
          { frame: 0, value: `translate(${x}px, ${y}px)` },
          { frame: duration, value: "translate(0px, 0px)", easing },
        ],
        delay,
      ),
    ),
    animation(
      "opacity",
      delayed(
        [
          { frame: 0, value: 0 },
          {
            frame: Math.max(1, Math.round(duration * 0.5)),
            value: 1,
            easing: "easeOut",
          },
        ],
        delay,
      ),
    ),
  ];
}

/** A single scale pulse: 1 → peak → 1. */
export function pulse(
  options: MotionPresetOptions & { peak?: number } = {},
): SceneAnimation[] {
  const duration = options.durationInFrames ?? 14;
  const delay = options.delay ?? 0;
  const easing = options.easing ?? "easeInOut";
  const peak = options.peak ?? 1.08;
  const mid = Math.max(1, Math.round(duration / 2));

  return [
    animation(
      "transform",
      delayed(
        [
          { frame: 0, value: "scale(1)" },
          { frame: mid, value: `scale(${peak})`, easing },
          { frame: duration, value: "scale(1)", easing },
        ],
        delay,
      ),
    ),
  ];
}

/**
 * Merges keyframe tracks that target the same property into one track each.
 *
 * The scene evaluator applies tracks in order with last-write-wins per
 * property, and a track holds its first value before its first frame — so an
 * exit track like fadeOut (which holds `1` from frame 0) silently masks an
 * earlier entrance track's 0 → 1 ramp for the whole timeline. Merging keeps
 * enter + exit combinations (popIn + fadeOut) composing the way authors mean.
 *
 * Merge rule per property, in track order: drop the later track's leading
 * frames that sit at/before the earlier result's last frame while holding the
 * earlier result's final value (pure hold artifacts), then append. If a real
 * overlap remains, the later track wins from its first kept frame onward.
 */
export function mergeAnimationsByProperty(
  animations: SceneAnimation[],
): SceneAnimation[] {
  const order: SceneAnimationTarget[] = [];
  const byProperty = new Map<SceneAnimationTarget, SceneAnimation[]>();

  for (const entry of animations) {
    const group = byProperty.get(entry.property);

    if (group) {
      group.push(entry);
    } else {
      order.push(entry.property);
      byProperty.set(entry.property, [entry]);
    }
  }

  return order.map((property) => {
    const group = byProperty.get(property) ?? [];

    if (group.length === 1) {
      return group[0] as SceneAnimation;
    }

    const frames = group
      .map((entry) => entry.frames)
      .reduce((merged, next) => mergeKeyframeTracks(merged, next));

    return { kind: "keyframes" as const, property, frames };
  });
}

function mergeKeyframeTracks(
  earlier: SceneAnimation["frames"],
  later: SceneAnimation["frames"],
): SceneAnimation["frames"] {
  if (earlier.length === 0) {
    return later;
  }

  if (later.length === 0) {
    return earlier;
  }

  const lastEarlier = earlier[earlier.length - 1];
  let laterKept = [...later];

  while (
    laterKept.length > 0 &&
    lastEarlier &&
    (laterKept[0] as { frame: number }).frame <= lastEarlier.frame &&
    (laterKept[0] as { value: unknown }).value === lastEarlier.value
  ) {
    laterKept = laterKept.slice(1);
  }

  if (laterKept.length === 0) {
    return earlier;
  }

  const firstLater = laterKept[0] as { frame: number };
  const earlierKept = earlier.filter((entry) => entry.frame < firstLater.frame);

  return [...earlierKept, ...laterKept];
}

export type MediaLookCategory =
  | "natural"
  | "social"
  | "cinematic"
  | "retro"
  | "portrait"
  | "backdrop";

export type MediaLookPreset = {
  name: string;
  description: string;
  category: MediaLookCategory;
  style: SceneStyle;
};

export const mediaLooks = {
  cleanProduct: {
    name: "Clean Product",
    description: "Neutral contrast lift for product shots and UI footage.",
    category: "natural",
    style: {
      filter: "brightness(1.04) contrast(1.08) saturate(1.04)",
    },
  },
  punchySocial: {
    name: "Punchy Social",
    description: "High-energy saturation and contrast for short-form edits.",
    category: "social",
    style: {
      filter: "brightness(1.08) contrast(1.22) saturate(1.35)",
    },
  },
  cinematicWarm: {
    name: "Cinematic Warm",
    description: "Warm, slightly muted grade for narrative clips.",
    category: "cinematic",
    style: {
      filter: "brightness(0.98) contrast(1.14) saturate(0.92) sepia(0.18)",
    },
  },
  coolNoir: {
    name: "Cool Noir",
    description: "Low-saturation blue-gray drama with strong contrast.",
    category: "cinematic",
    style: {
      filter:
        "brightness(0.9) contrast(1.28) saturate(0.45) hue-rotate(190deg)",
    },
  },
  retroTape: {
    name: "Retro Tape",
    description: "Soft analog warmth with faded contrast.",
    category: "retro",
    style: {
      filter: "brightness(1.02) contrast(0.92) saturate(1.22) sepia(0.28)",
    },
  },
  softPortrait: {
    name: "Soft Portrait",
    description:
      "Gentle brightness and lower contrast for people-focused clips.",
    category: "portrait",
    style: {
      filter: "brightness(1.08) contrast(0.94) saturate(1.08)",
    },
  },
  blurredBackdrop: {
    name: "Blurred Backdrop",
    description:
      "Dimmed blurred media for background layers behind foreground text.",
    category: "backdrop",
    style: {
      filter: "brightness(0.72) contrast(1.05) saturate(0.9) blur(18px)",
    },
  },
} satisfies Record<string, MediaLookPreset>;

export type MediaLookKey = keyof typeof mediaLooks;

export const mediaLookEntries = Object.entries(mediaLooks) as Array<
  [MediaLookKey, MediaLookPreset]
>;

export function mediaLook(
  key: MediaLookKey,
  overrides: SceneStyle = {},
): SceneStyle {
  return {
    ...mediaLooks[key].style,
    ...overrides,
  };
}

export type CompositionSize = {
  width: number;
  height: number;
};

export type SafeAreaProfileKey = "vertical" | "square" | "landscape";

export type SafeAreaProfile = {
  top: number;
  right: number;
  bottom: number;
  left: number;
  horizontalBasis: "shortSide" | "width";
  verticalBasis: "shortSide" | "height";
};

export const safeAreaProfiles = {
  vertical: {
    top: 0.075,
    right: 0.067,
    bottom: 0.085,
    left: 0.067,
    horizontalBasis: "shortSide",
    verticalBasis: "height",
  },
  square: {
    top: 0.067,
    right: 0.067,
    bottom: 0.067,
    left: 0.067,
    horizontalBasis: "shortSide",
    verticalBasis: "shortSide",
  },
  landscape: {
    top: 0.06,
    right: 0.05,
    bottom: 0.06,
    left: 0.05,
    horizontalBasis: "width",
    verticalBasis: "height",
  },
} satisfies Record<SafeAreaProfileKey, SafeAreaProfile>;

export type SafeAreaInsets = {
  top: number;
  right: number;
  bottom: number;
  left: number;
};

export type SafeAreaInput =
  | "auto"
  | SafeAreaProfileKey
  | boolean
  | number
  | {
      x?: number;
      y?: number;
      top?: number;
      right?: number;
      bottom?: number;
      left?: number;
    };

export type SafeAreaAnchor =
  | "center"
  | "top"
  | "bottom"
  | "title"
  | "subtitle"
  | "lowerThird"
  | "statCallout";

export type SafeAreaBoxOptions = {
  safeArea?: SafeAreaInput;
  width?: number;
  height?: number;
  widthRatio?: number;
  heightRatio?: number;
  align?: "left" | "center" | "right";
  offsetX?: number;
  offsetY?: number;
};

export type SafeAreaBox = Required<
  Pick<SceneStyle, "position" | "left" | "top" | "width" | "height">
>;

type SafeAreaAnchorDefaults = {
  width: number;
  height: number;
  top: number;
  align: "left" | "center" | "right";
};

export function inferSafeAreaProfile(
  size: CompositionSize,
): SafeAreaProfileKey {
  const aspect = size.width / size.height;

  if (aspect < 0.85) {
    return "vertical";
  }

  if (aspect > 1.25) {
    return "landscape";
  }

  return "square";
}

export function resolveSafeArea(
  size: CompositionSize,
  input: SafeAreaInput = "auto",
): SafeAreaInsets {
  if (input === false) {
    return { top: 0, right: 0, bottom: 0, left: 0 };
  }

  if (typeof input === "number") {
    const inset = Math.round(input);

    return { top: inset, right: inset, bottom: inset, left: inset };
  }

  if (typeof input === "object") {
    const defaultInsets = resolveSafeArea(size, "auto");

    return {
      top: Math.round(input.top ?? input.y ?? defaultInsets.top),
      right: Math.round(input.right ?? input.x ?? defaultInsets.right),
      bottom: Math.round(input.bottom ?? input.y ?? defaultInsets.bottom),
      left: Math.round(input.left ?? input.x ?? defaultInsets.left),
    };
  }

  const profileKey =
    input === "auto" || input === true ? inferSafeAreaProfile(size) : input;
  const profile = safeAreaProfiles[profileKey];
  const shortSide = Math.min(size.width, size.height);
  const horizontalBasis =
    profile.horizontalBasis === "width" ? size.width : shortSide;
  const verticalBasis =
    profile.verticalBasis === "height" ? size.height : shortSide;

  return {
    top: Math.round(profile.top * verticalBasis),
    right: Math.round(profile.right * horizontalBasis),
    bottom: Math.round(profile.bottom * verticalBasis),
    left: Math.round(profile.left * horizontalBasis),
  };
}

export function safeAreaBox(
  size: CompositionSize,
  anchor: SafeAreaAnchor,
  options: SafeAreaBoxOptions = {},
): SafeAreaBox {
  const insets = resolveSafeArea(size, options.safeArea ?? "auto");
  const availableWidth = Math.max(1, size.width - insets.left - insets.right);
  const availableHeight = Math.max(1, size.height - insets.top - insets.bottom);
  const defaults = safeAreaAnchorDefaults(size, anchor, insets);
  const width = Math.max(
    1,
    Math.min(
      availableWidth,
      Math.round(
        options.width ??
          (options.widthRatio === undefined
            ? defaults.width
            : availableWidth * options.widthRatio),
      ),
    ),
  );
  const height = Math.max(
    1,
    Math.min(
      availableHeight,
      Math.round(
        options.height ??
          (options.heightRatio === undefined
            ? defaults.height
            : availableHeight * options.heightRatio),
      ),
    ),
  );
  const align = options.align ?? defaults.align;
  const left =
    align === "left"
      ? insets.left
      : align === "right"
        ? size.width - insets.right - width
        : insets.left + Math.round((availableWidth - width) / 2);
  const top = safeAreaAnchorTop(
    size,
    anchor,
    insets,
    availableHeight,
    height,
    defaults.top,
  );

  return {
    position: "absolute",
    left: left + Math.round(options.offsetX ?? 0),
    top: top + Math.round(options.offsetY ?? 0),
    width,
    height,
  };
}

function safeAreaAnchorDefaults(
  size: CompositionSize,
  anchor: SafeAreaAnchor,
  insets: SafeAreaInsets,
): SafeAreaAnchorDefaults {
  const availableWidth = Math.max(1, size.width - insets.left - insets.right);
  const availableHeight = Math.max(1, size.height - insets.top - insets.bottom);
  const centerHeight = Math.round(size.height * 0.2);
  const titleHeight = Math.round(size.height * 0.18);
  const captionHeight = Math.round(size.height * 0.12);
  const lowerThirdHeight = Math.round(size.height * 0.15);
  const statHeight = Math.round(size.height * 0.18);

  switch (anchor) {
    case "title":
      return {
        width: availableWidth,
        height: titleHeight,
        top: insets.top + Math.round(size.height * 0.05),
        align: "center",
      };
    case "subtitle":
      return {
        width: availableWidth,
        height: captionHeight,
        top:
          size.height -
          insets.bottom -
          Math.round(size.height * 0.11) -
          captionHeight,
        align: "center",
      };
    case "lowerThird":
      return {
        width: Math.round(availableWidth * 0.74),
        height: lowerThirdHeight,
        top:
          size.height -
          insets.bottom -
          Math.round(size.height * 0.12) -
          lowerThirdHeight,
        align: "left",
      };
    case "statCallout":
      return {
        width: Math.round(availableWidth * 0.42),
        height: statHeight,
        top: insets.top + Math.round(size.height * 0.24),
        align: "right",
      };
    case "top":
      return {
        width: availableWidth,
        height: titleHeight,
        top: insets.top,
        align: "center",
      };
    case "bottom":
      return {
        width: availableWidth,
        height: captionHeight,
        top: size.height - insets.bottom - captionHeight,
        align: "center",
      };
    case "center":
      return {
        width: availableWidth,
        height: centerHeight,
        top: insets.top + Math.round((availableHeight - centerHeight) / 2),
        align: "center",
      };
  }
}

function safeAreaAnchorTop(
  size: CompositionSize,
  anchor: SafeAreaAnchor,
  insets: SafeAreaInsets,
  availableHeight: number,
  height: number,
  fallbackTop: number,
): number {
  switch (anchor) {
    case "center":
      return insets.top + Math.round((availableHeight - height) / 2);
    case "bottom":
      return size.height - insets.bottom - height;
    case "subtitle":
      return (
        size.height - insets.bottom - Math.round(size.height * 0.11) - height
      );
    case "lowerThird":
      return (
        size.height - insets.bottom - Math.round(size.height * 0.12) - height
      );
    case "statCallout":
    case "title":
    case "top":
      return fallbackTop;
  }
}

export type ClipLayoutCategory =
  | "single"
  | "pip"
  | "split"
  | "grid"
  | "backdrop"
  | "safe-area";

export type ClipLayoutPreset = {
  name: string;
  description: string;
  category: ClipLayoutCategory;
  style: SceneStyle;
};

export const clipLayouts = {
  fullscreen: {
    name: "Fullscreen",
    description: "Fill the whole composition with cropped media.",
    category: "single",
    style: {
      position: "absolute",
      left: 0,
      top: 0,
      width: "100%",
      height: "100%",
      objectFit: "cover",
      objectPosition: "center center",
    },
  },
  containCenter: {
    name: "Contain Center",
    description: "Show the full source inside the composition bounds.",
    category: "single",
    style: {
      position: "absolute",
      left: 0,
      top: 0,
      width: "100%",
      height: "100%",
      objectFit: "contain",
      objectPosition: "center center",
    },
  },
  pictureInPicture: {
    name: "Picture In Picture",
    description: "Small floating media card in the bottom-right corner.",
    category: "pip",
    style: {
      position: "absolute",
      right: 48,
      bottom: 48,
      width: 360,
      height: 640,
      objectFit: "cover",
      objectPosition: "center center",
      borderRadius: 24,
      border: "3px solid rgba(255,255,255,0.88)",
      boxShadow: "0px 20px 52px rgba(0,0,0,0.36)",
      overflow: "hidden",
      zIndex: 20,
    },
  },
  splitLeft: {
    name: "Split Left",
    description: "Left half of a two-up split screen.",
    category: "split",
    style: {
      position: "absolute",
      left: 0,
      top: 0,
      width: "50%",
      height: "100%",
      objectFit: "cover",
      objectPosition: "center center",
    },
  },
  splitRight: {
    name: "Split Right",
    description: "Right half of a two-up split screen.",
    category: "split",
    style: {
      position: "absolute",
      right: 0,
      top: 0,
      width: "50%",
      height: "100%",
      objectFit: "cover",
      objectPosition: "center center",
    },
  },
  gridTopLeft: {
    name: "Grid Top Left",
    description: "Top-left cell of a 2x2 grid.",
    category: "grid",
    style: gridCellStyle(0, 0),
  },
  gridTopRight: {
    name: "Grid Top Right",
    description: "Top-right cell of a 2x2 grid.",
    category: "grid",
    style: gridCellStyle(1, 0),
  },
  gridBottomLeft: {
    name: "Grid Bottom Left",
    description: "Bottom-left cell of a 2x2 grid.",
    category: "grid",
    style: gridCellStyle(0, 1),
  },
  gridBottomRight: {
    name: "Grid Bottom Right",
    description: "Bottom-right cell of a 2x2 grid.",
    category: "grid",
    style: gridCellStyle(1, 1),
  },
  blurredBackground: {
    name: "Blurred Background",
    description: "Full-frame blurred media behind foreground content.",
    category: "backdrop",
    style: {
      position: "absolute",
      left: "-8%",
      top: "-8%",
      width: "116%",
      height: "116%",
      objectFit: "cover",
      objectPosition: "center center",
      filter: "brightness(0.68) saturate(0.9) blur(22px)",
    },
  },
  phoneSafeVertical: {
    name: "Phone Safe Vertical",
    description: "Vertical full-frame crop with safe center emphasis.",
    category: "safe-area",
    style: {
      position: "absolute",
      left: 0,
      top: 0,
      width: "100%",
      height: "100%",
      objectFit: "cover",
      objectPosition: "center center",
    },
  },
} satisfies Record<string, ClipLayoutPreset>;

export type ClipLayoutKey = keyof typeof clipLayouts;

export const clipLayoutEntries = Object.entries(clipLayouts) as Array<
  [ClipLayoutKey, ClipLayoutPreset]
>;

export function clipLayout(
  key: ClipLayoutKey,
  overrides: SceneStyle = {},
): SceneStyle {
  return {
    ...clipLayouts[key].style,
    ...overrides,
  };
}

export type TransitionTemplateKey =
  | "fade"
  | "dipToBlack"
  | "flash"
  | "wipeLeft"
  | "wipeRight"
  | "zoom";

export type TransitionTemplate = {
  name: string;
  description: string;
  category: "soft" | "section" | "graphic" | "energy";
};

export const transitionTemplates = {
  fade: {
    name: "Fade",
    description: "General-purpose soft overlay transition.",
    category: "soft",
  },
  dipToBlack: {
    name: "Dip To Black",
    description: "Full black section break between ideas or clips.",
    category: "section",
  },
  flash: {
    name: "Flash",
    description: "Bright beat accent for fast edits and emphasis.",
    category: "energy",
  },
  wipeLeft: {
    name: "Wipe Left",
    description: "Graphic wipe moving in from the right edge.",
    category: "graphic",
  },
  wipeRight: {
    name: "Wipe Right",
    description: "Graphic wipe moving in from the left edge.",
    category: "graphic",
  },
  zoom: {
    name: "Zoom",
    description: "Energetic opacity and scale pulse transition.",
    category: "energy",
  },
} satisfies Record<TransitionTemplateKey, TransitionTemplate>;

export const transitionTemplateEntries = Object.entries(
  transitionTemplates,
) as Array<[TransitionTemplateKey, TransitionTemplate]>;

export type TransitionOverlayOptions = {
  id?: string;
  at?: number;
  duration?: number;
  color?: string;
  zIndex?: number;
};

export function transitionOverlay(
  template: TransitionTemplateKey,
  options: TransitionOverlayOptions = {},
): SceneNode {
  const id = options.id ?? `${template}-transition`;
  const duration = Math.max(1, options.duration ?? 18);
  const color =
    options.color ?? (template === "flash" ? "#ffffff" : "rgba(0,0,0,1)");
  const zIndex = options.zIndex ?? 1000;

  if (template === "wipeLeft" || template === "wipeRight") {
    const fromX =
      template === "wipeLeft"
        ? "translate(100%, 0px)"
        : "translate(-100%, 0px)";
    const toX = "translate(0%, 0px)";

    return {
      id,
      type: "div",
      from: options.at,
      duration,
      style: fullFrameTransitionStyle(color, zIndex),
      animations: [
        animation("transform", [
          { frame: 0, value: fromX },
          { frame: duration - 1, value: toX, easing: "easeInOut" },
        ]),
      ],
    };
  }

  if (template === "zoom") {
    return {
      id,
      type: "div",
      from: options.at,
      duration,
      style: {
        ...fullFrameTransitionStyle(color, zIndex),
        transformOrigin: "center center",
      },
      animations: [
        animation("opacity", [
          { frame: 0, value: 0 },
          {
            frame: Math.max(1, Math.round(duration * 0.45)),
            value: 0.72,
            easing: "easeOut",
          },
          { frame: duration - 1, value: 0, easing: "easeIn" },
        ]),
        animation("transform", [
          { frame: 0, value: "scale(0.92)" },
          { frame: duration - 1, value: "scale(1.08)", easing: "easeOut" },
        ]),
      ],
    };
  }

  const peak = template === "fade" ? 1 : template === "dipToBlack" ? 1 : 0.88;

  return {
    id,
    type: "div",
    from: options.at,
    duration,
    style: fullFrameTransitionStyle(color, zIndex),
    animations: [
      animation("opacity", [
        { frame: 0, value: 0 },
        {
          frame: Math.max(1, Math.round(duration / 2)),
          value: peak,
          easing: template === "flash" ? "easeOut" : "easeInOut",
        },
        { frame: duration - 1, value: 0, easing: "easeIn" },
      ]),
    ],
  };
}

export type TextOverlayCategory =
  | "title"
  | "lower-third"
  | "quote"
  | "stat"
  | "banner"
  | "social";

export type TextOverlaySlot =
  | "kicker"
  | "title"
  | "subtitle"
  | "body"
  | "value"
  | "label"
  | "attribution";

export type TextOverlayTemplate = {
  name: string;
  description: string;
  category: TextOverlayCategory;
  required: TextOverlaySlot[];
  optional?: TextOverlaySlot[];
};

export const textOverlayTemplates = {
  titleCard: {
    name: "Title Card",
    description:
      "Centered editorial title stack for openings and section cards.",
    category: "title",
    required: ["title"],
    optional: ["kicker", "subtitle"],
  },
  lowerThird: {
    name: "Lower Third",
    description: "Speaker or subject label anchored near the bottom edge.",
    category: "lower-third",
    required: ["title"],
    optional: ["subtitle", "kicker"],
  },
  quoteCard: {
    name: "Quote Card",
    description: "Large pull quote with optional attribution.",
    category: "quote",
    required: ["body"],
    optional: ["attribution", "kicker"],
  },
  statCallout: {
    name: "Stat Callout",
    description: "Metric card with a large value and supporting label.",
    category: "stat",
    required: ["value"],
    optional: ["label", "subtitle"],
  },
  announcementBanner: {
    name: "Announcement Banner",
    description: "High-contrast horizontal announcement strip.",
    category: "banner",
    required: ["title"],
    optional: ["subtitle", "kicker"],
  },
  socialHook: {
    name: "Social Hook",
    description: "Short-form hook text with a fitted highlight backing.",
    category: "social",
    required: ["title"],
    optional: ["subtitle"],
  },
  chapterTitle: {
    name: "Chapter Title",
    description: "Minimal section title with a short accent rule.",
    category: "title",
    required: ["title"],
    optional: ["kicker", "subtitle"],
  },
} satisfies Record<string, TextOverlayTemplate>;

export type TextOverlayTemplateKey = keyof typeof textOverlayTemplates;

export const textOverlayTemplateEntries = Object.entries(
  textOverlayTemplates,
) as Array<[TextOverlayTemplateKey, TextOverlayTemplate]>;

export type TextOverlayOptions = {
  template?: TextOverlayTemplateKey;
  id?: string;
  from?: number;
  duration?: number;
  composition?: CompositionSize;
  safeArea?: SafeAreaInput;
  kicker?: string;
  title?: string;
  subtitle?: string;
  body?: string;
  value?: string;
  label?: string;
  attribution?: string;
  accentColor?: string;
  style?: SceneStyle;
  kickerStyle?: SceneStyle;
  titleStyle?: SceneStyle;
  subtitleStyle?: SceneStyle;
  bodyStyle?: SceneStyle;
  valueStyle?: SceneStyle;
  labelStyle?: SceneStyle;
  attributionStyle?: SceneStyle;
  enter?: SceneAnimation[] | false;
};

/**
 * Production-shaped text overlays compiled to ordinary scene nodes. Template
 * ids are stable so apps and agents can patch generated children directly.
 */
export function textOverlay(options: TextOverlayOptions): SceneNode {
  const template = options.template ?? "titleCard";

  switch (template) {
    case "titleCard":
      return titleCardOverlay(options);
    case "lowerThird":
      return lowerThirdOverlay(options);
    case "quoteCard":
      return quoteCardOverlay(options);
    case "statCallout":
      return statCalloutOverlay(options);
    case "announcementBanner":
      return announcementBannerOverlay(options);
    case "socialHook":
      return socialHookOverlay(options);
    case "chapterTitle":
      return chapterTitleOverlay(options);
  }
}

function titleCardOverlay(options: TextOverlayOptions): SceneNode {
  const id = overlayId(options, "title-card");

  return overlayContainer(
    id,
    options,
    textOverlayContainerStyle(
      options,
      "center",
      {
        position: "absolute",
        left: 96,
        right: 96,
        top: 560,
        height: 560,
      },
      { heightRatio: 0.29 },
      {
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        gap: 24,
      },
    ),
    [
      maybeTextNode(
        id,
        "kicker",
        options.kicker,
        robustTextStyle(
          "kicker",
          eyebrowStyle(options.accentColor ?? "#38bdf8"),
          options.kickerStyle,
        ),
      ),
      textNode(
        id,
        "title",
        requiredSlot(options, "title"),
        robustTextStyle(
          "title",
          {
            width: "100%",
            fontFamily: "Inter, system-ui, Arial, sans-serif",
            fontSize: 108,
            fontWeight: 900,
            lineHeight: 0.95,
            color: "#ffffff",
            textAlign: "center",
            textShadow: "0px 12px 42px rgba(0,0,0,0.48)",
          },
          options.titleStyle,
        ),
      ),
      maybeTextNode(
        id,
        "subtitle",
        options.subtitle,
        robustTextStyle(
          "subtitle",
          {
            width: "100%",
            fontFamily: "Inter, system-ui, Arial, sans-serif",
            fontSize: 42,
            fontWeight: 700,
            lineHeight: 1.18,
            color: "rgba(226,232,240,0.88)",
            textAlign: "center",
          },
          options.subtitleStyle,
        ),
      ),
    ],
  );
}

function lowerThirdOverlay(options: TextOverlayOptions): SceneNode {
  const id = overlayId(options, "lower-third");
  const accent = options.accentColor ?? "#f59e0b";

  return overlayContainer(
    id,
    options,
    textOverlayContainerStyle(
      options,
      "lowerThird",
      {
        position: "absolute",
        left: 72,
        bottom: 132,
        width: 820,
        minHeight: 190,
      },
      {},
      {
        padding: 28,
        display: "flex",
        flexDirection: "column",
        justifyContent: "center",
        gap: 10,
        backgroundColor: "rgba(15,23,42,0.78)",
        borderRadius: 18,
        border: `2px solid ${accent}`,
        boxShadow: "0px 18px 48px rgba(0,0,0,0.32)",
      },
    ),
    [
      maybeTextNode(
        id,
        "kicker",
        options.kicker,
        robustTextStyle("kicker", eyebrowStyle(accent), options.kickerStyle),
      ),
      textNode(
        id,
        "title",
        requiredSlot(options, "title"),
        robustTextStyle(
          "title",
          {
            width: "100%",
            fontFamily: "Inter, system-ui, Arial, sans-serif",
            fontSize: 58,
            fontWeight: 900,
            lineHeight: 1,
            color: "#ffffff",
          },
          options.titleStyle,
        ),
      ),
      maybeTextNode(
        id,
        "subtitle",
        options.subtitle,
        robustTextStyle(
          "subtitle",
          {
            width: "100%",
            fontFamily: "Inter, system-ui, Arial, sans-serif",
            fontSize: 31,
            fontWeight: 700,
            lineHeight: 1.16,
            color: "#cbd5e1",
          },
          options.subtitleStyle,
        ),
      ),
    ],
  );
}

function quoteCardOverlay(options: TextOverlayOptions): SceneNode {
  const id = overlayId(options, "quote-card");

  return overlayContainer(
    id,
    options,
    textOverlayContainerStyle(
      options,
      "center",
      {
        position: "absolute",
        left: 90,
        top: 610,
        width: 900,
        minHeight: 520,
      },
      { widthRatio: 0.82, heightRatio: 0.27 },
      {
        padding: 54,
        display: "flex",
        flexDirection: "column",
        justifyContent: "center",
        gap: 28,
        backgroundColor: "rgba(248,250,252,0.92)",
        borderRadius: 28,
        boxShadow: "0px 28px 70px rgba(15,23,42,0.28)",
      },
    ),
    [
      maybeTextNode(
        id,
        "kicker",
        options.kicker,
        robustTextStyle(
          "kicker",
          eyebrowStyle(options.accentColor ?? "#2563eb"),
          options.kickerStyle,
        ),
      ),
      textNode(
        id,
        "body",
        requiredSlot(options, "body"),
        robustTextStyle(
          "body",
          {
            width: "100%",
            fontFamily: "Georgia, Times New Roman, serif",
            fontSize: 64,
            fontWeight: 700,
            lineHeight: 1.12,
            color: "#0f172a",
            textAlign: "center",
          },
          options.bodyStyle,
        ),
      ),
      maybeTextNode(
        id,
        "attribution",
        options.attribution,
        robustTextStyle(
          "attribution",
          {
            width: "100%",
            fontFamily: "Inter, system-ui, Arial, sans-serif",
            fontSize: 30,
            fontWeight: 800,
            color: "#475569",
            textAlign: "center",
          },
          options.attributionStyle,
        ),
      ),
    ],
  );
}

function statCalloutOverlay(options: TextOverlayOptions): SceneNode {
  const id = overlayId(options, "stat-callout");
  const accent = options.accentColor ?? "#14b8a6";

  return overlayContainer(
    id,
    options,
    textOverlayContainerStyle(
      options,
      "statCallout",
      {
        position: "absolute",
        right: 72,
        top: 1030,
        width: 430,
        minHeight: 320,
      },
      { widthRatio: 0.4, align: "right" },
      {
        padding: 34,
        display: "flex",
        flexDirection: "column",
        justifyContent: "center",
        gap: 12,
        backgroundColor: "rgba(2,6,23,0.84)",
        borderRadius: 24,
        border: `2px solid ${accent}`,
        boxShadow: "0px 22px 60px rgba(0,0,0,0.34)",
      },
    ),
    [
      textNode(
        id,
        "value",
        requiredSlot(options, "value"),
        robustTextStyle(
          "value",
          {
            width: "100%",
            fontFamily: "Inter, system-ui, Arial, sans-serif",
            fontSize: 96,
            fontWeight: 950,
            lineHeight: 0.92,
            color: accent,
            textAlign: "left",
          },
          options.valueStyle,
        ),
      ),
      maybeTextNode(
        id,
        "label",
        options.label,
        robustTextStyle(
          "label",
          {
            width: "100%",
            fontFamily: "Inter, system-ui, Arial, sans-serif",
            fontSize: 34,
            fontWeight: 900,
            color: "#ffffff",
            lineHeight: 1.05,
          },
          options.labelStyle,
        ),
      ),
      maybeTextNode(
        id,
        "subtitle",
        options.subtitle,
        robustTextStyle(
          "subtitle",
          {
            width: "100%",
            fontFamily: "Inter, system-ui, Arial, sans-serif",
            fontSize: 25,
            fontWeight: 700,
            color: "#94a3b8",
            lineHeight: 1.18,
          },
          options.subtitleStyle,
        ),
      ),
    ],
  );
}

function announcementBannerOverlay(options: TextOverlayOptions): SceneNode {
  const id = overlayId(options, "announcement-banner");
  const accent = options.accentColor ?? "#ef4444";

  return overlayContainer(
    id,
    options,
    textOverlayContainerStyle(
      options,
      "top",
      {
        position: "absolute",
        left: 0,
        top: 220,
        width: "100%",
        minHeight: 190,
      },
      { safeArea: false, widthRatio: 1, heightRatio: 0.12 },
      {
        padding: 36,
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        gap: 10,
        backgroundColor: accent,
        boxShadow: "0px 20px 50px rgba(0,0,0,0.28)",
      },
    ),
    [
      maybeTextNode(
        id,
        "kicker",
        options.kicker,
        robustTextStyle(
          "kicker",
          {
            width: "100%",
            fontFamily: "Inter, system-ui, Arial, sans-serif",
            fontSize: 28,
            fontWeight: 900,
            letterSpacing: 3,
            color: "rgba(255,255,255,0.82)",
            textAlign: "center",
          },
          options.kickerStyle,
        ),
      ),
      textNode(
        id,
        "title",
        requiredSlot(options, "title"),
        robustTextStyle(
          "title",
          {
            width: "100%",
            fontFamily: "Inter, system-ui, Arial, sans-serif",
            fontSize: 72,
            fontWeight: 950,
            lineHeight: 0.95,
            color: "#ffffff",
            textAlign: "center",
            textStroke: "3px rgba(0,0,0,0.18)",
          },
          options.titleStyle,
        ),
      ),
      maybeTextNode(
        id,
        "subtitle",
        options.subtitle,
        robustTextStyle(
          "subtitle",
          {
            width: "100%",
            fontFamily: "Inter, system-ui, Arial, sans-serif",
            fontSize: 30,
            fontWeight: 800,
            color: "rgba(255,255,255,0.88)",
            textAlign: "center",
          },
          options.subtitleStyle,
        ),
      ),
    ],
  );
}

function socialHookOverlay(options: TextOverlayOptions): SceneNode {
  const id = overlayId(options, "social-hook");
  const accent = options.accentColor ?? "#facc15";

  return overlayContainer(
    id,
    options,
    textOverlayContainerStyle(
      options,
      "center",
      {
        position: "absolute",
        left: 72,
        right: 72,
        top: 500,
        minHeight: 520,
      },
      { heightRatio: 0.27 },
      {
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        gap: 22,
      },
    ),
    [
      textNode(
        id,
        "title",
        requiredSlot(options, "title"),
        robustTextStyle(
          "title",
          {
            width: "100%",
            fontFamily: "Poppins, Inter, system-ui, sans-serif",
            fontSize: 98,
            fontWeight: 950,
            lineHeight: 0.95,
            color: "#0f172a",
            textAlign: "center",
            textBackgroundColor: accent,
            textBackgroundPaddingX: 34,
            textBackgroundPaddingY: 16,
            textBackgroundRadius: 22,
            textShadow: "0px 6px 0px rgba(255,255,255,0.22)",
            textStroke: "4px rgba(255,255,255,0.95)",
          },
          options.titleStyle,
        ),
      ),
      maybeTextNode(
        id,
        "subtitle",
        options.subtitle,
        robustTextStyle(
          "subtitle",
          {
            width: "92%",
            fontFamily: "Inter, system-ui, Arial, sans-serif",
            fontSize: 38,
            fontWeight: 800,
            lineHeight: 1.14,
            color: "#ffffff",
            textAlign: "center",
            textStroke: "4px rgba(0,0,0,0.72)",
          },
          options.subtitleStyle,
        ),
      ),
    ],
  );
}

function chapterTitleOverlay(options: TextOverlayOptions): SceneNode {
  const id = overlayId(options, "chapter-title");
  const accent = options.accentColor ?? "#a78bfa";

  return overlayContainer(
    id,
    options,
    textOverlayContainerStyle(
      options,
      "center",
      {
        position: "absolute",
        left: 96,
        right: 96,
        top: 720,
        minHeight: 340,
      },
      { heightRatio: 0.18 },
      {
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        gap: 24,
      },
    ),
    [
      {
        id: `${id}-rule`,
        type: "div",
        style: {
          width: 180,
          height: 8,
          backgroundColor: accent,
          borderRadius: 999,
        },
      },
      maybeTextNode(
        id,
        "kicker",
        options.kicker,
        robustTextStyle("kicker", eyebrowStyle(accent), options.kickerStyle),
      ),
      textNode(
        id,
        "title",
        requiredSlot(options, "title"),
        robustTextStyle(
          "title",
          {
            width: "100%",
            fontFamily: "Inter, system-ui, Arial, sans-serif",
            fontSize: 82,
            fontWeight: 900,
            lineHeight: 0.98,
            color: "#ffffff",
            textAlign: "center",
            textShadow: "0px 10px 28px rgba(0,0,0,0.42)",
          },
          options.titleStyle,
        ),
      ),
      maybeTextNode(
        id,
        "subtitle",
        options.subtitle,
        robustTextStyle(
          "subtitle",
          {
            width: "100%",
            fontFamily: "Inter, system-ui, Arial, sans-serif",
            fontSize: 32,
            fontWeight: 700,
            color: "#cbd5e1",
            textAlign: "center",
          },
          options.subtitleStyle,
        ),
      ),
    ],
  );
}

function overlayContainer(
  id: string,
  options: TextOverlayOptions,
  style: SceneStyle,
  children: Array<SceneNode | undefined>,
): SceneNode {
  return {
    id,
    type: "div",
    from: options.from,
    duration: options.duration,
    style: {
      ...style,
      ...options.style,
    },
    animations:
      options.enter === false
        ? []
        : (options.enter ?? fadeUp({ durationInFrames: 10, distance: 28 })),
    children: children.filter(
      (child): child is SceneNode => child !== undefined,
    ),
  };
}

function textOverlayContainerStyle(
  options: TextOverlayOptions,
  anchor: SafeAreaAnchor,
  fallback: SceneStyle,
  boxOptions: SafeAreaBoxOptions,
  style: SceneStyle,
): SceneStyle {
  if (!options.composition) {
    return {
      ...fallback,
      ...style,
    };
  }

  return {
    ...safeAreaBox(options.composition, anchor, {
      ...boxOptions,
      safeArea: boxOptions.safeArea ?? options.safeArea,
    }),
    ...style,
  };
}

function robustTextStyle(
  slot: TextOverlaySlot,
  style: SceneStyle,
  overrides: SceneStyle = {},
): SceneStyle {
  const mergedStyle = { ...style, ...overrides };
  const fontSize =
    typeof mergedStyle.fontSize === "number"
      ? mergedStyle.fontSize
      : slot === "value"
        ? 96
        : slot === "title"
          ? 72
          : slot === "body"
            ? 64
            : 30;
  const maxLinesBySlot: Record<TextOverlaySlot, number> = {
    kicker: 1,
    title: 2,
    subtitle: 2,
    body: 4,
    value: 1,
    label: 2,
    attribution: 1,
  };

  return {
    overflow: "hidden",
    textFit: "shrink",
    textOverflow: "ellipsis",
    maxLines: maxLinesBySlot[slot],
    minFontSize: Math.max(14, Math.round(fontSize * 0.52)),
    ...mergedStyle,
  };
}

function textNode(
  overlayId: string,
  slot: TextOverlaySlot,
  value: string,
  style: SceneStyle,
): SceneNode {
  return {
    id: `${overlayId}-${slot}`,
    type: "text",
    text: value,
    style,
  };
}

function maybeTextNode(
  overlayId: string,
  slot: TextOverlaySlot,
  value: string | undefined,
  style: SceneStyle,
): SceneNode | undefined {
  return value === undefined || value.trim() === ""
    ? undefined
    : textNode(overlayId, slot, value, style);
}

function overlayId(options: TextOverlayOptions, fallback: string): string {
  return options.id ?? fallback;
}

function requiredSlot(
  options: TextOverlayOptions,
  slot: TextOverlaySlot,
): string {
  const value = options[slot];

  if (typeof value !== "string" || value.trim() === "") {
    throw new Error(
      `textOverlay(${options.template ?? "titleCard"}) requires ${slot}.`,
    );
  }

  return value;
}

function eyebrowStyle(color: string): SceneStyle {
  return {
    width: "100%",
    fontFamily: "Inter, system-ui, Arial, sans-serif",
    fontSize: 26,
    fontWeight: 900,
    letterSpacing: 3,
    color,
    textAlign: "center",
  };
}

function gridCellStyle(column: 0 | 1, row: 0 | 1): SceneStyle {
  return {
    position: "absolute",
    left: column === 0 ? 0 : "50%",
    top: row === 0 ? 0 : "50%",
    width: "50%",
    height: "50%",
    objectFit: "cover",
    objectPosition: "center center",
    overflow: "hidden",
  };
}

function fullFrameTransitionStyle(color: string, zIndex: number): SceneStyle {
  return {
    position: "absolute",
    left: 0,
    top: 0,
    width: "100%",
    height: "100%",
    backgroundColor: color,
    opacity: 0,
    zIndex,
  };
}

export type ImageOverlayCategory =
  | "brand"
  | "decorative"
  | "product"
  | "identity";

export type ImageOverlayPlacement =
  | SafeAreaAnchor
  | "topLeft"
  | "topRight"
  | "bottomLeft"
  | "bottomRight";

export type ImageOverlayTemplate = {
  name: string;
  description: string;
  category: ImageOverlayCategory;
  placement: ImageOverlayPlacement;
  box: SafeAreaBoxOptions;
  containerStyle?: SceneStyle;
  imageStyle?: SceneStyle;
};

export const imageOverlayTemplates = {
  logoBug: {
    name: "Logo Bug",
    description: "Small brand mark anchored in a safe corner.",
    category: "brand",
    placement: "topRight",
    box: { widthRatio: 0.16, heightRatio: 0.09 },
    containerStyle: {
      opacity: 0.92,
    },
    imageStyle: {
      objectFit: "contain",
      objectPosition: "center center",
    },
  },
  watermark: {
    name: "Watermark",
    description: "Subtle persistent brand image near the lower edge.",
    category: "brand",
    placement: "bottomRight",
    box: { widthRatio: 0.2, heightRatio: 0.08 },
    containerStyle: {
      opacity: 0.42,
    },
    imageStyle: {
      objectFit: "contain",
      objectPosition: "center center",
    },
  },
  sticker: {
    name: "Sticker",
    description: "Expressive transparent sticker or badge overlay.",
    category: "decorative",
    placement: "topLeft",
    box: { widthRatio: 0.22, heightRatio: 0.16 },
    imageStyle: {
      objectFit: "contain",
      objectPosition: "center center",
    },
  },
  productShot: {
    name: "Product Shot",
    description: "Large product or app image framed for launches.",
    category: "product",
    placement: "center",
    box: { widthRatio: 0.68, heightRatio: 0.46 },
    containerStyle: {
      borderRadius: 28,
      boxShadow: "0px 28px 76px rgba(2,6,23,0.38)",
      overflow: "hidden",
    },
    imageStyle: {
      objectFit: "contain",
      objectPosition: "center center",
      backgroundColor: "rgba(15,23,42,0.18)",
    },
  },
  cornerBadge: {
    name: "Corner Badge",
    description: "Rounded badge image for labels, awards, or calls to action.",
    category: "decorative",
    placement: "bottomLeft",
    box: { widthRatio: 0.24, heightRatio: 0.12 },
    containerStyle: {
      borderRadius: 999,
      boxShadow: "0px 16px 42px rgba(2,6,23,0.3)",
      overflow: "hidden",
    },
    imageStyle: {
      objectFit: "cover",
      objectPosition: "center center",
    },
  },
  avatarBadge: {
    name: "Avatar Badge",
    description: "Circular portrait or channel avatar with a soft border.",
    category: "identity",
    placement: "lowerThird",
    box: { widthRatio: 0.18, heightRatio: 0.1 },
    containerStyle: {
      borderRadius: 999,
      border: "4px solid rgba(255,255,255,0.9)",
      boxShadow: "0px 16px 44px rgba(2,6,23,0.34)",
      overflow: "hidden",
    },
    imageStyle: {
      objectFit: "cover",
      objectPosition: "center center",
    },
  },
} satisfies Record<string, ImageOverlayTemplate>;

export type ImageOverlayTemplateKey = keyof typeof imageOverlayTemplates;

export const imageOverlayTemplateEntries = Object.entries(
  imageOverlayTemplates,
) as Array<[ImageOverlayTemplateKey, ImageOverlayTemplate]>;

export type ImageOverlayOptions = {
  template?: ImageOverlayTemplateKey;
  id?: string;
  assetId: string;
  from?: number;
  duration?: number;
  composition?: CompositionSize;
  safeArea?: SafeAreaInput;
  placement?: ImageOverlayPlacement;
  style?: SceneStyle;
  imageStyle?: SceneStyle;
  objectFit?: NonNullable<SceneStyle["objectFit"]>;
  objectPosition?: SceneStyle["objectPosition"];
  opacity?: number;
  borderRadius?: SceneStyle["borderRadius"];
  shadow?: SceneStyle["boxShadow"];
  enter?: SceneAnimation[] | false;
};

export function imageOverlay(options: ImageOverlayOptions): SceneNode {
  const key = options.template ?? "logoBug";
  const template = imageOverlayTemplates[key];
  const id = options.id ?? `${key}-image-overlay`;

  if (options.assetId.trim() === "") {
    throw new Error("imageOverlay() requires a non-empty assetId.");
  }

  return {
    id,
    type: "div",
    from: options.from,
    duration: options.duration,
    style: imageOverlayContainerStyle(options, template),
    animations:
      options.enter === false
        ? []
        : (options.enter ?? fadeUp({ durationInFrames: 10, distance: 20 })),
    children: [
      {
        id: `${id}-image`,
        type: "img",
        assetId: options.assetId,
        style: imageOverlayImageStyle(options, template),
      },
    ],
  };
}

function imageOverlayContainerStyle(
  options: ImageOverlayOptions,
  template: ImageOverlayTemplate,
): SceneStyle {
  const placementDefaults = imageOverlayPlacementDefaults(
    options.placement ?? template.placement,
  );
  const box = options.composition
    ? safeAreaBox(options.composition, placementDefaults.anchor, {
        ...template.box,
        align: template.box.align ?? placementDefaults.align,
        safeArea: template.box.safeArea ?? options.safeArea,
      })
    : imageOverlayFallbackBox(
        placementDefaults.anchor,
        placementDefaults.align,
      );

  return {
    ...box,
    overflow: "visible",
    ...template.containerStyle,
    ...(options.opacity === undefined ? {} : { opacity: options.opacity }),
    ...(options.borderRadius === undefined
      ? {}
      : { borderRadius: options.borderRadius }),
    ...(options.shadow === undefined ? {} : { boxShadow: options.shadow }),
    ...options.style,
  };
}

function imageOverlayImageStyle(
  options: ImageOverlayOptions,
  template: ImageOverlayTemplate,
): SceneStyle {
  return {
    width: "100%",
    height: "100%",
    ...template.imageStyle,
    objectFit: options.objectFit ?? template.imageStyle?.objectFit ?? "contain",
    objectPosition:
      options.objectPosition ??
      template.imageStyle?.objectPosition ??
      "center center",
    ...options.imageStyle,
  };
}

function imageOverlayPlacementDefaults(placement: ImageOverlayPlacement): {
  anchor: SafeAreaAnchor;
  align?: SafeAreaBoxOptions["align"];
} {
  switch (placement) {
    case "topLeft":
      return { anchor: "top", align: "left" };
    case "topRight":
      return { anchor: "top", align: "right" };
    case "bottomLeft":
      return { anchor: "bottom", align: "left" };
    case "bottomRight":
      return { anchor: "bottom", align: "right" };
    default:
      return { anchor: placement };
  }
}

function imageOverlayFallbackBox(
  anchor: SafeAreaAnchor,
  align: SafeAreaBoxOptions["align"] = "center",
): SceneStyle {
  const common = {
    position: "absolute" as const,
    width: 180,
    height: 120,
  };

  switch (anchor) {
    case "top":
    case "title":
      return topFallbackBox(common, align);
    case "lowerThird":
    case "bottom":
    case "subtitle":
      return bottomFallbackBox(common, align);
    case "statCallout":
      return { ...common, left: 72, top: 960 };
    case "center":
      return {
        position: "absolute",
        left: "30%",
        top: "35%",
        width: "40%",
        height: "30%",
      };
  }
}

function topFallbackBox(
  common: Pick<SceneStyle, "position" | "width" | "height">,
  align: SafeAreaBoxOptions["align"],
): SceneStyle {
  if (align === "left") {
    return { ...common, left: 72, top: 72 };
  }

  if (align === "right") {
    return { ...common, right: 72, top: 72 };
  }

  return { ...common, left: "42%", top: 72 };
}

function bottomFallbackBox(
  common: Pick<SceneStyle, "position" | "width" | "height">,
  align: SafeAreaBoxOptions["align"],
): SceneStyle {
  if (align === "left") {
    return { ...common, left: 72, bottom: 132 };
  }

  if (align === "right") {
    return { ...common, right: 72, bottom: 132 };
  }

  return { ...common, left: "42%", bottom: 132 };
}

export type VideoOverlayCategory =
  | "pip"
  | "reaction"
  | "demo"
  | "background"
  | "editorial";

export type VideoOverlayPlacement = ImageOverlayPlacement;

export type VideoOverlayTemplate = {
  name: string;
  description: string;
  category: VideoOverlayCategory;
  placement: VideoOverlayPlacement;
  box: SafeAreaBoxOptions;
  muted?: boolean;
  containerStyle?: SceneStyle;
  videoStyle?: SceneStyle;
};

export const videoOverlayTemplates = {
  pictureInPicture: {
    name: "Picture In Picture",
    description: "Small inset video for demos, speaker clips, or references.",
    category: "pip",
    placement: "topRight",
    box: { widthRatio: 0.32, heightRatio: 0.18 },
    muted: true,
    containerStyle: {
      borderRadius: 24,
      boxShadow: "0px 18px 48px rgba(2,6,23,0.34)",
      overflow: "hidden",
    },
    videoStyle: {
      objectFit: "cover",
      objectPosition: "center center",
    },
  },
  reactionCam: {
    name: "Reaction Cam",
    description: "Rounded talking-head overlay anchored near the lower third.",
    category: "reaction",
    placement: "bottomRight",
    box: { widthRatio: 0.28, heightRatio: 0.2 },
    muted: false,
    containerStyle: {
      borderRadius: 999,
      border: "4px solid rgba(255,255,255,0.9)",
      boxShadow: "0px 18px 54px rgba(2,6,23,0.36)",
      overflow: "hidden",
    },
    videoStyle: {
      objectFit: "cover",
      objectPosition: "center center",
    },
  },
  screenDemo: {
    name: "Screen Demo",
    description: "Large contained app or product walkthrough video.",
    category: "demo",
    placement: "center",
    box: { widthRatio: 0.74, heightRatio: 0.46 },
    muted: true,
    containerStyle: {
      borderRadius: 30,
      boxShadow: "0px 30px 78px rgba(2,6,23,0.4)",
      overflow: "hidden",
    },
    videoStyle: {
      objectFit: "contain",
      objectPosition: "center center",
      backgroundColor: "rgba(15,23,42,0.28)",
    },
  },
  backgroundLoop: {
    name: "Background Loop",
    description: "Muted full-frame looping-style background clip.",
    category: "background",
    placement: "center",
    box: { safeArea: false, widthRatio: 1, heightRatio: 1 },
    muted: true,
    containerStyle: {
      opacity: 0.72,
    },
    videoStyle: {
      objectFit: "cover",
      objectPosition: "center center",
    },
  },
  brollStrip: {
    name: "B-roll Strip",
    description: "Wide editorial strip for supplemental footage.",
    category: "editorial",
    placement: "bottom",
    box: { widthRatio: 0.86, heightRatio: 0.16 },
    muted: true,
    containerStyle: {
      borderRadius: 22,
      boxShadow: "0px 16px 42px rgba(2,6,23,0.28)",
      overflow: "hidden",
    },
    videoStyle: {
      objectFit: "cover",
      objectPosition: "center center",
    },
  },
  videoBadge: {
    name: "Video Badge",
    description:
      "Compact rounded video label for proof, avatars, or live marks.",
    category: "editorial",
    placement: "topLeft",
    box: { widthRatio: 0.24, heightRatio: 0.14 },
    muted: true,
    containerStyle: {
      borderRadius: 999,
      boxShadow: "0px 14px 38px rgba(2,6,23,0.32)",
      overflow: "hidden",
    },
    videoStyle: {
      objectFit: "cover",
      objectPosition: "center center",
    },
  },
} satisfies Record<string, VideoOverlayTemplate>;

export type VideoOverlayTemplateKey = keyof typeof videoOverlayTemplates;

export const videoOverlayTemplateEntries = Object.entries(
  videoOverlayTemplates,
) as Array<[VideoOverlayTemplateKey, VideoOverlayTemplate]>;

export type VideoOverlayOptions = {
  template?: VideoOverlayTemplateKey;
  id?: string;
  assetId: string;
  from?: number;
  duration?: number;
  trimStart?: number;
  playbackRate?: number;
  volume?: number;
  muted?: boolean;
  audioBus?: string;
  pan?: number;
  ducks?: SceneDucking;
  endBehavior?: "hold" | "loop";
  composition?: CompositionSize;
  safeArea?: SafeAreaInput;
  placement?: VideoOverlayPlacement;
  style?: SceneStyle;
  videoStyle?: SceneStyle;
  objectFit?: NonNullable<SceneStyle["objectFit"]>;
  objectPosition?: SceneStyle["objectPosition"];
  opacity?: number;
  borderRadius?: SceneStyle["borderRadius"];
  shadow?: SceneStyle["boxShadow"];
  enter?: SceneAnimation[] | false;
};

export function videoOverlay(options: VideoOverlayOptions): SceneNode {
  const key = options.template ?? "pictureInPicture";
  const template = videoOverlayTemplates[key];
  const id = options.id ?? `${key}-video-overlay`;

  if (options.assetId.trim() === "") {
    throw new Error("videoOverlay() requires a non-empty assetId.");
  }

  return {
    id,
    type: "video",
    assetId: options.assetId,
    from: options.from,
    duration: options.duration,
    videoStartTime: options.trimStart,
    playbackRate: options.playbackRate,
    audioBus: options.audioBus,
    pan: options.pan,
    ducks: options.ducks,
    videoEndBehavior: options.endBehavior,
    volume:
      options.volume ??
      ((options.muted ?? template.muted ?? true) ? 0 : undefined),
    style: videoOverlayStyle(options, template),
    animations:
      options.enter === false
        ? []
        : (options.enter ?? fadeUp({ durationInFrames: 10, distance: 18 })),
  };
}

function videoOverlayStyle(
  options: VideoOverlayOptions,
  template: VideoOverlayTemplate,
): SceneStyle {
  const placementDefaults = imageOverlayPlacementDefaults(
    options.placement ?? template.placement,
  );
  const box = options.composition
    ? safeAreaBox(options.composition, placementDefaults.anchor, {
        ...template.box,
        align: template.box.align ?? placementDefaults.align,
        safeArea: template.box.safeArea ?? options.safeArea,
      })
    : imageOverlayFallbackBox(
        placementDefaults.anchor,
        placementDefaults.align,
      );

  return {
    ...box,
    overflow: "hidden",
    ...template.containerStyle,
    ...template.videoStyle,
    objectFit: options.objectFit ?? template.videoStyle?.objectFit ?? "cover",
    objectPosition:
      options.objectPosition ??
      template.videoStyle?.objectPosition ??
      "center center",
    ...(options.opacity === undefined ? {} : { opacity: options.opacity }),
    ...(options.borderRadius === undefined
      ? {}
      : { borderRadius: options.borderRadius }),
    ...(options.shadow === undefined ? {} : { boxShadow: options.shadow }),
    ...options.videoStyle,
    ...options.style,
  };
}

export type AudioOverlayCategory =
  | "music"
  | "voice"
  | "effect"
  | "ambience"
  | "cue";

export type AudioOverlayTemplate = {
  name: string;
  description: string;
  category: AudioOverlayCategory;
  defaultVolume: number;
  defaultDuration?: number;
};

export const audioOverlayTemplates = {
  backgroundMusic: {
    name: "Background Music",
    description: "Quiet music bed under the whole scene or a long section.",
    category: "music",
    defaultVolume: 0.28,
  },
  voiceover: {
    name: "Voiceover",
    description: "Primary narration or spoken explanation over visuals.",
    category: "voice",
    defaultVolume: 1,
  },
  soundEffect: {
    name: "Sound Effect",
    description: "One-shot effect aligned with an edit, title, or action.",
    category: "effect",
    defaultVolume: 0.85,
    defaultDuration: 45,
  },
  beatAccent: {
    name: "Beat Accent",
    description: "Short percussive hit for cuts, pulses, or reveals.",
    category: "effect",
    defaultVolume: 0.7,
    defaultDuration: 18,
  },
  ambientBed: {
    name: "Ambient Bed",
    description: "Low ambience underneath a scene without dominating dialogue.",
    category: "ambience",
    defaultVolume: 0.22,
  },
  notificationPing: {
    name: "Notification Ping",
    description: "Compact cue sound for UI moments and callouts.",
    category: "cue",
    defaultVolume: 0.65,
    defaultDuration: 30,
  },
} satisfies Record<string, AudioOverlayTemplate>;

export type AudioOverlayTemplateKey = keyof typeof audioOverlayTemplates;

export const audioOverlayTemplateEntries = Object.entries(
  audioOverlayTemplates,
) as Array<[AudioOverlayTemplateKey, AudioOverlayTemplate]>;

export type AudioOverlayOptions = {
  template?: AudioOverlayTemplateKey;
  id?: string;
  assetId: string;
  from?: number;
  duration?: number;
  trimStart?: number;
  volume?: number;
  volumeEnvelope?: VolumeEnvelope;
  fadeInDuration?: number;
  fadeOutDuration?: number;
  fadeInEasing?: string;
  fadeOutEasing?: string;
  loop?: boolean;
  muted?: boolean;
  audioBus?: string;
  pan?: number;
  ducks?: SceneDucking;
};

export type AudioFadeEnvelopeOptions = {
  /** Total node duration in frames. Required when fadeOutDuration is set. */
  duration?: number;
  /** Fade in length in node-local frames. */
  fadeInDuration?: number;
  /** Fade out length in node-local frames. */
  fadeOutDuration?: number;
  fadeInEasing?: string;
  fadeOutEasing?: string;
};

export function audioOverlay(options: AudioOverlayOptions): SceneNode {
  const key = options.template ?? "backgroundMusic";
  const template: AudioOverlayTemplate = audioOverlayTemplates[key];
  const id = options.id ?? `${key}-audio-overlay`;
  const duration = options.duration ?? template.defaultDuration;

  if (options.assetId.trim() === "") {
    throw new Error("audioOverlay() requires a non-empty assetId.");
  }

  return {
    id,
    type: "audio",
    assetId: options.assetId,
    from: options.from,
    duration,
    audioStartTime: options.trimStart,
    volume: options.volume ?? (options.muted ? 0 : template.defaultVolume),
    loop: options.loop,
    audioBus: options.audioBus,
    pan: options.pan,
    ducks: options.ducks,
    volumeEnvelope:
      options.volumeEnvelope ??
      audioFadeEnvelope({
        duration,
        fadeInDuration: options.fadeInDuration,
        fadeOutDuration: options.fadeOutDuration,
        fadeInEasing: options.fadeInEasing,
        fadeOutEasing: options.fadeOutEasing,
      }),
    style: {},
    animations: [],
    children: [],
  };
}

export function audioFadeEnvelope(
  options: AudioFadeEnvelopeOptions,
): VolumeEnvelope | undefined {
  const fadeInDuration = normalizedFrameDuration(
    options.fadeInDuration,
    "fadeInDuration",
  );
  const fadeOutDuration = normalizedFrameDuration(
    options.fadeOutDuration,
    "fadeOutDuration",
  );
  const duration =
    options.duration === undefined
      ? undefined
      : normalizedFrameDuration(options.duration, "duration");

  if (fadeInDuration === 0 && fadeOutDuration === 0) {
    return undefined;
  }

  if (fadeOutDuration > 0 && duration === undefined) {
    throw new Error(
      "audioFadeEnvelope() requires duration when fadeOutDuration is set.",
    );
  }

  if (duration !== undefined && fadeOutDuration > duration) {
    throw new Error(
      "audioFadeEnvelope() fadeOutDuration cannot be longer than duration.",
    );
  }

  const finalActiveFrame =
    duration === undefined ? undefined : Math.max(0, duration - 1);
  const fadeOutStartFrame =
    finalActiveFrame === undefined
      ? undefined
      : Math.max(0, finalActiveFrame - fadeOutDuration);

  if (
    fadeOutStartFrame !== undefined &&
    fadeInDuration > 0 &&
    fadeOutDuration > 0 &&
    fadeInDuration > fadeOutStartFrame
  ) {
    throw new Error(
      "audioFadeEnvelope() fadeInDuration and fadeOutDuration overlap; shorten the fades or pass an explicit volumeEnvelope.",
    );
  }

  const points: VolumeEnvelope = [];

  if (fadeInDuration > 0) {
    pushVolumePoint(points, { frame: 0, value: 0 });
    pushVolumePoint(points, {
      frame: fadeInDuration,
      value: 1,
      easing: options.fadeInEasing ?? "easeOut",
    });
  }

  if (
    fadeOutDuration > 0 &&
    finalActiveFrame !== undefined &&
    fadeOutStartFrame !== undefined
  ) {
    if (fadeOutStartFrame < finalActiveFrame) {
      pushVolumePoint(points, {
        frame: fadeOutStartFrame,
        value: 1,
      });
    }
    pushVolumePoint(points, {
      frame: finalActiveFrame,
      value: 0,
      easing: options.fadeOutEasing ?? "easeIn",
    });
  }

  return points;
}

export function audioCrossfade(
  durationInFrames: number,
  options: { easing?: string } = {},
): { outgoing: VolumeEnvelope; incoming: VolumeEnvelope } {
  const duration = normalizedFrameDuration(
    durationInFrames,
    "durationInFrames",
  );
  if (duration === 0) {
    throw new Error("audioCrossfade() durationInFrames must be at least 1.");
  }
  const easing = options.easing ?? "easeInOut";
  return {
    outgoing: [
      { frame: 0, value: 1 },
      { frame: duration, value: 0, easing },
    ],
    incoming: [
      { frame: 0, value: 0 },
      { frame: duration, value: 1, easing },
    ],
  };
}

function normalizedFrameDuration(value: number | undefined, name: string) {
  if (value === undefined) {
    return 0;
  }

  if (!Number.isInteger(value) || value < 0) {
    throw new Error(`${name} must be a non-negative integer frame count.`);
  }

  return value;
}

function pushVolumePoint(
  points: VolumeEnvelope,
  point: VolumeEnvelope[number],
) {
  const previous = points[points.length - 1];

  if (previous && previous.frame === point.frame) {
    if (previous.value !== point.value) {
      throw new Error(
        `audioFadeEnvelope() generated conflicting volume values at frame ${point.frame}.`,
      );
    }

    points[points.length - 1] = { ...point, easing: previous.easing };
    return;
  }

  points.push(point);
}

/** One spoken word with millisecond timestamps (ASR output shape). */
export type CaptionWord = {
  word: string;
  startMs: number;
  endMs: number;
};

export type CaptionStyle = {
  fontFamily?: string;
  fontSize?: number;
  fontWeight?: number | string;
  fontStyle?: "normal" | "italic";
  color?: string;
  /** Color of highlighted words (TikTok) or the active word (karaoke). */
  highlightColor?: string;
  lineHeight?: number | string;
  letterSpacing?: number | string;
  textShadow?: string;
  textStroke?: string;
};

const captionStyleDefaults: Required<CaptionStyle> = {
  fontFamily: "system-ui, Arial, sans-serif",
  fontSize: 112,
  fontWeight: 800,
  fontStyle: "normal",
  color: "#ffffff",
  highlightColor: "#ffd166",
  lineHeight: 1.08,
  letterSpacing: 0,
  textShadow: "0px 10px 40px rgba(0,0,0,0.55)",
  textStroke: "8px #000000",
};

export type CaptionArea = {
  top?: number | string;
  height?: number | string;
};

export type TikTokCaptionOptions = {
  fps: number;
  /** Prefix for generated node ids (default "caption"). */
  idPrefix?: string;
  /** Vertical band the captions occupy (defaults: top "40%", height "20%"). */
  area?: CaptionArea;
  style?: CaptionStyle;
  /** Indices of words to render in highlightColor with a fitted pill behind them. */
  highlightIndices?: number[];
  /** Fitted background behind highlighted words. */
  pill?: {
    color?: string;
    radius?: number;
    paddingX?: number;
    paddingY?: number;
    /** @deprecated Use paddingY. Kept as a compatibility hint for older callers. */
    heightRatio?: number;
  };
  /** Entrance pop per word (set false to disable). */
  pop?:
    | { fromScale?: number; durationInFrames?: number; easing?: string }
    | false;
  /** Keep each word visible until the next one starts (default true). */
  holdBetweenWords?: boolean;
};

const msToFrame = (ms: number, fps: number): number =>
  Math.round((ms / 1000) * fps);

/**
 * The one-word-at-a-time caption style: each word fills the caption area for
 * its spoken span, popping in with a transform tween. Returns a single
 * container node to drop into scene.nodes; placement is `from`/`duration`
 * computed from the word timestamps.
 */
export function tiktokCaptions(
  words: CaptionWord[],
  options: TikTokCaptionOptions,
): SceneNode {
  const prefix = options.idPrefix ?? "caption";
  const style = { ...captionStyleDefaults, ...options.style };
  const highlight = new Set(options.highlightIndices ?? []);
  const pill = {
    color: options.pill?.color ?? "rgba(255, 209, 102, 0.16)",
    radius: options.pill?.radius ?? 36,
    paddingX: options.pill?.paddingX ?? 56,
    paddingY:
      options.pill?.paddingY ??
      Math.round(
        ((options.pill?.heightRatio ?? 1.7) * style.fontSize -
          style.fontSize * 1.25) /
          2,
      ),
  };
  const pop = options.pop === false ? null : (options.pop ?? {});
  const hold = options.holdBetweenWords ?? true;

  const children: SceneNode[] = words.map((entry, index) => {
    const from = msToFrame(entry.startMs, options.fps);
    const nextStart = words[index + 1]?.startMs;
    const endMs = hold && nextStart !== undefined ? nextStart : entry.endMs;
    const duration = Math.max(1, msToFrame(endMs, options.fps) - from);

    const textNode: SceneNode = {
      id: `${prefix}-w${index}-text`,
      type: "text",
      text: entry.word,
      style: {
        width: "100%",
        height: "100%",
        fontFamily: style.fontFamily,
        fontSize: style.fontSize,
        fontWeight: style.fontWeight,
        fontStyle: style.fontStyle,
        lineHeight: style.lineHeight,
        letterSpacing: style.letterSpacing,
        color: highlight.has(index) ? style.highlightColor : style.color,
        textAlign: "center",
        textShadow: style.textShadow,
        textStroke: style.textStroke,
        ...(highlight.has(index)
          ? {
              textBackgroundColor: pill.color,
              textBackgroundPaddingX: pill.paddingX,
              textBackgroundPaddingY: Math.max(0, pill.paddingY),
              textBackgroundRadius: pill.radius,
            }
          : {}),
      },
      animations: pop
        ? popIn({
            durationInFrames: pop.durationInFrames ?? 5,
            easing: pop.easing ?? "spring(0.3)",
            fromScale: pop.fromScale ?? 0.7,
          })
        : [],
    };

    return {
      id: `${prefix}-w${index}`,
      type: "div",
      from,
      duration,
      style: {
        position: "absolute",
        left: 0,
        width: "100%",
        top: 0,
        height: "100%",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
      },
      children: [textNode],
    };
  });

  return {
    id: prefix,
    type: "div",
    style: {
      position: "absolute",
      left: 0,
      width: "100%",
      top: options.area?.top ?? "40%",
      height: options.area?.height ?? "20%",
    },
    children,
  };
}

export type KaraokeCaptionOptions = {
  fps: number;
  idPrefix?: string;
  area?: CaptionArea;
  style?: CaptionStyle;
  /** Frames the highlight takes to ramp in/out (default 2). */
  rampFrames?: number;
};

/**
 * The accumulating karaoke style: the whole line is visible for its full
 * span and each word's color ramps to the highlight color while it is being
 * spoken. Returns a single container node.
 */
export function karaokeCaptions(
  words: CaptionWord[],
  options: KaraokeCaptionOptions,
): SceneNode {
  const prefix = options.idPrefix ?? "karaoke";
  const style = { ...captionStyleDefaults, ...options.style };
  const ramp = Math.max(1, options.rampFrames ?? 2);
  const first = words[0];
  const last = words[words.length - 1];

  if (!first || !last) {
    throw new Error("karaokeCaptions needs at least one word.");
  }

  const lineFrom = msToFrame(first.startMs, options.fps);
  const lineDuration = Math.max(
    1,
    msToFrame(last.endMs, options.fps) - lineFrom,
  );

  const children: SceneNode[] = words.map((entry, index) => {
    // Keyframe frames are local to the line container.
    const start = msToFrame(entry.startMs, options.fps) - lineFrom;
    const end = msToFrame(entry.endMs, options.fps) - lineFrom;
    const frames: Keyframes = [];

    if (start - ramp > 0) {
      frames.push({ frame: 0, value: style.color });
    }

    frames.push(
      { frame: Math.max(0, start - ramp), value: style.color },
      { frame: Math.max(1, start), value: style.highlightColor },
      { frame: Math.max(2, end), value: style.highlightColor },
      { frame: Math.max(3, end + ramp), value: style.color },
    );

    // Deduplicate any collapsed frames while keeping order strict.
    const strict: Keyframes = [];

    for (const entry of frames) {
      const previous = strict[strict.length - 1];

      if (!previous) {
        strict.push(entry);
      } else if (entry.frame > previous.frame) {
        strict.push(entry);
      }
    }

    return {
      id: `${prefix}-w${index}`,
      type: "text",
      text: entry.word,
      style: {
        fontFamily: style.fontFamily,
        fontSize: style.fontSize,
        fontWeight: style.fontWeight,
        fontStyle: style.fontStyle,
        lineHeight: style.lineHeight,
        letterSpacing: style.letterSpacing,
        color: style.color,
        textAlign: "center",
        textShadow: style.textShadow,
        textStroke: style.textStroke,
      },
      animations: [animation("color", strict)],
    } satisfies SceneNode;
  });

  return {
    id: prefix,
    type: "div",
    from: lineFrom,
    duration: lineDuration,
    style: {
      position: "absolute",
      left: 0,
      width: "100%",
      top: options.area?.top ?? "70%",
      height: options.area?.height ?? "15%",
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      gap: Math.round(style.fontSize * 0.35),
    },
    children,
  };
}

export type CaptionTemplateCategory = "static" | "karaoke" | "karaokeVariant";

export type CaptionRenderMode = "line" | "karaoke" | "word";

export type CaptionTemplateStyle = CaptionStyle & {
  textBackgroundColor?: string;
  textBackgroundPaddingX?: number;
  textBackgroundPaddingY?: number;
  textBackgroundRadius?: number;
};

export type CaptionTemplateHighlightStyle = {
  color?: string;
  backgroundColor?: string;
  fontWeight?: number | string;
  scale?: number;
  textShadow?: string;
  textBackgroundPaddingX?: number;
  textBackgroundPaddingY?: number;
  textBackgroundRadius?: number;
};

export type CaptionTemplate = {
  name: string;
  description: string;
  category: CaptionTemplateCategory;
  renderMode: CaptionRenderMode;
  style: CaptionTemplateStyle;
  highlightStyle?: CaptionTemplateHighlightStyle;
  segment?: {
    maxWords?: number;
    maxDurationMs?: number;
    gapMs?: number;
  };
};

export const captionTemplates = {
  classic: {
    name: "Classic",
    description: "Clean white subtitles with a strong editorial outline.",
    category: "static",
    renderMode: "line",
    style: {
      fontFamily: "Inter, system-ui, Arial, sans-serif",
      fontSize: 78,
      fontWeight: 800,
      color: "#ffffff",
      lineHeight: 1.22,
      letterSpacing: 1.2,
      textShadow: "2px 2px 8px rgba(0,0,0,0.5)",
      textStroke: "4px rgba(15,23,42,0.92)",
    },
  },
  minimalBar: {
    name: "Minimal Bar",
    description: "Compact caption pills for quiet, readable edits.",
    category: "static",
    renderMode: "line",
    style: {
      fontFamily: "Inter, system-ui, Arial, sans-serif",
      fontSize: 68,
      fontWeight: 700,
      color: "#ffffff",
      lineHeight: 1.18,
      letterSpacing: 2,
      textShadow: "0px 2px 8px rgba(0,0,0,0.34)",
      textBackgroundColor: "rgba(17,24,39,0.74)",
      textBackgroundPaddingX: 30,
      textBackgroundPaddingY: 16,
      textBackgroundRadius: 999,
    },
  },
  handwritten: {
    name: "Handwritten",
    description: "Loose, friendly subtitles with lighter motion pressure.",
    category: "static",
    renderMode: "line",
    style: {
      fontFamily: "Caveat, Bradley Hand, Comic Sans MS, cursive",
      fontSize: 84,
      fontWeight: 500,
      color: "#ffffff",
      lineHeight: 1.2,
      textShadow: "2px 2px 6px rgba(0,0,0,0.56)",
    },
  },
  retro: {
    name: "Retro",
    description: "Golden vintage lettering with a warm hard shadow.",
    category: "static",
    renderMode: "line",
    style: {
      fontFamily: "Rubik Mono One, Impact, system-ui, sans-serif",
      fontSize: 62,
      fontWeight: 900,
      color: "#ffd84d",
      lineHeight: 1.1,
      letterSpacing: 1.4,
      textShadow: "5px 5px 0px #ff4500",
      textStroke: "2px rgba(88,28,13,0.72)",
    },
  },
  cinematic: {
    name: "Cinematic",
    description: "Premium serif captions with a restrained dark backing.",
    category: "static",
    renderMode: "line",
    style: {
      fontFamily: "Georgia, Times New Roman, serif",
      fontSize: 76,
      fontWeight: 700,
      color: "#f8fafc",
      lineHeight: 1.18,
      letterSpacing: 1.4,
      textShadow: "0px 4px 18px rgba(0,0,0,0.45)",
      textBackgroundColor: "rgba(15,23,42,0.58)",
      textBackgroundPaddingX: 28,
      textBackgroundPaddingY: 14,
      textBackgroundRadius: 8,
    },
  },
  storyteller: {
    name: "Storyteller",
    description: "Warm narrative subtitles for interviews and recaps.",
    category: "static",
    renderMode: "line",
    style: {
      fontFamily: "Georgia, Times New Roman, serif",
      fontSize: 70,
      fontWeight: 650,
      color: "#fef3c7",
      lineHeight: 1.28,
      letterSpacing: 0.8,
      textShadow: "0px 3px 12px rgba(0,0,0,0.55)",
    },
  },
  hustle: {
    name: "Hustle",
    description: "One-word punch captions with a red active badge.",
    category: "karaoke",
    renderMode: "word",
    style: {
      fontFamily: "Montserrat, Inter, system-ui, sans-serif",
      fontSize: 84,
      fontWeight: 900,
      color: "#ffffff",
      lineHeight: 1.08,
      textShadow: "0px 4px 14px rgba(0,0,0,0.44)",
      textStroke: "5px rgba(0,0,0,0.9)",
    },
    highlightStyle: {
      color: "#ffffff",
      backgroundColor: "#ff3b30",
      scale: 1.08,
      fontWeight: 900,
      textShadow: "0px 2px 8px rgba(0,0,0,0.36)",
      textBackgroundPaddingX: 20,
      textBackgroundPaddingY: 8,
      textBackgroundRadius: 8,
    },
  },
  spotlight: {
    name: "Spotlight",
    description: "Short-form captions with a bright yellow active pill.",
    category: "karaoke",
    renderMode: "word",
    style: {
      fontFamily: "Poppins, Inter, system-ui, sans-serif",
      fontSize: 88,
      fontWeight: 900,
      color: "#ffffff",
      lineHeight: 1.08,
      textShadow: "0px 6px 18px rgba(0,0,0,0.35)",
      textStroke: "7px rgba(15,23,42,0.92)",
    },
    highlightStyle: {
      color: "#0f172a",
      backgroundColor: "#facc15",
      scale: 1.1,
      fontWeight: 900,
      textShadow: "0px 2px 6px rgba(250,204,21,0.24)",
      textBackgroundPaddingX: 24,
      textBackgroundPaddingY: 9,
      textBackgroundRadius: 999,
    },
  },
  karaoke: {
    name: "Karaoke",
    description: "Full-line captions with active-word color and pill emphasis.",
    category: "karaoke",
    renderMode: "karaoke",
    style: {
      fontFamily: "Poppins, Inter, system-ui, sans-serif",
      fontSize: 76,
      fontWeight: 900,
      color: "#ffffff",
      lineHeight: 1.12,
      textShadow: "0px 4px 14px rgba(0,0,0,0.42)",
      textStroke: "5px rgba(2,6,23,0.9)",
    },
    highlightStyle: {
      color: "#ffffff",
      backgroundColor: "rgba(236,72,153,0.95)",
      scale: 1.1,
      fontWeight: 900,
      textShadow: "0px 4px 10px rgba(190,24,93,0.42)",
      textBackgroundPaddingX: 20,
      textBackgroundPaddingY: 7,
      textBackgroundRadius: 999,
    },
  },
  neon: {
    name: "Neon",
    description: "Electric captions with cyan highlights and soft glow.",
    category: "karaokeVariant",
    renderMode: "karaoke",
    style: {
      fontFamily: "Outfit, Inter, system-ui, sans-serif",
      fontSize: 74,
      fontWeight: 800,
      color: "#ffffff",
      lineHeight: 1.12,
      letterSpacing: 1.6,
      textShadow: "0px 0px 18px rgba(56,189,248,0.75)",
      textStroke: "3px rgba(3,7,18,0.82)",
      textBackgroundColor: "rgba(3,7,18,0.52)",
      textBackgroundPaddingX: 26,
      textBackgroundPaddingY: 12,
      textBackgroundRadius: 16,
    },
    highlightStyle: {
      color: "#e0f2fe",
      backgroundColor: "rgba(125,211,252,0.2)",
      scale: 1.06,
      fontWeight: 800,
      textShadow: "0px 0px 12px rgba(125,211,252,0.85)",
      textBackgroundPaddingX: 16,
      textBackgroundPaddingY: 5,
      textBackgroundRadius: 10,
    },
  },
  future: {
    name: "Future",
    description: "Clean tech subtitles with blue active-word accents.",
    category: "karaokeVariant",
    renderMode: "karaoke",
    style: {
      fontFamily: "Space Grotesk, Inter, system-ui, sans-serif",
      fontSize: 72,
      fontWeight: 800,
      color: "#e2e8f0",
      lineHeight: 1.14,
      letterSpacing: 2.2,
      textShadow: "0px 0px 15px rgba(148,163,184,0.35)",
      textStroke: "2px rgba(56,189,248,0.55)",
      textBackgroundColor: "rgba(15,23,42,0.74)",
      textBackgroundPaddingX: 28,
      textBackgroundPaddingY: 13,
      textBackgroundRadius: 10,
    },
    highlightStyle: {
      color: "#38bdf8",
      backgroundColor: "rgba(14,165,233,0.2)",
      scale: 1.07,
      fontWeight: 800,
      textShadow: "0px 0px 15px rgba(56,189,248,0.6)",
      textBackgroundPaddingX: 16,
      textBackgroundPaddingY: 5,
      textBackgroundRadius: 8,
    },
  },
  terminal: {
    name: "Terminal",
    description: "Code-inspired green captions for technical videos.",
    category: "karaokeVariant",
    renderMode: "karaoke",
    style: {
      fontFamily: "Courier New, ui-monospace, monospace",
      fontSize: 66,
      fontWeight: 800,
      color: "#86efac",
      lineHeight: 1.18,
      letterSpacing: 1.6,
      textShadow: "0px 0px 10px rgba(34,197,94,0.36)",
      textBackgroundColor: "rgba(2,6,23,0.86)",
      textBackgroundPaddingX: 24,
      textBackgroundPaddingY: 12,
      textBackgroundRadius: 10,
    },
    highlightStyle: {
      color: "#dcfce7",
      backgroundColor: "rgba(34,197,94,0.2)",
      scale: 1.03,
      fontWeight: 800,
      textBackgroundPaddingX: 12,
      textBackgroundPaddingY: 4,
      textBackgroundRadius: 5,
    },
  },
  colorShift: {
    name: "Color Shift",
    description: "High-contrast karaoke captions with color-only emphasis.",
    category: "karaokeVariant",
    renderMode: "karaoke",
    style: {
      fontFamily: "Poppins, Inter, system-ui, sans-serif",
      fontSize: 76,
      fontWeight: 900,
      color: "#ffffff",
      lineHeight: 1.12,
      letterSpacing: 1.6,
      textShadow: "0px 4px 14px rgba(0,0,0,0.42)",
      textStroke: "5px rgba(2,6,23,0.9)",
    },
    highlightStyle: {
      color: "#ff4fa3",
      scale: 1.08,
      fontWeight: 900,
      textShadow: "0px 0px 14px rgba(255,79,163,0.55)",
    },
  },
} satisfies Record<string, CaptionTemplate>;

export type CaptionTemplateKey = keyof typeof captionTemplates;

export const captionTemplateEntries = Object.entries(captionTemplates) as Array<
  [CaptionTemplateKey, CaptionTemplate]
>;

export const subtitleTemplates = captionTemplates;
export type SubtitleTemplateKey = CaptionTemplateKey;

export type SubtitleSegment = {
  text: string;
  startMs?: number;
  endMs?: number;
  startSeconds?: number;
  endSeconds?: number;
};

export type StyledCaptionOptions = {
  fps: number;
  idPrefix?: string;
  template?: CaptionTemplateKey;
  renderMode?: CaptionRenderMode;
  area?: CaptionArea;
  style?: Partial<CaptionTemplateStyle>;
  highlightStyle?: CaptionTemplateHighlightStyle;
  maxWordsPerSegment?: number;
  maxSegmentDurationMs?: number;
  gapMs?: number;
  rampFrames?: number;
};

export type SubtitleTrackOptions = {
  fps: number;
  idPrefix?: string;
  template?: CaptionTemplateKey;
  composition?: CompositionSize;
  safeArea?: SafeAreaInput;
  area?: CaptionArea;
  style?: Partial<CaptionTemplateStyle>;
  maxLines?: number;
  minFontSize?: number;
  textFit?: SceneStyle["textFit"];
  textOverflow?: SceneStyle["textOverflow"];
  enter?: SceneAnimation[] | false;
};

type CaptionSegment = {
  words: CaptionWord[];
  startMs: number;
  endMs: number;
};

/**
 * Community subtitle templates translated into native motionforge scene data.
 * The result is still just nodes, timings, styles, and keyframes; no Remotion,
 * DOM, or adapter layer is involved.
 */
export function styledCaptions(
  words: CaptionWord[],
  options: StyledCaptionOptions,
): SceneNode {
  const key = options.template ?? "classic";
  const template: CaptionTemplate = captionTemplates[key];
  const prefix = options.idPrefix ?? `${key}-captions`;
  const renderMode = options.renderMode ?? template.renderMode;
  const style = { ...template.style, ...options.style };
  const highlightStyle = {
    ...template.highlightStyle,
    ...options.highlightStyle,
  };

  if (renderMode === "word") {
    return wordTemplateCaptions(words, {
      fps: options.fps,
      idPrefix: prefix,
      area: options.area,
      style,
      highlightStyle,
    });
  }

  const segments = segmentCaptionWords(words, {
    maxWords:
      options.maxWordsPerSegment ??
      template.segment?.maxWords ??
      (renderMode === "karaoke" ? 5 : 8),
    maxDurationMs:
      options.maxSegmentDurationMs ??
      template.segment?.maxDurationMs ??
      (renderMode === "karaoke" ? 2200 : 3000),
    gapMs: options.gapMs ?? template.segment?.gapMs ?? 450,
  });

  return {
    id: prefix,
    type: "div",
    style: {
      position: "absolute",
      left: 0,
      width: "100%",
      top: options.area?.top ?? (renderMode === "karaoke" ? "68%" : "72%"),
      height:
        options.area?.height ?? (renderMode === "karaoke" ? "18%" : "16%"),
    },
    children:
      renderMode === "karaoke"
        ? segments.map((segment, index) =>
            karaokeTemplateSegment(segment, index, {
              fps: options.fps,
              prefix,
              style,
              highlightStyle,
              rampFrames: options.rampFrames ?? 3,
            }),
          )
        : segments.map((segment, index) =>
            lineTemplateSegment(segment, index, {
              fps: options.fps,
              prefix,
              style,
            }),
          ),
  };
}

export const styledSubtitles = styledCaptions;

/**
 * Segment-timed subtitles for SRT/VTT-style workflows. Each segment is a
 * timed child window containing one bounded text node.
 */
export function subtitleTrack(
  segments: SubtitleSegment[],
  options: SubtitleTrackOptions,
): SceneNode {
  const key = options.template ?? "classic";
  const template: CaptionTemplate = captionTemplates[key];
  const prefix = options.idPrefix ?? `${key}-subtitles`;
  const style = { ...template.style, ...options.style };
  const normalized = normalizeSubtitleSegments(segments);

  if (normalized.length === 0) {
    throw new Error("subtitleTrack() requires at least one non-empty segment.");
  }

  return {
    id: prefix,
    type: "div",
    style: subtitleTrackStyle(options),
    children: normalized.map((segment, index) =>
      subtitleTrackSegment(segment, index, {
        fps: options.fps,
        prefix,
        style,
        maxLines: options.maxLines,
        minFontSize: options.minFontSize,
        textFit: options.textFit,
        textOverflow: options.textOverflow,
        enter: options.enter,
      }),
    ),
  };
}

export const subtitles = subtitleTrack;

export function parseSrt(input: string): SubtitleSegment[] {
  return parseSubtitleCues(input, {
    format: "SRT",
    headerPattern: undefined,
    timeSeparator: "-->",
  });
}

export function parseVtt(input: string): SubtitleSegment[] {
  const normalized = normalizeSubtitleInput(input);
  const withoutBom = stripBom(normalized);
  const lines = withoutBom.split("\n");
  const firstMeaningful = lines.find((line) => line.trim() !== "");

  if (!firstMeaningful?.trim().startsWith("WEBVTT")) {
    throw new Error("WebVTT input must start with WEBVTT.");
  }

  return parseSubtitleCues(lines.slice(1).join("\n"), {
    format: "WebVTT",
    headerPattern: /^(NOTE|STYLE|REGION)(\s|$)/,
    timeSeparator: "-->",
  });
}

type SubtitleCueParseOptions = {
  format: "SRT" | "WebVTT";
  headerPattern?: RegExp;
  timeSeparator: "-->";
};

function parseSubtitleCues(
  input: string,
  options: SubtitleCueParseOptions,
): SubtitleSegment[] {
  const normalized = normalizeSubtitleInput(input);
  const blocks = normalized
    .split(/\n{2,}/)
    .map((block) => block.trim())
    .filter(Boolean);
  const segments: SubtitleSegment[] = [];

  for (const block of blocks) {
    if (options.headerPattern?.test(block)) {
      continue;
    }

    const lines = block.split("\n").map((line) => line.trimEnd());
    const timingIndex = lines.findIndex((line) =>
      line.includes(options.timeSeparator),
    );

    if (timingIndex < 0) {
      if (options.format === "SRT" && /^\d+$/.test(lines[0]?.trim() ?? "")) {
        throw new Error(`SRT cue ${lines[0]} is missing a time range.`);
      }
      continue;
    }

    const timing = lines[timingIndex];

    if (!timing) {
      continue;
    }

    const textLines = lines
      .slice(timingIndex + 1)
      .filter((line) => line !== "");
    const cueLabel =
      timingIndex > 0 && lines[timingIndex - 1]?.trim()
        ? lines[timingIndex - 1]?.trim()
        : `${segments.length + 1}`;

    if (textLines.length === 0) {
      continue;
    }

    const [startRaw, endWithSettings] = timing.split(options.timeSeparator);
    const endRaw = endWithSettings?.trim().split(/\s+/)[0];

    if (!startRaw || !endRaw) {
      throw new Error(
        `${options.format} cue ${cueLabel} has an invalid time range.`,
      );
    }

    const startMs = parseSubtitleTimestamp(startRaw.trim(), options.format);
    const endMs = parseSubtitleTimestamp(endRaw.trim(), options.format);

    if (endMs <= startMs) {
      throw new Error(
        `${options.format} cue ${cueLabel} must end after it starts.`,
      );
    }

    segments.push({
      text: textLines.join("\n"),
      startMs,
      endMs,
    });
  }

  if (segments.length === 0) {
    throw new Error(
      `${options.format} input did not contain any subtitle cues.`,
    );
  }

  return segments;
}

function normalizeSubtitleInput(input: string): string {
  return input.replace(/\r\n?/g, "\n").trim();
}

function stripBom(input: string): string {
  return input.charCodeAt(0) === 0xfeff ? input.slice(1) : input;
}

function parseSubtitleTimestamp(
  input: string,
  format: "SRT" | "WebVTT",
): number {
  const separator = format === "SRT" ? "," : ".";
  const escaped = separator === "." ? "\\." : ",";
  const pattern = new RegExp(
    `^(?:(\\d{1,2}):)?(\\d{2}):(\\d{2})${escaped}(\\d{3})$`,
  );
  const match = pattern.exec(input);

  if (!match) {
    throw new Error(`${format} timestamp "${input}" is invalid.`);
  }

  const hours = Number(match[1] ?? 0);
  const minutes = Number(match[2]);
  const seconds = Number(match[3]);
  const milliseconds = Number(match[4]);

  if (minutes > 59 || seconds > 59) {
    throw new Error(
      `${format} timestamp "${input}" has invalid minutes or seconds.`,
    );
  }

  return ((hours * 60 + minutes) * 60 + seconds) * 1000 + milliseconds;
}

type NormalizedSubtitleSegment = {
  text: string;
  startMs: number;
  endMs: number;
};

function normalizeSubtitleSegments(
  segments: SubtitleSegment[],
): NormalizedSubtitleSegment[] {
  return segments
    .map((segment, index) => {
      const text = segment.text.trim();

      if (text === "") {
        return null;
      }

      const startMs = subtitleSegmentTimeMs(segment, "start", index);
      const endMs = subtitleSegmentTimeMs(segment, "end", index);

      if (endMs <= startMs) {
        throw new Error(
          `subtitle segment ${index + 1} must end after it starts.`,
        );
      }

      return { text, startMs, endMs };
    })
    .filter(
      (segment): segment is NormalizedSubtitleSegment => segment !== null,
    );
}

function subtitleSegmentTimeMs(
  segment: SubtitleSegment,
  boundary: "start" | "end",
  index: number,
): number {
  const ms = boundary === "start" ? segment.startMs : segment.endMs;
  const seconds =
    boundary === "start" ? segment.startSeconds : segment.endSeconds;

  if (ms !== undefined && seconds !== undefined) {
    throw new Error(
      `subtitle segment ${index + 1} cannot define both ${boundary}Ms and ${boundary}Seconds.`,
    );
  }

  const value = ms ?? (seconds === undefined ? undefined : seconds * 1000);

  if (value === undefined || !Number.isFinite(value) || value < 0) {
    throw new Error(
      `subtitle segment ${index + 1} needs a non-negative ${boundary} time.`,
    );
  }

  return value;
}

function subtitleTrackStyle(options: SubtitleTrackOptions): SceneStyle {
  if (options.area) {
    return {
      position: "absolute",
      left: 0,
      width: "100%",
      top: options.area.top ?? "72%",
      height: options.area.height ?? "16%",
    };
  }

  if (options.composition) {
    return safeAreaBox(options.composition, "subtitle", {
      safeArea: options.safeArea,
    });
  }

  return {
    position: "absolute",
    left: 0,
    width: "100%",
    top: "72%",
    height: "16%",
  };
}

function subtitleTrackSegment(
  segment: NormalizedSubtitleSegment,
  index: number,
  options: {
    fps: number;
    prefix: string;
    style: CaptionTemplateStyle;
    maxLines?: number;
    minFontSize?: number;
    textFit?: SceneStyle["textFit"];
    textOverflow?: SceneStyle["textOverflow"];
    enter?: SceneAnimation[] | false;
  },
): SceneNode {
  const from = msToFrame(segment.startMs, options.fps);
  const duration = Math.max(1, msToFrame(segment.endMs, options.fps) - from);

  return {
    id: `${options.prefix}-s${index}`,
    type: "div",
    from,
    duration,
    style: {
      position: "absolute",
      left: 0,
      top: 0,
      width: "100%",
      height: "100%",
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
    },
    children: [
      {
        id: `${options.prefix}-s${index}-text`,
        type: "text",
        text: segment.text,
        style: subtitleTextStyle(options.style, {
          maxLines: options.maxLines,
          minFontSize: options.minFontSize,
          textFit: options.textFit,
          textOverflow: options.textOverflow,
        }),
        animations:
          options.enter === false
            ? []
            : (options.enter ?? [
                animation("opacity", [
                  { frame: 0, value: 0 },
                  {
                    frame: Math.min(5, Math.max(1, duration - 1)),
                    value: 1,
                    easing: "easeOut",
                  },
                ]),
              ]),
      },
    ],
  };
}

function subtitleTextStyle(
  style: CaptionTemplateStyle,
  options: {
    maxLines?: number;
    minFontSize?: number;
    textFit?: SceneStyle["textFit"];
    textOverflow?: SceneStyle["textOverflow"];
  },
): SceneStyle {
  const subtitleStyle = subtitleTextSafetyStyle(style, options);

  return captionTextStyle(style, subtitleStyle) ?? subtitleStyle;
}

function subtitleTextSafetyStyle(
  style: CaptionTemplateStyle,
  options: {
    maxLines?: number;
    minFontSize?: number;
    textFit?: SceneStyle["textFit"];
    textOverflow?: SceneStyle["textOverflow"];
  },
): SceneStyle {
  const fontSize = style.fontSize ?? captionStyleDefaults.fontSize;

  return {
    width: "100%",
    height: "100%",
    overflow: "hidden",
    textFit: options.textFit ?? "shrink",
    textOverflow: options.textOverflow ?? "ellipsis",
    maxLines: options.maxLines ?? 2,
    minFontSize:
      options.minFontSize ?? Math.max(16, Math.round(fontSize * 0.5)),
  };
}

function wordTemplateCaptions(
  words: CaptionWord[],
  options: {
    fps: number;
    idPrefix: string;
    area?: CaptionArea;
    style: CaptionTemplateStyle;
    highlightStyle: CaptionTemplateHighlightStyle;
  },
): SceneNode {
  return tiktokCaptions(words, {
    fps: options.fps,
    idPrefix: options.idPrefix,
    area: options.area ?? { top: "64%", height: "22%" },
    highlightIndices: words.map((_, index) => index),
    style: {
      fontFamily: options.style.fontFamily,
      fontSize: options.style.fontSize,
      fontWeight: options.style.fontWeight,
      fontStyle: options.style.fontStyle,
      lineHeight: options.style.lineHeight,
      letterSpacing: options.style.letterSpacing,
      color: options.style.color,
      highlightColor:
        options.highlightStyle.color ?? options.style.highlightColor,
      textShadow: options.style.textShadow,
      textStroke: options.style.textStroke,
    },
    pill: options.highlightStyle.backgroundColor
      ? {
          color: options.highlightStyle.backgroundColor,
          paddingX: options.highlightStyle.textBackgroundPaddingX ?? 24,
          paddingY: options.highlightStyle.textBackgroundPaddingY ?? 10,
          radius: options.highlightStyle.textBackgroundRadius ?? 999,
        }
      : undefined,
    pop: {
      fromScale: 0.82,
      durationInFrames: 6,
      easing: "spring(0.28)",
    },
  });
}

function lineTemplateSegment(
  segment: CaptionSegment,
  index: number,
  options: {
    fps: number;
    prefix: string;
    style: CaptionTemplateStyle;
  },
): SceneNode {
  const from = msToFrame(segment.startMs, options.fps);
  const duration = Math.max(1, msToFrame(segment.endMs, options.fps) - from);

  return {
    id: `${options.prefix}-s${index}`,
    type: "div",
    from,
    duration,
    style: {
      position: "absolute",
      left: 0,
      top: 0,
      width: "100%",
      height: "100%",
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
    },
    children: [
      {
        id: `${options.prefix}-s${index}-text`,
        type: "text",
        text: captionSegmentText(segment.words),
        style: captionTextStyle(options.style, {
          width: "100%",
          height: "100%",
        }),
        animations: [
          animation("opacity", [
            { frame: 0, value: 0 },
            {
              frame: Math.min(5, Math.max(1, duration - 1)),
              value: 1,
              easing: "easeOut",
            },
          ]),
        ],
      },
    ],
  };
}

function karaokeTemplateSegment(
  segment: CaptionSegment,
  index: number,
  options: {
    fps: number;
    prefix: string;
    style: CaptionTemplateStyle;
    highlightStyle: CaptionTemplateHighlightStyle;
    rampFrames: number;
  },
): SceneNode {
  const from = msToFrame(segment.startMs, options.fps);
  const duration = Math.max(1, msToFrame(segment.endMs, options.fps) - from);
  const fontSize = options.style.fontSize ?? captionStyleDefaults.fontSize;
  const paddingX = options.highlightStyle.textBackgroundPaddingX ?? 14;

  return {
    id: `${options.prefix}-s${index}`,
    type: "div",
    from,
    duration,
    style: {
      position: "absolute",
      left: 0,
      top: 0,
      width: "100%",
      height: "100%",
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      gap: Math.round(fontSize * 0.22 + paddingX * 0.35),
    },
    children: segment.words.map((word, wordIndex) =>
      karaokeTemplateWord(word, wordIndex, {
        fps: options.fps,
        prefix: `${options.prefix}-s${index}`,
        lineFrom: from,
        lineDuration: duration,
        style: options.style,
        highlightStyle: options.highlightStyle,
        rampFrames: options.rampFrames,
      }),
    ),
  };
}

function karaokeTemplateWord(
  word: CaptionWord,
  index: number,
  options: {
    fps: number;
    prefix: string;
    lineFrom: number;
    lineDuration: number;
    style: CaptionTemplateStyle;
    highlightStyle: CaptionTemplateHighlightStyle;
    rampFrames: number;
  },
): SceneNode {
  const start = Math.max(
    0,
    msToFrame(word.startMs, options.fps) - options.lineFrom,
  );
  const end = Math.max(
    start + 1,
    msToFrame(word.endMs, options.fps) - options.lineFrom,
  );
  const ramp = Math.max(1, options.rampFrames);
  const baseColor = options.style.color ?? captionStyleDefaults.color;
  const activeColor =
    options.highlightStyle.color ??
    options.style.highlightColor ??
    captionStyleDefaults.highlightColor;
  const activeBackground = options.highlightStyle.backgroundColor;
  const transparentBackground = transparentColor(activeBackground);
  const scale = options.highlightStyle.scale ?? 1;

  return {
    id: `${options.prefix}-w${index}`,
    type: "text",
    text: word.word,
    style: {
      ...captionTextStyle(options.style),
      ...(options.highlightStyle.fontWeight
        ? { fontWeight: options.highlightStyle.fontWeight }
        : {}),
      ...(activeBackground
        ? {
            textBackgroundColor: transparentBackground,
            textBackgroundPaddingX:
              options.highlightStyle.textBackgroundPaddingX ?? 14,
            textBackgroundPaddingY:
              options.highlightStyle.textBackgroundPaddingY ?? 5,
            textBackgroundRadius:
              options.highlightStyle.textBackgroundRadius ?? 8,
          }
        : {}),
    },
    animations: [
      animation(
        "color",
        strictFrames([
          { frame: 0, value: baseColor },
          { frame: Math.max(0, start - ramp), value: baseColor },
          { frame: start, value: activeColor, easing: "easeOut" },
          { frame: end, value: activeColor },
          { frame: end + ramp, value: baseColor, easing: "easeOut" },
        ]),
      ),
      ...(activeBackground
        ? [
            animation(
              "textBackgroundColor",
              strictFrames([
                { frame: 0, value: transparentBackground },
                {
                  frame: Math.max(0, start - ramp),
                  value: transparentBackground,
                },
                { frame: start, value: activeBackground, easing: "easeOut" },
                { frame: end, value: activeBackground },
                {
                  frame: end + ramp,
                  value: transparentBackground,
                  easing: "easeOut",
                },
              ]),
            ),
          ]
        : []),
      ...(scale !== 1
        ? [
            animation(
              "transform",
              strictFrames([
                { frame: 0, value: "scale(1)" },
                { frame: Math.max(0, start - ramp), value: "scale(1)" },
                { frame: start, value: `scale(${scale})`, easing: "easeOut" },
                { frame: end, value: `scale(${scale})` },
                { frame: end + ramp, value: "scale(1)", easing: "easeOut" },
              ]),
            ),
          ]
        : []),
    ],
  };
}

function captionTextStyle(
  style: CaptionTemplateStyle,
  extra: Partial<SceneNode["style"]> = {},
): SceneNode["style"] {
  return {
    fontFamily: style.fontFamily,
    fontSize: style.fontSize,
    fontWeight: style.fontWeight,
    fontStyle: style.fontStyle,
    lineHeight: style.lineHeight,
    letterSpacing: style.letterSpacing,
    color: style.color,
    textAlign: "center",
    textShadow: style.textShadow,
    textStroke: style.textStroke,
    ...(style.textBackgroundColor
      ? {
          textBackgroundColor: style.textBackgroundColor,
          textBackgroundPaddingX: style.textBackgroundPaddingX ?? 24,
          textBackgroundPaddingY: style.textBackgroundPaddingY ?? 10,
          textBackgroundRadius: style.textBackgroundRadius ?? 12,
        }
      : {}),
    ...extra,
  };
}

function segmentCaptionWords(
  words: CaptionWord[],
  options: { maxWords: number; maxDurationMs: number; gapMs: number },
): CaptionSegment[] {
  const clean = words.filter((entry) => entry.word.trim() !== "");
  const segments: CaptionSegment[] = [];
  let current: CaptionWord[] = [];

  for (const word of clean) {
    const first = current[0];
    const previous = current[current.length - 1];
    const wouldExceedWords = current.length >= options.maxWords;
    const wouldExceedDuration =
      first !== undefined && word.endMs - first.startMs > options.maxDurationMs;
    const largeGap =
      previous !== undefined && word.startMs - previous.endMs > options.gapMs;

    if (
      current.length > 0 &&
      (wouldExceedWords || wouldExceedDuration || largeGap)
    ) {
      segments.push(captionSegment(current));
      current = [];
    }

    current.push(word);
  }

  if (current.length > 0) {
    segments.push(captionSegment(current));
  }

  return segments;
}

function captionSegment(words: CaptionWord[]): CaptionSegment {
  const first = words[0];
  const last = words[words.length - 1];

  return {
    words,
    startMs: first?.startMs ?? 0,
    endMs: last?.endMs ?? first?.endMs ?? 0,
  };
}

/**
 * Characters from scripts written without inter-word spaces (Han, kana,
 * full-width forms, Thai/Lao/Khmer/Myanmar). Hangul is NOT here — Korean
 * uses spaces. Used to join ASR word tokens back into natural text: CJK
 * ASR emits per-character/per-token "words", and joining those with " "
 * would render 你 好 世 界 instead of 你好世界.
 */
const spacelessScriptPattern =
  // Built via RegExp so the es5-target app tsconfig accepts the u flag.
  new RegExp(
    "[\\u2E80-\\u303F\\u3040-\\u30FF\\u31F0-\\u31FF\\u3400-\\u4DBF\\u4E00-\\u9FFF" +
      "\\uF900-\\uFAFF\\uFE30-\\uFE4F\\uFF00-\\uFF9F\\u{20000}-\\u{2FA1F}" +
      "\\u0E00-\\u0EFF\\u1000-\\u109F\\u1780-\\u17FF]",
    "u",
  );

function lastGrapheme(text: string): string {
  const clusters = Array.from(text);
  return clusters[clusters.length - 1] ?? "";
}

function firstGrapheme(text: string): string {
  return Array.from(text)[0] ?? "";
}

/**
 * Joins caption word tokens with script-aware spacing: a space separates two
 * tokens unless both boundary characters belong to spaceless scripts, so
 * Chinese/Japanese/Thai read naturally while Latin runs (and mixed
 * CJK-Latin boundaries) keep their spaces.
 */
export function joinCaptionWords(tokens: string[]): string {
  let result = "";

  for (const raw of tokens) {
    const token = raw.trim();

    if (!token) {
      continue;
    }

    if (result === "") {
      result = token;
      continue;
    }

    const omitSpace =
      spacelessScriptPattern.test(lastGrapheme(result)) &&
      spacelessScriptPattern.test(firstGrapheme(token));

    result += omitSpace ? token : ` ${token}`;
  }

  return result.replace(/\s+([,.;:!?])/g, "$1");
}

/**
 * True when the text is dominated by spaceless-script characters — callers
 * use it to size caption segments by tokens-per-line appropriately (a CJK
 * "word" is roughly a character, so lines need more tokens).
 */
export function isSpacelessScriptText(text: string): boolean {
  const clusters = Array.from(text).filter((char) => !/\s/.test(char));

  if (clusters.length === 0) {
    return false;
  }

  const spaceless = clusters.filter((char) =>
    spacelessScriptPattern.test(char),
  ).length;

  return spaceless / clusters.length > 0.5;
}

function captionSegmentText(words: CaptionWord[]): string {
  return joinCaptionWords(words.map((entry) => entry.word));
}

function strictFrames(frames: Keyframes): Keyframes {
  const result: Keyframes = [];

  for (const frame of frames) {
    const previous = result[result.length - 1];

    if (!previous || frame.frame > previous.frame) {
      result.push(frame);
    } else if (frame.frame === previous.frame) {
      result[result.length - 1] = frame;
    }
  }

  return result;
}

function transparentColor(value: string | undefined): string {
  if (!value) {
    return "rgba(0, 0, 0, 0)";
  }

  const hex = value.match(/^#([0-9a-fA-F]{6})$/);
  if (hex) {
    const raw = hex[1] ?? "000000";
    return `rgba(${Number.parseInt(raw.slice(0, 2), 16)}, ${Number.parseInt(raw.slice(2, 4), 16)}, ${Number.parseInt(raw.slice(4, 6), 16)}, 0)`;
  }

  const rgb = value.match(/^rgba?\(([^)]+)\)$/);
  if (rgb) {
    const [r = "0", g = "0", b = "0"] = (rgb[1] ?? "")
      .split(",")
      .map((part) => part.trim());
    return `rgba(${r}, ${g}, ${b}, 0)`;
  }

  return "rgba(0, 0, 0, 0)";
}

export {
  timeline,
  Timeline,
  type StaggerOptions,
  type TimelinePosition,
} from "./timeline";

export {
  canonicalEffectParamKey,
  canonicalEffectParamKeys,
  effectParamAliases,
  normalizeEffectColorsValue,
  normalizeEffectDirectionValue,
  normalizeEffectLevelValue,
  normalizeEffectParamValue,
  normalizeEffectScaleValue,
  normalizeEffectScopeValue,
  normalizeEffectUnitValue,
  numericEffectParamKeys,
} from "./effect-params";
