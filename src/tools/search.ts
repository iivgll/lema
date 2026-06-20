import { readdirSync, readFileSync, existsSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { def, obj, safe } from "./types.js";

const GREP_CAP = 50;
const GLOB_CAP = 100;

/** Directories never worth walking — dependencies, build output, VCS. */
const IGNORE_DIRS = new Set(["node_modules", "dist", "build", ".git", ".lema"]);

/** Convert a glob pattern to a RegExp. Supports * ** ? */
function globToRegex(pattern: string): RegExp {
  const re = pattern
    .replace(/[.+^${}()|[\]\\]/g, "\\$&")
    .replace(/\*\*/g, "\x00")   // placeholder for **
    .replace(/\*/g, "[^/]*")
    .replace(/\x00/g, ".*")
    .replace(/\?/g, "[^/]");
  return new RegExp(`^${re}$`);
}

/** Recursively collect files under `dir`, relative to `root`. */
function walk(root: string, dir: string, out: string[]): void {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name.startsWith(".") || IGNORE_DIRS.has(entry.name)) continue;
    const abs = join(dir, entry.name);
    if (entry.isDirectory()) walk(root, abs, out);
    else out.push(relative(root, abs));
  }
}

export const grep = def(
  "grep",
  "Search for a regex pattern across files. Returns file:line:content matches, capped at 50. Use path to narrow the search.",
  obj(
    {
      pattern: { type: "string", description: "Regular expression to search for." },
      path: { type: "string", description: "File or directory to search in (default: entire working directory)." },
    },
    ["pattern"],
  ),
  async ({ pattern, path }, ctx) => {
    const root = path ? safe(ctx.cwd, path) : ctx.cwd;
    if (!existsSync(root)) {
      return `ERROR: path not found: ${path} → try list_dir to explore the directory structure`;
    }

    let re: RegExp;
    try {
      re = new RegExp(pattern);
    } catch {
      return `ERROR: invalid regex: ${pattern}`;
    }

    const files: string[] = [];
    if (statSync(root).isFile()) {
      files.push(path ?? ".");
    } else {
      walk(ctx.cwd, root, files);
    }

    const matches: string[] = [];
    for (const rel of files) {
      if (matches.length >= GREP_CAP) break;
      const abs = safe(ctx.cwd, rel);
      let text: string;
      try { text = readFileSync(abs, "utf8"); } catch { continue; }
      const lines = text.split("\n");
      for (let i = 0; i < lines.length && matches.length < GREP_CAP; i++) {
        if (re.test(lines[i])) matches.push(`${rel}:${i + 1}:${lines[i]}`);
      }
    }

    if (!matches.length) return `no matches for /${pattern}/ in ${path ?? "."}`;
    const suffix = matches.length >= GREP_CAP ? `\n...[capped at ${GREP_CAP}]` : "";
    return matches.join("\n") + suffix;
  },
);

export const glob = def(
  "glob",
  "Find files by name pattern. Supports * ** ?. Returns paths relative to working directory, capped at 100.",
  obj(
    { pattern: { type: "string", description: "Glob pattern, e.g. src/**/*.ts or **/*.json" } },
    ["pattern"],
  ),
  async ({ pattern }, ctx) => {
    const re = globToRegex(pattern);
    const files: string[] = [];
    walk(ctx.cwd, ctx.cwd, files);
    const matches = files.filter((f) => re.test(f)).slice(0, GLOB_CAP);
    if (!matches.length) return `no files match: ${pattern}`;
    const suffix = matches.length >= GLOB_CAP ? `\n...[capped at ${GLOB_CAP}]` : "";
    return matches.join("\n") + suffix;
  },
);

export const listDir = def(
  "list_dir",
  "List entries of a directory. Use glob or grep for searching; use this to look around one directory.",
  obj({ path: { type: "string", description: "Directory path relative to working directory; '.' for root." } }, ["path"]),
  async ({ path }, ctx) => {
    const abs = safe(ctx.cwd, path || ".");
    if (!existsSync(abs)) {
      return `ERROR: directory not found: ${path} → try list_dir with '.' to start from the root`;
    }
    return readdirSync(abs, { withFileTypes: true })
      .map((e) => (e.isDirectory() ? `${e.name}/` : e.name))
      .join("\n");
  },
);
