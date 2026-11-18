import { test } from "node:test";
import assert from "node:assert/strict";
import { todayCoach, proteinWeek, proteinWeekText, weekCompare, weekCompareLines, biggestWin, mealIdeas, weekWindow } from "../coach.js";

// Made-up data only. 2026-11-19 is a Thursday; its week starts Monday 2026-11-16.
const TODAY = "2026-11-19";
const t = { kcal: 2000, protein: 150, macros: { carbs: 200, fat: 67 } };
const e = (date, kcal, protein, id = `${date}-${kcal}`) => ({ id, date, meal: "lunch", name: "Test food", source: "quick", amount: 1, unit: "serving", base: { kcal, protein, carbs: 0, fat: 0 }, createdAt: `${date}T12:00:00.000Z` });

test("weekWindow: this week up to today, all of last week", () => {
  const w = weekWindow(TODAY);
  assert.deepEqual(w.thisWeek, ["2026-11-16", "2026-11-17", "2026-11-18", "2026-11-19"]);
  assert.equal(w.lastWeek[0], "2026-11-09");
  assert.equal(w.lastWeek[6], "2026-11-15");
});

test("todayCoach covers no profile, nothing logged, over, protein done, protein behind, on track", () => {
  assert.equal(todayCoach({ kcal: 500, protein: 20 }, null), null);
  assert.match(todayCoach({ kcal: 0, protein: 0 }, t).text, /Nothing logged yet today\. You have 2,000 kcal and 150 g protein/);
  const over = todayCoach({ kcal: 2250, protein: 120 }, t);
  assert.equal(over.tone, "warn");
  assert.match(over.text, /^250 kcal over today's target\. Protein still needs 30 g/);
  const done = todayCoach({ kcal: 1500, protein: 152 }, t);
  assert.equal(done.tone, "good");
  assert.match(done.text, /Protein target reached, with 500 kcal left/);
  const behind = todayCoach({ kcal: 1200, protein: 45 }, t);
  assert.match(behind.text, /^Protein is behind: 30\u00a0% of the target with 60\u00a0% of calories eaten/);
  assert.equal(behind.kcalLeft, 800);
  assert.equal(behind.proteinLeft, 105);
  assert.match(todayCoach({ kcal: 1000, protein: 70 }, t).text, /^On track: 1,000 kcal and 80 g protein left today\./);
});

test("proteinWeek counts this week's logged days that reach the target", () => {
  const entries = [e("2026-11-16", 1800, 150), e("2026-11-17", 1900, 120), e("2026-11-19", 1000, 160), e("2026-11-12", 2000, 200)];
  const p = proteinWeek(entries, t, TODAY);
  assert.deepEqual({ logged: p.logged, hit: p.hit, target: p.target }, { logged: 3, hit: 2, target: 150 });
  assert.equal(Math.round(p.avg), 143);
  assert.equal(proteinWeekText(p), "Target hit on 2 of 3 logged days; 143 g a day on average against 150 g.");
  assert.equal(proteinWeek(entries, null, TODAY), null);
  assert.equal(proteinWeek([], t, TODAY), null);
});

test("weekCompare and its lines: averages over logged days, weight 7-day average a week apart", () => {
  const entries = [e("2026-11-16", 1800, 140), e("2026-11-18", 2000, 160), e("2026-11-10", 2200, 120), e("2026-11-11", 2200, 120)];
  const weighIns = [{ date: "2026-11-12", kg: 80 }, { date: "2026-11-19", kg: 79.4 }];
  const c = weekCompare(entries, weighIns, TODAY);
  assert.deepEqual(c.kcal, { now: 1900, prev: 2200 });
  assert.deepEqual(c.protein, { now: 150, prev: 120 });
  const lines = weekCompareLines(c);
  assert.deepEqual(lines.map((l) => l.label), ["Calories", "Protein", "Weight"]);
  assert.equal(lines[0].text, "1,900 kcal a day, 300 kcal less than last week.");
  assert.equal(lines[1].text, "150 g a day, 30 g more than last week.");
  assert.match(lines[2].text, /^7-day average 79\.4 kg, down 0\.6 kg \(1\.3 lb\) since a week ago\.$/);
  // Nothing last week: no comparison clause; nothing this week: no lines.
  assert.equal(weekCompareLines(weekCompare([e("2026-11-16", 1800, 140)], [], TODAY))[0].text, "1,800 kcal a day.");
  assert.deepEqual(weekCompareLines(weekCompare([], [], TODAY)), []);
});

test("biggestWin picks the strongest win of the week, or null", () => {
  assert.equal(biggestWin({ today: TODAY }), null);
  const logging = [e("2026-11-16", 2500, 50), e("2026-11-17", 2500, 50), e("2026-11-18", 2500, 50)];
  assert.deepEqual(biggestWin({ entries: logging, t, today: TODAY }), { kind: "logging", text: "Food logged on 3 days." });
  const protein = [e("2026-11-16", 1900, 155), e("2026-11-17", 1950, 150), e("2026-11-18", 1800, 160)];
  assert.equal(biggestWin({ entries: protein, t, today: TODAY }).text, "Protein target hit on 3 days.");
  // Weight toward a loss goal beats protein days.
  const weighIns = [{ date: "2026-11-12", kg: 80 }, { date: "2026-11-19", kg: 79.5 }];
  const w = biggestWin({ entries: protein, weighIns, t, goalKg: 72, weightKg: 79.5, today: TODAY });
  assert.equal(w.kind, "weight");
  assert.match(w.text, /moved 0\.5 kg \(1\.1 lb\) toward your goal/);
  // Moving away from the goal is no win.
  assert.equal(biggestWin({ weighIns, goalKg: 90, weightKg: 79.5, today: TODAY }), null);
  // A lift record this week beats everything.
  const sessions = [
    { id: "s1", date: "2026-11-10T18:00:00", sets: [{ exId: "back-squat", w: 100, reps: 5, rir: 2 }] },
    { id: "s2", date: "2026-11-18T18:00:00", sets: [{ exId: "back-squat", w: 105, reps: 5, rir: 2 }] },
  ];
  assert.deepEqual(biggestWin({ entries: protein, weighIns, sessions, t, goalKg: 72, weightKg: 79.5, today: TODAY }), { kind: "records", text: "A new lift record on Back squat." });
  const water = [{ date: "2026-11-16", water: 8 }, { date: "2026-11-17", water: 9 }, { date: "2026-11-19", water: 8 }, { date: "2026-11-12", water: 8 }];
  assert.equal(biggestWin({ days: water, today: TODAY }).text, "Water goal reached on 3 days.");
});

test("mealIdeas: fits the calories left, favors protein per calorie, then use", () => {
  const foods = [
    { id: "f1", name: "Greek yogurt", kcal: 150, protein: 20, uses: 3 },
    { id: "f2", name: "Cookie", kcal: 250, protein: 3, uses: 10 },
    { id: "f3", name: "Big burrito", kcal: 900, protein: 45 },
    { id: "f4", name: "Chicken breast", kcal: 200, protein: 40 },
  ];
  const meals = [{ id: "m1", name: "Rice bowl", uses: 1, items: [{ amount: 1, base: { kcal: 450, protein: 35, carbs: 50, fat: 8 } }] }];
  const ideas = mealIdeas(foods, meals, { kcal: 600, protein: 60 });
  assert.deepEqual(ideas.map((x) => x.name), ["Chicken breast", "Rice bowl", "Greek yogurt"]);
  assert.deepEqual(ideas[1], { kind: "meal", id: "m1", name: "Rice bowl", kcal: 450, protein: 35, after: 150 });
  assert.ok(!mealIdeas(foods, meals, { kcal: 600, protein: 60 }, 10).some((x) => x.name === "Big burrito"));
  // Protein done: the most used that fit come first.
  assert.equal(mealIdeas(foods, [], { kcal: 300, protein: 0 })[0].name, "Cookie");
  assert.deepEqual(mealIdeas(foods, meals, { kcal: 40, protein: 30 }), []);
  assert.deepEqual(mealIdeas([], [], { kcal: 800, protein: 30 }), []);
});
