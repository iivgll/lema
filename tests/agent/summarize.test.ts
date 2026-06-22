import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { summarizeResult } from "../../src/agent/index.js";

describe("summarizeResult preview", () => {
  test("list_dir lists entry names inline", () => {
    const out = summarizeResult("list_dir", "src/\npackage.json\nREADME.md");
    assert.match(out, /3 entries/);
    assert.match(out, /src\/.*package\.json.*README\.md/);
  });

  test("grep shows count and first matches", () => {
    const r = "a.ts:1:foo\nb.ts:2:foo\nc.ts:3:foo\nd.ts:4:foo";
    const out = summarizeResult("grep", r);
    const lines = out.split("\n");
    assert.equal(lines[0], "4 matches");
    assert.match(lines[1], /a\.ts:1:foo/);
    assert.match(out, /… \+1 more/);
  });

  test("glob singular/plural and no-match", () => {
    assert.equal(summarizeResult("glob", "no files match: *.zzz").split("\n")[0], "no files");
    assert.equal(summarizeResult("glob", "only.ts").split("\n")[0], "1 file");
  });

  test("web_search previews result titles", () => {
    const r = "1. First Title\n   http://a\n   snip\n\n2. Second Title\n   http://b\n   snip";
    const out = summarizeResult("web_search", r);
    assert.match(out, /2 results/);
    assert.match(out, /1\. First Title/);
    assert.match(out, /2\. Second Title/);
    assert.ok(!out.includes("http://"), "urls/snippets excluded from preview");
  });

  test("edit_file strips the OK prefix", () => {
    assert.equal(summarizeResult("edit_file", "OK: edited src/x.ts"), "edited src/x.ts");
  });

  test("bash shows a couple output lines", () => {
    const out = summarizeResult("bash", "line one\nline two\nline three");
    assert.equal(out.split("\n")[0], "3 lines");
    assert.match(out, /line one/);
  });

  test("errors collapse to one line", () => {
    assert.equal(summarizeResult("bash", "EXIT 1:\nboom"), "EXIT 1:");
  });
});
