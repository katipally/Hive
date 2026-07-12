# Hive — setup guide

There are **two sides** to setup:

1. **Operator (you), one time.** You run the hive and connect the shared bots once.
2. **Each member, when they join.** They send a short invite code to a bot — that's it.

The hive is the server-side brain. People only ever talk to **their bee** on whatever
channel they've linked. One Telegram bot (or Discord bot) serves everyone — you do
**not** set up a bot per person.

---

## Part A — Operator setup (one time)

### 1. Run it

```bash
pnpm install
pnpm dev
```

Four things start:

| Process       | URL                     | What it is                          |
|---------------|-------------------------|-------------------------------------|
| hive-server   | http://localhost:4800   | the brain (graph, disclosure, polls)|
| bee runtime   | http://localhost:4801   | hosts bees + channel adapters       |
| dashboard     | http://localhost:5173   | operator console (you)              |
| web chat      | http://localhost:5174   | a bee you can talk to in the browser|

Open the **dashboard** at http://localhost:5173.

### 2. Models (do this first)

**Settings** tab:
1. Add a provider key (Anthropic, OpenAI-compatible, Ollama, or MiniMax). Keys are
   encrypted; only the last 4 digits are shown.
2. Assign a model to each of the three roles: **chat, extraction, social** (retrieval is
   lexical — there is no embeddings role).

Local, no cloud key: run [Ollama](https://ollama.com) and point the base URL at it.

### 3. Connect the channels — **Channels** tab

This is the one-time bot setup. Everything here runs on your **primary bee**.

**Telegram**
1. In Telegram, message **@BotFather** → `/newbot` → follow prompts.
2. Copy the **bot token** (like `123456:ABC-DEF…`).
3. Dashboard → **Channels** → Telegram → paste the token → **Connect**.

**Discord**
1. https://discord.com/developers/applications → **New Application**.
2. **Bot** tab → add a bot → copy the **token**.
3. Enable **both** privileged intents (same page): **Server Members Intent** and
   **Message Content Intent**.
4. **OAuth2 → URL Generator** → scope `bot` → open the URL → add the bot to a server you
   control, then make a **server invite link that never expires**.
5. Dashboard → **Channels** → Discord → paste the **token** and the **server invite link**
   → **Connect**. When someone joins the server, the bot DMs them to start pairing.

> **No iMessage.** Apple has no server API for iMessage, and it can't run on a hosted
> (Linux) server, so it isn't supported. Use **Telegram** for the "texts you on your
> phone" experience. See docs/CHANNELS.md.

### 4. Add members

**Members** tab → **Add member**. Each gets an invite code like `BEE-1234`. Give each
person their code plus how to reach the bot (below).

---

## Part B — Member setup (each person, when they join)

You hand them a code (`BEE-1234`) and tell them which bot to message:

| Channel   | What the member does                                              |
|-----------|------------------------------------------------------------------|
| Telegram  | Open your hive's Telegram bot, send `BEE-1234`                     |
| Discord   | Join the server via the invite link; the bot DMs you — reply `BEE-1234` |
| Web       | Open the web chat, paste `BEE-1234`                               |

The bee replies "✅ Linked!" and they can talk normally from then on. If they later
link a **second** channel with the same code, it's still one person with one memory —
they can start on Telegram and continue on the web.

---

## What members can say to their bee

| Command                | Effect                                             |
|------------------------|----------------------------------------------------|
| `/me`                  | what the hive remembers about them                 |
| `/shared`              | what the hive has shared about them with others    |
| `/forget`              | forget the last thing they said                    |
| `/private <message>`   | talk off the record — nothing is stored or shared  |
| `/nopoll`              | don't include them when gathering the group's take |
| `/privacy set <rule>`  | a standing rule the hive honors before sharing     |
| `/constitution`        | read the values the hive operates under            |
| just ask "why did you…"| the bee explains its decisions honestly            |

## Polling ("ask your network")

A member can ask their bee to check with friends ("ask everyone for gift ideas"), or
the hive decides on its own that the group has a question worth asking. Either way it
asks each friend **privately and anonymously**, synthesizes what people think, and
sends it back. Watch it live on the **Polls** tab. Members who ran `/nopoll` are never
asked; off-the-record messages never enter a poll.

## WhatsApp (not built yet)

Two paths, both deferred: **Baileys** (QR login, works without a paid API but violates
WhatsApp's ToS and can get the number banned) or the official **WhatsApp Business
Cloud API** (approved number, costs per message). The adapter is stubbed to the same
contract; pick a path before wiring it.

## Testing

`pnpm smoke` boots a throwaway hive + bee in mock mode and runs the whole flow
end-to-end (pairing, memory, disclosure, nudge delivery) — no setup needed.
