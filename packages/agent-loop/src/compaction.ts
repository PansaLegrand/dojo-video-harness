import { canonicalJson, copyJson, utf8JsonBytes } from "./json.js";
import type { ChatMessage, LoopCompactionOptions } from "./types.js";

/** Drops only whole, explicitly disposable tool groups. Instructions are immutable. */
export function compactLoopMessages(input: {
  messages: ChatMessage[];
  initialMessages: ChatMessage[];
  compactableToolNames: string[];
  pinnedToolCallIds?: string[];
  durablePlanRefs?: string[];
  /** Derived storage headroom; does not replace the frozen character policy. */
  maxUtf8Bytes?: number;
  options: LoopCompactionOptions;
}): { messages: ChatMessage[]; droppedGroups: number; characters: number } {
  const messages = copyJson(input.messages);
  const initial = input.initialMessages;
  if (
    canonicalJson(messages.slice(0, initial.length)) !== canonicalJson(initial)
  )
    throw new Error("Compaction cannot rewrite the original instructions.");
  const { maxCharacters } = input.options;
  const keepRecent = input.options.keepRecentGroups ?? 2;
  if (
    input.maxUtf8Bytes !== undefined &&
    (!Number.isSafeInteger(input.maxUtf8Bytes) || input.maxUtf8Bytes < 1)
  )
    throw new Error("Invalid message compaction byte budget.");
  if (
    !Number.isInteger(maxCharacters) ||
    maxCharacters < 1 ||
    maxCharacters > 2_000_000 ||
    !Number.isInteger(keepRecent) ||
    keepRecent < 1 ||
    keepRecent > 32
  )
    throw new Error("Invalid message compaction budget.");
  const compactable = new Set(input.compactableToolNames);
  const pinned = new Set([
    ...(input.options.protectedToolCallIds ?? []),
    ...(input.pinnedToolCallIds ?? []),
  ]);
  const groups: Array<{
    messages: ChatMessage[];
    removable: boolean;
    complete: boolean;
  }> = [];
  for (let index = 0; index < messages.length; ) {
    const start = index;
    const message = messages[index++];
    if (message.role === "tool")
      throw new Error("Compaction found an orphaned tool observation.");
    const calls = message.tool_calls ?? [];
    const group = [message];
    if (calls.length) {
      if (message.role !== "assistant")
        throw new Error("Tool calls require an assistant message.");
      const expected = new Set(calls.map((call) => call.id));
      if (expected.size !== calls.length)
        throw new Error("Compaction found duplicate tool identities.");
      while (index < messages.length && messages[index].role === "tool") {
        const observation = messages[index++];
        if (
          !observation.tool_call_id ||
          !expected.delete(observation.tool_call_id)
        )
          throw new Error("Compaction found an orphaned tool observation.");
        group.push(observation);
      }
      if (expected.size && index !== messages.length)
        throw new Error("Compaction found an incomplete tool group.");
      const serialized = JSON.stringify(group);
      const protectedValue = (value: unknown): boolean => {
        if (!value || typeof value !== "object") return false;
        if (Array.isArray(value)) return value.some(protectedValue);
        const data = value as Record<string, unknown>;
        if (
          data.pinned === true ||
          data.ok === false ||
          data.valid === false ||
          data.success === false ||
          data.status === "error" ||
          data.status === "failed"
        )
          return true;
        return Object.entries(data).some(
          ([key, child]) =>
            ((key === "error" || key === "errors" || key === "issues") &&
              child !== null &&
              child !== false &&
              child !== "" &&
              (!Array.isArray(child) || child.length > 0)) ||
            protectedValue(child),
        );
      };
      const containsError = group.some((part) => {
        if (part.role !== "tool" || typeof part.content !== "string")
          return false;
        try {
          const value: unknown = JSON.parse(part.content);
          return protectedValue(value);
        } catch {
          return true; // Unknown observation formats remain evidence.
        }
      });
      groups.push({
        messages: group,
        complete: expected.size === 0,
        removable:
          start >= initial.length &&
          expected.size === 0 &&
          !containsError &&
          calls.every(
            (call) =>
              compactable.has(call.function.name) && !pinned.has(call.id),
          ) &&
          !(input.durablePlanRefs ?? []).some((ref) =>
            serialized.includes(ref),
          ),
      });
    } else groups.push({ messages: group, removable: false, complete: false });
  }
  // Keep the most recent complete assistant/tool groups, including protected ones.
  const toolGroups = groups.filter((group) => group.complete);
  for (const group of toolGroups.slice(-keepRecent)) group.removable = false;
  let result = groups.flatMap((group) => group.messages);
  let characters = JSON.stringify(result).length;
  const exceeds = () =>
    characters > maxCharacters ||
    (input.maxUtf8Bytes !== undefined &&
      utf8JsonBytes(result) > input.maxUtf8Bytes);
  let droppedGroups = 0;
  for (const group of groups) {
    if (!exceeds()) break;
    if (!group.removable) continue;
    group.messages = [];
    droppedGroups++;
    result = groups.flatMap((item) => item.messages);
    characters = JSON.stringify(result).length;
  }
  if (exceeds())
    throw new Error("Protected instructions/evidence exceed context budget.");
  return { messages: result, droppedGroups, characters };
}
