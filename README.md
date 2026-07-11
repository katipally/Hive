# Hive 🐝

Social intelligence for a group of people. Each member talks to their own **Bee** — a
personal AI agent — over web chat, Telegram, Discord, or iMessage. Behind every bee sits
one shared **Hive**: it receives each conversation turn, builds a temporal knowledge graph
of what it learns, and proactively connects people. A contextual-integrity **disclosure
agent** decides what may cross between members, so the hive can be useful to everyone
without leaking what should stay private.

Everything runs locally. Provider API keys are entered in the dashboard and encrypted at
rest — no `.env`, no plaintext secrets on disk.

## The pieces

| Part | What it is |
|------|------------|
| **Hive server** | The brain. HTTP API + WebSockets, SQLite knowledge graph, extraction/disclosure/proactive pipelines. |
| **Hive dashboard** (website) | The operator console: view the graph, disclosures, proactive activity, members, channels, and model settings. |
| **Bee runtime** | Hosts the bees and the channel adapters (web/Telegram/Discord/iMessage). Holds no API keys — it proxies LLM calls through the hive. |
| **Bee chat** (website) | Where a member actually talks to their bee: streaming chat, multiple conversations, voice mode. |

## What it does

- **Temporal knowledge graph.** Every turn is extracted by an LLM into memories, entities,
  and relations stored in SQLite (`better-sqlite3` + `sqlite-vec`). Facts carry validity
  ranges: when something changes ("moved to Berlin"), the superseded relation is invalidated
  rather than deleted, so the graph has history.
- **Contextual-integrity disclosure.** Whenever one member's knowledge could reach another
  (in a reply or a proactive nudge), a dedicated agent decides `share` / `partial` /
  `withhold`. It fails closed on error, honours each member's free-text privacy preferences,
  and every decision is logged with the model's reasoning and what was withheld.
- **Proactive connection.** A heartbeat runs the social layer: an orchestrator scans the
  group for introductions worth making, per-member nudges surface things you'd want to know,
  and a weekly digest summarises a member's week. Nudges are rate-limited, deduplicated,
  quiet-hours-aware, and delivered out-of-band to the right person's bee.
- **Ask your network (polls).** The hive can pose an anonymised question across members,
  collect replies through their bees, and synthesise a consensus back — gossip as a
  coordination tool, with attribution stripped.
- **Multiple channels.** Web chat is always on. Telegram and Discord connect with a bot
  token; iMessage (macOS) reads `~/Library/Messages/chat.db` and sends via AppleScript.
- **Bring your own model.** Anthropic, MiniMax, OpenAI-compatible endpoints, and local
  Ollama are supported. Four roles are assigned independently: **chat**, **extraction**,
  **social**, and **embeddings**.
- **Privacy & security.** Keys are AES-256-GCM encrypted (`hive-data/master.key`, `0600`).
  Bees never hold keys. Unknown senders are refused until paired. Servers bind `127.0.0.1`.

## Using the Hive dashboard

The operator console. Its tabs map to real endpoints on the hive server:

- **Knowledge graph** — the 3D graph of members, entities, and relations. Filter by member,
  search, inspect a node, or delete memories/entities.
- **Proactive** — pending and sent nudges, a live activity feed, and shared interests across
  members. "Find connections" triggers an orchestrator pass on demand.
- **Polls** — create an ask-your-network poll, watch replies land, and synthesise the result.
- **Disclosures** — the audit log of every cross-member decision (share/partial/withhold)
  with reasoning.
- **Members** — add members, copy their `BEE-XXXX` invite code, and set per-bee persona,
  proactivity, quiet hours, and timezone.
- **Channels** — connect Telegram/Discord/iMessage and see live adapter health.
- **Settings** — add provider keys (only the last 4 digits are ever shown) and assign a model
  to each of the four roles.

## Using the Bee chat

Where a member talks to their bee:

- **Pair once.** Paste your `BEE-XXXX` code (from the dashboard's Members tab) as a chat
  message; the bee links this session to you and greets you by name.
- **Chat.** Replies stream token by token. The bee grounds itself in the hive: it recalls
  what it knows before answering and refuses to invent facts.
- **Multiple conversations.** Each profile keeps separate named threads; history is stored
  server-side so it survives a refresh or a new device.
- **Voice mode.** Speech-to-text and text-to-speech via the browser Web Speech API, with a
  mic-reactive orb.
- **Slash commands.** `/me` (what the bee remembers about you), `/shared` (what it has shared
  with others), `/forget` (drop the last thing), `/private <message>` (off the record — not
  stored), `/nopoll` / `/pollme` (opt out of / into group polls), `/privacy set <rule>` (a
  standing rule the disclosure agent must honour), `/constitution`, `/help`.

## Run it locally

```bash
pnpm install
pnpm dev          # hive-server :4800, bee :4801, dashboard :5173, bee chat :5174
```

Then open the dashboard at **http://localhost:5173**:

1. **Settings** → add a provider key, **Fetch models**, and assign the four roles.
   (Local Ollama needs no key.)
2. **Members** → add a member and copy their `BEE-XXXX` code.
3. Open the bee chat at **http://localhost:5174**, send the code to link, and talk. Watch the
   **Graph**, **Disclosures**, and **Proactive** tabs fill in.

Seed a graph without conversations: `pnpm -C apps/hive-server seed`.

## More docs

- **[docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)** — how the pipeline, disclosure, and
  proactive systems actually work, with the data flow.
- **[docs/HOSTING.md](docs/HOSTING.md)** — the hosted-demo build (single container behind
  Caddy) and the current Render deployment.
- **[docs/SETUP.md](docs/SETUP.md)** — operator and per-member setup, including channel bots.
