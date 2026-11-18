// Day trackers: fasting plan and timer, streak, water and exercise. Every number here is made up.
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  protocolLabel, normalPlan, plannedWindow, runningFast, fastStatus, fmtDuration, fmtClock, fastHistory, fastStreak,
  fastTimesProblem, dayRecord, waterGoalOf, addWater, exerciseProblem, netCalories, waterMessage, fastMessage, exerciseMessage,
} from "../trackers.js";
import { parseMfpExercise, planMfpImport, mfpConfirmText, planIsEmpty, detectMfpFile } from "../mfp.js";

const H = 3600_000;
const local = (y, mo, d, h = 0, mi = 0) => new Date(y, mo - 1, d, h, mi);
const fast = (id, start, hours, goalHours = 16) => ({ id, start: start.toISOString(), end: hours === null ? null : new Date(start.getTime() + hours * H).toISOString(), goalHours });

test("protocolLabel: the standard plans by name, others in hours", () => {
  assert.equal(protocolLabel(16), "16:8");
  assert.equal(protocolLabel(12), "12:12");
  assert.equal(protocolLabel(18), "18 h");
});

test("normalPlan: bad values fall back to 16 h from 20:00", () => {
  assert.deepEqual(normalPlan(null), { hours: 16, startTime: "20:00" });
  assert.deepEqual(normalPlan({ hours: 0, startTime: "25:00" }), { hours: 16, startTime: "20:00" });
  assert.deepEqual(normalPlan({ hours: 14, startTime: "19:30" }), { hours: 14, startTime: "19:30" });
});

test("plannedWindow: today's start until its end has passed, then tomorrow's", () => {
  const plan = { hours: 16, startTime: "20:00" };
  // Afternoon: today's fast is still ahead.
  let w = plannedWindow(plan, local(2026, 3, 10, 15));
  assert.deepEqual([w.start, w.end], [local(2026, 3, 10, 20), local(2026, 3, 11, 12)]);
  // Early morning: last night's window is still running.
  w = plannedWindow(plan, local(2026, 3, 10, 7));
  assert.deepEqual([w.start, w.end], [local(2026, 3, 9, 20), local(2026, 3, 10, 12)]);
  // After the window ends at noon, the next one is tonight.
  w = plannedWindow(plan, local(2026, 3, 10, 12, 30));
  assert.deepEqual(w.start, local(2026, 3, 10, 20));
});

test("runningFast: the newest fast without an end", () => {
  const a = fast("a", local(2026, 3, 1, 20), 16), b = fast("b", local(2026, 3, 2, 20), null), c = fast("c", local(2026, 3, 3, 20), null);
  assert.equal(runningFast([a, b, c]).id, "c");
  assert.equal(runningFast([a]), null);
});

test("fastStatus: elapsed, share of the goal and when it is reached", () => {
  const f = fast("a", local(2026, 3, 1, 20), null, 16);
  const s = fastStatus(f, local(2026, 3, 2, 4));
  assert.equal(s.elapsed, 8 * H);
  assert.equal(s.pct, 0.5);
  assert.equal(s.reached, false);
  assert.deepEqual(s.goalAt, local(2026, 3, 2, 12));
  assert.equal(s.left, 8 * H);
  const done = fastStatus(fast("b", local(2026, 3, 1, 20), 17, 16));
  assert.equal(done.reached, true);
  assert.equal(done.pct, 1);
});

test("fmtDuration and fmtClock", () => {
  assert.equal(fmtDuration(16 * H + 5 * 60_000), "16 h 05 min");
  assert.equal(fmtDuration(45 * 60_000), "45 min");
  assert.equal(fmtClock(14 * H + 5 * 60_000 + 9000), "14:05:09");
});

test("fastStreak: consecutive days with a fast that reached its goal", () => {
  const today = "2026-03-10";
  const list = [
    fast("a", local(2026, 3, 7, 20), 16), // ends Mar 8
    fast("b", local(2026, 3, 8, 20), 16), // ends Mar 9
    fast("c", local(2026, 3, 9, 20), 16.5), // ends Mar 10
  ];
  assert.equal(fastStreak(list, today), 3);
  // No fast ended today yet: the streak through yesterday still counts.
  assert.equal(fastStreak(list.slice(0, 2), today), 2);
  // A short fast breaks it.
  assert.equal(fastStreak([list[0], fast("b", local(2026, 3, 8, 20), 10), list[2]], today), 1);
  // A running fast does not count.
  assert.equal(fastStreak([fast("r", local(2026, 3, 9, 20), null)], today), 0);
  assert.deepEqual(fastHistory(list).map((f) => f.id), ["c", "b", "a"]);
});

test("fastTimesProblem: start before end, nothing in the future, at most 7 days", () => {
  const now = local(2026, 3, 10, 12);
  assert.equal(fastTimesProblem(local(2026, 3, 9, 20), local(2026, 3, 10, 12), now), "");
  assert.equal(fastTimesProblem(local(2026, 3, 9, 20), null, now), "");
  assert.match(fastTimesProblem(local(2026, 3, 10, 13), null, now), /future/);
  assert.match(fastTimesProblem(local(2026, 3, 10, 10), local(2026, 3, 10, 9), now), /after the start/);
  assert.match(fastTimesProblem(local(2026, 3, 1, 10), local(2026, 3, 9, 10), now), /7 days/);
  assert.match(fastTimesProblem(new Date(NaN), null, now), /started/);
});

test("dayRecord and water: defaults, limits and the goal", () => {
  assert.deepEqual(dayRecord("2026-03-10", undefined), { date: "2026-03-10", water: 0, exerciseKcal: null, steps: null });
  const r = dayRecord("2026-03-10", { water: 3, exerciseKcal: 250, steps: 6000, exerciseSource: "mfp" });
  assert.equal(r.exerciseSource, "mfp");
  assert.equal(addWater(r, 1).water, 4);
  assert.equal(addWater({ ...r, water: 0 }, -1).water, 0);
  assert.equal(addWater({ ...r, water: 40 }, 1).water, 40);
  assert.equal(waterGoalOf(undefined), 8);
  assert.equal(waterGoalOf(10), 10);
  assert.equal(waterGoalOf(0), 8);
});

test("exerciseProblem and netCalories", () => {
  assert.equal(exerciseProblem("300", "8000"), "");
  assert.equal(exerciseProblem("", ""), "");
  assert.match(exerciseProblem("-5", ""), /Calories burned/);
  assert.match(exerciseProblem("", "12.5"), /whole number/);
  assert.match(exerciseProblem("", "300000"), /Steps/);
  assert.equal(netCalories(1800, 300), 1500);
  assert.equal(netCalories(1800, null), 1800);
});

test("announcements for water, fasts and exercise", () => {
  assert.equal(waterMessage(5, 8), "Water 5 of 8 glasses.");
  assert.equal(waterMessage(8, 8), "Water 8 of 8 glasses, goal reached.");
  const f = fast("a", local(2026, 3, 1, 20), 16.25, 16);
  assert.equal(fastMessage("Fast ended:", f), "Fast ended: 16 h 15 min of 16 h, goal reached.");
  assert.equal(exerciseMessage("Tue, Mar 10", { exerciseKcal: 300, steps: 8000 }, 1800), "Exercise saved for Tue, Mar 10: 300 kcal burned, 8000 steps, net 1500 kcal.");
  assert.equal(exerciseMessage("Tue, Mar 10", { exerciseKcal: null, steps: null }, 0), "Exercise cleared for Tue, Mar 10.");
});

// ---------- MyFitnessPal Exercise-Summary ----------

const EXERCISE_CSV = [
  "Date,Exercise,Type,Exercise Calories,Exercise Minutes,Sets,Reps Per Set,Pounds,Steps,Note",
  "2026-03-01,Walking,Cardio,120,30,,,,,",
  "2026-03-01,Phone steps,Cardio,80,,,,,4500,",
  "2026-03-02,Phone steps,Cardio,,,,,,\"7,200\",",
  "2026-03-03,Cycling,Cardio,abc,20,,,,,",
  "nope,Walking,Cardio,50,10,,,,,",
  "2099-01-01,Walking,Cardio,50,10,,,,,",
].join("\n");

test("parseMfpExercise: calories and steps added up per day", () => {
  assert.equal(detectMfpFile(EXERCISE_CSV), "exercise");
  const { rows, skipped } = parseMfpExercise(EXERCISE_CSV);
  assert.deepEqual(rows, [
    { date: "2026-03-01", kcal: 200, steps: 4500 },
    { date: "2026-03-02", kcal: null, steps: 7200 },
    { date: "2099-01-01", kcal: 50, steps: null },
  ]);
  assert.equal(skipped.length, 2);
});

test("planMfpImport: exercise fills only days with none logged, keeping water", () => {
  const { rows } = parseMfpExercise(EXERCISE_CSV);
  const days = [
    { date: "2026-03-01", water: 4, exerciseKcal: null, steps: null },
    { date: "2026-03-02", water: 2, exerciseKcal: 150, steps: null },
  ];
  const plan = planMfpImport({ exercise: rows, days, today: "2026-03-10", now: new Date("2026-03-10T12:00:00Z") });
  assert.deepEqual(plan.days, [{ date: "2026-03-01", water: 4, exerciseKcal: 200, steps: 4500, exerciseSource: "mfp" }]);
  assert.equal(plan.exerciseDaysTaken, 1);
  assert.equal(plan.future, 1);
  assert.equal(planIsEmpty(plan), false);
  const text = mfpConfirmText(plan);
  assert.match(text, /exercise on 1 day/);
  assert.match(text, /1 day already has exercise logged/);
  // Importing again adds nothing.
  const again = planMfpImport({ exercise: rows, days: [...days.slice(1), ...plan.days], today: "2026-03-10" });
  assert.equal(again.days.length, 0);
  assert.equal(planIsEmpty(again), true);
});

test("nextWindow: a fast already done tonight moves the window to tomorrow", async () => {
  const { nextWindow } = await import("../trackers.js");
  const plan = { hours: 14, startTime: "19:00" };
  const now = local(2026, 3, 10, 22, 30);
  assert.deepEqual(nextWindow(plan, [], now).start, local(2026, 3, 10, 19));
  const done = fast("a", local(2026, 3, 10, 7, 20), 15, 14); // ends 22:20, after the 19:00 start
  assert.deepEqual(nextWindow(plan, [done], now).start, local(2026, 3, 11, 19));
  const earlier = fast("b", local(2026, 3, 9, 19), 14, 14); // ended this morning
  assert.deepEqual(nextWindow(plan, [earlier], now).start, local(2026, 3, 10, 19));
});
