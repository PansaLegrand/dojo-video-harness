import type {
  SceneNodeInput,
  SceneAnimation,
  VolumeEnvelope,
} from "@dojo-video-engine/schema";
import type { EditorDocument } from "./document";
import {
  editorTransitionPlan,
  type EditorTransitionPlan,
} from "./composition-validation";
import { derivedCompositionId } from "./composition-ids";

export type CompositionNodeOrigin = {
  itemId: string;
  transitionId: string;
  media: boolean;
};
type Point = { frame: number; value: number };
const points = (values: Point[]): Point[] =>
  [...new Map(values.map((value) => [value.frame, value])).values()].sort(
    (a, b) => a.frame - b.frame,
  );
const opacity = (values: Point[]): SceneAnimation[] => [
  { kind: "keyframes", property: "opacity", frames: points(values) },
];

/** Native isolated media leaves, never new div parents: original source clocks and root IDs stay stable. */
export function compileEditorCompositionNodes(
  document: EditorDocument,
  nodes: SceneNodeInput[],
): { nodes: SceneNodeInput[]; origins: Map<string, CompositionNodeOrigin> } {
  const origins = new Map<string, CompositionNodeOrigin>();
  if (!document.transitions) return { nodes, origins };
  const roots = new Map(nodes.map((node) => [node.id, node]));
  const plans = Object.values(document.transitions)
    .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
    .map((transition) => editorTransitionPlan(document, transition))
    .filter((plan) => roots.has(plan.from.id) && roots.has(plan.to.id));
  if (!plans.length) return { nodes, origins };
  const occupied = new Set<string>();
  const collect = (node: SceneNodeInput) => {
    occupied.add(node.id);
    node.children?.forEach(collect);
  };
  nodes.forEach(collect);
  const incoming = new Map(plans.map((plan) => [plan.to.id, plan])),
    outgoing = new Map(plans.map((plan) => [plan.from.id, plan]));
  const participants = new Set([...incoming.keys(), ...outgoing.keys()]);
  const transformed = new Map<string, SceneNodeInput[]>();
  const plates: SceneNodeInput[] = [];
  for (const plan of plans)
    if (plan.transition.kind === "dipToBlack") {
      const id = derivedCompositionId(
        plan.transition.id,
        "black-plate",
        occupied,
      );
      plates.push({
        id,
        type: "div",
        from: plan.start,
        duration: plan.end - plan.start,
        style: {
          position: "absolute",
          left: 0,
          top: 0,
          width: document.format.width,
          height: document.format.height,
          backgroundColor: "#000000",
        },
      });
      origins.set(id, {
        itemId: plan.from.id,
        transitionId: plan.transition.id,
        media: false,
      });
    }
  function handle(
    node: SceneNodeInput,
    plan: EditorTransitionPlan,
    before: boolean,
  ): SceneNodeInput | null {
    const visual = plan.transition.kind === "dissolve",
      audible = plan.transition.audio === "crossfade" && node.type === "video";
    if (!visual && !audible) return null;
    const id = derivedCompositionId(
      plan.transition.id,
      before ? "incoming-handle" : "outgoing-handle",
      occupied,
    );
    const duration = before ? plan.before : plan.after,
      from = before ? plan.start : plan.cut;
    const {
      animations: _animations,
      volumeEnvelope: _envelope,
      ducks: _ducks,
      children: _children,
      ...base
    } = node;
    const value: SceneNodeInput = {
      ...base,
      id,
      from,
      duration,
      style: {
        ...node.style,
        backgroundColor: before ? plan.toBackdrop : plan.fromBackdrop,
        isolation: true,
        opacity: visual ? 1 : 0,
      },
    };
    if (visual && before)
      value.animations = opacity([
        { frame: 0, value: 0 },
        {
          frame: duration,
          value: plan.before / plan.transition.durationFrames,
        },
      ]);
    if (node.type === "video") {
      value.videoStartTime = Math.max(
        0,
        (node.videoStartTime ?? 0) +
          ((before ? -plan.before : plan.from.node.duration!) *
            (node.playbackRate ?? 1)) /
            document.format.fps,
      );
      value.volume = audible ? (node.volume ?? 1) : 0;
      if (audible)
        value.volumeEnvelope = before
          ? [
              { frame: 0, value: 0 },
              {
                frame: duration,
                value: plan.before / plan.transition.durationFrames,
              },
            ]
          : [
              { frame: 0, value: plan.after / plan.transition.durationFrames },
              { frame: duration, value: 0 },
            ];
    }
    origins.set(id, {
      itemId: before ? plan.to.id : plan.from.id,
      transitionId: plan.transition.id,
      media: true,
    });
    return value;
  }
  for (const id of participants) {
    const original = roots.get(id)!,
      enter = incoming.get(id),
      leave = outgoing.get(id),
      duration = original.duration!;
    const node: SceneNodeInput = {
      ...original,
      style: {
        ...original.style,
        backgroundColor: enter?.toBackdrop ?? leave!.fromBackdrop,
        isolation: true,
        opacity: 1,
      },
    };
    const visualPoints: Point[] = [],
      gainPoints: Point[] = [];
    if (enter) {
      visualPoints.push(
        {
          frame: 0,
          value:
            enter.transition.kind === "dissolve"
              ? enter.before / enter.transition.durationFrames
              : 0,
        },
        { frame: enter.after, value: 1 },
      );
      if (enter.transition.audio === "crossfade" && node.type === "video")
        gainPoints.push(
          { frame: 0, value: enter.before / enter.transition.durationFrames },
          { frame: enter.after, value: 1 },
        );
    }
    if (leave?.transition.kind === "dipToBlack") {
      if (!visualPoints.length) visualPoints.push({ frame: 0, value: 1 });
      visualPoints.push(
        { frame: duration - leave.before, value: 1 },
        { frame: duration, value: 0 },
      );
    }
    if (leave?.transition.audio === "crossfade" && node.type === "video") {
      if (!gainPoints.length) gainPoints.push({ frame: 0, value: 1 });
      gainPoints.push(
        { frame: duration - leave.before, value: 1 },
        {
          frame: duration,
          value: leave.after / leave.transition.durationFrames,
        },
      );
    }
    if (visualPoints.length) node.animations = opacity(visualPoints);
    if (gainPoints.length)
      node.volumeEnvelope = points(gainPoints) as VolumeEnvelope;
    const before = enter ? handle(original, enter, true) : null,
      after = leave ? handle(original, leave, false) : null;
    transformed.set(id, [
      ...(before ? [before] : []),
      node,
      ...(after ? [after] : []),
    ]);
  }
  // Only transition participants change slots. Eligibility excludes overlapping
  // same-track content, so this guarantees incoming-over-outgoing paint order
  // without changing overlay tracks or unrelated item ordering.
  const ordered = [...participants].sort(
    (a, b) => (roots.get(a)!.from ?? 0) - (roots.get(b)!.from ?? 0),
  );
  let cursor = 0,
    insertedPlates = false;
  const result = nodes.flatMap((node) => {
    if (!participants.has(node.id)) return [node];
    const prefix = insertedPlates ? [] : plates;
    insertedPlates = true;
    return [...prefix, ...transformed.get(ordered[cursor++]!)!];
  });
  return { nodes: result, origins };
}
