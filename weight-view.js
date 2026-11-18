// Weight on the Today tab: the card (7-day average, weekly change, progress to
// the goal, the chart) and its sheets (log a weigh-in, history, CSV import).
// The maths lives in weight.js. Every weigh-in change also moves the profile's
// weight to the latest 7-day average, so the daily targets follow the trend.
import * as db from "./db.js";
import { dayKey, shiftDay, kgToLb } from "./nutrition.js";
import { summary, trend, sortWeighIns, averageEnding, weightAxis, daysBetween, weightProblem, validDate, parseWeighInCsv, round1, weighInMessage } from "./weight.js";
import { esc, dec1, announce, openPanel, swapPanel, closePanel, panelEl, closeBtn, backBtn } from "./ui.js";

let rerender = () => {};
export function setWeightRerender(fn) { rerender = fn; }

// The chart's range; resets on reload.
const RANGES = [
  { id: "1m", label: "1M", days: 30 },
  { id: "3m", label: "3M", days: 91 },
  { id: "all", label: "All", days: null },
];
let range = "3m";

const lb = (kg) => `${dec1(kgToLb(kg))} lb`;
const signed = (n) => `${n >= 0.05 ? "+" : n <= -0.05 ? "−" : "±"}${Math.abs(n).toFixed(1)}`;

function fmtDay(key, opts = { month: "short", day: "numeric" }) {
  const [y, m, d] = key.split("-").map(Number);
  return new Date(y, m - 1, d).toLocaleDateString(undefined, opts);
}

function relDay(key) {
  const today = dayKey();
  if (key === today) return "today";
  if (key === shiftDay(today, -1)) return "yesterday";
  return fmtDay(key);
}

export async function syncProfileWeight() {
  const profile = await db.getMeta("profile", null);
  if (!profile) return;
  const s = summary(await db.getAll("weighIns"));
  if (s.avg === null) return;
  const kg = round1(s.avg);
  if (kg !== profile.weightKg) await db.setMeta("profile", { ...profile, weightKg: kg, updatedAt: new Date().toISOString() });
}

// ---------- the card ----------

export async function weightCard() {
  const [list, profile] = await Promise.all([db.getAll("weighIns"), db.getMeta("profile", null)]);
  if (!list.length) {
    return `<h3>Weight</h3>
    <div class="card empty">
      <p><strong>No weigh-ins yet.</strong></p>
      <p class="muted small">Weigh in most mornings. Daily weight swings by 0.5-1 kg, so genki tracks the 7-day average.</p>
      <div class="foot-actions tight">
        <button type="button" class="btn" data-act="w-log">Log weight</button>
        <button type="button" class="btn ghost" data-act="w-import">Import CSV</button>
      </div>
    </div>`;
  }
  const goal = profile?.goalKg ?? null;
  const s = summary(list, goal);
  const towardGoal = (d) => (goal !== null && s.start !== null ? Math.sign(d) === Math.sign(goal - s.start) : d < 0);
  const change = s.weekChange === null
    ? `<span class="hint">Change shows after two weeks</span>`
    : `<span class="sum-left${Math.abs(s.weekChange) >= 0.05 && towardGoal(s.weekChange) ? " good-text" : ""}">${signed(s.weekChange)} kg</span><span class="hint"> vs last week</span>`;

  let progress = `<p class="hint">Set a goal weight in <button type="button" class="link-btn inline" data-act="n-profile">Profile &amp; targets</button> to track progress.</p>`;
  if (s.progress) {
    const p = s.progress;
    progress = `<div class="progress">
      <div class="sum-row small"><span>${p.reached ? "<strong class=\"good-text\">Goal reached</strong>" : `<strong>${dec1(Math.max(0, p.lost))} kg</strong> ${goal < s.start ? "lost" : "gained"}`}</span><span class="muted">${p.reached ? `goal ${dec1(goal)} kg` : `${dec1(p.toGo)} kg to ${dec1(goal)} kg`}</span></div>
      <div class="bar goal" aria-hidden="true"><span style="width:${(p.pct * 100).toFixed(1)}%"></span></div>
      <p class="hint">From ${dec1(s.start)} kg, your first week's average${profile?.targetDate ? `; target date ${esc(fmtDay(profile.targetDate, { year: "numeric", month: "short", day: "numeric" }))}` : ""}.</p>
    </div>`;
  }

  return `<h3>Weight</h3>
  <div class="card weight">
    <div class="sum-row">
      <div><span class="stat-label">7-day average</span><span class="sum-big">${dec1(s.avg)}</span><span class="muted"> kg</span><span class="hint"> · ${lb(s.avg)}</span></div>
      <div class="right">${change}</div>
    </div>
    ${progress}
    ${chart(list, profile)}
    <div class="range" role="group" aria-label="Chart range">
      ${RANGES.map((r) => `<button type="button" data-act="w-range" data-range="${r.id}" aria-pressed="${r.id === range}">${r.label}</button>`).join("")}
    </div>
    <p class="hint">Last weigh-in ${dec1(s.latest.kg)} kg, ${esc(relDay(s.latest.date))}.</p>
    <div class="foot-actions tight">
      <button type="button" class="btn" data-act="w-log">Log weight</button>
      <button type="button" class="btn ghost" data-act="w-history">History</button>
    </div>
  </div>`;
}

// ---------- chart ----------

const W = 340, H = 170, PAD = { l: 34, r: 10, t: 10, b: 22 };

function chart(list, profile) {
  const points = trend(list);
  const last = points[points.length - 1].date;
  const r = RANGES.find((x) => x.id === range);
  const goal = profile?.goalKg ?? null;
  const targetDate = profile?.targetDate && validDate(profile.targetDate) ? profile.targetDate : null;
  let from = r.days ? shiftDay(last, -(r.days - 1)) : points[0].date;
  let to = last;
  // "All" runs to the target date, so the plan line shows where it ends.
  if (!r.days && targetDate && targetDate > to) to = targetDate;
  if (from === to) from = shiftDay(to, -6);
  const shown = points.filter((p) => p.date >= from && p.date <= to);

  // The plan: a straight line from the first week's average to the goal on the target date.
  const s = summary(list, goal);
  const plan = goal !== null && targetDate && s.start !== null && targetDate > points[0].date
    ? { a: { date: points[0].date, kg: s.start }, b: { date: targetDate, kg: goal } } : null;

  const vals = shown.flatMap((p) => [p.kg, p.avg]);
  if (goal !== null) vals.push(goal);
  const axis = weightAxis(vals.length ? vals : [s.avg]);
  const span = Math.max(1, daysBetween(from, to));
  const x = (d) => PAD.l + (daysBetween(from, d) / span) * (W - PAD.l - PAD.r);
  const y = (kg) => PAD.t + (1 - (kg - axis.min) / (axis.max - axis.min)) * (H - PAD.t - PAD.b);
  const f = (n) => n.toFixed(1);

  const grid = axis.ticks.map((t) => `<line class="grid" x1="${PAD.l}" x2="${W - PAD.r}" y1="${f(y(t))}" y2="${f(y(t))}"/><text class="tick" x="${PAD.l - 6}" y="${f(y(t) + 4)}" text-anchor="end">${dec1(t)}</text>`).join("");
  const xLabels = [from, to].map((d, i) => `<text class="tick" x="${f(i ? W - PAD.r : PAD.l)}" y="${H - 6}" text-anchor="${i ? "end" : "start"}">${esc(fmtDay(d))}</text>`).join("");
  const goalLine = goal !== null && goal >= axis.min && goal <= axis.max
    ? `<line class="goal-line" x1="${PAD.l}" x2="${W - PAD.r}" y1="${f(y(goal))}" y2="${f(y(goal))}"/><text class="tick goal-label" x="${PAD.l + 4}" y="${f(y(goal) - 5)}" text-anchor="start">Goal ${dec1(goal)}</text>` : "";
  const planLine = plan ? `<line class="plan-line" x1="${f(x(plan.a.date))}" y1="${f(y(plan.a.kg))}" x2="${f(x(plan.b.date))}" y2="${f(y(plan.b.kg))}"/>` : "";
  const dots = shown.map((p) => `<circle class="dot-kg" cx="${f(x(p.date))}" cy="${f(y(p.kg))}" r="2.6"/>`).join("");
  const avgPath = shown.length > 1 ? `<polyline class="avg-line" points="${shown.map((p) => `${f(x(p.date))},${f(y(p.avg))}`).join(" ")}"/>` : "";
  const label = `Weight from ${fmtDay(from)} to ${fmtDay(to)}: ${shown.length} weigh-ins, 7-day average now ${dec1(s.avg)} kg${goal !== null ? `, goal ${dec1(goal)} kg` : ""}.`;
  return `<figure class="chart">
    <svg viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(label)}">
      <defs><clipPath id="w-plot"><rect x="${PAD.l}" y="${PAD.t}" width="${W - PAD.l - PAD.r}" height="${H - PAD.t - PAD.b}"/></clipPath></defs>
      ${grid}${xLabels}
      <g clip-path="url(#w-plot)">${planLine}${goalLine}${dots}${avgPath}</g>
    </svg>
    <figcaption class="legend"><span class="key avg">7-day average</span><span class="key kg">Weigh-ins</span>${plan ? `<span class="key plan">Plan to goal</span>` : ""}</figcaption>
  </figure>`;
}

// ---------- clicks from the card ----------

export async function handleWeightClick(act, el) {
  if (act === "w-range") { range = el.dataset.range; rerender(); }
  else if (act === "w-log") await openLog();
  else if (act === "w-history") await openHistory();
  else if (act === "w-import") pickCsv();
}

// ---------- log / edit a weigh-in ----------

async function openLog(date = dayKey(), { fromHistory = false } = {}) {
  const today = dayKey();
  const existing = await db.get("weighIns", date);
  const html = `
    <div class="sheet-head">${fromHistory ? backBtn() : ""}<h2 id="panel-title" class="grow">${existing ? "Edit weigh-in" : "Log weight"}</h2>${closeBtn}</div>
    <form class="form" id="weigh-form" novalidate>
      <div class="grid2">
        <label class="field"><span>Day</span><input name="date" type="date" max="${today}" value="${esc(date)}" required></label>
        <label class="field"><span>Weight (kg)</span><input name="kg" type="number" inputmode="decimal" step="0.1" min="30" max="300" value="${existing ? esc(existing.kg) : ""}" autofocus><small class="hint" id="weigh-lb">${existing ? lb(existing.kg) : ""}</small></label>
      </div>
      <p class="hint">One weigh-in per day: saving a day that has one replaces it.</p>
      <button class="btn" type="submit">Save</button>
      ${existing ? `<button class="btn danger" type="button" data-act="delete">Delete this weigh-in</button>` : ""}
      <p class="msg bad" role="status" id="weigh-msg"></p>
    </form>`;
  const handlers = {
    click: async (act) => {
      if (act === "back") await openHistory();
      if (act === "delete" && existing) {
        if (!confirm(`Delete the weigh-in on ${fmtDay(existing.date, { weekday: "short", month: "short", day: "numeric" })} (${dec1(existing.kg)} kg)? This cannot be undone.`)) return;
        await db.del("weighIns", existing.date);
        await syncProfileWeight();
        rerender();
        if (fromHistory) await openHistory(); else closePanel();
        announce(weighInMessage(`Weigh-in on ${fmtDay(existing.date)} deleted.`, summary(await db.getAll("weighIns")).avg));
      }
    },
    input: (e) => {
      if (e.target.name === "kg") {
        const kg = Number(e.target.value);
        panelEl().querySelector("#weigh-lb").textContent = kg > 0 ? lb(kg) : "";
      }
    },
    submit: async (form) => {
      const fd = new FormData(form);
      const d = String(fd.get("date") ?? "");
      const raw = String(fd.get("kg") ?? "").trim();
      const kg = raw === "" ? NaN : Number(raw);
      const msg = panelEl().querySelector("#weigh-msg");
      if (!validDate(d) || d > today) { msg.textContent = "Pick a day up to today."; return; }
      const problem = weightProblem(kg);
      if (problem) { msg.textContent = problem; return; }
      // Moving a weigh-in to another day: drop the old day's record.
      if (existing && d !== existing.date) await db.del("weighIns", existing.date);
      await db.put("weighIns", { date: d, kg: round1(kg), at: new Date().toISOString() });
      await syncProfileWeight();
      rerender();
      if (fromHistory) await openHistory(); else closePanel();
      announce(weighInMessage(`Weigh-in saved: ${round1(kg)} kg on ${fmtDay(d)}.`, summary(await db.getAll("weighIns")).avg));
    },
  };
  if (document.querySelector("#panel-dialog").open) swapPanel(html, handlers); else openPanel(html, handlers);
}

// ---------- history ----------

async function openHistory(message = "", tone = "") {
  const sorted = sortWeighIns(await db.getAll("weighIns"));
  const rows = [...sorted].reverse().map((w) => {
    const avg = averageEnding(sorted, w.date);
    return `<li><button type="button" class="entry" data-act="edit" data-date="${esc(w.date)}">
      <span class="entry-name">${esc(fmtDay(w.date, { weekday: "short", year: "numeric", month: "short", day: "numeric" }))}<span class="hint">7-day avg ${dec1(avg)} kg</span></span>
      <span class="entry-num">${dec1(w.kg)} kg<span class="hint">${lb(w.kg)}</span></span>
    </button></li>`;
  }).join("");
  const html = `
    <div class="sheet-head"><h2 id="panel-title">Weigh-ins</h2>${closeBtn}</div>
    <p class="sub">${sorted.length ? `${sorted.length} ${sorted.length === 1 ? "day" : "days"}, newest first. Tap one to change or delete it.` : "None yet."}</p>
    <div class="foot-actions tight">
      <button type="button" class="btn" data-act="new">Log weight</button>
      <button type="button" class="btn ghost" data-act="import">Import CSV</button>
    </div>
    <p class="hint">CSV: one <code>date,weight_kg</code> row per line, dates as YYYY-MM-DD, for example <code>2026-01-05,80.4</code>. Days already logged are replaced.</p>
    <p class="msg ${tone}" role="status">${esc(message)}</p>
    ${rows ? `<ul class="entries">${rows}</ul>` : ""}`;
  const handlers = {
    click: async (act, el) => {
      if (act === "edit") await openLog(el.dataset.date, { fromHistory: true });
      if (act === "new") await openLog(dayKey(), { fromHistory: true });
      if (act === "import") pickCsv();
    },
  };
  if (document.querySelector("#panel-dialog").open) swapPanel(html, handlers); else openPanel(html, handlers);
}

// ---------- CSV import ----------

let csvInput;
function pickCsv() {
  if (!csvInput) {
    csvInput = Object.assign(document.createElement("input"), { type: "file", accept: ".csv,text/csv,text/plain", hidden: true });
    document.body.append(csvInput);
    csvInput.addEventListener("change", async () => {
      const file = csvInput.files[0];
      csvInput.value = "";
      if (!file) return;
      try { await importCsv(await file.text()); }
      catch (err) { await openHistory(`Import failed: ${err.message}. Nothing changed.`, "bad"); }
    });
  }
  csvInput.click();
}

async function importCsv(text) {
  const { rows, skipped } = parseWeighInCsv(text);
  const today = dayKey();
  const future = rows.filter((r) => r.date > today);
  const usable = rows.filter((r) => r.date <= today);
  const skipNote = [...skipped.map((s) => `line ${s.line}: ${s.reason}`), ...future.map((r) => `${r.date}: a day in the future`)];
  if (!usable.length) {
    await openHistory(`No weigh-ins found in that file.${skipNote.length ? ` Skipped ${skipNote.slice(0, 3).join("; ")}${skipNote.length > 3 ? "; …" : ""}.` : ""}`, "bad");
    return;
  }
  const have = new Set((await db.getAll("weighIns")).map((w) => w.date));
  const replacing = usable.filter((r) => have.has(r.date)).length;
  const lines = [
    `Add ${usable.length} weigh-ins from ${usable[0].date} to ${usable[usable.length - 1].date}?`,
    replacing ? `${replacing} of those days already have one, which the file replaces.` : "",
    skipNote.length ? `${skipNote.length} ${skipNote.length === 1 ? "line is" : "lines are"} skipped (${skipNote.slice(0, 3).join("; ")}${skipNote.length > 3 ? "; …" : ""}).` : "",
  ].filter(Boolean);
  if (!confirm(lines.join("\n\n"))) { await openHistory("Import cancelled. Nothing changed."); return; }
  const at = new Date().toISOString();
  await db.putMany("weighIns", usable.map((r) => ({ ...r, at })));
  await syncProfileWeight();
  rerender();
  await openHistory(`Imported ${usable.length} weigh-ins${skipNote.length ? `, skipped ${skipNote.length} ${skipNote.length === 1 ? "line" : "lines"}` : ""}.`, "good");
}
