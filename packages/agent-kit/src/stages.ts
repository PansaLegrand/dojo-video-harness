import {
  completionCanonical,
  completionHash,
  parseCompletionRequirements,
  type CompletionRequirement,
} from "./completion.js";

/** Host-independent stage records. These never authorize provider work or commit a project. */
export type EditArtifactKind =
  | "evidence"
  | "caption-batch"
  | "commands"
  | "verification"
  | "creative-decision"
  | "failure"
  | "provider-receipt";
export type EditArtifactRef = {
  version: 1;
  id: string;
  runId: string;
  bindingHash: string;
  kind: EditArtifactKind;
  sha256: string;
  sizeBytes: number;
};
export type EditStageBinding = {
  projectId: string;
  runId: string;
  baseHash: string;
  instructionHash: string;
  sourceHash: string;
  scopeHash: string;
  profile: string;
  modelIdentity: string;
};
export type EditStageKind =
  | "evidence"
  | "caption_batch"
  | "assemble"
  | "verify";
export type EditStageStatus =
  | "pending"
  | "running"
  | "waiting"
  | "completed"
  | "failed"
  | "cancelled";
export type EditStageUsage = {
  modelCalls: number;
  toolCalls: number;
  inputTokens: number;
  outputTokens: number;
  usageKnown: boolean;
};
export type EditStageLimits = {
  modelCalls: number;
  toolCalls: number;
  outputTokens: number;
  attempts: number;
  expiresAt: string;
};
export type EditStageFailure = {
  code:
    | "INPUT_MISSING"
    | "SOURCE_CHANGED"
    | "BUDGET_EXHAUSTED"
    | "EXPIRED"
    | "KNOWN_REJECTION"
    | "UNKNOWN_OUTCOME"
    | "INVALID_OUTPUT";
  message: string;
};
export type EditStage = {
  id: string;
  kind: EditStageKind;
  execution: "host" | "model";
  dependencies: string[];
  inputs: EditArtifactRef[];
  sourceItemId?: string;
  descriptor?: Record<string, unknown>;
  status: EditStageStatus;
  attemptId?: string;
  outputs: EditArtifactRef[];
  failure?: EditStageFailure;
};
export type EditStageAttempt = {
  id: string;
  stageId: string;
  checkpointId: string;
  modelIdentity: string;
  status: "running" | "waiting" | "completed" | "failed" | "cancelled";
  usage: EditStageUsage;
  startedAt: string;
  updatedAt: string;
};
export type EditStagePlan = {
  version: 1;
  id: string;
  revision: number;
  binding: EditStageBinding;
  bindingHash: string;
  instruction: string;
  requirements: CompletionRequirement[];
  requirementsHash: string;
  limits: EditStageLimits;
  usage: EditStageUsage;
  status: EditStageStatus;
  stages: EditStage[];
  attempts: EditStageAttempt[];
  operations: Record<string, { hash: string; revision: number }>;
};
export type EditStageEvent = { operationId: string } & (
  | { type: "claim"; stageId: string; attemptId: string; checkpointId: string }
  | { type: "wait" | "resume"; stageId: string; attemptId: string }
  | {
      type: "record_usage";
      stageId: string;
      attemptId: string;
      usage: EditStageUsage;
    }
  | {
      type: "complete";
      stageId: string;
      attemptId: string;
      outputs: EditArtifactRef[];
    }
  | {
      type: "fail";
      stageId: string;
      attemptId: string;
      failure: EditStageFailure;
    }
  | { type: "cancel" }
);
export class EditStageError extends Error {
  constructor(
    readonly code:
      | "STAGE_INVALID"
      | "STAGE_CONFLICT"
      | "STAGE_BUDGET"
      | "STAGE_UNKNOWN_OUTCOME",
    message: string,
  ) {
    super(message);
    this.name = "EditStageError";
  }
}
const kinds: EditArtifactKind[] = [
  "evidence",
  "caption-batch",
  "commands",
  "verification",
  "creative-decision",
  "failure",
  "provider-receipt",
];
const statuses: EditStageStatus[] = [
  "pending",
  "running",
  "waiting",
  "completed",
  "failed",
  "cancelled",
];
function fail(message: string): never {
  throw new EditStageError("STAGE_INVALID", message);
}
function row(v: unknown, keys: string[]): Record<string, unknown> {
  if (
    !v ||
    typeof v !== "object" ||
    Array.isArray(v) ||
    ![Object.prototype, null].includes(Object.getPrototypeOf(v))
  )
    fail("Stage values must be plain JSON objects.");
  for (const key of Object.keys(v))
    if (
      !keys.includes(key) ||
      ["__proto__", "prototype", "constructor"].includes(key)
    )
      fail(`Unknown stage field: ${key}`);
  return v as Record<string, unknown>;
}
function text(v: unknown, max = 191): string {
  if (typeof v !== "string" || !v.length || v.length > max)
    fail("Invalid stage identity/text.");
  return v as string;
}
function integer(v: unknown, min = 0, max = Number.MAX_SAFE_INTEGER): number {
  if (!Number.isSafeInteger(v) || Number(v) < min || Number(v) > max)
    fail("Invalid stage counter/budget.");
  return Number(v);
}
function hash(v: unknown): string {
  if (typeof v !== "string" || !/^sha256:[a-f0-9]{64}$/.test(v))
    fail("Invalid stage content hash.");
  return v as string;
}
function date(v: unknown): string {
  const s = text(v, 40);
  if (!Number.isFinite(Date.parse(s)) || new Date(s).toISOString() !== s)
    fail("Invalid stage timestamp.");
  return s;
}
function unique(v: unknown, max = 64): string[] {
  if (!Array.isArray(v) || v.length > max) fail("Invalid stage identity list.");
  const a = (v as unknown[]).map((x) => text(x));
  if (new Set(a).size !== a.length) fail("Duplicate stage identity.");
  return a;
}
export function parseEditStageUsage(raw: unknown): EditStageUsage {
  const v = row(raw, [
    "modelCalls",
    "toolCalls",
    "inputTokens",
    "outputTokens",
    "usageKnown",
  ]);
  for (const key of ["modelCalls", "toolCalls", "inputTokens", "outputTokens"])
    integer(v[key]);
  if (typeof v.usageKnown !== "boolean") fail("Invalid known-usage flag.");
  return structuredClone(v) as EditStageUsage;
}
export function parseEditArtifactRef(raw: unknown): EditArtifactRef {
  const v = row(raw, [
    "version",
    "id",
    "runId",
    "bindingHash",
    "kind",
    "sha256",
    "sizeBytes",
  ]);
  if (v.version !== 1 || !kinds.includes(v.kind as EditArtifactKind))
    fail("Unknown artifact version/kind.");
  text(v.id);
  text(v.runId);
  hash(v.bindingHash);
  hash(v.sha256);
  integer(v.sizeBytes, 1, 4 * 1024 * 1024);
  return structuredClone(v) as EditArtifactRef;
}
function refs(raw: unknown): EditArtifactRef[] {
  if (!Array.isArray(raw) || raw.length > 128)
    fail("Artifact-reference budget exceeded.");
  const result = (raw as unknown[]).map(parseEditArtifactRef);
  if (new Set(result.map((x) => x.id)).size !== result.length)
    fail("Duplicate artifact reference.");
  return result;
}
export function parseEditStagePlan(raw: unknown): EditStagePlan {
  if (new TextEncoder().encode(completionCanonical(raw)).length > 1024 * 1024)
    fail("Stage plan exceeds its UTF-8 byte budget.");
  const v = row(raw, [
    "version",
    "id",
    "revision",
    "binding",
    "bindingHash",
    "instruction",
    "requirements",
    "requirementsHash",
    "limits",
    "usage",
    "status",
    "stages",
    "attempts",
    "operations",
  ]);
  if (v.version !== 1 || !statuses.includes(v.status as EditStageStatus))
    fail("Unknown stage plan version/status.");
  text(v.id);
  integer(v.revision);
  hash(v.bindingHash);
  hash(v.requirementsHash);
  text(v.instruction, 4000);
  const binding = row(v.binding, [
    "projectId",
    "runId",
    "baseHash",
    "instructionHash",
    "sourceHash",
    "scopeHash",
    "profile",
    "modelIdentity",
  ]);
  for (const key of ["projectId", "runId", "profile"]) text(binding[key]);
  text(binding.modelIdentity, 2048);
  for (const key of ["baseHash", "instructionHash", "sourceHash", "scopeHash"])
    hash(binding[key]);
  parseCompletionRequirements(v.requirements, {
    assetSequence: true,
    speechCallout: true,
  });
  const limits = row(v.limits, [
    "modelCalls",
    "toolCalls",
    "outputTokens",
    "attempts",
    "expiresAt",
  ]);
  integer(limits.modelCalls, 1, 256);
  integer(limits.toolCalls, 1, 512);
  integer(limits.outputTokens, 1, 1024 * 1024);
  integer(limits.attempts, 1, 128);
  date(limits.expiresAt);
  const usage = parseEditStageUsage(v.usage);
  if (
    !Array.isArray(v.stages) ||
    !v.stages.length ||
    v.stages.length > 64 ||
    !Array.isArray(v.attempts) ||
    v.attempts.length > Number(limits.attempts)
  )
    fail("Stage/attempt budget exceeded.");
  const prior = new Set<string>();
  for (const rawStage of v.stages as unknown[]) {
    const stage = row(rawStage, [
      "id",
      "kind",
      "execution",
      "dependencies",
      "inputs",
      "sourceItemId",
      "descriptor",
      "status",
      "attemptId",
      "outputs",
      "failure",
    ]);
    const id = text(stage.id);
    if (prior.has(id)) fail("Duplicate stage ID.");
    if (
      !["evidence", "caption_batch", "assemble", "verify"].includes(
        String(stage.kind),
      ) ||
      !statuses.includes(stage.status as EditStageStatus)
    )
      fail("Invalid stage kind/status.");
    if (stage.execution !== "host" && stage.execution !== "model")
      fail("Invalid stage execution authority.");
    if (unique(stage.dependencies).some((id) => !prior.has(id)))
      fail("Stages must depend only on earlier stages.");
    refs(stage.inputs);
    refs(stage.outputs);
    if (stage.sourceItemId !== undefined) text(stage.sourceItemId);
    if (stage.attemptId !== undefined) text(stage.attemptId);
    if (
      stage.descriptor !== undefined &&
      (!stage.descriptor ||
        Array.isArray(stage.descriptor) ||
        typeof stage.descriptor !== "object" ||
        new TextEncoder().encode(completionCanonical(stage.descriptor)).length >
          16384)
    )
      fail("Invalid bounded stage descriptor.");
    if (stage.failure !== undefined) parseFailure(stage.failure);
    prior.add(id);
  }
  const attempts = v.attempts as EditStageAttempt[];
  if (new Set(attempts.map((a) => a.id)).size !== attempts.length)
    fail("Duplicate attempt ID.");
  const sum = {
    modelCalls: 0,
    toolCalls: 0,
    inputTokens: 0,
    outputTokens: 0,
    usageKnown: true,
  };
  for (const rawAttempt of attempts) {
    const a = row(rawAttempt, [
      "id",
      "stageId",
      "checkpointId",
      "modelIdentity",
      "status",
      "usage",
      "startedAt",
      "updatedAt",
    ]);
    text(a.id);
    text(a.checkpointId);
    text(a.modelIdentity, 2048);
    date(a.startedAt);
    date(a.updatedAt);
    if (
      !prior.has(text(a.stageId)) ||
      !["running", "waiting", "completed", "failed", "cancelled"].includes(
        String(a.status),
      )
    )
      fail("Invalid stage attempt.");
    const u = parseEditStageUsage(a.usage);
    for (const key of [
      "modelCalls",
      "toolCalls",
      "inputTokens",
      "outputTokens",
    ] as const)
      sum[key] = integer(sum[key] + u[key]);
    sum.usageKnown &&= u.usageKnown;
  }
  if (completionCanonical(sum) !== completionCanonical(usage))
    fail("Stage usage does not equal the attempt ledger.");
  const plan = structuredClone(v) as EditStagePlan;
  for (const stage of plan.stages) {
    if (
      ["running", "waiting", "completed"].includes(stage.status) &&
      stage.dependencies.some(
        (id) => plan.stages.find((s) => s.id === id)?.status !== "completed",
      )
    )
      fail("Stage dependencies are incomplete.");
    for (const ref of [...stage.inputs, ...stage.outputs])
      if (
        ref.runId !== plan.binding.runId ||
        ref.bindingHash !== plan.bindingHash
      )
        fail("Artifact belongs to another run/source binding.");
    if (
      stage.attemptId &&
      !attempts.some((a) => a.id === stage.attemptId && a.stageId === stage.id)
    )
      fail("Missing stage attempt.");
    if (
      stage.status === "completed" &&
      (!stage.attemptId || !stage.outputs.length)
    )
      fail("Completed stage lacks its output receipt.");
    const allowed: Record<EditStageKind, EditArtifactKind[]> = {
      evidence: ["evidence", "provider-receipt"],
      caption_batch: ["caption-batch"],
      assemble: ["commands"],
      verify: ["verification"],
    };
    if (stage.outputs.some((ref) => !allowed[stage.kind].includes(ref.kind)))
      fail("Stage output has the wrong artifact kind.");
  }
  if (
    !v.operations ||
    typeof v.operations !== "object" ||
    Array.isArray(v.operations)
  )
    fail("Invalid stage operation receipts.");
  const operations = row(v.operations, Object.keys(v.operations));
  if (Object.keys(operations).length > 4096)
    fail("Stage operation budget exceeded.");
  for (const [id, receipt] of Object.entries(operations)) {
    text(id);
    const op = row(receipt, ["hash", "revision"]);
    hash(op.hash);
    integer(op.revision, 1, plan.revision);
  }
  if (
    plan.status === "completed" &&
    plan.stages.some((s) => s.status !== "completed")
  )
    fail("Incomplete stages cannot complete a plan.");
  if (
    (usage.modelCalls > plan.limits.modelCalls ||
      usage.toolCalls > plan.limits.toolCalls ||
      usage.outputTokens > plan.limits.outputTokens) &&
    plan.status !== "failed" &&
    plan.status !== "cancelled"
  )
    fail("Over-budget usage requires an explicit stopped plan.");
  return plan;
}
function parseFailure(raw: unknown): EditStageFailure {
  const v = row(raw, ["code", "message"]);
  if (
    ![
      "INPUT_MISSING",
      "SOURCE_CHANGED",
      "BUDGET_EXHAUSTED",
      "EXPIRED",
      "KNOWN_REJECTION",
      "UNKNOWN_OUTCOME",
      "INVALID_OUTPUT",
    ].includes(String(v.code))
  )
    fail("Invalid stage failure code.");
  text(v.message, 1000);
  return structuredClone(v) as EditStageFailure;
}
export function parseEditStageEvent(raw: unknown): EditStageEvent {
  if (!raw || typeof raw !== "object" || Array.isArray(raw))
    fail("Invalid stage transition.");
  const type = (raw as { type?: unknown }).type;
  const fields: Record<string, string[]> = {
    claim: ["stageId", "attemptId", "checkpointId"],
    wait: ["stageId", "attemptId"],
    resume: ["stageId", "attemptId"],
    record_usage: ["stageId", "attemptId", "usage"],
    complete: ["stageId", "attemptId", "outputs"],
    fail: ["stageId", "attemptId", "failure"],
    cancel: [],
  };
  if (typeof type !== "string" || !Object.hasOwn(fields, type))
    fail("Unknown stage transition.");
  const value = row(raw, ["type", "operationId", ...fields[type]]);
  text(value.operationId);
  for (const key of ["stageId", "attemptId", "checkpointId"])
    if (fields[type].includes(key)) text(value[key]);
  if (type === "record_usage") parseEditStageUsage(value.usage);
  if (type === "complete") refs(value.outputs);
  if (type === "fail") parseFailure(value.failure);
  return structuredClone(value) as EditStageEvent;
}
export async function createEditStagePlan(input: {
  id: string;
  binding: EditStageBinding;
  instruction: string;
  requirements: CompletionRequirement[];
  limits: EditStageLimits;
  stages: Array<
    Omit<EditStage, "status" | "outputs" | "attemptId" | "failure">
  >;
}): Promise<EditStagePlan> {
  return parseEditStagePlan({
    version: 1,
    id: input.id,
    revision: 0,
    binding: input.binding,
    bindingHash: await completionHash(input.binding),
    instruction: input.instruction,
    requirements: input.requirements,
    requirementsHash: await completionHash(input.requirements),
    limits: input.limits,
    usage: {
      modelCalls: 0,
      toolCalls: 0,
      inputTokens: 0,
      outputTokens: 0,
      usageKnown: true,
    },
    status: "pending",
    stages: input.stages.map((stage) => ({
      ...stage,
      status: "pending",
      outputs: [],
    })),
    attempts: [],
    operations: {},
  });
}
export async function assertEditStageBinding(
  plan: EditStagePlan,
  binding: EditStageBinding,
) {
  if (
    (await completionHash(binding)) !== plan.bindingHash ||
    completionCanonical(binding) !== completionCanonical(plan.binding) ||
    (await completionHash(plan.instruction)) !== plan.binding.instructionHash ||
    (await completionHash(plan.requirements)) !== plan.requirementsHash
  )
    throw new EditStageError(
      "STAGE_CONFLICT",
      "The original instruction, outcomes, scope, source or model binding changed.",
    );
}
/** Absolute counters are accounted once; a replay never purchases another attempt. */
export async function transitionEditStagePlan(
  raw: unknown,
  event: EditStageEvent,
  options: { expectedRevision: number; now: string },
): Promise<{ plan: EditStagePlan; applied: boolean }> {
  event = parseEditStageEvent(event);
  const plan = parseEditStagePlan(raw);
  await assertEditStageBinding(plan, plan.binding);
  date(options.now);
  text(event.operationId);
  const eventHash = await completionHash(event),
    previous = plan.operations[event.operationId];
  if (previous) {
    if (previous.hash !== eventHash)
      throw new EditStageError(
        "STAGE_CONFLICT",
        "Stage operation ID was reused with different input.",
      );
    return { plan, applied: false };
  }
  if (plan.revision !== options.expectedRevision)
    throw new EditStageError(
      "STAGE_CONFLICT",
      "Another execution advanced this stage plan.",
    );
  if (event.type === "cancel") {
    plan.status = "cancelled";
    for (const stage of plan.stages)
      if (stage.status !== "completed") stage.status = "cancelled";
    for (const attempt of plan.attempts)
      if (["running", "waiting"].includes(attempt.status))
        attempt.status = "cancelled";
  } else {
    const stage = plan.stages.find((s) => s.id === event.stageId);
    if (!stage) fail("Unknown stage.");
    if (event.type === "claim") {
      if (["failed", "cancelled", "completed"].includes(plan.status))
        throw new EditStageError(
          "STAGE_CONFLICT",
          "This plan cannot start another stage.",
        );
      if (Date.parse(options.now) >= Date.parse(plan.limits.expiresAt))
        throw new EditStageError("STAGE_CONFLICT", "The stage plan expired.");
      if (stage.execution === "model" && !plan.usage.usageKnown)
        throw new EditStageError(
          "STAGE_UNKNOWN_OUTCOME",
          "Unknown provider usage requires reconciliation before another model stage.",
        );
      if (
        stage.status !== "pending" ||
        stage.dependencies.some(
          (id) => plan.stages.find((s) => s.id === id)?.status !== "completed",
        ) ||
        plan.stages.some((s) => ["running", "waiting"].includes(s.status))
      )
        throw new EditStageError(
          "STAGE_CONFLICT",
          "The stage is not ready or another stage owns execution.",
        );
      if (
        plan.attempts.length >= plan.limits.attempts ||
        (stage.execution === "model" &&
          (plan.usage.modelCalls >= plan.limits.modelCalls ||
            plan.usage.toolCalls >= plan.limits.toolCalls ||
            plan.usage.outputTokens >= plan.limits.outputTokens))
      )
        throw new EditStageError(
          "STAGE_BUDGET",
          "The original authorized stage budget is exhausted.",
        );
      if (
        plan.attempts.some(
          (a) =>
            a.id === event.attemptId || a.checkpointId === event.checkpointId,
        )
      )
        throw new EditStageError(
          "STAGE_CONFLICT",
          "Attempt/checkpoint identity was already used.",
        );
      text(event.attemptId);
      text(event.checkpointId);
      stage.status = "running";
      stage.attemptId = event.attemptId;
      plan.status = "running";
      plan.attempts.push({
        id: event.attemptId,
        checkpointId: event.checkpointId,
        stageId: stage.id,
        modelIdentity: plan.binding.modelIdentity,
        status: "running",
        usage: {
          modelCalls: 0,
          toolCalls: 0,
          inputTokens: 0,
          outputTokens: 0,
          usageKnown: true,
        },
        startedAt: options.now,
        updatedAt: options.now,
      });
    } else {
      const attempt = plan.attempts.find(
        (a) => a.id === event.attemptId && a.stageId === stage.id,
      );
      if (!attempt || stage.attemptId !== attempt.id)
        throw new EditStageError(
          "STAGE_CONFLICT",
          "Stage attempt identity changed.",
        );
      if (event.type === "record_usage") {
        const usage = parseEditStageUsage(event.usage);
        for (const key of [
          "modelCalls",
          "toolCalls",
          "inputTokens",
          "outputTokens",
        ] as const) {
          if (usage[key] < attempt.usage[key])
            fail("Stage usage counters cannot decrease.");
          plan.usage[key] = integer(
            plan.usage[key] + usage[key] - attempt.usage[key],
          );
        }
        if (!attempt.usage.usageKnown && usage.usageKnown)
          fail(
            "Unknown provider usage cannot become known without reconciliation.",
          );
        attempt.usage = usage;
        plan.usage.usageKnown = plan.attempts.every((a) => a.usage.usageKnown);
        if (
          plan.usage.modelCalls > plan.limits.modelCalls ||
          plan.usage.toolCalls > plan.limits.toolCalls ||
          plan.usage.outputTokens > plan.limits.outputTokens
        ) {
          plan.status = plan.status === "cancelled" ? "cancelled" : "failed";
          stage.status = plan.status;
          attempt.status = "failed";
          stage.failure = {
            code: "BUDGET_EXHAUSTED",
            message:
              "Reported provider usage exceeded the original authorized budget. Completed output is retained; further execution is blocked.",
          };
        }
      } else if (event.type === "complete") {
        const outputs = refs(event.outputs);
        if (!outputs.length) fail("A completed stage needs an output receipt.");
        if (
          !(["running", "waiting", "cancelled"] as string[]).includes(
            stage.status,
          )
        )
          throw new EditStageError(
            "STAGE_CONFLICT",
            "The stage cannot accept another completion.",
          );
        stage.outputs = outputs;
        attempt.status = "completed";
        if (plan.status !== "cancelled" && plan.status !== "failed") {
          stage.status = "completed";
          plan.status = plan.stages.every((s) => s.status === "completed")
            ? "completed"
            : "waiting";
        }
      } else if (event.type === "fail") {
        stage.failure = parseFailure(event.failure);
        stage.status = plan.status === "cancelled" ? "cancelled" : "failed";
        attempt.status = "failed";
        if (plan.status !== "cancelled") plan.status = "failed";
      } else {
        if (
          plan.status === "cancelled" ||
          plan.status === "failed" ||
          !["running", "waiting"].includes(stage.status)
        )
          throw new EditStageError(
            "STAGE_CONFLICT",
            "The saved stage cannot resume.",
          );
        stage.status = event.type === "wait" ? "waiting" : "running";
        attempt.status = stage.status;
        plan.status = stage.status;
      }
      attempt.updatedAt = options.now;
    }
  }
  plan.revision++;
  plan.operations[event.operationId] = {
    hash: eventHash,
    revision: plan.revision,
  };
  return { plan: parseEditStagePlan(plan), applied: true };
}
export type EditStagePort = {
  load(): Promise<EditStagePlan | null>;
  initialize(
    plan: EditStagePlan,
  ): Promise<{ plan: EditStagePlan; created: boolean }>;
  transition(
    event: EditStageEvent,
    expectedRevision: number,
  ): Promise<{ plan: EditStagePlan; applied: boolean }>;
  putArtifact(kind: EditArtifactKind, value: unknown): Promise<EditArtifactRef>;
  readArtifact(ref: EditArtifactRef): Promise<unknown>;
};
