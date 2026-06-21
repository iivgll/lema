/**
 * Effort: a session-level reasoning dial for small local models.
 *
 * It is a deterministic preset over concrete knobs (step budget, token budget,
 * a short behavioural hint), not a "think more" switch. For SLMs the dominant
 * failure is overthinking, so `low` is a first-class setting and `medium` (the
 * default) reproduces the configured budgets exactly.
 */
/** Concrete reasoning levels. `auto` (below) resolves to one of these per task. */
export type Effort = "low" | "medium" | "high" | "ultra";

/** Settable values, including `auto` which picks a level from the task. */
export type EffortSetting = Effort | "auto";

export const EFFORTS: readonly Effort[] = ["low", "medium", "high", "ultra"];
export const EFFORT_SETTINGS: readonly EffortSetting[] = ["auto", "low", "medium", "high", "ultra"];

/**
 * Pick an effort level from the task text — cheap, no model call (E2). Heavy
 * build/fix work or long asks get `high`; short factual questions get `low`;
 * everything else `medium`. Never auto-selects `ultra` — that stays opt-in
 * because its verify gate is expensive.
 */
export function estimateEffort(task: string): Effort {
  const t = task.toLowerCase().trim();
  const words = t.split(/\s+/).filter(Boolean).length;
  const heavy = /\b(implement|refactor|build|create|add|fix|debug|migrat|optimi[sz]e|rewrite|design|test|deploy|integrat|generate)\b/.test(t);
  const trivial = words <= 8 && /\b(what|which|who|where|when|show|list|explain|describe|print|tell)\b/.test(t);
  if (heavy || words > 40) return "high";
  if (trivial) return "low";
  return "medium";
}

export interface EffortBase {
  maxSteps: number;
  maxTokens: number;
}

export interface EffortProfile {
  maxSteps: number;
  maxTokens: number;
  /** Appended to the system prompt to steer thoroughness. Empty for medium. */
  hint: string;
  /**
   * Require a tool-grounded verification pass before accepting a final answer
   * (ultra only). Research shows small models self-verify poorly but verify well
   * with tools, and one sequential refine round beats wide parallel sampling.
   */
  verify: boolean;
  /** Native reasoning hint to pass through when the server supports it (E1). */
  reasoning?: "low" | "medium" | "high";
}

const MIN_STEPS = 4;
const MIN_TOKENS = 512;

const VERIFY_HINT =
  "This is a high-stakes task. Before your FINAL answer you MUST verify with tools: " +
  "run the tests or build, re-read any file you changed, and confirm with grep. " +
  "If verification reveals a problem, fix it and verify again. Never claim success unverified.";

/** Resolve an effort level into concrete budgets + a prompt hint. Pure. */
export function effortProfile(effort: Effort, base: EffortBase): EffortProfile {
  switch (effort) {
    case "low":
      return {
        maxSteps: Math.max(MIN_STEPS, Math.ceil(base.maxSteps / 2)),
        maxTokens: Math.max(MIN_TOKENS, Math.floor(base.maxTokens / 2)),
        hint: "Answer concisely. Take the most direct path and avoid unnecessary reasoning or extra tool calls.",
        verify: false,
      };
    case "high":
      return {
        maxSteps: base.maxSteps * 2,
        maxTokens: base.maxTokens * 2,
        hint: "Work carefully: plan the steps, use tools to verify, and double-check before finishing.",
        verify: false,
        reasoning: "high",
      };
    case "ultra":
      // Scale STEPS (room for a verify-and-fix round), not the monologue — for a
      // small model more tool actions help, more thinking tokens invite overthinking.
      return {
        maxSteps: base.maxSteps * 3,
        maxTokens: base.maxTokens * 2,
        hint: VERIFY_HINT,
        verify: true,
        reasoning: "high",
      };
    default: // medium and any unknown value
      return { maxSteps: base.maxSteps, maxTokens: base.maxTokens, hint: "", verify: false };
  }
}
