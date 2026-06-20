export interface ChatMessage {
  role: "system" | "user" | "assistant" | "tool";
  content: string | null;
  tool_calls?: ToolCall[];
  tool_call_id?: string;
  name?: string;
}

export interface ToolCall {
  id: string;
  type: "function";
  function: { name: string; arguments: string };
}

export interface ToolSchema {
  type: "function";
  function: {
    name: string;
    description: string;
    parameters: Record<string, unknown>;
  };
}

export interface ChatOptions {
  model?: string;
  tools?: ToolSchema[];
  temperature?: number;
  maxTokens?: number;
}

export interface Usage {
  prompt_tokens: number;
  completion_tokens: number;
  total_tokens: number;
}

export interface ChatResult {
  message: ChatMessage;
  usage?: Usage;
}

export interface EmbedOptions {
  model?: string;
  input?: string[];
}

export interface EmbedResult {
  embedding: number[];
}

export interface Model {
  id: string;
  name: string;
  type: "chat" | "embedding" | "both";
}

export interface ModelProvider {
  listModels(): Promise<string[]>;
  resolveModel(): Promise<string>;
  chat(messages: ChatMessage[], opts?: ChatOptions): Promise<ChatResult>;
  embed(texts: string[], opts?: EmbedOptions): Promise<number[][]>;
}
