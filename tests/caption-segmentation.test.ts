import { expect, it } from "vitest";
import { applyEditorCommand } from "../packages/core/src/lib/editor/commands";
import { captionCueSchema } from "../packages/core/src/lib/editor/document";
import { completionHash } from "@dojo-video/agent-kit";
import { createVideoProjectDocument, hashVideoProjectDocument, parseVideoProjectDocument, toEditorDocument } from "../packages/core/src/lib/video-project/document";
import { executeVideoProjectCommands, rebaseVideoProjectCommands } from "../packages/core/src/lib/video-project/commands";
import { compileNativeAgentResult } from "../packages/core/src/lib/video-project/agent-runtime";
import { buildVideoProjectRevertCommands } from "../packages/core/src/lib/video-project/revert";
import { prepareCaptionSegmentation, validateCaptionSegmentationReceipt, joinCaptionDisplayText } from "../packages/core/src/lib/video-project/caption-segmentation";

function fixture() {
  const doc = createVideoProjectDocument({ width: 640, height: 360, fps: 30, durationInFrames: 180 });
  doc.assets.speech = { id: "speech", name: "Interview", type: "video", source: "project", durationSeconds: 6 };
  doc.sources.speech = { assetId: "speech", revision: "original-speech" };
  doc.items.push({ id: "speech", name: "Interview", trackId: "visual", node: { id: "speech", type: "video", assetId: "speech", from: 0, duration: 180 } });
  doc.tracks.push({ id: "zh-track", name: "Chinese", kind: "visual", muted: false, locked: false, hidden: false });
  const words = [
    { text: "solid", startMs: 0, endMs: 400 }, { text: "pace", startMs: 400, endMs: 1200 },
    { text: "twenty", startMs: 1200, endMs: 1500 }, { text: "point", startMs: 1500, endMs: 1800 },
    { text: "five", startMs: 1800, endMs: 2200 }, { text: "percent.", startMs: 2200, endMs: 3000 },
  ];
  doc.evidence.asr = { id: "asr", asrTaskId: "owned-asr", sourceAssetId: "speech", sourceRevision: "original-speech", transcriptHash: "sha256:" + "a".repeat(64), text: "solid pace twenty point five percent.", language: "en", words: words.map((word, index) => ({ ...word, id: `w:aaaaaaaaaaaaaaaa:${index}` })) };
  const values = [
    { id: "en", language: "en", direction: "ltr" as const, text: ["solid", "pace", "twenty point five percent."], top: 200 },
    { id: "zh", language: "zh", direction: "ltr" as const, text: ["稳健", "的步伐。", "百分之二十点五。"], top: 260 },
    { id: "ar", language: "ar", direction: "rtl" as const, text: ["بوتيرة", "ثابتة.", "عشرون ونصف بالمئة."], top: 310 },
  ];
  for (const row of values) doc.items.push({ id: row.id, name: row.id, trackId: row.id === "zh" ? "zh-track" : "visual",
    node: { id: row.id, type: "div", from: 0, duration: 180, style: { color: row.id === "en" ? "#ff0000" : "#ffffff", top: row.top, fontSize: 24 } },
    caption: { mode: row.id === "en" ? "karaoke" : "sentence", highlightColor: "#ffff00", direction: row.direction, language: row.language, role: row.id === "en" ? "original" : "translation", sourceItemId: "speech", pairedItemId: row.id === "en" ? "zh" : "en",
      cues: row.text.map((text, index) => ({ id: ["solid", "pace", "number"][index], text, startMs: [0, 400, 1200][index], endMs: [400, 1200, 3000][index], ...(row.id === "en" ? { words: index < 2 ? [words[index]] : words.slice(2) } : {}) })) } });
  doc.items.push({ id: "unrelated", name: "Unrelated title", trackId: "visual", node: { id: "unrelated", type: "text", text: "Before", from: 0, duration: 180 } });
  return parseVideoProjectDocument(doc);
}
const cues = (doc: ReturnType<typeof fixture>, id: string) => doc.items.find(item => item.id === id)!.caption!.cues;
it("merges stranded words atomically across source-linked English, CJK and RTL captions with a source-bound receipt", async () => {
  const before = fixture(), saved = JSON.stringify(before), plan = await prepareCaptionSegmentation(before, { operation: "merge", itemId: "zh", cueId: "solid" });
  expect(plan.receipt).toMatchObject({ version: 1, grouping: "manual-paired-v1", operation: "merge", sourceItemId: "speech", sourceRevision: "original-speech", inputCueIds: ["solid", "pace"], outputCueIds: ["solid"], affectedItemIds: ["en", "ar", "zh"] });
  expect(plan.commands).toHaveLength(3);
  const after = executeVideoProjectCommands(before, plan.commands).document;
  expect(cues(after, "en")[0].text).toBe("solid pace"); expect(cues(after, "zh")[0].text).toBe("稳健的步伐。"); expect(cues(after, "ar")[0].text).toBe("بوتيرة ثابتة.");
  for (const id of ["en", "zh", "ar"]) {
    expect(cues(after, id).map(cue => [cue.id, cue.startMs, cue.endMs])).toEqual([["solid", 0, 1200], ["number", 1200, 3000]]);
    expect(after.items.find(item => item.id === id)!.node).toEqual(before.items.find(item => item.id === id)!.node);
    expect(cues(after, id)[1]).toEqual(cues(before, id)[2]);
  }
  expect(cues(after, "en")[0].words).toEqual([...cues(before, "en")[0].words!, ...cues(before, "en")[1].words!]);
  expect(after.evidence).toEqual(before.evidence); expect(after.sources).toEqual(before.sources); expect(JSON.stringify(before)).toBe(saved);
  expect(await validateCaptionSegmentationReceipt(before, plan.commands, plan.receipt)).toEqual(plan.receipt);
});
it("splits with explicit text for every language and genuine source boundaries without inventing translated word clocks", async () => {
  const original = fixture(), merged = await prepareCaptionSegmentation(original, { operation: "merge", itemId: "en", cueId: "solid" });
  const before = executeVideoProjectCommands(original, merged.commands).document;
  const plan = await prepareCaptionSegmentation(before, { operation: "split", itemId: "ar", cueId: "solid", splitMs: 400, newCueId: "solid:manual:v1:tail",
    texts: { en: { before: "solid", after: "pace" }, zh: { before: "稳健", after: "的步伐。" }, ar: { before: "بوتيرة", after: "ثابتة." } } });
  const after = executeVideoProjectCommands(before, plan.commands).document;
  for (const id of ["en", "zh", "ar"]) expect(cues(after, id).map(cue => [cue.id, cue.startMs, cue.endMs])).toEqual([["solid", 0, 400], ["solid:manual:v1:tail", 400, 1200], ["number", 1200, 3000]]);
  expect(cues(after, "en")[0].words).toEqual(cues(original, "en")[0].words); expect(cues(after, "en")[1].words).toEqual(cues(original, "en")[1].words);
  expect(cues(after, "ar")[0].words).toBeUndefined(); expect(cues(after, "zh")[1].words).toBeUndefined(); expect(after.evidence).toEqual(original.evidence);
  expect(await validateCaptionSegmentationReceipt(before, plan.commands, plan.receipt)).toEqual(plan.receipt);
});
it.each(["locked", "different-cue", "different-time", "missing-parent", "different-source"])("rejects %s families before changing any language", async kind => {
  const doc = fixture(), translated = doc.items.find(item => item.id === "zh")!;
  if (kind === "locked") doc.tracks.find(track => track.id === "zh-track")!.locked = true;
  if (kind === "different-cue") translated.caption!.cues[0].id = "other";
  if (kind === "different-time") translated.caption!.cues[0].endMs = 399;
  if (kind === "missing-parent") translated.caption!.pairedItemId = "unrelated";
  if (kind === "different-source") translated.caption!.sourceItemId = undefined;
  const before = JSON.stringify(doc);
  await expect(prepareCaptionSegmentation(doc, { operation: "merge", itemId: "en", cueId: "solid" })).rejects.toThrow();
  expect(JSON.stringify(doc)).toBe(before);
});
it("requires explicit complete translated parts and rejects cuts through a supplied source word", async () => {
  const before = fixture();
  await expect(prepareCaptionSegmentation(before, { operation: "split", itemId: "en", cueId: "number", splitMs: 1600, newCueId: "new", texts: { en: { before: "twenty", after: "point five percent." } } })).rejects.toThrow(/every linked language/);
  await expect(prepareCaptionSegmentation(before, { operation: "split", itemId: "en", cueId: "number", splitMs: 1600, newCueId: "new", texts: { en: { before: "twenty", after: "point five percent." }, zh: { before: "百分之", after: "二十五点五。" }, ar: { before: "خمسة", after: "وعشرون ونصف بالمئة." } } })).rejects.toThrow(/between complete timed words/);
});
it("does not manufacture a missing timed-word array when merging editable display text", async () => {
  const before = fixture(); delete cues(before, "en")[1].words;
  const plan = await prepareCaptionSegmentation(before, { operation: "merge", itemId: "en", cueId: "solid" });
  const after = executeVideoProjectCommands(before, plan.commands).document;
  expect(cues(after, "en")[0].words).toBeUndefined(); expect(after.evidence).toEqual(before.evidence);
});
it("retains fractional source-bound word boundaries after a playback-rate edit", async () => {
  const original = fixture(), retimed = executeVideoProjectCommands(original, [{ type: "set", target: { kind: "node", itemId: "speech", nodeId: "speech" }, path: ["playbackRate"], value: 1.5 }]).document;
  const boundary = cues(retimed, "en")[0].endMs; expect(boundary % 1).not.toBe(0);
  const merged = await prepareCaptionSegmentation(retimed, { operation: "merge", itemId: "en", cueId: "solid" });
  const before = executeVideoProjectCommands(retimed, merged.commands).document;
  const plan = await prepareCaptionSegmentation(before, { operation: "split", itemId: "en", cueId: "solid", splitMs: boundary, newCueId: "fractional-tail",
    texts: { en: { before: "solid", after: "pace" }, zh: { before: "稳健", after: "的步伐。" }, ar: { before: "بوتيرة", after: "ثابتة." } } });
  await validateCaptionSegmentationReceipt(before, plan.commands, plan.receipt);
  const after = executeVideoProjectCommands(before, plan.commands).document;
  expect(cues(after, "en")[0].endMs).toBe(boundary); expect(cues(after, "en")[1].startMs).toBe(boundary); expect(after.evidence).toEqual(original.evidence);
});
it("records absent source provenance explicitly for standalone imported display captions", async () => {
  const document = fixture(); for (const item of document.items) if (item.caption) item.caption.sourceItemId = undefined;
  const plan = await prepareCaptionSegmentation(document, { operation: "merge", itemId: "en", cueId: "solid" });
  expect(plan.receipt.sourceItemId).toBeNull(); expect(plan.receipt.sourceRevision).toBeNull();
  await validateCaptionSegmentationReceipt(document, plan.commands, plan.receipt);
});
it("validates real effects rather than allowing a forged hash or unrelated command in segmentation audit metadata", async () => {
  const before = fixture(), plan = await prepareCaptionSegmentation(before, { operation: "merge", itemId: "en", cueId: "solid" });
  const forged = [...plan.commands, { type: "set" as const, target: { kind: "node" as const, itemId: "unrelated", nodeId: "unrelated" }, path: ["text"], value: "Forged" }];
  await expect(validateCaptionSegmentationReceipt(before, forged, { ...plan.receipt, commandsHash: await completionHash(forged) })).rejects.toThrow();
  await expect(validateCaptionSegmentationReceipt(before, plan.commands, { ...plan.receipt, asrEvidence: before.evidence })).rejects.toThrow();
  const changed = structuredClone(before); changed.items.find(item => item.id === "speech")!.node.videoStartTime = .5;
  await expect(validateCaptionSegmentationReceipt(changed, plan.commands, plan.receipt)).rejects.toThrow(/source timing changed/);
});
it("preserves later appearance edits and supports a rebased Undo without touching other items or source evidence", async () => {
  const before = fixture(), plan = await prepareCaptionSegmentation(before, { operation: "merge", itemId: "zh", cueId: "solid" });
  const current = executeVideoProjectCommands(before, [{ type: "set", target: { kind: "node", itemId: "en", nodeId: "en" }, path: ["style", "color"], value: "#2563eb" }, { type: "set", target: { kind: "node", itemId: "unrelated", nodeId: "unrelated" }, path: ["text"], value: "Manual title" }]).document;
  await validateCaptionSegmentationReceipt(current, plan.commands, plan.receipt);
  const after = executeVideoProjectCommands(current, plan.commands).document, inverse = buildVideoProjectRevertCommands(current, after);
  const later = executeVideoProjectCommands(after, [{ type: "set", target: { kind: "node", itemId: "zh", nodeId: "zh" }, path: ["style", "fontSize"], value: 38 }]).document;
  const undone = rebaseVideoProjectCommands(after, later, inverse); expect(undone.ok).toBe(true); if (!undone.ok) throw new Error(undone.reason);
  expect(cues(undone.document, "en")).toEqual(cues(before, "en")); expect(cues(undone.document, "ar")).toEqual(cues(before, "ar"));
  expect(undone.document.items.find(item => item.id === "en")!.node.style!.color).toBe("#2563eb");
  expect(undone.document.items.find(item => item.id === "zh")!.node.style!.fontSize).toBe(38);
  expect(undone.document.items.find(item => item.id === "unrelated")!.node.text).toBe("Manual title"); expect(undone.document.evidence).toEqual(before.evidence);
});
it("uses portable commands that match the current agent and manual command kernels", async () => {
  const document = fixture(), plan = await prepareCaptionSegmentation(document, { operation: "merge", itemId: "en", cueId: "solid" });
  const request = { contract: "video-project-commands", version: 1, baseRevision: 0, baseHash: await hashVideoProjectDocument(document), document, context: { selectedItemIds: [], playheadFrame: 0 } };
  const edit = { outcome: "proposal", summary: "Merge linked display cues", commands: plan.commands };
  const host = await compileNativeAgentResult(request, edit);
  const after = executeVideoProjectCommands(document, plan.commands).document;
  let manual = toEditorDocument(document);
  for (const command of plan.commands) {
    if (command.type !== "set" || command.target.kind !== "caption") throw new Error("Unexpected structure command");
    const itemId = command.target.itemId;
    const item = manual.items.find(item => item.id === itemId)!;
    manual = applyEditorCommand(manual, { type: "updateItem", id: item.id, patch: { caption: { ...item.caption!, cues: captionCueSchema.array().parse(command.value) } } });
  }
  expect(manual).toEqual(toEditorDocument(after));
  expect(host.proposal!.previewHash).toBe(await hashVideoProjectDocument(after));
});
it.each([["二十五点", "五个百分点。", "二十五点五个百分点。"], ["twenty point five", "percent.", "twenty point five percent."], ["بوتيرة", "ثابتة.", "بوتيرة ثابتة."], ["solid\n", "pace", "solid pace"]])("joins %s / %s as display text without adding number grammar", (left, right, expected) => {
  expect(joinCaptionDisplayText(left, right)).toBe(expected);
});
