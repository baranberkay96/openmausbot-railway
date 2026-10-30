// OpenMausBot on Railway: the container's main process, run as root.
//
// 1. Checks PORT and hands the /data volume to the app user `maus` (a fresh Railway volume belongs to root).
// 2. Turns OPENMAUSBOT_OWNER_PASSWORD into a salted scrypt record that only the edge user `ombedge` can read,
//    before any port opens. An invalid password stops the boot; an empty one turns the owner sign-in page off.
// 3. Starts, each under its own user and with only the environment it needs:
//    - OpenMausBot (upstream's server-launcher, unchanged) as `maus`, listening on 127.0.0.1:8799/8800;
//    - the owner sign-in page (owner-signin.mjs) as `ombedge` on 127.0.0.1:8797;
//    - Caddy as `ombedge` on $PORT, the only public listener.
//    If one of them ends, the others are stopped and the container exits for Railway to restart it.
//
// Written for this template; see NOTICE.md.
import { execFileSync } from "node:child_process";
import { chmodSync, chownSync, mkdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { PASSWORD_VAR, edgeEnv, edgePort, lookupUser, ownerPassword, passwordRecord, serverEnv, signinEnv, supervise } from "./lib.mjs";

const DATA_DIR = "/data";
const RUN_DIR = "/run/omb-railway";
const EDGE_DIR = join(RUN_DIR, "edge");
const RECORD = join(EDGE_DIR, "owner.json");
const APP_DIR = "/app";
const HERE = "/opt/omb-railway";

const log = (line) => console.log(`[railway] ${line}`);
const fail = (line) => {
  console.error(`[railway] ${line}`);
  process.exit(1);
};

function users() {
  const passwd = readFileSync("/etc/passwd", "utf8");
  const app = lookupUser(passwd, "maus");
  const edge = lookupUser(passwd, "ombedge");
  if (!app || !edge) fail("the image lacks the maus or ombedge user");
  return { app, edge };
}

function prepareVolume(app) {
  let data;
  try {
    data = statSync(DATA_DIR);
  } catch {
    mkdirSync(DATA_DIR, { recursive: true });
    data = statSync(DATA_DIR);
  }
  if (data.dev === statSync("/").dev) {
    log(`WARNING: ${DATA_DIR} is not a mounted volume; chats, bots and engine sign-ins are lost on the next deploy`);
  }
  const owner = `${app.uid}:${app.gid}`;
  if (data.uid !== app.uid || data.gid !== app.gid) {
    log(`giving ${DATA_DIR} to maus (first boot or a restored volume)`);
    execFileSync("chown", ["-R", owner, DATA_DIR], { stdio: "inherit" });
    chmodSync(DATA_DIR, 0o700);
    return;
  }
  // HOME is /data for root too, so a command run as root over `railway ssh` (an engine login, a CLI call) leaves
  // root-owned files there that the app cannot read. Give them back.
  const rootOwned = execFileSync("find", [DATA_DIR, "-xdev", "-user", "0", "-print", "-quit"], { encoding: "utf8" }).trim();
  if (rootOwned) {
    log(`giving root-owned files under ${DATA_DIR} back to maus (first one: ${rootOwned})`);
    execFileSync("find", [DATA_DIR, "-xdev", "-user", "0", "-exec", "chown", "-h", owner, "{}", "+"], { stdio: "inherit" });
  }
}

async function prepareOwnerSignin(edge) {
  rmSync(RUN_DIR, { recursive: true, force: true });
  mkdirSync(RUN_DIR, { mode: 0o755 });
  mkdirSync(EDGE_DIR, { mode: 0o700 });
  chownSync(EDGE_DIR, edge.uid, edge.gid);

  const password = ownerPassword(process.env);
  if (password.state === "invalid") fail(`${password.reason}. Fix the variable and redeploy (the app was not started).`);
  if (password.state === "off") {
    log(`${PASSWORD_VAR} is empty: the owner sign-in page is off. Pair a browser with \`omb pair\` over railway ssh.`);
    return null;
  }
  const record = await passwordRecord(password.value);
  const temp = `${RECORD}.tmp`;
  writeFileSync(temp, `${JSON.stringify(record)}\n`, { mode: 0o400 });
  chownSync(temp, edge.uid, edge.gid);
  renameSync(temp, RECORD);
  log(`owner sign-in ready at /railway/sign-in (password from ${PASSWORD_VAR}, kept only as a salted hash)`);
  return RECORD;
}

async function main() {
  if (process.getuid?.() !== 0) fail("supervisor.mjs must start as root (the Dockerfile sets USER root)");
  let port;
  try {
    port = edgePort(process.env);
  } catch (error) {
    fail(error.message);
  }
  const { app, edge } = users();
  prepareVolume(app);
  const recordPath = await prepareOwnerSignin(edge);

  const server = serverEnv(process.env, { home: DATA_DIR, user: "maus" });
  if (server.dropped.length) log(`not passing empty variables to OpenMausBot: ${server.dropped.join(", ")}`);
  if (server.overridden.length) log(`ignoring ${server.overridden.join(", ")}: the edge needs the default loopback ports`);
  log(`public address for pairing and webhook links: ${server.env.OMB_PUBLIC_URL ?? "(none: set OMB_PUBLIC_URL)"}`);
  delete process.env[PASSWORD_VAR];

  const code = await supervise([
    {
      name: "OpenMausBot",
      command: process.execPath,
      args: [join(APP_DIR, "dist-server/server-launcher.js")],
      cwd: APP_DIR,
      env: server.env,
      uid: app.uid,
      gid: app.gid,
    },
    {
      name: "owner sign-in",
      command: process.execPath,
      args: [join(HERE, "owner-signin.mjs")],
      cwd: EDGE_DIR,
      env: signinEnv(process.env, EDGE_DIR, recordPath),
      uid: edge.uid,
      gid: edge.gid,
    },
    {
      name: "Caddy",
      command: "/usr/local/bin/caddy",
      args: ["run", "--config", join(HERE, "Caddyfile"), "--adapter", "caddyfile"],
      cwd: EDGE_DIR,
      env: edgeEnv(process.env, EDGE_DIR, port),
      uid: edge.uid,
      gid: edge.gid,
    },
  ], { log });
  process.exit(code);
}

main().catch((error) => fail(error instanceof Error ? error.stack ?? error.message : String(error)));
