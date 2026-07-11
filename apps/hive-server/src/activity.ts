import { getDb } from "./db/db.js";
import { id } from "@hive/shared";
import type { ActivityEntry, ActivityType } from "@hive/shared";
import { broadcastDash } from "./ws/dash-hub.js";

export function logActivity(
  type: ActivityType,
  memberId: string | null,
  payload: Record<string, unknown>,
): ActivityEntry {
  const entry: ActivityEntry = { id: id("act"), ts: Date.now(), type, memberId, payload };
  getDb()
    .db.prepare("INSERT INTO activity_log(id,ts,type,member_id,payload) VALUES(?,?,?,?,?)")
    .run(entry.id, entry.ts, entry.type, entry.memberId, JSON.stringify(entry.payload));
  broadcastDash({ type: "activity.append", entry });
  return entry;
}

// Keep the activity log bounded — it's the fastest-growing table (a row per
// member per heartbeat + every pipeline/nudge/poll event). Called by the heartbeat.
export function pruneActivity(keep = 5000): void {
  getDb()
    .db.prepare("DELETE FROM activity_log WHERE id NOT IN (SELECT id FROM activity_log ORDER BY ts DESC LIMIT ?)")
    .run(keep);
}

export function recentActivity(limit = 100, offset = 0): ActivityEntry[] {
  return (
    getDb().db.prepare("SELECT * FROM activity_log ORDER BY ts DESC LIMIT ? OFFSET ?").all(limit, offset) as Record<
      string,
      unknown
    >[]
  ).map((r) => ({
    id: r["id"] as string,
    ts: r["ts"] as number,
    type: r["type"] as ActivityType,
    memberId: (r["member_id"] as string) ?? null,
    payload: JSON.parse(r["payload"] as string),
  }));
}
