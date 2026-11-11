import { describe, it, expect, vi } from "vitest";
import { Readable } from "node:stream";
import type { IncomingMessage, ServerResponse } from "node:http";
import { HttpError } from "../apps/server/src/store";
const state = vi.hoisted(() => ({
  handler: null as
    | null
    | ((req: IncomingMessage, res: ServerResponse) => Promise<void>),
}));
vi.mock("../apps/server/src/local-api", () => ({
  getLocalApi: async () => state.handler,
}));
import { handleLocalRequest } from "../apps/server/src/next-route";
describe("Next API boundary", () => {
  it("preserves request bytes and JSON envelopes", async () => {
    state.handler = async (req, res) => {
      const chunks = [];
      for await (const chunk of req) chunks.push(chunk);
      res.writeHead(201, { "Content-Type": "application/json" });
      res.end(
        JSON.stringify({
          success: true,
          data: Buffer.concat(chunks).toString(),
        }),
      );
    };
    const r = await handleLocalRequest(
      new Request("http://localhost:4310/api/test", {
        method: "POST",
        body: '{"unicode":"你好"}',
      }),
    );
    expect(r.status).toBe(201);
    expect(await r.json()).toEqual({
      success: true,
      data: '{"unicode":"你好"}',
    });
  });
  it("streams media with the original status and range headers", async () => {
    state.handler = async (_req, res) => {
      res.writeHead(206, {
        "Content-Type": "video/mp4",
        "Content-Length": "4",
        "Content-Range": "bytes 0-3/10",
      });
      Readable.from([Buffer.from([0, 1]), Buffer.from([2, 3])]).pipe(res);
    };
    const r = await handleLocalRequest(
      new Request("http://localhost:4310/api/media"),
    );
    expect(r.status).toBe(206);
    expect(r.headers.get("content-range")).toBe("bytes 0-3/10");
    expect([...new Uint8Array(await r.arrayBuffer())]).toEqual([0, 1, 2, 3]);
  });
  it("maps service errors without exposing a Next HTML error page", async () => {
    state.handler = async () => {
      throw new HttpError("Not found", 404, "NOT_FOUND");
    };
    const r = await handleLocalRequest(
      new Request("http://localhost:4310/api/missing"),
    );
    expect(r.status).toBe(404);
    expect(await r.json()).toMatchObject({
      success: false,
      error: "Not found",
      code: "NOT_FOUND",
    });
  });
  it("exposes pending browser input codes to the shared receipt client", async () => {
    state.handler = async () => {
      throw new HttpError("Receipt pending", 409, "BROWSER_INPUT_PENDING");
    };
    const response = await handleLocalRequest(
      new Request("http://localhost:4310/api/receipt"),
    );
    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({
      code: "BROWSER_INPUT_PENDING",
      error_code: "BROWSER_INPUT_PENDING",
    });
  });
});
