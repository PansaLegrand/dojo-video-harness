import { EventEmitter } from "node:events";
import { Readable } from "node:stream";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  MusicProviderError,
  submitBackgroundMusic,
  pollBackgroundMusic,
  downloadMusicTrack,
  type MusicDownloadOptions,
} from "../packages/adapters/src/music";

const config = {
  baseUrl: "https://api.kie.ai",
  model: "V6",
  apiKey: "private-test-key",
};
const input = {
  prompt: "Calm instrumental piano, no vocals",
  title: "Calm",
  durationSeconds: 20,
};
const signal = () => new AbortController().signal;
const response = (data: unknown) =>
  new Response(JSON.stringify({ code: 200, data }));
const row = {
  id: "audio-1",
  audio_url: "https://cdn1.suno.ai/track.mp3",
  duration: 19.99,
  title: "Calm",
};
const done = {
  taskId: "task-1",
  state: "success",
  response: { task_id: "task-1", data: [row] },
};
const track = {
  id: row.id,
  audioUrl: row.audio_url,
  durationSeconds: row.duration,
  title: row.title,
};
afterEach(() => vi.useRealTimers());

describe("Kie local-first background music adapter", () => {
  it("submits one custom instrumental jobs-v1 request without a callback or lyrics", async () => {
    const fetchImpl = vi.fn(async () => response({ taskId: "task-1" }));
    expect(
      await submitBackgroundMusic(config, input, signal(), { fetchImpl }),
    ).toEqual({ taskId: "task-1" });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [
      URL,
      RequestInit,
    ];
    expect(url.href).toBe("https://api.kie.ai/api/v1/jobs/createTask");
    expect(init).toMatchObject({
      method: "POST",
      redirect: "error",
      headers: { Authorization: "Bearer private-test-key" },
    });
    expect(JSON.parse(String(init.body))).toEqual({
      model: "ai-music-api/generate",
      input: {
        model: "V6",
        custom_mode: true,
        instrumental: true,
        style: input.prompt,
        title: "Calm",
        duration: 20,
      },
    });
  });
  it.each([
    [{ ...config, model: "V5" }, input],
    [{ ...config, apiKey: "" }, input],
    [{ ...config, baseUrl: "http://untrusted.example" }, input],
    [{ ...config, baseUrl: "https://api.kie.ai/api/v1" }, input],
    [config, { ...input, durationSeconds: 361 }],
    [config, { ...input, prompt: "x".repeat(1001) }],
    [config, { ...input, instrumental: false }],
  ])(
    "rejects invalid inputs/settings before paid requests",
    async (settings, request) => {
      const fetchImpl = vi.fn();
      await expect(
        submitBackgroundMusic(settings, request, signal(), { fetchImpl }),
      ).rejects.toMatchObject({ submissionUncertain: false });
      expect(fetchImpl).not.toHaveBeenCalled();
    },
  );
  it("cancellation before submit sends no request", async () => {
    const controller = new AbortController();
    controller.abort();
    const fetchImpl = vi.fn();
    await expect(
      submitBackgroundMusic(config, input, controller.signal, { fetchImpl }),
    ).rejects.toMatchObject({ code: "cancelled", submissionUncertain: false });
    expect(fetchImpl).not.toHaveBeenCalled();
  });
  it.each([
    () => new Response("private-test-key echoed by gateway", { status: 502 }),
    () => new Response("private-test-key invalid JSON"),
    () => response({}),
    () => {
      throw new Error("private-test-key network diagnostics");
    },
  ])(
    "retains uncertainty after a submit may have been accepted without retrying or exposing provider text",
    async (result) => {
      const fetchImpl = vi.fn(async () => result());
      const error = await submitBackgroundMusic(config, input, signal(), {
        fetchImpl,
      }).catch((e) => e);
      expect(error).toBeInstanceOf(MusicProviderError);
      expect(error.submissionUncertain).toBe(true);
      expect(String(error)).not.toContain(config.apiKey);
      expect(JSON.stringify(error)).not.toContain(config.apiKey);
      expect(fetchImpl).toHaveBeenCalledTimes(1);
    },
  );
  it("reports explicit provider rejection without printing echoed secrets", async () => {
    const fetchImpl = vi.fn(
      async () =>
        new Response(JSON.stringify({ code: 402, msg: config.apiKey })),
    );
    await expect(
      submitBackgroundMusic(config, input, signal(), { fetchImpl }),
    ).rejects.toMatchObject({
      code: "provider_rejected",
      providerCode: 402,
      submissionUncertain: false,
    });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });
  it("bounds a stalled submit and classifies the outcome as uncertain", async () => {
    vi.useFakeTimers();
    const fetchImpl = vi.fn(
      (_url, init) =>
        new Promise<Response>((_, reject) =>
          init!.signal!.addEventListener("abort", () =>
            reject(new Error("secret upstream detail")),
          ),
        ),
    );
    const pending = submitBackgroundMusic(config, input, signal(), {
      fetchImpl,
      timeoutMs: 25,
    });
    const checked = expect(pending).rejects.toMatchObject({
      code: "timeout",
      submissionUncertain: true,
    });
    await vi.advanceTimersByTimeAsync(25);
    await checked;
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });
  it("bounds stalled response-body reads as well as headers", async () => {
    vi.useFakeTimers();
    const cancelled = vi.fn();
    const fetchImpl = vi.fn(
      async () => new Response(new ReadableStream({ cancel: cancelled })),
    );
    const pending = submitBackgroundMusic(config, input, signal(), {
      fetchImpl,
      timeoutMs: 25,
    });
    const checked = expect(pending).rejects.toMatchObject({
      code: "timeout",
      submissionUncertain: true,
    });
    await vi.advanceTimersByTimeAsync(25);
    await checked;
    expect(cancelled).toHaveBeenCalled();
  });
  it("enforces declared and streamed JSON size bounds", async () => {
    for (const large of [
      new Response("{}", {
        headers: { "content-length": String(3 * 1024 * 1024) },
      }),
      new Response("x".repeat(2 * 1024 * 1024 + 1)),
    ]) {
      await expect(
        submitBackgroundMusic(config, input, signal(), {
          fetchImpl: async () => large,
        }),
      ).rejects.toMatchObject({
        code: "invalid_response",
        submissionUncertain: true,
      });
    }
  });
  it("polls one existing task and returns only validated final tracks", async () => {
    const fetchImpl = vi.fn(async () => response(done));
    expect(
      await pollBackgroundMusic(config, "task-1", signal(), { fetchImpl }),
    ).toEqual({ status: "succeeded", tracks: [track] });
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [
      URL,
      RequestInit,
    ];
    expect(url.href).toBe(
      "https://api.kie.ai/api/v1/jobs/recordInfo?taskId=task-1",
    );
    expect(init.method).toBe("GET");
    expect(init.body).toBeUndefined();
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });
  it("supports the jobs resultJson and legacy track spelling in the jobs envelope", async () => {
    const variants = [
      {
        taskId: "task-1",
        state: "success",
        resultJson: JSON.stringify({ task_id: "task-1", data: [row] }),
      },
      {
        taskId: "task-1",
        status: "SUCCESS",
        response: {
          sunoData: [
            {
              audioId: row.id,
              audioUrl: row.audio_url,
              duration: row.duration,
              title: row.title,
            },
          ],
        },
      },
    ];
    for (const detail of variants)
      expect(
        await pollBackgroundMusic(config, "task-1", signal(), {
          fetchImpl: async () => response(detail),
        }),
      ).toEqual({ status: "succeeded", tracks: [track] });
  });
  it.each([
    "waiting",
    "queuing",
    "generating",
    "TEXT_SUCCESS",
    "FIRST_SUCCESS",
  ])("does not insert partial results at %s", async (phase) => {
    expect(
      await pollBackgroundMusic(config, "task-1", signal(), {
        fetchImpl: async () => response({ ...done, state: phase }),
      }),
    ).toEqual({ status: "pending" });
  });
  it("does not promote a queued or first-only result to completed audio", async () => {
    for (const detail of [
      { ...done, state: "waiting", status: "SUCCESS" },
      { ...done, response: { ...done.response, callbackType: "first" } },
    ])
      expect(
        await pollBackgroundMusic(config, "task-1", signal(), {
          fetchImpl: async () => response(detail),
        }),
      ).toEqual({ status: "pending" });
  });
  it("keeps application-level server failure uncertain after a paid POST", async () => {
    await expect(
      submitBackgroundMusic(config, input, signal(), {
        fetchImpl: async () =>
          new Response(JSON.stringify({ code: 500, msg: config.apiKey })),
      }),
    ).rejects.toMatchObject({ submissionUncertain: true, providerCode: 500 });
  });
  it("surfaces terminal failure without remote error text or accidental success", async () => {
    expect(
      await pollBackgroundMusic(config, "task-1", signal(), {
        fetchImpl: async () =>
          response({
            ...done,
            state: "fail",
            failCode: "501",
            failMsg: config.apiKey,
          }),
      }),
    ).toEqual({ status: "failed", code: "provider_501" });
  });
  it.each([
    { ...done, taskId: "another-task" },
    { ...done, taskId: undefined },
    { ...done, model: "another-generator" },
    { ...done, response: { task_id: "another-task", data: [row] } },
    { ...done, response: { data: [] } },
    { ...done, response: { data: [row, row] } },
    { ...done, response: { data: [{ ...row, duration: 0 }] } },
    {
      ...done,
      response: { data: [{ ...row, audio_url: "http://127.0.0.1/file" }] },
    },
    {
      ...done,
      response: {
        data: [
          { ...row, audio_url: undefined, stream_audio_url: row.audio_url },
        ],
      },
    },
    { taskId: "task-1", state: "mysterious" },
  ])(
    "rejects malformed, mismatched and incomplete final outputs",
    async (detail) => {
      await expect(
        pollBackgroundMusic(config, "task-1", signal(), {
          fetchImpl: async () => response(detail),
        }),
      ).rejects.toMatchObject({
        code: "invalid_response",
        submissionUncertain: false,
      });
    },
  );
});

function downloadFixture({
  status = 200,
  mime = "audio/mpeg",
  parts = [Buffer.from("audio")],
  length,
}: { status?: number; mime?: string; parts?: Buffer[]; length?: number } = {}) {
  let captured: Record<string, unknown> | undefined;
  const requestImpl = vi.fn(
    (options: Record<string, unknown>, callback: (value: unknown) => void) => {
      captured = options;
      const request = new EventEmitter() as EventEmitter & { end(): void };
      request.end = () => {
        const response = Readable.from(parts) as Readable & {
          statusCode: number;
          headers: Record<string, string>;
        };
        response.statusCode = status;
        response.headers = {
          "content-type": mime,
          ...(length === undefined ? {} : { "content-length": String(length) }),
        };
        callback(response);
      };
      return request;
    },
  );
  return {
    requestImpl: requestImpl as unknown as NonNullable<
      MusicDownloadOptions["requestImpl"]
    >,
    requestMock: requestImpl,
    captured: () => captured,
  };
}
describe("music result download boundary", () => {
  const lookupImpl = vi.fn(async () => [
    { address: "8.8.8.8", family: 4 },
  ]) as unknown as NonNullable<MusicDownloadOptions["lookupImpl"]>;
  it("pins the public socket address and sends no provider credential to media storage", async () => {
    const fixture = downloadFixture();
    const result = await downloadMusicTrack(track, signal(), {
      lookupImpl,
      requestImpl: fixture.requestImpl,
    });
    expect(await result.text()).toBe("audio");
    expect(fixture.captured()).toMatchObject({
      hostname: "8.8.8.8",
      servername: "cdn1.suno.ai",
      path: "/track.mp3",
      headers: { Host: "cdn1.suno.ai", Accept: "audio/*" },
    });
    expect(JSON.stringify(fixture.captured())).not.toContain(config.apiKey);
    expect(fixture.captured()?.headers).not.toHaveProperty("Authorization");
  });
  it.each([
    "https://127.0.0.1/file.mp3",
    "https://suno.ai.attacker.example/file.mp3",
    "https://user:secret@cdn1.suno.ai/file.mp3",
    "https://cdn1.suno.ai:444/file.mp3",
  ])("rejects an untrusted media destination %s", async (audioUrl) => {
    const fixture = downloadFixture();
    await expect(
      downloadMusicTrack({ ...track, audioUrl }, signal(), {
        lookupImpl,
        requestImpl: fixture.requestImpl,
      }),
    ).rejects.toThrow();
    expect(fixture.requestMock).not.toHaveBeenCalled();
  });
  it.each([
    "127.0.0.1",
    "10.1.1.1",
    "169.254.169.254",
    "100.64.1.1",
    "::1",
    "::ffff:127.0.0.1",
    "fc00::1",
  ])(
    "rejects a CDN name resolving to non-public address %s",
    async (address) => {
      const fixture = downloadFixture();
      const lookup = vi.fn(async () => [
        { address, family: address.includes(":") ? 6 : 4 },
      ]) as unknown as typeof lookupImpl;
      await expect(
        downloadMusicTrack(track, signal(), {
          lookupImpl: lookup,
          requestImpl: fixture.requestImpl,
        }),
      ).rejects.toMatchObject({ code: "download_rejected" });
      expect(fixture.requestMock).not.toHaveBeenCalled();
    },
  );
  it.each([
    { status: 302 },
    { mime: "text/html" },
    { length: 100 },
    { parts: [Buffer.alloc(10), Buffer.alloc(10)] },
  ])("rejects redirects, bad MIME and over-budget bodies", async (options) => {
    const fixture = downloadFixture(options);
    await expect(
      downloadMusicTrack(track, signal(), {
        lookupImpl,
        requestImpl: fixture.requestImpl,
        maxBytes: 12,
      }),
    ).rejects.toMatchObject({ code: "download_rejected" });
  });
  it("bounds stalled DNS before opening a socket", async () => {
    vi.useFakeTimers();
    const fixture = downloadFixture();
    const lookup = vi.fn(
      () => new Promise(() => {}),
    ) as unknown as typeof lookupImpl;
    const checked = expect(
      downloadMusicTrack(track, signal(), {
        lookupImpl: lookup,
        requestImpl: fixture.requestImpl,
        timeoutMs: 20,
      }),
    ).rejects.toMatchObject({ code: "timeout" });
    await vi.advanceTimersByTimeAsync(20);
    await checked;
    expect(fixture.requestMock).not.toHaveBeenCalled();
  });
});

describe("trusted local music provider media", () => {
  const origin = "http://127.0.0.1:4319";
  it("permits explicitly configured local providers without sending an empty Authorization header", async () => {
    const fetchImpl = vi.fn(async (url) =>
      String(url).includes("createTask")
        ? response({ taskId: "task-1" })
        : response({ taskId: "task-1", state: "waiting" }),
    );
    const localConfig = { ...config, baseUrl: origin, apiKey: "" };
    await submitBackgroundMusic(localConfig, input, signal(), { fetchImpl });
    await pollBackgroundMusic(localConfig, "task-1", signal(), { fetchImpl });
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    for (const call of fetchImpl.mock.calls as unknown as [URL, RequestInit][])
      expect(call[1].headers).not.toHaveProperty("Authorization");
  });

  it("polling permits only the configured local origin, never arbitrary loopback destinations", async () => {
    const localConfig = { ...config, baseUrl: origin };
    const detail = {
      ...done,
      response: { data: [{ ...row, audio_url: origin + "/music.wav" }] },
    };
    expect(
      await pollBackgroundMusic(localConfig, "task-1", signal(), {
        fetchImpl: async () => response(detail),
      }),
    ).toMatchObject({
      status: "succeeded",
      tracks: [{ audioUrl: origin + "/music.wav" }],
    });
    for (const [settings, url] of [
      [config, origin + "/music.wav"],
      [config, "https://127.0.0.1/music.wav"],
      [localConfig, "http://127.0.0.1:4320/music.wav"],
      [localConfig, "http://localhost:4319/music.wav"],
      [localConfig, "http://169.254.169.254/meta"],
    ] as const) {
      await expect(
        pollBackgroundMusic(settings, "task-1", signal(), {
          fetchImpl: async () =>
            response({
              ...done,
              response: { data: [{ ...row, audio_url: url }] },
            }),
        }),
      ).rejects.toMatchObject({ code: "invalid_response" });
    }
  });
  it("downloads same-origin local media without an Authorization header and without DNS", async () => {
    const fixture = downloadFixture({ mime: "audio/wav" });
    const lookupImpl = vi.fn();
    const blob = await downloadMusicTrack(
      { ...track, audioUrl: origin + "/music.wav" },
      signal(),
      {
        localProviderOrigin: origin,
        lookupImpl,
        requestImpl: fixture.requestImpl,
      },
    );
    expect(await blob.text()).toBe("audio");
    expect(lookupImpl).not.toHaveBeenCalled();
    expect(fixture.captured()).toMatchObject({
      protocol: "http:",
      hostname: "127.0.0.1",
      port: 4319,
      headers: { Host: "127.0.0.1:4319", Accept: "audio/*" },
    });
    expect(fixture.captured()?.headers).not.toHaveProperty("Authorization");
  });
  it("does not let a local-provider option grant another origin, arbitrary host, or credentials", async () => {
    for (const [provider, url] of [
      [origin, "http://127.0.0.1:4320/music.wav"],
      [origin, "http://localhost:4319/music.wav"],
      ["http://evil.test", "http://evil.test/music.wav"],
      [origin, "http://secret@127.0.0.1:4319/music.wav"],
      [undefined, origin + "/music.wav"],
    ] as const) {
      const fixture = downloadFixture();
      await expect(
        downloadMusicTrack({ ...track, audioUrl: url }, signal(), {
          localProviderOrigin: provider,
          requestImpl: fixture.requestImpl,
        }),
      ).rejects.toThrow();
      expect(fixture.requestMock).not.toHaveBeenCalled();
    }
  });
  it.each([
    { status: 302 },
    { mime: "text/html" },
    { length: 100 },
    { parts: [Buffer.alloc(10), Buffer.alloc(10)] },
  ])(
    "retains redirect, MIME and byte limits for a local provider",
    async (options) => {
      const fixture = downloadFixture(options);
      await expect(
        downloadMusicTrack(
          { ...track, audioUrl: origin + "/music.wav" },
          signal(),
          {
            localProviderOrigin: origin,
            requestImpl: fixture.requestImpl,
            maxBytes: 12,
          },
        ),
      ).rejects.toMatchObject({ code: "download_rejected" });
    },
  );
});

describe("music download through synthetic fake-IP DNS", () => {
  const fakeLookup = vi.fn(async () => [
    { address: "198.18.6.7", family: 4 },
  ]) as unknown as NonNullable<MusicDownloadOptions["lookupImpl"]>;
  const dnsAnswer = {
    Status: 0,
    TC: false,
    Question: [{ name: "cdn1.suno.ai.", type: 1 }],
    Answer: [{ type: 1, data: "8.8.8.8" }],
  };
  it("resolves only the allowlisted hostname through fixed HTTPS DNS then pins a public socket", async () => {
    const fixture = downloadFixture();
    const dnsFetchImpl = vi.fn(
      async () => new Response(JSON.stringify(dnsAnswer)),
    );
    const result = await downloadMusicTrack(
      {
        ...track,
        audioUrl: track.audioUrl + "?signature=private-test-signature",
      },
      signal(),
      {
        lookupImpl: fakeLookup,
        dnsFetchImpl,
        requestImpl: fixture.requestImpl,
      },
    );
    expect(await result.text()).toBe("audio");
    const [url, options] = dnsFetchImpl.mock.calls[0] as unknown as [
      URL,
      RequestInit,
    ];
    expect(url.origin + url.pathname).toBe("https://1.1.1.1/dns-query");
    expect(url.searchParams.get("name")).toBe("cdn1.suno.ai");
    expect(url.searchParams.get("type")).toBe("A");
    expect(options).toMatchObject({
      redirect: "error",
      headers: { Accept: "application/dns-json" },
    });
    expect(options.headers).not.toHaveProperty("Authorization");
    expect(String(url)).not.toContain("private-test-signature");
    expect(fixture.captured()).toMatchObject({
      hostname: "8.8.8.8",
      servername: "cdn1.suno.ai",
    });
  });
  it.each(["127.0.0.1", "10.1.1.1", "169.254.169.254", "198.18.6.7"])(
    "still rejects resolver answers pointing to %s",
    async (address) => {
      const fixture = downloadFixture();
      const dnsFetchImpl = vi.fn(
        async () =>
          new Response(
            JSON.stringify({
              ...dnsAnswer,
              Answer: [{ type: 1, data: address }],
            }),
          ),
      );
      await expect(
        downloadMusicTrack(track, signal(), {
          lookupImpl: fakeLookup,
          dnsFetchImpl,
          requestImpl: fixture.requestImpl,
        }),
      ).rejects.toMatchObject({ code: "download_rejected" });
      expect(fixture.requestMock).not.toHaveBeenCalled();
    },
  );
  it.each([
    { ...dnsAnswer, Question: [{ name: "foreign.example.", type: 1 }] },
    { ...dnsAnswer, TC: true },
    { ...dnsAnswer, Status: 3 },
    { ...dnsAnswer, Answer: [] },
  ])(
    "rejects uncorrelated, truncated, failed or empty DNS responses",
    async (value) => {
      const fixture = downloadFixture();
      await expect(
        downloadMusicTrack(track, signal(), {
          lookupImpl: fakeLookup,
          dnsFetchImpl: async () => new Response(JSON.stringify(value)),
          requestImpl: fixture.requestImpl,
        }),
      ).rejects.toMatchObject({ code: "download_rejected" });
      expect(fixture.requestMock).not.toHaveBeenCalled();
    },
  );
  it("does not use public DNS to override arbitrary private or mixed DNS answers", async () => {
    const dnsFetchImpl = vi.fn();
    const fixture = downloadFixture();
    for (const addresses of [
      [{ address: "10.1.1.1", family: 4 }],
      [
        { address: "198.18.6.7", family: 4 },
        { address: "127.0.0.1", family: 4 },
      ],
    ]) {
      const lookupImpl = vi.fn(
        async () => addresses,
      ) as unknown as typeof fakeLookup;
      await expect(
        downloadMusicTrack(track, signal(), {
          lookupImpl,
          dnsFetchImpl,
          requestImpl: fixture.requestImpl,
        }),
      ).rejects.toMatchObject({ code: "download_rejected" });
    }
    expect(dnsFetchImpl).not.toHaveBeenCalled();
    expect(fixture.requestMock).not.toHaveBeenCalled();
  });
  it("rejects oversized DNS output and never follows redirects", async () => {
    for (const response of [
      new Response("x".repeat(16 * 1024 + 1)),
      new Response(null, {
        status: 302,
        headers: { location: "http://127.0.0.1/private" },
      }),
    ]) {
      const fixture = downloadFixture();
      const dnsFetchImpl = vi.fn(async () => response);
      await expect(
        downloadMusicTrack(track, signal(), {
          lookupImpl: fakeLookup,
          dnsFetchImpl,
          requestImpl: fixture.requestImpl,
        }),
      ).rejects.toThrow();
      expect(dnsFetchImpl).toHaveBeenCalledTimes(1);
      expect(fixture.requestMock).not.toHaveBeenCalled();
    }
  });
});
