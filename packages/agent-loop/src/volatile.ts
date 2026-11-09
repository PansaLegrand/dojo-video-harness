import type { ToolLoopInput, LoopResult, LoopEvent } from "./types.js";
import { LoopProviderOutputBudgetError } from "./checkpoint.js";

/** The host supplies tools and commits. This package has no project, provider or billing dependencies. */
export async function runVolatileToolLoop<T>(
  input: ToolLoopInput<T>,
): Promise<LoopResult<T>> {
  const { signal } = input;
  const bounded = (value: number, maximum: number, name: string) => {
    if (!Number.isInteger(value) || value < 1 || value > maximum)
      throw new Error(`Invalid ${name} budget.`);
    return value;
  };
  const maxSteps = bounded(input.maxSteps ?? 8, 32, "model-step");
  const maxToolCalls = bounded(input.maxToolCalls ?? 24, 64, "tool-call");
  const maxOutputTokens = bounded(
    input.maxOutputTokens ?? 32768,
    128000,
    "output-token",
  );
  const registry = new Map(input.tools.map((tool) => [tool.name, tool]));
  if (registry.size !== input.tools.length)
    throw new Error("Tool names must be unique.");
  const specs = input.tools.map(({ name, description, parameters }) => ({
    name,
    description,
    parameters,
  }));
  const messages = input.messages.slice();
  const ids = new Set<string>();
  const usage = { inputTokens: 0, outputTokens: 0 };
  let sequence = 0,
    toolCalls = 0,
    observationBytes = 0;
  const emit = async (
    type: LoopEvent["type"],
    name?: string,
    summary?: string,
  ) => {
    signal.throwIfAborted();
    await input.onEvent?.({
      sequence: sequence++,
      type,
      ...(name ? { name } : {}),
      ...(summary ? { summary } : {}),
    });
  };
  for (let step = 0; step < maxSteps; step++) {
    signal.throwIfAborted();
    const remaining = maxOutputTokens - usage.outputTokens;
    if (remaining < 1)
      throw new Error("Model output budget reached. Narrow the request.");
    await emit("model.started");
    const response = await input.model.complete(messages, specs, signal, {
      maxOutputTokens: remaining,
      outputBudgetPolicy: "preserve-overrun-v1",
    });
    signal.throwIfAborted();
    if (response.usage) {
      if (
        response.outputTokenLimit !== undefined &&
        (!Number.isSafeInteger(response.outputTokenLimit) ||
          response.outputTokenLimit < 1 ||
          response.outputTokenLimit > 128000)
      )
        throw new Error("Invalid provider output limit.");
      for (const count of [
        response.usage.inputTokens,
        response.usage.outputTokens,
      ]) {
        if (!Number.isSafeInteger(count) || count < 0)
          throw new Error("Invalid provider usage.");
      }
      const priorOutputTokens = usage.outputTokens;
      usage.inputTokens += response.usage.inputTokens;
      usage.outputTokens += response.usage.outputTokens;
      if (
        !Number.isSafeInteger(usage.inputTokens) ||
        !Number.isSafeInteger(usage.outputTokens)
      )
        throw new Error("Invalid provider usage.");
      const requestedMaxOutputTokens = Math.min(
        remaining,
        response.outputTokenLimit ?? remaining,
      );
      if (response.usage.outputTokens > requestedMaxOutputTokens)
        throw new LoopProviderOutputBudgetError({
          kind: "provider-output-budget",
          modelCall: step + 1,
          priorOutputTokens,
          requestedMaxOutputTokens,
          returnedOutputTokens: response.usage.outputTokens,
        });
    } else if (input.maxOutputTokens !== undefined) {
      // Unknown usage cannot authorize another paid turn under a total-token budget.
      usage.outputTokens = maxOutputTokens;
    }
    if (response.text.length > 300000 || response.calls.length > 64)
      throw new Error("Model result exceeds context budget.");
    messages.push({
      role: "assistant",
      content: response.text || null,
      providerOutput: response.providerOutput,
      ...(response.calls.length
        ? {
            tool_calls: response.calls.map((call) => ({
              id: call.id,
              type: "function" as const,
              function: { name: call.name, arguments: call.arguments },
            })),
          }
        : {}),
    });
    if (!response.calls.length) {
      if (!response.text.trim())
        throw new Error("The model returned no answer or tool calls.");
      return {
        result: await input.answer(response.text),
        usage,
        modelCalls: step + 1,
      };
    }
    for (const call of response.calls) {
      signal.throwIfAborted();
      if (++toolCalls > maxToolCalls)
        throw new Error("Tool-call budget reached. Narrow the request.");
      if (!call.id || ids.has(call.id))
        throw new Error("The model reused a tool-call identity.");
      ids.add(call.id);
      if (call.arguments.length > 300000)
        throw new Error("Tool input exceeds context budget.");
      await emit("tool.started", call.name);
      let observation: unknown;
      let terminal: { result: T } | undefined;
      try {
        const tool = registry.get(call.name);
        if (!tool)
          throw new Error("Unknown tool. Choose from the advertised registry.");
        const outcome = await tool.execute(JSON.parse(call.arguments), signal);
        signal.throwIfAborted();
        if (outcome.kind === "terminal") terminal = { result: outcome.result };
        else {
          observation = outcome.value;
          if (JSON.stringify(observation).length > 120000)
            throw new Error(
              "Result exceeds context budget. Inspect fewer items.",
            );
        }
      } catch (cause) {
        signal.throwIfAborted();
        observation = {
          error: cause instanceof Error ? cause.message : "Tool failed",
          hint: "Correct the input or ask a focused question.",
        };
      }
      // Persistence/event failures are outside the correctable tool-error boundary.
      if (terminal) {
        await emit("tool.completed", call.name, "Validated");
        return { result: terminal.result, usage, modelCalls: step + 1 };
      }
      const content = JSON.stringify(observation);
      observationBytes += content.length;
      if (observationBytes > 240000)
        throw new Error("Observation budget reached. Narrow the request.");
      messages.push({ role: "tool", tool_call_id: call.id, content });
      await emit("tool.completed", call.name);
    }
  }
  throw new Error("Model-step budget reached. Narrow the request.");
}
