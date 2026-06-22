# Your local LLM isn't dumb. Your harness is.

I've been running local models for about a year. LM Studio, Ollama, a few different quantized weights. And for most of that time I kept hitting the same wall: the model would start a task, make progress, then quietly hallucinate some detail, forget what it just wrote, or give up halfway through something it clearly could have finished.

My first instinct was to upgrade the model. Bigger weights, better quant. It helped a little. But not as much as I expected.

Then I started paying attention to *how* the model was failing, not just *that* it was failing.

---

## The pattern

A 9B model tasked with "fix the failing tests in this repo" would typically:

1. Read the test file ✓
2. Read the source file ✓
3. Generate a fix that looked plausible ✓
4. Move on without running the tests ✗
5. Return an answer that was confidently wrong ✗

The model had the knowledge. It knew how to fix the issue. It just had no way to verify its own output. No feedback loop. No memory of what worked last time. No mechanism to stay on track across more than a few steps.

This isn't a model problem. It's a harness problem.

---

## What a harness actually does

When you run `claude` or `cursor` or any coding agent, there's a lot happening that isn't the model:

- Deciding which files to show the model
- Running the tests and feeding back the output
- Managing context so old turns don't crowd out recent ones
- Storing what worked before so the model doesn't reinvent it

None of that is intelligence. All of it determines whether the model's intelligence is useful.

A bad harness makes a smart model dumb. A good harness makes a small model punch above its weight.

---

## What I built

I built **lema** — an open source agentic CLI for local LLMs. The core loop is straightforward:

```
give model a task
→ model calls tools (read, write, bash, search)
→ if model touches files: run your test suite
→ if tests fail: feed output back, let model fix
→ repeat until passing or step budget exhausted
→ if red→green happened: record what worked as a memory
```

The verification loop is the main thing. The model stops guessing and starts knowing.

---

## The results are surprising

Testing against the same codebase with two models:

- `qwen3-coder-30B` (iq2_xxs quant, aggressive compression)
- `qwen3.5-9B` (8-bit quant, much higher quality)

The 30B is technically "smarter" by parameter count. But in practice the 9B with a good harness consistently outperformed it. The 30B would loop, repeat tool calls, lose track of what it had already done. The 9B would read, edit, verify, done.

Quantization quality matters more than raw size when the harness is doing the heavy lifting.

---

## The things that actually matter

**Verification.** Not "does the answer look right" but "does it pass the tests." Small models verify poorly in their head but well with actual output. So lema runs the check, not the model.

**Memory.** When a task completes after a test failure, lema stores a lesson — what the task was, what the check was, what the failure said. On similar future tasks it retrieves relevant lessons via embedding search before starting. The model reads them. It doesn't start from scratch.

**Context compaction.** Long tasks fill the context window. Most agents either crash or start hallucinating. lema auto-summarizes older turns and continues. 20-step tasks on a 9B model, no degradation.

**Effort dial.** Not every task needs deep reasoning. `--effort low` for quick lookups, `--effort high` for architecture decisions. This isn't just a prompt change — it scales the reasoning budget, step limits, and verification aggressiveness.

---

## The honest limitations

This doesn't make a 9B model into GPT-4. Complex multi-file refactors on large codebases still hit context limits. Web search quality depends on the model's synthesis ability. And some tasks just need a bigger model.

But for a substantial class of everyday coding tasks — fixing a bug, writing tests, adding a feature — a well-harnessed small local model works. No API key. No cloud. No cost per token.

---

## Try it

```bash
npm install -g @iivgll4/lema
lema "fix the failing tests in this repo"
```

Needs LM Studio running with a model loaded. Works with any OpenAI-compatible server.

The code is on GitHub, MIT licensed. If you try it and something doesn't work, open an issue.
