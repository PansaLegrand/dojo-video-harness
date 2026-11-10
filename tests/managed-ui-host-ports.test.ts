import { afterEach, expect, it } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  ProjectStore,
  snapshot,
  publicRun,
  type StoredRun,
} from "../apps/server/src/store";
import { VideoWorkspaceController } from "../packages/core/src/lib/video-project/client-controller";
import { hashVideoProjectDocument } from "../packages/core/src/lib/video-project/document";
import { prepareCaptionSegmentation } from "../packages/core/src/lib/video-project/caption-segmentation";
const roots: string[] = [];
afterEach(async () => {
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  );
});
it("keeps commercial-only registry hints absent from a normal local run instead of activating unsupported HTTP adapters", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "managed-ui-local-"));
  roots.push(root);
  const store = new ProjectStore(root);
  await store.init();
  const p = await store.create();
  const run: StoredRun = {
    id: "run",
    operationId: "local",
    status: "completed",
    phase: "answered",
    instruction: "Explain the timeline",
    baseRevision: p.revision,
    baseHash: p.documentHash,
    context: { selectedItemIds: [], playheadFrame: 0 },
    proposal: null,
    prerequisites: null,
    error: null,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    events: [],
    requestHash: "local-request",
    request: {
      contract: "video-project-commands",
      version: 1,
      baseRevision: p.revision,
      baseHash: p.documentHash,
      document: p.document,
      context: { selectedItemIds: [], playheadFrame: 0 },
    },
  };
  const visible = publicRun(run);
  expect(visible).not.toHaveProperty("hostRequests");
  expect(visible).not.toHaveProperty("externalJobs");
  expect(visible).not.toHaveProperty("outputRequests");
  expect(visible).not.toHaveProperty("verification");
  expect(visible.status).toBe("completed");
});
it("retains a validated paired-caption audit through a lost local commit acknowledgment and browser-controller reload", async () => {
  const root = await mkdtemp(
    path.join(os.tmpdir(), "managed-ui-caption-audit-"),
  );
  roots.push(root);
  const store = new ProjectStore(root);
  await store.init();
  const created = await store.create();
  await store.transaction(created.id, async (p) => {
    for (const [id, language, texts] of [
      ["en", "en", ["solid", "pace"]],
      ["zh", "zh", ["稳健", "的步伐"]],
    ] as const)
      p.document.items.push({
        id,
        name: language,
        trackId: "visual",
        node: { id, type: "div", from: 0, duration: 90 },
        caption: {
          mode: "sentence",
          direction: "ltr",
          highlightColor: "#ffff00",
          role: id === "en" ? "original" : "translation",
          language,
          pairedItemId: id === "en" ? "zh" : "en",
          cues: texts.map((text, i) => ({
            id: String(i),
            text,
            startMs: i * 400,
            endMs: i ? 1200 : 400,
          })),
        },
      });
    p.documentHash = await hashVideoProjectDocument(p.document);
    p.versions["0"] = structuredClone(p.document);
  });
  const initial = await store.read(created.id),
    plan = await prepareCaptionSegmentation(initial.document, {
      operation: "merge",
      itemId: "en",
      cueId: "0",
    });
  const persisted = new Map<string, string>(),
    storage = {
      getItem: (key: string) => persisted.get(key) ?? null,
      setItem: (key: string, value: string) => {
        persisted.set(key, value);
      },
      removeItem: (key: string) => {
        persisted.delete(key);
      },
    };
  const calls: Array<Record<string, unknown>> = [];
  let lose = true;
  const request = async <T>(_url: string, init?: RequestInit): Promise<T> => {
    if (!init?.body) return snapshot(await store.read(created.id)) as T;
    const body = JSON.parse(String(init.body));
    calls.push(body);
    const result = await store.commit(created.id, body);
    if (lose) {
      lose = false;
      throw new Error("Lost acknowledgment");
    }
    return result as T;
  };
  const first = new VideoWorkspaceController(created.id, request, storage);
  await first.open();
  first.dispatch(plan.commands, { captionSegmentation: plan.receipt });
  await expect(first.flush()).rejects.toThrow("Lost acknowledgment");
  first.close();
  const next = new VideoWorkspaceController(created.id, request, storage);
  await next.open();
  await next.flush();
  const saved = await store.read(created.id);
  expect(saved.revision).toBe(1);
  expect(calls).toHaveLength(2);
  expect(calls[1]).toEqual(calls[0]);
  expect(calls[0].captionSegmentation).toEqual(plan.receipt);
  expect(saved.receipts[String(calls[0].operationId)].metadata).toEqual({
    captionSegmentation: plan.receipt,
  });
  expect(
    saved.document.items.find((item) => item.id === "zh")!.caption!.cues[0]
      .text,
  ).toBe("稳健的步伐");
  next.close();
});
