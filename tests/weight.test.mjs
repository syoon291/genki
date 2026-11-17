// Weigh-in maths and the CSV import. Every weight here is made up.
import { test } from "node:test";
import assert from "node:assert/strict";
import { sortWeighIns, averageEnding, trend, summary, goalProgress, weightAxis, parseWeighInCsv, daysBetween, validDate, weightProblem } from "../weight.js";

const w = (date, kg) => ({ date, kg });
// Two weeks: 80.0 down by 0.1 a day, with one day missing.
const twoWeeks = Array.from({ length: 14 }, (_, i) => w(`2026-03-${String(i + 1).padStart(2, "0")}`, Math.round((80 - i * 0.1) * 10) / 10)).filter((x) => x.date !== "2026-03-10");

test("sortWeighIns orders oldest first and keeps the last record for a day", () => {
  const s = sortWeighIns([w("2026-01-03", 70), w("2026-01-01", 71), w("2026-01-03", 69.5)]);
  assert.deepEqual(s.map((x) => [x.date, x.kg]), [["2026-01-01", 71], ["2026-01-03", 69.5]]);
});

test("the 7-day average covers the 7 calendar days ending on the day, skipping gaps", () => {
  const s = sortWeighIns(twoWeeks);
  // 8-14 March, with the 10th missing: 79.3, 79.2, 79.0, 78.9, 78.8, 78.7
  assert.ok(Math.abs(averageEnding(s, "2026-03-14") - (79.3 + 79.2 + 79.0 + 78.9 + 78.8 + 78.7) / 6) < 1e-9);
  assert.equal(averageEnding(s, "2026-02-01"), null);
  // A single day counts on its own.
  assert.equal(averageEnding(s, "2026-03-01"), 80);
});

test("the average window crosses month ends", () => {
  const s = sortWeighIns([w("2026-02-26", 70), w("2026-03-04", 72), w("2026-02-25", 90)]);
  assert.equal(averageEnding(s, "2026-03-04"), 71); // 26 Feb to 4 Mar, not the 25th
});

test("trend gives each weigh-in its trailing average", () => {
  const t = trend([w("2026-01-02", 81), w("2026-01-01", 79)]);
  assert.deepEqual(t, [{ date: "2026-01-01", kg: 79, avg: 79 }, { date: "2026-01-02", kg: 81, avg: 80 }]);
});

test("summary: latest, average, weekly change and progress from the first week", () => {
  const s = summary(twoWeeks, 75);
  assert.deepEqual(s.latest, { date: "2026-03-14", kg: 78.7 });
  const firstWeek = (80 + 79.9 + 79.8 + 79.7 + 79.6 + 79.5 + 79.4) / 7;
  assert.ok(Math.abs(s.start - firstWeek) < 1e-9);
  assert.ok(Math.abs(s.weekChange - (s.avg - firstWeek)) < 1e-9);
  assert.ok(s.weekChange < 0);
  assert.equal(s.progress.reached, false);
  assert.ok(s.progress.pct > 0 && s.progress.pct < 1);
});

test("summary with no weigh-ins, and with one week only", () => {
  assert.deepEqual(summary([]), { latest: null, avg: null, weekChange: null, start: null, progress: null });
  const one = summary([w("2026-01-01", 70), w("2026-01-03", 69)]);
  assert.equal(one.weekChange, null);
  assert.equal(one.progress, null); // no goal
});

test("goalProgress for losing, gaining, reaching and no goal", () => {
  assert.deepEqual(goalProgress(80, 78, 75), { lost: 2, toGo: 3, pct: 0.4, reached: false });
  assert.deepEqual(goalProgress(80, 74.5, 75), { lost: 5.5, toGo: 0, pct: 1, reached: true });
  assert.equal(goalProgress(80, 81, 75).pct, 0); // moved away: clamped
  assert.deepEqual(goalProgress(60, 62, 65), { lost: 2, toGo: 3, pct: 0.4, reached: false }); // gaining toward 65
  assert.equal(goalProgress(80, 78, null), null);
  assert.equal(goalProgress(80, 80, 80).reached, true);
});

test("weightAxis pads a flat series and uses round steps", () => {
  const flat = weightAxis([70, 70.2]);
  assert.ok(flat.min <= 69.1 && flat.max >= 71.1);
  const a = weightAxis([72.3, 80.6, 75]);
  assert.equal(a.min, 72);
  assert.equal(a.max, 82);
  assert.deepEqual(a.ticks, [72, 74, 76, 78, 80, 82]);
  assert.deepEqual(weightAxis([]).ticks, []);
});

test("daysBetween and validDate", () => {
  assert.equal(daysBetween("2026-02-27", "2026-03-02"), 3);
  assert.equal(daysBetween("2026-03-28", "2026-03-30"), 2); // across a DST change in many zones
  assert.equal(validDate("2026-02-29"), false);
  assert.equal(validDate("2028-02-29"), true);
  assert.equal(validDate("2026-1-5"), false);
});

test("weightProblem checks the 30-300 kg range", () => {
  assert.equal(weightProblem(70), null);
  assert.match(weightProblem(NaN), /Enter/);
  assert.match(weightProblem(12), /between 30 and 300/);
});

test("CSV import reads date,weight_kg rows with a header", () => {
  const r = parseWeighInCsv("date,weight_kg\n2026-01-02,70.44\n2026-01-01,71\n");
  assert.deepEqual(r.rows, [{ date: "2026-01-01", kg: 71 }, { date: "2026-01-02", kg: 70.4 }]);
  assert.deepEqual(r.skipped, []);
});

test("CSV import without a header, with CRLF, a BOM, quotes, slashes and blank or comment lines", () => {
  const r = parseWeighInCsv("﻿2026/01/01,\"70.0\"\r\n\r\n# a note\r\n2026-01-02;69.8\r\n");
  assert.deepEqual(r.rows, [{ date: "2026-01-01", kg: 70 }, { date: "2026-01-02", kg: 69.8 }]);
  assert.deepEqual(r.skipped, []);
});

test("CSV import skips bad rows with their line number and keeps the last row for a day", () => {
  const r = parseWeighInCsv("date,weight_kg\n2026-13-01,70\n2026-01-01,abc\n2026-01-02\n2026-01-03,5\n2026-01-04,70\n2026-01-04,69.5\n");
  assert.deepEqual(r.rows, [{ date: "2026-01-04", kg: 69.5 }]);
  assert.deepEqual(r.skipped.map((s) => s.line), [2, 3, 4, 5]);
  assert.match(r.skipped[0].reason, /not a YYYY-MM-DD date/);
  assert.match(r.skipped[1].reason, /not a weight/);
  assert.match(r.skipped[2].reason, /needs a date and a weight/);
});

test("CSV import of an empty file", () => {
  assert.deepEqual(parseWeighInCsv(""), { rows: [], skipped: [] });
  assert.deepEqual(parseWeighInCsv("date,weight_kg\n"), { rows: [], skipped: [] });
});

test("parseWeighInCsv: a semicolon file keeps a decimal comma", () => {
  const { rows, skipped } = parseWeighInCsv("date;weight_kg\n2026-01-05;80,4\n2026-01-06;79.9\n");
  assert.deepEqual(rows, [{ date: "2026-01-05", kg: 80.4 }, { date: "2026-01-06", kg: 79.9 }]);
  assert.equal(skipped.length, 0);
});

test("parseWeighInCsv: the first delimiter wins per line", () => {
  const { rows, skipped } = parseWeighInCsv('date;weight_kg\n"2026-01-05","80.4"\n2026-01-06\t79,9\n2026-01-07,80.1,lunch; late\n');
  assert.deepEqual(rows, [{ date: "2026-01-05", kg: 80.4 }, { date: "2026-01-06", kg: 79.9 }, { date: "2026-01-07", kg: 80.1 }]);
  assert.equal(skipped.length, 0);
});
