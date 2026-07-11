import { getDb } from "../db/db.js";

// Graphify-style, embedding-free retrieval: SQLite FTS5 gives us BM25 (which already
// bakes in IDF term weighting), so rare/distinctive words dominate — no vectors needed.

const STOP = new Set(
  "a an the of to in on at for and or but is are was were be been being am i you he she it we they my your his her our their me him them us this that these those with as by from about into over under again further then once here there all any both each few more most other some such no nor not only own same so than too very can will just don should now do does did have has had having what which who whom whose when where why how".split(
    /\s+/,
  ),
);

export function tokens(text: string): string[] {
  return (text.toLowerCase().match(/[a-z0-9]{2,}/g) ?? []).filter((t) => !STOP.has(t));
}

export function tokenSet(text: string): Set<string> {
  return new Set(tokens(text));
}

export function jaccard(a: Set<string>, b: Set<string>): number {
  if (!a.size || !b.size) return 0;
  let inter = 0;
  for (const x of a) if (b.has(x)) inter++;
  return inter / (a.size + b.size - inter);
}

// Free user text → a safe FTS5 MATCH query: significant tokens OR'd, each quoted so
// punctuation/operators in the text can't break the query. null if nothing usable.
export function toMatchQuery(text: string): string | null {
  const terms = Array.from(new Set(tokens(text))).slice(0, 24);
  if (terms.length === 0) return null;
  return terms.map((t) => `"${t}"`).join(" OR ");
}

export interface LexHit {
  memoryId: string;
  memberId: string;
  text: string;
  score: number; // higher = more relevant
}

// BM25 lexical search over ALL members' memory text (caller splits own vs others).
// bm25() returns lower-is-better; we negate so higher = better.
export function lexicalSearch(query: string, k: number): LexHit[] {
  const q = toMatchQuery(query);
  if (!q) return [];
  try {
    const rows = getDb()
      .db.prepare(
        // join to memories so superseded (contradicted) rows never surface (DATA-1)
        `SELECT f.memory_id AS memoryId, f.member_id AS memberId, f.text, bm25(memories_fts) AS rank
         FROM memories_fts f JOIN memories m ON m.id = f.memory_id
         WHERE memories_fts MATCH ? AND m.superseded_by IS NULL ORDER BY rank LIMIT ?`,
      )
      .all(q, k) as { memoryId: string; memberId: string; text: string; rank: number }[];
    return rows.map((r) => ({ memoryId: r.memoryId, memberId: r.memberId, text: r.text, score: -r.rank }));
  } catch {
    return [];
  }
}

// Candidate near-duplicates of a text within one member (for dedup): FTS shortlist.
export function lexicalCandidates(memberId: string, query: string, k: number): { id: string; text: string }[] {
  const q = toMatchQuery(query);
  if (!q) return [];
  try {
    return getDb()
      .db.prepare(
        `SELECT memory_id AS id, text FROM memories_fts
         WHERE memories_fts MATCH ? AND member_id = ? ORDER BY bm25(memories_fts) LIMIT ?`,
      )
      .all(q, memberId, k) as { id: string; text: string }[];
  } catch {
    return [];
  }
}

// ---- FTS index maintenance (called from graph/write.ts) ----
export function ftsInsert(memoryId: string, memberId: string, text: string): void {
  getDb().db.prepare("INSERT INTO memories_fts(memory_id, member_id, text) VALUES(?,?,?)").run(memoryId, memberId, text);
}
export function ftsDelete(memoryId: string): void {
  getDb().db.prepare("DELETE FROM memories_fts WHERE memory_id=?").run(memoryId);
}
