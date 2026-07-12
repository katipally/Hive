import type { Member, Poll } from "@hive/shared";
import { getMember, listMembers, pickIdentity, pickDeliveryIdentities } from "../db/repo.js";
import { callRole, callRoleJson } from "../llm/call.js";
import { COMPOSE_ASK_SYSTEM, composeAskUser, SYNTHESIZE_SYSTEM, synthesizeUser } from "../prompts/polls.js";
import { deliverNudge as pushToBee, onNudgeResult } from "../ws/bee-hub.js";
import { onUserTurn } from "../ingest/ingest.js";
import { logActivity } from "../activity.js";
import { getBeeSettings } from "../settings/settings.js";
import { inQuietHours } from "../proactive/nudges.js";
import {
  insertPoll,
  insertAsk,
  markAskDelivered,
  getPoll,
  setPollStatus,
  setPollSynthesis,
  asksForPoll,
  openAskForMember,
  recordAnswer,
  dueCollectingPolls,
} from "./store.js";

const DEFAULT_TTL = 48 * 3_600_000; // 48h to collect

// Anonymity floor: never synthesize (and thus surface) fewer than this many answers,
// or the initiator could attribute a lone reply. Default 2 keeps the small demo group
// working (3 members → 2 pollable friends) while still blocking single-answer synthesis;
// raise it for larger groups where stronger anonymity is warranted.
const MIN_POLL_RESPONDENTS = Math.max(2, Number(process.env["HIVE_POLL_MIN_RESPONDENTS"] ?? 2));

// Bee delivery of poll questions/results reuses the nudge wire. Ask ids are
// prefixed "pask" so we can mark them delivered when the bee confirms.
onNudgeResult((deliveryId, status) => {
  if (deliveryId.startsWith("pask") && status === "delivered") markAskDelivered(deliveryId);
});

// A friend's reply to their open poll question arrives as a normal user turn.
onUserTurn((memberId, text) => void capturePollResponse(memberId, text).catch(() => {}));

// Start a poll: pick the audience, compose an anonymized question per friend,
// and quietly deliver it. Autonomous polls pass initiatorMemberId = null.
export async function startPoll(opts: {
  initiatorMemberId: string | null;
  topic: string;
  question: string;
  ttlMs?: number;
}): Promise<Poll> {
  const poll = insertPoll({
    initiatorMemberId: opts.initiatorMemberId,
    topic: opts.topic,
    question: opts.question,
    status: "collecting",
    anonymized: true,
    synthesis: null,
    closesAt: Date.now() + (opts.ttlMs ?? DEFAULT_TTL),
  });

  // audience: everyone except the initiator — reachable, not opted out, and (PROA-7)
  // subject to the same governance as nudges: proactivity=off mutes them, and we don't
  // ping people during their quiet hours. Polls are no longer an ungoverned channel.
  const audience = listMembers().filter(
    (m) =>
      m.id !== opts.initiatorMemberId &&
      !m.optOutOfPolling &&
      getBeeSettings(m.id).proactivity !== "off" &&
      !inQuietHours(m) &&
      pickIdentity(m) !== null,
  );

  let asked = 0;
  for (const friend of audience) {
    let question: string;
    try {
      question = (
        await callRole("social", {
          system: COMPOSE_ASK_SYSTEM,
          messages: [{ role: "user", content: composeAskUser(friend.name, opts.topic, opts.question) }],
        })
      ).trim();
    } catch {
      continue; // compose failed for this friend — skip, don't block the poll
    }
    if (!question) continue;
    const ask = insertAsk(poll.id, friend.id, question);
    // deliver the question on the member's home base (web) AND their most-recent channel
    const identities = pickDeliveryIdentities(friend);
    let delivered = false;
    for (const identity of identities) {
      const ok = pushToBee(
        {
          type: "nudge.deliver",
          nudgeId: ask.id,
          memberId: friend.id,
          channelIdentityId: identity.id,
          channel: identity.channel,
          externalId: identity.externalId,
          text: question,
        },
        identity.beeId,
      );
      if (ok) delivered = true;
    }
    if (delivered) {
      markAskDelivered(ask.id); // optimistic; nudge.result confirms too
      asked++;
    }
  }

  logActivity("poll", opts.initiatorMemberId, {
    summary: asked ? `polling ${asked} friend(s): ${opts.topic}` : `poll started but no one reachable: ${opts.topic}`,
    pollId: poll.id,
    asked,
  });
  return poll;
}

// Correlate a reply to a poll question only if it arrives within this window of the
// question being asked. Beyond it, the message is treated as ordinary conversation and
// the stale ask closes at the poll's 48h deadline — this stops an unrelated later message
// from being silently recorded as someone's poll answer.
const POLL_REPLY_WINDOW_MS = Number(process.env["HIVE_POLL_REPLY_WINDOW_MS"] ?? 3 * 60 * 60 * 1000);

// Called from ingest on every user turn: if this member has a recently-asked poll
// question waiting, capture their reply as the answer and synthesize when everyone's in.
// (Assumes at most one open ask per member — the orchestrator keeps one poll collecting.)
export async function capturePollResponse(memberId: string, text: string): Promise<void> {
  const ask = openAskForMember(memberId);
  if (!ask || !ask.deliveredAt) return;
  if (Date.now() - ask.deliveredAt > POLL_REPLY_WINDOW_MS) return;
  // Only record the reply if it actually answers what we asked — otherwise an unrelated
  // in-flight message (a new topic, a "brb", a question of their own) would be silently
  // logged as their vote. Fail-open on an LLM hiccup so we never drop a genuine answer.
  if (!(await isPollAnswer(ask.question, text).catch(() => true))) return;
  recordAnswer(ask.id, text.trim());
  const asks = asksForPoll(ask.pollId);
  const delivered = asks.filter((a) => a.deliveredAt);
  const answered = delivered.filter((a) => a.answeredAt);
  if (delivered.length > 0 && answered.length >= delivered.length) void synthesizePoll(ask.pollId);
}

// LLM gate: is this chat message a reply to the question the member was just asked?
// Counts brief/partial replies and "I'd rather not say"; excludes unrelated topics.
async function isPollAnswer(question: string, message: string): Promise<boolean> {
  const out = await callRoleJson<{ answers: boolean }>("social", {
    system:
      'Decide if a chat message is a reply to a specific question the person was just asked. ' +
      'Respond ONLY as JSON {"answers": true|false}. It counts as answering even if brief, ' +
      'partial, uncertain, or a refusal to answer the question itself. It does NOT count if the ' +
      "message is about an unrelated topic or is the person raising their own different question.",
    messages: [{ role: "user", content: `They were asked:\n"${question}"\n\nTheir message:\n"${message}"\n\nIs the message a reply to that question?` }],
  });
  return out.answers === true;
}

// Synthesize consensus from the answers gathered and deliver it to the initiator.
export async function synthesizePoll(pollId: string): Promise<void> {
  const poll = getPoll(pollId);
  // Only a still-collecting poll may enter synthesis. This is the re-entrancy guard
  // (PROA-5): the moment we flip to "synthesizing" below, any concurrent caller —
  // another tick, the manual endpoint, a racing answer — sees a non-collecting status
  // here and bails, so we never double-synthesize or double-deliver. The check-and-set
  // is atomic because better-sqlite3 is synchronous (no await between them).
  if (!poll || poll.status !== "collecting") return;

  const answers = asksForPoll(pollId)
    .map((a) => a.answer)
    .filter((a): a is string => !!a && a.trim().length > 0);
  const pastDeadline = poll.closesAt != null && poll.closesAt <= Date.now();

  // anonymity floor (PROA-3): too few answers to safely surface — wait for more, or
  // once the deadline passes, expire quietly. Never synthesize a single answer.
  if (answers.length < MIN_POLL_RESPONDENTS) {
    if (pastDeadline) {
      setPollStatus(pollId, "expired");
      logActivity("poll", poll.initiatorMemberId, { summary: `expired (only ${answers.length} answer(s), need ${MIN_POLL_RESPONDENTS}): ${poll.topic}`, pollId });
    }
    return;
  }

  setPollStatus(pollId, "synthesizing");
  let synthesis: string;
  try {
    const out = await callRoleJson<{ synthesis: string }>("social", {
      system: SYNTHESIZE_SYSTEM,
      messages: [{ role: "user", content: synthesizeUser(poll.topic, poll.question, answers) }],
    });
    synthesis = (out.synthesis ?? "").trim();
  } catch (e) {
    logActivity("error", poll.initiatorMemberId, { stage: "poll_synthesize", pollId, error: (e as Error).message });
    // Don't loop forever (PROA-4): give up terminally once past the deadline; before
    // that, drop back to collecting so a later answer can trigger one clean retry.
    setPollStatus(pollId, pastDeadline ? "failed" : "collecting");
    return;
  }
  if (!synthesis) {
    setPollStatus(pollId, pastDeadline ? "failed" : "collecting");
    return;
  }
  setPollSynthesis(pollId, synthesis);
  logActivity("poll", poll.initiatorMemberId, {
    summary: `synthesized ${answers.length} answer(s): ${poll.topic}`,
    pollId,
  });

  // Deliver the synthesis. A member-initiated poll goes back to whoever asked; an
  // AUTONOMOUS group poll (no initiator) goes to everyone who was polled — otherwise the
  // hive spends the synthesis call and the answer reaches nobody (PROA-13). The synthesis
  // is anonymized aggregate text, so broadcasting it to participants is privacy-safe.
  const recipientIds = poll.initiatorMemberId
    ? [poll.initiatorMemberId]
    : [...new Set(asksForPoll(pollId).map((a) => a.memberId))];
  for (const rid of recipientIds) {
    const member = getMember(rid);
    if (!member) continue;
    const text = poll.initiatorMemberId
      ? `Here's what I gathered on ${poll.topic}:\n\n${synthesis}`
      : `The group weighed in on ${poll.topic} — here's the gist:\n\n${synthesis}`;
    for (const identity of pickDeliveryIdentities(member)) {
      pushToBee(
        {
          type: "nudge.deliver",
          nudgeId: `psyn_${pollId}_${rid}`,
          memberId: rid,
          channelIdentityId: identity.id,
          channel: identity.channel,
          externalId: identity.externalId,
          text,
        },
        identity.beeId,
      );
    }
  }
}

export function cancelPoll(pollId: string): void {
  setPollStatus(pollId, "cancelled");
}

// Close polls whose deadline passed (called by the proactive heartbeat).
export function closeDuePolls(): void {
  for (const p of dueCollectingPolls()) void synthesizePoll(p.id);
}
