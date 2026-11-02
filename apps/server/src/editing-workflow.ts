import { createHash, randomUUID } from "node:crypto";
import { z } from "zod/v3";
import { ProjectStore, HttpError, message, runOf, type Project } from "./store";
import {
  canonicalSerialize,
  hashVideoProjectDocument,
  parseVideoProjectDocument,
  type VideoProjectDocument,
  type VideoTranscriptEvidence,
} from "../../../packages/core/src/lib/video-project/document";
import {
  executeVideoProjectCommands,
  type VideoProjectCommand,
} from "../../../packages/core/src/lib/video-project/commands";
import {
  captionSourceCommands,
  transcriptEvidenceFromAsr,
} from "../../../packages/core/src/lib/video-project/semantic";
import { compileVideoProjectDocument } from "../../../packages/core/src/lib/video-project/compilation";
import type { AgentTool } from "../../../packages/agent/src/tools";

export const editingWorkflowInput = z
  .object({
    clipIds: z.array(z.string().min(1).max(191)).min(1).max(12),
    logoAssetId: z.string().min(1).max(191).optional(),
    generateCaptions: z.boolean(),
    sourceLanguage: z.string().min(1).max(20).default("auto"),
    translationLanguage: z.string().min(1).max(50).optional(),
    exportVideo: z.boolean(),
  })
  .strict();
export type EditingWorkflowInput = z.infer<typeof editingWorkflowInput>;
export type WorkflowTaskReceipt = {
  id: string;
  project_id?: string;
  asset_id?: string;
  sourceHash?: string;
  status: string;
  operationId?: string;
  requestHash?: string;
  target_language?: string;
  raw_asr_result?: unknown;
  output_subtitle_data?: unknown;
};
export type EditingWorkflow = {
  id: string;
  runId: string;
  input: EditingWorkflowInput;
  requestHash: string;
  baseRevision: number;
  baseHash: string;
  status:
    | "awaiting_approval"
    | "approved"
    | "awaiting_review"
    | "cancelled"
    | "exported";
  sources: Array<{
    assetId: string;
    sourceId: string;
    name: string;
    fingerprint: string;
    byteLength: number;
    requestId: string;
  }>;
  translations: Record<string, string>;
  asr?: Array<{ assetId: string; taskId: string }>;
  completionHash?: string;
  exportId?: string;
  createdAt: string;
};
type WorkflowProject = Project & {
  editingWorkflows?: Record<string, EditingWorkflow>;
};
const plans = (p: Project) => ((p as WorkflowProject).editingWorkflows ??= {});
const getPlan = (p: Project, id: string) => {
  const plan = plans(p)[id];
  if (!plan) throw new HttpError("Editing workflow not found.", 404);
  return plan;
};
const asrSchema = z
  .object({
    asr: z
      .array(
        z.object({ assetId: z.string(), taskId: z.string().uuid() }).strict(),
      )
      .max(12),
  })
  .strict();
const completedSchema = asrSchema
  .extend({
    translations: z
      .array(
        z.object({ itemId: z.string(), taskId: z.string().uuid() }).strict(),
      )
      .max(12),
  })
  .strict();
export const workflowCaptionId = (planId: string, itemId: string) =>
  `workflow:${planId}:caption:${createHash("sha256").update(itemId).digest("hex").slice(0, 16)}`;
export function workflowUtterances(
  cues: Array<{ text: string; startMs: number; endMs: number }>,
) {
  return cues.map((cue, index) => ({
    text: cue.text,
    index,
    start_time_ms: Math.round(cue.startMs),
    end_time_ms: Math.round(cue.endMs),
  }));
}

/** Pure native commands: existing clips keep their source offsets/rates; all unrelated items survive. */
export function assembleWorkflowCandidate(
  base: VideoProjectDocument,
  plan: Pick<EditingWorkflow, "id" | "input">,
  evidence: VideoTranscriptEvidence[] = [],
) {
  let document = base;
  const commands: VideoProjectCommand[] = [];
  const add = (batch: VideoProjectCommand[]) => {
    document = executeVideoProjectCommands(document, batch).document;
    commands.push(...batch);
  };
  let from = 0;
  for (const id of plan.input.clipIds) {
    const item = document.items.find((x) => x.id === id);
    if (!item || item.node.type !== "video" || !item.node.duration)
      throw new HttpError("Choose existing video clips with known durations.");
    add([{ type: "moveItem", id, from }]);
    from += item.node.duration;
  }
  // The requested sequence sets the minimum duration; preserve later unrelated media.
  const duration = Math.max(
    from,
    ...document.items.map((x) => (x.node.from ?? 0) + (x.node.duration ?? 0)),
  );
  if (document.format.durationInFrames !== duration)
    add([
      {
        type: "set",
        target: { kind: "format" },
        path: ["durationInFrames"],
        value: duration,
      },
    ]);
  if (plan.input.logoAssetId) {
    const logo = document.assets[plan.input.logoAssetId];
    if (!logo || logo.type !== "image")
      throw new HttpError("Choose an imported image for the logo.");
    const id = `workflow:${plan.id}:logo`;
    const width = Math.round(document.format.width * 0.18),
      height = Math.round((width * (logo.height ?? 1)) / (logo.width ?? 1));
    add([
      {
        type: "addItem",
        item: {
          id,
          name: "Workflow logo",
          trackId: "visual",
          node: {
            id,
            type: "img",
            assetId: logo.id,
            from: 0,
            duration: from,
            style: {
              position: "absolute",
              left: Math.round(document.format.width * 0.04),
              top: Math.round(document.format.height * 0.04),
              width,
              height,
              objectFit: "contain",
              zIndex: 80,
            },
          },
        },
      },
    ]);
  }
  for (const item of evidence)
    if (!document.evidence[item.id])
      add([{ type: "addEvidence", evidence: item }]);
  const captions: Array<{
    itemId: string;
    cues: Array<{ text: string; startMs: number; endMs: number }>;
  }> = [];
  if (plan.input.generateCaptions)
    for (const id of plan.input.clipIds) {
      const clip = document.items.find((x) => x.id === id)!;
      const transcript = evidence.find(
        (x) => x.sourceAssetId === clip.node.assetId,
      );
      if (!transcript)
        throw new HttpError(
          "A completed source transcript is required for every clip.",
        );
      const itemId = workflowCaptionId(plan.id, id);
      add(
        captionSourceCommands(document, {
          sourceItemId: id,
          evidenceId: transcript.id,
          itemId,
          trackId: "visual",
          preset: "classic",
        }),
      );
      captions.push({
        itemId,
        cues: document.items.find((x) => x.id === itemId)!.caption!.cues,
      });
    }
  return { document, commands, captions };
}

export class EditingWorkflowService {
  constructor(
    private store: ProjectStore,
    private getTask: (id: string) => WorkflowTaskReceipt | undefined,
  ) {}
  async list(projectId: string) {
    const p = await this.store.read(projectId);
    return Promise.all(
      Object.values(plans(p))
        .slice(-20)
        .map(async (plan) => {
          const run = runOf(p, plan.runId);
          const applied = run.appliedAfter;
          const revision = applied
            ? Object.entries(p.versions).find(
                ([, document]) =>
                  canonicalSerialize(document) === canonicalSerialize(applied),
              )?.[0]
            : undefined;
          return {
            ...plan,
            runStatus: run.status,
            ...(applied && revision !== undefined
              ? {
                  applied: {
                    revision: Number(revision),
                    documentHash: await hashVideoProjectDocument(applied),
                  },
                }
              : {}),
          };
        }),
    );
  }
  async create(projectId: string, runId: string, raw: unknown) {
    const input = editingWorkflowInput.parse(raw),
      requestHash = canonicalSerialize(input);
    return this.store.transaction(projectId, (p) => {
      const prior = plans(p)[runId];
      if (prior) {
        if (prior.requestHash !== requestHash)
          throw new HttpError(
            "This run already has a different workflow.",
            409,
          );
        return prior;
      }
      const run = runOf(p, runId);
      if (run.status !== "running")
        throw new HttpError(
          "Agent run is no longer preparing a workflow.",
          409,
        );
      if (run.scope?.kind !== "project")
        throw new HttpError(
          "A multi-clip workflow requires project scope. Ask the user to change scope.",
        );
      if (p.revision !== run.baseRevision || p.documentHash !== run.baseHash)
        throw new HttpError(
          "Project changed while preparing the workflow.",
          409,
        );
      if (new Set(input.clipIds).size !== input.clipIds.length)
        throw new HttpError("Choose each clip once.");
      if (input.translationLanguage && !input.generateCaptions)
        throw new HttpError(
          "Caption translation requires generated captions in this workflow.",
        );
      const sources: EditingWorkflow["sources"] = [];
      for (const id of input.clipIds) {
        const clip = p.document.items.find((x) => x.id === id);
        if (
          !clip ||
          clip.node.type !== "video" ||
          !clip.node.assetId ||
          !clip.node.duration
        )
          throw new HttpError(
            "Choose existing video clips with known durations.",
          );
        if (p.document.tracks.find((t) => t.id === clip.trackId)?.locked)
          throw new HttpError("Unlock the selected video track first.");
        if (
          input.generateCaptions &&
          p.document.items.some((x) => x.caption?.sourceItemId === id)
        )
          throw new HttpError(
            "This workflow creates new captions. Use clips without existing linked captions.",
          );
        if (
          input.generateCaptions &&
          !sources.some((x) => x.assetId === clip.node.assetId)
        ) {
          const source = p.sources.find(
            (x) =>
              x.sourceId === clip.node.assetId ||
              x.assetId === clip.node.assetId,
          );
          if (!source || source.byteLength > 25 * 1024 * 1024)
            throw new HttpError(
              "Each speech source must be registered and at most 25 MiB for the configured ASR adapter.",
            );
          sources.push({
            assetId: clip.node.assetId,
            sourceId: source.sourceId,
            name: p.document.assets[clip.node.assetId]?.name ?? source.fileName,
            fingerprint: source.fingerprint,
            byteLength: source.byteLength,
            requestId: randomUUID(),
          });
        }
      }
      const plan: EditingWorkflow = {
        id: runId,
        runId,
        input,
        requestHash,
        baseRevision: p.revision,
        baseHash: p.documentHash,
        status: "awaiting_approval",
        sources,
        translations: Object.fromEntries(
          input.clipIds.map((id) => [
            workflowCaptionId(runId, id),
            randomUUID(),
          ]),
        ),
        createdAt: new Date().toISOString(),
      };
      // Validate join/overlay before asking for provider consent.
      assembleWorkflowCandidate(p.document, {
        ...plan,
        input: { ...input, generateCaptions: false },
      });
      plans(p)[plan.id] = plan;
      return plan;
    });
  }
  async authorizeProviderRequest(projectId: string, requestId: string) {
    const p = await this.store.read(projectId);
    const plan = Object.values(plans(p)).find(
      (plan) =>
        plan.sources.some((source) => source.requestId === requestId) ||
        Object.values(plan.translations).includes(requestId),
    );
    if (
      plan &&
      (plan.status !== "approved" ||
        runOf(p, plan.runId).status !== "completed")
    )
      throw new HttpError(
        "This workflow no longer authorizes provider work.",
        409,
      );
  }
  async approve(projectId: string, id: string, raw: unknown) {
    const v = z
      .object({
        baseRevision: z.number().int(),
        baseHash: z.string(),
        sourceConsent: z.literal(true),
      })
      .strict()
      .parse(raw);
    return this.store.transaction(projectId, (p) => {
      const plan = getPlan(p, id);
      if (
        ["cancelled", "failed", "stale", "applied"].includes(
          runOf(p, plan.runId).status,
        )
      )
        throw new HttpError("Agent run is no longer actionable.", 409);
      if (plan.status === "cancelled")
        throw new HttpError("Workflow cancelled.", 409);
      if (
        v.baseRevision !== plan.baseRevision ||
        v.baseHash !== plan.baseHash ||
        p.documentHash !== plan.baseHash ||
        p.revision !== plan.baseRevision
      )
        throw new HttpError(
          "Project changed. Ask for a new workflow before sending media.",
          409,
        );
      if (["queued", "running"].includes(runOf(p, plan.runId).status))
        throw new HttpError(
          "Wait for the agent to finish preparing its plan.",
          409,
        );
      if (plan.status === "awaiting_approval") plan.status = "approved";
      return plan;
    });
  }
  private async candidate(
    p: Project,
    plan: EditingWorkflow,
    asr: Array<{ assetId: string; taskId: string }>,
  ) {
    if (
      ["cancelled", "failed", "stale", "applied"].includes(
        runOf(p, plan.runId).status,
      )
    )
      throw new HttpError("Agent run is no longer actionable.", 409);
    if (plan.status !== "approved" && plan.status !== "awaiting_review")
      throw new HttpError("Approve this workflow before continuing.", 409);
    if (
      asr.length !== plan.sources.length ||
      new Set(asr.map((x) => x.assetId)).size !== asr.length
    )
      throw new HttpError("Provide exactly the planned source receipts.");
    const evidence: VideoTranscriptEvidence[] = [];
    for (const source of plan.sources) {
      const receipt = asr.find((x) => x.assetId === source.assetId),
        task = receipt ? this.getTask(receipt.taskId) : undefined;
      if (
        !task ||
        task.status !== "completed" ||
        task.project_id !== p.id ||
        task.asset_id !== source.sourceId ||
        task.sourceHash !== source.fingerprint ||
        task.operationId !== `asr:${p.id}:${source.requestId}`
      )
        throw new HttpError(
          "ASR receipt does not match this approved source request.",
        );
      evidence.push(
        await transcriptEvidenceFromAsr(
          runOf(p, plan.runId).request.document as VideoProjectDocument,
          source.assetId,
          task.raw_asr_result,
          task.id,
        ),
      );
    }
    if (plan.asr && canonicalSerialize(plan.asr) !== canonicalSerialize(asr))
      throw new HttpError("Completed workflow receipts cannot change.", 409);
    plan.asr = asr;
    return assembleWorkflowCandidate(
      runOf(p, plan.runId).request.document as VideoProjectDocument,
      plan,
      evidence,
    );
  }
  async captions(projectId: string, id: string, raw: unknown) {
    const v = asrSchema.parse(raw);
    return this.store.transaction(projectId, async (p) => {
      const plan = getPlan(p, id);
      const result = await this.candidate(p, plan, v.asr);
      return {
        captions: result.captions,
        translationRequests: plan.translations,
      };
    });
  }
  async complete(projectId: string, id: string, raw: unknown) {
    const v = completedSchema.parse(raw),
      hash = canonicalSerialize(v);
    return this.store.transaction(projectId, async (p) => {
      const plan = getPlan(p, id);
      if (plan.completionHash) {
        if (plan.completionHash !== hash)
          throw new HttpError("Workflow completion changed.", 409);
        return plan;
      }
      const result = await this.candidate(p, plan, v.asr);
      if (
        v.translations.length !==
          (plan.input.translationLanguage ? result.captions.length : 0) ||
        new Set(v.translations.map((x) => x.itemId)).size !==
          v.translations.length
      )
        throw new HttpError(
          "Provide exactly the requested translation receipts.",
        );
      for (const caption of result.captions) {
        if (!plan.input.translationLanguage) continue;
        const receipt = v.translations.find((x) => x.itemId === caption.itemId),
          task = receipt ? this.getTask(receipt.taskId) : undefined;
        const utterances = workflowUtterances(caption.cues);
        let request: unknown;
        try {
          request = JSON.parse(task?.requestHash ?? "{}").v;
        } catch {}
        const expected = {
          project_id: projectId,
          request_id: plan.translations[caption.itemId],
          target_language: plan.input.translationLanguage,
          utterances,
        };
        if (
          !task ||
          task.status !== "completed" ||
          task.project_id !== projectId ||
          task.operationId !==
            `translation:${projectId}:${expected.request_id}` ||
          canonicalSerialize(request) !== canonicalSerialize(expected)
        )
          throw new HttpError(
            "Translation receipt does not match the original caption text and timing.",
          );
        const parsedOutput = z
          .object({
            utterances: z
              .array(
                z
                  .object({
                    text: z.string().max(4000),
                    index: z.number().int(),
                    start_time_ms: z.number().finite(),
                    end_time_ms: z.number().finite(),
                  })
                  .strict(),
              )
              .max(500),
          })
          .strict()
          .safeParse(task.output_subtitle_data);
        const output = parsedOutput.success
          ? parsedOutput.data.utterances
          : undefined;
        if (
          !output ||
          output.length !== utterances.length ||
          output.some(
            (x, i) =>
              typeof x.text !== "string" ||
              x.index !== i ||
              x.start_time_ms !== utterances[i].start_time_ms ||
              x.end_time_ms !== utterances[i].end_time_ms,
          )
        )
          throw new HttpError(
            "Translation changed caption identity or timing.",
          );
        const item = result.document.items.find(
          (x) => x.id === caption.itemId,
        )!;
        const translated = {
          ...item.caption!,
          language: plan.input.translationLanguage,
          role: "translation" as const,
          mode: "sentence" as const,
          cues: item.caption!.cues.map((cue, i) => ({
            id: cue.id,
            text: output[i].text,
            startMs: cue.startMs,
            endMs: cue.endMs,
          })),
        };
        const command = result.commands.find(
          (c) => c.type === "addItem" && c.item.id === item.id,
        );
        if (!command || command.type !== "addItem")
          throw new HttpError("Missing workflow caption insertion.");
        command.item.caption = translated;
        result.document = executeVideoProjectCommands(
          parseVideoProjectDocument(runOf(p, plan.runId).request.document),
          result.commands,
        ).document;
      }
      compileVideoProjectDocument(
        result.document,
        Object.fromEntries(
          Object.keys(result.document.assets).map((key) => [
            key,
            `asset:${key}`,
          ]),
        ),
      );
      const run = runOf(p, plan.runId);
      if (run.status === "cancelled")
        throw new HttpError("Agent run cancelled.", 409);
      run.proposal = {
        summary: "Join clips, place the logo and prepare captions",
        commands: result.commands,
        changedItemIds: result.document.items
          .filter(
            (x) =>
              canonicalSerialize(x) !==
              canonicalSerialize(
                parseVideoProjectDocument(run.request.document).items.find(
                  (before) => before.id === x.id,
                ),
              ),
          )
          .map((x) => x.id),
        impact: "review",
        previewHash: await hashVideoProjectDocument(result.document),
      };
      run.status = "awaiting_review";
      run.phase = "workflow_ready";
      run.updatedAt = new Date().toISOString();
      message(
        p,
        run.id,
        "assistant",
        "Your complete workflow is ready to compare and apply. Export is available after approval.",
      );
      plan.status = "awaiting_review";
      plan.completionHash = hash;
      return plan;
    });
  }
  async cancel(projectId: string, id: string) {
    return this.store.transaction(projectId, (p) => {
      const plan = getPlan(p, id);
      if (runOf(p, plan.runId).status === "applied")
        throw new HttpError("Use undo for an applied workflow.", 409);
      plan.status = "cancelled";
      const run = runOf(p, plan.runId);
      run.status = "cancelled";
      run.phase = "cancelled";
      return { cancelled: true };
    });
  }
  async exported(projectId: string, id: string, raw: unknown) {
    const v = z.object({ exportId: z.string().uuid() }).strict().parse(raw);
    return this.store.transaction(projectId, async (p) => {
      const plan = getPlan(p, id),
        run = runOf(p, plan.runId),
        receipt = p.exports?.[v.exportId];
      const appliedRevision = run.appliedAfter
        ? Object.entries(p.versions).find(
            ([, document]) =>
              canonicalSerialize(document) ===
              canonicalSerialize(run.appliedAfter),
          )?.[0]
        : undefined;
      if (
        !plan.input.exportVideo ||
        run.status !== "applied" ||
        !run.appliedAfter ||
        !receipt ||
        receipt.status !== "completed" ||
        appliedRevision === undefined ||
        receipt.profile.documentRevision !== Number(appliedRevision) ||
        receipt.documentHash !==
          (await hashVideoProjectDocument(run.appliedAfter))
      )
        throw new HttpError(
          "Export must match the applied workflow revision.",
          409,
        );
      if (plan.exportId && plan.exportId !== v.exportId)
        throw new HttpError("Workflow export already completed.", 409);
      plan.exportId = v.exportId;
      plan.status = "exported";
      return plan;
    });
  }
  tool(projectId: string, runId: string): AgentTool {
    return {
      name: "prepare_editing_workflow",
      effect: "ask",
      description:
        "Prepare ONE reviewed multi-step workflow for joining existing video clips, overlaying an imported logo, generating source-bound captions, translating them, then exporting. This only creates a plan. The user explicitly approves provider/media access, then compares/applies the resulting proposal before export. Use exact existing clip/image asset IDs; never claim jobs or exports are already done.",
      parameters: {
        type: "object",
        properties: {
          clipIds: {
            type: "array",
            items: { type: "string" },
            minItems: 1,
            maxItems: 12,
          },
          logoAssetId: { type: "string" },
          generateCaptions: { type: "boolean" },
          sourceLanguage: { type: "string" },
          translationLanguage: { type: "string" },
          exportVideo: { type: "boolean" },
        },
        required: ["clipIds", "generateCaptions", "exportVideo"],
        additionalProperties: false,
      },
      execute: async (args) => {
        const plan = await this.create(projectId, runId, args);
        const p = await this.store.read(projectId);
        const run = runOf(p, runId);
        return {
          kind: "terminal",
          result: {
            contract: "video-project-commands",
            version: 1,
            baseRevision: run.baseRevision,
            baseHash: run.baseHash,
            outcome: "answer",
            summary: `Workflow ${plan.id} is ready for approval in the editing workflow card. No media has been sent and no project edit has been applied.`,
            proposal: null,
          },
        };
      },
    };
  }
}
