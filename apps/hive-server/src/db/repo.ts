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
  const ents = "(SELECT id FROM entities WHERE member_id=@m)";
  db.transaction(() => {
    db.prepare("UPDATE memories SET superseded_by=NULL WHERE member_id=@m").run({ m: memberId });
    // Remove every edge touching this member's entities OR memories before deleting those
    // rows. edges.src_entity_id/dst_entity_id are NOT NULL FKs to entities, so an edge that
    // references the member's entity (but not one of their memories) would otherwise abort
    // the whole transaction when we delete entities → the DELETE 500s and the member is stuck.
    db.prepare(
      `DELETE FROM edges WHERE src_entity_id IN ${ents} OR dst_entity_id IN ${ents} OR source_memory_id IN ${mems} OR invalidated_by_memory_id IN ${mems}`,
    ).run({ m: memberId });
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
// Read-only: the member's current live pairing code, or null. Use this for reads (e.g.
// the members list) so a GET never mints a row.
export function activePairingCode(memberId: string): string | null {
  const r = getDb()
    .db.prepare(
      "SELECT code FROM pairing_codes WHERE member_id=? AND revoked_at IS NULL AND expires_at>? ORDER BY created_at DESC LIMIT 1",
    )
    .get(memberId, Date.now()) as { code: string } | undefined;
  return r?.code ?? null;
}

export function createPairingCode(memberId: string, ttlMs = 1000 * 60 * 60 * 24 * 30): string {
  const existing = activePairingCode(memberId); // reuse an existing live code if present
  if (existing) return existing;
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
  const { db } = getDb();
  // Web is special: a browser id is a random, churning token (new profile / cleared
  // storage → new id), so treating each as a distinct identity piled up duplicate web
  // rows per member and let one browser accumulate bindings across members (a leak).
  // Invariant enforced here: ONE web identity per member, and one browser id ↔ one member.
  if (channel === "web") {
    // (1) this browser id is currently bound to a *different* member → this browser is
    //     now this member; drop the stale binding so identities never cross members.
    //     Null its references (the old member's turns keep their member_id) rather than
    //     reassign them, so no history moves between members.
    const byExt = findIdentity("web", externalId);
    if (byExt && byExt.memberId !== memberId) mergeIdentityInto(byExt.id, null);
    // (2) this member already has a web identity → rebind it to the new browser id
    //     instead of inserting a second row.
    const row = db
      .prepare("SELECT * FROM channel_identities WHERE member_id=? AND channel='web'")
      .get(memberId) as Record<string, unknown> | undefined;
    if (row) {
      const ci = rowToIdentity(row);
      db.prepare("UPDATE channel_identities SET external_id=?, display_name=?, bee_id=?, linked_at=? WHERE id=?")
        .run(externalId, displayName ?? ci.displayName, beeId ?? ci.beeId, Date.now(), ci.id);
      return { ...ci, externalId, displayName: displayName ?? ci.displayName, beeId: beeId ?? ci.beeId, linkedAt: Date.now() };
    }
  }
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

// Unlink a single channel identity (the /logout flow) — removes just this channel's
// binding; the member's memory and other channels are untouched. Clears the preferred
// pointer if it was this one so the member can still be reached elsewhere.
export function unlinkIdentity(channel: ChannelKind, externalId: string): { memberId: string; channelIdentityId: string } | null {
  const ci = findIdentity(channel, externalId);
  if (!ci) return null;
  const { db } = getDb();
  const m = getMember(ci.memberId);
  if (m?.preferredChannelIdentityId === ci.id) updateMember(ci.memberId, { preferredChannelIdentityId: null });
  db.prepare("DELETE FROM channel_identities WHERE id=?").run(ci.id);
  return { memberId: ci.memberId, channelIdentityId: ci.id };
}

// Remove a channel identity safely: repoint everything that FK-references it (turns,
// nudges, a member's preferred pointer) to `toId` first, then delete. `toId=null` nulls
// those references instead (used when the identity leaves a member entirely). Without
// this, deleting a referenced identity fails the FOREIGN KEY constraint.
function mergeIdentityInto(fromId: string, toId: string | null): void {
  const { db } = getDb();
  db.prepare("UPDATE turns SET channel_identity_id=? WHERE channel_identity_id=?").run(toId, fromId);
  db.prepare("UPDATE nudges SET channel_identity_id=? WHERE channel_identity_id=?").run(toId, fromId);
  db.prepare("UPDATE members SET preferred_channel_identity_id=? WHERE preferred_channel_identity_id=?").run(toId, fromId);
  db.prepare("DELETE FROM channel_identities WHERE id=?").run(fromId);
}

// One-time hygiene at boot: collapse any pre-existing duplicate web identities (created
// before the one-web-per-member rule) down to the most recent per member, merging their
// turns/nudges into the keeper so no history is lost. Cheap and idempotent.
export function dedupeWebIdentities(): number {
  const { db } = getDb();
  const rows = db
    .prepare("SELECT id, member_id FROM channel_identities WHERE channel='web' ORDER BY member_id, linked_at DESC")
    .all() as { id: string; member_id: string }[];
  const keeper = new Map<string, string>();
  const losers: { id: string; keeper: string }[] = [];
  for (const r of rows) {
    const k = keeper.get(r.member_id);
    if (k) losers.push({ id: r.id, keeper: k });
    else keeper.set(r.member_id, r.id);
  }
  if (!losers.length) return 0;
  db.transaction(() => {
    for (const l of losers) mergeIdentityInto(l.id, l.keeper);
  })();
  return losers.length;
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

// Channels to deliver a proactive message on. Always includes WEB (the bee) when the
// member has a web identity — that's their home base and should never be missed — PLUS
// their MOST-RECENTLY-used and MOST-FREQUENTLY-used channel (so someone who lives in
// Telegram also hears it there). Deduped. Derived from `turns` — no schema change.
export function pickDeliveryIdentities(member: Member): ChannelIdentity[] {
  const all = listIdentities(member.id);
  const ids = new Set<string>();
  // web is home base — always deliver there if the member is paired on web
  const web = all.find((c) => c.channel === "web");
  if (web) ids.add(web.id);

  const rows = getDb()
    .db.prepare(
      `SELECT channel_identity_id AS ci, COUNT(*) AS cnt, MAX(ts) AS last
       FROM turns WHERE member_id=? AND channel_identity_id IS NOT NULL
       GROUP BY channel_identity_id`,
    )
    .all(member.id) as { ci: string; cnt: number; last: number }[];
  if (rows.length) {
    ids.add([...rows].sort((a, b) => b.last - a.last)[0]!.ci); // most-recently-used
    ids.add([...rows].sort((a, b) => b.cnt - a.cnt)[0]!.ci); // most-frequently-used
  }
  if (ids.size === 0) {
    const one = pickIdentity(member); // no web, no turns yet — best single guess
    if (one) ids.add(one.id);
  }
  return [...ids].map((i) => getIdentity(i)).filter((x): x is ChannelIdentity => !!x);
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
