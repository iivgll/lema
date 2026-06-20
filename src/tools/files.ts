import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { dirname } from "node:path";
import { def, obj, safe } from "./types.js";

const READ_LIMIT_DEFAULT = 200;
/** Per-line cap: keeps a single huge line (minified JS/JSON) from flooding the context. */
const LINE_CHAR_CAP = 2000;

export const readFile = def(
  "read_file",
  "Read lines from a UTF-8 file. Use offset/limit to page through large files instead of reading the whole thing at once.",
  obj(
    {
      path: { type: "string", description: "Path relative to the working directory." },
      offset: { type: "number", description: "1-based line number to start reading from (default 1)." },
      limit: { type: "number", description: `Max lines to return (default ${READ_LIMIT_DEFAULT}).` },
    },
    ["path"],
  ),
  async ({ path, offset, limit }, ctx) => {
    const abs = safe(ctx.cwd, path);
    if (!existsSync(abs)) {
      return `ERROR: file not found: ${path} → try grep to search for the file name, or list_dir to explore`;
    }
    const lines = readFileSync(abs, "utf8").split("\n");
    const from = Math.max(1, Number(offset) || 1) - 1; // convert to 0-based
    const count = Number(limit) || READ_LIMIT_DEFAULT;
    const slice = lines
      .slice(from, from + count)
      .map((l) => (l.length > LINE_CHAR_CAP ? l.slice(0, LINE_CHAR_CAP) + "…[line truncated]" : l));
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
