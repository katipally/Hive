import { join } from "node:path";
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { appendJsonl, readJsonl } from "@hive/shared";
import type { Message } from "@hive/shared/llm";
import { dataDir } from "./config.js";

// One JSONL transcript per (channelIdentity/session). Keeps chat continuity locally.
interface TurnLine {
  role: "user" | "assistant";
  content: string;
  ts: number;
}

// Rolling compaction checkpoint: everything with ts <= throughTs is represented
// by `summary`; only newer turns are kept verbatim. Persisted so a prefix is
// summarized once, not on every message.
interface Compact {
  throughTs: number;
  summary: string;
}

function sessionFile(beeId: string, sessionId: string): string {
  return join(dataDir(), "sessions", beeId, `${sessionId}.jsonl`);
}
function compactFile(beeId: string, sessionId: string): string {
  return join(dataDir(), "sessions", beeId, `${sessionId}.compact.json`);
}

const estTokens = (s: string) => Math.ceil(s.length / 4); // cheap char/4 heuristic

export function appendSession(beeId: string, sessionId: string, role: "user" | "assistant", content: string): void {
  appendJsonl(sessionFile(beeId, sessionId), { role, content, ts: Date.now() } satisfies TurnLine);
}

// Kept for callers that just want a recent slice (no compaction).
export function loadHistory(beeId: string, sessionId: string, limit = 20): Message[] {
  const lines = readJsonl<TurnLine>(sessionFile(beeId, sessionId));
  return lines.slice(-limit).map((l) => ({ role: l.role, content: l.content }));
}

// Full persisted transcript for a session — the server-side source of truth the
// web client loads so history survives a new browser / device (not just localStorage).
export function sessionTurns(beeId: string, sessionId: string): TurnLine[] {
  return readJsonl<TurnLine>(sessionFile(beeId, sessionId));
}

function readCompact(beeId: string, sessionId: string): Compact | null {
  try {
    return JSON.parse(readFileSync(compactFile(beeId, sessionId), "utf8")) as Compact;
  } catch {
    return null;
  }
}
function writeCompact(beeId: string, sessionId: string, c: Compact): void {
  const f = compactFile(beeId, sessionId);
  mkdirSync(join(f, ".."), { recursive: true });
  writeFileSync(f, JSON.stringify(c));
}

function toMessages(summary: string | null, turns: TurnLine[]): Message[] {
  const msgs: Message[] = [];
  if (summary) msgs.push({ role: "user", content: `[Summary of earlier conversation]\n${summary}` });
  for (const t of turns) msgs.push({ role: t.role, content: t.content });
  return msgs;
}

// Context for the agent, compacted to a token budget. When the live tail exceeds
// `budgetTokens`, the older turns are folded into a generated summary (via the
// caller-supplied `summarize`) and a checkpoint is persisted, so long threads
// don't blow the context window (openclaw's compaction, adapted to flat JSONL).
export async function loadHistoryCompacted(
  beeId: string,
  sessionId: string,
  summarize: (conversation: string) => Promise<string>,
  budgetTokens = 6000,
  keepRecentTokens = 3000,
): Promise<Message[]> {
  const lines = readJsonl<TurnLine>(sessionFile(beeId, sessionId));
  const prior = readCompact(beeId, sessionId);
  let summary = prior?.summary ?? null;
  const live = prior ? lines.filter((l) => l.ts > prior.throughTs) : lines;

  const total = (summary ? estTokens(summary) : 0) + live.reduce((n, l) => n + estTokens(l.content), 0);
  if (total <= budgetTokens) return toMessages(summary, live);

  // Over budget — keep the most recent turns under keepRecentTokens, fold the rest in.
  let acc = 0, cut = 0;
  for (let i = live.length - 1; i >= 0; i--) {
    acc += estTokens(live[i]!.content);
    if (acc > keepRecentTokens) { cut = i + 1; break; }
  }
  const older = live.slice(0, cut);
  const recent = live.slice(cut);
  if (!older.length) return toMessages(summary, live);

  const convo = (summary ? `Summary so far:\n${summary}\n\n` : "") + older.map((l) => `${l.role}: ${l.content}`).join("\n");
  try {
    summary = await summarize(convo);
    writeCompact(beeId, sessionId, { throughTs: older[older.length - 1]!.ts, summary });
  } catch {
    // summarization unavailable — degrade to just dropping the older prefix
  }
  return toMessages(summary, recent);
}
