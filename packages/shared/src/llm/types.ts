// LLM abstraction. Two api families collapse the 4 providers:
//   anthropic-messages -> Anthropic, MiniMax
//   openai-compat      -> OpenAI, Ollama
export type ApiFamily = "anthropic-messages" | "openai-compat";

export type ProviderId = "anthropic" | "minimax" | "openai" | "ollama";

export type ThinkingLevel = "off" | "low" | "medium" | "high";

export interface ProviderSpec {
  id: ProviderId;
  label: string;
  api: ApiFamily;
  defaultBaseUrl: string;
  // how the models list is fetched
  listPath: string; // relative to base or absolute
  needsKey: boolean;
  supportsEmbeddings: boolean;
}

export interface ModelInfo {
  id: string;
  provider: ProviderId;
  label?: string;
  contextLength?: number;
  supportsReasoning?: boolean;
  supportsTools?: boolean;
}

export type Role = "system" | "user" | "assistant" | "toolResult";

export interface ToolCall {
  id: string;
  name: string;
  args: Record<string, unknown>;
}

export interface Message {
  role: Role;
  content: string;
  // assistant-only: tool calls the model wants to make
  toolCalls?: ToolCall[];
  // toolResult-only: which call this answers
  toolCallId?: string;
}

export interface ToolSpec {
  name: string;
  description: string;
  parameters: Record<string, unknown>; // JSON schema
}

export interface Usage {
  inputTokens: number;
  outputTokens: number;
}

// Streaming events emitted by an adapter.
export type StreamEvent =
  | { type: "text_delta"; text: string }
  | { type: "thinking_delta"; text: string }
  | { type: "tool_call"; call: ToolCall }
  | { type: "done"; usage?: Usage };

export interface ChatRequest {
  baseUrl: string;
  apiKey?: string;
  model: string;
  system?: string;
  messages: Message[];
  tools?: ToolSpec[];
  thinkingLevel?: ThinkingLevel;
  temperature?: number;
  maxTokens?: number;
  signal?: AbortSignal;
}

export type StreamFn = (req: ChatRequest) => AsyncGenerator<StreamEvent>;

export interface EmbedRequest {
  baseUrl: string;
  apiKey?: string;
  model: string;
  input: string[];
}
