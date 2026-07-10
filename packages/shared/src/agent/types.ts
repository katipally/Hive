import type { Message, StreamFn, ThinkingLevel, ToolSpec, Usage } from "../llm/types.js";

export interface AgentTool {
  spec: ToolSpec;
  run(args: Record<string, unknown>): Promise<string>;
}

export type AgentEvent =
  | { type: "turn_start" }
  | { type: "text_delta"; text: string }
  | { type: "thinking_delta"; text: string }
  | { type: "tool_start"; name: string; args: Record<string, unknown> }
  | { type: "tool_end"; name: string; result: string }
  | { type: "turn_end"; text: string; usage?: Usage };

export interface LoopConfig {
  streamFn: StreamFn;
  model: string;
  baseUrl: string;
  apiKey?: string;
  system?: string;
  thinkingLevel?: ThinkingLevel;
  tools?: AgentTool[];
  maxTurns?: number;
  // hook to inject retrieved context, edit history, etc. before each LLM call
  transformContext?: (messages: Message[]) => Message[];
  signal?: AbortSignal;
}
