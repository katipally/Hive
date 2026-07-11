import { getDb } from "../db/db.js";
import type { GraphPayload, GraphNode, GraphLink, EntityType } from "@hive/shared";

export interface GraphFilter {
  member?: string;
  type?: string;
  showInvalidated?: boolean;
}

// Build the react-force-graph-3d payload. Node size = degree; group = entity type.
// ponytail: bounded to MAX_* rows — a 3D force graph can't usefully render more than a
// few thousand nodes anyway, and this keeps the query O(cap) instead of O(whole graph).
// Beyond the cap, explore via the member/type filters. Raise the caps if needed.
const MAX_EDGES = 3000;
const MAX_NODES = 3000;
export function readGraph(filter: GraphFilter): GraphPayload {
  const { db } = getDb();

  let edgeSql = "SELECT * FROM edges";
  if (!filter.showInvalidated) edgeSql += " WHERE invalidated_at IS NULL";
  edgeSql += " ORDER BY confidence DESC, created_at DESC LIMIT " + MAX_EDGES;
  const edgeRows = db.prepare(edgeSql).all() as Record<string, unknown>[];

  const entityRows = db
    .prepare("SELECT id,name,type,member_id FROM entities ORDER BY created_at DESC LIMIT ?")
    .all(MAX_NODES) as { id: string; name: string; type: EntityType; member_id: string | null }[];

  const degree = new Map<string, number>();
  for (const e of edgeRows) {
    degree.set(e["src_entity_id"] as string, (degree.get(e["src_entity_id"] as string) ?? 0) + 1);
    degree.set(e["dst_entity_id"] as string, (degree.get(e["dst_entity_id"] as string) ?? 0) + 1);
  }

  let nodes: GraphNode[] = entityRows.map((r) => ({
    id: r.id,
    name: r.name,
    type: r.type,
    memberId: r.member_id,
    val: 1 + (degree.get(r.id) ?? 0),
    group: r.type,
  }));

  if (filter.type) nodes = nodes.filter((n) => n.type === filter.type);

  // member filter: keep nodes connected to that member's entities (1-hop)
  if (filter.member) {
    const memberEntityIds = new Set(entityRows.filter((r) => r.member_id === filter.member).map((r) => r.id));
    const keep = new Set(memberEntityIds);
    for (const e of edgeRows) {
      const s = e["src_entity_id"] as string;
      const d = e["dst_entity_id"] as string;
      if (memberEntityIds.has(s)) keep.add(d);
      if (memberEntityIds.has(d)) keep.add(s);
    }
    nodes = nodes.filter((n) => keep.has(n.id));
  }

  const nodeIds = new Set(nodes.map((n) => n.id));
  const links: GraphLink[] = edgeRows
    .filter((e) => nodeIds.has(e["src_entity_id"] as string) && nodeIds.has(e["dst_entity_id"] as string))
    .map((e) => ({
      source: e["src_entity_id"] as string,
      target: e["dst_entity_id"] as string,
      rel: e["rel"] as string,
      confidence: e["confidence"] as number,
      validFrom: (e["valid_from"] as number) ?? null,
      validTo: (e["valid_to"] as number) ?? null,
      invalidated: e["invalidated_at"] != null,
      sourceMemoryId: (e["source_memory_id"] as string) ?? null,
    }));

  return { nodes, links };
}

// Node inspector: entity attrs + connected edges + source memories.
export function inspectEntity(entityId: string) {
  const { db } = getDb();
  const entity = db.prepare("SELECT * FROM entities WHERE id=?").get(entityId) as
    | Record<string, unknown>
    | undefined;
  if (!entity) return null;
  const edges = db
    .prepare("SELECT * FROM edges WHERE src_entity_id=? OR dst_entity_id=?")
    .all(entityId, entityId);
  const memoryIds = new Set<string>();
  for (const e of edges as Record<string, unknown>[])
    if (e["source_memory_id"]) memoryIds.add(e["source_memory_id"] as string);
  const memories = memoryIds.size
    ? db
        .prepare(
          `SELECT * FROM memories WHERE id IN (${[...memoryIds].map(() => "?").join(",")})`,
        )
        .all(...memoryIds)
    : [];
  return { entity: { ...entity, attrs: JSON.parse((entity["attrs"] as string) ?? "{}") }, edges, memories };
}
