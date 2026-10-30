import { it, expect, afterEach } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { ProjectStore, snapshot } from "../apps/server/src/store";
const roots: string[] = [];
afterEach(async () => {
  await Promise.all(
    roots.splice(0).map((p) => rm(p, { recursive: true, force: true })),
  );
});
async function fixture() {
  const root = await mkdtemp(path.join(os.tmpdir(), "dojo-harness-test-"));
  roots.push(root);
  const store = new ProjectStore(root);
  await store.init();
  const project = await store.create();
  return { store, project };
}
it("serializes concurrent commits, rebases unrelated fields, and preserves idempotency across reload", async () => {
  const { store, project } = await fixture();
  const base = { baseRevision: 0, baseHash: project.documentHash };
  const one = {
      ...base,
      operationId: "one",
      commands: [
        {
          type: "set",
          target: { kind: "format" },
          path: ["backgroundColor"],
          value: "#123456",
        },
      ],
    },
    two = {
      ...base,
      operationId: "two",
      commands: [
        {
          type: "set",
          target: { kind: "format" },
          path: ["durationInFrames"],
          value: 300,
        },
      ],
    };
  await Promise.all([
    store.commit(project.id, one),
    store.commit(project.id, two),
  ]);
  const current = await store.read(project.id);
  expect(current.revision).toBe(2);
  expect(current.document.format.backgroundColor).toBe("#123456");
  expect(current.document.format.durationInFrames).toBe(300);
  await new ProjectStore(store.directory).commit(project.id, one);
  expect((await store.read(project.id)).revision).toBe(2);
  await expect(
    store.commit(project.id, { ...one, commands: two.commands }),
  ).rejects.toThrow(/reused/);
});
it("rejects conflicting stale edits without partially writing the project", async () => {
  const { store, project } = await fixture();
  const command = (color: string) => [
    {
      type: "set",
      target: { kind: "format" },
      path: ["backgroundColor"],
      value: color,
    },
  ];
  await store.commit(project.id, {
    operationId: "first",
    baseRevision: 0,
    baseHash: project.documentHash,
    commands: command("#000000"),
  });
  await expect(
    store.commit(project.id, {
      operationId: "second",
      baseRevision: 0,
      baseHash: project.documentHash,
      commands: command("#ffffff"),
    }),
  ).rejects.toThrow();
  expect((await store.read(project.id)).revision).toBe(1);
});
it("rolls back a transaction if final validation fails", async () => {
  const { store, project } = await fixture();
  await expect(
    store.transaction(project.id, (p) => {
      p.name = "Not committed";
      throw new Error("reject");
    }),
  ).rejects.toThrow("reject");
  expect((await store.read(project.id)).name).toBe("Untitled video");
  expect(snapshot(await store.read(project.id)).history.canUndo).toBe(false);
});
