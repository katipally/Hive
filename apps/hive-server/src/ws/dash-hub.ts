import type { WebSocket } from "ws";
import { WebSocketServer } from "ws";
import type { HiveToDash } from "@hive/shared";

const clients = new Set<WebSocket>();

export function attachDashHub(wss: WebSocketServer): void {
  wss.on("connection", (ws) => {
    clients.add(ws);
    ws.on("close", () => clients.delete(ws));
    ws.on("error", () => clients.delete(ws));
  });
}

export function broadcastDash(msg: HiveToDash): void {
  const data = JSON.stringify(msg);
  for (const ws of clients) {
    try {
      ws.send(data);
    } catch {
      /* ignore */
    }
  }
}
