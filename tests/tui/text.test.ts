import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { vlen, wrap } from "../../src/tui/text.js";

describe("vlen", () => {
  test("plain string", () => assert.equal(vlen("hello"), 5));
  test("empty string", () => assert.equal(vlen(""), 0));
  test("strips SGR color codes", () => assert.equal(vlen("\x1b[32mhello\x1b[0m"), 5));
  test("strips bold", () => assert.equal(vlen("\x1b[1mABC\x1b[0m"), 3));
  test("multiple codes", () => assert.equal(vlen("\x1b[1m\x1b[36mhi\x1b[0m"), 2));
});

describe("wrap", () => {
  test("short line returned as-is", () => {
    assert.deepEqual(wrap("hello", 10), ["hello"]);
  });

  test("exact width not wrapped", () => {
    assert.deepEqual(wrap("hello", 5), ["hello"]);
  });

  test("long line split at width", () => {
    const result = wrap("abcdefgh", 4);
    assert.deepEqual(result, ["abcd", "efgh"]);
  });

  test("ANSI codes do not count toward width", () => {
    const colored = "\x1b[32mhello\x1b[0m";
    // visible length is 5, width is 10 — should not wrap
    assert.deepEqual(wrap(colored, 10), [colored]);
  });

  test("ANSI codes do not count toward width when wrapping", () => {
    // 12 visible chars, width 6 → visible content across 2 chunks; reset code on last chunk
    const result = wrap("\x1b[1m" + "a".repeat(12) + "\x1b[0m", 6);
    const visible = result.map((l) => l.replace(/\x1b\[[0-9;]*m/g, "")).join("");
    assert.equal(visible, "a".repeat(12));
  });

  test("empty string", () => {
    assert.deepEqual(wrap("", 10), [""]);
  });

  test("width 1 splits every character", () => {
    const result = wrap("abc", 1);
    assert.deepEqual(result, ["a", "b", "c"]);
  });
});
