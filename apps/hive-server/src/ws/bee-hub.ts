import type { WebSocket } from "ws";
import { WebSocketServer } from "ws";
import type { BeeToHive, HiveToBee } from "@hive/shared";
import { getSecret, putSecret, hasSecret, listSecretNames } from "../crypto/keystore.js";
import { upsertBee } from "../db/repo.js";
import { getDb } from "../db/db.js";
import { checkIdentity, attemptPair } from "../identity/pairing.js";
import { ingestTurn } from "../ingest/ingest.js";
import { buildContext } from "../retrieval/retrieve.js";
import { broadcastDash } from "./dash-hub.js";

interface BeeConn {
  beeId: string;
  ws: WebSocket;
}

const bees = new Map<string, BeeConn>();

function send(ws: WebSocket, msg: HiveToBee): void {
  try {
    ws.send(JSON.stringify(msg));
  } catch {
    /* ignore */
  }
}

export function beeOnline(beeId: string): boolean {
  return bees.has(beeId);
}

// All known bees, oldest first. The oldest (first-registered) bee is the canonical
// "hive bee" that hosts the shared channel bots — a stable, deterministic choice
// rather than a heuristic. Online status comes from the live connection map.
export function listBees(): { beeId: string; online: boolean; primary: boolean }[] {
  const rows = getDb().db.prepare("SELECT id FROM bees ORDER BY created_at ASC, id ASC").all() as { id: string }[];
  return rows.map((r, i) => ({ beeId: r.id, online: bees.has(r.id), primary: i === 0 }));
}

// Generic push to a specific bee (channel config, etc.).
export function sendToBee(beeId: string, msg: HiveToBee): boolean {
  const conn = bees.get(beeId);
  if (!conn) return false;
  send(conn.ws, msg);
  return true;
}

// Push all stored channel configs for a bee (called on reconnect).
export function pushStoredChannelConfigs(beeId: string): void {
  const conn = bees.get(beeId);
  if (!conn) return;
  for (const name of listSecretNames(`bee:${beeId}:channel:`)) {
    const channel = name.split(":").pop()!;
    const raw = getSecret(name);
    if (!raw) continue;
    send(conn.ws, { type: "channel.config", channel: channel as never, config: JSON.parse(raw) });
  }
}

// Push a nudge to the bee that owns a member's channel identity.
export function deliverNudge(msg: Extract<HiveToBee, { type: "nudge.deliver" }>, beeId: string | null): boolean {
  const conn = beeId ? bees.get(beeId) : bees.values().next().value;
  if (!conn) return false;
  send(conn.ws, msg);
  return true;
}

export function attachBeeHub(wss: WebSocketServer, version: string): void {
  wss.on("connection", (ws) => {
    let beeId: string | null = null;

    ws.on("message", async (raw) => {
      let msg: BeeToHive;
      try {
        msg = JSON.parse(raw.toString()) as BeeToHive;
      } catch {
        return;
      }

      // must say hello first
      if (msg.type === "hello") {
        // Trust-on-first-use for localhost bees: store token if unseen, else verify.
        const secretName = `bee:${msg.beeId}:token`;
        if (!hasSecret(secretName)) putSecret(secretName, msg.beeToken);
        else if (getSecret(secretName) !== msg.beeToken) {
          send(ws, { type: "hello.err", error: "bad bee token" });
          ws.close();
          return;
        }
        beeId = msg.beeId;
        upsertBee(beeId);
        bees.set(beeId, { beeId, ws });
        broadcastDash({ type: "bee.presence", beeId, online: true });
        send(ws, { type: "hello.ack", ok: true, beeId, serverVersion: version });
        pushStoredChannelConfigs(beeId);
        return;
      }

      if (!beeId) return; // ignore pre-hello traffic

      switch (msg.type) {
        case "ping":
          send(ws, { type: "pong" });
          break;
        case "identity.check": {
          const r = checkIdentity(msg.channel, msg.externalId);
          send(ws, { type: "identity.result", reqId: msg.reqId, ...r });
          break;
        }
        case "pair.attempt": {
          const r = attemptPair(msg.channel, msg.externalId, msg.displayName, msg.code, beeId);
          send(ws, { type: "pair.result", reqId: msg.reqId, ...r });
          break;
        }
        case "context.request": {
          const blocks = await buildContext(msg.memberId, msg.sessionId, msg.text);
          send(ws, { type: "context.response", reqId: msg.reqId, blocks });
          break;
        }
        case "ingest.turn": {
          ingestTurn(msg);
          send(ws, { type: "ingest.ack", turnId: msg.turnId });
          break;
        }
        case "nudge.result":
          // recorded by the proactive module via a listener in M7
          nudgeResultListeners.forEach((l) => l(msg.nudgeId, msg.status, msg.error));
          break;
      }
    });

    ws.on("close", () => {
      if (beeId) {
        bees.delete(beeId);
        broadcastDash({ type: "bee.presence", beeId, online: false });
      }
    });
    ws.on("error", () => ws.close());
  });
}

// M7 registers a listener to persist nudge delivery results.
type NudgeResultListener = (nudgeId: string, status: "delivered" | "failed", error?: string) => void;
const nudgeResultListeners: NudgeResultListener[] = [];
export function onNudgeResult(l: NudgeResultListener): void {
  nudgeResultListeners.push(l);
}
