import { getDb } from "../db/db.js";
import { id } from "@hive/shared";
import { getMember, pickDeliveryIdentities } from "../db/repo.js";
import { deliverNudge as pushToBee } from "../ws/bee-hub.js";
import { logActivity } from "../activity.js";

export interface Reminder {
  id: string;
  memberId: string;
  text: string;
  dueAt: number;
  createdAt: number;
  deliveredAt: number | null;
}

export function insertReminder(memberId: string, text: string, dueAt: number): string {
  const rid = id("rem");
  getDb()
    .db.prepare("INSERT INTO reminders(id,member_id,text,due_at,created_at) VALUES(?,?,?,?,?)")
    .run(rid, memberId, text, dueAt, Date.now());
  logActivity("reminder", memberId, { summary: `reminder set for ${new Date(dueAt).toISOString()}: ${text}`, dueAt });
  return rid;
}

export function listReminders(memberId: string): Reminder[] {
  return (
    getDb()
      .db.prepare("SELECT id,member_id,text,due_at,created_at,delivered_at FROM reminders WHERE member_id=? ORDER BY due_at DESC LIMIT 50")
      .all(memberId) as Record<string, unknown>[]
  ).map((r) => ({
    id: r["id"] as string,
    memberId: r["member_id"] as string,
    text: r["text"] as string,
    dueAt: r["due_at"] as number,
    createdAt: r["created_at"] as number,
    deliveredAt: (r["delivered_at"] as number) ?? null,
  }));
}

// Dedicated 1-minute loop so reminders fire on time (the heartbeat is a coarse 15-min
// tick). Cheap: just an indexed DB read, no LLM. Idempotent — markDelivered gates it.
let reminderTimer: ReturnType<typeof setInterval> | null = null;
export function startReminderLoop(): void {
  if (reminderTimer) return;
  reminderTimer = setInterval(() => {
    try {
      deliverDueReminders();
    } catch (e) {
      console.error("[hive] reminder tick failed:", (e as Error).message);
    }
  }, 60_000);
  reminderTimer.unref?.();
}

function markDelivered(rid: string): void {
  getDb().db.prepare("UPDATE reminders SET delivered_at=? WHERE id=?").run(Date.now(), rid);
}

// Called each heartbeat tick: deliver any reminders now due. A reminder the member
// explicitly set bypasses the nudge cooldown/governance — they asked for it. If the bee
// is offline it stays undelivered and retries next tick.
export function deliverDueReminders(): void {
  const { db } = getDb();
  const now = Date.now();
  const rows = db
    .prepare("SELECT id, member_id, text FROM reminders WHERE delivered_at IS NULL AND due_at<=?")
    .all(now) as { id: string; member_id: string; text: string }[];
  for (const r of rows) {
    const member = getMember(r.member_id);
    if (!member) {
      markDelivered(r.id); // orphaned member — don't retry forever
      continue;
    }
    let ok = false;
    for (const ident of pickDeliveryIdentities(member)) {
      const sent = pushToBee(
        {
          type: "nudge.deliver",
          nudgeId: `rem_${r.id}`,
          memberId: member.id,
          channelIdentityId: ident.id,
          channel: ident.channel,
          externalId: ident.externalId,
          text: `⏰ Reminder: ${r.text}`,
        },
        ident.beeId,
      );
      if (sent) ok = true;
    }
    if (ok) {
      markDelivered(r.id);
      logActivity("reminder", member.id, { summary: `delivered reminder: ${r.text}` });
    }
  }
}
