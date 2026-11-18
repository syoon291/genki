// Day trackers: fasting, water and exercise. Pure functions (no DOM, no
// IndexedDB) so they run under `node --test` as well as in the browser.
//
// - A fast is { id, start (ISO), end (ISO) | null while it runs, goalHours }.
// - The fasting plan (meta fastPlan) is { hours, startTime ("HH:MM") }: how
//   long a fast lasts and when it is planned to start each day.
// - A day record (store "days", one per local day) is { date, water (glasses),
//   exerciseKcal, steps, exerciseSource?: "mfp" }; a field not logged is null.
import { dayKey, shiftDay } from "./nutrition.js";

export const PROTOCOLS = [
  { hours: 12, label: "12:12" },
  { hours: 14, label: "14:10" },
  { hours: 16, label: "16:8" },
];
export const FAST_HOURS = [1, 72];
export const DEFAULT_PLAN = { hours: 16, startTime: "20:00" };
export const DEFAULT_WATER_GOAL = 8;
export const WATER_MAX = 40;
export const EXERCISE_MAX = { kcal: 10000, steps: 200000 };

const HOUR = 3600_000;

// "16:8" for the standard protocols, "18 h" for a custom one.
export function protocolLabel(hours) {
  return PROTOCOLS.find((p) => p.hours === hours)?.label ?? `${hours} h`;
}

// The plan as stored, made safe: whole hours in FAST_HOURS, a valid start time.
export function normalPlan(plan) {
  const h = Number(plan?.hours);
  const hours = Number.isInteger(h) && h >= FAST_HOURS[0] && h <= FAST_HOURS[1] ? h : DEFAULT_PLAN.hours;
  const startTime = validTime(plan?.startTime) ? plan.startTime : DEFAULT_PLAN.startTime;
  return { hours, startTime };
}

export const validTime = (s) => typeof s === "string" && /^([01]\d|2[0-3]):[0-5]\d$/.test(s);

// A Date at "HH:MM" on the local day `key`.
function at(key, time) {
  const [y, m, d] = key.split("-").map(Number);
  const [hh, mm] = time.split(":").map(Number);
  return new Date(y, m - 1, d, hh, mm);
}

// The planned fast that is running now or comes next: { start, end } Dates.
// Today's planned start counts until its planned end has passed.
export function plannedWindow(plan, now = new Date()) {
  const p = normalPlan(plan);
  for (const k of [shiftDay(dayKey(now), -1), dayKey(now), shiftDay(dayKey(now), 1)]) {
    const start = at(k, p.startTime);
    const end = new Date(start.getTime() + p.hours * HOUR);
    if (end > now) return { start, end };
  }
  // Not reached (tomorrow's window always ends after now), kept for safety.
  const start = at(shiftDay(dayKey(now), 1), p.startTime);
  return { start, end: new Date(start.getTime() + p.hours * HOUR) };
}

// The planned window to show next: plannedWindow, moved on a day when a fast
// already ended inside it or after its start (today's fast is done).
export function nextWindow(plan, fasts, now = new Date()) {
  const w = plannedWindow(plan, now);
  const done = fasts.some((f) => f.end && new Date(f.end) >= w.start);
  if (!done) return w;
  // The next local day at the planned clock time (not +24 h, which drifts an hour over a DST change).
  const start = at(shiftDay(dayKey(w.start), 1), normalPlan(plan).startTime);
  return { start, end: new Date(start.getTime() + normalPlan(plan).hours * HOUR) };
}

// The fast in progress (no end), the newest one if there are several.
export function runningFast(fasts) {
  return [...fasts].filter((f) => !f.end).sort((a, b) => b.start.localeCompare(a.start))[0] ?? null;
}

// Where a fast stands at `now` (or at its end once ended).
export function fastStatus(fast, now = new Date()) {
  const start = new Date(fast.start).getTime();
  const stop = fast.end ? new Date(fast.end).getTime() : now.getTime();
  const elapsed = Math.max(0, stop - start);
  const goal = fast.goalHours * HOUR;
  return { elapsed, goal, pct: Math.min(1, elapsed / goal), reached: elapsed >= goal, goalAt: new Date(start + goal), left: Math.max(0, goal - elapsed) };
}

// "16 h 05 min", "45 min".
export function fmtDuration(ms) {
  const min = Math.floor(ms / 60_000);
  const h = Math.floor(min / 60), m = min % 60;
  return h ? `${h} h ${String(m).padStart(2, "0")} min` : `${m} min`;
}

// "16:05:09", the live timer.
export function fmtClock(ms) {
  const s = Math.floor(ms / 1000);
  const pad = (n) => String(n).padStart(2, "0");
  return `${Math.floor(s / 3600)}:${pad(Math.floor(s / 60) % 60)}:${pad(s % 60)}`;
}

// Finished fasts, newest first.
export function fastHistory(fasts) {
  return fasts.filter((f) => f.end).sort((a, b) => b.end.localeCompare(a.end));
}

// Days in a row (counted by the day each fast ended) with a fast that reached
// its goal, up to today; a streak still counts when today has none yet.
export function fastStreak(fasts, today = dayKey()) {
  const days = new Set(fastHistory(fasts).filter((f) => fastStatus(f).reached).map((f) => dayKey(new Date(f.end))));
  let k = days.has(today) ? today : shiftDay(today, -1);
  let n = 0;
  while (days.has(k)) { n++; k = shiftDay(k, -1); }
  return n;
}

// A problem with a fast's times, or "" when they are fine. `end` may be null
// (still running). Times are Dates.
export function fastTimesProblem(start, end, now = new Date()) {
  if (!(start instanceof Date) || Number.isNaN(start.getTime())) return "Enter when the fast started.";
  if (start > now) return "The start cannot be in the future.";
  if (end === null) return now - start > 7 * 24 * HOUR ? "A fast can be at most 7 days long." : "";
  if (!(end instanceof Date) || Number.isNaN(end.getTime())) return "Enter when the fast ended.";
  if (end > now) return "The end cannot be in the future.";
  if (end <= start) return "The end must be after the start.";
  if (end - start > 7 * 24 * HOUR) return "A fast can be at most 7 days long.";
  return "";
}

// ---------- water and exercise ----------

// A day record with every field present (null when not logged).
export function dayRecord(date, rec) {
  return {
    date,
    water: Number.isInteger(rec?.water) && rec.water > 0 ? rec.water : 0,
    exerciseKcal: Number.isFinite(rec?.exerciseKcal) ? rec.exerciseKcal : null,
    steps: Number.isFinite(rec?.steps) ? rec.steps : null,
    ...(rec?.exerciseSource ? { exerciseSource: rec.exerciseSource } : {}),
  };
}

export const waterGoalOf = (g) => (Number.isInteger(g) && g >= 1 && g <= WATER_MAX ? g : DEFAULT_WATER_GOAL);

// The day record after adding `delta` glasses (never below 0 or above WATER_MAX).
export function addWater(rec, delta) {
  return { ...rec, water: Math.max(0, Math.min(WATER_MAX, (rec.water || 0) + delta)) };
}

// A problem with typed exercise numbers ("" = not logged), or "".
export function exerciseProblem(kcal, steps) {
  for (const [v, max, what] of [[kcal, EXERCISE_MAX.kcal, "Calories burned"], [steps, EXERCISE_MAX.steps, "Steps"]]) {
    if (v === "") continue;
    const n = Number(v);
    if (!Number.isFinite(n) || n < 0 || n > max) return `${what} must be a number from 0 to ${max.toLocaleString("en-US")}.`;
    if (what === "Steps" && !Number.isInteger(n)) return "Steps must be a whole number.";
  }
  return "";
}

// Food eaten minus exercise burned. Targets stay as they are: the profile's
// activity level already counts everyday exercise.
export const netCalories = (foodKcal, exerciseKcal) => foodKcal - (exerciseKcal || 0);

// ---------- what screen readers hear ----------

export function waterMessage(glasses, goal) {
  return `Water ${glasses} of ${goal} ${goal === 1 ? "glass" : "glasses"}${glasses >= goal ? ", goal reached" : ""}.`;
}

export function fastMessage(what, fast, now = new Date()) {
  if (!fast) return what;
  const s = fastStatus(fast, now);
  return `${what} ${fmtDuration(s.elapsed)} of ${fast.goalHours} h${s.reached ? ", goal reached" : ""}.`;
}

export function exerciseMessage(date, rec, foodKcal) {
  const parts = [];
  if (rec.exerciseKcal !== null) parts.push(`${Math.round(rec.exerciseKcal)} kcal burned`);
  if (rec.steps !== null) parts.push(`${rec.steps} steps`);
  if (!parts.length) return `Exercise cleared for ${date}.`;
  const net = rec.exerciseKcal !== null ? `, net ${Math.round(netCalories(foodKcal, rec.exerciseKcal))} kcal` : "";
  return `Exercise saved for ${date}: ${parts.join(", ")}${net}.`;
}
