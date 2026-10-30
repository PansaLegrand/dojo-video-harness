import { it, expect, afterEach } from "vitest";
import { mkdtemp, readFile, writeFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createServer } from "node:net";
import { once } from "node:events";
import {
  assertNode,
  ensureEnv,
  checkPort,
  portValue,
  openInvocation,
} from "../scripts/lib/local-launch.mjs";
const roots: string[] = [];
afterEach(async () => {
  await Promise.all(
    roots.splice(0).map((p) => rm(p, { recursive: true, force: true })),
  );
});
it("creates first-run configuration without overwriting existing keys", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "harness-setup-"));
  roots.push(root);
  await writeFile(path.join(root, ".env.example"), "LLM_API_KEY=\nPORT=4310\n");
  expect(await ensureEnv(root)).toBe(true);
  await writeFile(path.join(root, ".env"), "LLM_API_KEY=keep-me\n");
  expect(await ensureEnv(root)).toBe(false);
  expect(await readFile(path.join(root, ".env"), "utf8")).toBe(
    "LLM_API_KEY=keep-me\n",
  );
});
it("rejects unsupported Node versions and unusable ports", () => {
  expect(() => assertNode("18.20.0")).toThrow();
  expect(() => assertNode("20.18.0")).toThrow();
  expect(() => assertNode("22.14.0")).not.toThrow();
  expect(portValue("4400")).toBe(4400);
  for (const value of ["bad", "0", "65536"])
    expect(() => portValue(value)).toThrow();
});
it("detects a port conflict and supplies platform-specific browser open commands", async () => {
  const server = createServer();
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const port = (server.address() as { port: number }).port;
  try {
    await expect(checkPort(port)).rejects.toMatchObject({ code: "EADDRINUSE" });
  } finally {
    await new Promise<void>((r) => server.close(() => r()));
  }
  await expect(checkPort(port)).resolves.toBeUndefined();
  const url = `http://127.0.0.1:${port}`;
  expect(openInvocation(url, "win32")).toEqual({
    command: "rundll32.exe",
    args: ["url.dll,FileProtocolHandler", url],
  });
  expect(openInvocation(url, "darwin").args).toEqual([url]);
});
