import { serve } from "@hono/node-server";
import { WebSocketServer } from "ws";
import { join } from "node:path";
import type { IncomingMessage } from "node:http";
import type { Duplex } from "node:stream";
import { openDb } from "./db/db.js";
import { dedupeWebIdentities } from "./db/repo.js";
import { initKeystore } from "./crypto/keystore.js";
import { buildApi } from "./http/api.js";
import { attachBeeHub } from "./ws/bee-hub.js";
import { attachDashHub } from "./ws/dash-hub.js";
import { registerPipeline } from "./pipeline/register.js";
import { startHeartbeat } from "./proactive/heartbeat.js";
import { startReminderLoop } from "./proactive/reminders.js";
import { bakeProviderKeyFromEnv } from "./bootstrap.js";
import { roleConfigured } from "./settings/settings.js";

// Last-resort backstops so one poison message / rejected promise logs instead of
// tearing the process down (or silently killing a background loop).
process.on("unhandledRejection", (e) => console.error("[hive] unhandledRejection:", e));
process.on("uncaughtException", (e) => console.error("[hive] uncaughtException:", e));

const VERSION = "0.1.0";
const PORT = Number(process.env["HIVE_PORT"] ?? 4800);
const DATA_DIR = process.env["HIVE_DATA_DIR"] ?? join(process.cwd(), "hive-data");

openDb(DATA_DIR);
initKeystore(DATA_DIR);
bakeProviderKeyFromEnv(); // configure the model from env if a key is provided
registerPipeline();

// clean up any duplicate web identities left by the old per-browser-id scheme
const _deduped = dedupeWebIdentities();
if (_deduped) console.log(`[hive] collapsed ${_deduped} duplicate web identit${_deduped === 1 ? "y" : "ies"}`);

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

// Surface silent-absence: with no model configured, extraction/proactive/polls quietly
// never fire. Warn loudly at boot so it's not a mystery.
if (!roleConfigured("chat"))
  console.warn("[hive] ⚠ no model configured — set a provider key in Settings (or MINIMAX_API_KEY via env), or chat/extraction won't work.");
if (!process.env["EXA_API_KEY"])
  console.log("[hive] web search: using the keyless provider (DuckDuckGo). Set EXA_API_KEY for higher-quality results.");
