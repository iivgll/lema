import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { effortProfile, EFFORTS } from "../src/effort.js";

const base = { maxSteps: 12, maxTokens: 2048 };

describe("effortProfile", () => {
  test("medium reproduces the base budgets exactly", () => {
    const p = effortProfile("medium", base);
    assert.equal(p.maxSteps, 12);
    assert.equal(p.maxTokens, 2048);
    assert.equal(p.hint, "");
  });

  test("low halves and floors the budgets, adds a concise hint", () => {
    const p = effortProfile("low", base);
    assert.equal(p.maxSteps, 6);
    assert.equal(p.maxTokens, 1024);
    assert.match(p.hint, /concise/i);
  });

  test("high doubles the budgets, adds a careful hint", () => {
    const p = effortProfile("high", base);
    assert.equal(p.maxSteps, 24);
    assert.equal(p.maxTokens, 4096);
    assert.match(p.hint, /verify|careful|double-check/i);
  });

  test("low respects the floors on small base budgets", () => {
    const p = effortProfile("low", { maxSteps: 4, maxTokens: 600 });
    assert.equal(p.maxSteps, 4);   // min 4, not 2
    assert.equal(p.maxTokens, 512); // min 512, not 300
  });

  test("unknown effort falls back to medium", () => {
    const p = effortProfile("turbo" as never, base);
    assert.equal(p.maxSteps, 12);
    assert.equal(p.maxTokens, 2048);
    assert.equal(p.hint, "");
  });

  test("EFFORTS lists the three levels", () => {
    assert.deepEqual([...EFFORTS], ["low", "medium", "high"]);
  });
});
