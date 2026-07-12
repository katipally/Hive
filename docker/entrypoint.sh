#!/usr/bin/env bash
# Boot the hive brain + a web-only bee, then front both with Caddy on $PORT.
# If any of the three dies, exit so the host restarts the container.
set -euo pipefail

mkdir -p "$HIVE_DATA_DIR" "$BEE_DATA_DIR"

HIVE_PORT=4800 pnpm -C apps/hive-server start &
BEE_PORT=4801 HIVE_WS_URL=ws://localhost:4800/ws/bee HIVE_HTTP_URL=http://localhost:4800 pnpm -C apps/bee start &

# Wait for both backends to accept connections before fronting them with Caddy, so we
# don't return a flood of 502s during the boot window.
wait_port() {
  for _ in $(seq 1 60); do
    if (exec 3<>"/dev/tcp/127.0.0.1/$1") 2>/dev/null; then exec 3>&-; return 0; fi
    sleep 1
  done
}
wait_port 4800
wait_port 4801

caddy run --config /etc/caddy/Caddyfile --adapter caddyfile &

wait -n
echo "a process exited — shutting down so the host can restart us"
exit 1
