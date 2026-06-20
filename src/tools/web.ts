import { def, obj } from "./types.js";

const DDG_URL = "https://html.duckduckgo.com/html/?q=";
const FETCH_CAP = 2000;
const RESULT_CAP = 5;
const CACHE_TTL_MS = 3 * 60 * 1000;

// ---------------------------------------------------------------------------
// In-memory cache (W2)
// ---------------------------------------------------------------------------

interface CacheEntry { result: string; ts: number }
const cache = new Map<string, CacheEntry>();

function fromCache(key: string): string | undefined {
  const e = cache.get(key);
  if (!e) return undefined;
  if (Date.now() - e.ts > CACHE_TTL_MS) { cache.delete(key); return undefined; }
  return e.result;
}
function toCache(key: string, result: string): void {
  cache.set(key, { result, ts: Date.now() });
}

// ---------------------------------------------------------------------------
// HTML helpers
// ---------------------------------------------------------------------------

const ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " " };

/** Strip HTML tags and decode common entities. */
export function stripTags(html: string): string {
  return html
    .replace(/<[^>]+>/g, " ")
    .replace(/&#x([0-9a-fA-F]+);/g, (_, h) => String.fromCharCode(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
    .replace(/&([a-zA-Z]+);/g, (_, e) => ENTITIES[e.toLowerCase()] ?? "")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * DuckDuckGo wraps every result href in a redirect: //duckduckgo.com/l/?uddg=<real>&rut=…
 * Pull the real target out of the uddg param and decode it. Falls back to the
 * raw href (with protocol added) when it isn't a wrapped link.
 */
export function cleanDDGUrl(href: string): string {
  const m = href.match(/[?&]uddg=([^&]+)/);
  if (m) {
    try { return decodeURIComponent(m[1]); } catch { /* fall through */ }
  }
  return href.startsWith("//") ? `https:${href}` : href;
}

// ---------------------------------------------------------------------------
// DDG parser (W0) — pure function, tested offline
// ---------------------------------------------------------------------------

export interface SearchResult { title: string; url: string; snippet: string }

/**
 * Parse a DuckDuckGo HTML results page into structured records.
 * Regex-based, no DOM — zero deps.
 * Returns [] when markup is unrecognised (bot challenge, empty, etc.).
 */
export function parseDDG(html: string): SearchResult[] {
  const results: SearchResult[] = [];

  // result__a holds title + URL; result__snippet holds the description.
  const titleRe = /class="result__a"[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/g;
  const snippetRe = /class="result__snippet"[^>]*>([\s\S]*?)<\/(?:a|div)>/g;

  const titles: Array<{ url: string; title: string }> = [];
  let m: RegExpExecArray | null;
  while ((m = titleRe.exec(html)) !== null && titles.length < RESULT_CAP) {
    titles.push({ url: cleanDDGUrl(m[1]), title: stripTags(m[2]) });
  }
  const snippets: string[] = [];
  while ((m = snippetRe.exec(html)) !== null && snippets.length < RESULT_CAP) {
    snippets.push(stripTags(m[1]));
  }

  for (let i = 0; i < titles.length; i++) {
    results.push({ ...titles[i], snippet: snippets[i] ?? "" });
  }
  return results;
}

function formatResults(results: SearchResult[]): string {
  return results
    .map((r, i) => `${i + 1}. ${r.title}\n   ${r.url}\n   ${r.snippet}`)
    .join("\n\n");
}

// ---------------------------------------------------------------------------
// Tools
// ---------------------------------------------------------------------------

export const webSearch = def(
  "web_search",
  "Search the web via DuckDuckGo. Returns up to 5 title·url·snippet results. Use web_fetch to read a full page.",
  obj({ query: { type: "string", description: "Search query." } }, ["query"]),
  async ({ query }) => {
    const key = `search:${query}`;
    const cached = fromCache(key);
    if (cached) return cached;

    let html: string;
    try {
      const res = await fetch(`${DDG_URL}${encodeURIComponent(query)}`, {
        headers: { "User-Agent": "Mozilla/5.0 (compatible; lema/1.0)" },
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      html = await res.text();
    } catch (e) {
      return `ERROR: search request failed — ${(e as Error).message} → try again or use web_fetch with a direct URL`;
    }

    const results = parseDDG(html);
    if (!results.length) {
      return `ERROR: search blocked or no results for "${query}" — retry later or use web_fetch with a direct URL`;
    }

    const out = formatResults(results);
    toCache(key, out);
    return out;
  },
);

export const webFetch = def(
  "web_fetch",
  "Fetch one web page and return its readable text, truncated. Use after web_search to read a specific result.",
  obj({ url: { type: "string", description: "Full URL to fetch." } }, ["url"]),
  async ({ url }) => {
    const key = `fetch:${url}`;
    const cached = fromCache(key);
    if (cached) return cached;

    let html: string;
    try {
      const res = await fetch(url, {
        headers: { "User-Agent": "Mozilla/5.0 (compatible; lema/1.0)" },
      });
      if (!res.ok) return `ERROR: could not fetch ${url} (HTTP ${res.status})`;
      html = await res.text();
    } catch (e) {
      return `ERROR: could not fetch ${url} — ${(e as Error).message}`;
    }

    const text = stripTags(html);
    const out = text.length > FETCH_CAP ? text.slice(0, FETCH_CAP) + `…[truncated — ${text.length - FETCH_CAP} more chars]` : text;
    toCache(key, out);
    return out;
  },
);
