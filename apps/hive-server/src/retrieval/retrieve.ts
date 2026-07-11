import type { ContextBlock } from "@hive/shared";
import { getDb } from "../db/db.js";
import { knnMemories } from "../db/vec.js";
import { embedTexts, embeddingsConfigured } from "../llm/call.js";
import { decideDisclosure } from "../disclosure/agent.js";

const MAX_HITS = 12;
const MAX_DISTANCE = 0.65; // cosine distance cutoff for relevance

interface Mem {
  id: string;
  memberId: string;
  text: string;
  salience: number;
}

// Retrieve relevant knowledge for a member's turn. Own memories pass freely;
// other members' memories are gated by the disclosure agent (always audited).
export async function buildContext(
  memberId: string,
  _sessionId: string,
  text: string,
): Promise<ContextBlock[]> {
  const { db } = getDb();
  let hits: Mem[] = [];

  if (embeddingsConfigured()) {
    let emb: number[] | undefined;
    try {
      emb = (await embedTexts([text]))[0];
    } catch {
      emb = undefined;
    }
    if (emb) {
      const knn = knnMemories(emb, MAX_HITS).filter((h) => h.distance < MAX_DISTANCE);
      hits = knn
        .map((h) => db.prepare("SELECT id,member_id as memberId,text,salience FROM memories WHERE id=?").get(h.memoryId) as Mem | undefined)
        .filter((m): m is Mem => !!m);
    }
  }
  // fallback: recent own memories (no vectors)
  if (hits.length === 0) {
    hits = db
      .prepare("SELECT id,member_id as memberId,text,salience FROM memories WHERE member_id=? ORDER BY created_at DESC LIMIT 6")
      .all(memberId) as Mem[];
  }

  const own = hits.filter((m) => m.memberId === memberId);
  const others = hits.filter((m) => m.memberId !== memberId);

  const blocks: ContextBlock[] = [];
  for (const m of own) blocks.push({ kind: "memory", text: m.text, sourceIds: [m.id] });

  // multi-hop: also include the member's own structured relations from the graph,
  // so key facts surface even when the exact memory didn't vector-match.
  for (const f of memberGraphFacts(memberId)) blocks.push({ kind: "graph", text: f, sourceIds: [] });

  // group cross-member memories by owner and gate each group
  const byOwner = new Map<string, Mem[]>();
  for (const m of others) {
    if (!byOwner.has(m.memberId)) byOwner.set(m.memberId, []);
    byOwner.get(m.memberId)!.push(m);
  }
  for (const [ownerId, mems] of byOwner) {
    const verdict = await decideDisclosure({
      toMemberId: memberId,
      fromMemberId: ownerId,
      question: text,
      memories: mems.map((m) => ({ id: m.id, text: m.text })),
      context: "chat",
    });
    if (verdict.decision !== "withhold" && verdict.disclosed) {
      blocks.push({
        kind: "disclosure-note",
        text: verdict.disclosed,
        sourceIds: mems.map((m) => m.id),
      });
    }
  }

  return blocks;
}

// The member's own live relations, phrased as facts. Scoped by SOURCE-MEMORY
// ownership so a shared entity node can never leak another member's edges — the
// "keep shared entities, guard the reads" model. (Also fixes the old node-owner
// lookup that returned nothing because extracted entities are hive-shared.)
function memberGraphFacts(memberId: string): string[] {
  const { db } = getDb();
  const rows = db
    .prepare(
      `SELECT s.name src, g.rel, d.name dst FROM edges g
       JOIN entities s ON s.id=g.src_entity_id JOIN entities d ON d.id=g.dst_entity_id
       JOIN memories m ON m.id=g.source_memory_id
       WHERE g.invalidated_at IS NULL AND m.member_id=?
       ORDER BY g.confidence DESC LIMIT 12`,
    )
    .all(memberId) as { src: string; rel: string; dst: string }[];
  return rows.map((r) => `${r.src} ${r.rel.replace(/_/g, " ")} ${r.dst}`);
}
