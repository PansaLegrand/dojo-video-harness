import type {
  LoopCheckpoint,
  LoopEvent,
  LoopResult,
  LoopSnapshot,
  ModelReply,
  ToolLoopInput,
} from "./types.js";
import {
  integer,
  LoopRecoveryRequiredError,
  parseLoopCheckpoint,
  replyMessage,
  validateReply,
  validateSnapshot,
} from "./checkpoint.js";
import { canonicalJson, copyJson, hashJson } from "./json.js";
import { compactLoopMessages } from "./compaction.js";
import { runVolatileToolLoop } from "./volatile.js";

/** Persistence is an optional host CAS port, never a database/provider dependency. */
export async function runToolLoop<T>(
  input: ToolLoopInput<T>,
): Promise<LoopResult<T>> {
  const port = input.checkpoint;
  if (!port && !input.compaction) return runVolatileToolLoop(input);
  const { signal } = input;
  signal.throwIfAborted();
  const registry = new Map(input.tools.map((tool) => [tool.name, tool]));
  if (registry.size !== input.tools.length)
    throw new Error("Tool names must be unique.");
  const snapshot: LoopSnapshot = copyJson(
    {
      runId: port?.runId ?? "volatile",
      snapshotHash: port?.snapshotHash ?? "volatile",
      ...(input.model.identity === undefined
        ? {}
        : { modelIdentity: input.model.identity }),
      messages: input.messages,
      tools: input.tools.map(
        ({ name, description, parameters, replaySafe, compactionSafe }) => ({
          name,
          description,
          parameters,
          replaySafe: replaySafe === true,
          compactionSafe: compactionSafe === true,
        }),
      ),
      budgets: {
        maxSteps: integer(input.maxSteps ?? 8, 1, 32),
        maxToolCalls: integer(input.maxToolCalls ?? 24, 1, 64),
        maxOutputTokens: integer(input.maxOutputTokens ?? 32768, 1, 128000),
        requireUsage: Boolean(port) || input.maxOutputTokens !== undefined,
      },
      answerReplaySafe: input.answerReplaySafe === true,
      durablePlanRefs: input.durablePlanRefs ?? [],
      ...(input.compaction ? { compaction: input.compaction } : {}),
    },
    2_000_000,
  );
  validateSnapshot(snapshot);
  const bindingHash = await hashJson({ version: 1, snapshot });
  signal.throwIfAborted();
  const stored = port ? await port.load() : null;
  signal.throwIfAborted();
  let checkpoint: LoopCheckpoint;
  if (stored !== null) {
    checkpoint = parseLoopCheckpoint(stored);
    if (
      checkpoint.bindingHash !== bindingHash ||
      canonicalJson(checkpoint.snapshot) !== canonicalJson(snapshot)
    )
      throw new Error(
        "Loop checkpoint binding does not match this run/snapshot/tool inventory.",
      );
  } else {
    checkpoint = parseLoopCheckpoint({
      version: 1,
      revision: 0,
      bindingHash,
      snapshot,
      phase: "ready-for-model",
      messages: snapshot.messages,
      usage: { inputTokens: 0, outputTokens: 0 },
      usageKnown: true,
      modelCalls: 0,
      toolCalls: 0,
      observationCharacters: 0,
      sequence: 0,
      usedToolCallIds: [],
      pinnedToolCallIds: [],
    });
    await port?.save(copyJson(checkpoint), null);
  }
  const persist = async (phase: LoopCheckpoint["phase"]) => {
    const previousRevision = checkpoint.revision;
    const next = parseLoopCheckpoint({
      ...checkpoint,
      phase,
      revision: previousRevision + 1,
    });
    await port?.save(copyJson(next), previousRevision);
    checkpoint = next;
  };
  const event = (
    type: LoopEvent["type"],
    fields: Partial<LoopEvent> = {},
  ): LoopEvent => ({
    sequence: checkpoint.sequence++,
    type,
    ...fields,
  });
  const emit = async (value: LoopEvent) => {
    signal.throwIfAborted();
    await input.onEvent?.(value);
    signal.throwIfAborted();
  };
  const result = (): LoopResult<T> => ({
    result: copyJson(checkpoint.result) as T,
    usage: { ...checkpoint.usage },
    modelCalls: checkpoint.modelCalls,
    ...(port ? { usageKnown: checkpoint.usageKnown } : {}),
  });
  const complete = async (value: T, name?: string, callId?: string) => {
    checkpoint.result = copyJson(value);
    delete checkpoint.pendingTurn;
    const completedEvent = name
      ? event("tool.completed", { name, callId, summary: "Validated" })
      : undefined;
    await persist("completed");
    signal.throwIfAborted();
    if (completedEvent) await emit(completedEvent);
    return result();
  };
  const toolMetadata = (name: string) =>
    snapshot.tools.find((tool) => tool.name === name);
  const executeTool = async (
    replay: boolean,
  ): Promise<LoopResult<T> | undefined> => {
    const turn = checkpoint.pendingTurn!;
    const call = turn.reply.calls[turn.nextToolIndex];
    const safe = toolMetadata(call.name)?.replaySafe === true;
    if (replay && !safe)
      throw new LoopRecoveryRequiredError("tool-outcome-unknown", call.id);
    if (!replay) {
      if (checkpoint.toolCalls >= snapshot.budgets.maxToolCalls)
        throw new Error("Tool-call budget reached. Narrow the request.");
      if (checkpoint.usedToolCallIds.includes(call.id))
        throw new Error("The model reused a tool-call identity.");
      checkpoint.toolCalls++;
      checkpoint.usedToolCallIds.push(call.id);
    }
    const started = event("tool.started", {
      name: call.name,
      callId: call.id,
      ...(replay ? { replay: true } : {}),
    });
    await persist("tool-pending");
    await emit(started);
    let observation: unknown;
    let pinned = false;
    let enteredExecutor = false;
    let terminal: { result: T } | undefined;
    try {
      const tool = registry.get(call.name);
      if (!tool)
        throw new Error("Unknown tool. Choose from the advertised registry.");
      const args: unknown = JSON.parse(call.arguments);
      enteredExecutor = true;
      const outcome = await tool.execute(args, signal, {
        callId: call.id,
        ...(port ? { runId: snapshot.runId } : {}),
        replay,
      });
      // Keep known returned outcomes even if cancellation arrived during the call.
      if (outcome.kind === "terminal")
        terminal = { result: copyJson(outcome.result) };
      else if (outcome.kind === "observation") {
        observation = copyJson(outcome.value, 120000);
        pinned = outcome.pinned === true;
      } else throw new Error("Invalid trusted tool outcome.");
    } catch (cause) {
      signal.throwIfAborted();
      if (enteredExecutor && port && !safe)
        throw new LoopRecoveryRequiredError("tool-outcome-unknown", call.id);
      observation = {
        error: cause instanceof Error ? cause.message : "Tool failed",
        hint: "Correct the input or ask a focused question.",
      };
      pinned = true;
    }
    if (terminal) return complete(terminal.result, call.name, call.id);
    const content = JSON.stringify(observation);
    checkpoint.observationCharacters += content.length;
    if (checkpoint.observationCharacters > 240000)
      throw new Error("Observation budget reached. Narrow the request.");
    checkpoint.messages.push({ role: "tool", tool_call_id: call.id, content });
    if (pinned && !checkpoint.pinnedToolCallIds.includes(call.id))
      checkpoint.pinnedToolCallIds.push(call.id);
    // Persist the cursor with its observation, so completed tools are never replayed.
    checkpoint.pendingTurn!.nextToolIndex++;
    if (
      checkpoint.pendingTurn!.nextToolIndex ===
      checkpoint.pendingTurn!.reply.calls.length
    )
      delete checkpoint.pendingTurn;
    const completedEvent = event("tool.completed", {
      name: call.name,
      callId: call.id,
    });
    await persist("tool-observations");
    signal.throwIfAborted();
    await emit(completedEvent);
  };
  const answer = async (replay: boolean): Promise<LoopResult<T>> => {
    if (replay && !snapshot.answerReplaySafe)
      throw new LoopRecoveryRequiredError("answer-outcome-unknown");
    const text = checkpoint.pendingTurn!.reply.text;
    if (!text.trim())
      throw new Error("The model returned no answer or tool calls.");
    await persist("answer-pending");
    signal.throwIfAborted();
    const value = await input.answer(text);
    return complete(value);
  };

  while (true) {
    signal.throwIfAborted();
    if (checkpoint.phase === "completed") return result();
    if (checkpoint.phase === "model-pending")
      throw new LoopRecoveryRequiredError("model-outcome-unknown");
    if (checkpoint.phase === "answer-pending") return answer(true);
    if (checkpoint.phase === "tool-pending") {
      const terminal = await executeTool(true);
      if (terminal) return terminal;
      continue;
    }
    if (checkpoint.pendingTurn) {
      if (!checkpoint.pendingTurn.reply.calls.length) return answer(false);
      const terminal = await executeTool(false);
      if (terminal) return terminal;
      continue;
    }
    if (snapshot.compaction)
      checkpoint.messages = compactLoopMessages({
        messages: checkpoint.messages,
        initialMessages: snapshot.messages,
        compactableToolNames: snapshot.tools
          .filter((tool) => tool.compactionSafe)
          .map((tool) => tool.name),
        pinnedToolCallIds: checkpoint.pinnedToolCallIds,
        durablePlanRefs: snapshot.durablePlanRefs,
        options: snapshot.compaction,
      }).messages;
    if (checkpoint.modelCalls >= snapshot.budgets.maxSteps)
      throw new Error("Model-step budget reached. Narrow the request.");
    const remaining =
      snapshot.budgets.maxOutputTokens - checkpoint.usage.outputTokens;
    if (remaining < 1)
      throw new Error("Model output budget reached. Narrow the request.");
    checkpoint.modelCalls++;
    const started = event("model.started");
    await persist("model-pending"); // Submission fence: never automatically repeat this state.
    await emit(started);
    const returned = await input.model.complete(
      copyJson(checkpoint.messages),
      copyJson(
        snapshot.tools.map(({ name, description, parameters }) => ({
          name,
          description,
          parameters,
        })),
      ),
      signal,
      { maxOutputTokens: remaining },
    );
    const reply = copyJson(returned);
    validateReply(reply);
    const callIds = reply.calls.map((call) => call.id);
    if (
      new Set(callIds).size !== callIds.length ||
      callIds.some((id) => checkpoint.usedToolCallIds.includes(id))
    )
      throw new Error("The model reused a tool-call identity.");
    if (reply.usage) {
      checkpoint.usage.inputTokens = integer(
        checkpoint.usage.inputTokens + reply.usage.inputTokens,
        0,
        Number.MAX_SAFE_INTEGER,
      );
      checkpoint.usage.outputTokens = integer(
        checkpoint.usage.outputTokens + reply.usage.outputTokens,
        0,
        snapshot.budgets.maxOutputTokens,
      );
    } else {
      checkpoint.usageKnown = false;
      if (snapshot.budgets.requireUsage)
        checkpoint.usage.outputTokens = snapshot.budgets.maxOutputTokens;
    }
    checkpoint.messages.push(replyMessage(reply));
    checkpoint.pendingTurn = { reply, nextToolIndex: 0 };
    await persist("model-returned"); // Preserve paid output before tools or cancellation.
    signal.throwIfAborted();
  }
}
