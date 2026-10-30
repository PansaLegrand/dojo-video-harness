import { it, expect, afterEach } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { ProjectStore } from "../apps/server/src/store";
import {
  prepareExport,
  claimExport,
  finishExport,
} from "../apps/server/src/exports";
const roots: string[] = [];
afterEach(async () => {
  await Promise.all(
    roots.splice(0).map((r) => rm(r, { recursive: true, force: true })),
  );
});
async function fixture() {
  const dir = await mkdtemp(path.join(os.tmpdir(), "harness-export-"));
  roots.push(dir);
  const store = new ProjectStore(dir);
  await store.init();
  const project = await store.create();
  const profile = {
    exportId: crypto.randomUUID(),
    documentRevision: 0,
    width: 1280,
    height: 720,
    fps: 30,
    durationInFrames: 180,
    resolution: "original",
    sourceType: "editor_export",
  };
  return { store, project, profile };
}
it("pins output to its revision and forbids replacing reserved bytes", async () => {
  const { store, project, profile } = await fixture();
  const prepared = await prepareExport(store, project.id, {
    ...profile,
    phase: "prepare",
  });
  expect(prepared.documentHash).toBe(project.documentHash);
  await claimExport(store, project.id, profile.exportId, "a".repeat(64), 100);
  await expect(
    claimExport(store, project.id, profile.exportId, "b".repeat(64), 100),
  ).rejects.toThrow(/different bytes/);
  await finishExport(store, project.id, profile.exportId, 100, "a".repeat(64));
  await expect(
    prepareExport(store, project.id, {
      ...profile,
      width: 1920,
      phase: "prepare",
    }),
  ).rejects.toThrow(/another revision/);
});
it("rejects invalid output dimensions and cancellation remains terminal", async () => {
  const { store, project, profile } = await fixture();
  await expect(
    prepareExport(store, project.id, {
      ...profile,
      width: 1280,
      height: 1280,
      phase: "prepare",
    }),
  ).rejects.toThrow(/pinned/);
  await prepareExport(store, project.id, { ...profile, phase: "prepare" });
  await prepareExport(store, project.id, { ...profile, phase: "cancel" });
  await expect(
    claimExport(store, project.id, profile.exportId, "a".repeat(64), 100),
  ).rejects.toThrow(/not prepared/);
  await expect(
    finishExport(store, project.id, profile.exportId, 100, "a".repeat(64)),
  ).rejects.toThrow(/cancelled/);
});
