// Daily targets and day totals. Pure functions (no DOM, no IndexedDB) so they
// run under `node --test` as well as in the browser. These are general
// guidelines for healthy adults, not medical advice.

export const ACTIVITY = {
  sedentary: { factor: 1.2, label: "Sedentary", hint: "Desk job, little exercise" },
  light: { factor: 1.375, label: "Light", hint: "Exercise 1-3 days a week" },
  moderate: { factor: 1.55, label: "Moderate", hint: "Exercise 3-5 days a week" },
  active: { factor: 1.725, label: "Active", hint: "Hard exercise 6-7 days a week" },
  very: { factor: 1.9, label: "Very active", hint: "Physical job plus training" },
};

export const DEFAULT_DEFICIT = 500; // kcal/day, about 0.45 kg a week
export const MAX_DEFICIT = 1000;
// The target never goes below these, whatever the deficit (common minimums
// for unsupervised dieting).
export const KCAL_FLOOR = { female: 1200, male: 1500 };
export const PROTEIN_RANGE = [1.6, 2.2]; // g per kg body weight
export const DEFAULT_PROTEIN_PER_KG = 1.8;
export const KCAL_PER_KG = 7700; // energy in 1 kg of body fat, roughly

// Energy per gram, for turning a share of calories into grams and back.
export const KCAL_PER_G = { protein: 4, carbs: 4, fat: 9 };
// Carbs and fat are set as a share of calories ("pct") or as grams ("g").
// Without a saved choice: fat 30 % of calories, carbs the rest after protein.
export const DEFAULT_FAT_PCT = 30;
export const MACRO_LIMITS = { pct: [0, 100], carbG: [0, 1000], fatG: [0, 400] };

export const MEALS = [
  { id: "breakfast", label: "Breakfast" },
  { id: "lunch", label: "Lunch" },
  { id: "dinner", label: "Dinner" },
  { id: "snacks", label: "Snacks" },
];

const KG_PER_LB = 0.45359237;
export const kgToLb = (kg) => kg / KG_PER_LB;

export function ageFrom(birthYear, today = new Date()) {
  return today.getFullYear() - birthYear;
}

// Resting energy (Mifflin-St Jeor, 1990), kcal/day.
export function bmr({ sex, weightKg, heightCm, age }) {
  const base = 10 * weightKg + 6.25 * heightCm - 5 * age;
  return sex === "female" ? base - 161 : base + 5;
}

// Returns a list of problems with a profile, each fit to show; empty when it is usable.
export function profileProblems(p, today = new Date()) {
  const out = [];
  const year = today.getFullYear();
  if (p.sex !== "female" && p.sex !== "male") out.push("Pick a sex for the energy formula.");
  if (!(p.birthYear >= year - 100 && p.birthYear <= year - 18)) out.push("Year of birth must make you 18 to 100 (the formula is for adults).");
  if (!(p.heightCm >= 120 && p.heightCm <= 230)) out.push("Height must be between 120 and 230 cm.");
  if (!(p.weightKg >= 30 && p.weightKg <= 300)) out.push("Weight must be between 30 and 300 kg.");
  if (!ACTIVITY[p.activity]) out.push("Pick an activity level.");
  if (p.goalKg !== undefined && p.goalKg !== null && !(p.goalKg >= 30 && p.goalKg <= 300)) out.push("Goal weight must be between 30 and 300 kg.");
  if (!(Number.isFinite(p.deficit) && p.deficit >= 0 && p.deficit <= MAX_DEFICIT)) out.push(`Daily deficit must be between 0 and ${MAX_DEFICIT} kcal.`);
  if (!(p.proteinPerKg >= PROTEIN_RANGE[0] && p.proteinPerKg <= PROTEIN_RANGE[1])) out.push(`Protein must be between ${PROTEIN_RANGE[0]} and ${PROTEIN_RANGE[1]} g per kg.`);
  if (p.targetDate && !/^\d{4}-\d{2}-\d{2}$/.test(p.targetDate)) out.push("Target date is not a date.");
  out.push(...macroProblems(p));
  return out;
}

// { bmr, tdee, kcal, deficit, floored, floor, protein, macros } for a valid profile
// (macros: carb and fat targets, see macroTargets).
// deficit is what the target actually takes off maintenance (smaller than
// the profile's when the floor kicks in).
export function targets(p, today = new Date()) {
  const rest = bmr({ sex: p.sex, weightKg: p.weightKg, heightCm: p.heightCm, age: ageFrom(p.birthYear, today) });
  const tdee = rest * ACTIVITY[p.activity].factor;
  const floor = KCAL_FLOOR[p.sex];
  const wanted = tdee - p.deficit;
  // Round first, then floor, so the target shown is never under the floor.
  const kcal = Math.max(floor, Math.round(wanted / 10) * 10);
  const protein = Math.round(p.weightKg * p.proteinPerKg);
  return {
    bmr: Math.round(rest),
    tdee: Math.round(tdee),
    kcal,
    deficit: Math.max(0, Math.round(tdee) - kcal),
    floored: kcal === floor && wanted < floor,
    floor,
    protein,
    macros: macroTargets(p, { kcal, protein }),
  };
}

// ---------- carbs and fat ----------

// Grams of a macro that make up `pct` percent of `kcal`.
export function gramsFromPct(kcal, pct, macro) {
  return kcal > 0 ? (kcal * pct) / 100 / KCAL_PER_G[macro] : 0;
}

// Percent of `kcal` that `grams` of a macro supply.
export function pctFromGrams(kcal, grams, macro) {
  return kcal > 0 ? ((grams * KCAL_PER_G[macro]) / kcal) * 100 : 0;
}

const inRange = (v, [lo, hi]) => Number.isFinite(v) && v >= lo && v <= hi;
const given = (v) => v !== undefined && v !== null;

export function macroProblems(p) {
  const out = [];
  if (given(p.macroMode) && p.macroMode !== "pct" && p.macroMode !== "g") out.push("Pick how carbs and fat are set.");
  if (p.macroMode === "g") {
    if (!inRange(p.carbG, MACRO_LIMITS.carbG)) out.push(`Carbs must be between 0 and ${MACRO_LIMITS.carbG[1]} g.`);
    if (!inRange(p.fatG, MACRO_LIMITS.fatG)) out.push(`Fat must be between 0 and ${MACRO_LIMITS.fatG[1]} g.`);
  } else if (p.macroMode === "pct") {
    if (!inRange(p.carbPct, MACRO_LIMITS.pct)) out.push("Carbs must be between 0 and 100 % of calories.");
    if (!inRange(p.fatPct, MACRO_LIMITS.pct)) out.push("Fat must be between 0 and 100 % of calories.");
    else if (Number.isFinite(p.carbPct) && p.carbPct + p.fatPct > 100) out.push("Carbs and fat cannot add up to more than 100 % of calories.");
  }
  return out;
}

// Carb and fat targets for a profile, given its calorie and protein targets:
// { mode, carbs, fat (grams, whole), carbPct, fatPct, proteinPct, totalPct (whole percents) }.
// In "pct" mode the grams follow the calorie target; in "g" mode the grams
// stay put and the percents follow. With no saved choice, fat is 30 % and
// carbs take what protein and fat leave (never below zero).
export function macroTargets(p, t) {
  const proteinPct = pctFromGrams(t.kcal, t.protein, "protein");
  let mode = p.macroMode, carbs, fat;
  if (mode === "g") {
    carbs = p.carbG; fat = p.fatG;
  } else {
    let carbPct = p.carbPct, fatPct = p.fatPct;
    if (mode !== "pct") {
      mode = "auto";
      fatPct = DEFAULT_FAT_PCT;
      carbPct = Math.max(0, 100 - proteinPct - fatPct);
    }
    carbs = gramsFromPct(t.kcal, carbPct, "carbs");
    fat = gramsFromPct(t.kcal, fatPct, "fat");
  }
  carbs = Math.round(carbs); fat = Math.round(fat);
  const carbPct = pctFromGrams(t.kcal, carbs, "carbs");
  const fatPct = pctFromGrams(t.kcal, fat, "fat");
  return {
    mode,
    carbs,
    fat,
    carbPct: Math.round(carbPct),
    fatPct: Math.round(fatPct),
    proteinPct: Math.round(proteinPct),
    totalPct: Math.round(carbPct + fatPct + proteinPct),
  };
}

// When the goal weight would be reached at the target's deficit:
// { kgToGo, days, date (YYYY-MM-DD), onTrack (vs the profile's target date, or null) }.
// null when there is no goal below the current weight or no deficit.
export function projection(p, t, today = new Date()) {
  if (!(p.goalKg > 0) || p.goalKg >= p.weightKg || !(t.deficit > 0)) return null;
  const kgToGo = p.weightKg - p.goalKg;
  const days = Math.ceil((kgToGo * KCAL_PER_KG) / t.deficit);
  const d = new Date(today.getFullYear(), today.getMonth(), today.getDate() + days);
  const date = dayKey(d);
  return { kgToGo: Math.round(kgToGo * 10) / 10, days, date, onTrack: p.targetDate ? date <= p.targetDate : null };
}

// Local calendar day as YYYY-MM-DD (the food log's day key).
export function dayKey(d = new Date()) {
  const pad = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export function shiftDay(key, days) {
  const [y, m, d] = key.split("-").map(Number);
  return dayKey(new Date(y, m - 1, d + days));
}

// A log entry stores its nutrients per unit (`base`) and how many units were eaten.
export function entryNutrients(e) {
  const k = e.amount;
  return { kcal: e.base.kcal * k, protein: e.base.protein * k, fat: (e.base.fat ?? 0) * k, carbs: (e.base.carbs ?? 0) * k };
}

export function sumEntries(entries) {
  const t = { kcal: 0, protein: 0, fat: 0, carbs: 0 };
  for (const e of entries) {
    const n = entryNutrients(e);
    t.kcal += n.kcal; t.protein += n.protein; t.fat += n.fat; t.carbs += n.carbs;
  }
  return t;
}

// The days of the week (Monday first) that hold `key`, as YYYY-MM-DD.
export function weekDays(key) {
  const [y, m, d] = key.split("-").map(Number);
  const back = (new Date(y, m - 1, d).getDay() + 6) % 7; // days since Monday
  return Array.from({ length: 7 }, (_, i) => shiftDay(key, i - back));
}

// What share of each daily target (whole percents) the nutrients `n` are.
// t: targets(); null without a complete profile.
export function pctOfTargets(n, t) {
  if (!t) return null;
  const p = (v, target) => (target > 0 ? Math.round((v / target) * 100) : null);
  return { kcal: p(n.kcal, t.kcal), protein: p(n.protein, t.protein), carbs: p(n.carbs, t.macros.carbs), fat: p(n.fat, t.macros.fat) };
}

// { breakfast: { entries, totals }, ... } in MEALS order; unknown meals land in snacks.
export function byMeal(entries) {
  const out = Object.fromEntries(MEALS.map((m) => [m.id, { entries: [], totals: null }]));
  for (const e of entries) (out[e.meal] ?? out.snacks).entries.push(e);
  for (const m of Object.values(out)) {
    m.entries.sort((a, b) => (a.createdAt ?? "").localeCompare(b.createdAt ?? ""));
    m.totals = sumEntries(m.entries);
  }
  return out;
}

// The meal to suggest for a new entry, by local time of day.
export function mealForHour(h) {
  if (h < 10) return "breakfast";
  if (h < 15) return "lunch";
  if (h >= 17 && h < 22) return "dinner";
  return "snacks";
}

// ---------- weekly history (imported, read-only) ----------
// Weekly nutrition averages from another app, kept as history: one record per
// week, keyed by its first day. Never edited in genki; a re-import replaces a week.

export const WEEK_COLUMNS = ["week_start", "week_end", "net_kcal_per_day", "protein_g", "carbs_g", "fat_g", "fiber_g", "carb_pct", "fat_pct", "protein_pct"];
// Record field for each column after the two dates, with its allowed range.
const WEEK_FIELDS = [
  ["kcal", "net_kcal_per_day", 0, 10000],
  ["protein", "protein_g", 0, 1000],
  ["carbs", "carbs_g", 0, 2000],
  ["fat", "fat_g", 0, 1000],
  ["fiber", "fiber_g", 0, 500],
  ["carbPct", "carb_pct", 0, 100],
  ["fatPct", "fat_pct", 0, 100],
  ["proteinPct", "protein_pct", 0, 100],
];

const isDay = (s) => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const [y, m, d] = s.split("-").map(Number);
  const dt = new Date(y, m - 1, d);
  return dt.getFullYear() === y && dt.getMonth() === m - 1 && dt.getDate() === d;
};

// Parse a weekly-averages CSV. The columns are found by a header row naming
// them (any order, extra columns ignored); with no header they are taken in
// WEEK_COLUMNS order. week_start, week_end and net_kcal_per_day are required;
// the rest may be blank (stored as null). Percents may carry a "%". Returns
// { rows: [{ weekStart, weekEnd, kcal, protein, carbs, fat, fiber, carbPct,
// fatPct, proteinPct }] (oldest first, last row for a week wins),
// skipped: [{ line, reason }] }.
export function parseWeeklyCsv(text) {
  const byWeek = new Map(), skipped = [];
  const lines = String(text).replace(/^﻿/, "").split(/\r\n|\n|\r/);
  let col = null;
  lines.forEach((raw, i) => {
    const line = raw.trim();
    if (!line || line.startsWith("#")) return;
    const delim = line.match(/[,;\t]/)?.[0] ?? ",";
    const cells = line.split(delim).map((c) => c.trim().replace(/^"(.*)"$/, "$1").trim());
    if (!col) {
      if (!/^\d/.test(cells[0])) {
        const names = cells.map((c) => c.toLowerCase());
        col = Object.fromEntries(WEEK_COLUMNS.map((c) => [c, names.indexOf(c)]));
        return;
      }
      col = Object.fromEntries(WEEK_COLUMNS.map((c, k) => [c, k]));
    }
    const n = i + 1;
    if (col.week_start < 0 || col.week_end < 0 || col.net_kcal_per_day < 0) { skipped.push({ line: n, reason: "the header has no week_start, week_end or net_kcal_per_day column" }); return; }
    const cell = (name) => (col[name] >= 0 ? (cells[col[name]] ?? "") : "");
    const weekStart = cell("week_start").replace(/\//g, "-");
    const weekEnd = cell("week_end").replace(/\//g, "-");
    if (!isDay(weekStart)) { skipped.push({ line: n, reason: `"${cell("week_start")}" is not a YYYY-MM-DD date` }); return; }
    if (!isDay(weekEnd) || weekEnd < weekStart) { skipped.push({ line: n, reason: `"${cell("week_end")}" is not a YYYY-MM-DD date on or after ${weekStart}` }); return; }
    const row = { weekStart, weekEnd };
    for (const [field, name, lo, hi] of WEEK_FIELDS) {
      const s = cell(name).replace(/%$/, "").trim();
      if (s === "") {
        if (field === "kcal") { skipped.push({ line: n, reason: "no net_kcal_per_day" }); return; }
        row[field] = null;
        continue;
      }
      const v = Number(delim === "," ? s : s.replace(",", "."));
      if (!Number.isFinite(v) || v < lo || v > hi) { skipped.push({ line: n, reason: `${name} "${cell(name)}" is not a number from ${lo} to ${hi}` }); return; }
      row[field] = Math.round(v * 10) / 10;
    }
    byWeek.set(weekStart, row);
  });
  const rows = [...byWeek.values()].sort((a, b) => a.weekStart.localeCompare(b.weekStart));
  return { rows, skipped };
}

// What a screen reader hears after the day's log changes: what happened, then
// the day's calories and protein against the targets (or eaten, without a profile).
export function dayTotalsMessage(action, total, t) {
  const r = Math.round;
  const totals = t
    ? `Day total ${r(total.kcal)} of ${r(t.kcal)} kcal, ${r(total.protein)} of ${r(t.protein)} g protein.`
    : `Day total ${r(total.kcal)} kcal, ${r(total.protein)} g protein.`;
  return `${action} ${totals}`;
}
