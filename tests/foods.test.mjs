// Food search and serving units. Foods here are made-up samples.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fromTableRow, fromMyFood, searchFoods, searchKey, makeEntry, recentMyFoods, unitLabel } from "../foods.js";

const jp = [
  ["jp1", "Chicken, broiler, breast, meat without skin, raw", 105, 23.3, 1.9, 0.1],
  ["jp2", "Soybeans, natto, \"Itohiki-natto\" (fermented whole soybean)", 190, 16.5, 10, 12.1],
  ["jp3", "Rice, well-milled rice, cooked", 156, 2.5, 0.3, 37.1],
].map((r) => fromTableRow(r, "jp"));
const us = [
  ["us1", "Egg, whole, raw, fresh", 143, 12.6, 9.5, 0.7, [["1 large", 50], ["1 jumbo", 63]]],
  ["us2", "Chicken, broilers or fryers, breast, meat only, cooked, roasted", 165, 31, 3.6, 0],
].map((r) => fromTableRow(r, "us"));
const mine = [fromMyFood({ id: "m1", name: "Chicken salad bowl", serving: "1 bowl", grams: 250, kcal: 320, protein: 28, fat: 12, carbs: 20, uses: 3, lastUsed: "2026-01-10T00:00:00Z" })];

test("table rows become foods per 100 g with a gram unit and portions", () => {
  const egg = us[0];
  assert.equal(egg.per, "100 g");
  assert.deepEqual(egg.units.map((u) => u.label), ["g", "1 large", "1 jumbo"]);
  assert.equal(egg.units[0].factor, 0.01);
  assert.equal(egg.units[1].factor, 0.5);
  assert.equal(unitLabel(egg.units[1]), "1 large (50 g)");
  assert.equal(unitLabel(egg.units[0]), "g");
});

test("my foods are per serving, with grams when the serving weight is known", () => {
  const f = mine[0];
  assert.equal(f.per, "serving");
  assert.deepEqual(f.units.map((u) => u.label), ["1 bowl", "g"]);
  assert.equal(f.units[1].factor, 1 / 250);
  assert.deepEqual(fromMyFood({ id: "x", name: "Bar", kcal: 200, protein: 20 }).units.map((u) => u.label), ["serving"]);
});

test("search keys drop case, accents and punctuation", () => {
  assert.equal(searchKey("Café-au-Lait, \"Hot\""), "cafe au lait hot");
});

test("every query word must start a word of the name, in any order", () => {
  const ids = (q) => searchFoods(q, [mine, jp, us]).map((f) => f.id);
  assert.deepEqual(ids("natto"), ["jp2"]);
  assert.deepEqual(ids("nat"), ["jp2"]);
  assert.deepEqual(ids("breast chick").sort(), ["jp1", "us2"]);
  assert.deepEqual(ids("atto"), []);
  assert.deepEqual(ids("   "), []);
});

test("my foods rank first, then names starting with the query, then shorter names", () => {
  const ids = searchFoods("chicken", [mine, jp, us]).map((f) => f.id);
  assert.equal(ids[0], "m1");
  assert.deepEqual(ids.slice(1), ["jp1", "us2"]); // the shorter name first
  assert.equal(searchFoods("egg", [jp, us], 1).length, 1);
});

test("names with the query words near the front rank higher", () => {
  const list = [
    ["a", "Chicken, offal and by-products, skin, breast, raw", 300, 10, 30, 0],
    ["b", "Chicken, broiler, breast, meat only, raw, extra long name to lose on length", 110, 23, 1, 0],
  ].map((r) => fromTableRow(r, "us"));
  assert.deepEqual(searchFoods("chicken breast", [list]).map((f) => f.id), ["b", "a"]);
});

test("a whole-word match beats a prefix match", () => {
  const list = [["n", "Eggnog", 88, 4.6, 4.2, 8], ["e", "Egg, whole, raw, fresh", 143, 12.6, 9.5, 0.7]].map((r) => fromTableRow(r, "us"));
  assert.deepEqual(searchFoods("egg", [list]).map((f) => f.id), ["e", "n"]);
});

test("an entry stores nutrients per unit and the amount eaten", () => {
  const e = makeEntry(jp[0], jp[0].units[0], 150, { id: "e1", date: "2026-01-15", meal: "lunch", now: new Date("2026-01-15T03:00:00Z") });
  assert.equal(e.unit, "g");
  assert.equal(e.amount, 150);
  assert.equal(e.base.kcal, 1.05);
  assert.equal(e.base.protein, 0.233);
  assert.equal(e.source, "jp");
  assert.equal(e.ref, "jp1");
  assert.equal(e.createdAt, "2026-01-15T03:00:00.000Z");
  const egg = makeEntry(us[0], us[0].units[1], 2, { id: "e2", date: "2026-01-15", meal: "breakfast" });
  assert.equal(egg.base.kcal, 71.5);
  assert.equal(egg.unit, "1 large");
});

test("recent my foods come first", () => {
  const list = [{ id: "a", lastUsed: "2026-01-01" }, { id: "b", lastUsed: "2026-01-09" }, { id: "c" }];
  assert.deepEqual(recentMyFoods(list).map((f) => f.id), ["b", "a", "c"]);
});

test("the bundled tables load and search", () => {
  for (const src of ["jp", "us"]) {
    const t = JSON.parse(readFileSync(new URL(`../foods/${src}.json`, import.meta.url)));
    assert.ok(t.meta.source && t.meta.license);
    assert.ok(t.foods.length > 1000);
    const foods = t.foods.map((r) => fromTableRow(r, src));
    assert.ok(new Set(foods.map((f) => f.id)).size === foods.length, `${src} ids are unique`);
    assert.ok(searchFoods("chicken breast", [foods]).length > 0);
  }
});
