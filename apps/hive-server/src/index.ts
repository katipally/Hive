import { serve } from "@hono/node-server";
import { WebSocketServer } from "ws";
import { join } from "node:path";
import type { IncomingMessage } from "node:http";
import type { Duplex } from "node:stream";
import { openDb } from "./db/db.js";
import { initKeystore } from "./crypto/keystore.js";
import { buildApi } from "./http/api.js";
import { attachBeeHub } from "./ws/bee-hub.js";
import { attachDashHub } from "./ws/dash-hub.js";
import { registerPipeline } from "./pipeline/register.js";
import { startHeartbeat } from "./proactive/heartbeat.js";
import { startReminderLoop } from "./proactive/reminders.js";
import { bootstrapDemo } from "./demo.js";

// Last-resort backstops so one poison message / rejected promise logs instead of
// tearing the process down (or silently killing a background loop).
process.on("unhandledRejection", (e) => console.error("[hive] unhandledRejection:", e));
process.on("uncaughtException", (e) => console.error("[hive] uncaughtException:", e));

const VERSION = "0.1.0";
const PORT = Number(process.env["HIVE_PORT"] ?? 4800);
const DATA_DIR = process.env["HIVE_DATA_DIR"] ?? join(process.cwd(), "hive-data");

openDb(DATA_DIR);
initKeystore(DATA_DIR);
registerPipeline();

const app = buildApi(VERSION);
const server = serve({ fetch: app.fetch, port: PORT });

const beeWss = new WebSocketServer({ noServer: true });
const dashWss = new WebSocketServer({ noServer: true });
attachBeeHub(beeWss, VERSION);
attachDashHub(dashWss);

// route WS upgrades by path
server.on("upgrade", (req: IncomingMessage, socket: Duplex, head: Buffer) => {
  const url = req.url ?? "";
  if (url.startsWith("/ws/bee")) {
    beeWss.handleUpgrade(req, socket, head, (ws) => beeWss.emit("connection", ws, req));
  } else if (url.startsWith("/ws/dash")) {
    dashWss.handleUpgrade(req, socket, head, (ws) => dashWss.emit("connection", ws, req));
  } else {
    socket.destroy();
  }
});

startHeartbeat();
startReminderLoop();

console.log(`[hive] listening on http://localhost:${PORT}  (ws: /ws/bee, /ws/dash)`);
console.log(`[hive] data dir: ${DATA_DIR}`);

// Surface silent-absence: a missing key means a whole feature quietly never fires,
// with no error anywhere. Warn loudly at boot instead.
if (process.env["HIVE_DEMO"] && !process.env["MINIMAX_API_KEY"])
  console.warn("[hive] ⚠ MINIMAX_API_KEY not set — the 'social' role stays unconfigured, so proactive nudges/polls will NEVER fire.");
if (!process.env["EXA_API_KEY"])
  console.log("[hive] web search: using the keyless provider (DuckDuckGo). Set EXA_API_KEY for higher-quality results.");

// hosted demo only (HIVE_DEMO): bake key/roles, seed the scenario, kick orchestrator
void bootstrapDemo().catch((e) => console.error("[hive] demo bootstrap failed:", e));
