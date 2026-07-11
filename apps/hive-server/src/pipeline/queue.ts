import { getDb } from "../db/db.js";
import { logActivity } from "../activity.js";

export type Job =
  | { kind: "extract"; memberId: string; sessionId: string }
  | { kind: "conclude"; memberId: string }
  | { kind: "implications"; memberId: string; memoryIds: string[] }
  | { kind: "errand"; memberId: string; memoryIds: string[] };

type Handler = (job: Job) => Promise<void>;
const handlers = new Map<string, Handler>();
export function registerHandler(kind: Job["kind"], fn: Handler): void {
  handlers.set(kind, fn);
}

const q: Job[] = [];
let running = false;

export function enqueue(job: Job): void {
  q.push(job);
  void drain();
}

// Re-enqueue extraction for any turns left unprocessed by a crash/restart. The
// in-memory queue is otherwise lost on restart; this recovers it at boot.
export function sweepPendingExtractions(): void {
  const rows = getDb()
    .db.prepare("SELECT DISTINCT member_id, session_id FROM turns WHERE extracted_at IS NULL")
    .all() as { member_id: string; session_id: string }[];
  for (const r of rows) enqueue({ kind: "extract", memberId: r.member_id, sessionId: r.session_id });
}

// Implications (event-driven nudges) live only in the in-memory queue too — recover
// any extracted memories that never got their implications pass. Conclude self-heals
// (it re-fires at the next multiple of 10), so it needs no sweep.
export function sweepPendingImplications(): void {
  const rows = getDb()
    .db.prepare(
      "SELECT member_id, id FROM memories WHERE implications_at IS NULL AND kind != 'conclusion' ORDER BY created_at",
    )
    .all() as { member_id: string; id: string }[];
  const byMember = new Map<string, string[]>();
  for (const r of rows) (byMember.get(r.member_id) ?? byMember.set(r.member_id, []).get(r.member_id)!).push(r.id);
  for (const [memberId, memoryIds] of byMember) enqueue({ kind: "implications", memberId, memoryIds });
}

async function drain(): Promise<void> {
  if (running) return;
  running = true;
  while (q.length) {
    const job = q.shift()!;
    const handler = handlers.get(job.kind);
    if (!handler) continue; // stage not wired yet
    let lastErr: unknown;
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        await handler(job);
        lastErr = undefined;
        break;
      } catch (e) {
        lastErr = e;
        await new Promise((r) => setTimeout(r, 250 * 2 ** attempt));
      }
    }
    if (lastErr) {
      logActivity("error", "memberId" in job ? job.memberId : null, {
        stage: job.kind,
        error: lastErr instanceof Error ? lastErr.message : String(lastErr),
      });
    }
  }
  running = false;
}

// ---- extraction debounce ----
// Enqueue extraction when a session goes idle (default 45s), or immediately at >=4 pending turns.
const IDLE_MS = Number(process.env["HIVE_EXTRACT_IDLE_MS"] ?? 45_000);
const BATCH_TRIGGER = 4;
const timers = new Map<string, NodeJS.Timeout>();

export function onTurnIngested(memberId: string, sessionId: string): void {
  const key = `${memberId}:${sessionId}`;
  const pending = (
    getDb()
      .db.prepare("SELECT COUNT(*) c FROM turns WHERE member_id=? AND session_id=? AND extracted_at IS NULL")
      .get(memberId, sessionId) as { c: number }
  ).c;

  const fire = () => {
    const t = timers.get(key);
    if (t) clearTimeout(t);
    timers.delete(key);
    enqueue({ kind: "extract", memberId, sessionId });
  };

  if (pending >= BATCH_TRIGGER) {
    fire();
    return;
  }
  const existing = timers.get(key);
  if (existing) clearTimeout(existing);
  timers.set(key, setTimeout(fire, IDLE_MS));
}
