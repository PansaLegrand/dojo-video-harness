import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { AgentService } from "../../apps/server/src/agent-service";
import { ProjectStore, commitDocument } from "../../apps/server/src/store";
import { loadLocalSkills } from "../../apps/server/src/skill-loader";
import type {
  LanguageModel,
  ChatMessage,
} from "../../packages/agent/src/types";
import {
  correctionFixture,
  correctionPrompts,
  gradeCorrection,
  referenceCorrection,
  correctionScene,
  type CorrectionTarget,
} from "./corrections";

export async function runCorrectionSession(options: {
  distractor: boolean;
  model?: LanguageModel;
  output?: string;
  onMessages?: (messages: ChatMessage[], turn: number) => void;
}) {
  const root = await mkdtemp(path.join(os.tmpdir(), "dojo-corrections-"));
  let store = new ProjectStore(root),
    target: CorrectionTarget | undefined;
  const turns: Array<{
    turn: number;
    prompt: string;
    passed: boolean;
    error?: string;
    calls: unknown[];
  }> = [];
  const scenario = options.distractor ? "with-other-text" : "single-text";
  try {
    await store.init();
    const project = await store.create(scenario);
    await store.transaction(project.id, (p) =>
      commitDocument(p, correctionFixture(options.distractor), false),
    );
    for (const [turn, prompt] of correctionPrompts.entries()) {
      // New host per turn proves continuity comes from persisted project/chat, not in-process model state.
      store = new ProjectStore(root);
      await store.init();
      const before = await store.read(project.id);
      const calls: unknown[] = [];
      const result = {
        turn,
        prompt,
        passed: false,
        calls,
      } as (typeof turns)[number];
      const agent = new AgentService(
        store,
        {
          complete: async (messages, tools, signal) => {
            options.onMessages?.(messages, turn);
            const reply = options.model
              ? await options.model.complete(messages, tools, signal)
              : {
                  text: "",
                  calls: [
                    {
                      id: randomUUID(),
                      name: "propose_edit",
                      arguments: JSON.stringify({
                        summary: [
                          "Add Hello title",
                          "Make the title red",
                          "Use yellow behind the title",
                          "Enlarge the title",
                        ][turn],
                        commands: referenceCorrection(
                          before.document,
                          turn,
                          target,
                        ),
                      }),
                    },
                  ],
                };
            calls.push(
              ...reply.calls.map((call) => ({
                name: call.name,
                arguments: call.arguments,
              })),
            );
            return reply;
          },
        },
        await loadLocalSkills("skills"),
      );
      try {
        const started = await agent.start(project.id, {
          operationId: randomUUID(),
          instruction: prompt,
          baseRevision: before.revision,
          baseHash: before.documentHash,
          scope: { kind: "project" },
          context: { selectedItemIds: [], playheadFrame: 75 },
        });
        const deadline = Date.now() + 185_000;
        let current = await store.read(project.id);
        while (
          current.runs.some((r) => ["queued", "running"].includes(r.status)) &&
          Date.now() < deadline
        ) {
          await new Promise((resolve) => setTimeout(resolve, 30));
          current = await store.read(project.id);
        }
        const run = current.runs.find((r) => r.id === started.run.id)!;
        if (["queued", "running"].includes(run.status))
          await agent.cancel(project.id, run.id);
        if (options.output) {
          await mkdir(options.output, { recursive: true });
          await writeFile(
            path.join(options.output, `${scenario}-${turn}-run.json`),
            JSON.stringify(
              {
                before: before.document,
                messages: current.messages,
                status: run.status,
                error: run.error,
                proposal: run.proposal,
                clarification: run.clarification,
                calls,
              },
              null,
              2,
            ),
          );
        }
        assert.equal(
          current.documentHash,
          before.documentHash,
          "No mutation before Apply",
        );
        assert.equal(
          run.status,
          "awaiting_review",
          JSON.stringify(
            run.error ??
              run.clarification ??
              "Expected correction without clarification",
          ),
        );
        const review = await agent.review(project.id, run.id);
        target = gradeCorrection(
          before.document,
          review.afterDocument,
          turn,
          target,
        );
        await agent.apply(project.id, run.id, {
          operationId: randomUUID(),
          baseRevision: current.revision,
          baseHash: current.documentHash,
          reviewBasis: review.review.basis,
        });
        const saved = await store.read(project.id);
        assert.deepEqual(saved.document, review.afterDocument);
        const reopened = new ProjectStore(root);
        await reopened.init();
        assert.equal(
          (await reopened.read(project.id)).documentHash,
          saved.documentHash,
        );
        if (options.output) {
          await writeFile(
            path.join(options.output, `${scenario}-${turn}-document.json`),
            JSON.stringify(saved.document, null, 2),
          );
          await writeFile(
            path.join(options.output, `${scenario}-${turn}-scene.json`),
            JSON.stringify(correctionScene(saved.document), null, 2),
          );
        }
        result.passed = true;
      } catch (error) {
        result.error = error instanceof Error ? error.message : String(error);
      }
      turns.push(result);
      if (!result.passed) break; // Never skip a failed dependency or replace it with a reference edit.
    }
  } finally {
    await rm(root, { recursive: true, force: true });
  }
  return {
    scenario,
    target,
    turns,
    passed: turns.length === 4 && turns.every((turn) => turn.passed),
  };
}
