import { getDb } from "../db/db.js";
import { getMember, getMemberByName, listMembers } from "../db/repo.js";
import { callRoleJson } from "../llm/call.js";
import { IMPLICATIONS_SYSTEM, implicationsUser } from "../prompts/proactive.js";
import { proposeCandidate } from "../proactive/nudges.js";
import { logActivity } from "../activity.js";

interface ImplicationsOut {
  nudges: { recipient: string; reason: string; topic: string }[];
}

// Event-driven: does this member's new knowledge warrant nudging other members?
// Marks each processed memory with implications_at so the boot sweep can recover
// runs lost to a crash without re-processing everything. ponytail: a re-run after a
// mid-loop crash is bounded by the 7-day nudge dedup, so it can't spam duplicates.
export async function runImplications(memberId: string, memoryIds: string[]): Promise<void> {
  const { db } = getDb();
  const mark = () => {
    const stmt = db.prepare("UPDATE memories SET implications_at=? WHERE id=?");
    const now = Date.now();
    for (const mid of memoryIds) stmt.run(now, mid);
  };
  const member = getMember(memberId);
  if (!member || memoryIds.length === 0) return mark();

  const rows = memoryIds
    .map((mid) => db.prepare("SELECT text, salience FROM memories WHERE id=?").get(mid) as { text: string; salience: number } | undefined)
    .filter((r): r is { text: string; salience: number } => !!r);
  if (rows.length === 0) return mark();

  const others = listMembers().filter((m) => m.id !== memberId);
  if (others.length === 0) return mark();

  // Cheap no-LLM pre-filter: only spend a social LLM call when something here is worth
  // telling someone. Salience is the primary gate — but a quietly-stated fact that names
  // ANOTHER member ("I'm helping Bob with the party") is exactly a cross-member signal
  // even at low salience, so that's a second trigger (PROA-14): important-but-low-salience
  // facts that reference the group are no longer buried forever.
  const SALIENCE_MIN = Number(process.env["HIVE_SALIENCE_MIN"] ?? 0.6);
  const salientEnough = Math.max(...rows.map((r) => r.salience)) >= SALIENCE_MIN;
  const namesAnotherMember = rows.some((r) =>
    others.some((o) => new RegExp(`\\b${escapeRegex(o.name)}\\b`, "i").test(r.text)),
  );
  if (!salientEnough && !namesAnotherMember) {
    logActivity("implication", memberId, { summary: "skipped (nothing salient enough to share)", count: 0 });
    return mark();
  }

  const facts = rows.map((r) => r.text);

  const out = await callRoleJson<ImplicationsOut>("social", {
    system: IMPLICATIONS_SYSTEM,
    messages: [{ role: "user", content: implicationsUser(member.name, facts, others.map((m) => m.name)) }],
    validate: (v): boolean => !!v && Array.isArray((v as { nudges?: unknown }).nudges),
  });

  const nudges = out.nudges ?? [];
  logActivity("implication", memberId, {
    summary: nudges.length ? `${nudges.length} candidate(s): ${nudges.map((n) => n.recipient).join(", ")}` : "no implications",
    count: nudges.length,
  });

  for (const n of nudges) {
    const recipient = getMemberByName(n.recipient);
    if (!recipient || recipient.id === memberId) continue;
    await proposeCandidate({
      recipientMemberId: recipient.id,
      aboutMemberId: memberId,
      kind: "event",
      reason: n.reason,
      topic: n.topic || "event",
      sourceMemoryIds: memoryIds,
    });
  }
  mark(); // processed — don't re-sweep these on next boot
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
