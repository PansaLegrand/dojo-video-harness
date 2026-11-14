import { describe, expect, it, vi } from "vitest";
import { builtInSkills, type EditorStagePorts } from "../packages/agent-kit/src/index";
import { createVideoToolset } from "../packages/agent/src/tools";
import { createVideoProjectDocument, hashVideoProjectDocument } from "../packages/core/src/lib/video-project/document";
import { reviewNativeCompletionEdit } from "../packages/core/src/lib/video-project/completion-preflight";
import { compileNativeAgentResult, type NativeAgentResult } from "../packages/core/src/lib/video-project/agent-runtime";

async function fixture() {
  const document = createVideoProjectDocument({ width: 640, height: 360, fps: 30, durationInFrames: 300 });
  document.assets.photo = { id: "photo", type: "image", source: "local", name: "Photo" };
  document.assets.speech = { id: "speech", type: "audio", source: "local", name: "Speech", durationSeconds: 10 };
  document.sources.speech = { assetId: "speech", revision: "rev" };
  document.items.push({ id: "voice", name: "Speech", trackId: "audio", node: { id: "voice", type: "audio", assetId: "speech", from: 0, duration: 300 } });
  document.evidence.asr = { id: "asr", sourceAssetId: "speech", sourceRevision: "rev", transcriptHash: "synthetic", language: "en", text: "Revenue increased 25 percent", words: [
    { id: "w0", text: "Revenue", startMs: 0, endMs: 500 }, { id: "w1", text: "increased", startMs: 500, endMs: 1000 },
    { id: "w2", text: "25", startMs: 1000, endMs: 1300 }, { id: "w3", text: "percent", startMs: 1300, endMs: 1600 },
  ] };
  return { contract: "video-project-commands" as const, version: 1 as const, baseRevision: 0, baseHash: await hashVideoProjectDocument(document), document,
    instruction: "Keep the exact source quote, numeric highlight and image placement", context: { selectedItemIds: [], playheadFrame: 0 } };
}
const quote = { id: "quote", kind: "speech_callout", itemId: "quote", bindingId: "quote-anchor", sourceItemId: "voice", evidenceId: "asr", wordIds: ["w0", "w1"], exactText: "Revenue increased", minReadableMs: 1000 };
const highlight = { ...quote, id: "growth", kind: "speech_highlight", itemId: "growth", bindingId: "growth-anchor", wordIds: ["w2", "w3"], exactText: "25%" };
const image = { id: "image", kind: "asset_sequence", items: [{ itemId: "card", assetId: "photo", from: 0, duration: 60, sourceStartSeconds: 0 }] };
const cases = [
  { name: "source quote mismatch", invalid: { ...quote, wordIds: ["w1", "w2"] }, valid: quote, error: /wordIds resolve to/ },
  { name: "numeric highlight mismatch", invalid: { ...highlight, exactText: "35%" }, valid: highlight, error: /numeric exactText/ },
  { name: "image source offset", invalid: { ...image, items: [{ ...image.items[0], sourceStartSeconds: 2 }] }, valid: image, error: /Source offsets apply only/ },
];

describe("retained and current source declaration contracts", () => {
  it.each(cases)("retains old declaration behavior for $name and validates current requirements before freezing", async ({ invalid, valid, error }) => {
    const request = await fixture(), before = JSON.stringify(request);
    for (const { profile, agentKitVersion } of [
      ...(["local-editor-v8", "local-editor-v9", "local-editor-v10", "local-editor-v11", "local-editor-v12", "local-editor-v13", "local-editor-v14"] as const).map(profile => ({ profile, agentKitVersion: undefined as string | undefined })),
      { profile: "local-editor-v14" as const, agentKitVersion: "0.2.8" },
    ]) {
      const plan = vi.fn(async () => compileNativeAgentResult(request, { outcome: "answer", summary: "Owned plan accepted", commands: [] }));
      const stages: EditorStagePorts<NativeAgentResult> = { phase: "planning", generalEditing: true, deriveCaptionPlan: true, preparedCommands: false,
        planEditStages: plan, saveCaptionBatch: async () => { throw Error("No captions in this test"); }, readEditArtifact: async () => ({}), resolvePreparedEdit: async value => value };
      const session = createVideoToolset(request, builtInSkills(), [], { profile, stages, agentKitVersion });
      const execute = (requirement: unknown) => session.tools.find(tool => tool.name === "plan_edit_stages")!.execute({ requirements: [requirement], captionPairs: [] }, new AbortController().signal);
      if (profile === "local-editor-v14" && agentKitVersion !== "0.2.8") {
        await expect(execute(invalid)).rejects.toThrow(error);
        expect(plan).not.toHaveBeenCalled();
        // An invalid declaration never freezes state or consumes a correction.
        await expect(execute(valid)).resolves.toMatchObject({ kind: "terminal" });
        expect(plan).toHaveBeenCalledTimes(1);
      } else {
        await expect(execute(invalid)).resolves.toMatchObject({ kind: "terminal" });
        expect(plan).toHaveBeenCalledTimes(1);
      }
    }
    expect(JSON.stringify(request)).toBe(before);
  });
});

it("keeps zero image source offsets behind the current source-validation contract", async () => {
  const request = await fixture();
  request.document.items.push({ id: "card", name: "Before", trackId: "visual", node: { id: "card", type: "img", assetId: "photo", from: 0, duration: 60 } });
  request.baseHash = await hashVideoProjectDocument(request.document);
  const input = { requirements: [image], edit: { outcome: "proposal", summary: "Rename image", commands: [{ type: "set", target: { kind: "item", itemId: "card" }, path: ["name"], value: "After" }] } };
  const retained = await reviewNativeCompletionEdit(request, input);
  expect(retained.checks.find(check => check.id === "image")).toMatchObject({ passed: false, message: "Source offsets apply to video/audio assets." });
  expect(retained.receipt).toBeUndefined();
  const current = await reviewNativeCompletionEdit(request, input, { validateSourceRequirements: true });
  expect(current.checks.every(check => check.passed)).toBe(true);
  expect(current.receipt).toBeDefined();
});

it("fails closed on a saved unavailable build instead of silently using current tools", async () => {
  const { savedAgentKitVersion, selectAgentKit } = await import("../packages/agent/src/runtime-build");
  expect(savedAgentKitVersion({ agentProfile: "local-editor-v14" })).toBe("0.2.8");
  expect(() => savedAgentKitVersion({ agentProfile: "local-editor-v14", agentKitVersion: "0.2.999" })).toThrow(/unavailable/);
  expect(() => selectAgentKit("local-editor-v13", "0.2.8")).toThrow(/unavailable/);
});
