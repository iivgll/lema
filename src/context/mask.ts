import type { ChatMessage } from "../provider.js";
import { estimateTokens } from "./budget.js";

/**
 * Replace tool-result bodies that fall outside the recent `maskWindowTokens`
 * with a one-line placeholder. Tool *calls* and assistant reasoning are never touched.
 * Pure: returns a new array, does not mutate input.
 */
export function maskObservations(
  messages: ChatMessage[],
  maskWindowTokens: number,
): ChatMessage[] {
  // Walk backwards, counting tokens. Once we've accumulated maskWindowTokens,
  // everything older gets its tool-result body replaced.
  let tokensFromEnd = 0;
  const result: ChatMessage[] = new Array(messages.length);

  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i];
    tokensFromEnd += estimateTokens([m]);

    if (tokensFromEnd > maskWindowTokens && m.role === "tool") {
      result[i] = { ...m, content: `[output hidden — ${toolSummary(m)}]` };
    } else {
      result[i] = m;
    }
  }
  return result;
}

/** One-line description of a tool result for the placeholder. */
function toolSummary(m: ChatMessage): string {
  const content = m.content ?? "";
  // Try to extract a meaningful label from common patterns.
  const firstLine = content.split("\n")[0].slice(0, 80).trim();
  return firstLine || `tool_call_id:${m.tool_call_id ?? "?"}`;
}
