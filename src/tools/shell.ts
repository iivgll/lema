import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { def, obj } from "./types.js";

const pexec = promisify(execFile);

export const bash = def(
  "bash",
  "Run a shell command for execution tasks: tests, builds, git, package managers. Not for reading or searching — use read_file, grep, glob for that.",
  obj({ command: { type: "string", description: "The shell command to execute." } }, ["command"]),
  async ({ command }, ctx) => {
    try {
      const { stdout, stderr } = await pexec("/bin/sh", ["-c", command], {
        cwd: ctx.cwd,
        timeout: 120_000,
        maxBuffer: 10 * 1024 * 1024,
      });
      const out = (stdout + (stderr ? `\n[stderr]\n${stderr}` : "")).trim();
      return out || "(no output)";
    } catch (err: any) {
      const out = `${err.stdout ?? ""}${err.stderr ?? ""}`.trim();
      return `EXIT ${err.code ?? "?"}: ${out || err.message}`;
    }
  },
);
