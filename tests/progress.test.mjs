import { test } from "node:test";
import assert from "node:assert/strict";
import { weekTotals, weekAverages, macroSplit, topFoods, weekCsv, weekCsvName, weekMessage } from "../progress.js";

// Made-up entries: base nutrients per unit, amount units eaten.
const e = (id, date, name, base, amount = 1, extra = {}) => ({ id, date, meal: "lunch", name, source: "my", ref: name, amount, unit: "serving", base, createdAt: `${date}T12:00:00.000Z`, ...extra });
const rice = { kcal: 200, protein: 4, carbs: 45, fat: 0.5 };
const chicken = { kcal: 165, protein: 31, carbs: 0, fat: 3.6, fiber: 0 };
const oats = { kcal: 150, protein: 5, carbs: 27, fat: 3, fiber: 4 };

// 2026-11-16 is a Monday.
const entries = [
  e("a", "2026-11-16", "Rice", rice, 2),
  e("b", "2026-11-16", "Chicken", chicken),
  e("c", "2026-11-18", "Oats", oats),
  e("d", "2026-11-18", "Rice", rice),
  e("m1", "2026-11-17", "MyFitnessPal dinner", { kcal: 700, protein: 30, carbs: 80, fat: 25 }, 1, { source: "mfp", ref: null, unit: "meal" }),
  e("m2", "2026-11-19", "MyFitnessPal dinner", { kcal: 650, protein: 28, carbs: 70, fat: 22 }, 1, { source: "mfp", ref: null, unit: "meal" }),
  e("x", "2026-11-23", "Rice", rice, 5), // next week
];

test("weekTotals gives seven days Monday first, with totals only on logged days", () => {
  const wk = weekTotals(entries, "2026-11-19");
  assert.deepEqual(wk.map((d) => d.date), ["2026-11-16", "2026-11-17", "2026-11-18", "2026-11-19", "2026-11-20", "2026-11-21", "2026-11-22"]);
  assert.deepEqual(wk.map((d) => d.logged), [true, true, true, true, false, false, false]);
  assert.equal(wk[0].n.kcal, 565);
  assert.equal(wk[0].n.fiber, 0);
  assert.equal(wk[1].n.fiber, undefined);
  assert.equal(wk[4].n, null);
});

test("weekAverages averages over logged days; extras over the days that have them", () => {
  const avg = weekAverages(weekTotals(entries, "2026-11-16"));
  assert.equal(avg.days, 4);
  assert.equal(avg.kcal, (565 + 700 + 350 + 650) / 4);
  assert.deepEqual(avg.extras.fiber, { avg: 2, days: 2 });
  assert.equal(avg.extras.sodium, undefined);
  assert.equal(weekAverages(weekTotals([], "2026-11-16")), null);
});

test("macroSplit shares calories and always adds up to 100", () => {
  assert.deepEqual(macroSplit({ carbs: 50, fat: 0, protein: 50 }), { carbs: 50, fat: 0, protein: 50 });
  const s = macroSplit({ carbs: 33.3, fat: 14.8, protein: 33.3 });
  assert.equal(s.carbs + s.fat + s.protein, 100);
  assert.deepEqual(macroSplit({ carbs: 0, fat: 0, protein: 0 }), { carbs: 0, fat: 0, protein: 0 });
});

test("topFoods groups named foods across the week and keeps imported meal totals apart", () => {
  const days = weekTotals([], "2026-11-16").map((d) => d.date);
  const top = topFoods(entries, days, "carbs");
  assert.deepEqual(top.map((t) => [t.name, t.date, t.times]), [
    ["Rice", null, 2],
    ["MyFitnessPal dinner", "2026-11-17", 1],
    ["MyFitnessPal dinner", "2026-11-19", 1],
    ["Oats", null, 1],
  ]);
  assert.equal(top[0].grams, 135); // 2 x 45 + 45, next week's rice left out
  assert.equal(top[0].pct, Math.round((135 / (135 + 80 + 70 + 27)) * 100));
  assert.deepEqual(topFoods(entries, days, "protein", 1).map((t) => t.name), ["Chicken"]);
});

test("weekCsv has a header and one row a day, blanks for days not logged", () => {
  const wk = weekTotals(entries, "2026-11-16");
  const lines = weekCsv(wk).trim().split("\n");
  assert.equal(lines[0], "date,kcal,protein_g,carbs_g,fat_g,fiber_g");
  assert.equal(lines.length, 8);
  assert.equal(lines[1], "2026-11-16,565,39,90,4.6,0");
  assert.equal(lines[2], "2026-11-17,700,30,80,25,");
  assert.equal(lines[5], "2026-11-20,,,,,");
  assert.equal(weekCsvName(wk), "genki-week-2026-11-16.csv");
});

test("weekMessage says the week and its average", () => {
  assert.equal(weekMessage("Last week", null), "Last week. Nothing logged.");
  assert.equal(weekMessage("This week", { kcal: 1834.6, days: 1 }), "This week. 1835 kcal a day on average over 1 logged day.");
});
