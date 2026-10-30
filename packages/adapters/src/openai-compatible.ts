import { z } from "zod/v3";
import type {
  LanguageModel,
  ChatMessage,
  ToolSpec,
} from "../../agent/src/types";
export type ProviderConfig = { baseUrl: string; model: string; apiKey: string };
export function providerUrl(base: string, suffix: string) {
  const url = new URL(base.replace(/\/$/, "") + "/" + suffix);
  if (
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    !(
      url.protocol === "https:" ||
      (url.protocol === "http:" &&
        ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname))
    )
  )
    throw new Error("Provider URLs require HTTPS, except local providers.");
  return url;
}
export async function providerJson(response: Response) {
  if (!response.ok) {
    await response.body?.cancel();
    throw new Error(
      `Provider returned HTTP ${response.status}. Check the configured endpoint, model, key, and account limits.`,
    );
  }
  const reader = response.body?.getReader();
  if (!reader) throw new Error("Provider returned an empty body.");
  const parts: Uint8Array[] = [];
  let bytes = 0;
  while (true) {
    const next = await reader.read();
    if (next.done) break;
    bytes += next.value.length;
    if (bytes > 4_000_000) {
      await reader.cancel();
      throw new Error("Provider response exceeds 4 MB.");
    }
    parts.push(next.value);
  }
  return JSON.parse(Buffer.concat(parts).toString("utf8")) as unknown;
}
const responseSchema = z.object({
  choices: z
    .array(
      z.object({
        message: z.object({
          content: z.string().nullable().optional(),
          tool_calls: z
            .array(
              z.object({
                id: z.string().min(1).max(191),
                type: z.literal("function"),
                function: z.object({
                  name: z.string().max(100),
                  arguments: z.string().max(300_000),
                }),
              }),
            )
            .max(24)
            .optional(),
        }),
      }),
    )
    .min(1),
});
/** Transport only. No retries, document mutation, billing, or tools live here. */
export class OpenAICompatibleModel implements LanguageModel {
  constructor(private config: ProviderConfig) {}
  async complete(
    messages: ChatMessage[],
    tools: ToolSpec[],
    signal: AbortSignal,
  ) {
    if (!this.config.model)
      throw new Error("Set LLM_MODEL in .env before using chat.");
    const response = await fetch(
      providerUrl(this.config.baseUrl, "chat/completions"),
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
          messages,
          tools: tools.map((t) => ({ type: "function", function: t })),
          tool_choice: "auto",
          max_tokens: 8192,
          stream: false,
        }),
      },
    );
    const message = responseSchema.parse(await providerJson(response))
      .choices[0]!.message;
    return {
      text: message.content ?? "",
      calls: (message.tool_calls ?? []).map((call) => ({
        id: call.id,
        ...call.function,
      })),
    };
  }
}
