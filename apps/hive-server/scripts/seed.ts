// CLI: seed the demo friend group into hive.db without running conversations.
// Usage: HIVE_DATA_DIR=./hive-data pnpm seed
import { join } from "node:path";
import { openDb } from "../src/db/db.js";
import { initKeystore } from "../src/crypto/keystore.js";
import { seedDemo } from "../src/demo.js";

const DATA_DIR = process.env["HIVE_DATA_DIR"] ?? join(process.cwd(), "hive-data");
openDb(DATA_DIR);
initKeystore(DATA_DIR);
seedDemo().then((members) => {
  console.log("Seeded members + codes:");
  for (const m of members) console.log(`  ${m.name}: ${m.code}`);
  console.log("Done. Open the dashboard to see the graph.");
  process.exit(0);
});
