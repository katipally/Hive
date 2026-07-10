import { getDb } from "../db/db.js";
import { id } from "@hive/shared";
import type { Disclosure, DisclosureContext, DisclosureDecision } from "@hive/shared";
import { broadcastDash } from "../ws/dash-hub.js";

export function insertDisclosure(d: {
  fromMemberId: string;
  toMemberId: string;
  context: DisclosureContext;
  decision: DisclosureDecision;
  disclosed: string | null;
  withheld: string | null;
  reasoning: string;
  memoryIds: string[];
}): Disclosure {
  const row: Disclosure = { id: id("dsc"), createdAt: Date.now(), ...d };
  getDb()
    .db.prepare(
      `INSERT INTO disclosures(id,from_member_id,to_member_id,context,decision,disclosed,withheld,reasoning,memory_ids,created_at)
       VALUES(@id,@fromMemberId,@toMemberId,@context,@decision,@disclosed,@withheld,@reasoning,@memoryIds,@createdAt)`,
    )
    .run({ ...row, memoryIds: JSON.stringify(row.memoryIds) });
  broadcastDash({ type: "disclosure.created", disclosure: row });
  return row;
}

// disclosures where this member is the SUBJECT (info about them that crossed to others)
export function disclosuresFromMember(memberId: string, limit = 200): Disclosure[] {
  return (
    getDb().db.prepare("SELECT * FROM disclosures WHERE from_member_id=? ORDER BY created_at DESC LIMIT ?").all(memberId, limit) as Record<
      string,
      unknown
    >[]
  ).map((r) => ({
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
  }));
}

export function listDisclosures(limit = 200): Disclosure[] {
  return (
    getDb().db.prepare("SELECT * FROM disclosures ORDER BY created_at DESC LIMIT ?").all(limit) as Record<
      string,
      unknown
    >[]
  ).map((r) => ({
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
  }));
}
