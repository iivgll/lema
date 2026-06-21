import type { ToolCall } from "../provider.js";

/**
 * Recover tool calls that a model emitted as plain text instead of in the
 * structured `tool_calls` field. Small local models (Qwen/Hermes templates on
 * LM Studio) often do this when the server fails to parse their tool syntax.
 *
 * Handles the two common shapes:
 *   A) <tool_call>{"name":"read_file","arguments":{"path":"x"}}</tool_call>
 *   B) <function=read_file><parameter=path>x</parameter></function>
 *
 * Returns [] when nothing parseable is found, so callers can treat the content
 * as a normal final answer.
 */
/**
 * Remove tool-call markup from a final answer. When the model "calls a tool" in
 * its tool-less finishing turn, the raw <tool_call>/<function=…> text would
 * otherwise leak into the answer shown to the user.
 */
export function stripToolMarkup(content: string): string {
  return content
    .replace(/<tool_call>[\s\S]*?<\/tool_call>/g, "")
    .replace(/<function=[\s\S]*?<\/function>/g, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export function parseTextToolCalls(content: string): ToolCall[] {
  const calls: ToolCall[] = [];

  // Format A: JSON inside <tool_call> … </tool_call>.
  for (const block of content.match(/<tool_call>([\s\S]*?)<\/tool_call>/g) ?? []) {
    const inner = block.replace(/<\/?tool_call>/g, "").trim();
    const fromJson = tryJson(inner);
    if (fromJson) { calls.push(fromJson); continue; }
    const fromXml = tryXml(inner);
    if (fromXml) calls.push(fromXml);
  }

  // Format B: bare <function=…>…</function> blocks (no JSON wrapper).
  if (!calls.length) {
    for (const block of content.match(/<function=[\s\S]*?<\/function>/g) ?? []) {
      const fromXml = tryXml(block);
      if (fromXml) calls.push(fromXml);
    }
  }

  return calls.map((c, i) => ({ ...c, id: c.id || `text-${i}` }));
}

/** Parse a Hermes-style JSON call: {"name": "...", "arguments": {...}}. */
function tryJson(text: string): ToolCall | null {
  try {
    const obj = JSON.parse(text);
    if (!obj || typeof obj.name !== "string") return null;
    const args = obj.arguments ?? obj.parameters ?? {};
    return {
      id: "",
      type: "function",
      function: { name: obj.name, arguments: typeof args === "string" ? args : JSON.stringify(args) },
    };
  } catch {
    return null;
  }
}

/** Parse the XML form: <function=NAME><parameter=KEY>VALUE</parameter>…</function>. */
function tryXml(block: string): ToolCall | null {
  const name = block.match(/<function=([^>\s]+)/)?.[1];
  if (!name) return null;
  const args: Record<string, string> = {};
  const paramRe = /<parameter=([^>]+)>([\s\S]*?)<\/parameter>/g;
  let m: RegExpExecArray | null;
  while ((m = paramRe.exec(block)) !== null) {
    args[m[1].trim()] = m[2].trim();
  }
  return { id: "", type: "function", function: { name, arguments: JSON.stringify(args) } };
}
