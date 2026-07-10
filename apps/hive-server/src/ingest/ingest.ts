import { insertTurn } from "../db/repo.js";
import { onTurnIngested } from "../pipeline/queue.js";

export function ingestTurn(t: {
  turnId: string;
  memberId: string;
  channelIdentityId: string;
  sessionId: string;
  role: "user" | "assistant";
  content: string;
  ts: number;
}): void {
  insertTurn({
    id: t.turnId,
    memberId: t.memberId,
    channelIdentityId: t.channelIdentityId,
    sessionId: t.sessionId,
    role: t.role,
    content: t.content,
    ts: t.ts,
  });
  onTurnIngested(t.memberId, t.sessionId);
}
