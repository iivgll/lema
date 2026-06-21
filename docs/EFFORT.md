# lema — effort (a reasoning dial for small models)

A session-level `effort` knob (low / medium / high), like Claude's, but shaped for local
small models. It is **not** a "think more" cult — for SLMs the dominant failure is
*overthinking*, so effort is mainly a lever to keep a weak model from spiralling, and only
secondarily to add depth on genuinely hard tasks.

## Thesis

- **Effort is a preset of concrete knobs, not magic.** It maps to things lema already has —
  the step budget, the token budget, and a short behavioural hint — plus native reasoning
  when the model supports it. Deterministic and model-agnostic.
- **Overthinking is the real SLM risk.** Research (2026) shows extended reasoning makes
  models abandon correct answers, ramble on easy queries, and sometimes *lose* accuracy as
  compute grows (inverse scaling). So the **default is conservative** (medium) and `low`
  is a first-class, useful setting — not a downgrade.
- **Stay model-agnostic.** The local model zoo is inconsistent about native reasoning
  params. Budgets + prompt steering work everywhere; native thinking is a bonus applied
  only when available.

## Approaches considered

| Approach | Model-agnostic | Deterministic | Cost | SLM-safe |
|----------|----------------|---------------|------|----------|
| A. Native param (`reasoning_effort`, Qwen3 `/think`) | ✗ varies by model/server | med | low | depends |
| B. Budget mapping (`maxSteps` + `max_tokens`) | ✓ | ✓ | low | ✓ direct control |
| C. Prompt steering (concise vs careful) | ✓ | ✗ soft | low | med |
| D. Adaptive by difficulty (Plan-and-Budget) | ✓ | med | high | ✓ best in theory |

**Chosen: B + C now, A as a bonus passthrough, D later.** B is the backbone (works on every
local model, fully deterministic, reuses existing config). C adds Claude-like thoroughness
tone. A is layered on when the server accepts it. D (auto-pick effort from task difficulty)
is deferred — powerful but needs a difficulty heuristic.

## The dial

`effort` scales the user's configured `maxSteps`/`maxTokens` (which define *medium*):

| effort | maxSteps | maxTokens | prompt hint | native thinking |
|--------|----------|-----------|-------------|-----------------|
| **low** | ~½ (min 4) | ~½ (min 512) | "answer concisely, most direct path, avoid extra tool calls" | off |
| **medium** (default) | base | base | none | off / auto |
| **high** | ~2× | ~2× | "plan steps, verify with tools, double-check" | on when supported |

Medium = exactly today's behaviour, so existing configs are unchanged.

## Architecture

A pure module owns the mapping; the agent consumes it. No new deps, single responsibility.

```
src/effort.ts
  type Effort = "low" | "medium" | "high"
  effortProfile(effort, base) -> { maxSteps, maxTokens, hint }
```

- **Agent** ([agent/index.ts](../src/agent/index.ts)) resolves the profile per run: it bounds
  the loop with `profile.maxSteps`, passes `profile.maxTokens` to every `chat` call
  (including the graceful-finish call), and appends `profile.hint` to the system prompt at
  session init.
- **Budgets respond immediately** when effort changes mid-session (they're resolved each
  run). The prompt hint is set at session start (it lives in the once-pushed system
  message); changing effort affects tone from the next session — the impactful budget
  levers are live right away.

## UX — top-level `/effort`

A first-class command (not tucked under `/settings`):

- `/effort` — interactive radio picker (low / medium / high), current marked.
- `/effort low|medium|high` — set directly.
- Persist in config:

```jsonc
// lema.config.json
{ "effort": "medium" }   // default
```

## Implementation phases

### E0 — the dial (B + C)
- `src/effort.ts`: `Effort` type, `effortProfile(effort, base)`.
- `config.ts`: `effort?: Effort`, default `"medium"`.
- Agent: resolve profile; bound loop with `maxSteps`; pass `maxTokens` to `chat` and
  `forceFinish`; append `hint` to `SYSTEM`.
- REPL: `/effort` command (picker + arg) and a `setEffort` on the session; one-shot CLI
  passes `cfg.effort`.
- Tests: low halves and floors budgets (with minimums); high doubles; medium == base;
  unknown value falls back to medium; profile is pure.

### E1 — native thinking passthrough (A)
- On `high`, send the server's reasoning hint (e.g. `reasoning_effort`/thinking enable)
  when supported; degrade silently to B+C when not (same probe/fallback pattern as the
  strict-tools work in [grammar.ts](../src/models/grammar.js)).

### (later) E2 — adaptive effort (D)
- Auto-pick a profile from a cheap task-difficulty heuristic; manual `/effort` overrides.

## Invariants (must hold; cover with tests)

- `effortProfile` is pure and has no model call.
- `medium` reproduces the pre-effort budgets exactly (no behaviour change for old configs).
- `low` never drops below the floors (maxSteps ≥ 4, maxTokens ≥ 512).
- An unknown/missing effort resolves to `medium`, never throws.
- Zero runtime deps; `effort` merges like the other config fields.

## Open decisions

- **Scale factors.** ½ and 2× are starting points; tune against real local runs.
- **Hint responsiveness.** Baking into the session system prompt vs a per-turn end-anchor
  reminder (cf. [RULES.md](RULES.md)); start with session-init, revisit if tone lag annoys.
- **Native param names.** Which servers accept which reasoning flag — discover in E1.

## References

- [Anthropic — effort](https://platform.claude.com/docs/en/build-with-claude/effort) &
  [adaptive thinking](https://platform.claude.com/docs/en/build-with-claude/adaptive-thinking)
  (effort = behavioural signal, not a hard token budget).
- [When More Thinking Hurts (arXiv 2604.10739)](https://arxiv.org/abs/2604.10739);
  [Inverse Scaling in Test-Time Compute (2507.14417)](https://arxiv.org/pdf/2507.14417).
- [Plan and Budget (2505.16122)](https://arxiv.org/abs/2505.16122);
  [Reasoning on a Budget — survey (2507.02076)](https://arxiv.org/html/2507.02076v1).
