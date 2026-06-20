import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { dirname } from "node:path";
import { def, obj, safe } from "./types.js";

const READ_LIMIT_DEFAULT = 200;
/** Per-line cap: keeps a single huge line (minified JS/JSON) from flooding the context. */
const LINE_CHAR_CAP = 2000;
/** Lines of context shown around each pattern match (like grep -C). */
const PATTERN_CONTEXT_DEFAULT = 3;
/** Most match-windows returned in pattern mode before truncating. */
const PATTERN_WINDOW_CAP = 20;

/** Truncate an over-long line so one minified line can't flood the context. */
function clamp(line: string): string {
  return line.length > LINE_CHAR_CAP ? line.slice(0, LINE_CHAR_CAP) + "…[line truncated]" : line;
}

/**
 * Return only the windows of lines around each regex match (grep -C style),
 * merging overlapping windows. Each line is prefixed with its 1-based number so
 * the model knows where it is and can offset-read for more.
 */
function readMatches(lines: string[], pattern: string, context: number): string {
  let re: RegExp;
  try {
    re = new RegExp(pattern);
  } catch {
    return `ERROR: invalid regex: ${pattern}`;
  }
  const hits: number[] = [];
  for (let i = 0; i < lines.length; i++) if (re.test(lines[i])) hits.push(i);
  if (!hits.length) return `no lines match /${pattern}/ → read without pattern to page through the file`;

  // Merge each hit's [i-context, i+context] window into non-overlapping ranges.
  const ranges: Array<[number, number]> = [];
  for (const i of hits) {
    const lo = Math.max(0, i - context);
    const hi = Math.min(lines.length - 1, i + context);
    const last = ranges[ranges.length - 1];
    if (last && lo <= last[1] + 1) last[1] = Math.max(last[1], hi);
    else ranges.push([lo, hi]);
  }

  const shown = ranges.slice(0, PATTERN_WINDOW_CAP);
  const blocks = shown.map(([lo, hi]) => {
    const body = [];
    for (let i = lo; i <= hi; i++) body.push(`${i + 1}:${clamp(lines[i])}`);
    return body.join("\n");
  });
  const suffix = ranges.length > PATTERN_WINDOW_CAP ? `\n...[${ranges.length - PATTERN_WINDOW_CAP} more match windows — narrow the pattern]` : "";
  return blocks.join("\n--\n") + suffix;
}

export const readFile = def(
  "read_file",
  "Read a UTF-8 file. Give pattern to return only the lines around each match (like grep -C) — best for large files. Otherwise use offset/limit to page through it.",
  obj(
    {
      path: { type: "string", description: "Path relative to the working directory." },
      offset: { type: "number", description: "1-based line number to start reading from (default 1)." },
      limit: { type: "number", description: `Max lines to return (default ${READ_LIMIT_DEFAULT}).` },
      pattern: { type: "string", description: "Regex; return only matching lines with surrounding context instead of a contiguous range." },
      context: { type: "number", description: `Lines of context around each pattern match (default ${PATTERN_CONTEXT_DEFAULT}).` },
    },
    ["path"],
  ),
  async ({ path, offset, limit, pattern, context }, ctx) => {
    const abs = safe(ctx.cwd, path);
    if (!existsSync(abs)) {
      return `ERROR: file not found: ${path} → try grep to search for the file name, or list_dir to explore`;
    }
    const lines = readFileSync(abs, "utf8").split("\n");

    if (pattern) {
      const around = Math.max(0, Number(context) || PATTERN_CONTEXT_DEFAULT);
      return readMatches(lines, pattern, around);
    }

    const from = Math.max(1, Number(offset) || 1) - 1; // convert to 0-based
    const count = Number(limit) || READ_LIMIT_DEFAULT;
    const slice = lines.slice(from, from + count).map(clamp);
    const suffix = from + count < lines.length ? `\n...[${lines.length - from - count} more lines — use offset=${from + count + 1}]` : "";
    return slice.join("\n") + suffix;
  },
);

export const writeFile = def(
  "write_file",
  "Create or overwrite a file with full content. Prefer edit_file for targeted changes to existing files.",
  obj(
    {
      path: { type: "string", description: "Path relative to the working directory." },
      content: { type: "string", description: "Full file content to write." },
    },
    ["path", "content"],
  ),
  async ({ path, content }, ctx) => {
    const abs = safe(ctx.cwd, path);
    mkdirSync(dirname(abs), { recursive: true });
    writeFileSync(abs, content, "utf8");
    return `OK: wrote ${content.length} bytes to ${path}`;
  },
);

export const editFile = def(
  "edit_file",
  "Replace an exact string in a file. The old string must match exactly once — if it matches zero or multiple times the edit is refused.",
  obj(
    {
      path: { type: "string", description: "Path relative to the working directory." },
      old: { type: "string", description: "Exact string to find and replace. Must be unique in the file." },
      new: { type: "string", description: "String to replace it with." },
    },
    ["path", "old", "new"],
  ),
  async ({ path, old: oldStr, new: newStr }, ctx) => {
    const abs = safe(ctx.cwd, path);
    if (!existsSync(abs)) {
      return `ERROR: file not found: ${path} → read the file first to get the exact content`;
    }
    const content = readFileSync(abs, "utf8");
    const count = content.split(oldStr).length - 1;
    if (count === 0) {
      return `ERROR: old string not found in ${path} → re-read the file first to get exact content`;
    }
    if (count > 1) {
      return `ERROR: old string matches ${count} locations in ${path} — add more surrounding context to make it unique`;
    }
    writeFileSync(abs, content.replace(oldStr, newStr), "utf8");
    return `OK: edited ${path}`;
  },
);
