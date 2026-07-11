#!/usr/bin/env bash
# Boot the hive brain + a web-only bee, then front both with Caddy on $PORT.
# If any of the three dies, exit so the host restarts the container.
set -euo pipefail

mkdir -p "$HIVE_DATA_DIR" "$BEE_DATA_DIR"

HIVE_PORT=4800 pnpm -C apps/hive-server start &
BEE_DEMO=1 BEE_PORT=4801 HIVE_WS_URL=ws://localhost:4800/ws/bee HIVE_HTTP_URL=http://localhost:4800 pnpm -C apps/bee start &
caddy run --config /etc/caddy/Caddyfile --adapter caddyfile &

wait -n
echo "a process exited — shutting down so the host can restart us"
exit 1
