import {
  compositionCommandSchemas,
  isVideoCompositionCommand,
} from "./composition-commands";
import {
  applyCompositionCommand,
  compositionCommandItems,
  reconcileComposition,
} from "./composition";
import { z } from "zod/v3";
import {
  jsonValueSchema,
  sceneNodeSchema,
  type SceneNodeInput,
} from "@motionforge/schema";
import {
  applyEditorCommand,
  offsetEditorItem,
  type EditorCommand,
} from "@/lib/editor/commands";
import {
  editorAssetSchema,
  editorItemSchema,
  editorTrackSchema,
  editorFormatSchema,
  type EditorDocument,
} from "@/lib/editor/document";
import {
  canonicalSerialize,
  normalizeVideoProjectJson,
  parseVideoProjectDocument,
  toEditorDocument,
  videoSourceIdentitySchema,
  videoSourceBindingSchema,
  videoTranscriptEvidenceSchema,
  videoCreativeContextSchema,
  type VideoProjectDocument,
} from "./document";
import { compileParsedVideoProjectDocument } from "./compilation";
import {
  projectSourceRange,
  reprojectVideoSourceBindings,
} from "./source-clock";

const id = z
  .string()
  .min(1)
  .max(191)
  .refine(
    (value) => !["__proto__", "prototype", "constructor"].includes(value),
    "Reserved identity.",
  );
const frame = z.number().int().min(0).max(2_592_000);
export const videoProjectTargetSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("node"), itemId: id, nodeId: id }).strict(),
  z.object({ kind: z.literal("item"), itemId: id }).strict(),
  z.object({ kind: z.literal("caption"), itemId: id }).strict(),
  z.object({ kind: z.literal("cue"), itemId: id, cueId: id }).strict(),
  z.object({ kind: z.literal("track"), trackId: id }).strict(),
  z.object({ kind: z.literal("format") }).strict(),
  z.object({ kind: z.literal("project") }).strict(),
]);
const path = z
  .array(
    z
      .string()
      .min(1)
      .max(191)
      .refine(
        (key) => !["__proto__", "prototype", "constructor"].includes(key),
        "Unsafe property path.",
      ),
  )
  .min(1)
  .max(8);
const rawVideoProjectCommandSchema = z.discriminatedUnion("type", [
  ...compositionCommandSchemas,
  z
    .object({
      type: z.literal("set"),
      target: videoProjectTargetSchema,
      path,
      value: jsonValueSchema,
    })
    .strict(),
  z
    .object({
      type: z.literal("clear"),
      target: videoProjectTargetSchema,
      path,
    })
    .strict(),
  z.object({ type: z.literal("addAsset"), asset: editorAssetSchema }).strict(),
  z
    .object({ type: z.literal("addSource"), source: videoSourceIdentitySchema })
    .strict(),
  z
    .object({
      type: z.literal("bindAsset"),
      id,
      assetId: id,
      sourceRevision: id,
    })
    .strict(),
  z.object({ type: z.literal("addTrack"), track: editorTrackSchema }).strict(),
  z.object({ type: z.literal("removeTrack"), id }).strict(),
  z
    .object({
      type: z.literal("reorderTracks"),
      ids: z.array(id).min(1).max(64),
    })
    .strict(),
  z
    .object({ type: z.literal("reorderItems"), ids: z.array(id).max(5000) })
    .strict(),
  z
    .object({
      type: z.literal("reorderNodes"),
      itemId: id,
      parentNodeId: id,
      ids: z.array(id).max(5000),
    })
    .strict(),
  z.object({ type: z.literal("addItem"), item: editorItemSchema }).strict(),
  z.object({ type: z.literal("removeItem"), id }).strict(),
  z.object({ type: z.literal("duplicateItem"), id, newId: id }).strict(),
  z.object({ type: z.literal("splitItem"), id, frame, newId: id }).strict(),
  z
    .object({
      type: z.literal("moveItem"),
      id,
      from: frame,
      trackId: id.optional(),
    })
    .strict(),
  z
    .object({
      type: z.literal("trimItem"),
      id,
      from: frame,
      duration: frame.min(1),
    })
    .strict(),
  z.object({ type: z.literal("removeGap"), trackId: id, frame }).strict(),
  z
    .object({
      type: z.literal("removeTimelineRange"),
      from: frame,
      duration: frame.min(1),
    })
    .strict(),
  z
    .object({
      type: z.literal("addNode"),
      itemId: id,
      parentNodeId: id,
      node: sceneNodeSchema,
      index: z.number().int().min(0).optional(),
    })
    .strict(),
  z.object({ type: z.literal("removeNode"), itemId: id, nodeId: id }).strict(),
  z
    .object({
      type: z.literal("addEvidence"),
      evidence: videoTranscriptEvidenceSchema,
    })
    .strict(),
  z
    .object({
      type: z.literal("bindSource"),
      binding: videoSourceBindingSchema,
    })
    .strict(),
  z.object({ type: z.literal("removeBinding"), id }).strict(),
  z
    .object({
      type: z.literal("updateCreativeContext"),
      context: videoCreativeContextSchema,
    })
    .strict(),
]);
export const videoProjectCommandSchema = z.preprocess(
  (value) => normalizeVideoProjectJson(value),
  rawVideoProjectCommandSchema,
);
export const videoProjectCommandsSchema = z
  .array(videoProjectCommandSchema)
  .min(1)
  .max(500);
export type VideoProjectCommand = z.infer<typeof videoProjectCommandSchema>;
export type VideoProjectTarget = z.infer<typeof videoProjectTargetSchema>;
export type VideoProjectFootprint = {
  reads: string[];
  writes: string[];
  dependencies: string[];
};
export type VideoProjectCommandResult = {
  document: VideoProjectDocument;
  footprint: VideoProjectFootprint;
  changedEntities: string[];
  changedItemIds: string[];
  impact: "direct" | "review";
};
const plain = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === "object" && !Array.isArray(value);
const equal = (a: unknown, b: unknown) =>
  canonicalSerialize(a) === canonicalSerialize(b);
const pointer = (parts: string[]) =>
  parts.map((part) => encodeURIComponent(part)).join("/");
const parts = (value: string) => value.split("/").map(decodeURIComponent);
function findNode(
  node: SceneNodeInput,
  nodeId: string,
): SceneNodeInput | undefined {
  if (node.id === nodeId) return node;
  for (const child of node.children ?? []) {
    const found = findNode(child, nodeId);
    if (found) return found;
  }
}
function targetPath(target: VideoProjectTarget): string[] {
  switch (target.kind) {
    case "format":
      return ["format"];
    case "project":
      return [];
    case "track":
      return ["tracks", target.trackId];
    case "item":
      return ["items", target.itemId];
    case "node":
      return ["items", target.itemId, "nodes", target.nodeId];
    case "caption":
      return ["items", target.itemId, "caption"];
    case "cue":
      return ["items", target.itemId, "caption", "cues", target.cueId];
  }
}
/** Logical ID paths survive array reordering and nested group edits. */
export function readVideoProjectPath(
  document: VideoProjectDocument,
  encoded: string,
): unknown {
  if (!encoded) return document;
  const decoded = parts(encoded);
  if (decoded[0] === "transitionEdges")
    return Object.values(document.transitions ?? {})
      .filter(
        (value) =>
          value.fromItemId === decoded[1] || value.toItemId === decoded[1],
      )
      .map((value) => value.id)
      .sort();
  if (decoded[0] === "groupMembership")
    return Object.values(document.linkedGroups ?? {})
      .filter((value) => value.itemIds.includes(decoded[1]!))
      .map((value) => value.id)
      .sort();
  if (decoded[0] === "trackItems")
    return document.items
      .filter((item) => item.trackId === decoded[1])
      .map((item) => item.id)
      .sort();
  if (decoded[0] === "dependents")
    return {
      items: document.items
        .filter(
          (item) =>
            item.caption?.sourceItemId === decoded[1] ||
            item.visualizerSourceItemId === decoded[1],
        )
        .map((item) => item.id)
        .sort(),
      bindings: Object.values(document.bindings)
        .filter(
          (binding) =>
            binding.sourceItemId === decoded[1] ||
            binding.itemId === decoded[1],
        )
        .map((binding) => binding.id)
        .sort(),
    };
  if (decoded[0] === "itemsOrder") return document.items.map((item) => item.id);
  if (decoded[0] === "tracksOrder")
    return document.tracks.map((track) => track.id);
  let value: unknown = document;
  for (const key of decoded) {
    if (Array.isArray(value))
      value = value.find((entry) => plain(entry) && entry.id === key);
    else if (key === "nodes" && plain(value) && plain(value.node))
      value = { nodeTree: value.node };
    else if (plain(value) && plain(value.nodeTree))
      value = findNode(value.nodeTree as SceneNodeInput, key);
    else value = plain(value) ? value[key] : undefined;
  }
  return value;
}
function targetValue(
  document: VideoProjectDocument,
  target: VideoProjectTarget,
) {
  const value = readVideoProjectPath(document, pointer(targetPath(target)));
  if (!plain(value))
    throw new Error(
      "The target no longer exists or is a derived caption node.",
    );
  return value;
}
export const VIDEO_PROJECT_EDITABLE_FIELDS: Readonly<
  Record<VideoProjectTarget["kind"], readonly string[]>
> = {
  node: [
    "text",
    "runs",
    "style",
    "animations",
    "params",
    "assetId",
    "from",
    "duration",
    "volume",
    "volumeEnvelope",
    "playbackRate",
    "videoStartTime",
    "audioStartTime",
    "loop",
    "muted",
    "fit",
    "audioBus",
    "ducks",
    "mask",
    "shape",
    "extension",
    "effect",
    "clip",
    "pan",
    "videoEndBehavior",
  ],
  item: ["name", "trackId", "visualizerSourceItemId", "motionGraphic"],
  caption: [
    "mode",
    "highlightColor",
    "highlightStyle",
    "motion",
    "direction",
    "language",
    "role",
    "sourceItemId",
    "pairedItemId",
    "cues",
  ],
  cue: ["text", "startMs", "endMs", "words"],
  track: ["name", "kind", "muted", "hidden", "locked"],
  format: ["width", "height", "fps", "durationInFrames", "backgroundColor"],
  project: ["audioBuses", "markers"],
};
Object.values(VIDEO_PROJECT_EDITABLE_FIELDS).forEach(Object.freeze);
Object.freeze(VIDEO_PROJECT_EDITABLE_FIELDS);
function assertEditablePath(target: VideoProjectTarget, field: string[]) {
  const first = field[0]!;
  if (!VIDEO_PROJECT_EDITABLE_FIELDS[target.kind].includes(first))
    throw new Error(
      `Field ${target.kind}.${first} is not editable by a property command.`,
    );
  if (
    (target.kind === "caption" && first === "cues") ||
    (target.kind === "cue" && first === "words")
  ) {
    if (field.length > 1)
      throw new Error("Use cue IDs or replace the explicit word array.");
  }
}
function mutatePath(
  value: Record<string, unknown>,
  field: string[],
  command: Extract<VideoProjectCommand, { type: "set" | "clear" }>,
) {
  let owner = value;
  for (const key of field.slice(0, -1)) {
    if (!plain(owner[key])) {
      if (command.type === "clear" && owner[key] === undefined) return;
      if (owner[key] !== undefined)
        throw new Error("A property path cannot traverse an array or scalar.");
      owner[key] = {};
    }
    owner = owner[key] as Record<string, unknown>;
  }
  if (command.type === "set")
    owner[field[field.length - 1]!] = structuredClone(command.value);
  else delete owner[field[field.length - 1]!];
}
function nativeDocument(document: VideoProjectDocument) {
  const {
    transitions: _transitions,
    linkedGroups: _groups,
    ...native
  } = document;
  return toEditorDocument(native);
}
function nativeApply(
  document: VideoProjectDocument,
  command: EditorCommand,
): void {
  const result = applyEditorCommand(nativeDocument(document), command);
  Object.assign(document, result, { kind: "video-project" });
}
function changeLeaves(
  before: unknown,
  after: unknown,
  path: string[],
  output: Set<string>,
) {
  if (equal(before, after)) return;
  if (plain(before) && plain(after)) {
    for (const key of new Set([...Object.keys(before), ...Object.keys(after)]))
      changeLeaves(before[key], after[key], [...path, key], output);
  } else output.add(pointer(path));
}
function documentChanges(
  before: VideoProjectDocument,
  after: VideoProjectDocument,
) {
  const writes = new Set<string>();
  for (const category of ["items", "tracks"] as const) {
    const oldEntries = new Map(
      before[category].map((entry) => [entry.id, entry]),
    );
    const newEntries = new Map(
      after[category].map((entry) => [entry.id, entry]),
    );
    for (const key of new Set([...oldEntries.keys(), ...newEntries.keys()]))
      changeLeaves(
        oldEntries.get(key),
        newEntries.get(key),
        [category, key],
        writes,
      );
    if (
      !equal(
        before[category].map((entry) => entry.id),
        after[category].map((entry) => entry.id),
      )
    )
      writes.add(pointer([`${category}Order`]));
  }
  for (const category of ["transitions", "linkedGroups"] as const) {
    const previous = before[category] ?? {},
      next = after[category] ?? {};
    for (const key of new Set([...Object.keys(previous), ...Object.keys(next)]))
      changeLeaves(previous[key], next[key], [category, key], writes);
  }
  for (const category of [
    "format",
    "assets",
    "sources",
    "evidence",
    "bindings",
    "creativeContext",
    "audioBuses",
    "markers",
    "metadata",
  ] as const)
    changeLeaves(before[category], after[category], [category], writes);
  return writes;
}
function sourceClock(document: VideoProjectDocument, itemId: string) {
  const item = document.items.find((item) => item.id === itemId);
  if (!item) return null;
  return {
    type: item.node.type,
    assetId: item.node.assetId,
    from: item.node.from ?? 0,
    duration: item.node.duration,
    fps: document.format.fps,
    start:
      item.node.type === "video"
        ? (item.node.videoStartTime ?? 0)
        : (item.node.audioStartTime ?? 0),
    rate: item.node.type === "video" ? (item.node.playbackRate ?? 1) : 1,
  };
}
function assertSourceEditingIntent(
  document: VideoProjectDocument,
  command: VideoProjectCommand,
) {
  const rootTarget =
    (command.type === "set" || command.type === "clear") &&
    command.target.kind === "node" &&
    command.target.nodeId === command.target.itemId
      ? command.target.itemId
      : undefined;
  const timingItemId =
    rootTarget ??
    (["moveItem", "trimItem", "splitItem", "duplicateItem"].includes(
      command.type,
    ) && "id" in command
      ? command.id
      : undefined);
  if (
    timingItemId &&
    Object.values(document.bindings).some(
      (binding) => binding.itemId === timingItemId,
    )
  ) {
    const item = document.items.find((item) => item.id === timingItemId)!;
    const changed =
      command.type === "splitItem" ||
      command.type === "duplicateItem" ||
      (command.type === "moveItem" && command.from !== (item.node.from ?? 0)) ||
      (command.type === "trimItem" &&
        (command.from !== (item.node.from ?? 0) ||
          command.duration !== item.node.duration)) ||
      ((command.type === "set" || command.type === "clear") &&
        ["from", "duration"].includes(command.path[0]!) &&
        !equal(
          command.type === "set"
            ? command.value
            : command.path[0] === "from"
              ? 0
              : undefined,
          command.path[0] === "from"
            ? (item.node.from ?? 0)
            : item.node.duration,
        ));
    if (changed)
      throw new Error(
        "Unlink the speech/source anchor before changing this graphic's timing, splitting it or duplicating it. Edit its source clip to keep it linked.",
      );
  }
  if (
    rootTarget &&
    (command.type === "set" || command.type === "clear") &&
    command.path[0] === "assetId"
  ) {
    const item = document.items.find((item) => item.id === rootTarget);
    if (
      item &&
      !equal(
        item.node.assetId,
        command.type === "set" ? command.value : undefined,
      )
    ) {
      if (
        document.items.some(
          (candidate) => candidate.caption?.sourceItemId === item.id,
        )
      )
        throw new Error(
          "Unlink or regenerate the source captions before replacing their spoken media.",
        );
      if (
        Object.values(document.bindings).some(
          (binding) => binding.sourceItemId === item.id,
        )
      )
        throw new Error(
          "Unlink the speech anchors before replacing their source media.",
        );
    }
  }
}
function insertedNodeCount(node: SceneNodeInput): number {
  return (
    1 +
    (node.children ?? []).reduce(
      (total, child) => total + insertedNodeCount(child),
      0,
    )
  );
}
function requiresCommandReview(command: VideoProjectCommand, fps: number) {
  if (command.type === "addItem")
    return (
      insertedNodeCount(command.item.node) > 32 ||
      command.item.node.duration! > fps * 30
    );
  if (command.type === "addNode")
    return (
      insertedNodeCount(command.node) > 32 ||
      (command.node.duration ?? 0) > fps * 30
    );
  if (command.type !== "set" && command.type !== "clear") return false;
  if (command.target.kind === "format")
    return command.path[0] !== "backgroundColor";
  if (command.target.kind === "node")
    return (
      command.path[0] === "assetId" ||
      ["videoStartTime", "audioStartTime", "playbackRate"].includes(
        command.path[0]!,
      ) ||
      (command.target.nodeId === command.target.itemId &&
        command.path[0] === "duration") ||
      (command.path[0] === "params" &&
        ["audioAssetId", "coverAssetId"].includes(command.path[1]!))
    );
  return false;
}
function assertLockedDependencies(
  before: VideoProjectDocument,
  after: VideoProjectDocument,
) {
  for (const track of before.tracks.filter((track) => track.locked)) {
    const oldItems = before.items.filter((item) => item.trackId === track.id);
    const nextItems = after.items.filter((item) => item.trackId === track.id);
    const lockedIds = new Set(
      [...oldItems, ...nextItems].map((item) => item.id),
    );
    const oldBindings = Object.values(before.bindings).filter((binding) =>
      lockedIds.has(binding.itemId),
    );
    const sourceIds = new Set([
      ...oldItems.flatMap((item) =>
        [item.caption?.sourceItemId, item.visualizerSourceItemId].filter(
          (id): id is string => Boolean(id),
        ),
      ),
      ...oldBindings.map((binding) => binding.sourceItemId),
    ]);
    if (
      [...sourceIds].some(
        (id) => !equal(sourceClock(before, id), sourceClock(after, id)),
      )
    )
      throw new Error(
        `Unlock dependent track ${track.name} before changing its source clock.`,
      );
    const nextBindings = Object.values(after.bindings).filter((binding) =>
      lockedIds.has(binding.itemId),
    );
    if (!equal(oldItems, nextItems) || !equal(oldBindings, nextBindings))
      throw new Error(
        `Unlock dependent track ${track.name} before editing its source.`,
      );
  }
}
function collectDependencies(
  document: VideoProjectDocument,
  itemId: string,
  result: Set<string>,
  recursive = false,
) {
  const item = document.items.find((item) => item.id === itemId);
  result.add(pointer(["items", itemId, "id"]));
  if (!item) return;
  result.add(pointer(["transitionEdges", itemId]));
  result.add(pointer(["groupMembership", itemId]));
  for (const transition of Object.values(document.transitions ?? {}))
    if (transition.fromItemId === itemId || transition.toItemId === itemId)
      result.add(pointer(["transitions", transition.id]));
  for (const group of Object.values(document.linkedGroups ?? {}))
    if (group.itemIds.includes(itemId))
      result.add(pointer(["linkedGroups", group.id]));
  result.add(pointer(["items", itemId, "trackId"]));
  result.add(pointer(["tracks", item.trackId, "locked"]));
  if (recursive) {
    if (result.has(pointer(["dependents", itemId]))) return;
    result.add(pointer(["items", itemId]));
    result.add(pointer(["dependents", itemId]));
    if (item.node.assetId) result.add(pointer(["sources", item.node.assetId]));
    for (const linked of document.items.filter(
      (candidate) =>
        candidate.caption?.sourceItemId === itemId ||
        candidate.visualizerSourceItemId === itemId,
    ))
      collectDependencies(document, linked.id, result);
    for (const binding of Object.values(document.bindings).filter(
      (binding) => binding.sourceItemId === itemId || binding.itemId === itemId,
    )) {
      result.add(pointer(["bindings", binding.id]));
      collectDependencies(document, binding.itemId, result, true);
    }
  }
}
function addBoundSplit(
  document: VideoProjectDocument,
  previous: VideoProjectDocument,
  command: Extract<
    VideoProjectCommand,
    { type: "splitItem" | "duplicateItem" }
  >,
) {
  const newSource = document.items.find((item) => item.id === command.newId);
  if (!newSource) return;
  for (const old of Object.values(previous.bindings).filter(
    (binding) => binding.sourceItemId === command.id,
  )) {
    const target = document.items.find((item) => item.id === old.itemId);
    if (!target) continue;
    const left = document.items.find((item) => item.id === command.id)!;
    const leftProjection = projectSourceRange(
      left,
      document.format.fps,
      old.sourceStartMs,
      old.sourceEndMs,
    );
    const rightProjection = projectSourceRange(
      newSource,
      document.format.fps,
      old.sourceStartMs,
      old.sourceEndMs,
    );
    if (!rightProjection) continue;
    if (!leftProjection && command.type === "splitItem") {
      document.bindings[old.id]!.sourceItemId = command.newId;
      continue;
    }
    let suffix = 1,
      newId = `${command.newId.slice(0, 70)}:bound:${old.itemId.slice(0, 80)}`;
    while (document.items.some((item) => item.id === newId))
      newId = `${command.newId.slice(0, 65)}:bound:${old.itemId.slice(0, 75)}:${suffix++}`;
    const copy =
      command.type === "splitItem"
        ? offsetEditorItem(
            target,
            rightProjection.from - (target.node.from ?? 0),
            document.format.fps,
          )
        : structuredClone(target);
    const reId = (node: SceneNodeInput, index: string): SceneNodeInput => ({
      ...node,
      id: index === "" ? newId : `${newId.slice(0, 140)}:node:${index}`,
      children: node.children?.map((child, i) => reId(child, `${index}_${i}`)),
    });
    copy.id = newId;
    copy.node = reId(copy.node, "");
    document.items.push(copy);
    let bindingId = `${newId}:anchor`.slice(0, 191),
      n = 1;
    while (document.bindings[bindingId])
      bindingId = `${newId.slice(0, 175)}:anchor${n++}`;
    document.bindings[bindingId] = {
      ...old,
      id: bindingId,
      itemId: newId,
      sourceItemId: command.newId,
    };
  }
}

function removeTimelineRange(
  input: VideoProjectDocument,
  from: number,
  duration: number,
): VideoProjectDocument {
  const end = from + duration,
    originalDuration = input.format.durationInFrames;
  if (end > originalDuration)
    throw new Error("The removed range must be inside the project.");
  let document = structuredClone(input);
  const primary = (item: VideoProjectDocument["items"][number]) =>
    !item.caption?.sourceItemId &&
    !item.visualizerSourceItemId &&
    !Object.values(document.bindings).some(
      (binding) => binding.itemId === item.id,
    );
  const apply = (command: VideoProjectCommand) => {
    document = executeVideoProjectCommands(document, [command]).document;
  };
  for (const boundary of [from, end]) {
    const crossing = document.items.filter(
      (item) =>
        primary(item) &&
        (item.node.from ?? 0) < boundary &&
        (item.node.from ?? 0) + item.node.duration! > boundary,
    );
    for (const item of crossing) {
      let newId = `${item.id.slice(0, 140)}:cut:${boundary}`,
        suffix = 1;
      while (document.items.some((candidate) => candidate.id === newId))
        newId = `${item.id.slice(0, 130)}:cut:${boundary}:${suffix++}`;
      apply({ type: "splitItem", id: item.id, frame: boundary, newId });
    }
  }
  // Remove independent layers before their sources so source deletion cannot
  // leave a stale child ID in this deterministic work list.
  const inside = document.items
    .filter(
      (item) =>
        primary(item) &&
        (item.node.from ?? 0) >= from &&
        (item.node.from ?? 0) + item.node.duration! <= end,
    )
    .sort(
      (a, b) =>
        Number(["video", "audio"].includes(a.node.type)) -
        Number(["video", "audio"].includes(b.node.type)),
    );
  for (const item of inside)
    if (document.items.some((current) => current.id === item.id))
      apply({ type: "removeItem", id: item.id });
  const after = document.items.filter(
    (item) => primary(item) && (item.node.from ?? 0) >= end,
  );
  // Shift the surviving primary clips inside one outer transaction: a transition
  // pair must not be rejected halfway through its common ripple displacement.
  for (const item of after)
    if (document.items.some((current) => current.id === item.id))
      nativeApply(document, {
        type: "moveItem",
        id: item.id,
        from: (item.node.from ?? 0) - duration,
      });
  reprojectVideoSourceBindings(document);
  reconcileComposition(document);
  const targetDuration = Math.max(1, originalDuration - duration);
  // Unresolved anchors remain reusable but have no visible timeline output.
  // Keep their placeholder geometry bounded when the overall movie shrinks.
  for (const binding of Object.values(document.bindings).filter(
    (binding) => binding.status === "unresolved",
  )) {
    const item = document.items.find((item) => item.id === binding.itemId);
    if (!item) continue;
    item.node.from = Math.min(item.node.from ?? 0, targetDuration - 1);
    item.node.duration = Math.min(
      item.node.duration!,
      targetDuration - item.node.from,
    );
  }
  if (document.markers)
    document.markers = Object.fromEntries(
      Object.entries(document.markers).flatMap(([name, frame]) =>
        frame >= from && frame < end
          ? []
          : [[name, frame >= end ? frame - duration : frame]],
      ),
    );
  document.format.durationInFrames = targetDuration;
  return document;
}

const formatContainerSchema = z.object({ format: editorFormatSchema });

/** An independent move changes only placement and duration. All complex/source-linked edits retain native replay. */
function independentMoves(
  document: VideoProjectDocument,
  commands: readonly VideoProjectCommand[],
) {
  if (
    Object.keys(document.bindings).length ||
    commands.some((command) => command.type !== "moveItem")
  )
    return null;
  const items = new Map(
    document.items.map((item, index) => [item.id, { item, index }]),
  );
  const sourceIds = new Set(
    document.items.flatMap((item) =>
      [item.caption?.sourceItemId, item.visualizerSourceItemId].filter(
        (id): id is string => Boolean(id),
      ),
    ),
  );
  if (
    commands.some((command) => {
      const item = items.get(
        (command as Extract<VideoProjectCommand, { type: "moveItem" }>).id,
      )?.item;
      return (
        !item ||
        item.caption ||
        item.visualizerSourceItemId ||
        sourceIds.has(item.id)
      );
    })
  )
    return null;
  const tracks = new Map(document.tracks.map((track) => [track.id, track]));
  const {
    sources: _sources,
    evidence: _evidence,
    bindings: _bindings,
    creativeContext: _context,
    ...native
  } = document;
  let bytes = JSON.stringify({ ...native, kind: "motionforge-editor" }).length;
  return (command: Extract<VideoProjectCommand, { type: "moveItem" }>) => {
    const previous = items.get(command.id)!;
    const item = document.items[previous.index]!;
    if (tracks.get(item.trackId)?.locked)
      throw new Error("Unlock the track before editing it.");
    const target = command.trackId ?? item.trackId;
    if (tracks.get(target)?.locked)
      throw new Error("Unlock the target track first.");
    if (!tracks.has(target)) throw new Error(`Track ${target} does not exist.`);
    const next = {
      ...item,
      trackId: target,
      node: { ...item.node, from: command.from },
    };
    const duration = Math.max(
      document.format.durationInFrames,
      command.from + item.node.duration!,
    );
    // Preserve the native reducer's per-step range and size rejection, even if
    // a later command would otherwise move the item back into bounds.
    formatContainerSchema.parse({
      format: { ...document.format, durationInFrames: duration },
    });
    bytes +=
      JSON.stringify(next).length -
      JSON.stringify(item).length +
      String(duration).length -
      String(document.format.durationInFrames).length;
    if (bytes > 4_000_000)
      throw new Error("The editing document exceeds 4 MB.");
    document.items[previous.index] = next;
    document.format.durationInFrames = duration;
  };
}

export function executeVideoProjectCommands(
  input: VideoProjectDocument,
  raw: readonly VideoProjectCommand[],
): VideoProjectCommandResult {
  const original = parseVideoProjectDocument(input);
  const commands = videoProjectCommandsSchema.parse(raw);
  let document = structuredClone(original);
  const reads = new Set<string>(),
    dependencies = new Set<string>();
  let impact: "direct" | "review" = commands.length > 20 ? "review" : "direct";
  const move = independentMoves(document, commands);
  for (const command of commands) {
    if (move && command.type === "moveItem") {
      collectDependencies(document, command.id, dependencies, true);
      move(command);
      continue;
    }
    const before = structuredClone(document);
    assertSourceEditingIntent(document, command);
    if (requiresCommandReview(command, document.format.fps)) impact = "review";
    if (command.type === "set" || command.type === "clear") {
      assertEditablePath(command.target, command.path);
      const target = targetValue(document, command.target);
      reads.add(pointer([...targetPath(command.target), ...command.path]));
      if ("itemId" in command.target) {
        collectDependencies(before, command.target.itemId, dependencies);
        if (command.target.kind === "node")
          dependencies.add(pointer([...targetPath(command.target), "type"]));
      }
      const timingRoot =
        command.target.kind === "node" &&
        command.target.nodeId === command.target.itemId &&
        [
          "from",
          "duration",
          "playbackRate",
          "videoStartTime",
          "audioStartTime",
          "assetId",
        ].includes(command.path[0]!);
      const oldNative = timingRoot ? nativeDocument(document) : undefined;
      mutatePath(target, command.path, command);
      if (command.target.kind === "format") {
        // Native fps changes rescale all node clocks together.
        const patch = {
          [command.path[0]!]:
            document.format[command.path[0]! as keyof typeof document.format],
        };
        document = before;
        nativeApply(document, { type: "updateFormat", patch });
      } else if (
        oldNative &&
        command.target.kind === "node" &&
        command.target.nodeId === command.target.itemId
      ) {
        const itemId = command.target.itemId;
        const item = document.items.find((item) => item.id === itemId)!;
        const root = structuredClone(item.node);
        // Retain explicit deletion semantics: native reducer merges node fields.
        const oldItem = oldNative.items.find(
          (candidate) => candidate.id === item.id,
        );
        if (oldItem)
          for (const key of Object.keys(oldItem.node))
            if (!(key in root))
              (root as unknown as Record<string, unknown>)[key] = undefined;
        const result = applyEditorCommand(oldNative, {
          type: "updateItem",
          id: item.id,
          patch: { node: root },
        });
        document.items = result.items;
        document.format = result.format;
        if (
          [
            "from",
            "duration",
            "playbackRate",
            "videoStartTime",
            "audioStartTime",
            "assetId",
          ].includes(command.path[0]!)
        )
          collectDependencies(before, item.id, dependencies, true);
      }
    } else if (isVideoCompositionCommand(command)) {
      const category =
        command.type === "setTransition" || command.type === "removeTransition"
          ? "transitions"
          : "linkedGroups";
      const id =
        command.type === "setTransition"
          ? command.transition.id
          : command.type === "setLinkedGroup"
            ? command.group.id
            : command.id;
      reads.add(pointer([category, id]));
      for (const itemId of compositionCommandItems(before, command))
        collectDependencies(before, itemId, dependencies, true);
      if (category === "transitions") {
        dependencies.add("format");
        dependencies.add("tracksOrder");
        const trackId = before.items.find(
          (item) => item.id === compositionCommandItems(before, command)[0],
        )?.trackId;
        if (trackId) dependencies.add(pointer(["trackItems", trackId]));
        before.items
          .filter((item) => item.trackId === trackId)
          .forEach((item) => {
            for (const field of ["from", "duration"] as const)
              dependencies.add(
                pointer(["items", item.id, "nodes", item.id, field]),
              );
          });
      }
      if (command.type === "duplicateLinkedGroup") {
        reads.add(pointer(["linkedGroups", command.newGroupId]));
        Object.values(command.itemIds).forEach((itemId) =>
          reads.add(pointer(["items", itemId])),
        );
      }
      applyCompositionCommand(document, command, nativeApply);
      impact = "review";
    } else
      switch (command.type) {
        case "bindAsset": {
          const asset = document.assets[command.id];
          const source = document.sources[command.id];
          reads.add(pointer(["assets", command.id]));
          dependencies.add(pointer(["sources", command.id]));
          if (
            !asset ||
            asset.source === "static" ||
            !source ||
            source.revision !== command.sourceRevision
          )
            throw new Error(
              "Cloud media binding requires the original registered source revision.",
            );
          if (asset.assetId && asset.assetId !== command.assetId)
            throw new Error(
              "A source cannot be rebound to different cloud media.",
            );
          document.assets[command.id] = {
            ...asset,
            source: "project",
            assetId: command.assetId,
          };
          break;
        }
        case "addSource": {
          const prior = document.sources[command.source.assetId];
          reads.add(pointer(["sources", command.source.assetId]));
          if (prior && !equal(prior, command.source))
            throw new Error("A source identity is immutable.");
          document.sources[command.source.assetId] = structuredClone(
            command.source,
          );
          break;
        }
        case "addEvidence": {
          reads.add(pointer(["evidence", command.evidence.id]));
          dependencies.add(
            pointer(["sources", command.evidence.sourceAssetId]),
          );
          if (
            document.evidence[command.evidence.id] &&
            !equal(document.evidence[command.evidence.id], command.evidence)
          )
            throw new Error(
              "Transcript evidence is immutable; caption corrections cannot rewrite spoken words.",
            );
          document.evidence[command.evidence.id] = structuredClone(
            command.evidence,
          );
          break;
        }
        case "bindSource":
          reads.add(pointer(["bindings", command.binding.id]));
          dependencies.add(pointer(["sources", command.binding.sourceAssetId]));
          if (command.binding.evidenceId)
            dependencies.add(pointer(["evidence", command.binding.evidenceId]));
          collectDependencies(
            before,
            command.binding.sourceItemId,
            dependencies,
            true,
          );
          collectDependencies(
            before,
            command.binding.itemId,
            dependencies,
            true,
          );
          document.bindings[command.binding.id] = structuredClone(
            command.binding,
          );
          break;
        case "removeBinding":
          reads.add(pointer(["bindings", command.id]));
          delete document.bindings[command.id];
          break;
        case "updateCreativeContext":
          reads.add("creativeContext");
          document.creativeContext = structuredClone(command.context);
          break;
        case "removeTimelineRange": {
          reads.add("items");
          reads.add("tracks");
          reads.add("bindings");
          dependencies.add("format");
          document = removeTimelineRange(
            document,
            command.from,
            command.duration,
          );
          impact = "review";
          break;
        }
        case "removeTrack": {
          reads.add(pointer(["tracks", command.id]));
          dependencies.add(pointer(["trackItems", command.id]));
          if (
            document.tracks.length < 2 ||
            document.items.some((item) => item.trackId === command.id)
          )
            throw new Error(
              "Only an empty track may be removed; retain at least one track.",
            );
          const track = document.tracks.find(
            (track) => track.id === command.id,
          );
          if (!track || track.locked)
            throw new Error("Select an existing unlocked track.");
          document.tracks = document.tracks.filter(
            (track) => track.id !== command.id,
          );
          impact = "review";
          break;
        }
        case "reorderItems":
        case "reorderTracks": {
          const key = command.type === "reorderItems" ? "items" : "tracks";
          reads.add(`${key}Order`);
          const entries = document[key];
          if (
            command.ids.length !== entries.length ||
            new Set(command.ids).size !== entries.length ||
            command.ids.some((id) => !entries.some((entry) => entry.id === id))
          )
            throw new Error(
              "Reordering must include every existing ID exactly once.",
            );
          if (key === "items")
            document.items = command.ids.map(
              (id) => document.items.find((item) => item.id === id)!,
            );
          else {
            if (
              document.tracks.some(
                (track, index) =>
                  track.locked && command.ids[index] !== track.id,
              )
            )
              throw new Error(
                "Unlock tracks before changing their layer order.",
              );
            document.tracks = command.ids.map(
              (id) => document.tracks.find((track) => track.id === id)!,
            );
          }
          impact = "review";
          break;
        }
        case "reorderNodes": {
          collectDependencies(before, command.itemId, dependencies);
          const item = document.items.find(
            (item) => item.id === command.itemId,
          );
          const parent = item && findNode(item.node, command.parentNodeId);
          if (!parent || item?.caption)
            throw new Error("Select an editable graphic group.");
          reads.add(
            pointer([
              "items",
              command.itemId,
              "nodes",
              command.parentNodeId,
              "children",
            ]),
          );
          const children = parent.children ?? [];
          if (
            command.ids.length !== children.length ||
            new Set(command.ids).size !== children.length ||
            command.ids.some((id) => !children.some((child) => child.id === id))
          )
            throw new Error("Reordering must include each child exactly once.");
          parent.children = command.ids.map(
            (id) => children.find((child) => child.id === id)!,
          );
          impact = "review";
          break;
        }
        case "addNode": {
          collectDependencies(before, command.itemId, dependencies);
          const item = document.items.find(
            (item) => item.id === command.itemId,
          );
          const parent = item && findNode(item.node, command.parentNodeId);
          if (!parent || item?.caption)
            throw new Error(
              "Select an editable graphic group; caption children are derived.",
            );
          reads.add(
            pointer([
              "items",
              command.itemId,
              "nodes",
              command.parentNodeId,
              "children",
            ]),
          );
          parent.children ??= [];
          parent.children.splice(
            command.index ?? parent.children.length,
            0,
            structuredClone(command.node),
          );
          break;
        }
        case "removeNode": {
          collectDependencies(before, command.itemId, dependencies);
          const item = document.items.find(
            (item) => item.id === command.itemId,
          );
          if (
            !item ||
            item.id === command.nodeId ||
            !findNode(item.node, command.nodeId)
          )
            throw new Error(
              "Select an existing nested node; removeItem removes a root.",
            );
          reads.add(
            pointer(["items", command.itemId, "nodes", command.nodeId]),
          );
          const remove = (node: SceneNodeInput) => {
            node.children = node.children?.filter(
              (child) => child.id !== command.nodeId,
            );
            node.children?.forEach(remove);
          };
          remove(item.node);
          impact = "review";
          break;
        }
        default: {
          if ("id" in command)
            collectDependencies(before, command.id, dependencies, true);
          if (command.type === "addItem") {
            reads.add(pointer(["items", command.item.id]));
            dependencies.add(
              pointer(["tracks", command.item.trackId, "locked"]),
            );
            dependencies.add("format/fps");
          }
          if (command.type === "addAsset")
            reads.add(pointer(["assets", command.asset.id]));
          if (command.type === "addTrack")
            reads.add(pointer(["tracks", command.track.id]));
          if (command.type === "removeGap") {
            dependencies.add(pointer(["tracks", command.trackId]));
            dependencies.add(pointer(["trackItems", command.trackId]));
            before.items
              .filter((item) => item.trackId === command.trackId)
              .forEach((item) =>
                collectDependencies(before, item.id, dependencies, true),
              );
          }
          nativeApply(document, command);
          if (command.type === "splitItem" || command.type === "duplicateItem")
            addBoundSplit(document, before, command);
          if (command.type === "removeItem") {
            const removed = new Set([command.id]);
            for (const binding of Object.values(document.bindings))
              if (binding.sourceItemId === command.id)
                removed.add(binding.itemId);
            document.items = document.items.filter(
              (item) => !removed.has(item.id),
            );
            document.bindings = Object.fromEntries(
              Object.entries(document.bindings).filter(
                ([, binding]) =>
                  !removed.has(binding.sourceItemId) &&
                  !removed.has(binding.itemId),
              ),
            );
          }
          if (
            ["removeItem", "trimItem", "splitItem", "removeGap"].includes(
              command.type,
            )
          )
            impact = "review";
        }
      }
    reprojectVideoSourceBindings(document);
    if (before.format.fps !== document.format.fps && document.transitions) {
      const ratio = document.format.fps / before.format.fps;
      Object.values(document.transitions).forEach((transition) => {
        transition.durationFrames = Math.max(
          2,
          Math.round(transition.durationFrames * ratio),
        );
      });
    }
    reconcileComposition(document, command);
    document.format.durationInFrames = Math.max(
      document.format.durationInFrames,
      ...document.items.map(
        (item) => (item.node.from ?? 0) + item.node.duration!,
      ),
    );
    assertLockedDependencies(before, document);
  }
  document = parseVideoProjectDocument(document);
  // Parse/compile geometry and asset dependencies without fetching bytes. Runtime
  // availability is separately enforced by the preview/export source resolver.
  const placeholders = Object.fromEntries(
    Object.keys(document.assets).map((id) => [
      id,
      `https://media.invalid/${encodeURIComponent(id)}`,
    ]),
  );
  compileParsedVideoProjectDocument(document, placeholders, {
    sourceMap: false,
  });
  const writes = documentChanges(original, document);
  const changedItemIds = [
    ...new Set(
      [...writes]
        .filter((key) => parts(key)[0] === "items")
        .map((key) => parts(key)[1]!),
    ),
  ];
  const changedEntities = [...writes];
  if (changedItemIds.length > 5 || changedEntities.length > 50)
    impact = "review";
  return {
    document,
    footprint: {
      reads: [...reads],
      writes: [...writes],
      dependencies: [...dependencies],
    },
    changedEntities,
    changedItemIds,
    impact,
  };
}

function leafCommands(
  target: VideoProjectTarget,
  before: unknown,
  after: unknown,
  at: string[],
  output: VideoProjectCommand[],
) {
  if (equal(before, after)) return;
  if (
    plain(after) &&
    (plain(before) || before === undefined) &&
    Object.keys(after).length
  ) {
    const prior = plain(before) ? before : {};
    for (const key of new Set([...Object.keys(prior), ...Object.keys(after)]))
      leafCommands(target, prior[key], after[key], [...at, key], output);
  } else if (after === undefined)
    output.push({ type: "clear", target, path: at });
  else
    output.push({
      type: "set",
      target,
      path: at,
      value: after as z.infer<typeof jsonValueSchema>,
    });
}
/** Translate legacy UI intent against its base; never send a whole-node replacement. */
export function editorCommandsToVideoCommands(
  input: VideoProjectDocument,
  legacy: readonly EditorCommand[],
): VideoProjectCommand[] {
  let document = structuredClone(input);
  const output: VideoProjectCommand[] = [];
  for (const command of legacy) {
    const batch: VideoProjectCommand[] = [];
    if (command.type === "updateItem") {
      const item = document.items.find((item) => item.id === command.id);
      if (!item) throw new Error("The selected item no longer exists.");
      for (const [field, value] of Object.entries(command.patch)) {
        if (field === "node") {
          for (const [key, child] of Object.entries(command.patch.node ?? {})) {
            if (["id", "type"].includes(key)) {
              if (!equal(item.node[key as "id" | "type"], child))
                throw new Error(
                  "Node identity/type cannot be replaced by an update.",
                );
              continue;
            }
            if (key === "children") {
              const beforeNodes = item.node.children ?? [],
                afterNodes = command.patch.node?.children ?? [];
              const walk = (
                before: SceneNodeInput[],
                after: SceneNodeInput[],
                parentId: string,
              ) => {
                before
                  .filter((node) => !after.some((next) => next.id === node.id))
                  .forEach((node) =>
                    batch.push({
                      type: "removeNode",
                      itemId: item.id,
                      nodeId: node.id,
                    }),
                  );
                after.forEach((node, index) => {
                  const old = before.find((old) => old.id === node.id);
                  if (old && old.type !== node.type)
                    throw new Error(
                      "Node type cannot be changed by a property update.",
                    );
                  if (!old) {
                    batch.push({
                      type: "addNode",
                      itemId: item.id,
                      parentNodeId: parentId,
                      node,
                      index,
                    });
                    return;
                  }
                  for (const name of new Set([
                    ...Object.keys(old),
                    ...Object.keys(node),
                  ])) {
                    if (["id", "type", "children"].includes(name)) continue;
                    leafCommands(
                      { kind: "node", itemId: item.id, nodeId: node.id },
                      (old as unknown as Record<string, unknown>)[name],
                      (node as unknown as Record<string, unknown>)[name],
                      [name],
                      batch,
                    );
                  }
                  walk(old.children ?? [], node.children ?? [], node.id);
                });
              };
              walk(beforeNodes, afterNodes, item.id);
              if (
                !equal(
                  beforeNodes.map((node) => node.id),
                  afterNodes.map((node) => node.id),
                )
              )
                batch.push({
                  type: "reorderNodes",
                  itemId: item.id,
                  parentNodeId: item.id,
                  ids: afterNodes.map((node) => node.id),
                });
              continue;
            }
            leafCommands(
              { kind: "node", itemId: item.id, nodeId: item.id },
              (item.node as unknown as Record<string, unknown>)[key],
              child,
              [key],
              batch,
            );
          }
        } else if (field === "caption") {
          if (!item.caption || !value)
            throw new Error(
              "Create captions using addItem; update existing cue properties explicitly.",
            );
          const next = value as NonNullable<typeof item.caption>;
          for (const key of new Set([
            ...Object.keys(item.caption),
            ...Object.keys(next),
          ])) {
            if (
              key === "cues" &&
              equal(
                item.caption.cues.map((cue) => cue.id),
                next.cues.map((cue) => cue.id),
              )
            ) {
              next.cues.forEach((cue, index) => {
                for (const field of [
                  "text",
                  "startMs",
                  "endMs",
                  "words",
                ] as const)
                  leafCommands(
                    { kind: "cue", itemId: item.id, cueId: cue.id },
                    item.caption!.cues[index]![field],
                    cue[field],
                    [field],
                    batch,
                  );
              });
            } else
              leafCommands(
                { kind: "caption", itemId: item.id },
                (item.caption as unknown as Record<string, unknown>)[key],
                (next as unknown as Record<string, unknown>)[key],
                [key],
                batch,
              );
          }
        } else
          leafCommands(
            { kind: "item", itemId: item.id },
            (item as unknown as Record<string, unknown>)[field],
            value,
            [field],
            batch,
          );
      }
    } else if (command.type === "updateTrack") {
      const track = document.tracks.find((track) => track.id === command.id);
      if (!track) throw new Error("Track not found.");
      for (const [key, value] of Object.entries(command.patch))
        leafCommands(
          { kind: "track", trackId: command.id },
          (track as unknown as Record<string, unknown>)[key],
          value,
          [key],
          batch,
        );
    } else if (command.type === "updateFormat") {
      for (const [key, value] of Object.entries(command.patch))
        leafCommands(
          { kind: "format" },
          (document.format as unknown as Record<string, unknown>)[key],
          value,
          [key],
          batch,
        );
    } else if (
      command.type === "addAsset" &&
      document.assets[command.asset.id]?.source === "local" &&
      command.asset.source === "project" &&
      command.asset.assetId
    ) {
      const existing = document.assets[command.asset.id]!;
      if (
        !equal(
          { ...existing, source: "project", assetId: command.asset.assetId },
          command.asset,
        )
      )
        throw new Error(
          "Cloud publication cannot change the original media metadata.",
        );
      const source = document.sources[command.asset.id];
      if (!source)
        throw new Error("Register a source identity before cloud publication.");
      batch.push({
        type: "bindAsset",
        id: command.asset.id,
        assetId: command.asset.assetId,
        sourceRevision: source.revision,
      });
    } else batch.push(command);
    if (batch.length) {
      document = executeVideoProjectCommands(document, batch).document;
      output.push(...batch);
    }
  }
  return output;
}
export const convertEditorCommand = (
  document: VideoProjectDocument,
  command: EditorCommand,
) => editorCommandsToVideoCommands(document, [command]);
export function rebaseVideoProjectCommands(
  base: VideoProjectDocument,
  current: VideoProjectDocument,
  commands: readonly VideoProjectCommand[],
) {
  try {
    const result = executeVideoProjectCommands(base, commands);
    const conflicts = [
      ...new Set([...result.footprint.reads, ...result.footprint.dependencies]),
    ].filter(
      (key) =>
        !equal(
          readVideoProjectPath(base, key),
          readVideoProjectPath(current, key),
        ),
    );
    if (conflicts.length)
      return {
        ok: false as const,
        conflicts,
        reason:
          "The proposed edit depends on changed properties or source timing.",
      };
    return {
      ok: true as const,
      commands: [...commands],
      ...executeVideoProjectCommands(current, commands),
    };
  } catch (error) {
    return {
      ok: false as const,
      conflicts: [],
      reason:
        error instanceof Error
          ? error.message
          : "The proposed edit is no longer valid.",
    };
  }
}

export { buildVideoProjectRevertCommands } from "./revert";
