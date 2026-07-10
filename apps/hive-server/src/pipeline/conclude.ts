import { getDb } from "../db/db.js";
import { getMember } from "../db/repo.js";
import { callRoleJson, embedTexts, embeddingsConfigured } from "../llm/call.js";
import { CONCLUDE_SYSTEM, concludeUser } from "../prompts/proactive.js";
import { insertMemory } from "../graph/write.js";
import { logActivity } from "../activity.js";
import { broadcastDash } from "../ws/dash-hub.js";

interface ConcludeOut {
  conclusions: { text: string; salience?: number }[];
}

// Derive higher-order conclusions from a member's accumulated graph slice.
export async function runConclude(memberId: string): Promise<void> {
  const member = getMember(memberId);
  if (!member) return;
  const { db } = getDb();

  const facts = (
    db.prepare("SELECT text FROM memories WHERE member_id=? AND kind!='conclusion' ORDER BY salience DESC LIMIT 25").all(memberId) as {
      text: string;
    }[]
  ).map((r) => r.text);
  if (facts.length < 3) return;

  const relations = (
    db
      .prepare(
        `SELECT s.name src, rel, d.name dst FROM edges g
         JOIN entities s ON s.id=g.src_entity_id JOIN entities d ON d.id=g.dst_entity_id
         WHERE g.invalidated_at IS NULL LIMIT 30`,
      )
      .all() as { src: string; rel: string; dst: string }[]
  ).map((r) => `${r.src} ${r.rel} ${r.dst}`);

  const out = await callRoleJson<ConcludeOut>("social", {
    system: CONCLUDE_SYSTEM,
    messages: [{ role: "user", content: concludeUser(member.name, facts, relations) }],
  });

  const conclusions = (out.conclusions ?? []).filter((c) => c.text?.trim());
  if (conclusions.length === 0) return;

  const embs = embeddingsConfigured() ? await embedTexts(conclusions.map((c) => c.text)).catch(() => []) : [];
  for (let i = 0; i < conclusions.length; i++) {
    insertMemory({
      memberId,
      kind: "conclusion",
      text: conclusions[i]!.text,
      salience: Math.max(0, Math.min(1, conclusions[i]!.salience ?? 0.6)),
      sourceTurnId: null,
      embedding: embs[i],
    });
  }
  logActivity("conclusion", memberId, { summary: `+${conclusions.length} conclusion(s)`, count: conclusions.length });
  broadcastDash({ type: "graph.dirty" });
}
