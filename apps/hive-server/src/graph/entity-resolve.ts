import { getDb } from "../db/db.js";

// Embedding-free entity resolution (graphify's dedup approach, minus the LSH stage which
// we don't need at this scale): a normalized key merges case/spacing/punctuation variants
// ("New York" = "new-york" = "NewYork"), then a conservative fuzzy pass catches typos
// ("Google" = "Googel") — guarded so it never merges genuinely different entities.

export function normName(s: string): string {
  return s.normalize("NFKC").toLowerCase().replace(/[^a-z0-9]+/g, "");
}

function jaro(s1: string, s2: string): number {
  const len1 = s1.length,
    len2 = s2.length;
  if (len1 === 0 || len2 === 0) return 0;
  const md = Math.max(0, Math.floor(Math.max(len1, len2) / 2) - 1);
  const m1 = new Array(len1).fill(false),
    m2 = new Array(len2).fill(false);
  let matches = 0;
  for (let i = 0; i < len1; i++) {
    const lo = Math.max(0, i - md),
      hi = Math.min(i + md + 1, len2);
    for (let j = lo; j < hi; j++)
      if (!m2[j] && s1[i] === s2[j]) {
        m1[i] = m2[j] = true;
        matches++;
        break;
      }
  }
  if (matches === 0) return 0;
  let t = 0,
    k = 0;
  for (let i = 0; i < len1; i++)
    if (m1[i]) {
      while (!m2[k]) k++;
      if (s1[i] !== s2[k]) t++;
      k++;
    }
  t /= 2;
  return (matches / len1 + matches / len2 + (matches - t) / matches) / 3;
}

export function jaroWinkler(a: string, b: string): number {
  if (a === b) return 1;
  const j = jaro(a, b);
  let p = 0;
  while (p < 4 && p < a.length && p < b.length && a[p] === b[p]) p++;
  return j + p * 0.1 * (1 - j);
}

// Guardrails that HARD-block a fuzzy merge regardless of score — the "don't merge
// different things" half of dedup (graphify dedup.py guard rails):
function canMerge(a: string, b: string): boolean {
  // differing numeric tokens: "M1"/"M2", "ADR-11"/"ADR-13", "v1"/"v2"
  const na = (a.match(/\d+/g) ?? []).sort().join(",");
  const nb = (b.match(/\d+/g) ?? []).sort().join(",");
  if (na !== nb) return false;
  // big length gap: avoid "Sam"→"Samuel Jackson" / "Bob"→"Bob Smith" (could be different people)
  if (Math.min(a.length, b.length) / Math.max(a.length, b.length) < 0.6) return false;
  return true;
}

const FUZZY_THRESHOLD = 0.94;

// Resolve a name+type to an existing entity: exact normalized match, else a guarded
// high-similarity fuzzy match among same-type candidates sharing a normalized prefix
// (indexed block, so this stays cheap as the graph grows). null → it's a new entity.
export function resolveExistingEntity(name: string, type: string): { id: string; member_id: string | null } | null {
  const { db } = getDb();
  const n = normName(name);
  if (!n) return null;

  const exact = db.prepare("SELECT id, member_id FROM entities WHERE norm=? AND type=? LIMIT 1").get(n, type) as
    | { id: string; member_id: string | null }
    | undefined;
  if (exact) return exact;

  const cands = db
    .prepare("SELECT id, name, member_id FROM entities WHERE type=? AND norm LIKE ? LIMIT 50")
    .all(type, n.slice(0, 4) + "%") as { id: string; name: string; member_id: string | null }[];
  const la = name.toLowerCase();
  let best: { id: string; member_id: string | null } | null = null;
  let bestScore = 0;
  for (const c of cands) {
    const cl = c.name.toLowerCase();
    const s = jaroWinkler(la, cl);
    if (s >= FUZZY_THRESHOLD && s > bestScore && canMerge(la, cl)) {
      best = { id: c.id, member_id: c.member_id };
      bestScore = s;
    }
  }
  return best;
}
