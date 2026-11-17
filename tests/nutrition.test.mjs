// Targets maths. Every profile here is made up.
import { test } from "node:test";
import assert from "node:assert/strict";
import { bmr, targets, projection, profileProblems, ageFrom, kgToLb, dayKey, shiftDay, sumEntries, byMeal, entryNutrients, mealForHour, KCAL_FLOOR, DEFAULT_DEFICIT } from "../nutrition.js";

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
