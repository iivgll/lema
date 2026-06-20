import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { extractSequences, parseSeq } from "../../src/tui/input.js";

describe("extractSequences", () => {
  test("plain text returns individual characters", () => {
    const { sequences, remainder } = extractSequences("abc");
    assert.deepEqual(sequences, ["a", "b", "c"]);
    assert.equal(remainder, "");
  });

  test("complete CSI sequence extracted", () => {
    const { sequences, remainder } = extractSequences("\x1b[A");
    assert.deepEqual(sequences, ["\x1b[A"]);
    assert.equal(remainder, "");
  });

  test("incomplete CSI sequence stays in remainder", () => {
    const { sequences, remainder } = extractSequences("\x1b[");
    assert.deepEqual(sequences, []);
    assert.equal(remainder, "\x1b[");
  });

  test("SGR mouse sequence extracted", () => {
    const seq = "\x1b[<0;10;20M";
    const { sequences } = extractSequences(seq);
    assert.deepEqual(sequences, [seq]);
  });

  test("text before escape + incomplete escape buffered", () => {
    const { sequences, remainder } = extractSequences("hi\x1b[");
    assert.deepEqual(sequences, ["h", "i"]);
    assert.equal(remainder, "\x1b[");
  });

  test("mixed text and complete sequences", () => {
    const { sequences, remainder } = extractSequences("a\x1b[Ab");
    assert.deepEqual(sequences, ["a", "\x1b[A", "b"]);
    assert.equal(remainder, "");
  });
});

describe("parseSeq", () => {
  test("enter / return", () => {
    assert.deepEqual(parseSeq("\r"), { name: "return" });
    assert.deepEqual(parseSeq("\n"), { name: "return" });
  });

  test("backspace", () => {
    assert.deepEqual(parseSeq("\x7f"), { name: "backspace" });
    assert.deepEqual(parseSeq("\b"), { name: "backspace" });
  });

  test("escape", () => {
    assert.deepEqual(parseSeq("\x1b"), { name: "escape" });
  });

  test("tab", () => {
    assert.deepEqual(parseSeq("\t"), { name: "tab" });
  });

  test("ctrl-c / ctrl-d", () => {
    assert.deepEqual(parseSeq("\x03"), { name: "c", ctrl: true });
    assert.deepEqual(parseSeq("\x04"), { name: "d", ctrl: true });
  });

  test("printable character", () => {
    assert.deepEqual(parseSeq("x"), { str: "x" });
  });

  test("arrow keys", () => {
    assert.deepEqual(parseSeq("\x1b[A"), { name: "up" });
    assert.deepEqual(parseSeq("\x1b[B"), { name: "down" });
    assert.deepEqual(parseSeq("\x1b[C"), { name: "right" });
    assert.deepEqual(parseSeq("\x1b[D"), { name: "left" });
  });

  test("page up / page down", () => {
    assert.deepEqual(parseSeq("\x1b[5~"), { name: "pageup" });
    assert.deepEqual(parseSeq("\x1b[6~"), { name: "pagedown" });
  });

  test("home / end", () => {
    assert.deepEqual(parseSeq("\x1b[H"), { name: "home" });
    assert.deepEqual(parseSeq("\x1b[F"), { name: "end" });
  });

  test("SGR mouse event", () => {
    const key = parseSeq("\x1b[<0;10;20M");
    assert.equal(key.mouse, 0);
  });

  test("SGR mouse wheel down (button 65)", () => {
    const key = parseSeq("\x1b[<65;10;20M");
    assert.equal(key.mouse, 65);
  });
});
