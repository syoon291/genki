// Fast check for a no-build static app: every script parses, the manifest is
// well formed, and every file the service worker precaches exists and is
// published by the Pages workflow. Run from the repo root with Node 20+.
import { readFileSync, existsSync } from "node:fs";
import { execFileSync } from "node:child_process";

const fail = (msg) => { console.error(`check failed: ${msg}`); process.exit(1); };

// App files load as ES modules; sw.js is a classic service worker script.
for (const [f, args] of [["app.js", ["--input-type=module"]], ["db.js", ["--input-type=module"]], ["backup.js", ["--input-type=module"]], ["sw.js", []]]) {
  try { execFileSync(process.execPath, ["--check", ...args], { input: readFileSync(f), stdio: ["pipe", "pipe", "pipe"] }); }
  catch (e) { fail(`${f} does not parse\n${e.stderr}`); }
}

let manifest;
try { manifest = JSON.parse(readFileSync("manifest.webmanifest", "utf8")); }
catch (e) { fail(`manifest.webmanifest is not valid JSON: ${e.message}`); }
for (const k of ["name", "short_name", "start_url", "display", "icons"]) if (!manifest[k]) fail(`manifest.webmanifest is missing ${k}`);
for (const i of manifest.icons) if (!existsSync(i.src)) fail(`manifest icon ${i.src} does not exist`);

const shellMatch = readFileSync("sw.js", "utf8").match(/const SHELL = (\[[^\]]*\])/);
if (!shellMatch) fail("could not find the SHELL list in sw.js");
const shell = JSON.parse(shellMatch[1]).filter((f) => f !== "./");
for (const f of shell) if (!existsSync(f)) fail(`sw.js precaches ${f}, which does not exist`);

// Every module app.js imports must be precached, or the app breaks offline.
for (const [, f] of readFileSync("app.js", "utf8").matchAll(/from "\.\/([^"]+)"/g)) if (!shell.includes(f)) fail(`app.js imports ${f}, but sw.js does not precache it`);

// Everything index.html loads from this site must be precached too.
for (const [, f] of readFileSync("index.html", "utf8").matchAll(/(?:href|src)="([^":#]+)"/g)) if (!shell.includes(f)) fail(`index.html loads ${f}, but sw.js does not precache it`);

// The Pages workflow copies an explicit file list into the site: every precached file must be in it.
const wf = readFileSync(".github/workflows/pages.yml", "utf8").match(/cp -R ([^\n]*) _site\//);
if (!wf) fail("could not find the site copy step in .github/workflows/pages.yml");
const staged = wf[1].trim().split(/\s+/);
for (const f of shell) if (!staged.includes(f.split("/")[0])) fail(`sw.js precaches ${f}, but the Pages workflow does not copy it into the site`);

console.log(`ok: scripts parse, manifest valid, ${shell.length} shell files precached and published`);
