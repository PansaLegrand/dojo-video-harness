import type { SceneNodeInput } from "@dojo-video-engine/schema";
import { canonicalSerialize, type VideoProjectDocument } from "./document";
import type { VideoProjectCommandResult } from "./commands";
import {
  nativeAgentScopeSchema,
  type NativeAgentScope,
} from "./agent-authoring";
import { isVideoCompositionCommand } from "./composition-commands";
import { compositionCommandItems } from "./composition";

type Item = VideoProjectDocument["items"][number];
type Operation = Record<string, any>;
const equal = (left: unknown, right: unknown) =>
  canonicalSerialize(left) === canonicalSerialize(right);
const windowOf = (item: Item) => ({
  from: item.node.from ?? 0,
  until: (item.node.from ?? 0) + item.node.duration!,
});
function walk(node: SceneNodeInput): SceneNodeInput[] {
  return [node, ...(node.children ?? []).flatMap(walk)];
}
function nodeIn(
  item: Item | undefined,
  id: string,
): SceneNodeInput | undefined {
  return item && walk(item.node).find((node) => node.id === id);
}
const decode = (path: string) =>
  path.split("/").filter(Boolean).map(decodeURIComponent);

export class NativeAgentScopeError extends Error {
  readonly code = "NATIVE_AGENT_SCOPE_VIOLATION";
  constructor(
    message = "This edit changes content outside the requested scope. Keep the proposal inside that scope or ask to broaden it.",
  ) {
    super(message);
    this.name = "NativeAgentScopeError";
  }
}

export function validateNativeAgentScope(
  document: VideoProjectDocument,
  input: NativeAgentScope,
): NativeAgentScope {
  const scope = nativeAgentScopeSchema.parse(input);
  if (scope.kind === "selection") {
    if (
      scope.itemIds.some((id) => !document.items.some((item) => item.id === id))
    )
      throw new NativeAgentScopeError(
        "A scoped item no longer exists. Select the current items before retrying.",
      );
    if (
      scope.node &&
      (scope.itemIds.length !== 1 ||
        scope.itemIds[0] !== scope.node.itemId ||
        !nodeIn(
          document.items.find((item) => item.id === scope.node!.itemId),
          scope.node.nodeId,
        ))
    )
      throw new NativeAgentScopeError(
        "The scoped node does not belong to this selection.",
      );
  }
  if (
    scope.kind === "range" &&
    scope.fromFrame + scope.durationInFrames > document.format.durationInFrames
  )
    throw new NativeAgentScopeError(
      "The requested time range extends beyond the current project.",
    );
  return scope;
}

/** A range owns complete clips inside it; intersecting clips require an explicit narrower edit. */
export function nativeScopeItemIds(
  document: VideoProjectDocument,
  scope: NativeAgentScope,
): string[] {
  if (scope.kind === "project") return document.items.map((item) => item.id);
  if (scope.kind === "selection") return [...scope.itemIds];
  return document.items
    .filter((item) => {
      const span = windowOf(item);
      return (
        span.from >= scope.fromFrame &&
        span.until <= scope.fromFrame + scope.durationInFrames
      );
    })
    .map((item) => item.id);
}

function linkedItems(
  document: VideoProjectDocument,
  roots: ReadonlySet<string>,
): Set<string> {
  const result = new Set(roots);
  for (;;) {
    const before = result.size;
    for (const item of document.items)
      if (
        (item.caption?.sourceItemId && result.has(item.caption.sourceItemId)) ||
        (item.visualizerSourceItemId && result.has(item.visualizerSourceItemId))
      )
        result.add(item.id);
    for (const binding of Object.values(document.bindings))
      if (result.has(binding.sourceItemId)) result.add(binding.itemId);
    if (result.size === before) return result;
  }
}

function withoutPinnedNode(item: Item, nodeId: string): unknown {
  const visit = (node: SceneNodeInput): SceneNodeInput => ({
    ...node,
    children: (node.children ?? [])
      .filter((child) => child.id !== nodeId)
      .map(visit),
  });
  return { ...item, node: visit(item.node) };
}
function withoutLinkedTiming(item: Item): unknown {
  const {
    from: _from,
    duration: _duration,
    videoStartTime: _videoStart,
    audioStartTime: _audioStart,
    playbackRate: _rate,
    ...node
  } = item.node;
  const caption = item.caption
    ? (() => {
        const {
          cues: _cues,
          sourceItemId: _source,
          pairedItemId: _pair,
          ...rest
        } = item.caption!;
        return rest;
      })()
    : undefined;
  return { ...item, node, caption };
}

/** Checked model operations may cause native linked timing changes, never arbitrary dependent edits. */
export class NativeAgentScopeSession {
  readonly scope: NativeAgentScope | undefined;
  readonly propagatedItemIds = new Set<string>();
  private readonly owned: Set<string>;
  private readonly originalItems: Set<string>;
  private readonly pinned: { itemId: string; nodeId: string } | undefined;
  private readonly creationWindows: Array<{ from: number; until: number }>;
  constructor(
    private readonly original: VideoProjectDocument,
    scope?: NativeAgentScope,
  ) {
    this.scope = scope ? validateNativeAgentScope(original, scope) : undefined;
    this.owned = new Set(scope ? nativeScopeItemIds(original, scope) : []);
    this.originalItems = new Set(
      scope ? original.items.map((item) => item.id) : [],
    );
    this.pinned =
      this.scope?.kind === "selection" &&
      this.scope.node &&
      this.scope.node.itemId !== this.scope.node.nodeId
        ? this.scope.node
        : undefined;
    this.creationWindows =
      this.scope?.kind === "range"
        ? [
            {
              from: this.scope.fromFrame,
              until: this.scope.fromFrame + this.scope.durationInFrames,
            },
          ]
        : scope
          ? original.items
              .filter((item) => this.owned.has(item.id))
              .map(windowOf)
          : [];
  }
  private ownItem(id: string, nodeOnly = false) {
    if (!this.owned.has(id) || (!nodeOnly && this.pinned?.itemId === id))
      throw new NativeAgentScopeError();
  }
  private ownNode(
    document: VideoProjectDocument,
    itemId: string,
    nodeId: string,
  ) {
    this.ownItem(itemId, true);
    if (
      this.pinned &&
      !walk(
        nodeIn(
          document.items.find((item) => item.id === itemId),
          this.pinned.nodeId,
        ) ?? { id: "", type: "div" },
      ).some((node) => node.id === nodeId)
    )
      throw new NativeAgentScopeError();
  }
  private allowNew(item: Item, unrestrictedPlacement = false) {
    if (this.pinned)
      throw new NativeAgentScopeError(
        "Creating another timeline item needs an item or project scope, rather than one nested node.",
      );
    const span = windowOf(item);
    if (
      !unrestrictedPlacement &&
      !this.creationWindows.some(
        (window) => span.from >= window.from && span.until <= window.until,
      )
    )
      throw new NativeAgentScopeError(
        "The new item extends outside the requested time span. Shorten it or broaden the scope.",
      );
    this.owned.add(item.id);
  }
  check(
    candidate: unknown,
    before: VideoProjectDocument,
    execution: VideoProjectCommandResult,
  ): void {
    if (!this.scope || this.scope.kind === "project") return;
    const command = candidate as Operation,
      after = execution.document;
    const related = linkedItems(before, this.owned);
    let permitsDerivedRemoval = false;
    let permitsDerivedCreation = false;
    const direct = (id: string) => this.ownItem(id);
    const composition = isVideoCompositionCommand(command as { type: string });
    if (composition) {
      const ids = compositionCommandItems(
        before,
        command as Parameters<typeof compositionCommandItems>[1],
      );
      for (const id of ids) {
        if (
          command.type === "setTransition" ||
          command.type === "removeTransition" ||
          this.owned.has(id)
        )
          direct(id);
        else if (related.has(id) && !this.pinned)
          this.propagatedItemIds.add(id);
        else
          throw new NativeAgentScopeError(
            "Select every source member of this linked composition before editing it.",
          );
      }
      permitsDerivedCreation = command.type === "duplicateLinkedGroup";
    } else {
      switch (command.type) {
        case "applyCapability":
          this.ownNode(
            before,
            command.action.target.itemId,
            command.action.target.nodeId,
          );
          break;
        case "set":
        case "clear": {
          const target = command.target;
          if (target.kind === "node")
            this.ownNode(before, target.itemId, target.nodeId);
          else if (["item", "caption", "cue"].includes(target.kind))
            direct(target.itemId);
          else
            throw new NativeAgentScopeError(
              "Project format, track and global settings require project scope.",
            );
          break;
        }
        case "moveItem":
        case "trimItem":
        case "updateMotionGraphic":
          direct(command.id ?? command.itemId);
          break;
        case "removeItem":
          direct(command.id);
          permitsDerivedRemoval = true;
          break;
        case "duplicateItem":
        case "splitItem":
          direct(command.id);
          permitsDerivedCreation = true;
          break;
        case "addNode":
        case "reorderNodes":
          this.ownNode(before, command.itemId, command.parentNodeId);
          break;
        case "removeNode":
          this.ownNode(before, command.itemId, command.nodeId);
          break;
        case "captionSource":
          direct(command.sourceItemId);
          permitsDerivedCreation = true;
          break;
        case "anchorSpeech":
          direct(command.itemId);
          break;
        case "removeBinding": {
          const binding = before.bindings[command.id];
          if (!binding)
            throw new NativeAgentScopeError(
              "The source binding no longer exists.",
            );
          direct(binding.itemId);
          break;
        }
        case "addAsset": {
          if (
            before.assets[command.asset.id] &&
            !equal(
              before.assets[command.asset.id],
              after.assets[command.asset.id],
            )
          )
            throw new NativeAgentScopeError(
              "Changing a shared asset declaration requires project scope.",
            );
          break;
        }
        case "addTrack":
          break; // finish() verifies it belongs to scoped content.
        case "insertSvg":
        case "insertGraphic":
        case "addItem": {
          const id = command.itemId ?? command.item.id;
          const item = after.items.find((item) => item.id === id);
          if (!item || before.items.some((item) => item.id === id))
            throw new NativeAgentScopeError();
          this.allowNew(item);
          break;
        }
        case "cutSpeech":
        case "removeTimelineRange":
        case "removeGap":
          throw new NativeAgentScopeError(
            "Ripple timing edits affect the wider timeline. Ask to use project scope before proposing this cut.",
          );
        default:
          throw new NativeAgentScopeError(
            "This operation requires project scope or an explicitly supported selection operation.",
          );
      }
    }
    const newRoots = new Set<string>(
      command.type === "captionSource"
        ? [command.itemId]
        : command.type === "duplicateLinkedGroup"
          ? (Object.values(command.itemIds) as string[])
          : [command.newId],
    );
    const newFamily = permitsDerivedCreation
      ? linkedItems(after, newRoots)
      : new Set<string>();
    if (permitsDerivedCreation)
      for (const item of after.items)
        if (!before.items.some((old) => old.id === item.id)) {
          if (!newFamily.has(item.id)) throw new NativeAgentScopeError();
          this.allowNew(item, this.scope.kind === "selection");
        }
    for (const id of linkedItems(after, this.owned)) related.add(id);
    for (const changed of execution.changedItemIds) {
      const old = before.items.find((item) => item.id === changed),
        next = after.items.find((item) => item.id === changed);
      if (this.owned.has(changed)) {
        if (
          this.pinned &&
          old &&
          next &&
          !equal(
            withoutPinnedNode(old, this.pinned.nodeId),
            withoutPinnedNode(next, this.pinned.nodeId),
          )
        )
          throw new NativeAgentScopeError(
            "The proposal changes another part of the selected group.",
          );
        if (this.scope.kind === "range" && next) {
          const span = windowOf(next);
          if (
            span.from < this.scope.fromFrame ||
            span.until > this.scope.fromFrame + this.scope.durationInFrames
          )
            throw new NativeAgentScopeError(
              "The edited clip extends outside the requested range.",
            );
        }
      } else {
        if (
          !related.has(changed) ||
          !old ||
          (!next && !permitsDerivedRemoval) ||
          (next && !equal(withoutLinkedTiming(old), withoutLinkedTiming(next)))
        )
          throw new NativeAgentScopeError();
        this.propagatedItemIds.add(changed);
      }
    }
    for (const write of execution.footprint.writes) {
      const path = decode(write);
      if (path[0] === "items" || path[0] === "itemsOrder") continue;
      if (
        path[0] === "format" &&
        path[1] === "durationInFrames" &&
        after.format.durationInFrames >= before.format.durationInFrames
      )
        continue;
      if (path[0] === "assets" && path[1] && !before.assets[path[1]]) continue;
      if (
        path[0] === "tracks" &&
        path[1] &&
        !before.tracks.some((track) => track.id === path[1])
      )
        continue;
      if (
        path[0] === "tracksOrder" &&
        after.tracks
          .filter((track) => before.tracks.some((old) => old.id === track.id))
          .map((track) => track.id)
          .join("\0") === before.tracks.map((track) => track.id).join("\0")
      )
        continue;
      if (path[0] === "bindings" && path[1]) {
        const binding = after.bindings[path[1]] ?? before.bindings[path[1]];
        if (
          binding &&
          (this.owned.has(binding.itemId) ||
            (related.has(binding.itemId) &&
              this.owned.has(binding.sourceItemId)))
        )
          continue;
      }
      if (path[0] === "transitions" || path[0] === "linkedGroups") {
        const category = path[0],
          oldRecords = before[category] ?? {},
          newRecords = after[category] ?? {};
        const ids = path[1]
          ? [path[1]]
          : [
              ...new Set([
                ...Object.keys(oldRecords),
                ...Object.keys(newRecords),
              ]),
            ];
        const timing =
          [
            "moveItem",
            "trimItem",
            "splitItem",
            "removeItem",
            "updateMotionGraphic",
          ].includes(command.type) ||
          (["set", "clear"].includes(command.type) &&
            [
              "from",
              "duration",
              "videoStartTime",
              "audioStartTime",
              "playbackRate",
              "assetId",
            ].includes(command.path?.[0]));
        for (const id of ids) {
          const old = oldRecords[id] as any,
            next = newRecords[id] as any;
          if (equal(old, next)) continue;
          const members =
            category === "transitions"
              ? ([
                  ...new Set(
                    [
                      old?.fromItemId,
                      old?.toItemId,
                      next?.fromItemId,
                      next?.toItemId,
                    ].filter(Boolean),
                  ),
                ] as string[])
              : ([
                  ...new Set([
                    ...(old?.itemIds ?? []),
                    ...(next?.itemIds ?? []),
                  ]),
                ] as string[]);
          if (
            composition &&
            members.every(
              (member) =>
                this.owned.has(member) ||
                (category === "linkedGroups" && related.has(member)),
            )
          )
            continue;
          const surviving = old?.itemIds?.filter((member: string) =>
            after.items.some((item) => item.id === member),
          );
          const cleanup =
            category === "transitions"
              ? timing &&
                old &&
                !next &&
                members.some((member) => this.owned.has(member))
              : permitsDerivedRemoval &&
                old &&
                (!next || equal(next, { ...old, itemIds: surviving })) &&
                members.some((member) => this.owned.has(member));
          if (!cleanup) throw new NativeAgentScopeError();
          for (const member of members)
            if (!this.owned.has(member)) this.propagatedItemIds.add(member);
        }
        continue;
      }
      throw new NativeAgentScopeError();
    }
  }
  finish(document: VideoProjectDocument) {
    if (!this.scope || this.scope.kind === "project") return;
    for (const track of document.tracks)
      if (
        !this.original.tracks.some((original) => original.id === track.id) &&
        !document.items.some(
          (item) => item.trackId === track.id && this.owned.has(item.id),
        )
      )
        throw new NativeAgentScopeError(
          "A new track must contain content inside the requested scope.",
        );
    const surviving = new Set(document.items.map((item) => item.id));
    const before = this.original.items
      .filter((item) => !this.owned.has(item.id) && surviving.has(item.id))
      .map((item) => item.id);
    const after = document.items
      .filter(
        (item) => this.originalItems.has(item.id) && !this.owned.has(item.id),
      )
      .map((item) => item.id);
    if (!equal(before, after)) throw new NativeAgentScopeError();
  }
}
