import { it, expect } from "vitest";
import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { redactEvidence } from "../evals/agent/evidence";
import { runScenario } from "../evals/agent/runner";
import { scenarios } from "../evals/agent/scenarios";

it("removes credentials, private reasoning and signed URL query values", () => {
  const raw = {
    apiKey: "secret-value",
    providerOutput: [{ encrypted_content: "opaque-private" }],
    text: "Bearer token123 secret-value https://user:password@example.com/file?signature=hidden#private",
  };
  const result = JSON.stringify(redactEvidence(raw, ["secret-value"]));
  for (const secret of [
    "secret-value",
    "opaque-private",
    "token123",
    "signature",
    "password",
  ])
    expect(result).not.toContain(secret);
  expect(result).toContain("https://example.com/file");
});
it("retains a sanitized failed snapshot before cleanup and marks missing usage unknown", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "dojo-evidence-"));
  try {
    const result = await runScenario(scenarios[0], {
      evidenceDir: root,
      redactValues: ["known-secret"],
      model: {
        async complete() {
          return {
            text: "known-secret",
            calls: [],
            providerOutput: [
              { type: "reasoning", encrypted_content: "hidden-reasoning" },
            ],
          };
        },
      },
    });
    expect(result.passed).toBe(false);
    expect(result.inputTokens).toBeNull();
    expect(result.usageUnavailableCalls).toBe(1);
    expect(result.evidence).toBeDefined();
    const text = await readFile(result.evidence!.path, "utf8");
    expect(text).not.toContain("known-secret");
    expect(text).not.toContain("hidden-reasoning");
    const evidence = JSON.parse(text);
    expect(
      evidence.events.some(
        (e: { kind: string }) => e.kind === "project.failed",
      ),
    ).toBe(true);
    if (process.platform !== "win32")
      expect((await stat(result.evidence!.path)).mode & 0o777).toBe(0o600);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
it("redacts echoed secrets from transport failures in the public report", async () => {
  const result = await runScenario(scenarios[0], {
    redactValues: ["not-for-report"],
    model: {
      async complete() {
        throw new Error("Provider echoed not-for-report");
      },
    },
  });
  expect(result.passed).toBe(false);
  expect(result.error).not.toContain("not-for-report");
  expect(result.inputTokens).toBeNull();
});

it("redacts a credential echoed in a model-selected tool name", async () => {
  let calls = 0;
  const result = await runScenario(scenarios[0], {
    redactValues: ["credential-in-tool-name"],
    model: {
      async complete() {
        calls++;
        return calls === 1
          ? {
              text: "",
              calls: [
                { id: "one", name: "credential-in-tool-name", arguments: "{}" },
              ],
            }
          : { text: "No edit", calls: [] };
      },
    },
  });
  expect(result.passed).toBe(false);
  expect(JSON.stringify(result)).not.toContain("credential-in-tool-name");
});
