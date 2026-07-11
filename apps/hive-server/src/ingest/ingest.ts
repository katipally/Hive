import { insertTurn } from "../db/repo.js";
import { onTurnIngested } from "../pipeline/queue.js";

// Listeners fired on each incoming USER turn. Registered at boot (e.g. polling's
// reply-capture) via a registry so we avoid an ingest↔polling import cycle.
type UserTurnListener = (memberId: string, text: string) => void;
const userTurnListeners: UserTurnListener[] = [];
export function onUserTurn(l: UserTurnListener): void {
  userTurnListeners.push(l);
}

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
  if (t.role === "user") {
    for (const l of userTurnListeners) {
      try {
        l(t.memberId, t.content);
      } catch {
        /* a listener must never break ingest */
      }
    }
  }
  onTurnIngested(t.memberId, t.sessionId);
}
