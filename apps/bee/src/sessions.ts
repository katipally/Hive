import { join } from "node:path";
import { readFileSync, writeFileSync, mkdirSync, rmSync, readdirSync } from "node:fs";
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

// A separate DISPLAY transcript that also records out-of-band messages (nudges,
// polls, notices). The LLM session above stays user/assistant-only; this is what
// the web client loads so proactive messages survive refresh instead of vanishing.
export interface DisplayLine {
  role: "user" | "bee" | "notice" | "nudge";
  content: string;
  ts: number;
}
function displayFile(beeId: string, sessionId: string): string {
  return join(dataDir(), "sessions", beeId, `${sessionId}.display.jsonl`);
}
export function appendDisplay(beeId: string, sessionId: string, role: DisplayLine["role"], content: string): void {
  appendJsonl(displayFile(beeId, sessionId), { role, content, ts: Date.now() } satisfies DisplayLine);
}
export function displayTurns(beeId: string, sessionId: string): DisplayLine[] {
  return readJsonl<DisplayLine>(displayFile(beeId, sessionId));
}

// The conversation-thread tags this bee has on disk (from display transcripts).
// Session ids look like `member:<memberId>:<tag>`; we return the trailing tags so
// the web client can list every thread, not just the ones it created locally. When a
// memberId is given the list is scoped to that person — one bee can host several web
// members, so the unscoped list would leak everyone's threads into each sidebar.
export function listSessionTags(beeId: string, memberId?: string): string[] {
  try {
    const files = readdirSync(join(dataDir(), "sessions", beeId));
    const prefix = memberId ? `member:${memberId}:` : null;
    const tags = files
      .filter((f) => f.endsWith(".display.jsonl"))
      .filter((f) => !prefix || f.startsWith(prefix))
      .map((f) => f.replace(/\.display\.jsonl$/, "").split(":").pop() ?? "")
      .filter(Boolean);
    return [...new Set(tags)];
  } catch {
    return [];
  }
}

// Delete a conversation thread entirely: the display transcript the web client
// reads, plus the LLM session (.jsonl) and its compaction checkpoint, so the
// conversation truly resets rather than resurfacing on the next message.
export function deleteDisplay(beeId: string, sessionId: string): void {
  rmSync(displayFile(beeId, sessionId), { force: true });
  rmSync(sessionFile(beeId, sessionId), { force: true });
  rmSync(compactFile(beeId, sessionId), { force: true });
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
