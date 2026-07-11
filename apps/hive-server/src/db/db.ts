import Database from "better-sqlite3";
import { readFileSync, mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { normName } from "../graph/entity-resolve.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

export interface HiveDb {
  db: Database.Database;
}

let instance: HiveDb | null = null;

export function openDb(dataDir: string): HiveDb {
  if (instance) return instance;
  mkdirSync(dataDir, { recursive: true });
  const db = new Database(join(dataDir, "hive.db"));
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");

  db.exec(readFileSync(join(__dirname, "schema.sql"), "utf8"));
  // Additive column migrations for pre-existing DBs (fresh DBs already have them from
  // schema.sql). Idempotent: swallow ONLY "duplicate column" and surface every other error
  // instead of hiding a real schema failure. ponytail: a single-file SQLite dev app doesn't
  // need a versioned migration framework — add the next ALTER here.
  for (const stmt of [
    "ALTER TABLE nudges ADD COLUMN feedback INTEGER",
    "ALTER TABLE members ADD COLUMN opt_out_polling INTEGER NOT NULL DEFAULT 0",
    "ALTER TABLE memories ADD COLUMN implications_at INTEGER",
    "ALTER TABLE disclosures ADD COLUMN cache_key TEXT",
    "ALTER TABLE entities ADD COLUMN norm TEXT",
  ]) {
    try {
      db.exec(stmt);
    } catch (e) {
      if (!/duplicate column name/i.test((e as Error).message)) throw e;
    }
  }
  // Indexes on migrated columns must be created AFTER the ALTERs above (schema.sql runs
  // before them, so a column added by migration isn't there yet when schema.sql executes).
  db.exec(
    "CREATE INDEX IF NOT EXISTS idx_disclosures_cache ON disclosures(from_member_id, to_member_id, cache_key, created_at)",
  );
  db.exec("CREATE INDEX IF NOT EXISTS idx_entities_norm ON entities(norm, type)");
  // SQLite can't ALTER a CHECK constraint, so rebuild the nudges table when its kind-check
  // predates a newer kind (e.g. 'errand'). Nothing references nudges by FK, so this is safe.
  const nudgesSql = (db.prepare("SELECT sql FROM sqlite_master WHERE name='nudges'").get() as { sql: string } | undefined)?.sql ?? "";
  if (nudgesSql && !nudgesSql.includes("'errand'")) {
    db.transaction(() => {
      db.exec(`CREATE TABLE nudges_new (
        id TEXT PRIMARY KEY,
        member_id TEXT NOT NULL REFERENCES members(id),
        kind TEXT NOT NULL CHECK (kind IN ('event','heartbeat','errand')),
        status TEXT NOT NULL CHECK (status IN ('proposed','queued','sent','suppressed','dismissed','failed')),
        draft TEXT, reasoning TEXT NOT NULL, source TEXT NOT NULL DEFAULT '{}',
        dedup_key TEXT NOT NULL, channel_identity_id TEXT REFERENCES channel_identities(id),
        created_at INTEGER NOT NULL, sent_at INTEGER, suppress_reason TEXT, feedback INTEGER
      )`);
      db.exec(`INSERT INTO nudges_new (id,member_id,kind,status,draft,reasoning,source,dedup_key,channel_identity_id,created_at,sent_at,suppress_reason,feedback)
        SELECT id,member_id,kind,status,draft,reasoning,source,dedup_key,channel_identity_id,created_at,sent_at,suppress_reason,feedback FROM nudges`);
      db.exec("DROP TABLE nudges");
      db.exec("ALTER TABLE nudges_new RENAME TO nudges");
      db.exec("CREATE INDEX IF NOT EXISTS idx_nudges_ledger ON nudges(member_id, dedup_key, created_at)");
      db.exec("CREATE INDEX IF NOT EXISTS idx_nudges_cooldown ON nudges(member_id, sent_at) WHERE status = 'sent'");
    })();
    console.log("[db] migrated nudges table to allow the 'errand' kind");
  }
  // Backfill the normalized name for entities created before resolution existed.
  {
    const rows = db.prepare("SELECT id, name FROM entities WHERE norm IS NULL").all() as { id: string; name: string }[];
    if (rows.length) {
      const upd = db.prepare("UPDATE entities SET norm=? WHERE id=?");
      db.transaction(() => rows.forEach((r) => upd.run(normName(r.name), r.id)))();
    }
  }
  // Backfill the lexical index for memories created before FTS existed (or on an older DB).
  const ftsCount = (db.prepare("SELECT count(*) c FROM memories_fts").get() as { c: number }).c;
  const memCount = (db.prepare("SELECT count(*) c FROM memories").get() as { c: number }).c;
  if (ftsCount === 0 && memCount > 0) {
    const rows = db.prepare("SELECT id, member_id, text FROM memories").all() as { id: string; member_id: string; text: string }[];
    const ins = db.prepare("INSERT INTO memories_fts(memory_id, member_id, text) VALUES(?,?,?)");
    db.transaction(() => rows.forEach((r) => ins.run(r.id, r.member_id, r.text)))();
    console.log(`[db] backfilled lexical index for ${rows.length} memories`);
  }
  instance = { db };
  return instance;
}

export function getDb(): HiveDb {
  if (!instance) throw new Error("db not opened");
  return instance;
}
