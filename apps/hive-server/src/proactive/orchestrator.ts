import { listMembers, getMemberByName } from "../db/repo.js";
import { callRoleJson } from "../llm/call.js";
import { ORCHESTRATOR_SYSTEM, orchestratorUser } from "../prompts/proactive.js";
import { sharedInterests, memberBriefs, memberConnections } from "../graph/social.js";
import { proposeCandidate } from "./nudges.js";
import { startPoll } from "../polling/polls.js";
import { getDb } from "../db/db.js";
import { logActivity } from "../activity.js";

interface OrchestratorOut {
  opportunities: { recipient: string; about: string; reason: string; topic: string }[];
  polls?: { for: string; topic: string; question: string }[];
}

// don't stack autonomous polls — one open collecting poll at a time is plenty
function hasOpenPoll(): boolean {
  return !!getDb().db.prepare("SELECT 1 FROM polls WHERE status='collecting' LIMIT 1").get();
}

// Scans the whole group for opportunities to connect / help / celebrate.
// This is the social-intelligence layer that sets a hive apart from N assistants.
export async function runOrchestrator(): Promise<void> {
  const members = listMembers();
  if (members.length < 2) return;

  const briefs = memberBriefs();
  const shared = sharedInterests();
  const connections = memberConnections();

  let out: OrchestratorOut;
  try {
    out = await callRoleJson<OrchestratorOut>("social", {
      system: ORCHESTRATOR_SYSTEM,
      messages: [{ role: "user", content: orchestratorUser(briefs, shared, connections) }],
      validate: (v): boolean => !!v && Array.isArray((v as { opportunities?: unknown }).opportunities),
    });
  } catch (e) {
    logActivity("error", null, { stage: "orchestrator", error: (e as Error).message });
    return;
  }

  const ops = out.opportunities ?? [];
  logActivity("implication", null, {
    summary: ops.length ? `${ops.length} group opportunity(ies)` : "no group opportunities",
    kind: "orchestrator",
    opportunities: ops.length,
  });

  for (const op of ops) {
    const recipient = getMemberByName(op.recipient);
    if (!recipient) continue;
    const about = op.about && op.about.toLowerCase() !== "self" ? getMemberByName(op.about) : recipient;
    await proposeCandidate({
      recipientMemberId: recipient.id,
      aboutMemberId: (about ?? recipient).id,
      kind: "event",
      reason: op.reason,
      topic: `group:${op.topic || "connect"}`,
      sourceMemoryIds: ["orchestrator"],
    });
    // A connection between two distinct people is two-sided — reach out to BOTH,
    // so an introduction actually introduces (Hivemind's "set up a first date").
    // Each direction runs the disclosure gate independently inside proposeCandidate.
    if (about && about.id !== recipient.id) {
      await proposeCandidate({
        recipientMemberId: about.id,
        aboutMemberId: recipient.id,
        kind: "event",
        reason: op.reason,
        topic: `group:${op.topic || "connect"}`,
        sourceMemoryIds: ["orchestrator"],
      });
    }
  }

  // autonomous polling — at most one, never stacked. Needs ≥3 members to be worth it.
  const polls = out.polls ?? [];
  if (polls.length && members.length >= 3 && !hasOpenPoll()) {
    const poll = polls[0]!;
    if (poll.question?.trim()) {
      const forMember = poll.for && poll.for.toLowerCase() !== "none" ? getMemberByName(poll.for) : null;
      await startPoll({
        initiatorMemberId: forMember?.id ?? null,
        topic: poll.topic?.trim() || poll.question.trim().slice(0, 60),
        question: poll.question.trim(),
      });
    }
  }
}
