// genki app shell: four tabs (Today / Nutrition / Workouts / Progress) rendered into
// (Today: the nutrition tiles, the coach cards from coach-view.js, the weight card from weight-view.js and the
// next-workout card from workouts-view.js; Progress: the week views from progress-view.js)
// <main id="view">, and the Data & backup sheet (JSON export/import, and the
// Account section from account-view.js, and the Sync section from sync-view.js).
// The tab is kept in the URL hash so a reload stays where you were.
import * as db from "./db.js";
import { buildBackup, backupFileName, parseBackup } from "./backup.js";
import { recordCount, mergeStores, diffStores } from "./merge.js";
import { esc, initPanel, focusKey, restoreFocus } from "./ui.js";
import { syncSection, handleSyncAct, handleSyncSubmit, setSyncHooks, clearSyncNote, autoSync, syncErrorNotice, hideSyncNotice } from "./sync-view.js";
import { nutritionView, todayTiles, handleViewClick, setRerender } from "./nutrition-view.js";
import { weightCard, handleWeightClick, setWeightRerender, syncProfileWeight } from "./weight-view.js";
import { detectMfpFile, parseMfpNutrition, parseMfpWeights, parseMfpExercise, planMfpImport, mfpConfirmText, planIsEmpty } from "./mfp.js";
import { dayKey } from "./nutrition.js";
import { progressView, handleProgressClick, setProgressRerender } from "./progress-view.js";
import { handleScanClick, setScanRerender } from "./scans-view.js";
import { fastingCard, dayTrackersCard, handleTrackerClick, setTrackerRerender, initFastClock } from "./trackers-view.js";
import { workoutsView, nextWorkoutCard, handleLiftClick, handleLiftInput, setLiftRerender, initRestTimer } from "./workouts-view.js";
import { coachCards, handleCoachClick, setCoachRerender } from "./coach-view.js";
import { initContrast, setContrast, contrastSection } from "./contrast.js";
import { accountsOn, accountSection, handleAccountAct, handleAccountSubmit, setAccountHooks, clearAccountNote, accountAutoSync, accountErrorNotice, hideAccountNotice, acceptSignInLink, isSignInHash } from "./account-view.js";

const TABS = ["today", "nutrition", "workouts", "progress"];
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
    ${storeError ? "" : await accountErrorNotice()}
    ${storeError ? "" : await syncErrorNotice()}
    ${storeError ? "" : await todayTiles()}
    <a class="btn ghost log-link" href="#nutrition">Log food</a>
    ${storeError ? "" : await coachCards()}
    ${storeError ? "" : await fastingCard()}
    ${storeError ? "" : await dayTrackersCard()}
    ${storeError ? "" : await weightCard()}
    ${storeError ? "" : await nextWorkoutCard()}`,
  nutrition: () => (storeError ? `<h2>Nutrition</h2>` : nutritionView()),
  workouts: () => (storeError ? `<h2>Workouts</h2>` : workoutsView()),
  progress: () => (storeError ? `<h2>Progress</h2>` : progressView()),
};

// Views read IndexedDB, so rendering is async; a newer render wins over a slower older one.
let renderSeq = 0;
async function render() {
  const seq = ++renderSeq;
  const tab = currentTab();
  document.title = `${tab[0].toUpperCase()}${tab.slice(1)} · genki`;
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
  // Keep focus on the same control across the re-render (a day arrow, a toggle).
  const active = view.contains(document.activeElement) ? focusKey(document.activeElement) : null;
  view.innerHTML = banner + html;
  const again = active && view.querySelector(active);
  if (again && !again.disabled) again.focus({ preventScroll: true });
  else if (active) view.focus({ preventScroll: true });
  restoreFocus(view);
}

setRerender(() => render());
setWeightRerender(() => render());
setLiftRerender(() => render());
initContrast();
setProgressRerender(() => render());
setScanRerender(() => render());
setTrackerRerender(() => render());
setCoachRerender(() => render());
initPanel();
initRestTimer();
initFastClock();
view.addEventListener("click", (e) => {
  const el = e.target.closest("[data-act]");
  if (!el || !view.contains(el)) return;
  const act = el.dataset.act;
  if (act === "account-notice-open") { openSheet("account").catch((err) => alert(`That did not work: ${err.message}`)); return; }
  if (act === "account-notice-hide") {
    hideAccountNotice().then(() => render(), (err) => alert(`That did not work: ${err.message}`));
    return;
  }
  if (act === "sync-notice-open") { openSheet("sync").catch((err) => alert(`That did not work: ${err.message}`)); return; }
  if (act === "sync-notice-hide") {
    hideSyncNotice().then(() => render(), (err) => alert(`That did not work: ${err.message}`));
    return;
  }
  const handler = act.startsWith("lift-") ? handleLiftClick : act.startsWith("w-") ? handleWeightClick : act.startsWith("p-") ? handleProgressClick : act.startsWith("bs-") ? handleScanClick : act.startsWith("t-") ? handleTrackerClick : act.startsWith("c-") ? handleCoachClick : handleViewClick;
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
  let total = 0, lastExport = null, lastImport = null;
  try {
    total = recordCount(await db.dumpAll());
    lastExport = await db.getMeta("lastExportAt", null);
    lastImport = await db.getMeta("lastImportAt", null);
  } catch (e) {
    message = message || `Storage is unavailable: ${e.message}`;
    tone = "bad";
  }
  sheet.innerHTML = `
    <div class="sheet-head">
      <h2 id="data-title">Data &amp; backup</h2>
      <button type="button" class="icon-btn" data-act="close" aria-label="Close"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18"/></svg></button>
    </div>
    <p class="sub">Everything genki stores stays in this browser on this device unless you ${accountsOn() ? "sign in to your account or " : ""}turn on Sync below. Export a backup file to keep a copy or move to another device.</p>
    <dl class="facts">
      <div><dt>Records stored</dt><dd>${total}</dd></div>
      <div><dt>Last export</dt><dd>${esc(fmtDate(lastExport))}</dd></div>
      <div><dt>Last import</dt><dd>${esc(fmtDate(lastImport))}</dd></div>
    </dl>
    <div class="stack">
      <button type="button" class="btn" data-act="export">Export backup (JSON)</button>
      <button type="button" class="btn ghost" data-act="import">Import backup…</button>
    </div>
    <p class="hint">Importing merges the backup into what is stored here: records from both are kept, and where both have the same one, the newer edit wins. Nothing is replaced.</p>
    <div class="stack">
      <button type="button" class="btn ghost" data-act="mfp">Import MyFitnessPal…</button>
    </div>
    <p class="hint">Pick the CSV files from a MyFitnessPal export (Nutrition-Summary, Measurement-Summary, Exercise-Summary). Each day's meals go into the food log, meals you had more than once become my foods, weights fill days with no weigh-in, and exercise calories and steps fill days with no exercise logged. Nothing already here is replaced.</p>
    <p class="msg ${tone}" role="status">${esc(message)}</p>
    ${await accountSection()}
    ${contrastSection()}
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
  const total = recordCount(parsed.backup.stores);
  const when = parsed.backup.exportedAt ? ` from ${fmtDate(parsed.backup.exportedAt)}` : "";
  if (!confirm(`Merge the backup${when} (${total} records) into the data on this device? Records from both are kept; where both have the same one, the newer edit wins. Nothing is replaced.`)) {
    await renderSheet("Import cancelled. Nothing changed.");
    return;
  }
  // Owner decision: an import merges, never replaces (the same merge as sync).
  const local = await db.dumpAll();
  const merged = mergeStores(local, parsed.backup.stores, db.KEY_PATHS);
  const { applied } = await db.applyChanges(diffStores(local, merged, db.KEY_PATHS));
  // The data has changed by now: a failure to stamp the time must not report "Nothing changed".
  try { await db.setMeta("lastImportAt", new Date().toISOString()); } catch {}
  await renderSheet(applied ? `Imported: ${applied} ${applied === 1 ? "record" : "records"} added or updated.` : "Everything in that backup is already here. Nothing changed.", "good");
  render();
}

// ---------- MyFitnessPal import ----------

let mfpInput;
function pickMfp() {
  if (!mfpInput) {
    mfpInput = Object.assign(document.createElement("input"), { type: "file", accept: ".csv,text/csv,text/plain", multiple: true, hidden: true });
    document.body.append(mfpInput);
    mfpInput.addEventListener("change", async () => {
      const files = [...mfpInput.files];
      mfpInput.value = "";
      if (!files.length) return;
      try { await importMfp(files); }
      catch (err) { await renderSheet(`MyFitnessPal import failed: ${err.message}`, "bad"); }
    });
  }
  mfpInput.click();
}

async function importMfp(files) {
  const meals = [], weights = [], exercise = [], ignored = [];
  let skipped = 0, unit = "lb";
  for (const file of files) {
    const text = await file.text();
    const kind = detectMfpFile(text);
    if (kind === "nutrition") { const r = parseMfpNutrition(text); meals.push(...r.rows); skipped += r.skipped.length; }
    else if (kind === "measurement") { const r = parseMfpWeights(text); weights.push(...r.rows); skipped += r.skipped.length; unit = r.unit; }
    else if (kind === "exercise") { const r = parseMfpExercise(text); exercise.push(...r.rows); skipped += r.skipped.length; }
    else ignored.push(`${file.name} is not a MyFitnessPal export file and is left out.`);
  }
  const [entries, myFoods, weighIns, days] = await Promise.all([db.getAll("entries"), db.getAll("myFoods"), db.getAll("weighIns"), db.getAll("days")]);
  const plan = planMfpImport({ meals, weights, exercise, entries, myFoods, weighIns, days, today: dayKey() });
  const found = meals.length || weights.length || exercise.length;
  if (planIsEmpty(plan)) {
    const why = found ? "Everything in those files is already here." : "No meals, weights or exercise found in those files.";
    await renderSheet(`${why} Nothing changed.${ignored.length ? ` ${ignored.join(" ")}` : ""}`, found ? "" : "bad");
    return;
  }
  if (!confirm(mfpConfirmText(plan, { ignored, skipped, unit }))) { await renderSheet("Import cancelled. Nothing changed."); return; }
  const entriesOut = [...plan.entries, ...plan.fillEntries], foodsOut = [...plan.myFoods, ...plan.fillFoods];
  if (entriesOut.length) await db.putMany("entries", entriesOut);
  if (foodsOut.length) await db.putMany("myFoods", foodsOut);
  if (plan.weighIns.length) { await db.putMany("weighIns", plan.weighIns); await syncProfileWeight(); }
  if (plan.days.length) await db.putMany("days", plan.days);
  const done = [
    plan.entries.length ? `${plan.entries.length} ${plan.entries.length === 1 ? "meal" : "meals"}` : "",
    plan.myFoods.length ? `${plan.myFoods.length} ${plan.myFoods.length === 1 ? "my food" : "my foods"}` : "",
    plan.weighIns.length ? `${plan.weighIns.length} ${plan.weighIns.length === 1 ? "weigh-in" : "weigh-ins"}` : "",
    plan.days.length ? `exercise on ${plan.days.length} ${plan.days.length === 1 ? "day" : "days"}` : "",
  ].filter(Boolean);
  const filled = plan.fillEntries.length + plan.fillFoods.length;
  const fillNote = filled ? `Filled in fiber, sugar and sodium on ${filled} ${filled === 1 ? "record" : "records"} imported before.` : "";
  await renderSheet(`${done.length ? `Imported ${done.join(", ")} from MyFitnessPal.` : ""}${done.length && fillNote ? " " : ""}${fillNote}${plan.myFoods.length ? " Rename the new my foods in Nutrition > My foods." : ""}`, "good");
  render();
}

// A sync result redraws the sheet when it is open, and the tab (the Today notice).
setSyncHooks({
  rerender: () => {
    render();
    return dialog.open ? renderSheet().catch((e) => console.warn("genki: could not redraw the sheet", e)) : undefined;
  },
  restored: () => render(),
});
setAccountHooks({
  rerender: () => {
    render();
    return dialog.open ? renderSheet().catch((e) => console.warn("genki: could not redraw the sheet", e)) : undefined;
  },
  restored: () => render(),
});

// The Data & backup sheet; from a Today notice it opens at that section ("sync", "account").
async function openSheet(section = "", { keepNotes = false } = {}) {
  if (!keepNotes) { clearSyncNote(); clearAccountNote(); }
  await renderSheet();
  if (!dialog.open) dialog.showModal();
  if (section) sheet.querySelector(`#${section}-title`)?.scrollIntoView({ block: "start" });
}
$("#data-btn").addEventListener("click", () => openSheet());

sheet.addEventListener("click", async (e) => {
  const act = e.target.closest("[data-act]")?.dataset.act;
  if (act === "close") dialog.close();
  if (act === "export") {
    try { await doExport(); } catch (err) { await renderSheet(`Export failed: ${err.message}`, "bad"); }
  }
  if (act === "import") fileInput.click();
  if (act === "mfp") pickMfp();
  if (act === "contrast") {
    const v = e.target.closest("[data-act]").dataset.v;
    setContrast(v);
    await renderSheet();
    sheet.querySelector(`[data-act="contrast"][data-v="${v}"]`)?.focus();
  }
  if (act && !handleAccountAct(act)) handleSyncAct(act);
});
sheet.addEventListener("submit", (e) => {
  e.preventDefault();
  if (!handleAccountSubmit(e.target)) handleSyncSubmit(e.target);
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

// The email sign-in link lands here with the tokens in the URL hash: take
// them out of the address bar (and history) before anything else runs.
const signInHash = isSignInHash(location.hash) ? location.hash : "";
if (signInHash) history.replaceState(null, "", `${location.pathname}${location.search}#today`);

try {
  await db.openDB();
  if (!(await db.getMeta("createdAt", null))) await db.setMeta("createdAt", new Date().toISOString());
} catch (e) {
  storeError = e.message;
}
render();
if (!storeError && signInHash) acceptSignInLink(signInHash).then((handled) => { if (handled) openSheet("account", { keepNotes: true }); }, (e) => console.warn("genki: sign-in link failed", e));
if (!storeError) { autoSync(); if (!signInHash) accountAutoSync(); }

if ("serviceWorker" in navigator && location.protocol === "https:") {
  navigator.serviceWorker.register("sw.js").catch(() => {});
}
