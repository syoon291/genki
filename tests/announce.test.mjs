// What screen readers hear after the view changes (the polite live region).
// Every number here is made up.
import { test } from "node:test";
import assert from "node:assert/strict";
import { dayTotalsMessage } from "../nutrition.js";
import { weighInMessage } from "../weight.js";
import { setMessage, sessionSavedMessage } from "../workouts.js";

test("dayTotalsMessage: totals against the targets, rounded", () => {
  assert.equal(
    dayTotalsMessage("Added Test oats to Breakfast.", { kcal: 612.4, protein: 41.6 }, { kcal: 1800, protein: 120 }),
    "Added Test oats to Breakfast. Day total 612 of 1800 kcal, 42 of 120 g protein.",
  );
});

test("dayTotalsMessage: without a profile, only what was eaten", () => {
  assert.equal(dayTotalsMessage("Removed Test toast.", { kcal: 0, protein: 0 }, null), "Removed Test toast. Day total 0 kcal, 0 g protein.");
});

test("weighInMessage: the 7-day average after the change, or none left", () => {
  assert.equal(weighInMessage("Weigh-in saved: 70.2 kg on Jan 5.", 70.46), "Weigh-in saved: 70.2 kg on Jan 5. 7-day average 70.5 kg.");
  assert.equal(weighInMessage("Weigh-in on Jan 5 deleted.", null), "Weigh-in on Jan 5 deleted. No weigh-ins left.");
});

test("setMessage: done with weight, reps and the rest", () => {
  assert.equal(setMessage({ name: "Test press", n: 2, of: 3, done: true, w: "40", reps: "8", unit: "kg", rest: 90 }), "Test press set 2 of 3 done: 40 kg × 8. Rest 1:30.");
});

test("setMessage: bodyweight, no rest, and undone", () => {
  assert.equal(setMessage({ name: "Test squat", n: 1, of: 2, done: true, w: "", reps: "12", unit: "lb", rest: 0 }), "Test squat set 1 of 2 done: 12 reps.");
  assert.equal(setMessage({ name: "Test squat", n: 1, of: 2, done: false, w: "", reps: "12", unit: "lb", rest: 0 }), "Test squat set 1 of 2 marked not done.");
});

test("sessionSavedMessage: sets and new records, singular and plural", () => {
  assert.equal(sessionSavedMessage({ day: "Day A", sets: [{}] }, []), "Session saved: Day A, 1 set, 0 new PRs.");
  assert.equal(sessionSavedMessage({ day: "Day B", sets: [{}, {}] }, [{}]), "Session saved: Day B, 2 sets, 1 new PR.");
});
