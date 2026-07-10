import { id } from "@hive/shared";
import { getDb } from "../db/db.js";
import { getMember } from "../db/repo.js";
import { callRole } from "../llm/call.js";
import { insertNudge } from "./store.js";
import { deliverNudgeById } from "./nudges.js";
import { logActivity } from "../activity.js";

const DIGEST_SYSTEM = `You write a short, warm "here's your week" note from a person's Hive bee. Two or three sentences, friendly and specific, referencing what they've been up to. No lists, no preamble — just the note.`;

// Compose and deliver a personal digest to a member from their recent memories.
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

  const nudge = {
    id: id("ndg"),
    memberId,
    kind: "heartbeat" as const,
    status: "queued" as const,
    draft,
    reasoning: "weekly digest",
    source: { kind: "digest" },
    dedupKey: `digest:${new Date(Date.now()).toISOString().slice(0, 10)}`,
    channelIdentityId: null,
    createdAt: Date.now(),
    sentAt: null,
    suppressReason: null,
  };
  insertNudge(nudge);
  logActivity("nudge", memberId, { summary: "weekly digest queued" });
  await deliverNudgeById(nudge.id);
  return true;
}
