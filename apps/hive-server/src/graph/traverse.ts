import { getDb } from "../db/db.js";
import { tokens } from "../retrieval/lexical.js";

interface Edge {
  src: string;
  dst: string;
  srcName: string;
  dstName: string;
  rel: string;
  confidence: number;
}

// A member's own live subgraph: edges sourced by their memories (never another
// member's edges, even on a shared entity node — the "keep shared nodes, guard reads" model).
function memberEdges(memberId: string): Edge[] {
  return getDb()
    .db.prepare(
      `SELECT g.src_entity_id src, g.dst_entity_id dst, s.name srcName, d.name dstName, g.rel, g.confidence
       FROM edges g
       JOIN entities s ON s.id=g.src_entity_id JOIN entities d ON d.id=g.dst_entity_id
       JOIN memories m ON m.id=g.source_memory_id
       WHERE g.invalidated_at IS NULL AND m.member_id=?`,
    )
    .all(memberId) as Edge[];
}

// Query-seeded, hub-avoiding BFS over the member's subgraph → up to `limit` facts phrased
// "src rel dst". Real multi-hop (graphify's approach): seed from entities whose name matches
// the query, expand up to `depth` hops, but never expand THROUGH a super-connector hub
// (p90 degree, floored) so one busy node can't drag the whole graph into every answer.
export function memberGraphFacts(memberId: string, query: string, limit = 12, depth = 2): string[] {
  const edges = memberEdges(memberId);
  if (edges.length === 0) return [];

  const adj = new Map<string, Edge[]>();
  const deg = new Map<string, number>();
  const nameOf = new Map<string, string>();
  for (const e of edges) {
    (adj.get(e.src) ?? adj.set(e.src, []).get(e.src)!).push(e);
    (adj.get(e.dst) ?? adj.set(e.dst, []).get(e.dst)!).push(e);
    deg.set(e.src, (deg.get(e.src) ?? 0) + 1);
    deg.set(e.dst, (deg.get(e.dst) ?? 0) + 1);
    nameOf.set(e.src, e.srcName);
    nameOf.set(e.dst, e.dstName);
  }

  const degrees = [...deg.values()].sort((a, b) => a - b);
  const p90 = degrees[Math.floor(degrees.length * 0.9)] ?? 0;
  const hubCut = Math.max(8, p90); // don't traverse through nodes busier than this

  const q = new Set(tokens(query));
  let seeds = [...nameOf.entries()].filter(([, nm]) => tokens(nm).some((t) => q.has(t))).map(([id]) => id);
  if (seeds.length === 0) seeds = [...adj.keys()]; // query hit nothing → whole subgraph

  const seen = new Set<string>();
  const collected: Edge[] = [];
  const have = new Set<string>();
  let frontier = seeds;
  for (let d = 0; d < depth && frontier.length; d++) {
    const next: string[] = [];
    for (const node of frontier) {
      if (seen.has(node)) continue;
      seen.add(node);
      for (const e of adj.get(node) ?? []) {
        const key = `${e.src}|${e.rel}|${e.dst}`;
        if (!have.has(key)) {
          have.add(key);
          collected.push(e);
        }
        const other = e.src === node ? e.dst : e.src;
        if (!seen.has(other) && (deg.get(other) ?? 0) <= hubCut) next.push(other);
      }
    }
    frontier = next;
  }

  collected.sort((a, b) => b.confidence - a.confidence);
  return collected.slice(0, limit).map((e) => `${e.srcName} ${e.rel.replace(/_/g, " ")} ${e.dstName}`);
}
