// `omb …` over `railway ssh`: runs upstream's own command line (dist-server/openmausbot.js) as the app user with the
// server's data folder and port, so a root shell never leaves root-owned files on the volume.
//   omb pair --label Laptop             pairing code and link for a browser or desktop app (full access)
//   omb pair --label Tablet --client    one that may chat and answer cards but not change settings
//   omb pair                            (in a terminal, without --label) upstream's phone wizard
//   omb sessions                        list paired devices; omb sessions revoke {id} signs one out
// Written for this template; see NOTICE.md.
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";

import { PASSWORD_VAR, PORTS, lookupUser } from "./lib.mjs";

const app = lookupUser(readFileSync("/etc/passwd", "utf8"), "maus");
if (!app) {
  console.error("omb: the maus user is missing from this image");
  process.exit(1);
}
const env = { ...process.env, HOME: "/data", USER: "maus", LOGNAME: "maus", OMB_DATA_DIR: "/data/.openmausbot", OMB_PORT: String(PORTS.server) };
delete env[PASSWORD_VAR];
delete env.PORT;
const asRoot = process.getuid?.() === 0;
if (!asRoot && process.getuid?.() !== app.uid) {
  console.error("omb: run this as root (railway ssh) or as maus");
  process.exit(1);
}
const result = spawnSync(process.execPath, ["/app/dist-server/openmausbot.js", ...process.argv.slice(2)], {
  cwd: "/app",
  env,
  stdio: "inherit",
  ...(asRoot ? { uid: app.uid, gid: app.gid } : {}),
});
if (result.error) {
  console.error(`omb: ${result.error.message}`);
  process.exit(1);
}
process.exit(result.status ?? 1);
