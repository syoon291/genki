// The Sync section of the Data & backup sheet, and the once-a-day auto-sync.
// The token and the sync state live in the device-only database (db.js
// getDevice/setDevice), never in the stores a backup carries.
import * as db from "./db.js";
import { buildBackup, parseBackup, countRecords } from "./backup.js";
import { esc } from "./ui.js";
import { REPO, PATH, checkAccess, fetchRemote, pushFile, syncDue, looksLikeToken } from "./sync.js";

// Device keys: syncToken, syncSha (the file version this device last wrote or
// restored: set means this device is linked and may auto-sync), lastSyncedAt,
// lastSyncError.
let busy = false;
let note = { msg: "", tone: "" };
let rerender = () => {};
let onRestored = () => {};

export function setSyncHooks({ rerender: r, restored }) {
  if (r) rerender = r;
  if (restored) onRestored = restored;
}

export function clearSyncNote() { note = { msg: "", tone: "" }; }

const say = (msg, tone = "") => { note = { msg, tone }; };

function fmt(iso) {
  return iso ? new Date(iso).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" }) : "never";
}

export async function syncSection() {
  let token = null, lastSyncedAt = null, lastError = null, linked = false;
  try {
    token = await db.getDevice("syncToken", null);
    lastSyncedAt = await db.getDevice("lastSyncedAt", null);
    lastError = await db.getDevice("lastSyncError", null);
    linked = !!(await db.getDevice("syncSha", null));
  } catch (e) {
    return `<section class="sync" aria-labelledby="sync-title"><h3 id="sync-title">Sync</h3><p class="msg bad" role="status">${esc(`Sync is unavailable: ${e.message}`)}</p></section>`;
  }
  const status = `<p class="msg ${note.tone}" role="status">${esc(busy ? "Working…" : note.msg)}</p>`;
  if (!token) {
    return `
    <section class="sync" aria-labelledby="sync-title">
      <h3 id="sync-title">Sync</h3>
      <p class="hint">Keep a copy in your private GitHub repo ${esc(REPO)} (file ${esc(PATH)}). Paste a fine-grained token that can reach only genki-data, with Contents read and write. It stays on this device and is never part of a backup.</p>
      <form class="stack" data-form="sync-token">
        <label class="field"><span>GitHub token</span>
          <input type="password" name="token" autocomplete="off" autocapitalize="off" spellcheck="false" placeholder="github_pat_…" required>
        </label>
        <button type="submit" class="btn ghost"${busy ? " disabled" : ""}>Save token</button>
      </form>
      ${status}
    </section>`;
  }
  return `
    <section class="sync" aria-labelledby="sync-title">
      <h3 id="sync-title">Sync</h3>
      <dl class="facts">
        <div><dt>Syncs to</dt><dd>${esc(REPO)}</dd></div>
        <div><dt>Last synced</dt><dd>${esc(fmt(lastSyncedAt))}</dd></div>
      </dl>
      ${lastError ? `<p class="hint">Last automatic sync failed: ${esc(lastError)}</p>` : ""}
      ${linked ? `<p class="hint">Syncs on its own once a day when you open genki.</p>` : `<p class="hint">Sync now or restore once to turn on the daily sync.</p>`}
      <div class="stack">
        <button type="button" class="btn" data-act="sync-now"${busy ? " disabled" : ""}>Sync now</button>
        <button type="button" class="btn ghost" data-act="sync-restore"${busy ? " disabled" : ""}>Restore from genki-data…</button>
        <button type="button" class="btn ghost" data-act="sync-forget"${busy ? " disabled" : ""}>Remove token</button>
      </div>
      ${status}
    </section>`;
}

async function run(job) {
  if (busy) return;
  busy = true;
  say("");
  rerender();
  try { await job(); }
  catch (e) { say(e.message, "bad"); }
  finally { busy = false; rerender(); }
}

export function handleSyncSubmit(form) {
  if (form.dataset.form !== "sync-token") return false;
  const input = form.elements.token;
  const token = input.value.trim();
  if (busy) return true;
  input.value = "";
  run(async () => {
    if (!looksLikeToken(token)) { say("That does not look like a fine-grained GitHub token (github_pat_…). Classic ghp_ tokens are not accepted.", "bad"); return; }
    const access = await checkAccess(token);
    if (!access.private) { say("genki-data is not a private repo. Make it private before syncing to it.", "bad"); return; }
    await db.setDevice("syncToken", token);
    await db.delDevice("syncSha");
    await db.delDevice("lastSyncError");
    let remote;
    try { remote = await fetchRemote(token); }
    catch (e) { say(`Token saved, but could not read genki-data yet: ${e.message}`, "bad"); return; }
    say(remote ? "Token saved. genki-data already has a backup: restore it to this device, or sync now to replace it." : "Token saved. Sync now to make the first copy.", "good");
  });
  return true;
}

export function handleSyncAct(act) {
  if (act === "sync-now") { run(() => syncNow({ interactive: true })); return true; }
  if (act === "sync-restore") { run(restore); return true; }
  if (act === "sync-forget") {
    run(async () => {
      if (!confirm("Remove the GitHub token from this device? The copy in genki-data stays.")) return;
      for (const k of ["syncToken", "syncSha", "lastSyncedAt", "lastSyncError"]) await db.delDevice(k);
      say("Token removed.", "good");
    });
    return true;
  }
  return false;
}

function summary(backup) {
  const total = Object.values(countRecords(backup.stores)).reduce((a, b) => a + b, 0);
  const when = backup.exportedAt ? ` from ${fmt(backup.exportedAt)}` : "";
  return { total, when };
}

// Write this device's data to app/latest.json. A device that is not linked yet
// (never synced or restored here) asks before replacing a file already there,
// so a fresh phone never overwrites the real copy with an empty one.
async function syncNow({ interactive }) {
  const token = await db.getDevice("syncToken", null);
  if (!token) throw new Error("No token saved.");
  let sha = await db.getDevice("syncSha", null);
  if (!sha) {
    if (!interactive) return;
    const remote = await fetchRemote(token);
    if (remote) {
      const parsed = parseBackup(remote.text, await db.storeNames(), db.KEY_PATHS);
      const what = parsed.ok ? (({ total, when }) => `${when} (${total} records)`)(summary(parsed.backup)) : "";
      if (!confirm(`genki-data already has a backup${what}. Replace it with the data on this device?`)) { say("Sync cancelled. Nothing changed."); return; }
      sha = remote.sha;
    }
  }
  const now = new Date();
  const text = JSON.stringify(buildBackup(await db.dumpAll(), now), null, 2);
  const next = await pushFile(token, text, sha, { message: `genki sync ${now.toISOString()}` });
  await db.setDevice("syncSha", next);
  await db.setDevice("lastSyncedAt", now.toISOString());
  await db.delDevice("lastSyncError");
  say("Synced.", "good");
}

async function restore() {
  const token = await db.getDevice("syncToken", null);
  if (!token) throw new Error("No token saved.");
  const remote = await fetchRemote(token);
  if (!remote) { say("genki-data has no backup yet. Sync now to make the first copy.", "bad"); return; }
  const parsed = parseBackup(remote.text, await db.storeNames(), db.KEY_PATHS);
  if (!parsed.ok) { say(`The copy in genki-data cannot be used: ${parsed.error}`, "bad"); return; }
  const { total, when } = summary(parsed.backup);
  if (!confirm(`Replace the data on this device with the genki-data backup${when} (${total} records)? This cannot be undone.`)) { say("Restore cancelled. Nothing changed."); return; }
  await db.replaceAll(parsed.backup.stores);
  // The data is replaced from here on: show it even if the sync state cannot be saved.
  onRestored();
  try { await db.setMeta("lastImportAt", new Date().toISOString()); } catch (e) { console.warn("genki: could not record the import time", e); }
  try {
    await db.setDevice("syncSha", remote.sha);
    await db.setDevice("lastSyncedAt", new Date().toISOString());
    await db.delDevice("lastSyncError");
  } catch (e) {
    say(`Restored ${total} records, but could not save the sync state: ${e.message}`, "bad");
    return;
  }
  say(`Restored ${total} records.`, "good");
}

// On open: a linked device with a token syncs once a local day, quietly.
// A failure is kept to show in the Sync section, never thrown.
export async function autoSync(now = new Date()) {
  try {
    const token = await db.getDevice("syncToken", null);
    const sha = await db.getDevice("syncSha", null);
    if (!token || !sha || !syncDue(await db.getDevice("lastSyncedAt", null), now)) return;
    if (busy) return;
    busy = true;
    try { await syncNow({ interactive: false }); }
    finally { busy = false; }
  } catch (e) {
    try { await db.setDevice("lastSyncError", e.message); }
    catch (e2) { console.warn("genki: auto-sync failed and its error could not be saved", e, e2); }
  }
  note = { msg: "", tone: "" };
  try { await rerender(); } catch (e) { console.warn("genki: could not redraw the Sync section", e); }
}
