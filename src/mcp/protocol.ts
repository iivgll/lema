import { createInterface } from "node:readline";

// JSON-RPC 2.0 types (MCP uses this as its wire format)

export interface JsonRpcRequest {
  jsonrpc: "2.0";
  id: string | number | null;
  method: string;
  params?: unknown;
}

export interface JsonRpcNotification {
  jsonrpc: "2.0";
  method: string;
  params?: unknown;
}

export interface JsonRpcResponse {
  jsonrpc: "2.0";
  id: string | number | null;
  result?: unknown;
  error?: { code: number; message: string; data?: unknown };
}

export type McpToolContent = { type: "text"; text: string };

export interface McpToolResult {
  content: McpToolContent[];
  isError?: boolean;
}

export function respond(id: string | number | null, result: unknown): void {
  const msg: JsonRpcResponse = { jsonrpc: "2.0", id, result };
  process.stdout.write(JSON.stringify(msg) + "\n");
}

export function respondError(id: string | number | null, code: number, message: string): void {
  const msg: JsonRpcResponse = { jsonrpc: "2.0", id, error: { code, message } };
  process.stdout.write(JSON.stringify(msg) + "\n");
}

export function toolText(text: string): McpToolResult {
  return { content: [{ type: "text", text }] };
}

export function toolError(message: string): McpToolResult {
  return { content: [{ type: "text", text: message }], isError: true };
}

/** Read newline-delimited JSON-RPC messages from stdin. Calls handler for each. */
export function listenStdin(
  handler: (msg: JsonRpcRequest | JsonRpcNotification) => void,
): void {
  const rl = createInterface({ input: process.stdin, terminal: false });
  rl.on("line", (line) => {
    const trimmed = line.trim();
    if (!trimmed) return;
    try {
      handler(JSON.parse(trimmed) as JsonRpcRequest);
    } catch {
      respondError(null, -32700, "Parse error");
    }
  });
}
