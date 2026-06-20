import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { renderMarkdown } from "../../src/tui/markdown.js";

const strip = (s: string) => s.replace(/\x1b\[[0-9;]*m/g, "");

describe("renderMarkdown", () => {
  test("plain text unchanged", () => {
    assert.equal(strip(renderMarkdown("hello world")), "hello world");
  });

  test("bold **text** visible text is unwrapped", () => {
    assert.equal(strip(renderMarkdown("**bold**")), "bold");
  });

  test("italic *text* visible text is unwrapped", () => {
    assert.equal(strip(renderMarkdown("*italic*")), "italic");
  });

  test("inline code `code` visible text is unwrapped", () => {
    assert.equal(strip(renderMarkdown("`code`")), "code");
  });

  test("# heading visible text has no leading #", () => {
    assert.equal(strip(renderMarkdown("# Heading")).trim(), "Heading");
  });

  test("bullet list - item", () => {
    const out = renderMarkdown("- item");
    assert.equal(strip(out).trim(), "• item");
  });

  test("fenced code block preserved as-is", () => {
    const input = "```\nconst x = 1;\n```";
    const out = strip(renderMarkdown(input));
    assert.match(out, /const x = 1;/);
  });

  test("empty string", () => {
    assert.equal(renderMarkdown(""), "");
  });

  test("multiple lines", () => {
    const out = strip(renderMarkdown("line1\nline2"));
    assert.match(out, /line1/);
    assert.match(out, /line2/);
  });
});
