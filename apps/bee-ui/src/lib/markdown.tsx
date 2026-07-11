import type { ReactNode } from "react";

// Tiny, dependency-free markdown for chat bubbles: **bold**, *italic*, `code`,
// [links](url), and bullet lists. Builds React nodes (never innerHTML) so it's XSS-safe.
function renderInline(text: string): ReactNode[] {
  const nodes: ReactNode[] = [];
  const re = /(\*\*([^*]+)\*\*|\*([^*]+)\*|`([^`]+)`|\[([^\]]+)\]\((https?:\/\/[^\s)]+)\))/g;
  let last = 0;
  let m: RegExpExecArray | null;
  let k = 0;
  while ((m = re.exec(text))) {
    if (m.index > last) nodes.push(text.slice(last, m.index));
    if (m[2] != null) nodes.push(<strong key={k++}>{m[2]}</strong>);
    else if (m[3] != null) nodes.push(<em key={k++}>{m[3]}</em>);
    else if (m[4] != null) nodes.push(<code key={k++} className="rounded bg-fg/[0.08] px-1 py-0.5 text-[0.9em]">{m[4]}</code>);
    else if (m[5] != null && m[6] != null)
      nodes.push(
        <a key={k++} href={m[6]} target="_blank" rel="noreferrer" className="text-accent underline underline-offset-2 break-all">
          {m[5]}
        </a>,
      );
    last = m.index + m[0].length;
  }
  if (last < text.length) nodes.push(text.slice(last));
  return nodes;
}

export function Markdown({ text }: { text: string }) {
  // strip a stray tool-call marker some models leak, so even older stored messages are clean
  const lines = text.replace(/\[e~\[/g, "").split("\n");
  const blocks: ReactNode[] = [];
  let list: string[] = [];
  let key = 0;
  const flush = () => {
    if (!list.length) return;
    const items = list;
    list = [];
    blocks.push(
      <ul key={`ul${key++}`} className="my-1 list-disc space-y-0.5 pl-5">
        {items.map((li, i) => (
          <li key={i}>{renderInline(li)}</li>
        ))}
      </ul>,
    );
  };
  for (const line of lines) {
    const bullet = line.match(/^\s*[-*]\s+(.*)/);
    if (bullet) {
      list.push(bullet[1]!);
      continue;
    }
    flush();
    if (line.trim() === "") continue; // blank line → paragraph spacing handles the gap
    blocks.push(<p key={`p${key++}`}>{renderInline(line)}</p>);
  }
  flush();
  return <div className="space-y-1.5">{blocks}</div>;
}
