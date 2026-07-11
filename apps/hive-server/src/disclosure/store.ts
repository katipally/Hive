import { getDb } from "../db/db.js";
import { id } from "@hive/shared";
import type { Disclosure, DisclosureContext, DisclosureDecision } from "@hive/shared";
import { broadcastDash } from "../ws/dash-hub.js";

function rowToDisclosure(r: Record<string, unknown>): Disclosure {
  return {
    id: r["id"] as string,
    fromMemberId: r["from_member_id"] as string,
    toMemberId: r["to_member_id"] as string,
    context: r["context"] as DisclosureContext,
    decision: r["decision"] as DisclosureDecision,
    disclosed: (r["disclosed"] as string) ?? null,
    withheld: (r["withheld"] as string) ?? null,
    reasoning: r["reasoning"] as string,
    memoryIds: JSON.parse((r["memory_ids"] as string) ?? "[]"),
    createdAt: r["created_at"] as number,
  };
}

export function insertDisclosure(d: {
  fromMemberId: string;
  toMemberId: string;
  context: DisclosureContext;
  decision: DisclosureDecision;
  disclosed: string | null;
  withheld: string | null;
  reasoning: string;
  memoryIds: string[];
  cacheKey?: string;
}): Disclosure {
  const row: Disclosure = { id: id("dsc"), createdAt: Date.now(), ...d };
  getDb()
    .db.prepare(
      `INSERT INTO disclosures(id,from_member_id,to_member_id,context,decision,disclosed,withheld,reasoning,memory_ids,cache_key,created_at)
       VALUES(@id,@fromMemberId,@toMemberId,@context,@decision,@disclosed,@withheld,@reasoning,@memoryIds,@cacheKey,@createdAt)`,
    )
    .run({ ...row, memoryIds: JSON.stringify(row.memoryIds), cacheKey: d.cacheKey ?? null });
  broadcastDash({ type: "disclosure.created", disclosure: row });
  return row;
}

// A recent identical decision (same members + content + privacy pref), if any — lets the
// hot chat path reuse a verdict instead of paying an LLM call for a repeated retrieval.
// TTL-bounded and pref-aware (the pref is baked into cacheKey), so it can't leak stale grants.
export function cachedDisclosure(fromMemberId: string, toMemberId: string, cacheKey: string, ttlMs: number): Disclosure | null {
  const r = getDb()
    .db.prepare(
      "SELECT * FROM disclosures WHERE from_member_id=? AND to_member_id=? AND cache_key=? AND created_at>? ORDER BY created_at DESC LIMIT 1",
    )
    .get(fromMemberId, toMemberId, cacheKey, Date.now() - ttlMs) as Record<string, unknown> | undefined;
  return r ? rowToDisclosure(r) : null;
}

// disclosures where this member is the SUBJECT (info about them that crossed to others)
export function disclosuresFromMember(memberId: string, limit = 200): Disclosure[] {
  return (
    getDb().db.prepare("SELECT * FROM disclosures WHERE from_member_id=? ORDER BY created_at DESC LIMIT ?").all(memberId, limit) as Record<
      string,
      unknown
    >[]
  ).map(rowToDisclosure);
}

export function pruneDisclosures(keep = 5000): void {
  getDb()
    .db.prepare("DELETE FROM disclosures WHERE id NOT IN (SELECT id FROM disclosures ORDER BY created_at DESC LIMIT ?)")
    .run(keep);
}

export function listDisclosures(limit = 200, offset = 0): Disclosure[] {
  return (
    getDb().db.prepare("SELECT * FROM disclosures ORDER BY created_at DESC LIMIT ? OFFSET ?").all(limit, offset) as Record<
      string,
      unknown
    >[]
  ).map(rowToDisclosure);
}
