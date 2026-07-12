# Channels — how people talk to their bee from anywhere

Hive's bee is a personal AI agent. By default you chat with it in the **web chat**,
but it can also live in **Telegram** or **Discord** so a member talks
to it from their phone like texting a friend — and the hive can proactively reach out
on the same channel.

## The model (read this first)

- Channels are **operator setup, done once.** They run on the hive's **primary bee**
  (the first/oldest bee), not per-member. You connect the bot once in the dashboard →
  **Channels** tab.
- Every member then **joins the same bot** by sending their **invite code**
  (`BEE-XXXX`). That links their Telegram/Discord/phone identity to their member
  profile. After that they just chat normally; memory is unified across every channel
  they use.
- A member's invite code is on the dashboard **Members** page.

```
  member's phone ──▶ the bot (Telegram/Discord) ──▶ primary bee ──▶ hive brain
       ▲                                                                          │
       └──────────────── proactive nudge / reply (recent + frequent channel) ◀────┘
```

Only **one** bee runs a given non-web channel (first to claim it), so two bees never
double-read the same inbox.

---

## Which channel should I use?

```
  Channel    Runs on hosted (Render)?   Needs        Effort / cost
  ───────────────────────────────────────────────────────────────────────────
  Web        ✅ always on               nothing      none — the default
  Telegram   ✅ yes                     BotFather    free · recommended for hosted
                                        token
  Discord    ✅ yes                     bot token +  free · good for communities
                                        server invite
                                        + 2 intents
```

**Recommendation:** for the hosted demo (and to impress with a real "it texted me"
moment), lead with **Telegram** — one free token, no Mac, works on Render today.

**Why not iMessage?** Apple has no server API for iMessage — the only ways to send/receive
are on a Mac signed into Messages, or via a paid third-party "iMessage-as-a-service"
(LoopMessage/SendBlue, ~$20/mo). Neither fits a no-Mac hosted product, so **iMessage was
removed.** Telegram gives the same "proactive AI reaches out on my phone" effect for free.

---

## Telegram

**Operator setup (once):**
1. In Telegram, open **@BotFather** → `/newbot` → name it → pick a username ending in `bot`.
2. Copy the token (`123456:ABC-DEF…`).
3. Dashboard → **Channels → Telegram** → paste token → **Connect**. Wait for **connected**.

**How a member connects from their phone:**
1. Open the bot (`https://t.me/<yourbotusername>`) and tap **Start**.
2. The bot replies asking for an invite code → send `BEE-XXXX`.
3. Linked. Now they just text the bot normally.

**Gotchas / the `401 Unauthorized` you hit:**
- A `401 Unauthorized` (or `getUpdates failed 401`) means the **token is invalid or was
  revoked** — not a code bug. This happens if you regenerated the token in BotFather, or
  the saved token is stale. **Fix:** Channels → Telegram → **Disconnect**, then reconnect
  with a fresh BotFather token. (A revoked token now fails cleanly instead of throwing.)
- The token is stored in `apps/bee/bee-data/bee.json`. Clearing that file (see
  [RESET.md](./RESET.md)) also forgets the channel.
- Only run one bee per token; a second bee with the same token is ignored on purpose.

---

## Discord

Discord is the personal-agent-in-DMs case. **Important Discord platform rule:** a bot
can only DM a user who **shares at least one server** with it. So even though you chat
in DMs, everyone must be in a server the bot is also in first. Hive handles this: you
give it a **server invite link**, and when a new person joins that server the bot
**DMs them automatically** to start pairing.

**Operator setup (once):**
1. discord.com/developers/applications → **New Application** → name → **Create**.
2. **Bot** → under **Privileged Gateway Intents** turn **ON both**:
   **Server Members Intent** (so the bot sees people joining) and **Message Content
   Intent** (so it can read DM text) → Save.
3. **Reset Token** → copy it.
4. **OAuth2 → URL Generator** → scope `bot` → open the link → **add the bot to a server**
   (a server you control is fine). Make a server **invite link that never expires** and
   grab it too.
5. Dashboard → **Channels → Discord** → paste the **bot token** and the **server invite
   link** → **Connect**. (Hive validates the invite is real and current.)

**How a member connects:**
1. They open the **server invite link** and join the server.
2. The bot **DMs them automatically** asking for an invite code → they reply `BEE-XXXX`.
3. Linked. They chat with it in DMs from the Discord app.

Messages in server channels are ignored — it only responds in DMs (personal-agent by
design). The server exists only to satisfy Discord's "shared server" rule for DMs.

---

## Quick "is it working?" checklist

| Symptom | Cause | Fix |
|---|---|---|
| Telegram `401 Unauthorized` | bad/revoked token | reconnect with a fresh BotFather token |
| Discord bot won't DM a new joiner | Server Members Intent off | enable it in the dev portal, reconnect |
| Discord ignores DM text | Message Content Intent off | enable it in the dev portal, reconnect |
| Bot replies "send your invite code" | identity not linked yet | send `BEE-XXXX` from the Members page |
| Nothing proactive arrives | server was asleep / no linked channel | keep it warm; link a channel first |
