import { join } from "node:path";
import { appendJsonl, readJsonl } from "@hive/shared";
import type { Message } from "@hive/shared/llm";
import { dataDir } from "./config.js";

// One JSONL transcript per (channelIdentity/session). Keeps chat continuity locally.
interface TurnLine {
  role: "user" | "assistant";
  content: string;
  ts: number;
}

function sessionFile(beeId: string, sessionId: string): string {
  return join(dataDir(), "sessions", beeId, `${sessionId}.jsonl`);
}

export function appendSession(beeId: string, sessionId: string, role: "user" | "assistant", content: string): void {
  appendJsonl(sessionFile(beeId, sessionId), { role, content, ts: Date.now() } satisfies TurnLine);
}

export function loadHistory(beeId: string, sessionId: string, limit = 20): Message[] {
  const lines = readJsonl<TurnLine>(sessionFile(beeId, sessionId));
  return lines.slice(-limit).map((l) => ({ role: l.role, content: l.content }));
}
