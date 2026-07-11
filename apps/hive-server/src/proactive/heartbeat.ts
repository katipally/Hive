import { getDb } from "../db/db.js";
import { listMembers, getMemberByName, touchHeartbeat } from "../db/repo.js";
import { getProactive } from "../settings/settings.js";
import { callRoleJson } from "../llm/call.js";
import { HEARTBEAT_SYSTEM, heartbeatUser } from "../prompts/proactive.js";
import { proposeCandidate, deliverQueued, inQuietHours } from "./nudges.js";
import { pruneNudges } from "./store.js";
import { runOrchestrator } from "./orchestrator.js";
import { sendDigest } from "./digest.js";
import { closeDuePolls } from "../polling/polls.js";
import { logActivity, pruneActivity } from "../activity.js";
import { pruneDisclosures } from "../disclosure/store.js";
import { roleConfigured } from "../settings/settings.js";
import { getKVNum, setKVNum } from "../db/kv.js";

let started = false;
let running = false;
// Weekly digest gate. The digest's own 7-day topic dedup is the real backstop; this just
// avoids composing a draft we'd throw away. Persisted (like lastOrchestrator) so a restart
// doesn't re-fire it. Keys: proactive:lastOrchestrator, proactive:lastDigest:<memberId>.
const WEEK_MS = 7 * 86_400_000;

// Self-scheduling so the interval reflects settings changes without a restart,
// and re-entrancy guarded so a slow tick never overlaps the next.
export function startHeartbeat(): void {
  if (started) return;
  started = true;
  const loop = () => {
    const intervalMs = Math.max(30_000, getProactive().heartbeatIntervalMin * 60_000);
    const t = setTimeout(async () => {
      if (!running) {
        running = true;
        try {
          await runHeartbeatTick();
        } catch (e) {
          // A throw here (without this catch) would escape the async callback and stop
          // the self-scheduling loop below from ever running again → heartbeat dies.
          console.error("[hive] heartbeat tick failed:", (e as Error).message);
        } finally {
          running = false;
        }
      }
      loop();
    }, intervalMs);
    t.unref?.();
  };
  loop();
}

// Current time in the member's own timezone (QUAL-3) so "is anything worth messaging
// them about RIGHT NOW" reasons about their local clock, not UTC.
function localNow(timezone: string): string {
  try {
    return new Date().toLocaleString("en-US", { timeZone: timezone, dateStyle: "full", timeStyle: "short" });
  } catch {
    return new Date().toISOString();
  }
}

interface HeartbeatOut {
  worthIt: boolean;
  reason: string;
  topic: string;
  about: string;
}

export async function runHeartbeatTick(): Promise<void> {
  // always try to flush queued (held) nudges + keep the stores bounded
  deliverQueued();
  closeDuePolls(); // synthesize any polls whose collection window has elapsed
  pruneActivity();
  pruneNudges();
  pruneDisclosures();
  if (!roleConfigured("social")) return;

  const p = getProactive();

  // group orchestration — the social layer. Run at most once per min-gap window.
  // Persisted (PROA-10) so a restart doesn't re-fire the orchestrator on the first tick.
  const lastOrchestrator = getKVNum("proactive:lastOrchestrator") ?? 0;
  if (Date.now() - lastOrchestrator > p.heartbeatMinGapHours * 3_600_000) {
    setKVNum("proactive:lastOrchestrator", Date.now());
    await runOrchestrator();
  }
  const { db } = getDb();
  const gapMs = p.heartbeatMinGapHours * 3_600_000;

  for (const member of listMembers()) {
    if (member.lastHeartbeatAt && Date.now() - member.lastHeartbeatAt < gapMs) continue;
    if (inQuietHours(member)) continue;

    const slice = (
      db
        .prepare("SELECT text FROM memories WHERE member_id=? AND superseded_by IS NULL ORDER BY salience DESC, created_at DESC LIMIT 10")
        .all(member.id) as { text: string }[]
    ).map((r) => r.text);
    if (slice.length === 0) {
      touchHeartbeat(member.id);
      continue;
    }

    try {
      const out = await callRoleJson<HeartbeatOut>("social", {
        system: HEARTBEAT_SYSTEM,
        messages: [{ role: "user", content: heartbeatUser(member.name, localNow(member.timezone), slice) }],
        validate: (v): boolean => !!v && typeof (v as { worthIt?: unknown }).worthIt === "boolean",
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

    // weekly "here's your week" digest — self-addressed nudge, gated to once per 7 days.
    // Stamp the week as done ONLY after a confirmed compose+propose (PROA-12): if there's
    // nothing to say or compose fails, we retry next tick instead of skipping 7 days.
    const digestKey = `proactive:lastDigest:${member.id}`;
    if (Date.now() - (getKVNum(digestKey) ?? 0) > WEEK_MS) {
      const sent = await sendDigest(member.id).catch(() => false);
      if (sent) setKVNum(digestKey, Date.now());
    }
    touchHeartbeat(member.id);
  }
}
