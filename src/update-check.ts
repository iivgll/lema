import { readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

const PACKAGE = "@iivgll4/lema";
const CACHE_FILE = join(homedir(), ".lema-update-check");
const CHECK_INTERVAL_MS = 24 * 60 * 60 * 1000;

function currentVersion(): string {
  try {
    const pkg = new URL("../package.json", import.meta.url).pathname;
    return JSON.parse(readFileSync(pkg, "utf8")).version as string;
  } catch {
    return "0.0.0";
  }
}

function readCache(): { checkedAt: number; latest: string } | null {
  try {
    return JSON.parse(readFileSync(CACHE_FILE, "utf8"));
  } catch {
    return null;
  }
}

function writeCache(latest: string): void {
  try {
    writeFileSync(CACHE_FILE, JSON.stringify({ checkedAt: Date.now(), latest }));
  } catch {}
}

function isNewer(latest: string, current: string): boolean {
  const p = (v: string) => v.split(".").map(Number);
  const [la, lb, lc] = p(latest);
  const [ca, cb, cc] = p(current);
  return la > ca || (la === ca && lb > cb) || (la === ca && lb === cb && lc > cc);
}

function notify(latest: string, current: string): void {
  process.stdout.write(
    `\n  ┌─────────────────────────────────────────────┐\n` +
    `  │  Update available: ${current} → \x1b[32m${latest}\x1b[0m${" ".repeat(Math.max(0, 21 - current.length - latest.length))}  │\n` +
    `  │  \x1b[36mnpm install -g ${PACKAGE}\x1b[0m  │\n` +
    `  └─────────────────────────────────────────────┘\n\n`
  );
}

async function fetchLatest(): Promise<string | null> {
  try {
    const res = await fetch(`https://registry.npmjs.org/${PACKAGE}/latest`, {
      signal: AbortSignal.timeout(3000),
    });
    const json = await res.json() as { version?: string };
    return json.version ?? null;
  } catch {
    return null;
  }
}

/**
 * Awaitable version — call before starting TUI so the notice prints cleanly.
 * Uses cache when fresh; fetches otherwise (with 3s timeout so it's not slow).
 */
export async function checkForUpdate(): Promise<void> {
  const current = currentVersion();
  const cache = readCache();

  if (cache && Date.now() - cache.checkedAt < CHECK_INTERVAL_MS) {
    if (isNewer(cache.latest, current)) notify(cache.latest, current);
    return;
  }

  const latest = await fetchLatest();
  if (!latest) return;
  writeCache(latest);
  if (isNewer(latest, current)) notify(latest, current);
}
