import { getDb } from "./db.js";

// Tiny persistent key-value store for cross-restart runtime state (rate-limit windows,
// last-run timestamps) that used to live in module-level variables and reset to 0 on
// every Render cold-start. ponytail: one table, string values; callers encode as needed.

export function getKV(key: string): string | null {
  const r = getDb().db.prepare("SELECT value FROM kv WHERE key=?").get(key) as { value: string } | undefined;
  return r?.value ?? null;
}

export function setKV(key: string, value: string): void {
  getDb()
    .db.prepare(
      "INSERT INTO kv(key,value,updated_at) VALUES(?,?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value, updated_at=excluded.updated_at",
    )
    .run(key, value, Date.now());
}

export function getKVNum(key: string): number | null {
  const v = getKV(key);
  return v == null ? null : Number(v);
}

export function setKVNum(key: string, n: number): void {
  setKV(key, String(n));
}
