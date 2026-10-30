/** Explicitly opt-in paid acceptance test. Synthetic project, no user media. */
import assert from "node:assert/strict";
import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { GptResponsesModel } from "../packages/adapters/src/gpt-responses";
import { AgentService } from "../apps/server/src/agent-service";
import { ProjectStore, snapshot } from "../apps/server/src/store";
import type { LanguageModel } from "../packages/agent/src/types";

if (!process.argv.includes("--live"))
  throw new Error(
    "Pass --live to allow up to eight paid GPT requests against a synthetic project.",
  );
const config = {
  baseUrl: process.env.LLM_BASE_URL ?? "https://api.openai.com/v1",
  model: process.env.LLM_MODEL ?? "gpt-6-sol",
  apiKey: process.env.LLM_API_KEY ?? "",
};
if (!config.apiKey) throw new Error("Set LLM_API_KEY before the live test.");
const transport = new GptResponsesModel(config);
let calls = 0,
  inputTokens = 0,
  outputTokens = 0;
const toolNames: string[] = [];
const model: LanguageModel = {
  async complete(messages, tools, signal) {
    assert(
      ++calls <= 8,
      "Live acceptance request budget exhausted; no automatic retry.",
    );
    const reply = await transport.complete(messages, tools, signal);
    inputTokens += reply.usage?.inputTokens ?? 0;
    outputTokens += reply.usage?.outputTokens ?? 0;
    toolNames.push(...reply.calls.map((c) => c.name));
    console.log(
      JSON.stringify({
        call: calls,
        tools: reply.calls.map((c) => c.name),
        usage: reply.usage,
      }),
    );
    return reply;
  },
};
const root = await mkdtemp(path.join(os.tmpdir(), "harness-live-gpt-"));
const store = new ProjectStore(root);
const skills = await Promise.all(
  (await readdir("skills"))
    .filter((n) => n.endsWith(".md"))
    .map(async (name) => {
      const instructions = await readFile(path.join("skills", name), "utf8");
      return {
        name: name.slice(0, -3),
        description:
          instructions.split("\n").find((l) => l && !l.startsWith("#")) ?? name,
        instructions,
      };
    }),
);
const agent = new AgentService(store, model, skills);
async function settle(id: string) {
  const deadline = Date.now() + 190_000;
  while (Date.now() < deadline) {
    const p = await store.read(id);
    const run = p.runs.at(-1)!;
    if (!["queued", "running"].includes(run.status)) {
      assert(
        !["failed", "interrupted"].includes(run.status),
        `Agent run failed: ${run.error ?? run.status}`,
      );
      return { p, run };
    }
    await new Promise((r) => setTimeout(r, 200));
  }
  const p = await store.read(id);
  await agent.cancel(id, p.runs.at(-1)!.id);
  throw new Error("Live acceptance deadline reached.");
}
try {
  await store.init();
  let p = await store.create("GPT acceptance fixture");
  await store.commit(p.id, {
    operationId: "fixture",
    baseRevision: 0,
    baseHash: p.documentHash,
    commands: [
      {
        type: "addItem",
        item: {
          id: "title",
          name: "Opening title",
          trackId: "visual",
          node: {
            id: "title",
            type: "text",
            text: "A synthetic test",
            from: 0,
            duration: 90,
            style: { color: "#ffffff" },
          },
        },
      },
    ],
  });
  p = await store.read(p.id);
  const request = (instruction: string, operationId: string) => ({
    instruction,
    operationId,
    baseRevision: p.revision,
    baseHash: p.documentHash,
    scope: { kind: "selection", itemIds: ["title"] },
    context: { selectedItemIds: ["title"], playheadFrame: 0 },
  });
  await agent.start(
    p.id,
    request(
      "Read the precise-editing skill and inspect the selected title, then propose changing only its text color to #2563eb. Keep its text and timing unchanged.",
      "edit",
    ),
  );
  let settled = await settle(p.id);
  assert.equal(settled.run.status, "awaiting_review");
  assert.equal(
    settled.p.documentHash,
    p.documentHash,
    "Proposal must not apply itself",
  );
  assert(
    toolNames.includes("read_skill") && toolNames.includes("inspect_project"),
    "Expected a real tool-observation continuation",
  );
  const review = await agent.review(p.id, settled.run.id);
  await agent.apply(p.id, settled.run.id, {
    operationId: "apply-test",
    baseRevision: p.revision,
    baseHash: p.documentHash,
    reviewBasis: review.review.basis,
  });
  p = await store.read(p.id);
  assert.equal(p.document.items[0].node.style?.color, "#2563eb");
  assert.equal(p.document.items[0].node.text, "A synthetic test");
  console.log("PASS live inspection/skill/proposal and explicit host approval");

  await agent.start(
    p.id,
    request(
      "Before editing, ask me to choose between Blue (#2563eb) and Green (#16a34a) for the title, using ask_user with those two options. Wait for my answer; do not propose an edit yet.",
      "question",
    ),
  );
  settled = await settle(p.id);
  assert.equal(settled.run.status, "needs_input");
  assert.equal(settled.p.documentHash, p.documentHash);
  const question = settled.run.clarification;
  assert(question);
  const choice = question.options?.find((o) => /green/i.test(o.label));
  assert(choice);
  await agent.answer(p.id, settled.run.id, {
    operationId: "answer-test",
    questionId: question.id,
    optionId: choice.id,
    baseRevision: p.revision,
    baseHash: p.documentHash,
  });
  settled = await settle(p.id);
  assert.equal(settled.run.status, "awaiting_review");
  assert.equal(
    settled.p.documentHash,
    p.documentHash,
    "Answered question must still await approval",
  );
  const answerReview = await agent.review(p.id, settled.run.id);
  await agent.apply(p.id, settled.run.id, {
    operationId: "apply-answer-test",
    baseRevision: p.revision,
    baseHash: p.documentHash,
    reviewBasis: answerReview.review.basis,
  });
  const final = snapshot(await store.read(p.id));
  assert.equal(final.document.items[0].node.style?.color, "#16a34a");
  assert.equal(final.document.items[0].node.text, "A synthetic test");
  console.log(
    "PASS live question, linked answer, and second explicit approval",
  );
  console.log(
    JSON.stringify({
      model: config.model,
      endpoint: new URL(config.baseUrl).origin,
      calls,
      inputTokens,
      outputTokens,
      toolNames,
      result: "passed",
    }),
  );
} finally {
  await rm(root, { recursive: true, force: true });
}
