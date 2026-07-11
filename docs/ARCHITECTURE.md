# Architecture

How Hive works, end to end. This describes the code as it runs, not aspirations.

## Processes

- **hive-server** (`apps/hive-server`, port 4800), the brain. A Hono HTTP API plus two
  WebSocket hubs: `/ws/bee` for bees and `/ws/dash` for dashboards. One SQLite database
  (`hive.db`).
- **bee** (`apps/bee`, port 4801), the runtime that hosts one or more bee instances and the
  channel adapters. Connects out to the hive over `/ws/bee`. Holds no provider keys.
- **hive-dash** (`apps/hive-dash`, port 5173) and **bee-ui** (`apps/bee-ui`, port 5174),   React single-page apps for the operator and the member. They talk to the servers over the
  same-origin HTTP/WS paths, so they work behind one reverse proxy in production.
- **packages/shared**, the bee↔hive protocol types, the LLM client (provider adapters +
  streaming), and the tool-using agent loop.

## Bee ↔ hive protocol

The bee opens a WebSocket to the hive and sends `hello` with its `beeId` and `beeToken`.
The hive stores the token on first contact (trust on first use) and rejects a mismatched
token afterward. From then on the bee sends:

- `identity.check` / `pair.attempt`, resolve or link a channel address (e.g. a web uid, a
  Telegram user) to a member via an invite code.
- `ingest.turn`, a conversation turn to record and learn from. The hive replies `ingest.ack`;
  unacked turns are persisted to a durable outbox on the bee's disk and replayed on reconnect,
  so a restart never drops conversation from the graph.
- `context.request`, ask the hive for grounding context before replying.
- `nudge.result`, report whether a proactive nudge was delivered.

The hive pushes `nudge.deliver`, `channel.config`, and `identity.revoked` to the bee.

## The pipeline (turn → graph)

1. **Ingest.** `ingest.turn` writes the turn to SQLite and notifies listeners (used by the
   polling system to capture replies).
2. **Debounce.** Turns queue per member; extraction fires when a member has four pending turns
   or after 45s of idle. The queue retries with backoff and re-drains on boot, so in-flight
   work survives a restart.
3. **Extraction.** The **extraction**-role model reads the member's recent turns and returns
   structured memories, entities, and relations. These are written to the graph; if an
   embeddings model is configured, memory text is embedded for vector search.
4. **Dedup + temporal invalidation.** New memories are deduplicated against existing ones
   (vector distance, or exact text if no embeddings). For a fixed set of *functional*
   relations (where a newer fact supersedes an older one), the previous edge is marked
   invalidated with a validity range rather than deleted.
5. **Implications & conclusions.** A follow-up **social**-role pass proposes higher-level
   implications; a periodic step folds memories into conclusions.

## Retrieval and grounding

When a bee asks for context, the hive runs vector K-NN over the member's memories (with a
cosine-similarity cutoff), falling back to recent memories when no embeddings model is set.
Facts owned by *other* members are never returned raw: they pass through the disclosure agent
first, and are scoped by which member a source memory belongs to, so one person's private
facts can't leak into another's context.

## Disclosure (contextual integrity)

`decideDisclosure` is called on the two paths where knowledge crosses members: cross-member
retrieval and proactive nudges. It asks the **social** model, with a dedicated prompt, to
return `share` / `partial` / `withhold`, the disclosed text, and the reasoning. Key
properties, all in code:

- **Fails closed.** Any error or unrecognised decision becomes `withhold`.
- **Honours privacy preferences.** A member's free-text privacy rule is injected into the
  prompt and must be respected.
- **Cached.** Identical (members + content + question + preference) reuse a recent verdict for
  a TTL; any change busts the cache.
- **Audited.** Every verdict is persisted and shown on the dashboard's Disclosures tab with
  its reasoning and what was withheld.

## Proactive system

A self-scheduling heartbeat reflects the current settings without a restart. Each tick:
flushes queued nudges, closes polls whose window elapsed, prunes stores, runs the group
**orchestrator** (rate-limited to a minimum gap), proposes a per-member nudge if worthwhile,
and sends a weekly digest.

Every nudge passes a funnel before delivery: proactivity mute/scale, an adaptive cooldown that
backs off on negative feedback, a 7-day per-topic dedup, the disclosure gate (for anything
about another member), an LLM compose step, and an undo/recall window. It's then delivered to
the owning member's bee over the WebSocket and recorded to that member's transcript so it
survives a refresh.

**Polling** composes an anonymised question, delivers it to members through the nudge wire,
captures their replies as they chat, synthesises a consensus, and delivers it back.

## Storage and secrets

One SQLite database (`hive-data/hive.db`) in WAL mode with foreign keys on; the schema loads
from `schema.sql` with idempotent additive migrations. Vector search uses a `sqlite-vec`
virtual table created lazily on first embedding. Provider keys live in a `secrets` table,
encrypted with AES-256-GCM using a 32-byte master key at `hive-data/master.key` (mode `0600`,
created on first boot). The API only ever returns the last four characters of a key.

## Models and providers

Four roles are resolved independently to a provider + model + key: **chat** (bee replies),
**extraction** (turn → graph), **social** (disclosure, implications, orchestration, nudge
composition, digest, poll synthesis), and **embeddings** (optional; enables vector retrieval
and dedup). Providers: Anthropic and MiniMax use the `anthropic-messages` API family; OpenAI
and Ollama use the `openai-compat` family. Reasoning effort is passed per role where the model
supports it.

## Bee internals

Each bee runs a tool-using agent loop. The tools call back into the hive: `recall` (look up
grounded context), `my_memories`, `whats_shared_about_me`, `set_privacy`, `ask_network`
(kick off a poll), and `explain_decision`. LLM completions stream through the hive's proxy
(`/api/llm/chat`) so the bee never needs a key. Channel adapters (`web`, `telegram`,
`discord`, `imessage`) share one message handler; non-web channels are claimed by a single
bee so two adapters never double-process the same inbox.
