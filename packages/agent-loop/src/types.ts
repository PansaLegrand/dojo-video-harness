export type ToolSpec = {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
};
export type ToolCall = { id: string; name: string; arguments: string };
export type ChatMessage = {
  role: "system" | "user" | "assistant" | "tool";
  content: string | Array<unknown> | null;
  tool_call_id?: string;
  tool_calls?: Array<{
    id: string;
    type: "function";
    function: { name: string; arguments: string };
  }>;
  providerOutput?: Array<Record<string, unknown>>;
};
export type ModelReply = {
  text: string;
  calls: ToolCall[];
  providerOutput?: Array<Record<string, unknown>>;
  usage?: { inputTokens: number; outputTokens: number };
  /** Exact maximum sent by the adapter; present only for preserve-overrun-v1. */
  outputTokenLimit?: number;
};
export interface LanguageModel {
  /** Stable, non-secret provider endpoint/model identity for durable bindings. */
  readonly identity?: string;
  complete(
    messages: ChatMessage[],
    tools: ToolSpec[],
    signal: AbortSignal,
    limits?: {
      maxOutputTokens: number;
      maxReplyBytes?: number;
      outputBudgetPolicy?: "preserve-overrun-v1";
    },
  ): Promise<ModelReply>;
}
export type LoopEvent = {
  sequence: number;
  type: "model.started" | "tool.started" | "tool.completed";
  name?: string;
  summary?: string;
  callId?: string;
  replay?: boolean;
};
export type ToolExecutionContext = {
  callId: string;
  runId?: string;
  replay: boolean;
};
export type LoopTool<T> = ToolSpec & {
  /** Explicit host assertion that repeating an uncertain execution is safe. */
  replaySafe?: boolean;
  /** Explicit host assertion that old observations contain no required evidence. */
  compactionSafe?: boolean;
  execute(
    args: unknown,
    signal: AbortSignal,
    context?: ToolExecutionContext,
  ): Promise<
    | { kind: "observation"; value: unknown; pinned?: boolean }
    | { kind: "terminal"; result: T }
  >;
};
export type LoopCompactionOptions = {
  maxCharacters: number;
  keepRecentGroups?: number;
  protectedToolCallIds?: string[];
};
export type LoopBudgets = {
  maxSteps: number;
  maxToolCalls: number;
  maxOutputTokens: number;
  requireUsage: boolean;
};
/** Byte budgets cover serialized UTF-8 JSON, including opaque provider output. */
export type LoopCheckpointCapacity = {
  maxBytes: number;
  maxReplyBytes: number;
  reserveBytes: number;
};
export type LoopSnapshot = {
  runId: string;
  snapshotHash: string;
  modelIdentity?: string;
  messages: ChatMessage[];
  tools: Array<ToolSpec & { replaySafe: boolean; compactionSafe: boolean }>;
  budgets: LoopBudgets;
  answerReplaySafe: boolean;
  durablePlanRefs: string[];
  compaction?: LoopCompactionOptions;
  checkpointEncoding?: "compact-v2";
  checkpointCapacity?: LoopCheckpointCapacity;
  outputBudgetPolicy?: "preserve-overrun-v1";
};
export type LoopOutputBudgetOverrun = {
  kind: "provider-output-budget";
  modelCall: number;
  priorOutputTokens: number;
  requestedMaxOutputTokens: number;
  returnedOutputTokens: number;
};
export type LoopCheckpointPhase =
  | "ready-for-model"
  | "model-pending"
  | "model-returned"
  | "tool-pending"
  | "tool-observations"
  | "answer-pending"
  | "completed";
export type LoopCheckpoint = {
  version: 1;
  revision: number;
  bindingHash: string;
  snapshot: LoopSnapshot;
  phase: LoopCheckpointPhase;
  messages: ChatMessage[];
  usage: { inputTokens: number; outputTokens: number };
  usageKnown: boolean;
  modelCalls: number;
  toolCalls: number;
  observationCharacters: number;
  sequence: number;
  usedToolCallIds: string[];
  pinnedToolCallIds: string[];
  pendingTurn?: { reply: ModelReply; nextToolIndex: number };
  outputBudgetOverrun?: LoopOutputBudgetOverrun;
  result?: unknown;
};
export type LoopCheckpointPort = {
  runId: string;
  snapshotHash: string;
  /** New-snapshot defaults; existing snapshots retain their original profile. */
  encoding?: "compact-v2";
  capacity?: LoopCheckpointCapacity;
  load(): Promise<unknown | null>;
  /** Atomic CAS. With compact-v2, persist encodeLoopCheckpoint(next), not expanded JSON. */
  save(next: LoopCheckpoint, expectedRevision: number | null): Promise<void>;
};
/** Storage-only v2 representation; parseLoopCheckpoint restores the logical v1 shape. */
export type CompactLoopCheckpoint = Omit<
  LoopCheckpoint,
  "version" | "messages"
> & {
  version: 2;
  messageTail: ChatMessage[];
};
export type LoopResult<T> = {
  result: T;
  usage: { inputTokens: number; outputTokens: number };
  modelCalls: number;
  /** Present for durable runs, including completed checkpoint replay. */
  usageKnown?: boolean;
};
export type ToolLoopInput<T> = {
  model: LanguageModel;
  messages: ChatMessage[];
  tools: LoopTool<T>[];
  signal: AbortSignal;
  answer(text: string): Promise<T>;
  answerReplaySafe?: boolean;
  onEvent?: (event: LoopEvent) => void | Promise<void>;
  maxSteps?: number;
  maxToolCalls?: number;
  maxOutputTokens?: number;
  checkpoint?: LoopCheckpointPort;
  compaction?: LoopCompactionOptions;
  durablePlanRefs?: string[];
};
