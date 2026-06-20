# lema — context management (Vector A: masking-first)

How lema keeps a conversation inside a small local context window without paying for
slow, lossy summaries on every turn. This is the design for **Vector A** from the
research note: a deterministic, masking-first context manager with summarization only
as a last resort.

## Thesis

For local 4–12B models the practical window is 16–32k tokens and every model call is
slow (~10 tok/s) and one-model-at-a-time. Two consequences drive the whole design:

- **Summarization is the expensive, risky path.** It costs an extra LLM call and a small
  model writes bad summaries that drop the detail the agent needs next.
- **Observation masking is free and deterministic.** Dropping old tool outputs (bash
  output, file reads) while keeping the agent's reasoning and actions costs zero model
  calls and never degrades. Research (JetBrains/LangChain) shows masking is ~52% cheaper
  and slightly *more* accurate than summarization.

So lema masks first, and only summarizes when masking alone can't free enough room.

## Where we start

Today there is **no cross-turn memory**: every `runAgent()` rebuilds `messages[]` from
the system prompt + recalled skills + one task ([agent/index.ts](../src/agent/index.ts)).
The TUI transcript is cosmetic. This is greenfield — we add a context layer, we don't
rewrite one.

## Architecture

A new feature folder `src/context/`, owning the live `messages[]` and the budget policy.
The agent loop depends on the abstraction, never on the policy details (DIP).

```
src/context/
  budget.ts      — token accounting + pressure stage (pure functions)
  mask.ts        — observation masking (pure: messages → messages)
  summarize.ts   — last-resort LLM summarization (uses the cheap model)
  archive.ts     — cold store: embed + persist evicted spans, recall by similarity
  manager.ts     — ContextManager: orchestrates the above against a budget
  index.ts       — barrel
```

`ContextManager` is the single owner of the conversation. The agent appends turns to it
and asks it for the messages to send; the manager applies the policy transparently.

```ts
interface ContextManager {
  /** Append a message (assistant/tool/user) to the live conversation. */
  push(message: ChatMessage): void;
  /** The messages to send to the model this step, after applying the budget policy. */
  render(): ChatMessage[];
  /** Tokens currently occupied (from the last usage report). */
  pressure(): number; // 0..1 of the usable window
}
```

`runAgent` stops building `messages[]` by hand and drives a `ContextManager` instead.
`repl.ts` keeps one manager per session so memory survives across turns.

## Budget model

Config-driven (added to `LemaConfig`), because window size differs per model:

| field | meaning | default |
|-------|---------|---------|
| `contextWindow` | model's token window | 8192 (overridable per model) |
| `reserveTokens` | headroom for the next completion | 2048 |
| `keepRecentTokens` | most-recent turns kept verbatim, never touched | 3000 |
| `maskWindow` | tool observations newer than this stay full | 1500 |

Usable budget = `contextWindow − reserveTokens`. We already get live occupancy for free
from `usage.total_tokens` (`AgentStats.ctx`), so the manager needs no tokenizer — it
trusts the server's count and estimates only for not-yet-sent spans (chars/4 heuristic).

## Pressure stages (ACC-lite)

Adapted from OPENDEV's progressive thresholds, collapsed to three stages tuned for a
small window. Each stage runs only if the previous didn't free enough:

1. **< 70% — do nothing.** Send the conversation as-is.
2. **≥ 70% — mask observations** (free, deterministic). Replace tool results older than
   `maskWindow` with a one-line placeholder that preserves identity:
   `[output hidden — read_file src/x.ts, 412 lines]`. Reasoning and tool *calls* stay
   intact, so the agent still knows what it did and can re-read if needed.
3. **≥ 85% — summarize the oldest span** with the cheap model (gemma-4b), cutting at a
   **user-message boundary**. The summary keeps a `readFiles` / `modifiedFiles` list so
   the workspace map survives. The evicted span goes to the cold archive (below).
4. **≥ 95% — emergency hard-trim.** Drop oldest masked turns outright to guarantee the
   request fits. Last resort; should be rare once 2–3 are working.

On an actual context-overflow error from the server, force stage 3 and retry the failed
request **once** (pi's recovery pattern).

## Cold store (hot/cold split)

Hot = whatever `render()` returns. Cold = everything evicted by stages 3–4, embedded with
nomic and written to disk — the same substrate `SkillStore` already uses. `archive.ts`
reuses that machinery (cosine over `provider.embed`) rather than reinventing it.

Recall is a separate, optional layer (Vector C): at the start of a turn, pull top-k
relevant evicted spans back into context, exactly like skill retrieval. We build the
archive *write* path now so nothing is lost; the *read* path lands when we wire long-term
memory.

## Division of labor

Consistent with the roadmap's model split:

- **gemma-12b-coder** — the task itself (unchanged).
- **gemma-4-e4b** — summarization in stage 3 (cheap, tolerant of lower quality here).
- **nomic-embed** — archive embedding + recall.

## Implementation phases

### C0 — accounting + masking (the 80/20)
- `budget.ts`: `usableBudget`, `pressureStage`, char/4 estimator.
- `mask.ts`: pure `maskObservations(messages, maskWindow)`.
- `ContextManager` with stages 1–2 only; `runAgent` drives it.
- Per-session manager in `repl.ts` → conversation now persists across turns.
- Tests: masking is deterministic, preserves calls/reasoning, respects `maskWindow`.

### C1 — summarization fallback
- `summarize.ts`: cut at user boundary, cheap-model summary, `readFiles/modifiedFiles`.
- Stage 3 + one-retry on overflow.
- Tests: cut point lands on a user boundary; summary carries the file map.

### C2 — cold archive (write path)
- `archive.ts`: embed + persist evicted spans (reuse SkillStore cosine substrate).
- Stage 4 emergency trim.

### C3 — long-term recall (read path, = Vector C)
- Top-k recall of evicted spans at turn start, behind a flag.

## Invariants (must hold; cover with tests)

- Masking and the budget math are **pure** and need no model call.
- Masking never removes a tool *call* or assistant reasoning — only observation bodies.
- A summary cut never splits a user turn from its assistant response mid-exchange.
- `render()` output always fits `contextWindow − reserveTokens` (stage 4 guarantees it).
- Zero runtime deps; one source of truth for the budget in `config.ts`.

## Open decisions

- **Window discovery.** Hard to read the real window from an OpenAI-compatible server;
  start config-driven with a sane default, optionally probe `lms` later.
- **Estimator drift.** chars/4 under-counts code/tokens; we correct from `usage` after
  each call, so drift only affects the not-yet-sent tail.
- **Summary placement.** As a `system` note vs. a synthetic `user` turn — pi uses an
  entry type; we'll model it as a tagged `ChatMessage` to keep the array homogeneous.

## References

- JetBrains Research — Efficient Context Management (masking vs summarization, hybrid).
- LangChain — Autonomous context compression.
- pi-agent — Compaction and Context Management (keepRecent, file-tracking, retry).
- OPENDEV — Adaptive Context Compaction (progressive pressure stages).
- Google ADK — Context compression (sliding-window summarization).
