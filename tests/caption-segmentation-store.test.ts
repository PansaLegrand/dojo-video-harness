import { afterEach, expect, it } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { completionHash } from "@dojo-video/agent-kit";
import { ProjectStore, snapshot } from "../apps/server/src/store";
import { canonicalSerialize, hashVideoProjectDocument } from "../packages/core/src/lib/video-project/document";
import { prepareCaptionSegmentation } from "../packages/core/src/lib/video-project/caption-segmentation";
const roots: string[] = [];
afterEach(async () => { await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true }))); });
async function fixture() {
  const root = await mkdtemp(path.join(os.tmpdir(), "caption-segmentation-store-")); roots.push(root);
  const store = new ProjectStore(root); await store.init(); const created = await store.create();
  await store.transaction(created.id, async project => {
    const doc = project.document;
    doc.assets.speech = { id: "speech", name: "Original", type: "video", source: "local", durationSeconds: 6 };
    doc.sources.speech = { assetId: "speech", revision: "original" };
    doc.items.push({ id: "source", name: "Original", trackId: "visual", node: { id: "source", type: "video", assetId: "speech", from: 0, duration: 180 } });
    for (const [id, text] of [["en", ["solid", "pace"]], ["zh", ["稳健", "的步伐"]]] as const) doc.items.push({ id, name: id, trackId: "visual", node: { id, type: "div", from: 0, duration: 180, style: { color: id === "en" ? "#ff0000" : "#ffffff", fontSize: 24 } },
      caption: { mode: "sentence", highlightColor: "#ffff00", direction: "ltr", sourceItemId: "source", role: id === "en" ? "original" : "translation", pairedItemId: id === "en" ? "zh" : "en", language: id,
        cues: [{ id: "one", text: text[0], startMs: 0, endMs: 400 }, { id: "two", text: text[1], startMs: 400, endMs: 1200 }] } });
    project.documentHash = await hashVideoProjectDocument(doc); project.versions["0"] = structuredClone(doc);
  });
  const project = await store.read(created.id), plan = await prepareCaptionSegmentation(project.document, { operation: "merge", itemId: "en", cueId: "one" });
  return { store, project, plan, input: { operationId: "merge", baseRevision: project.revision, baseHash: project.documentHash, commands: plan.commands, captionSegmentation: plan.receipt } };
}
it("persists independently validated segmentation provenance through unrelated rebase, retry and store reload", async () => {
  const f = await fixture();
  await f.store.commit(f.project.id, { operationId: "style", baseRevision: 0, baseHash: f.project.documentHash, commands: [{ type: "set", target: { kind: "node", itemId: "en", nodeId: "en" }, path: ["style", "color"], value: "#2563eb" }] });
  const committed = await f.store.commit(f.project.id, f.input); expect(committed.revision).toBe(2);
  expect(committed.document.items.find(item => item.id === "en")!.node.style!.color).toBe("#2563eb");
  expect(committed.document.items.find(item => item.id === "zh")!.caption!.cues[0].text).toBe("稳健的步伐");
  const reloaded = new ProjectStore(f.store.directory), saved = await reloaded.read(f.project.id);
  expect(saved.receipts.merge.metadata).toEqual({ captionSegmentation: f.plan.receipt });
  expect(saved.receipts.merge.hash).toBe(canonicalSerialize(f.input));
  expect((await reloaded.commit(f.project.id, f.input)).revision).toBe(2);
  expect((await reloaded.read(f.project.id)).receipts.merge.metadata).toEqual(saved.receipts.merge.metadata);
  await expect(reloaded.commit(f.project.id, { ...f.input, captionSegmentation: { ...f.plan.receipt, commandsHash: "sha256:" + "0".repeat(64) } })).rejects.toThrow(/reused/);
  expect((await reloaded.read(f.project.id)).revision).toBe(2);
});
it("keeps old body hashes and receipts byte-shape compatible when optional provenance is absent", async () => {
  const f = await fixture(), body = { operationId: "old-body", baseRevision: 0, baseHash: f.project.documentHash, commands: [{ type: "set", target: { kind: "format" }, path: ["backgroundColor"], value: "#123456" }] };
  await f.store.commit(f.project.id, body); const saved = await f.store.read(f.project.id);
  expect(saved.receipts[body.operationId].hash).toBe(canonicalSerialize(body));
  expect(Object.keys(saved.receipts[body.operationId]).sort()).toEqual(["hash", "snapshot"]);
});
it("rejects forged audit payloads and source-clock changes without a partial document or receipt write", async () => {
  const f = await fixture(), commands = [...f.plan.commands, { type: "set" as const, target: { kind: "format" as const }, path: ["backgroundColor"], value: "#000000" }];
  await expect(f.store.commit(f.project.id, { ...f.input, commands, captionSegmentation: { ...f.plan.receipt, commandsHash: await completionHash(commands) } })).rejects.toMatchObject({ code: "CAPTION_SEGMENTATION_STALE" });
  expect(snapshot(await f.store.read(f.project.id))).toEqual(snapshot(f.project));
  await f.store.commit(f.project.id, { operationId: "clock", baseRevision: 0, baseHash: f.project.documentHash, commands: [{ type: "set", target: { kind: "node", itemId: "source", nodeId: "source" }, path: ["videoStartTime"], value: .25 }] });
  const before = await f.store.read(f.project.id);
  await expect(f.store.commit(f.project.id, f.input)).rejects.toThrow();
  const after = await f.store.read(f.project.id); expect(snapshot(after)).toEqual(snapshot(before)); expect(after.receipts.merge).toBeUndefined();
});
