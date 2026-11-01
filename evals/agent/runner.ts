import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { AgentService } from "../../apps/server/src/agent-service";
import {
  ProjectStore,
  commitDocument,
  type StoredRun,
} from "../../apps/server/src/store";
import type {
  LanguageModel,
  ModelReply,
  ChatMessage,
} from "../../packages/agent/src/types";
import { fixture, setNode, type Scenario, type Turn } from "./scenarios";
import { gradeEdit, InvariantError, type Trial } from "./grading";
import { assertIndependentOutcome } from "./oracles";
function invariant(value: unknown, message: string): asserts value {
  if (!value) throw new InvariantError(message);
}
function referenceReply(turn: Turn, answered: boolean): ModelReply {
  const question = turn.expected === "question" && !answered;
  if (turn.expected === "advice")
    return {
      text: "This requires a capability, evidence, or permission that is not currently available. No edit was made.",
      calls: [],
    };
  return {
    text: "",
    calls: [
      {
        id: randomUUID(),
        name: question ? "ask_user" : "propose_edit",
        arguments: JSON.stringify(
          question
            ? {
                id: "color",
                question: "Blue or green?",
                options: [
                  { id: "blue", label: "Blue (#2563eb)" },
                  { id: "green", label: "Green (#16a34a)" },
                ],
                allowText: true,
              }
            : {
                outcome: "proposal",
                summary: "Requested edit",
                commands: turn.reference,
              },
        ),
      },
    ],
  };
}
export async function runScenario(
  scenario: Scenario,
  options: {
    model?: LanguageModel;
    repetition?: number;
    onMessages?: (messages: ChatMessage[], turnIndex: number) => void;
  } = {},
): Promise<Trial> {
  const root = await mkdtemp(path.join(os.tmpdir(), "harness-agent-eval-"));
  let store = new ProjectStore(root);
  let turnIndex = 0,
    answered = false,
    calls = 0,
    inputTokens = 0,
    outputTokens = 0;
  const tools: string[] = [];
  const started = Date.now();
  const model: LanguageModel = {
    async complete(messages, specs, signal) {
      calls++;
      options.onMessages?.(messages, turnIndex);
      const reply = options.model
        ? await options.model.complete(messages, specs, signal)
        : referenceReply(scenario.turns[turnIndex], answered);
      inputTokens += reply.usage?.inputTokens ?? 0;
      outputTokens += reply.usage?.outputTokens ?? 0;
      tools.push(...reply.calls.map((c) => c.name));
      return reply;
    },
  };
  const skills = await Promise.all(
    (await readdir("skills"))
      .filter((n) => n.endsWith(".md"))
      .map(async (name) => {
        const instructions = await readFile(path.join("skills", name), "utf8");
        return {
          name: name.slice(0, -3),
          description:
            instructions.split("\n").find((l) => l && !l.startsWith("#")) ??
            name,
          instructions,
        };
      }),
  );
  let agent = new AgentService(store, model, skills);
  let projectId: string | undefined;
  let activeRun: string | undefined;
  async function restart() {
    store = new ProjectStore(root);
    await store.init();
    await store.recoverInterrupted();
    agent = new AgentService(store, model, skills);
  }
  async function settle(id: string): Promise<StoredRun> {
    const deadline = Date.now() + 185_000;
    while (Date.now() < deadline) {
      const p = await store.read(projectId!);
      const run = p.runs.find((r) => r.id === id)!;
      if (!["queued", "running"].includes(run.status)) {
        assert.notEqual(
          run.status,
          "failed",
          run.error?.message ?? "Agent failed",
        );
        return run;
      }
      await new Promise((r) => setTimeout(r, options.model ? 100 : 5));
    }
    throw new Error("Agent scenario deadline exceeded.");
  }
  const runIds: string[] = [];
  let beforeLast: ReturnType<typeof fixture> | undefined;
  try {
    await store.init();
    const seed = await store.create("Agent milestone fixture");
    projectId = seed.id;
    await store.transaction(projectId, (p) =>
      commitDocument(p, fixture(scenario.fixture), false),
    );
    for (turnIndex = 0; turnIndex < scenario.turns.length; turnIndex++) {
      const turn = scenario.turns[turnIndex];
      answered = false;
      const before = await store.read(projectId);
      beforeLast = before.document;
      const input = {
        operationId: `turn-${turnIndex}`,
        instruction: turn.prompt,
        baseHash: before.documentHash,
        baseRevision: before.revision,
        scope: turn.selected.length
          ? { kind: "selection", itemIds: turn.selected }
          : { kind: "project" },
        context: { selectedItemIds: turn.selected, playheadFrame: 0 },
        ...(turn.referenceTurn !== undefined
          ? { referenceRunId: runIds[turn.referenceTurn] }
          : {}),
      };
      const start = await agent.start(projectId, input);
      activeRun = start.run.id;
      const duplicate = await agent.start(projectId, input);
      invariant(
        duplicate.run.id === activeRun,
        "Duplicate submission created a second run.",
      );
      let run = await settle(activeRun);
      invariant(
        (await store.read(projectId)).documentHash === before.documentHash,
        "Agent mutated the document before approval.",
      );
      if (turn.restart) {
        const priorCalls = calls;
        await restart();
        invariant(calls === priorCalls, "Restart resubmitted provider work.");
      }
      if (turn.expected === "question") {
        assert.equal(
          run.status,
          "needs_input",
          "Expected a pending question before editing.",
        );
        assert(run.clarification, "Missing structured question.");
        const q = run.clarification;
        const choice = q.options?.find((o) => /green/i.test(o.label));
        const reply = {
          operationId: `answer-${turnIndex}`,
          questionId: q.id,
          baseRevision: before.revision,
          baseHash: before.documentHash,
          ...(q.allowText !== false
            ? { text: turn.answer! }
            : { optionId: choice?.id }),
        };
        answered = true;
        const child = await agent.answer(projectId, activeRun, reply);
        const replay = await agent.answer(projectId, activeRun, reply);
        invariant(
          child.run.id === replay.run.id,
          "Answer replay created another continuation.",
        );
        invariant(
          child.run.clarificationParentRunId === activeRun,
          "Answer lost its parent question.",
        );
        activeRun = child.run.id;
        run = await settle(activeRun);
        invariant(
          (await store.read(projectId)).documentHash === before.documentHash,
          "Answer applied an edit without review.",
        );
      }
      runIds.push(activeRun);
      if (turn.expected === "advice") {
        assert(
          ["completed", "needs_input"].includes(run.status),
          "Unsupported request must give advice or ask, without proposing an edit.",
        );
        invariant(
          run.proposal === null,
          "Unsupported request produced an edit proposal.",
        );
        assertIndependentOutcome(
          before.document,
          (await store.read(projectId)).document,
          scenario.id,
          turnIndex,
        );
        continue;
      }
      assert.equal(
        run.status,
        "awaiting_review",
        "Expected an actionable edit proposal.",
      );
      const comparison = await agent.review(projectId, activeRun);
      assertIndependentOutcome(
        before.document,
        comparison.afterDocument,
        scenario.id,
        turnIndex,
      );
      gradeEdit(before.document, comparison.afterDocument, turn.reference);
      const approval = {
        operationId: `approve-${turnIndex}`,
        baseRevision: before.revision,
        baseHash: before.documentHash,
        reviewBasis: comparison.review.basis,
      };
      const first = await agent.apply(projectId, activeRun, approval);
      const priorCalls = calls;
      const replay = await agent.apply(projectId, activeRun, approval);
      invariant(
        first.revision === replay.revision && calls === priorCalls,
        "Approval replay repeated an edit or provider work.",
      );
      const saved = await new ProjectStore(root).read(projectId);
      assertIndependentOutcome(
        before.document,
        saved.document,
        scenario.id,
        turnIndex,
      );
      gradeEdit(before.document, saved.document, turn.reference);
    }
    if (scenario.manualThenUndo) {
      const p = await store.read(projectId);
      await store.commit(projectId, {
        operationId: "manual-wording",
        baseRevision: p.revision,
        baseHash: p.documentHash,
        commands: [setNode("title", ["text"], "Manual wording retained")],
      });
      const changed = await store.read(projectId),
        priorCalls = calls;
      const input = {
        operationId: "undo-last",
        baseRevision: changed.revision,
        baseHash: changed.documentHash,
      };
      const undone = await agent.undo(projectId, runIds.at(-1)!, input);
      const replay = await agent.undo(projectId, runIds.at(-1)!, input);
      invariant(
        undone.revision === replay.revision && calls === priorCalls,
        "Undo replay repeated work.",
      );
      gradeEdit(beforeLast!, (await store.read(projectId)).document, [
        setNode("title", ["text"], "Manual wording retained"),
      ]);
      assertIndependentOutcome(
        beforeLast!,
        (await store.read(projectId)).document,
        "manual-wording-after-undo",
      );
    }
    return {
      scenarioId: scenario.id,
      repetition: options.repetition ?? 1,
      passed: true,
      calls,
      inputTokens,
      outputTokens,
      durationMs: Date.now() - started,
      tools,
    };
  } catch (error) {
    return {
      scenarioId: scenario.id,
      repetition: options.repetition ?? 1,
      passed: false,
      invariantFailure: error instanceof InvariantError,
      error:
        error instanceof Error
          ? error.message.slice(0, 500)
          : "Scenario failed",
      calls,
      inputTokens,
      outputTokens,
      durationMs: Date.now() - started,
      tools,
    };
  } finally {
    if (projectId && activeRun) {
      const p = await store.read(projectId).catch(() => null);
      if (
        p?.runs.some(
          (r) => r.id === activeRun && ["running", "queued"].includes(r.status),
        )
      )
        await agent.cancel(projectId, activeRun).catch(() => {});
    }
    await rm(root, { recursive: true, force: true });
  }
}
