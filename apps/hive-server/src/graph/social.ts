import { getDb } from "../db/db.js";

export interface SharedInterest {
  entity: string;
  type: string;
  members: string[]; // member names who share it
}

// Entities (topics, things, places, orgs) that connect to 2+ members' own nodes.
// This is the raw signal for "who in the group has something in common".
export function sharedInterests(): SharedInterest[] {
  const { db } = getDb();
  // member entities (person nodes bound to a member)
  const rows = db
    .prepare(
      `SELECT other.id AS eid, other.name AS ename, other.type AS etype, m.name AS member
       FROM edges g
       JOIN entities me ON me.id = (CASE WHEN g.src_entity_id IN (SELECT id FROM entities WHERE member_id IS NOT NULL) THEN g.src_entity_id ELSE g.dst_entity_id END)
       JOIN entities other ON other.id = (CASE WHEN me.id = g.src_entity_id THEN g.dst_entity_id ELSE g.src_entity_id END)
       JOIN members m ON m.id = me.member_id
       WHERE g.invalidated_at IS NULL AND me.member_id IS NOT NULL AND other.member_id IS NULL`,
    )
    .all() as { eid: string; ename: string; etype: string; member: string }[];

  const byEntity = new Map<string, { name: string; type: string; members: Set<string> }>();
  for (const r of rows) {
    if (!byEntity.has(r.eid)) byEntity.set(r.eid, { name: r.ename, type: r.etype, members: new Set() });
    byEntity.get(r.eid)!.members.add(r.member);
  }
  return [...byEntity.values()]
    .filter((e) => e.members.size >= 2)
    .map((e) => ({ entity: e.name, type: e.type, members: [...e.members] }))
    .sort((a, b) => b.members.length - a.members.length);
}

// A compact per-member brief for the orchestrator: name + top salient facts.
export function memberBriefs(limitPerMember = 6): { name: string; facts: string[] }[] {
  const { db } = getDb();
  const members = db.prepare("SELECT id, name FROM members").all() as { id: string; name: string }[];
  return members.map((m) => {
    const facts = (
      db
        .prepare("SELECT text FROM memories WHERE member_id=? ORDER BY salience DESC, created_at DESC LIMIT ?")
        .all(m.id, limitPerMember) as { text: string }[]
    ).map((r) => r.text);
    return { name: m.name, facts };
  });
}
