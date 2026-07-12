import { complete } from "@hive/shared/llm";
import type { Message } from "@hive/shared/llm";
import { resolveRole } from "../settings/settings.js";
import { getKVNum, setKVNum } from "../db/kv.js";
import type { ModelRole } from "@hive/shared";

// Global daily call cap — a safety backstop for a hosted instance's shared/baked key.
// 0 (unset) = unlimited, so local dev is never affected. State is persisted in the DB
// (not a module variable) so a Render cold-start doesn't reset the count to 0 and defeat
// the cap. ponytail: add per-IP buckets only if the public instance actually gets abused.
const DAILY_CAP = Number(process.env["HIVE_LLM_DAILY_CAP"] ?? 0);
function chargeBudget(): void {
  if (!DAILY_CAP) return;
  const now = Date.now();
  let windowStart = getKVNum("llm:capWindowStart") ?? now;
  let count = getKVNum("llm:capCount") ?? 0;
  if (now - windowStart > 86_400_000) {
    windowStart = now;
    count = 0;
  }
  if (count >= DAILY_CAP) throw new Error("Daily limit reached — the shared model budget resets within 24h.");
  setKVNum("llm:capWindowStart", windowStart);
  setKVNum("llm:capCount", count + 1);
}

// Call a role's model for a single completion (used by pipeline stages).
export async function callRole(
  role: ModelRole,
  opts: { system?: string; messages: Message[] },
): Promise<string> {
  chargeBudget();
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
// Pass `validate` to also reject well-formed JSON of the wrong shape (a real model can
// return valid JSON that's missing required keys) — a failed check triggers the same repair retry.
export async function callRoleJson<T>(
  role: ModelRole,
  opts: { system?: string; messages: Message[]; validate?: (v: unknown) => boolean },
): Promise<T> {
  const ok = (v: T | undefined): v is T => v !== undefined && (!opts.validate || opts.validate(v));
  const first = await callRole(role, opts);
  const parsed = tryParse<T>(first);
  if (ok(parsed)) return parsed;
  const repaired = await callRole(role, {
    system: opts.system,
    messages: [
      ...opts.messages,
      { role: "assistant", content: first },
      { role: "user", content: "That was not the expected JSON. Reply with ONLY the JSON object in the exact shape requested, no prose, no code fences." },
    ],
  });
  const p2 = tryParse<T>(repaired);
  if (ok(p2)) return p2;
  throw new Error("model did not return valid JSON of the expected shape");
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

