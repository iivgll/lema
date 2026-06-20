import * as ui from "../ui.js";

/**
 * Minimal Markdown → ANSI renderer for assistant output. Handles the subset
 * local models actually emit: headers, bold/italic, inline code, fenced code,
 * and bullet lists. Intentionally small — not a full CommonMark parser.
 */
export function renderMarkdown(md: string): string {
  const out: string[] = [];
  let inFence = false;
  let fenceLang = "";

  for (const raw of md.split("\n")) {
    // Fenced code block: ``` or ```language
    const fenceMatch = raw.match(/^\s*```(\w*)/);
    if (fenceMatch) {
      if (!inFence) {
        inFence = true;
        fenceLang = fenceMatch[1];
        out.push(ui.dim(raw));
      } else {
        inFence = false;
        fenceLang = "";
        out.push(ui.dim(raw));
      }
      continue;
    }
    if (inFence) {
      out.push(ui.dim("  " + raw));
      continue;
    }
    out.push(renderInline(raw, fenceLang));
  }

  return out.join("\n");
}

function renderInline(line: string, fenceLang: string): string {
  let l = line;

  // Headers: "# Title" (H1), "## Title" (H2), etc.
  // H1 should be bold and cyan, H2-H6 just bold
  const hMatch = line.match(/^(#{1,6})\s+(.*)$/);
  if (hMatch) {
    const level = hMatch[1].length;
    const title = hMatch[2];
    if (level === 1) {
      return ui.bold(ui.cyan(title));
    }
    return ui.bold(title);
  }

  // Bullet markers: "- " / "* " -> "• "
  l = l.replace(/^(\s*)[-*]\s+/, (_m, s) => s + ui.magenta("• "));

  // Numbered lists: "1. ", "2. ", etc.
  l = l.replace(/^(\s*)(\d+)\.\s+/, (_m, s, n) => s + ui.magenta(n + ". "));

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
