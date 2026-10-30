import type { SceneAnimation } from "@motionforge/schema";

/**
 * Timeline choreography: sequences presets across multiple nodes without
 * hand-computed frame offsets. Pure — compiles to the same keyframe arrays
 * presets already emit, on each node's local clock.
 *
 * The frame math is the part humans and LLMs get wrong (change one duration
 * and every downstream offset is silently stale), so the timeline owns it:
 * entries default to starting when the previous entry ends, `after` targets
 * an earlier entry by node id, `overlap`/`gap` nudge from there, and
 * `stagger` spaces a group N frames apart.
 *
 * Offsets are applied by shifting keyframes with a hold of the first value
 * from frame 0 — an entrance preset's held `opacity: 0` keeps the node
 * invisible until its slot arrives. All choreographed nodes are assumed to
 * share a start (`from`), since keyframes run on each node's local clock.
 */

type Keyframes = SceneAnimation["frames"];

export type TimelinePosition = {
  /** Absolute timeline frame to start at (wins over `after`). */
  at?: number;
  /** Start when this earlier entry's node id finishes. Default: previous entry. */
  after?: string;
  /** Start at a previously declared named timeline marker. */
  atMarker?: string;
  /** Start `overlap` frames before the reference point. */
  overlap?: number;
  /** Start `gap` frames after the reference point. */
  gap?: number;
};

export type StaggerOptions = TimelinePosition & {
  /** Frames between consecutive starts (default 5). */
  every?: number;
};

type TimelineEntry = {
  id: string;
  animations: SceneAnimation[];
  startFrame: number;
  endFrame: number;
};

export type SequenceStep = {
  id: string;
  animations: SceneAnimation[];
  position?: TimelinePosition;
};

/** Last keyframe across an animation list — the preset's natural length. */
function presetDuration(animations: SceneAnimation[]): number {
  let last = 0;

  for (const animation of animations) {
    for (const frame of animation.frames) {
      last = Math.max(last, frame.frame);
    }
  }

  return last;
}

/** Shifts frames by `offset`, holding the first value from frame 0. */
function shifted(frames: Keyframes, offset: number): Keyframes {
  if (offset <= 0) {
    return frames;
  }

  const first = frames[0];
  const moved = frames.map((entry) => ({
    ...entry,
    frame: entry.frame + offset,
  }));

  // A keyframe list already starting past 0 keeps its implicit hold; only
  // anchor an explicit hold when the original list began at frame 0.
  return first && first.frame === 0
    ? [{ frame: 0, value: first.value }, ...moved]
    : moved;
}

export class Timeline {
  private entries: TimelineEntry[] = [];
  private markers = new Map<string, number>();

  /**
   * Adds one node's preset output to the timeline. Without a position it
   * starts when the previous entry ends (the GSAP default people expect).
   */
  add(
    id: string,
    animations: SceneAnimation[],
    position: TimelinePosition = {},
  ): this {
    if (this.entries.some((entry) => entry.id === id)) {
      throw new Error(
        `Timeline already has an entry for node "${id}". Combine its animations into one add() call; one entry per node keeps start times unambiguous.`,
      );
    }

    const startFrame = this.resolveStart(position);
    const endFrame = startFrame + presetDuration(animations);
    this.entries.push({ id, animations, startFrame, endFrame });
    return this;
  }

  /**
   * Adds a group of nodes sharing one preset, each starting `every` frames
   * after the previous. The group as a whole is positioned like a single
   * add(); later entries default to after the whole group.
   */
  stagger(
    ids: string[],
    animations: SceneAnimation[] | ((index: number) => SceneAnimation[]),
    options: StaggerOptions = {},
  ): this {
    const every = options.every ?? 5;
    const base = this.resolveStart(options);

    ids.forEach((id, index) => {
      if (this.entries.some((entry) => entry.id === id)) {
        throw new Error(
          `Timeline already has an entry for node "${id}". Combine its animations into one add() call; one entry per node keeps start times unambiguous.`,
        );
      }

      const resolved =
        typeof animations === "function" ? animations(index) : animations;
      const startFrame = base + index * every;
      this.entries.push({
        id,
        animations: resolved,
        startFrame,
        endFrame: startFrame + presetDuration(resolved),
      });
    });

    return this;
  }

  sequence(steps: readonly SequenceStep[]): this {
    steps.forEach((step) =>
      this.add(step.id, step.animations, step.position ?? {}),
    );
    return this;
  }

  marker(name: string, at = this.durationInFrames): this {
    if (!/^[A-Za-z][A-Za-z0-9._-]{0,63}$/.test(name)) {
      throw new Error(`Invalid timeline marker name ${JSON.stringify(name)}.`);
    }
    if (!Number.isInteger(at) || at < 0) {
      throw new Error(`Timeline marker frame must be a non-negative integer.`);
    }
    if (this.markers.has(name)) {
      throw new Error(`Timeline marker "${name}" is already defined.`);
    }
    this.markers.set(name, at);
    return this;
  }

  /** Timeline frame where the last entry ends (0 when empty). */
  get durationInFrames(): number {
    return this.entries.reduce(
      (max, entry) => Math.max(max, entry.endFrame),
      0,
    );
  }

  /**
   * Per-node animation lists with all offsets applied. Assign to each node's
   * `animations` (or emit as patch ops via compileToPatch()).
   */
  compile(): Record<string, SceneAnimation[]> {
    const result: Record<string, SceneAnimation[]> = {};

    for (const entry of this.entries) {
      result[entry.id] = entry.animations.map((animation) => ({
        ...animation,
        frames: shifted(animation.frames, entry.startFrame),
      }));
    }

    return result;
  }

  /**
   * The same compilation as RFC 0001 patch ops — ready for
   * `applyScenePatch(scene, timeline.compileToPatch())`.
   */
  compileToPatch(): Array<{
    op: "setAnimations";
    id: string;
    animations: SceneAnimation[];
  }> {
    return Object.entries(this.compile()).map(([id, animations]) => ({
      op: "setAnimations",
      id,
      animations,
    }));
  }

  compileMarkers(): Record<string, number> {
    return Object.fromEntries(
      Array.from(this.markers.entries()).sort(([left], [right]) =>
        left.localeCompare(right),
      ),
    );
  }

  compileScenePatch(): Array<
    | {
        op: "setAnimations";
        id: string;
        animations: SceneAnimation[];
      }
    | { op: "setMarker"; name: string; frame: number }
  > {
    return [
      ...this.compileToPatch(),
      ...Object.entries(this.compileMarkers()).map(([name, frame]) => ({
        op: "setMarker" as const,
        name,
        frame,
      })),
    ];
  }

  private resolveStart(position: TimelinePosition): number {
    const overlap = position.overlap ?? 0;
    const gap = position.gap ?? 0;

    if (overlap < 0 || gap < 0) {
      throw new Error(
        "Timeline overlap and gap must be non-negative; swap one for the other instead of negating.",
      );
    }

    let reference: number;

    if (position.at !== undefined && position.atMarker !== undefined) {
      throw new Error(
        "Timeline position uses either `at` or `atMarker`, not both.",
      );
    }

    if (position.at !== undefined) {
      if (position.at < 0) {
        throw new Error(`Timeline \`at\` must be >= 0, got ${position.at}.`);
      }

      reference = position.at;
    } else if (position.atMarker !== undefined) {
      const marker = this.markers.get(position.atMarker);
      if (marker === undefined) {
        throw new Error(
          `Timeline atMarker references unknown marker "${position.atMarker}".`,
        );
      }
      reference = marker;
    } else if (position.after !== undefined) {
      const target = this.entries.find((entry) => entry.id === position.after);

      if (!target) {
        const known = this.entries.map((entry) => `"${entry.id}"`).join(", ");
        throw new Error(
          `Timeline \`after\` references unknown entry "${position.after}". Entries so far: ${known || "(none)"}.`,
        );
      }

      reference = target.endFrame;
    } else {
      reference = this.entries[this.entries.length - 1]?.endFrame ?? 0;
    }

    // Clamp like GSAP: an overlap larger than the reference cannot start
    // before the timeline does.
    return Math.max(0, reference - overlap + gap);
  }
}

/** Entry point: `timeline().add(...).stagger(...).compile()`. */
export function timeline(): Timeline {
  return new Timeline();
}
