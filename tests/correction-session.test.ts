import { compileNativeAgentResult } from "../packages/core/src/lib/video-project/agent-runtime";
import { hashVideoProjectDocument } from "../packages/core/src/lib/video-project/document";
import { it, expect } from "vitest";
import { runCorrectionSession } from "../evals/agent/correction-session";
import {
  correctionFixture,
  referenceCorrection,
  gradeCorrection,
  allNodes,
} from "../evals/agent/corrections";
import { executeVideoProjectCommands } from "../packages/core/src/lib/video-project/commands";

it.each([false, true])(
  "preserves implicit follow-up context with no selection/reference (other text: %s)",
  async (distractor) => {
    const inputs: any[] = [];
    const result = await runCorrectionSession({
      distractor,
      onMessages(messages, turn) {
        inputs[turn] = JSON.parse(
          messages.find((m) => m.role === "user")!.content as string,
        );
      },
    });
    expect(result, JSON.stringify(result)).toMatchObject({ passed: true });
    for (const [turn, input] of inputs.entries()) {
      expect(input.context.selectedItemIds).toEqual([]);
      expect(input.authoring.reference).toBeUndefined();
      if (turn > 0) {
        expect(
          input.conversation.some((message: any) =>
            message.text.includes("Hello"),
          ),
        ).toBe(true);
        expect(
          input.document.items.some(
            (item: any) => item.id === result.target!.itemId,
          ),
        ).toBe(true);
      }
    }
  },
);
it("rejects replaced identity, collateral edits, changed wording, and no-op corrections", async () => {
  const before = correctionFixture(true);
  const proposal = await compileNativeAgentResult(
    {
      contract: "video-project-commands",
      version: 1,
      baseRevision: 0,
      baseHash: await hashVideoProjectDocument(before),
      document: before,
      context: { selectedItemIds: [], playheadFrame: 75 },
    },
    { summary: "Add Hello", commands: referenceCorrection(before, 0) },
  );
  const created = executeVideoProjectCommands(
    before,
    proposal.proposal!.commands,
  ).document;
  const target = gradeCorrection(before, created, 0);
  const redProposal = await compileNativeAgentResult(
    {
      contract: "video-project-commands",
      version: 1,
      baseRevision: 1,
      baseHash: await hashVideoProjectDocument(created),
      document: created,
      context: { selectedItemIds: [], playheadFrame: 75 },
    },
    {
      summary: "Make it red",
      commands: referenceCorrection(created, 1, target),
    },
  );
  const red = executeVideoProjectCommands(
    created,
    redProposal.proposal!.commands,
  ).document;
  expect(() => gradeCorrection(created, red, 1, target)).not.toThrow();
  for (const mutate of [
    (d: typeof red) => {
      d.items.find((item) => item.id === target.itemId)!.id = "replacement";
    },
    (d: typeof red) => {
      d.items.find((item) => item.id === "existing-label")!.node.style!.color =
        "red";
    },
    (d: typeof red) => {
      allNodes(d.items.find((item) => item.id === target.itemId)!.node).find(
        (node) => node.id === target.textId,
      )!.text = "Goodbye";
    },
    (d: typeof red) => {
      d.format.backgroundColor = "yellow";
    },
    (d: typeof red) => {
      d.items.push(structuredClone(d.items.at(-1)!));
    },
  ]) {
    const broken = structuredClone(red);
    mutate(broken);
    expect(() => gradeCorrection(created, broken, 1, target)).toThrow();
  }
  expect(() => gradeCorrection(created, created, 1, target)).toThrow();
});

import { gradeCorrectionPixels } from "../evals/agent/correction-pixels";
it("pixel oracle rejects a font-size-only change that shrink-to-fit renders at the old size", () => {
  const frames = [
    { red: { count: 0, width: 0, height: 0 }, yellow: 0 },
    { red: { count: 100, width: 60, height: 20 }, yellow: 0 },
    { red: { count: 100, width: 60, height: 20 }, yellow: 800 },
    { red: { count: 150, width: 78, height: 26 }, yellow: 900 },
  ];
  expect(() => gradeCorrectionPixels(frames)).not.toThrow();
  expect(() =>
    gradeCorrectionPixels([...frames.slice(0, 3), frames[2]]),
  ).toThrow(/grow/);
  expect(() => gradeCorrectionPixels(frames.slice(0, 3))).toThrow(/every turn/);
  expect(() =>
    gradeCorrectionPixels(
      frames.map((f, i) => (i === 2 ? { ...f, yellow: 0 } : f)),
    ),
  ).toThrow(/Yellow background/);
});
