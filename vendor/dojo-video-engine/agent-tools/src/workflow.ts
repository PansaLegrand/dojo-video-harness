import { z, type ZodTypeAny } from "zod/v3";
import { zodToJsonSchema } from "zod-to-json-schema";
import {
  createSceneWorkspace,
  sceneCommandsSchema,
  SceneWorkspaceError,
  type CompileSceneCommandsContext,
  type SceneWorkspace,
  type SceneWorkspaceSnapshot,
  type SceneCommands,
  type WorkspaceDraft,
  type WorkspaceHistoryEntry,
} from "@dojo-video-engine/commands";
import {
  checkScene,
  inspectTree,
  type TreeInspectionNode,
} from "@dojo-video-engine/inspection";
import {
  defaultSceneComplexityLimits,
  preflightScene,
  sceneJsonSchema,
  type Scene,
  type SceneComplexityLimits,
  type SceneNode,
} from "@dojo-video-engine/schema";

const MAX_HANDLE_LENGTH = 191;
const MAX_ACTION_LENGTH = 96;
const MAX_OPERATION_LENGTH = 96;
const MAX_QUERY_LENGTH = 512;
const MAX_RESULT_STRING = 100_000;
const MAX_JSON_ARRAY = 512;
const MAX_JSON_PROPERTIES = 128;
const DEFAULT_MAX_HANDLES = 8;
const DEFAULT_MAX_EVENTS = 512;
const DEFAULT_MAX_RESULT_VALUES = 20_000;
const DEFAULT_MAX_RESULT_DEPTH = 8;
const DEFAULT_HISTORY_LIMIT = 100;
const DEFAULT_READ_LIMIT = 100;
const BOUNDED_JSON_OBJECT_MARKER = "dojo-video-engine:bounded-workflow-json-object";

export type WorkflowJsonValue =
  | string
  | number
  | boolean
  | null
  | WorkflowJsonValue[]
  | { [key: string]: WorkflowJsonValue };

const workflowJsonScalarSchema: z.ZodType<WorkflowJsonValue> = z.union([
  z.string().max(MAX_RESULT_STRING),
  z.number().finite(),
  z.boolean(),
  z.null(),
]) as z.ZodType<WorkflowJsonValue>;

function boundedJsonObject(
  valueSchema: z.ZodType<WorkflowJsonValue>,
): z.ZodType<WorkflowJsonValue> {
  return z
    .record(valueSchema)
    .superRefine((value, ctx) => {
      if (Object.keys(value).length > MAX_JSON_PROPERTIES) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `JSON objects support at most ${MAX_JSON_PROPERTIES} properties.`,
        });
      }
    })
    .describe(BOUNDED_JSON_OBJECT_MARKER) as z.ZodType<WorkflowJsonValue>;
}

function nextJsonLevel(
  valueSchema: z.ZodType<WorkflowJsonValue>,
): z.ZodType<WorkflowJsonValue> {
  return z.union([
    workflowJsonScalarSchema,
    z.array(valueSchema).max(MAX_JSON_ARRAY),
    boundedJsonObject(valueSchema),
  ]) as z.ZodType<WorkflowJsonValue>;
}

const workflowJsonValueLevel1Schema = nextJsonLevel(workflowJsonScalarSchema);
const workflowJsonValueLevel2Schema = nextJsonLevel(
  workflowJsonValueLevel1Schema,
);
const workflowJsonValueLevel3Schema = nextJsonLevel(
  workflowJsonValueLevel2Schema,
);
const workflowJsonValueLevel4Schema = nextJsonLevel(
  workflowJsonValueLevel3Schema,
);
const workflowJsonValueLevel5Schema = nextJsonLevel(
  workflowJsonValueLevel4Schema,
);
const workflowJsonValueLevel6Schema = nextJsonLevel(
  workflowJsonValueLevel5Schema,
);
const workflowJsonValueLevel7Schema = nextJsonLevel(
  workflowJsonValueLevel6Schema,
);

/** Bounded JSON payload used by evidence parameters and workflow results. */
export const workflowJsonValueSchema: z.ZodType<WorkflowJsonValue> =
  nextJsonLevel(workflowJsonValueLevel7Schema);

const handleSchema = z.string().min(1).max(MAX_HANDLE_LENGTH);
const expectedRevisionSchema = z.number().int().nonnegative();
const resultLimitSchema = z.number().int().min(1).max(200);

export const workflowLoadInputSchema = z
  .object({
    action: z.literal("workspace.load"),
    /** The one deliberate recursive/unknown ingestion boundary. */
    scene: z.unknown(),
    historyLimit: z.number().int().min(1).max(10_000).optional(),
  })
  .strict();

export const workflowReadInputSchema = z
  .object({
    action: z.literal("workspace.read"),
    handle: handleSchema,
    expectedRevision: expectedRevisionSchema.optional(),
    view: z.enum(["summary", "node"]).default("summary"),
    id: z.string().min(1).max(191).optional(),
    limit: resultLimitSchema.optional(),
  })
  .strict()
  .superRefine((value, ctx) => {
    if (value.view === "node" && value.id === undefined) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["id"],
        message: "Node reads require an exact node id.",
      });
    }
    if (value.view === "summary" && value.id !== undefined) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["id"],
        message: "Summary reads do not consume id.",
      });
    }
  });

export const workflowSearchInputSchema = z
  .object({
    action: z.literal("workspace.search"),
    handle: handleSchema,
    expectedRevision: expectedRevisionSchema.optional(),
    query: z.string().max(MAX_QUERY_LENGTH).optional(),
    types: z
      .array(
        z.enum([
          "div",
          "text",
          "img",
          "video",
          "audio",
          "lottie",
          "effect",
          "extension",
          "shape",
        ]),
      )
      .max(9)
      .optional(),
    limit: resultLimitSchema.optional(),
  })
  .strict()
  .superRefine((value, ctx) => {
    if ((value.query ?? "").trim() === "" && (value.types?.length ?? 0) === 0) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message:
          "Search needs a non-empty query, at least one node type, or both.",
      });
    }
  });

const unsafeInsetsSchema = z.union([
  z.number().finite().nonnegative(),
  z
    .object({
      top: z.number().finite().nonnegative(),
      right: z.number().finite().nonnegative(),
      bottom: z.number().finite().nonnegative(),
      left: z.number().finite().nonnegative(),
    })
    .strict(),
]);

export const workflowCheckInputSchema = z
  .object({
    action: z.literal("workspace.check"),
    handle: handleSchema,
    expectedRevision: expectedRevisionSchema.optional(),
    frames: z.array(z.number().int().nonnegative()).min(1).max(32).optional(),
    sampleCount: z.number().int().min(1).max(32).optional(),
    unsafeInsets: unsafeInsetsSchema.optional(),
    excessiveCropThreshold: z.number().finite().min(0).max(1).optional(),
    maxDiagnostics: z.number().int().min(1).max(500).optional(),
  })
  .strict()
  .superRefine((value, ctx) => {
    if (value.frames !== undefined && value.sampleCount !== undefined) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["sampleCount"],
        message: "Use explicit frames or sampleCount, not both.",
      });
    }
  });

export type WorkflowCommandsInput = {
  action: "commands.apply";
  handle: string;
  expectedRevision: number;
  commands: SceneCommands;
};

export const workflowCommandsInputSchema: z.ZodType<WorkflowCommandsInput> = z
  .object({
    action: z.literal("commands.apply"),
    handle: handleSchema,
    expectedRevision: expectedRevisionSchema,
    commands: sceneCommandsSchema,
  })
  .strict() as z.ZodType<WorkflowCommandsInput>;

export const workflowUndoInputSchema = z
  .object({
    action: z.literal("workspace.undo"),
    handle: handleSchema,
    expectedRevision: expectedRevisionSchema,
  })
  .strict();

export const workflowRedoInputSchema = z
  .object({
    action: z.literal("workspace.redo"),
    handle: handleSchema,
    expectedRevision: expectedRevisionSchema,
  })
  .strict();

export const workflowEvidenceInputSchema = z
  .object({
    action: z.literal("evidence.run"),
    handle: handleSchema,
    expectedRevision: expectedRevisionSchema,
    operation: z
      .string()
      .min(1)
      .max(MAX_OPERATION_LENGTH)
      .regex(/^[A-Za-z][A-Za-z0-9._/-]*$/),
    params: workflowJsonValueLevel4Schema.optional(),
  })
  .strict();

export const workflowCloseInputSchema = z
  .object({
    action: z.literal("workspace.close"),
    handle: handleSchema,
    expectedRevision: expectedRevisionSchema,
  })
  .strict();

export const workflowEventsInputSchema = z
  .object({
    action: z.literal("events.read"),
    afterSequence: z.number().int().nonnegative().optional(),
    limit: z.number().int().min(1).max(500).optional(),
  })
  .strict();

export const workflowDisposeInputSchema = z
  .object({ action: z.literal("session.dispose") })
  .strict();

export const workflowActionInputSchema = z.union([
  workflowReadInputSchema,
  workflowSearchInputSchema,
  workflowCheckInputSchema,
  workflowCommandsInputSchema,
  workflowUndoInputSchema,
  workflowRedoInputSchema,
  workflowEvidenceInputSchema,
  workflowCloseInputSchema,
  workflowEventsInputSchema,
  workflowDisposeInputSchema,
]);

export const workflowRequestSchema = z.union([
  workflowLoadInputSchema,
  workflowActionInputSchema,
]);

export type WorkflowRequest = z.infer<typeof workflowRequestSchema>;

export const workflowEventSchema = z
  .object({
    sequence: z.number().int().positive(),
    sessionId: z.string().min(1).max(128),
    operationId: z.string().min(1).max(64),
    action: z.string().min(1).max(MAX_ACTION_LENGTH),
    phase: z.enum(["start", "complete", "error"]),
    handle: handleSchema.optional(),
    revision: expectedRevisionSchema.optional(),
    details: workflowJsonValueLevel3Schema.optional(),
  })
  .strict();

export type WorkflowEvent = z.infer<typeof workflowEventSchema>;

export const workflowErrorSchema = z
  .object({
    code: z.string().min(1).max(64),
    message: z.string().min(1).max(2_048),
    details: workflowJsonValueLevel4Schema.optional(),
  })
  .strict();

const workflowSuccessResultSchema = z
  .object({
    ok: z.literal(true),
    sessionId: z.string().min(1).max(128),
    operationId: z.string().min(1).max(64),
    action: z.string().min(1).max(MAX_ACTION_LENGTH),
    handle: handleSchema.optional(),
    revision: expectedRevisionSchema.optional(),
    data: workflowJsonValueSchema.optional(),
    events: z.array(workflowEventSchema).length(2),
  })
  .strict();

const workflowFailureResultSchema = z
  .object({
    ok: z.literal(false),
    sessionId: z.string().min(1).max(128),
    operationId: z.string().min(1).max(64),
    action: z.string().min(1).max(MAX_ACTION_LENGTH),
    handle: handleSchema.optional(),
    revision: expectedRevisionSchema.optional(),
    error: workflowErrorSchema,
    events: z.array(workflowEventSchema).length(2),
  })
  .strict();

export const workflowResultSchema = z.union([
  workflowSuccessResultSchema,
  workflowFailureResultSchema,
]);

export type WorkflowResult = z.infer<typeof workflowResultSchema>;

type WorkflowInputSchema =
  | typeof workflowLoadInputSchema
  | typeof workflowReadInputSchema
  | typeof workflowSearchInputSchema
  | typeof workflowCheckInputSchema
  | typeof workflowCommandsInputSchema
  | typeof workflowUndoInputSchema
  | typeof workflowRedoInputSchema
  | typeof workflowEvidenceInputSchema
  | typeof workflowCloseInputSchema
  | typeof workflowEventsInputSchema
  | typeof workflowDisposeInputSchema;

export type WorkflowToolDescriptor = {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  outputSchema: Record<string, unknown>;
};

const workflowToolDefinitions: ReadonlyArray<{
  name: string;
  action: WorkflowRequest["action"];
  description: string;
  schema: WorkflowInputSchema;
}> = [
  {
    name: "dojo-video-engine.workflow.load",
    action: "workspace.load",
    description:
      "Strictly ingest one recursive Scene and return an opaque workspace handle.",
    schema: workflowLoadInputSchema,
  },
  {
    name: "dojo-video-engine.workflow.read",
    action: "workspace.read",
    description: "Read a flat workspace summary or one flat node by handle.",
    schema: workflowReadInputSchema,
  },
  {
    name: "dojo-video-engine.workflow.search",
    action: "workspace.search",
    description: "Search flat node summaries without resending the Scene.",
    schema: workflowSearchInputSchema,
  },
  {
    name: "dojo-video-engine.workflow.check",
    action: "workspace.check",
    description:
      "Run bounded structural/layout checks on a workspace revision.",
    schema: workflowCheckInputSchema,
  },
  {
    name: "dojo-video-engine.workflow.commands",
    action: "commands.apply",
    description: "Apply strict non-recursive commands transactionally.",
    schema: workflowCommandsInputSchema,
  },
  {
    name: "dojo-video-engine.workflow.undo",
    action: "workspace.undo",
    description: "Undo one committed workspace change at an exact revision.",
    schema: workflowUndoInputSchema,
  },
  {
    name: "dojo-video-engine.workflow.redo",
    action: "workspace.redo",
    description: "Redo one workspace change at an exact revision.",
    schema: workflowRedoInputSchema,
  },
  {
    name: "dojo-video-engine.workflow.evidence",
    action: "evidence.run",
    description:
      "Run a host-injected render/artifact/evidence operation by handle.",
    schema: workflowEvidenceInputSchema,
  },
  {
    name: "dojo-video-engine.workflow.close",
    action: "workspace.close",
    description: "Release one workspace handle deterministically.",
    schema: workflowCloseInputSchema,
  },
  {
    name: "dojo-video-engine.workflow.events",
    action: "events.read",
    description: "Read the bounded provider-neutral session event stream.",
    schema: workflowEventsInputSchema,
  },
  {
    name: "dojo-video-engine.workflow.dispose",
    action: "session.dispose",
    description: "Dispose all handles and injected evidence resources.",
    schema: workflowDisposeInputSchema,
  },
];

function jsonSchema(schema: ZodTypeAny, name: string): Record<string, unknown> {
  const output = zodToJsonSchema(schema, {
    name,
    target: "jsonSchema7",
    $refStrategy: "none",
  }) as Record<string, unknown>;
  decorateWorkflowJsonSchema(output);
  return output;
}

function decorateWorkflowJsonSchema(value: unknown): void {
  if (Array.isArray(value)) {
    value.forEach(decorateWorkflowJsonSchema);
    return;
  }
  if (!value || typeof value !== "object") return;
  const schema = value as Record<string, unknown>;
  if (schema.description === BOUNDED_JSON_OBJECT_MARKER) {
    schema.maxProperties = MAX_JSON_PROPERTIES;
    schema.description = "Bounded workflow JSON object.";
  }
  const properties =
    schema.properties && typeof schema.properties === "object"
      ? (schema.properties as Record<string, Record<string, unknown>>)
      : undefined;
  const action = properties?.action?.const;
  const constraints: Record<string, unknown>[] = [];
  if (action === "workspace.read") {
    constraints.push(
      {
        if: {
          properties: { view: { const: "node" } },
          required: ["view"],
        },
        then: { required: ["id"] },
      },
      {
        if: {
          not: {
            properties: { view: { const: "node" } },
            required: ["view"],
          },
        },
        then: { not: { required: ["id"] } },
      },
    );
  } else if (action === "workspace.search") {
    if (properties?.query) properties.query.pattern = "\\S";
    constraints.push({
      anyOf: [
        { required: ["query"] },
        {
          properties: { types: { minItems: 1 } },
          required: ["types"],
        },
      ],
    });
  } else if (action === "workspace.check") {
    constraints.push({
      not: { required: ["frames", "sampleCount"] },
    });
  }
  if (constraints.length > 0) {
    schema.allOf = [
      ...(Array.isArray(schema.allOf) ? schema.allOf : []),
      ...constraints,
    ];
  }
  Object.values(schema).forEach(decorateWorkflowJsonSchema);
}

function toolInputJsonSchema(
  schema: ZodTypeAny,
  name: string,
): Record<string, unknown> {
  const output = jsonSchema(schema, name);
  const definitions = output.definitions as
    | Record<string, Record<string, unknown>>
    | undefined;
  const root = definitions?.[name] ?? output;
  const properties = root.properties as Record<string, unknown> | undefined;
  if (name === "dojo-video-engine_workflow_load" && properties && definitions) {
    const canonical = sceneJsonSchema() as {
      definitions?: Record<string, Record<string, unknown>>;
    };
    const sceneDefinition = canonical.definitions?.DojoVideoEngineScene;
    if (!sceneDefinition) {
      throw new Error(
        "Canonical Scene JSON Schema has no DojoVideoEngineScene root.",
      );
    }
    definitions.DojoVideoEngineScene = structuredClone(sceneDefinition);
    properties.scene = { $ref: "#/definitions/DojoVideoEngineScene" };
    root.required = [
      ...new Set([
        ...(Array.isArray(root.required) ? root.required : []),
        "scene",
      ]),
    ];
  }
  if (properties) delete properties.action;
  if (Array.isArray(root.required)) {
    root.required = root.required.filter((entry) => entry !== "action");
  }
  root.description =
    "Provider-facing input. The workflow registry injects the internal action discriminator.";
  return output;
}

/** Detached JSON Schema descriptors for provider/tool adapters. */
let workflowDescriptorCache: WorkflowToolDescriptor[] | undefined;

export function workflowToolDescriptors(): WorkflowToolDescriptor[] {
  if (!workflowDescriptorCache) {
    const outputSchema = jsonSchema(workflowResultSchema, "WorkflowResult");
    workflowDescriptorCache = workflowToolDefinitions.map((definition) => ({
      name: definition.name,
      description: definition.description,
      inputSchema: toolInputJsonSchema(
        definition.schema,
        definition.name.replaceAll(".", "_"),
      ),
      outputSchema: structuredClone(outputSchema),
    }));
  }
  return structuredClone(workflowDescriptorCache);
}

/** Complete request schema; only the load branch contains unknown Scene data. */
export function workflowRequestJsonSchema(): Record<string, unknown> {
  return structuredClone(jsonSchema(workflowRequestSchema, "WorkflowRequest"));
}

export function workflowResultJsonSchema(): Record<string, unknown> {
  return structuredClone(jsonSchema(workflowResultSchema, "WorkflowResult"));
}

export type WorkflowEvidenceRequest = {
  sessionId: string;
  handle: string;
  revision: number;
  operation: string;
  params?: WorkflowJsonValue;
  /** Defensive canonical clones; never workspace-owned objects. */
  beforeScene: Scene;
  scene: Scene;
  afterScene: Scene;
  /** The one most recent successful commit/undo/redo, if any. */
  history?: WorkspaceHistoryEntry;
};

export interface WorkflowEvidenceAdapter {
  run(request: WorkflowEvidenceRequest): unknown | Promise<unknown>;
  disposeHandle?(context: {
    sessionId: string;
    handle: string;
  }): void | Promise<void>;
  dispose?(context: { sessionId: string }): void | Promise<void>;
}

export type AgentWorkflowSessionOptions = {
  sessionId?: string;
  maxHandles?: number;
  maxEvents?: number;
  maxResultValues?: number;
  maxResultDepth?: number;
  historyLimit?: number;
  sceneLimits?: Partial<SceneComplexityLimits>;
  commandContext?: CompileSceneCommandsContext;
  evidence?: WorkflowEvidenceAdapter;
};

export type WorkflowHostSnapshot = SceneWorkspaceSnapshot & {
  sessionId: string;
  handle: string;
};

export type WorkflowEventListener = (event: WorkflowEvent) => unknown;

type WorkspaceRecord = {
  workspace: SceneWorkspace;
  order: number;
  previousScene: Scene;
  lastHistory?: WorkspaceHistoryEntry;
};

type DispatchResult = {
  handle?: string;
  revision?: number;
  data?: WorkflowJsonValue;
};

export type WorkflowErrorCode =
  | "invalid_request"
  | "scene_rejected"
  | "handle_limit"
  | "unknown_handle"
  | "unknown_node"
  | "cross_session_handle"
  | "invalid_frame"
  | "stale_revision"
  | "command_failed"
  | "workspace_failed"
  | "evidence_unavailable"
  | "evidence_failed"
  | "cleanup_failed"
  | "non_json_result"
  | "result_budget"
  | "session_disposed";

export class WorkflowError extends Error {
  constructor(
    readonly code: WorkflowErrorCode,
    message: string,
    readonly details?: unknown,
  ) {
    super(message);
    this.name = "WorkflowError";
  }
}

let nextDefaultSessionId = 1;

/**
 * Session-scoped handle runtime. All operations are serialized, so workspace
 * revisions, evidence borrows, event order, and cleanup are deterministic.
 */
export class AgentWorkflowSession {
  readonly id: string;
  private readonly maxHandles: number;
  private readonly maxEvents: number;
  private readonly maxResultValues: number;
  private readonly maxResultDepth: number;
  private readonly historyLimit: number;
  private readonly sceneLimits: Partial<SceneComplexityLimits>;
  private readonly commandContext?: CompileSceneCommandsContext;
  private readonly evidence?: WorkflowEvidenceAdapter;
  private readonly workspaces = new Map<string, WorkspaceRecord>();
  private readonly listeners = new Set<WorkflowEventListener>();
  private readonly eventLog: WorkflowEvent[] = [];
  private handleCounter = 0;
  private operationCounter = 0;
  private eventCounter = 0;
  private disposed = false;
  private tail: Promise<void> = Promise.resolve();

  constructor(options: AgentWorkflowSessionOptions = {}) {
    const defaultId = `mfwf-s${nextDefaultSessionId++}`;
    this.id = options.sessionId ?? defaultId;
    if (!/^[A-Za-z][A-Za-z0-9_-]{0,63}$/.test(this.id)) {
      throw new TypeError(
        "sessionId must start with a letter and contain at most 64 letters, numbers, underscore, or hyphen characters.",
      );
    }
    this.maxHandles = boundedInteger(
      options.maxHandles,
      DEFAULT_MAX_HANDLES,
      1,
      256,
      "maxHandles",
    );
    this.maxEvents = boundedInteger(
      options.maxEvents,
      DEFAULT_MAX_EVENTS,
      4,
      10_000,
      "maxEvents",
    );
    this.maxResultValues = boundedInteger(
      options.maxResultValues,
      DEFAULT_MAX_RESULT_VALUES,
      100,
      1_000_000,
      "maxResultValues",
    );
    this.maxResultDepth = boundedInteger(
      options.maxResultDepth,
      DEFAULT_MAX_RESULT_DEPTH,
      4,
      8,
      "maxResultDepth",
    );
    this.historyLimit = boundedInteger(
      options.historyLimit,
      DEFAULT_HISTORY_LIMIT,
      1,
      10_000,
      "historyLimit",
    );
    this.sceneLimits = structuredClone(options.sceneLimits ?? {});
    this.commandContext = options.commandContext
      ? structuredClone(options.commandContext)
      : undefined;
    this.evidence = options.evidence;
  }

  /** Subscribe without binding to an agent/model provider. */
  onEvent(listener: WorkflowEventListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /** All requests serialize through one session queue and never reject. */
  execute(input: unknown): Promise<WorkflowResult> {
    const safeInput = normalizeWorkflowInput(input);
    const run = this.tail.then(
      () => this.executeNow(safeInput),
      () => this.executeNow(safeInput),
    );
    this.tail = run.then(
      () => undefined,
      () => undefined,
    );
    return run;
  }

  dispose(): Promise<WorkflowResult> {
    return this.execute({ action: "session.dispose" });
  }

  /** Trusted host accessor; never included in model-facing tool descriptors. */
  hostSnapshot(handle: string): Promise<Readonly<WorkflowHostSnapshot>> {
    return this.enqueueHost(() => {
      if (this.disposed) {
        throw new WorkflowError(
          "session_disposed",
          `Workflow session ${JSON.stringify(this.id)} is disposed.`,
        );
      }
      const snapshot = this.requireWorkspace(handle).snapshot();
      return deepFreeze({
        sessionId: this.id,
        handle,
        ...structuredClone(snapshot),
      });
    });
  }

  /** Trusted host accessor for committed forward/inverse patch evidence. */
  hostHistory(handle: string): Promise<readonly WorkspaceHistoryEntry[]> {
    return this.enqueueHost(() => {
      if (this.disposed) {
        throw new WorkflowError(
          "session_disposed",
          `Workflow session ${JSON.stringify(this.id)} is disposed.`,
        );
      }
      return deepFreeze(structuredClone(this.requireWorkspace(handle).history));
    });
  }

  private async executeNow(input: unknown): Promise<WorkflowResult> {
    const operationId = `op-${++this.operationCounter}`;
    const action = inputAction(input);
    const rawHandle = inputHandle(input);
    const start = this.emit({
      operationId,
      action,
      phase: "start",
      ...(rawHandle ? { handle: rawHandle } : {}),
    });
    const parsed = workflowRequestSchema.safeParse(input);
    if (!parsed.success) {
      const error = {
        code: "invalid_request",
        message: "Workflow request failed strict validation.",
        details: toBoundedJson(
          parsed.error.issues.slice(0, 32).map((issue) => ({
            path: issue.path,
            code: issue.code,
            message: issue.message,
          })),
          this.resultLimits(),
          "validation issues",
        ),
      };
      const terminal = this.previewEvent({
        operationId,
        action,
        phase: "error",
        ...(rawHandle ? { handle: rawHandle } : {}),
        details: { code: error.code },
      });
      const result = this.validateResult({
        ok: false,
        sessionId: this.id,
        operationId,
        action,
        ...(rawHandle ? { handle: rawHandle } : {}),
        error,
        events: [start, terminal],
      });
      this.publishEvent(terminal);
      return result;
    }

    const request = parsed.data;
    try {
      const dispatched = await this.dispatch(request);
      const data = dispatched.data
        ? toBoundedJson(
            dispatched.data,
            this.resultLimits(),
            `${request.action} result`,
          )
        : undefined;
      const terminal = this.previewEvent({
        operationId,
        action: request.action,
        phase: "complete",
        ...(dispatched.handle ? { handle: dispatched.handle } : {}),
        ...(dispatched.revision === undefined
          ? {}
          : { revision: dispatched.revision }),
      });
      const result = this.validateResult({
        ok: true,
        sessionId: this.id,
        operationId,
        action: request.action,
        ...(dispatched.handle ? { handle: dispatched.handle } : {}),
        ...(dispatched.revision === undefined
          ? {}
          : { revision: dispatched.revision }),
        ...(data === undefined ? {} : { data }),
        events: [start, terminal],
      });
      this.publishEvent(terminal);
      return result;
    } catch (cause) {
      const normalized = this.normalizeErrorSafely(cause);
      const handle = "handle" in request ? request.handle : undefined;
      const revision = handle
        ? this.workspaces.get(handle)?.workspace.revision
        : undefined;
      const terminal = this.previewEvent({
        operationId,
        action: request.action,
        phase: "error",
        ...(handle ? { handle } : {}),
        ...(revision === undefined ? {} : { revision }),
        details: { code: normalized.code },
      });
      const result = this.validateResult({
        ok: false,
        sessionId: this.id,
        operationId,
        action: request.action,
        ...(handle ? { handle } : {}),
        ...(revision === undefined ? {} : { revision }),
        error: normalized,
        events: [start, terminal],
      });
      this.publishEvent(terminal);
      return result;
    }
  }

  private async dispatch(request: WorkflowRequest): Promise<DispatchResult> {
    if (this.disposed) {
      if (request.action === "session.dispose") {
        return { data: { disposed: true, alreadyDisposed: true } };
      }
      if (request.action !== "events.read") {
        throw new WorkflowError(
          "session_disposed",
          `Workflow session ${JSON.stringify(this.id)} is disposed.`,
        );
      }
    }

    switch (request.action) {
      case "workspace.load":
        return this.load(request);
      case "workspace.read":
        return this.read(request);
      case "workspace.search":
        return this.search(request);
      case "workspace.check":
        return this.check(request);
      case "commands.apply":
        return this.applyCommands(request);
      case "workspace.undo":
        return this.undo(request);
      case "workspace.redo":
        return this.redo(request);
      case "evidence.run":
        return this.runEvidence(request);
      case "workspace.close":
        return this.close(request);
      case "events.read":
        return this.readEvents(request);
      case "session.dispose":
        return this.disposeSession();
    }
  }

  private load(
    request: z.infer<typeof workflowLoadInputSchema>,
  ): DispatchResult {
    if (this.workspaces.size >= this.maxHandles) {
      throw new WorkflowError(
        "handle_limit",
        `Session handle limit ${this.maxHandles} reached; close a workspace before loading another Scene.`,
        { limit: this.maxHandles },
      );
    }
    const preflight = preflightScene(request.scene, this.sceneLimits);
    if (!preflight.ok) {
      throw new WorkflowError(
        "scene_rejected",
        "Scene failed the strict bounded workflow load boundary.",
        {
          issues: preflight.issues.slice(0, 32).map((issue) => ({
            code: issue.code,
            path: issue.path,
            message: issue.message,
            ...(issue.actual === undefined ? {} : { actual: issue.actual }),
            ...(issue.limit === undefined ? {} : { limit: issue.limit }),
          })),
        },
      );
    }
    const handle = `${this.id}:w${++this.handleCounter}`;
    const workspace = createSceneWorkspace(preflight.scene, {
      historyLimit: Math.min(
        request.historyLimit ?? this.historyLimit,
        this.historyLimit,
      ),
      ...(this.commandContext ? { commandContext: this.commandContext } : {}),
    });
    this.workspaces.set(handle, {
      workspace,
      order: this.handleCounter,
      previousScene: workspace.read(),
    });
    return {
      handle,
      revision: 0,
      data: {
        loaded: true,
        summary: sceneSummary(workspace.read()),
        complexity: {
          nodes: preflight.usage.nodes,
          assets: preflight.usage.assets,
          maxDepth: preflight.usage.maxDepth,
          documentValues: preflight.usage.documentValues,
        },
      },
    };
  }

  private read(
    request: z.infer<typeof workflowReadInputSchema>,
  ): DispatchResult {
    const workspace = this.requireWorkspace(request.handle);
    this.assertRevision(workspace, request.expectedRevision);
    const scene = workspace.read();
    const tree = inspectTree(scene);
    if (request.view === "node") {
      const row = tree.nodes.find((node) => node.id === request.id);
      if (!row) {
        throw new WorkflowError(
          "unknown_node",
          `No node has id ${JSON.stringify(request.id)} in workspace ${JSON.stringify(request.handle)}.`,
          { nodeId: request.id },
        );
      }
      return {
        handle: request.handle,
        revision: workspace.revision,
        data: { view: "node", node: flatNode(scene, row) },
      };
    }
    const limit = request.limit ?? DEFAULT_READ_LIMIT;
    const assets = flatAssetCatalog(scene, limit);
    return {
      handle: request.handle,
      revision: workspace.revision,
      data: {
        view: "summary",
        ...sceneSummary(scene),
        canUndo: workspace.canUndo,
        canRedo: workspace.canRedo,
        historyEntries: workspace.history.length,
        nodes: tree.nodes.slice(0, limit).map((row) => flatNode(scene, row)),
        truncated: tree.nodes.length > limit,
        assetCatalog: assets.rows,
        assetsTruncated: assets.truncated,
      },
    };
  }

  private search(
    request: z.infer<typeof workflowSearchInputSchema>,
  ): DispatchResult {
    const workspace = this.requireWorkspace(request.handle);
    this.assertRevision(workspace, request.expectedRevision);
    const scene = workspace.read();
    const query = request.query?.trim().toLocaleLowerCase("en-US") ?? "";
    const types = new Set(request.types ?? []);
    const tree = inspectTree(scene);
    const matches = tree.nodes.filter((row) => {
      const node = findNode(scene, row.id);
      if (!node) return false;
      if (types.size > 0 && !types.has(node.type)) return false;
      if (query === "") return true;
      const haystack = [node.id, node.text ?? "", node.assetId ?? "", node.type]
        .join("\u0000")
        .toLocaleLowerCase("en-US");
      return haystack.includes(query);
    });
    const limit = request.limit ?? DEFAULT_READ_LIMIT;
    return {
      handle: request.handle,
      revision: workspace.revision,
      data: {
        total: matches.length,
        matches: matches.slice(0, limit).map((row) => flatNode(scene, row)),
        truncated: matches.length > limit,
      },
    };
  }

  private check(
    request: z.infer<typeof workflowCheckInputSchema>,
  ): DispatchResult {
    const workspace = this.requireWorkspace(request.handle);
    this.assertRevision(workspace, request.expectedRevision);
    const scene = workspace.read();
    const invalidFrame = request.frames?.find(
      (frame) => frame >= scene.duration,
    );
    if (invalidFrame !== undefined) {
      throw new WorkflowError(
        "invalid_frame",
        `Check frame ${invalidFrame} must be inside [0, ${scene.duration}).`,
        { frame: invalidFrame, duration: scene.duration },
      );
    }
    const checked = checkScene(scene, {
      ...(request.frames ? { frames: request.frames } : {}),
      ...(request.sampleCount === undefined
        ? {}
        : { sampleCount: request.sampleCount }),
      ...(request.unsafeInsets === undefined
        ? {}
        : { unsafeInsets: request.unsafeInsets }),
      ...(request.excessiveCropThreshold === undefined
        ? {}
        : { excessiveCropThreshold: request.excessiveCropThreshold }),
    });
    const diagnostics = checked.composition?.diagnostics ?? [];
    const limit = request.maxDiagnostics ?? 100;
    return {
      handle: request.handle,
      revision: workspace.revision,
      data: {
        kind: checked.kind,
        version: checked.version,
        ok: checked.ok,
        summary: checked.summary,
        validation: checked.validation,
        lint: checked.lint.issues.slice(0, limit).map((issue) => ({
          code: issue.code,
          severity: issue.severity,
          path: issue.path,
          message: issue.message,
        })),
        diagnostics: diagnostics.slice(0, limit).map((diagnostic) => ({
          code: diagnostic.code,
          severity: diagnostic.severity,
          nodeId: diagnostic.nodeId,
          relatedNodeIds: diagnostic.relatedNodeIds,
          frame: diagnostic.frame,
          reason: diagnostic.reason,
          remediation: diagnostic.remediation,
          confidence: diagnostic.confidence,
        })),
        truncated:
          diagnostics.length > limit || checked.lint.issues.length > limit,
      },
    };
  }

  private applyCommands(
    request: z.infer<typeof workflowCommandsInputSchema>,
  ): DispatchResult {
    const record = this.requireWorkspaceRecord(request.handle);
    const workspace = record.workspace;
    const before = workspace.read();
    const draft = workspace.draft(request.commands, request.expectedRevision);
    this.assertCandidateScene(draft.scene, "command transaction");
    const data = toBoundedJson(
      { changed: true, history: summarizeDraft(draft) },
      this.resultLimits(),
      "command transaction result",
    );
    const entry = workspace.commit(draft, request.expectedRevision);
    record.previousScene = before;
    record.lastHistory = structuredClone(entry);
    return {
      handle: request.handle,
      revision: workspace.revision,
      data,
    };
  }

  private undo(
    request: z.infer<typeof workflowUndoInputSchema>,
  ): DispatchResult {
    const record = this.requireWorkspaceRecord(request.handle);
    const workspace = record.workspace;
    const before = workspace.read();
    const preview = workspace.previewUndo(request.expectedRevision);
    if (!preview.changed) {
      return {
        handle: request.handle,
        revision: workspace.revision,
        data: { changed: false },
      };
    }
    this.assertCandidateScene(preview.scene, "undo transaction");
    const data = toBoundedJson(
      { changed: true, history: summarizeHistory(preview.history) },
      this.resultLimits(),
      "undo transaction result",
    );
    const entry = workspace.undo(request.expectedRevision);
    if (!entry) {
      throw new WorkflowError(
        "workspace_failed",
        "Undo candidate disappeared before publication.",
      );
    }
    if (entry) {
      record.previousScene = before;
      record.lastHistory = structuredClone(entry);
    }
    return {
      handle: request.handle,
      revision: workspace.revision,
      data,
    };
  }

  private redo(
    request: z.infer<typeof workflowRedoInputSchema>,
  ): DispatchResult {
    const record = this.requireWorkspaceRecord(request.handle);
    const workspace = record.workspace;
    const before = workspace.read();
    const preview = workspace.previewRedo(request.expectedRevision);
    if (!preview.changed) {
      return {
        handle: request.handle,
        revision: workspace.revision,
        data: { changed: false },
      };
    }
    this.assertCandidateScene(preview.scene, "redo transaction");
    const data = toBoundedJson(
      { changed: true, history: summarizeHistory(preview.history) },
      this.resultLimits(),
      "redo transaction result",
    );
    const entry = workspace.redo(request.expectedRevision);
    if (!entry) {
      throw new WorkflowError(
        "workspace_failed",
        "Redo candidate disappeared before publication.",
      );
    }
    if (entry) {
      record.previousScene = before;
      record.lastHistory = structuredClone(entry);
    }
    return {
      handle: request.handle,
      revision: workspace.revision,
      data,
    };
  }

  private async runEvidence(
    request: z.infer<typeof workflowEvidenceInputSchema>,
  ): Promise<DispatchResult> {
    const record = this.requireWorkspaceRecord(request.handle);
    const workspace = record.workspace;
    this.assertRevision(workspace, request.expectedRevision);
    if (!this.evidence) {
      throw new WorkflowError(
        "evidence_unavailable",
        "No evidence adapter is installed for this workflow session.",
      );
    }
    let result: unknown;
    try {
      const afterScene = workspace.read();
      result = await this.evidence.run({
        sessionId: this.id,
        handle: request.handle,
        revision: workspace.revision,
        operation: request.operation,
        ...(request.params === undefined
          ? {}
          : { params: request.params as WorkflowJsonValue }),
        beforeScene: structuredClone(record.previousScene),
        scene: structuredClone(afterScene),
        afterScene,
        ...(record.lastHistory
          ? { history: structuredClone(record.lastHistory) }
          : {}),
      });
    } catch (cause) {
      throw new WorkflowError(
        "evidence_failed",
        `Evidence operation ${JSON.stringify(request.operation)} failed: ${safeMessage(cause)}.`,
        { operation: request.operation },
      );
    }
    return {
      handle: request.handle,
      revision: workspace.revision,
      data: {
        operation: request.operation,
        result: toBoundedJson(
          result,
          this.resultLimits(),
          `evidence ${request.operation}`,
        ),
      },
    };
  }

  private async close(
    request: z.infer<typeof workflowCloseInputSchema>,
  ): Promise<DispatchResult> {
    const workspace = this.requireWorkspace(request.handle);
    this.assertRevision(workspace, request.expectedRevision);
    let failure: unknown;
    try {
      await this.evidence?.disposeHandle?.({
        sessionId: this.id,
        handle: request.handle,
      });
    } catch (cause) {
      failure = cause;
    } finally {
      this.workspaces.delete(request.handle);
    }
    if (failure) {
      throw new WorkflowError(
        "cleanup_failed",
        `Workspace ${JSON.stringify(request.handle)} closed but evidence cleanup failed: ${safeMessage(failure)}.`,
        { handle: request.handle },
      );
    }
    return {
      handle: request.handle,
      revision: workspace.revision,
      data: { closed: true },
    };
  }

  private readEvents(
    request: z.infer<typeof workflowEventsInputSchema>,
  ): DispatchResult {
    const after = request.afterSequence ?? 0;
    const limit = request.limit ?? 100;
    const matches = this.eventLog.filter((event) => event.sequence > after);
    return {
      data: {
        events: matches.slice(0, limit),
        truncated: matches.length > limit,
        latestSequence: this.eventCounter,
      },
    };
  }

  private async disposeSession(): Promise<DispatchResult> {
    if (this.disposed) {
      return { data: { disposed: true, alreadyDisposed: true } };
    }
    const errors: Array<{ handle?: string; message: string }> = [];
    const handles = [...this.workspaces.entries()].sort(
      (left, right) => left[1].order - right[1].order,
    );
    for (const [handle] of handles) {
      try {
        await this.evidence?.disposeHandle?.({ sessionId: this.id, handle });
      } catch (cause) {
        errors.push({ handle, message: safeMessage(cause) });
      } finally {
        this.workspaces.delete(handle);
      }
    }
    try {
      await this.evidence?.dispose?.({ sessionId: this.id });
    } catch (cause) {
      errors.push({ message: safeMessage(cause) });
    }
    this.disposed = true;
    if (errors.length > 0) {
      throw new WorkflowError(
        "cleanup_failed",
        "Workflow session disposed with evidence cleanup failures.",
        { errors },
      );
    }
    return {
      data: {
        disposed: true,
        alreadyDisposed: false,
        handlesClosed: handles.length,
      },
    };
  }

  private requireWorkspace(handle: string): SceneWorkspace {
    return this.requireWorkspaceRecord(handle).workspace;
  }

  private requireWorkspaceRecord(handle: string): WorkspaceRecord {
    const found = this.workspaces.get(handle);
    if (found) return found;
    const separator = handle.lastIndexOf(":w");
    if (separator > 0 && handle.slice(0, separator) !== this.id) {
      throw new WorkflowError(
        "cross_session_handle",
        `Workspace handle ${JSON.stringify(handle)} belongs to another session.`,
      );
    }
    throw new WorkflowError(
      "unknown_handle",
      `Unknown or closed workspace handle ${JSON.stringify(handle)}.`,
    );
  }

  private assertRevision(
    workspace: SceneWorkspace,
    expected: number | undefined,
  ): void {
    if (expected !== undefined && workspace.revision !== expected) {
      throw new WorkflowError(
        "stale_revision",
        `Stale workspace revision: expected ${expected}, current revision is ${workspace.revision}.`,
        { expectedRevision: expected, actualRevision: workspace.revision },
      );
    }
  }

  private assertCandidateScene(scene: Scene, label: string): void {
    const preflight = preflightScene(scene, this.sceneLimits);
    if (preflight.ok) return;
    throw new WorkflowError(
      "scene_rejected",
      `${label} exceeds the workflow Scene policy and was not published.`,
      {
        issues: preflight.issues.slice(0, 32).map((issue) => ({
          code: issue.code,
          path: issue.path,
          message: issue.message,
          ...(issue.actual === undefined ? {} : { actual: issue.actual }),
          ...(issue.limit === undefined ? {} : { limit: issue.limit }),
        })),
      },
    );
  }

  private emit(
    input: Omit<WorkflowEvent, "sequence" | "sessionId">,
  ): WorkflowEvent {
    return this.publishEvent(this.previewEvent(input));
  }

  private previewEvent(
    input: Omit<WorkflowEvent, "sequence" | "sessionId">,
  ): WorkflowEvent {
    return workflowEventSchema.parse({
      ...input,
      sequence: this.eventCounter + 1,
      sessionId: this.id,
    });
  }

  private publishEvent(eventInput: WorkflowEvent): WorkflowEvent {
    const event = workflowEventSchema.parse(eventInput);
    if (event.sequence !== this.eventCounter + 1) {
      throw new Error("Workflow event sequence publication is out of order.");
    }
    this.eventCounter = event.sequence;
    this.eventLog.push(event);
    if (this.eventLog.length > this.maxEvents) {
      this.eventLog.splice(0, this.eventLog.length - this.maxEvents);
    }
    for (const listener of this.listeners) {
      try {
        const returned = listener(structuredClone(event));
        if (
          returned &&
          typeof returned === "object" &&
          "then" in returned &&
          typeof returned.then === "function"
        ) {
          void Promise.resolve(returned).catch(() => undefined);
        }
      } catch {
        // Event observers never affect workflow semantics.
      }
    }
    return structuredClone(event);
  }

  private normalizeError(cause: unknown): z.infer<typeof workflowErrorSchema> {
    if (cause instanceof WorkflowError) {
      return workflowErrorSchema.parse({
        code: cause.code,
        message: boundedMessage(cause.message),
        ...(cause.details === undefined
          ? {}
          : {
              details: toBoundedJson(
                cause.details,
                this.resultLimits(),
                "workflow error details",
              ),
            }),
      });
    }
    if (cause instanceof SceneWorkspaceError) {
      const code =
        cause.code === "stale_revision"
          ? "stale_revision"
          : cause.code === "command_failed"
            ? "command_failed"
            : "workspace_failed";
      return workflowErrorSchema.parse({
        code,
        message: boundedMessage(cause.message),
        ...(cause.details === undefined
          ? {}
          : {
              details: toBoundedJson(
                cause.details,
                this.resultLimits(),
                "workspace error details",
              ),
            }),
      });
    }
    return workflowErrorSchema.parse({
      code: "workspace_failed",
      message: boundedMessage(safeMessage(cause)),
    });
  }

  private normalizeErrorSafely(
    cause: unknown,
  ): z.infer<typeof workflowErrorSchema> {
    try {
      return this.normalizeError(cause);
    } catch (normalizationFailure) {
      return workflowErrorSchema.parse({
        code:
          normalizationFailure instanceof WorkflowError
            ? normalizationFailure.code
            : "non_json_result",
        message: boundedMessage(
          `Workflow failure details could not be serialized: ${safeMessage(normalizationFailure)}.`,
        ),
      });
    }
  }

  private validateResult(value: unknown): WorkflowResult {
    return workflowResultSchema.parse(value);
  }

  private resultLimits(): JsonLimits {
    return {
      maxValues: this.maxResultValues,
      maxDepth: this.maxResultDepth,
      maxArray: MAX_JSON_ARRAY,
      maxProperties: MAX_JSON_PROPERTIES,
      maxString: MAX_RESULT_STRING,
    };
  }

  private enqueueHost<T>(operation: () => T | Promise<T>): Promise<T> {
    const run = this.tail.then(operation, operation);
    this.tail = run.then(
      () => undefined,
      () => undefined,
    );
    return run;
  }
}

export function createAgentWorkflowSession(
  options?: AgentWorkflowSessionOptions,
): AgentWorkflowSession {
  return new AgentWorkflowSession(options);
}

export type AgentWorkflowToolRegistryOptions = {
  session?: AgentWorkflowSession;
  sessionOptions?: AgentWorkflowSessionOptions;
};

/** Provider-neutral name/input adapter; tool callers never send `action`. */
export class AgentWorkflowToolRegistry {
  readonly session: AgentWorkflowSession;

  constructor(options: AgentWorkflowToolRegistryOptions = {}) {
    if (options.session && options.sessionOptions) {
      throw new TypeError("Provide session or sessionOptions, not both.");
    }
    this.session =
      options.session ?? createAgentWorkflowSession(options.sessionOptions);
  }

  list(): WorkflowToolDescriptor[] {
    return workflowToolDescriptors();
  }

  call(name: string, input: unknown): Promise<WorkflowResult> {
    const definition = workflowToolDefinitions.find(
      (candidate) => candidate.name === name,
    );
    let safeInput: Record<string, unknown> | undefined;
    try {
      const cloned = structuredClone(input);
      if (isPlainRecord(cloned) && !Object.hasOwn(cloned, "action")) {
        safeInput = cloned;
      }
    } catch {
      safeInput = undefined;
    }
    if (!definition || !safeInput || typeof name !== "string") {
      return this.session.execute({
        action: "request.invalid",
        tool: name,
      });
    }
    return this.session.execute({
      ...safeInput,
      action: definition.action,
    });
  }

  hostSnapshot(handle: string): Promise<Readonly<WorkflowHostSnapshot>> {
    return this.session.hostSnapshot(handle);
  }

  hostHistory(handle: string): Promise<readonly WorkspaceHistoryEntry[]> {
    return this.session.hostHistory(handle);
  }

  dispose(): Promise<WorkflowResult> {
    return this.session.dispose();
  }
}

export function createAgentWorkflowToolRegistry(
  options?: AgentWorkflowToolRegistryOptions,
): AgentWorkflowToolRegistry {
  return new AgentWorkflowToolRegistry(options);
}

function sceneSummary(scene: Scene): Record<string, WorkflowJsonValue> {
  return {
    schemaVersion: scene.schemaVersion,
    width: scene.width,
    height: scene.height,
    fps: scene.fps,
    duration: scene.duration,
    assets: Object.keys(scene.assets).length,
    rootNodes: scene.nodes.length,
  };
}

function flatNode(scene: Scene, row: TreeInspectionNode): WorkflowJsonValue {
  const node = findNode(scene, row.id)!;
  const text = node.text ?? node.runs?.map((run) => run.text).join("");
  const boundedText =
    text === undefined
      ? undefined
      : text.length <= 2_000
        ? text
        : `${text.slice(0, 2_000)}…`;
  const assetId =
    node.assetId === undefined ? undefined : displayIdentity(node.assetId);
  const envelope = node.volumeEnvelope ?? [];
  const animations = node.animations ?? [];
  return {
    id: node.id,
    type: node.type,
    parentId: row.parentId,
    depth: row.depth,
    documentOrder: row.documentOrder,
    sourcePath: row.sourcePath,
    localWindow: row.localWindow,
    absoluteWindow: row.absoluteWindow,
    ...(boundedText === undefined
      ? {}
      : { text: boundedText, textTruncated: text!.length > 2_000 }),
    ...(assetId === undefined
      ? {}
      : {
          assetId,
          assetIdTruncated: node.assetId!.length > MAX_DISPLAY_ID_LENGTH,
        }),
    ...(node.effect === undefined ? {} : { effect: node.effect }),
    from: node.from ?? 0,
    ...(node.duration === undefined ? {} : { duration: node.duration }),
    ...(node.videoStartTime === undefined
      ? {}
      : { videoStartTime: node.videoStartTime }),
    ...(node.playbackRate === undefined
      ? {}
      : { playbackRate: node.playbackRate }),
    ...(node.audioStartTime === undefined
      ? {}
      : { audioStartTime: node.audioStartTime }),
    ...(node.volume === undefined ? {} : { volume: node.volume }),
    ...(node.audioBus === undefined ? {} : { audioBus: node.audioBus }),
    ...(node.pan === undefined ? {} : { pan: node.pan }),
    ...(node.ducks === undefined ? {} : { ducks: node.ducks }),
    ...(node.videoEndBehavior === undefined
      ? {}
      : { videoEndBehavior: node.videoEndBehavior }),
    ...(node.loop === undefined ? {} : { loop: node.loop }),
    ...(envelope.length === 0
      ? {}
      : {
          volumeEnvelope: envelope.slice(0, 100).map((point) => ({
            frame: point.frame,
            value: point.value,
            ...(point.easing === undefined ? {} : { easing: point.easing }),
          })),
          volumeEnvelopePoints: envelope.length,
          volumeEnvelopeTruncated: envelope.length > 100,
        }),
    animationTracks: animations.slice(0, 64).map((animation) => ({
      property: animation.property,
      ...(animation.repeat === undefined ? {} : { repeat: animation.repeat }),
      ...(animation.yoyo === undefined ? {} : { yoyo: animation.yoyo }),
      keyframes: animation.frames.slice(0, 64).map((frame) => ({
        frame: frame.frame,
        value: frame.value,
        ...(frame.easing === undefined ? {} : { easing: frame.easing }),
      })),
      keyframesTotal: animation.frames.length,
      keyframesTruncated: animation.frames.length > 64,
    })),
    animationTracksTotal: animations.length,
    animationTracksTruncated: animations.length > 64,
    style: node.style ?? {},
    childIds: (node.children ?? [])
      .slice(0, MAX_JSON_ARRAY)
      .map((child) => child.id),
    childrenTruncated: (node.children?.length ?? 0) > MAX_JSON_ARRAY,
  };
}

function flatAssetCatalog(
  scene: Scene,
  limit: number,
): { rows: WorkflowJsonValue[]; truncated: boolean } {
  const assets = Object.values(scene.assets).sort((left, right) =>
    left.id < right.id ? -1 : left.id > right.id ? 1 : 0,
  );
  return {
    rows: assets.slice(0, limit).map((asset) => ({
      id: displayIdentity(asset.id),
      idTruncated: asset.id.length > MAX_DISPLAY_ID_LENGTH,
      type: asset.type,
      metadata: boundedAssetMetadata(asset.metadata),
    })),
    truncated: assets.length > limit,
  };
}

function boundedAssetMetadata(
  metadata: Scene["assets"][string]["metadata"],
): WorkflowJsonValue {
  if (!metadata) return {};
  return {
    ...(metadata.duration === undefined ? {} : { duration: metadata.duration }),
    ...(metadata.width === undefined ? {} : { width: metadata.width }),
    ...(metadata.height === undefined ? {} : { height: metadata.height }),
    ...(metadata.byteLength === undefined
      ? {}
      : { byteLength: metadata.byteLength }),
    ...(metadata.mimeType === undefined
      ? {}
      : { mimeType: metadata.mimeType.slice(0, 512) }),
    ...(metadata.codec === undefined
      ? {}
      : { codec: metadata.codec.slice(0, 512) }),
    ...(metadata.hasAudio === undefined ? {} : { hasAudio: metadata.hasAudio }),
    ...(metadata.audioCodec === undefined
      ? {}
      : { audioCodec: metadata.audioCodec.slice(0, 512) }),
    ...(metadata.audioSampleRate === undefined
      ? {}
      : { audioSampleRate: metadata.audioSampleRate }),
    ...(metadata.audioChannels === undefined
      ? {}
      : { audioChannels: metadata.audioChannels }),
    ...(metadata.frameRate === undefined
      ? {}
      : { frameRate: metadata.frameRate }),
    ...(metadata.variableFrameRate === undefined
      ? {}
      : { variableFrameRate: metadata.variableFrameRate }),
    ...(metadata.contentHash === undefined
      ? {}
      : { contentHash: metadata.contentHash }),
  };
}

function findNode(scene: Scene, id: string): SceneNode | undefined {
  const stack = [...scene.nodes].reverse();
  while (stack.length > 0) {
    const node = stack.pop()!;
    if (node.id === id) return node;
    for (let index = (node.children?.length ?? 0) - 1; index >= 0; index -= 1) {
      stack.push(node.children![index]!);
    }
  }
  return undefined;
}

const MAX_DISPLAY_AFFECTED_IDS = 200;
const MAX_DISPLAY_ID_LENGTH = 191;

function summarizeDraft(draft: WorkspaceDraft): WorkflowJsonValue {
  return summarizeTransaction({
    kind: "commit",
    revisionBefore: draft.baseRevision,
    revisionAfter: draft.baseRevision + 1,
    affectedIds: draft.affectedIds,
    diff: draft.semanticDiff.summary,
    diagnostics: draft.diagnostics,
  });
}

function summarizeHistory(entry: WorkspaceHistoryEntry): WorkflowJsonValue {
  return summarizeTransaction({
    kind: entry.kind,
    revisionBefore: entry.revisionBefore,
    revisionAfter: entry.revisionAfter,
    affectedIds: entry.affectedIds,
    diff: entry.semanticDiff.summary,
    diagnostics: entry.diagnostics,
  });
}

function summarizeTransaction(input: {
  kind: WorkspaceHistoryEntry["kind"];
  revisionBefore: number;
  revisionAfter: number;
  affectedIds: string[];
  diff: WorkspaceHistoryEntry["semanticDiff"]["summary"];
  diagnostics: WorkspaceHistoryEntry["diagnostics"];
}): WorkflowJsonValue {
  const displayedIds = input.affectedIds
    .slice(0, MAX_DISPLAY_AFFECTED_IDS)
    .map(displayIdentity);
  return {
    kind: input.kind,
    revisionBefore: input.revisionBefore,
    revisionAfter: input.revisionAfter,
    affectedIds: displayedIds,
    affectedIdsTotal: input.affectedIds.length,
    affectedIdsTruncated:
      input.affectedIds.length > displayedIds.length ||
      input.affectedIds.some((id) => id.length > MAX_DISPLAY_ID_LENGTH),
    diff: input.diff,
    diagnostics: input.diagnostics.slice(0, 100).map((diagnostic) => ({
      commandIndex: diagnostic.commandIndex,
      kind: diagnostic.kind,
      severity: diagnostic.severity,
      code: diagnostic.code,
      message: diagnostic.message.slice(0, 2_048),
      affectedIds: diagnostic.affectedIds
        .slice(0, MAX_DISPLAY_AFFECTED_IDS)
        .map(displayIdentity),
      affectedIdsTotal: diagnostic.affectedIds.length,
      affectedIdsTruncated:
        diagnostic.affectedIds.length > MAX_DISPLAY_AFFECTED_IDS ||
        diagnostic.affectedIds.some((id) => id.length > MAX_DISPLAY_ID_LENGTH),
    })),
  };
}

function displayIdentity(value: string): string {
  if (value.length <= MAX_DISPLAY_ID_LENGTH) return value;
  return `${value.slice(0, 128)}…[length=${value.length},fnv1a=${fnv1a(value)}]`;
}

function fnv1a(value: string): string {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

function inputAction(input: unknown): string {
  if (
    input &&
    typeof input === "object" &&
    !Array.isArray(input) &&
    typeof (input as Record<string, unknown>).action === "string"
  ) {
    const value = (input as Record<string, unknown>).action as string;
    return value.length > 0 && value.length <= MAX_ACTION_LENGTH
      ? value
      : "request.invalid";
  }
  return "request.invalid";
}

function normalizeWorkflowInput(input: unknown): unknown {
  try {
    return structuredClone(input);
  } catch {
    return {
      action: "request.invalid",
      boundaryError: "Workflow input could not be cloned as data.",
    };
  }
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return false;
  }
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function inputHandle(input: unknown): string | undefined {
  if (
    input &&
    typeof input === "object" &&
    !Array.isArray(input) &&
    typeof (input as Record<string, unknown>).handle === "string"
  ) {
    const value = (input as Record<string, unknown>).handle as string;
    return value.length > 0 && value.length <= MAX_HANDLE_LENGTH
      ? value
      : undefined;
  }
  return undefined;
}

type JsonLimits = {
  maxValues: number;
  maxDepth: number;
  maxArray: number;
  maxProperties: number;
  maxString: number;
};

function toBoundedJson(
  input: unknown,
  limits: JsonLimits,
  label: string,
): WorkflowJsonValue {
  let values = 0;
  const seen = new WeakSet<object>();
  const visit = (value: unknown, depth: number): WorkflowJsonValue => {
    values += 1;
    if (values > limits.maxValues) {
      throw new WorkflowError(
        "result_budget",
        `${label} exceeds the ${limits.maxValues}-value result budget.`,
      );
    }
    if (depth > limits.maxDepth) {
      throw new WorkflowError(
        "result_budget",
        `${label} exceeds the result depth budget ${limits.maxDepth}.`,
      );
    }
    if (value === null || typeof value === "boolean") return value;
    if (typeof value === "string") {
      if (value.length > limits.maxString) {
        throw new WorkflowError(
          "result_budget",
          `${label} contains a string longer than ${limits.maxString}.`,
        );
      }
      return value;
    }
    if (typeof value === "number") {
      if (!Number.isFinite(value)) {
        throw new WorkflowError(
          "non_json_result",
          `${label} contains a non-finite number.`,
        );
      }
      return value;
    }
    if (typeof value !== "object") {
      throw new WorkflowError(
        "non_json_result",
        `${label} contains ${typeof value}, which is not JSON.`,
      );
    }
    if (seen.has(value)) {
      throw new WorkflowError(
        "non_json_result",
        `${label} must be a JSON tree without cycles or shared references.`,
      );
    }
    seen.add(value);
    if (Array.isArray(value)) {
      if (value.length > limits.maxArray) {
        throw new WorkflowError(
          "result_budget",
          `${label} contains an array longer than ${limits.maxArray}.`,
        );
      }
      return value.map((entry) => visit(entry, depth + 1));
    }
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) {
      throw new WorkflowError(
        "non_json_result",
        `${label} contains a non-plain object.`,
      );
    }
    const entries = Object.entries(value as Record<string, unknown>);
    if (entries.length > limits.maxProperties) {
      throw new WorkflowError(
        "result_budget",
        `${label} contains an object with more than ${limits.maxProperties} properties.`,
      );
    }
    const output = Object.create(null) as Record<string, WorkflowJsonValue>;
    for (const [key, child] of entries) {
      if (child === undefined) {
        throw new WorkflowError(
          "non_json_result",
          `${label}.${key} is undefined rather than JSON.`,
        );
      }
      output[key] = visit(child, depth + 1);
    }
    return output;
  };
  return visit(input, 0);
}

function boundedInteger(
  value: number | undefined,
  fallback: number,
  min: number,
  max: number,
  name: string,
): number {
  const resolved = value ?? fallback;
  if (!Number.isSafeInteger(resolved) || resolved < min || resolved > max) {
    throw new TypeError(
      `${name} must be an integer from ${min} through ${max}.`,
    );
  }
  return resolved;
}

function boundedMessage(value: string): string {
  const normalized = value.trim() || "Workflow operation failed.";
  return normalized.slice(0, 2_048);
}

function safeMessage(value: unknown): string {
  return value instanceof Error && value.message.trim() !== ""
    ? value.message.slice(0, 1_024)
    : "unknown failure";
}

function deepFreeze<T>(value: T): T {
  if (typeof value !== "object" || value === null || Object.isFrozen(value)) {
    return value;
  }
  Object.freeze(value);
  for (const child of Object.values(value as Record<string, unknown>)) {
    deepFreeze(child);
  }
  return value;
}

// Keep this reference visible in declaration output: hosts may tighten any
// canonical Scene preflight limit without changing Scene validity.
export const defaultWorkflowSceneLimits: Readonly<SceneComplexityLimits> =
  defaultSceneComplexityLimits;
