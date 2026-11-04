/** One bounded diagnostic; no paid retries and no fixed expected IDs in model input. */
import assert from "node:assert/strict";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import path from "node:path";
import { runCorrectionSession } from "../evals/agent/correction-session";
import { GptResponsesModel } from "../packages/adapters/src/gpt-responses";
const args = process.argv.slice(2);
assert(args.every((arg) => arg === "--live"));
const live = args.includes("--live");
const key = process.env.LLM_API_KEY ?? "";
if (live) assert(key, "Supply LLM_API_KEY privately");
const commit = execFileSync("git", ["rev-parse", "HEAD"], {
  encoding: "utf8",
}).trim();
const dirty = !!execFileSync("git", ["status", "--porcelain"], {
  encoding: "utf8",
}).trim();
if (live) assert(!dirty, "Commit the frozen diagnostic before live requests");
const fingerprint = async () => {
  const hash = createHash("sha256");
  for (const file of execFileSync("git", ["ls-files", "-z"], {
    encoding: "utf8",
  })
    .split("\0")
    .filter(Boolean)
    .sort()) {
    hash.update(file);
    hash.update(await readFile(file));
  }
  return hash.digest("hex");
};
const sourceHash = await fingerprint();
const output = path.resolve(
  "test-results/corrections",
  `${new Date().toISOString().replace(/:/g, "-")}-${randomUUID().slice(0, 8)}`,
);
await mkdir(output, { recursive: true });
const endpoint = "https://ai-gateway.vercel.sh/v1",
  model = "openai/gpt-6-sol";
const provider = new GptResponsesModel({
  baseUrl: endpoint,
  model,
  apiKey: key,
});
let requests = 0,
  turnRequests = 0,
  inputBytes = 0,
  inputTokens = 0,
  outputTokens = 0,
  stopped = false;
const sessions: Awaited<ReturnType<typeof runCorrectionSession>>[] = [];
const report = () => ({
  commit,
  sourceHash,
  dirty,
  mode: live ? "live-gateway" : "reference",
  endpoint: live ? endpoint : null,
  model: live ? model : null,
  budget: {
    maxRequests: 32,
    maxRequestsPerTurn: 4,
    maxInputBytes: 3_000_000,
    maxOutputTokens: 65_536,
    noAutomaticRetries: true,
    currencyCeiling: null,
  },
  requests,
  inputTokens,
  outputTokens,
  inputBytes,
  sessions,
  structuralPassed:
    sessions.length === 2 && sessions.every((session) => session.passed),
  renderAcceptance: "separate render-evidence.json required",
  humanAcceptance: "pending",
  scope:
    "Two four-turn applied-edit conversations; no selection or explicit run reference; host reopened each turn. No pending-proposal or long-history qualification.",
});
const save = async () =>
  writeFile(
    path.join(output, "report.json"),
    JSON.stringify(report(), null, 2).replaceAll(
      key || "__no_secret__",
      "[redacted]",
    ),
  );
await save();
for (const distractor of [false, true]) {
  assert.equal(
    await fingerprint(),
    sourceHash,
    "Candidate changed during evaluation",
  );
  const result = await runCorrectionSession({
    distractor,
    output,
    model: live
      ? {
          complete: async (messages, tools, signal) => {
            if (stopped) throw new Error("Diagnostic stopped; no paid retry");
            if (messages.length === 2) turnRequests = 0;
            const bytes = Buffer.byteLength(
              JSON.stringify({ messages, tools }),
            );
            if (
              requests >= 32 ||
              turnRequests >= 4 ||
              inputBytes + bytes > 3_000_000 ||
              outputTokens + 8192 > 65_536
            ) {
              stopped = true;
              throw new Error("Declared diagnostic budget exhausted");
            }
            requests++;
            turnRequests++;
            inputBytes += bytes;
            await save();
            try {
              const reply = await provider.complete(messages, tools, signal);
              if (!reply.usage) throw new Error("Provider usage missing; stop");
              inputTokens += reply.usage.inputTokens;
              outputTokens += reply.usage.outputTokens;
              await save();
              return reply;
            } catch (error) {
              stopped = true;
              throw error;
            }
          },
        }
      : undefined,
  });
  sessions.push(result);
  await save();
  console.log(
    JSON.stringify({
      scenario: result.scenario,
      passed: result.passed,
      turns: result.turns.map(({ calls, ...turn }) => turn),
    }),
  );
  if (stopped) break;
}
assert.equal(
  await fingerprint(),
  sourceHash,
  "Candidate changed during evaluation",
);
console.log(
  JSON.stringify({
    output,
    structuralPassed: report().structuralPassed,
    requests,
    inputTokens,
    outputTokens,
  }),
);
if (!report().structuralPassed) process.exitCode = 1;
