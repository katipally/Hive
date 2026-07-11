import { getDb } from "./db.js";
import { id, pairingCode } from "@hive/shared";
import type { ChannelIdentity, ChannelKind, Member } from "@hive/shared";

// ---- members ----
export function createMember(name: string, timezone = "UTC"): Member {
  const m: Member = {
    id: id("mem"),
    name,
    timezone,
    quietHoursStart: null,
    quietHoursEnd: null,
    preferredChannelIdentityId: null,
    lastHeartbeatAt: null,
    optOutOfPolling: false,
    createdAt: Date.now(),
  };
  getDb()
    .db.prepare(
      "INSERT INTO members(id,name,timezone,created_at) VALUES(@id,@name,@timezone,@createdAt)",
    )
    .run(m);
  return m;
}

function rowToMember(r: Record<string, unknown>): Member {
  return {
    id: r["id"] as string,
    name: r["name"] as string,
    timezone: r["timezone"] as string,
    quietHoursStart: (r["quiet_hours_start"] as string) ?? null,
    quietHoursEnd: (r["quiet_hours_end"] as string) ?? null,
    preferredChannelIdentityId: (r["preferred_channel_identity_id"] as string) ?? null,
    lastHeartbeatAt: (r["last_heartbeat_at"] as number) ?? null,
    optOutOfPolling: !!(r["opt_out_polling"] as number),
    createdAt: r["created_at"] as number,
  };
}

export function getMember(memberId: string): Member | null {
  const r = getDb().db.prepare("SELECT * FROM members WHERE id = ?").get(memberId) as
    | Record<string, unknown>
    | undefined;
  return r ? rowToMember(r) : null;
}

export function getMemberByName(name: string): Member | null {
  const r = getDb().db.prepare("SELECT * FROM members WHERE lower(name)=lower(?) LIMIT 1").get(name) as
    | Record<string, unknown>
    | undefined;
  return r ? rowToMember(r) : null;
}

export function listMembers(): Member[] {
  return (getDb().db.prepare("SELECT * FROM members ORDER BY created_at").all() as Record<
    string,
    unknown
  >[]).map(rowToMember);
}

export function updateMember(
  memberId: string,
  fields: Partial<
    Pick<Member, "name" | "timezone" | "quietHoursStart" | "quietHoursEnd" | "preferredChannelIdentityId" | "optOutOfPolling">
  >,
): Member | null {
  const cur = getMember(memberId);
  if (!cur) return null;
  const next = { ...cur, ...fields };
  getDb()
    .db.prepare(
      `UPDATE members SET name=@name, timezone=@timezone, quiet_hours_start=@quietHoursStart,
       quiet_hours_end=@quietHoursEnd, preferred_channel_identity_id=@preferredChannelIdentityId,
       opt_out_polling=@optOutOfPolling WHERE id=@id`,
    )
    .run({ ...next, optOutOfPolling: next.optOutOfPolling ? 1 : 0 });
  return next;
}

export function touchHeartbeat(memberId: string): void {
  getDb().db.prepare("UPDATE members SET last_heartbeat_at = ? WHERE id = ?").run(Date.now(), memberId);
}

// Remove a member and everything that belongs to them. Order respects foreign
// keys; shared entities are left in place (they may belong to the whole hive).
export function deleteMember(memberId: string): boolean {
  const db = getDb().db;
  const exists = db.prepare("SELECT 1 FROM members WHERE id=?").get(memberId);
  if (!exists) return false;
  const mems = "(SELECT id FROM memories WHERE member_id=@m)";
  db.transaction(() => {
    db.prepare("UPDATE memories SET superseded_by=NULL WHERE member_id=@m").run({ m: memberId });
    db.prepare(`DELETE FROM edges WHERE source_memory_id IN ${mems} OR invalidated_by_memory_id IN ${mems}`).run({ m: memberId });
    db.prepare("DELETE FROM poll_asks WHERE member_id=@m OR poll_id IN (SELECT id FROM polls WHERE initiator_member_id=@m)").run({ m: memberId });
    db.prepare("DELETE FROM polls WHERE initiator_member_id=@m").run({ m: memberId });
    db.prepare("DELETE FROM disclosures WHERE from_member_id=@m OR to_member_id=@m").run({ m: memberId });
    db.prepare("DELETE FROM nudges WHERE member_id=@m").run({ m: memberId });
    db.prepare("DELETE FROM memories WHERE member_id=@m").run({ m: memberId });
    db.prepare("DELETE FROM turns WHERE member_id=@m").run({ m: memberId });
    db.prepare("DELETE FROM entities WHERE member_id=@m").run({ m: memberId });
    db.prepare("DELETE FROM channel_identities WHERE member_id=@m").run({ m: memberId });
    db.prepare("DELETE FROM pairing_codes WHERE member_id=@m").run({ m: memberId });
    db.prepare("DELETE FROM activity_log WHERE member_id=@m").run({ m: memberId });
    db.prepare("DELETE FROM members WHERE id=@m").run({ m: memberId });
  })();
  return true;
}

// The channel identities for a member (used to notify their bee on removal).
export function memberIdentityIds(memberId: string): string[] {
  return (getDb().db.prepare("SELECT id FROM channel_identities WHERE member_id=?").all(memberId) as { id: string }[]).map((r) => r.id);
}

// ---- pairing codes ----
export function createPairingCode(memberId: string, ttlMs = 1000 * 60 * 60 * 24 * 30): string {
  // reuse an existing live code if present
  const existing = getDb()
    .db.prepare(
      "SELECT code FROM pairing_codes WHERE member_id=? AND revoked_at IS NULL AND expires_at>? ORDER BY created_at DESC LIMIT 1",
    )
    .get(memberId, Date.now()) as { code: string } | undefined;
  if (existing) return existing.code;
  const code = pairingCode();
  const now = Date.now();
  getDb()
    .db.prepare(
      "INSERT INTO pairing_codes(code, member_id, created_at, expires_at) VALUES(?,?,?,?)",
    )
    .run(code, memberId, now, now + ttlMs);
  return code;
}

export function memberForCode(code: string): string | null {
  const r = getDb()
    .db.prepare(
      "SELECT member_id FROM pairing_codes WHERE code=? AND revoked_at IS NULL AND expires_at>?",
    )
    .get(code.trim().toUpperCase(), Date.now()) as { member_id: string } | undefined;
  return r?.member_id ?? null;
}

// ---- channel identities ----
function rowToIdentity(r: Record<string, unknown>): ChannelIdentity {
  return {
    id: r["id"] as string,
    memberId: r["member_id"] as string,
    channel: r["channel"] as ChannelKind,
    externalId: r["external_id"] as string,
    displayName: (r["display_name"] as string) ?? null,
    beeId: (r["bee_id"] as string) ?? null,
    linkedAt: r["linked_at"] as number,
  };
}

export function findIdentity(channel: ChannelKind, externalId: string): ChannelIdentity | null {
  const r = getDb()
    .db.prepare("SELECT * FROM channel_identities WHERE channel=? AND external_id=?")
    .get(channel, externalId) as Record<string, unknown> | undefined;
  return r ? rowToIdentity(r) : null;
}

export function linkIdentity(
  memberId: string,
  channel: ChannelKind,
  externalId: string,
  displayName: string | null,
  beeId: string | null,
): ChannelIdentity {
  const existing = findIdentity(channel, externalId);
  if (existing) return existing;
  const ci: ChannelIdentity = {
    id: id("ci"),
    memberId,
    channel,
    externalId,
    displayName,
    beeId,
    linkedAt: Date.now(),
  };
  getDb()
    .db.prepare(
      `INSERT INTO channel_identities(id,member_id,channel,external_id,display_name,bee_id,linked_at)
       VALUES(@id,@memberId,@channel,@externalId,@displayName,@beeId,@linkedAt)`,
    )
    .run(ci);
  // default preferred channel = first linked
  const m = getMember(memberId);
  if (m && !m.preferredChannelIdentityId) updateMember(memberId, { preferredChannelIdentityId: ci.id });
  return ci;
}

export function listIdentities(memberId: string): ChannelIdentity[] {
  return (
    getDb().db.prepare("SELECT * FROM channel_identities WHERE member_id=?").all(memberId) as Record<
      string,
      unknown
    >[]
  ).map(rowToIdentity);
}

export function getIdentity(id: string): ChannelIdentity | null {
  const r = getDb().db.prepare("SELECT * FROM channel_identities WHERE id=?").get(id) as
    | Record<string, unknown>
    | undefined;
  return r ? rowToIdentity(r) : null;
}

// The channel to reach a member on: their preferred identity, else the first linked one.
export function pickIdentity(member: Member): ChannelIdentity | null {
  if (member.preferredChannelIdentityId) {
    const ci = getIdentity(member.preferredChannelIdentityId);
    if (ci) return ci;
  }
  return listIdentities(member.id)[0] ?? null;
}

// ---- bees ----
export function upsertBee(beeId: string): void {
  getDb()
    .db.prepare(
      "INSERT INTO bees(id,last_seen_at,created_at) VALUES(?,?,?) ON CONFLICT(id) DO UPDATE SET last_seen_at=excluded.last_seen_at",
    )
    .run(beeId, Date.now(), Date.now());
}

// ---- turns ----
export function insertTurn(t: {
  id: string;
  memberId: string;
  channelIdentityId: string;
  sessionId: string;
  role: "user" | "assistant";
  content: string;
  ts: number;
}): void {
  getDb()
    .db.prepare(
      `INSERT OR IGNORE INTO turns(id,member_id,channel_identity_id,session_id,role,content,ts)
       VALUES(@id,@memberId,@channelIdentityId,@sessionId,@role,@content,@ts)`,
    )
    .run(t);
}
