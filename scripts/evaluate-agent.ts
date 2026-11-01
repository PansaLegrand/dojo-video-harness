/** Local, provider-independent evaluation runner. --live explicitly permits paid GPT calls. */
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { mkdir, readFile, writeFile, readdir, rename } from "node:fs/promises";
import path from "node:path";
import { scenarios } from "../evals/agent/scenarios";
import { runScenario } from "../evals/agent/runner";
import { gradeSuite, type Trial } from "../evals/agent/grading";
import { GptResponsesModel } from "../packages/adapters/src/gpt-responses";
import { providerUrl } from "../packages/adapters/src/provider-http";
import type { LanguageModel } from "../packages/agent/src/types";
const args = process.argv.slice(2);
const value = (flag: string, fallback?: string) =>
  args.includes(flag) ? args[args.indexOf(flag) + 1] : fallback;
for (let i = 0; i < args.length; i++) {
  if (args[i] === "--live") continue;
  if (
    !["--repeat", "--max-requests", "--case", "--output"].includes(args[i]) ||
    !args[i + 1] ||
    args[i + 1].startsWith("--")
  )
    throw new Error(
      "Use --live, --repeat N, --max-requests N, --case ID, or --output PATH.",
    );
  i++;
}
const repeats = Number(value("--repeat", "1")),
  maxRequests = Number(value("--max-requests", "80"));
if (
  !Number.isInteger(repeats) ||
  repeats < 1 ||
  repeats > 10 ||
  !Number.isInteger(maxRequests) ||
  maxRequests < 1 ||
  maxRequests > 1000
)
  throw new Error("repeat must be 1–10 and max-requests 1–1000.");
const live = args.includes("--live"),
  selection = value("--case");
const cases = selection
  ? scenarios.filter((s) => s.id === selection)
  : scenarios;
if (!cases.length) throw new Error("Unknown scenario ID.");
const config = {
  baseUrl: process.env.LLM_BASE_URL ?? "https://api.openai.com/v1",
  model: process.env.LLM_MODEL ?? "gpt-6-sol",
  apiKey: process.env.LLM_API_KEY ?? "",
};
if (live && !config.apiKey)
  throw new Error("Set LLM_API_KEY before opting into live evaluations.");
const endpoint = live ? providerUrl(config.baseUrl, "responses").href : null;
const transport = live ? new GptResponsesModel(config) : null;
let requests = 0,
  transportFailed = false;
const model: LanguageModel | undefined = transport
  ? {
      async complete(messages, tools, signal) {
        if (requests >= maxRequests)
          throw new Error(
            "Evaluation request budget exhausted; no automatic retry.",
          );
        requests++;
        try {
          return await transport.complete(messages, tools, signal);
        } catch (error) {
          transportFailed = true;
          throw error;
        }
      },
    }
  : undefined;
const git = (...params: string[]) =>
  execFileSync("git", params, { encoding: "utf8" }).trim();
const commit = git("rev-parse", "HEAD"),
  dirty = !!git("status", "--porcelain");
const files = [
  "evals/agent/scenarios.ts",
  "evals/agent/grading.ts",
  "evals/agent/oracles.ts",
  "evals/agent/evidence.ts",
  "evals/agent/runner.ts",
  "scripts/evaluate-agent.ts",
  "packages/agent/src/loop.ts",
  "packages/agent/src/tools.ts",
  "packages/adapters/src/gpt-responses.ts",
  ...(await readdir("skills")).sort().map((n) => `skills/${n}`),
];
const hash = createHash("sha256");
for (const file of files) hash.update(file).update(await readFile(file));
const runId = new Date().toISOString().replace(/[:.]/g, "-");
const output = path.resolve(
  value("--output", `test-results/agent-evals/${runId}.json`)!,
);
const trials: Trial[] = [];
const startedAt = new Date().toISOString();
async function report() {
  const grade = gradeSuite(cases, trials, repeats);
  const sourceUnchanged =
    git("rev-parse", "HEAD") === commit && !git("status", "--porcelain");
  const durations = trials.map((t) => t.durationMs).sort((a, b) => a - b);
  const percentile = (p: number) =>
    durations[Math.max(0, Math.ceil(durations.length * p) - 1)] ?? null;
  const result = {
    version: 1,
    runId,
    startedAt,
    updatedAt: new Date().toISOString(),
    commit,
    dirty,
    sourceUnchanged,
    node: process.version,
    mode: live ? "live" : "reference-fixture",
    model: live ? config.model : null,
    endpoint,
    suiteHash: hash.copy().digest("hex"),
    scenarios: cases.map((s) => s.id),
    repeats,
    requestBudget: live ? maxRequests : 0,
    requests,
    transportFailed,
    skippedTrials: cases.length * repeats - trials.length,
    grade,
    // A reference fixture run or a filtered/single-pass live run cannot qualify a milestone.
    milestoneAgentGatePassed:
      live &&
      !selection &&
      repeats >= 3 &&
      !dirty &&
      sourceUnchanged &&
      grade.passed,
    inputTokens: trials.some((t) => t.inputTokens === null)
      ? null
      : trials.reduce((n, t) => n + (t.inputTokens ?? 0), 0),
    outputTokens: trials.some((t) => t.outputTokens === null)
      ? null
      : trials.reduce((n, t) => n + (t.outputTokens ?? 0), 0),
    usageUnavailableCalls: trials.reduce(
      (n, t) => n + (t.usageUnavailableCalls ?? 0),
      0,
    ),
    engineVersion: JSON.parse(
      await readFile("config/engine-release.json", "utf8"),
    ).engineVersion,
    lockfileHash: createHash("sha256")
      .update(await readFile("package-lock.json"))
      .digest("hex"),
    scenarioLatencyMs: { p50: percentile(0.5), p95: percentile(0.95) },
    trials,
  };
  await mkdir(path.dirname(output), { recursive: true });
  await writeFile(output + ".tmp", JSON.stringify(result, null, 2) + "\n");
  await rename(output + ".tmp", output);
  return result;
}
await report();
outer: for (let repetition = 1; repetition <= repeats; repetition++)
  for (const scenario of cases) {
    if (live && (transportFailed || requests >= maxRequests)) break outer;
    const result = await runScenario(scenario, {
      model,
      repetition,
      evidenceDir: output + ".evidence",
      redactValues: [config.apiKey],
    });
    trials.push(result);
    console.log(
      `${result.passed ? "PASS" : "FAIL"} ${scenario.id} (${repetition}/${repeats})${result.error ? `: ${result.error}` : ""}`,
    );
    await report();
  }
const result = await report();
console.log(
  JSON.stringify({
    report: output,
    mode: result.mode,
    grade: result.grade,
    milestoneAgentGatePassed: result.milestoneAgentGatePassed,
  }),
);
if (!result.grade.passed) process.exitCode = 1;
