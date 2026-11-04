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
async function fixture(
  model: LanguageModel,
  mode: "review" | "direct" = "review",
) {
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
  return {
    store,
    p,
    input,
    agent: new AgentService(store, model, [], undefined, mode),
  };
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

it("keeps a pending review across restart and fails interrupted work without resubmitting", async () => {
  const model = { complete: vi.fn(async () => propose()) };
  const { store, p, input, agent } = await fixture(model);
  const start = await agent.start(p.id, input);
  await settle(store, p.id);
  await store.transaction(p.id, (project) => {
    project.runs.push({
      ...structuredClone(project.runs[0]),
      id: crypto.randomUUID(),
      operationId: "interrupted",
      status: "running",
      proposal: null,
    });
  });
  const restarted = new ProjectStore(store.directory);
  await restarted.recoverInterrupted();
  const saved = await restarted.read(p.id);
  expect(saved.runs.map((r) => r.status)).toEqual([
    "awaiting_review",
    "failed",
  ]);
  expect(saved.runs[1].error?.code).toBe("INTERRUPTED");
  expect(saved.documentHash).toBe(p.documentHash);
  const host = new AgentService(restarted, model, []);
  const review = await host.review(p.id, start.run.id);
  await host.apply(p.id, start.run.id, {
    operationId: "apply-after-restart",
    baseRevision: p.revision,
    baseHash: p.documentHash,
    reviewBasis: review.review.basis,
  });
  expect(model.complete).toHaveBeenCalledTimes(1);
});

it("rejects stale questions and conflicting submission identities before further model work", async () => {
  const model = {
    complete: vi.fn(
      async (): Promise<ModelReply> => ({
        text: "",
        calls: [
          {
            id: "question",
            name: "ask_user",
            arguments: JSON.stringify({
              id: "color",
              question: "Which color?",
              allowText: true,
            }),
          },
        ],
      }),
    ),
  };
  const { store, p, input, agent } = await fixture(model);
  const start = await agent.start(p.id, input);
  await settle(store, p.id);
  await expect(
    agent.start(p.id, { ...input, instruction: "A different request" }),
  ).rejects.toThrow(/another request/);
  await store.commit(p.id, {
    operationId: "manual",
    baseRevision: p.revision,
    baseHash: p.documentHash,
    commands: [
      {
        type: "set",
        target: { kind: "node", itemId: "title", nodeId: "title" },
        path: ["text"],
        value: "Changed manually",
      },
    ],
  });
  const current = await store.read(p.id);
  await expect(
    agent.answer(p.id, start.run.id, {
      operationId: "stale-answer",
      questionId: "color",
      text: "Blue",
      baseRevision: current.revision,
      baseHash: current.documentHash,
    }),
  ).rejects.toThrow(/project changed/i);
  await expect(
    agent.start(p.id, { ...input, operationId: "stale-start" }),
  ).rejects.toThrow(/latest edits/);
  expect((await store.read(p.id)).documentHash).toBe(current.documentHash);
  expect(model.complete).toHaveBeenCalledTimes(1);
});

it("cancelled proposals cannot be applied or resurrected by replaying the request", async () => {
  const model = { complete: vi.fn(async () => propose()) };
  const { store, p, input, agent } = await fixture(model);
  const start = await agent.start(p.id, input);
  await settle(store, p.id);
  const comparison = await agent.review(p.id, start.run.id);
  await agent.cancel(p.id, start.run.id);
  const replay = await agent.start(p.id, input);
  expect(replay.run.status).toBe("cancelled");
  await expect(
    agent.apply(p.id, start.run.id, {
      operationId: "cancelled-apply",
      baseRevision: p.revision,
      baseHash: p.documentHash,
      reviewBasis: comparison.review.basis,
    }),
  ).rejects.toThrow(/no longer actionable/);
  expect((await store.read(p.id)).documentHash).toBe(p.documentHash);
  expect(model.complete).toHaveBeenCalledTimes(1);
});

it("reviews a late proposal against an unrelated manual edit without overwriting it", async () => {
  let release!: (reply: ModelReply) => void;
  const model = {
    complete: vi.fn(
      () =>
        new Promise<ModelReply>((resolve) => {
          release = resolve;
        }),
    ),
  };
  const { store, p, input, agent } = await fixture(model);
  const start = await agent.start(p.id, input);
  await vi.waitFor(() => expect(model.complete).toHaveBeenCalledTimes(1));
  await store.commit(p.id, {
    operationId: "manual-wording",
    baseRevision: p.revision,
    baseHash: p.documentHash,
    commands: [
      {
        type: "set",
        target: { kind: "node", itemId: "title", nodeId: "title" },
        path: ["text"],
        value: "Keep this wording",
      },
    ],
  });
  release(propose());
  await settle(store, p.id);
  const current = await store.read(p.id),
    review = await agent.review(p.id, start.run.id);
  expect(current.document.items[0].node.style?.color).toBe("#ffffff");
  await agent.apply(p.id, start.run.id, {
    operationId: "approve-current",
    baseRevision: current.revision,
    baseHash: current.documentHash,
    reviewBasis: review.review.basis,
  });
  expect((await store.read(p.id)).document.items[0].node).toMatchObject({
    text: "Keep this wording",
    style: { color: "#2563eb" },
  });
});

it("refuses a timing undo after the same target changed and preserves both edits", async () => {
  const model = {
    complete: async (): Promise<ModelReply> => ({
      text: "",
      calls: [
        {
          id: "move",
          name: "propose_edit",
          arguments: JSON.stringify({
            summary: "Move title",
            commands: [{ type: "moveItem", id: "title", from: 30 }],
          }),
        },
      ],
    }),
  };
  const { store, p, input, agent } = await fixture(model);
  const start = await agent.start(p.id, {
    ...input,
    instruction: "Move the title to one second",
  });
  await settle(store, p.id);
  const review = await agent.review(p.id, start.run.id);
  await agent.apply(p.id, start.run.id, {
    operationId: "apply-move",
    baseRevision: p.revision,
    baseHash: p.documentHash,
    reviewBasis: review.review.basis,
  });
  const moved = await store.read(p.id);
  await store.commit(p.id, {
    operationId: "manual",
    baseRevision: moved.revision,
    baseHash: moved.documentHash,
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
  await expect(
    agent.undo(p.id, start.run.id, {
      operationId: "undo-move",
      baseRevision: changed.revision,
      baseHash: changed.documentHash,
    }),
  ).rejects.toThrow(/changed properties/);
  expect((await store.read(p.id)).documentHash).toBe(changed.documentHash);
});

it("captures one model instance per run even when provider settings change between tool calls", async () => {
  let release!: (reply: ModelReply) => void;
  let steps = 0;
  const oldModel = {
    complete: vi.fn(
      async (): Promise<ModelReply> =>
        ++steps === 1
          ? await new Promise((resolve) => {
              release = resolve;
            })
          : propose(),
    ),
  };
  const newModel = { complete: vi.fn(async () => propose("#16a34a")) };
  let current = oldModel;
  const { store, p, input } = await fixture(oldModel);
  const host = new AgentService(store, () => current, []);
  const started = await host.start(p.id, input);
  await vi.waitFor(() => expect(oldModel.complete).toHaveBeenCalledTimes(1));
  current = newModel;
  release({
    text: "",
    calls: [{ id: "inspect", name: "inspect_project", arguments: "{}" }],
  });
  const result = await settle(store, p.id);
  expect(result.runs.find((r) => r.id === started.run.id)?.status).toBe(
    "awaiting_review",
  );
  expect(oldModel.complete).toHaveBeenCalledTimes(2);
  expect(newModel.complete).not.toHaveBeenCalled();
});

it("direct editing survives restart and applies once through the guarded path with undo", async () => {
  const model = { complete: vi.fn(async () => propose()) };
  const { store, p, input, agent } = await fixture(model, "direct");
  const started = await agent.start(p.id, input);
  await agent.start(p.id, input);
  const ready = await settle(store, p.id);
  expect(ready.runs[0]).toMatchObject({
    status: "ready",
    proposal: { impact: "direct" },
  });
  // Browser owns the final save boundary: no server mutation over a local draft.
  expect(ready.documentHash).toBe(p.documentHash);
  const reopened = new ProjectStore(store.directory);
  await reopened.init();
  const host = new AgentService(reopened, model, [], undefined, "direct");
  const comparison = await host.review(p.id, started.run.id);
  const apply = {
    operationId: "direct-apply",
    baseRevision: ready.revision,
    baseHash: ready.documentHash,
    reviewBasis: comparison.review.basis,
  };
  await host.apply(p.id, started.run.id, apply);
  await host.apply(p.id, started.run.id, apply);
  const saved = await reopened.read(p.id);
  expect(saved.revision).toBe(ready.revision + 1);
  expect(saved.document.items[0].node.style?.color).toBe("#2563eb");
  await host.undo(p.id, started.run.id, {
    operationId: "direct-undo",
    baseRevision: saved.revision,
    baseHash: saved.documentHash,
  });
  expect((await reopened.read(p.id)).document.items[0].node.style?.color).toBe(
    "#ffffff",
  );
  expect(model.complete).toHaveBeenCalledTimes(1);
});
it("direct application rejects a stale basis without overwriting a manual edit", async () => {
  const { store, p, input, agent } = await fixture(
    { complete: async () => propose() },
    "direct",
  );
  const started = await agent.start(p.id, input);
  const ready = await settle(store, p.id);
  const comparison = await agent.review(p.id, started.run.id);
  await store.commit(p.id, {
    operationId: "manual-while-applying",
    baseRevision: ready.revision,
    baseHash: ready.documentHash,
    commands: [
      {
        type: "set",
        target: { kind: "node", itemId: "title", nodeId: "title" },
        path: ["style", "color"],
        value: "#ff0000",
      },
    ],
  });
  await expect(
    agent.apply(p.id, started.run.id, {
      operationId: "stale-direct",
      baseRevision: ready.revision,
      baseHash: ready.documentHash,
      reviewBasis: comparison.review.basis,
    }),
  ).rejects.toThrow(/Refresh/);
  await expect(agent.review(p.id, started.run.id)).rejects.toThrow();
  expect((await store.read(p.id)).document.items[0].node.style?.color).toBe(
    "#ff0000",
  );
});
it("cancelled direct edits cannot apply on a later browser poll", async () => {
  const { store, p, input, agent } = await fixture(
    { complete: async () => propose() },
    "direct",
  );
  const started = await agent.start(p.id, input);
  const ready = await settle(store, p.id);
  const comparison = await agent.review(p.id, started.run.id);
  await agent.cancel(p.id, started.run.id);
  await expect(
    agent.apply(p.id, started.run.id, {
      operationId: "cancelled-direct",
      baseRevision: ready.revision,
      baseHash: ready.documentHash,
      reviewBasis: comparison.review.basis,
    }),
  ).rejects.toThrow(/no longer actionable/);
  expect((await store.read(p.id)).documentHash).toBe(p.documentHash);
});
