# NOTICE: OpenMausBot template

## Software deployed

| Component | Source | License | How it is used |
|---|---|---|---|
| OpenMausBot | https://github.com/milind-soni/OpenMausBot, release `v0.1.134` = commit `0213b7435fc83a936f77c18475ba2a0d7b7c2de4` (2026-10-30); image `ghcr.io/milind-soni/openmausbot:v0.1.134@sha256:7efc06588a124d18b4188df1fa89c332b9e46efc25ab47dcb2445971f4a57ba2` | Apache License 2.0, Copyright 2026 Milind Soni and OpenMausBot contributors (repository `LICENSE`, `NOTICE`), except `enterprise/`, which is source-available under the OpenMausBot Enterprise License | Used unmodified as the base image. The published image also contains the bundled `enterprise/` layer; it stays inactive without a license key, and this template sets none (`OMB_LICENSE_KEY` is not used). Third-party software inside the image (Chrome for Testing, agent-browser, DuckDB, Node.js, Debian packages, the components listed in upstream's `NOTICE` and `third_party/`) keeps its own licenses. |
| Claude Code CLI | npm `@anthropic-ai/claude-code@2.1.308` | Anthropic's terms (see the package README) | Installed into the image with npm, unmodified, as upstream's compose does. Using it requires the owner's own Anthropic account or API key. |
| Codex CLI | npm `@openai/codex@0.166.0` | Apache License 2.0 (OpenAI) | Installed into the image with npm, unmodified. Using it requires the owner's own ChatGPT plan. |
| Caddy | Docker Hub `caddy:2.11.7@sha256:36c24ad91a7ff7bc4c87fe22bfa8df3c4b18da0773d73fc12ee2c52b98c0bb7e` | Apache License 2.0 | The `caddy` binary is copied out of the official image (copying drops its file capability) and runs the template's own Caddyfile. |

OpenMausBot, MausBot and the mascot are trademarks of Supamaus Software Private Limited (upstream `LICENSING.md`). The names identify the software this template deploys, unchanged; the listing icon is upstream's `public/app-icon-512.png`, loaded from the repository at the pinned commit. This is a community template and is not affiliated with or endorsed by OpenMausBot, Supamaus Software, Boat, Composio, Anthropic or OpenAI. Boat and Composio are third-party services with their own accounts, terms and charges.

## Template files

All template files were written for this package: TEMPLATE.md, template.json, README.md, this NOTICE, `services/openmausbot/Dockerfile` and `services/openmausbot/railway/` (`supervisor.mjs`, `owner-signin.mjs`, `lib.mjs`, `omb.mjs`, `omb`, `Caddyfile`). No upstream file or text was copied into them.

The Caddyfile follows the proxy rules upstream documents (keep `Host`, set `X-Forwarded-For` and `X-Forwarded-Proto`, do not buffer the event stream, route `/hooks/*` to the webhook receiver) and the idea of copying the Caddy binary to drop its file capability comes from upstream's Dockerfile; both were re-written here, not copied. The owner sign-in page and `omb` call OpenMausBot's own HTTP API (`POST /api/auth/pairing`) and command line (`dist-server/openmausbot.js`) at runtime.

Apache License 2.0 text: https://github.com/milind-soni/OpenMausBot/blob/v0.1.134/LICENSE
Upstream NOTICE: https://github.com/milind-soni/OpenMausBot/blob/v0.1.134/NOTICE
Enterprise License: https://github.com/milind-soni/OpenMausBot/blob/v0.1.134/enterprise/LICENSE

## Upstream files checked (tag `v0.1.134`, checked 2026-10-30)

- Deployment: `Dockerfile` (stages `edge`, `build`, `runtime`, `cloud-home`, `server`), `compose.yaml`, `.env.example`, `.dockerignore`, `deploy/docker-compose.yml`, `deploy/Caddyfile`, `deploy/.env.example`, `deploy/local/{Dockerfile,Caddyfile,README.md}`, `deploy/fly/{fly.toml,Caddyfile}`, `deploy/podman/{Containerfile,compose.yaml,Caddyfile,README.md}`
- Documentation: `README.md`, `SECURITY.md`, `LICENSING.md`, `NOTICE`, `enterprise/LICENSE`, `docs/self-hosting.md`, `docs/deploy-vps.md`, `docs/byo-vps.md`, `docs/bot-box.md`, `docs/computer-use-integration.md`, `docs/approval-levels.md`, `docs/analytics.md`, `docs/composio.md`
- Server source: `server/request-auth.ts` (loopback trust, proxied requests, session scopes, client allow-list), `server/sessions.ts` (pairing code format and lifetime, session terms, lockout), `server/index.ts` (listen addresses, public routes, `/api/health`, `POST /api/auth/pairing`, public URL handling, webhook receiver), `server/cli.ts` and `server/cli-pairing.ts` (`pair`, `sessions`), `server/pair-cli.ts`, `server/server-launcher.ts`, `server/config.ts` (environment variables that override Settings), `server/credential-env.ts` (what engines never inherit), `server/boat.ts`, `server/container-computer.ts`, `server/webhook-ingress.ts`, `server/engine-install.ts`, `server/engine-homes/layout.ts`, `server/standalone-releases.ts`
- Image: GHCR index, linux/amd64 manifest and config for the pinned digest (user `maus`, `HOME=/data`, `OMB_*` defaults, entry `node dist-server/server-launcher.js`, revision label = the tag's commit); the `dist-server` layer (`sha256:81e67ff8…`) was downloaded and listed to confirm `server-launcher.js`, `index.js`, `openmausbot.js` and the bundled routes the build checks for (nothing from it is redistributed).

## Market templates reviewed

None: the Railway marketplace had no OpenMausBot template on 2026-10-30 (`templateSearch` for "openmausbot" and "mausbot" returned nothing), and `_market/` for this app is empty.
