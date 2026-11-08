import {
  editorItemKind,
  editorItemKinds,
  editorTrackContentKind,
  type EditorItemKind,
} from "@/lib/editor/timeline-tracks";
import type { EditorItem, EditorTrack } from "@/lib/editor/document";
import type { VideoProjectDocument } from "./document";
import type { VideoProjectCommand } from "./commands";

const paintOrder = Object.keys(editorItemKinds) as EditorItemKind[];
const overlaps = (left: EditorItem, right: EditorItem) =>
  (left.node.from ?? 0) < (right.node.from ?? 0) + right.node.duration! &&
  (right.node.from ?? 0) < (left.node.from ?? 0) + left.node.duration!;

/** Place new or retyped agent items after rebase in the same guarded edit. */
export function generatedTrackCommands(
  before: VideoProjectDocument,
  after: VideoProjectDocument,
): VideoProjectCommand[] {
  const oldItems = new Map(before.items.map((item) => [item.id, item]));
  // Splits retain their original lane even when an older project used a mixed
  // visual track. Exact timeline/source coverage distinguishes them from layers.
  const splitIds = new Set<string>();
  for (const source of before.items) {
    if (!["video", "audio"].includes(source.node.type)) continue;
    const head = after.items.find((item) => item.id === source.id);
    if (!head || head.node.duration! >= source.node.duration!) continue;
    const from = source.node.from ?? 0,
      end = from + source.node.duration!;
    const rate = source.node.playbackRate ?? 1;
    const sourceStart =
      source.node.type === "audio"
        ? (source.node.audioStartTime ?? 0)
        : (source.node.videoStartTime ?? 0);
    const pieces = after.items
      .filter(
        (item) =>
          (item.id === source.id || !oldItems.has(item.id)) &&
          item.trackId === source.trackId &&
          item.node.type === source.node.type &&
          item.node.assetId === source.node.assetId &&
          (item.node.from ?? 0) >= from &&
          (item.node.from ?? 0) + item.node.duration! <= end,
      )
      .sort((a, b) => (a.node.from ?? 0) - (b.node.from ?? 0));
    let cursor = from;
    const contiguous =
      pieces.length > 1 &&
      pieces.some((item) => item.id === source.id) &&
      pieces.every((item) => {
        const at = item.node.from ?? 0;
        const start =
          item.node.type === "audio"
            ? (item.node.audioStartTime ?? 0)
            : (item.node.videoStartTime ?? 0);
        const matches =
          at === cursor &&
          (item.node.playbackRate ?? 1) === rate &&
          Math.abs(
            start - sourceStart - ((at - from) * rate) / before.format.fps,
          ) < 1e-7;
        cursor += item.node.duration!;
        return matches;
      });
    if (before.format.fps === after.format.fps && contiguous && cursor === end)
      pieces
        .filter((item) => !oldItems.has(item.id))
        .forEach((item) => splitIds.add(item.id));
  }
  const added = after.items.filter((item) => {
    const previous = oldItems.get(item.id);
    return (
      !splitIds.has(item.id) &&
      (!previous || editorItemKind(previous) !== editorItemKind(item))
    );
  });
  if (!added.length) return [];
  const addedIds = new Set(added.map((item) => item.id));
  const placed = after.items.filter((item) => !addedIds.has(item.id));
  const tracks = after.tracks.map((track) => ({ ...track }));
  const commands: VideoProjectCommand[] = [];
  for (const item of added) {
    const kind = editorItemKind(item);
    const suitable = (track: EditorTrack) => {
      if (
        track.locked ||
        track.hidden ||
        track.muted ||
        track.kind !== (kind === "audio" ? "audio" : "visual")
      )
        return false;
      const members = placed.filter(
        (candidate) => candidate.trackId === track.id,
      );
      const contentKind =
        editorTrackContentKind(track, members) ??
        (!members.length
          ? editorTrackContentKind(track, after.items)
          : undefined);
      return (
        contentKind === kind &&
        members.every(
          (candidate) =>
            !overlaps(candidate, item) &&
            (kind !== "translation" ||
              candidate.caption?.language === item.caption?.language),
        )
      );
    };
    let track =
      tracks.find((track) => track.id === item.trackId && suitable(track)) ??
      tracks.find(suitable);
    if (!track) {
      if (tracks.length >= 64)
        throw new Error(
          "The timeline has reached its 64-track limit. Remove an empty track before adding another layer.",
        );
      const prefix = `track:${kind}`;
      let id = prefix,
        number = 1;
      while (tracks.some((track) => track.id === id))
        id = `${prefix}:${++number}`;
      const lane =
        tracks.filter((track) => editorTrackContentKind(track, placed) === kind)
          .length + 1;
      track = {
        id,
        name: editorItemKinds[kind] + (lane > 1 ? ` ${lane}` : ""),
        kind: kind === "audio" ? "audio" : "visual",
        locked: false,
        hidden: false,
        muted: false,
      };
      commands.push({ type: "addTrack", track });
      tracks.push(track);
    }
    if (track.id !== item.trackId)
      commands.push({
        type: "set",
        target: { kind: "item", itemId: item.id },
        path: ["trackId"],
        value: track.id,
      });
    placed.push({ ...item, trackId: track.id });
  }
  const appended = [
    ...after.tracks.map((track) => track.id),
    ...commands.flatMap((command) =>
      command.type === "addTrack" ? [command.track.id] : [],
    ),
  ];
  const oldTracks = new Set(before.tracks.map((track) => track.id));
  const orderedTracks = tracks.filter((track) => oldTracks.has(track.id));
  for (const track of tracks.filter((track) => !oldTracks.has(track.id))) {
    const kind = editorTrackContentKind(track, placed);
    const rank = kind === undefined ? -1 : paintOrder.indexOf(kind);
    const at =
      rank < 0
        ? -1
        : orderedTracks.findIndex((candidate) => {
            const candidateKind = editorTrackContentKind(candidate, placed);
            return (
              candidateKind !== undefined &&
              paintOrder.indexOf(candidateKind) > rank
            );
          });
    orderedTracks.splice(at < 0 ? orderedTracks.length : at, 0, track);
  }
  // Locked tracks keep their exact row positions. New lanes can still be appended.
  const ordered = (
    tracks.some((track) => track.locked) ? tracks : orderedTracks
  ).map((track) => track.id);
  if (ordered.some((id, index) => id !== appended[index]))
    commands.push({ type: "reorderTracks", ids: ordered });
  return commands;
}
