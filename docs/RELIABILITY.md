# lema — the reliability engine (verify · plan · learn)

The single highest-leverage thing we can add. 2026 research is blunt: what makes an agent
reliable is **not** a bigger model — it's a real **verification loop**. The best agents
"iteratively try actions, self-evaluate via tests/lints, and repeat until verified before
finishing." Google's DORA 2025 found AI adoption up 90% but bug rate up 9% — *generation
without verification ships defects*. For a small local model this is the whole game: it
can't out-think a hard task, but it can out-*check* it with tools.

This is three features that form one engine. The spine is **#1 (verification)**; #2 and #3
make it sharper. All three matter **more** for SLMs than for frontier models.

## Where lema is today

| Capability | Status |
|------------|--------|
| Verify via tools | ⚠️ weak — only a prompt rule + ultra's one-shot gate; nothing actually runs the project's tests automatically or checks they passed |
| Planning / decomposition | ❌ none — the model improvises step by step and drifts |
| Learn from outcomes | ⚠️ partial — `SkillStore` records wins, but failures→fixes never become rules |
| Loop safety | ✅ graceful finish + repeat guard + text-tool-call recovery |
| Context discipline | ✅ masking; pinned rules/re-injection planned ([RULES.md](RULES.md)) |

The substrate is here (tools incl. `bash`, `SkillStore`, `ContextManager`, the effort
dial). We're missing the engine that drives it.

## Feature 1 — Verification loop (the spine) ⭐

Make "check your work" automatic and tool-grounded, not a hope in the system prompt.

- **Discover the project's check command** once per session: read `package.json` scripts
  (`test`, `build`, `lint`), or `Makefile`, or an explicit `check` in `lema.config.json`.
  Zero deps — just read files.
- **Gate success on a green check.** After the agent makes file edits and tries to finish,
  lema runs the check command itself. If it fails, the failure output is fed back as a
  tool result and the loop continues (fix → re-check). Success is only accepted when the
  check passes (or there were no code changes to verify).
- **Generalises the ultra gate.** Today's ultra `verify` flag asks the model to verify;
  this makes lema *run the verifier and read the result*, which is what T1 (arXiv
  2504.04718) shows SLMs need — offload checking to tools, since they self-check poorly.
- **Bounded.** Cap verify-fix rounds (e.g. 3) so a stubborn failure ends in a graceful,
  honest "tests still failing: …" rather than an infinite loop.

Why it's #1: it directly delivers "use tools, run code, don't forget to check errors" and
is the documented top reliability lever. It also turns lema's edits from "probably works"
into "verified or reported."

## Feature 2 — Lightweight planning / decomposition

Small models lose the thread on multi-step work. Give them an external spine.

- For `high`/`ultra` (or auto-high) tasks, a cheap **plan step**: the model lists 2–5
  concrete subgoals before acting.
- The plan is kept as a **pinned checklist** and re-injected near the end of context (reuse
  the [RULES.md](RULES.md) pinned + re-inject machinery) so it survives lost-in-the-middle.
- After each subgoal, the model ticks it off. The checklist *is* the working memory.

Keep it modest: research notes planning is "less mature, less predictable" than verify, so
it's a support act — a short checklist, not a heavy planner.

## Feature 3 — Learn from failure ("every mistake becomes a rule")

lema is meant to be self-improving, but only learns from wins. Close the loop on failures.

- When a verify-fix sequence goes **red → green**, capture the delta: what failed and what
  fixed it, distilled into a one-line rule, written via `SkillStore` (kind `lesson`).
- Recalled like any skill on similar future tasks (the recall path already exists).
- This is the "every mistake becomes a rule" pattern the 2026 reports highlight — and it
  compounds: a small model that re-derives nothing gets steadily sharper on *your* repo.

## SLM rationale (why this beats "a bigger dial")

- A small model **cannot reliably self-verify** (memory/arithmetic/exactness) but **can**
  read a failing test — so route verification through tools (Feature 1).
- It **drifts** on long tasks — so externalise the plan as a checklist (Feature 2).
- It **doesn't generalise** well — so accumulate concrete, repo-specific rules (Feature 3).

Each feature converts a known SLM weakness into a deterministic, tool/﻿memory-backed
strength. None of them adds a runtime dependency.

## Architecture (builds on what exists)

```
src/verify/
  check.ts    — discover + run the project check command (test/build/lint)
  index.ts
```

- **Agent loop** consumes a `Verifier` abstraction (DIP): "is there a check? run it; is it
  green?" The loop stays unaware of *how* (could be npm test, pytest, make).
- **Planning** rides the `ContextManager` pinned/re-inject path from RULES.md — no new
  context owner.
- **Learning** rides `SkillStore` — a new skill `kind: "lesson"`, same persistence + recall.
- **Effort tie-in:** verification is on for `high`/`ultra` by default and configurable for
  `medium`; `low` skips it (speed). Auto-effort can flip it on for heavy tasks.

## Implementation phases

### V1 — verification loop (the 80/20, do this first)
- `src/verify/check.ts`: discover check command (config `check` → package.json scripts →
  Makefile); run it via the existing shell tool plumbing; return `{ ok, output }`.
- Agent: after edits + a finish attempt, run the check; on failure feed output back and
  continue; accept success only when green or no files changed. Cap rounds; honest report
  on exhaustion.
- Config: `{ "check": "npm test" }` optional override; `verify` per effort level.
- Tests (offline): command discovery from a fixture package.json; green accepts; red loops
  then reports; no-edits path skips verification.

### V2 — planning checklist
- Plan step for high/ultra; pinned checklist + re-inject (after RULES.md R0/R1 land).
- Tests: plan produced for heavy tasks; checklist survives masking; not run for low.

### V3 — learn from failure
- On red→green, distil a `lesson` skill; recall on similar tasks.
- Tests: a fixed failure writes one lesson; lessons surface via existing recall.

## Invariants (must hold; cover with tests)

- Verification never runs a command the project didn't define — discovery only, never a
  guessed destructive command.
- Success is reported only when the check is green **or** there was nothing to verify.
- Verify-fix rounds are bounded; exhaustion yields an honest failure, never a false success.
- Plan checklist and lessons reuse `ContextManager`/`SkillStore` — no new context owner,
  no new store, zero runtime deps.
- Everything degrades: no check command found → behave exactly as today.

## Open decisions

- **Check discovery order & ambiguity.** Multiple scripts (test+lint+build) — run all, or
  a configured subset? Start: prefer `test`, allow config to widen.
- **When to verify.** Only after edits (cheap) vs every finish. Start: only when files
  changed this run.
- **Lesson quality.** Auto-distilled one-liners can be noisy; cap count and dedupe by
  similarity (the embedding substrate already exists).

## References

- [Agentic design patterns 2026 (Augment)](https://www.augmentcode.com/guides/agentic-design-patterns)
  — self-correction/verification as the defining 2026 capability; DORA bug-rate finding.
- [Scaling Test-Time Compute for Agentic Coding (2604.16529)](https://www.emergentmind.com/papers/2604.16529)
  — verifiers from log-prob to running unit tests to tool feedback.
- [T1: Tool-integrated Self-verification for SLMs (2504.04718)](https://arxiv.org/pdf/2504.04718)
  — small models verify with tools, not in-head.
- AI coding agents 2026 — "every mistake becomes a rule," aggressive verification, memory.
