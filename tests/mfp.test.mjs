// MyFitnessPal export import. Every number here is made up.
import { test } from "node:test";
import assert from "node:assert/strict";
import { parseCsv, detectMfpFile, parseMfpNutrition, parseMfpWeights, planMfpImport, mfpConfirmText, planIsEmpty, entryId, mealFor } from "../mfp.js";

const NUT_HEAD = "Date,Meal,Calories,Fat (g),Saturated Fat,Polyunsaturated Fat,Monounsaturated Fat,Trans Fat,Cholesterol,Sodium (mg),Potassium,Carbohydrates (g),Fiber,Sugar,Protein (g),Vitamin A,Vitamin C,Calcium,Iron,Note";
const row = (date, meal, kcal, fat, carbs, protein, note = "") => `${date},${meal},${kcal},${fat},1,1,1,0,10,100,100,${carbs},3,2,${protein},0,0,0,0,${note}`;
const nutrition = [
  NUT_HEAD,
  row("2026-03-02", "Lunch", 600, 20, 50, 40),
  row("2026-03-02", "Dinner", 800.4, 30, 70, 55),
  row("2026-03-03", "Lunch", 600, 20, 50, 40),
  row("2026-03-03", "Breakfast", 300, 10, 35, 15, '"eggs, toast"'),
  row("2026-03-04", "Dinner", 600, 20, 50, 40),
].join("\n");

test("parseCsv handles quotes, commas inside quotes, CRLF and a BOM", () => {
  const rows = parseCsv('﻿a,b\r\n"x, y","say ""hi"""\r\n\r\n3,4');
  assert.deepEqual(rows.map((r) => r.cells), [["a", "b"], ["x, y", 'say "hi"'], ["3", "4"]]);
  assert.equal(rows[2].line, 4);
});

test("detectMfpFile tells the three export files apart by header", () => {
  assert.equal(detectMfpFile(nutrition), "nutrition");
  assert.equal(detectMfpFile("Date,Weight\n2026-03-02,170.0"), "measurement");
  assert.equal(detectMfpFile("Date,Exercise,Type,Exercise Calories,Exercise Minutes,Sets,Reps Per Set,Pounds,Steps,Note\n"), "exercise");
  assert.equal(detectMfpFile("date,weight_kg\n2026-03-02,70"), null);
  assert.equal(detectMfpFile('{"app":"genki"}'), null);
});

test("nutrition rows keep kcal, protein, carbs and fat per day and meal, oldest first", () => {
  const { rows, skipped } = parseMfpNutrition(nutrition);
  assert.deepEqual(skipped, []);
  assert.equal(rows.length, 5);
  assert.deepEqual(rows[0], { date: "2026-03-02", meal: "lunch", mealName: "Lunch", kcal: 600, protein: 40, carbs: 50, fat: 20 });
  assert.equal(rows[1].kcal, 800.4);
  assert.deepEqual(rows.slice(2, 4).map((r) => r.meal), ["breakfast", "lunch"]);
});

test("nutrition: bad dates and numbers are skipped with their line; empty meals too; two rows for one meal add up", () => {
  const text = [NUT_HEAD, row("2026-13-01", "Lunch", 1, 1, 1, 1), row("2026-03-02", "Lunch", "abc", 1, 1, 1), row("2026-03-02", "Dinner", 0, 0, 0, 0), row("2026-03-05", "Snacks", 100, 1, 10, 5), row("2026-03-05", "Snacks", 50, 1, 5, 5)].join("\n");
  const { rows, skipped } = parseMfpNutrition(text);
  assert.deepEqual(skipped.map((s) => s.line), [2, 3, 4]);
  assert.equal(rows.length, 1);
  assert.deepEqual(rows[0], { date: "2026-03-05", meal: "snacks", mealName: "Snacks", kcal: 150, protein: 10, carbs: 15, fat: 2 });
});

test("custom meal names land in snacks", () => {
  assert.equal(mealFor("Snack"), "snacks");
  assert.equal(mealFor("Pre-workout"), "snacks");
  assert.equal(mealFor("DINNER"), "dinner");
});

test("weights are read as lb unless the header says kg, and blank days are skipped quietly", () => {
  const lb = parseMfpWeights("Date,Weight,Body Fat\n2026-03-02,170.0,\n2026-03-03,,20\n2026-03-04,abc,\n");
  assert.equal(lb.unit, "lb");
  assert.deepEqual(lb.rows, [{ date: "2026-03-02", kg: 77.1 }]);
  assert.deepEqual(lb.skipped.map((s) => s.line), [4]);
  const kg = parseMfpWeights("Date,Weight (kg)\n2026-03-02,70.25\n");
  assert.equal(kg.unit, "kg");
  assert.deepEqual(kg.rows, [{ date: "2026-03-02", kg: 70.3 }]);
});

test("plan: every meal becomes one entry with a fixed id; repeats become one my food named after the meal", () => {
  const { rows } = parseMfpNutrition(nutrition);
  const now = new Date("2026-03-10T09:00:00Z");
  const plan = planMfpImport({ meals: rows, today: "2026-03-10", now });
  assert.equal(plan.entries.length, 5);
  const e = plan.entries[0];
  assert.deepEqual(e, { id: "mfp-2026-03-02-lunch", date: "2026-03-02", meal: "lunch", name: "MyFitnessPal lunch", source: "mfp", ref: null, amount: 1, unit: "1 meal", base: { kcal: 600, protein: 40, fat: 20, carbs: 50 }, createdAt: now.toISOString() });
  assert.equal(entryId(rows[0]), e.id);
  assert.equal(plan.myFoods.length, 1);
  const f = plan.myFoods[0];
  assert.equal(f.name, "Lunch 600 kcal");
  assert.deepEqual([f.kcal, f.protein, f.carbs, f.fat, f.uses, f.serving, f.grams], [600, 40, 50, 20, 3, "1 meal", null]);
  assert.equal(f.lastUsed, "2026-03-04T12:00:00.000Z");
  assert.equal(plan.from, "2026-03-02");
  assert.equal(plan.to, "2026-03-04");
});

test("plan: thousands get a comma; a name already taken gets a number", () => {
  const meals = [1, 2].map((d) => ({ date: `2026-03-0${d}`, meal: "lunch", mealName: "Lunch", kcal: 1163.2, protein: 50, carbs: 100, fat: 40 }));
  const plan = planMfpImport({ meals, today: "2026-03-10", myFoods: [{ id: "x", name: "Lunch 1,163 kcal", kcal: 500, protein: 1, carbs: 1, fat: 1 }] });
  assert.equal(plan.myFoods[0].name, "Lunch 1,163 kcal (2)");
});

test("re-import never duplicates: stored entries, my foods with the same numbers and weighed days are left alone", () => {
  const { rows } = parseMfpNutrition(nutrition);
  const first = planMfpImport({ meals: rows, weights: [{ date: "2026-03-02", kg: 77.1 }], today: "2026-03-10" });
  const again = planMfpImport({ meals: rows, weights: [{ date: "2026-03-02", kg: 77.1 }], entries: first.entries, myFoods: [{ ...first.myFoods[0], id: "renamed", name: "Chicken bowl" }], weighIns: first.weighIns, today: "2026-03-10" });
  assert.ok(planIsEmpty(again));
  assert.equal(again.alreadyLogged, 5);
  assert.equal(again.foodsKnown, 1);
  assert.equal(again.weightDaysTaken, 1);
});

test("weights only fill days with no weigh-in; future days are left out", () => {
  const plan = planMfpImport({
    weights: [{ date: "2026-03-01", kg: 77 }, { date: "2026-03-02", kg: 76.8 }, { date: "2026-03-20", kg: 76 }],
    weighIns: [{ date: "2026-03-02", kg: 76.5, at: "x" }],
    meals: [{ date: "2026-03-21", meal: "lunch", mealName: "Lunch", kcal: 100, protein: 1, carbs: 1, fat: 1 }],
    today: "2026-03-10",
  });
  assert.deepEqual(plan.weighIns.map((w) => [w.date, w.kg]), [["2026-03-01", 77]]);
  assert.equal(plan.weightDaysTaken, 1);
  assert.equal(plan.future, 2);
  assert.equal(plan.entries.length, 0);
});

test("the confirm text lists counts and the date range, then what is left out", () => {
  const { rows } = parseMfpNutrition(nutrition);
  const plan = planMfpImport({ meals: rows, weights: [{ date: "2026-03-01", kg: 77 }], today: "2026-03-10" });
  const text = mfpConfirmText(plan, { ignored: ["Exercise-Summary.csv is left out: genki does not keep exercise calories or steps."], skipped: 2, unit: "lb" });
  const lines = text.split("\n\n");
  assert.equal(lines[0], "Add 5 meals to the food log, 1 repeated meal to my foods, 1 weigh-in (read as lb), from 2026-03-01 to 2026-03-04?");
  assert.match(text, /2 lines could not be read/);
  assert.match(text, /exercise calories or steps/);
});
