import { z } from "zod/v3";
import { isGptModelId } from "./gpt-model";
import type {
  LanguageModel,
  ChatMessage,
  ToolSpec,
} from "../../agent/src/types";
import {
  providerUrl,
  providerJson,
  type ProviderConfig,
} from "./provider-http";

const functionCall = z
  .object({
    type: z.literal("function_call"),
    call_id: z.string().min(1).max(191),
    name: z.string().min(1).max(100),
    arguments: z.string().max(300_000),
    status: z.literal("completed").optional(),
  })
  .passthrough();
const message = z
  .object({
    type: z.literal("message"),
    role: z.literal("assistant"),
    status: z.literal("completed").optional(),
    content: z.array(
      z.discriminatedUnion("type", [
        z
          .object({ type: z.literal("output_text"), text: z.string() })
          .passthrough(),
        z
          .object({ type: z.literal("refusal"), refusal: z.string() })
          .passthrough(),
      ]),
    ),
  })
  .passthrough();
const reasoning = z
  .object({
    type: z.literal("reasoning"),
    id: z.string().optional(),
    summary: z.array(z.unknown()),
    encrypted_content: z.string().nullable().optional(),
  })
  .passthrough();
const responseSchema = z.object({
  status: z.literal("completed"),
  output: z
    .array(z.discriminatedUnion("type", [functionCall, message, reasoning]))
    .max(100),
  usage: z
    .object({
      input_tokens: z.number().int().nonnegative(),
      output_tokens: z.number().int().nonnegative(),
    })
    .optional(),
});

/** Replay the complete model output so tool results retain their reasoning context. */
function responseInput(
  messages: ChatMessage[],
): Array<Record<string, unknown>> {
  return messages.flatMap((m): Array<Record<string, unknown>> => {
    if (m.role === "tool") {
      if (!m.tool_call_id || typeof m.content !== "string")
        throw new Error(
          "Tool results require their original call ID and a string output.",
        );
      return [
        {
          type: "function_call_output",
          call_id: m.tool_call_id,
          output: m.content,
        },
      ];
    }
    if (m.role === "assistant") {
      if (m.providerOutput) return m.providerOutput;
      return [
        ...(m.content ? [{ role: "assistant", content: m.content }] : []),
        ...(m.tool_calls ?? []).map((call) => ({
          type: "function_call",
          call_id: call.id,
          ...call.function,
        })),
      ];
    }
    const content =
      typeof m.content === "string"
        ? m.content
        : (m.content ?? []).map((part) => {
            const value = z
              .discriminatedUnion("type", [
                z.object({ type: z.literal("text"), text: z.string() }),
                z.object({
                  type: z.literal("image_url"),
                  image_url: z.object({ url: z.string() }),
                }),
              ])
              .parse(part);
            return value.type === "text"
              ? { type: "input_text", text: value.text }
              : { type: "input_image", image_url: value.image_url.url };
          });
    return [{ role: m.role, content }];
  });
}

/** GPT-only Responses transport. No SDK, retries, tool execution, or project writes. */
export class GptResponsesModel implements LanguageModel {
  constructor(private config: ProviderConfig) {}
  async complete(
    messages: ChatMessage[],
    tools: ToolSpec[],
    signal: AbortSignal,
    limits?: { maxOutputTokens: number },
  ) {
    signal.throwIfAborted();
    if (!isGptModelId(this.config.model))
      throw new Error(
        "Set LLM_MODEL to a GPT model such as gpt-6-sol or openai/gpt-6-sol. Only GPT models are supported.",
      );
    const response = await fetch(
      providerUrl(this.config.baseUrl, "responses"),
      {
        method: "POST",
        redirect: "error",
        signal,
        headers: {
          "Content-Type": "application/json",
          ...(this.config.apiKey
            ? { Authorization: `Bearer ${this.config.apiKey}` }
            : {}),
        },
        body: JSON.stringify({
          model: this.config.model,
          input: responseInput(messages),
          tools: tools.map((t) => ({ type: "function", ...t, strict: false })),
          ...(tools.length
            ? { tool_choice: "auto", parallel_tool_calls: false }
            : {}),
          max_output_tokens: Math.min(8192, limits?.maxOutputTokens ?? 8192),
          stream: false,
          store: false,
          include: ["reasoning.encrypted_content"],
        }),
      },
    );
    const raw = await providerJson(response);
    // Kie can return an error envelope with HTTP 200. Never echo provider messages.
    if (raw && typeof raw === "object") {
      const envelope = raw as Record<string, unknown>;
      if (typeof envelope.code === "number" && envelope.code !== 200)
        throw new Error(
          `GPT provider returned error code ${envelope.code}. Check the key, model, and account limits.`,
        );
      if (envelope.error)
        throw new Error(
          "GPT provider reported an error. Check the configured endpoint, model, key, and account limits.",
        );
    }
    const parsed = responseSchema.safeParse(raw);
    if (!parsed.success)
      throw new Error(
        "GPT provider returned an incomplete or unsupported Responses payload. No tool calls were executed.",
      );
    const result = parsed.data;
    const calls = result.output.filter((item) => item.type === "function_call");
    if (calls.length > 24)
      throw new Error("GPT provider exceeded the tool-call limit.");
    return {
      text: result.output
        .flatMap((item) =>
          item.type === "message"
            ? item.content.map((part) =>
                part.type === "output_text" ? part.text : part.refusal,
              )
            : [],
        )
        .join("\n"),
      calls: calls.map((call) => ({
        id: call.call_id,
        name: call.name,
        arguments: call.arguments,
      })),
      providerOutput: result.output,
      ...(result.usage
        ? {
            usage: {
              inputTokens: result.usage.input_tokens,
              outputTokens: result.usage.output_tokens,
            },
          }
        : {}),
    };
  }
}
