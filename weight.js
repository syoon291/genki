// Weigh-ins: the 7-day average, the weekly change, progress to the goal,
// chart scaling and the CSV import. Pure functions (no DOM, no IndexedDB) so
// they run under `node --test` as well as in the browser.
// A weigh-in is { date: "YYYY-MM-DD" (local day), kg, at (ISO time logged) };
// there is at most one per day, and re-logging a day replaces it.
import { shiftDay } from "./nutrition.js";

export const WEIGHT_RANGE = [30, 300]; // kg, the same bounds as the profile
export const AVG_DAYS = 7;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export const round1 = (n) => Math.round(n * 10) / 10;

export function validDate(s) {
  if (typeof s !== "string" || !DATE_RE.test(s)) return false;
  const [y, m, d] = s.split("-").map(Number);
  const dt = new Date(y, m - 1, d);
  return dt.getFullYear() === y && dt.getMonth() === m - 1 && dt.getDate() === d;
}

export function weightProblem(kg) {
  if (!Number.isFinite(kg)) return "Enter your weight in kg.";
  if (kg < WEIGHT_RANGE[0] || kg > WEIGHT_RANGE[1]) return `Weight must be between ${WEIGHT_RANGE[0]} and ${WEIGHT_RANGE[1]} kg.`;
  return null;
}

// Oldest first, one per day (the last one given for a day wins).
export function sortWeighIns(list) {
  const byDay = new Map();
  for (const w of list) byDay.set(w.date, w);
  return [...byDay.values()].sort((a, b) => a.date.localeCompare(b.date));
}

// Mean of the weigh-ins in the `days` calendar days ending on `end` (inclusive),
// or null when there are none. `sorted` is oldest first.
export function averageEnding(sorted, end, days = AVG_DAYS) {
  const start = shiftDay(end, -(days - 1));
  let sum = 0, n = 0;
  for (const w of sorted) {
    if (w.date < start) continue;
    if (w.date > end) break;
    sum += w.kg; n++;
  }
  return n ? sum / n : null;
}

// Each weigh-in with its trailing 7-day average: [{ date, kg, avg }], oldest first.
export function trend(list) {
  const sorted = sortWeighIns(list);
  return sorted.map((w) => ({ date: w.date, kg: w.kg, avg: averageEnding(sorted, w.date) }));
}

// The numbers the weight card shows. `today` is a day key.
// {
//   latest: { date, kg } | null,
//   avg: 7-day average ending on the latest weigh-in,
//   weekChange: that average minus the one a week earlier (null without both),
//   start: mean of the first week of weigh-ins (the progress baseline),
//   progress: { lost, toGo, pct (0..1), reached } | null without a goal
// }
export function summary(list, goalKg = null) {
  const sorted = sortWeighIns(list);
  if (!sorted.length) return { latest: null, avg: null, weekChange: null, start: null, progress: null };
  const latest = sorted[sorted.length - 1];
  const avg = averageEnding(sorted, latest.date);
  const prev = averageEnding(sorted, shiftDay(latest.date, -AVG_DAYS));
  const first = sorted[0];
  const start = averageEnding(sorted, shiftDay(first.date, AVG_DAYS - 1));
  return { latest: { date: latest.date, kg: latest.kg }, avg, weekChange: prev === null ? null : avg - prev, start, progress: goalProgress(start, avg, goalKg) };
}

// How far from `start` toward `goal` the `current` weight is. Works for a goal
// above the start too (gaining). pct is clamped to 0..1.
export function goalProgress(start, current, goal) {
  if (!(goal > 0) || start === null || current === null) return null;
  const span = start - goal;
  const lost = start - current; // positive when moving down
  if (span === 0) return { lost: round1(-lost), toGo: 0, pct: 1, reached: true };
  const pct = Math.min(1, Math.max(0, lost / span));
  const toGo = Math.abs(current - goal);
  const reached = span > 0 ? current <= goal : current >= goal;
  return { lost: round1(span > 0 ? lost : -lost), toGo: reached ? 0 : round1(toGo), pct: reached ? 1 : pct, reached };
}

// Days between two day keys (b - a).
export function daysBetween(a, b) {
  const [y1, m1, d1] = a.split("-").map(Number);
  const [y2, m2, d2] = b.split("-").map(Number);
  return Math.round((Date.UTC(y2, m2 - 1, d2) - Date.UTC(y1, m1 - 1, d1)) / 86400000);
}

// Y axis for the chart: a range padded around the values, in round steps.
// Returns { min, max, ticks }.
export function weightAxis(values) {
  const v = values.filter(Number.isFinite);
  if (!v.length) return { min: 0, max: 1, ticks: [] };
  let lo = Math.min(...v), hi = Math.max(...v);
  if (hi - lo < 2) { const mid = (hi + lo) / 2; lo = mid - 1; hi = mid + 1; }
  const step = [0.5, 1, 2, 5, 10, 20, 50].find((s) => (hi - lo) / s <= 5) ?? 50;
  const min = Math.floor(lo / step) * step;
  const max = Math.ceil(hi / step) * step;
  const ticks = [];
  for (let t = min; t <= max + 1e-9; t += step) ticks.push(round1(t));
  return { min, max, ticks };
}

// Parse a weigh-in CSV: one `date,weight_kg` row per line, an optional header
// row, dates as YYYY-MM-DD (or YYYY/MM/DD). Blank lines and lines starting
// with # are skipped. Returns { rows: [{ date, kg }] (oldest first, one per
// day, last row for a day wins), skipped: [{ line, reason }] }.
export function parseWeighInCsv(text) {
  const rows = [], skipped = [];
  const lines = String(text).replace(/^﻿/, "").split(/\r\n|\n|\r/);
  let seenData = false;
  lines.forEach((raw, i) => {
    const line = raw.trim();
    if (!line || line.startsWith("#")) return;
    // The delimiter is the first `,` `;` or tab on the line (the date has none); with `;` or tab a comma is a decimal comma.
    const delim = line.match(/[,;\t]/)?.[0] ?? ",";
    const cells = line.split(delim).map((c) => c.trim().replace(/^"(.*)"$/, "$1").trim());
    // A header is a first non-blank line that does not start with a digit.
    if (!seenData) { seenData = true; if (!/^\d/.test(cells[0])) return; }
    const n = i + 1;
    if (cells.length < 2) { skipped.push({ line: n, reason: "needs a date and a weight" }); return; }
    const date = cells[0].replace(/\//g, "-");
    if (!validDate(date)) { skipped.push({ line: n, reason: `"${cells[0]}" is not a YYYY-MM-DD date` }); return; }
    const kg = Number(delim === "," ? cells[1] : cells[1].replace(",", "."));
    if (cells[1] === "" || weightProblem(kg)) { skipped.push({ line: n, reason: `"${cells[1]}" is not a weight between ${WEIGHT_RANGE[0]} and ${WEIGHT_RANGE[1]} kg` }); return; }
    rows.push({ date, kg: round1(kg) });
  });
  return { rows: sortWeighIns(rows), skipped };
}

// What a screen reader hears after a weigh-in is saved or deleted: what
// happened, then the 7-day average now (null when no weigh-ins are left).
export function weighInMessage(action, avg) {
  return avg == null ? `${action} No weigh-ins left.` : `${action} 7-day average ${round1(avg)} kg.`;
}
