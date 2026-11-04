/** Frozen four-case gate; no paid retries. Credentials are supplied only in process memory. */
import { mkdir, readFile, writeFile, mkdtemp, rm } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import path from "node:path";
import os from "node:os";
import assert from "node:assert/strict";
import { AgentService } from "../apps/server/src/agent-service";
import {
  ProjectStore,
  commitDocument,
  snapshot,
} from "../apps/server/src/store";
import { loadLocalSkills } from "../apps/server/src/skill-loader";
import { GptResponsesModel } from "../packages/adapters/src/gpt-responses";
import {
  lowerThirdCases,
  lowerThirdFixture,
  gradeLowerThird,
} from "../evals/agent/lower-third";
import { prepareReadableOverlay } from "../packages/core/src/lib/video-project/readable-overlay";

const args = process.argv.slice(2);
assert(args.every((arg) => arg === "--live"));
const live = args.includes("--live"),
  key = process.env.LLM_API_KEY ?? "";
const endpoint = "https://ai-gateway.vercel.sh/v1",
  modelId = "openai/gpt-6-sol";
if (live) assert(key, "Supply LLM_API_KEY privately");
const commit = execFileSync("git", ["rev-parse", "HEAD"], {
  encoding: "utf8",
}).trim();
const dirty = !!execFileSync("git", ["status", "--porcelain"], {
  encoding: "utf8",
}).trim();
if (live)
  assert(!dirty, "Commit the frozen candidate before paid qualification");
const sourceHash = async () => {
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
const initialHash = await sourceHash();
const output = path.resolve(
  "test-results/lower-thirds",
  `${new Date().toISOString().replace(/:/g, "-")}-${randomUUID().slice(0, 8)}`,
);
await mkdir(output, { recursive: true });
const directory = await mkdtemp(
    path.join(os.tmpdir(), "dojo-lower-third-gate-"),
  ),
  store = new ProjectStore(directory);
await store.init();
const skills = await loadLocalSkills("skills"),
  provider = new GptResponsesModel({
    baseUrl: endpoint,
    model: modelId,
    apiKey: key,
  });
const maxRequests = Number(process.env.LOWER_THIRD_REQUEST_BUDGET ?? 72);
assert(Number.isInteger(maxRequests) && maxRequests > 0 && maxRequests <= 72);
let requests = 0,
  inputBytes = 0,
  inputTokens = 0,
  outputTokens = 0,
  fatal = false;
const trials: Array<Record<string, unknown>> = [];
const report = () => ({
  commit,
  sourceHash: initialHash,
  dirty,
  mode: live ? "live-gateway" : "reference",
  model: live ? modelId : null,
  endpoint: live ? endpoint : null,
  budget: {
    maxRequests,
    maxRequestsPerTrial: 6,
    maxSerializedInputBytes: 6_000_000,
    maxReportedOutputTokens: 98_304,
    deadlineMs: 180_000,
    currencyCeiling: null,
    noAutomaticRetries: true,
  },
  requests,
  inputBytes,
  inputTokens,
  outputTokens,
  plannedTrials: 12,
  trials,
  semanticPassed: trials.length === 12 && trials.every((trial) => trial.passed),
  humanAcceptance: "pending",
  renderAcceptance: "separate render-evidence.json required",
});
await writeFile(
  path.join(output, "report.json"),
  JSON.stringify(report(), null, 2),
  { flag: "wx" },
);
try {
  outer: for (const test of lowerThirdCases)
    for (let repetition = 1; repetition <= 3; repetition++) {
      assert.equal(
        await sourceHash(),
        initialHash,
        "Candidate changed during evaluation",
      );
      const project = await store.create(test.id),
        document = lowerThirdFixture(test);
      await store.transaction(project.id, (p) =>
        commitDocument(p, document, false),
      );
      const before = await store.read(project.id),
        calls: Array<unknown> = [],
        usage: Array<unknown> = [];
      let trialRequests = 0;
      const agent = new AgentService(
        store,
        {
          complete: async (messages, tools, signal) => {
            if (!live) {
              const response = test.clarification
                ? {
                    name: "ask_user",
                    arguments: JSON.stringify({
                      id: "clarify",
                      question:
                        test.id === "ambiguous"
                          ? "Which interview take should get the lower-third?"
                          : "May I shorten the long subtitle?",
                      options: [
                        { id: "a", label: "First option" },
                        { id: "b", label: "Second option" },
                      ],
                      allowText: true,
                    }),
                  }
                : {
                    name: "propose_edit",
                    arguments: JSON.stringify({
                      summary: "Lower-third",
                      commands: [
                        prepareReadableOverlay(document, {
                          itemId: "lower",
                          trackId: "visual",
                          kind: "lowerThird",
                          text: test.text[0],
                          subtitle: test.text[1],
                          from: 0,
                          duration: 150,
                        }),
                      ],
                    }),
                  };
              return { text: "", calls: [{ id: randomUUID(), ...response }] };
            }
            const bytes = Buffer.byteLength(
              JSON.stringify({ messages, tools }),
            );
            if (
              trialRequests >= 6 ||
              requests >= maxRequests ||
              inputBytes + bytes > 6_000_000 ||
              outputTokens + 8192 > 98_304
            ) {
              fatal = true;
              throw new Error("Declared evaluation budget exhausted");
            }
            trialRequests++;
            requests++;
            inputBytes += bytes;
            try {
              const result = await provider.complete(messages, tools, signal);
              if (!result.usage) {
                fatal = true;
                throw new Error(
                  "Provider usage missing; stop rather than assume zero",
                );
              }
              inputTokens += result.usage.inputTokens;
              outputTokens += result.usage.outputTokens;
              usage.push(result.usage);
              calls.push(
                ...result.calls.map((call) => ({
                  name: call.name,
                  arguments: call.arguments,
                })),
              );
              return result;
            } catch (error) {
              fatal = true;
              throw error;
            }
          },
        },
        skills,
      );
      const trial: Record<string, unknown> = {
        case: test.id,
        repetition,
        prompt: test.prompt,
        passed: false,
      };
      try {
        const started = await agent.start(project.id, {
          operationId: randomUUID(),
          instruction: test.prompt,
          baseRevision: before.revision,
          baseHash: before.documentHash,
          scope: { kind: "project" },
          context: { selectedItemIds: [], playheadFrame: 0 },
        });
        const deadline = Date.now() + 180_000;
        let current = await store.read(project.id);
        while (
          current.runs.some((run) =>
            ["queued", "running"].includes(run.status),
          ) &&
          Date.now() < deadline
        ) {
          await new Promise((resolve) => setTimeout(resolve, 100));
          current = await store.read(project.id);
        }
        const run = current.runs.find((run) => run.id === started.run.id)!;
        if (["queued", "running"].includes(run.status)) {
          await agent.cancel(project.id, run.id);
          fatal = true;
          throw new Error(
            "Trial deadline exceeded; cancelled and stopped the gate",
          );
        }
        assert.equal(
          current.documentHash,
          before.documentHash,
          "No pre-approval mutation",
        );
        await writeFile(
          path.join(output, `${test.id}-${repetition}-run.json`),
          JSON.stringify(
            {
              before: before.document,
              run: {
                status: run.status,
                summary: run.summary,
                error: run.error,
                clarification: run.clarification,
                proposal: run.proposal,
              },
              calls,
              usage,
            },
            null,
            2,
          ),
        );
        if (run.status === "needs_input") {
          assert(
            test.clarification,
            "Expected a concrete proposal with sufficient context",
          );
          assert(run.clarification?.question, "Expected a durable question");
          const question = run.clarification.question;
          assert(
            test.id === "ambiguous"
              ? /which|take|clip/i.test(question)
              : /short|fit|word|text|copy|split|line/i.test(question),
            "Question must address the actual ambiguity or excess copy",
          );
          trial.outcome = "clarification";
          trial.question = question;
        } else {
          assert.equal(
            run.status,
            "awaiting_review",
            run.error ?? "No reviewable proposal",
          );
          const review = await agent.review(project.id, run.id);
          const graded = gradeLowerThird(
            test,
            before.document,
            review.afterDocument,
          );
          const now = snapshot(await store.read(project.id));
          await agent.apply(project.id, run.id, {
            operationId: randomUUID(),
            baseRevision: now.revision,
            baseHash: now.documentHash,
            reviewBasis: review.review.basis,
          });
          const applied = await store.read(project.id);
          assert.deepEqual(applied.document, review.afterDocument);
          const reopened = new ProjectStore(directory);
          await reopened.init();
          assert.equal(
            (await reopened.read(project.id)).documentHash,
            applied.documentHash,
          );
          await writeFile(
            path.join(output, `${test.id}-${repetition}-scene.json`),
            JSON.stringify(graded.scene, null, 2),
          );
          trial.outcome = "applied";
          trial.geometry = graded.geometries;
          trial.documentHash = applied.documentHash;
        }
        trial.passed = true;
      } catch (error) {
        trial.error = (error instanceof Error ? error.message : String(error))
          .replaceAll(key || "__no_secret__", "[redacted]")
          .slice(0, 1500);
      }
      trial.requests = trialRequests;
      trial.calls = calls;
      trial.usage = usage;
      trials.push(trial);
      assert.equal(
        await sourceHash(),
        initialHash,
        "Candidate changed during evaluation",
      );
      await writeFile(
        path.join(output, "report.json"),
        JSON.stringify(report(), null, 2),
      );
      console.log(
        JSON.stringify({
          case: test.id,
          repetition,
          passed: trial.passed,
          outcome: trial.outcome,
          error: trial.error,
          requests: trialRequests,
        }),
      );
      if (fatal) break outer;
    }
} finally {
  await rm(directory, { recursive: true, force: true });
}
console.log(
  JSON.stringify({
    output,
    passed: report().semanticPassed,
    trials: trials.length,
    requests,
    inputTokens,
    outputTokens,
  }),
);
if (!report().semanticPassed) process.exitCode = 1;
