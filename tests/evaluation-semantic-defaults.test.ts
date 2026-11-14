import { expect, it } from "vitest";
import { fixture } from "../evals/agent/scenarios";
import { extendedScenarios } from "../evals/agent/extended-scenarios";
import { gradeEdit } from "../evals/agent/grading";
import { assertIndependentOutcome } from "../evals/agent/oracles";
import { canonicalEvaluationDocument } from "../evals/agent/semantic-defaults";
const basis = () => {
  const before = fixture(), after = structuredClone(before);
  after.items[0].node.duration = 150;
  after.items.find(item => item.id === "bed")!.node.volume = 0.25;
  after.items.find(item => item.id === "title")!.node.text = "Intro";
  return { before, after };
};
const grade = (before: ReturnType<typeof fixture>, after: ReturnType<typeof fixture>) => {
  gradeEdit(before, after, extendedScenarios.find(scenario => scenario.id === "compound-request")!.turns[0].reference);
  assertIndependentOutcome(before, after, "compound-request");
};
it("equates only absent media source starts with zero in both independent and command-result graders", () => {
  const { before, after } = basis();
  expect(() => grade(before, after)).not.toThrow();
  after.items[0].node.videoStartTime = 0;
  after.items.find(item => item.id === "bed")!.node.audioStartTime = 0;
  expect(() => grade(before, after)).not.toThrow();
  expect(before.items[0].node.videoStartTime).toBeUndefined();
});
it.each(["offset", "duration", "start", "rate", "other-text", "null", "audio-offset", "nested-state"])("still rejects %s changes", kind => {
  const { before, after } = basis();
  if (kind === "offset") after.items[0].node.videoStartTime = 1 / 30;
  if (kind === "duration") after.items[0].node.duration = 149;
  if (kind === "start") after.items[0].node.from = 1;
  if (kind === "rate") after.items[0].node.playbackRate = 2;
  if (kind === "other-text") after.items.find(item => item.id === "subtitle")!.node.text = "Unrequested";
  if (kind === "null") (after.items[0].node as any).videoStartTime = null;
  if (kind === "audio-offset") after.items.find(item => item.id === "bed")!.node.audioStartTime = 1 / 30;
  if (kind === "nested-state") after.items[0].node.children!.push({ ...structuredClone(before.items[0].node), id: "nested", videoStartTime: 1 });
  expect(() => grade(before, after)).toThrow();
  expect(() => assertIndependentOutcome(before, after, "compound-request")).toThrow();
});
it("does not invent defaults for text, unresolved assets, explicit null or change nested nonzero starts", () => {
  const doc = fixture();
  (doc.items[0].node as any).videoStartTime = null;
  doc.items[0].node.children!.push({ ...structuredClone(doc.items[0].node), id: "nested", videoStartTime: 7 });
  doc.items.find(item => item.id === "bed")!.node.assetId = "missing";
  const result = canonicalEvaluationDocument(doc);
  expect(result.items[0].node.videoStartTime).toBeNull();
  expect(result.items[0].node.children![0].videoStartTime).toBe(7);
  expect(result.items.find(item => item.id === "bed")!.node.audioStartTime).toBeUndefined();
  expect(result.items.find(item => item.id === "title")!.node.videoStartTime).toBeUndefined();
});
