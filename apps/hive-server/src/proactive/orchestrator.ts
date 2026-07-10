import { listMembers, getMemberByName } from "../db/repo.js";
import { callRoleJson } from "../llm/call.js";
import { ORCHESTRATOR_SYSTEM, orchestratorUser } from "../prompts/proactive.js";
import { sharedInterests, memberBriefs } from "../graph/social.js";
import { proposeCandidate } from "./nudges.js";
import { logActivity } from "../activity.js";

interface OrchestratorOut {
  opportunities: { recipient: string; about: string; reason: string; topic: string }[];
}

// Scans the whole group for opportunities to connect / help / celebrate.
// This is the social-intelligence layer that sets a hive apart from N assistants.
export async function runOrchestrator(): Promise<void> {
  const members = listMembers();
  if (members.length < 2) return;

  const briefs = memberBriefs();
  const shared = sharedInterests();

  let out: OrchestratorOut;
  try {
    out = await callRoleJson<OrchestratorOut>("social", {
      system: ORCHESTRATOR_SYSTEM,
      messages: [{ role: "user", content: orchestratorUser(briefs, shared) }],
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
  }
}
