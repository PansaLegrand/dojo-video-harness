import {
  VIDEO_PROJECT_EDITABLE_FIELDS,
  type VideoProjectTarget,
} from "./commands";
import { supportedStyleKeys } from "@motionforge/schema";
import {
  NATIVE_AGENT_HOST_ONLY_OPERATIONS,
  nativeAgentPropertyUnit,
} from "./agent-schema";

type Issue = {
  code: string;
  path: Array<string | number>;
  message: string;
  expected?: string;
  allowed?: string[];
};
export type NativeAgentDiagnostic = {
  version: 1;
  code:
    | "INVALID_MODEL_JSON"
    | "INVALID_MODEL_OPERATION"
    | "INVALID_PROPERTY"
    | "HOST_ONLY_OPERATION"
    | "OPERATION_REJECTED";
  commandIndex?: number;
  operation?: string;
  target?: Record<string, unknown>;
  targetPath?: string[];
  unit?: string;
  allowed?: string[];
  issues: Issue[];
  hint: string;
};

type Context = {
  commandIndex?: number;
  command?: unknown;
  modelOutput?: unknown;
  json?: boolean;
};
const record = (value: unknown): Record<string, unknown> | null =>
  value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;

function modelCommand(
  context: Context,
  index?: number,
): Record<string, unknown> | null {
  if (context.command) return record(context.command);
  const commands = record(context.modelOutput)?.commands;
  return Array.isArray(commands) && index !== undefined
    ? record(commands[index])
    : null;
}

function flattenIssues(value: unknown, context: Context): Issue[] {
  const source = record(value);
  if (!Array.isArray(source?.issues)) return [];
  return source.issues
    .flatMap((raw: unknown): Issue[] => {
      const issue = record(raw);
      if (!issue) return [];
      const path = Array.isArray(issue.path)
        ? (issue.path
            .filter(
              (part) => typeof part === "string" || typeof part === "number",
            )
            .slice(0, 16)
            .map((part) =>
              typeof part === "string" ? part.slice(0, 100) : part,
            ) as Array<string | number>)
        : [];
      if (issue.code === "invalid_union" && Array.isArray(issue.unionErrors)) {
        const index =
          path[0] === "commands" && typeof path[1] === "number"
            ? path[1]
            : context.commandIndex;
        const type = modelCommand(context, index)?.type;
        const branches = issue.unionErrors.map((error) =>
          flattenIssues(error, context),
        );
        const score = (branch: Issue[]) =>
          branch.reduce(
            (sum, entry) =>
              sum +
              (entry.path.at(-1) === "type" &&
              entry.expected &&
              entry.expected !== type
                ? 100
                : 1),
            0,
          );
        return branches.sort((a, b) => score(a) - score(b))[0] ?? [];
      }
      if (issue.code === "unrecognized_keys" && Array.isArray(issue.keys))
        return issue.keys
          .slice(0, 4)
          .map((key) => ({
            code: "unrecognized_key",
            path: [...path, String(key).slice(0, 100)],
            message: "Remove this unrecognized field.",
          }));
      if (
        (issue.code === "invalid_enum_value" ||
          issue.code === "invalid_union_discriminator") &&
        Array.isArray(issue.options)
      )
        return [
          {
            code: String(issue.code),
            path,
            message: "Choose one of the supported values.",
            allowed: issue.options
              .slice(0, 24)
              .map((value) => String(value).slice(0, 100)),
          },
        ];
      return [
        {
          code: String(issue.code ?? "invalid_value").slice(0, 80),
          path,
          message: String(issue.message ?? "Invalid native value.").slice(
            0,
            350,
          ),
          ...(typeof issue.expected === "string"
            ? { expected: issue.expected.slice(0, 100) }
            : {}),
        },
      ];
    })
    .slice(0, 6);
}

export class NativeAgentDiagnosticError extends Error {
  readonly code = "NATIVE_AGENT_CANDIDATE_INVALID";
  constructor(readonly diagnostic: NativeAgentDiagnostic) {
    super(
      `${diagnostic.commandIndex === undefined ? "" : `Command ${diagnostic.commandIndex + 1}${diagnostic.operation ? ` (${diagnostic.operation})` : ""}: `}${diagnostic.issues[0]?.message ?? "Invalid native command proposal."}`,
    );
    this.name = "NativeAgentDiagnosticError";
  }
}

export function nativeAgentDiagnosticError(
  cause: unknown,
  context: Context = {},
): NativeAgentDiagnosticError {
  if (cause instanceof NativeAgentDiagnosticError) return cause;
  const issues = flattenIssues(cause, context);
  const issueIndex = issues.find(
    (issue) =>
      issue.path[0] === "commands" && typeof issue.path[1] === "number",
  )?.path[1];
  const commandIndex =
    context.commandIndex ??
    (typeof issueIndex === "number" ? issueIndex : undefined);
  const command = modelCommand(context, commandIndex);
  const rawTarget = record(command?.target);
  const target = rawTarget
    ? Object.fromEntries(
        ["kind", "itemId", "nodeId", "cueId", "trackId"].flatMap((key) =>
          typeof rawTarget[key] === "string"
            ? [[key, rawTarget[key].slice(0, 191)]]
            : [],
        ),
      )
    : null;
  const targetPath = Array.isArray(command?.path)
    ? command.path
        .filter((part): part is string => typeof part === "string")
        .slice(0, 8)
        .map((part) => part.slice(0, 100))
    : undefined;
  const message =
    cause instanceof Error ? cause.message : "Invalid native command proposal.";
  const operation =
    typeof command?.type === "string" ? command.type : undefined;
  const forbidden =
    operation !== undefined &&
    (NATIVE_AGENT_HOST_ONLY_OPERATIONS as readonly string[]).includes(
      operation,
    );
  const property =
    message.includes("is not editable by a property command") ||
    Boolean(context.command && targetPath && issues.length);
  const kind =
    typeof target?.kind === "string" &&
    Object.hasOwn(VIDEO_PROJECT_EDITABLE_FIELDS, target.kind)
      ? (target.kind as VideoProjectTarget["kind"])
      : undefined;
  const allowed =
    property && kind
      ? kind === "node" && targetPath?.[0] === "style"
        ? [...supportedStyleKeys]
        : [...VIDEO_PROJECT_EDITABLE_FIELDS[kind]]
      : undefined;
  const diagnostic: NativeAgentDiagnostic = {
    version: 1,
    code: context.json
      ? "INVALID_MODEL_JSON"
      : forbidden
        ? "HOST_ONLY_OPERATION"
        : property
          ? "INVALID_PROPERTY"
          : issues.length
            ? "INVALID_MODEL_OPERATION"
            : "OPERATION_REJECTED",
    ...(commandIndex !== undefined ? { commandIndex } : {}),
    ...(operation ? { operation: operation.slice(0, 100) } : {}),
    ...(target ? { target } : {}),
    ...(targetPath ? { targetPath } : {}),
    ...(kind && targetPath
      ? { unit: nativeAgentPropertyUnit(kind, targetPath) }
      : {}),
    ...(allowed ? { allowed } : {}),
    issues: issues.length
      ? issues
      : [
          {
            code: "rejected",
            path: commandIndex === undefined ? [] : ["commands", commandIndex],
            message: message.slice(0, 700),
          },
        ],
    hint: forbidden
      ? "Evidence and source bindings must come from host-resolved sources and words. Use captionSource, cutSpeech, or anchorSpeech with existing evidence."
      : context.json
        ? "Return one JSON object with summary, outcome, and commands; no surrounding prose."
        : "Correct this operation against the supplied native schema and unchanged snapshot. Use needs_input with commands:[] if required facts are unavailable.",
  };
  // Bound repair/log payloads without reflecting model-authored values or document content.
  while (
    JSON.stringify(diagnostic).length > 3800 &&
    diagnostic.issues.length > 1
  )
    diagnostic.issues.pop();
  if (JSON.stringify(diagnostic).length > 3800) delete diagnostic.allowed;
  if (JSON.stringify(diagnostic).length > 3800) delete diagnostic.target;
  if (JSON.stringify(diagnostic).length > 3800) {
    diagnostic.targetPath = diagnostic.targetPath?.slice(0, 4);
    diagnostic.issues = diagnostic.issues
      .slice(0, 1)
      .map((issue) => ({
        ...issue,
        path: issue.path.slice(-4),
        message: issue.message.slice(0, 200),
        allowed: issue.allowed?.slice(0, 6),
      }));
  }
  if (JSON.stringify(diagnostic).length > 3800) {
    delete diagnostic.targetPath;
    diagnostic.issues = [
      {
        code: "rejected",
        path: [],
        message:
          "Native validation rejected this operation; review the supplied schema.",
      },
    ];
  }
  return new NativeAgentDiagnosticError(diagnostic);
}
