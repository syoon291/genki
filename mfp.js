// MyFitnessPal import: reads the CSVs of MyFitnessPal's data export and plans
// what lands in genki. Pure functions (no DOM, no IndexedDB) so they run under
// `node --test` as well as in the browser.
//
// The export has three files, told apart by their header row:
// - Nutrition-Summary: one row per day per meal, the meal's TOTALS only (no
//   food names): Date, Meal, Calories, Fat (g), ..., Sodium (mg), ...,
//   Carbohydrates (g), Fiber, Sugar, Protein (g), ...
// - Measurement-Summary: Date, Weight (in the account's unit, lb unless the
//   header says kg), only on days a weight was logged.
// - Exercise-Summary: exercise calories and steps. genki has nowhere to keep
//   these, so the file is recognised and left out.
import { validDate, round1, WEIGHT_RANGE } from "./weight.js";
import { MEALS } from "./nutrition.js";
import { EXTRAS, extrasOf } from "./foods.js";

const KG_PER_LB = 0.45359237;
const MEAL_IDS = new Set(MEALS.map((m) => m.id));
const MEAL_ALIASES = { snack: "snacks" };

// Split CSV text into rows of cells: quoted cells may hold commas, doubled
// quotes and line breaks; a BOM and blank lines are dropped.
export function parseCsv(text) {
  const s = String(text).replace(/^﻿/, "");
  const rows = [];
  let row = [], cell = "", quoted = false, line = 1, rowLine = 1;
  const endRow = () => {
    row.push(cell);
    if (row.some((c) => c.trim() !== "")) rows.push({ line: rowLine, cells: row.map((c) => c.trim()) });
    row = []; cell = "";
  };
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (quoted) {
      if (ch === '"' && s[i + 1] === '"') { cell += '"'; i++; }
      else if (ch === '"') quoted = false;
      else { if (ch === "\n") line++; cell += ch; }
    } else if (ch === '"') quoted = true;
    else if (ch === ",") { row.push(cell); cell = ""; }
    else if (ch === "\r" || ch === "\n") {
      if (ch === "\r" && s[i + 1] === "\n") i++;
      endRow();
      line++;
      rowLine = line;
    } else cell += ch;
  }
  endRow();
  return rows;
}

const norm = (h) => h.toLowerCase().replace(/\s+/g, " ").trim();
const findCol = (header, re) => header.findIndex((h) => re.test(norm(h)));

// Which MyFitnessPal file this is, from its header: "nutrition", "measurement",
// "exercise", or null when it is none of them.
export function detectMfpFile(text) {
  const header = (parseCsv(text)[0]?.cells ?? []).map(norm);
  if (header[0] !== "date") return null;
  if (header.includes("meal") && header.includes("calories")) return "nutrition";
  if (header.includes("exercise")) return "exercise";
  if (header.some((h) => /^weight\b/.test(h))) return "measurement";
  return null;
}

// "2026-03-04" as is; "3/4/2026" (US month/day) read too, for exports made in another locale.
function toDay(s) {
  const t = s.trim();
  if (validDate(t)) return t;
  const m = t.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (!m) return null;
  const d = `${m[3]}-${m[1].padStart(2, "0")}-${m[2].padStart(2, "0")}`;
  return validDate(d) ? d : null;
}

function toNumber(s, max) {
  if (s === "" || s == null) return 0;
  const v = Number(String(s).replace(/,/g, ""));
  return Number.isFinite(v) && v >= 0 && v <= max ? v : null;
}

// genki's meal for a MyFitnessPal meal name (custom meal names go to snacks).
export function mealFor(name) {
  const k = norm(name);
  if (MEAL_IDS.has(k)) return k;
  return MEAL_ALIASES[k] ?? "snacks";
}

// Fiber and sugar in g, sodium in mg (the units of foods.js EXTRAS), with the
// largest number a meal may hold.
const EXTRA_COLS = { fiber: [/^fiber\b/, 2000], sugar: [/^sugars?\b/, 2000], sodium: [/^sodium\b/, 100000] };
const roundExtra = (id, v) => (id === "sodium" ? Math.round(v) : round1(v));

// Nutrition-Summary rows: { rows: [{ date, meal (genki's), mealName (as in the
// file), kcal, protein, carbs, fat, fiber?, sugar?, sodium? }] oldest first,
// skipped: [{ line, reason }] }. fiber, sugar and sodium are there only when
// the file has their column and the cell is filled in. Two rows for one day
// and meal are added together.
export function parseMfpNutrition(text) {
  const [head, ...data] = parseCsv(text);
  const skipped = [];
  if (!head) return { rows: [], skipped };
  const h = head.cells;
  const col = {
    date: findCol(h, /^date$/), meal: findCol(h, /^meal$/), kcal: findCol(h, /^calories/),
    fat: findCol(h, /^fat\b/), carbs: findCol(h, /^carbohydrates?\b/), protein: findCol(h, /^protein\b/),
  };
  const extraCol = Object.fromEntries(Object.entries(EXTRA_COLS).map(([id, [re]]) => [id, findCol(h, re)]));
  if (col.date < 0 || col.meal < 0 || col.kcal < 0) return { rows: [], skipped: [{ line: head.line, reason: "not a MyFitnessPal Nutrition-Summary file" }] };
  const byKey = new Map();
  for (const { line, cells } of data) {
    const date = toDay(cells[col.date] ?? "");
    if (!date) { skipped.push({ line, reason: `"${cells[col.date] ?? ""}" is not a date` }); continue; }
    const mealName = cells[col.meal] || "Snacks";
    const v = {};
    for (const [k, max] of [["kcal", 20000], ["protein", 2000], ["carbs", 2000], ["fat", 2000]]) {
      v[k] = col[k] >= 0 ? toNumber(cells[col[k]], max) : 0;
      if (v[k] === null) { skipped.push({ line, reason: `${k === "kcal" ? "calories" : k} "${cells[col[k]]}" is not a number` }); break; }
    }
    if (Object.values(v).includes(null)) continue;
    if (!(v.kcal > 0 || v.protein > 0 || v.carbs > 0 || v.fat > 0)) { skipped.push({ line, reason: "an empty meal" }); continue; }
    // A fiber, sugar or sodium cell that is blank or not a number is left out; the meal still counts.
    const ex = {};
    for (const [id, [, max]] of Object.entries(EXTRA_COLS)) {
      const cell = extraCol[id] >= 0 ? cells[extraCol[id]] ?? "" : "";
      const n = cell === "" ? null : toNumber(cell, max);
      if (n !== null) ex[id] = n;
    }
    const key = `${date}|${norm(mealName)}`;
    const prev = byKey.get(key);
    if (prev) {
      for (const k of ["kcal", "protein", "carbs", "fat"]) prev[k] += v[k];
      for (const [id, n] of Object.entries(ex)) prev[id] = (prev[id] ?? 0) + n;
    } else byKey.set(key, { date, meal: mealFor(mealName), mealName, ...v, ...ex });
  }
  const rows = [...byKey.values()]
    .map((r) => {
      const out = { ...r, kcal: round1(r.kcal), protein: round1(r.protein), carbs: round1(r.carbs), fat: round1(r.fat) };
      for (const { id } of EXTRAS) if (id in out) out[id] = roundExtra(id, out[id]);
      return out;
    })
    .sort((a, b) => a.date.localeCompare(b.date) || MEALS.findIndex((m) => m.id === a.meal) - MEALS.findIndex((m) => m.id === b.meal));
  return { rows, skipped };
}

// Measurement-Summary weights: { rows: [{ date, kg }] oldest first (one per
// day, the last wins), unit: "lb"|"kg", skipped }. Days without a weight are
// left out quietly (the file holds other measurements too).
export function parseMfpWeights(text) {
  const [head, ...data] = parseCsv(text);
  const skipped = [];
  if (!head) return { rows: [], unit: "lb", skipped };
  const h = head.cells;
  const dateCol = findCol(h, /^date$/), wCol = findCol(h, /^weight\b/);
  if (dateCol < 0 || wCol < 0) return { rows: [], unit: "lb", skipped: [{ line: head.line, reason: "not a MyFitnessPal Measurement-Summary file" }] };
  const unit = /\bkg\b|kilo/.test(norm(h[wCol])) ? "kg" : "lb";
  const byDay = new Map();
  for (const { line, cells } of data) {
    const raw = cells[wCol] ?? "";
    if (raw === "") continue;
    const date = toDay(cells[dateCol] ?? "");
    if (!date) { skipped.push({ line, reason: `"${cells[dateCol] ?? ""}" is not a date` }); continue; }
    const n = Number(raw.replace(/,/g, ""));
    const kg = unit === "kg" ? n : n * KG_PER_LB;
    if (!Number.isFinite(kg) || kg < WEIGHT_RANGE[0] || kg > WEIGHT_RANGE[1]) { skipped.push({ line, reason: `"${raw}" is not a weight between ${WEIGHT_RANGE[0]} and ${WEIGHT_RANGE[1]} kg` }); continue; }
    byDay.set(date, { date, kg: round1(kg) });
  }
  return { rows: [...byDay.values()].sort((a, b) => a.date.localeCompare(b.date)), unit, skipped };
}

// The id an imported meal gets, so importing the same file again never adds it twice.
export const entryId = (r) => `mfp-${r.date}-${norm(r.mealName).replace(/[^a-z0-9]+/g, "-")}`;
const macroKey = (f) => `${Math.round(f.kcal)}|${round1(f.protein)}|${round1(f.carbs)}|${round1(f.fat)}`;
const mealLabel = (id) => MEALS.find((m) => m.id === id)?.label ?? "Meal";

// What an import adds, given the parsed files and what is stored already.
// - every meal row becomes one food-log entry (id from entryId; one already
//   stored is left as it is, so edits made in genki survive a re-import);
// - meal totals with the same kcal, protein, carbs and fat on 2+ rows become
//   one my food each, named after the meal they were most often ("Lunch 1,163
//   kcal"), unless a my food with those numbers exists;
// - fiber, sugar and sodium ride along on both; a meal or my food imported
//   before (same id) that lacks one of them gets it filled in, and nothing
//   else about it changes (fillEntries, fillFoods: the whole records to put);
// - weights fill only days with no weigh-in.
// Days after `today` are left out. `now` is a Date.
export function planMfpImport({ meals = [], weights = [], entries = [], myFoods = [], weighIns = [], today, now = new Date() }) {
  const at = now.toISOString();
  const future = [];
  const stored = new Map(entries.map((e) => [e.id, e]));
  const haveEntry = new Set(stored.keys());
  const newEntries = [];
  const fillEntries = [];
  let alreadyLogged = 0;
  const pastMeals = [];
  for (const r of meals) {
    if (r.date > today) { future.push(r.date); continue; }
    pastMeals.push(r);
    const id = entryId(r);
    if (haveEntry.has(id)) {
      const old = stored.get(id);
      const add = old && missingExtras(old.base, r);
      stored.delete(id); // one fill per entry, even if the files repeat a meal
      if (add) fillEntries.push({ ...old, base: { ...old.base, ...add } });
      else alreadyLogged++;
      continue;
    }
    haveEntry.add(id);
    newEntries.push({
      id, date: r.date, meal: r.meal, name: `MyFitnessPal ${norm(r.mealName)}`, source: "mfp", ref: null,
      amount: 1, unit: "1 meal", base: { kcal: r.kcal, protein: r.protein, fat: r.fat, carbs: r.carbs, ...extrasOf(r) }, createdAt: at,
    });
  }

  const groups = new Map();
  for (const r of pastMeals) {
    const k = macroKey(r);
    const g = groups.get(k) ?? { rows: [], byMeal: new Map() };
    g.rows.push(r);
    g.byMeal.set(r.meal, (g.byMeal.get(r.meal) ?? 0) + 1);
    groups.set(k, g);
  }
  const haveFood = new Set(myFoods.map(macroKey));
  const byId = new Map(myFoods.map((f) => [f.id, f]));
  const names = new Set(myFoods.map((f) => f.name.toLowerCase()));
  const newFoods = [];
  const fillFoods = [];
  let foodsKnown = 0;
  for (const [k, g] of groups) {
    if (g.rows.length < 2) continue;
    const id = `mfp-${k.replace(/\|/g, "-").replace(/\./g, "_")}`;
    // The newest row with fiber, sugar or sodium gives the my food's.
    const withExtras = g.rows.filter((x) => Object.keys(extrasOf(x)).length).sort((a, b) => b.date.localeCompare(a.date))[0];
    const ex = withExtras ? extrasOf(withExtras) : {};
    // Only a my food this import made before is filled in; one of the owner's own with the same numbers is theirs.
    const old = byId.get(id);
    const add = old && missingExtras(old, ex);
    if (add) { fillFoods.push({ ...old, ...add }); continue; }
    if (haveFood.has(k) || old) { foodsKnown++; continue; }
    const r = g.rows[0];
    const meal = [...g.byMeal].sort((a, b) => b[1] - a[1] || MEALS.findIndex((m) => m.id === a[0]) - MEALS.findIndex((m) => m.id === b[0]))[0][0];
    const base = `${mealLabel(meal)} ${Math.round(r.kcal).toLocaleString("en-US")} kcal`;
    let name = base;
    for (let n = 2; names.has(name.toLowerCase()); n++) name = `${base} (${n})`;
    names.add(name.toLowerCase());
    const last = g.rows.map((x) => x.date).sort().at(-1);
    newFoods.push({
      id, name, serving: "1 meal", grams: null, kcal: r.kcal, protein: r.protein, fat: r.fat, carbs: r.carbs, ...ex,
      uses: g.rows.length, lastUsed: `${last}T12:00:00.000Z`, createdAt: at,
    });
  }

  const haveDay = new Set(weighIns.map((w) => w.date));
  const newWeighIns = [];
  let weightDaysTaken = 0;
  for (const w of weights) {
    if (w.date > today) { future.push(w.date); continue; }
    if (haveDay.has(w.date)) { weightDaysTaken++; continue; }
    haveDay.add(w.date);
    newWeighIns.push({ date: w.date, kg: w.kg, at });
  }

  const days = [...newEntries.map((e) => e.date), ...newWeighIns.map((w) => w.date)].sort();
  return {
    entries: newEntries, myFoods: newFoods, weighIns: newWeighIns, fillEntries, fillFoods,
    alreadyLogged, foodsKnown, weightDaysTaken, future: future.length,
    from: days[0] ?? null, to: days.at(-1) ?? null,
  };
}

// The fiber, sugar and sodium `from` has that `record` lacks, or null when none.
function missingExtras(record, from) {
  const have = extrasOf(record);
  const add = Object.fromEntries(Object.entries(extrasOf(from)).filter(([id]) => !(id in have)));
  return Object.keys(add).length ? add : null;
}

const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

// The confirm prompt: what will be added and over which dates, then what is left out.
export function mfpConfirmText(plan, { ignored = [], skipped = 0, unit = "lb" } = {}) {
  const adds = [
    plan.entries.length ? plural(plan.entries.length, "meal") + " to the food log" : "",
    plan.myFoods.length ? plural(plan.myFoods.length, "repeated meal") + " to my foods" : "",
    plan.weighIns.length ? plural(plan.weighIns.length, "weigh-in") + (unit === "lb" ? " (read as lb)" : "") : "",
  ].filter(Boolean);
  const fills = [
    plan.fillEntries?.length ? plural(plan.fillEntries.length, "meal") + " in the food log" : "",
    plan.fillFoods?.length ? plural(plan.fillFoods.length, "my food") : "",
  ].filter(Boolean);
  const fillText = fills.length ? `fill in fiber, sugar and sodium on ${fills.join(" and ")} imported before` : "";
  const lines = [
    adds.length
      ? `Add ${adds.join(", ")}${plan.from ? `, from ${plan.from} to ${plan.to}` : ""}${fillText ? `, and ${fillText}` : ""}?`
      : `${fillText[0].toUpperCase()}${fillText.slice(1)}?`,
    plan.alreadyLogged ? `${plural(plan.alreadyLogged, "meal was", "meals were")} imported before and ${plan.alreadyLogged === 1 ? "is" : "are"} left as ${plan.alreadyLogged === 1 ? "it is" : "they are"}.` : "",
    plan.foodsKnown ? `${plural(plan.foodsKnown, "repeated meal is", "repeated meals are")} already in my foods.` : "",
    plan.weightDaysTaken ? `${plural(plan.weightDaysTaken, "day already has", "days already have")} a weigh-in, which ${plan.weightDaysTaken === 1 ? "is" : "are"} kept.` : "",
    plan.future ? `${plural(plan.future, "row")} in the future ${plan.future === 1 ? "is" : "are"} skipped.` : "",
    skipped ? `${plural(skipped, "line")} could not be read and ${skipped === 1 ? "is" : "are"} skipped.` : "",
    ...ignored,
  ].filter(Boolean);
  return lines.join("\n\n");
}

// Whether the plan adds anything at all.
export const planIsEmpty = (plan) => !plan.entries.length && !plan.myFoods.length && !plan.weighIns.length && !plan.fillEntries?.length && !plan.fillFoods?.length;
