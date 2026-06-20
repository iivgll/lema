import type { ChatMessage } from "../provider.js";

export interface ContextBudget {
  /** Model's total token window. */
  contextWindow: number;
  /** Reserved headroom for the next completion. */
  reserveTokens: number;
  /** Most-recent turns kept verbatim, never masked. */
  keepRecentTokens: number;
  /** Tool observations newer than this (tokens from end) stay full. */
  maskWindow: number;
}

export const BUDGET_DEFAULTS: ContextBudget = {
  contextWindow: 8192,
  reserveTokens: 2048,
  keepRecentTokens: 3000,
  maskWindow: 1500,
};

/** Tokens available for the conversation (excludes completion reserve). */
export function usableBudget(b: ContextBudget): number {
  return b.contextWindow - b.reserveTokens;
}

/**
 * Pressure stage based on how full the usable window is.
 * 0 = do nothing, 1 = mask, 2 = summarize, 3 = hard-trim.
 */
export function pressureStage(used: number, b: ContextBudget): 0 | 1 | 2 | 3 {
  const ratio = used / usableBudget(b);
  if (ratio >= 0.95) return 3;
  if (ratio >= 0.85) return 2;
  if (ratio >= 0.70) return 1;
  return 0;
}

/** Rough token estimate for messages not yet sent (chars / 4 heuristic). */
export function estimateTokens(messages: ChatMessage[]): number {
  let chars = 0;
  for (const m of messages) {
    if (m.content) chars += m.content.length;
    if (m.tool_calls) chars += JSON.stringify(m.tool_calls).length;
  }
  return Math.ceil(chars / 4);
}
