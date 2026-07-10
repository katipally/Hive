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
  // lightweight migrations (add columns to existing DBs; ignore if already present)
  for (const stmt of ["ALTER TABLE nudges ADD COLUMN feedback INTEGER"]) {
    try {
      db.exec(stmt);
    } catch {
      /* column exists */
    }
  }
  instance = { db, vecEnabled };
  return instance;
}

export function getDb(): HiveDb {
  if (!instance) throw new Error("db not opened");
  return instance;
}
