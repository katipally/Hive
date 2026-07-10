import type { Message, ToolSpec } from "../llm/types.js";
import type { AgentEvent, AgentTool, LoopConfig } from "./types.js";

// Minimal streaming tool-calling loop. Distilled from openclaw's agent-core:
// while the assistant emits tool calls, run them (sequentially), append results, repeat.
export async function* runAgentLoop(
  history: Message[],
  cfg: LoopConfig,
): AsyncGenerator<AgentEvent> {
  const tools = cfg.tools ?? [];
  const toolSpecs: ToolSpec[] = tools.map((t) => t.spec);
  const byName = new Map<string, AgentTool>(tools.map((t) => [t.spec.name, t]));
  const maxTurns = cfg.maxTurns ?? 8;
  const messages = [...history];

  for (let turn = 0; turn < maxTurns; turn++) {
    yield { type: "turn_start" };

    const ctx = cfg.transformContext ? cfg.transformContext(messages) : messages;
    let text = "";
    const pendingCalls: { id: string; name: string; args: Record<string, unknown> }[] = [];
    let usage;

    for await (const ev of cfg.streamFn({
      baseUrl: cfg.baseUrl,
      apiKey: cfg.apiKey,
      model: cfg.model,
      system: cfg.system,
      messages: ctx,
      tools: toolSpecs.length ? toolSpecs : undefined,
      thinkingLevel: cfg.thinkingLevel,
      signal: cfg.signal,
    })) {
      if (ev.type === "text_delta") {
        text += ev.text;
        yield { type: "text_delta", text: ev.text };
      } else if (ev.type === "thinking_delta") {
        yield { type: "thinking_delta", text: ev.text };
      } else if (ev.type === "tool_call") {
        pendingCalls.push(ev.call);
      } else if (ev.type === "done") {
        usage = ev.usage;
      }
    }

    if (pendingCalls.length === 0) {
      yield { type: "turn_end", text, usage };
      return;
    }

    // record the assistant turn (text + the calls it requested)
    messages.push({ role: "assistant", content: text, toolCalls: pendingCalls });

    for (const call of pendingCalls) {
      yield { type: "tool_start", name: call.name, args: call.args };
      const tool = byName.get(call.name);
      let result: string;
      try {
        result = tool ? await tool.run(call.args) : `error: unknown tool ${call.name}`;
      } catch (e) {
        result = `error: ${e instanceof Error ? e.message : String(e)}`;
      }
      yield { type: "tool_end", name: call.name, result };
      messages.push({ role: "toolResult", content: result, toolCallId: call.id });
    }
  }
  yield { type: "turn_end", text: "", usage: undefined };
}
