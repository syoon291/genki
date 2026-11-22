// Body scans on the Progress tab: the card (the latest scan and its change
// since the last one), the add/edit sheet and the history sheet. The maths
// and parsing live in scans.js. Scans never touch the weigh-ins.
import * as db from "./db.js";
import { dayKey } from "./nutrition.js";
import { SCAN_FIELDS, parseScanForm, sortScans, shown, scanChanges, overWeighIn, scanMessage, fromKg } from "./scans.js";
import { esc, announce, openPanel, swapPanel, closePanel, panelEl, closeBtn, backBtn } from "./ui.js";

let rerender = () => {};
export function setScanRerender(fn) { rerender = fn; }

const UNIT_KEY = "scanUnit";
const getUnit = async () => ((await db.getMeta(UNIT_KEY, "lb")) === "kg" ? "kg" : "lb");

function fmtDay(key, opts = { weekday: "short", month: "short", day: "numeric" }) {
  const [y, m, d] = key.split("-").map(Number);
  return new Date(y, m - 1, d).toLocaleDateString(undefined, opts);
}

const places = (f) => (f.id === "ecwTbw" ? 3 : f.id === "bmr" ? 0 : 1);
const num = (n, p) => new Intl.NumberFormat(undefined, { minimumFractionDigits: p, maximumFractionDigits: p }).format(n);
const unitOf = (f, unit) => (f.mass ? unit : f.unit);
const withUnit = (v, f, unit) => `${num(v, places(f))}${unitOf(f, unit) ? `${f.unit === "%" ? "" : " "}${unitOf(f, unit)}` : ""}`;
function deltaText(c, unit) {
  if (c.delta === null) return "";
  const p = places(c.field);
  const r = Number(c.delta.toFixed(p));
  const sign = r > 0 ? "+" : r < 0 ? "−" : "±";
  return `${sign}${num(Math.abs(r), p)}${unitOf(c.field, unit) ? `${c.field.unit === "%" ? "" : " "}${unitOf(c.field, unit)}` : ""}`;
}
const when = (s) => `${fmtDay(s.date)}${s.time ? `, ${s.time}` : ""}`;

// ---------- the card ----------

// scans and weighIns as stored; returns the card's HTML.
export function scansCard(scans, weighIns, unit) {
  if (!scans.length) {
    return `<div class="card empty">
      <p><strong>No body scans yet.</strong></p>
      <p class="muted small">Add an InBody (or similar) printout to track muscle and body fat week to week. Its weight stays apart from your morning weigh-ins.</p>
      <button type="button" class="btn" data-act="bs-add">Add scan</button>
    </div>`;
  }
  const sorted = sortScans(scans);
  const cur = sorted[sorted.length - 1], prev = sorted.length > 1 ? sorted[sorted.length - 2] : null;
  const changes = scanChanges(cur, prev, unit);
  const top = ["smmKg", "pbf", "fatKg"].map((id) => changes.find((c) => c.field.id === id)).filter(Boolean);
  const rest = changes.filter((c) => !top.includes(c));
  const trio = top.map((c) => `<div><span class="stat-label">${esc(c.field.short ?? c.field.label)}</span><span class="trio-big">${num(c.value, places(c.field))}</span><span class="hint">${esc(unitOf(c.field, unit))}${c.delta === null ? "" : ` · <span class="${c.good === true ? "good-text" : ""}">${esc(deltaText(c, unit))}</span>`}</span></div>`).join("");
  const over = overWeighIn(cur, weighIns);
  const rows = rest.map((c) => {
    let note = c.delta === null ? "" : `<span class="hint${c.good === true ? " good-text" : ""}">${esc(deltaText(c, unit))}</span>`;
    if (c.field.id === "weightKg" && over !== null) note = `<span class="hint">${esc(`${over >= 0 ? "+" : "−"}${num(Math.abs(fromKg(over, unit)), 1)} ${unit} on that morning's weigh-in`)}</span>`;
    return `<li class="day-row"><span class="entry-name">${esc(c.field.label)}</span><span class="entry-num">${esc(withUnit(c.value, c.field, unit))}${note}</span></li>`;
  }).join("");
  return `<div class="card prog">
    <p class="hint">Latest scan ${esc(when(cur))}${prev ? `; changes since ${esc(fmtDay(prev.date, { month: "short", day: "numeric" }))}` : ""}.</p>
    ${trio ? `<div class="trio">${trio}</div>` : ""}
    ${rows ? `<ul class="entries days-list">${rows}</ul>` : ""}
    <p class="hint">The scan's weight is with clothes on, so it is kept here and never changes your weigh-ins or 7-day average.</p>
    <div class="foot-actions tight">
      <button type="button" class="btn" data-act="bs-add">Add scan</button>
      <button type="button" class="btn ghost" data-act="bs-history">All scans (${sorted.length})</button>
    </div>
  </div>`;
}

// A one-line summary for the Overview, or "" without scans.
export function scanLine(scans, unit) {
  if (!scans.length) return "";
  const sorted = sortScans(scans);
  const cur = sorted[sorted.length - 1];
  const parts = SCAN_FIELDS.filter((f) => ["smmKg", "pbf"].includes(f.id)).map((f) => {
    const v = shown(cur, f, unit);
    return v === null ? null : `${f.short} ${withUnit(v, f, unit)}`;
  }).filter(Boolean);
  return `<p class="hint">Body scan ${esc(fmtDay(cur.date, { month: "short", day: "numeric" }))}${parts.length ? `: ${esc(parts.join(", "))}` : ""}. More under Weight.</p>`;
}

// ---------- taps ----------

export async function handleScanClick(act, el) {
  if (act === "bs-add") await openScan(null);
  else if (act === "bs-history") await openHistory();
}

// ---------- add / edit ----------

async function openScan(id, { fromHistory = false } = {}) {
  const today = dayKey();
  const existing = id ? await db.get("bodyScans", id) : null;
  let unit = existing?.unit ?? (await getUnit());
  const val = (f) => {
    const v = shown(existing, f, unit);
    return v === null ? "" : String(Number(v.toFixed(places(f))));
  };
  const field = (f) => {
    const step = f.mass ? "0.1" : String(f.step);
    const u = f.mass ? `<span data-unit>${unit}</span>` : esc(f.unit);
    return `<label class="field"><span>${esc(f.label)}${u ? ` (${u})` : ""}</span><input name="${f.id}" type="number" inputmode="decimal" step="${step}" value="${esc(val(f))}"${f.id === "weightKg" && !existing ? " autofocus" : ""}></label>`;
  };
  const html = `
    <div class="sheet-head">${fromHistory ? backBtn() : ""}<h2 id="panel-title" class="grow">${existing ? "Edit body scan" : "Add body scan"}</h2>${closeBtn}</div>
    <p class="sub">Copy the numbers from the printout. Leave a box empty when it is not on yours; only the weight is needed.</p>
    <form class="form" id="scan-form" novalidate>
      <div class="grid2">
        <label class="field"><span>Day</span><input name="date" type="date" max="${today}" value="${esc(existing?.date ?? today)}" required></label>
        <label class="field"><span>Time (optional)</span><input name="time" type="time" value="${esc(existing?.time ?? "")}"></label>
      </div>
      <fieldset class="seg"><legend>Weights on the printout are in</legend>
        <label><input type="radio" name="unit" value="lb" ${unit === "lb" ? "checked" : ""}><span>lb</span></label>
        <label><input type="radio" name="unit" value="kg" ${unit === "kg" ? "checked" : ""}><span>kg</span></label>
      </fieldset>
      <div class="grid2">${SCAN_FIELDS.map(field).join("")}</div>
      <button class="btn" type="submit">Save</button>
      ${existing ? `<button class="btn danger" type="button" data-act="delete">Delete this scan</button>` : ""}
      <p class="msg bad" role="status" id="scan-msg"></p>
    </form>`;
  const handlers = {
    click: async (act) => {
      if (act === "back") await openHistory();
      if (act === "delete" && existing) {
        if (!confirm(`Delete the body scan from ${when(existing)}? This cannot be undone.`)) return;
        await db.del("bodyScans", existing.id);
        rerender();
        if (fromHistory) await openHistory(); else closePanel();
        announce(`Body scan from ${fmtDay(existing.date)} deleted.`);
      }
    },
    input: (e) => {
      if (e.target.name !== "unit") return;
      unit = e.target.value === "kg" ? "kg" : "lb";
      for (const s of panelEl().querySelectorAll("[data-unit]")) s.textContent = unit;
    },
    submit: async (form) => {
      const values = Object.fromEntries(new FormData(form));
      const msg = panelEl().querySelector("#scan-msg");
      const { scan, error } = parseScanForm(values, today);
      if (error) { msg.textContent = error; return; }
      const all = await db.getAll("bodyScans");
      const clash = all.find((s) => s.id === scan.id && s.id !== existing?.id);
      if (clash && !confirm(`There is already a scan on ${when(clash)}. Replace it?`)) return;
      const record = { ...scan, at: new Date().toISOString() };
      await db.put("bodyScans", record);
      // Moving a scan to another day or time: drop the old record (after the new one is safe).
      if (existing && existing.id !== scan.id) await db.del("bodyScans", existing.id);
      await db.setMeta(UNIT_KEY, scan.unit);
      const before = sortScans(all.filter((s) => s.id !== scan.id && s.id !== existing?.id && (s.date < scan.date || (s.date === scan.date && (s.time ?? "") < (scan.time ?? "")))));
      rerender();
      if (fromHistory) await openHistory(); else closePanel();
      announce(scanMessage(record, before[before.length - 1] ?? null, scan.unit));
    },
  };
  if (document.querySelector("#panel-dialog").open) swapPanel(html, handlers); else openPanel(html, handlers);
}

// ---------- history ----------

async function openHistory() {
  const unit = await getUnit();
  const sorted = sortScans(await db.getAll("bodyScans"));
  const f = (id) => SCAN_FIELDS.find((x) => x.id === id);
  const rows = [...sorted].reverse().map((s) => {
    const bits = ["smmKg", "pbf"].map((id) => { const v = shown(s, f(id), unit); return v === null ? null : `${f(id).short} ${withUnit(v, f(id), unit)}`; }).filter(Boolean);
    return `<li><button type="button" class="entry" data-act="edit" data-id="${esc(s.id)}">
      <span class="entry-name">${esc(fmtDay(s.date, { weekday: "short", year: "numeric", month: "short", day: "numeric" }))}${s.time ? `<span class="hint">${esc(s.time)}</span>` : ""}</span>
      <span class="entry-num">${esc(withUnit(shown(s, f("weightKg"), unit), f("weightKg"), unit))}<span class="hint">${esc(bits.join(" · "))}</span></span>
    </button></li>`;
  }).join("");
  const html = `
    <div class="sheet-head"><h2 id="panel-title">Body scans</h2>${closeBtn}</div>
    <p class="sub">${sorted.length ? `${sorted.length} ${sorted.length === 1 ? "scan" : "scans"}, newest first. Tap one to change or delete it.` : "None yet."}</p>
    <button type="button" class="btn" data-act="new">Add scan</button>
    ${rows ? `<ul class="entries spaced">${rows}</ul>` : ""}`;
  const handlers = {
    click: async (act, el) => {
      if (act === "edit") await openScan(el.dataset.id, { fromHistory: true });
      if (act === "new") await openScan(null, { fromHistory: true });
    },
  };
  if (document.querySelector("#panel-dialog").open) swapPanel(html, handlers); else openPanel(html, handlers);
}

export { getUnit as scanUnit };
