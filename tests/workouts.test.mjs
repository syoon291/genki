// Workout maths (ported from Liftlog) and the Liftlog migration. Every lift here is made up.
import { test } from "node:test";
import assert from "node:assert/strict";
import * as L from "../workouts.js";

const DAY = L.DAY;
const T0 = Date.UTC(2026, 0, 5, 9); // a Monday
const at = (days) => new Date(T0 + days * DAY).toISOString();
const sess = (id, days, sets, extra = {}) => ({ id, date: at(days), day: "Day", sets, ...extra });
const set = (exId, w, reps, rir = 2) => ({ exId, w, reps, rir });
const slot = { sets: 3, lo: 6, hi: 10, rir: 2, rest: 120 };

test("generatePlan builds one day per training day from the library", () => {
  for (const days of [2, 3, 4, 5, 6]) {
    const p = L.generatePlan({ days, equip: "gym" });
    assert.equal(p.schedule.length, days);
    for (const d of p.schedule) {
      assert.ok(d.slots.length >= 5);
      for (const s of d.slots) assert.ok(L.BY_ID[s.exId], s.exId);
      // No exercise twice in one day.
      assert.equal(new Set(d.slots.map((s) => s.exId)).size, d.slots.length);
    }
  }
  // Out-of-range day counts are clamped.
  assert.equal(L.generatePlan({ days: 9 }).schedule.length, 6);
  assert.equal(L.generatePlan({ days: 1 }).schedule.length, 2);
});

test("bodyweight plans use only bodyweight exercises, with higher rep ranges", () => {
  const p = L.generatePlan({ days: 3, equip: "bw" });
  for (const s of p.schedule.flatMap((d) => d.slots)) {
    assert.ok(L.BY_ID[s.exId].eq.includes("bw"), s.exId);
    if (L.BY_ID[s.exId].inc === 0) assert.ok(s.hi >= 20);
  }
});

test("the goal sets the main-lift prescription and the level the set count", () => {
  const main = (o) => L.generatePlan({ days: 3, ...o }).schedule[0].slots.find((s) => s.main);
  assert.deepEqual([main({ goal: "strength" }).lo, main({ goal: "strength" }).hi], [3, 5]);
  assert.equal(main({ goal: "strength", level: "beginner" }).sets, 3);
});

test("e1rm uses Epley with reps in reserve counted as reps, capped at 15", () => {
  assert.equal(L.e1rm(100, 8, 2), 100 * (1 + 10 / 30));
  assert.equal(L.e1rm(100, 1, 0), 100);
  assert.equal(L.e1rm(100, 20, 5), 100 * 1.5);
  assert.equal(L.e1rm(0, 5, 0), 0);
});

test("suggest: double progression adds load after the top of the range on every set", () => {
  const first = L.suggest("bench", slot, []);
  assert.equal(first.w, null);
  const top = [sess("a", 0, [set("bench", 60, 10), set("bench", 60, 10), set("bench", 60, 10)])];
  assert.deepEqual([L.suggest("bench", slot, top).w, L.suggest("bench", slot, top).reps], [62.5, 6]);
  const mid = [sess("a", 0, [set("bench", 60, 8), set("bench", 60, 7), set("bench", 60, 7)])];
  assert.deepEqual([L.suggest("bench", slot, mid).w, L.suggest("bench", slot, mid).reps], [60, 9]);
  const miss = [sess("a", 0, [set("bench", 60, 4), set("bench", 60, 4), set("bench", 60, 6)])];
  assert.equal(L.suggest("bench", slot, miss).w, 55); // 54 rounded to the 2.5 kg step
  // Bodyweight: add a rep instead.
  const bw = [sess("a", 0, [set("push-up", 0, 10), set("push-up", 0, 10), set("push-up", 0, 10)])];
  assert.deepEqual([L.suggest("push-up", slot, bw).w, L.suggest("push-up", slot, bw).reps], [0, 11]);
});

test("records lists each session that beat every earlier best, newest first", () => {
  const ss = [
    sess("a", 0, [set("bench", 60, 8)]),
    sess("b", 3, [set("bench", 62.5, 8)]),
    sess("c", 7, [set("bench", 60, 6)]),
    sess("d", 10, [set("bench", 65, 8)]),
  ];
  const prs = L.records(ss);
  assert.deepEqual(prs.map((p) => p.date), [at(10), at(3)]);
  assert.ok(prs[0].best > prs[0].prev);
});

test("newRecords reports only what the new session set", () => {
  const before = [sess("a", 0, [set("bench", 60, 8), set("squat", 80, 5)])];
  const s = sess("b", 2, [set("bench", 65, 8), set("back-squat", 70, 5)]);
  assert.deepEqual(L.newRecords(before, s).map((p) => p.exId), ["bench"]);
});

test("sets per muscle count 1 for primary and 0.5 for secondary muscles", () => {
  const acc = L.loggedSets([sess("a", 0, [set("bench", 60, 8), set("bench", 60, 8)])], T0 - DAY, T0 + DAY);
  assert.equal(acc.chest, 2);
  assert.equal(acc.triceps, 1);
  assert.equal(acc.quads, 0);
  // Outside the window it is not counted.
  assert.equal(L.loggedSets([sess("a", 5, [set("bench", 60, 8)])], T0 - DAY, T0 + DAY).chest, 0);
});

test("weeklyTonnage sums weight x reps per Monday-start week", () => {
  const ss = [sess("a", 0, [set("bench", 50, 10)]), sess("b", 2, [set("bench", 50, 10)]), sess("c", 8, [set("bench", 40, 5)])];
  const w = L.weeklyTonnage(ss, 3, T0 + 9 * DAY);
  assert.deepEqual(w.map((x) => x.kg), [0, 1000, 200]);
  assert.deepEqual(w.map((x) => x.sessions), [0, 2, 1]);
});

test("slopePerWeek needs 3 points and finds a steady climb", () => {
  assert.equal(L.slopePerWeek([{ date: at(0), best: 100 }, { date: at(7), best: 101 }]), null);
  const fit = L.slopePerWeek([0, 7, 14, 21].map((d, i) => ({ date: at(d), best: 100 + i })));
  assert.ok(Math.abs(fit.slope - 1) < 1e-9);
  assert.ok(Math.abs(fit.r2 - 1) < 1e-9);
});

test("fmtWeight rounds to plate steps in kg and lb", () => {
  assert.equal(L.fmtWeight(61.3, "kg"), "61.5");
  assert.equal(L.fmtWeight(60, "lb", L.BY_ID.bench), "130"); // 132.3 lb to the 5 lb step
  assert.equal(L.fmtWeight(10, "lb", L.BY_ID.lateral), "22.5"); // small-jump exercise: 2.5 lb step
  assert.equal(L.fmtWeight(null), "");
});

test("newDraft pre-fills the suggested weight; collectSets keeps rows with reps, in kg", () => {
  const plan = { schedule: [{ name: "A", slots: [{ exId: "bench", main: true, ...slot }, { exId: "push-up", ...slot }] }] };
  const past = [sess("a", 0, [set("bench", 60, 10), set("bench", 60, 10), set("bench", 60, 10)])];
  const d = L.newDraft(plan, 0, past, "kg", T0);
  assert.equal(d.entries[0].sets.length, 3);
  assert.equal(d.entries[0].sets[0].w, "62.5");
  assert.equal(d.entries[1].sets[0].w, "");
  d.entries[0].sets[0].reps = "8";
  d.entries[0].sets[1].reps = "7"; d.entries[0].sets[1].rir = "1";
  d.entries[1].sets[0].reps = "12";
  assert.deepEqual(L.collectSets(d, "kg"), [set("bench", 62.5, 8, 2), set("bench", 62.5, 7, 1), set("push-up", 0, 12, 2)]);
  // Typed in lb, stored in kg.
  const lb = L.newDraft(plan, 0, [], "lb", T0);
  lb.entries[0].sets[0] = { w: "135", reps: "5", rir: "", done: true };
  assert.equal(L.collectSets(lb, "lb")[0].w, +(135 / L.LB_PER_KG).toFixed(2));
});

test("fromLiftlog reads Liftlog's stored state and drops bad rows", () => {
  const plan = L.generatePlan({ days: 4 });
  const raw = JSON.stringify({
    v: 1, unit: "lb", plan, next: 2, draft: { day: "x" }, form: { goal: "strength", days: 4, equip: "gym", level: "advanced" },
    sessions: [
      { id: "s1", date: at(0), day: "Upper A", sets: [set("bench", 60, 8), { exId: "bench", w: 60, reps: 0 }], minutes: 50 },
      { id: "s2", date: "not a date", day: "Lower A", sets: [set("back-squat", 80, 5)] },
      { id: "s3", date: at(2), day: "Lower A", sets: [] },
    ],
  });
  const d = L.fromLiftlog(raw);
  assert.equal(d.unit, "lb");
  assert.equal(d.next, 2);
  assert.equal(d.plan.schedule.length, 4);
  assert.deepEqual(d.sessions.map((s) => s.id), ["s1"]);
  assert.equal(d.sessions[0].sets.length, 1);
  assert.equal(d.sessions[0].source, "liftlog");
  assert.equal(d.sessions[0].minutes, 50);
});

test("fromLiftlog refuses what is not Liftlog data", () => {
  for (const raw of [null, "", "{", "[]", JSON.stringify({ v: 2, sessions: [] }), JSON.stringify({ v: 1 }), JSON.stringify({ app: "genki" })]) assert.equal(L.fromLiftlog(raw), null, String(raw));
  // A bad plan or rotation index falls back safely.
  const d = L.fromLiftlog({ v: 1, sessions: [], plan: { schedule: "x" }, next: 7, unit: "stone" });
  assert.deepEqual([d.plan, d.next, d.unit], [null, 0, "kg"]);
});

test("newSessions skips sessions already brought over", () => {
  assert.deepEqual(L.newSessions([{ id: "a" }], [{ id: "a" }, { id: "b" }]).map((s) => s.id), ["b"]);
});

test("toCSV writes one row per set in the chosen unit", () => {
  const csv = L.toCSV([sess("a", 0, [set("bench", 100, 5, 2), set("bench", 100, 5, 1)], { day: "Upper, A" })], "kg").trim().split("\n");
  assert.equal(csv.length, 3);
  assert.equal(csv[1], `2026-01-05,"Upper, A",Bench press,hpush,1,100,5,2,${+(L.e1rm(100, 5, 2)).toFixed(1)},chest`);
  assert.match(csv[2], /,2,100,5,1,/);
});

test("fromLiftlog rebuilds the plan so no markup or junk number reaches the page", () => {
  const evil = { goal: "<b>", days: "<img>", equip: "x", level: 1, split: 5, schedule: [{ name: "<i>", slots: [{ exId: "bench", sets: "<script>", lo: "a", hi: null, rir: {}, rest: "9<" }, { exId: 7 }] }] };
  const d = L.fromLiftlog({ v: 1, sessions: [], plan: evil });
  const s = d.plan.schedule[0].slots;
  assert.equal(s.length, 1);
  for (const k of ["sets", "lo", "hi", "rir", "rest"]) assert.equal(typeof s[0][k], "number", k);
  assert.deepEqual([d.plan.goal, d.plan.days, d.plan.equip, d.plan.level], ["hypertrophy", 2, "gym", "intermediate"]);
  assert.deepEqual(d.form, { goal: "hypertrophy", days: 2, equip: "gym", level: "intermediate" });
  assert.doesNotThrow(() => L.generatePlan(d.form));
});
