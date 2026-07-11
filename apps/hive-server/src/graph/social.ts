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

export interface MemberPair {
  a: string;
  b: string;
  shared: string[]; // entity names both are linked to
  score: number;
}

// Ranked people-pairs who share interests/entities — the actionable form of the raw
// shared-entity signal (entity resolution means "Hiking"/"hiking"/typos already collapse
// into one node, so this catches more real overlaps than exact string matching did).
// This is the substrate the orchestrator turns into introductions.
export function memberConnections(limit = 10): MemberPair[] {
  const pairs = new Map<string, MemberPair>();
  for (const s of sharedInterests()) {
    const ms = [...s.members].sort();
    for (let i = 0; i < ms.length; i++)
      for (let j = i + 1; j < ms.length; j++) {
        const key = `${ms[i]}|${ms[j]}`;
        const e = pairs.get(key) ?? { a: ms[i]!, b: ms[j]!, shared: [], score: 0 };
        e.shared.push(s.entity);
        e.score = e.shared.length;
        pairs.set(key, e);
      }
  }
  return [...pairs.values()].sort((x, y) => y.score - x.score).slice(0, limit);
}

// Friend groups: connected components over the member-connection graph. Members who
// share interests (directly or transitively) fall into one community — the hive's sense
// of "who belongs together", useful for group-level nudges and orchestration.
export function memberCommunities(): string[][] {
  const adj = new Map<string, Set<string>>();
  const add = (a: string, b: string) => (adj.get(a) ?? adj.set(a, new Set()).get(a)!).add(b);
  for (const c of memberConnections(1000)) {
    add(c.a, c.b);
    add(c.b, c.a);
  }
  const seen = new Set<string>();
  const groups: string[][] = [];
  for (const start of adj.keys()) {
    if (seen.has(start)) continue;
    const stack = [start];
    const grp: string[] = [];
    while (stack.length) {
      const n = stack.pop()!;
      if (seen.has(n)) continue;
      seen.add(n);
      grp.push(n);
      for (const m of adj.get(n) ?? []) if (!seen.has(m)) stack.push(m);
    }
    if (grp.length > 1) groups.push(grp);
  }
  return groups;
}

// A compact per-member brief for the orchestrator: name + top salient facts.
export function memberBriefs(limitPerMember = 6): { name: string; facts: string[] }[] {
  const { db } = getDb();
  const members = db.prepare("SELECT id, name FROM members").all() as { id: string; name: string }[];
  return members.map((m) => {
    const facts = (
      db
        .prepare("SELECT text FROM memories WHERE member_id=? AND superseded_by IS NULL ORDER BY salience DESC, created_at DESC LIMIT ?")
        .all(m.id, limitPerMember) as { text: string }[]
    ).map((r) => r.text);
    return { name: m.name, facts };
  });
}
