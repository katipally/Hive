import { id } from "@hive/shared";
import type { Member, Nudge, NudgeKind } from "@hive/shared";
import { getMember, pickIdentity } from "../db/repo.js";
import { getProactive, getBeeSettings } from "../settings/settings.js";
import { callRole } from "../llm/call.js";
import { COMPOSE_SYSTEM, composeUser } from "../prompts/proactive.js";
import { decideDisclosure } from "../disclosure/agent.js";
import { insertNudge, setNudgeStatus, getNudge, recentSentNudges, lastSentAt, negativeFeedbackRatio } from "./store.js";
import { deliverNudge as pushToBee, onNudgeResult } from "../ws/bee-hub.js";
import { logActivity } from "../activity.js";

export interface Candidate {
  recipientMemberId: string;
  aboutMemberId: string; // may equal recipient (self / heartbeat)
  kind: NudgeKind;
  reason: string;
  topic: string;
  sourceMemoryIds: string[];
  draft?: string; // pre-composed message (e.g. weekly digest); skips the compose step
}

const DAY = 86_400_000;

// Register once: persist delivery results reported by bees.
onNudgeResult((nudgeId, status, error) => {
  if (status === "delivered") setNudgeStatus(nudgeId, "sent", { sentAt: Date.now() });
  else setNudgeStatus(nudgeId, "failed", { suppressReason: error ?? "delivery failed" });
});

// Undo/recall window: an approved nudge waits briefly before it actually goes out,
// so the operator can pull it back. Timers are in-memory (best-effort per session).
const pendingUndo = new Map<string, NodeJS.Timeout>();

// Send now, or hold for the configured undo window then send.
export function scheduleDelivery(nudgeId: string): void {
  const windowMs = getProactive().undoWindowSec * 1000;
  if (windowMs <= 0) {
    void deliverNudgeById(nudgeId);
    return;
  }
  const t = setTimeout(() => {
    pendingUndo.delete(nudgeId);
    void deliverNudgeById(nudgeId);
  }, windowMs);
  t.unref?.();
  pendingUndo.set(nudgeId, t);
}

// Recall a nudge still inside its window. Returns false if it already went out.
export function undoNudge(nudgeId: string): boolean {
  const t = pendingUndo.get(nudgeId);
  if (!t) return false;
  clearTimeout(t);
  pendingUndo.delete(nudgeId);
  setNudgeStatus(nudgeId, "dismissed", { suppressReason: "recalled by operator" });
  return true;
}

export async function proposeCandidate(cand: Candidate): Promise<void> {
  const recipient = getMember(cand.recipientMemberId);
  if (!recipient) return;
  const p = getProactive();
  const dedupKey = `${cand.aboutMemberId}:${cand.topic}`.toLowerCase();

  const suppress = (reason: string, draft: string | null = null) =>
    insertNudge(mkNudge(cand, dedupKey, "suppressed", draft, reason));

  // per-member proactivity: off mutes entirely; low/high scale the cooldown window
  const proactivity = getBeeSettings(cand.recipientMemberId).proactivity;
  if (proactivity === "off") {
    suppress("muted by member");
    return;
  }
  const proactivityFactor = proactivity === "low" ? 2 : proactivity === "high" ? 0.4 : 1;

  // cooldown — stretched when this member has been rating nudges unhelpful lately
  const negRatio = negativeFeedbackRatio(cand.recipientMemberId, 14 * DAY);
  const cooldownMs = p.cooldownHours * 3_600_000 * (1 + 3 * negRatio) * proactivityFactor; // up to 4x if unhelpful; ×member proactivity
  const last = lastSentAt(cand.recipientMemberId);
  if (last && Date.now() - last < cooldownMs) {
    suppress(negRatio > 0.5 ? "cooldown (learning: fewer nudges)" : "cooldown");
    return;
  }
  // dedup (same topic sent in last 7d)
  if (recentSentNudges(cand.recipientMemberId, 7 * DAY).some((n) => n.dedupKey === dedupKey)) {
    suppress("duplicate");
    return;
  }

  // disclosure gate when it's about someone else
  let shareable = cand.reason;
  if (cand.aboutMemberId !== cand.recipientMemberId) {
    const memText = cand.reason;
    const verdict = await decideDisclosure({
      toMemberId: cand.recipientMemberId,
      fromMemberId: cand.aboutMemberId,
      question: `Should I proactively tell ${recipient.name}: ${cand.reason}`,
      memories: cand.sourceMemoryIds.map((mid, i) => ({ id: mid, text: i === 0 ? memText : "" })).filter((m) => m.text),
      context: "nudge",
    });
    if (verdict.decision === "withhold" || !verdict.disclosed) {
      suppress("disclosure withheld");
      return;
    }
    shareable = verdict.disclosed;
  }

  // compose (unless the source already wrote the message, e.g. weekly digest)
  let draft: string;
  if (cand.draft) {
    draft = cand.draft.trim();
  } else {
    try {
      draft = (await callRole("social", {
        system: COMPOSE_SYSTEM,
        messages: [{ role: "user", content: composeUser(recipient.name, shareable, cand.reason) }],
      })).trim();
    } catch (e) {
      suppress(`compose failed: ${(e as Error).message}`);
      return;
    }
  }
  if (!draft) {
    suppress("empty draft");
    return;
  }

  const status = p.autoApprove ? "queued" : "proposed";
  const nudge = mkNudge(cand, dedupKey, status, draft, null);
  insertNudge(nudge);
  logActivity("nudge", cand.recipientMemberId, { summary: `${status}: ${cand.reason}`, topic: cand.topic });
  if (status === "queued") scheduleDelivery(nudge.id);
}

function mkNudge(
  cand: Candidate,
  dedupKey: string,
  status: Nudge["status"],
  draft: string | null,
  suppressReason: string | null,
): Nudge {
  return {
    id: id("ndg"),
    memberId: cand.recipientMemberId,
    kind: cand.kind,
    status,
    draft,
    reasoning: cand.reason,
    source: { aboutMemberId: cand.aboutMemberId, topic: cand.topic, memoryIds: cand.sourceMemoryIds },
    dedupKey,
    channelIdentityId: null,
    createdAt: Date.now(),
    sentAt: null,
    suppressReason,
  };
}

export async function deliverNudgeById(nudgeId: string): Promise<void> {
  pendingUndo.delete(nudgeId); // it's going out now
  const nudge = getNudge(nudgeId);
  if (!nudge || !nudge.draft) return;
  const member = getMember(nudge.memberId);
  if (!member) return;
  if (inQuietHours(member)) return; // hold; heartbeat retries via deliverQueued

  const identity = pickIdentity(member);
  if (!identity) {
    setNudgeStatus(nudgeId, "failed", { suppressReason: "no channel linked" });
    return;
  }
  const ok = pushToBee(
    {
      type: "nudge.deliver",
      nudgeId,
      memberId: member.id,
      channelIdentityId: identity.id,
      channel: identity.channel,
      externalId: identity.externalId,
      text: nudge.draft,
    },
    identity.beeId,
  );
  if (!ok) setNudgeStatus(nudgeId, "failed", { suppressReason: "bee offline" });
  // success path: bee replies nudge.result -> onNudgeResult sets 'sent'
}

// Deliver any queued nudges now outside quiet hours (called by heartbeat).
export function deliverQueued(): void {
  const { db } = getDbLazy();
  const rows = db.prepare("SELECT id FROM nudges WHERE status='queued'").all() as { id: string }[];
  for (const r of rows) if (!pendingUndo.has(r.id)) void deliverNudgeById(r.id); // don't jump the undo window
}

export function inQuietHours(member: Member): boolean {
  if (!member.quietHoursStart || !member.quietHoursEnd) return false;
  const now = new Date();
  const hhmm = now.toLocaleTimeString("en-GB", { timeZone: member.timezone, hour: "2-digit", minute: "2-digit", hour12: false });
  const cur = toMin(hhmm);
  const s = toMin(member.quietHoursStart);
  const e = toMin(member.quietHoursEnd);
  return s <= e ? cur >= s && cur < e : cur >= s || cur < e; // handle overnight wrap
}
function toMin(hhmm: string): number {
  const [h, m] = hhmm.split(":").map(Number);
  return (h ?? 0) * 60 + (m ?? 0);
}

// avoid import cycle at module load
import { getDb } from "../db/db.js";
function getDbLazy() {
  return getDb();
}
