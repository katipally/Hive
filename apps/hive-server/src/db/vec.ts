import { getDb } from "./db.js";

// vec0 fixes dimension at table creation. We create it lazily once we know the
// embeddings dim (from the first embed call / settings). Changing dim requires
// dropping + re-embedding (settings UI warns).
let ensuredDim: number | null = null;

export function ensureVecTable(dim: number): boolean {
  const { db, vecEnabled } = getDb();
  if (!vecEnabled) return false;
  if (ensuredDim === dim) return true;
  const row = db
    .prepare("SELECT value FROM settings WHERE key = 'embeddings.dim'")
    .get() as { value: string } | undefined;
  const existing = row ? Number(row.value) : null;
  if (existing && existing !== dim) {
    db.exec("DROP TABLE IF EXISTS vec_memories");
    db.prepare(
      "INSERT OR REPLACE INTO settings(key,value,updated_at) VALUES('embeddings.dim',?,?)",
    ).run(String(dim), Date.now());
  } else if (!existing) {
    db.prepare("INSERT OR REPLACE INTO settings(key,value,updated_at) VALUES('embeddings.dim',?,?)").run(
      String(dim),
      Date.now(),
    );
  }
  db.exec(
    `CREATE VIRTUAL TABLE IF NOT EXISTS vec_memories USING vec0(memory_id TEXT PRIMARY KEY, embedding float[${dim}] distance=cosine)`,
  );
  ensuredDim = dim;
  return true;
}

export function upsertMemoryVector(memoryId: string, embedding: number[]): void {
  const { db, vecEnabled } = getDb();
  if (!vecEnabled) return;
  ensureVecTable(embedding.length);
  db.prepare("INSERT OR REPLACE INTO vec_memories(memory_id, embedding) VALUES(?, ?)").run(
    memoryId,
    new Float32Array(embedding),
  );
}

export interface VecHit {
  memoryId: string;
  distance: number;
}

export function knnMemories(embedding: number[], k: number): VecHit[] {
  const { db, vecEnabled } = getDb();
  if (!vecEnabled) return [];
  try {
    ensureVecTable(embedding.length);
    const rows = db
      .prepare(
        "SELECT memory_id as memoryId, distance FROM vec_memories WHERE embedding MATCH ? ORDER BY distance LIMIT ?",
      )
      .all(new Float32Array(embedding), k) as VecHit[];
    return rows;
  } catch {
    return [];
  }
}
