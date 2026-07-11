import type { ChatRequest, Message, StreamEvent } from "./types.js";
import { parseSSE } from "./sse.js";

function toOpenAI(system: string | undefined, messages: Message[]): Record<string, unknown>[] {
  const out: Record<string, unknown>[] = [];
  if (system) out.push({ role: "system", content: system });
  for (const m of messages) {
    if (m.role === "system") {
      out.push({ role: "system", content: m.content });
    } else if (m.role === "toolResult") {
      out.push({ role: "tool", tool_call_id: m.toolCallId, content: m.content });
    } else if (m.role === "assistant") {
      const msg: Record<string, unknown> = { role: "assistant", content: m.content || null };
      if (m.toolCalls?.length)
        msg["tool_calls"] = m.toolCalls.map((c) => ({
          id: c.id,
          type: "function",
          function: { name: c.name, arguments: JSON.stringify(c.args) },
        }));
      out.push(msg);
    } else {
      out.push({ role: "user", content: m.content });
    }
  }
  return out;
}

// chat lives at {base}/chat/completions; for ollama base is http://host:11434 so append /v1.
function chatUrl(baseUrl: string): string {
  const b = baseUrl.replace(/\/$/, "");
  if (b.endsWith("/v1")) return `${b}/chat/completions`;
  if (/:11434$|ollama\.com$/.test(b)) return `${b}/v1/chat/completions`;
  return `${b}/chat/completions`;
}

export async function* openaiStream(req: ChatRequest): AsyncGenerator<StreamEvent> {
  const body: Record<string, unknown> = {
    model: req.model,
    messages: toOpenAI(req.system, req.messages),
    stream: true,
    stream_options: { include_usage: true },
  };
  if (req.tools?.length)
    body["tools"] = req.tools.map((t) => ({
      type: "function",
      function: { name: t.name, description: t.description, parameters: t.parameters },
    }));
  if (req.thinkingLevel && req.thinkingLevel !== "off") body["reasoning_effort"] = req.thinkingLevel;
  if (req.temperature !== undefined) body["temperature"] = req.temperature;
  if (req.maxTokens !== undefined) body["max_tokens"] = req.maxTokens;

  const headers: Record<string, string> = { "content-type": "application/json" };
  if (req.apiKey) headers["authorization"] = `Bearer ${req.apiKey}`;

  const res = await fetch(chatUrl(req.baseUrl), {
    method: "POST",
    headers,
    body: JSON.stringify(body),
    signal: req.signal,
  });
  if (!res.ok) throw new Error(`openai-compat ${res.status}: ${await res.text()}`);

  const toolAcc = new Map<number, { id: string; name: string; args: string }>();
  let usage: { inputTokens: number; outputTokens: number } | undefined;

  for await (const frame of parseSSE(res)) {
    if (!frame.data || frame.data === "[DONE]") continue;
    let ev: Record<string, unknown>;
    try {
      ev = JSON.parse(frame.data);
    } catch {
      continue;
    }
    const choices = ev["choices"] as Array<Record<string, unknown>> | undefined;
    const u = ev["usage"] as Record<string, number> | undefined;
    if (u) usage = { inputTokens: u["prompt_tokens"] ?? 0, outputTokens: u["completion_tokens"] ?? 0 };
    const choice = choices?.[0];
    if (!choice) continue;
    const delta = choice["delta"] as Record<string, unknown> | undefined;
    if (delta?.["content"]) yield { type: "text_delta", text: delta["content"] as string };
    const reasoning = delta?.["reasoning_content"] ?? delta?.["reasoning"];
    if (typeof reasoning === "string" && reasoning) yield { type: "thinking_delta", text: reasoning };
    const tcs = delta?.["tool_calls"] as Array<Record<string, unknown>> | undefined;
    if (tcs)
      for (const tc of tcs) {
        const idx = (tc["index"] as number) ?? 0;
        let acc = toolAcc.get(idx);
        if (!acc) {
          acc = { id: (tc["id"] as string) ?? `call_${idx}`, name: "", args: "" };
          toolAcc.set(idx, acc);
        }
        if (tc["id"]) acc.id = tc["id"] as string;
        const fn = tc["function"] as Record<string, unknown> | undefined;
        if (fn?.["name"]) acc.name = fn["name"] as string;
        if (fn?.["arguments"]) acc.args += fn["arguments"] as string;
      }
    if (choice["finish_reason"]) {
      for (const acc of toolAcc.values()) {
        let args: Record<string, unknown> = {};
        try {
          args = acc.args ? JSON.parse(acc.args) : {};
        } catch {
          /* empty */
        }
        yield { type: "tool_call", call: { id: acc.id, name: acc.name, args } };
      }
      toolAcc.clear();
    }
  }
  yield { type: "done", usage };
}
