import { loadConfig, type LemaConfig } from "../config.js";
import { Provider } from "../provider.js";
import type { ModelProvider } from "../provider.js";
import { MemoryStore } from "../memory.js";
import { SkillLibrary } from "../skills/index.js";
import { ContextManager } from "../context/index.js";
import { getTools } from "../tools/index.js";
import { loadRulesPreamble } from "../rules/index.js";
import type { Tool } from "../tools/index.js";
import type { AgentStats } from "../agent/index.js";
import type { EffortSetting } from "../effort.js";

export interface McpSession {
  cfg: LemaConfig;
  cwd: string;
  provider: ModelProvider;
  context: ContextManager;
  memory: MemoryStore;
  skills: SkillLibrary;
  tools: Tool[];
  model: string;
  effort: EffortSetting;
  lastStats: AgentStats | null;
  /** AbortController for the currently running lema_run, or null when idle. */
  running: AbortController | null;
}

export async function createSession(): Promise<McpSession> {
  const cwd = process.env.LEMA_CWD ?? process.cwd();
  const cfg = loadConfig(cwd);
  const provider = new Provider(cfg);
  const model = await provider.resolveModel();
  const loadedRules = loadRulesPreamble(cwd, cfg.rules);
  const context = new ContextManager({ budget: cfg.context, rules: loadedRules?.preamble });
  const memory = new MemoryStore(cfg, provider, cwd);
  const skills = new SkillLibrary(cwd);
  const tools = getTools(cfg);

  return {
    cfg,
    cwd,
    provider,
    context,
    memory,
    skills,
    tools,
    model,
    effort: cfg.effort,
    lastStats: null,
    running: null,
  };
}
