import { afterEach, expect, it, vi } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { ProjectStore, publicRun } from "../apps/server/src/store";
import { AgentService } from "../apps/server/src/agent-service";
import { builtInSkills } from "../packages/agent-kit/src/index";
import type { LanguageModel } from "../packages/agent/src/types";
const roots: string[] = [];
afterEach(async () => {
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  );
});
it("retains the exact same-funded reply acknowledgement when the next question arrives before its HTTP acknowledgement", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "clarification-op-ack-"));
  roots.push(root);
  const store = new ProjectStore(root);
  await store.init();
  const project = await store.create();
  let calls = 0;
  const model: LanguageModel = {
    identity: "synthetic-ack:model",
    complete: async () => {
      calls++;
      const args = JSON.stringify({
          id: "question-" + calls,
          question: "Choose option for question " + calls,
          options: [
            { id: "keep", label: "Keep" },
            { id: "change", label: "Change" },
          ],
          allowText: true,
        }),
        callId = "question-call-" + calls;
      return {
        text: "",
        calls: [{ id: callId, name: "ask_user", arguments: args }],
        usage: { inputTokens: 40, outputTokens: 40 },
        providerOutput: [
          {
            type: "function_call",
            call_id: callId,
            name: "ask_user",
            arguments: args,
            status: "completed",
          },
        ],
      };
    },
  };
  const agent = new AgentService(
    store,
    model,
    builtInSkills(),
    undefined,
    "review",
    undefined,
    "local-editor-v6",
  );
  const started = await agent.start(project.id, {
    operationId: "initial",
    instruction: "Ask which editing option I want before changing the project",
    baseRevision: 0,
    baseHash: project.documentHash,
    context: { selectedItemIds: [], playheadFrame: 0 },
    scope: { kind: "project" },
  });
  await vi.waitFor(async () => {
    const run = (await store.read(project.id)).runs[0];
    expect(run.status).toBe("needs_input");
    expect(run.clarification?.id).toBe("question-1");
  });
  const first = (await store.read(project.id)).runs[0],
    answer = {
      operationId: "accepted-first-answer",
      questionId: first.clarification!.id,
      baseRevision: 0,
      baseHash: project.documentHash,
      optionId: "keep",
    };
  // Treat the returned HTTP result as lost; recovery observes only saved state.
  await agent.answer(project.id, started.run.id, answer);
  await vi.waitFor(async () => {
    const run = (await store.read(project.id)).runs[0];
    expect(run.status).toBe("needs_input");
    expect(run.clarification?.id).toBe("question-2");
  });
  const reloaded = await new ProjectStore(root).read(project.id),
    visible = publicRun(reloaded.runs[0]);
  expect(reloaded.runs).toHaveLength(1);
  expect(visible.id).toBe(started.run.id);
  expect(visible.clarificationReply).toMatchObject({
    remaining: 1,
    answerOperationId: answer.operationId,
  });
  expect(visible.clarification?.id).toBe("question-2");
  expect(calls).toBe(2);
  expect(reloaded.revision).toBe(0);
  await agent.answer(project.id, started.run.id, answer);
  expect(calls).toBe(2);
  expect(
    publicRun((await store.read(project.id)).runs[0]).clarificationReply
      ?.answerOperationId,
  ).toBe(answer.operationId);
}, 15000);
