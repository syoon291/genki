// Fast check for a no-build static app: every script parses, the manifest is
// well formed, and every file the service worker precaches exists and is
// published by the Pages workflow. Run from the repo root with Node 20+.
import { readFileSync, existsSync } from "node:fs";
import { execFileSync } from "node:child_process";

const fail = (msg) => { console.error(`check failed: ${msg}`); process.exit(1); };

// App files load as ES modules; sw.js is a classic service worker script.
const MODULES = ["app.js", "db.js", "backup.js", "ui.js", "nutrition.js", "foods.js", "nutrition-view.js", "weight.js", "weight-view.js", "workouts.js", "workouts-view.js"];
for (const [f, args] of [...MODULES.map((m) => [m, ["--input-type=module"]]), ["sw.js", []]]) {
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

// Every module the app imports must be precached, or the app breaks offline.
for (const m of MODULES) for (const [, f] of readFileSync(m, "utf8").matchAll(/from "\.\/([^"]+)"/g)) if (!shell.includes(f)) fail(`${m} imports ${f}, but sw.js does not precache it`);

// Every data file the app fetches must be precached too, and must be a valid food table.
for (const m of MODULES) for (const [, f] of readFileSync(m, "utf8").matchAll(/fetch\(`(foods\/[^`]+)`/g)) {
  for (const src of ["jp", "us"]) {
    const file = f.replace("${src}", src);
    if (!shell.includes(file)) fail(`${m} fetches ${file}, but sw.js does not precache it`);
    let t;
    try { t = JSON.parse(readFileSync(file, "utf8")); } catch (e) { fail(`${file} is not valid JSON: ${e.message}`); }
    if (!t.meta?.source || !Array.isArray(t.foods) || t.foods.length < 100) fail(`${file} is not a food table`);
    const bad = t.foods.find((r) => typeof r[0] !== "string" || typeof r[1] !== "string" || ![2, 3, 4, 5].every((i) => Number.isFinite(r[i]) && r[i] >= 0));
    if (bad) fail(`${file} has a bad row: ${JSON.stringify(bad)}`);
  }
}

// Everything index.html loads from this site must be precached too.
for (const [, f] of readFileSync("index.html", "utf8").matchAll(/(?:href|src)="([^":#]+)"/g)) if (!shell.includes(f)) fail(`index.html loads ${f}, but sw.js does not precache it`);

// The Pages workflow copies an explicit file list into the site: every precached file must be in it.
const wf = readFileSync(".github/workflows/pages.yml", "utf8").match(/cp -R ([^\n]*) _site\//);
if (!wf) fail("could not find the site copy step in .github/workflows/pages.yml");
const staged = wf[1].trim().split(/\s+/);
for (const f of shell) if (!staged.includes(f.split("/")[0])) fail(`sw.js precaches ${f}, but the Pages workflow does not copy it into the site`);

console.log(`ok: scripts parse, manifest valid, ${shell.length} shell files precached and published`);
