import { it, expect, afterEach, vi } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { ProjectStore, snapshot } from "../apps/server/src/store";
import { AgentService } from "../apps/server/src/agent-service";
import type { LanguageModel, ModelReply } from "../packages/agent/src";
const roots: string[] = [];
afterEach(async () => {
  await Promise.all(
    roots.splice(0).map((p) => rm(p, { recursive: true, force: true })),
  );
});
const propose = (color = "#2563eb"): ModelReply => ({
  text: "",
  calls: [
    {
      id: crypto.randomUUID(),
      name: "propose_edit",
      arguments: JSON.stringify({
        summary: "Color title",
        commands: [
          {
            type: "set",
            target: { kind: "node", itemId: "title", nodeId: "title" },
            path: ["style", "color"],
            value: color,
          },
        ],
      }),
    },
  ],
});
async function fixture(model: LanguageModel) {
  const root = await mkdtemp(path.join(os.tmpdir(), "harness-service-"));
  roots.push(root);
  const store = new ProjectStore(root);
  await store.init();
  let p = await store.create();
  await store.commit(p.id, {
    operationId: "setup",
    baseRevision: 0,
    baseHash: p.documentHash,
    commands: [
      {
        type: "addItem",
        item: {
          id: "title",
          name: "Title",
          trackId: "visual",
          node: {
            id: "title",
            type: "text",
            text: "Hello",
            from: 0,
            duration: 90,
            style: { color: "#ffffff" },
          },
        },
      },
    ],
  });
  p = await store.read(p.id);
  const input = {
    operationId: "instruction",
    instruction: "Make title blue",
    baseRevision: p.revision,
    baseHash: p.documentHash,
    scope: { kind: "selection", itemIds: ["title"] },
    context: { selectedItemIds: ["title"], playheadFrame: 0 },
  };
  return { store, p, input, agent: new AgentService(store, model, []) };
}
async function settle(store: ProjectStore, id: string) {
  for (let i = 0; i < 200; i++) {
    const p = await store.read(id);
    if (
      p.runs.length &&
      p.runs.every((r) => !["queued", "running"].includes(r.status))
    )
      return p;
    await new Promise((r) => setTimeout(r, 10));
  }
  throw new Error("Run did not settle");
}
it("requires explicit review-bound application, then selectively undoes without another model call", async () => {
  const model = { complete: vi.fn(async () => propose()) };
  const { store, p, input, agent } = await fixture(model);
  const started = await agent.start(p.id, input);
  await agent.start(p.id, input);
  await settle(store, p.id);
  expect((await store.read(p.id)).document.items[0].node.style?.color).toBe(
    "#ffffff",
  );
  const comparison = await agent.review(p.id, started.run.id);
  const latest = snapshot(await store.read(p.id));
  await agent.apply(p.id, started.run.id, {
    operationId: "apply",
    baseRevision: latest.revision,
    baseHash: latest.documentHash,
    reviewBasis: comparison.review.basis,
  });
  const applied = await store.read(p.id);
  expect(applied.document.items[0].node.style?.color).toBe("#2563eb");
  await store.commit(p.id, {
    operationId: "manual",
    baseRevision: applied.revision,
    baseHash: applied.documentHash,
    commands: [
      {
        type: "set",
        target: { kind: "node", itemId: "title", nodeId: "title" },
        path: ["text"],
        value: "Manual wording",
      },
    ],
  });
  const changed = await store.read(p.id);
  await agent.undo(p.id, started.run.id, {
    operationId: "undo",
    baseRevision: changed.revision,
    baseHash: changed.documentHash,
  });
  const final = await store.read(p.id);
  expect(final.document.items[0].node.text).toBe("Manual wording");
  expect(final.document.items[0].node.style?.color).toBe("#ffffff");
  expect(model.complete).toHaveBeenCalledTimes(1);
});
it("keeps cancellation terminal even if the provider returns afterward", async () => {
  let release!: (v: ModelReply) => void;
  const model = {
    complete: vi.fn(
      () =>
        new Promise<ModelReply>((resolve) => {
          release = resolve;
        }),
    ),
  };
  const { store, p, input, agent } = await fixture(model);
  const started = await agent.start(p.id, input);
  await vi.waitFor(() => expect(model.complete).toHaveBeenCalledTimes(1));
  await agent.cancel(p.id, started.run.id);
  release(propose());
  await new Promise((r) => setTimeout(r, 60));
  const final = await store.read(p.id);
  expect(final.runs[0].status).toBe("cancelled");
  expect(final.documentHash).toBe(p.documentHash);
});
it("persists an answered question and replays the same continuation without spending another call", async () => {
  let calls = 0;
  const model: LanguageModel = {
    complete: async () =>
      ++calls === 1
        ? {
            text: "",
            calls: [
              {
                id: "question",
                name: "ask_user",
                arguments: JSON.stringify({
                  id: "q",
                  question: "Which color?",
                  options: [
                    { id: "blue", label: "Blue", targetItemIds: ["title"] },
                    { id: "white", label: "White", targetItemIds: ["title"] },
                  ],
                }),
              },
            ],
          }
        : propose(),
  };
  const { store, p, input, agent } = await fixture(model);
  const started = await agent.start(p.id, input);
  await settle(store, p.id);
  const answer = {
    operationId: "answer",
    questionId: "q",
    optionId: "blue",
    baseRevision: p.revision,
    baseHash: p.documentHash,
  };
  await Promise.all([
    agent.answer(p.id, started.run.id, answer),
    agent.answer(p.id, started.run.id, answer),
  ]);
  const final = await settle(store, p.id);
  expect(final.runs).toHaveLength(2);
  expect(calls).toBe(2);
  expect(final.runs[1].status).toBe("awaiting_review");
  expect(final.documentHash).toBe(p.documentHash);
});
it("rejects applying an obsolete review without losing the proposal", async () => {
  const { store, p, input, agent } = await fixture({
    complete: async () => propose(),
  });
  const started = await agent.start(p.id, input);
  await settle(store, p.id);
  const comparison = await agent.review(p.id, started.run.id);
  await store.commit(p.id, {
    operationId: "manual",
    baseRevision: p.revision,
    baseHash: p.documentHash,
    commands: [
      {
        type: "set",
        target: { kind: "format" },
        path: ["backgroundColor"],
        value: "#123456",
      },
    ],
  });
  await expect(
    agent.apply(p.id, started.run.id, {
      operationId: "apply",
      baseRevision: p.revision,
      baseHash: p.documentHash,
      reviewBasis: comparison.review.basis,
    }),
  ).rejects.toThrow(/Refresh/);
  expect((await store.read(p.id)).runs[0].status).toBe("awaiting_review");
});
