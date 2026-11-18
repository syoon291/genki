// The Progress tab: a week at a glance (Overview), then Calories, Macros,
// Nutrients and Weight views of the same week, with week navigation and a CSV
// export of the shown week. It only reads: nothing here is stored, so the
// view and the week reset on reload. The maths lives in progress.js.
import * as db from "./db.js";
import { dayKey, shiftDay, weekDays, targets, profileProblems, kgToLb } from "./nutrition.js";
import { summary, sortWeighIns, round1 } from "./weight.js";
import { EXTRAS } from "./foods.js";
import { MACROS, weekTotals, weekAverages, macroSplit, topFoods, weekCsv, weekCsvName, weekMessage } from "./progress.js";
import { esc, int, dec1, announce } from "./ui.js";

let rerender = () => {};
export function setProgressRerender(fn) { rerender = fn; }

const MODES = [
  { id: "overview", label: "Overview" },
  { id: "calories", label: "Calories" },
  { id: "macros", label: "Macros" },
  { id: "nutrients", label: "Nutrients" },
  { id: "weight", label: "Weight" },
];
let mode = "overview";
let week = null; // the Monday of the shown week; null follows the current week
let topMacro = "carbs";

const monday = (key) => weekDays(key)[0];
const shownWeek = () => week ?? monday(dayKey());

function fmtDay(key, opts = { month: "short", day: "numeric" }) {
  const [y, m, d] = key.split("-").map(Number);
  return new Date(y, m - 1, d).toLocaleDateString(undefined, opts);
}
const weekday = (key, style = "short") => fmtDay(key, { weekday: style });

function weekLabel(start) {
  const now = monday(dayKey());
  if (start === now) return "This week";
  if (start === shiftDay(now, -7)) return "Last week";
  return `${fmtDay(start)} – ${fmtDay(shiftDay(start, 6))}`;
}

const signed = (n) => `${n >= 0.05 ? "+" : n <= -0.05 ? "−" : "±"}${Math.abs(n).toFixed(1)}`;

function bar(value, target, cls = "") {
  const pct = target > 0 ? Math.min(100, (value / target) * 100) : 0;
  const over = target > 0 && value > target;
  return `<div class="bar ${cls}${over ? " over" : ""}" aria-hidden="true"><span style="width:${pct.toFixed(1)}%"></span></div>`;
}

async function load() {
  const start = shownWeek();
  const days = weekDays(start);
  const [profile, lists, weighIns] = await Promise.all([
    db.getMeta("profile", null),
    Promise.all(days.map((d) => db.getByIndex("entries", "date", d))),
    db.getAll("weighIns"),
  ]);
  const entries = lists.flat();
  const t = profile && !profileProblems(profile).length ? targets(profile) : null;
  const wk = weekTotals(entries, start);
  return { start, days, profile, t, entries, wk, avg: weekAverages(wk), weighIns };
}

// ---------- the tab ----------

export async function progressView() {
  const d = await load();
  const today = dayKey();
  const label = weekLabel(d.start);
  const isNow = d.start === monday(today);
  const body = { overview, calories, macros, nutrients, weight }[mode](d);
  const logged = d.avg?.days ?? 0;
  return `
    <div class="title-row">
      <h2>Progress</h2>
      <div class="day-nav">
        <button type="button" class="icon-btn" data-act="p-prev" aria-label="Previous week"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M15 5l-7 7 7 7"/></svg></button>
        <button type="button" class="day-label week-label" data-act="p-now" ${isNow ? "disabled" : ""} aria-label="${esc(label)}${isNow ? "" : ", go to this week"}">${esc(label)}</button>
        <button type="button" class="icon-btn" data-act="p-next" aria-label="Next week" ${isNow ? "disabled" : ""}><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 5l7 7-7 7"/></svg></button>
      </div>
    </div>
    <div class="range modes" role="group" aria-label="Show">
      ${MODES.map((m) => `<button type="button" data-act="p-mode" data-mode="${m.id}" aria-pressed="${m.id === mode}">${m.label}</button>`).join("")}
    </div>
    ${body}
    <div class="export">
      <button type="button" class="btn ghost" data-act="p-export" data-week="${d.start}" ${logged ? "" : "disabled"}>Export week (CSV)</button>
      <p class="hint">${logged ? `One row a day, ${esc(fmtDay(d.start))} to ${esc(fmtDay(shiftDay(d.start, 6)))}: kcal, protein, carbs, fat and fiber.` : "Nothing logged this week to export."}</p>
    </div>`;
}

const loggedLine = (avg) => (avg ? `over ${avg.days} logged ${avg.days === 1 ? "day" : "days"}` : "nothing logged this week");

// ---------- overview ----------

function overview(d) {
  return `
    <h3>Calories</h3>
    ${calorieCard(d)}
    <h3>Weight</h3>
    ${weightSummary(d)}
    <h3>Macros</h3>
    ${macroAverages(d)}`;
}

function calorieCard(d, { list = false } = {}) {
  const { avg, t } = d;
  const head = avg
    ? `<div class="sum-row">
        <div><span class="stat-label">Daily average</span><span class="sum-big">${int(avg.kcal)}</span>${t ? `<span class="muted"> / ${int(t.kcal)}</span>` : `<span class="muted"> kcal</span>`}</div>
        <div class="right">${t ? `<span class="sum-left${avg.kcal > t.kcal ? " over-text" : ""}">${int(Math.abs(t.kcal - avg.kcal))}</span><span class="hint"> ${avg.kcal > t.kcal ? "over" : "under"}</span>` : ""}</div>
      </div>
      <p class="hint">${loggedLine(avg)}${t ? "" : ". Set up your profile in Nutrition for a target"}.</p>`
    : `<p class="muted small">Nothing logged this week.</p>`;
  return `<div class="card prog">
    ${head}
    ${kcalChart(d)}
    ${list ? dayList(d) : ""}
  </div>`;
}

// Seven calorie bars, Monday first, with the target as a dashed line.
const CW = 340, CH = 150, CP = { l: 34, r: 6, t: 12, b: 22 };
function kcalChart(d) {
  const { wk, t } = d;
  const today = dayKey();
  const max = Math.max(t ? t.kcal * 1.15 : 0, ...wk.map((x) => (x.n ? x.n.kcal * 1.08 : 0)), 500);
  const step = [250, 500, 1000, 2000].find((s) => max / s <= 4) ?? 2000;
  const top = Math.ceil(max / step) * step;
  const ph = CH - CP.t - CP.b;
  const y = (v) => CP.t + (1 - v / top) * ph;
  const bw = (CW - CP.l - CP.r) / 7;
  const f = (n) => n.toFixed(1);
  const ticks = [];
  for (let v = 0; v <= top; v += step) ticks.push(`<line class="grid" x1="${CP.l}" x2="${CW - CP.r}" y1="${f(y(v))}" y2="${f(y(v))}"/><text class="tick" x="${CP.l - 6}" y="${f(y(v) + 4)}" text-anchor="end">${v >= 1000 ? `${v / 1000}k` : v}</text>`);
  const bars = wk.map((x, i) => {
    const cx = CP.l + i * bw;
    const lbl = `<text class="tick${x.date === today ? " now" : ""}" x="${f(cx + bw / 2)}" y="${CH - 6}" text-anchor="middle">${esc(weekday(x.date, "narrow"))}</text>`;
    if (!x.n) return lbl;
    const over = t && x.n.kcal > t.kcal;
    return `<rect class="kcal-bar${over ? " over" : ""}" x="${f(cx + bw * 0.18)}" y="${f(y(x.n.kcal))}" width="${f(bw * 0.64)}" height="${f(Math.max(0, y(0) - y(x.n.kcal)))}" rx="3"/>${lbl}`;
  }).join("");
  const target = t ? `<line class="target-line" x1="${CP.l}" x2="${CW - CP.r}" y1="${f(y(t.kcal))}" y2="${f(y(t.kcal))}"/>` : "";
  const said = wk.map((x) => `${weekday(x.date, "long")} ${x.n ? `${int(x.n.kcal)}` : "not logged"}`).join(", ");
  const label = `Calories by day: ${said}${t ? `. Target ${int(t.kcal)} kcal` : ""}.`;
  return `<figure class="chart">
    <svg viewBox="0 0 ${CW} ${CH}" role="img" aria-label="${esc(label)}">${ticks.join("")}${bars}${target}</svg>
    <figcaption class="legend"><span class="key kcal">Calories eaten</span>${t ? `<span class="key target">Target ${int(t.kcal)}</span><span class="key over">Over target</span>` : ""}</figcaption>
  </figure>`;
}

function dayList(d) {
  const { wk, t } = d;
  const rows = wk.map((x) => {
    let right = `<span class="hint">Not logged</span>`;
    if (x.n) {
      const diff = t ? t.kcal - x.n.kcal : null;
      right = `${int(x.n.kcal)}${diff === null ? "" : `<span class="hint${diff < 0 ? " over-text" : ""}">${int(Math.abs(diff))} ${diff < 0 ? "over" : "under"}</span>`}`;
    }
    return `<li class="day-row"><span class="entry-name">${esc(weekday(x.date, "long"))}<span class="hint">${esc(fmtDay(x.date))}</span></span><span class="entry-num">${right}</span></li>`;
  }).join("");
  const total = wk.reduce((s, x) => s + (x.n?.kcal ?? 0), 0);
  return `<ul class="entries days-list">${rows}</ul>
    <p class="hint">Week total ${int(total)} kcal${t && d.avg ? `; the target for the ${d.avg.days} logged ${d.avg.days === 1 ? "day" : "days"} is ${int(t.kcal * d.avg.days)}` : ""}.</p>`;
}

// ---------- weight ----------

const kg1 = new Intl.NumberFormat(undefined, { minimumFractionDigits: 1, maximumFractionDigits: 1 });
const lb = (kg) => `${dec1(kgToLb(kg))} lb`;

function weightSummary(d) {
  if (!d.weighIns.length) {
    return `<div class="card empty">
      <p><strong>No weigh-ins yet.</strong></p>
      <p class="muted small">Weigh in most mornings to see your start, current weight and change here.</p>
      <button type="button" class="btn" data-act="w-log">Log weight</button>
    </div>`;
  }
  const goal = d.profile?.goalKg ?? null;
  const s = summary(d.weighIns, goal);
  const change = s.avg - s.start;
  const toward = goal !== null && goal !== s.start ? Math.sign(change) === Math.sign(goal - s.start) : change < 0;
  return `<div class="card">
    <div class="trio">
      <div><span class="stat-label">Start</span><span class="trio-big">${dec1(s.start)}</span><span class="hint">kg</span></div>
      <div><span class="stat-label">Current</span><span class="trio-big">${dec1(s.avg)}</span><span class="hint">kg</span></div>
      <div><span class="stat-label">Change</span><span class="trio-big${Math.abs(change) >= 0.05 && toward ? " good-text" : ""}">${signed(change)}</span><span class="hint">kg</span></div>
    </div>
    <p class="hint">Start is your first week's average, current the last 7 days' (${esc(lb(s.avg))})${goal !== null ? `; goal ${dec1(goal)} kg` : ""}.</p>
  </div>`;
}

function weight(d) {
  const sorted = sortWeighIns(d.weighIns);
  const inWeek = new Map(sorted.filter((w) => d.days.includes(w.date)).map((w) => [w.date, w.kg]));
  const mean = (list) => (list.length ? list.reduce((s, v) => s + v, 0) / list.length : null);
  const thisAvg = mean([...inWeek.values()]);
  const prevDays = weekDays(shiftDay(d.start, -7));
  const prevAvg = mean(sorted.filter((w) => prevDays.includes(w.date)).map((w) => w.kg));
  const rows = d.days.map((day) => `<li class="day-row"><span class="entry-name">${esc(weekday(day, "long"))}<span class="hint">${esc(fmtDay(day))}</span></span><span class="entry-num">${inWeek.has(day) ? `${kg1.format(inWeek.get(day))} kg` : `<span class="hint">No weigh-in</span>`}</span></li>`).join("");
  const weekCard = `<div class="card prog">
    <div class="sum-row">
      <div><span class="stat-label">This week's average</span>${thisAvg === null ? `<span class="muted small"> no weigh-ins</span>` : `<span class="sum-big">${kg1.format(thisAvg)}</span><span class="muted"> kg</span>`}</div>
      <div class="right">${thisAvg !== null && prevAvg !== null ? `<span class="sum-left">${signed(round1(thisAvg - prevAvg))} kg</span><span class="hint"> vs prior week</span>` : ""}</div>
    </div>
    <ul class="entries days-list">${rows}</ul>
    <button type="button" class="btn ghost" data-act="w-log">Log weight</button>
  </div>`;
  return `<h3>Overall</h3>${weightSummary(d)}<h3>The week</h3>${weekCard}`;
}

// ---------- macros ----------

function macroAverages(d) {
  const { avg, t } = d;
  if (!avg) return `<div class="card"><p class="muted small">Nothing logged this week.</p></div>`;
  const split = macroSplit(avg);
  const rows = MACROS.map((m) => {
    const target = m.id === "protein" ? t?.protein : t?.macros[m.id];
    return `<div class="macro-row">
      <div class="sum-row"><span class="stat-label">${m.label}</span><span class="small"><strong class="${m.id}-text">${int(avg[m.id])}g</strong>${target ? `<span class="muted"> / ${int(target)}g</span>` : ""}<span class="hint"> · ${split[m.id]} %</span></span></div>
      ${target ? bar(avg[m.id], target, m.id) : ""}
    </div>`;
  }).join("");
  return `<div class="card prog">
    <p class="hint">Daily average ${loggedLine(avg)}; the percent is each one's share of calories.</p>
    <div class="macro-rows flush">${rows}</div>
  </div>`;
}

function macros(d) {
  const { avg, t, wk } = d;
  if (!avg) return `<h3>Macros</h3><div class="card"><p class="muted small">Nothing logged this week.</p></div>`;
  const split = macroSplit(avg);
  const goal = t ? { carbs: t.macros.carbPct, fat: t.macros.fatPct, protein: t.macros.proteinPct } : null;
  const table = MACROS.map((m) => `<tr><th scope="row"><span class="key ${m.id}">${m.label}</span></th><td>${split[m.id]} %</td><td>${goal ? `${goal[m.id]} %` : "–"}</td><td>${int(avg[m.id])} g</td></tr>`).join("");
  const top = topFoods(d.entries, d.days, topMacro);
  const macroName = MACROS.find((m) => m.id === topMacro).label.toLowerCase();
  const foods = top.length
    ? `<ol class="entries top-foods">${top.map((it) => `<li class="day-row"><span class="entry-name">${esc(it.name)}${it.date ? ` <span class="hint">(${esc(fmtDay(it.date))})</span>` : ""}<span class="hint">${it.times === 1 ? "once" : `${it.times} times`} · ${it.pct} % of the week's ${macroName}</span></span><span class="entry-num"><span class="${topMacro}-text">${dec1(it.grams)} g</span></span></li>`).join("")}</ol>`
    : `<p class="muted small">No ${macroName} logged this week.</p>`;
  return `
    <h3>Daily split</h3>
    <div class="card prog">
      ${splitChart(wk)}
      <table class="split-table">
        <thead><tr><th scope="col">Macro</th><th scope="col">Average</th><th scope="col">Target</th><th scope="col">A day</th></tr></thead>
        <tbody>${table}</tbody>
      </table>
      <p class="hint">Share of calories, ${loggedLine(avg)}.${t ? "" : " Set up your profile in Nutrition for the target split."}</p>
    </div>
    <h3>Foods highest in</h3>
    <div class="card prog">
      <div class="range" role="group" aria-label="Foods highest in">
        ${MACROS.map((m) => `<button type="button" data-act="p-top" data-macro="${m.id}" aria-pressed="${m.id === topMacro}">${m.label}</button>`).join("")}
      </div>
      ${foods}
      <p class="hint">Each MyFitnessPal import is one meal's total, so it shows as one item with its day.</p>
    </div>`;
}

// Seven bars stacked from each macro's share of the day's calories.
function splitChart(wk) {
  const W = 340, H = 140, P = { l: 30, r: 6, t: 6, b: 22 };
  const ph = H - P.t - P.b, bw = (W - P.l - P.r) / 7;
  const f = (n) => n.toFixed(1);
  const today = dayKey();
  const grid = [0, 50, 100].map((v) => { const yy = P.t + (1 - v / 100) * ph; return `<line class="grid" x1="${P.l}" x2="${W - P.r}" y1="${f(yy)}" y2="${f(yy)}"/><text class="tick" x="${P.l - 6}" y="${f(yy + 4)}" text-anchor="end">${v}%</text>`; }).join("");
  const said = [];
  const bars = wk.map((x, i) => {
    const cx = P.l + i * bw;
    const lbl = `<text class="tick${x.date === today ? " now" : ""}" x="${f(cx + bw / 2)}" y="${H - 6}" text-anchor="middle">${esc(weekday(x.date, "narrow"))}</text>`;
    const s = x.n ? macroSplit(x.n) : null;
    if (!s || !(s.carbs + s.fat + s.protein)) { said.push(`${weekday(x.date, "long")} not logged`); return lbl; }
    said.push(`${weekday(x.date, "long")} ${s.carbs} % carbs, ${s.fat} % fat, ${s.protein} % protein`);
    let acc = 0;
    // Carbs at the bottom, then fat, then protein.
    const segs = MACROS.map((m) => {
      const h = (s[m.id] / 100) * ph;
      const yy = P.t + ph - acc - h;
      acc += h;
      return h > 0 ? `<rect class="seg-${m.id}" x="${f(cx + bw * 0.18)}" y="${f(yy)}" width="${f(bw * 0.64)}" height="${f(h)}"/>` : "";
    }).join("");
    return segs + lbl;
  }).join("");
  return `<figure class="chart">
    <svg viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(`Share of calories by day: ${said.join("; ")}.`)}">${grid}${bars}</svg>
    <figcaption class="legend">${MACROS.map((m) => `<span class="key ${m.id}">${m.label}</span>`).join("")}</figcaption>
  </figure>`;
}

// ---------- nutrients ----------

function nutrients(d) {
  const { avg, t } = d;
  if (!avg) return `<h3>Nutrients</h3><div class="card"><p class="muted small">Nothing logged this week.</p></div>`;
  const row = (label, value, unit, target, cls = "") => `<div class="macro-row">
      <div class="sum-row"><span class="stat-label">${label}</span><span class="small"><strong${cls ? ` class="${cls}-text"` : ""}>${int(value)}${unit}</strong>${target ? `<span class="muted"> / ${int(target)}${unit}</span>` : ""}</span></div>
      ${target ? bar(value, target, cls) : ""}
    </div>`;
  const main = [
    row("Calories", avg.kcal, " kcal", t?.kcal),
    row("Protein", avg.protein, "g", t?.protein, "protein"),
    row("Carbs", avg.carbs, "g", t?.macros.carbs, "carbs"),
    row("Fat", avg.fat, "g", t?.macros.fat, "fat"),
  ].join("");
  const extras = EXTRAS.map((x) => {
    const e = avg.extras[x.id];
    if (!e) return `<div class="sum-row small"><span class="stat-label">${x.label}</span><span class="hint">Not listed on this week's foods</span></div>`;
    const v = x.unit === "mg" ? int(e.avg) : dec1(e.avg);
    return `<div class="sum-row small"><span class="stat-label">${x.label}</span><span><strong>${v} ${x.unit}</strong><span class="hint"> · ${e.days} of ${avg.days} days</span></span></div>`;
  }).join("");
  return `
    <h3>Daily average</h3>
    <div class="card prog">
      <p class="hint">${loggedLine(avg)[0].toUpperCase()}${loggedLine(avg).slice(1)}.</p>
      <div class="macro-rows flush">${main}</div>
    </div>
    <h3>Other nutrients</h3>
    <div class="card prog">
      ${extras}
      <p class="hint">Counted only from foods that list them (my foods, recipes and MyFitnessPal imports where they have them; the bundled tables carry none), so the real amounts may be higher.</p>
    </div>`;
}

// ---------- calories ----------

function calories(d) {
  return `<h3>Calories</h3>${calorieCard(d, { list: true })}`;
}

// ---------- taps ----------

export async function handleProgressClick(act, el) {
  if (act === "p-mode") { if (MODES.some((m) => m.id === el.dataset.mode)) mode = el.dataset.mode; rerender(); return; }
  if (act === "p-top") { if (MACROS.some((m) => m.id === el.dataset.macro)) topMacro = el.dataset.macro; rerender(); return; }
  if (act === "p-prev" || act === "p-next" || act === "p-now") {
    const now = monday(dayKey());
    let next = act === "p-now" ? now : shiftDay(shownWeek(), act === "p-prev" ? -7 : 7);
    if (next > now) next = now;
    week = next === now ? null : next;
    await rerender();
    if (shownWeek() !== next) return; // a later tap moved on; its own announcement follows
    const wk = weekTotals(await Promise.all(weekDays(next).map((x) => db.getByIndex("entries", "date", x))).then((l) => l.flat()), next);
    announce(weekMessage(weekLabel(next), weekAverages(wk)));
    return;
  }
  if (act === "p-export") {
    const days = weekDays(el.dataset.week || shownWeek());
    const entries = (await Promise.all(days.map((x) => db.getByIndex("entries", "date", x)))).flat();
    const wk = weekTotals(entries, days[0]);
    const blob = new Blob([weekCsv(wk)], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = Object.assign(document.createElement("a"), { href: url, download: weekCsvName(wk) });
    document.body.append(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 60_000);
    announce(`Week of ${fmtDay(days[0])} exported as CSV.`);
  }
}
