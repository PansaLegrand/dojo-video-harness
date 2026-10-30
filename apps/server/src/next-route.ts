import { Readable, PassThrough } from "node:stream";
import type { IncomingMessage, ServerResponse } from "node:http";
import { z } from "zod/v3";
import { HttpError } from "./store";
import { getLocalApi } from "./local-api";
/** Adapt Web Request/Response at the host boundary. The API retains streamed media
 * and its established request envelopes; Next owns routing, assets and rendering. */
export async function handleLocalRequest(request: Request): Promise<Response> {
  const api = await getLocalApi();
  const incoming = request.body
    ? Readable.fromWeb(
        request.body as import("node:stream/web").ReadableStream<Uint8Array>,
      )
    : Readable.from([]);
  const headers = Object.fromEntries(request.headers.entries());
  const req = Object.assign(incoming, {
    headers,
    method: request.method,
    url: new URL(request.url).pathname + new URL(request.url).search,
  }) as unknown as IncomingMessage;
  request.signal.addEventListener("abort", () => incoming.destroy(), {
    once: true,
  });
  return new Promise((resolve) => {
    const stream = new PassThrough(),
      headers = new Headers();
    let status = 200,
      sent = false;
    function begin() {
      if (sent) return;
      sent = true;
      resolve(
        new Response(Readable.toWeb(stream) as ReadableStream<Uint8Array>, {
          status,
          headers,
        }),
      );
    }
    const response = Object.assign(stream, {
      setHeader(name: string, value: string | number) {
        headers.set(name, String(value));
        return response;
      },
      writeHead(code: number, values: Record<string, string | number> = {}) {
        status = code;
        for (const [name, value] of Object.entries(values))
          headers.set(name, String(value));
        begin();
        return response;
      },
    });
    Object.defineProperty(response, "headersSent", { get: () => sent });
    const res = response as unknown as ServerResponse;
    void api(req, res).catch((cause) => {
      if (sent) {
        stream.destroy(cause instanceof Error ? cause : undefined);
        return;
      }
      status =
        cause instanceof HttpError
          ? cause.status
          : cause instanceof z.ZodError || cause instanceof SyntaxError
            ? 400
            : 500;
      const message =
        cause instanceof z.ZodError
          ? "Invalid request: " +
            cause.issues
              .map((i) => i.path.join(".") + " " + i.message)
              .join("; ")
          : cause instanceof Error
            ? cause.message
            : "Request failed";
      headers.set("Content-Type", "application/json");
      headers.set("Cache-Control", "no-store");
      begin();
      stream.end(
        JSON.stringify({
          success: false,
          error: message,
          message,
          code: cause instanceof HttpError ? cause.code : "REQUEST_FAILED",
        }),
      );
    });
  });
}
