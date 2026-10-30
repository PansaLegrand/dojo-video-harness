/** A launch-candidate check, never a deployment command. Live requests require --live. */
import { spawn, execFileSync } from "node:child_process";
import { mkdir, readFile, writeFile, rename } from "node:fs/promises";
import path from "node:path";
const args = process.argv.slice(2);
if (args.some((a) => !["--live"].includes(a)))
  throw new Error(
    "Use --live for the full paid GPT milestone evaluation, or no flags for local checks.",
  );
const live = args.includes("--live");
if (live && !process.env.LLM_API_KEY)
  throw new Error(
    "Set LLM_API_KEY before --live. This permits up to 240 GPT requests.",
  );
const git = (...params) =>
  execFileSync("git", params, { encoding: "utf8" }).trim();
const commit = git("rev-parse", "HEAD"),
  dirty = !!git("status", "--porcelain");
if (live && dirty)
  throw new Error(
    "Commit the candidate before a paid milestone run. Use eval:agent -- --live for development trials.",
  );
const root = path.resolve(
  "test-results/milestones",
  new Date().toISOString().replace(/[:.]/g, "-"),
);
await mkdir(root, { recursive: true });
const reportPath = path.join(root, "report.json");
const report = {
  version: 1,
  commit,
  dirty,
  node: process.version,
  liveRequested: live,
  phases: [],
  automatedGatePassed: false,
  manualReviewRequired: true,
};
const save = async () => {
  await writeFile(reportPath + ".tmp", JSON.stringify(report, null, 2) + "\n");
  await rename(reportPath + ".tmp", reportPath);
};
await save();
async function run(name, command, params, env = {}) {
  const start = Date.now();
  const code = await new Promise((resolve) => {
    const child = spawn(command, params, {
      stdio: "inherit",
      env: { ...process.env, ...env },
    });
    child.once("error", () => resolve(1));
    child.once("exit", (code) => resolve(code ?? 1));
  });
  report.phases.push({
    name,
    passed: code === 0,
    durationMs: Date.now() - start,
  });
  await save();
  if (code !== 0)
    throw new Error(`${name} failed. Remaining phases were not run.`);
}
try {
  await run("typecheck-tests-build", "npm", ["run", "check"]);
  await run(
    "browser-workflows-export",
    process.execPath,
    ["scripts/browser-smoke.mjs"],
    { BROWSER_TEST_OUTPUT_DIR: path.join(root, "browser") },
  );
  report.browserArtifacts = "browser";
  const evaluation = path.join(root, "agent-evaluation.json");
  await run(
    live ? "live-gpt-evaluation" : "reference-fixture-validation",
    process.execPath,
    [
      "--import",
      "tsx",
      "scripts/evaluate-agent.ts",
      "--output",
      evaluation,
      ...(live ? ["--live", "--repeat", "3", "--max-requests", "240"] : []),
    ],
  );
  const result = JSON.parse(await readFile(evaluation, "utf8"));
  report.sourceUnchanged =
    git("rev-parse", "HEAD") === commit && !git("status", "--porcelain");
  report.automatedGatePassed =
    live &&
    report.sourceUnchanged &&
    !dirty &&
    result.commit === commit &&
    result.milestoneAgentGatePassed === true;
  report.agentReport = path.relative(root, evaluation);
  report.status = report.automatedGatePassed
    ? "automated-pass-manual-review-required"
    : live
      ? "not-qualified"
      : "local-pass-live-not-run";
  if (live && !report.automatedGatePassed) process.exitCode = 1;
} catch (error) {
  report.status = "failed";
  report.error = error.message;
  process.exitCode = 1;
} finally {
  await save();
  console.log(
    JSON.stringify({
      report: reportPath,
      status: report.status,
      automatedGatePassed: report.automatedGatePassed,
    }),
  );
}
