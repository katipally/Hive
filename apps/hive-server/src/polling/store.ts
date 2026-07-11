import { getDb } from "../db/db.js";
import { id } from "@hive/shared";
import type { Poll, PollAsk, PollDetail, PollStatus } from "@hive/shared";
import { broadcastDash } from "../ws/dash-hub.js";

function rowToPoll(r: Record<string, unknown>): Poll {
  return {
    id: r["id"] as string,
    initiatorMemberId: (r["initiator_member_id"] as string) ?? null,
    topic: r["topic"] as string,
    question: r["question"] as string,
    status: r["status"] as PollStatus,
    anonymized: !!(r["anonymized"] as number),
    synthesis: (r["synthesis"] as string) ?? null,
    closesAt: (r["closes_at"] as number) ?? null,
    createdAt: r["created_at"] as number,
  };
}

function rowToAsk(r: Record<string, unknown>): PollAsk {
  return {
    id: r["id"] as string,
    pollId: r["poll_id"] as string,
    memberId: r["member_id"] as string,
    question: r["question"] as string,
    answer: (r["answer"] as string) ?? null,
    deliveredAt: (r["delivered_at"] as number) ?? null,
    answeredAt: (r["answered_at"] as number) ?? null,
  };
}

export function insertPoll(p: Omit<Poll, "id" | "createdAt"> & { id?: string }): Poll {
  const poll: Poll = { ...p, id: p.id ?? id("poll"), createdAt: Date.now() };
  getDb()
    .db.prepare(
      `INSERT INTO polls(id,initiator_member_id,topic,question,status,anonymized,synthesis,closes_at,created_at)
       VALUES(@id,@initiatorMemberId,@topic,@question,@status,@anonymized,@synthesis,@closesAt,@createdAt)`,
    )
    .run({ ...poll, anonymized: poll.anonymized ? 1 : 0 });
  emit(poll.id);
  return poll;
}

export function insertAsk(pollId: string, memberId: string, question: string): PollAsk {
  const ask: PollAsk = { id: id("pask"), pollId, memberId, question, answer: null, deliveredAt: null, answeredAt: null };
  getDb()
    .db.prepare(
      `INSERT INTO poll_asks(id,poll_id,member_id,question,answer,delivered_at,answered_at)
       VALUES(@id,@pollId,@memberId,@question,NULL,NULL,NULL)`,
    )
    .run(ask);
  return ask;
}

export function markAskDelivered(askId: string): void {
  getDb().db.prepare("UPDATE poll_asks SET delivered_at=? WHERE id=?").run(Date.now(), askId);
}

export function getPoll(pollId: string): Poll | null {
  const r = getDb().db.prepare("SELECT * FROM polls WHERE id=?").get(pollId) as Record<string, unknown> | undefined;
  return r ? rowToPoll(r) : null;
}

export function setPollStatus(pollId: string, status: PollStatus): void {
  getDb().db.prepare("UPDATE polls SET status=? WHERE id=?").run(status, pollId);
  emit(pollId);
}

export function setPollSynthesis(pollId: string, synthesis: string): void {
  getDb().db.prepare("UPDATE polls SET synthesis=?, status='done' WHERE id=?").run(synthesis, pollId);
  emit(pollId);
}

export function asksForPoll(pollId: string): PollAsk[] {
  return (getDb().db.prepare("SELECT * FROM poll_asks WHERE poll_id=? ORDER BY delivered_at").all(pollId) as Record<string, unknown>[]).map(rowToAsk);
}

// The oldest still-open ask for a member (delivered, not yet answered) — used to
// correlate the member's next reply back to a poll on ingest.
export function openAskForMember(memberId: string): PollAsk | null {
  const r = getDb()
    .db.prepare(
      "SELECT * FROM poll_asks WHERE member_id=? AND delivered_at IS NOT NULL AND answered_at IS NULL ORDER BY delivered_at LIMIT 1",
    )
    .get(memberId) as Record<string, unknown> | undefined;
  return r ? rowToAsk(r) : null;
}

export function recordAnswer(askId: string, answer: string): void {
  getDb().db.prepare("UPDATE poll_asks SET answer=?, answered_at=? WHERE id=?").run(answer, Date.now(), askId);
  const poll = getDb().db.prepare("SELECT poll_id FROM poll_asks WHERE id=?").get(askId) as { poll_id: string } | undefined;
  if (poll) emit(poll.poll_id);
}

export function pollDetail(pollId: string): PollDetail | null {
  const p = getPoll(pollId);
  return p ? { ...p, asks: asksForPoll(pollId) } : null;
}

export function listPollDetails(limit = 100): PollDetail[] {
  const polls = (getDb().db.prepare("SELECT * FROM polls ORDER BY created_at DESC LIMIT ?").all(limit) as Record<string, unknown>[]).map(rowToPoll);
  return polls.map((p) => ({ ...p, asks: asksForPoll(p.id) }));
}

// Polls still collecting whose deadline has passed (heartbeat closes them).
export function dueCollectingPolls(): Poll[] {
  return (
    getDb()
      .db.prepare("SELECT * FROM polls WHERE status='collecting' AND closes_at IS NOT NULL AND closes_at<=?")
      .all(Date.now()) as Record<string, unknown>[]
  ).map(rowToPoll);
}

function emit(pollId: string): void {
  const d = pollDetail(pollId);
  if (d) broadcastDash({ type: "poll.updated", poll: d });
}
