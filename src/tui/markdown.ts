import * as ui from "../ui.js";

/**
 * Minimal Markdown → ANSI renderer for assistant output. Handles the subset
 * local models actually emit: headers, bold/italic, inline code, fenced code,
 * and bullet lists. Intentionally small — not a full CommonMark parser.
 */
export function renderMarkdown(md: string): string {
  const out: string[] = [];
  let inFence = false;

  for (const raw of md.split("\n")) {
    const fence = raw.match(/^\s*```/);
    if (fence) {
      inFence = !inFence;
      out.push(ui.dim(raw));
      continue;
    }
    if (inFence) {
      out.push(ui.dim("  " + raw));
      continue;
    }
    out.push(renderInline(raw));
  }

  return out.join("\n");
}

function renderInline(line: string): string {
  // Headers: "## Title" -> bold title.
  const h = line.match(/^(#{1,6})\s+(.*)$/);
  if (h) return ui.bold(h[2]);

  let l = line;
  // Bullet markers: "- " / "* " -> "• ".
  l = l.replace(/^(\s*)[-*]\s+/, (_m, s) => s + ui.magenta("• "));
  // Inline code `code`.
  l = l.replace(/`([^`]+)`/g, (_m, c) => ui.cyan(c));
  // Bold **text** / __text__.
  l = l.replace(/\*\*([^*]+)\*\*/g, (_m, c) => ui.bold(c));
  l = l.replace(/__([^_]+)__/g, (_m, c) => ui.bold(c));
  // Italic *text* / _text_ (after bold so it doesn't eat ** markers).
  l = l.replace(/(^|[^*])\*([^*\s][^*]*)\*/g, (_m, p, c) => p + ui.italic(c));
  l = l.replace(/(^|[^_])_([^_\s][^_]*)_/g, (_m, p, c) => p + ui.italic(c));

  return l;
}
