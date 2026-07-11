import { getDb } from "../db/db.js";
import { getMember } from "../db/repo.js";
import { callRoleJson } from "../llm/call.js";
import { EXTRACT_SYSTEM, extractUser } from "../prompts/extract.js";
import { upsertEntity, insertMemory, insertEdge, invalidateEdgesBySrcRel, findEntityByName, liveEdgeDst } from "../graph/write.js";
import { normalizeRel, isFunctional } from "../graph/relations.js";
import { isDuplicateMemory } from "./resolve.js";
import { logActivity } from "../activity.js";
import { broadcastDash } from "../ws/dash-hub.js";
import { enqueue } from "./queue.js";

interface Extraction {
  memories: { text: string; kind?: "raw" | "abstract"; salience?: number }[];
  entities: { name: string; type: string }[];
  relations: { src: string; rel: string; dst: string; confidence?: number; validFrom?: number | null }[];
  invalidations: { statement: string }[];
}

export async function runExtraction(memberId: string, sessionId: string): Promise<void> {
  const { db } = getDb();
  const member = getMember(memberId);
  if (!member) return;

  const turns = db
    .prepare(
      "SELECT id,role,content,ts FROM turns WHERE member_id=? AND session_id=? AND extracted_at IS NULL ORDER BY ts",
    )
    .all(memberId, sessionId) as { id: string; role: string; content: string; ts: number }[];
  if (turns.length === 0) return;

  // Build the extraction window from the MEMBER's own words only. The assistant's
  // replies are generated text and can hallucinate — never treat them as facts,
  // or the graph fills with invented people/preferences. (We still mark every
  // turn extracted below so the cursor advances.)
  const userTurns = turns.filter((t) => t.role === "user");
  if (userTurns.length === 0) {
    const now0 = Date.now();
    const mark0 = db.prepare("UPDATE turns SET extracted_at=? WHERE id=?");
    db.transaction((ids: string[]) => ids.forEach((id) => mark0.run(now0, id)))(turns.map((t) => t.id));
    return;
  }
  const window = userTurns.map((t) => t.content).join("\n");

  // recent context to avoid dup + resolve references
  const recentMems = db
    .prepare("SELECT text FROM memories WHERE member_id=? ORDER BY created_at DESC LIMIT 15")
    .all(memberId) as { text: string }[];
  const entNames = db
    .prepare(
      "SELECT DISTINCT e.name FROM entities e JOIN edges g ON (g.src_entity_id=e.id OR g.dst_entity_id=e.id) LIMIT 30",
    )
    .all() as { name: string }[];
  const existingContext = [
    recentMems.map((m) => `- ${m.text}`).join("\n"),
    entNames.length ? `entities: ${entNames.map((e) => e.name).join(", ")}` : "",
  ]
    .filter(Boolean)
    .join("\n");

  const ex = await callRoleJson<Extraction>("extraction", {
    system: EXTRACT_SYSTEM,
    messages: [{ role: "user", content: extractUser(member.name, existingContext, window) }],
    // real models occasionally emit valid JSON of the wrong shape — force a retry so a turn's
    // knowledge isn't silently dropped by `ex.memories ?? []` below.
    validate: (v): boolean => !!v && typeof v === "object" && Array.isArray((v as { memories?: unknown }).memories),
  });

  const memberEntityId = upsertEntity(member.name, "person", memberId);
  const lastTurnId = turns[turns.length - 1]!.id;

  // ---- memories (with lexical dedup) ----
  const mems = ex.memories ?? [];
  const newMemoryIds: string[] = [];
  let dupes = 0;
  for (const m of mems) {
    if (isDuplicateMemory(memberId, m.text)) {
      dupes++;
      continue;
    }
    const mid = insertMemory({
      memberId,
      kind: m.kind === "abstract" ? "abstract" : "raw",
      text: m.text,
      salience: clamp(m.salience ?? 0.5),
      sourceTurnId: lastTurnId,
    });
    newMemoryIds.push(mid);
  }
  const provenanceMemory = newMemoryIds[0] ?? null;

  // ---- entities ----
  for (const e of ex.entities ?? []) upsertEntity(e.name, e.type, null);

  // ---- relations (normalized verb + functional invalidation + contradiction detection) ----
  let edgeCount = 0;
  let invalidated = 0;
  let contradictions = 0;
  for (const r of ex.relations ?? []) {
    if (!r.src || !r.rel || !r.dst) continue;
    const rel = normalizeRel(r.rel); // canonical verb so paraphrases supersede correctly
    const srcId = resolveEntity(r.src, member.name, memberEntityId);
    const dstId = resolveEntity(r.dst, member.name, memberEntityId);
    if (isFunctional(rel)) {
      // contradiction: a live functional edge pointing at a DIFFERENT target means the
      // fact changed (moved city, new job). Record it, then supersede the old edge.
      const prior = liveEdgeDst(srcId, rel);
      if (prior && prior.dstId !== dstId) {
        contradictions++;
        logActivity("extraction", memberId, { summary: `updated: ${r.src} ${rel.replace(/_/g, " ")} → ${r.dst} (was ${prior.dstName})` });
      }
      invalidated += invalidateEdgesBySrcRel(srcId, rel, provenanceMemory);
    }
    insertEdge({
      srcEntityId: srcId,
      rel,
      dstEntityId: dstId,
      confidence: clamp(r.confidence ?? 0.8),
      validFrom: r.validFrom ?? null,
      sourceMemoryId: provenanceMemory,
    });
    edgeCount++;
  }

  // mark turns done
  const now = Date.now();
  const mark = db.prepare("UPDATE turns SET extracted_at=? WHERE id=?");
  const tx = db.transaction((ids: string[]) => ids.forEach((id) => mark.run(now, id)));
  tx(turns.map((t) => t.id));

  logActivity("extraction", memberId, {
    summary: `+${newMemoryIds.length} memories, +${edgeCount} relations${invalidated ? `, ${invalidated} invalidated` : ""}${contradictions ? `, ${contradictions} updated` : ""}${dupes ? `, ${dupes} deduped` : ""}`,
    memories: newMemoryIds.length,
    relations: edgeCount,
    invalidated,
    contradictions,
    deduped: dupes,
  });
  broadcastDash({ type: "graph.dirty" });

  // downstream proactive stages (event-driven)
  if (newMemoryIds.length) {
    enqueue({ kind: "implications", memberId, memoryIds: newMemoryIds });
    enqueue({ kind: "errand", memberId, memoryIds: newMemoryIds });
  }
  maybeConclude(memberId);
}

function resolveEntity(name: string, memberName: string, memberEntityId: string): string {
  if (name.trim().toLowerCase() === memberName.trim().toLowerCase()) return memberEntityId;
  // reuse an existing entity of any type before creating a generic 'thing'
  const existing = findEntityByName(name);
  if (existing) return existing.id;
  return upsertEntity(name, "thing", null);
}

function maybeConclude(memberId: string): void {
  const c = (
    getDb()
      .db.prepare("SELECT COUNT(*) c FROM memories WHERE member_id=? AND kind!='conclusion'")
      .get(memberId) as { c: number }
  ).c;
  if (c > 0 && c % 10 === 0) enqueue({ kind: "conclude", memberId });
}

function clamp(n: number): number {
  return Math.max(0, Math.min(1, n));
}
