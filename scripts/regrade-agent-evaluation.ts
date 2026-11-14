/** Regrade immutable saved candidates only. No provider, store, Apply or network adapter. */
import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { gradeEdit } from "../evals/agent/grading";
import { assertIndependentOutcome } from "../evals/agent/oracles";
import { reliabilityScenarios } from "../evals/agent/reliability";
import { evaluationGraderIdentity } from "../evals/agent/grader-identity";
const args = process.argv.slice(2);
if (args.length !== 2 || args[0] === args[1]) throw new Error("Usage: regrade-agent-evaluation.ts ORIGINAL_REPORT NEW_REPORT");
const originalPath = path.resolve(args[0]), outputPath = path.resolve(args[1]);
if (originalPath === outputPath) throw new Error("The original report must remain unchanged.");
const digest = (value: Buffer | string) => createHash("sha256").update(value).digest("hex");
const originalBytes = await readFile(originalPath), original = JSON.parse(originalBytes.toString());
if (original.suite !== "reliability" || !Array.isArray(original.trials)) throw new Error("Expected a reliability report.");
const outcomes = [];
for (const trial of original.trials) {
  const scenario = reliabilityScenarios.find(scenario => scenario.id === trial.scenarioId);
  if (!scenario || !trial.evidence?.path || !trial.evidence.sha256) throw new Error("Missing registered case or original evidence.");
  const bytes = await readFile(trial.evidence.path);
  if (digest(bytes) !== trial.evidence.sha256) throw new Error("Original evidence checksum changed.");
  const evidence = JSON.parse(bytes.toString()), before = new Map();
  let comparisons = 0, appliedChecks = 0, error: string | undefined;
  try {
    if (evidence.omitted) throw new Error("Original evidence is incomplete.");
    for (const event of evidence.events) {
      const payload = event.payload;
      if (event.kind === "project.before") before.set(payload.turnIndex, payload.document);
      if (!["comparison", "project.applied"].includes(event.kind)) continue;
      const basis = before.get(payload.turnIndex), turn = scenario.turns[payload.turnIndex];
      if (!basis || !turn) throw new Error("Missing turn basis.");
      const document = event.kind === "comparison" ? payload.comparison.afterDocument : payload.document;
      gradeEdit(basis, document, turn.reference);
      if (scenario.assertOutcome) scenario.assertOutcome(basis, document, payload.turnIndex);
      else assertIndependentOutcome(basis, document, scenario.id, payload.turnIndex);
      if (event.kind === "comparison") comparisons++; else appliedChecks++;
    }
    const expected = scenario.turns.filter(turn => turn.expected !== "advice").length;
    if (comparisons !== expected) throw new Error("Not every requested edit has a saved candidate to regrade.");
    if (!trial.passed && trial.failureCategory !== "outcome") throw new Error("Original failure is not an outcome-grading failure; semantic regrading cannot clear it.");
  } catch (cause) { error = cause instanceof Error ? cause.message : "Regrade failed"; }
  outcomes.push({ scenarioId: trial.scenarioId, repetition: trial.repetition, originalPassed: trial.passed, originalError: trial.error ?? null, evidenceSha256: trial.evidence.sha256, semanticPassed: !error, comparisons, appliedChecks, applyNotRerun: true, ...(error ? { error } : {}) });
}
const result = {
  version: 1, mode: "saved-evidence-semantic-regrade", createdAt: new Date().toISOString(),
  original: { path: originalPath, sha256: digest(originalBytes), commit: original.commit, suiteHash: original.suiteHash, graderVersion: original.grader?.version ?? 1, grade: original.grade },
  grader: await evaluationGraderIdentity(), providerRequests: 0, projectWrites: 0, workflowRerun: false,
  originalWorkflowPassed: original.trials.filter((trial: { passed: boolean }) => trial.passed).length,
  semanticPassed: outcomes.filter(outcome => outcome.semanticPassed).length,
  executed: outcomes.length, expected: original.grade.expected,
  scope: "Saved candidate semantics only. Original failed trials were not newly applied, replayed or rerun; their original workflow outcomes remain intact.",
  outcomes,
};
await writeFile(outputPath, JSON.stringify(result, null, 2) + "\n", { flag: "wx", mode: 0o600 });
console.log(JSON.stringify({ outputPath, originalWorkflowPassed: result.originalWorkflowPassed, semanticPassed: result.semanticPassed, executed: result.executed, providerRequests: 0, projectWrites: 0 }));
if (outcomes.some(outcome => !outcome.semanticPassed)) process.exitCode = 1;
