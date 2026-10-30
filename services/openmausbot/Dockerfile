# syntax=docker/dockerfile:1
#
# OpenMausBot v0.1.134 on Railway.
#
# The official server image (ghcr.io/milind-soni/openmausbot, the Dockerfile's `server` target: harness server,
# web app, the bots' browser) is used unchanged. This layer adds:
#   - the Claude Code and Codex CLIs, pinned (the published image ships no engines; upstream's compose adds them
#     the same way, with npm at build time);
#   - Caddy as the public edge on $PORT, because OpenMausBot only ever listens on 127.0.0.1 and treats every
#     request through a proxy as remote (upstream runs Caddy in the same network namespace for the same reason);
#   - railway/: a root supervisor that hands the volume to `maus`, a small owner sign-in page that turns
#     OPENMAUSBOT_OWNER_PASSWORD into a one-time pairing code, and `omb` for `railway ssh`.
#
# Pins (checked 2026-10-30):
#   OpenMausBot v0.1.134 = commit 0213b7435fc83a936f77c18475ba2a0d7b7c2de4, image built 2026-10-30, linux/amd64 only.
#   Caddy 2.11.7 (Docker Hub library/caddy index digest).
#   Claude Code 2.1.308 (npm "stable" tag, 2026-10-22), Codex 0.166.0 (npm "latest", 2026-10-29).
# Upgrade: change the tag and digest below (and the engine pins if you like), redeploy; the RUN checks fail the
# build if the upstream files or routes this wrapper relies on have moved. Everything stateful is on /data.
# Persistence is declared in template.json (Railway volume at /data); this file declares no Docker volume.

FROM caddy:2.11.7@sha256:36c24ad91a7ff7bc4c87fe22bfa8df3c4b18da0773d73fc12ee2c52b98c0bb7e AS edge
# Copying to a new file drops the image's cap_net_bind_service file capability; the edge uses an unprivileged port.
RUN cp /usr/bin/caddy /caddy

FROM ghcr.io/milind-soni/openmausbot:v0.1.134@sha256:7efc06588a124d18b4188df1fa89c332b9e46efc25ab47dcb2445971f4a57ba2

USER root

# Engine CLIs (npm packages, as upstream's compose bakes them). PIN_ prefix: Railway passes service variables as
# build arguments, and these names cannot collide with a tool's own settings.
ARG PIN_CLAUDE_CODE=2.1.308
ARG PIN_CODEX=0.166.0
RUN export HOME=/tmp/omb-build-home \
 && npm install -g --no-fund --no-audit --cache /tmp/omb-npm-cache \
      "@anthropic-ai/claude-code@${PIN_CLAUDE_CODE}" "@openai/codex@${PIN_CODEX}" \
 && claude --version \
 && codex --version \
 && rm -rf /tmp/omb-build-home /tmp/omb-npm-cache /tmp/node-compile-cache

COPY --from=edge /caddy /usr/local/bin/caddy
COPY railway/lib.mjs railway/supervisor.mjs railway/owner-signin.mjs railway/omb.mjs railway/Caddyfile /opt/omb-railway/
COPY railway/omb /usr/local/bin/omb

# Engines update themselves only through Settings -> Engines (into /data); the global copies are root's.
ENV DISABLE_AUTOUPDATER=1 \
    PORT=8080

# `ombedge` runs Caddy and the sign-in page: it can read the owner password record, `maus` (the app and every bot
# shell) cannot. The checks below fail the build, not the first boot, when an upstream hook has moved.
RUN set -eu; \
    useradd --system --no-create-home --home-dir /nonexistent --shell /usr/sbin/nologin ombedge; \
    chown -R root:root /opt/omb-railway /usr/local/bin/omb /usr/local/bin/caddy; \
    chmod 0755 /opt/omb-railway /usr/local/bin/omb /usr/local/bin/caddy; \
    chmod 0644 /opt/omb-railway/*; \
    for f in lib supervisor owner-signin omb; do node --check "/opt/omb-railway/$f.mjs"; done; \
    sh -n /usr/local/bin/omb; \
    caddy version; \
    HOME=/tmp/caddy-check XDG_DATA_HOME=/tmp/caddy-check XDG_CONFIG_HOME=/tmp/caddy-check PORT=8080 \
      caddy validate --config /opt/omb-railway/Caddyfile --adapter caddyfile; \
    rm -rf /tmp/caddy-check; \
    for port in 8797 8799 8800; do grep -q "127.0.0.1:$port" /opt/omb-railway/Caddyfile; done; \
    d=/app/dist-server; \
    test -f "$d/server-launcher.js"; \
    test -f "$d/openmausbot.js"; \
    grep -qF '"/api/auth/pairing"' "$d/index.js"; \
    grep -qF '/pair#code=${code}' "$d/index.js"; \
    grep -qF 'function isProxied(' "$d/index.js"; \
    grep -qF '"127.0.0.1", async () =>' "$d/index.js"; \
    grep -qF 'OMB_PUBLIC_URL' "$d/index.js"; \
    test "$(id -u maus)" != 0; \
    test "$(id -u ombedge)" != 0; \
    test -d /app/dist

EXPOSE 8080

# Railway's podman-init is PID 1 and reaps exited browser processes; the supervisor is its child.
ENTRYPOINT ["node", "/opt/omb-railway/supervisor.mjs"]
CMD []
