// Rep notation, the new set fields and the workout history file. Every set and name here is made up.
import { test } from "node:test";
import assert from "node:assert/strict";
import * as L from "../workouts.js";
import { convertHistory, proposeAliases, normKey } from "../scripts/workout-history.mjs";

test("parseReps reads fractional reps, hard, extra, one side and drop sets", () => {
  const cases = {
    "7.4": { reps: 7.4 },
    "7.7H": { reps: 7.7, hard: true },
    "12.55": { reps: 12.55 },
    "7+1H": { reps: 7, extra: 1, hard: true },
    "11H+3": { reps: 11, extra: 3, hard: true },
    "7R": { reps: 7, side: "R" },
    "7RH": { reps: 7, side: "R" }, // RH is the right hand, not hard
    "7HR": { reps: 7, side: "R", hard: true },
    "7RHH": { reps: 7, side: "R", hard: true },
    "6.5L": { reps: 6.5, side: "L" },
    "d6": { reps: 6, drop: true },
    "drop 6.5H": { reps: 6.5, hard: true, drop: true },
    "10R: 7L": { reps: 7, repsL: 7, repsR: 10 },
    "10L: 8H": { reps: 8, repsL: 10, repsR: 8, hard: true },
    "8R:8L (H)": { reps: 8, repsL: 8, repsR: 8, hard: true },
    "7right:7left": { reps: 7, repsL: 7, repsR: 7 },
    "7,5": { reps: 7.5 },
    "7.H": { reps: 7, hard: true },
  };
  for (const [t, want] of Object.entries(cases)) assert.deepEqual(L.parseReps(t), want, t);
});

test("parseReps refuses other text unless lenient, which keeps it as the note", () => {
  for (const t of ["", "abc", "H", "7x", "8 both", "0", "7L:7L", "1:2:3"]) assert.equal(L.parseReps(t), null, t);
  assert.deepEqual(L.parseReps("8 slow warm", { lenient: true }), { reps: 8, note: "slow warm" });
  assert.deepEqual(L.parseReps("6.5H (made-up note)", { lenient: true }), { reps: 6.5, hard: true, note: "made-up note" });
});

test("formatReps writes notation that parses back to the same set", () => {
  for (const t of ["7.4", "7.7H", "7+1H", "7HR", "7L", "d6", "d6.5H", "10R:7L", "9.5HR:6.5HL", "12.55+2"]) {
    const p = L.parseReps(t);
    assert.deepEqual(L.parseReps(L.formatReps(p)), p, t);
  }
});

test("e1rm uses fractional reps; extra reps count toward load moved", () => {
  assert.equal(L.e1rm(100, 7.5, 0), 100 * (1 + 7.5 / 30));
  assert.ok(L.e1rm(100, 7.4, 0) > L.e1rm(100, 7, 0));
  assert.equal(L.setLoad({ w: 50, reps: 7, extra: 1 }), 400);
  assert.equal(L.sessionVolume({ sets: [{ w: 50, reps: 7.5 }, { w: 0, reps: 10, bw: true }] }), 375);
});

test("fmtLoad keeps pound weights as typed; fmtSet writes a set for a list", () => {
  const kg = +(L.toKg(92, "lb")).toFixed(3);
  assert.equal(L.fmtLoad(kg, "lb"), "92");
  assert.equal(L.fmtSet({ w: kg, reps: 7.4, hard: true }, "lb"), "92×7.4H");
  assert.equal(L.fmtSet({ w: 0, reps: 10, bw: true }, "lb"), "BW×10");
  assert.equal(L.fmtSet({ w: 10, reps: 6, drop: true }, "kg"), "d10×6");
  assert.equal(L.fmtSet({ w: 0, reps: 12 }, "kg", L.BY_ID["push-up"]), "12");
});

test("collectSets takes notation: hard means 0 in reserve, a first set cannot be a drop set", () => {
  const slot = { sets: 3, lo: 6, hi: 10, rir: 2, rest: 90 };
  const d = { entries: [{ exId: "bench", slot, sets: [
    { w: "60", reps: "d8", rir: "", done: true },
    { w: "60", reps: "7.4H", rir: "", done: true },
    { w: "45", reps: "d5.5", rir: "", done: true },
    { w: "60", reps: "nope", rir: "", done: false },
    { w: "60", reps: "6+1", rir: "1", done: true },
  ] }] };
  assert.deepEqual(L.collectSets(d, "kg"), [
    { exId: "bench", w: 60, reps: 8, rir: 2 },
    { exId: "bench", w: 60, reps: 7.4, rir: 0, hard: true },
    { exId: "bench", w: 45, reps: 5.5, rir: 2, drop: true },
    { exId: "bench", w: 60, reps: 6, rir: 1, extra: 1 },
  ]);
});

test("setMessage spells notation out and keeps plain reps as before", () => {
  assert.equal(L.setMessage({ name: "Test row", n: 1, of: 3, done: true, w: "40", reps: "7.5H", unit: "lb", rest: 0 }), "Test row set 1 of 3 done: 40 lb × 7.5 reps, hard.");
  assert.equal(L.setMessage({ name: "Test row", n: 1, of: 3, done: true, w: "40", reps: "8", unit: "lb", rest: 0 }), "Test row set 1 of 3 done: 40 lb × 8.");
});

const file = (over = {}) => ({
  genki: "workout-history", v: 1, unit: "lb",
  exercises: [{ id: "x-test-curl", name: "Test curl" }],
  sessions: [{ id: "h-2023-01-02-1", date: "2023-01-02", day: "Arms", note: "made-up", sets: [
    { exId: "x-test-curl", w: 11.34, reps: 8.5, rir: 0, hard: true },
    { exId: "x-test-curl", w: 9, reps: 6, rir: null, drop: true },
    { exId: "bench", w: 40, reps: 10, rir: null, side: "R" },
  ] }],
  ...over,
});

test("fromHistoryFile keeps checked sessions at local noon, with their exercises", () => {
  const d = L.fromHistoryFile(JSON.stringify(file()));
  assert.equal(d.unit, "lb");
  assert.deepEqual(d.exercises, [{ id: "x-test-curl", name: "Test curl" }]);
  const s = d.sessions[0];
  assert.equal(s.source, "history");
  assert.equal(new Date(s.date).getHours(), 12);
  assert.equal(new Date(s.date).getDate(), 2);
  assert.deepEqual(s.sets[1], { exId: "x-test-curl", w: 9, reps: 6, rir: null, drop: true });
  assert.equal(s.sets[2].side, "R");
});

test("fromHistoryFile drops what it cannot trust", () => {
  for (const raw of [null, "{", JSON.stringify({ genki: "workout-history", v: 2, exercises: [], sessions: [] }), JSON.stringify({ app: "genki" })]) assert.equal(L.fromHistoryFile(raw), null, String(raw));
  const d = L.fromHistoryFile(file({
    exercises: [{ id: "x-<b>", name: "bad id" }, { id: "bench", name: "shadows the library" }, { id: "x-ok", name: "  " }, { id: "x-test-curl", name: "Test curl" }],
    sessions: [
      { id: "h-1", date: "2023-02-30", day: "bad date", sets: [{ exId: "bench", w: 1, reps: 1 }] },
      { id: "<img>", date: "2023-02-01", day: "bad id", sets: [{ exId: "bench", w: 1, reps: 1 }] },
      { id: "h-2", date: "2023-02-01", day: "<b>Day</b>", sets: [
        { exId: "x-unknown", w: 1, reps: 5 }, { exId: "bench", w: "40", reps: 5 }, { exId: "bench", w: -1, reps: 0 },
        { exId: "x-test-curl", w: 5, reps: 5, drop: true, side: "up", note: 7, rir: 99 },
      ] },
    ],
  }));
  assert.deepEqual(d.exercises.map((e) => e.id), ["x-test-curl"]);
  assert.equal(d.sessions.length, 1);
  // String weights are not numbers; a drop set after another exercise is not a drop set.
  assert.deepEqual(d.sessions[0].sets, [{ exId: "bench", w: 0, reps: 5, rir: null }, { exId: "x-test-curl", w: 5, reps: 5, rir: null }]);
  assert.equal(d.sessions[0].day, "<b>Day</b>"); // kept as text: the view escapes it
});

const log = { sessions: [
  { id: 1, date: "2023-03-01", label: "Pull", notes: ["made-up note"], exercises: [
    { name: "Test db curls", key: "test db curls", sets: [
      { weight: 25, unit: "s", raw: "9.7" }, { weight: 25, unit: "s", raw: "7+1RH" }, { weight: 15, unit: "s", is_drop: true, raw: "6.5H" },
    ] },
    { name: "Test db bicep curl", key: "test db bicep curl", sets: [{ weight: 20, unit: "kg", raw: "10R: 8L" }, { weight: null, unit: "", raw: "" }] },
    { name: "Test pullups", key: "test pullups", sets: [{ weight: null, unit: "", weight_label: "bodyweight", raw: "slow 8" }] },
  ] },
  { id: 2, date: "2023-03-02", label: "Cardio", notes: [], exercises: [] },
] };

test("convertHistory reads the raw reps with the app's notation, in pounds", () => {
  const { file: f, stats } = convertHistory(log, { exercises: [{ name: "Test curl", keys: ["test db curls", "test db bicep curl"] }] });
  assert.deepEqual([stats.sessionsOut, stats.setsOut, stats.skipped.noReps, stats.skipped.emptySession], [1, 5, 1, 1]);
  const s = f.sessions[0];
  assert.equal(s.id, "h-2023-03-01-1");
  assert.deepEqual(s.sets.map((x) => x.exId), ["x-test-curl", "x-test-curl", "x-test-curl", "x-test-curl", "x-test-pullups"]);
  assert.equal(s.sets[0].reps, 9.7);
  assert.equal(s.sets[0].w, +(25 / L.LB_PER_KG).toFixed(3));
  assert.deepEqual([s.sets[1].side, s.sets[1].extra, s.sets[1].hard], ["R", 1, undefined]);
  assert.deepEqual([s.sets[2].drop, s.sets[2].hard, s.sets[2].rir], [true, true, 0]);
  assert.deepEqual([s.sets[3].w, s.sets[3].repsR, s.sets[3].repsL], [20, 10, 8]);
  assert.deepEqual([s.sets[4].bw, s.sets[4].reps, s.sets[4].note], [true, 8, "slow"]);
  // What it writes is what the app accepts.
  const d = L.fromHistoryFile(JSON.stringify(f));
  assert.equal(d.sessions[0].sets.length, 5);
  assert.deepEqual(d.exercises.map((e) => e.name).sort(), ["Test curl", "Test pullups"]);
});

test("proposeAliases groups spelling variants only", () => {
  assert.equal(normKey("DB bicep curls"), normKey("dumbbell curl"));
  assert.equal(normKey("lat pull downs"), normKey("Lat pulldowns"));
  assert.notEqual(normKey("machine preacher curls"), normKey("preacher curls"));
  const p = proposeAliases(log);
  assert.deepEqual(p.exercises.find((g) => g.keys.length === 2).keys.sort(), ["test db bicep curl", "test db curls"]);
});

test("suggest aims for the next whole rep after a fractional one", () => {
  const past = [{ id: "a", date: "2026-01-05T09:00:00.000Z", day: "D", sets: [{ exId: "bench", w: 60, reps: 7.4, rir: 0 }] }];
  assert.equal(L.suggest("bench", { sets: 3, lo: 6, hi: 10, rir: 2, rest: 90 }, past).reps, 8);
});

test("fromHistoryFile keeps one session per id and refuses years before 1900", () => {
  const set = { exId: "bench", w: 50, reps: 5 };
  const r = L.fromHistoryFile({ genki: L.HISTORY_KIND, v: 1, unit: "kg", exercises: [], sessions: [
    { id: "h-a", date: "2023-04-01", day: "A", sets: [set] },
    { id: "h-a", date: "2023-04-02", day: "A again", sets: [set] },
    { id: "h-b", date: "0050-04-01", day: "B", sets: [set] },
  ] });
  assert.deepEqual(r.sessions.map((s) => s.day), ["A"]);
});

test("toCSV keeps formula-like names as text", () => {
  const csv = L.toCSV([{ date: "2023-05-01T12:00:00.000Z", day: "=1+1", sets: [{ exId: "x-test", w: 10, reps: 5 }] }], "kg", { "x-test": "@test" });
  assert.match(csv.split("\n")[1], /^2023-05-01,'=1\+1,'@test,/);
});

test("convertHistory gives names that slug alike their own ids", () => {
  const log = { sessions: [{ id: 1, date: "2023-06-01", label: "Test", notes: [], exercises: [
    { name: "Test row!", key: "test row!", sets: [{ weight: 10, unit: "kg", raw: "8" }] },
    { name: "Test row?", key: "test row?", sets: [{ weight: 10, unit: "kg", raw: "8" }] },
  ] }] };
  const { file } = convertHistory(log);
  const ids = file.sessions[0].sets.map((x) => x.exId);
  assert.notEqual(ids[0], ids[1]);
  assert.equal(file.exercises.length, 2);
});
