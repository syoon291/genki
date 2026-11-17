// genki app shell: three tabs (Today / Nutrition / Workouts) rendered into
// (Today: the nutrition tiles, the weight card from weight-view.js and the
// next-workout card from workouts-view.js)
// <main id="view">, and the Data & backup sheet (JSON export/import, and the
// Sync section from sync-view.js).
// The tab is kept in the URL hash so a reload stays where you were.
import * as db from "./db.js";
import { buildBackup, backupFileName, parseBackup, countRecords } from "./backup.js";
import { esc, initPanel } from "./ui.js";
import { syncSection, handleSyncAct, handleSyncSubmit, setSyncHooks, clearSyncNote, autoSync } from "./sync-view.js";
import { nutritionView, todayTiles, handleViewClick, setRerender } from "./nutrition-view.js";
import { weightCard, handleWeightClick, setWeightRerender } from "./weight-view.js";
import { workoutsView, nextWorkoutCard, handleLiftClick, handleLiftInput, setLiftRerender, initRestTimer } from "./workouts-view.js";

const TABS = ["today", "nutrition", "workouts"];
const $ = (sel, root = document) => root.querySelector(sel);
const view = $("#view");
const dialog = $("#data-dialog");
const sheet = $("#data-sheet");
const fileInput = $("#import-file");

let storeError = null;

// ---------- tabs ----------

function currentTab() {
  const t = location.hash.slice(1);
  return TABS.includes(t) ? t : "today";
}

function greeting(d = new Date()) {
  const h = d.getHours();
  if (h < 5) return "Late night";
  if (h < 12) return "Good morning";
  if (h < 18) return "Good afternoon";
  return "Good evening";
}

const RENDER = {
  today: async () => `
    <h2>${greeting()}</h2>
    <p class="sub">${esc(new Date().toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric" }))}</p>
    ${storeError ? "" : await todayTiles()}
    <a class="btn ghost log-link" href="#nutrition">Log food</a>
    ${storeError ? "" : await weightCard()}
    ${storeError ? "" : await nextWorkoutCard()}`,
  nutrition: () => (storeError ? `<h2>Nutrition</h2>` : nutritionView()),
  workouts: () => (storeError ? `<h2>Workouts</h2>` : workoutsView()),
};

// Views read IndexedDB, so rendering is async; a newer render wins over a slower older one.
let renderSeq = 0;
async function render() {
  const seq = ++renderSeq;
  const tab = currentTab();
  for (const b of document.querySelectorAll(".tabs button")) {
    const on = b.dataset.tab === tab;
    b.classList.toggle("on", on);
    if (on) b.setAttribute("aria-current", "page"); else b.removeAttribute("aria-current");
  }
  const banner = storeError ? `<div class="card warn-card" role="alert"><strong>Storage is unavailable.</strong> <span class="small">${esc(storeError)} Nothing you enter will be saved.</span></div>` : "";
  let html;
  try { html = await RENDER[tab](); }
  catch (e) { html = `<div class="card warn-card" role="alert"><strong>Something went wrong.</strong> <span class="small">${esc(e.message)}</span></div>`; }
  if (seq !== renderSeq) return;
  view.innerHTML = banner + html;
}

setRerender(() => render());
setWeightRerender(() => render());
setLiftRerender(() => render());
initPanel();
initRestTimer();
view.addEventListener("click", (e) => {
  const el = e.target.closest("[data-act]");
  if (!el || !view.contains(el)) return;
  const act = el.dataset.act;
  const handler = act.startsWith("lift-") ? handleLiftClick : act.startsWith("w-") ? handleWeightClick : handleViewClick;
  handler(act, el).catch((err) => alert(`That did not work: ${err.message}`));
});
// Typing in the workout set rows and picking from its selects.
for (const type of ["input", "change"]) view.addEventListener(type, (e) => { handleLiftInput(e).catch((err) => alert(`That did not work: ${err.message}`)); });

document.querySelector(".tabs").addEventListener("click", (e) => {
  const b = e.target.closest("button[data-tab]");
  if (!b) return;
  if (location.hash !== `#${b.dataset.tab}`) location.hash = b.dataset.tab;
  else render();
  window.scrollTo(0, 0);
});
window.addEventListener("hashchange", () => { render(); view.focus({ preventScroll: true }); });

// ---------- data & backup ----------

function fmtDate(iso) {
  if (!iso) return "never";
  return new Date(iso).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
}

async function renderSheet(message = "", tone = "") {
  let counts = {}, lastExport = null, lastImport = null;
  try {
    counts = countRecords(await db.dumpAll());
    lastExport = await db.getMeta("lastExportAt", null);
    lastImport = await db.getMeta("lastImportAt", null);
  } catch (e) {
    message = message || `Storage is unavailable: ${e.message}`;
    tone = "bad";
  }
  const total = Object.values(counts).reduce((a, b) => a + b, 0);
  sheet.innerHTML = `
    <div class="sheet-head">
      <h2 id="data-title">Data &amp; backup</h2>
      <button type="button" class="icon-btn" data-act="close" aria-label="Close"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18"/></svg></button>
    </div>
    <p class="sub">Everything genki stores stays in this browser on this device unless you turn on Sync below. Export a backup file to keep a copy or move to another device.</p>
    <dl class="facts">
      <div><dt>Records stored</dt><dd>${total}</dd></div>
      <div><dt>Last export</dt><dd>${esc(fmtDate(lastExport))}</dd></div>
      <div><dt>Last import</dt><dd>${esc(fmtDate(lastImport))}</dd></div>
    </dl>
    <div class="stack">
      <button type="button" class="btn" data-act="export">Export backup (JSON)</button>
      <button type="button" class="btn ghost" data-act="import">Import backup…</button>
    </div>
    <p class="hint">Importing replaces what is stored here with the backup's contents.</p>
    <p class="msg ${tone}" role="status">${esc(message)}</p>
    ${await syncSection()}`;
}

async function doExport() {
  const now = new Date();
  const backup = buildBackup(await db.dumpAll(), now);
  const blob = new Blob([JSON.stringify(backup, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = Object.assign(document.createElement("a"), { href: url, download: backupFileName(now) });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
  await db.setMeta("lastExportAt", now.toISOString());
  await renderSheet("Backup downloaded.", "good");
}

async function doImport(file) {
  const parsed = parseBackup(await file.text(), await db.storeNames(), db.KEY_PATHS);
  if (!parsed.ok) { await renderSheet(parsed.error, "bad"); return; }
  const counts = countRecords(parsed.backup.stores);
  const total = Object.values(counts).reduce((a, b) => a + b, 0);
  const when = parsed.backup.exportedAt ? ` from ${fmtDate(parsed.backup.exportedAt)}` : "";
  if (!confirm(`Replace the data on this device with the backup${when} (${total} records)? This cannot be undone.`)) {
    await renderSheet("Import cancelled. Nothing changed.");
    return;
  }
  await db.replaceAll(parsed.backup.stores);
  // The data is replaced by now: a failure to stamp the time must not report "Nothing changed".
  try { await db.setMeta("lastImportAt", new Date().toISOString()); } catch {}
  await renderSheet(`Imported ${total} records.`, "good");
  render();
}

setSyncHooks({ rerender: () => (dialog.open ? renderSheet().catch((e) => console.warn("genki: could not redraw the sheet", e)) : undefined), restored: () => render() });

$("#data-btn").addEventListener("click", async () => {
  clearSyncNote();
  await renderSheet();
  if (!dialog.open) dialog.showModal();
});

sheet.addEventListener("click", async (e) => {
  const act = e.target.closest("[data-act]")?.dataset.act;
  if (act === "close") dialog.close();
  if (act === "export") {
    try { await doExport(); } catch (err) { await renderSheet(`Export failed: ${err.message}`, "bad"); }
  }
  if (act === "import") fileInput.click();
  if (act) handleSyncAct(act);
});
sheet.addEventListener("submit", (e) => {
  e.preventDefault();
  handleSyncSubmit(e.target);
});

// Tap on the backdrop closes the sheet.
dialog.addEventListener("click", (e) => { if (e.target === dialog) dialog.close(); });

fileInput.addEventListener("change", async () => {
  const file = fileInput.files[0];
  fileInput.value = "";
  if (!file) return;
  try { await doImport(file); } catch (err) { await renderSheet(`Import failed: ${err.message}. Nothing changed.`, "bad"); }
});

// ---------- start ----------

try {
  await db.openDB();
  if (!(await db.getMeta("createdAt", null))) await db.setMeta("createdAt", new Date().toISOString());
} catch (e) {
  storeError = e.message;
}
render();
if (!storeError) autoSync();

if ("serviceWorker" in navigator && location.protocol === "https:") {
  navigator.serviceWorker.register("sw.js").catch(() => {});
}
