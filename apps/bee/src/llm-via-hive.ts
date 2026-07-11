import type { ModelRole } from "@hive/shared";
import type { Message, StreamEvent, StreamFn, ThinkingLevel, ToolSpec } from "@hive/shared/llm";

// Stream a completion through the hive LLM proxy. Bees never hold API keys;
// hive resolves role -> provider/model/key and streams SSE back.
export async function* chatViaHive(opts: {
  hiveHttpUrl: string;
  beeId: string;
  beeToken: string;
  role: ModelRole;
  system?: string;
  messages: Message[];
  tools?: ToolSpec[];
  thinkingLevel?: ThinkingLevel;
  signal?: AbortSignal;
}): AsyncGenerator<StreamEvent> {
  const res = await fetch(`${opts.hiveHttpUrl}/api/llm/chat`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-bee-id": opts.beeId, "x-bee-token": opts.beeToken },
    body: JSON.stringify({
      role: opts.role,
      system: opts.system,
      messages: opts.messages,
      tools: opts.tools,
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

// Adapt the hive proxy to the generic StreamFn the agent loop expects. hive
// resolves provider/model/key from the role, so baseUrl/apiKey/model on the
// request are ignored — only system/messages/tools/thinkingLevel matter.
export function hiveStreamFn(opts: { hiveHttpUrl: string; beeId: string; beeToken: string; role: ModelRole }): StreamFn {
  return (req) =>
    chatViaHive({
      hiveHttpUrl: opts.hiveHttpUrl,
      beeId: opts.beeId,
      beeToken: opts.beeToken,
      role: opts.role,
      system: req.system,
      messages: req.messages,
      tools: req.tools,
      thinkingLevel: req.thinkingLevel,
      signal: req.signal,
    });
}
