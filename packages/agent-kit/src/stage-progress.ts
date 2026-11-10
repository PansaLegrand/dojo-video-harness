import type { EditStagePlan, EditStageStatus } from "./stages.js";
export type EditStageProgress = {
  version: 1;
  status: EditStageStatus;
  completedStages: number;
  totalStages: number;
  items: Array<{
    id: string;
    kind: string;
    status: EditStageStatus;
    sourceItemId?: string;
    completedUnits: number;
    totalUnits: number;
    savedOutput: boolean;
    failure?: { code: string; message: string };
  }>;
  remainingRequirements: Array<{ id: string; kind: string }>;
  remainingBudget: {
    modelCalls: number;
    toolCalls: number;
    outputTokens: number;
    usageKnown: boolean;
    modelContinuationAvailable: boolean;
  };
};
/** Saved work and application are distinct. This summary never attests that the
 * project was applied, a provider job settled or an export was published. */
export function editStageProgress(
  plan: EditStagePlan,
  now = Date.now(),
): EditStageProgress {
  const remainingBudget = {
    modelCalls: Math.max(0, plan.limits.modelCalls - plan.usage.modelCalls),
    toolCalls: Math.max(0, plan.limits.toolCalls - plan.usage.toolCalls),
    outputTokens: Math.max(
      0,
      plan.limits.outputTokens - plan.usage.outputTokens,
    ),
    usageKnown:
      plan.usage.usageKnown &&
      !plan.stages.some((stage) => stage.failure?.code === "UNKNOWN_OUTCOME"),
    modelContinuationAvailable: false,
  };
  remainingBudget.modelContinuationAvailable =
    !["failed", "cancelled", "completed"].includes(plan.status) &&
    now < Date.parse(plan.limits.expiresAt) &&
    remainingBudget.usageKnown &&
    remainingBudget.modelCalls > 0 &&
    remainingBudget.toolCalls > 0 &&
    remainingBudget.outputTokens > 0;
  return {
    version: 1,
    status: plan.status,
    completedStages: plan.stages.filter((stage) => stage.status === "completed")
      .length,
    totalStages: plan.stages.length,
    items: plan.stages.map((stage) => {
      let totalUnits = 1;
      if (stage.kind === "caption_batch") {
        for (const evidence of plan.stages.filter(
          (stage) => stage.kind === "evidence",
        )) {
          const manifest = evidence.descriptor?.manifest as
            | {
                manifestHash?: string;
                batches?: Array<{ id: string; count: number }>;
              }
            | undefined;
          if (
            manifest &&
            manifest.manifestHash === stage.descriptor?.manifestHash
          )
            totalUnits =
              manifest.batches?.find(
                (batch) => batch.id === stage.descriptor?.batchId,
              )?.count ?? 1;
        }
      }
      return {
        id: stage.id,
        kind: stage.kind,
        status: stage.status,
        ...(stage.sourceItemId ? { sourceItemId: stage.sourceItemId } : {}),
        totalUnits,
        completedUnits: stage.outputs.length ? totalUnits : 0,
        savedOutput: stage.outputs.length > 0,
        ...(stage.failure ? { failure: stage.failure } : {}),
      };
    }),
    remainingRequirements:
      plan.status === "completed"
        ? []
        : plan.requirements.map(({ id, kind }) => ({ id, kind })),
    remainingBudget,
  };
}
