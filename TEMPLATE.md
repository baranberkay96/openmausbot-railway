# OpenMausBot v0.1 AI Bot Team Chat: Railway template spec

## Listing

| Field | Value |
|---|---|
| Name | **OpenMausBot v0.1 AI Bot Team Chat** (`v0.1` from the GitHub release `v0.1.134`, the pinned build; upstream ships a release almost daily, so the name carries major.minor only) |
| Description | Chat with your own team of AI agents, each with its own model and tools. (72 chars, as given) |
| Category | AI/ML |
| Tags | openmausbot, ai-agents, multi-agent, claude-code, codex, chat, self-hosted, grok-bot-alternative |
| Icon | `https://cdn.jsdelivr.net/gh/milind-soni/OpenMausBot@0213b7435fc83a936f77c18475ba2a0d7b7c2de4/public/app-icon-512.png` (upstream icon at the pinned commit, HTTP 200 `image/png`) |

The description holds: every bot is an agent (Claude Code or Codex CLI) with its own model picked per bot, and its own tools (shell and files in the container, a headless browser, MCP servers, connected apps, an optional Boat cloud computer). What it does not say: the agents need a Claude or ChatGPT subscription (or an API key), connected after deploy. The README says so under Dependencies.

## Feasibility: what a bot's "computer" is

Upstream's README says each bot has "its own cloud computer". Read from the code and docs at `v0.1.134`:

| Where a bot works | What it is | On Railway |
|---|---|---|
| The server itself | The agent CLI (`claude`, `codex`) runs as a child process of the harness server, as the server's user; its shell, files and MCP servers are in that container. This is where every turn runs. | **Works**: plain processes in the service container. |
| Bot browser | `agent-browser` with a pinned Chrome for Testing, one isolated session per bot, baked into the image | **Works** (Chrome in the container; see Open questions on `/dev/shm` and the Chrome sandbox) |
| Cloud computer ("Cloud") | **Boat** (boat.dev), a hosted service: one remote Linux desktop per bot through Boat's HTTPS API (`server/boat.ts`), key `BOX_TOKEN` / Settings | **Works with a Boat API key** (outbound HTTPS only). Paid after Boat's trial. |
| Self-hosted VPS | `docker -H ssh://alias` to a Docker daemon on a VPS you own (`docs/byo-vps.md`) | Possible in principle, **not set up**: the image has no `docker` CLI or `ssh`; documented as out of scope |
| Local VM | Docker/Podman/`container` desktop containers on the same host (`server/container-computer.ts`) | **Does not work**: no Docker-in-Docker, no privileged containers on Railway |
| This computer | Cua driver controlling the desktop of the machine running the desktop app | **Does not apply** to a server (desktop app only) |
| Bot box | bubblewrap sandbox per turn, only on upstream's MausBot Cloud image (`cloud-home` target) | Not part of the server image; not used |

Verdict: **feasible**. The core product (chat, bots, rooms, routines, webhooks, connected apps, browser) is upstream's own "headless server" mode, which runs every agent as a local process; the cloud computer works through the hosted Boat API with the owner's key. Only Local VM and host control are unavailable, as on any headless server.

## Base market template

None. The Railway marketplace had no OpenMausBot template on 2026-10-30 (`templateSearch` "openmausbot", "mausbot": empty; `_market/` empty). The package is built from upstream's own deployment files: `deploy/docker-compose.yml` + `deploy/Caddyfile` (server + Caddy in one network namespace), `compose.yaml` + `deploy/local/Dockerfile` (engines baked with npm), `deploy/fly/{fly.toml,Caddyfile}` (upstream's own PaaS deployment: one machine, `/data` volume, Caddy edge with trusted proxies, restart always, 30 s kill timeout).

## Pinned versions

| Component | Source | Version | Date | Checked |
|---|---|---|---|---|
| OpenMausBot | `ghcr.io/milind-soni/openmausbot:v0.1.134@sha256:7efc06588a124d18b4188df1fa89c332b9e46efc25ab47dcb2445971f4a57ba2` (OCI index: linux/amd64 manifest `sha256:a27f2720…` + build attestation; 13 layers, 497 MB compressed) | release v0.1.134, commit `0213b7435fc83a936f77c18475ba2a0d7b7c2de4` (= image label `org.opencontainers.image.revision`) | released and built 2026-10-30 | 2026-10-30 |
| Claude Code | npm `@anthropic-ai/claude-code` | 2.1.308 (npm `stable` tag; `latest` was 2.1.314) | 2026-10-22 | 2026-10-30 |
| Codex | npm `@openai/codex` | 0.166.0 (npm `latest`) | 2026-10-29 | 2026-10-30 |
| Caddy | `caddy:2.11.7@sha256:36c24ad91a7ff7bc4c87fe22bfa8df3c4b18da0773d73fc12ee2c52b98c0bb7e` | 2.11.7 (latest GitHub release) | release 2026-10-03, image rebuilt 2026-10-30 | 2026-10-30 |

The image config (GHCR registry API, anonymous token): `User maus`, `HOME=/data`, `OMB_DATA_DIR=/data/.openmausbot`, `OMB_PORT=8799`, `OMB_WEBHOOK_PORT=8800`, `OMB_STATIC_DIR=/app/dist`, `AGENT_BROWSER_EXECUTABLE_PATH=/opt/openmausbot-browser/chrome`, `WorkingDir /app`, `Entrypoint docker-entrypoint.sh`, `Cmd node dist-server/server-launcher.js`, `VOLUME /data`, label `org.opencontainers.image.version=v0.1.134`. Its build history shows `ENGINES=` (empty): the published image has **no** agent CLIs, which is why this template adds them, the same way upstream's `compose.yaml` and `deploy/local/Dockerfile` do. The `dist-server` layer lists `server-launcher.js`, `index.js`, `openmausbot.js`, `pair-cli.js` and the `enterprise/` bundle (owned by uid/gid 1001 = `maus`).

Upstream tags every release (`v…`), every `main` push (`sha-…`) and `latest`. The service is built from `services/openmausbot/Dockerfile` (repo `baranberkay96/openmausbot-railway`, root `/services/openmausbot`). Upgrade: replace the tag and digest (and optionally `PIN_CLAUDE_CODE` / `PIN_CODEX`) and redeploy; the build fails if a route or file the wrapper relies on has moved.

## Architecture

```
 Browser / desktop app / phone ──HTTPS──► Railway edge ──► :8080 (PORT), healthcheck GET /api/health
 ┌──────────────────────────────────────────────────────────────────────────────────────────────┐
 │ OpenMausBot service (official image + railway/ wrapper)                                       │
 │ podman-init (PID 1) → node supervisor.mjs (root)                                             │
 │   checks PORT; chowns /data to maus on first boot; writes the owner password as a salted     │
 │   scrypt record (/run/omb-railway/edge/owner.json, 0400 ombedge); then starts:               │
 │   ├─ OpenMausBot (maus): node dist-server/server-launcher.js → index.js                      │
 │   │    app + API + SSE on 127.0.0.1:8799, webhook receiver on 127.0.0.1:8800                 │
 │   │    agent turns: claude / codex CLIs as child processes; agent-browser + Chrome           │
 │   │    outbound: Anthropic/OpenAI, Boat API, Composio, MCP servers, the web                  │
 │   ├─ owner sign-in (ombedge): node owner-signin.mjs on 127.0.0.1:8797                        │
 │   └─ Caddy (ombedge) on :$PORT, the only public listener:                                    │
 │        GET / without a session cookie → 302 /railway/sign-in                                 │
 │        /railway/sign-in → 8797     /hooks/* → 8800     everything else → 8799 (SSE, WS)      │
 │        sets X-Forwarded-For {client_ip} (from Railway's X-Real-IP) and X-Forwarded-Proto     │
 │ volume /data (HOME of maus): .openmausbot/ (messages.db, config.json, sessions, routines,    │
 │   webhooks, attachments, workspaces, tools/npm), .claude/ .codex/ (engine sign-ins),         │
 │   browser profiles                                                                           │
 └──────────────────────────────────────────────────────────────────────────────────────────────┘
```

One service. Upstream's self-hosted stack is the server plus Caddy sharing one network namespace (the server never binds a public interface; "the loopback-trust invariant is the auth model"). Railway cannot share a network namespace between services, so Caddy runs in the same container (Rule 3b). There is no database, queue or worker service upstream: state is SQLite/DuckDB files in the data folder, so there is nothing else to add.

### Why the edge is required, and how auth works through it

OpenMausBot decides trust per request (`server/request-auth.ts`):
- a request with any `X-Forwarded-For`, `X-Forwarded-Proto`, `X-Forwarded-Host` or `Forwarded` header is **proxied**: it never gets loopback trust and needs a paired session (cookie, bearer token or stream ticket) with the right scope;
- a request from a browser (`Sec-Fetch-Site`/`Sec-Fetch-Dest`, or a WebSocket with `Origin`) never gets loopback trust either;
- a session-less request from a program on 127.0.0.1 is the **owner** (`OMB_LOOPBACK_TRUST` unset = upstream's self-hosted default).

Caddy always sets `X-Forwarded-For` and `X-Forwarded-Proto` on what it forwards, so everything from the internet (and from other services in the project) is "remote". Caddy keeps the browser's `Host`, which OpenMausBot's same-origin and cookie checks use, and does not buffer the event stream. The pairing lockout (10 bad codes per minute per address → 1 minute) keys on the last `X-Forwarded-For` value, which Caddy sets to `{client_ip}`: Railway's edge is a trusted proxy (private and CGNAT ranges) and names the client in `X-Real-IP`.

### Owner sign-in (the "owner created before the port opens")

OpenMausBot has no user accounts and no sign-up: its login is **pairing**, a 12-character single-use code (5 minutes) minted by a program on the server (`openmausbot pair`), exchanged for a session cookie; optionally an emailed code for addresses on an allow-list (empty by default). On a fresh Railway deployment nobody could get a code without a terminal, so the template adds:

1. `OPENMAUSBOT_OWNER_PASSWORD` = `${{secret(32)}}`. Before any child starts, the supervisor validates it (12-1024 characters, no control characters; invalid = the boot stops with the reason) and writes only a salted scrypt hash (N=16384, r=8, p=1) to `/run/omb-railway/edge/owner.json`, readable by `ombedge` alone. The variable is removed from every child's environment.
2. `/railway/sign-in` (Caddy → `owner-signin.mjs`): a password form. On the right password it calls `POST /api/auth/pairing` on 127.0.0.1:8799 (loopback, no forwarded headers = owner) for an **admin** pairing code labelled "Owner sign-in (Railway)", and answers `303 /pair#code={code}`. The code travels in the URL fragment (not sent to a server, not logged); OpenMausBot's own `/pair` page exchanges it (**Connect**) for its normal session cookie (30 days, renewed while used, at most 180 days).
3. Guards: same-origin check on the POST (`Origin` / `Sec-Fetch-Site`), form content type only, 4 KiB body limit, 5 wrong passwords per client address in 15 minutes lock that address for 15 minutes, at most 30 password checks per minute overall (bounds scrypt CPU), constant-time comparison, `no-store`/CSP/`frame-ancestors 'none'` headers, password and codes never logged.
4. Empty variable = page off (it explains how to pair over `railway ssh`); the app itself still requires pairing.
5. Caddy redirects only `GET /` without any `omb_session_` cookie to the sign-in page, so the "Open app" link lands somewhere useful; `/pair` stays reachable for codes and email sign-in.

Changing the password affects new sign-ins only; sessions that already exist stay valid until revoked (Settings → Remote access, or `omb sessions revoke {id}`).

## Service: OpenMausBot

| Setting | Value |
|---|---|
| Source | repo `baranberkay96/openmausbot-railway`, root `/services/openmausbot` (Dockerfile) |
| Start | `ENTRYPOINT node /opt/omb-railway/supervisor.mjs` (no start command override) |
| Healthcheck | `GET /api/health` on `PORT=8080`, timeout 300 s. Through Caddy to the server; upstream answers `{"app":"openmausbot"}` without a session once it listens, and Caddy answers 502 until then. |
| Public domain | yes, target port 8080 |
| TCP proxy | none |
| Volume | `/data` (upstream's `HOME` and data volume) |
| Restart policy | `ALWAYS` (upstream: compose `unless-stopped`, Fly `always`). The supervisor exits when any of its three processes ends, so a crash restarts the container. |
| Replicas | 1 (SQLite and files on the volume) |
| Draining | `RAILWAY_DEPLOYMENT_DRAINING_SECONDS=30` (upstream Fly `kill_timeout = 30s`; the supervisor waits 25 s before SIGKILL) |

### Image additions (Dockerfile)

| Addition | Why |
|---|---|
| `@anthropic-ai/claude-code@2.1.308`, `@openai/codex@0.166.0` (npm, global) | The published image has no engines. Upstream's compose bakes these two by default. Settings → Engines can install newer copies into `/data/.openmausbot/tools/npm`, which come first on the engines' PATH. |
| `DISABLE_AUTOUPDATER=1` | Claude Code would try to update its root-owned global copy as `maus` and fail; updates go through Settings → Engines instead. |
| `/usr/local/bin/caddy` from `caddy:2.11.7` | Public edge (copied to a new file, which drops the image's `cap_net_bind_service`, as upstream's Dockerfile does for its own edge). |
| `ombedge` system user | Runs Caddy and the sign-in page; can read the password record. `maus` (the app and every bot shell) cannot. |
| `/opt/omb-railway/` | `supervisor.mjs`, `owner-signin.mjs`, `lib.mjs`, `omb.mjs`, `Caddyfile` (root-owned, read-only). |
| `/usr/local/bin/omb` | `railway ssh` helper: upstream's CLI (`dist-server/openmausbot.js`) as `maus` with the server's data folder and port. |
| Build checks | `node --check` on every script, `sh -n`, `caddy validate` of the Caddyfile, the Caddyfile's loopback ports, and in the upstream bundle: `server-launcher.js`, `openmausbot.js`, the `"/api/auth/pairing"` route, the `/pair#code=` link format, `isProxied`, the loopback `listen`, `OMB_PUBLIC_URL`; `maus` and `ombedge` exist and are not root. |
| No `VOLUME` instruction | Rule 8.17. The base image's own `VOLUME /data` metadata is inherited (see Open questions). |

### What the supervisor does

| Step | Effect |
|---|---|
| `PORT` | Must be 1-65535 and not 8797/8799/8800, else the boot stops. |
| `/data` | Warning when it is not a mounted volume. If its owner is not `maus` (fresh Railway volume, restored volume), `chown -R maus:maus /data` and mode 0700. Otherwise files owned by root inside it (left by commands run as root over `railway ssh`, whose `HOME` is also `/data`) are given back to `maus` (`find -xdev -user 0`). |
| Owner password | Validated and hashed as above, before anything listens. |
| OpenMausBot environment | The container's variables minus `OPENMAUSBOT_OWNER_PASSWORD`, minus `PORT` (a bot's dev server would otherwise pick the edge's port), minus **empty** variables (OpenMausBot treats a set-but-empty key variable such as `BOX_TOKEN=` as "no key" and it would override the key saved in Settings); `HOME=/data`, `OMB_PORT=8799`, `OMB_WEBHOOK_PORT=8800` forced (the edge targets them); `OMB_PUBLIC_URL` defaults to `https://$RAILWAY_PUBLIC_DOMAIN`, `OMB_WEBHOOK_PUBLIC_URL` to `OMB_PUBLIC_URL`. |
| Edge environment | Caddy: `PATH`, `HOME`, `XDG_*`, `PORT` only. Sign-in page: `PATH`, `HOME`, `NODE_ENV`, the record path only. |
| Processes | Upstream's `server-launcher.js` (unchanged, keeps upstream's in-place restart), the sign-in page, Caddy; started in that order with their own uid/gid (supplementary groups dropped). SIGTERM is passed to all three; if one exits, the others are stopped and the container exits with its code. |

### Variables

None is required at deploy.

| Variable | Default | Notes |
|---|---|---|
| `PORT` | `8080` | Caddy; healthcheck port = domain target port (Rule 8.1) |
| `OPENMAUSBOT_OWNER_PASSWORD` | `${{secret(32)}}` | Owner sign-in page; never reaches OpenMausBot or the bots |
| `OMB_PUBLIC_URL` | `https://${{RAILWAY_PUBLIC_DOMAIN}}` | Upstream variable: base of pairing links and (through the supervisor) webhook URLs |
| `BOX_TOKEN` | empty | Upstream variable: Boat API key (cloud computers). Optional; can be saved in Settings instead. A value here wins over Settings on every start. |
| `COMPOSIO_API_KEY` | empty | Upstream variable: Composio project key (connected apps). Optional; same precedence. |
| `RAILWAY_DEPLOYMENT_DRAINING_SECONDS` | `30` | Graceful stop window |

Not set on purpose:
- `OMB_LOOPBACK_TRUST`: upstream's self-hosted default (`owner`) applies. `service` closes most of the local API to bot shells but, as upstream documents, not all of it, and it also stops the owner sign-in page and `omb pair` from minting codes (sign in by email or from Settings → Remote access instead).
- `OMB_SIGNIN_EMAILS` / `OMB_SIGNIN_MEMBER_EMAILS`: when set they override the list edited in Settings → Remote access; leaving them unset keeps that list editable. Email codes come from upstream's account service (`accounts.openmausbot.com`).
- Model provider keys (`OMB_ANTHROPIC_API_KEY`, `OMB_OPENROUTER_API_KEY`, `XAI_API_KEY`, …): saved in Settings → Connections instead; the app boots without any.
- `OMB_LICENSE_KEY`: enterprise features stay off.

## Security model: what agents can access

Upstream's model for a self-hosted server is one owner whose bots act as the owner. The template keeps it and documents it; the README repeats the essentials.

**Default approval level is Full access** (`docs/approval-levels.md`): every new bot and conversation runs its engine in its most permissive mode; commands, edits, connected-app sends and computer actions run without a card. Ask for approval, Auto-accept edits and Approve for me are per-bot choices.

A bot's agent runs as `maus` in this container and can:
- read and change everything on `/data`: `messages.db`, `config.json` (every key saved in Settings, stored in plain JSON with mode 0600 for the same user), session and webhook data, other bots' folders and memory, the Claude and Codex sign-ins (`~/.claude`, `~/.codex`), browser profiles;
- call OpenMausBot's API on 127.0.0.1:8799 as the owner (owner loopback trust): change settings and keys, create pairing codes, approve cards;
- read the server process's environment (`/proc`, same user), so keys set as Railway variables (`BOX_TOKEN`, `COMPOSIO_API_KEY`) are visible; upstream strips them from the engines' own environment, but not from the filesystem view;
- reach the internet and, through Railway's private network, any other service in the same project and environment (no egress filter on the shell; the bots' *browser* has upstream's egress gate that refuses private addresses);
- use the connected apps (Composio) and Boat computers configured for it, and spend the owner's Claude/ChatGPT plan or API keys.

It cannot: read the owner password or its hash (`/run/omb-railway/edge`, `ombedge` 0700), read Caddy's or the sign-in page's environment (other user), read root's or PID 1's environment, or act on the Railway account (no Railway token in the container).

Prompt injection through a web page, an email, a webhook payload or a connected app can therefore make a Full-access bot run commands with all of the above. Upstream accepts this for a self-hosted owner (its SECURITY.md treats Full access as a standing user decision). Recommendations in the README: Ask for approval on sensitive bots, connect only the accounts the bots should use, do not keep unrelated databases in the same Railway project.

**Public without a session** (upstream design): static web app files, `/pair` and the sign-in pages, `GET /api/health` (`{"app":"openmausbot"}` only), `GET /api/brand`, `GET /.well-known/openmausbot/environment` (environment id, label, version, capabilities), `POST /api/auth/pair` (code exchange, lockout), `POST /api/auth/email/*` (only for allow-listed addresses), `/hooks/*` (per-hook secret, bearer or capability URL), the MCP OAuth callback. Everything else answers 401/403 "pair this device".

**Analytics**: optional, anonymous product events from the web page to PostHog, per browser; off in Settings → General → Usage analytics (`docs/analytics.md`).

## First login

1. Wait for the deployment to turn healthy (first build pulls a ~0.5 GB image and installs the two CLIs).
2. Open the public URL → `/railway/sign-in`. Enter `OPENMAUSBOT_OWNER_PASSWORD` from the Variables tab → OpenMausBot's `/pair` page with the code filled in → **Connect**.
3. Settings → Engines: **Sign in to Claude** (Anthropic's page, paste the code) and/or **Connect ChatGPT** (device code for Codex).
4. Optional: Settings → API keys / Connections: Boat key, Composio key, model provider keys, voice keys.
5. Create a bot, give it a model, send a message.

More devices: Settings → Remote access (phones, tablets, the desktop app's "Connect to a server…", email sign-in list), or `railway ssh` → `omb pair --label Laptop` (prints a link at `OMB_PUBLIC_URL`). `omb pair` without `--label` in a terminal starts upstream's phone wizard (client scope).

Terminal work over `railway ssh` runs as root with `HOME=/data`: use `omb …` for OpenMausBot's CLI and `su maus -s /bin/bash` for anything else (for example `claude` to sign in from a terminal). Root-owned leftovers in `/data` are handed back to `maus` on the next boot.

## Improvements over market templates

No OpenMausBot template exists on the marketplace. Compared with running upstream's image on Railway as is:
1. **Reachable at all**: the server binds 127.0.0.1 only; the template adds the edge upstream's compose provides with Caddy, with Railway-specific client-address handling for the pairing lockout.
2. **Login without a terminal**: generated owner password → one-time admin pairing code, created before the port opens; upstream otherwise needs `openmausbot pair` on the machine.
3. **Engines included and pinned** (the published image has none).
4. **Volume ownership** handled (a fresh Railway volume is root-owned; the image runs as `maus`).
5. **Secrets separated by user**: the owner password never enters the app's or the bots' environment; empty optional key variables are not passed (they would override Settings).
6. Pinned by release tag and digest, with build-time checks of every upstream hook the wrapper uses; restart always, 30 s drain, real healthcheck through the edge.
7. Documented agent access model, public surface, and what does and does not work on Railway (Boat yes, Local VM/host control no).

## Resource estimate

Railway prices: RAM $10/GB-month, vCPU $20/vCPU-month, volume $0.15/GB-month. Not measured (no container run); derived from the process set and upstream's sizing (Fly home 2 GB shared CPU; VPS guide "2 CPUs and 4 GB of RAM is plenty").

| Process | Idle RAM / CPU | Typical RAM / CPU | Notes |
|---|---|---|---|
| OpenMausBot server | 0.25-0.4 GB / 0.02-0.05 vCPU | 0.4-0.6 GB / 0.1 vCPU | 15 MB server bundle, SQLite, DuckDB, routines/webhook timers |
| Agent CLIs | 0 | 0.2-0.4 GB per running turn | Claude Code (native binary) or Codex; several bots or rooms run turns in parallel |
| Bot browser (Chrome) | 0 | 0.3-0.6 GB per active browser session | Only while a bot browses |
| Caddy + sign-in page | ~0.06 GB | ~0.06 GB | |
| Volume | ~0.1 GB after first sign-ins | 1-5 GB | Attachments cap at 512 MB by default (`OMB_ATTACHMENTS_MAX_BYTES`), browser profiles, bot workspaces, engine caches |

Estimated monthly cost: **idle ≈ $5**, **typical ≈ $15-25** (about 1-1.5 GB average RAM, 0.2-0.3 vCPU, 2-3 GB volume), heavy parallel bots with browsers $40-60. Model usage is billed by the owner's Claude/ChatGPT plan or API keys; Boat and Composio bill separately.

Minimum plan: **Hobby**. Trial's 1 GB RAM per service is too small for a turn plus a browser. Hobby's 5 GB volume fits normal use.

## Verification results (2026-10-30, no Docker)

Docker was not used. **The Dockerfile has not been built and the container has not been run.**

| Check | How | Result |
|---|---|---|
| Image tag, digest, config | GHCR registry API (anonymous token): index, amd64 manifest, config blob | `v0.1.134` → index `sha256:7efc0658…`, amd64 only, revision = tag commit `0213b74`, `ENGINES=` empty, user `maus` |
| Bundle contents | `dist-server` layer `sha256:81e67ff8…` downloaded (digest verified) and listed; `index.js` searched | entry files present; `"/api/auth/pairing"`, `/pair#code=${code}`, `function isProxied(`, `"127.0.0.1", async () =>`, `OMB_PUBLIC_URL` present (the Dockerfile's build checks) |
| Upstream behaviour the wrapper relies on | `gh api` reads of `server/request-auth.ts`, `sessions.ts`, `index.ts`, `cli.ts`, `config.ts`, `credential-env.ts`, `webhook-ingress.ts` at the tag | as described above (proxied = remote, owner loopback trust, pairing route and response, public routes, empty-env override, 127.0.0.1 listeners) |
| Engines and Caddy | npm registry metadata; Docker Hub registry HEAD; GitHub release | versions and digest as pinned |
| Scripts | `node --check` (Node 24.3) on all `.mjs`; `sh -n`, `dash -n`, `bash -n` on `omb`; `template.json` JSON parse; description length | clean; 72 chars |
| Dockerfile | every instruction known, no `VOLUME`; the `RUN` bodies extracted (continuations joined as Docker does) and parsed with `sh -n`/`dash -n`/`bash -n`; the build's file and grep checks replayed against the downloaded `dist-server` layer and the Caddyfile | clean; all checks pass |
| `lib.mjs` | 11 unit tests (`node --test`) | pass: port checks, password rules, scrypt record/verify, limiter (lockout, window, global budget, bounded map), client key, same-origin, code format, passwd parsing, env scrubbing, supervision (child exit code, SIGTERM, SIGKILL after grace, spawn failure) |
| `owner-signin.mjs` | 10 integration tests against a fake `/api/auth/pairing` on 127.0.0.1:8799 | pass: form and headers, 404/405/HEAD, cross-site and wrong content type refused before any check, wrong password 401 with nothing minted, right password → loopback POST without forwarded headers → `303 /pair#code=…`, per-address lockout, service-trust refusal explained, malformed code not passed on, 413 on large bodies, 503 while the server is down, off mode |
| `supervisor.mjs` | 5 runs of a copy with paths pointed at a temp tree and fake server/Caddy | pass: record written 0400 in a 0700 dir before start and without the password; server env without the password, `PORT` or empty variables, ports forced, public URLs derived; Caddy env minimal; clean SIGTERM; short password and bad `PORT` stop the boot before anything starts; empty password = page off; app exit 7 → container exit 7 |
| Caddyfile | reviewed against Caddy 2.11 directives; `caddy validate` runs at build time | **not executed locally** (no Caddy binary here) |
| Links and icon | curl | icon 200 `image/png` |
| Docker build, container run, Railway behaviour | | **not run (unverified)** |

## Verification checklist

- [ ] Build log: engines install, `claude --version` and `codex --version` print, `caddy validate` reports a valid configuration, all grep checks pass.
- [ ] Deploy log: `owner sign-in ready at /railway/sign-in`, `giving /data to maus (first boot …)`, `public address … https://{domain}`, upstream's start lines (`openmausbot webhook receiver on http://127.0.0.1:8800 (advertised as https://{domain})`, `local requests: owner trust (self-hosted default)`), `[owner sign-in] ready`; no `is not a mounted volume`; healthcheck `/api/health` passes.
- [ ] `curl https://{domain}/api/health` → `{"app":"openmausbot"}`; `curl https://{domain}/api/bots` → 403 "this request came through a proxy"; `curl -H 'X-Forwarded-For: 127.0.0.1' https://{domain}/api/config` → 403; `curl -I https://{domain}/` → 302 to `/railway/sign-in`.
- [ ] Wrong password → "Wrong password"; right password → `/pair#code=…` → Connect → app loads; Settings → Remote access lists "Owner sign-in (Railway)".
- [ ] Settings → Engines: Claude sign-in (paste code) and Codex device code work; a bot answers a message with each engine; a bot runs a shell command (Full access) and browses a page.
- [ ] `railway ssh`: `omb pair --label Test` prints a link at `https://{domain}/pair#code=…`; `omb sessions` lists sessions; `ls -ld /data` → `maus` 0700; `ls -l /run/omb-railway/edge` → `ombedge`; `su maus -s /bin/sh -c 'cat /run/omb-railway/edge/owner.json'` → permission denied; `tr '\0' '\n' < /proc/$(pgrep -f 'dist-server/index.js' | head -1)/environ | grep -c OPENMAUSBOT_OWNER_PASSWORD` → 0.
- [ ] Deploy logs after a few wrong pairing codes from two networks: the lockout hits only one (client addresses are distinct, i.e. Railway's `X-Real-IP` is trusted).
- [ ] Webhook: create one in a bot, `curl -X POST` its `https://{domain}/hooks/…` URL with the secret → the bot runs.
- [ ] Persistence: redeploy; the session, bots, chats, engine sign-ins and routines survive.
- [ ] Optional: set `BOX_TOKEN`, open a bot's Computer panel → a Boat desktop starts.

## Open questions

- **Never built or run by us.** Most likely failure points: the npm engine install at build time; `caddy validate` with the global `trusted_proxies`/`client_ip_headers` options; Chrome in Railway's container (`/dev/shm` size, user namespaces for its sandbox; upstream runs with `--shm-size 512m` and an init); Codex's own sandbox when a bot is not on Full access (Landlock/bubblewrap may be blocked by Railway's seccomp profile).
- Railway's edge source addresses are assumed to be in private or CGNAT ranges and `X-Real-IP` to carry the client. If not, all clients share one pairing-lockout bucket (10 bad codes per minute lock everyone for a minute) and one sign-in lockout bucket; nothing becomes less secure.
- The base image keeps `VOLUME ["/data"]` in its config. Railway rejects a `VOLUME` instruction in a Dockerfile; an inherited one is assumed fine (as for other `FROM` images with volumes).
- First boot time (data folder creation, browser identity calibration) is not measured; 300 s is a guess with margin.
- The Settings flows (Claude paste-code sign-in, ChatGPT device code, engine installs into `/data`) were read from docs and code, not exercised.
- Upstream releases about daily; image-level fixes arrive only when this template's pin is bumped.
- RAM and volume figures are estimates.
