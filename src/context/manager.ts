import type { ChatMessage } from "../provider.js";
import {
  type ContextBudget,
  BUDGET_DEFAULTS,
  usableBudget,
  pressureStage,
  estimateTokens,
} from "./budget.js";
import { maskObservations } from "./mask.js";

export interface ContextManagerOptions {
  budget?: Partial<ContextBudget>;
}

/**
 * Owns the live messages[] for a session. Applies the masking-first budget
 * policy transparently so the agent loop never reasons about context pressure.
 */
export class ContextManager {
  private readonly messages: ChatMessage[] = [];
  private readonly budget: ContextBudget;
  /** Last total_tokens reported by the server; 0 until first model call. */
  private lastCtxTokens = 0;
  /** True after the first call to push() — used to skip re-init on subsequent tasks. */
  private _initialized = false;

  constructor(opts: ContextManagerOptions = {}) {
    this.budget = { ...BUDGET_DEFAULTS, ...opts.budget };
  }

  /** Append a message to the live conversation. */
  push(message: ChatMessage): void {
    this.messages.push(message);
    this._initialized = true;
  }

  /**
   * Update the token count from the server's usage report.
   * Called after each model response so pressure stays accurate.
   */
  updateUsage(totalTokens: number): void {
    this.lastCtxTokens = totalTokens;
  }

  /**
   * Returns the messages to send to the model this step,
   * after applying the active pressure stage.
   */
  render(): ChatMessage[] {
    const used = this.lastCtxTokens || estimateTokens(this.messages);
    const stage = pressureStage(used, this.budget);

    if (stage === 0) return [...this.messages];

    // Stage 1+: mask old observations (free + deterministic).
    const masked = maskObservations(this.messages, this.budget.maskWindow);

    // Stage 2 (summarize) and 3 (hard-trim) are C1/C2 — not yet implemented.
    // For now, fall through to masked result even under high pressure.
    return masked;
  }

  /** Fraction of the usable window occupied (0..1+). */
  pressure(): number {
    const used = this.lastCtxTokens || estimateTokens(this.messages);
    return used / usableBudget(this.budget);
  }

  /** True once the first message has been pushed (system prompt already present). */
  isInitialized(): boolean {
    return this._initialized;
  }
}
