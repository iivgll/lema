import type { ModelProvider } from "../provider.js";

/** A function that compresses a transcript into a short summary. */
export type Summarizer = (transcript: string, instruction?: string) => Promise<string>;

const SUMMARY_SYSTEM = `You compress a coding agent's conversation so it can continue with far less context.
Write a SHORT summary (at most ~200 words) that preserves only what's needed to continue:
- the task/goal,
- what has been done so far (files created/edited, commands run and their outcome),
- key decisions and constraints,
- what still remains to do.
Output the summary only — no preamble, no markdown headers.`;

/**
 * Build a Summarizer backed by a model provider. Kept separate from the
 * ContextManager so the manager depends on a plain function, not on a provider
 * (dependency inversion) — the same summarizer powers auto-compaction and the
 * /compact command.
 */
export function makeSummarizer(
  provider: ModelProvider,
  model: string,
  maxTokens = 700,
  signal?: AbortSignal,
): Summarizer {
  return async (transcript, instruction) => {
    const keep = instruction ? `\n\nKeep especially: ${instruction}` : "";
    const { message } = await provider.chat(
      [
        { role: "system", content: SUMMARY_SYSTEM + keep },
        { role: "user", content: transcript },
      ],
      { model, maxTokens, signal },
    );
    return message.content ?? "";
  };
}
