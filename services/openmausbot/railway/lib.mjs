// Shared pieces of the OpenMausBot Railway wrapper (supervisor.mjs, owner-signin.mjs, omb.mjs).
// Written for this template. Nothing here is copied from OpenMausBot; it only talks to the
// server's documented HTTP API on loopback.
import { spawn } from "node:child_process";
import { readFileSync } from "node:fs";
import { randomBytes, scrypt as scryptCallback, timingSafeEqual } from "node:crypto";

/** Loopback ports inside the container. The Caddyfile names the same numbers. */
export const PORTS = Object.freeze({ server: 8799, webhook: 8800, signin: 8797 });

/** The owner password variable. Only the wrapper reads it; OpenMausBot and its bots never get it. */
export const PASSWORD_VAR = "OPENMAUSBOT_OWNER_PASSWORD";
export const PASSWORD_MIN = 12;
export const PASSWORD_MAX = 1024;
const WRAPPER_ONLY_VARS = Object.freeze([PASSWORD_VAR]);

const SCRYPT = Object.freeze({ N: 16384, r: 8, p: 1, keylen: 32, maxmem: 64 * 1024 * 1024 });
const PAIRING_CODE = /^[2-9A-HJ-NP-Z]{4}-[2-9A-HJ-NP-Z]{4}-[2-9A-HJ-NP-Z]{4}$/;

/** "8080" -> 8080; anything that is not a whole number from 1 to 65535 -> null. */
export function parsePort(value) {
  const text = String(value ?? "").trim();
  if (!/^\d{1,5}$/.test(text)) return null;
  const port = Number(text);
  return port >= 1 && port <= 65535 ? port : null;
}

/** The public edge port (Railway's PORT). Throws with a readable reason. */
export function edgePort(env) {
  const port = parsePort(env.PORT);
  if (port === null) throw new Error(`PORT must be a port number from 1 to 65535 (got "${String(env.PORT ?? "")}")`);
  if (Object.values(PORTS).includes(port)) {
    throw new Error(`PORT ${port} is used inside the container (${Object.values(PORTS).join(", ")}); keep the default 8080`);
  }
  return port;
}

/** { state: "off" } when empty, { state: "invalid", reason } or { state: "on", value }. */
export function ownerPassword(env) {
  const raw = env[PASSWORD_VAR];
  if (raw === undefined) return { state: "off" };
  const value = String(raw).replace(/[\r\n]+$/, "");
  if (value === "") return { state: "off" };
  if (/[\u0000-\u001f\u007f]/.test(value)) return { state: "invalid", reason: `${PASSWORD_VAR} contains control characters` };
  if (value.length < PASSWORD_MIN) return { state: "invalid", reason: `${PASSWORD_VAR} must have at least ${PASSWORD_MIN} characters` };
  if (value.length > PASSWORD_MAX) return { state: "invalid", reason: `${PASSWORD_VAR} must have at most ${PASSWORD_MAX} characters` };
  return { state: "on", value };
}

function scrypt(password, salt, params) {
  return new Promise((resolve, reject) => {
    scryptCallback(password, salt, params.keylen, { N: params.N, r: params.r, p: params.p, maxmem: SCRYPT.maxmem }, (error, key) => {
      if (error) reject(error);
      else resolve(key);
    });
  });
}

/** A salted scrypt record of the password; the password itself is never stored. */
export async function passwordRecord(password) {
  const salt = randomBytes(16);
  const hash = await scrypt(password, salt, SCRYPT);
  return { v: 1, alg: "scrypt", N: SCRYPT.N, r: SCRYPT.r, p: SCRYPT.p, salt: salt.toString("base64"), hash: hash.toString("base64") };
}

export function readPasswordRecord(path) {
  if (!path) return null;
  let parsed;
  try {
    parsed = JSON.parse(readFileSync(path, "utf8"));
  } catch {
    return null;
  }
  const ok = parsed && parsed.v === 1 && parsed.alg === "scrypt" &&
    [parsed.N, parsed.r, parsed.p].every((n) => Number.isInteger(n) && n > 0) &&
    typeof parsed.salt === "string" && typeof parsed.hash === "string";
  return ok ? parsed : null;
}

export async function verifyPassword(record, candidate) {
  if (!record || typeof candidate !== "string" || candidate.length === 0 || candidate.length > PASSWORD_MAX) return false;
  const expected = Buffer.from(record.hash, "base64");
  const actual = await scrypt(candidate, Buffer.from(record.salt, "base64"), { N: record.N, r: record.r, p: record.p, keylen: expected.length });
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

/** Per-address failure lockout plus a global budget of password checks (each one costs an scrypt). */
export class SignInLimiter {
  constructor(options = {}) {
    this.failures = options.failures ?? 5;
    this.windowMs = options.windowMs ?? 15 * 60_000;
    this.lockMs = options.lockMs ?? 15 * 60_000;
    this.perMinute = options.perMinute ?? 30;
    this.maxKeys = options.maxKeys ?? 10_000;
    this.now = options.now ?? Date.now;
    this.entries = new Map();
    this.budget = { start: 0, used: 0 };
  }

  /** Seconds to wait before this address may try again, or 0. */
  blockedFor(key) {
    const entry = this.entries.get(key);
    if (!entry) return 0;
    const now = this.now();
    if (entry.lockedUntil > now) return Math.ceil((entry.lockedUntil - now) / 1000);
    return 0;
  }

  /** False once the global budget for this minute is spent. */
  take() {
    const now = this.now();
    if (now - this.budget.start >= 60_000) this.budget = { start: now, used: 0 };
    if (this.budget.used >= this.perMinute) return false;
    this.budget.used += 1;
    return true;
  }

  fail(key) {
    const now = this.now();
    let entry = this.entries.get(key);
    if (!entry || now - entry.windowStart > this.windowMs) entry = { windowStart: now, count: 0, lockedUntil: 0 };
    entry.count += 1;
    if (entry.count >= this.failures) entry.lockedUntil = now + this.lockMs;
    this.entries.delete(key);
    this.entries.set(key, entry);
    while (this.entries.size > this.maxKeys) this.entries.delete(this.entries.keys().next().value);
  }

  succeed(key) {
    this.entries.delete(key);
  }
}

/** The client address Caddy wrote into X-Forwarded-For (it sets exactly one value), else the peer. */
export function clientKey(headers, peer) {
  const forwarded = String(headers["x-forwarded-for"] ?? "").split(",").map((part) => part.trim()).filter(Boolean);
  const value = forwarded.length ? forwarded[forwarded.length - 1] : String(peer ?? "unknown");
  return (value.replace(/[^\w.:%[\]-]/g, "") || "unknown").slice(0, 64);
}

/** A browser form POST must come from this site's own page; programs without these headers are let through. */
export function sameOriginPost(headers) {
  const site = headers["sec-fetch-site"];
  if (site !== undefined && site !== "same-origin" && site !== "none") return false;
  const origin = headers.origin;
  if (origin === undefined) return true;
  if (origin === "null") return false;
  try {
    return new URL(origin).host.toLowerCase() === String(headers.host ?? "").toLowerCase();
  } catch {
    return false;
  }
}

/** The pairing code from POST /api/auth/pairing, or null when the reply does not look like one. */
export function pairingCode(body) {
  const code = body && typeof body.code === "string" ? body.code.trim() : "";
  return PAIRING_CODE.test(code) ? code : null;
}

/**
 * The environment OpenMausBot (and so every bot shell it starts) runs with: the container's variables minus the
 * wrapper's own and minus empty ones (OpenMausBot reads a set-but-empty key variable as "remove the key saved in
 * Settings"), with the fixed loopback ports and the public address filled in.
 */
export function serverEnv(env, options = {}) {
  const home = options.home ?? "/data";
  const out = {};
  const dropped = [];
  for (const [name, value] of Object.entries(env)) {
    if (WRAPPER_ONLY_VARS.includes(name) || name === "PORT") continue;
    if (value === undefined || value === "") {
      dropped.push(name);
      continue;
    }
    out[name] = value;
  }
  const overridden = ["OMB_PORT", "OMB_WEBHOOK_PORT"].filter((name) => out[name] !== undefined &&
    out[name] !== String(name === "OMB_PORT" ? PORTS.server : PORTS.webhook));
  out.HOME = home;
  out.USER = options.user ?? "maus";
  out.LOGNAME = out.USER;
  out.OMB_PORT = String(PORTS.server);
  out.OMB_WEBHOOK_PORT = String(PORTS.webhook);
  if (!out.OMB_DATA_DIR) out.OMB_DATA_DIR = `${home}/.openmausbot`;
  const domain = String(env.RAILWAY_PUBLIC_DOMAIN ?? "").trim().replace(/^https?:\/\//, "").replace(/\/+$/, "");
  if (!out.OMB_PUBLIC_URL && domain) out.OMB_PUBLIC_URL = `https://${domain}`;
  if (!out.OMB_WEBHOOK_PUBLIC_URL && out.OMB_PUBLIC_URL) out.OMB_WEBHOOK_PUBLIC_URL = out.OMB_PUBLIC_URL;
  return { env: out, dropped, overridden };
}

/** Caddy and the sign-in page get almost nothing: no keys, no password. */
export function edgeEnv(env, runDir, port) {
  return {
    PATH: env.PATH ?? "/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin",
    HOME: runDir,
    XDG_DATA_HOME: `${runDir}/data`,
    XDG_CONFIG_HOME: `${runDir}/config`,
    PORT: String(port),
  };
}

export function signinEnv(env, runDir, recordPath) {
  return {
    PATH: env.PATH ?? "/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin",
    HOME: runDir,
    NODE_ENV: "production",
    OMB_RAILWAY_OWNER_RECORD: recordPath ?? "",
  };
}

/** uid, gid and home of a user from an /etc/passwd text. */
export function lookupUser(passwdText, name) {
  for (const line of String(passwdText).split("\n")) {
    const fields = line.split(":");
    if (fields[0] === name && fields.length >= 7) {
      const uid = Number(fields[2]);
      const gid = Number(fields[3]);
      if (Number.isInteger(uid) && Number.isInteger(gid)) return { uid, gid, home: fields[5] };
    }
  }
  return null;
}

/**
 * Starts every child in order and resolves with an exit code: 0 after SIGTERM/SIGINT stopped them all, else the code
 * of the first child that ended on its own (at least 1), after the others were stopped. Railway's restart policy then
 * starts the container again.
 */
export function supervise(specs, options = {}) {
  const log = options.log ?? ((line) => console.log(`[railway] ${line}`));
  const graceMs = options.graceMs ?? 25_000;
  const signals = options.signals ?? process;
  return new Promise((resolve) => {
    const running = new Map();
    let stopping = false;
    let result = 0;
    let killTimer = null;

    const finishIfDone = () => {
      if (stopping && running.size === 0) {
        if (killTimer) clearTimeout(killTimer);
        signals.off("SIGTERM", onTerm);
        signals.off("SIGINT", onInt);
        resolve(result);
      }
    };
    const stopAll = (code) => {
      if (stopping) return;
      stopping = true;
      result = code;
      for (const [name, child] of running) {
        log(`stopping ${name}`);
        child.kill("SIGTERM");
      }
      killTimer = setTimeout(() => {
        for (const [name, child] of running) {
          log(`${name} did not stop in ${Math.round(graceMs / 1000)} s; killing it`);
          child.kill("SIGKILL");
        }
      }, graceMs);
      killTimer.unref?.();
      finishIfDone();
    };
    const onTerm = () => stopAll(0);
    const onInt = () => stopAll(0);
    signals.on("SIGTERM", onTerm);
    signals.on("SIGINT", onInt);

    for (const spec of specs) {
      if (stopping) break;
      const child = spawn(spec.command, spec.args ?? [], {
        cwd: spec.cwd,
        env: spec.env,
        stdio: ["ignore", "inherit", "inherit"],
        ...(spec.uid !== undefined ? { uid: spec.uid, gid: spec.gid } : {}),
      });
      running.set(spec.name, child);
      child.once("error", (error) => {
        log(`${spec.name} could not start: ${error.message}`);
        running.delete(spec.name);
        stopAll(1);
        finishIfDone();
      });
      child.once("exit", (code, signal) => {
        running.delete(spec.name);
        if (!stopping) {
          log(`${spec.name} exited (${signal ?? `code ${code}`}); stopping the container so Railway restarts it`);
          stopAll(code && code > 0 ? code : 1);
        }
        finishIfDone();
      });
    }
  });
}
