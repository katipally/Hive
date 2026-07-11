# Single-origin demo image: hive-server + bee (web channel) behind Caddy, with the
# dashboard and web-chat served as static builds. One container, one public port.
# The macOS-only iMessage channel and the Telegram/Discord bot channels are NOT
# part of the hosted build — they're local-operator features.
FROM node:22-bookworm

# pnpm via corepack
RUN corepack enable && corepack prepare pnpm@11.5.2 --activate

WORKDIR /app
COPY . .

# install everything (devDeps included — the servers run via tsx, native modules
# better-sqlite3/sqlite-vec compile here)
RUN pnpm install --frozen-lockfile

# build the two SPAs. bee-ui is served under /chat and talks to the bee at /bee-api
# so it never collides with the dashboard's own /api (which points at the hive).
RUN pnpm -C apps/hive-dash build \
 && VITE_BEE_API=/bee-api pnpm -C apps/bee-ui exec vite build --base=/chat/ \
 && mkdir -p /srv/dash /srv/chat \
 && cp -r apps/hive-dash/dist/. /srv/dash/ \
 && cp -r apps/bee-ui/dist/. /srv/chat/

# Caddy: download the raw static binary. (The official caddy image sets file
# capabilities on its binary, which Render's sandboxed runtime refuses to exec
# — "Operation not permitted"/status 126. A plain download carries no caps, and
# we bind $PORT rather than a privileged port, so none are needed.)
ARG CADDY_VERSION=2.11.4
RUN curl -fsSL "https://github.com/caddyserver/caddy/releases/download/v${CADDY_VERSION}/caddy_${CADDY_VERSION}_linux_amd64.tar.gz" \
      | tar -xz -C /usr/bin caddy \
 && chmod +x /usr/bin/caddy
COPY docker/Caddyfile /etc/caddy/Caddyfile
COPY docker/entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh

ENV PORT=8080 HIVE_DATA_DIR=/data/hive BEE_DATA_DIR=/data/bee
EXPOSE 8080
CMD ["/entrypoint.sh"]
