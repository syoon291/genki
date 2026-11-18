// Progress tab numbers: a week of the food log as daily totals, averages over
// the logged days, each day's macro split, the foods highest in a macro, and
// the week as CSV. Pure functions (no DOM, no IndexedDB) so they run under
// `node --test` as well as in the browser.
import { weekDays, KCAL_PER_G } from "./nutrition.js";
import { itemsTotal, logKey, EXTRAS } from "./foods.js";

export const MACROS = [
  { id: "carbs", label: "Carbs" },
  { id: "fat", label: "Fat" },
  { id: "protein", label: "Protein" },
];

// The week (Monday first) holding `key`: [{ date, logged, n: totals | null }],
// where totals are kcal, protein, carbs, fat plus the extras (fiber, sugar,
// sodium) the day's foods carry. `entries` may hold any days; others are ignored.
export function weekTotals(entries, key) {
  const days = weekDays(key);
  const byDay = new Map(days.map((d) => [d, []]));
  for (const e of entries) byDay.get(e.date)?.push(e);
  return days.map((date) => {
    const list = byDay.get(date);
    return { date, logged: list.length > 0, n: list.length ? itemsTotal(list) : null };
  });
}

// Daily averages over the logged days: { days (logged count), kcal, protein,
// carbs, fat, extras: { fiber: { avg, days } ... } } with an extra only when
// some day has it (its average is over the days that have it). null when no
// day is logged.
export function weekAverages(week) {
  const logged = week.filter((d) => d.logged);
  if (!logged.length) return null;
  const avg = (k) => logged.reduce((s, d) => s + d.n[k], 0) / logged.length;
  const extras = {};
  for (const { id } of EXTRAS) {
    const have = logged.filter((d) => Number.isFinite(d.n[id]));
    if (have.length) extras[id] = { avg: have.reduce((s, d) => s + d.n[id], 0) / have.length, days: have.length };
  }
  return { days: logged.length, kcal: avg("kcal"), protein: avg("protein"), carbs: avg("carbs"), fat: avg("fat"), extras };
}

// Share of calories from each macro (whole percents that add up to 100, or
// all zero when there are no macro calories): { carbs, fat, protein }.
export function macroSplit(n) {
  const kcal = { carbs: n.carbs * KCAL_PER_G.carbs, fat: n.fat * KCAL_PER_G.fat, protein: n.protein * KCAL_PER_G.protein };
  const total = kcal.carbs + kcal.fat + kcal.protein;
  if (!(total > 0)) return { carbs: 0, fat: 0, protein: 0 };
  // Largest remainder, so the three always add up to 100.
  const raw = MACROS.map((m) => ({ id: m.id, v: (kcal[m.id] / total) * 100 }));
  const out = Object.fromEntries(raw.map((r) => [r.id, Math.floor(r.v)]));
  let left = 100 - Object.values(out).reduce((s, v) => s + v, 0);
  for (const r of [...raw].sort((a, b) => (b.v % 1) - (a.v % 1))) { if (left-- <= 0) break; out[r.id]++; }
  return out;
}

// The foods that gave the most of `macro` (grams) this week, most first:
// [{ name, grams, times, pct (share of the week's total of that macro) }].
// Named foods are grouped across the week (by the food they were logged from);
// imported MyFitnessPal meal totals stay one item each, with their day.
export function topFoods(entries, days, macro, limit = 5) {
  const inWeek = new Set(days);
  const groups = new Map();
  let total = 0;
  for (const e of entries) {
    if (!inWeek.has(e.date)) continue;
    const g = (e.base?.[macro] ?? 0) * e.amount;
    if (!(g > 0)) continue;
    total += g;
    const key = e.source === "mfp" ? `mfp:${e.id}` : logKey(e);
    const item = groups.get(key) ?? { name: e.name, date: e.source === "mfp" ? e.date : null, grams: 0, times: 0 };
    item.grams += g;
    item.times++;
    groups.set(key, item);
  }
  return [...groups.values()]
    .sort((a, b) => b.grams - a.grams || a.name.localeCompare(b.name))
    .slice(0, limit)
    .map((it) => ({ ...it, pct: Math.round((it.grams / total) * 100) }));
}

// The week as CSV: one row per day, Monday first. A day with nothing logged
// has empty cells; fiber is empty when none of the day's foods carry it.
export const CSV_HEADER = ["date", "kcal", "protein_g", "carbs_g", "fat_g", "fiber_g"];
export function weekCsv(week) {
  const r1 = (v) => String(Math.round(v * 10) / 10);
  const rows = week.map((d) => {
    if (!d.logged) return [d.date, "", "", "", "", ""];
    return [d.date, String(Math.round(d.n.kcal)), r1(d.n.protein), r1(d.n.carbs), r1(d.n.fat), Number.isFinite(d.n.fiber) ? r1(d.n.fiber) : ""];
  });
  return [CSV_HEADER, ...rows].map((r) => r.join(",")).join("\n") + "\n";
}

export const weekCsvName = (week) => `genki-week-${week[0].date}.csv`;

// What a screen reader hears after moving to another week.
export function weekMessage(label, avg) {
  if (!avg) return `${label}. Nothing logged.`;
  return `${label}. ${Math.round(avg.kcal)} kcal a day on average over ${avg.days} logged ${avg.days === 1 ? "day" : "days"}.`;
}
