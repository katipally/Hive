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
export async function runImplications(memberId: string, memoryIds: string[]): Promise<void> {
  const member = getMember(memberId);
  if (!member || memoryIds.length === 0) return;

  const { db } = getDb();
  const facts = memoryIds
    .map((mid) => (db.prepare("SELECT text FROM memories WHERE id=?").get(mid) as { text: string } | undefined)?.text)
    .filter((t): t is string => !!t);
  if (facts.length === 0) return;

  const others = listMembers().filter((m) => m.id !== memberId);
  if (others.length === 0) return;

  const out = await callRoleJson<ImplicationsOut>("social", {
    system: IMPLICATIONS_SYSTEM,
    messages: [{ role: "user", content: implicationsUser(member.name, facts, others.map((m) => m.name)) }],
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
}
