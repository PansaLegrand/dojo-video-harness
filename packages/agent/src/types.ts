export type {
  ToolSpec,
  ToolCall,
  ChatMessage,
  ModelReply,
  LanguageModel,
} from "../../agent-loop/src/index";
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
  callId?: string;
  replay?: boolean;
};
