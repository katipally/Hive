# Resetting Hive — wipe data for a fresh start

Like tapping **"Clear app data"** — this removes everything Hive has learned and every
connection, so it boots like a brand-new install. It does **not** touch your code.

## What data exists, and where

```
  apps/hive-server/hive-data/        ← the HIVE brain
    hive.db  (+ -wal, -shm)          knowledge graph, memories, disclosures, nudges,
                                     polls, activity log, settings, AND your encrypted
                                     provider keys + model roles
    master.key                       the key that encrypts those secrets

  apps/bee/bee-data/                 ← the BEES
    bee.json                         bee identities + CHANNEL TOKENS (Telegram/Discord/…)
    sessions/                        per-member chat transcripts
    outbox/                          queued channel deliveries
```

Cloud (Render free tier) keeps the same layout on an **ephemeral disk** — it already
wipes on every restart/redeploy and boots empty, so "resetting" the cloud is just
restarting it.

---

## Local reset

**1. Stop the app** (Ctrl-C the `pnpm dev` terminal).

**2. Delete the data** (choose one scope):

```bash
# Full nuke — hive brain + bees (fresh install)
rm -rf apps/hive-server/hive-data apps/bee/bee-data

# Only the hive brain (keep bee identities/channel tokens)
rm -rf apps/hive-server/hive-data

# Only the bees (keep the graph/memories; forget channels + transcripts)
rm -rf apps/bee/bee-data
```

**3. Restart:**

```bash
pnpm dev
```

It comes up **empty** — there's no reseed. You re-add members, re-pair, and reconnect channels.

### Heads-up when you delete `hive-data`
Your **MiniMax key and model roles live in `hive.db`** (encrypted). Deleting `hive-data`
forgets them, so after a full reset either:
- if you set `MINIMAX_API_KEY` + `HIVE_MODEL` in the environment, they **re-bake from env on
  the next boot**, or
- re-enter the key + pick MiniMax-M3 in the dashboard **Settings** tab.

Deleting `bee-data/bee.json` forgets **channel tokens** — you'll reconnect Telegram/Discord
in the **Channels** tab (this is the clean way to clear a bad/revoked Telegram token).

### One-liner (full reset + restart)
```bash
# from the repo root
pkill -f "tsx watch" ; rm -rf apps/hive-server/hive-data apps/bee/bee-data && pnpm dev
```

---

## Cloud reset (Render)

The free tier has **no persistent disk**, so runtime data is thrown away on every boot
and the instance comes back empty. To force a clean slate:

1. Render dashboard → the **hive-demo** service.
2. **Manual Deploy → Deploy latest commit** (or **Restart service**).
3. On boot it starts from an empty DB (only the provider key re-bakes from env). Done.

Nothing to delete by hand — the ephemeral disk *is* the reset. If you later attach a
**persistent disk** for accumulating memory, clear it instead via the service **Shell**:
```bash
rm -rf /var/data/hive-data /var/data/bee-data   # match your mounted disk path
```
then restart the service.

---

## What reset does NOT clear

- **External channels' own history.** Telegram/Discord keep the *chat history*
  on their side (that's the messaging app, not Hive). Hive just forgets the link + its
  own memory of the conversation.
- **The cron warm-keep job** (cron-job.org / GitHub Action) — leave it; it doesn't hold data.
- Your **`.env` / Render env vars** (keys, flags) — those are config, not data.
