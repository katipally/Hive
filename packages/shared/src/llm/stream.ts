import type { ApiFamily, ChatRequest, StreamEvent } from "./types.js";
import { anthropicStream } from "./anthropic.js";
import { openaiStream } from "./openai-compat.js";

export function streamByFamily(family: ApiFamily, req: ChatRequest): AsyncGenerator<StreamEvent> {
  return family === "anthropic-messages" ? anthropicStream(req) : openaiStream(req);
}

// Collect a full non-streaming completion (used by hive-internal pipeline calls).
export async function complete(
  family: ApiFamily,
  req: ChatRequest,
): Promise<{ text: string; usage?: { inputTokens: number; outputTokens: number } }> {
  let text = "";
  let usage;
  for await (const ev of streamByFamily(family, req)) {
    if (ev.type === "text_delta") text += ev.text;
    else if (ev.type === "done") usage = ev.usage;
  }
  return { text, usage };
}
