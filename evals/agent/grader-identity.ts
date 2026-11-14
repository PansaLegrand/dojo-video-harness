import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { EVALUATION_GRADER_VERSION } from "./semantic-defaults";
export async function evaluationGraderIdentity() {
  const files = ["evals/agent/grading.ts", "evals/agent/oracles.ts", "evals/agent/reliability.ts", "evals/agent/semantic-defaults.ts"];
  const hash = createHash("sha256");
  for (const file of files) hash.update(file).update(await readFile(file));
  return { version: EVALUATION_GRADER_VERSION, files, sha256: hash.digest("hex") };
}
