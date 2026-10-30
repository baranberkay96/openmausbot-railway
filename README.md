# Deploy and Host OpenMausBot with Railway

[![Deploy on Railway](https://railway.com/button.svg)](https://railway.com/deploy/openmausbot-v01-ai-bot-team-chat?referralCode=20H68q)

OpenMausBot is an open-source chat app where every contact is an AI agent: Claude Code or Codex with its own personality, model, tools and connected apps. This template runs OpenMausBot v0.1.134 as an always-on server on Railway, behind a login that exists before the app goes online.

## About Hosting OpenMausBot

OpenMausBot is one server process: it serves the web app, runs each bot's agent CLI, keeps transcripts, routines and webhooks, and gives bots a headless browser. It only listens on loopback and its login is pairing, a one-time code made on the server itself. This community template uses the official image unchanged, adds the Claude Code and Codex CLIs, and puts Caddy in front as the public edge. A small owner sign-in page turns a generated password into a pairing code, so you never need a terminal to get in. Everything is stored on a volume at `/data`.

## Common Use Cases

- A small team of specialist bots (research, writing, coding, operations) you message like contacts, each on the model that suits it
- Scheduled routines and webhook-triggered jobs that keep running while every laptop is closed
- Bots that work in Gmail, Slack, GitHub, Notion and hundreds of other apps through Composio
- Bots with their own cloud Linux desktop (Boat) for computer-use tasks you can watch and take over
- One shared workspace you open from a browser, the desktop app or a phone

## Dependencies for OpenMausBot Hosting

- A Claude subscription (Claude Code) or a ChatGPT plan (Codex), signed in after deploy in **Settings → Engines**. API keys (Anthropic, OpenRouter and other OpenAI-compatible providers) work too, billed per token.
- A Railway volume at `/data` (included)
- Optional: a Boat (boat.dev) API key for the bots' cloud computers, paid after Boat's trial
- Optional: a Composio project key for connected apps

### Deployment Dependencies

- OpenMausBot repository (Apache-2.0): https://github.com/milind-soni/OpenMausBot
- Release v0.1.134: https://github.com/milind-soni/OpenMausBot/releases/tag/v0.1.134
- Container image: https://github.com/milind-soni/OpenMausBot/pkgs/container/openmausbot
- Self-hosting reference: https://github.com/milind-soni/OpenMausBot/blob/v0.1.134/docs/self-hosting.md
- Approval levels: https://github.com/milind-soni/OpenMausBot/blob/v0.1.134/docs/approval-levels.md
- Boat API keys: https://docs.boat.dev/api-keys
- Composio setup: https://github.com/milind-soni/OpenMausBot/blob/v0.1.134/docs/composio.md

### Implementation Details

| Service | Source | Purpose |
|---|---|---|
| OpenMausBot | Dockerfile in `services/openmausbot` on `ghcr.io/milind-soni/openmausbot:v0.1.134` (pinned by digest) + Claude Code 2.1.308 + Codex 0.166.0 + Caddy 2.11.7 | Web app, API, agents, routines, webhooks and the bots' browser on 127.0.0.1; Caddy on port 8080 is the only public listener; healthcheck `/api/health`; volume at `/data` |

**First login**

1. Wait until the deployment is healthy, then open the public URL. A browser without a session lands on `/railway/sign-in`.
2. Enter `OPENMAUSBOT_OWNER_PASSWORD` from the service's Variables tab. The page creates a one-time pairing code and opens OpenMausBot's own pairing page: choose **Connect**. The browser stays signed in (30 days, renewed while you use it, at most 180).
3. In **Settings → Engines**, sign in to Claude (open Anthropic's page, paste the code back) or connect ChatGPT for Codex (device code).
4. Create a bot and send it a message.

**More devices**: from a signed-in browser use **Settings → Remote access** to pair a phone, tablet or the desktop app, or let people sign in with an emailed code by adding their address to the sign-in list there. Without the owner page: `railway ssh` into the service, run `omb pair --label Laptop` and open the link it prints. `omb sessions` lists devices and `omb sessions revoke {id}` signs one out.

**What agents can access**: every bot runs its agent CLI in this container as the app user, and new bots start at upstream's default approval level, **Full access** (commands run without asking). A bot's shell can read and change everything on `/data`, including the keys saved in Settings, the Claude and Codex sign-ins and other bots' files; it can call OpenMausBot's local API as the owner; and it can reach the internet and other services in this Railway project over the private network. Keys set as Railway variables are readable from that shell too. It cannot read the owner password, which only the edge user can see as a salted hash. Pick **Ask for approval** for bots that handle sensitive work, connect only accounts you want the bots to use, and keep unrelated databases out of this project.

**What is public**: the sign-in pages, static app files, `/api/health`, `/.well-known/openmausbot/environment` (id, label, version) and `/hooks/...` webhook URLs, each guarded by its own secret. Everything else needs a paired session. There is no open sign-up.

**Cloud computers**: bots get their own Linux desktop through Boat once `BOX_TOKEN` (or the key in Settings) is set. Upstream's Local VM (Docker or Podman on the host) and control of your own computer need the desktop app and do not run on Railway.

**Custom domain**: attach it to this service, set `OMB_PUBLIC_URL` to `https://{your-domain}` and redeploy. Pair the browser again on the new address.

**Scaling**: one replica (SQLite and files on `/data`). Give the service more RAM for several bots working or browsing at once.

**Pinning and upgrades**: the Dockerfile pins the upstream image by tag and digest and the engines by version. To upgrade, change those values and redeploy; the build checks that the routes this template relies on still exist. Engines can also be updated from **Settings → Engines** (installed into `/data`). Back up `/data` first.

### Why Deploy OpenMausBot on Railway?

Bots that run routines, answer webhooks and keep their memory need a machine that is always on, a disk that survives restarts and HTTPS. Railway gives you all three in one service with logs, restarts and SSH, so your bot team lives in your own project without running a server yourself.
