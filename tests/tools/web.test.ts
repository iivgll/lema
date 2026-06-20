import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { parseDDG, stripTags, cleanDDGUrl, webSearch, webFetch } from "../../src/tools/web.js";

// ---------------------------------------------------------------------------
// stripTags
// ---------------------------------------------------------------------------

describe("stripTags", () => {
  test("removes HTML tags", () => {
    assert.equal(stripTags("<b>hello</b>"), "hello");
  });

  test("decodes common entities", () => {
    assert.equal(stripTags("a &amp; b"), "a & b");
    assert.equal(stripTags("&lt;div&gt;"), "<div>");
    assert.equal(stripTags("&quot;hi&quot;"), '"hi"');
  });

  test("decodes numeric entities", () => {
    assert.equal(stripTags("&#65;"), "A");
  });

  test("decodes hex entities", () => {
    assert.equal(stripTags("what&#x27;s new"), "what's new");
  });

  test("collapses whitespace", () => {
    assert.equal(stripTags("a  \n  b"), "a b");
  });

  test("handles empty string", () => {
    assert.equal(stripTags(""), "");
  });
});

// ---------------------------------------------------------------------------
// cleanDDGUrl
// ---------------------------------------------------------------------------

describe("cleanDDGUrl", () => {
  test("unwraps a DDG redirect to the real url", () => {
    const href = "//duckduckgo.com/l/?uddg=https%3A%2F%2Fdocs.flutter.dev%2Frelease&amp;rut=abc";
    assert.equal(cleanDDGUrl(href), "https://docs.flutter.dev/release");
  });

  test("adds protocol to a bare protocol-relative url", () => {
    assert.equal(cleanDDGUrl("//example.com/page"), "https://example.com/page");
  });

  test("leaves a normal absolute url untouched", () => {
    assert.equal(cleanDDGUrl("https://example.com"), "https://example.com");
  });
});

// ---------------------------------------------------------------------------
// parseDDG — offline with HTML fixtures
// ---------------------------------------------------------------------------

/** Minimal DDG-style result block fixture. */
function makeDDGHtml(results: Array<{ title: string; url: string; snippet: string }>): string {
  return results
    .map(
      (r) => `
      <h2 class="result__title">
        <a rel="nofollow" class="result__a" href="${r.url}">${r.title}</a>
      </h2>
      <a class="result__snippet" href="#">${r.snippet}</a>
    `,
    )
    .join("\n");
}

describe("parseDDG", () => {
  test("extracts title, url, snippet from DDG HTML", () => {
    const html = makeDDGHtml([
      { title: "Node.js Docs", url: "https://nodejs.org", snippet: "Official Node.js docs." },
    ]);
    const results = parseDDG(html);
    assert.equal(results.length, 1);
    assert.equal(results[0].title, "Node.js Docs");
    assert.equal(results[0].url, "https://nodejs.org");
    assert.match(results[0].snippet, /Node\.js docs/);
  });

  test("returns multiple results", () => {
    const html = makeDDGHtml([
      { title: "A", url: "https://a.com", snippet: "snippet a" },
      { title: "B", url: "https://b.com", snippet: "snippet b" },
      { title: "C", url: "https://c.com", snippet: "snippet c" },
    ]);
    assert.equal(parseDDG(html).length, 3);
  });

  test("caps at 5 results", () => {
    const html = makeDDGHtml(
      Array.from({ length: 8 }, (_, i) => ({
        title: `T${i}`, url: `https://t${i}.com`, snippet: `s${i}`,
      })),
    );
    assert.ok(parseDDG(html).length <= 5);
  });

  test("returns [] for empty / unrecognised HTML", () => {
    assert.deepEqual(parseDDG("<html><body>Please enable JS</body></html>"), []);
  });

  test("strips HTML tags from titles and snippets", () => {
    const html = makeDDGHtml([
      { title: "<b>Bold</b> Title", url: "https://x.com", snippet: "a &amp; b" },
    ]);
    const [r] = parseDDG(html);
    assert.equal(r.title, "Bold Title");
    assert.equal(r.snippet, "a & b");
  });
});

// ---------------------------------------------------------------------------
// web_search — tool contract (mocked fetch)
// ---------------------------------------------------------------------------

describe("webSearch tool", () => {
  const ctx = { cwd: process.cwd() };

  test("returns formatted results on success", async () => {
    const html = makeDDGHtml([
      { title: "TypeScript", url: "https://typescriptlang.org", snippet: "Typed JavaScript." },
    ]);
    // @ts-ignore — mock fetch for this test
    globalThis.fetch = async () => ({ ok: true, text: async () => html });

    const result = await webSearch.run({ query: "typescript" }, ctx);
    assert.match(result, /TypeScript/);
    assert.match(result, /typescriptlang\.org/);
    assert.match(result, /Typed JavaScript/);
  });

  test("returns teaching error when server returns empty results", async () => {
    // @ts-ignore
    globalThis.fetch = async () => ({ ok: true, text: async () => "<html>no results</html>" });

    const result = await webSearch.run({ query: "xyzzy_no_match" }, ctx);
    assert.match(result, /ERROR/);
    assert.match(result, /web_fetch/);
  });

  test("returns teaching error on network failure", async () => {
    // @ts-ignore
    globalThis.fetch = async () => { throw new Error("ECONNREFUSED"); };

    const result = await webSearch.run({ query: "test" }, ctx);
    assert.match(result, /ERROR/);
    assert.match(result, /ECONNREFUSED/);
  });

  test("returns teaching error on HTTP error", async () => {
    // @ts-ignore
    globalThis.fetch = async () => ({ ok: false, status: 403, text: async () => "" });

    const result = await webSearch.run({ query: "test" }, ctx);
    assert.match(result, /ERROR/);
  });
});

// ---------------------------------------------------------------------------
// web_fetch — tool contract (mocked fetch)
// ---------------------------------------------------------------------------

describe("webFetch tool", () => {
  const ctx = { cwd: process.cwd() };

  test("returns extracted text from page", async () => {
    // @ts-ignore
    globalThis.fetch = async () => ({
      ok: true,
      text: async () => "<html><body><p>Hello <b>world</b></p></body></html>",
    });

    const result = await webFetch.run({ url: "https://example.com" }, ctx);
    assert.match(result, /Hello world/);
  });

  test("truncates long pages with hint", async () => {
    const big = "<p>" + "x".repeat(5000) + "</p>";
    // @ts-ignore
    globalThis.fetch = async () => ({ ok: true, text: async () => big });

    const result = await webFetch.run({ url: "https://example.com/big" }, ctx);
    assert.ok(result.length < 5000);
    assert.match(result, /truncated/);
  });

  test("returns teaching error on HTTP error", async () => {
    // @ts-ignore
    globalThis.fetch = async () => ({ ok: false, status: 404, text: async () => "" });

    const result = await webFetch.run({ url: "https://example.com/notfound" }, ctx);
    assert.match(result, /ERROR/);
    assert.match(result, /404/);
  });

  test("returns teaching error on network failure", async () => {
    // @ts-ignore
    globalThis.fetch = async () => { throw new Error("DNS lookup failed"); };

    const result = await webFetch.run({ url: "https://bad.invalid" }, ctx);
    assert.match(result, /ERROR/);
    assert.match(result, /DNS lookup failed/);
  });
});

// ---------------------------------------------------------------------------
// getTools — feature flag
// ---------------------------------------------------------------------------

describe("getTools web flag", () => {
  test("web tools absent by default", async () => {
    const { getTools } = await import("../../src/tools/index.js");
    const names = getTools().map((t) => t.schema.function.name);
    assert.ok(!names.includes("web_search"));
    assert.ok(!names.includes("web_fetch"));
  });

  test("web tools present when flag enabled", async () => {
    const { getTools } = await import("../../src/tools/index.js");
    const names = getTools({ tools: { web: true } }).map((t) => t.schema.function.name);
    assert.ok(names.includes("web_search"));
    assert.ok(names.includes("web_fetch"));
  });

  test("tool count stays within 7+2=9 when web enabled", async () => {
    const { getTools } = await import("../../src/tools/index.js");
    assert.ok(getTools({ tools: { web: true } }).length <= 9);
  });
});
