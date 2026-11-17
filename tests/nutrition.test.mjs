// Targets maths. Every profile here is made up.
import { test } from "node:test";
import assert from "node:assert/strict";
import { bmr, targets, projection, profileProblems, ageFrom, kgToLb, dayKey, shiftDay, sumEntries, byMeal, entryNutrients, mealForHour, KCAL_FLOOR, DEFAULT_DEFICIT, gramsFromPct, pctFromGrams } from "../nutrition.js";

const TODAY = new Date(2026, 0, 15); // 15 Jan 2026, local time
const man = { sex: "male", birthYear: 1996, heightCm: 180, weightKg: 80, activity: "moderate", goalKg: 75, targetDate: "2026-06-30", deficit: 500, proteinPerKg: 1.8 };
const woman = { sex: "female", birthYear: 1986, heightCm: 160, weightKg: 55, activity: "sedentary", goalKg: 52, targetDate: null, deficit: 500, proteinPerKg: 2.0 };

test("Mifflin-St Jeor resting energy for men and women", () => {
  assert.equal(bmr({ sex: "male", weightKg: 80, heightCm: 180, age: 30 }), 1780);
  assert.equal(bmr({ sex: "female", weightKg: 55, heightCm: 160, age: 40 }), 1189);
});

test("age comes from the year of birth", () => {
  assert.equal(ageFrom(1996, TODAY), 30);
});

test("calorie target is maintenance minus the deficit, rounded to 10", () => {
  const t = targets(man, TODAY);
  assert.equal(t.bmr, 1780);
  assert.equal(t.tdee, 2759); // 1780 x 1.55
  assert.equal(t.kcal, 2260); // 2759 - 500 = 2259, rounded
  assert.equal(t.deficit, 499);
  assert.equal(t.floored, false);
});

test("a zero deficit gives maintenance", () => {
  const t = targets({ ...man, deficit: 0 }, TODAY);
  assert.equal(t.kcal, 2760);
  assert.equal(t.deficit, 0);
});

test("the target never drops below the floor, and reports the real deficit", () => {
  const t = targets(woman, TODAY); // maintenance 1427, minus 500 = 927
  assert.equal(t.kcal, KCAL_FLOOR.female);
  assert.equal(t.floored, true);
  assert.equal(t.deficit, 1427 - 1200);
  const m = targets({ ...man, weightKg: 50, heightCm: 150, activity: "sedentary", deficit: 1000 }, TODAY);
  assert.equal(m.kcal, KCAL_FLOOR.male);
  assert.equal(m.floored, true);
});

test("protein target is grams per kg of body weight", () => {
  assert.equal(targets(man, TODAY).protein, 144); // 80 x 1.8
  assert.equal(targets(woman, TODAY).protein, 110); // 55 x 2.0
});

test("projection: days to the goal at the target's deficit, against the target date", () => {
  const t = targets(man, TODAY);
  const p = projection(man, t, TODAY);
  assert.equal(p.kgToGo, 5);
  assert.equal(p.days, Math.ceil((5 * 7700) / 499)); // 78
  assert.equal(p.date, "2026-04-03");
  assert.equal(p.onTrack, true);
  assert.equal(projection({ ...man, targetDate: "2026-02-01" }, t, TODAY).onTrack, false);
  assert.equal(projection(woman, targets(woman, TODAY), TODAY).onTrack, null);
});

test("no projection without a goal below the current weight or without a deficit", () => {
  const t = targets(man, TODAY);
  assert.equal(projection({ ...man, goalKg: null }, t, TODAY), null);
  assert.equal(projection({ ...man, goalKg: 85 }, t, TODAY), null);
  assert.equal(projection({ ...man, deficit: 0 }, targets({ ...man, deficit: 0 }, TODAY), TODAY), null);
});

test("profile problems name each missing or out-of-range field", () => {
  assert.deepEqual(profileProblems(man, TODAY), []);
  assert.deepEqual(profileProblems({ ...man, goalKg: null, targetDate: null }, TODAY), []);
  assert.match(profileProblems({ ...man, sex: null }, TODAY)[0], /sex/i);
  assert.match(profileProblems({ ...man, birthYear: 2015 }, TODAY)[0], /18 to 100/);
  assert.match(profileProblems({ ...man, heightCm: 90 }, TODAY)[0], /Height/);
  assert.match(profileProblems({ ...man, weightKg: null }, TODAY)[0], /Weight/);
  assert.match(profileProblems({ ...man, activity: "couch" }, TODAY)[0], /activity/i);
  assert.match(profileProblems({ ...man, deficit: 1500 }, TODAY)[0], /deficit/i);
  assert.match(profileProblems({ ...man, proteinPerKg: 3 }, TODAY)[0], /Protein/);
  assert.match(profileProblems({ ...man, targetDate: "soon" }, TODAY)[0], /date/);
});

test("the default deficit is 500 kcal", () => {
  assert.equal(DEFAULT_DEFICIT, 500);
});

test("kg to lb", () => {
  assert.equal(Math.round(kgToLb(80) * 10) / 10, 176.4);
});

test("day keys are local dates and shift across months and years", () => {
  assert.equal(dayKey(TODAY), "2026-01-15");
  assert.equal(shiftDay("2026-03-01", -1), "2026-02-28");
  assert.equal(shiftDay("2025-12-31", 1), "2026-01-01");
});

const entry = (meal, kcal, protein, amount = 1, extra = {}) => ({ id: `${meal}${kcal}`, meal, amount, base: { kcal, protein, fat: 1, carbs: 2 }, ...extra });

test("entry nutrients scale by amount; totals add up", () => {
  assert.deepEqual(entryNutrients(entry("lunch", 1.65, 0.31, 150)), { kcal: 1.65 * 150, protein: 0.31 * 150, fat: 150, carbs: 300 });
  const t = sumEntries([entry("lunch", 200, 20), entry("dinner", 300, 10, 2)]);
  assert.deepEqual(t, { kcal: 800, protein: 40, fat: 3, carbs: 6 });
  assert.deepEqual(sumEntries([]), { kcal: 0, protein: 0, fat: 0, carbs: 0 });
});

test("entries group by meal in order, unknown meals go to snacks", () => {
  const g = byMeal([
    entry("dinner", 300, 10, 1, { createdAt: "2026-01-15T12:00:00Z" }),
    entry("dinner", 100, 5, 1, { createdAt: "2026-01-15T11:00:00Z" }),
    entry("elevenses", 50, 1),
  ]);
  assert.deepEqual(Object.keys(g), ["breakfast", "lunch", "dinner", "snacks"]);
  assert.deepEqual(g.dinner.entries.map((e) => e.base.kcal), [100, 300]);
  assert.equal(g.dinner.totals.kcal, 400);
  assert.equal(g.snacks.entries.length, 1);
  assert.equal(g.breakfast.totals.kcal, 0);
});

test("meal suggestion by hour", () => {
  assert.equal(mealForHour(7), "breakfast");
  assert.equal(mealForHour(12), "lunch");
  assert.equal(mealForHour(16), "snacks");
  assert.equal(mealForHour(19), "dinner");
  assert.equal(mealForHour(23), "snacks");
});

// ---------- carbs and fat ----------

test("percent and grams convert both ways at 4 / 4 / 9 kcal per gram", () => {
  assert.equal(gramsFromPct(2000, 50, "carbs"), 250);
  assert.equal(gramsFromPct(2000, 30, "fat"), 2000 * 0.3 / 9);
  assert.equal(pctFromGrams(2000, 250, "carbs"), 50);
  assert.equal(pctFromGrams(1800, 60, "fat"), 30);
  assert.equal(pctFromGrams(2000, 150, "protein"), 30);
  assert.equal(pctFromGrams(0, 100, "carbs"), 0);
  assert.equal(gramsFromPct(0, 50, "carbs"), 0);
  // Round trip.
  assert.ok(Math.abs(pctFromGrams(2350, gramsFromPct(2350, 27, "fat"), "fat") - 27) < 1e-9);
});

test("default macros: fat 30 %, carbs the rest after protein", () => {
  const m = targets(man, TODAY).macros; // 2260 kcal, 144 g protein = 25.5 %
  assert.equal(m.mode, "auto");
  assert.equal(m.fat, Math.round(2260 * 0.3 / 9)); // 75
  // Carbs fill what is left: 2260 - 678 (fat) - 576 (protein) = 1006 kcal, about 251.5 g.
  assert.ok(Math.abs(m.carbs - 1006 / 4) <= 0.5);
  assert.equal(m.fatPct, 30);
  assert.equal(m.proteinPct, 25);
  assert.ok(Math.abs(m.totalPct - 100) <= 1);
});

test("percent mode: grams follow the calorie target", () => {
  const p = { ...man, macroMode: "pct", carbPct: 50, fatPct: 30 };
  const a = targets(p, TODAY).macros;
  assert.equal(a.carbs, Math.round(2260 * 0.5 / 4)); // 283 (282.5 rounds up)
  assert.equal(a.fat, Math.round(2260 * 0.3 / 9));
  assert.equal(a.carbPct, 50);
  // A bigger deficit lowers the calorie target, and the grams with it.
  const b = targets({ ...p, deficit: 800 }, TODAY);
  assert.equal(b.macros.carbs, Math.round(b.kcal * 0.5 / 4));
  assert.ok(b.macros.carbs < a.carbs);
  assert.equal(b.macros.carbPct, 50);
});

test("grams mode: grams stay put and the percents follow", () => {
  const p = { ...man, macroMode: "g", carbG: 200, fatG: 70 };
  const a = targets(p, TODAY).macros;
  assert.equal(a.carbs, 200);
  assert.equal(a.fat, 70);
  assert.equal(a.carbPct, Math.round(800 / 2260 * 100)); // 35
  assert.equal(a.fatPct, Math.round(630 / 2260 * 100)); // 28
  const b = targets({ ...p, deficit: 800 }, TODAY).macros;
  assert.equal(b.carbs, 200);
  assert.ok(b.carbPct > a.carbPct);
});

test("totalPct shows when protein, carbs and fat do not add up to the calories", () => {
  assert.equal(targets({ ...man, macroMode: "pct", carbPct: 50, fatPct: 30 }, TODAY).macros.totalPct, 105);
});

test("macro settings are validated", () => {
  const ok = (extra) => profileProblems({ ...man, ...extra }, TODAY);
  assert.deepEqual(ok({}), []);
  assert.deepEqual(ok({ macroMode: null }), []);
  assert.deepEqual(ok({ macroMode: "pct", carbPct: 40, fatPct: 30 }), []);
  assert.deepEqual(ok({ macroMode: "g", carbG: 150, fatG: 60 }), []);
  assert.match(ok({ macroMode: "pct", carbPct: 80, fatPct: 30 })[0], /more than 100/);
  assert.match(ok({ macroMode: "pct", carbPct: null, fatPct: 30 })[0], /Carbs/);
  assert.match(ok({ macroMode: "g", carbG: 150, fatG: 500 })[0], /Fat must be between 0 and 400/);
  assert.match(ok({ macroMode: "other" })[0], /Pick how/);
});
