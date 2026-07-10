import type { ModelRole } from "@hive/shared";
import type { Message, StreamEvent, ThinkingLevel } from "@hive/shared/llm";

// Stream a completion through the hive LLM proxy. Bees never hold API keys;
// hive resolves role -> provider/model/key and streams SSE back.
export async function* chatViaHive(opts: {
  hiveHttpUrl: string;
  beeToken: string;
  role: ModelRole;
  system?: string;
  messages: Message[];
  thinkingLevel?: ThinkingLevel;
  signal?: AbortSignal;
}): AsyncGenerator<StreamEvent> {
  const res = await fetch(`${opts.hiveHttpUrl}/api/llm/chat`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-bee-token": opts.beeToken },
    body: JSON.stringify({
      role: opts.role,
      system: opts.system,
      messages: opts.messages,
      thinkingLevel: opts.thinkingLevel,
    }),
    signal: opts.signal,
  });
  if (!res.ok || !res.body) throw new Error(`hive llm proxy ${res.status}`);

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buf = "";
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });
    let nl: number;
    while ((nl = buf.indexOf("\n\n")) !== -1) {
      const frame = buf.slice(0, nl);
      buf = buf.slice(nl + 2);
      const line = frame.split("\n").find((l) => l.startsWith("data:"));
      if (!line) continue;
      const data = line.slice(5).trim();
      if (!data) continue;
      try {
        yield JSON.parse(data) as StreamEvent;
      } catch {
        /* ignore */
      }
    }
  }
}
