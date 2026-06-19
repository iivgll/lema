import { createInterface, type Interface } from "node:readline";
import { stdin, stdout } from "node:process";
import type { LemaConfig } from "./config.js";
import { Provider } from "./provider.js";
import { SkillStore } from "./skills.js";
import { runAgent, consoleRenderer } from "./agent.js";
import * as ui from "./ui.js";

interface Session {
  cfg: LemaConfig;
  provider: Provider;
  skills: SkillStore;
}

/** A slash command. Adding one must not require touching the REPL loop (open/closed). */
interface SlashCommand {
  name: string;
  aliases?: string[];
  desc: string;
  /** Return true to end the session. */
  run(session: Session, arg: string): Promise<boolean | void> | boolean | void;
}

const COMMANDS: SlashCommand[] = [
  { name: "help", aliases: ["?"], desc: "show available commands", run: () => printMenu() },
  {
    name: "models",
    desc: "list models on the server",
    run: async (s) => {
      const models = await s.provider.listModels();
      models.forEach((m) => ui.log("  " + m));
    },
  },
  {
    name: "skills",
    desc: "list stored skills",
    run: (s) => {
      const all = s.skills.all();
      if (!all.length) return ui.warn("no skills yet — they appear as lema solves verified tasks");
      all.forEach((k) => ui.log(`  ${ui.bold(k.name)} ${ui.dim(`[${k.kind}] ${k.wins}/${k.uses}`)}`));
    },
  },
  {
    name: "ping",
    desc: "check the server is reachable",
    run: async (s) => {
      const models = await s.provider.listModels();
      ui.ok(`server up at ${s.cfg.baseUrl} — ${models.length} model(s)`);
    },
  },
  { name: "cwd", desc: "print the working directory", run: () => ui.log("  " + process.cwd()) },
  {
    name: "clear",
    desc: "clear the screen",
    run: () => {
      stdout.write("\x1b[2J\x1b[H");
    },
  },
  { name: "exit", aliases: ["quit", "q"], desc: "quit lema", run: () => true },
];

const COMMAND_INDEX = new Map<string, SlashCommand>(
  COMMANDS.flatMap((c) => [c.name, ...(c.aliases ?? [])].map((n) => [n, c] as const)),
);

function printMenu(): void {
  ui.log(ui.dim("  commands:"));
  for (const c of COMMANDS) {
    ui.log(`    ${ui.cyan("/" + c.name).padEnd(20)} ${ui.dim(c.desc)}`);
  }
}

/** TAB completion for slash commands. */
function completer(line: string): [string[], string] {
  if (!line.startsWith("/")) return [[], line];
  const all = COMMANDS.map((c) => "/" + c.name);
  const hits = all.filter((c) => c.startsWith(line));
  return [hits.length ? hits : all, line];
}

function banner(model: string): void {
  ui.log();
  ui.log("  " + ui.bold("lema") + ui.dim("  · local self-improving agent"));
  ui.log(ui.dim(`  model: ${model}    cwd: ${process.cwd()}`));
  ui.log(ui.dim("  type a task, or ") + ui.cyan("/") + ui.dim(" for commands (TAB to autocomplete)."));
  ui.log();
}

async function dispatch(session: Session, raw: string): Promise<boolean> {
  const [name, ...rest] = raw.split(/\s+/);
  const cmd = COMMAND_INDEX.get(name.toLowerCase());
  if (!cmd) {
    ui.warn(`unknown command: /${name} — type /help`);
    return false;
  }
  return (await cmd.run(session, rest.join(" "))) === true;
}

async function runTask(session: Session, task: string): Promise<void> {
  ui.log();
  await runAgent(task, {
    cfg: session.cfg,
    provider: session.provider,
    cwd: process.cwd(),
    skills: session.skills,
    onEvent: consoleRenderer,
  });
  ui.log();
}

/** Process one input line. Returns true when the session should end. */
async function handle(session: Session, raw: string): Promise<boolean> {
  const input = raw.trim();
  if (!input) return false;
  try {
    if (input === "/") printMenu();
    else if (input.startsWith("/")) return await dispatch(session, input.slice(1));
    else await runTask(session, input);
  } catch (e) {
    ui.err((e as Error).message);
  }
  return false;
}

async function readAll(stream: NodeJS.ReadableStream): Promise<string> {
  let data = "";
  for await (const chunk of stream) data += chunk;
  return data;
}

/** Non-TTY (piped/scripted) input: read it all, run line by line, no races. */
async function runBatch(session: Session): Promise<void> {
  const text = await readAll(stdin);
  for (const line of text.split(/\r?\n/)) {
    if (await handle(session, line)) break;
  }
}

/** Start the interactive session. Bare `lema` lands here. */
export async function startRepl(cfg: LemaConfig, provider: Provider): Promise<void> {
  const session: Session = { cfg, provider, skills: new SkillStore(cfg, provider) };
  const model = await provider.resolveModel().catch(() => "(no model loaded)");
  banner(model);

  if (!stdin.isTTY) {
    await runBatch(session);
    ui.log(ui.dim("bye"));
    return;
  }

  const rl: Interface = createInterface({
    input: stdin,
    output: stdout,
    completer,
    prompt: ui.cyan("lema ▸ "),
  });
  rl.on("SIGINT", () => rl.close());

  // Queue lines from the 'line' event and drain them one at a time. Using the
  // event (not `for await`) is what keeps piped/pasted input from being dropped.
  await new Promise<void>((resolve) => {
    const queue: string[] = [];
    let processing = false;
    let closed = false;
    let done = false;

    const finish = () => {
      if (done) return;
      done = true;
      rl.close();
      resolve();
    };

    const pump = async () => {
      if (processing) return;
      processing = true;
      while (queue.length) {
        if (await handle(session, queue.shift()!)) return finish();
        if (!done && !closed) rl.prompt();
      }
      processing = false;
      if (closed) finish();
    };

    rl.on("line", (line) => {
      queue.push(line);
      void pump();
    });
    rl.on("close", () => {
      closed = true;
      if (!processing && queue.length === 0) finish();
    });

    rl.prompt();
  });

  ui.log(ui.dim("bye"));
}
