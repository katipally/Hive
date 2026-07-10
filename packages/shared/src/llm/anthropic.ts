import type { ChatRequest, Message, StreamEvent, ThinkingLevel } from "./types.js";
import { parseSSE } from "./sse.js";

const THINK_BUDGET: Record<Exclude<ThinkingLevel, "off">, number> = {
  low: 2048,
  medium: 8192,
  high: 16384,
};

interface Block {
  type: string;
  text?: string;
  id?: string;
  name?: string;
  input?: unknown;
  tool_use_id?: string;
  content?: unknown;
}

// Convert our neutral Message[] into Anthropic's alternating user/assistant blocks.
// Consecutive toolResult messages merge into one user turn.
function toAnthropic(messages: Message[]): { role: "user" | "assistant"; content: Block[] }[] {
  const out: { role: "user" | "assistant"; content: Block[] }[] = [];
  for (const m of messages) {
    if (m.role === "system") continue;
    if (m.role === "toolResult") {
      const block: Block = { type: "tool_result", tool_use_id: m.toolCallId, content: m.content };
      const last = out[out.length - 1];
      if (last && last.role === "user" && last.content[0]?.type === "tool_result") {
        last.content.push(block);
      } else {
        out.push({ role: "user", content: [block] });
      }
      continue;
    }
    if (m.role === "assistant") {
      const content: Block[] = [];
      if (m.content) content.push({ type: "text", text: m.content });
      for (const c of m.toolCalls ?? [])
        content.push({ type: "tool_use", id: c.id, name: c.name, input: c.args });
      out.push({ role: "assistant", content: content.length ? content : [{ type: "text", text: "" }] });
      continue;
    }
    // user
    out.push({ role: "user", content: [{ type: "text", text: m.content }] });
  }
  return out;
}

export async function* anthropicStream(req: ChatRequest): AsyncGenerator<StreamEvent> {
  const think = req.thinkingLevel && req.thinkingLevel !== "off" ? req.thinkingLevel : null;
  const budget = think ? THINK_BUDGET[think] : 0;
  const maxTokens = req.maxTokens ?? (think ? budget + 4096 : 4096);

  const body: Record<string, unknown> = {
    model: req.model,
    max_tokens: maxTokens,
    stream: true,
    messages: toAnthropic(req.messages),
  };
  if (req.system) body["system"] = req.system;
  if (req.tools?.length)
    body["tools"] = req.tools.map((t) => ({
      name: t.name,
      description: t.description,
      input_schema: t.parameters,
    }));
  if (think) {
    body["thinking"] = { type: "enabled", budget_tokens: budget };
    body["temperature"] = 1;
  } else if (req.temperature !== undefined) {
    body["temperature"] = req.temperature;
  }

  const res = await fetch(`${req.baseUrl}/v1/messages`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-api-key": req.apiKey ?? "",
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify(body),
    signal: req.signal,
  });
  if (!res.ok) throw new Error(`anthropic ${res.status}: ${await res.text()}`);

  const toolAcc = new Map<number, { id: string; name: string; json: string }>();
  let usage: { inputTokens: number; outputTokens: number } | undefined;

  for await (const frame of parseSSE(res)) {
    if (!frame.data || frame.data === "[DONE]") continue;
    let ev: Record<string, unknown>;
    try {
      ev = JSON.parse(frame.data);
    } catch {
      continue;
    }
    const t = ev["type"];
    if (t === "content_block_start") {
      const idx = ev["index"] as number;
      const block = ev["content_block"] as Block;
      if (block?.type === "tool_use")
        toolAcc.set(idx, { id: block.id!, name: block.name!, json: "" });
    } else if (t === "content_block_delta") {
      const idx = ev["index"] as number;
      const delta = ev["delta"] as Record<string, unknown>;
      const dt = delta["type"];
      if (dt === "text_delta") yield { type: "text_delta", text: delta["text"] as string };
      else if (dt === "thinking_delta")
        yield { type: "thinking_delta", text: delta["thinking"] as string };
      else if (dt === "input_json_delta") {
        const acc = toolAcc.get(idx);
        if (acc) acc.json += delta["partial_json"] as string;
      }
    } else if (t === "content_block_stop") {
      const idx = ev["index"] as number;
      const acc = toolAcc.get(idx);
      if (acc) {
        let args: Record<string, unknown> = {};
        try {
          args = acc.json ? JSON.parse(acc.json) : {};
        } catch {
          /* leave empty */
        }
        yield { type: "tool_call", call: { id: acc.id, name: acc.name, args } };
        toolAcc.delete(idx);
      }
    } else if (t === "message_delta") {
      const u = (ev["usage"] as Record<string, number>) ?? {};
      usage = { inputTokens: u["input_tokens"] ?? 0, outputTokens: u["output_tokens"] ?? 0 };
    } else if (t === "message_stop") {
      yield { type: "done", usage };
    }
  }
}
