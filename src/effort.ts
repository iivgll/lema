/**
 * Effort: a session-level reasoning dial for small local models.
 *
 * It is a deterministic preset over concrete knobs (step budget, token budget,
 * a short behavioural hint), not a "think more" switch. For SLMs the dominant
 * failure is overthinking, so `low` is a first-class setting and `medium` (the
 * default) reproduces the configured budgets exactly.
 */
export type Effort = "low" | "medium" | "high";

export const EFFORTS: readonly Effort[] = ["low", "medium", "high"];

export interface EffortBase {
  maxSteps: number;
  maxTokens: number;
}

export interface EffortProfile {
  maxSteps: number;
  maxTokens: number;
  /** Appended to the system prompt to steer thoroughness. Empty for medium. */
  hint: string;
}

const MIN_STEPS = 4;
const MIN_TOKENS = 512;

/** Resolve an effort level into concrete budgets + a prompt hint. Pure. */
export function effortProfile(effort: Effort, base: EffortBase): EffortProfile {
  switch (effort) {
    case "low":
      return {
        maxSteps: Math.max(MIN_STEPS, Math.ceil(base.maxSteps / 2)),
        maxTokens: Math.max(MIN_TOKENS, Math.floor(base.maxTokens / 2)),
        hint: "Answer concisely. Take the most direct path and avoid unnecessary reasoning or extra tool calls.",
      };
    case "high":
      return {
        maxSteps: base.maxSteps * 2,
        maxTokens: base.maxTokens * 2,
        hint: "Work carefully: plan the steps, use tools to verify, and double-check before finishing.",
      };
    default: // medium and any unknown value
      return { maxSteps: base.maxSteps, maxTokens: base.maxTokens, hint: "" };
  }
}
