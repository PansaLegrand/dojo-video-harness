import type { SceneNodeInput } from "@dojo-video-engine/schema";
import type { EditorItem } from "@/lib/editor/document";
import {
  canonicalSerialize,
  parseVideoProjectDocument,
  type VideoProjectDocument,
} from "./document";
import {
  executeVideoProjectCommands,
  type VideoProjectCommand,
  type VideoProjectTarget,
} from "./commands";

const equal = (a: unknown, b: unknown) =>
  canonicalSerialize(a) === canonicalSerialize(b);
const record = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === "object" && !Array.isArray(value);
function properties(
  target: VideoProjectTarget,
  before: unknown,
  after: unknown,
  path: string[],
  commands: VideoProjectCommand[],
) {
  if (equal(before, after)) return;
  if (
    record(after) &&
    (record(before) || before === undefined) &&
    Object.keys(after).length
  ) {
    const old = record(before) ? before : {};
    for (const key of new Set([...Object.keys(old), ...Object.keys(after)]))
      properties(target, old[key], after[key], [...path, key], commands);
  } else if (after === undefined)
    commands.push({ type: "clear", target, path });
  else commands.push({ type: "set", target, path, value: after as never });
}
function nodes(
  itemId: string,
  current: SceneNodeInput,
  previous: SceneNodeInput,
  commands: VideoProjectCommand[],
) {
  for (const key of new Set([
    ...Object.keys(current),
    ...Object.keys(previous),
  ])) {
    if (["id", "type", "children"].includes(key)) continue;
    properties(
      { kind: "node", itemId, nodeId: current.id },
      (current as unknown as Record<string, unknown>)[key],
      (previous as unknown as Record<string, unknown>)[key],
      [key],
      commands,
    );
  }
  const oldChildren = current.children ?? [],
    newChildren = previous.children ?? [];
  for (const child of oldChildren)
    if (!newChildren.some((node) => node.id === child.id))
      commands.push({ type: "removeNode", itemId, nodeId: child.id });
  for (const [index, child] of newChildren.entries()) {
    const old = oldChildren.find((node) => node.id === child.id);
    if (old) nodes(itemId, old, child, commands);
    else
      commands.push({
        type: "addNode",
        itemId,
        parentNodeId: current.id,
        node: child,
        index,
      });
  }
  if (
    !equal(
      oldChildren.map((child) => child.id),
      newChildren.map((child) => child.id),
    )
  )
    commands.push({
      type: "reorderNodes",
      itemId,
      parentNodeId: current.id,
      ids: newChildren.map((child) => child.id),
    });
}
function itemChanges(
  current: EditorItem,
  previous: EditorItem,
  commands: VideoProjectCommand[],
) {
  for (const key of ["name", "trackId", "visualizerSourceItemId"] as const)
    properties(
      { kind: "item", itemId: current.id },
      current[key],
      previous[key],
      [key],
      commands,
    );
  nodes(current.id, current.node, previous.node, commands);
  if (current.caption && previous.caption) {
    for (const key of new Set([
      ...Object.keys(current.caption),
      ...Object.keys(previous.caption),
    ])) {
      if (
        key === "cues" &&
        equal(
          current.caption.cues.map((cue) => cue.id),
          previous.caption.cues.map((cue) => cue.id),
        )
      ) {
        for (const cue of previous.caption.cues) {
          const prior = current.caption.cues.find(
            (value) => value.id === cue.id,
          )!;
          for (const field of ["text", "startMs", "endMs", "words"] as const)
            properties(
              { kind: "cue", itemId: current.id, cueId: cue.id },
              prior[field],
              cue[field],
              [field],
              commands,
            );
        }
      } else
        properties(
          { kind: "caption", itemId: current.id },
          (current.caption as unknown as Record<string, unknown>)[key],
          (previous.caption as unknown as Record<string, unknown>)[key],
          [key],
          commands,
        );
    }
  }
}

/**
 * Build the inverse of an acknowledged edit, suitable for rebase(after, current).
 * Source files, cloud bindings and ASR evidence are reusable results and remain
 * available. Reverting an edit never reverses a charge or recreates a paid job.
 */
export function buildVideoProjectRevertCommands(
  beforeInput: VideoProjectDocument,
  afterInput: VideoProjectDocument,
): VideoProjectCommand[] {
  const previous = parseVideoProjectDocument(beforeInput),
    current = parseVideoProjectDocument(afterInput);
  const commands: VideoProjectCommand[] = [];
  // Temporarily release only locks changed by this operation; pre-existing locks
  // remain enforced by execution and by the caller's rebase check.
  for (const track of current.tracks)
    if (
      track.locked &&
      previous.tracks.find((old) => old.id === track.id)?.locked === false
    )
      commands.push({
        type: "set",
        target: { kind: "track", trackId: track.id },
        path: ["locked"],
        value: false,
      });
  for (const track of previous.tracks)
    if (!current.tracks.some((value) => value.id === track.id))
      commands.push({ type: "addTrack", track: { ...track, locked: false } });
  // Remove changed composition links before restoring endpoint/member geometry;
  // recreate their exact optional records only after all original IDs are back.
  for (const transition of Object.values(current.transitions ?? {}))
    if (!equal(previous.transitions?.[transition.id], transition))
      commands.push({ type: "removeTransition", id: transition.id });
  for (const group of Object.values(current.linkedGroups ?? {}))
    if (!equal(previous.linkedGroups?.[group.id], group))
      commands.push({ type: "removeLinkedGroup", id: group.id });
  // Release affected anchors inside this atomic inverse before restoring their
  // authored geometry; restoring the source/binding later reprojects it once.
  const releasedBindings = new Set<string>();
  for (const binding of Object.values(current.bindings)) {
    const old = previous.bindings[binding.id];
    const currentItem = current.items.find(
        (item) => item.id === binding.itemId,
      ),
      oldItem = previous.items.find((item) => item.id === binding.itemId);
    if (
      !old ||
      !equal(old, binding) ||
      currentItem?.node.from !== oldItem?.node.from ||
      currentItem?.node.duration !== oldItem?.node.duration
    ) {
      commands.push({ type: "removeBinding", id: binding.id });
      releasedBindings.add(binding.id);
    }
  }
  const missing = previous.items.filter(
    (item) => !current.items.some((value) => value.id === item.id),
  );
  for (const item of missing.sort(
    (a, b) =>
      Number(["video", "audio"].includes(b.node.type)) -
      Number(["video", "audio"].includes(a.node.type)),
  ))
    commands.push({ type: "addItem", item });
  for (const old of [...previous.items].sort(
    (a, b) =>
      Number(["video", "audio"].includes(b.node.type)) -
      Number(["video", "audio"].includes(a.node.type)),
  )) {
    const item = current.items.find((value) => value.id === old.id);
    if (item) itemChanges(item, old, commands);
  }
  for (const binding of Object.values(previous.bindings))
    if (
      releasedBindings.has(binding.id) ||
      !equal(current.bindings[binding.id], binding)
    )
      commands.push({ type: "bindSource", binding });
  const removed = new Set(
    current.items
      .filter((item) => !previous.items.some((old) => old.id === item.id))
      .map((item) => item.id),
  );
  // Remove sources last: their reducer also removes linked captions/visualizers.
  const removalItems = current.items
    .filter((item) => removed.has(item.id))
    .sort(
      (a, b) =>
        Number(["video", "audio"].includes(a.node.type)) -
        Number(["video", "audio"].includes(b.node.type)),
    );
  for (const item of removalItems)
    commands.push({ type: "removeItem", id: item.id });
  for (const track of current.tracks)
    if (!previous.tracks.some((old) => old.id === track.id)) {
      if (track.locked)
        commands.push({
          type: "set",
          target: { kind: "track", trackId: track.id },
          path: ["locked"],
          value: false,
        });
      commands.push({ type: "removeTrack", id: track.id });
    }
  const finalLocks: VideoProjectCommand[] = [];
  for (const track of previous.tracks) {
    const old = current.tracks.find((value) => value.id === track.id);
    if (old) {
      for (const key of ["name", "kind", "hidden", "muted"] as const)
        properties(
          { kind: "track", trackId: track.id },
          old[key],
          track[key],
          [key],
          commands,
        );
      properties(
        { kind: "track", trackId: track.id },
        old.locked,
        track.locked,
        ["locked"],
        finalLocks,
      );
    } else if (track.locked)
      finalLocks.push({
        type: "set",
        target: { kind: "track", trackId: track.id },
        path: ["locked"],
        value: true,
      });
  }
  if (
    !equal(
      current.items.map((item) => item.id),
      previous.items.map((item) => item.id),
    )
  )
    commands.push({
      type: "reorderItems",
      ids: previous.items.map((item) => item.id),
    });
  if (
    !equal(
      current.tracks.map((track) => track.id),
      previous.tracks.map((track) => track.id),
    )
  )
    commands.push({
      type: "reorderTracks",
      ids: previous.tracks.map((track) => track.id),
    });
  // FPS must be restored before explicit original frame values. Its native
  // rescaling is reversed first, then remaining property edits establish exact
  // saved values (including rounded frames).
  const formatCommands: VideoProjectCommand[] = [];
  for (const key of Object.keys(previous.format))
    properties(
      { kind: "format" },
      (current.format as unknown as Record<string, unknown>)[key],
      (previous.format as unknown as Record<string, unknown>)[key],
      [key],
      formatCommands,
    );
  if (current.format.fps !== previous.format.fps) {
    const fps = formatCommands.find(
      (command) =>
        (command.type === "set" || command.type === "clear") &&
        command.path[0] === "fps",
    )!;
    let afterUnlocks = 0;
    while (
      afterUnlocks < commands.length &&
      commands[afterUnlocks]!.type === "set" &&
      (commands[afterUnlocks] as { value?: unknown }).value === false
    )
      afterUnlocks++;
    commands.splice(afterUnlocks, 0, fps);
    const withoutFps = formatCommands.filter((command) => command !== fps);
    commands.push(...withoutFps);
  } else commands.push(...formatCommands);
  for (const key of ["markers", "audioBuses"] as const)
    properties(
      { kind: "project" },
      current[key],
      previous[key],
      [key],
      commands,
    );
  for (const group of Object.values(previous.linkedGroups ?? {}))
    if (!equal(current.linkedGroups?.[group.id], group))
      commands.push({ type: "setLinkedGroup", group });
  for (const transition of Object.values(previous.transitions ?? {}))
    if (!equal(current.transitions?.[transition.id], transition))
      commands.push({ type: "setTransition", transition });
  if (!equal(current.creativeContext, previous.creativeContext))
    commands.push({
      type: "updateCreativeContext",
      context: previous.creativeContext,
    });
  commands.push(...finalLocks);
  if (commands.length) executeVideoProjectCommands(current, commands);
  return commands;
}
