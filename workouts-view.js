// The Workouts tab (ported from Liftlog): Train (start a plan day, log sets
// pre-filled from last time, rest timer), Progress (strength trend, PRs,
// sets per muscle, weekly volume, consistency, history) and Plan (build a plan
// from a template, units, CSV export, Liftlog import). Also the Today tab's
// "Next workout" card. The maths lives in workouts.js.
//
// State: finished sessions in the `workouts` store; the plan, the rotation
// position, the session in progress, the unit and the plan form in `meta`.
import * as db from "./db.js";
import * as L from "./workouts.js";
import { esc, int, announce } from "./ui.js";

let rerender = () => {};
export function setLiftRerender(fn) { rerender = fn; }

const META = { plan: "liftPlan", next: "liftNext", draft: "liftDraft", unit: "liftUnit", form: "liftForm", focus: "liftFocus", liftlog: "liftlogImport" };
const DEFAULT_FORM = { goal: "hypertrophy", days: 3, equip: "gym", level: "intermediate" };
const DAY = L.DAY;

let S = null;          // state as of the last render
let sub = null;        // "train" | "progress" | "plan"; resets on reload
let lastSaved = null;  // summary card after finishing a session
let note = null;       // { text, tone } for the Plan tab's status line, shown once

async function load() {
  const [plan, next, draft, unit, form, focus, liftlog, sessions] = await Promise.all([
    db.getMeta(META.plan, null), db.getMeta(META.next, 0), db.getMeta(META.draft, null), db.getMeta(META.unit, "kg"),
    db.getMeta(META.form, null), db.getMeta(META.focus, null), db.getMeta(META.liftlog, null), db.getAll("workouts"),
  ]);
  S = { plan, next, draft, unit: L.UNITS.includes(unit) ? unit : "kg", form: { ...DEFAULT_FORM, ...(form || {}) }, focus, liftlog, sessions };
  return S;
}

// ---------- formats ----------
const u = () => S.unit;
const disp = (kg) => (S.unit === "lb" ? kg * L.LB_PER_KG : kg);
const fmtW = (kg, ex) => L.fmtWeight(kg, S.unit, ex);
const fmtBig = (kg) => { const v = disp(kg); return v >= 1e6 ? (v / 1e6).toFixed(1) + "M" : v >= 1e4 ? Math.round(v / 1e3) + "k" : int(v); };
const date = (d) => new Date(d).toLocaleDateString(undefined, { month: "short", day: "numeric" });
const dur = (s) => `${Math.floor(s / 60)}:${String(Math.round(s % 60)).padStart(2, "0")}`;
const exName = (id) => (L.BY_ID[id] ? L.BY_ID[id].name : id);
const plural = (n, w) => `${n} ${w}${n === 1 ? "" : "s"}`;

function toggles(act, value, opts, label, extra = "") {
  return `<div class="range" role="group" aria-label="${esc(label)}" style="grid-template-columns:repeat(${opts.length},1fr)">${opts.map(([v, l]) => `<button type="button" data-act="${act}" data-val="${esc(v)}" ${extra} aria-pressed="${String(v) === String(value)}">${esc(l)}</button>`).join("")}</div>`;
}

// ---------- the tab ----------

export async function workoutsView() {
  await load();
  if (!sub) sub = S.plan ? "train" : "plan";
  const body = { train: viewTrain, progress: viewProgress, plan: viewPlan }[sub]();
  note = null;
  return `<div class="lift">
    <h2>Workouts</h2>
    <p class="sub">Your plan, your sets, your records.</p>
    ${toggles("lift-sub", sub, [["train", "Train"], ["progress", "Progress"], ["plan", "Plan"]], "Workouts section")}
    ${liftlogOffer()}
    ${body}
  </div>`;
}

// Liftlog on the website kept its data in this browser (same origin on GitHub
// Pages). Offer it once while there is something new to bring over.
function liftlogData() {
  try { return L.fromLiftlog(localStorage.getItem(L.LIFTLOG_KEY)); } catch { return null; }
}
function liftlogOffer() {
  if (S.liftlog) return ""; // dismissed, or already brought over
  const d = liftlogData();
  if (!d) return "";
  const fresh = L.newSessions(S.sessions, d.sessions);
  if (!fresh.length && (S.plan || !d.plan)) return "";
  return `<div class="card lift-offer">
    <p><strong>Bring over your Liftlog history?</strong></p>
    <p class="muted small">This browser has Liftlog data from the website: ${plural(fresh.length, "session")}${d.plan && !S.plan ? " and your plan" : ""}. Liftlog itself stays as it is.</p>
    <div class="foot-actions tight">
      <button type="button" class="btn" data-act="lift-liftlog">Bring it over</button>
      <button type="button" class="btn ghost" data-act="lift-liftlog-no">Not now</button>
    </div>
  </div>`;
}

// Adds sessions genki does not have yet; takes the plan, unit and rotation only
// when genki has no plan of its own. Returns a message.
async function importLiftlog(d) {
  const fresh = L.newSessions(S.sessions, d.sessions);
  if (fresh.length) await db.putMany("workouts", fresh);
  const tookPlan = !S.plan && d.plan;
  if (tookPlan) {
    await db.setMeta(META.plan, d.plan);
    await db.setMeta(META.next, d.next);
    await db.setMeta(META.unit, d.unit);
    if (d.form) await db.setMeta(META.form, { ...DEFAULT_FORM, ...d.form });
  }
  await db.setMeta(META.liftlog, new Date().toISOString());
  return `Brought over ${plural(fresh.length, "session")}${tookPlan ? " and your plan" : ""}.`;
}

// ---------- Train ----------

function viewTrain() {
  if (!S.plan) return `<div class="card empty"><p><strong>No plan yet.</strong></p><p class="muted small">Pick a goal and how many days a week; the split, exercises, sets and rest times follow.</p><button type="button" class="btn" data-act="lift-sub" data-val="plan">Build a plan</button></div>`;
  const saved = lastSaved ? savedCard(lastSaved) : "";
  if (!S.draft) {
    return saved + `<h3>Start a session</h3>
      <p class="hint">Next in your rotation is marked. Pick any day if you are switching things around.</p>
      <ul class="entries">${S.plan.schedule.map((d, i) => `<li><button type="button" class="entry${i === S.next ? " lift-next" : ""}" data-act="lift-start" data-day="${i}">
        <span class="entry-name"><strong>${esc(d.name)}</strong><span class="hint">${plural(d.slots.length, "exercise")} · about ${Math.round(L.estMinutes(d))} min</span></span>
        ${i === S.next ? `<span class="lift-pill">Next up</span>` : `<span class="muted small">Start</span>`}
      </button></li>`).join("")}</ul>`;
  }
  const d = S.draft;
  if (!d) return; // already finished (double tap)
  const done = d.entries.reduce((a, e) => a + e.sets.filter((x) => x.done).length, 0);
  const total = d.entries.reduce((a, e) => a + e.sets.length, 0);
  return `<div class="card lift-head">
      <div class="sum-row"><strong class="lift-day">${esc(d.day)}</strong><span class="hint">Started ${esc(new Date(d.started).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" }))} · ${done}/${total} sets</span></div>
      <div class="bar" aria-hidden="true"><span style="width:${total ? (done / total) * 100 : 0}%"></span></div>
    </div>
    ${d.entries.map(entryCard).join("")}
    <div class="lift-actions">
      <button type="button" class="btn" data-act="lift-finish">Finish and save</button>
      <button type="button" class="btn ghost" data-act="lift-discard">Discard</button>
    </div>`;
}

function entryCard(e, ei) {
  const ex = L.BY_ID[e.exId] || { name: e.exId, p: "", inc: 0 };
  const slot = e.slot;
  const h = L.history(S.sessions, e.exId);
  const last = h[h.length - 1];
  const sug = L.suggest(e.exId, slot, S.sessions);
  const alts = ex.p ? L.candidates(ex.p, S.plan.equip) : [];
  return `<div class="card lift-ex" data-entry="${ei}">
    <div class="lift-ex-head">
      <div><strong class="lift-ex-name">${esc(ex.name)}</strong><span class="hint">${esc(slot.sets)} × ${esc(slot.lo)}–${esc(slot.hi)} reps · ${esc(slot.rir)} in reserve · rest ${dur(slot.rest)}</span></div>
      ${alts.length > 1 ? `<label class="lift-swap"><span class="visually-hidden">Swap exercise</span><select data-swap="${ei}">${alts.map((a) => `<option value="${a.id}" ${a.id === e.exId ? "selected" : ""}>${esc(a.name)}</option>`).join("")}</select></label>` : ""}
    </div>
    <div class="lift-tip">
      ${last ? `<span><strong>Last (${esc(date(last.date))}):</strong> ${last.sets.map((x) => `${ex.inc || x.w ? fmtW(x.w, ex) + "×" : ""}${esc(x.reps)}`).join(", ")}</span>` : ""}
      <span><strong>Try:</strong> ${sug.w != null && ex.inc ? `${fmtW(sug.w, ex)} ${u()} × ${esc(sug.reps)}` : `${esc(sug.reps)} reps`}. ${esc(sug.why)}</span>
    </div>
    <div class="lift-sets">
      <div class="lift-set head" aria-hidden="true"><span>Set</span><span>${ex.inc ? u() : `+${u()}`}</span><span>Reps</span><span>RIR</span><span></span></div>
      ${e.sets.map((x, si) => `<div class="lift-set${x.done ? " done" : ""}" data-set="${si}">
        <span class="n">${si + 1}</span>
        <input inputmode="decimal" aria-label="Set ${si + 1} weight (${u()})" data-f="w" value="${esc(x.w)}" placeholder="${sug.w != null ? fmtW(sug.w, ex) : "0"}">
        <input inputmode="numeric" aria-label="Set ${si + 1} reps" data-f="reps" value="${esc(x.reps)}" placeholder="${esc(sug.reps)}">
        <input inputmode="numeric" aria-label="Set ${si + 1} reps in reserve" data-f="rir" value="${esc(x.rir)}" placeholder="${slot.rir}">
        <button type="button" class="lift-check" data-act="lift-done" aria-label="Set ${si + 1} done" aria-pressed="${!!x.done}"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg></button>
      </div>`).join("")}
    </div>
    <div class="lift-row">
      <button type="button" class="link-btn" data-act="lift-add-set">+ Add set</button>
      ${e.sets.length > 1 ? `<button type="button" class="link-btn muted" data-act="lift-remove-set">Remove last set</button>` : ""}
    </div>
  </div>`;
}

function savedCard({ session, prs }) {
  return `<div class="card lift-saved">
    <p><strong>Saved.</strong> ${esc(session.day)}, ${esc(date(session.date))}.</p>
    <div class="lift-kpis">
      <div><b>${session.sets.length}</b><span>sets</span></div>
      <div><b>${fmtBig(L.sessionVolume(session))}</b><span>${u()} moved</span></div>
      <div><b>${session.minutes}</b><span>minutes</span></div>
      <div><b>${prs.length}</b><span>new PR${prs.length === 1 ? "" : "s"}</span></div>
    </div>
    ${prs.length ? `<ul class="lift-list">${prs.map((p) => `<li><strong>${esc(exName(p.exId))}</strong>: estimated 1RM ${fmtW(p.prev)} → <strong class="good-text">${fmtW(p.best)} ${u()}</strong></li>`).join("")}</ul>` : ""}
    <button type="button" class="link-btn" data-act="lift-sub" data-val="progress">See your progress</button>
  </div>`;
}

// ---------- Progress ----------

function viewProgress() {
  const ss = S.sessions;
  if (!ss.length) return `<div class="card empty"><p><strong>Nothing to chart yet.</strong></p><p class="muted small">Finish a session and your records, strength trend and weekly volume show up here.</p></div>`;
  const now = Date.now();
  const in28 = ss.filter((s) => now - new Date(s.date) < 28 * DAY);
  const vol = (from, to) => ss.filter((s) => { const t = new Date(s.date).getTime(); return t >= from && t < to; }).reduce((a, s) => a + L.sessionVolume(s), 0);
  const thisW = vol(now - 7 * DAY, now + 1), lastW = vol(now - 14 * DAY, now - 7 * DAY);
  const delta = lastW ? Math.round(((thisW - lastW) / lastW) * 100) : null;
  const prs = L.records(ss);
  const pr28 = prs.filter((p) => now - new Date(p.date) < 28 * DAY);
  const exIds = [...new Set(ss.flatMap((s) => s.sets.map((x) => x.exId)))]
    .filter((id) => L.BY_ID[id] && L.BY_ID[id].inc)
    .sort((a, b) => (L.BY_ID[b].c - L.BY_ID[a].c) || (L.history(ss, b).length - L.history(ss, a).length));
  const focus = exIds.includes(S.focus) ? S.focus : exIds[0];
  return `
    <div class="card lift-kpis">
      <div><b>${in28.length}</b><span>sessions, last 28 days</span></div>
      <div><b>${(in28.length / 4).toFixed(1)}</b><span>a week${S.plan ? ` (plan: ${esc(S.plan.days)})` : ""}</span></div>
      <div><b>${fmtBig(thisW)}</b><span>${u()} moved, last 7 days${delta != null ? ` <em class="${delta >= 0 ? "good-text" : "warn-text"}">${delta >= 0 ? "▲" : "▼"} ${Math.abs(delta)}%</em>` : ""}</span></div>
      <div><b>${pr28.length}</b><span>PRs, last 28 days</span></div>
    </div>

    <h3>Strength trend</h3>
    <div class="card">
      <p class="hint lift-note">Best estimated one-rep max per session, with a straight-line trend.</p>
      ${exIds.length ? `<label class="field"><span>Exercise</span><select data-focus>${exIds.map((id) => `<option value="${id}" ${id === focus ? "selected" : ""}>${esc(exName(id))}</option>`).join("")}</select></label>${trendChart(focus)}` : `<p class="muted small">Log a weighted exercise to see a trend.</p>`}
    </div>

    <h3>Recent PRs</h3>
    <div class="card">
      ${prs.length ? `<ul class="lift-list">${prs.slice(0, 8).map((p) => `<li><span class="hint">${esc(date(p.date))}</span> <strong>${esc(exName(p.exId))}</strong>: ${fmtW(p.prev)} → <strong>${fmtW(p.best)} ${u()}</strong> <span class="hint">(+${(((p.best - p.prev) / p.prev) * 100).toFixed(1)}%)</span></li>`).join("")}</ul>` : `<p class="muted small">PRs show up from your second session of an exercise.</p>`}
    </div>

    <h3>Sets per muscle, last 7 days</h3>
    <div class="card">
      <p class="hint lift-note">A set counts 1 for each muscle it mainly trains and ½ for each that assists.</p>
      ${muscleChart(L.loggedSets(ss, now - 7 * DAY, now + 1), S.plan ? L.plannedSets(S.plan) : null)}
    </div>

    <h3>Weekly volume</h3>
    <div class="card">
      <p class="hint lift-note">Load moved (weight × reps) per week, last 12 weeks.</p>
      ${tonnageChart(L.weeklyTonnage(ss, 12, now))}
    </div>

    <h3>Consistency</h3>
    <div class="card">
      <p class="hint lift-note">Each square is a day over the last 16 weeks. Darker means more sets.</p>
      ${heatmap(ss, now)}
    </div>

    <h3>History</h3>
    <ul class="entries">${[...ss].sort((a, b) => new Date(b.date) - new Date(a.date)).slice(0, 20).map((s) => `<li class="lift-hist">
      <span class="entry-name"><strong>${esc(s.day)}</strong><span class="hint">${esc(date(s.date))} · ${s.sets.length} sets · ${fmtBig(L.sessionVolume(s))} ${u()}</span></span>
      <button type="button" class="link-btn muted" data-act="lift-delete" data-id="${esc(s.id)}" aria-label="Delete ${esc(s.day)} on ${esc(date(s.date))}">Delete</button></li>`).join("")}</ul>

    <details class="card lift-method">
      <summary><strong>How the numbers work</strong></summary>
      <ul>
        <li><strong>Progression</strong> is double progression: stay at a weight until every set reaches the top of the rep range, then add the smallest jump. If most sets miss the bottom of the range, drop about 10%.</li>
        <li><strong>Estimated 1RM</strong> uses the Epley formula, weight × (1 + reps ÷ 30), counting reps in reserve as reps you could have done, capped at 15.</li>
        <li><strong>Trend</strong> is a least-squares line through the estimated 1RMs; R² says how steady the progress is.</li>
        <li><strong>Volume</strong>: research suggests muscle growth rises with weekly sets, with about 10-20 hard sets per muscle doing well (shaded). It is a guide, not a rule.</li>
      </ul>
    </details>`;
}

// ---------- charts (inline SVG, 340 wide like the weight chart) ----------
const CW = 340;

function muscleChart(vals, ticks) {
  const rowH = 22, L0 = 76, R = 30, max = Math.max(24, ...Object.values(vals), ...(ticks ? Object.values(ticks) : [0]));
  const H = L.MUSCLES.length * rowH + 20;
  const x = (v) => L0 + (v / max) * (CW - L0 - R);
  const f = (n) => n.toFixed(1);
  const rows = L.MUSCLES.map((m, i) => {
    const y = 4 + i * rowH, v = vals[m] || 0, t = ticks ? ticks[m] : null;
    return `<text class="tick lift-label" x="${L0 - 8}" y="${y + 13}" text-anchor="end">${m}</text>
      <rect class="${v >= 10 && v <= 20 ? "lift-in" : "lift-out"}" x="${L0}" y="${y + 3}" width="${f(Math.max(0, x(v) - L0))}" height="12" rx="3"/>
      ${t ? `<line class="lift-target" x1="${f(x(t))}" x2="${f(x(t))}" y1="${y}" y2="${y + 18}"/>` : ""}
      <text class="tick" x="${f(x(v) + 5)}" y="${y + 13}">${+v.toFixed(1)}</text>`;
  }).join("");
  const axis = [0, 5, 10, 15, 20].filter((v) => v <= max).map((v) => `<text class="tick" x="${f(x(v))}" y="${H - 3}" text-anchor="middle">${v}</text>`).join("");
  const label = `Sets per muscle: ${L.MUSCLES.map((m) => `${m} ${+(vals[m] || 0).toFixed(1)}`).join(", ")}.`;
  return `<figure class="chart"><svg viewBox="0 0 ${CW} ${H}" role="img" aria-label="${esc(label)}">
      <rect class="lift-band" x="${f(x(10))}" y="2" width="${f(x(20) - x(10))}" height="${H - 20}"/>
      ${rows}${axis}</svg>
    <figcaption class="legend"><span class="key lift-k-in">In the 10–20 range</span><span class="key lift-k-out">Outside it</span>${ticks ? `<span class="key lift-k-target">Plan target</span>` : ""}</figcaption></figure>`;
}

function trendChart(id) {
  const pts = L.history(S.sessions, id);
  const ex = L.BY_ID[id];
  if (pts.length < 2) return `<p class="muted small">Two sessions of ${esc(ex.name)} are needed for a trend.</p>`;
  const H = 170, Lm = 34, R = 10, T = 10, B = 22;
  const t0 = new Date(pts[0].date).getTime(), t1 = new Date(pts[pts.length - 1].date).getTime();
  const vals = pts.map((p) => disp(p.best));
  const lo = Math.min(...vals) * 0.95, hi = Math.max(...vals) * 1.04;
  const x = (t) => Lm + ((t - t0) / Math.max(1, t1 - t0)) * (CW - Lm - R);
  const y = (v) => T + (1 - (v - lo) / (hi - lo || 1)) * (H - T - B);
  const f = (n) => n.toFixed(1);
  const fit = L.slopePerWeek(pts);
  const line = pts.map((p) => `${f(x(new Date(p.date).getTime()))},${f(y(disp(p.best)))}`).join(" ");
  const at = (t) => disp(fit.intercept + fit.slope * (t / (7 * DAY)));
  const fitLine = fit ? `<line class="goal-line" x1="${f(x(t0))}" y1="${f(y(at(t0)))}" x2="${f(x(t1))}" y2="${f(y(at(t1)))}"/>` : "";
  const ticks = [0, 0.5, 1].map((k) => lo + k * (hi - lo));
  const best = pts.reduce((a, p) => (p.best > a.best ? p : a), pts[0]);
  const latest = pts[pts.length - 1];
  return `<figure class="chart"><svg viewBox="0 0 ${CW} ${H}" role="img" aria-label="${esc(`Estimated one-rep max for ${ex.name}: ${pts.length} sessions from ${date(t0)} to ${date(t1)}, latest ${fmtW(latest.best)} ${u()}, best ${fmtW(best.best)} ${u()}.`)}">
      ${ticks.map((v) => `<line class="grid" x1="${Lm}" x2="${CW - R}" y1="${f(y(v))}" y2="${f(y(v))}"/><text class="tick" x="${Lm - 6}" y="${f(y(v) + 4)}" text-anchor="end">${Math.round(v)}</text>`).join("")}
      <text class="tick" x="${Lm}" y="${H - 6}">${esc(date(t0))}</text>
      <text class="tick" x="${CW - R}" y="${H - 6}" text-anchor="end">${esc(date(t1))}</text>
      ${fitLine}
      <polyline class="avg-line" points="${line}"/>
      ${pts.map((p) => `<circle class="lift-pt" cx="${f(x(new Date(p.date).getTime()))}" cy="${f(y(disp(p.best)))}" r="3"/>`).join("")}
    </svg>
    <figcaption class="legend"><span class="key avg">Estimated 1RM</span>${fit ? `<span class="key lift-k-fit">Trend</span>` : ""}</figcaption></figure>
    <div class="lift-kpis small">
      <div><b>${fmtW(latest.best)} ${u()}</b><span>latest</span></div>
      <div><b>${fmtW(best.best)} ${u()}</b><span>best, ${esc(date(best.date))}</span></div>
      <div><b>${fit ? `${fit.slope >= 0 ? "+" : "−"}${Math.abs(disp(fit.slope)).toFixed(2)}` : "–"}</b><span>${fit ? `${u()} a week, R² ${fit.r2.toFixed(2)}` : "trend needs 3 sessions"}</span></div>
    </div>`;
}

function tonnageChart(weeks) {
  const H = 160, Lm = 34, R = 6, T = 8, B = 20;
  const top = Math.max(1, ...weeks.map((w) => disp(w.kg)));
  const max = top * 1.1;
  const bw = (CW - Lm - R) / weeks.length;
  const y = (v) => T + (1 - v / max) * (H - T - B);
  const f = (n) => n.toFixed(1);
  const short = (v) => (v >= 1e4 ? Math.round(v / 1e3) + "k" : int(v));
  const label = `Weekly volume, last ${weeks.length} weeks: ${weeks.map((w) => `${date(w.from)} ${int(disp(w.kg))} ${u()}`).join(", ")}.`;
  return `<figure class="chart"><svg viewBox="0 0 ${CW} ${H}" role="img" aria-label="${esc(label)}">
      ${[0, 0.5, 1].map((k) => `<line class="grid" x1="${Lm}" x2="${CW - R}" y1="${f(y(k * top))}" y2="${f(y(k * top))}"/><text class="tick" x="${Lm - 6}" y="${f(y(k * top) + 4)}" text-anchor="end">${short(k * top)}</text>`).join("")}
      ${weeks.map((w, i) => { const v = disp(w.kg); return `<rect class="${i === weeks.length - 1 ? "lift-in" : "lift-out"}" x="${f(Lm + i * bw + 2)}" y="${f(y(v))}" width="${f(bw - 4)}" height="${f(Math.max(0, H - B - y(v)))}" rx="3"/>${i % 3 === 2 || i === weeks.length - 1 ? `<text class="tick" x="${f(Lm + i * bw + bw / 2)}" y="${H - 5}" text-anchor="middle">${esc(date(w.from))}</text>` : ""}`; }).join("")}
    </svg></figure>`;
}

function heatmap(ss, now) {
  const byDay = {};
  for (const s of ss) { const d = new Date(s.date); d.setHours(0, 0, 0, 0); byDay[d.getTime()] = (byDay[d.getTime()] || 0) + s.sets.length; }
  const max = Math.max(1, ...Object.values(byDay));
  const start = L.weekStart(now) - 15 * 7 * DAY;
  const c = 16, g = 3;
  let cells = "", days = 0;
  for (let w = 0; w < 16; w++) for (let d = 0; d < 7; d++) {
    const day = new Date(start); day.setDate(day.getDate() + w * 7 + d); day.setHours(0, 0, 0, 0);
    const t = day.getTime();
    if (t > now) continue;
    const v = byDay[t] || 0;
    if (v) days++;
    cells += `<rect class="${v ? "lift-in" : "lift-rest"}" x="${16 + w * (c + g)}" y="${d * (c + g)}" width="${c}" height="${c}" rx="3"${v ? ` opacity="${(0.35 + 0.65 * (v / max)).toFixed(2)}"` : ""}/>`;
  }
  const labels = ["M", "", "W", "", "F", "", ""].map((l, d) => (l ? `<text class="tick" x="0" y="${d * (c + g) + 12}">${l}</text>` : "")).join("");
  return `<figure class="chart"><svg viewBox="0 0 ${16 + 16 * (c + g)} ${7 * (c + g)}" role="img" aria-label="Training days over the last 16 weeks: ${days} days with sets.">${labels}${cells}</svg></figure>`;
}

// ---------- Plan ----------

function viewPlan() {
  const f = S.form;
  const same = S.plan && ["goal", "days", "equip", "level"].every((k) => String(S.plan[k]) === String(f[k]));
  const shown = same ? S.plan : L.generatePlan(f);
  const planned = L.plannedSets(shown);
  const under = L.MUSCLES.filter((m) => planned[m] < 10 && m !== "core");
  const over = L.MUSCLES.filter((m) => planned[m] > 20);
  const n = S.sessions.length;
  return `
    <div class="card form lift-form">
      <p class="muted small">Pick your goal and schedule. The split, exercises, sets, rep ranges and rest times follow from it.</p>
      <div class="field"><span>Goal</span>${toggles("lift-form", f.goal, [["strength", "Strength"], ["hypertrophy", "Muscle"], ["general", "General"]], "Goal", 'data-k="goal"')}</div>
      <div class="field"><span>Days a week</span>${toggles("lift-form", f.days, [[2, "2"], [3, "3"], [4, "4"], [5, "5"], [6, "6"]], "Days a week", 'data-k="days"')}</div>
      <div class="field"><span>Equipment</span>${toggles("lift-form", f.equip, [["gym", "Full gym"], ["db", "Dumbbells"], ["bw", "Bodyweight"]], "Equipment", 'data-k="equip"')}</div>
      <div class="field"><span>Experience</span>${toggles("lift-form", f.level, [["beginner", "Beginner"], ["intermediate", "Intermediate"], ["advanced", "Advanced"]], "Experience", 'data-k="level"')}</div>
      ${same ? `<p class="good-text lift-current"><strong>This is your current plan.</strong></p>` : `<button type="button" class="btn" data-act="lift-use-plan">${S.plan ? "Switch to this plan" : "Use this plan"}</button>${S.plan ? `<p class="hint">Your logged sessions are kept.</p>` : ""}`}
    </div>

    <h3>${esc(shown.split)}</h3>
    ${shown.schedule.map((d, i) => `<div class="card lift-plan-day">
      <strong>${i + 1}. ${esc(d.name)}</strong>
      <ol>${d.slots.map((s) => `<li><span>${esc(exName(s.exId))}${s.main ? ` <span class="lift-pill">main</span>` : ""}</span><span class="hint">${esc(s.sets)} × ${esc(s.lo)}–${esc(s.hi)} · ${esc(s.rir)} in reserve · rest ${dur(s.rest)}</span></li>`).join("")}</ol>
    </div>`).join("")}

    <h3>Volume check</h3>
    <div class="card">
      <p class="hint lift-note">Planned hard sets per muscle a week. Roughly 10-20 a week (shaded) suits growth.</p>
      ${muscleChart(planned, null)}
      <p class="small lift-note">${!under.length && !over.length ? "Every muscle lands in the 10-20 range." : `${under.length ? `Under 10 sets: <strong>${under.join(", ")}</strong>. Fine for maintenance; add a set or two where you want growth. ` : ""}${over.length ? `Over 20 sets: <strong>${over.join(", ")}</strong>. Watch recovery.` : ""}`}</p>
    </div>

    <h3>Settings and data</h3>
    <div class="card form">
      <div class="field"><span>Weight unit</span>${toggles("lift-unit", S.unit, [["kg", "Kilograms"], ["lb", "Pounds"]], "Weight unit")}</div>
      <p class="hint">Stored in kg, shown in your unit. Switching never changes your data.</p>
      <div class="foot-actions tight">
        <button type="button" class="btn ghost" data-act="lift-csv" ${n ? "" : "disabled"}>Export CSV</button>
        <button type="button" class="btn ghost" data-act="lift-liftlog-file">Import Liftlog file</button>
      </div>
      <p class="hint">${plural(n, "session")} logged. The CSV has one row per set; workouts are also in the full backup (top right). A Liftlog backup file adds the sessions genki does not have yet.</p>
      <p class="msg ${note ? note.tone : ""}" id="lift-msg" role="status">${note ? esc(note.text) : ""}</p>
      <input type="file" id="lift-file" accept="application/json,.json" hidden>
    </div>`;
}

// ---------- Today card ----------

export async function nextWorkoutCard() {
  await load();
  if (!S.plan) return `<h3>Next workout</h3><div class="card empty"><p>No plan picked yet.</p><a class="btn ghost" href="#workouts">Go to Workouts</a></div>`;
  if (S.draft) {
    const d = S.draft;
    const done = d.entries.reduce((a, e) => a + e.sets.filter((x) => x.done).length, 0);
    const total = d.entries.reduce((a, e) => a + e.sets.length, 0);
    return `<h3>Workout in progress</h3><div class="card lift-today">
      <div class="sum-row"><strong class="lift-day">${esc(d.day)}</strong><span class="hint">${done}/${total} sets</span></div>
      <a class="btn" href="#workouts" data-act="lift-goto-train">Continue</a></div>`;
  }
  const i = S.next < S.plan.schedule.length ? S.next : 0;
  const day = S.plan.schedule[i];
  const last = [...S.sessions].sort((a, b) => new Date(b.date) - new Date(a.date))[0];
  return `<h3>Next workout</h3><div class="card lift-today">
    <div class="sum-row"><strong class="lift-day">${esc(day.name)}</strong><span class="hint">${plural(day.slots.length, "exercise")} · about ${Math.round(L.estMinutes(day))} min</span></div>
    <p class="hint">${day.slots.slice(0, 4).map((s) => esc(exName(s.exId))).join(", ")}${day.slots.length > 4 ? "…" : ""}${last ? `<br>Last session: ${esc(last.day)}, ${esc(date(last.date))}` : ""}</p>
    <button type="button" class="btn" data-act="lift-start" data-day="${i}">Start ${esc(day.name)}</button></div>`;
}

// ---------- rest timer (fixed bar above the tabs, outside the view) ----------
let timer = null;
const tEl = () => document.getElementById("rest-timer");
function startTimer(sec) {
  stopTimer();
  timer = { end: Date.now() + sec * 1000, total: sec, id: setInterval(tick, 250) };
  tEl().hidden = false;
  tick();
}
function tick() {
  if (!timer) return;
  const left = Math.max(0, (timer.end - Date.now()) / 1000);
  document.getElementById("rest-left").textContent = dur(Math.ceil(left));
  document.getElementById("rest-fill").style.width = `${(100 * left) / timer.total}%`;
  if (left <= 0) { navigator.vibrate?.([200, 100, 200]); stopTimer(); }
}
function stopTimer() { if (timer) clearInterval(timer.id); timer = null; if (tEl()) tEl().hidden = true; }
export function initRestTimer() {
  tEl().addEventListener("click", (e) => {
    const act = e.target.closest("[data-act]")?.dataset.act;
    if (act === "rest-add" && timer) { timer.end += 30_000; timer.total += 30; tick(); }
    if (act === "rest-skip") stopTimer();
  });
}

// ---------- events ----------

const saveDraft = () => db.setMeta(META.draft, S.draft);
const toTop = () => window.scrollTo(0, 0);

async function start(i) {
  if (!S) await load();
  if (S.draft && !confirm(`Drop the ${S.draft.day} session in progress and start a new one?`)) return;
  S.draft = L.newDraft(S.plan, i, S.sessions, S.unit);
  await saveDraft();
  lastSaved = null;
  sub = "train";
  if (location.hash !== "#workouts") location.hash = "workouts"; else rerender();
  toTop();
}

async function finish() {
  const d = S.draft;
  if (!d) return; // already finished (double tap)
  const sets = L.collectSets(d, S.unit);
  if (!sets.length) { alert("No sets with reps yet. Log at least one set, or discard the session."); return; }
  const session = { id: `w-${Date.now().toString(36)}`, date: new Date().toISOString(), day: d.day, sets, minutes: Math.round((Date.now() - d.started) / 60000) };
  const prs = L.newRecords(S.sessions, session);
  S.draft = null; // before any await: a second tap or a late keystroke must not save or resurrect this session
  await db.put("workouts", session);
  await db.setMeta(META.next, (d.dayIdx + 1) % S.plan.schedule.length);
  await db.setMeta(META.draft, null);
  lastSaved = { session, prs };
  stopTimer();
  rerender();
  announce(L.sessionSavedMessage(session, prs));
  toTop();
}

function download(name, text, type) {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const a = Object.assign(document.createElement("a"), { href: url, download: name });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

function msg(text, tone = "") {
  const m = document.getElementById("lift-msg");
  if (m) { m.textContent = text; m.className = `msg ${tone}`; }
}

export async function handleLiftClick(act, el) {
  if (!S) await load();
  const entryEl = el.closest("[data-entry]");
  const e = entryEl && S.draft ? S.draft.entries[+entryEl.dataset.entry] : null;
  switch (act) {
    case "lift-sub": sub = el.dataset.val; rerender(); toTop(); break;
    case "lift-goto-train": sub = "train"; break; // the link changes the hash, which renders
    case "lift-form": {
      const k = el.dataset.k, v = el.dataset.val;
      await db.setMeta(META.form, { ...S.form, [k]: k === "days" ? +v : v });
      rerender(); break;
    }
    case "lift-use-plan":
      if (S.draft && !confirm(`Switching plans drops the ${S.draft.day} session in progress. Switch?`)) break;
      await db.setMeta(META.plan, L.generatePlan(S.form));
      await db.setMeta(META.next, 0);
      await db.setMeta(META.draft, null);
      sub = "train"; rerender(); toTop(); break;
    case "lift-unit": {
      const to = el.dataset.val;
      if (!L.UNITS.includes(to)) break;
      if (S.draft && to !== S.unit) {
        // Weights in the session in progress are typed text: re-express them in the new unit.
        for (const e of S.draft.entries) for (const x of e.sets) {
          const v = parseFloat(x.w);
          if (Number.isFinite(v) && v > 0) x.w = String(+(L.toKg(v, S.unit) * (to === "lb" ? L.LB_PER_KG : 1)).toFixed(1)); // 0.1 steps: a kg/lb toggle never drifts
        }
        await saveDraft();
      }
      await db.setMeta(META.unit, to); rerender(); break;
    }
    case "lift-start": await start(+el.dataset.day); break;
    case "lift-done": {
      const si = +el.closest("[data-set]").dataset.set, x = e.sets[si];
      if (!x.done && !(parseInt(x.reps, 10) > 0)) {
        // Tapping done on an empty row logs the suggested numbers shown as placeholders.
        // A weighted exercise with no suggestion yet (first time) needs a typed weight.
        const row = el.closest("[data-set]");
        const ex = L.BY_ID[e.exId];
        if (x.w === "" && ex?.inc && !(parseFloat(row.querySelector('[data-f="w"]').placeholder) > 0)) { row.querySelector('[data-f="w"]').focus(); break; }
        x.reps = row.querySelector('[data-f="reps"]').placeholder;
        if (x.w === "") x.w = row.querySelector('[data-f="w"]').placeholder;
      }
      x.done = !x.done;
      await saveDraft();
      rerender();
      if (x.done) startTimer(e.slot.rest);
      announce(L.setMessage({ name: exName(e.exId), n: si + 1, of: e.sets.length, done: x.done, w: x.w, reps: x.reps, unit: S.unit, rest: x.done ? e.slot.rest : 0 }));
      break;
    }
    case "lift-add-set": { const prev = e.sets[e.sets.length - 1]; e.sets.push({ w: prev ? prev.w : "", reps: "", rir: "", done: false }); await saveDraft(); rerender(); break; }
    case "lift-remove-set": e.sets.pop(); await saveDraft(); rerender(); break;
    case "lift-finish": await finish(); break;
    case "lift-discard":
      if (confirm("Discard this session? Nothing from it is saved.")) { S.draft = null; await db.setMeta(META.draft, null); stopTimer(); rerender(); }
      break;
    case "lift-delete": {
      const s = S.sessions.find((x) => x.id === el.dataset.id);
      if (s && confirm(`Delete ${s.day} on ${date(s.date)}? This cannot be undone.`)) { await db.del("workouts", s.id); rerender(); }
      break;
    }
    case "lift-csv": download(`genki-workouts-${new Date().toISOString().slice(0, 10)}.csv`, L.toCSV(S.sessions, S.unit), "text/csv"); break;
    case "lift-liftlog": { const d = liftlogData(); if (d) { await importLiftlog(d); sub = S.plan ? sub : "train"; rerender(); } break; }
    case "lift-liftlog-no": await db.setMeta(META.liftlog, "dismissed"); rerender(); break;
    case "lift-liftlog-file": document.getElementById("lift-file")?.click(); break;
  }
}

// Typing in a set row saves the draft without re-rendering (focus stays put).
export async function handleLiftInput(ev) {
  const t = ev.target;
  if (!S) return;
  if (t.dataset.f && S.draft && ev.type === "input") {
    const e = S.draft.entries[+t.closest("[data-entry]").dataset.entry];
    // A comma-decimal keyboard types "72,5": read the comma as the decimal point, keep the first one only.
    const clean = t.dataset.f === "w"
      ? t.value.replace(/,/g, ".").replace(/[^0-9.]/g, "").replace(/^([^.]*\.)(.*)$/, (_, a, b) => a + b.replace(/\./g, ""))
      : t.value.replace(/[^0-9]/g, "");
    if (clean !== t.value) t.value = clean;
    e.sets[+t.closest("[data-set]").dataset.set][t.dataset.f] = clean;
    await saveDraft();
    return;
  }
  if (ev.type !== "change") return;
  if (t.dataset.swap != null && S.draft) {
    const e = S.draft.entries[+t.dataset.swap];
    e.exId = t.value;
    const w = L.prefill(e.exId, e.slot, S.sessions, S.unit);
    for (const x of e.sets) if (!x.done) x.w = w;
    await saveDraft();
    rerender();
  } else if (t.hasAttribute("data-focus")) {
    await db.setMeta(META.focus, t.value);
    rerender();
  } else if (t.id === "lift-file" && t.files[0]) {
    const file = t.files[0];
    t.value = "";
    const d = L.fromLiftlog(await file.text());
    if (!d) { msg("That file is not a Liftlog backup.", "bad"); return; }
    note = { text: await importLiftlog(d), tone: "good" };
    rerender();
  }
}
