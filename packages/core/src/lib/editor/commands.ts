import {
  parseEditorDocument,
  type EditorDocument,
  type EditorAsset,
  type EditorTrack,
  type EditorItem,
  type EditorFormat,
} from "./document";
import type { SceneNodeInput } from "@dojo-video-engine/schema";
import { evaluateKeyframes } from "@dojo-video-engine/core";
import { assertEditorCanvasDimensions } from "./canvas-format";

export type EditorCommand =
  | { type: "addAsset"; asset: EditorAsset }
  | { type: "addTrack"; track: EditorTrack }
  | { type: "updateTrack"; id: string; patch: Partial<Omit<EditorTrack, "id">> }
  | { type: "addItem"; item: EditorItem }
  | { type: "updateItem"; id: string; patch: Partial<Omit<EditorItem, "id">> }
  | { type: "removeItem"; id: string }
  | { type: "duplicateItem"; id: string; newId: string }
  | { type: "splitItem"; id: string; frame: number; newId: string }
  | { type: "moveItem"; id: string; from: number; trackId?: string }
  | { type: "trimItem"; id: string; from: number; duration: number }
  | { type: "updateFormat"; patch: Partial<EditorFormat> }
  | { type: "removeGap"; trackId: string; frame: number };

function remapIds(
  node: SceneNodeInput,
  oldId: string,
  newId: string,
  occupied = new Set<string>([newId]),
): SceneNodeInput {
  return {
    ...node,
    id: node.id === oldId ? newId : derivedItemId(newId, node.id, occupied),
    children: node.children?.map((child) =>
      remapIds(child, oldId, newId, occupied),
    ),
  };
}

function occupiedNodeIds(document: EditorDocument) {
  const ids = new Set<string>();
  const visit = (node: SceneNodeInput) => {
    ids.add(node.id);
    node.children?.forEach(visit);
  };
  document.items.forEach((item) => visit(item.node));
  return ids;
}

/** Browser-safe deterministic labels, with document-local collision checks. */
function derivedItemId(
  parentId: string,
  childId: string,
  occupied: Set<string>,
) {
  const preferred = parentId + ":" + childId;
  const value = parentId + "\0" + childId;
  const hash = (seed: number) => {
    let result = seed;
    for (let i = 0; i < value.length; i++)
      result = Math.imul(result ^ value.charCodeAt(i), 16777619);
    return (result >>> 0).toString(36);
  };
  const base =
    preferred.length <= 191
      ? preferred
      : parentId.slice(0, 80) +
        ":linked:" +
        hash(2166136261) +
        hash(2246822519);
  let candidate = base,
    suffix = 0;
  while (occupied.has(candidate))
    candidate = base.slice(0, 180) + ":" + ++suffix;
  occupied.add(candidate);
  return candidate;
}

function retimeNode(node: SceneNodeInput, ratio: number): SceneNodeInput {
  const scale = (value: number) => Math.max(0, Math.round(value * ratio));
  const points = <T extends { frame: number }>(values: T[]) => [
    ...new Map(
      values.map((point) => [
        scale(point.frame),
        { ...point, frame: scale(point.frame) },
      ]),
    ).values(),
  ];
  return {
    ...node,
    from: scale(node.from ?? 0),
    ...(node.duration ? { duration: Math.max(1, scale(node.duration)) } : {}),
    animations: node.animations?.map((a) => ({
      ...a,
      frames: points(a.frames),
    })),
    volumeEnvelope: node.volumeEnvelope
      ? points(node.volumeEnvelope)
      : undefined,
    children: node.children?.map((child) => retimeNode(child, ratio)),
    ...(node.ducks
      ? {
          ducks: {
            ...node.ducks,
            ...(node.ducks.attackFrames !== undefined
              ? { attackFrames: scale(node.ducks.attackFrames) }
              : {}),
            ...(node.ducks.releaseFrames !== undefined
              ? { releaseFrames: scale(node.ducks.releaseFrames) }
              : {}),
          },
        }
      : {}),
  };
}

/** A source-time adjustment must account for speed, including when splitting. */
function offsetItem(item: EditorItem, frames: number, fps: number): EditorItem {
  const next = structuredClone(item);
  const node = next.node;
  if (node.type === "video") {
    const start =
      (node.videoStartTime ?? 0) + (frames / fps) * (node.playbackRate ?? 1);
    if (start < -1e-8)
      throw new Error("The trim starts before the source media.");
    node.videoStartTime = Math.max(0, start);
  }
  if (node.type === "audio") {
    const start = (node.audioStartTime ?? 0) + frames / fps;
    if (start < -1e-8)
      throw new Error("The trim starts before the source media.");
    node.audioStartTime = Math.max(0, start);
  }
  if (next.caption) {
    const offset = (frames * 1000) / fps;
    next.caption.cues = next.caption.cues
      .filter((c) => c.endMs > offset)
      .map((c) => ({
        ...c,
        startMs: Math.max(0, c.startMs - offset),
        endMs: c.endMs - offset,
        words: c.words
          ?.filter((w) => w.endMs > offset)
          .map((w) => ({
            ...w,
            startMs: Math.max(0, w.startMs - offset),
            endMs: w.endMs - offset,
          })),
      }));
  }
  // Child clocks remain rooted in the original group when a parent is cut.
  // Negative child starts preserve nested video, Lottie and animation samples.
  if (frames && node.children?.length)
    node.children = node.children.map((child) => ({
      ...child,
      from: (child.from ?? 0) - frames,
    }));
  // Native keyframes/envelopes are node-local: retain their evaluated source time
  // by shifting the frame clock when the start of an item is trimmed.
  if (frames && node.animations?.length)
    node.animations = node.animations.map((animation) => ({
      ...animation,
      frames: [
        {
          frame: 0,
          value:
            evaluateKeyframes(animation.frames, frames) ??
            animation.frames[0]!.value,
        },
        ...animation.frames
          .filter((f) => f.frame > frames)
          .map((f) => ({ ...f, frame: f.frame - frames })),
      ],
    }));
  if (frames && node.volumeEnvelope)
    node.volumeEnvelope = [
      {
        frame: 0,
        value: Number(evaluateKeyframes(node.volumeEnvelope, frames)),
      },
      ...node.volumeEnvelope
        .filter((f) => f.frame > frames)
        .map((f) => ({ ...f, frame: f.frame - frames })),
    ];
  return next;
}

function sourceOffset(node: SceneNodeInput) {
  return node.type === "video"
    ? (node.videoStartTime ?? 0)
    : node.type === "audio"
      ? (node.audioStartTime ?? 0)
      : 0;
}

/** Map the saved cue clock through source seconds, then clip to the new media window. */
function reprojectSourceCaption(
  caption: EditorItem,
  previous: EditorItem,
  changed: EditorItem,
  fps: number,
): EditorItem {
  const oldRate =
    previous.node.type === "video" ? (previous.node.playbackRate ?? 1) : 1;
  const newRate =
    changed.node.type === "video" ? (changed.node.playbackRate ?? 1) : 1;
  if (oldRate <= 0 || newRate <= 0)
    throw new Error("Source-bound captions require forward media playback.");
  const relativeMs =
    (((caption.node.from ?? 0) - (previous.node.from ?? 0)) * 1000) / fps;
  const sourceDeltaMs =
    (sourceOffset(previous.node) - sourceOffset(changed.node)) * 1000;
  const toPresentationMs = (time: number) =>
    (sourceDeltaMs + (relativeMs + time) * oldRate) / newRate;
  const durationMs = (changed.node.duration! * 1000) / fps;
  const cues = caption.caption!.cues.flatMap((cue) => {
    const startMs = Math.max(0, toPresentationMs(cue.startMs));
    const endMs = Math.min(durationMs, toPresentationMs(cue.endMs));
    if (endMs <= startMs) return [];
    const words = cue.words?.flatMap((word) => {
      const start = Math.max(startMs, toPresentationMs(word.startMs));
      const end = Math.min(endMs, toPresentationMs(word.endMs));
      return end > start ? [{ ...word, startMs: start, endMs: end }] : [];
    });
    return [{ ...cue, startMs, endMs, ...(words ? { words } : {}) }];
  });
  return {
    ...caption,
    node: {
      ...caption.node,
      from: changed.node.from,
      duration: changed.node.duration,
    },
    caption: { ...caption.caption!, cues },
  };
}

export function applyEditorCommand(
  input: EditorDocument,
  command: EditorCommand,
): EditorDocument {
  const doc = structuredClone(parseEditorDocument(input));
  const itemIndex =
    "id" in command ? doc.items.findIndex((i) => i.id === command.id) : -1;
  const item = itemIndex >= 0 ? doc.items[itemIndex]! : undefined;
  const needsItem = [
    "updateItem",
    "removeItem",
    "duplicateItem",
    "splitItem",
    "moveItem",
    "trimItem",
  ].includes(command.type);
  if (needsItem && !item)
    throw new Error("The selected item no longer exists.");
  if (needsItem && doc.tracks.find((t) => t.id === item!.trackId)?.locked)
    throw new Error("Unlock the track before editing it.");
  if (
    item?.visualizerSourceItemId &&
    ["moveItem", "trimItem", "splitItem"].includes(command.type)
  )
    throw new Error("Unlink the visualizer before changing its timing.");
  switch (command.type) {
    case "addAsset":
      if (
        doc.assets[command.asset.id] &&
        JSON.stringify(doc.assets[command.asset.id]) !==
          JSON.stringify(command.asset)
      ) {
        const old = doc.assets[command.asset.id]!;
        // Font descriptors may be enriched without replacing the immutable file.
        if (
          !(
            old.type === "font" &&
            command.asset.type === "font" &&
            old.source === "static" &&
            command.asset.source === "static" &&
            old.src === command.asset.src
          )
        )
          throw new Error("An asset ID cannot be rebound to different media.");
      }
      doc.assets[command.asset.id] = command.asset;
      break;
    case "addTrack":
      doc.tracks.push(command.track);
      break;
    case "updateTrack": {
      const index = doc.tracks.findIndex((t) => t.id === command.id);
      if (index < 0) throw new Error("Track not found.");
      doc.tracks[index] = { ...doc.tracks[index]!, ...command.patch };
      break;
    }
    case "addItem":
      if (doc.tracks.find((t) => t.id === command.item.trackId)?.locked)
        throw new Error("Unlock the target track first.");
      doc.items.push(command.item);
      break;
    case "updateItem":
      doc.items[itemIndex] = {
        ...item!,
        ...command.patch,
        node: command.patch.node
          ? { ...item!.node, ...command.patch.node }
          : item!.node,
      };
      break;
    case "removeItem":
      doc.items = doc.items.filter(
        (i) =>
          i.id !== command.id &&
          i.caption?.sourceItemId !== command.id &&
          i.visualizerSourceItemId !== command.id,
      );
      break;
    case "duplicateItem": {
      if (item!.visualizerSourceItemId)
        throw new Error("Unlink the visualizer or duplicate its source clip.");
      const linkedItems = doc.items.filter(
        (i) =>
          i.caption?.sourceItemId === item!.id ||
          i.visualizerSourceItemId === item!.id,
      );
      const occupied = occupiedNodeIds(doc);
      occupied.add(command.newId);
      const derivedIds = new Map(
        linkedItems.map((linked) => [
          linked.id,
          derivedItemId(command.newId, linked.id, occupied),
        ]),
      );
      doc.items.push({
        ...structuredClone(item!),
        id: command.newId,
        node: {
          ...remapIds(item!.node, item!.id, command.newId),
          from: (item!.node.from ?? 0) + item!.node.duration!,
        },
      });
      for (const linked of linkedItems) {
        const copy = structuredClone(linked);
        copy.id = derivedIds.get(linked.id)!;
        copy.node = {
          ...remapIds(copy.node, linked.id, copy.id),
          from: (copy.node.from ?? 0) + item!.node.duration!,
        };
        if (copy.visualizerSourceItemId)
          copy.visualizerSourceItemId = command.newId;
        if (copy.caption) {
          copy.caption.sourceItemId = command.newId;
          if (copy.caption.pairedItemId)
            copy.caption.pairedItemId = derivedIds.get(
              copy.caption.pairedItemId,
            );
        }
        doc.items.push(copy);
      }
      break;
    }
    case "moveItem": {
      if (
        command.trackId &&
        doc.tracks.find((t) => t.id === command.trackId)?.locked
      )
        throw new Error("Unlock the target track first.");
      doc.items[itemIndex] = {
        ...item!,
        trackId: command.trackId ?? item!.trackId,
        node: { ...item!.node, from: command.from },
      };
      break;
    }
    case "trimItem": {
      const start = item!.node.from ?? 0;
      const next = offsetItem(item!, command.from - start, doc.format.fps);
      next.node = {
        ...next.node,
        from: command.from,
        duration: command.duration,
      };
      doc.items[itemIndex] = next;
      break;
    }
    case "splitItem": {
      const start = item!.node.from ?? 0;
      const offset = command.frame - start;
      const duration = item!.node.duration!;
      if (!Number.isInteger(command.frame) || offset <= 0 || offset >= duration)
        throw new Error("Split inside the selected clip.");
      const captions = doc.items.filter(
        (i) => i.caption?.sourceItemId === item!.id,
      );
      const visualizers = doc.items.filter(
        (i) => i.visualizerSourceItemId === item!.id,
      );
      const occupied = occupiedNodeIds(doc);
      occupied.add(command.newId);
      const derivedIds = new Map<string, string>();
      const movedCaptionIds = new Set<string>();
      for (const caption of captions) {
        const at = command.frame - (caption.node.from ?? 0);
        if (at >= caption.node.duration!) continue;
        if (at <= 0) {
          derivedIds.set(caption.id, caption.id);
          movedCaptionIds.add(caption.id);
        } else
          derivedIds.set(
            caption.id,
            derivedItemId(command.newId, caption.id, occupied),
          );
      }
      for (const visualizer of visualizers)
        derivedIds.set(
          visualizer.id,
          derivedItemId(command.newId, visualizer.id, occupied),
        );
      const right = offsetItem(item!, offset, doc.format.fps);
      right.id = command.newId;
      right.node = {
        ...remapIds(right.node, item!.id, command.newId),
        from: command.frame,
        duration: duration - offset,
      };
      doc.items[itemIndex] = {
        ...item!,
        node: { ...item!.node, duration: offset },
      };
      doc.items.splice(itemIndex + 1, 0, right);
      for (const caption of captions) {
        const captionOffset = command.frame - (caption.node.from ?? 0);
        if (captionOffset >= caption.node.duration!) continue;
        const previousPair = caption.caption!.pairedItemId;
        if (captionOffset <= 0) {
          caption.caption!.sourceItemId = right.id;
          if (previousPair)
            caption.caption!.pairedItemId = derivedIds.get(previousPair);
          continue;
        }
        const tail = offsetItem(caption, captionOffset, doc.format.fps);
        tail.id = derivedIds.get(caption.id)!;
        tail.node = {
          ...remapIds(tail.node, caption.id, tail.id),
          from: command.frame,
          duration: caption.node.duration! - captionOffset,
        };
        tail.caption!.sourceItemId = right.id;
        if (previousPair)
          tail.caption!.pairedItemId = derivedIds.get(previousPair);
        caption.node.duration = captionOffset;
        doc.items.push(tail);
      }
      for (const caption of captions)
        if (
          !movedCaptionIds.has(caption.id) &&
          caption.caption!.pairedItemId &&
          movedCaptionIds.has(caption.caption!.pairedItemId)
        ) {
          caption.caption!.pairedItemId = undefined;
        }
      for (const visualizer of visualizers) {
        const tail = structuredClone(visualizer);
        tail.id = derivedIds.get(visualizer.id)!;
        tail.visualizerSourceItemId = right.id;
        tail.node = {
          ...remapIds(tail.node, visualizer.id, tail.id),
          from: command.frame,
          duration: duration - offset,
        };
        visualizer.node.duration = offset;
        doc.items.push(tail);
      }
      break;
    }
    case "updateFormat": {
      assertEditorCanvasDimensions(command.patch);
      const ratio = (command.patch.fps ?? doc.format.fps) / doc.format.fps;
      if (ratio !== 1) {
        doc.items = doc.items.map((i) => ({
          ...i,
          node: retimeNode(i.node, ratio),
        }));
        doc.format.durationInFrames = Math.max(
          1,
          Math.round(doc.format.durationInFrames * ratio),
        );
        if (doc.markers)
          doc.markers = Object.fromEntries(
            Object.entries(doc.markers).map(([key, value]) => [
              key,
              Math.round(value * ratio),
            ]),
          );
      }
      doc.format = { ...doc.format, ...command.patch };
      break;
    }
    case "removeGap": {
      const track = doc.tracks.find((t) => t.id === command.trackId);
      if (!track || track.locked) throw new Error("Select an unlocked track.");
      const clips = doc.items
        .filter((i) => i.trackId === command.trackId)
        .sort((a, b) => (a.node.from ?? 0) - (b.node.from ?? 0));
      if (
        clips.some(
          (i) =>
            (i.node.from ?? 0) <= command.frame &&
            (i.node.from ?? 0) + i.node.duration! > command.frame,
        )
      )
        throw new Error("Select an empty gap.");
      const before = Math.max(
        0,
        ...clips
          .filter((i) => (i.node.from ?? 0) + i.node.duration! <= command.frame)
          .map((i) => (i.node.from ?? 0) + i.node.duration!),
      );
      const after = clips.find((i) => (i.node.from ?? 0) > command.frame)?.node
        .from;
      if (after === undefined) break;
      const moved = clips.filter((clip) => (clip.node.from ?? 0) >= after);
      const ids = new Set(moved.map((clip) => clip.id));
      for (const clip of doc.items)
        if (
          ids.has(clip.id) ||
          (clip.caption?.sourceItemId && ids.has(clip.caption.sourceItemId)) ||
          (clip.visualizerSourceItemId && ids.has(clip.visualizerSourceItemId))
        ) {
          clip.node.from = Math.max(
            0,
            (clip.node.from ?? 0) - (after - before),
          );
        }
      break;
    }
  }
  // Source-bound subtitles follow the same edit transaction as their clip.
  if (item && ["moveItem", "trimItem", "updateItem"].includes(command.type)) {
    const changed = doc.items.find((i) => i.id === item.id)!;
    const delta = (changed.node.from ?? 0) - (item.node.from ?? 0);
    const ratio =
      (item.node.playbackRate ?? 1) / (changed.node.playbackRate ?? 1);
    for (const [index, caption] of doc.items.entries()) {
      if (caption.visualizerSourceItemId === item.id) {
        caption.node = {
          ...caption.node,
          from: changed.node.from,
          duration: changed.node.duration,
        };
        continue;
      }
      if (caption.caption?.sourceItemId !== item.id) continue;
      // trimItem already shifts source and cue clocks together in offsetItem.
      // Inspector source/rate edits arrive as updateItem and need this distinct projection.
      if (
        command.type === "updateItem" &&
        (sourceOffset(item.node) !== sourceOffset(changed.node) || ratio !== 1)
      ) {
        doc.items[index] = reprojectSourceCaption(
          caption,
          item,
          changed,
          doc.format.fps,
        );
        continue;
      }
      if (
        command.type === "updateItem" &&
        changed.node.duration !== item.node.duration
      ) {
        // Duration-only edits change the visible source window, not the saved
        // words. Align a later caption container to the source clock, retaining
        // its word/animation offsets so extending the clip restores its cues.
        const aligned = offsetItem(
          caption,
          (item.node.from ?? 0) - (caption.node.from ?? 0),
          doc.format.fps,
        );
        aligned.node = {
          ...aligned.node,
          from: changed.node.from,
          duration: changed.node.duration,
        };
        doc.items[index] = aligned;
        continue;
      }
      const next =
        command.type === "trimItem"
          ? offsetItem(caption, delta, doc.format.fps)
          : caption;
      next.node = {
        ...next.node,
        from: (caption.node.from ?? 0) + delta,
        ...(command.type === "trimItem"
          ? { duration: changed.node.duration }
          : {}),
      };
      doc.items[index] = next;
    }
  }
  const end = Math.max(
    1,
    ...doc.items.map((i) => (i.node.from ?? 0) + (i.node.duration ?? 1)),
  );
  if (
    command.type === "updateFormat" &&
    command.patch.durationInFrames !== undefined &&
    command.patch.durationInFrames < end
  )
    throw new Error("Duration cannot cut off timeline items.");
  doc.format.durationInFrames = Math.max(doc.format.durationInFrames, end);
  return parseEditorDocument(doc);
}

/** Shared source-clock primitive for native semantic range cuts. */
export { offsetItem as offsetEditorItem };
