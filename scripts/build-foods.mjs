// Builds the bundled food tables in foods/ from the public source files.
// Run by hand when a source updates (never in CI): see docs/food-data.md.
//
//   node scripts/build-foods.mjs <source-dir>
//
// <source-dir> holds:
//   mext2020.xlsx    MEXT Standard Tables of Food Composition in Japan 2020, chapter 2 data
//                    (https://www.mext.go.jp/content/20201225-mxt_kagsei-mext_01110_012.xlsx)
//   mext2015en.xlsx  The 2015 English edition, for English food names
//                    (https://www.mext.go.jp/component/english/__icsFiles/afieldfile/2017/12/25/1374049_1r12_1.xlsx)
//   sr/              USDA FoodData Central SR Legacy CSV, unzipped
//                    (https://fdc.nal.usda.gov/fdc-datasets/FoodData_Central_sr_legacy_food_csv_2018-04.zip)
//
// Output rows are [id, name, kcal, protein, fat, carbs] per 100 g, plus for
// USDA foods a list of household portions [label, grams].
import { readFileSync, writeFileSync, readdirSync, existsSync } from "node:fs";
import { join } from "node:path";
import { readSheet } from "./xlsx.mjs";

const src = process.argv[2];
if (!src) { console.error("usage: node scripts/build-foods.mjs <source-dir>"); process.exit(1); }

const r1 = (n) => Math.round(n * 10) / 10;

// MEXT cells: "12.7", "(11.3)" (an estimate), "Tr" (trace), "(0)", "-" (not measured), "*".
function mextNum(v) {
  if (v === undefined || v === null) return null;
  const s = String(v).replace(/[()（）]/g, "").trim();
  if (s === "Tr" || s === "(Tr)") return 0;
  const n = Number(s);
  return s !== "" && Number.isFinite(n) ? n : null;
}

// English names in the 2015 edition carry footnote stars and synonyms:
// "Common oats*, oatmeal, raw\r\n［*Syn. Oats］" -> "Common oats, oatmeal, raw (oats)".
function cleanEnglish(name) {
  let syn = [];
  let s = name.replace(/［\s*\*?\s*Syn\.\s*([^］]+)］/g, (_, x) => { syn.push(x.trim()); return ""; });
  s = s.replace(/［[^］]*］/g, "").replace(/\*/g, "").replace(/\s+/g, " ").replace(/\s+,/g, ",").trim();
  syn = syn.filter((x) => !s.toLowerCase().includes(x.toLowerCase()));
  return syn.length ? `${s} (${syn.join(", ").toLowerCase()})` : s;
}

function buildMext() {
  const isFood = (r) => /^\d{5}$/.test(r[1] ?? "");
  const english = new Map(readSheet(join(src, "mext2015en.xlsx"), 1).filter(isFood).map((r) => [r[1], cleanEnglish(r[3])]));
  const rows = readSheet(join(src, "mext2020.xlsx"), 1).filter(isFood);
  const out = [];
  let unnamed = 0;
  for (const r of rows) {
    const name = english.get(r[1]);
    if (!name) { unnamed++; continue; }
    // Columns of the 2020 sheet: 6 kcal, 8 protein from amino acids, 9 protein (N x factor),
    // 10 fat as triacylglycerol, 12 lipid, 20 total carbohydrate (as on a label).
    const kcal = mextNum(r[6]);
    if (kcal === null) continue;
    const protein = mextNum(r[9]) ?? mextNum(r[8]) ?? 0;
    const fat = mextNum(r[12]) ?? mextNum(r[10]) ?? 0;
    const carbs = mextNum(r[20]) ?? 0;
    out.push([`jp${r[1]}`, name, Math.round(kcal), r1(protein), r1(fat), r1(carbs)]);
  }
  return { foods: out, total: rows.length, unnamed };
}

// Minimal CSV for USDA's files: quoted fields, commas, doubled quotes.
function* csv(file) {
  const text = readFileSync(file, "utf8");
  let i = 0, row = [], field = "", q = false, header;
  const emit = () => { row.push(field); field = ""; const r = row; row = []; return r; };
  for (; i < text.length; i++) {
    const c = text[i];
    if (q) {
      if (c === '"') { if (text[i + 1] === '"') { field += '"'; i++; } else q = false; }
      else field += c;
    } else if (c === '"') q = true;
    else if (c === ",") { row.push(field); field = ""; }
    else if (c === "\n") {
      const r = emit();
      if (!header) header = r; else yield Object.fromEntries(header.map((h, j) => [h, r[j]]));
    } else if (c !== "\r") field += c;
  }
  if (field || row.length) { const r = emit(); if (header) yield Object.fromEntries(header.map((h, j) => [h, r[j]])); }
}

// Categories that are not generic foods: baby food, fast food, restaurant
// items, brand database rows, lab reference materials, regional native foods.
const SKIP_CATEGORIES = new Set(["3", "21", "24", "25", "26", "27"]);
// SR Legacy writes brand names in capitals ("KELLOGG'S", "CAMPBELL'S"); a few in title case.
const BRANDED = /\b[A-Z][A-Z'&.-]{2,}\b|®|™|\b(Pillsbury|Kraft|Nabisco|Keebler|Archway|Oscar Mayer|Hormel|Kellogg|Quaker|Campbell|Heinz|Hershey|Nestle|Ocean Spray|Tyson|Mission|Martha White|Betty Crocker|Mrs\.)\b/;

function buildUsda() {
  const dir = join(src, "sr");
  const base = existsSync(join(dir, "food.csv")) ? dir : join(dir, readdirSync(dir).find((d) => existsSync(join(dir, d, "food.csv"))));
  const foods = new Map();
  let skipped = 0;
  for (const f of csv(join(base, "food.csv"))) {
    if (SKIP_CATEGORIES.has(f.food_category_id) || BRANDED.test(f.description)) { skipped++; continue; }
    foods.set(f.fdc_id, { name: f.description.replace(/\s+/g, " ").trim(), n: {}, portions: [] });
  }
  // 1008 energy (kcal), 1003 protein, 1004 total fat, 1005 carbohydrate by difference.
  const KEYS = { 1008: "kcal", 1003: "protein", 1004: "fat", 1005: "carbs" };
  for (const r of csv(join(base, "food_nutrient.csv"))) {
    const f = foods.get(r.fdc_id);
    const k = KEYS[r.nutrient_id];
    if (f && k) f.n[k] = Number(r.amount);
  }
  const units = new Map([...csv(join(base, "measure_unit.csv"))].map((u) => [u.id, u.name]));
  for (const p of csv(join(base, "food_portion.csv"))) {
    const f = foods.get(p.fdc_id);
    const g = Number(p.gram_weight);
    if (!f || !(g > 0) || f.portions.length >= 3) continue;
    const unit = units.get(p.measure_unit_id);
    const what = [unit && unit !== "undetermined" ? unit : "", p.portion_description, p.modifier].filter(Boolean).join(" ").replace(/\s+/g, " ").trim();
    if (!what) continue;
    const amount = Number(p.amount) || 1;
    f.portions.push([`${amount === 1 ? "1" : r1(amount)} ${what}`, r1(g)]);
  }
  const out = [];
  for (const [id, f] of foods) {
    if (!Number.isFinite(f.n.kcal)) { skipped++; continue; }
    const row = [`us${id}`, f.name, Math.round(f.n.kcal), r1(f.n.protein ?? 0), r1(f.n.fat ?? 0), r1(f.n.carbs ?? 0)];
    if (f.portions.length) row.push(f.portions);
    out.push(row);
  }
  out.sort((a, b) => a[1].localeCompare(b[1]));
  return { foods: out, skipped };
}

const write = (file, meta, foods) => {
  // One food per line keeps diffs readable when a source is rebuilt.
  const body = foods.map((f) => JSON.stringify(f)).join(",\n");
  writeFileSync(file, `{"meta":${JSON.stringify(meta)},\n"foods":[\n${body}\n]}\n`);
};

const jp = buildMext();
write("foods/jp.json", {
  source: "Standard Tables of Food Composition in Japan 2020 (Eighth Revised Edition), Ministry of Education, Culture, Sports, Science and Technology (MEXT). English names from the 2015 (Seventh Revised) English edition.",
  url: "https://www.mext.go.jp/a_menu/syokuhinseibun/mext_01110.html",
  license: "Public Data License of the Government of Japan (compatible with CC BY 4.0); trimmed to energy, protein, fat and carbohydrate by genki",
  per: "100 g edible portion",
}, jp.foods);
console.log(`MEXT: ${jp.foods.length} foods (${jp.unnamed} of ${jp.total} new in 2020 have no English name and are left out)`);

const us = buildUsda();
write("foods/us.json", {
  source: "USDA FoodData Central, SR Legacy (April 2018)",
  url: "https://fdc.nal.usda.gov/",
  license: "Public domain (CC0 1.0); trimmed to energy, protein, fat and carbohydrate, generic foods only, by genki",
  per: "100 g",
}, us.foods);
console.log(`USDA: ${us.foods.length} foods (${us.skipped} branded, restaurant or incomplete left out)`);
