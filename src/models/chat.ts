import type { ChatMessage, ToolSchema, Usage } from "./message.js";

export interface ChatOptions {
  model?: string;
  tools?: ToolSchema[];
  temperature?: number;
  maxTokens?: number;
  signal?: AbortSignal;
}

export interface ChatResult {
  message: ChatMessage;
  usage?: Usage;
}

export interface EmbedOptions {
  model?: string;
  input?: string[];
}
