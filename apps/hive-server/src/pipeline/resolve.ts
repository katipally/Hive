import { getDb } from "../db/db.js";
import { knnMemories } from "../db/vec.js";

// Memory dedup: is this new memory near-identical to one the member already has?
// Uses cosine distance from vec_memories (<= 0.08 distance ≈ >= 0.92 similarity).
const DUP_DISTANCE = 0.08;

export function isDuplicateMemory(memberId: string, embedding: number[]): string | null {
  const hits = knnMemories(embedding, 8);
  if (hits.length === 0) return null;
  const { db } = getDb();
  for (const h of hits) {
    if (h.distance > DUP_DISTANCE) break;
    const owner = db.prepare("SELECT member_id FROM memories WHERE id=?").get(h.memoryId) as
      | { member_id: string }
      | undefined;
    if (owner?.member_id === memberId) return h.memoryId;
  }
  return null;
}

// Fallback dedup when vectors are disabled: exact-ish text match on the member's recent memories.
export function isDuplicateText(memberId: string, text: string): string | null {
  const norm = text.trim().toLowerCase();
  const r = getDb()
    .db.prepare("SELECT id FROM memories WHERE member_id=? AND lower(trim(text))=? LIMIT 1")
    .get(memberId, norm) as { id: string } | undefined;
  return r?.id ?? null;
}
