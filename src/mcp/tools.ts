import { runAgent, type AgentEvent } from "../agent/index.js";
import { makeSummarizer } from "../context/index.js";
import { EFFORT_SETTINGS, type EffortSetting } from "../effort.js";
import { toolText, toolError, type McpToolResult } from "./protocol.js";
import type { McpSession } from "./session.js";

// MCP tool schema type (minimal — only what Claude needs to call tools)
export interface McpTool {
  name: string;
  description: string;
  inputSchema: {
    type: "object";
    properties: Record<string, { type: string; description: string }>;
    required?: string[];
  };
  run(args: Record<string, unknown>, session: McpSession): Promise<McpToolResult>;
}

// ─── Tool definitions ────────────────────────────────────────────────────────

const lema_run: McpTool = {
  name: "lema_run",
  description:
    "Run a task in lema's agent loop against the local LLM. Returns the final answer, step count, token stats, and a full log of every agent event (tool calls, model output, verification results).",
  inputSchema: {
    type: "object",
    properties: {
      task: { type: "string", description: "The task or prompt to run." },
      effort: {
        type: "string",
        description: "Effort level: auto, low, medium, high, ultra. Defaults to session effort.",
      },
    },
    required: ["task"],
  },
  async run(args, session) {
    if (session.running) return toolError("A task is already running. Call lema_abort first.");

    const task = String(args.task ?? "");
    const effortArg = String(args.effort ?? "").trim().toLowerCase();
    const effort = EFFORT_SETTINGS.includes(effortArg as EffortSetting)
      ? (effortArg as EffortSetting)
      : session.effort;

    const ac = new AbortController();
    session.running = ac;

    const events: AgentEvent[] = [];
    try {
      const result = await runAgent(task, {
        maxSteps: session.cfg.maxSteps,
        maxTokens: session.cfg.maxTokens,
        effort,
        provider: session.provider,
        cwd: session.cwd,
        memory: session.memory,
        skillsMeta: session.skills.metadataBlock() ?? undefined,
        context: session.context,
        tools: session.tools,
        signal: ac.signal,
        onEvent: (e) => {
          events.push(e);
          if (e.type === "stats" || e.type === "done") session.lastStats = e.stats ?? session.lastStats;
        },
      });

      const log = events.map(formatEvent).filter(Boolean).join("\n");
      const out = [
        `answer: ${result.answer}`,
        `steps: ${result.steps}`,
        session.lastStats
          ? `stats: ↑${session.lastStats.prompt} ↓${session.lastStats.completion} · ${session.lastStats.tokps.toFixed(1)} tok/s · ctx ${Math.round(session.lastStats.ctxPct * 100)}%`
          : "",
        "",
        "─── events ───",
        log,
      ]
        .filter(Boolean)
        .join("\n");

      return toolText(out);
    } catch (e) {
      return toolError((e as Error).message);
    } finally {
      session.running = null;
    }
  },
};

const lema_abort: McpTool = {
  name: "lema_abort",
  description: "Abort the currently running lema_run task.",
  inputSchema: { type: "object", properties: {} },
  async run(_args, session) {
    if (!session.running) return toolText("No task is running.");
    session.running.abort();
    session.running = null;
    return toolText("Aborted.");
  },
};

const lema_stats: McpTool = {
  name: "lema_stats",
  description:
    "Get the current session state: active model, effort level, context pressure, and token stats from the last run.",
  inputSchema: { type: "object", properties: {} },
  async run(_args, session) {
    const lines = [
      `model:   ${session.model}`,
      `effort:  ${session.effort}`,
      `cwd:     ${session.cwd}`,
      `context: ${Math.round(session.context.pressure() * 100)}%  (${session.context.tokens()} tokens estimated)`,
      `running: ${session.running ? "yes" : "no"}`,
    ];
    if (session.lastStats) {
      const s = session.lastStats;
      lines.push(
        "",
        "last run:",
        `  prompt:     ${s.prompt} tok`,
        `  completion: ${s.completion} tok`,
        `  speed:      ${s.tokps.toFixed(1)} tok/s`,
        `  wall time:  ${s.seconds.toFixed(1)}s`,
      );
    }
    return toolText(lines.join("\n"));
  },
};

const lema_context: McpTool = {
  name: "lema_context",
  description:
    "Return the current conversation transcript as JSON. Each message has role, content, and optional tool_calls / tool_call_id fields.",
  inputSchema: { type: "object", properties: {} },
  async run(_args, session) {
    const messages = session.context.render();
    return toolText(JSON.stringify(messages, null, 2));
  },
};

const lema_models: McpTool = {
  name: "lema_models",
  description: "List the models currently loaded in LM Studio (or the configured OpenAI-compatible server).",
  inputSchema: { type: "object", properties: {} },
  async run(_args, session) {
    try {
      const models = (await session.provider.listModels()).filter((m) => !/embed/i.test(m));
      if (!models.length) return toolText("No chat models found on the server.");
      return toolText(models.map((m, i) => `${i + 1}. ${m}${m === session.model ? "  ← active" : ""}`).join("\n"));
    } catch (e) {
      return toolError(`Failed to reach server: ${(e as Error).message}`);
    }
  },
};

const lema_set_model: McpTool = {
  name: "lema_set_model",
  description: "Switch the active model. Use lema_models to list available models.",
  inputSchema: {
    type: "object",
    properties: { model: { type: "string", description: "Model id to switch to." } },
    required: ["model"],
  },
  async run(args, session) {
    const model = String(args.model ?? "").trim();
    if (!model) return toolError("model is required.");
    session.cfg.model = model;
    session.model = model;
    return toolText(`Model set to: ${model}`);
  },
};

const lema_set_effort: McpTool = {
  name: "lema_set_effort",
  description: `Set the reasoning effort for subsequent lema_run calls. Options: ${EFFORT_SETTINGS.join(", ")}.`,
  inputSchema: {
    type: "object",
    properties: { effort: { type: "string", description: "Effort level." } },
    required: ["effort"],
  },
  async run(args, session) {
    const want = String(args.effort ?? "").trim().toLowerCase();
    if (!EFFORT_SETTINGS.includes(want as EffortSetting))
      return toolError(`Unknown effort: ${want}. Use: ${EFFORT_SETTINGS.join(", ")}`);
    session.effort = want as EffortSetting;
    return toolText(`Effort set to: ${want}`);
  },
};

const lema_compact: McpTool = {
  name: "lema_compact",
  description:
    "Summarize and compress the conversation context to free up space in the model's window. Optionally pass an instruction about what to preserve.",
  inputSchema: {
    type: "object",
    properties: {
      instruction: {
        type: "string",
        description: "Optional hint about what to preserve in the summary.",
      },
    },
  },
  async run(args, session) {
    const instruction = args.instruction ? String(args.instruction) : undefined;
    const before = session.context.tokens();
    const model = await session.provider.resolveModel();
    const ok = await session.context
      .compact(makeSummarizer(session.provider, model), instruction)
      .catch(() => false);
    if (!ok) return toolText("Nothing to compact yet — conversation is too short.");
    const after = session.context.tokens();
    return toolText(`Compacted: ~${before} → ~${after} tokens  (saved ~${before - after})`);
  },
};

const lema_memory_search: McpTool = {
  name: "lema_memory_search",
  description:
    "Search lema's learned memory store (lessons and knowledge it has accumulated) by semantic similarity to a query.",
  inputSchema: {
    type: "object",
    properties: { query: { type: "string", description: "Search query." } },
    required: ["query"],
  },
  async run(args, session) {
    const query = String(args.query ?? "").trim();
    if (!query) return toolError("query is required.");
    const results = await session.memory.search(query, 5).catch(() => [] as import("../memory.js").Memory[]);
    if (!results.length) return toolText("No matching memories found.");
    const text = results
      .map((m, i) => [`${i + 1}. [${m.kind}] ${m.name}`, `   ${m.description}`, `   ${m.body.slice(0, 200)}`].join("\n"))
      .join("\n\n");
    return toolText(text);
  },
};

// ─── Registry ────────────────────────────────────────────────────────────────

export const ALL_MCP_TOOLS: McpTool[] = [
  lema_run,
  lema_abort,
  lema_stats,
  lema_context,
  lema_models,
  lema_set_model,
  lema_set_effort,
  lema_compact,
  lema_memory_search,
];

export const MCP_TOOL_MAP = new Map<string, McpTool>(ALL_MCP_TOOLS.map((t) => [t.name, t]));

// ─── Resources ───────────────────────────────────────────────────────────────

export const MCP_RESOURCES = [
  {
    uri: "lema://session/context",
    name: "Conversation context",
    description: "The full conversation transcript (all ChatMessage objects) as JSON.",
    mimeType: "application/json",
  },
  {
    uri: "lema://session/memory",
    name: "Learned memory",
    description: "All memories lema has accumulated (lessons, knowledge, procedures) as JSON.",
    mimeType: "application/json",
  },
];

export async function readResource(uri: string, session: McpSession): Promise<string> {
  if (uri === "lema://session/context") {
    return JSON.stringify(session.context.render(), null, 2);
  }
  if (uri === "lema://session/memory") {
    return JSON.stringify(session.memory.all(), null, 2);
  }
  throw new Error(`Unknown resource: ${uri}`);
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function formatEvent(e: AgentEvent): string {
  switch (e.type) {
    case "step":    return `[${e.label ?? "step"}] ${e.text ?? ""}`;
    case "tool":    return `  ⏺ ${e.tool}(${e.detail ?? ""})`;
    case "tool-result": return `  ⎿ ${e.text ?? ""}`;
    case "assistant": return e.text?.trim() ? `⏺ ${e.text.trim()}` : "";
    case "thinking": return "";
    case "thinking-stop": return "";
    case "stats":   return e.stats ? `[stats] ↑${e.stats.prompt} ↓${e.stats.completion} · ${e.stats.tokps.toFixed(1)} tok/s · ctx ${Math.round(e.stats.ctxPct * 100)}%` : "";
    case "done":    return "";
    default:        return "";
  }
}
