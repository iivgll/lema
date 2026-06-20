import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { PasteBuffer, PASTE_END } from "../../src/tui/paste.js";

describe("PasteBuffer", () => {
  test("not active initially", () => {
    const pb = new PasteBuffer();
    assert.equal(pb.active, false);
  });

  test("active after startPaste()", () => {
    const pb = new PasteBuffer();
    pb.startPaste();
    assert.equal(pb.active, true);
  });

  test("feed returns null while accumulating", () => {
    const pb = new PasteBuffer();
    pb.startPaste();
    assert.equal(pb.feed("some text"), null);
  });

  test("feed returns content when PASTE_END arrives", () => {
    const pb = new PasteBuffer();
    pb.startPaste();
    const result = pb.feed("hello" + PASTE_END);
    assert.equal(result, "hello");
    assert.equal(pb.active, false);
  });

  test("feed across multiple chunks", () => {
    const pb = new PasteBuffer();
    pb.startPaste();
    assert.equal(pb.feed("hel"), null);
    const result = pb.feed("lo" + PASTE_END);
    assert.equal(result, "hello");
  });

  test("process: short single-line paste returned inline", () => {
    const pb = new PasteBuffer();
    const result = pb.process("short text");
    assert.equal(result, "short text");
    assert.doesNotMatch(result, /\[paste/);
  });

  test("process: multi-line paste becomes placeholder", () => {
    const pb = new PasteBuffer();
    const result = pb.process("line1\nline2\nline3");
    assert.match(result, /^\[paste #1 \+3 lines\]$/);
  });

  test("process: long single-line paste becomes placeholder", () => {
    const pb = new PasteBuffer();
    const result = pb.process("x".repeat(250));
    assert.match(result, /^\[paste #1 250 chars\]$/);
  });

  test("expand restores placeholder", () => {
    const pb = new PasteBuffer();
    const raw = "line1\nline2\nline3";
    const marker = pb.process(raw);
    assert.equal(pb.expand(marker), raw);
  });

  test("expand leaves unknown placeholders unchanged", () => {
    const pb = new PasteBuffer();
    const line = "[paste #99 3 chars]";
    assert.equal(pb.expand(line), line);
  });

  test("clear removes stored pastes", () => {
    const pb = new PasteBuffer();
    const marker = pb.process("x".repeat(250));
    pb.clear();
    assert.equal(pb.expand(marker), marker);
  });

  test("multiple pastes get incrementing ids", () => {
    const pb = new PasteBuffer();
    const m1 = pb.process("x".repeat(250));
    const m2 = pb.process("y".repeat(250));
    assert.match(m1, /paste #1/);
    assert.match(m2, /paste #2/);
  });

  test("tabs converted to spaces in process", () => {
    const pb = new PasteBuffer();
    assert.equal(pb.process("a\tb"), "a  b");
  });
});
