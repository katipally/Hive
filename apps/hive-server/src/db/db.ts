import Database from "better-sqlite3";
import * as sqliteVec from "sqlite-vec";
import { readFileSync, mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));

export interface HiveDb {
  db: Database.Database;
  vecEnabled: boolean;
}

let instance: HiveDb | null = null;

export function openDb(dataDir: string): HiveDb {
  if (instance) return instance;
  mkdirSync(dataDir, { recursive: true });
  const db = new Database(join(dataDir, "hive.db"));
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");

  let vecEnabled = false;
  try {
    sqliteVec.load(db);
    vecEnabled = true;
  } catch (e) {
    // Vector search disabled — retrieval falls back to LIKE. See risks §1.
    console.warn(`[db] sqlite-vec unavailable, vector search disabled: ${(e as Error).message}`);
  }

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
  instance = { db, vecEnabled };
  return instance;
}

export function getDb(): HiveDb {
  if (!instance) throw new Error("db not opened");
  return instance;
}
