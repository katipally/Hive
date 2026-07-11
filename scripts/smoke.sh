#!/usr/bin/env bash
# Self-contained smoke test against a REAL model. Boots hive + bee on ALTERNATE
# ports (4900/4901, so it never clobbers a running `pnpm dev`) against throwaway
# data dirs, seeds a real provider key + model roles, runs the end-to-end test,
# and tears everything down.
#
# Requires:  HIVE_TEST_API_KEY=sk-...   (skips cleanly if unset)
# Optional:  HIVE_TEST_PROVIDER (default anthropic), HIVE_TEST_MODEL (default a cheap model).
set -uo pipefail
cd "$(dirname "$0")/.."

KEY="${HIVE_TEST_API_KEY:-${ANTHROPIC_API_KEY:-}}"
if [ -z "$KEY" ]; then
  echo "⏭  smoke skipped — set HIVE_TEST_API_KEY (or ANTHROPIC_API_KEY) to run against a real model."
  exit 0
fi
PROVIDER="${HIVE_TEST_PROVIDER:-anthropic}"
MODEL="${HIVE_TEST_MODEL:-claude-haiku-4-5-20251001}"

TMP="$(mktemp -d)"
HIVE_PID=""; BEE_PID=""
HP=4900; BP=4901

cleanup() {
  [ -n "$HIVE_PID" ] && kill "$HIVE_PID" 2>/dev/null
  [ -n "$BEE_PID" ] && kill "$BEE_PID" 2>/dev/null
  # belt-and-suspenders: reap anything still holding the throwaway ports
  lsof -ti tcp:$HP -sTCP:LISTEN 2>/dev/null | xargs kill 2>/dev/null || true
  lsof -ti tcp:$BP -sTCP:LISTEN 2>/dev/null | xargs kill 2>/dev/null || true
  rm -rf "$TMP"
}
trap cleanup EXIT

export HIVE_DATA_DIR="$TMP/hive"
export BEE_DATA_DIR="$TMP/bee"
export HIVE_PORT=$HP
export BEE_PORT=$BP
export HIVE_WS_URL="ws://localhost:$HP/ws/bee"
export HIVE_HTTP_URL="http://localhost:$HP"

echo "· booting hive (real model, port $HP) …"
pnpm -C apps/hive-server start >"$TMP/hive.log" 2>&1 & HIVE_PID=$!
echo "· booting bee (port $BP) …"
pnpm -C apps/bee start >"$TMP/bee.log" 2>&1 & BEE_PID=$!

wait_health() { # url name logfile
  local i=0
  until curl -sf "$1" >/dev/null 2>&1; do
    i=$((i+1)); [ "$i" -gt 150 ] && { echo "✗ $2 never came up:"; tail -20 "$3"; return 1; }
    sleep 0.2
  done
}
wait_health "http://localhost:$HP/api/health" hive "$TMP/hive.log" || exit 1
wait_health "http://localhost:$BP/api/health" bee "$TMP/bee.log" || exit 1

echo "· seeding provider key + model roles ($PROVIDER / $MODEL) …"
api() { curl -sf -H 'content-type: application/json' "$@" >/dev/null; }
api -X PUT "http://localhost:$HP/api/providers/$PROVIDER/key" -d "{\"key\":\"$KEY\"}" || { echo "✗ key seed failed"; exit 1; }
for role in chat extraction social; do
  api -X PUT "http://localhost:$HP/api/settings/roles/$role" -d "{\"provider\":\"$PROVIDER\",\"modelId\":\"$MODEL\"}" || { echo "✗ role $role seed failed"; exit 1; }
done

echo "· running smoke …"
SMOKE_HIVE="http://localhost:$HP" SMOKE_BEE="http://localhost:$BP" \
  pnpm -C apps/hive-server exec tsx scripts/smoke.ts
