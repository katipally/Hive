import type { ContextBlock } from "@hive/shared";
import { getDb } from "../db/db.js";
import { lexicalSearch } from "./lexical.js";
import { memberGraphFacts } from "../graph/traverse.js";
import { decideDisclosure } from "../disclosure/agent.js";

const MAX_HITS = 12;
const MAX_OTHER_OWNERS = 3; // cap cross-member disclosure LLM calls per turn

interface Mem {
  id: string;
  memberId: string;
  text: string;
}

// Retrieve relevant knowledge for a member's turn. Own memories pass freely; other
// members' memories are gated by the disclosure agent (always audited). Embedding-free:
// BM25 lexical seed + hub-avoiding multi-hop graph traversal (graphify's approach).
export async function buildContext(memberId: string, _sessionId: string, text: string): Promise<ContextBlock[]> {
  const { db } = getDb();

  // Lexical (BM25) retrieval — real query relevance without vectors. Only fall back to
  // recency when the query has no usable search terms at all.
  let hits: Mem[] = lexicalSearch(text, MAX_HITS).map((h) => ({ id: h.memoryId, memberId: h.memberId, text: h.text }));
  if (hits.length === 0) {
    hits = db
      .prepare("SELECT id,member_id as memberId,text FROM memories WHERE member_id=? AND superseded_by IS NULL ORDER BY created_at DESC LIMIT 6")
      .all(memberId) as Mem[];
  }

  const own = hits.filter((m) => m.memberId === memberId);
  const others = hits.filter((m) => m.memberId !== memberId);

  const blocks: ContextBlock[] = [];
  for (const m of own) blocks.push({ kind: "memory", text: m.text, sourceIds: [m.id] });

  // real multi-hop, hub-avoiding traversal of the member's own subgraph, seeded by the query
  for (const f of memberGraphFacts(memberId, text)) blocks.push({ kind: "graph", text: f, sourceIds: [] });

  // group cross-member memories by owner; gate the busiest few owners (bounds LLM calls)
  const byOwner = new Map<string, Mem[]>();
  for (const m of others) {
    if (!byOwner.has(m.memberId)) byOwner.set(m.memberId, []);
    byOwner.get(m.memberId)!.push(m);
  }
  const owners = [...byOwner.entries()].sort((a, b) => b[1].length - a[1].length).slice(0, MAX_OTHER_OWNERS);
  for (const [ownerId, mems] of owners) {
    try {
      const verdict = await decideDisclosure({
        toMemberId: memberId,
        fromMemberId: ownerId,
        question: text,
        memories: mems.map((m) => ({ id: m.id, text: m.text })),
        context: "chat",
      });
      if (verdict.decision !== "withhold" && verdict.disclosed) {
        blocks.push({ kind: "disclosure-note", text: verdict.disclosed, sourceIds: mems.map((m) => m.id) });
      }
    } catch {
      // A disclosure decision failing (e.g. the model is overloaded) must NOT wipe out the
      // member's own retrieved context. Fail closed on the cross-member fact, keep the rest.
    }
  }

  return blocks;
}
