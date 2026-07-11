import { getDb } from "../db/db.js";
import { lexicalCandidates, tokenSet, jaccard } from "../retrieval/lexical.js";

// Memory dedup, embedding-free: exact normalized match first (cheap), then an FTS
// shortlist of the member's similar memories checked by Jaccard token overlap.
const DUP_JACCARD = 0.82;

export function isDuplicateMemory(memberId: string, text: string): string | null {
  const { db } = getDb();
  const norm = text.trim().toLowerCase();
  const exact = db
    .prepare("SELECT id FROM memories WHERE member_id=? AND lower(trim(text))=? LIMIT 1")
    .get(memberId, norm) as { id: string } | undefined;
  if (exact) return exact.id;

  const a = tokenSet(text);
  if (a.size === 0) return null;
  for (const c of lexicalCandidates(memberId, text, 5)) {
    if (jaccard(a, tokenSet(c.text)) >= DUP_JACCARD) return c.id;
  }
  return null;
}
