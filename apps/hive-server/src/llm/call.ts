import { complete, embed as embedProvider } from "@hive/shared/llm";
import type { Message } from "@hive/shared/llm";
import { resolveRole } from "../settings/settings.js";
import type { ModelRole } from "@hive/shared";
import { isMock, mockComplete, mockEmbed } from "./mock.js";

// Call a role's model for a single completion (used by pipeline stages).
export async function callRole(
  role: Exclude<ModelRole, "embeddings">,
  opts: { system?: string; messages: Message[] },
): Promise<string> {
  if (isMock()) return mockComplete(role, opts.system, opts.messages);
  const r = resolveRole(role);
  const { text } = await complete(r.family, {
    baseUrl: r.baseUrl,
    apiKey: r.apiKey,
    model: r.model,
    system: opts.system,
    messages: opts.messages,
    thinkingLevel: r.thinkingLevel,
  });
  return text;
}

// Ask a role for strict JSON; strips markdown fences and retries once via a repair note.
export async function callRoleJson<T>(
  role: Exclude<ModelRole, "embeddings">,
  opts: { system?: string; messages: Message[] },
): Promise<T> {
  const first = await callRole(role, opts);
  const parsed = tryParse<T>(first);
  if (parsed !== undefined) return parsed;
  const repaired = await callRole(role, {
    system: opts.system,
    messages: [
      ...opts.messages,
      { role: "assistant", content: first },
      { role: "user", content: "That was not valid JSON. Reply with ONLY the JSON object, no prose, no code fences." },
    ],
  });
  const p2 = tryParse<T>(repaired);
  if (p2 !== undefined) return p2;
  throw new Error("model did not return valid JSON");
}

function tryParse<T>(s: string): T | undefined {
  let t = s.trim();
  const fence = t.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fence) t = fence[1]!.trim();
  const start = t.indexOf("{");
  const end = t.lastIndexOf("}");
  if (start !== -1 && end !== -1) t = t.slice(start, end + 1);
  try {
    return JSON.parse(t) as T;
  } catch {
    return undefined;
  }
}

export async function embedTexts(texts: string[]): Promise<number[][]> {
  if (texts.length === 0) return [];
  if (isMock()) return mockEmbed(texts);
  const r = resolveRole("embeddings");
  return embedProvider(r.provider, {
    baseUrl: r.baseUrl,
    apiKey: r.apiKey,
    model: r.model,
    input: texts,
  });
}

export function embeddingsConfigured(): boolean {
  if (isMock()) return true;
  try {
    resolveRole("embeddings");
    return true;
  } catch {
    return false;
  }
}
