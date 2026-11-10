import { expect, it } from "vitest";
import {
  createEditStagePlan,
  completionHash,
  editStageProgress,
  transitionEditStagePlan,
} from "../packages/agent-kit/src/index";
it("projects uncertain paid usage without inventing zero tokens or advertising a continuation", async () => {
  const hash = "sha256:" + "a".repeat(64),
    instruction = "Complete every requested source caption";
  let plan = await createEditStagePlan({
    id: "plan",
    binding: {
      projectId: "project",
      runId: "run",
      baseHash: hash,
      instructionHash: await completionHash(instruction),
      scopeHash: hash,
      sourceHash: hash,
      profile: "commercial-editing-v7",
      modelIdentity: "fixed-model",
    },
    instruction,
    requirements: [{ id: "caption", kind: "item_present", itemId: "caption" }],
    limits: {
      modelCalls: 32,
      toolCalls: 64,
      outputTokens: 32000,
      attempts: 64,
      expiresAt: "2099-01-01T00:00:00.000Z",
    },
    stages: [
      {
        id: "caption",
        kind: "caption_batch",
        execution: "model",
        dependencies: [],
        inputs: [],
      },
    ],
  });
  const next = async (event: Parameters<typeof transitionEditStagePlan>[1]) => {
    plan = (
      await transitionEditStagePlan(plan, event, {
        expectedRevision: plan.revision,
        now: "2026-11-10T00:00:00.000Z",
      })
    ).plan;
  };
  await next({
    type: "claim",
    operationId: "claim",
    stageId: "caption",
    attemptId: "attempt",
    checkpointId: "checkpoint",
  });
  await next({
    type: "record_usage",
    operationId: "known-usage",
    stageId: "caption",
    attemptId: "attempt",
    usage: {
      modelCalls: 2,
      toolCalls: 3,
      inputTokens: 500,
      outputTokens: 800,
      usageKnown: true,
    },
  });
  expect(editStageProgress(plan).remainingBudget).toMatchObject({
    modelCalls: 30,
    toolCalls: 61,
    outputTokens: 31200,
    usageKnown: true,
    modelContinuationAvailable: true,
  });
  await next({
    type: "fail",
    operationId: "uncertain-provider-fence",
    stageId: "caption",
    attemptId: "attempt",
    failure: {
      code: "UNKNOWN_OUTCOME",
      message:
        "The model request may have been accepted. Reconcile the saved response before continuing.",
    },
  });
  const before = JSON.stringify(plan),
    progress = editStageProgress(plan);
  expect(progress.remainingBudget).toEqual({
    modelCalls: 30,
    toolCalls: 61,
    outputTokens: 31200,
    usageKnown: false,
    modelContinuationAvailable: false,
  });
  expect(progress.items[0].failure?.code).toBe("UNKNOWN_OUTCOME");
  expect(JSON.stringify(plan)).toBe(before);
  expect(plan.usage).toMatchObject({
    inputTokens: 500,
    outputTokens: 800,
    usageKnown: true,
  });
});
