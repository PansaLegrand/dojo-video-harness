import { afterEach, describe, expect, it, vi } from "vitest";
import { GptResponsesModel } from "../packages/adapters/src/gpt-responses";
import { runAgent } from "../packages/agent/src/loop";
import {
  createVideoProjectDocument,
  hashVideoProjectDocument,
} from "../packages/core/src/lib/video-project/document";
const config = {
  baseUrl: "https://api.kie.ai/codex/v1",
  model: "gpt-6-sol",
  apiKey: "test-key",
};
const signal = () => new AbortController().signal;
const tool = {
  name: "inspect_project",
  description: "Inspect",
  parameters: { type: "object", properties: {} },
};
const complete = (output: unknown[]) => ({
  status: "completed",
  output,
  usage: { input_tokens: 15, output_tokens: 5 },
});
const call = (name = "inspect_project", args = "{}", callId = "call-1") => ({
  type: "function_call",
  id: "fc-" + callId,
  call_id: callId,
  name,
  arguments: args,
  status: "completed",
});
const reasoning = {
  type: "reasoning",
  id: "rs-1",
  summary: [],
  encrypted_content: "opaque-context",
};
const answer = {
  type: "message",
  role: "assistant",
  content: [{ type: "output_text", text: "Done", annotations: [] }],
  status: "completed",
};
afterEach(() => vi.unstubAllGlobals());
function provider(body: unknown, status = 200) {
  const fetch = vi.fn(
    async (_input: RequestInfo | URL, _init?: RequestInit) =>
      new Response(JSON.stringify(body), {
        status,
        headers: { "content-type": "application/json" },
      }),
  );
  vi.stubGlobal("fetch", fetch);
  return fetch;
}
describe("GPT Responses transport", () => {
  it("uses Responses function calls, bounded stateless requests, and image input", async () => {
    const fetch = provider(complete([reasoning, call()]));
    const abort = signal();
    const result = await new GptResponsesModel(config).complete(
      [
        {
          role: "user",
          content: [
            { type: "text", text: "Inspect" },
            {
              type: "image_url",
              image_url: { url: "data:image/png;base64,AAAA" },
            },
          ],
        },
      ],
      [tool],
      abort,
    );
    const [url, init] = fetch.mock.calls[0] as unknown as [URL, RequestInit];
    expect(url.href).toBe("https://api.kie.ai/codex/v1/responses");
    expect(init.signal).toBe(abort);
    expect(init.redirect).toBe("error");
    expect(JSON.parse(init.body as string)).toMatchObject({
      model: "gpt-6-sol",
      store: false,
      stream: false,
      max_output_tokens: 8192,
      include: ["reasoning.encrypted_content"],
      tool_choice: "auto",
      parallel_tool_calls: false,
      tools: [{ type: "function", name: "inspect_project", strict: false }],
      input: [
        {
          role: "user",
          content: [
            { type: "input_text", text: "Inspect" },
            { type: "input_image", image_url: "data:image/png;base64,AAAA" },
          ],
        },
      ],
    });
    expect(result.calls).toEqual([
      { id: "call-1", name: "inspect_project", arguments: "{}" },
    ]);
    expect(result.usage).toEqual({ inputTokens: 15, outputTokens: 5 });
  });
  it("keeps reasoning and call IDs through the real loop's observation turn", async () => {
    const document = createVideoProjectDocument();
    const fetch = provider(complete([reasoning, call()]));
    fetch.mockImplementationOnce(
      async () => new Response(JSON.stringify(complete([reasoning, call()]))),
    );
    fetch.mockImplementationOnce(
      async () => new Response(JSON.stringify(complete([answer]))),
    );
    const result = await runAgent({
      request: {
        contract: "video-project-commands",
        version: 1,
        baseRevision: 0,
        baseHash: await hashVideoProjectDocument(document),
        document,
        context: { selectedItemIds: [], playheadFrame: 0 },
        instruction: "Describe the project",
      },
      model: new GptResponsesModel(config),
      skills: [],
      signal: signal(),
    });
    expect(result.outcome).toBe("answer");
    const init = fetch.mock.calls[1]?.[1] as RequestInit | undefined;
    const body = JSON.parse(init?.body as string);
    expect(body.input[2]).toEqual(reasoning);
    expect(body.input[3]).toEqual(call());
    expect(body.input[4]).toMatchObject({
      type: "function_call_output",
      call_id: "call-1",
    });
    expect(JSON.parse(body.input[4].output)).toHaveProperty("format");
    expect(fetch).toHaveBeenCalledTimes(2);
  });
  it("omits tool_choice when no tools are provided", async () => {
    const fetch = provider(complete([answer]));
    const reply = await new GptResponsesModel(config).complete(
      [{ role: "user", content: "Hello" }],
      [],
      signal(),
    );
    const body = JSON.parse(
      (fetch.mock.calls[0]?.[1] as RequestInit).body as string,
    );
    expect(body).not.toHaveProperty("tool_choice");
    expect(reply.text).toBe("Done");
  });
  it.each([
    { code: 401, msg: "do not leak test-key" },
    { code: 402, msg: "do not leak test-key" },
    { code: 429, msg: "do not leak test-key" },
    { error: { message: "do not leak test-key" } },
  ])(
    "rejects HTTP-200 provider errors without leaking their message",
    async (payload) => {
      const fetch = provider(payload);
      const error = await new GptResponsesModel(config)
        .complete([], [tool], signal())
        .then(
          () => null,
          (error: Error) => error,
        );
      expect(error?.message).toMatch(/GPT provider/);
      expect(error?.message).not.toContain("test-key");
      expect(fetch).toHaveBeenCalledTimes(1);
    },
  );
  it.each([
    { status: "incomplete", output: [call()] },
    { status: "failed", output: [call()] },
    complete([{ ...call(), status: "in_progress" }]),
    complete([{ ...call(), call_id: "" }]),
    complete([{ type: "web_search_call" }]),
  ])(
    "rejects incomplete or unsupported output before tool execution",
    async (payload) => {
      provider(payload);
      await expect(
        new GptResponsesModel(config).complete([], [tool], signal()),
      ).rejects.toThrow(/No tool calls were executed/);
    },
  );
  it("does not retry HTTP errors or expose their response body", async () => {
    const fetch = provider({ error: "test-key" }, 429);
    await expect(
      new GptResponsesModel(config).complete([], [tool], signal()),
    ).rejects.toThrow("HTTP 429");
    expect(fetch).toHaveBeenCalledTimes(1);
  });
  it("does not quote malformed provider bodies in parse errors", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("secret-test-key invalid JSON")),
    );
    await expect(
      new GptResponsesModel(config).complete([], [tool], signal()),
    ).rejects.toThrow("Provider returned invalid JSON.");
  });
  it("rejects non-GPT models and pre-cancelled calls before network I/O", async () => {
    const fetch = provider(complete([answer]));
    await expect(
      new GptResponsesModel({ ...config, model: "claude-test" }).complete(
        [],
        [],
        signal(),
      ),
    ).rejects.toThrow("Only GPT");
    await expect(
      new GptResponsesModel(config).complete([], [], AbortSignal.abort()),
    ).rejects.toThrow();
    expect(fetch).not.toHaveBeenCalled();
  });
});
