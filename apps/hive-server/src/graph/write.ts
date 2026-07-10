import { getDb } from "../db/db.js";
import { id } from "@hive/shared";
import type { EntityType } from "@hive/shared";
import { upsertMemoryVector } from "../db/vec.js";

const VALID_TYPES: EntityType[] = ["person", "place", "org", "event", "thing", "topic"];

export function upsertEntity(name: string, type: string, memberId: string | null): string {
  const t = (VALID_TYPES.includes(type as EntityType) ? type : "thing") as EntityType;
  const { db } = getDb();
  const existing = db
    .prepare("SELECT id, member_id FROM entities WHERE lower(name)=lower(?) AND type=?")
    .get(name, t) as { id: string; member_id: string | null } | undefined;
  if (existing) {
    if (memberId && !existing.member_id)
      db.prepare("UPDATE entities SET member_id=? WHERE id=?").run(memberId, existing.id);
    return existing.id;
  }
  const eid = id("ent");
  db.prepare("INSERT INTO entities(id,name,type,member_id,created_at) VALUES(?,?,?,?,?)").run(
    eid,
    name,
    t,
    memberId,
    Date.now(),
  );
  return eid;
}

export function findEntityByName(name: string): { id: string; type: string } | null {
  const r = getDb()
    .db.prepare("SELECT id,type FROM entities WHERE lower(name)=lower(?) ORDER BY created_at LIMIT 1")
    .get(name) as { id: string; type: string } | undefined;
  return r ?? null;
}

export function insertMemory(m: {
  memberId: string;
  kind: "raw" | "abstract" | "conclusion";
  text: string;
  salience: number;
  sourceTurnId: string | null;
  provenance?: string[];
  embedding?: number[];
}): string {
  const mid = id("mry");
  getDb()
    .db.prepare(
      "INSERT INTO memories(id,member_id,kind,text,salience,source_turn_id,provenance,created_at) VALUES(?,?,?,?,?,?,?,?)",
    )
    .run(mid, m.memberId, m.kind, m.text, m.salience, m.sourceTurnId, JSON.stringify(m.provenance ?? []), Date.now());
  if (m.embedding) upsertMemoryVector(mid, m.embedding);
  return mid;
}

export function insertEdge(e: {
  srcEntityId: string;
  rel: string;
  dstEntityId: string;
  confidence: number;
  validFrom: number | null;
  sourceMemoryId: string | null;
}): string {
  const eid = id("edg");
  getDb()
    .db.prepare(
      "INSERT INTO edges(id,src_entity_id,rel,dst_entity_id,confidence,valid_from,source_memory_id,created_at) VALUES(?,?,?,?,?,?,?,?)",
    )
    .run(eid, e.srcEntityId, e.rel, e.dstEntityId, e.confidence, e.validFrom, e.sourceMemoryId, Date.now());
  return eid;
}

// ---- deletion / correction ----
export function deleteMemory(id: string): boolean {
  const { db, vecEnabled } = getDb();
  const exists = db.prepare("SELECT 1 FROM memories WHERE id=?").get(id);
  if (!exists) return false;
  // detach edges that cite this memory (keep the edges, drop the provenance)
  db.prepare("UPDATE edges SET source_memory_id=NULL WHERE source_memory_id=?").run(id);
  db.prepare("UPDATE edges SET invalidated_by_memory_id=NULL WHERE invalidated_by_memory_id=?").run(id);
  db.prepare("UPDATE memories SET superseded_by=NULL WHERE superseded_by=?").run(id);
  if (vecEnabled) {
    try {
      db.prepare("DELETE FROM vec_memories WHERE memory_id=?").run(id);
    } catch {
      /* vec table may not exist yet */
    }
  }
  db.prepare("DELETE FROM memories WHERE id=?").run(id);
  return true;
}

// Delete an entity and every edge touching it. Also drops now-orphaned memories
// only referenced by those edges? No — memories are member-owned, leave them.
export function deleteEntity(id: string): boolean {
  const { db } = getDb();
  const exists = db.prepare("SELECT 1 FROM entities WHERE id=?").get(id);
  if (!exists) return false;
  db.prepare("DELETE FROM edges WHERE src_entity_id=? OR dst_entity_id=?").run(id, id);
  db.prepare("DELETE FROM entities WHERE id=?").run(id);
  return true;
}

export function deleteEdge(id: string): boolean {
  const { db } = getDb();
  const r = db.prepare("DELETE FROM edges WHERE id=?").run(id);
  return r.changes > 0;
}

// "forget the last thing" — remove a member's most recent memory + any edges it sourced.
export function forgetLastMemory(memberId: string): string | null {
  const { db } = getDb();
  const row = db
    .prepare("SELECT id, text FROM memories WHERE member_id=? ORDER BY created_at DESC LIMIT 1")
    .get(memberId) as { id: string; text: string } | undefined;
  if (!row) return null;
  db.prepare("DELETE FROM edges WHERE source_memory_id=?").run(row.id);
  deleteMemory(row.id);
  return row.text;
}

// Close any live edges matching src+rel (functional relation superseded).
export function invalidateEdgesBySrcRel(
  srcEntityId: string,
  rel: string,
  byMemoryId: string | null,
  exceptEdgeId?: string,
): number {
  const { db } = getDb();
  const rows = db
    .prepare("SELECT id FROM edges WHERE src_entity_id=? AND rel=? AND invalidated_at IS NULL")
    .all(srcEntityId, rel) as { id: string }[];
  let n = 0;
  const now = Date.now();
  for (const r of rows) {
    if (r.id === exceptEdgeId) continue;
    db.prepare("UPDATE edges SET invalidated_at=?, valid_to=?, invalidated_by_memory_id=? WHERE id=?").run(
      now,
      now,
      byMemoryId,
      r.id,
    );
    n++;
  }
  return n;
}
