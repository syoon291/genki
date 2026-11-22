// Body scans: form parsing, units, changes between scans. Every value here is made up.
import { test } from "node:test";
import assert from "node:assert/strict";
import { parseScanForm, sortScans, scanChanges, overWeighIn, scanMessage, scanId, toKg, fromKg } from "../scans.js";
import { KEY_PATHS } from "../db.js";

const form = (o = {}) => ({ date: "2026-03-01", time: "09:30", unit: "lb", weightKg: "160", smmKg: "72", fatKg: "30", pbf: "18.8", vfa: "50", bmr: "1600", leanKg: "130", ecwTbw: "0.371", ...o });

test("bodyScans is a store keyed by id", () => {
  assert.equal(KEY_PATHS.bodyScans, "id");
});

test("a form in lb is stored in kg with 3 decimals that read back exactly", () => {
  const { scan, error } = parseScanForm(form(), "2026-03-02");
  assert.equal(error, undefined);
  assert.equal(scan.id, "scan-2026-03-01T09:30");
  assert.equal(scan.unit, "lb");
  assert.equal(scan.weightKg, 72.575);
  assert.equal(Number(fromKg(scan.weightKg, "lb").toFixed(1)), 160);
  assert.equal(Number(fromKg(scan.smmKg, "lb").toFixed(1)), 72);
  assert.equal(scan.pbf, 18.8);
  assert.equal(scan.vfa, 50);
  assert.equal(scan.ecwTbw, 0.371);
});

test("kg is taken as is; empty optional boxes are null; no time is fine", () => {
  const { scan } = parseScanForm({ date: "2026-03-01", unit: "kg", weightKg: "70,5", pbf: "" }, "2026-03-01");
  assert.equal(scan.id, "scan-2026-03-01");
  assert.equal(scan.time, null);
  assert.equal(scan.weightKg, 70.5);
  assert.equal(scan.pbf, null);
  assert.equal(scan.smmKg, null);
});

test("problems are named", () => {
  const err = (o, today = "2026-03-02") => parseScanForm(form(o), today).error;
  assert.match(err({ weightKg: "" }), /weight/);
  assert.match(err({ date: "2026-03-05" }), /up to today/);
  assert.match(err({ date: "2026-02-30" }), /day/);
  assert.match(err({ time: "25:00" }), /HH:MM/);
  assert.match(err({ pbf: "abc" }), /number/);
  assert.match(err({ pbf: "90" }), /between 2 and 75/);
  assert.match(err({ weightKg: "20" }), /between \d+ and \d+ lb/);
  assert.match(err({ smmKg: "170" }), /less than the weight/);
});

test("scans sort by day then time", () => {
  const s = sortScans([{ id: "c", date: "2026-03-08", time: null }, { id: "b", date: "2026-03-01", time: "18:00" }, { id: "a", date: "2026-03-01", time: "08:00" }]);
  assert.deepEqual(s.map((x) => x.id), ["a", "b", "c"]);
});

test("changes since the last scan say which way is good", () => {
  const prev = parseScanForm(form(), "2026-03-09").scan;
  const cur = parseScanForm(form({ date: "2026-03-08", smmKg: "73", fatKg: "28", pbf: "17.6", bmr: "1620", vfa: "" }), "2026-03-09").scan;
  const ch = Object.fromEntries(scanChanges(cur, prev, "lb").map((c) => [c.field.id, c]));
  assert.ok(Math.abs(ch.smmKg.delta - 1) < 0.01);
  assert.equal(ch.smmKg.good, true);
  assert.ok(Math.abs(ch.fatKg.delta + 2) < 0.01);
  assert.equal(ch.fatKg.good, true);
  assert.equal(ch.pbf.good, true);
  assert.equal(ch.bmr.good, null); // neither way is better
  assert.equal(ch.weightKg.good, null);
  assert.equal(ch.vfa, undefined); // not on this scan
  // The first scan has nothing to compare with.
  assert.equal(scanChanges(prev, null, "lb").every((c) => c.delta === null), true);
});

test("the scan's weight over that morning's weigh-in, never mixed into it", () => {
  const scan = { date: "2026-03-01", weightKg: toKg(160, "lb") };
  assert.equal(overWeighIn(scan, [{ date: "2026-03-01", kg: 71.4 }]), 1.175);
  assert.equal(Number(fromKg(overWeighIn({ date: "2026-03-01", weightKg: toKg(157, "lb") }, [{ date: "2026-03-01", kg: 70 }]), "lb").toFixed(1)), 2.7);
  assert.equal(overWeighIn(scan, [{ date: "2026-02-28", kg: 71.4 }]), null);
});

test("the screen reader message names muscle and body fat", () => {
  const prev = parseScanForm(form(), "2026-03-09").scan;
  const cur = parseScanForm(form({ date: "2026-03-08", smmKg: "73", pbf: "17.6" }), "2026-03-09").scan;
  assert.equal(scanMessage(cur, prev, "lb"), "Body scan saved. Muscle 73 lb, up 1 since the last scan; Body fat 17.6 %, down 1.2 since the last scan.");
  assert.equal(scanMessage(prev, null, "lb"), "Body scan saved. Muscle 72 lb; Body fat 18.8 %.");
  assert.equal(scanId("2026-03-01", null), "scan-2026-03-01");
});
