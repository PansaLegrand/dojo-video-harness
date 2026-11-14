import { describe, expect, it, vi } from "vitest";
import { reliabilityScenarios, reliabilityFixture, reliabilityMetrics, assertKieEvaluationEndpoint } from "../evals/agent/reliability";
import { EvaluationBudget, EvaluationAdmissionError } from "../evals/agent/request-budget";
import { runScenario } from "../evals/agent/runner";
import { scenarios } from "../evals/agent/scenarios";
import type { Trial } from "../evals/agent/grading";

describe("latest-profile reliability fixtures, not live model acceptance", () => {
  it.each(reliabilityScenarios)("$id passes current staged host, guarded Apply and duplicate replay", async scenario => {
    const result = await runScenario(scenario, { profile: "local-editor-v14" });
    expect(result, result.error).toMatchObject({ passed: true, profile: "local-editor-v14", noProposal: false, rejectedObservations: 0 });
    expect(result.firstRequest!.toolsBytes).toBeGreaterThan(0);
  });
  it("preserves model identity and forwards the original per-call allowance", async () => {
    const complete = vi.fn(async (_messages, _tools, _signal, limits) => {
      expect(limits.maxOutputTokens).toBeGreaterThan(0);
      expect(limits.maxReplyBytes).toBeGreaterThan(0);
      return { text: "No transcript is available.", calls: [], usage: { inputTokens: 25, outputTokens: 8 } };
    });
    const result = await runScenario(scenarios.find(s => s.id === "missing-transcript")!, { profile: "local-editor-v14", model: { identity: "evaluation:test", complete } });
    expect(result.passed, result.error).toBe(true);
    expect(result.firstRequest?.inputTokens).toBe(25);
  });
  it("counts an observed host validation rejection followed by a successful bounded correction", async () => {
    let call = 0;
    const scenario = reliabilityScenarios.find(s => s.id === "title-color")!;
    const result = await runScenario(scenario, { profile: "local-editor-v14", model: {
      identity: "synthetic-reliability-correction",
      async complete(messages) {
        call++;
        const context = JSON.parse(String(messages.find(message => message.role === "user")!.content)).durableStages;
        const passed = messages.some(message => message.role === "tool" && JSON.parse(String(message.content)).completionPreflight?.status === "passed");
        const edit = { outcome: "proposal", summary: "Requested blue title", commands: scenario.turns[0].reference };
        const name = !context ? "plan_edit_stages" : passed ? "propose_edit" : "review_edit";
        const args = !context ? { requirements: call === 1 ? [] : [{ id: "retain-source", kind: "item_present", itemId: "clip" }], captionPairs: [] } : passed ? edit : { edit };
        return { text: "", calls: [{ id: `correction-${call}`, name, arguments: JSON.stringify(args) }], usage: { inputTokens: 100, outputTokens: 30 } };
      },
    } });
    expect(result, result.error).toMatchObject({ passed: true, calls: 4, rejectedObservations: 1, noProposal: false });
    expect(reliabilityMetrics([result], 1)).toMatchObject({ firstPass: 0, recovered: 1 });
  });
  it("does not label a denied pre-dispatch budget check as unknown paid usage", async () => {
    const result = await runScenario(reliabilityScenarios[0], { profile: "local-editor-v14", model: {
      identity: "synthetic-budget-denial",
      async complete() { throw new EvaluationAdmissionError("Evaluation request budget exhausted; no automatic retry."); },
    } });
    expect(result).toMatchObject({ passed: false, failureCategory: "budget", calls: 1, notDispatchedCalls: 1, usageUnavailableCalls: 0, inputTokens: 0, outputTokens: 0 });
    expect(reliabilityMetrics([result], 32).modelCallsNotDispatched).toBe(1);
  });
  it("independent graders reject changed facts, shifted source origins and unrelated image edits", () => {
    const before = reliabilityFixture(), after = structuredClone(before);
    after.items.find(item => item.id === "english")!.node.style!.color = "#ff0000";
    after.items.find(item => item.id === "chinese")!.node.style!.color = "#ffffff";
    const grade = reliabilityScenarios.find(s => s.id === "existing-bilingual-styling")!.assertOutcome!;
    expect(() => grade(before, after, 0)).not.toThrow();
    for (const mutate of [
      (doc: typeof before) => { doc.items.find(item => item.id === "english")!.node.text = "Revenue grew 21% year over year."; },
      (doc: typeof before) => { doc.items.find(item => item.id === "interview")!.node.videoStartTime = 0; },
      (doc: typeof before) => { doc.items.find(item => item.id === "photo")!.node.from = 0; },
    ]) {
      const changed = structuredClone(after); mutate(changed);
      expect(() => grade(before, changed, 0)).toThrow(/Independent/);
    }
  });
  it("records recovered successes separately and never treats missing trials as coverage", () => {
    const base: Trial = { scenarioId: "a", repetition: 1, passed: true, calls: 3, inputTokens: null, outputTokens: null, durationMs: 1, tools: [] };
    expect(reliabilityMetrics([base, { ...base, repetition: 2, rejectedObservations: 1 }, { ...base, scenarioId: "b", passed: false, noProposal: true }, { ...base, scenarioId: "c", passed: false, invariantFailure: true }], 32)).toMatchObject({ expected: 32, executed: 4, firstPass: 1, recovered: 1, noProposal: 1, unsafeOutcomes: 1, providerCostUsd: null, coverage: 0.125 });
  });
});

describe("Kie destination and paid admission boundaries", () => {
  it("rejects gateway, deceptive hosts, redirects, credentials and alternate APIs before dispatch", () => {
    expect(assertKieEvaluationEndpoint("https://api.kie.ai/codex/v1/responses")).toBe("https://api.kie.ai/codex/v1/responses");
    for (const url of ["https://ai-gateway.vercel.sh/v1/responses", "https://api.kie.ai.attacker.test/codex/v1/responses", "https://api.kie.ai/codex/v1/responses?redirect=https://example.com", "https://secret@api.kie.ai/codex/v1/responses", "http://api.kie.ai/codex/v1/responses", "https://api.kie.ai/api/v1/jobs/createTask"]) expect(() => assertKieEvaluationEndpoint(url)).toThrow();
  });
  it("reserves before dispatch, accounts known usage, and leaves unknown charges reserved without retry", () => {
    const budget = new EvaluationBudget(2, 1, { inputUsdPerMillion: 0.6, outputUsdPerMillion: 3 });
    const first = budget.admit(100_000, 8192);
    expect(first).toMatchObject({ ordinal: 1, status: "pending", actualUsd: null });
    expect(() => budget.admit(1, 1)).toThrow(/reconciliation/);
    budget.settle(first, { inputTokens: 100, outputTokens: 20 });
    expect(budget.accountedUsd).toBeCloseTo(0.00012);
    const second = budget.admit(100_000, 8192); budget.settle(second);
    expect(second.status).toBe("unknown");
    expect(budget.accountedUsd).toBeGreaterThan(0.08);
    expect(() => budget.admit(1, 1)).toThrow(/reconciliation/);
    expect(() => budget.settle(first)).toThrow(/already settled/);
  });
  it("rejects unaffordable dispatch and preserves a provider overrun instead of clamping it", () => {
    const budget = new EvaluationBudget(2, 0.1, { inputUsdPerMillion: 0.6, outputUsdPerMillion: 3 });
    expect(() => budget.admit(1_000_000, 8192)).toThrow(/budget exhausted/);
    expect(budget.requests).toHaveLength(0);
    const first = budget.admit(100, 100); budget.settle(first, { inputTokens: 1_000_000, outputTokens: 1_000_000 });
    expect(budget.accountedUsd).toBe(3.6);
    expect(() => budget.admit(1, 1)).toThrow(/budget exhausted/);
  });
});

it("persists a paid reservation before the existing transport and never exceeds the shared CLI call cap", async () => {
  const { mkdtemp, writeFile, readFile, rm } = await import("node:fs/promises");
  const { spawn } = await import("node:child_process");
  const { tmpdir } = await import("node:os");
  const { join } = await import("node:path");
  const directory = await mkdtemp(join(tmpdir(), "reliability-admission-"));
  const output = join(directory, "report.json"), preload = join(directory, "transport.mjs");
  await writeFile(preload, `import { readFile } from "node:fs/promises";
    import childProcess from "node:child_process";
    import { syncBuiltinESMExports } from "node:module";
    const realExecFileSync = childProcess.execFileSync;
    childProcess.execFileSync = (file, args, options) => file === "git" && args[0] === "status" ? "" : realExecFileSync(file, args, options);
    syncBuiltinESMExports();
    globalThis.fetch = async (url, init) => {
      if (String(url) !== "https://api.kie.ai/codex/v1/responses" || init.redirect !== "error") throw new Error("Wrong destination");
      const report = JSON.parse(await readFile(process.env.EVAL_REPORT, "utf8"));
      const current = report.paidAdmissionLedger.requests.at(-1);
      if (current.status !== "pending" || current.ordinal !== report.requests) throw new Error("Fetch preceded durable admission");
      return new Response(JSON.stringify({ status:"completed", output:[{type:"message",role:"assistant",content:[{type:"output_text",text:"Please import the missing logo file."}]}], usage:{input_tokens:10,output_tokens:20} }), {headers:{"Content-Type":"application/json"}});
    };`);
  try {
    const code = await new Promise<number>((resolve, reject) => {
      const child = spawn(process.execPath, ["--import", preload, "--import", "tsx", "scripts/evaluate-agent.ts", "--suite", "reliability", "--case", "missing-media-no-fabrication", "--live", "--repeat", "3", "--max-requests", "2", "--max-usd", "5", "--input-usd-per-million", "0.6", "--output-usd-per-million", "3", "--output", output], {
        stdio: "ignore", env: { ...process.env, LLM_BASE_URL: "https://api.kie.ai/codex/v1", LLM_MODEL: "gpt-test", LLM_API_KEY: "synthetic-private-key", EVAL_REPORT: output },
      });
      child.once("error", reject); child.once("exit", code => resolve(code ?? 1));
    });
    const encoded = await readFile(output, "utf8"), report = JSON.parse(encoded);
    expect(code).toBe(1);
    expect(encoded).not.toContain("synthetic-private-key");
    expect(report).toMatchObject({ profile: "local-editor-v14", requests: 2, skippedTrials: 1, grade: { complete: false, passed: false }, reliabilityAgentGatePassed: false });
    expect(report.paidAdmissionLedger.requests).toHaveLength(2);
    expect(report.paidAdmissionLedger.requests.every((request: { status: string }) => request.status === "completed")).toBe(true);
    expect(report.reliability.providerCostUsd).toBeCloseTo(0.000132);
  } finally { await rm(directory, { recursive: true, force: true }); }
}, 30_000);
