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

  const facts = memoryIds
    .map((mid) => (db.prepare("SELECT text FROM memories WHERE id=?").get(mid) as { text: string } | undefined)?.text)
    .filter((t): t is string => !!t);
  if (facts.length === 0) return mark();

  const others = listMembers().filter((m) => m.id !== memberId);
  if (others.length === 0) return mark();

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
