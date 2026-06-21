# lema — skills & memory (authored skills + learned memory)

Two different things have been living in one `SkillStore`. Claude keeps them apart and so
should we:

- **Authored Skills** — reusable capability packages a human *or the model* writes
  (Claude-style `SKILL.md`), invocable by name, loaded on demand. New.
- **Learned memory** — facts/lessons the agent accumulates automatically and recalls by
  similarity. This is today's `SkillStore`; it needs finishing, not replacing.

This doc covers both: how to add Claude-style skills (project + global, `/skill` invocation,
AI-authored), and how to complete the learned-memory half.

## Why two systems

| | Authored Skills | Learned memory |
|---|---|---|
| Author | human or model (explicit) | the agent (automatic) |
| Trigger | `/name` or description match | similarity recall every task |
| Content | a capability ("how to do X here") | a fact/lesson ("this failed before") |
| Storage | `…/skills/<name>/SKILL.md` | `…/memory/*.json` (+ embedding) |
| Lifecycle | created/edited/deleted by you | grows + prunes itself |

Conflating them is why the current store is half-built. Split them and each gets simple.

## Current state (what to fix)

`src/skills/index.ts` is an embedding store at `.lema/skills/`. Honest gaps found in testing
([TEST-FINDINGS](TEST-FINDINGS.md)):
- `save()` is only ever called for red→green **lessons** — nothing captures successful
  procedures.
- `record()` (wins/uses) is **never called** → no quality signal, no pruning.
- UI says "previously-verified skills" — misleading; it's lessons.
- It also squats the name `skills`, which we want for authored skills.

## Part A — Authored Skills (Claude-style, new)

### Format — `SKILL.md`
A skill is a directory whose name is the invocation handle:

```
<skills-dir>/<name>/SKILL.md
```

```markdown
---
name: pr-review
description: Review a diff for bugs and style per this repo's conventions. Use when asked to review code or a PR.
---

# PR review
1. Run `git diff` to get the change.
2. Check: tests updated? errors handled? naming matches neighbours?
3. Report findings as a short list, most important first.
```

Frontmatter `name` + `description` are the only required fields. The body is plain Markdown
instructions. Optional sibling files (`reference.md`, `scripts/…`) are loaded only on demand
(level 3) via the normal `read_file`/`bash` tools.

### Scope — project + global
- **Project:** `.lema/skills/` (committed, shared with the repo).
- **Global:** `~/.lema/skills/` (personal, all projects).
- **Precedence:** project overrides global on a name clash (the repo pins its version).
  *(Claude does personal>project; we choose project-wins as more intuitive for a coding
  tool — see open decisions.)*

### Progressive disclosure (the SLM win)
Three levels, exactly like Claude — and even more valuable on a small window:
1. **L1 metadata, always on.** At session start, inject one line per skill —
   `name — description` — into the system preamble (via the same render-injection the rules
   use). ~1 line/skill, cheap.
2. **L2 body, on demand.** Load a skill's `SKILL.md` body into context only when it is
   invoked (below). Keep bodies short (≤ ~200 lines).
3. **L3 resources, as needed.** Extra files are just files — the model `read_file`s them
   when the body tells it to.

For a small model with many skills, L1 could still grow; if the catalog gets large, rank
the L1 list by embedding similarity to the task (reuse the memory embedder) and show top-k.

### Invocation
- **Explicit:** `/<name>` (or `/skill <name>`) → load that skill's body as a system message,
  then run the task with it in context.
- **Auto:** at task start, embed the task against skill descriptions; on a strong match,
  load that body automatically (announce it: `● skill pr-review`). Threshold tunable; off
  by default for SLM predictability, on via config.

### Authoring — by a human *or* the model
- **Human:** drop a `SKILL.md` in a skills dir. Done.
- **Model (the "skill-creator"):** `lema skill new "<what the skill should do>"` (or
  `/skill new …`). lema runs the model with a built-in **skill-creator instruction**
  (in-harness, like Claude's) that turns the prompt into a well-formed `SKILL.md`:
  - a crisp `name` (kebab-case), a trigger-rich `description` (so auto-match works),
  - a short, imperative body,
  - written to project or global (`--global`) after showing it for confirmation.
  The skill-creator instruction is the single source of "what a good skill looks like".

### Commands
- `/skills` — list available skills (name · scope · description).
- `/<name>` or `/skill <name>` — invoke.
- `/skill new "<prompt>" [--global]` — AI-author a skill.
- `/skill edit <name>` — open/regenerate. (later)

## Part B — finish Learned memory (the existing store)

Rename the concept to **memory**, move storage to `.lema/memory/`, and wire the missing
loop:
- **Capture successes, not just failures.** On a verified-green task that did real work,
  optionally distil a `procedure` memory (what worked) — gated so it doesn't spam.
- **Wire `wins`/`uses`.** When a recalled memory was in context for a task that succeeded,
  `record(win)`; surface `wins/uses` in listings; **prune** memories with poor ratios past
  a floor of uses.
- **Fix the wording** ("previously-verified skills" → "recalled memory").
- Keep red→green lessons (already working).

Authored Skills and memory can share the embedder and the cosine helper (DRY) but stay
separate stores.

## Architecture

```
src/skills/            (authored skills — new)
  skill.ts     — parse SKILL.md (frontmatter + body), validate
  store.ts     — discover project + global, precedence, list, load body
  creator.ts   — the skill-creator instruction + author-from-prompt
  index.ts
src/memory/            (renamed from today's skills/)
  store.ts     — embedding store (save/search/record/prune)
  index.ts
```

- The agent gets skill **metadata (L1)** injected at session start (render-injection,
  reusing the rules/preamble path) and **memory recall** as today.
- `/<name>` and `/skill new` are REPL commands; the one-shot CLI gets `skill` subcommands.
- DIP preserved: the agent depends on small interfaces (`listSkillMeta()`, `loadSkill(name)`,
  `memory.search()`), not on file layout.

## Implementation phases

### S1 — authored skills, read path (the 80/20)
- `skill.ts` + `store.ts`: discover `.lema/skills/` and `~/.lema/skills/`, parse `SKILL.md`,
  project-wins precedence.
- L1 metadata injected into the preamble; `/skills` lists them.
- `/<name>` (and `/skill <name>`) loads the body and runs the task with it.
- Tests: discovery + precedence; frontmatter parse; body loads only on invoke.

### S2 — AI skill-creator
- `creator.ts`: skill-creator instruction; `skill new "<prompt>" [--global]` writes a
  validated `SKILL.md` after confirmation.
- Tests: generated file has valid frontmatter; lands in the chosen scope.

### S3 — auto-invocation
- Embed task vs skill descriptions; load top body on a strong match, behind a config flag.

### S4 — finish memory
- Rename `skills/` store → `memory/` at `.lema/memory/`; wire `wins/uses` + prune; optional
  success-procedure capture; fix wording. Migrate any existing `.lema/skills/*.json`.

## Invariants (must hold; cover with tests)
- L1 shows only `name — description`; bodies load only on invoke/auto-match (progressive
  disclosure holds — never dump all skill bodies into context).
- Project skill overrides a global skill of the same name.
- A malformed `SKILL.md` (bad/missing frontmatter) is skipped with a warning, never crashes.
- Authored skills and memory are separate stores; the embedder/cosine is the only shared code.
- Zero runtime deps; skills config deep-merges like the other blocks.

## Open decisions
- **Precedence.** project-wins (chosen) vs Claude's personal-wins. Revisit if it surprises.
- **Global dir.** `~/.lema/skills/`; optionally also read `~/.claude/skills/` for instant
  reuse of existing Claude skills (compat bonus) — decide in S1.
- **Auto-invocation on SLM.** Strong-match threshold to avoid firing the wrong skill; start
  conservative / opt-in.
- **L1 budget when many skills.** List all vs embed-ranked top-k; start "list all", add
  ranking when a catalog grows.

## References
- [Anthropic — Equipping agents with Agent Skills](https://www.anthropic.com/engineering/equipping-agents-for-the-real-world-with-agent-skills)
- [Agent Skills overview](https://platform.claude.com/docs/en/agents-and-tools/agent-skills/overview) ·
  [authoring best practices](https://platform.claude.com/docs/en/agents-and-tools/agent-skills/best-practices)
- [Extend Claude Code with skills](https://code.claude.com/docs/en/skills) (personal vs project, `/name`, skill-creator)
- Progressive disclosure: L1 metadata always-on (~100 tok), L2 body <5k on trigger, L3 on demand.
