import { derivedCompositionId } from "@/lib/editor/composition-ids";
import type { SceneNodeInput } from "@motionforge/schema";
import type { EditorCommand } from "@/lib/editor/commands";
import type { EditorLinkedGroup } from "@/lib/editor/composition-schema";
import type { VideoProjectDocument } from "./document";
import type { VideoCompositionCommand } from "./composition-commands";

function parentMap(document: VideoProjectDocument) {
  const result = new Map<string, Set<string>>();
  const add = (child: string, parent: string | undefined) => {
    if (parent) {
      const parents = result.get(child) ?? new Set();
      parents.add(parent);
      result.set(child, parents);
    }
  };
  for (const item of document.items) {
    add(item.id, item.caption?.sourceItemId);
    add(item.id, item.visualizerSourceItemId);
  }
  for (const binding of Object.values(document.bindings))
    add(binding.itemId, binding.sourceItemId);
  return result;
}
/** Source children are linked effects, not independent timing edits. Stable order is canonical item order. */
export function linkedCompositionMembers(
  document: VideoProjectDocument,
  itemIds: readonly string[],
): string[] {
  const original = new Set(itemIds),
    included = new Set(itemIds),
    parents = parentMap(document);
  const children = new Map<string, string[]>();
  parents.forEach((values, child) =>
    values.forEach((parent) =>
      (() => {
        const values = children.get(parent) ?? [];
        values.push(child);
        children.set(parent, values);
      })(),
    ),
  );
  const queue = [...included];
  for (let at = 0; at < queue.length; at++)
    for (const child of children.get(queue[at]!) ?? [])
      if (!included.has(child)) {
        included.add(child);
        queue.push(child);
      }
  return [
    ...itemIds,
    ...document.items
      .filter((item) => included.has(item.id) && !original.has(item.id))
      .map((item) => item.id),
  ];
}
function assertSourceParents(
  document: VideoProjectDocument,
  members: readonly string[],
) {
  const included = new Set(members);
  for (const [child, parents] of parentMap(document))
    if (included.has(child))
      for (const parent of parents)
        if (!included.has(parent))
          throw new Error(
            "Include the source clip when linking its captions, visualizer or speech-bound graphics.",
          );
}
export function assertLinkedGroupBindings(document: VideoProjectDocument) {
  const membership = new Map<string, string>();
  Object.values(document.linkedGroups ?? {}).forEach((group) =>
    group.itemIds.forEach((id) => membership.set(id, group.id)),
  );
  for (const binding of Object.values(document.bindings)) {
    const parent = membership.get(binding.sourceItemId),
      child = membership.get(binding.itemId);
    if (parent !== child && (parent || child))
      throw new Error(
        "A linked group must include its speech-bound source and dependent clips.",
      );
  }
}
function unlocked(document: VideoProjectDocument, ids: readonly string[]) {
  const items = new Map(document.items.map((item) => [item.id, item])),
    tracks = new Map(document.tracks.map((track) => [track.id, track]));
  for (const id of ids) {
    const item = items.get(id);
    if (!item) throw new Error("A composition references a missing clip.");
    if (tracks.get(item.trackId)?.locked)
      throw new Error(
        "Unlock every affected track before editing this composition.",
      );
  }
}
function groupOf(
  document: VideoProjectDocument,
  id: string,
): EditorLinkedGroup {
  const group = document.linkedGroups?.[id];
  if (!group) throw new Error("The linked group no longer exists.");
  return group;
}
function occupiedIds(document: VideoProjectDocument) {
  const result = new Set<string>([
    ...Object.keys(document.linkedGroups ?? {}),
    ...Object.keys(document.transitions ?? {}),
    ...Object.keys(document.bindings),
  ]);
  const visit = (node: SceneNodeInput) => {
    result.add(node.id);
    node.children?.forEach(visit);
  };
  document.items.forEach((item) => visit(item.node));
  return result;
}
export function compositionCommandItems(
  document: VideoProjectDocument,
  command: VideoCompositionCommand,
): string[] {
  if (command.type === "setTransition")
    return [
      ...new Set([
        command.transition.fromItemId,
        command.transition.toItemId,
        ...Object.values(
          document.transitions?.[command.transition.id]
            ? { previous: document.transitions[command.transition.id] }
            : {},
        ).flatMap((value) => [value.fromItemId, value.toItemId]),
      ]),
    ];
  if (command.type === "removeTransition") {
    const transition = document.transitions?.[command.id];
    return transition ? [transition.fromItemId, transition.toItemId] : [];
  }
  if (command.type === "setLinkedGroup")
    return [
      ...new Set([
        ...linkedCompositionMembers(document, command.group.itemIds),
        ...(document.linkedGroups?.[command.group.id]?.itemIds ?? []),
      ]),
    ];
  return [...groupOf(document, command.id).itemIds];
}

/** Mutates only the transaction-owned working document; the outer kernel owns validation and footprints. */
export function applyCompositionCommand(
  document: VideoProjectDocument,
  command: VideoCompositionCommand,
  nativeApply: (document: VideoProjectDocument, command: EditorCommand) => void,
) {
  unlocked(document, compositionCommandItems(document, command));
  if (command.type === "setTransition") {
    document.transitions ??= {};
    document.transitions[command.transition.id] = structuredClone(
      command.transition,
    );
    return;
  }
  if (command.type === "removeTransition") {
    if (!document.transitions?.[command.id])
      throw new Error("The transition no longer exists.");
    delete document.transitions[command.id];
    return;
  }
  if (command.type === "setLinkedGroup") {
    const itemIds = linkedCompositionMembers(document, command.group.itemIds);
    assertSourceParents(document, itemIds);
    if (
      Object.values(document.linkedGroups ?? {}).some(
        (group) =>
          group.id !== command.group.id &&
          group.itemIds.some((id) => itemIds.includes(id)),
      )
    )
      throw new Error(
        "A clip already belongs to another linked group. Ungroup it first.",
      );
    document.linkedGroups ??= {};
    document.linkedGroups[command.group.id] = {
      ...structuredClone(command.group),
      itemIds,
    };
    return;
  }
  if (command.type === "removeLinkedGroup") {
    delete document.linkedGroups![command.id];
    return;
  }
  const group = groupOf(document, command.id),
    members = new Set(group.itemIds),
    items = document.items.filter((item) => members.has(item.id));
  const from = Math.min(...items.map((item) => item.node.from ?? 0)),
    delta = command.from - from;
  if (command.type === "moveLinkedGroup") {
    const parents = parentMap(document);
    for (const item of items)
      if (
        ![...(parents.get(item.id) ?? [])].some((parent) => members.has(parent))
      )
        nativeApply(document, {
          type: "moveItem",
          id: item.id,
          from: (item.node.from ?? 0) + delta,
        });
    return;
  }
  if (document.linkedGroups?.[command.newGroupId])
    throw new Error("The new linked group ID is already in use.");
  if (
    Object.keys(command.itemIds).length !== members.size ||
    [...members].some((id) => !command.itemIds[id])
  )
    throw new Error(
      "Duplicating a linked group requires one new ID for every member.",
    );
  const occupied = occupiedIds(document),
    copied = new Map(Object.entries(command.itemIds));
  occupied.add(command.newGroupId);
  for (const id of copied.values()) {
    if (occupied.has(id))
      throw new Error("A duplicated clip ID is already in use.");
    occupied.add(id);
  }
  const remapNode = (
    node: SceneNodeInput,
    rootId: string,
    isRoot: boolean,
  ): SceneNodeInput => ({
    ...node,
    id: isRoot ? rootId : derivedCompositionId(rootId, node.id, occupied),
    children: node.children?.map((child) => remapNode(child, rootId, false)),
  });
  const copies = items.map((item) => {
    const id = copied.get(item.id)!,
      copy = structuredClone(item);
    copy.id = id;
    copy.node = {
      ...remapNode(copy.node, id, true),
      from: (item.node.from ?? 0) + delta,
    };
    if (copy.caption?.sourceItemId)
      copy.caption.sourceItemId = copied.get(copy.caption.sourceItemId)!;
    if (copy.caption?.pairedItemId)
      copy.caption.pairedItemId =
        copied.get(copy.caption.pairedItemId) ?? copy.caption.pairedItemId;
    if (copy.visualizerSourceItemId)
      copy.visualizerSourceItemId = copied.get(copy.visualizerSourceItemId)!;
    return copy;
  });
  document.items.push(...copies);
  for (const binding of Object.values(document.bindings))
    if (copied.has(binding.itemId)) {
      const id = derivedCompositionId(command.newGroupId, binding.id, occupied);
      document.bindings[id] = {
        ...structuredClone(binding),
        id,
        itemId: copied.get(binding.itemId)!,
        sourceItemId: copied.get(binding.sourceItemId)!,
      };
    }
  for (const transition of Object.values(document.transitions ?? {}))
    if (copied.has(transition.fromItemId) && copied.has(transition.toItemId)) {
      const id = derivedCompositionId(
        command.newGroupId,
        transition.id,
        occupied,
      );
      document.transitions![id] = {
        ...transition,
        id,
        fromItemId: copied.get(transition.fromItemId)!,
        toItemId: copied.get(transition.toItemId)!,
      };
    }
  document.linkedGroups![command.newGroupId] = {
    ...group,
    id: command.newGroupId,
    itemIds: group.itemIds.map((id) => copied.get(id)!),
  };
}

/** Native deletes/splits retain composition identity only while their endpoints exist. */
export function reconcileComposition(
  document: VideoProjectDocument,
  command?: { type: string; id?: string; newId?: string },
) {
  const existing = new Set(document.items.map((item) => item.id));
  if (command?.type === "splitItem" && command.id && command.newId) {
    for (const transition of Object.values(document.transitions ?? {}))
      if (transition.fromItemId === command.id)
        transition.fromItemId = command.newId;
    for (const group of Object.values(document.linkedGroups ?? {}))
      if (group.itemIds.includes(command.id)) group.itemIds.push(command.newId);
  }
  for (const [id, transition] of Object.entries(document.transitions ?? {}))
    if (
      !existing.has(transition.fromItemId) ||
      !existing.has(transition.toItemId)
    )
      delete document.transitions![id];
  for (const [id, group] of Object.entries(document.linkedGroups ?? {})) {
    group.itemIds = linkedCompositionMembers(
      document,
      group.itemIds.filter((member) => existing.has(member)),
    );
    if (group.itemIds.length < 2) delete document.linkedGroups![id];
  }
  if (document.transitions && !Object.keys(document.transitions).length)
    delete document.transitions;
  if (document.linkedGroups && !Object.keys(document.linkedGroups).length)
    delete document.linkedGroups;
}
