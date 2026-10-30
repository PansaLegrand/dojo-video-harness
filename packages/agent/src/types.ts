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
};
export type ModelReply = { text: string; calls: ToolCall[] };
export interface LanguageModel {
  complete(
    messages: ChatMessage[],
    tools: ToolSpec[],
    signal: AbortSignal,
  ): Promise<ModelReply>;
}
export type AgentEvent = {
  sequence: number;
  type:
    | "model.started"
    | "tool.started"
    | "tool.completed"
    | "proposal.ready"
    | "question.asked"
    | "answer.ready";
  name?: string;
  summary?: string;
};
