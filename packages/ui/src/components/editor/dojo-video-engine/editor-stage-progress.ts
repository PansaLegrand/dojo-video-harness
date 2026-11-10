/** Bounded UI projection of the durable host summary. It cannot authorize a
 * continuation, settle a paid job or attest that edits reached the document. */
export type EditorStageStatus = "pending" | "running" | "waiting" | "completed" | "failed" | "cancelled";
export type EditorStageProgress = {
 version: 1; status: EditorStageStatus; completedStages: number; totalStages: number;
 items: Array<{ id: string; kind: string; status: EditorStageStatus; sourceItemId?: string; completedUnits: number; totalUnits: number; savedOutput: boolean; failure?: { code: string; message: string } }>;
 remainingRequirements: Array<{ id: string; kind: string }>;
 remainingBudget: { modelCalls: number; toolCalls: number; outputTokens: number; usageKnown: boolean; modelContinuationAvailable: boolean };
};
const statuses = new Set(["pending", "running", "waiting", "completed", "failed", "cancelled"]);
const record = (value: unknown): Record<string, unknown> | null => value !== null && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
const integer = (value: unknown, max = Number.MAX_SAFE_INTEGER) => Number.isSafeInteger(value) && Number(value) >= 0 && Number(value) <= max;
const text = (value: unknown, max = 191): value is string => typeof value === "string" && value.length > 0 && value.length <= max;
export function editorStageProgress(raw: unknown): EditorStageProgress | null {
 const value = record(raw); if (!value || value.version !== 1 || !statuses.has(String(value.status)) || !integer(value.totalStages, 64) || Number(value.totalStages) < 1 || !integer(value.completedStages, Number(value.totalStages)) || !Array.isArray(value.items) || value.items.length !== value.totalStages) return null;
 const ids = new Set<string>(), items: EditorStageProgress["items"] = [];
 for (const rawItem of value.items) {
  const item = record(rawItem); if (!item || !text(item.id) || ids.has(item.id) || !text(item.kind) || !statuses.has(String(item.status)) || !integer(item.totalUnits, 1_000_000) || Number(item.totalUnits) < 1 || !integer(item.completedUnits, Number(item.totalUnits)) || typeof item.savedOutput !== "boolean" || item.sourceItemId !== undefined && !text(item.sourceItemId)) return null;
  const failure = item.failure === undefined ? undefined : record(item.failure); if (item.failure !== undefined && (!failure || !text(failure.code) || !text(failure.message, 1000))) return null;
  ids.add(item.id); items.push({ id: item.id, kind: item.kind, status: item.status as EditorStageStatus, ...(typeof item.sourceItemId === "string" ? { sourceItemId: item.sourceItemId } : {}), completedUnits: Number(item.completedUnits), totalUnits: Number(item.totalUnits), savedOutput: item.savedOutput, ...(failure ? { failure: { code: String(failure.code), message: String(failure.message) } } : {}) });
 }
 if (items.filter(item => item.status === "completed").length !== value.completedStages || !Array.isArray(value.remainingRequirements) || value.remainingRequirements.length > 100) return null;
 const remainingRequirements: EditorStageProgress["remainingRequirements"] = [], requirements = new Set<string>();
 for (const rawRequirement of value.remainingRequirements) { const requirement = record(rawRequirement); if (!requirement || !text(requirement.id) || !text(requirement.kind) || requirements.has(requirement.id)) return null; requirements.add(requirement.id); remainingRequirements.push({ id: requirement.id, kind: requirement.kind }); }
 const budget = record(value.remainingBudget); if (!budget || ![budget.modelCalls, budget.toolCalls, budget.outputTokens].every(value => integer(value)) || typeof budget.usageKnown !== "boolean" || typeof budget.modelContinuationAvailable !== "boolean") return null;
 return { version: 1, status: value.status as EditorStageStatus, completedStages: Number(value.completedStages), totalStages: Number(value.totalStages), items, remainingRequirements, remainingBudget: { modelCalls: Number(budget.modelCalls), toolCalls: Number(budget.toolCalls), outputTokens: Number(budget.outputTokens), usageKnown: budget.usageKnown, modelContinuationAvailable: budget.modelContinuationAvailable } };
}
export function editorStageBudgetState(progress: EditorStageProgress): "unknown" | "available" | "exhausted" | "stopped" | "finished" {
 if (progress.status === "completed") return "finished";
 if (!progress.remainingBudget.usageKnown) return "unknown";
 if ([progress.remainingBudget.modelCalls, progress.remainingBudget.toolCalls, progress.remainingBudget.outputTokens].some(value => value === 0)) return "exhausted";
 return progress.remainingBudget.modelContinuationAvailable ? "available" : "stopped";
}
