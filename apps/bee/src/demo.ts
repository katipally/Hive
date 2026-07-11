import type { Bee } from "./bee.js";
import type { BeeConfig } from "./config.js";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// Demo only (BEE_DEMO): link each seeded hive member to a stable web identity on
// THIS bee, so the dashboard shows them online/linked and /chat can act as them
// with no code-pasting. The bee-ui demo picker uses the same `web-<name>` ids.
export async function demoAutoPair(bees: Map<string, Bee>, cfg: BeeConfig): Promise<void> {
  if (!process.env["BEE_DEMO"]) return;
  const bee = [...bees.values()][0];
  if (!bee) return;

  // wait for the hive to seed its members (their invite codes come back here)
  type M = { id: string; name: string; code: string };
  let members: M[] = [];
  for (let i = 0; i < 40; i++) {
    members = (await fetch(`${cfg.hiveHttpUrl}/api/members`).then((r) => r.json()).catch(() => [])) as M[];
    if (members.length >= 3) break;
    await sleep(1000);
  }

  for (const m of members) {
    const ext = `web-${m.name.toLowerCase()}`;
    const check = await bee.link.identityCheck("web", ext).catch(() => null);
    if (check?.known) continue;
    const r = await bee.link.pair("web", ext, m.name, m.code).catch(() => null);
    if (r?.ok) console.log(`[bee] demo: linked ${m.name} → web-${m.name.toLowerCase()}`);
  }
}
