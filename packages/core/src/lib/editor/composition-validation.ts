import { parseColorValue } from "@dojo-video-engine/schema/values";
import type { EditorDocument, EditorItem } from "./document";
import type { EditorTransition } from "./composition-schema";

export type EditorTransitionPlan = {
  transition: EditorTransition;
  from: EditorItem;
  to: EditorItem;
  cut: number;
  before: number;
  after: number;
  start: number;
  end: number;
  fromBackdrop: string;
  toBackdrop: string;
};
const zero = (value: unknown) =>
  value === undefined ||
  value === 0 ||
  value === "0" ||
  value === "0px" ||
  value === "0%";
const full = (value: unknown, dimension: number) =>
  value === undefined ||
  value === dimension ||
  value === `${dimension}px` ||
  value === "100%";
function opaqueColor(value: string): boolean {
  const parsed = parseColorValue(value);
  return parsed?.kind === "rgba" && parsed.alpha === 1;
}
function assertSimpleMedia(document: EditorDocument, item: EditorItem): string {
  const node = item.node,
    style = node.style ?? {};
  if (
    !["video", "img"].includes(node.type) ||
    item.caption ||
    item.visualizerSourceItemId ||
    node.children?.length
  )
    throw new Error(
      "Transitions currently require two plain video or image clips.",
    );
  if (!opaqueColor(document.format.backgroundColor))
    throw new Error(
      "Transitions currently require an opaque project background.",
    );
  if (
    node.mask ||
    node.clip ||
    node.animations?.length ||
    (style.opacity !== undefined && style.opacity !== 1) ||
    (style.blendMode && style.blendMode !== "source-over") ||
    (style.transform && style.transform !== "none") ||
    (style.filter && style.filter !== "none") ||
    style.background ||
    style.aspectRatio ||
    style.safeArea
  )
    throw new Error(
      "Transitions currently require unanimated, full-opacity media without masks, transforms, filters or custom blending.",
    );
  if (
    !full(style.width, document.format.width) ||
    !full(style.height, document.format.height) ||
    !zero(style.left) ||
    !zero(style.top) ||
    !zero(style.inset) ||
    !zero(style.zIndex) ||
    !zero(style.borderRadius) ||
    style.border ||
    style.boxShadow ||
    !zero(style.right) ||
    !zero(style.bottom) ||
    style.minWidth !== undefined ||
    style.maxWidth !== undefined ||
    style.minHeight !== undefined ||
    style.maxHeight !== undefined
  )
    throw new Error(
      "Transitions currently require full-frame media with square, undecorated edges.",
    );
  for (const key of [
    "borderTopLeftRadius",
    "borderTopRightRadius",
    "borderBottomLeftRadius",
    "borderBottomRightRadius",
    "padding",
    "paddingTop",
    "paddingRight",
    "paddingBottom",
    "paddingLeft",
    "margin",
    "marginTop",
    "marginRight",
    "marginBottom",
    "marginLeft",
  ] as const)
    if (!zero(style[key]))
      throw new Error(
        "Remove clip padding or margins before adding a transition.",
      );
  if (style.backgroundColor && !opaqueColor(style.backgroundColor))
    throw new Error(
      "Transitions currently require an opaque clip background or the project background.",
    );
  if (
    node.type === "video" &&
    ((node.playbackRate ?? 1) <= 0 || node.videoEndBehavior === "loop")
  )
    throw new Error(
      "Transitions currently require forward, non-looping video.",
    );
  return style.backgroundColor ?? document.format.backgroundColor;
}

export function editorTransitionPlan(
  document: EditorDocument,
  transition: EditorTransition,
): EditorTransitionPlan {
  const from = document.items.find((item) => item.id === transition.fromItemId),
    to = document.items.find((item) => item.id === transition.toItemId);
  if (!from || !to || from.id === to.id)
    throw new Error(
      "A transition must reference two different existing clips.",
    );
  const firstVisual = document.tracks.find((track) => track.kind === "visual");
  if (from.trackId !== to.trackId || from.trackId !== firstVisual?.id)
    throw new Error(
      "Transitions currently belong between clips on the first video track.",
    );
  const cut = (from.node.from ?? 0) + from.node.duration!;
  if (cut !== (to.node.from ?? 0))
    throw new Error(
      "Transition clips must meet at the same cut. Move or trim both endpoints together, or remove the transition first.",
    );
  const before = Math.floor(transition.durationFrames / 2),
    after = transition.durationFrames - before;
  if (from.node.duration! < before || to.node.duration! < after)
    throw new Error(
      "The transition is longer than its adjacent clips. Shorten it first.",
    );
  const fromBackdrop = assertSimpleMedia(document, from),
    toBackdrop = assertSimpleMedia(document, to);
  const firstFrame = from.node.from ?? 0,
    endFrame = (to.node.from ?? 0) + to.node.duration!;
  if (
    document.items.some(
      (item) =>
        item.trackId === from.trackId &&
        item.id !== from.id &&
        item.id !== to.id &&
        (item.node.from ?? 0) < endFrame &&
        (item.node.from ?? 0) + item.node.duration! > firstFrame,
    )
  )
    throw new Error(
      "Transition clips cannot overlap another clip on their video track. Move overlays to another track.",
    );
  if (transition.kind === "dissolve" || transition.audio === "crossfade") {
    if (from.node.type === "video") {
      const source = document.assets[from.node.assetId!],
        rate = from.node.playbackRate ?? 1;
      if (source?.durationSeconds === undefined)
        throw new Error(
          "The outgoing source duration is unknown, so its transition handle cannot be verified.",
        );
      if (
        (from.node.videoStartTime ?? 0) +
          ((from.node.duration! + after) * rate) / document.format.fps >
        source.durationSeconds + 1e-8
      )
        throw new Error(
          "The outgoing clip does not have enough unused source frames for this transition.",
        );
    }
    if (
      to.node.type === "video" &&
      (to.node.videoStartTime ?? 0) -
        (before * (to.node.playbackRate ?? 1)) / document.format.fps <
        -1e-8
    )
      throw new Error(
        "The incoming clip does not have enough unused source frames for this transition.",
      );
  }
  if (
    transition.audio === "crossfade" &&
    [from, to].some(
      (item) => item.node.volumeEnvelope?.length || item.node.ducks,
    )
  )
    throw new Error(
      "Remove existing clip gain automation or ducking before enabling transition audio crossfade. Picture-only keeps that audio unchanged.",
    );
  return {
    transition,
    from,
    to,
    cut,
    before,
    after,
    start: cut - before,
    end: cut + after,
    fromBackdrop,
    toBackdrop,
  };
}

/** Final authoring-boundary validation; native reduction uses a composition-free view between commands. */
export function assertEditorComposition(document: EditorDocument): void {
  const items = new Set(document.items.map((item) => item.id)),
    grouped = new Map<string, string>();
  for (const [id, group] of Object.entries(document.linkedGroups ?? {})) {
    if (id !== group.id) throw new Error("Linked group key and ID must match.");
    for (const member of group.itemIds) {
      if (!items.has(member))
        throw new Error("A linked group references a missing clip.");
      if (grouped.has(member))
        throw new Error("A clip may belong to only one linked group.");
      grouped.set(member, id);
    }
  }
  for (const item of document.items) {
    const parent = item.caption?.sourceItemId ?? item.visualizerSourceItemId;
    if (
      parent &&
      grouped.get(parent) !== grouped.get(item.id) &&
      (grouped.has(parent) || grouped.has(item.id))
    )
      throw new Error(
        "A linked group must include its source and dependent caption or visualizer clips.",
      );
  }
  const incoming = new Map<string, EditorTransitionPlan>(),
    outgoing = new Map<string, EditorTransitionPlan>();
  for (const [id, transition] of Object.entries(document.transitions ?? {})) {
    if (id !== transition.id)
      throw new Error("Transition key and ID must match.");
    const plan = editorTransitionPlan(document, transition);
    if (
      outgoing.has(transition.fromItemId) ||
      incoming.has(transition.toItemId)
    )
      throw new Error("A clip may have only one transition at each edge.");
    outgoing.set(transition.fromItemId, plan);
    incoming.set(transition.toItemId, plan);
  }
  incoming.forEach((plan, id) => {
    if (plan.after + (outgoing.get(id)?.before ?? 0) > plan.to.node.duration!)
      throw new Error(
        "Incoming and outgoing transitions overlap inside a clip. Shorten a transition first.",
      );
  });
}
