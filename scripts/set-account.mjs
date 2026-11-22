// Point genki at the owner's backend project: writes the project address and
// its publishable (public) key into account-config.js and adds the address to
// the Content Security Policy's connect-src in index.html, so the page may
// call that project and no other. Run from the repo root once the project
// exists (backend repo: docs/deployment.md), then commit both files.
//
//   node scripts/set-account.mjs https://<project-id>.supabase.co sb_publishable_...
//
// It refuses a secret key: only the publishable key may ever be in this repo.
import { readFileSync, writeFileSync } from "node:fs";
import { accountConfigProblem, CONNECT_BASE } from "./account-rules.mjs";

const [url, key] = process.argv.slice(2);
const problem = accountConfigProblem(url ?? "", key ?? "");
if (!url || !key || problem) {
  console.error(problem || "usage: node scripts/set-account.mjs https://<project-id>.supabase.co sb_publishable_...");
  process.exit(1);
}

const cfgPath = "account-config.js";
let cfg = readFileSync(cfgPath, "utf8");
cfg = cfg.replace(/export const ACCOUNT_URL = "[^"]*";/, `export const ACCOUNT_URL = ${JSON.stringify(url)};`)
  .replace(/export const ACCOUNT_KEY = "[^"]*";/, `export const ACCOUNT_KEY = ${JSON.stringify(key)};`);
writeFileSync(cfgPath, cfg);

let html = readFileSync("index.html", "utf8");
html = html.replace(/connect-src [^;"]+/, `connect-src ${CONNECT_BASE} ${url}`);
writeFileSync("index.html", html);
console.log(`genki now signs in to ${url}. Run npm run check, then commit account-config.js and index.html.`);
