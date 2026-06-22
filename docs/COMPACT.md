# Context compaction & auto-continue

Small local models have small windows (lema's default usable budget is ~6K of an
8K window). Long tasks overflow it, and a run that hits the step budget used to
stop mid-task — the user had to type "продолжи". This adds three things, all
sharing one mechanism: **summarize older turns so the run can keep going.**

## Research basis

- **ReSum** ([arXiv 2509.13313](https://arxiv.org/pdf/2509.13313)) — a summarization
  step compresses history near the length limit, then the agent continues. This is
  the model we follow: cheap, drop-in, no agent changes.
- **Context-Folding** ([arXiv 2510.11967](https://arxiv.org/abs/2510.11967)) — branch
  into a subtask and "fold" it into a short summary; 10× smaller active context.
  Stronger but more invasive — a possible later step.
- **Claude Code** `/compact` + auto-compact ([docs](https://platform.claude.com/docs/en/build-with-claude/compaction)):
  manual compaction lets the user say what to keep; auto-compact fires near the
  window limit. A "context left" gauge is standard UX.
- Empirically, keep the most recent ~10 turns verbatim and summarize the rest.

Note: compaction is about the **current conversation**. It is separate from the
memory store (long-term facts across sessions) — they don't share state.

## What lema does

**Stage-2 compaction** (`ContextManager.compact`). The budget already graded
pressure (0 none → 1 mask → 2 summarize → 3 trim); stage 2 was a no-op. Now it
splits messages into `[head, middle, tail]`:
- `head` — the leading system prompt, kept.
- `tail` — the most recent `keepRecentTokens`, snapped forward to a **user-turn
  boundary** so a tool result is never orphaned from its call.
- `middle` — everything between, rendered to a compact transcript and replaced by
  one `system` summary message.

The summarizer is injected (`Summarizer = (transcript, instruction?) => Promise<string>`)
so the manager never depends on a provider — `makeSummarizer(provider, model)`
builds one for both callers below.

**Auto-compaction + auto-continue** (agent loop). Before each model call, if
`pressure() ≥ 0.85` the loop compacts (with a 3-step cooldown so it doesn't retry
every step). The soft `maxSteps` becomes a target, not a wall: the loop runs to a
hard cap of `maxSteps × 2`, finishing early when the model stops calling tools and
ending with the usual `forceFinish` only at the cap. Runaway loops are still cut
earlier by `REPEAT_BUDGET`.

**`/compact [what to keep]`** — manual trigger of the same compaction; the optional
argument is passed to the summarizer as "keep especially: …".

**Context gauge** — `AgentStats.ctxPct` (= `pressure()`) is emitted every step via a
`stats` event and shown in the footer as `ctx 73%`. Auto-compaction fires at 85%.

## Tuning

- `COMPACT_AT = 0.85`, `COMPACT_COOLDOWN = 3`, hard cap `maxSteps × 2` (agent).
- `keepRecentTokens` (context budget) controls how much tail stays verbatim.
