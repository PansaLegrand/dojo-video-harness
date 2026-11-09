import { parseVideoProjectDocument } from "./document";
import { nativeAgentScopeSchema } from "./agent-authoring";
import { nativeScopeItemIds } from "./agent-scope";
import { captionTimingDiagnostics } from "./caption-source-range";

export type NativeAgentProgress = {
  version: 1;
  execution: {
    state:
      | "waiting_for_media"
      | "waiting_for_consent"
      | "transcribing"
      | "needs_input"
      | "preparing"
      | "ready"
      | "failed"
      | "cancelled"
      | "completed";
    phase: string;
  };
  application: {
    state: "pending" | "ready" | "applied" | "stale" | "not_applicable";
  };
  sources: Array<{
    itemId: string;
    assetId: string;
    name: string;
    fromFrame: number;
    durationInFrames: number;
    fps: number;
    media: "cloud_available" | "browser_required" | "missing";
    evidence:
      | "ready"
      | "partial"
      | "queued"
      | "running"
      | "failed"
      | "not_requested"
      | "unknown";
    taskId?: string;
  }>;
  deliverables: Array<{
    id: string;
    kind?: string;
    label: string;
    status: "pending" | "passed" | "failed";
    itemId?: string;
    frame?: number;
  }>;
  coverage: "undeclared" | "declared" | "verified" | "incomplete";
  recovery: {
    canResume: boolean;
    canReuseSavedResult: boolean;
    canCancel: boolean;
    needsMedia: boolean;
    needsConsent: boolean;
  };
};
type ProgressRun = {
  status: string;
  phase: string;
  baseDocumentJson: unknown;
  contextJson: unknown;
  requestJson: unknown;
  resultJson: unknown;
  asrTasksJson: unknown;
  cancelRequestedAt?: Date | null;
};
const record = (value: unknown): Record<string, any> =>
  value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, any>)
    : {};
const active = new Set(["queued", "running", "needs_evidence"]);

/** A summary of saved host facts, never an inference from model narration. Source
 * labels and clocks come from the run's immutable basis, not today's document. */
export function nativeAgentProgress(
  run: ProgressRun,
  recoverableOutput = false,
): NativeAgentProgress | undefined {
  const parsed = (() => {
    try {
      return parseVideoProjectDocument(run.baseDocumentJson);
    } catch {
      return null;
    }
  })();
  if (!parsed) return undefined;
  const document = parsed,
    request = record(run.requestJson),
    result = record(run.resultJson),
    context = record(run.contextJson);
  const scope = nativeAgentScopeSchema.safeParse(
    record(request.authoring).scope,
  );
  if (record(request.authoring).scope !== undefined && !scope.success)
    return undefined;
  const selected = scope.success
    ? nativeScopeItemIds(document, scope.data)
    : Array.isArray(context.selectedItemIds)
      ? context.selectedItemIds
      : [];
  const ids = new Set(selected);
  for (const item of document.items)
    if (ids.has(item.id) && item.caption?.sourceItemId)
      ids.add(item.caption.sourceItemId);
  const project = scope.success
    ? scope.data.kind === "project"
    : !selected.length;
  const prerequisite = record(request.prerequisites);
  const requiredAssets = new Set<string>(
    Array.isArray(prerequisite.assetIds) ? prerequisite.assetIds : [],
  );
  const bindings = Array.isArray(run.asrTasksJson)
    ? run.asrTasksJson.map(record)
    : [];
  const evidenceProgress = Array.isArray(request.evidenceProgress)
    ? request.evidenceProgress.map(record)
    : [];
  const usages = new Map<
    string,
    {
      itemId: string;
      assetId: string;
      name: string;
      from: number;
      until: number;
    }
  >();
  const pinned =
    scope.success && scope.data.kind === "selection"
      ? scope.data.node
      : undefined;
  for (const item of document.items.filter(
    (item) => project || ids.has(item.id),
  )) {
    const walk = (
      node: typeof item.node,
      parentFrom: number,
      parentDuration: number,
      inside: boolean,
    ) => {
      const from = parentFrom + (node.from ?? 0),
        duration = node.duration ?? parentDuration;
      const included = inside || pinned?.nodeId === node.id;
      if (included)
        for (const assetId of [
          node.assetId,
          node.params?.audioAssetId,
          node.params?.coverAssetId,
        ]) {
          if (
            typeof assetId !== "string" ||
            !["video", "audio", "image"].includes(
              document.assets[assetId]?.type,
            )
          )
            continue;
          const key = `${item.id}:${assetId}`,
            prior = usages.get(key);
          usages.set(key, {
            itemId: item.id,
            assetId,
            name: item.name,
            from: Math.min(prior?.from ?? from, from),
            until: Math.max(prior?.until ?? from + duration, from + duration),
          });
        }
      for (const child of node.children ?? [])
        walk(child, from, duration, included);
    };
    walk(item.node, 0, document.format.durationInFrames, !pinned);
  }
  const sources: NativeAgentProgress["sources"] = [...usages.values()].map(
    (usage) => {
      const assetId = usage.assetId,
        asset = document.assets[assetId],
        source = document.sources[assetId];
      const item = document.items.find((item) => item.id === usage.itemId)!;
      const binding = bindings.find((row) => row.sourceId === assetId),
        progress = evidenceProgress.find((row) => row.sourceId === assetId);
      const prepared =
        Array.isArray(request.evidenceCommands) &&
        request.evidenceCommands.find(
          (command: any) =>
            command?.type === "addEvidence" &&
            command.evidence?.sourceAssetId === assetId &&
            command.evidence?.sourceRevision === source?.revision,
        );
      const evidenceRow =
        Object.values(document.evidence).find(
          (row) =>
            row.sourceAssetId === assetId &&
            row.sourceRevision === source?.revision,
        ) ?? prepared?.evidence;
      const partial =
        evidenceRow &&
        (item.node.assetId === assetId &&
        ["video", "audio"].includes(item.node.type)
          ? !!captionTimingDiagnostics(document, item.id, evidenceRow)
          : !!evidenceRow.timingOmissions?.length);
      const ready = !!evidenceRow || prepared;
      const status = progress?.status;
      const evidence: NativeAgentProgress["sources"][number]["evidence"] =
        partial
          ? "partial"
          : ready || status === "ready"
            ? "ready"
            : ["queued", "running", "failed"].includes(status)
              ? status
              : requiredAssets.has(assetId)
                ? binding
                  ? "unknown"
                  : "queued"
                : "not_requested";
      return {
        itemId: item.id,
        assetId,
        name: usage.name,
        fromFrame: usage.from,
        durationInFrames: usage.until - usage.from,
        fps: document.format.fps,
        media:
          !asset || (!source && asset.source !== "static")
            ? "missing"
            : asset.source === "project" ||
                asset.assetId ||
                asset.source === "static"
              ? "cloud_available"
              : "browser_required",
        evidence,
        ...(typeof binding?.taskId === "string"
          ? { taskId: binding.taskId }
          : {}),
      };
    },
  );
  const verification = record(result.verification),
    completion = record(result.completion);
  const checks = Array.isArray(verification.outcomes)
    ? verification.outcomes.map(record)
    : [];
  const requirements = Array.isArray(completion.requirements)
    ? completion.requirements.map(record)
    : [];
  const deliverables: NativeAgentProgress["deliverables"] = requirements.length
    ? requirements.map((requirement) => {
        const check = checks.find((row) => row.id === requirement.id),
          itemId =
            typeof requirement.itemId === "string"
              ? requirement.itemId
              : requirement.sourceItemId;
        return {
          id: String(requirement.id),
          kind: String(requirement.kind),
          label:
            typeof check?.message === "string"
              ? check.message
              : String(requirement.kind).replaceAll("_", " "),
          status:
            check?.passed === true
              ? "passed"
              : check?.passed === false
                ? "failed"
                : "pending",
          ...(typeof itemId === "string"
            ? {
                itemId,
                ...(document.items.some((item) => item.id === itemId)
                  ? {
                      frame:
                        document.items.find((item) => item.id === itemId)!.node
                          .from ?? 0,
                    }
                  : {}),
              }
            : {}),
        };
      })
    : checks.map((check) => ({
        id: String(check.id),
        label: String(check.message ?? check.id),
        status:
          check.passed === true
            ? "passed"
            : check.passed === false
              ? "failed"
              : "pending",
      }));
  const needsConsent = prerequisite.status === "consent_required";
  const needsMedia =
    needsConsent &&
    sources.some(
      (source) =>
        requiredAssets.has(source.assetId) &&
        source.media !== "cloud_available",
    );
  const cancelled = run.status === "cancelled" || !!run.cancelRequestedAt;
  const proposalReady =
    ["ready", "awaiting_review"].includes(run.status) && !!result.proposal;
  const application: NativeAgentProgress["application"] = {
    state:
      run.status === "applied"
        ? "applied"
        : run.status === "stale"
          ? "stale"
          : proposalReady
            ? "ready"
            : run.status === "completed" && !result.proposal
              ? "not_applicable"
              : "pending",
  };
  const execution: NativeAgentProgress["execution"] = {
    phase: run.phase,
    state: cancelled
      ? "cancelled"
      : run.status === "failed" || run.status === "stale"
        ? "failed"
        : proposalReady
          ? "ready"
          : run.status === "needs_input"
            ? "needs_input"
            : ["applied", "completed"].includes(run.status)
              ? "completed"
              : needsMedia
                ? "waiting_for_media"
                : needsConsent
                  ? "waiting_for_consent"
                  : prerequisite.status === "running"
                    ? "transcribing"
                    : "preparing",
  };
  return {
    version: 1,
    execution,
    application,
    sources,
    deliverables,
    coverage: !deliverables.length
      ? "undeclared"
      : deliverables.some((row) => row.status === "failed")
        ? "incomplete"
        : verification.status === "passed" &&
            deliverables.every((row) => row.status === "passed")
          ? "verified"
          : "declared",
    recovery: {
      canResume:
        !cancelled &&
        active.has(run.status) &&
        run.phase !== "preparing" &&
        run.phase !== "dispatching",
      canReuseSavedResult:
        !cancelled &&
        recoverableOutput &&
        ["stale", "failed", "ready", "awaiting_review"].includes(run.status),
      canCancel:
        !cancelled &&
        (active.has(run.status) ||
          proposalReady ||
          run.status === "needs_input"),
      needsMedia,
      needsConsent,
    },
  };
}
