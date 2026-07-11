PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS secrets (
  name TEXT PRIMARY KEY,
  ciphertext BLOB NOT NULL,
  iv BLOB NOT NULL,
  tag BLOB NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS members (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  timezone TEXT NOT NULL DEFAULT 'UTC',
  quiet_hours_start TEXT,
  quiet_hours_end TEXT,
  preferred_channel_identity_id TEXT,
  last_heartbeat_at INTEGER,
  opt_out_polling INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS pairing_codes (
  code TEXT PRIMARY KEY,
  member_id TEXT NOT NULL REFERENCES members(id),
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  revoked_at INTEGER
);

CREATE TABLE IF NOT EXISTS channel_identities (
  id TEXT PRIMARY KEY,
  member_id TEXT NOT NULL REFERENCES members(id),
  channel TEXT NOT NULL CHECK (channel IN ('web','telegram','discord','imessage')),
  external_id TEXT NOT NULL,
  display_name TEXT,
  bee_id TEXT,
  linked_at INTEGER NOT NULL,
  UNIQUE (channel, external_id)
);

CREATE TABLE IF NOT EXISTS bees (
  id TEXT PRIMARY KEY,
  name TEXT,
  last_seen_at INTEGER,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS turns (
  id TEXT PRIMARY KEY,
  member_id TEXT NOT NULL REFERENCES members(id),
  channel_identity_id TEXT REFERENCES channel_identities(id),
  session_id TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('user','assistant')),
  content TEXT NOT NULL,
  ts INTEGER NOT NULL,
  extracted_at INTEGER
);
CREATE INDEX IF NOT EXISTS idx_turns_pending ON turns(member_id, ts) WHERE extracted_at IS NULL;

CREATE TABLE IF NOT EXISTS entities (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  type TEXT NOT NULL,
  attrs TEXT NOT NULL DEFAULT '{}',
  member_id TEXT REFERENCES members(id),
  created_at INTEGER NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_entities_name_type ON entities(lower(name), type);

CREATE TABLE IF NOT EXISTS memories (
  id TEXT PRIMARY KEY,
  member_id TEXT NOT NULL REFERENCES members(id),
  kind TEXT NOT NULL CHECK (kind IN ('raw','abstract','conclusion')),
  text TEXT NOT NULL,
  salience REAL NOT NULL DEFAULT 0.5,
  source_turn_id TEXT REFERENCES turns(id),
  provenance TEXT NOT NULL DEFAULT '[]',
  superseded_by TEXT REFERENCES memories(id),
  created_at INTEGER NOT NULL,
  implications_at INTEGER
);
CREATE INDEX IF NOT EXISTS idx_memories_member ON memories(member_id, created_at);

CREATE TABLE IF NOT EXISTS edges (
  id TEXT PRIMARY KEY,
  src_entity_id TEXT NOT NULL REFERENCES entities(id),
  rel TEXT NOT NULL,
  dst_entity_id TEXT NOT NULL REFERENCES entities(id),
  confidence REAL NOT NULL DEFAULT 0.8,
  valid_from INTEGER,
  valid_to INTEGER,
  source_memory_id TEXT REFERENCES memories(id),
  created_at INTEGER NOT NULL,
  invalidated_at INTEGER,
  invalidated_by_memory_id TEXT REFERENCES memories(id)
);
CREATE INDEX IF NOT EXISTS idx_edges_src ON edges(src_entity_id, rel);
CREATE INDEX IF NOT EXISTS idx_edges_dst ON edges(dst_entity_id);

CREATE TABLE IF NOT EXISTS disclosures (
  id TEXT PRIMARY KEY,
  from_member_id TEXT NOT NULL REFERENCES members(id),
  to_member_id TEXT NOT NULL REFERENCES members(id),
  context TEXT NOT NULL CHECK (context IN ('chat','nudge')),
  decision TEXT NOT NULL CHECK (decision IN ('share','partial','withhold')),
  disclosed TEXT,
  withheld TEXT,
  reasoning TEXT NOT NULL,
  memory_ids TEXT NOT NULL DEFAULT '[]',
  cache_key TEXT,
  created_at INTEGER NOT NULL
);
-- NOTE: the idx_disclosures_cache index is created in db.ts AFTER the cache_key migration,
-- because on pre-existing DBs the column is added by ALTER (which runs after this file).

CREATE TABLE IF NOT EXISTS nudges (
  id TEXT PRIMARY KEY,
  member_id TEXT NOT NULL REFERENCES members(id),
  kind TEXT NOT NULL CHECK (kind IN ('event','heartbeat')),
  status TEXT NOT NULL CHECK (status IN ('proposed','queued','sent','suppressed','dismissed','failed')),
  draft TEXT,
  reasoning TEXT NOT NULL,
  source TEXT NOT NULL DEFAULT '{}',
  dedup_key TEXT NOT NULL,
  channel_identity_id TEXT REFERENCES channel_identities(id),
  created_at INTEGER NOT NULL,
  sent_at INTEGER,
  suppress_reason TEXT
);
CREATE INDEX IF NOT EXISTS idx_nudges_ledger ON nudges(member_id, dedup_key, created_at);
CREATE INDEX IF NOT EXISTS idx_nudges_cooldown ON nudges(member_id, sent_at) WHERE status = 'sent';

CREATE TABLE IF NOT EXISTS activity_log (
  id TEXT PRIMARY KEY,
  ts INTEGER NOT NULL,
  type TEXT NOT NULL,
  member_id TEXT,
  payload TEXT NOT NULL DEFAULT '{}'
);
CREATE INDEX IF NOT EXISTS idx_activity_ts ON activity_log(ts);

-- ask-your-network polling: the hive quietly asks friends 1:1 and synthesizes.
CREATE TABLE IF NOT EXISTS polls (
  id TEXT PRIMARY KEY,
  initiator_member_id TEXT REFERENCES members(id), -- null = autonomous (hive-initiated)
  topic TEXT NOT NULL,
  question TEXT NOT NULL,                            -- the underlying intent
  status TEXT NOT NULL CHECK (status IN ('collecting','synthesizing','done','cancelled')),
  anonymized INTEGER NOT NULL DEFAULT 1,
  synthesis TEXT,
  closes_at INTEGER,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_polls_status ON polls(status, created_at);

-- one row per friend asked; `answer` fills in when they reply (correlated on ingest).
CREATE TABLE IF NOT EXISTS poll_asks (
  id TEXT PRIMARY KEY,
  poll_id TEXT NOT NULL REFERENCES polls(id),
  member_id TEXT NOT NULL REFERENCES members(id),
  question TEXT NOT NULL,                            -- the anonymized question actually sent
  answer TEXT,
  delivered_at INTEGER,
  answered_at INTEGER
);
CREATE INDEX IF NOT EXISTS idx_poll_asks_open ON poll_asks(member_id, answered_at);
CREATE INDEX IF NOT EXISTS idx_poll_asks_poll ON poll_asks(poll_id);
