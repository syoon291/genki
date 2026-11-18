// Frequently paired foods and the Import My foods file. All data is made up.
import { test } from "node:test";
import assert from "node:assert/strict";
import { pairedFoods, foodLogKey, fromMyFood, fromTableRow, searchFoods, parseMyFoodsFile, planMyFoodsImport } from "../foods.js";

const en = (id, date, meal, name, over = {}) => ({ id, date, meal, name, source: "us", ref: name, amount: 100, unit: "g", base: { kcal: 1, protein: 0.1, fat: 0, carbs: 0.2 }, createdAt: `${date}T08:00:00Z`, ...over });

test("paired foods: logged in the same meal at least twice, most often first", () => {
  const log = [
    en("1", "2026-01-01", "breakfast", "oats"), en("2", "2026-01-01", "breakfast", "milk"), en("3", "2026-01-01", "breakfast", "banana"),
    en("4", "2026-01-02", "breakfast", "oats"), en("5", "2026-01-02", "breakfast", "milk", { amount: 250, createdAt: "2026-01-02T09:00:00Z" }), en("6", "2026-01-02", "breakfast", "berries"),
    en("7", "2026-01-03", "breakfast", "oats"), en("8", "2026-01-03", "breakfast", "berries"),
    en("9", "2026-01-03", "lunch", "banana"), // another meal: not paired with oats
    en("10", "2026-01-04", "breakfast", "oats"), en("11", "2026-01-04", "breakfast", "oats"), // the food itself twice counts nothing
  ];
  const out = pairedFoods(log, "us:oats", []);
  assert.ok(out.every((p) => p.count === 2));
  assert.deepEqual(out.map((p) => p.food.name).sort(), ["berries", "milk"]);
  assert.equal(out.find((p) => p.food.name === "milk").amount, 250); // the latest shared meal's amount
  assert.deepEqual(pairedFoods(log, "us:oats", [], { min: 1 }).map((p) => p.food.name).includes("banana"), true);
  assert.deepEqual(pairedFoods(log, "us:nothing", []), []);
});

test("an add-sheet food's key matches its log entries", () => {
  const t = fromTableRow(["us1", "Oats", 380, 13, 7, 68], "us");
  assert.equal(foodLogKey(t), "us:us1");
  assert.equal(foodLogKey(fromMyFood({ id: "m1", name: "Bowl", kcal: 1, protein: 1 })), "my:m1");
});

const file = (o) => JSON.stringify({ genkiMyFoods: 1, ...o });
const sample = file({
  foods: [
    { name: "Burrito bowl", brand: "Sample Grill", serving: "1 bowl", kcal: 820, protein: 45, carbs: 90, fat: 28 },
    { name: "Iced tea", serving: "1 bottle", grams: 500, kcal: 0, protein: 0 },
    { name: "Broken", kcal: "lots", protein: 1 },
  ],
  meals: [
    { name: "Grill lunch", meal: "lunch", items: [{ food: "Burrito bowl", servings: 1 }, { food: "Iced tea" }, { food: "Missing" }] },
    { name: "Ghost", items: [{ food: "Nope", servings: 1 }] },
  ],
});

test("the My foods file is checked before anything is planned", () => {
  assert.equal(parseMyFoodsFile("{").ok, false);
  assert.match(parseMyFoodsFile(JSON.stringify({ foods: [] })).error, /genkiMyFoods/);
  assert.equal(parseMyFoodsFile(file({ foods: [], meals: [] })).ok, false);
  const p = parseMyFoodsFile(sample);
  assert.equal(p.ok, true);
  assert.deepEqual(p.foods.map((f) => f.name), ["Burrito bowl", "Iced tea"]);
  assert.equal(p.foods[1].serving, "1 bottle");
  assert.equal(p.foods[1].carbs, 0);
  assert.equal(p.foods[0].fiber, null);
  assert.match(p.skipped[0], /Broken/);
  assert.equal(p.meals[0].meal, "lunch");
  assert.equal(p.meals[0].items[1].servings, 1);
});

test("import plan: new foods and meals, items point at the foods, unknown ones left out", () => {
  let n = 0;
  const plan = planMyFoodsImport(parseMyFoodsFile(sample), [], [], { now: new Date("2026-01-05T00:00:00Z"), ids: () => `id${n++}` });
  assert.deepEqual(plan.counts, { newFoods: 2, updatedFoods: 0, newMeals: 1, updatedMeals: 0 });
  const bowl = plan.foods.find((f) => f.name === "Burrito bowl");
  assert.equal(bowl.brand, "Sample Grill");
  const meal = plan.meals[0];
  assert.equal(meal.name, "Grill lunch");
  assert.deepEqual(meal.items.map((i) => [i.name, i.ref, i.amount, i.unit, i.base.kcal]), [["Burrito bowl", bowl.id, 1, "1 bowl", 820], ["Iced tea", plan.foods[1].id, 1, "1 bottle", 0]]);
  assert.ok(plan.skipped.some((s) => /Missing/.test(s)));
  assert.ok(plan.skipped.some((s) => /Ghost/.test(s)));
});

test("a second import updates by name and brand instead of adding twice", () => {
  const existingFoods = [
    { id: "a", name: "burrito bowl", brand: "sample grill", serving: "1 bowl", kcal: 700, protein: 40, carbs: 80, fat: 20, sodium: 900, uses: 5, lastUsed: "2026-01-04T00:00:00Z" },
    { id: "b", name: "Burrito bowl", brand: "Other place", kcal: 600, protein: 30 },
    { id: "r", name: "Iced tea", brand: "", kcal: 5, protein: 0, recipe: { servings: 1, items: [] } },
  ];
  const existingMeals = [{ id: "m", name: "grill lunch", items: [], uses: 2 }];
  const plan = planMyFoodsImport(parseMyFoodsFile(sample), existingFoods, existingMeals, { ids: () => "new" });
  assert.deepEqual(plan.counts, { newFoods: 1, updatedFoods: 1, newMeals: 0, updatedMeals: 1 });
  const bowl = plan.foods.find((f) => f.id === "a");
  assert.equal(bowl.kcal, 820);
  assert.equal(bowl.uses, 5); // use counts survive
  assert.equal(bowl.sodium, 900); // what the file leaves out is kept
  assert.equal(plan.foods.find((f) => f.name === "Iced tea").id, "new"); // a recipe is never overwritten
  assert.equal(plan.meals[0].id, "m");
  assert.equal(plan.meals[0].uses, 2);
});

test("a my food's brand is searchable", () => {
  const f = fromMyFood({ id: "x", name: "Burrito bowl", brand: "Sample Grill", kcal: 820, protein: 45 });
  assert.equal(f.brand, "Sample Grill");
  assert.deepEqual(searchFoods("sample bowl", [[f]]).map((x) => x.id), ["x"]);
});
