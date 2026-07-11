import { loadConfig } from "./config.js";
import { Bee } from "./bee.js";
import { startWebServer } from "./channels/web.js";
import { demoAutoPair } from "./demo.js";

// Keep the runtime alive even if a channel adapter (bad token, dropped socket)
// throws — one broken channel must never take down everyone's bee.
process.on("unhandledRejection", (e) => console.error("[bee] unhandled rejection:", e));
process.on("uncaughtException", (e) => console.error("[bee] uncaught exception:", (e as Error).message));

const cfg = loadConfig();
const bees = new Map<string, Bee>();

for (const inst of cfg.instances) {
  const bee = new Bee(inst, cfg);
  bees.set(inst.beeId, bee);
  bee.start();
}

startWebServer(cfg, bees);

// hosted demo only: link the seeded members to this bee so /chat works code-free
void demoAutoPair(bees, cfg);

console.log(
  `[bee] runtime up on http://localhost:${cfg.webPort} — instances: ${cfg.instances
    .map((i) => `${i.name}(${i.beeId})`)
    .join(", ")}`,
);
