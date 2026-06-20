export type { Tool, ToolContext } from "./types.js";
export { def, obj, safe } from "./types.js";
export { readFile, writeFile, editFile } from "./files.js";
export { grep, glob, listDir } from "./search.js";
export { bash } from "./shell.js";

import { readFile, writeFile, editFile } from "./files.js";
import { grep, glob, listDir } from "./search.js";
import { bash } from "./shell.js";
import type { Tool } from "./types.js";

/** All 7 tools exposed to the model. Keep within 7±2 per the SLM budget rule. */
export const ALL_TOOLS: Tool[] = [readFile, writeFile, editFile, grep, glob, listDir, bash];

export function toolMap(tools: Tool[] = ALL_TOOLS): Map<string, Tool> {
  return new Map(tools.map((t) => [t.schema.function.name, t]));
}
