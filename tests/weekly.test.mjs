// Weekly nutrition history CSV. Every number here is made up.
import { test } from "node:test";
import assert from "node:assert/strict";
import { parseWeeklyCsv, WEEK_COLUMNS } from "../nutrition.js";

const header = WEEK_COLUMNS.join(",");

test("parses a headered file into one record per week, oldest first", () => {
  const { rows, skipped } = parseWeeklyCsv(`${header}\n2026-02-09,2026-02-15,1850,140,190,60,25,41,29,30\n2026-02-02,2026-02-08,1900.44,135,200,62,22,42,29,28\n`);
  assert.deepEqual(skipped, []);
  assert.equal(rows.length, 2);
  assert.deepEqual(rows[0], { weekStart: "2026-02-02", weekEnd: "2026-02-08", kcal: 1900.4, protein: 135, carbs: 200, fat: 62, fiber: 22, carbPct: 42, fatPct: 29, proteinPct: 28 });
  assert.equal(rows[1].weekStart, "2026-02-09");
});

test("finds columns by header name in any order and ignores extras", () => {
  const { rows } = parseWeeklyCsv("notes,net_kcal_per_day,week_end,week_start,protein_g\nhi,2000,2026-03-08,2026-03-02,150\n");
  assert.deepEqual(rows[0], { weekStart: "2026-03-02", weekEnd: "2026-03-08", kcal: 2000, protein: 150, carbs: null, fat: null, fiber: null, carbPct: null, fatPct: null, proteinPct: null });
});

test("without a header the columns are taken in the standard order", () => {
  const { rows } = parseWeeklyCsv("2026-03-02,2026-03-08,2000,150,210,70,30,40,30,30");
  assert.equal(rows[0].fiber, 30);
  assert.equal(rows[0].proteinPct, 30);
});

test("blank optional cells become null; percents may carry a % sign; BOM, quotes, CRLF and semicolons with decimal commas are accepted", () => {
  const { rows, skipped } = parseWeeklyCsv(`﻿${header.replaceAll(",", ";")}\r\n"2026-03-02";2026-03-08;1980,5;;;;;41%;29 %;30\r\n`);
  assert.deepEqual(skipped, []);
  assert.equal(rows[0].kcal, 1980.5);
  assert.equal(rows[0].protein, null);
  assert.equal(rows[0].carbPct, 41);
  assert.equal(rows[0].fatPct, 29);
});

test("skips bad rows with their line number and a reason", () => {
  const { rows, skipped } = parseWeeklyCsv([
    header,
    "2026-02-30,2026-03-06,1900", // not a real day
    "2026-03-09,2026-03-02,1900", // ends before it starts
    "2026-03-09,2026-03-15,", // no calories
    "2026-03-09,2026-03-15,1900,abc", // bad protein
    "2026-03-09,2026-03-15,1900,140,200,60,25,140", // percent over 100
    "# a comment",
    "",
    "2026-03-16,2026-03-22,1900",
  ].join("\n"));
  assert.deepEqual(skipped.map((s) => s.line), [2, 3, 4, 5, 6]);
  assert.match(skipped[0].reason, /YYYY-MM-DD/);
  assert.match(skipped[2].reason, /net_kcal_per_day/);
  assert.match(skipped[3].reason, /protein_g/);
  assert.equal(rows.length, 1);
});

test("the later row for a week wins", () => {
  const { rows } = parseWeeklyCsv(`${header}\n2026-03-02,2026-03-08,1900\n2026-03-02,2026-03-08,2100\n`);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].kcal, 2100);
});

test("a header without the required columns skips every row", () => {
  const { rows, skipped } = parseWeeklyCsv("date,kcal\n2026-03-02,1900\n");
  assert.equal(rows.length, 0);
  assert.match(skipped[0].reason, /header/);
});
