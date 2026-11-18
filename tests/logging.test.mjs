// Faster logging: recently logged, serving sizes, my meals, recipes, extra
// nutrients, week days and the share of targets. All data here is made up.
import { test } from "node:test";
import assert from "node:assert/strict";
import { fromTableRow, fromMyFood, fromEntry, recentLogged, servingSizes, makeEntry, extrasOf, itemFromEntry, itemsTotal, mealEntries, recipePerServing, scaleNutrients } from "../foods.js";
import { weekDays, pctOfTargets } from "../nutrition.js";

const egg = fromTableRow(["us1", "Egg, whole, raw, fresh", 143, 12.6, 9.5, 0.7, [["1 large", 50]]], "us");
const bowlRec = { id: "m1", name: "Sample bowl", serving: "1 bowl", grams: 400, kcal: 600, protein: 40, fat: 20, carbs: 60, fiber: 9, sodium: 900 };
const e = (id, over) => ({ id, date: "2026-01-15", meal: "lunch", name: "X", source: "quick", ref: null, amount: 1, unit: "serving", base: { kcal: 100, protein: 5, fat: 1, carbs: 10 }, createdAt: "2026-01-15T10:00:00Z", ...over });

test("extras keep only known, non-negative numbers", () => {
  assert.deepEqual(extrasOf({ fiber: 3, sugar: null, sodium: -1 }), { fiber: 3 });
  assert.deepEqual(extrasOf(undefined), {});
});

test("my foods and entries carry fiber, sugar and sodium when known", () => {
  const f = fromMyFood(bowlRec);
  assert.equal(f.fiber, 9);
  assert.equal(f.sugar, undefined);
  const en = makeEntry(f, f.units[0], 2, { id: "e1", date: "2026-01-15", meal: "lunch" });
  assert.deepEqual(en.base, { kcal: 600, protein: 40, fat: 20, carbs: 60, fiber: 9, sodium: 900 });
  // Table foods have none of them.
  assert.deepEqual(Object.keys(scaleNutrients(egg, 0.5)), ["kcal", "protein", "fat", "carbs"]);
});

test("serving sizes: tables open on 100 g, my foods on their serving", () => {
  assert.deepEqual(servingSizes(egg).map((s) => s.label), ["100 g", "1 g", "1 large (50 g)"]);
  assert.deepEqual(servingSizes(egg, 150).map((s) => [s.label, s.per]), [["150 g", 150], ["100 g", 100], ["1 g", 1], ["1 large (50 g)", 1]]);
  assert.deepEqual(servingSizes(fromMyFood(bowlRec)).map((s) => s.label), ["1 bowl", "100 g", "1 g"]);
  assert.deepEqual(servingSizes(fromMyFood({ id: "q", name: "Bar", kcal: 200, protein: 20 })).map((s) => s.label), ["serving"]);
});

test("a number of servings of a size is stored as amount x unit", () => {
  const sizes = servingSizes(egg);
  const s = sizes[0]; // 100 g
  const en = makeEntry(egg, egg.units[s.unit], 1.5 * s.per, { id: "e", date: "2026-01-15", meal: "breakfast" });
  assert.equal(en.unit, "g");
  assert.equal(en.amount, 150);
  assert.equal(Math.round(en.base.kcal * en.amount), 215);
});

test("recently logged: newest of each food first, any source", () => {
  const list = recentLogged([
    e("a", { name: "Oats", source: "us", ref: "us9", unit: "g", amount: 40, createdAt: "2026-01-13T08:00:00Z" }),
    e("b", { name: "Oats", source: "us", ref: "us9", unit: "g", amount: 60, createdAt: "2026-01-14T08:00:00Z" }),
    e("c", { name: "Sample bowl", source: "my", ref: "m1", unit: "1 bowl", amount: 2, base: { kcal: 1, protein: 1 }, createdAt: "2026-01-12T12:00:00Z" }),
    e("d", { name: "Latte", createdAt: "2026-01-15T07:00:00Z" }),
    e("f", { name: "MyFitnessPal lunch", source: "mfp", unit: "1 meal", createdAt: "2026-01-11T12:00:00Z" }),
  ], [bowlRec]);
  assert.deepEqual(list.map((r) => r.food.name), ["Latte", "Oats", "Sample bowl", "MyFitnessPal lunch"]);
  assert.equal(list[1].amount, 60);
  assert.equal(list[1].unit, "g");
  // A my food that still exists comes back with its current numbers.
  assert.equal(list[2].food.kcal, 600);
  assert.equal(list[2].food.id, "m1");
  assert.equal(list[2].amount, 2);
});

test("a food rebuilt from an entry logs the same thing again", () => {
  const old = e("a", { name: "Oats", source: "us", ref: "us9", unit: "g", amount: 40, base: { kcal: 3.8, protein: 0.13, fat: 0.07, carbs: 0.68, fiber: 0.1 } });
  const f = fromEntry(old);
  const again = makeEntry(f, f.units[0], 40, { id: "n", date: "2026-01-16", meal: "breakfast" });
  assert.equal(again.ref, "us9");
  assert.equal(again.source, "us");
  assert.deepEqual(again.base, old.base);
  // A quick add has no ref.
  assert.equal(makeEntry(fromEntry(e("q")), { label: "serving", factor: 1 }, 1, { id: "m", date: "2026-01-16", meal: "lunch" }).ref, null);
});

test("my meals log every item, times the servings, in order", () => {
  const items = [e("a", { name: "Rice", amount: 150, unit: "g", base: { kcal: 1.5, protein: 0.03, fat: 0, carbs: 0.33 } }), e("b", { name: "Chicken" })].map(itemFromEntry);
  assert.deepEqual(Object.keys(items[0]).sort(), ["amount", "base", "name", "ref", "source", "unit"]);
  let n = 0;
  const out = mealEntries({ items }, { date: "2026-01-20", meal: "dinner", servings: 2, now: new Date("2026-01-20T10:00:00Z"), ids: () => `id${n++}` });
  assert.deepEqual(out.map((x) => [x.id, x.name, x.amount, x.date, x.meal]), [["id0", "Rice", 300, "2026-01-20", "dinner"], ["id1", "Chicken", 2, "2026-01-20", "dinner"]]);
  assert.ok(out[0].createdAt < out[1].createdAt);
  assert.equal(Math.round(itemsTotal(items).kcal), 325);
});

test("a recipe's numbers are the ingredients' total per serving", () => {
  const items = [
    { name: "Lentils", amount: 200, unit: "g", base: { kcal: 1.16, protein: 0.09, fat: 0.004, carbs: 0.2, fiber: 0.08 } },
    { name: "Stock", amount: 1, unit: "1 cup", base: { kcal: 15, protein: 1, fat: 0.5, carbs: 1, sodium: 800 } },
  ];
  assert.deepEqual(recipePerServing(items, 4), { kcal: 62, protein: 4.8, fat: 0.3, carbs: 10.3, fiber: 4, sodium: 200 });
  assert.deepEqual(recipePerServing([], 0), { kcal: 0, protein: 0, fat: 0, carbs: 0 });
});

test("week days run Monday to Sunday around the day", () => {
  const w = weekDays("2026-01-15"); // a Thursday
  assert.equal(w[0], "2026-01-12");
  assert.equal(w[6], "2026-01-18");
  assert.deepEqual(weekDays("2026-01-18"), w);
  assert.equal(weekDays("2026-01-12")[0], "2026-01-12");
});

test("share of today's targets in whole percents", () => {
  const t = { kcal: 2000, protein: 120, macros: { carbs: 200, fat: 60 } };
  assert.deepEqual(pctOfTargets({ kcal: 500, protein: 30, carbs: 50, fat: 21 }, t), { kcal: 25, protein: 25, carbs: 25, fat: 35 });
  assert.equal(pctOfTargets({ kcal: 1 }, null), null);
});
