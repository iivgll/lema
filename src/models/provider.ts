import type { ChatMessage } from "./message.js";
import type { ChatOptions, ChatResult, EmbedOptions } from "./chat.js";

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
