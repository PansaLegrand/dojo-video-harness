import { canonicalJson, copyJson } from "./json.js";
import type {
  ChatMessage,
  LoopCheckpoint,
  LoopCompactionOptions,
  LoopSnapshot,
  ModelReply,
} from "./types.js";

export class LoopRecoveryRequiredError extends Error {
  constructor(
    public readonly reason:
      | "model-outcome-unknown"
      | "tool-outcome-unknown"
      | "answer-outcome-unknown",
    public readonly callId?: string,
  ) {
    super(`Durable loop requires host reconciliation: ${reason}.`);
    this.name = "LoopRecoveryRequiredError";
  }
}

function object(value: unknown, keys: string[]): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error("Invalid loop checkpoint object.");
  const result = value as Record<string, unknown>;
  if (Object.keys(result).some((key) => !keys.includes(key)))
    throw new Error("Unknown loop checkpoint field.");
  return result;
}
export function integer(value: unknown, min: number, max: number): number {
  if (
    !Number.isSafeInteger(value) ||
    Number(value) < min ||
    Number(value) > max
  )
    throw new Error("Invalid loop checkpoint budget/counter.");
  return Number(value);
}
function text(value: unknown, maximum: number): string {
  if (typeof value !== "string" || !value.length || value.length > maximum)
    throw new Error("Invalid loop checkpoint identity/text.");
  return value;
}
function strings(value: unknown, maximum: number, length = 1024): string[] {
  if (!Array.isArray(value) || value.length > maximum)
    throw new Error("Invalid loop checkpoint identity list.");
  const result = value.map((item) => text(item, length));
  if (new Set(result).size !== result.length)
    throw new Error("Duplicate loop checkpoint identities.");
  return result;
}
function usage(value: unknown) {
  const data = object(value, ["inputTokens", "outputTokens"]);
  integer(data.inputTokens, 0, Number.MAX_SAFE_INTEGER);
  integer(data.outputTokens, 0, Number.MAX_SAFE_INTEGER);
}
export function validateMessages(
  value: unknown,
): asserts value is ChatMessage[] {
  if (!Array.isArray(value) || value.length > 1024)
    throw new Error("Invalid loop conversation budget.");
  for (const item of value) {
    const data = object(item, [
      "role",
      "content",
      "tool_call_id",
      "tool_calls",
      "providerOutput",
    ]);
    if (!["system", "user", "assistant", "tool"].includes(String(data.role)))
      throw new Error("Invalid loop conversation role.");
    if (
      data.content !== null &&
      typeof data.content !== "string" &&
      !Array.isArray(data.content)
    )
      throw new Error("Invalid loop conversation content.");
    if (data.tool_call_id !== undefined) text(data.tool_call_id, 256);
    if (data.role === "tool" && !data.tool_call_id)
      throw new Error("Tool observations require an identity.");
    if (data.tool_calls !== undefined) {
      if (
        data.role !== "assistant" ||
        !Array.isArray(data.tool_calls) ||
        data.tool_calls.length > 64
      )
        throw new Error("Invalid assistant tool calls.");
      for (const raw of data.tool_calls) {
        const call = object(raw, ["id", "type", "function"]);
        text(call.id, 256);
        if (call.type !== "function")
          throw new Error("Invalid tool call type.");
        const fn = object(call.function, ["name", "arguments"]);
        text(fn.name, 128);
        if (typeof fn.arguments !== "string" || fn.arguments.length > 300000)
          throw new Error("Tool input exceeds context budget.");
      }
    }
    if (
      data.providerOutput !== undefined &&
      !Array.isArray(data.providerOutput)
    )
      throw new Error("Invalid provider output.");
  }
}
export function validateReply(value: unknown): asserts value is ModelReply {
  const data = object(value, ["text", "calls", "providerOutput", "usage"]);
  if (
    typeof data.text !== "string" ||
    data.text.length > 300000 ||
    !Array.isArray(data.calls) ||
    data.calls.length > 64
  )
    throw new Error("Model result exceeds context budget.");
  for (const item of data.calls) {
    const call = object(item, ["id", "name", "arguments"]);
    text(call.id, 256);
    text(call.name, 128);
    if (typeof call.arguments !== "string" || call.arguments.length > 300000)
      throw new Error("Tool input exceeds context budget.");
  }
  if (data.usage !== undefined) usage(data.usage);
  if (data.providerOutput !== undefined && !Array.isArray(data.providerOutput))
    throw new Error("Invalid provider output.");
}
export function validateCompaction(
  value: unknown,
): asserts value is LoopCompactionOptions {
  const data = object(value, [
    "maxCharacters",
    "keepRecentGroups",
    "protectedToolCallIds",
  ]);
  integer(data.maxCharacters, 1, 2_000_000);
  if (data.keepRecentGroups !== undefined)
    integer(data.keepRecentGroups, 1, 32);
  if (data.protectedToolCallIds !== undefined)
    strings(data.protectedToolCallIds, 128, 256);
}
export function validateSnapshot(
  value: unknown,
): asserts value is LoopSnapshot {
  const data = object(value, [
    "runId",
    "snapshotHash",
    "modelIdentity",
    "messages",
    "tools",
    "budgets",
    "answerReplaySafe",
    "durablePlanRefs",
    "compaction",
  ]);
  text(data.runId, 256);
  text(data.snapshotHash, 1024);
  if (data.modelIdentity !== undefined) text(data.modelIdentity, 2048);
  validateMessages(data.messages);
  const budgets = object(data.budgets, [
    "maxSteps",
    "maxToolCalls",
    "maxOutputTokens",
    "requireUsage",
  ]);
  integer(budgets.maxSteps, 1, 32);
  integer(budgets.maxToolCalls, 1, 64);
  integer(budgets.maxOutputTokens, 1, 128000);
  if (
    typeof budgets.requireUsage !== "boolean" ||
    typeof data.answerReplaySafe !== "boolean"
  )
    throw new Error("Invalid loop snapshot flags.");
  strings(data.durablePlanRefs, 64);
  if (data.compaction !== undefined) validateCompaction(data.compaction);
  if (!Array.isArray(data.tools) || data.tools.length > 128)
    throw new Error("Invalid loop tool inventory.");
  const names: string[] = [];
  for (const item of data.tools) {
    const tool = object(item, [
      "name",
      "description",
      "parameters",
      "replaySafe",
      "compactionSafe",
    ]);
    names.push(text(tool.name, 128));
    if (
      typeof tool.description !== "string" ||
      tool.description.length > 300000 ||
      typeof tool.replaySafe !== "boolean" ||
      typeof tool.compactionSafe !== "boolean" ||
      !tool.parameters ||
      typeof tool.parameters !== "object" ||
      Array.isArray(tool.parameters)
    )
      throw new Error("Invalid loop tool inventory.");
  }
  if (new Set(names).size !== names.length)
    throw new Error("Tool names must be unique.");
}

/** Structural parsing only. Execution also verifies the hash against current inputs. */
export function parseLoopCheckpoint(value: unknown): LoopCheckpoint {
  const json = copyJson(value);
  const data = object(json, [
    "version",
    "revision",
    "bindingHash",
    "snapshot",
    "phase",
    "messages",
    "usage",
    "usageKnown",
    "modelCalls",
    "toolCalls",
    "observationCharacters",
    "sequence",
    "usedToolCallIds",
    "pinnedToolCallIds",
    "pendingTurn",
    "result",
  ]);
  if (data.version !== 1)
    throw new Error("Unsupported loop checkpoint version.");
  integer(data.revision, 0, Number.MAX_SAFE_INTEGER);
  if (
    typeof data.bindingHash !== "string" ||
    !/^[a-f0-9]{64}$/.test(data.bindingHash)
  )
    throw new Error("Invalid loop checkpoint binding hash.");
  validateSnapshot(data.snapshot);
  validateMessages(data.messages);
  usage(data.usage);
  if (typeof data.usageKnown !== "boolean")
    throw new Error("Invalid provider usage state.");
  const checkpoint = json as LoopCheckpoint;
  const { snapshot } = checkpoint;
  integer(data.modelCalls, 0, snapshot.budgets.maxSteps);
  integer(data.toolCalls, 0, snapshot.budgets.maxToolCalls);
  integer(data.observationCharacters, 0, 240000);
  integer(data.sequence, 0, Number.MAX_SAFE_INTEGER);
  if (checkpoint.usage.outputTokens > snapshot.budgets.maxOutputTokens)
    throw new Error("Model output budget exceeded.");
  if (
    !checkpoint.usageKnown &&
    snapshot.budgets.requireUsage &&
    checkpoint.usage.outputTokens !== snapshot.budgets.maxOutputTokens
  )
    throw new Error("Unknown provider usage lost its budget reservation.");
  const used = strings(data.usedToolCallIds, 64, 256);
  const pinned = strings(data.pinnedToolCallIds, 64, 256);
  if (
    used.length !== checkpoint.toolCalls ||
    pinned.some((id) => !used.includes(id))
  )
    throw new Error("Invalid persisted tool-call accounting.");
  if (
    canonicalJson(checkpoint.messages.slice(0, snapshot.messages.length)) !==
    canonicalJson(snapshot.messages)
  )
    throw new Error("Checkpoint rewrote its original instructions.");
  const phases = [
    "ready-for-model",
    "model-pending",
    "model-returned",
    "tool-pending",
    "tool-observations",
    "answer-pending",
    "completed",
  ];
  if (!phases.includes(checkpoint.phase))
    throw new Error("Invalid loop checkpoint phase.");
  if (
    checkpoint.phase === "ready-for-model" &&
    (checkpoint.modelCalls ||
      checkpoint.toolCalls ||
      checkpoint.sequence ||
      checkpoint.usage.inputTokens ||
      checkpoint.usage.outputTokens ||
      canonicalJson(checkpoint.messages) !== canonicalJson(snapshot.messages))
  )
    throw new Error("Invalid initial loop checkpoint.");
  if (checkpoint.phase !== "ready-for-model" && checkpoint.modelCalls < 1)
    throw new Error("Missing persisted model-call budget.");
  const requiresTurn = [
    "model-returned",
    "tool-pending",
    "answer-pending",
  ].includes(checkpoint.phase);
  if (requiresTurn && !checkpoint.pendingTurn)
    throw new Error("Missing returned model turn.");
  if (
    ["ready-for-model", "model-pending", "completed"].includes(
      checkpoint.phase,
    ) &&
    checkpoint.pendingTurn
  )
    throw new Error("Unexpected pending model turn.");
  if (checkpoint.pendingTurn) {
    object(checkpoint.pendingTurn, ["reply", "nextToolIndex"]);
    const { reply, nextToolIndex } = checkpoint.pendingTurn;
    validateReply(reply);
    integer(nextToolIndex, 0, reply.calls.length);
    const allIds = reply.calls.map((call) => call.id);
    if (new Set(allIds).size !== allIds.length)
      throw new Error("Duplicate returned tool identities.");
    const completed = reply.calls.slice(0, nextToolIndex);
    if (completed.some((call) => !used.includes(call.id)))
      throw new Error("Missing completed tool identity.");
    if (checkpoint.phase === "tool-pending") {
      if (
        !reply.calls[nextToolIndex] ||
        !used.includes(reply.calls[nextToolIndex].id)
      )
        throw new Error("Missing in-flight tool identity.");
      if (
        reply.calls
          .slice(nextToolIndex + 1)
          .some((call) => used.includes(call.id))
      )
        throw new Error("Returned turn reused a tool identity.");
    } else if (
      reply.calls.slice(nextToolIndex).some((call) => used.includes(call.id))
    )
      throw new Error("Returned turn reused a tool identity.");
    if (checkpoint.phase === "answer-pending" && reply.calls.length)
      throw new Error("An answer cannot have pending tool calls.");
    if (checkpoint.phase === "model-returned" && nextToolIndex !== 0)
      throw new Error("Invalid returned model cursor.");
    if (
      checkpoint.phase === "tool-observations" &&
      (nextToolIndex < 1 || nextToolIndex >= reply.calls.length)
    )
      throw new Error("Invalid observation cursor.");
    const assistantIndex = checkpoint.messages.length - nextToolIndex - 1;
    const assistant = checkpoint.messages[assistantIndex];
    if (
      !assistant ||
      canonicalJson(assistant) !== canonicalJson(replyMessage(reply))
    )
      throw new Error("Returned model turn does not match conversation.");
    for (let index = 0; index < nextToolIndex; index++)
      if (
        checkpoint.messages[assistantIndex + index + 1]?.tool_call_id !==
        reply.calls[index].id
      )
        throw new Error("Observation does not match its returned tool call.");
  }
  if (
    checkpoint.phase === "completed"
      ? !Object.hasOwn(data, "result")
      : Object.hasOwn(data, "result")
  )
    throw new Error("Invalid terminal loop checkpoint.");
  return checkpoint;
}

export function replyMessage(reply: ModelReply): ChatMessage {
  return copyJson({
    role: "assistant" as const,
    content: reply.text || null,
    ...(reply.providerOutput ? { providerOutput: reply.providerOutput } : {}),
    ...(reply.calls.length
      ? {
          tool_calls: reply.calls.map((call) => ({
            id: call.id,
            type: "function" as const,
            function: { name: call.name, arguments: call.arguments },
          })),
        }
      : {}),
  });
}

/** A queueing hint, never a substitute for current-input binding validation/CAS. */
export function canResumeLoopCheckpoint(
  value: unknown,
  options?: {
    replaySafeToolNames?: string[];
    answerReplaySafe?: boolean;
  },
): boolean {
  try {
    const checkpoint = parseLoopCheckpoint(value);
    if (checkpoint.phase === "model-pending") return false;
    if (checkpoint.phase === "tool-pending") {
      const name =
        checkpoint.pendingTurn!.reply.calls[
          checkpoint.pendingTurn!.nextToolIndex
        ].name;
      return Boolean(
        options?.replaySafeToolNames?.includes(name) &&
          checkpoint.snapshot.tools.find((tool) => tool.name === name)
            ?.replaySafe,
      );
    }
    if (checkpoint.phase === "answer-pending")
      return Boolean(
        options?.answerReplaySafe && checkpoint.snapshot.answerReplaySafe,
      );
    return true;
  } catch {
    return false;
  }
}
