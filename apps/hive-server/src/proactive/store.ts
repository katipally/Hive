import { getDb } from "../db/db.js";
import type { Nudge, NudgeKind, NudgeStatus } from "@hive/shared";
import { broadcastDash } from "../ws/dash-hub.js";

function rowToNudge(r: Record<string, unknown>): Nudge {
  return {
    id: r["id"] as string,
    memberId: r["member_id"] as string,
    kind: r["kind"] as NudgeKind,
    status: r["status"] as NudgeStatus,
    draft: (r["draft"] as string) ?? null,
    reasoning: r["reasoning"] as string,
    source: JSON.parse((r["source"] as string) ?? "{}"),
    dedupKey: r["dedup_key"] as string,
    channelIdentityId: (r["channel_identity_id"] as string) ?? null,
    createdAt: r["created_at"] as number,
    sentAt: (r["sent_at"] as number) ?? null,
    suppressReason: (r["suppress_reason"] as string) ?? null,
    feedback: (r["feedback"] as number) ?? null,
  };
}

export function setNudgeFeedback(id: string, helpful: boolean): void {
  getDb().db.prepare("UPDATE nudges SET feedback=? WHERE id=?").run(helpful ? 1 : -1, id);
  const n = getNudge(id);
  if (n) broadcastDash({ type: "nudge.updated", nudge: n });
}

// fraction of recent rated nudges to a member that were unhelpful (for adaptive cooldown)
export function negativeFeedbackRatio(memberId: string, sinceMs: number): number {
  const rows = getDb()
    .db.prepare("SELECT feedback FROM nudges WHERE member_id=? AND feedback IS NOT NULL AND created_at>=?")
    .all(memberId, Date.now() - sinceMs) as { feedback: number }[];
  if (rows.length === 0) return 0;
  return rows.filter((r) => r.feedback < 0).length / rows.length;
}

export function insertNudge(n: Nudge): void {
  getDb()
    .db.prepare(
      `INSERT INTO nudges(id,member_id,kind,status,draft,reasoning,source,dedup_key,channel_identity_id,created_at,sent_at,suppress_reason)
       VALUES(@id,@memberId,@kind,@status,@draft,@reasoning,@source,@dedupKey,@channelIdentityId,@createdAt,@sentAt,@suppressReason)`,
    )
    .run({ ...n, source: JSON.stringify(n.source) });
  broadcastDash({ type: "nudge.updated", nudge: n });
}

export function getNudge(id: string): Nudge | null {
  const r = getDb().db.prepare("SELECT * FROM nudges WHERE id=?").get(id) as
    | Record<string, unknown>
    | undefined;
  return r ? rowToNudge(r) : null;
}

export function setNudgeStatus(id: string, status: NudgeStatus, extra?: { sentAt?: number; suppressReason?: string }): void {
  getDb()
    .db.prepare("UPDATE nudges SET status=?, sent_at=COALESCE(?,sent_at), suppress_reason=COALESCE(?,suppress_reason) WHERE id=?")
    .run(status, extra?.sentAt ?? null, extra?.suppressReason ?? null, id);
  const n = getNudge(id);
  if (n) broadcastDash({ type: "nudge.updated", nudge: n });
}

export function listNudges(limit = 200, offset = 0): Nudge[] {
  return (
    getDb().db.prepare("SELECT * FROM nudges ORDER BY created_at DESC LIMIT ? OFFSET ?").all(limit, offset) as Record<
      string,
      unknown
    >[]
  ).map(rowToNudge);
}

// Bound the nudge ledger — keep pending ones (proposed/queued) plus recent history.
export function pruneNudges(keep = 2000): void {
  getDb()
    .db.prepare(
      `DELETE FROM nudges WHERE status NOT IN ('proposed','queued')
       AND id NOT IN (SELECT id FROM nudges ORDER BY created_at DESC LIMIT ?)`,
    )
    .run(keep);
}

// recent sent nudges for cooldown/dedup checks
export function recentSentNudges(memberId: string, sinceMs: number): Nudge[] {
  return (
    getDb()
      .db.prepare("SELECT * FROM nudges WHERE member_id=? AND status='sent' AND sent_at>=? ORDER BY sent_at DESC")
      .all(memberId, Date.now() - sinceMs) as Record<string, unknown>[]
  ).map(rowToNudge);
}

export function lastSentAt(memberId: string): number | null {
  const r = getDb()
    .db.prepare("SELECT MAX(sent_at) m FROM nudges WHERE member_id=? AND status='sent'")
    .get(memberId) as { m: number | null };
  return r.m ?? null;
}
