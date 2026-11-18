// Day trackers on the Today tab: the fasting card (plan, Start/End with a live
// timer, history and streak) and the water and exercise cards, plus their
// sheets and the exercise / net calories line on the Nutrition tab. The maths
// lives in trackers.js. A web app cannot set phone reminders, so the planned
// start shows inside the card instead.
import * as db from "./db.js";
import { dayKey, shiftDay, sumEntries } from "./nutrition.js";
import {
  PROTOCOLS, FAST_HOURS, WATER_MAX, EXERCISE_MAX, protocolLabel, normalPlan, validTime, plannedWindow, nextWindow, runningFast, fastStatus,
  fmtDuration, fmtClock, fastHistory, fastStreak, fastTimesProblem, dayRecord, waterGoalOf, addWater, exerciseProblem,
  netCalories, waterMessage, fastMessage, exerciseMessage,
} from "./trackers.js";
import { esc, int, newId, announce, openPanel, swapPanel, closePanel, panelEl, closeBtn, backBtn } from "./ui.js";

let rerender = () => {};
export function setTrackerRerender(fn) { rerender = fn; }

const time = (d) => d.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
function when(d, now = new Date()) {
  const k = dayKey(d), today = dayKey(now);
  if (k === today) return time(d);
  if (k === shiftDay(today, -1)) return `yesterday ${time(d)}`;
  if (k === shiftDay(today, 1)) return `tomorrow ${time(d)}`;
  return `${d.toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" })} ${time(d)}`;
}
function fmtDay(key, opts = { weekday: "short", month: "short", day: "numeric" }) {
  const [y, m, d] = key.split("-").map(Number);
  return new Date(y, m - 1, d).toLocaleDateString(undefined, opts);
}
const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
// "YYYY-MM-DDTHH:MM" in local time, for datetime-local inputs.
function localInput(d) {
  const pad = (n) => String(n).padStart(2, "0");
  return `${dayKey(d)}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
const fromInput = (s) => (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(s) ? new Date(s) : null);

const loadPlan = async () => normalPlan(await db.getMeta("fastPlan", null));
const loadDay = async (date) => dayRecord(date, await db.get("days", date));

function bar(pct, reached) {
  return `<div class="bar${reached ? " goal" : ""}" aria-hidden="true"><span data-fast-bar style="width:${(Math.min(1, pct) * 100).toFixed(1)}%"></span></div>`;
}

// ---------- fasting card ----------

export async function fastingCard() {
  const [plan, fasts] = await Promise.all([loadPlan(), db.getAll("fasts")]);
  const now = new Date();
  const run = runningFast(fasts);
  const streak = fastStreak(fasts);
  const streakHtml = `<div class="right"><span class="sum-left${streak ? " good-text" : ""}">${streak}</span><span class="hint"> day streak</span></div>`;
  const more = `<div class="foot-actions tight">
      <button type="button" class="btn ghost" data-act="t-fast-plan">Plan</button>
      <button type="button" class="btn ghost" data-act="t-fast-history">History</button>
    </div>`;

  if (run) {
    const s = fastStatus(run, now);
    const note = s.reached
      ? `<strong class="good-text">Goal reached</strong> at ${esc(when(s.goalAt))}. End the fast when you eat.`
      : `Started ${esc(when(new Date(run.start)))}. Goal at ${esc(when(s.goalAt))}, <span data-fast-left>${esc(fmtDuration(s.left))}</span> to go.`;
    return `<h3>Fasting</h3>
    <div class="card fast" data-fast-start="${esc(run.start)}" data-fast-goal="${s.goal}" data-fast-reached="${s.reached}">
      <div class="sum-row">
        <div><span class="stat-label">Fasting · ${esc(protocolLabel(run.goalHours))}</span><span class="sum-big fast-clock" role="timer" aria-label="Time fasted" data-fast-clock>${fmtClock(s.elapsed)}</span></div>
        ${streakHtml}
      </div>
      ${bar(s.pct, s.reached)}
      <p class="hint">${note}</p>
      <div class="stack">
        <button type="button" class="btn" data-act="t-fast-end">End fast</button>
        <button type="button" class="btn ghost" data-act="t-fast-edit" data-id="${esc(run.id)}">Change start time</button>
      </div>
      ${more}
    </div>`;
  }

  const w = nextWindow(plan, fasts, now);
  const due = w.start <= now;
  const note = due
    ? `<p class="reminder" data-fast-due="${w.end.getTime()}"><strong>Time to start your fast.</strong> It was planned for ${esc(time(w.start))}; start now, or start and then change the start time.</p>`
    : `<p class="hint" data-fast-due="${w.start.getTime()}">Next fast starts ${esc(when(w.start))}, in <span data-fast-in>${esc(fmtDuration(w.start - now))}</span>.</p>`;
  return `<h3>Fasting</h3>
  <div class="card fast">
    <div class="sum-row">
      <div><span class="stat-label">${esc(protocolLabel(plan.hours))} plan</span><span class="sum-big">${esc(time(w.start))}</span><span class="muted"> to ${esc(time(w.end))}${dayKey(w.end) !== dayKey(w.start) ? " next day" : ""}</span></div>
      ${streakHtml}
    </div>
    ${note}
    <button type="button" class="btn" data-act="t-fast-start">Start fast</button>
    ${more}
  </div>`;
}

// The live timer: update the running fast's clock in place every second, and
// re-render when a goal or a planned start passes (no announcements: a timer
// that talks every second would drown everything else out).
let tick = null;
export function initFastClock() {
  if (tick) return;
  tick = setInterval(() => {
    if (document.hidden) return;
    const now = Date.now();
    const card = document.querySelector("[data-fast-start]");
    if (card) {
      const elapsed = Math.max(0, now - new Date(card.dataset.fastStart).getTime());
      const goal = Number(card.dataset.fastGoal);
      const clock = card.querySelector("[data-fast-clock]");
      if (clock) clock.textContent = fmtClock(elapsed);
      const b = card.querySelector("[data-fast-bar]");
      if (b) b.style.width = `${(Math.min(1, elapsed / goal) * 100).toFixed(1)}%`;
      const left = card.querySelector("[data-fast-left]");
      if (left) left.textContent = fmtDuration(Math.max(0, goal - elapsed));
      if (card.dataset.fastReached === "false" && elapsed >= goal) rerender();
    }
    const due = document.querySelector("[data-fast-due]");
    if (due) {
      const t = Number(due.dataset.fastDue);
      const inEl = due.querySelector("[data-fast-in]");
      if (inEl) inEl.textContent = fmtDuration(Math.max(0, t - now));
      if (now >= t) rerender();
    }
  }, 1000);
}

// ---------- water and exercise cards ----------

export async function dayTrackersCard() {
  const today = dayKey();
  const [rec, goalRaw, entries] = await Promise.all([loadDay(today), db.getMeta("waterGoal", null), db.getByIndex("entries", "date", today)]);
  const goal = waterGoalOf(goalRaw);
  const food = sumEntries(entries).kcal;
  const pct = Math.min(1, rec.water / goal);
  const hasEx = rec.exerciseKcal !== null || rec.steps !== null;
  const exHint = [
    rec.exerciseKcal !== null ? "kcal burned" : "",
    rec.steps !== null ? `${int(rec.steps)} steps` : "",
  ].filter(Boolean).map((s) => `<span class="hint">${esc(s)}</span>`).join("");
  return `<h3>Water and exercise</h3>
  <div class="grid2 trackers">
    <div class="card stat tracker">
      <span class="stat-label">Water</span>
      <span class="stat-value">${rec.water}<span class="of"> / ${goal}</span></span>
      <span class="hint">${rec.water >= goal ? `<span class="good-text">Goal reached</span>` : `${goal === 1 ? "glass" : "glasses"} today`}</span>
      <div class="bar${rec.water >= goal ? " goal" : ""}" aria-hidden="true"><span style="width:${(pct * 100).toFixed(1)}%"></span></div>
      <div class="stepper">
        <button type="button" class="icon-btn" data-act="t-water" data-delta="-1" aria-label="Remove a glass of water"${rec.water ? "" : " disabled"}><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 12h12"/></svg></button>
        <button type="button" class="icon-btn primary" data-act="t-water" data-delta="1" aria-label="Add a glass of water"${rec.water >= WATER_MAX ? " disabled" : ""}><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 6v12M6 12h12"/></svg></button>
      </div>
      <button type="button" class="link-btn" data-act="t-water-goal">Goal ${plural(goal, "glass", "glasses")}</button>
    </div>
    <div class="card stat tracker">
      <span class="stat-label">Exercise</span>
      ${hasEx
        ? `<span class="stat-value">${rec.exerciseKcal !== null ? int(rec.exerciseKcal) : "–"}</span>${exHint}
           ${rec.exerciseKcal !== null ? `<span class="hint">Net <strong class="net">${int(netCalories(food, rec.exerciseKcal))}</strong> kcal</span>` : ""}`
        : `<span class="stat-value">0</span><span class="hint">Nothing logged today. Net calories show here.</span>`}
      <button type="button" class="btn ghost small-btn" data-act="t-exercise" data-date="${today}">${hasEx ? "Change" : "Log exercise"}</button>
    </div>
  </div>`;
}

// The Nutrition tab's line under the day summary: exercise and net calories
// for the day shown there ("" when nothing is logged).
export async function exerciseLine(date, foodKcal) {
  const rec = await loadDay(date);
  if (rec.exerciseKcal === null && rec.steps === null) return "";
  const parts = [];
  if (rec.exerciseKcal !== null) parts.push(`Exercise ${int(rec.exerciseKcal)} kcal`, `Net <strong>${int(netCalories(foodKcal, rec.exerciseKcal))}</strong> kcal`);
  if (rec.steps !== null) parts.push(`${int(rec.steps)} steps`);
  return `<p class="macros">${parts.join(" · ")} <button type="button" class="link-btn inline" data-act="t-exercise" data-date="${esc(date)}">Change</button></p>`;
}

// ---------- clicks ----------

export async function handleTrackerClick(act, el) {
  if (act === "t-water") await changeWater(Number(el.dataset.delta));
  else if (act === "t-water-goal") await openWaterGoal();
  else if (act === "t-exercise") await openExercise(el.dataset.date || dayKey());
  else if (act === "t-fast-start") await startFast();
  else if (act === "t-fast-end") await endFast();
  else if (act === "t-fast-plan") await openPlan();
  else if (act === "t-fast-history") await openHistory();
  else if (act === "t-fast-edit") await openFast(el.dataset.id);
}

async function changeWater(delta) {
  const today = dayKey();
  const rec = addWater(await loadDay(today), delta);
  await db.put("days", rec);
  rerender();
  announce(waterMessage(rec.water, waterGoalOf(await db.getMeta("waterGoal", null))));
}

async function startFast() {
  if (runningFast(await db.getAll("fasts"))) { rerender(); return; }
  const plan = await loadPlan();
  const fast = { id: newId(), start: new Date().toISOString(), end: null, goalHours: plan.hours };
  await db.put("fasts", fast);
  rerender();
  announce(`Fast started, goal ${plan.hours} h.`);
}

async function endFast() {
  const run = runningFast(await db.getAll("fasts"));
  if (!run) { rerender(); return; }
  const now = new Date();
  const s = fastStatus(run, now);
  if (!s.reached && !confirm(`End the fast now at ${fmtDuration(s.elapsed)}? The goal is ${run.goalHours} h.`)) return;
  const done = { ...run, end: now.toISOString() };
  await db.put("fasts", done);
  rerender();
  announce(fastMessage("Fast ended:", done, now));
}

const show = (html, handlers) => (document.querySelector("#panel-dialog").open ? swapPanel(html, handlers) : openPanel(html, handlers));

// ---------- fasting plan ----------

async function openPlan() {
  const plan = await loadPlan();
  const custom = !PROTOCOLS.some((p) => p.hours === plan.hours);
  const preview = (hours, startTime) => {
    const p = normalPlan({ hours, startTime });
    const w = plannedWindow(p, new Date(2000, 0, 3, 0, 0)); // any day: only the clock times matter
    const eat = 24 - p.hours;
    return `Fast from ${esc(time(w.start))} to ${esc(time(w.end))}${w.end.getDate() !== w.start.getDate() ? " the next day" : ""}${eat > 0 ? `, then eat for ${eat} h` : ""}.`;
  };
  const html = `
    <div class="sheet-head"><h2 id="panel-title">Fasting plan</h2>${closeBtn}</div>
    <form class="form" id="fast-plan" novalidate>
      <fieldset class="seg"><legend>Fast and eating window (hours)</legend>
        ${PROTOCOLS.map((p) => `<label><input type="radio" name="proto" value="${p.hours}" ${!custom && p.hours === plan.hours ? "checked" : ""}><span>${p.label}</span></label>`).join("")}
        <label><input type="radio" name="proto" value="custom" ${custom ? "checked" : ""}><span>Custom</span></label>
      </fieldset>
      <div class="grid2">
        <label class="field"><span>Custom length (hours)</span><input name="hours" type="number" inputmode="numeric" min="${FAST_HOURS[0]}" max="${FAST_HOURS[1]}" step="1" value="${plan.hours}" ${custom ? "" : "disabled"}></label>
        <label class="field"><span>Planned start</span><input name="startTime" type="time" value="${esc(plan.startTime)}" required></label>
      </div>
      <p class="preview preview-line" id="fast-preview">${preview(plan.hours, plan.startTime)}</p>
      <p class="hint">genki cannot send phone reminders: the Today tab shows when your fast is due. A running fast keeps the length it started with.</p>
      <button class="btn" type="submit">Save plan</button>
      <p class="msg bad" role="status" id="fast-plan-msg"></p>
    </form>`;
  const read = (form) => {
    const fd = new FormData(form);
    const proto = String(fd.get("proto") ?? "");
    const hours = proto === "custom" ? Number(form.elements.hours.value) : Number(proto);
    return { hours, startTime: String(fd.get("startTime") ?? "") };
  };
  show(html, {
    input: (e) => {
      const form = e.target.form;
      if (!form) return;
      const custom = form.querySelector('input[name="proto"]:checked')?.value === "custom";
      form.elements.hours.disabled = !custom;
      const { hours, startTime } = read(form);
      if (Number.isInteger(hours) && hours >= FAST_HOURS[0] && hours <= FAST_HOURS[1] && validTime(startTime)) panelEl().querySelector("#fast-preview").innerHTML = preview(hours, startTime);
    },
    submit: async (form) => {
      const { hours, startTime } = read(form);
      const msg = panelEl().querySelector("#fast-plan-msg");
      if (!Number.isInteger(hours) || hours < FAST_HOURS[0] || hours > FAST_HOURS[1]) { msg.textContent = `Pick a plan, or a custom length of ${FAST_HOURS[0]} to ${FAST_HOURS[1]} whole hours.`; return; }
      if (!validTime(startTime)) { msg.textContent = "Enter the planned start time."; return; }
      await db.setMeta("fastPlan", { hours, startTime });
      rerender();
      closePanel();
      announce(`Fasting plan saved: ${protocolLabel(hours)}, starting ${startTime}.`);
    },
  });
}

// ---------- fasting history ----------

async function openHistory(message = "", tone = "") {
  const fasts = await db.getAll("fasts");
  const list = fastHistory(fasts);
  const streak = fastStreak(fasts);
  const reached = list.filter((f) => fastStatus(f).reached).length;
  const rows = list.map((f) => {
    const s = fastStatus(f);
    return `<li><button type="button" class="entry" data-act="edit" data-id="${esc(f.id)}">
      <span class="entry-name">${esc(fmtDay(dayKey(new Date(f.end))))}<span class="hint">${esc(when(new Date(f.start)))} to ${esc(time(new Date(f.end)))}</span></span>
      <span class="entry-num">${esc(fmtDuration(s.elapsed))}<span class="hint${s.reached ? " good-text" : ""}">${s.reached ? "goal reached" : `goal ${f.goalHours} h`}</span></span>
    </button></li>`;
  }).join("");
  const html = `
    <div class="sheet-head"><h2 id="panel-title">Fasting history</h2>${closeBtn}</div>
    ${list.length ? `<dl class="facts">
      <div><dt>Current streak</dt><dd>${plural(streak, "day")}</dd></div>
      <div><dt>Fasts reaching their goal</dt><dd>${reached} of ${list.length}</dd></div>
    </dl>` : ""}
    <p class="sub">${list.length ? "Newest first. Tap a fast to change its times or delete it." : "No finished fasts yet. Start one from the Today tab."}</p>
    <button type="button" class="btn ghost" data-act="add">Add a past fast</button>
    <p class="msg ${tone}" role="status">${esc(message)}</p>
    ${rows ? `<ul class="entries">${rows}</ul>` : ""}`;
  show(html, {
    click: async (act, el) => {
      if (act === "edit") await openFast(el.dataset.id, { fromHistory: true });
      if (act === "add") await openFast(null, { fromHistory: true });
    },
  });
}

// ---------- add / change a fast ----------

async function openFast(id, { fromHistory = false } = {}) {
  const existing = id ? await db.get("fasts", id) : null;
  if (id && !existing) { rerender(); if (fromHistory) await openHistory("That fast is gone.", "bad"); return; }
  const plan = await loadPlan();
  const now = new Date();
  const running = existing && !existing.end;
  const start = existing ? new Date(existing.start) : new Date(now.getTime() - plan.hours * 3600_000);
  const end = existing?.end ? new Date(existing.end) : now;
  const goal = existing?.goalHours ?? plan.hours;
  const title = !existing ? "Add a past fast" : running ? "Change start time" : "Change fast";
  const html = `
    <div class="sheet-head">${fromHistory ? backBtn() : ""}<h2 id="panel-title" class="grow">${title}</h2>${closeBtn}</div>
    <form class="form" id="fast-form" novalidate>
      <label class="field"><span>Started</span><input name="start" type="datetime-local" max="${localInput(now)}" value="${localInput(start)}" required autofocus></label>
      ${running ? "" : `<label class="field"><span>Ended</span><input name="end" type="datetime-local" max="${localInput(now)}" value="${localInput(end)}" required></label>`}
      <label class="field"><span>Goal (hours)</span><input name="goal" type="number" inputmode="numeric" min="${FAST_HOURS[0]}" max="${FAST_HOURS[1]}" step="1" value="${goal}"></label>
      <button class="btn" type="submit">Save</button>
      ${existing ? `<button class="btn danger" type="button" data-act="delete">Delete this fast</button>` : ""}
      <p class="msg bad" role="status" id="fast-msg"></p>
    </form>`;
  show(html, {
    click: async (act) => {
      if (act === "back") await openHistory();
      if (act === "delete" && existing) {
        if (!confirm(`Delete the fast that started ${when(new Date(existing.start))}? This cannot be undone.`)) return;
        await db.del("fasts", existing.id);
        rerender();
        if (fromHistory) await openHistory("Fast deleted.", "good"); else closePanel();
        announce("Fast deleted.");
      }
    },
    submit: async (form) => {
      const msg = panelEl().querySelector("#fast-msg");
      const s = fromInput(String(form.elements.start.value));
      const e = running ? null : fromInput(String(form.elements.end.value));
      const g = Number(form.elements.goal.value);
      const problem = fastTimesProblem(s, running ? null : e ?? new Date(NaN), new Date());
      if (problem) { msg.textContent = problem; return; }
      if (!Number.isInteger(g) || g < FAST_HOURS[0] || g > FAST_HOURS[1]) { msg.textContent = `The goal must be ${FAST_HOURS[0]} to ${FAST_HOURS[1]} whole hours.`; return; }
      const rec = { ...(existing ?? { id: newId() }), start: s.toISOString(), end: running ? null : e.toISOString(), goalHours: g };
      await db.put("fasts", rec);
      rerender();
      if (fromHistory) await openHistory("Fast saved.", "good"); else closePanel();
      announce(fastMessage(running ? "Start time changed:" : "Fast saved:", rec));
    },
  });
}

// ---------- water goal ----------

async function openWaterGoal() {
  const goal = waterGoalOf(await db.getMeta("waterGoal", null));
  const html = `
    <div class="sheet-head"><h2 id="panel-title">Water goal</h2>${closeBtn}</div>
    <form class="form" id="water-form" novalidate>
      <label class="field"><span>Glasses a day</span><input name="goal" type="number" inputmode="numeric" min="1" max="${WATER_MAX}" step="1" value="${goal}" autofocus></label>
      <p class="hint">A glass is about 250 ml. Food and other drinks count toward water too, so this is a guide, not a rule.</p>
      <button class="btn" type="submit">Save</button>
      <p class="msg bad" role="status" id="water-msg"></p>
    </form>`;
  show(html, {
    submit: async (form) => {
      const g = Number(form.elements.goal.value);
      if (!Number.isInteger(g) || g < 1 || g > WATER_MAX) { panelEl().querySelector("#water-msg").textContent = `Enter 1 to ${WATER_MAX} glasses.`; return; }
      await db.setMeta("waterGoal", g);
      rerender();
      closePanel();
      announce(`Water goal set to ${plural(g, "glass", "glasses")}.`);
    },
  });
}

// ---------- exercise ----------

async function openExercise(date) {
  const today = dayKey();
  const rec = await loadDay(date);
  const has = rec.exerciseKcal !== null || rec.steps !== null;
  const v = (n) => (n === null ? "" : String(n));
  const html = `
    <div class="sheet-head"><h2 id="panel-title">Exercise</h2>${closeBtn}</div>
    <form class="form" id="ex-form" novalidate>
      <label class="field"><span>Day</span><input name="date" type="date" max="${today}" value="${esc(date)}" required></label>
      <div class="grid2">
        <label class="field"><span>Calories burned</span><input name="kcal" type="number" inputmode="numeric" min="0" max="${EXERCISE_MAX.kcal}" step="1" value="${v(rec.exerciseKcal)}" autofocus></label>
        <label class="field"><span>Steps</span><input name="steps" type="number" inputmode="numeric" min="0" max="${EXERCISE_MAX.steps}" step="1" value="${v(rec.steps)}"></label>
      </div>
      ${rec.exerciseSource === "mfp" ? `<p class="hint">These came from your MyFitnessPal import. Saving makes them your own.</p>` : ""}
      <p class="hint">The total for the day, for example from your watch or a fitness app. Net calories (food minus exercise) show beside your food. Your targets stay the same, since your activity level already counts everyday movement.</p>
      <button class="btn" type="submit">Save</button>
      ${has ? `<button class="btn danger" type="button" data-act="clear">Clear this day's exercise</button>` : ""}
      <p class="msg bad" role="status" id="ex-msg"></p>
    </form>`;
  const save = async (d, kcal, steps) => {
    const cur = await loadDay(d);
    const { exerciseSource, ...rest } = cur;
    const next = { ...rest, exerciseKcal: kcal, steps };
    await db.put("days", next);
    const food = sumEntries(await db.getByIndex("entries", "date", d)).kcal;
    rerender();
    closePanel();
    announce(exerciseMessage(fmtDay(d), next, food));
  };
  show(html, {
    click: async (act) => {
      if (act === "clear") await save(date, null, null);
    },
    input: async (e) => {
      // Picking another day loads what that day has.
      if (e.target.name === "date" && /^\d{4}-\d{2}-\d{2}$/.test(e.target.value) && e.target.value >= "2000-01-01" && e.target.value <= today && e.target.value !== date) await openExercise(e.target.value);
    },
    submit: async (form) => {
      const msg = panelEl().querySelector("#ex-msg");
      const d = String(form.elements.date.value);
      if (!/^\d{4}-\d{2}-\d{2}$/.test(d) || d > today) { msg.textContent = "Pick a day up to today."; return; }
      const kcal = String(form.elements.kcal.value).trim(), steps = String(form.elements.steps.value).trim();
      const problem = exerciseProblem(kcal, steps);
      if (problem) { msg.textContent = problem; return; }
      await save(d, kcal === "" ? null : Math.round(Number(kcal)), steps === "" ? null : Number(steps));
    },
  });
}
