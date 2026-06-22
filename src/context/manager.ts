import type { ChatMessage } from "../provider.js";
import {
  type ContextBudget,
  BUDGET_DEFAULTS,
  usableBudget,
  pressureStage,
  estimateTokens,
} from "./budget.js";
import { maskObservations } from "./mask.js";
import type { Summarizer } from "./summarize.js";

/** Per-message cap when rendering the middle for summarization. */
const TRANSCRIPT_MSG_CAP = 400;

/** Render messages as a compact plain-text transcript for the summarizer. */
function transcriptText(msgs: ChatMessage[]): string {
  const clip = (s: string) => (s.length > TRANSCRIPT_MSG_CAP ? s.slice(0, TRANSCRIPT_MSG_CAP) + "…" : s);
  return msgs
    .map((m) => {
      if (m.role === "tool") return `tool result: ${clip((m.content ?? "").trim())}`;
      const calls = m.tool_calls?.map((c) => `${c.function.name}(${c.function.arguments})`).join(", ");
      const parts: string[] = [];
      if (m.content) parts.push(clip(m.content.trim()));
      if (calls) parts.push(`→ ${clip(calls)}`);
      return `${m.role}: ${parts.join(" ")}`;
    })
    .join("\n");
}

/** Project-rules anchors injected at render time (never stored, never masked). */
export interface ContextRules {
  /** Full rules, injected right after the system prompt (start anchor). */
  full: string;
  /** Short reminder appended near the end when context grows (end anchor). */
  condensed: string;
  /** Whether to append the end-anchor reminder at all. */
  reinject: boolean;
  /** Re-inject the reminder every N renders (and whenever pressure is high). */
  reinjectEvery: number;
}

export interface ContextManagerOptions {
  budget?: Partial<ContextBudget>;
  rules?: ContextRules;
}

/**
 * Owns the live messages[] for a session. Applies the masking-first budget
 * policy transparently so the agent loop never reasons about context pressure.
 */
export class ContextManager {
  private readonly messages: ChatMessage[] = [];
  private readonly budget: ContextBudget;
  private readonly rules?: ContextRules;
  /** Last total_tokens reported by the server; 0 until first model call. */
  private lastCtxTokens = 0;
  /** True after the first call to push() — used to skip re-init on subsequent tasks. */
  private _initialized = false;
  /** Counts render() calls, to drive turn-based rule re-injection. */
  private renderCount = 0;

  constructor(opts: ContextManagerOptions = {}) {
    this.budget = { ...BUDGET_DEFAULTS, ...opts.budget };
    this.rules = opts.rules;
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
    this.renderCount++;
    const used = this.lastCtxTokens || estimateTokens(this.messages);
    const stage = pressureStage(used, this.budget);

    // Stage 1+: mask old observations (free + deterministic). Stage 2/3 (C1/C2)
    // not yet implemented — fall through to masked even under high pressure.
    const base = stage === 0 ? [...this.messages] : maskObservations(this.messages, this.budget.maskWindow);

    return this.rules ? this.withRules(base) : base;
  }

  /**
   * Inject the project rules: full text right after the system prompt (start
   * anchor), and a condensed reminder at the end when the conversation has grown
   * (end anchor). Injected at render time — never stored, so never masked/evicted.
   */
  private withRules(base: ChatMessage[]): ChatMessage[] {
    const rules = this.rules!;
    const anchor: ChatMessage = { role: "system", content: rules.full };
    const out =
      base[0]?.role === "system" ? [base[0], anchor, ...base.slice(1)] : [anchor, ...base];

    if (rules.reinject && this.shouldReinject(rules.reinjectEvery)) {
      out.push({ role: "system", content: `Reminder of the project rules:\n${rules.condensed}` });
    }
    return out;
  }

  /** End-anchor cadence: every N renders, or whenever the window is half full. */
  private shouldReinject(every: number): boolean {
    return this.pressure() >= 0.5 || (every > 0 && this.renderCount % every === 0);
  }

  /** Fraction of the usable window occupied (0..1+). */
  pressure(): number {
    return this.tokens() / usableBudget(this.budget);
  }

  /** Best estimate of tokens currently held (server count, else heuristic). */
  tokens(): number {
    return this.lastCtxTokens || estimateTokens(this.messages);
  }

  /**
   * Compact the conversation: summarize older turns into a single system message,
   * keeping the leading system prompt and the most recent turns verbatim. This is
   * the stage-2 response to context pressure (ReSum-style) and also backs /compact.
   * Returns true if anything was compacted. The summarizer is injected so the
   * manager never depends on a provider directly.
   */
  async compact(summarize: Summarizer, instruction?: string): Promise<boolean> {
    const split = this.compactionSplit(this.budget.keepRecentTokens);
    if (!split) return false;
    const summary = (await summarize(transcriptText(split.middle), instruction)).trim();
    if (!summary) return false;
    const msg: ChatMessage = {
      role: "system",
      content: `Summary of earlier conversation (compacted to save context):\n${summary}`,
    };
    this.messages.length = 0;
    this.messages.push(...split.head, msg, ...split.tail);
    this.lastCtxTokens = 0; // re-measured on the next usage report
    return true;
  }

  /**
   * Split messages into [head, middle, tail] for compaction: head is the leading
   * system prompt, tail is the most recent ~keepRecent tokens snapped to a clean
   * user-turn boundary (so no tool result is orphaned), middle is everything
   * between. Returns null when there's nothing worthwhile to summarize.
   */
  private compactionSplit(
    keepRecentTokens: number,
  ): { head: ChatMessage[]; middle: ChatMessage[]; tail: ChatMessage[] } | null {
    const msgs = this.messages;
    const headLen = msgs.length && msgs[0].role === "system" ? 1 : 0;

    let acc = 0;
    let cut = msgs.length;
    for (let i = msgs.length - 1; i >= headLen; i--) {
      acc += estimateTokens([msgs[i]]);
      if (acc >= keepRecentTokens) { cut = i; break; }
    }
    // Snap forward to the next user message so the tail starts on a turn boundary
    // and never begins with an orphan tool result or dangling assistant call.
    while (cut < msgs.length && msgs[cut].role !== "user") cut++;
    if (cut <= headLen || cut >= msgs.length) return null;

    return { head: msgs.slice(0, headLen), middle: msgs.slice(headLen, cut), tail: msgs.slice(cut) };
  }

  /** True once the first message has been pushed (system prompt already present). */
  isInitialized(): boolean {
    return this._initialized;
  }
}
