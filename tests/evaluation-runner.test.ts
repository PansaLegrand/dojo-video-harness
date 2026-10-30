import { it, expect } from "vitest";
import { createServer } from "node:http";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

it("defaults to zero provider calls and cannot pass a budget-exhausted live-mode run", async () => {
  let requests = 0;
  const server = createServer(async (req, res) => {
    requests++;
    for await (const _ of req) {
      /* consume the synthetic request */
    }
    res.setHeader("Content-Type", "application/json");
    res.end(
      JSON.stringify({
        status: "completed",
        output: [
          {
            type: "function_call",
            call_id: `call-${requests}`,
            name: "propose_edit",
            arguments: JSON.stringify({
              outcome: "proposal",
              summary: "Blue title",
              commands: [
                {
                  type: "set",
                  target: { kind: "node", itemId: "title", nodeId: "title" },
                  path: ["style", "color"],
                  value: "#2563eb",
                },
              ],
            }),
          },
        ],
      }),
    );
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const port = (server.address() as { port: number }).port;
  const root = await mkdtemp(path.join(os.tmpdir(), "harness-eval-cli-"));
  async function run(name: string, args: string[]) {
    const output = path.join(root, name + ".json");
    const code = await new Promise<number>((resolve, reject) => {
      const child = spawn(
        process.execPath,
        [
          "--import",
          "tsx",
          "scripts/evaluate-agent.ts",
          "--case",
          "title-color",
          "--output",
          output,
          ...args,
        ],
        {
          stdio: "ignore",
          env: {
            ...process.env,
            LLM_BASE_URL: `http://127.0.0.1:${port}/v1`,
            LLM_MODEL: "gpt-test",
            LLM_API_KEY: "synthetic-secret-never-log",
          },
        },
      );
      child.once("error", reject);
      child.once("exit", (code) => resolve(code ?? 1));
    });
    const text = await readFile(output, "utf8");
    expect(text).not.toContain("synthetic-secret-never-log");
    return { code, report: JSON.parse(text) };
  }
  try {
    const reference = await run("reference", []);
    expect(reference.code).toBe(0);
    expect(requests).toBe(0);
    expect(reference.report).toMatchObject({
      mode: "reference-fixture",
      requests: 0,
      milestoneAgentGatePassed: false,
    });
    const capped = await run("capped", [
      "--live",
      "--repeat",
      "3",
      "--max-requests",
      "2",
    ]);
    expect(capped.code).toBe(1);
    expect(requests).toBe(2);
    expect(capped.report).toMatchObject({
      requests: 2,
      skippedTrials: 1,
      grade: { complete: false, passed: false },
      milestoneAgentGatePassed: false,
    });
    expect(capped.report.trials).toHaveLength(2);
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await rm(root, { recursive: true, force: true });
  }
});
