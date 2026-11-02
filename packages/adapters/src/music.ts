import { z } from "zod/v3";
import { lookup } from "node:dns/promises";
import { isIP, BlockList } from "node:net";
import { request as httpsRequest } from "node:https";
import { request as httpRequest } from "node:http";
import { providerUrl, type ProviderConfig } from "./provider-http";

// Kie's jobs-v1 API supports polling without callBackUrl. A local host must not
// invent a public callback. https://docs.kie.ai/suno-api/generate-music
export const backgroundMusicRequestSchema = z
  .object({
    prompt: z.string().trim().min(1).max(1000),
    title: z.string().trim().min(1).max(80),
    durationSeconds: z.number().finite().min(10).max(360).optional(),
  })
  .strict();
export type BackgroundMusicRequest = z.infer<
  typeof backgroundMusicRequestSchema
>;
export type MusicTrack = {
  id: string;
  audioUrl: string;
  title: string;
  durationSeconds: number;
};
export type MusicPollResult =
  | { status: "pending" }
  | { status: "succeeded"; tracks: MusicTrack[] }
  | { status: "failed"; code: string };
export type MusicRequestOptions = {
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
};
type MusicErrorCode =
  | "invalid_config"
  | "invalid_request"
  | "http"
  | "provider_rejected"
  | "invalid_response"
  | "transport"
  | "timeout"
  | "cancelled"
  | "download_rejected";
export class MusicProviderError extends Error {
  constructor(
    readonly code: MusicErrorCode,
    readonly submissionUncertain = false,
    readonly httpStatus?: number,
    readonly providerCode?: number,
  ) {
    super(
      submissionUncertain
        ? "Music submission outcome is unknown. Reconcile the existing request before generating again."
        : `Music provider operation failed (${code}).`,
    );
    this.name = "MusicProviderError";
  }
}
const taskIdSchema = z
  .string()
  .trim()
  .min(1)
  .max(200)
  .regex(/^[a-zA-Z0-9_-]+$/);
const MAX_JSON_BYTES = 2 * 1024 * 1024;
const record = (value: unknown): Record<string, unknown> | undefined =>
  value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
const numericCode = (value: unknown) =>
  (typeof value === "number" || typeof value === "string") &&
  /^\d{3}$/.test(String(value))
    ? Number(value)
    : undefined;
function scopedSignal(signal: AbortSignal, timeoutMs = 30_000) {
  if (!Number.isFinite(timeoutMs) || timeoutMs < 1 || timeoutMs > 120_000)
    throw new MusicProviderError("invalid_request");
  const controller = new AbortController();
  let timedOut = false;
  const abort = () => controller.abort();
  if (signal.aborted) abort();
  else signal.addEventListener("abort", abort, { once: true });
  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, timeoutMs);
  return {
    signal: controller.signal,
    timedOut: () => timedOut,
    dispose() {
      clearTimeout(timer);
      signal.removeEventListener("abort", abort);
    },
  };
}
function endpoint(config: ProviderConfig, suffix: string) {
  try {
    if (
      config.model !== "V6" ||
      (!config.apiKey?.trim() && !trustedLocalOrigin(config.baseUrl)) ||
      /[\r\n]/.test(config.apiKey)
    )
      throw new Error();
    const base = providerUrl(config.baseUrl, "");
    if (base.pathname !== "/") throw new Error();
    return providerUrl(config.baseUrl, `api/v1/jobs/${suffix}`);
  } catch {
    throw new MusicProviderError("invalid_config");
  }
}
async function bytes(response: Response, signal: AbortSignal, maximum: number) {
  if (Number(response.headers.get("content-length")) > maximum) {
    await response.body?.cancel();
    throw new MusicProviderError("invalid_response");
  }
  const reader = response.body?.getReader();
  if (!reader) throw new MusicProviderError("invalid_response");
  const parts: Uint8Array[] = [];
  let size = 0;
  const abort = () => {
    void reader.cancel().catch(() => undefined);
  };
  signal.addEventListener("abort", abort, { once: true });
  try {
    for (;;) {
      signal.throwIfAborted();
      const next = await reader.read();
      signal.throwIfAborted();
      if (next.done) break;
      size += next.value.byteLength;
      if (size > maximum) {
        await reader.cancel();
        throw new MusicProviderError("invalid_response");
      }
      parts.push(next.value);
    }
    return Buffer.concat(parts);
  } finally {
    signal.removeEventListener("abort", abort);
    reader.releaseLock();
  }
}
/** Exactly one HTTP request. Host persistence owns recovery and polling cadence. */
async function requestJson(
  config: ProviderConfig,
  url: URL,
  body: unknown | undefined,
  signal: AbortSignal,
  options: MusicRequestOptions,
) {
  if (signal.aborted) throw new MusicProviderError("cancelled");
  const bounded = scopedSignal(signal, options.timeoutMs),
    submitting = body !== undefined;
  try {
    const response = await (options.fetchImpl ?? fetch)(url, {
      method: submitting ? "POST" : "GET",
      redirect: "error",
      cache: "no-store",
      signal: bounded.signal,
      headers: {
        ...(config.apiKey?.trim()
          ? { Authorization: `Bearer ${config.apiKey.trim()}` }
          : {}),
        "Content-Type": "application/json",
      },
      ...(submitting ? { body: JSON.stringify(body) } : {}),
    });
    if (!response.ok) {
      await response.body?.cancel().catch(() => undefined);
      const definitelyRejected = [
        400, 401, 402, 403, 404, 422, 429, 451, 455,
      ].includes(response.status);
      throw new MusicProviderError(
        "http",
        submitting && !definitelyRejected,
        response.status,
      );
    }
    const raw = await bytes(response, bounded.signal, MAX_JSON_BYTES);
    let payload: unknown;
    try {
      payload = JSON.parse(raw.toString("utf8"));
    } catch {
      throw new MusicProviderError("invalid_response", submitting);
    }
    const envelope = record(payload),
      code = numericCode(envelope?.code);
    if (code === undefined)
      throw new MusicProviderError("invalid_response", submitting);
    if (code !== 200)
      throw new MusicProviderError(
        "provider_rejected",
        submitting &&
          ![400, 401, 402, 403, 404, 422, 429, 451, 455].includes(code),
        response.status,
        code,
      );
    const data = record(envelope?.data);
    if (!data) throw new MusicProviderError("invalid_response", submitting);
    return data;
  } catch (error) {
    if (error instanceof MusicProviderError) {
      if (
        submitting &&
        error.code === "invalid_response" &&
        !error.submissionUncertain
      )
        throw new MusicProviderError("invalid_response", true);
      throw error;
    }
    throw new MusicProviderError(
      bounded.timedOut()
        ? "timeout"
        : signal.aborted
          ? "cancelled"
          : "transport",
      submitting,
    );
  } finally {
    bounded.dispose();
  }
}
export async function submitBackgroundMusic(
  config: ProviderConfig,
  input: BackgroundMusicRequest,
  signal: AbortSignal,
  options: MusicRequestOptions = {},
): Promise<{ taskId: string }> {
  const checked = backgroundMusicRequestSchema.safeParse(input);
  if (!checked.success) throw new MusicProviderError("invalid_request");
  const url = endpoint(config, "createTask");
  const data = await requestJson(
    config,
    url,
    {
      model: "ai-music-api/generate",
      input: {
        model: "V6",
        custom_mode: true,
        instrumental: true,
        style: checked.data.prompt,
        title: checked.data.title,
        ...(checked.data.durationSeconds !== undefined
          ? { duration: checked.data.durationSeconds }
          : {}),
      },
    },
    signal,
    options,
  );
  const taskId = taskIdSchema.safeParse(data.taskId);
  if (!taskId.success) throw new MusicProviderError("invalid_response", true);
  return { taskId: taskId.data };
}
const pending = new Set([
  "WAITING",
  "QUEUING",
  "QUEUED",
  "PENDING",
  "GENERATING",
  "PROCESSING",
  "IN_PROGRESS",
  "RUNNING",
  "TEXT_SUCCESS",
  "FIRST_SUCCESS",
]);
const succeeded = new Set([
  "SUCCESS",
  "SUCCEEDED",
  "COMPLETE",
  "COMPLETED",
  "DONE",
  "FINISHED",
]);
const failed = new Set([
  "FAIL",
  "FAILED",
  "ERROR",
  "CANCELLED",
  "CANCELED",
  "CREATE_TASK_FAILED",
  "GENERATE_AUDIO_FAILED",
  "CALLBACK_EXCEPTION",
  "SENSITIVE_WORD_ERROR",
]);
const status = (value: unknown) =>
  typeof value === "string" ? value.toUpperCase() : "";
function correlate(
  detail: Record<string, unknown> | undefined,
  taskId: string,
) {
  for (const key of ["taskId", "task_id"])
    if (detail?.[key] !== undefined && detail[key] !== taskId)
      throw new MusicProviderError("invalid_response");
}
function trustedLocalOrigin(value?: string): string | undefined {
  if (!value) return undefined;
  try {
    const base = providerUrl(value, "");
    return base.pathname === "/" &&
      ["localhost", "127.0.0.1", "[::1]"].includes(base.hostname)
      ? base.origin
      : undefined;
  } catch {
    return undefined;
  }
}
function audioUrl(value: unknown, localProviderOrigin?: string): string {
  try {
    if (typeof value !== "string" || value.length > 8192) throw new Error();
    const url = new URL(value);
    const local = url.origin === trustedLocalOrigin(localProviderOrigin);
    if (
      (!local &&
        (url.protocol !== "https:" ||
          isIP(url.hostname.replace(/^\[|\]$/g, "")) ||
          url.hostname.replace(/\.$/, "") === "localhost" ||
          url.hostname.endsWith(".localhost"))) ||
      url.username ||
      url.password ||
      url.hash ||
      (!local && url.port && url.port !== "443")
    )
      throw new Error();
    return url.href;
  } catch {
    throw new MusicProviderError("invalid_response");
  }
}
/** Partial/first-track success never authorizes timeline insertion. */
export async function pollBackgroundMusic(
  config: ProviderConfig,
  taskId: string,
  signal: AbortSignal,
  options: MusicRequestOptions = {},
): Promise<MusicPollResult> {
  if (!taskIdSchema.safeParse(taskId).success)
    throw new MusicProviderError("invalid_request");
  const url = endpoint(config, "recordInfo");
  url.searchParams.set("taskId", taskId);
  const detail = await requestJson(config, url, undefined, signal, options);
  if (detail.taskId === undefined && detail.task_id === undefined)
    throw new MusicProviderError("invalid_response");
  if (detail.model !== undefined && detail.model !== "ai-music-api/generate")
    throw new MusicProviderError("invalid_response");
  correlate(detail, taskId);
  let result = record(detail.response);
  if (
    !result &&
    typeof detail.resultJson === "string" &&
    detail.resultJson.length <= MAX_JSON_BYTES
  ) {
    try {
      result = record(JSON.parse(detail.resultJson));
    } catch {
      /* A pending task may not have a complete result yet. */
    }
  }
  correlate(result, taskId);
  const state = status(detail.state),
    phase = status(detail.status);
  const providerCode =
    numericCode(detail.errorCode ?? detail.failCode ?? detail.fail_code) ??
    numericCode(result?.code);
  if (
    failed.has(state) ||
    failed.has(phase) ||
    (providerCode !== undefined && providerCode !== 200)
  )
    return {
      status: "failed",
      code: providerCode ? `provider_${providerCode}` : "generation_failed",
    };
  const effectiveStatus = state || phase;
  if (!succeeded.has(effectiveStatus)) {
    if (pending.has(effectiveStatus)) return { status: "pending" };
    throw new MusicProviderError("invalid_response");
  }
  if (result?.callbackType === "first" || result?.callbackType === "text")
    return { status: "pending" };
  if (result?.callbackType !== undefined && result.callbackType !== "complete")
    throw new MusicProviderError("invalid_response");
  const rawTracks =
    result?.data ?? result?.sunoData ?? detail.sunoData ?? detail.data;
  if (!Array.isArray(rawTracks) || rawTracks.length < 1 || rawTracks.length > 4)
    throw new MusicProviderError("invalid_response");
  const tracks = rawTracks.map((raw) => {
    const row = record(raw),
      id = taskIdSchema.safeParse(row?.id ?? row?.audioId ?? row?.audio_id);
    const duration = row?.duration,
      title = row?.title;
    if (
      !id.success ||
      typeof duration !== "number" ||
      !Number.isFinite(duration) ||
      duration <= 0 ||
      duration > 720 ||
      (title !== undefined && (typeof title !== "string" || title.length > 160))
    )
      throw new MusicProviderError("invalid_response");
    return {
      id: id.data,
      audioUrl: audioUrl(row?.audioUrl ?? row?.audio_url, config.baseUrl),
      durationSeconds: duration,
      title:
        typeof title === "string" && title.trim()
          ? title.trim()
          : "Generated background music",
    };
  });
  if (new Set(tracks.map((track) => track.id)).size !== tracks.length)
    throw new MusicProviderError("invalid_response");
  return { status: "succeeded", tracks };
}

const mediaHosts = ["kie.ai", "suno.ai", "redpandaai.co", "aiquickdraw.com"];
const blocked = new BlockList();
for (const [network, bits] of [
  ["0.0.0.0", 8],
  ["10.0.0.0", 8],
  ["100.64.0.0", 10],
  ["127.0.0.0", 8],
  ["169.254.0.0", 16],
  ["172.16.0.0", 12],
  ["192.0.0.0", 24],
  ["192.0.2.0", 24],
  ["192.168.0.0", 16],
  ["198.18.0.0", 15],
  ["198.51.100.0", 24],
  ["203.0.113.0", 24],
  ["224.0.0.0", 3],
] as const)
  blocked.addSubnet(network, bits, "ipv4");
function publicAddress(address: string) {
  const family = isIP(address);
  if (family === 4) return !blocked.check(address, "ipv4");
  return (
    family === 6 &&
    /^[23][0-9a-f]{3}:/i.test(address) &&
    !/^(?:2001:(?:db8|0):|2002:)/i.test(address)
  );
}
// Clash-style fake-IP DNS uses the reserved benchmark range. Never connect to
// those addresses: ask a fixed, TLS-verified public resolver for this already
// allowlisted CDN hostname, then retain the public-address/socket-pin checks.
const fakeDns = (address: string) =>
  /^198\.(18|19)\.\d{1,3}\.\d{1,3}$/.test(address) && isIP(address) === 4;
async function publicDnsAddresses(
  hostname: string,
  signal: AbortSignal,
  fetchImpl: typeof fetch,
) {
  const url = new URL("https://1.1.1.1/dns-query");
  url.searchParams.set("name", hostname);
  url.searchParams.set("type", "A");
  const response = await fetchImpl(url, {
    method: "GET",
    headers: { Accept: "application/dns-json" },
    redirect: "error",
    signal,
  });
  if (!response.ok) {
    await response.body?.cancel();
    throw new MusicProviderError("download_rejected");
  }
  let value: unknown;
  try {
    value = JSON.parse(
      (await bytes(response, signal, 16 * 1024)).toString("utf8"),
    );
  } catch {
    throw new MusicProviderError("download_rejected");
  }
  const schema = z.object({
    Status: z.literal(0),
    TC: z.literal(false).optional(),
    Question: z
      .array(z.object({ name: z.string(), type: z.literal(1) }))
      .length(1),
    Answer: z
      .array(z.object({ type: z.number().int(), data: z.string().max(1024) }))
      .min(1)
      .max(64),
  });
  const result = schema.safeParse(value);
  if (
    !result.success ||
    result.data.Question[0].name.replace(/\.$/, "").toLowerCase() !==
      hostname.toLowerCase()
  )
    throw new MusicProviderError("download_rejected");
  const addresses = result.data.Answer.filter(
    (answer) => answer.type === 1,
  ).map((answer) => ({ address: answer.data, family: 4 }));
  if (
    !addresses.length ||
    addresses.some(
      (entry) => isIP(entry.address) !== 4 || !publicAddress(entry.address),
    )
  )
    throw new MusicProviderError("download_rejected");
  return addresses;
}

export type MusicDownloadOptions = {
  /** Trusted host configuration only. It grants exactly one loopback origin. */
  localProviderOrigin?: string;
  timeoutMs?: number;
  maxBytes?: number;
  lookupImpl?: typeof lookup;
  dnsFetchImpl?: typeof fetch;
  requestImpl?: typeof httpsRequest;
};
/** Download bytes once, without the provider key, before a host reports durable media.
 * Allowlisted public DNS is pinned to the socket to prevent DNS rebinding. */
export async function downloadMusicTrack(
  track: MusicTrack,
  signal: AbortSignal,
  options: MusicDownloadOptions = {},
): Promise<Blob> {
  const url = new URL(audioUrl(track.audioUrl, options.localProviderOrigin));
  const local = url.origin === trustedLocalOrigin(options.localProviderOrigin);
  if (
    !local &&
    !mediaHosts.some(
      (host) => url.hostname === host || url.hostname.endsWith(`.${host}`),
    )
  )
    throw new MusicProviderError("download_rejected");
  if (signal.aborted) throw new MusicProviderError("cancelled");
  const maximum = options.maxBytes ?? 32 * 1024 * 1024;
  if (
    !Number.isSafeInteger(maximum) ||
    maximum < 1 ||
    maximum > 64 * 1024 * 1024
  )
    throw new MusicProviderError("invalid_request");
  const bounded = scopedSignal(signal, options.timeoutMs ?? 60_000);
  try {
    let addresses = local
      ? [
          {
            address: url.hostname === "[::1]" ? "::1" : "127.0.0.1",
            family: url.hostname === "[::1]" ? 6 : 4,
          },
        ]
      : await Promise.race([
          (options.lookupImpl ?? lookup)(url.hostname, { all: true }),
          new Promise<never>((_, reject) => {
            bounded.signal.addEventListener(
              "abort",
              () => reject(new Error()),
              {
                once: true,
              },
            );
          }),
        ]);
    bounded.signal.throwIfAborted();
    if (
      !local &&
      addresses.length &&
      addresses.every((entry) => entry.family === 4 && fakeDns(entry.address))
    )
      addresses = await publicDnsAddresses(
        url.hostname,
        bounded.signal,
        options.dnsFetchImpl ?? fetch,
      );
    if (
      !addresses.length ||
      (!local && addresses.some((entry) => !publicAddress(entry.address)))
    )
      throw new MusicProviderError("download_rejected");
    const address =
      addresses.find((entry) => entry.family === 4) ?? addresses[0];
    return await new Promise<Blob>((resolve, reject) => {
      const request = (
        options.requestImpl ??
        (url.protocol === "http:" ? httpRequest : httpsRequest)
      )(
        {
          protocol: url.protocol,
          hostname: address.address,
          family: address.family,
          servername:
            url.protocol === "https:" &&
            !isIP(url.hostname.replace(/^\[|\]$/g, ""))
              ? url.hostname
              : undefined,
          method: "GET",
          port: url.port
            ? Number(url.port)
            : url.protocol === "http:"
              ? 80
              : 443,
          path: url.pathname + url.search,
          headers: { Host: url.host, Accept: "audio/*" },
          signal: bounded.signal,
        },
        (response) => {
          const mime = String(response.headers["content-type"] ?? "")
            .split(";")[0]
            .trim()
            .toLowerCase();
          if (
            response.statusCode !== 200 ||
            ![
              "audio/mpeg",
              "audio/mp3",
              "audio/wav",
              "audio/x-wav",
              "audio/mp4",
              "audio/aac",
              "audio/ogg",
              "audio/flac",
              "application/octet-stream",
            ].includes(mime) ||
            Number(response.headers["content-length"]) > maximum
          ) {
            response.destroy();
            reject(new MusicProviderError("download_rejected"));
            return;
          }
          const chunks: Buffer[] = [];
          let size = 0;
          response.on("data", (chunk: Buffer) => {
            size += chunk.byteLength;
            if (size > maximum) {
              response.destroy();
              reject(new MusicProviderError("download_rejected"));
            } else chunks.push(chunk);
          });
          response.on("end", () =>
            size
              ? resolve(new Blob([Buffer.concat(chunks)], { type: mime }))
              : reject(new MusicProviderError("download_rejected")),
          );
          response.on("error", () =>
            reject(new MusicProviderError("download_rejected")),
          );
        },
      );
      request.on("error", () =>
        reject(new MusicProviderError("download_rejected")),
      );
      request.end();
    });
  } catch (error) {
    if (bounded.timedOut()) throw new MusicProviderError("timeout");
    if (signal.aborted) throw new MusicProviderError("cancelled");
    if (error instanceof MusicProviderError) throw error;
    throw new MusicProviderError("download_rejected");
  } finally {
    bounded.dispose();
  }
}
