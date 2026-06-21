import type { ChatMessage, ToolSchema, Usage } from "./message.js";

export interface ChatOptions {
  model?: string;
  tools?: ToolSchema[];
  temperature?: number;
  maxTokens?: number;
  /** Native reasoning hint (OpenAI `reasoning_effort`). Ignored by servers that don't support it. */
  reasoningEffort?: "low" | "medium" | "high";
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
