// Per-channel outgoing formatting. Web renders full markdown (bee-ui/lib/markdown.tsx);
// Telegram and Discord don't, and both silently drop messages over their length limit —
// so replies must be converted to channel-appropriate text AND chunked.

export const TELEGRAM_LIMIT = 4096;
export const DISCORD_LIMIT = 2000;

// Split into pieces each <= max chars, breaking at a paragraph, then a line, then a word,
// then (last resort) a hard cut — so a long reply is delivered fully instead of truncated.
export function splitMessage(text: string, max: number): string[] {
  if (text.length <= max) return [text];
  const parts: string[] = [];
  let rest = text;
  while (rest.length > max) {
    let cut = rest.lastIndexOf("\n\n", max);
    if (cut < max * 0.5) cut = rest.lastIndexOf("\n", max);
    if (cut < max * 0.5) cut = rest.lastIndexOf(" ", max);
    if (cut <= 0) cut = max; // no good break point — hard cut
    parts.push(rest.slice(0, cut).trimEnd());
    rest = rest.slice(cut).trimStart();
  }
  if (rest) parts.push(rest);
  return parts;
}

// Telegram: sent with no parse_mode, so strip markdown to clean plain text — no raw `**`
// leaking through, and no MarkdownV2 escaping pitfalls.
export function toTelegram(md: string): string {
  return md
    .replace(/```[\s\S]*?```/g, (m) => m.replace(/```/g, "").trim()) // code fence → contents
    .replace(/`([^`]+)`/g, "$1")
    .replace(/\*\*([^*]+)\*\*/g, "$1")
    .replace(/__([^_]+)__/g, "$1")
    .replace(/\*([^*]+)\*/g, "$1")
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, "$1 ($2)")
    .replace(/^#{1,6}\s+/gm, "")
    .replace(/^\s*[-*]\s+/gm, "• ");
}

// Discord renders **bold**/*italic*/`code`/bullets natively — only markdown LINKS aren't
// rendered, so expand `[text](url)` to `text (url)`; leave everything else.
export function toDiscord(md: string): string {
  return md.replace(/\[([^\]]+)\]\(([^)]+)\)/g, "$1 ($2)");
}
