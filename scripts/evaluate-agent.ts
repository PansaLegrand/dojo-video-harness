import { evaluationGraderIdentity } from "../evals/agent/grader-identity";
/** Local, provider-independent evaluation runner. --live explicitly permits paid GPT calls. */
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { mkdir, readFile, writeFile, readdir, rename } from "node:fs/promises";
import path from "node:path";
import { scenarios } from "../evals/agent/scenarios";
import { extendedScenarios } from "../evals/agent/extended-scenarios";
import { EvaluationBudget, EvaluationAdmissionError } from "../evals/agent/request-budget";
import { reliabilityScenarios, reliabilityMetrics, assertKieEvaluationEndpoint } from "../evals/agent/reliability";
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
    !["--repeat", "--max-requests", "--case", "--output", "--suite", "--profile", "--max-usd", "--input-usd-per-million", "--output-usd-per-million"].includes(
      args[i],
    ) ||
    !args[i + 1] ||
    args[i + 1].startsWith("--")
  )
    throw new Error(
      "Use --live, --suite baseline|extended|reliability, --repeat N, --max-requests N, --case ID, or --output PATH, --profile local-editor-vN.",
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
const suite = value("--suite", "baseline");
if (!["baseline", "extended", "reliability"].includes(suite!))
  throw new Error("Use --suite baseline, extended or reliability");
const profile = value("--profile", suite === "reliability" ? "local-editor-v14" : "local-editor-v1") as NonNullable<Parameters<typeof runScenario>[1]>["profile"];
if (!/^local-editor-v(?:[1-9]|1[0-4])$/.test(profile!)) throw new Error("Unknown evaluation profile.");
if (live && suite === "reliability" && !args.includes("--max-requests")) throw new Error("Live reliability evaluation requires an explicit --max-requests budget.");
const available = suite === "reliability" ? reliabilityScenarios : suite === "extended" ? extendedScenarios : scenarios;
const cases = selection
  ? available.filter((s) => s.id === selection)
  : available;
if (!cases.length) throw new Error("Unknown scenario ID.");
const config = {
  baseUrl: process.env.LLM_BASE_URL ?? (suite === "reliability" ? "https://api.kie.ai/codex/v1" : "https://api.openai.com/v1"),
  model: process.env.LLM_MODEL ?? "gpt-6-sol",
  apiKey: process.env.LLM_API_KEY ?? "",
};
if (live && !config.apiKey)
  throw new Error("Set LLM_API_KEY before opting into live evaluations.");
const endpoint = live ? providerUrl(config.baseUrl, "responses").href : null;
if (endpoint) {
  if (suite === "reliability") assertKieEvaluationEndpoint(endpoint);
  if (new URL(endpoint).hostname.endsWith("vercel.sh") || new URL(endpoint).hostname.endsWith("vercel.com")) throw new Error("Evaluation must not use Vercel Gateway.");
}
const transport = live ? new GptResponsesModel(config) : null;
if (live && suite === "reliability" && ["--max-usd", "--input-usd-per-million", "--output-usd-per-million"].some(flag => !args.includes(flag)))
  throw new Error("Live reliability requires --max-usd and explicit input/output USD-per-million quote rates.");
const budget = live && suite === "reliability" ? new EvaluationBudget(maxRequests,
  Number(value("--max-usd")), { inputUsdPerMillion: Number(value("--input-usd-per-million")), outputUsdPerMillion: Number(value("--output-usd-per-million")) }) : undefined;
let requests = 0,
  transportFailed = false, budgetExhausted = false;
const model: LanguageModel | undefined = transport
  ? {
      identity: transport.identity,
      async complete(messages, tools, signal, limits) {
        if (suite === "reliability" && !(await unchangedSource())) {
          transportFailed = true;
          throw new EvaluationAdmissionError("Evaluation source changed; commit the candidate before starting a new authorized run.");
        }
        if (transportFailed || requests >= maxRequests)
          throw new EvaluationAdmissionError(
            "Evaluation request budget exhausted; no automatic retry.",
          );
        let admitted;
        try { admitted = budget?.admit(Buffer.byteLength(JSON.stringify({ messages, tools })), Math.min(8192, limits?.maxOutputTokens ?? 8192)); }
        catch (cause) { budgetExhausted = true; throw cause; }
        requests++;
        // The exclusively claimed report is also this run's admission ledger.
        // Persist before dispatch, including a pending reservation if interrupted.
        await report();
        try {
          const reply = await transport.complete(messages, tools, signal, limits);
          if (admitted) {
            budget!.settle(admitted, reply.usage);
            if (admitted.status === "unknown") throw new Error("Uncertain provider usage requires reconciliation; no automatic retry.");
          }
          return reply;
        } catch (error) {
          transportFailed = true;
          if (admitted?.status === "pending") budget!.settle(admitted);
          throw error;
        } finally { await report(); }
      },
    }
  : undefined;
const git = (...params: string[]) =>
  execFileSync("git", params, { encoding: "utf8" }).trim();
const commit = git("rev-parse", "HEAD"),
  dirty = !!git("status", "--porcelain");
const files = [...new Set([
  ...git("ls-files", "-co", "--exclude-standard", "--", "packages/agent-kit/src", "packages/agent/src", "packages/agent-loop/src", "packages/adapters/src", "packages/core/src", "apps/server/src", "skills").split("\n").filter(Boolean),
  "packages/agent-kit/package.json", "package-lock.json", "config/engine-release.json",
  "evals/agent/scenarios.ts",
  "evals/agent/extended-scenarios.ts",
  "evals/agent/grading.ts",
  "evals/agent/oracles.ts",
  "evals/agent/evidence.ts",
  "evals/agent/runner.ts",
  "evals/agent/reliability.ts",
  "evals/agent/request-budget.ts",
  "evals/agent/semantic-defaults.ts",
  "evals/agent/grader-identity.ts",
  "scripts/evaluate-agent.ts",
  "packages/agent/src/loop.ts",
  "packages/agent/src/tools.ts",
  "packages/adapters/src/gpt-responses.ts",
  "packages/adapters/src/gpt-model.ts",
  ...(await readdir("skills")).sort().map((n) => `skills/${n}`),
])].sort();
async function fingerprint() {
  const hash = createHash("sha256");
  for (const file of files) hash.update(file).update(await readFile(file));
  return hash.digest("hex");
}
const sourceFingerprint = await fingerprint();
async function unchangedSource() {
  return git("rev-parse", "HEAD") === commit && !git("status", "--porcelain") && await fingerprint() === sourceFingerprint;
}
const runId = new Date().toISOString().replace(/[:.]/g, "-");
const output = path.resolve(
  value("--output", `test-results/agent-evals/${runId}.json`)!,
);
// Claim a new report before any provider call. Checkpoints may update this run,
// but a later run must never overwrite earlier failure evidence.
await mkdir(path.dirname(output), { recursive: true });
await writeFile(output, "", { flag: "wx", mode: 0o600 });
const trials: Trial[] = [];
const startedAt = new Date().toISOString();
async function report() {
  const grade = gradeSuite(cases, trials, repeats);
  const sourceUnchanged = await unchangedSource();
  const durations = trials.map((t) => t.durationMs).sort((a, b) => a - b);
  const percentile = (p: number) =>
    durations[Math.max(0, Math.ceil(durations.length * p) - 1)] ?? null;
  const result = {
    version: 1,
    suite,
    profile,
    agentKitVersion: JSON.parse(await readFile("packages/agent-kit/package.json", "utf8")).version,
    measuredScope: "Local harness semantic editing and host recovery; excludes browser visuals, commercial billing, ASR and generated media jobs.",
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
    suiteHash: sourceFingerprint,
    fingerprintedFiles: files,
    scenarios: cases.map((s) => s.id),
    repeats,
    requestBudget: live ? maxRequests : 0,
    requests,
    paidAdmissionLedger: budget ? { maximumRequests: budget.maximumRequests, maximumUsd: budget.maximumUsd, rates: budget.rates, costBasis: "Quoted rates times reported usage; conservative reservations; not a verified invoice.", accountedUsd: budget.accountedUsd, requests: budget.requests } : null,
    transportFailed,
    budgetExhausted,
    skippedTrials: cases.length * repeats - trials.length,
    grade,
    grader: await evaluationGraderIdentity(),
    reliability: { ...reliabilityMetrics(trials, cases.length * repeats), providerCostUsd: !live ? 0 : budget && budget.requests.every(request => request.status === "completed") ? budget.accountedUsd : null },
    reliabilityAgentGatePassed: live && suite === "reliability" && profile === "local-editor-v14" && !selection && repeats >= 2 && !dirty && sourceUnchanged && grade.passed,
    // A reference fixture run or a filtered/single-pass live run cannot qualify a milestone.
    milestoneAgentGatePassed:
      live &&
      suite === "baseline" &&
      !selection &&
      repeats >= 3 &&
      !dirty &&
      sourceUnchanged &&
      grade.passed,
    extendedAgentGatePassed:
      live &&
      suite === "extended" &&
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
  await writeFile(output + ".tmp", JSON.stringify(result, null, 2) + "\n", {
    mode: 0o600,
  });
  await rename(output + ".tmp", output);
  return result;
}
await report();
outer: for (let repetition = 1; repetition <= repeats; repetition++)
  for (const scenario of cases) {
    if (live && (transportFailed || budgetExhausted || requests >= maxRequests)) break outer;
    const result = await runScenario(scenario, {
      model,
      profile,
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
    extendedAgentGatePassed: result.extendedAgentGatePassed,
    reliabilityAgentGatePassed: result.reliabilityAgentGatePassed,
  }),
);
if (!result.grade.passed) process.exitCode = 1;
