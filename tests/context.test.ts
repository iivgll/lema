import { describe, it } from "node:test";
import assert from "node:assert/strict";
import type { ChatMessage } from "../src/provider.js";
import { pressureStage, usableBudget, estimateTokens, BUDGET_DEFAULTS } from "../src/context/budget.js";
import { maskObservations } from "../src/context/mask.js";
import { ContextManager } from "../src/context/manager.js";

// ---------------------------------------------------------------------------
// budget
// ---------------------------------------------------------------------------

describe("pressureStage", () => {
  const b = BUDGET_DEFAULTS; // contextWindow=8192, reserveTokens=2048 → usable=6144

  it("stage 0 below 70%", () => {
    assert.equal(pressureStage(0, b), 0);
    assert.equal(pressureStage(Math.floor(6144 * 0.69), b), 0);
  });

  it("stage 1 at 70%", () => {
    assert.equal(pressureStage(Math.ceil(6144 * 0.70), b), 1);
  });

  it("stage 2 at 85%", () => {
    assert.equal(pressureStage(Math.ceil(6144 * 0.85), b), 2);
  });

  it("stage 3 at 95%", () => {
    assert.equal(pressureStage(Math.ceil(6144 * 0.95), b), 3);
  });

  it("usableBudget is contextWindow minus reserveTokens", () => {
    assert.equal(usableBudget(b), 8192 - 2048);
  });
});

describe("estimateTokens", () => {
  it("empty messages returns 0", () => {
    assert.equal(estimateTokens([]), 0);
  });

  it("approximates chars/4", () => {
    const msgs: ChatMessage[] = [{ role: "user", content: "aaaa" }];
    assert.equal(estimateTokens(msgs), 1);
  });

  it("counts tool_calls JSON", () => {
    const msg: ChatMessage = {
      role: "assistant",
      content: null,
      tool_calls: [{ id: "1", type: "function", function: { name: "f", arguments: "{}" } }],
    };
    const est = estimateTokens([msg]);
    assert.ok(est > 0);
  });
});

// ---------------------------------------------------------------------------
// mask
// ---------------------------------------------------------------------------

describe("maskObservations", () => {
  function toolMsg(content: string, id = "t1"): ChatMessage {
    return { role: "tool", tool_call_id: id, content };
  }
  function userMsg(content: string): ChatMessage {
    return { role: "user", content };
  }
  function assistantMsg(content: string): ChatMessage {
    return { role: "assistant", content };
  }

  it("does not mask anything when all content fits in maskWindow", () => {
    const msgs: ChatMessage[] = [toolMsg("hello")];
    const result = maskObservations(msgs, 10_000);
    assert.equal(result[0].content, "hello");
  });

  it("masks old tool results beyond maskWindow", () => {
    // Fill with 1000 characters (≈250 tok), then set maskWindow to 0 to force mask.
    const large = "x".repeat(1000);
    const msgs: ChatMessage[] = [toolMsg(large, "t1"), userMsg("q")];
    const result = maskObservations(msgs, 0);
    assert.ok(result[0].content?.startsWith("[output hidden"));
  });

  it("never removes tool_call_id from masked messages", () => {
    const large = "x".repeat(1000);
    const msgs: ChatMessage[] = [toolMsg(large, "abc123")];
    const result = maskObservations(msgs, 0);
    assert.equal(result[0].tool_call_id, "abc123");
  });

  it("never touches assistant reasoning", () => {
    const msgs: ChatMessage[] = [
      assistantMsg("my reasoning here"),
      toolMsg("x".repeat(2000), "t1"),
    ];
    const result = maskObservations(msgs, 0);
    assert.equal(result[0].content, "my reasoning here");
  });

  it("preserves message count", () => {
    const msgs: ChatMessage[] = [toolMsg("a"), userMsg("b"), assistantMsg("c")];
    const result = maskObservations(msgs, 0);
    assert.equal(result.length, msgs.length);
  });

  it("does not mutate the input array", () => {
    const msgs: ChatMessage[] = [toolMsg("original")];
    maskObservations(msgs, 0);
    assert.equal(msgs[0].content, "original");
  });
});

// ---------------------------------------------------------------------------
// ContextManager
// ---------------------------------------------------------------------------

describe("ContextManager", () => {
  it("isInitialized() is false before first push", () => {
    const ctx = new ContextManager();
    assert.equal(ctx.isInitialized(), false);
  });

  it("isInitialized() is true after push", () => {
    const ctx = new ContextManager();
    ctx.push({ role: "user", content: "hi" });
    assert.equal(ctx.isInitialized(), true);
  });

  it("render() returns pushed messages at low pressure", () => {
    const ctx = new ContextManager();
    ctx.push({ role: "user", content: "hello" });
    const rendered = ctx.render();
    assert.equal(rendered.length, 1);
    assert.equal(rendered[0].content, "hello");
  });

  it("pressure() is 0 with no messages and no usage update", () => {
    const ctx = new ContextManager();
    assert.equal(ctx.pressure(), 0);
  });

  it("updateUsage drives pressure()", () => {
    const ctx = new ContextManager({ budget: { contextWindow: 1000, reserveTokens: 0 } });
    ctx.updateUsage(700);
    assert.ok(ctx.pressure() >= 0.7);
  });

  it("render() applies masking at stage 1 pressure", () => {
    // Set a tiny contextWindow so 700/800 tokens = 87.5% → stage 2, which still runs masking.
    const ctx = new ContextManager({ budget: { contextWindow: 800, reserveTokens: 0, maskWindow: 0 } });
    ctx.push({ role: "tool", tool_call_id: "t1", content: "big output here" });
    ctx.updateUsage(700); // ≥70% of 800 → stage 1
    const rendered = ctx.render();
    assert.ok(rendered[0].content?.startsWith("[output hidden"));
  });

  const rules = { full: "FULL RULES", condensed: "• rule", reinject: true, reinjectEvery: 2 };

  it("injects the full rules as a start anchor after the system prompt", () => {
    const ctx = new ContextManager({ rules: { ...rules, reinject: false } });
    ctx.push({ role: "system", content: "SYSTEM" });
    ctx.push({ role: "user", content: "hi" });
    const out = ctx.render();
    assert.equal(out[0].content, "SYSTEM");
    assert.equal(out[1].content, "FULL RULES"); // rules right after system
    assert.equal(out[2].content, "hi");
  });

  it("re-injects a condensed reminder on the reinjectEvery cadence", () => {
    const ctx = new ContextManager({ rules });
    ctx.push({ role: "system", content: "SYSTEM" });
    ctx.push({ role: "user", content: "hi" });
    ctx.render(); // renderCount 1 → no reminder (1 % 2 !== 0)
    const out = ctx.render(); // renderCount 2 → reminder appended
    assert.match(out[out.length - 1].content ?? "", /Reminder of the project rules/);
    assert.match(out[out.length - 1].content ?? "", /• rule/);
  });

  it("no rules ⇒ output unchanged", () => {
    const ctx = new ContextManager();
    ctx.push({ role: "system", content: "SYSTEM" });
    ctx.push({ role: "user", content: "hi" });
    assert.equal(ctx.render().length, 2);
  });
});

// ---------------------------------------------------------------------------
// compaction
// ---------------------------------------------------------------------------

describe("ContextManager.compact", () => {
  // A summarizer stub that records what it was asked to compress.
  const stubSummarizer = (capture?: (t: string) => void) => async (transcript: string) => {
    capture?.(transcript);
    return "SUMMARY";
  };

  // Build a manager whose budget makes the recent-tail tiny, so most history
  // becomes "middle" and is eligible for summarizing.
  const mgr = () => new ContextManager({ budget: { keepRecentTokens: 1 } });

  it("replaces the middle with a system summary, keeps head + recent user turn", async () => {
    const ctx = mgr();
    ctx.push({ role: "system", content: "SYSTEM" });
    ctx.push({ role: "user", content: "first task" });
    ctx.push({ role: "assistant", content: "did some work " .repeat(20) });
    ctx.push({ role: "user", content: "second task" });
    const ok = await ctx.compact(stubSummarizer());
    assert.equal(ok, true);
    const out = ctx.render();
    assert.equal(out[0].content, "SYSTEM");
    assert.match(out[1].content ?? "", /compacted to save context/);
    assert.match(out[1].content ?? "", /SUMMARY/);
    assert.equal(out[out.length - 1].content, "second task"); // recent turn kept verbatim
  });

  it("summarizes the older middle, not the recent tail", async () => {
    let seen = "";
    const ctx = mgr();
    ctx.push({ role: "system", content: "SYSTEM" });
    ctx.push({ role: "user", content: "OLD TASK" });
    ctx.push({ role: "assistant", content: "OLD WORK" });
    ctx.push({ role: "user", content: "RECENT TASK" });
    await ctx.compact(stubSummarizer((t) => (seen = t)));
    assert.match(seen, /OLD TASK/);
    assert.ok(!seen.includes("RECENT TASK"), "recent turn should not be summarized");
  });

  it("never orphans a tool result (tail starts on a user turn)", async () => {
    const ctx = mgr();
    ctx.push({ role: "system", content: "SYSTEM" });
    ctx.push({ role: "user", content: "task" });
    ctx.push({ role: "assistant", content: null, tool_calls: [{ id: "1", type: "function", function: { name: "f", arguments: "{}" } }] });
    ctx.push({ role: "tool", tool_call_id: "1", content: "result" });
    ctx.push({ role: "user", content: "next" });
    await ctx.compact(stubSummarizer());
    const out = ctx.render();
    // No tool message without a preceding assistant tool_calls.
    for (let i = 0; i < out.length; i++) {
      if (out[i].role === "tool") assert.equal(out[i - 1]?.role, "assistant");
    }
  });

  it("returns false (no-op) when there is nothing to compact", async () => {
    const ctx = new ContextManager();
    ctx.push({ role: "system", content: "SYSTEM" });
    ctx.push({ role: "user", content: "hi" });
    assert.equal(await ctx.compact(stubSummarizer()), false);
  });

  it("returns false when the summarizer yields nothing", async () => {
    const ctx = mgr();
    ctx.push({ role: "system", content: "SYSTEM" });
    ctx.push({ role: "user", content: "a" });
    ctx.push({ role: "assistant", content: "b ".repeat(20) });
    ctx.push({ role: "user", content: "c" });
    assert.equal(await ctx.compact(async () => "   "), false);
  });
});
