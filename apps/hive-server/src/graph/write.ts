import { getDb } from "../db/db.js";
import { id } from "@hive/shared";
import type { EntityType } from "@hive/shared";
import { ftsInsert, ftsDelete } from "../retrieval/lexical.js";
import { resolveExistingEntity, normName } from "./entity-resolve.js";

const VALID_TYPES: EntityType[] = ["person", "place", "org", "event", "thing", "topic"];

export function upsertEntity(name: string, type: string, memberId: string | null): string {
  const t = (VALID_TYPES.includes(type as EntityType) ? type : "thing") as EntityType;
  const { db } = getDb();
  // Resolve to an existing node (normalized exact, then guarded fuzzy) instead of a raw
  // lower(name) match — so "New York"/"new-york" and "Google"/"Googel" collapse cleanly.
  const existing = resolveExistingEntity(name, t);
  if (existing) {
    if (memberId && !existing.member_id)
      db.prepare("UPDATE entities SET member_id=? WHERE id=?").run(memberId, existing.id);
    return existing.id;
  }
  const eid = id("ent");
  db.prepare("INSERT INTO entities(id,name,type,norm,member_id,created_at) VALUES(?,?,?,?,?,?)").run(
    eid,
    name,
    t,
    normName(name),
    memberId,
    Date.now(),
  );
  return eid;
}

export function findEntityByName(name: string): { id: string; type: string } | null {
  const r = getDb()
    .db.prepare("SELECT id,type FROM entities WHERE norm=? ORDER BY created_at LIMIT 1")
    .get(normName(name)) as { id: string; type: string } | undefined;
  return r ?? null;
}

export function insertMemory(m: {
  memberId: string;
  kind: "raw" | "abstract" | "conclusion";
  text: string;
  salience: number;
  sourceTurnId: string | null;
  provenance?: string[];
}): string {
  const mid = id("mry");
  getDb()
    .db.prepare(
      "INSERT INTO memories(id,member_id,kind,text,salience,source_turn_id,provenance,created_at) VALUES(?,?,?,?,?,?,?,?)",
    )
    .run(mid, m.memberId, m.kind, m.text, m.salience, m.sourceTurnId, JSON.stringify(m.provenance ?? []), Date.now());
  ftsInsert(mid, m.memberId, m.text); // keep the lexical index in sync
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
  const { db } = getDb();
  const exists = db.prepare("SELECT 1 FROM memories WHERE id=?").get(id);
  if (!exists) return false;
  // detach edges that cite this memory (keep the edges, drop the provenance)
  db.prepare("UPDATE edges SET source_memory_id=NULL WHERE source_memory_id=?").run(id);
  db.prepare("UPDATE edges SET invalidated_by_memory_id=NULL WHERE invalidated_by_memory_id=?").run(id);
  db.prepare("UPDATE memories SET superseded_by=NULL WHERE superseded_by=?").run(id);
  ftsDelete(id);
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

// The current live target of a functional relation (for contradiction detection).
export function liveEdgeDst(srcEntityId: string, rel: string): { dstId: string; dstName: string } | null {
  const r = getDb()
    .db.prepare(
      `SELECT e.dst_entity_id dstId, d.name dstName FROM edges e JOIN entities d ON d.id=e.dst_entity_id
       WHERE e.src_entity_id=? AND e.rel=? AND e.invalidated_at IS NULL ORDER BY e.created_at DESC LIMIT 1`,
    )
    .get(srcEntityId, rel) as { dstId: string; dstName: string } | undefined;
  return r ?? null;
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
    .prepare("SELECT id, source_memory_id FROM edges WHERE src_entity_id=? AND rel=? AND invalidated_at IS NULL")
    .all(srcEntityId, rel) as { id: string; source_memory_id: string | null }[];
  let n = 0;
  const now = Date.now();
  const supersededSources = new Set<string>();
  for (const r of rows) {
    if (r.id === exceptEdgeId) continue;
    db.prepare("UPDATE edges SET invalidated_at=?, valid_to=?, invalidated_by_memory_id=? WHERE id=?").run(
      now,
      now,
      byMemoryId,
      r.id,
    );
    n++;
    if (r.source_memory_id && r.source_memory_id !== byMemoryId) supersededSources.add(r.source_memory_id);
  }
  // DATA-1: supersede the raw memories that sourced the now-contradicted edges, so the
  // stale fact ("lives in Austin") stops surfacing in /me and retrieval next to the new
  // one ("moved to Denver"). We keep the row (audit trail) but mark it superseded; reads
  // filter on superseded_by IS NULL. Only when there's a replacement memory to point at.
  if (byMemoryId && supersededSources.size) {
    const sup = db.prepare("UPDATE memories SET superseded_by=? WHERE id=? AND superseded_by IS NULL");
    for (const sid of supersededSources) sup.run(byMemoryId, sid);
  }
  return n;
}
