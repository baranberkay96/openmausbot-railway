// OpenMausBot on Railway: the owner sign-in page at /railway/sign-in, run as the edge user on 127.0.0.1.
//
// OpenMausBot's own login is pairing: a one-time code minted by a program on the server. This page asks for the
// owner password (OPENMAUSBOT_OWNER_PASSWORD, checked against the salted record the supervisor wrote), asks the
// server on loopback for a pairing code, and sends the browser to OpenMausBot's own /pair page with that code in the
// URL fragment (never sent to a server or logged). The session that follows is OpenMausBot's own.
//
// Written for this template; see NOTICE.md.
import { createServer } from "node:http";

import { PORTS, SignInLimiter, clientKey, pairingCode, readPasswordRecord, sameOriginPost, verifyPassword } from "./lib.mjs";

const PATH = "/railway/sign-in";
const BODY_LIMIT = 4096;
const record = readPasswordRecord(process.env.OMB_RAILWAY_OWNER_RECORD);
const limiter = new SignInLimiter();
const serverOrigin = `http://127.0.0.1:${PORTS.server}`;

const escape = (text) => String(text).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);

function page(title, body) {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex">
<title>${escape(title)} · OpenMausBot</title>
<style>
  :root { color-scheme: light dark; font-family: system-ui, -apple-system, "Segoe UI", sans-serif; }
  body { margin: 0; min-height: 100vh; display: grid; place-items: center; background: Canvas; color: CanvasText; }
  main { width: min(26rem, calc(100vw - 2rem)); padding: 2rem 0; }
  h1 { font-size: 1.35rem; margin: 0 0 .75rem; }
  p { line-height: 1.5; margin: .6rem 0; }
  label { display: block; font-weight: 600; margin: 1.2rem 0 .4rem; }
  input { box-sizing: border-box; width: 100%; padding: .65rem .75rem; font: inherit; border-radius: .5rem; border: 1px solid GrayText; }
  button { margin-top: 1rem; width: 100%; padding: .7rem; font: inherit; font-weight: 600; border: 0; border-radius: .5rem; background: #1084fe; color: #fff; cursor: pointer; }
  .note { font-size: .9rem; opacity: .8; }
  .error { color: #d33; font-weight: 600; }
  code { font-size: .9em; }
</style>
</head>
<body><main>
${body}
</main></body>
</html>
`;
}

function formPage(message) {
  return page("Owner sign-in", `<h1>Sign in to OpenMausBot</h1>
${message ? `<p class="error" role="alert">${escape(message)}</p>` : ""}
<form method="post" action="${PATH}">
  <label for="password">Owner password</label>
  <input id="password" name="password" type="password" autocomplete="current-password" required autofocus maxlength="1024">
  <button type="submit">Sign in</button>
</form>
<p class="note">The password is the <code>OPENMAUSBOT_OWNER_PASSWORD</code> variable of this service in Railway.
Signing in creates a one-time pairing code and opens OpenMausBot's own sign-in page; choose <strong>Connect</strong> there.</p>
<p class="note">Have a pairing code or an email invitation? <a href="/pair">Open the pairing page</a>.</p>`);
}

function offPage() {
  return page("Owner sign-in is off", `<h1>Owner sign-in is off</h1>
<p>This deployment has no <code>OPENMAUSBOT_OWNER_PASSWORD</code>, so this page cannot sign anyone in.</p>
<p>Pair this browser with a code instead: run <code>railway ssh</code> for this service, then <code>omb pair</code>, and open the link it prints.
Or set the variable in Railway and redeploy.</p>
<p class="note"><a href="/pair">Open the pairing page</a></p>`);
}

function send(res, status, html, extra = {}) {
  res.writeHead(status, {
    "content-type": "text/html; charset=utf-8",
    "cache-control": "no-store",
    "content-security-policy": "default-src 'none'; style-src 'unsafe-inline'; form-action 'self'; frame-ancestors 'none'; base-uri 'none'",
    "referrer-policy": "no-referrer",
    "x-content-type-options": "nosniff",
    "x-frame-options": "DENY",
    ...extra,
  });
  res.end(res.req.method === "HEAD" ? undefined : html);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    const onData = (chunk) => {
      size += chunk.length;
      if (size > BODY_LIMIT) {
        // Stop reading; the 413 goes out with Connection: close and the rest of the body is dropped with the socket.
        req.off("data", onData);
        req.pause();
        reject(new Error("too large"));
        return;
      }
      chunks.push(chunk);
    };
    req.on("data", onData);
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
  });
}

async function mintPairingCode() {
  const response = await fetch(`${serverOrigin}/api/auth/pairing`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ label: "Owner sign-in (Railway)" }),
    signal: AbortSignal.timeout(5000),
  });
  const body = await response.json().catch(() => ({}));
  return { status: response.status, code: response.status === 200 ? pairingCode(body) : null, error: typeof body?.error === "string" ? body.error : "" };
}

async function signIn(req, res) {
  if (!record) return send(res, 404, offPage());
  if (!sameOriginPost(req.headers)) return send(res, 403, formPage("Sign in from this page."));
  if (!/^application\/x-www-form-urlencoded\b/i.test(String(req.headers["content-type"] ?? ""))) {
    return send(res, 415, formPage("Sign in from this page."));
  }
  const key = clientKey(req.headers, req.socket.remoteAddress);
  const wait = limiter.blockedFor(key);
  if (wait > 0) return send(res, 429, formPage(`Too many wrong passwords. Try again in ${Math.ceil(wait / 60)} min.`), { "retry-after": String(wait) });
  if (!limiter.take()) return send(res, 429, formPage("Too many sign-in attempts right now. Try again in a minute."), { "retry-after": "60" });

  let password = "";
  try {
    password = new URLSearchParams(await readBody(req)).get("password") ?? "";
  } catch {
    return send(res, 413, formPage("That request was too large."), { connection: "close" });
  }
  if (!(await verifyPassword(record, password))) {
    limiter.fail(key);
    console.log(`[owner sign-in] wrong password from ${key}`);
    return send(res, 401, formPage("Wrong password."));
  }
  limiter.succeed(key);

  let minted;
  try {
    minted = await mintPairingCode();
  } catch {
    return send(res, 503, formPage("OpenMausBot is still starting. Try again in a minute."), { "retry-after": "30" });
  }
  if (!minted.code) {
    console.log(`[owner sign-in] the server refused a pairing code (HTTP ${minted.status}${minted.error ? `: ${minted.error}` : ""})`);
    const why = minted.status === 403
      ? "OpenMausBot refused to create a pairing code for this page (OMB_LOOPBACK_TRUST=service or a managed policy). Sign in with your email or pair from Settings → Remote access on a signed-in device."
      : "OpenMausBot could not create a pairing code. Try again in a minute.";
    return send(res, 502, formPage(why));
  }
  console.log(`[owner sign-in] signed in from ${key}; sent to /pair with a one-time code`);
  res.writeHead(303, { location: `/pair#code=${encodeURIComponent(minted.code)}`, "cache-control": "no-store", "referrer-policy": "no-referrer" });
  res.end();
}

const server = createServer((req, res) => {
  const path = (req.url ?? "/").split("?")[0];
  const handle = async () => {
    if (path !== PATH) return send(res, 404, page("Not found", "<h1>Not found</h1>"));
    if (req.method === "GET" || req.method === "HEAD") return send(res, 200, record ? formPage("") : offPage());
    if (req.method === "POST") return signIn(req, res);
    return send(res, 405, page("Not allowed", "<h1>Not allowed</h1>"), { allow: "GET, HEAD, POST" });
  };
  handle().catch((error) => {
    console.error(`[owner sign-in] ${error instanceof Error ? error.message : String(error)}`);
    if (!res.headersSent) send(res, 500, formPage("Something went wrong. Try again."));
    else res.destroy();
  });
});
server.headersTimeout = 10_000;
server.requestTimeout = 15_000;
server.listen(PORTS.signin, "127.0.0.1", () => {
  console.log(`[owner sign-in] ${record ? "ready" : "off (no owner password)"} on 127.0.0.1:${PORTS.signin}${PATH}`);
});
