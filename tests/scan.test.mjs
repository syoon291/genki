import { test } from "node:test";
import assert from "node:assert/strict";
import { productUrl, foodFromProduct, lookupBarcode } from "../openfoodfacts.js";
import { spokenQuery } from "../foods.js";

// Made-up products in Open Food Facts' reply shape.
const per100 = { "energy-kcal_100g": 380, proteins_100g: 12.5, carbohydrates_100g: 60, fat_100g: 8, fiber_100g: 9, sugars_100g: 14, sodium_100g: 0.4 };

test("productUrl asks only for the fields genki uses, and only for digits", () => {
  const u = new URL(productUrl("4000000000000"));
  assert.equal(u.origin, "https://world.openfoodfacts.org");
  assert.equal(u.pathname, "/api/v2/product/4000000000000.json");
  assert.match(u.searchParams.get("fields"), /nutriments/);
  assert.throws(() => productUrl("12/../x"));
});

test("a product with a serving in grams gives numbers per serving", () => {
  const f = foodFromProduct({ product_name: "Sample Granola", brands: "Test Mill, Other", serving_size: "40 g", serving_quantity: 40, nutriments: per100 }, "4000000000000");
  assert.deepEqual(f, { name: "Sample Granola", brand: "Test Mill", serving: "40 g", grams: 40, barcode: "4000000000000", kcal: 152, protein: 5, carbs: 24, fat: 3.2, fiber: 3.6, sugar: 5.6, sodium: 160 });
});

test("without a serving, numbers are per 100 g; kJ and salt are converted", () => {
  const f = foodFromProduct({ product_name: "Sample Crackers", nutriments: { "energy-kj_100g": 1674, proteins_100g: 10, carbohydrates_100g: 70, fat_100g: 12, salt_100g: 1.5 } }, "4000000000017");
  assert.equal(f.serving, "100 g");
  assert.equal(f.grams, 100);
  assert.equal(f.kcal, 400);
  assert.equal(f.sodium, 600);
  assert.equal(f.fiber, null);
  assert.equal(f.sugar, null);
  assert.equal(f.brand, "");
});

test("drinks in ml keep no serving weight", () => {
  const f = foodFromProduct({ product_name: "Sample Soda", serving_size: "330 ml", serving_quantity: 330, serving_quantity_unit: "ml", nutriments: { "energy-kcal_100g": 42, proteins_100g: 0, carbohydrates_100g: 10.6, fat_100g: 0, sugars_100g: 10.6 } }, "40000017");
  assert.equal(f.serving, "330 ml");
  assert.equal(f.grams, null);
  assert.equal(f.kcal, 139);
  assert.equal(f.sugar, 35);
});

test("only per-serving numbers are used as they are", () => {
  const f = foodFromProduct({ product_name: "Sample Bar", serving_size: "1 bar", nutriments: { "energy-kcal_serving": 210, proteins_serving: 20, carbohydrates_serving: 22, fat_serving: 7 } }, "4000000000024");
  assert.equal(f.serving, "1 bar");
  assert.equal(f.kcal, 210);
  assert.equal(f.protein, 20);
  assert.equal(f.grams, null);
});

test("a product without calories is not a food", () => {
  assert.equal(foodFromProduct({ product_name: "Sample Tea", nutriments: {} }, "1"), null);
  assert.equal(foodFromProduct(null, "1"), null);
  assert.equal(foodFromProduct({ product_name: "x", nutriments: { "energy-kcal_100g": "abc" } }, "1"), null);
});

test("long names are cut to fit my foods", () => {
  const f = foodFromProduct({ product_name: "A".repeat(200), brands: "B".repeat(100), nutriments: per100 }, "1");
  assert.equal(f.name.length, 80);
  assert.equal(f.brand.length, 60);
});

const reply = (status, body) => async () => ({ status, ok: status >= 200 && status < 300, json: async () => body });

test("lookupBarcode: found, missing, missing numbers, errors", async () => {
  let asked;
  const found = await lookupBarcode("4000000000000", async (url, opts) => { asked = { url, opts }; return reply(200, { status: 1, product: { product_name: "Sample Granola", nutriments: per100 } })(); });
  assert.equal(found.status, "found");
  assert.equal(found.food.name, "Sample Granola");
  assert.equal(asked.opts.credentials, "omit");
  assert.equal(asked.opts.referrerPolicy, "no-referrer");
  assert.deepEqual(await lookupBarcode("4000000000000", reply(404, { status: 0 })), { status: "missing" });
  assert.deepEqual(await lookupBarcode("4000000000000", reply(200, { status: 0 })), { status: "missing" });
  assert.deepEqual(await lookupBarcode("4000000000000", reply(200, { status: 1, product: { product_name: "Sample Tea", nutriments: {} } })), { status: "missing", name: "Sample Tea" });
  assert.equal((await lookupBarcode("4000000000000", reply(503, {}))).status, "error");
  assert.equal((await lookupBarcode("4000000000000", async () => { throw new TypeError("offline"); })).status, "error");
  assert.equal((await lookupBarcode("4000000000000", async () => ({ status: 200, ok: true, json: async () => { throw new SyntaxError("x"); } }))).status, "error");
});

test("spokenQuery turns what was said into a search", () => {
  assert.equal(spokenQuery("I had two boiled eggs for breakfast."), "boiled egg");
  assert.equal(spokenQuery("Add a banana"), "banana");
  assert.equal(spokenQuery("log 2 cups of oats"), "oat");
  assert.equal(spokenQuery("chicken breast"), "chicken breast");
  assert.equal(spokenQuery("Greek yogurt with my lunch"), "greek yogurt");
  assert.equal(spokenQuery("hummus"), "hummus");
  assert.equal(spokenQuery("tomatoes"), "tomato");
  assert.equal(spokenQuery("  "), "");
  assert.equal(spokenQuery(undefined), "");
});

test("an empty nutrient string counts as not given, not as 0", () => {
  assert.equal(foodFromProduct({ product_name: "Made-up bar", nutriments: { ...per100, "energy-kcal_100g": "", "energy_100g": "" } }, "4000000000013"), null);
});
