#!/usr/bin/env node
import { listenStdin, respond, respondError, toolError } from "./protocol.js";
import { createSession } from "./session.js";
import { ALL_MCP_TOOLS, MCP_TOOL_MAP, MCP_RESOURCES, readResource } from "./tools.js";
import type { JsonRpcRequest } from "./protocol.js";

const SERVER_INFO = { name: "lema-mcp", version: "0.0.1" };
const PROTOCOL_VERSION = "2024-11-05";

async function main(): Promise<void> {
  const session = await createSession();

  // Log to stderr so it doesn't pollute the JSON-RPC stdout channel
  process.stderr.write(`[lema-mcp] ready · model=${session.model} · cwd=${session.cwd}\n`);

  listenStdin(async (msg) => {
    const req = msg as JsonRpcRequest;

    // Notifications have no id — ignore them silently
    if (req.id === undefined) return;

    const { id, method, params } = req;
    const p = (params ?? {}) as Record<string, unknown>;

    try {
      switch (method) {
        case "initialize":
          respond(id, {
            protocolVersion: PROTOCOL_VERSION,
            serverInfo: SERVER_INFO,
            capabilities: { tools: {}, resources: {} },
          });
          break;

        case "tools/list":
          respond(id, {
            tools: ALL_MCP_TOOLS.map((t) => ({
              name: t.name,
              description: t.description,
              inputSchema: t.inputSchema,
            })),
          });
          break;

        case "tools/call": {
          const name = String(p.name ?? "");
          const args = (p.arguments ?? {}) as Record<string, unknown>;
          const tool = MCP_TOOL_MAP.get(name);
          if (!tool) {
            respond(id, toolError(`Unknown tool: ${name}`));
            break;
          }
          const result = await tool.run(args, session);
          respond(id, result);
          break;
        }

        case "resources/list":
          respond(id, { resources: MCP_RESOURCES });
          break;

        case "resources/read": {
          const uri = String(p.uri ?? "");
          const text = await readResource(uri, session);
          respond(id, {
            contents: [{ uri, mimeType: "application/json", text }],
          });
          break;
        }

        default:
          respondError(id, -32601, `Method not found: ${method}`);
      }
    } catch (e) {
      respondError(id, -32000, (e as Error).message);
    }
  });
}

main().catch((e) => {
  process.stderr.write(`[lema-mcp] fatal: ${(e as Error).message}\n`);
  process.exit(1);
});
