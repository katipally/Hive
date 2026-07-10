import { getDb } from "../db/db.js";
import { listMembers, getMemberByName, touchHeartbeat } from "../db/repo.js";
import { getProactive } from "../settings/settings.js";
import { callRoleJson } from "../llm/call.js";
import { HEARTBEAT_SYSTEM, heartbeatUser } from "../prompts/proactive.js";
import { proposeCandidate, deliverQueued, inQuietHours } from "./nudges.js";
import { runOrchestrator } from "./orchestrator.js";
import { logActivity } from "../activity.js";
import { roleConfigured } from "../settings/settings.js";

let lastOrchestrator = 0;

let timer: NodeJS.Timeout | null = null;

export function startHeartbeat(): void {
  if (timer) return;
  const intervalMs = getProactive().heartbeatIntervalMin * 60_000;
  timer = setInterval(() => void runHeartbeatTick(), intervalMs);
  timer.unref?.();
}

interface HeartbeatOut {
  worthIt: boolean;
  reason: string;
  topic: string;
  about: string;
}

export async function runHeartbeatTick(): Promise<void> {
  // always try to flush queued (held) nudges
  deliverQueued();
  if (!roleConfigured("social")) return;

  const p = getProactive();

  // group orchestration — the social layer. Run at most once per min-gap window.
  if (Date.now() - lastOrchestrator > p.heartbeatMinGapHours * 3_600_000) {
    lastOrchestrator = Date.now();
    await runOrchestrator();
  }
  const { db } = getDb();
  const gapMs = p.heartbeatMinGapHours * 3_600_000;

  for (const member of listMembers()) {
    if (member.lastHeartbeatAt && Date.now() - member.lastHeartbeatAt < gapMs) continue;
    if (inQuietHours(member)) continue;

    const slice = (
      db
        .prepare("SELECT text FROM memories WHERE member_id=? ORDER BY salience DESC, created_at DESC LIMIT 10")
        .all(member.id) as { text: string }[]
    ).map((r) => r.text);
    if (slice.length === 0) {
      touchHeartbeat(member.id);
      continue;
    }

    try {
      const out = await callRoleJson<HeartbeatOut>("social", {
        system: HEARTBEAT_SYSTEM,
        messages: [{ role: "user", content: heartbeatUser(member.name, new Date().toISOString(), slice) }],
      });
      if (out.worthIt) {
        const about = out.about && out.about.toLowerCase() !== "self" ? getMemberByName(out.about) : member;
        await proposeCandidate({
          recipientMemberId: member.id,
          aboutMemberId: (about ?? member).id,
          kind: "heartbeat",
          reason: out.reason,
          topic: out.topic || "checkin",
          sourceMemoryIds: [],
        });
      } else {
        logActivity("heartbeat_pass", member.id, { summary: out.reason || "nothing worth interrupting" });
      }
    } catch (e) {
      logActivity("error", member.id, { stage: "heartbeat", error: (e as Error).message });
    }
    touchHeartbeat(member.id);
  }
}
