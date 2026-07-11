import { getDb } from "../db/db.js";
import { getMember } from "../db/repo.js";
import { callRole } from "../llm/call.js";
import { proposeCandidate } from "./nudges.js";

const DIGEST_SYSTEM = `You write a short, warm "here's your week" note from a person's Hive bee. Two or three sentences, friendly and specific, referencing what they've been up to. No lists, no preamble — just the note.`;

// Compose a personal digest and hand it to the one nudge funnel (self-addressed, so
// disclosure is skipped, but it still gets cooldown/dedup/undo/quiet-hours like any nudge).
// The "digest" topic dedups over 7 days, which naturally enforces the weekly cadence.
export async function sendDigest(memberId: string): Promise<boolean> {
  const member = getMember(memberId);
  if (!member) return false;
  const { db } = getDb();
  const recent = (
    db
      .prepare("SELECT text FROM memories WHERE member_id=? AND created_at>=? ORDER BY created_at DESC LIMIT 20")
      .all(memberId, Date.now() - 7 * 86_400_000) as { text: string }[]
  ).map((r) => r.text);
  if (recent.length === 0) return false;

  let draft: string;
  try {
    draft = (
      await callRole("social", {
        system: DIGEST_SYSTEM,
        messages: [{ role: "user", content: `${member.name}'s recent week:\n${recent.map((r) => `- ${r}`).join("\n")}\n\nWrite their digest.` }],
      })
    ).trim();
  } catch {
    return false;
  }
  if (!draft) return false;

  await proposeCandidate({
    recipientMemberId: memberId,
    aboutMemberId: memberId,
    kind: "heartbeat",
    reason: "weekly digest",
    topic: "digest",
    sourceMemoryIds: [],
    draft,
    exemptCooldown: true, // don't let the per-member nudge cooldown swallow the weekly digest
  });
  return true;
}
