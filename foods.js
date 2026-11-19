// Food search and serving units. Pure functions (no DOM, no IndexedDB) so they
// run under `node --test`; app.js fetches the bundled tables in foods/ and
// passes them in.
//
// A food, whatever its source:
//   { id, name, source: "my" | "jp" | "us" | "quick" | "mfp", kcal, protein, fat, carbs,
//     fiber?, sugar?, sodium?, per: "100 g" | "serving" | a unit, units: [{ label, grams? , factor }] }
// Nutrients are per `per`; a unit's `factor` multiplies them for one of that unit.
// fiber and sugar are grams, sodium milligrams; each is optional (null or
// missing when not known: the bundled tables carry none of them).

// The optional nutrients, in display order.
export const EXTRAS = [
  { id: "fiber", label: "Fiber", unit: "g" },
  { id: "sugar", label: "Sugar", unit: "g" },
  { id: "sodium", label: "Sodium", unit: "mg" },
];

export const SOURCES = {
  my: "My food",
  jp: "Japan table",
  us: "USDA",
  mfp: "MyFitnessPal",
  quick: "Quick add",
};

// The optional nutrients a record holds, as { fiber, sugar, sodium } with only
// the known ones (numbers >= 0) present.
export function extrasOf(o) {
  const out = {};
  for (const { id } of EXTRAS) if (Number.isFinite(o?.[id]) && o[id] >= 0) out[id] = o[id];
  return out;
}

// Rows from foods/*.json: [id, name, kcal, protein, fat, carbs, portions?].
export function fromTableRow(row, source) {
  const [id, name, kcal, protein, fat, carbs, portions = []] = row;
  const units = [{ label: "g", grams: 1, factor: 0.01 }];
  for (const [label, grams] of portions) units.push({ label, grams, factor: grams / 100 });
  return { id, name, source, kcal, protein, fat, carbs, per: "100 g", units, key: searchKey(name) };
}

// A saved "my food": nutrients per serving, optionally with the serving's weight in grams.
export function fromMyFood(f) {
  const units = [{ label: f.serving || "serving", factor: 1 }];
  if (f.grams > 0) units.push({ label: "g", grams: 1, factor: 1 / f.grams });
  return { id: f.id, name: f.name, source: "my", kcal: f.kcal, protein: f.protein, fat: f.fat ?? 0, carbs: f.carbs ?? 0, ...extrasOf(f), per: "serving", units, key: searchKey(f.brand ? `${f.name} ${f.brand}` : f.name), brand: f.brand || "", uses: f.uses ?? 0, lastUsed: f.lastUsed ?? "", recipe: !!f.recipe };
}

// A food rebuilt from a log entry, so it can be logged again as it was: its
// nutrients are per one of the entry's unit. `ref` and `source` carry over.
export function fromEntry(e) {
  const b = e.base;
  const units = [{ label: e.unit, factor: 1, ...(e.unit === "g" ? { grams: 1 } : {}) }];
  return { id: `log:${e.id}`, logKey: logKey(e), ref: e.ref ?? null, name: e.name, source: e.source, kcal: b.kcal, protein: b.protein, fat: b.fat ?? 0, carbs: b.carbs ?? 0, ...extrasOf(b), per: e.unit, units, key: searchKey(e.name) };
}

// The "Recently logged" list: the newest entry of each distinct food (any
// source), newest first, as { food, unit, amount } to log it again the same
// way. A food from my foods that still exists comes back as that my food, with
// its current numbers. myFoods: raw my-food records.
export function recentLogged(entries, myFoods, limit = 12) {
  const mine = new Map(myFoods.map((f) => [f.id, f]));
  const sorted = [...entries].sort((a, b) => (b.createdAt ?? "").localeCompare(a.createdAt ?? ""));
  const seen = new Set();
  const out = [];
  for (const e of sorted) {
    const k = logKey(e);
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(relog(e, mine));
    if (out.length >= limit) break;
  }
  return out;
}

// One key per distinct food in the log: a table or my food by its id, anything
// else (quick add, imported meal totals) by its name and calories.
export function logKey(e) {
  return e.source === "my" || e.source === "jp" || e.source === "us" ? `${e.source}:${e.ref ?? e.name}` : `${e.source}:${searchKey(e.name)}:${e.base?.kcal}`;
}

// The key of a food in the add sheet, matching logKey() of its entries.
export function foodLogKey(food) {
  return food.logKey ?? `${food.source}:${food.ref ?? food.id}`;
}

// { food, unit, amount } to log entry `e` again (see recentLogged).
function relog(e, mine) {
  const mf = e.source === "my" && mine.get(e.ref);
  if (mf) {
    const food = fromMyFood(mf);
    const unit = food.units.find((u) => u.label === e.unit) ?? food.units[0];
    return { food, unit: unit.label, amount: unit.label === e.unit ? e.amount : 1 };
  }
  return { food: fromEntry(e), unit: e.unit, amount: e.amount };
}

// Frequently paired foods: the foods most often logged in the same meal of the
// same day as the food `key` (a logKey), at least `min` times, most often
// first (then most recent), each as { food, unit, amount, count } with the
// amount from the latest meal they shared.
export function pairedFoods(entries, key, myFoods, { limit = 5, min = 2 } = {}) {
  const groups = new Map();
  for (const e of entries) {
    const g = `${e.date}|${e.meal}`;
    if (!groups.has(g)) groups.set(g, []);
    groups.get(g).push(e);
  }
  const counts = new Map(); // key -> { count, latest entry }
  for (const list of groups.values()) {
    if (!list.some((e) => logKey(e) === key)) continue;
    const seen = new Set([key]);
    for (const e of list) {
      const k = logKey(e);
      if (seen.has(k)) continue;
      seen.add(k);
      const c = counts.get(k);
      if (!c) counts.set(k, { count: 1, e });
      else { c.count++; if ((e.createdAt ?? "") > (c.e.createdAt ?? "")) c.e = e; }
    }
  }
  const mine = new Map(myFoods.map((f) => [f.id, f]));
  return [...counts.values()]
    .filter((c) => c.count >= min)
    .sort((a, b) => b.count - a.count || (b.e.createdAt ?? "").localeCompare(a.e.createdAt ?? ""))
    .slice(0, limit)
    .map((c) => ({ ...relog(c.e, mine), count: c.count }));
}

// Serving sizes for the amount step: a size is one unit of the food times
// `per`, so "100 g" is 100 of the gram unit. An entry stores amount = number of
// servings x per, in the unit, so the log keeps its shape ("150 g", "2 x 1 large").
// `extraGrams` adds a gram size (the amount logged last time, for example).
export function servingSizes(food, extraGrams = null) {
  const out = [];
  const g = food.units.findIndex((u) => u.label === "g");
  for (let i = 0; i < food.units.length; i++) {
    if (i === g) continue;
    out.push({ label: unitLabel(food.units[i]), unit: i, per: 1 });
  }
  if (g >= 0) {
    const grams = [100, 1];
    if (extraGrams > 0 && !grams.includes(extraGrams)) grams.unshift(extraGrams);
    const gs = grams.map((n) => ({ label: `${Math.round(n * 10) / 10} g`, unit: g, per: n }));
    // Table foods (per 100 g) open on 100 g; my foods on their own serving.
    if (food.per === "100 g" || food.units.length === 1) out.unshift(...gs); else out.push(...gs);
  }
  return out;
}

// Lower-case, accents and punctuation stripped, so "Café au lait" finds "cafe".
export function searchKey(s) {
  return String(s).normalize("NFKD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

// What was said, as a search: "I had two boiled eggs for breakfast." -> "boiled egg".
// Leading "add / log / I had / I ate", amounts and units ("2 cups of"), a
// trailing "for lunch" and punctuation go; plurals lose their s so the
// word-start search finds both forms ("eggs" -> "egg", "tomatoes" -> "tomato").
const SPOKEN_LEAD = /^(?:(?:please|um+|uh+|ok(?:ay)?|so|and|then|also|just|i|i've|i'd|we|add|log|put|track|had|have|ate|eaten|drank|got|some|a|an|the|one|two|three|four|five|six|seven|eight|nine|ten|half|quarter|couple|few|of|[\d.,/]+|cups?|glass(?:es)?|bowls?|plates?|pieces?|slices?|servings?|portions?|cans?|bottles?|packs?|bars?|scoops?|spoons?|tablespoons?|teaspoons?|tbsp|tsp|handfuls?|grams?|g|kilos?|ml|oz|ounces?|pounds?|lbs?)\s+)+/;
const SPOKEN_TAIL = /\s+(?:(?:for|at|with|as|to)\s+(?:my\s+)?(?:breakfast|lunch|dinner|supper|snacks?|today|tonight|this\s+morning))+$/;
export function spokenQuery(text) {
  let s = String(text ?? "").toLowerCase().replace(/[.!?;:"“”]+/g, " ").replace(/\s+/g, " ").trim();
  for (let i = 0; i < 3; i++) s = s.replace(SPOKEN_TAIL, "").replace(SPOKEN_LEAD, "");
  return s.split(" ").map((w) => (w.length > 3 && /oes$/.test(w) ? w.slice(0, -2) : w.length > 3 && /[^su]s$/.test(w) ? w.slice(0, -1) : w)).join(" ").trim();
}

// Words of the query must each start a word of the name (any order).
// Ranked: my foods first, then names that start with the query, then names
// where the words come early, then shorter (more generic) names. `lists` is an array of food arrays, searched in order.
export function searchFoods(query, lists, limit = 40) {
  const words = searchKey(query).split(" ").filter(Boolean);
  if (!words.length) return [];
  const hits = [];
  for (const list of lists) {
    for (const f of list) {
      const key = f.key ?? searchKey(f.name);
      const nameWords = key.split(" ");
      let ok = true, spread = 0;
      for (const w of words) {
        const at = nameWords.findIndex((nw) => nw.startsWith(w));
        if (at < 0) { ok = false; break; }
        spread += at;
        // A whole word beats a prefix: "egg" finds "Egg, whole" before "Eggnog".
        if (!nameWords.includes(w)) spread += 5;
      }
      if (!ok) continue;
      let score = f.source === "my" ? 0 : 1000;
      // Query words near the front of the name ("Chicken, breast" over "Chicken, offal, skin, breast").
      score += spread * 6;
      if (!key.startsWith(words[0])) score += 200;
      // A raw/plain form first: fewer words and shorter names rank higher.
      score += nameWords.length * 4 + key.length * 0.1;
      hits.push({ f, score });
    }
  }
  hits.sort((a, b) => a.score - b.score);
  return hits.slice(0, limit).map((h) => h.f);
}

// A log entry for `amount` of `unit` (one of food.units) of `food`.
export function makeEntry(food, unit, amount, { id, date, meal, now = new Date() }) {
  return {
    id, date, meal,
    name: food.name,
    source: food.source,
    ref: food.ref !== undefined ? food.ref : food.id,
    amount,
    unit: unit.label,
    base: scaleNutrients(food, unit.factor),
    createdAt: now.toISOString(),
  };
}

// kcal, protein, fat, carbs (and the known extras) of `food` times k.
export function scaleNutrients(food, k) {
  const r = (n) => Math.round(n * 1e6) / 1e6; // per-gram values are tiny: keep precision
  const out = { kcal: r(food.kcal * k), protein: r(food.protein * k), fat: r((food.fat ?? 0) * k), carbs: r((food.carbs ?? 0) * k) };
  for (const [id, v] of Object.entries(extrasOf(food))) out[id] = r(v * k);
  return out;
}

// ---------- my meals and recipes ----------
// An item (of a my meal or a recipe) is a log entry without its day, meal or
// id: { name, source, ref, amount, unit, base }. Nutrients eaten: base x amount.

export function itemFromEntry(e) {
  return { name: e.name, source: e.source, ref: e.ref ?? null, amount: e.amount, unit: e.unit, base: { ...e.base } };
}

// Total nutrients of a list of items (or entries), extras only when some item has them.
export function itemsTotal(items) {
  const t = { kcal: 0, protein: 0, fat: 0, carbs: 0 };
  const ex = {};
  for (const it of items) {
    const k = it.amount;
    t.kcal += it.base.kcal * k; t.protein += it.base.protein * k; t.fat += (it.base.fat ?? 0) * k; t.carbs += (it.base.carbs ?? 0) * k;
    for (const [id, v] of Object.entries(extrasOf(it.base))) ex[id] = (ex[id] ?? 0) + v * k;
  }
  return { ...t, ...ex };
}

// The entries that log a my meal: every item times `servings`, on `date` in `meal`.
// ids: a function returning a new id. Each entry is a little later than the
// one before, so the meal keeps its order in the log.
export function mealEntries(myMeal, { date, meal, servings = 1, now = new Date(), ids }) {
  return myMeal.items.map((it, i) => ({
    id: ids(), date, meal,
    name: it.name, source: it.source, ref: it.ref ?? null,
    amount: Math.round(it.amount * servings * 1e6) / 1e6, unit: it.unit, base: { ...it.base },
    createdAt: new Date(now.getTime() + i).toISOString(),
  }));
}

// A recipe's numbers per serving: the ingredients' total over `servings`,
// rounded as a my food is (kcal to 1, grams to 0.1, sodium to 1 mg).
export function recipePerServing(items, servings) {
  const t = itemsTotal(items);
  const n = servings > 0 ? servings : 1;
  const r1 = (v) => Math.round((v / n) * 10) / 10;
  const out = { kcal: Math.round(t.kcal / n), protein: r1(t.protein), fat: r1(t.fat), carbs: r1(t.carbs) };
  if (t.fiber !== undefined) out.fiber = r1(t.fiber);
  if (t.sugar !== undefined) out.sugar = r1(t.sugar);
  if (t.sodium !== undefined) out.sodium = Math.round(t.sodium / n);
  return out;
}

// "1 large (50 g)", "g", "serving".
export function unitLabel(u) {
  return u.grams && u.label !== "g" ? `${u.label} (${u.grams} g)` : u.label;
}

// ---------- Import My foods (a JSON file) ----------
// { genkiMyFoods: 1,
//   foods: [{ name, brand?, serving?, grams?, kcal, protein, carbs?, fat?, fiber?, sugar?, sodium? }],
//   meals: [{ name, meal?, items: [{ food (a name from foods), servings }] }] }
// Foods become my foods (numbers per serving), meals my meals. A food matches a
// my food with the same name and brand, a meal a my meal with the same name, so
// a second import updates them instead of adding them twice.

const MEAL_IDS = ["breakfast", "lunch", "dinner", "snacks"];
const foodMatchKey = (name, brand) => `${searchKey(name)}|${searchKey(brand ?? "")}`;

// Returns { ok: true, foods, meals, skipped: [reason] } or { ok: false, error }.
export function parseMyFoodsFile(text) {
  let data;
  try { data = JSON.parse(String(text).replace(/^\uFEFF/, "")); }
  catch { return { ok: false, error: "That file is not valid JSON." }; }
  if (!data || typeof data !== "object" || data.genkiMyFoods !== 1) return { ok: false, error: "That file is not a My foods file (it needs \"genkiMyFoods\": 1)." };
  const skipped = [];
  const num = (v) => (typeof v === "number" ? v : typeof v === "string" && v.trim() !== "" ? Number(v) : NaN);
  const opt = (v) => (v === undefined || v === null || v === "" ? null : num(v));
  const foods = [];
  (Array.isArray(data.foods) ? data.foods : []).forEach((f, i) => {
    const name = typeof f?.name === "string" ? f.name.trim().slice(0, 80) : "";
    if (!name) { skipped.push(`food ${i + 1}: no name`); return; }
    const out = {
      name, brand: typeof f.brand === "string" ? f.brand.trim().slice(0, 60) : "",
      serving: (typeof f.serving === "string" && f.serving.trim().slice(0, 40)) || "1 serving",
      grams: opt(f.grams), kcal: num(f.kcal), protein: num(f.protein), carbs: opt(f.carbs) ?? 0, fat: opt(f.fat) ?? 0,
      fiber: opt(f.fiber), sugar: opt(f.sugar), sodium: opt(f.sodium),
    };
    const bad = ["kcal", "protein", "carbs", "fat"].some((k) => !(out[k] >= 0 && out[k] < 10000))
      || ["fiber", "sugar", "sodium"].some((k) => out[k] !== null && !(out[k] >= 0 && out[k] < 100000))
      || (out.grams !== null && !(out.grams > 0));
    if (bad) { skipped.push(`${name}: a number is missing or out of range`); return; }
    foods.push(out);
  });
  const meals = [];
  (Array.isArray(data.meals) ? data.meals : []).forEach((m, i) => {
    const name = typeof m?.name === "string" ? m.name.trim().slice(0, 80) : "";
    if (!name) { skipped.push(`meal ${i + 1}: no name`); return; }
    const items = (Array.isArray(m.items) ? m.items : []).map((it) => ({ food: typeof it?.food === "string" ? it.food.trim() : "", servings: it?.servings === undefined ? 1 : num(it.servings) }));
    meals.push({ name, meal: MEAL_IDS.includes(m.meal) ? m.meal : null, items });
  });
  if (!foods.length && !meals.length) return { ok: false, error: `No foods or meals found in that file.${skipped.length ? ` Skipped ${skipped.slice(0, 3).join("; ")}.` : ""}` };
  return { ok: true, foods, meals, skipped };
}

// What an import writes: { foods: [my food records], meals: [my meal records],
// counts: { newFoods, updatedFoods, newMeals, updatedMeals }, skipped }.
// existingFoods / existingMeals: the stored records. Recipes are never matched
// (a file food never overwrites a recipe). ids: a function returning a new id.
export function planMyFoodsImport(parsed, existingFoods, existingMeals, { now = new Date(), ids }) {
  const at = now.toISOString();
  const skipped = [...parsed.skipped];
  const byKey = new Map(existingFoods.filter((f) => !f.recipe).map((f) => [foodMatchKey(f.name, f.brand), f]));
  const counts = { newFoods: 0, updatedFoods: 0, newMeals: 0, updatedMeals: 0 };
  const written = new Map(); // match key -> record written by this import
  for (const f of parsed.foods) {
    const k = foodMatchKey(f.name, f.brand);
    const old = written.get(k) ?? byKey.get(k);
    if (!written.has(k)) old ? counts.updatedFoods++ : counts.newFoods++;
    // An update keeps what the file leaves out (grams, fiber, sugar, sodium added in the app).
    const given = old ? Object.fromEntries(Object.entries(f).filter(([, v]) => v !== null)) : f;
    written.set(k, { ...(old ?? { id: ids(), uses: 0, lastUsed: "", createdAt: at }), ...given, importedAt: at });
  }
  // Meal items name a food from the file (with or without its brand), else an existing my food.
  const byName = new Map();
  for (const f of [...existingFoods.filter((x) => !x.recipe), ...written.values()]) byName.set(searchKey(f.name), f);
  for (const f of written.values()) byName.set(searchKey(`${f.name} ${f.brand}`), f);
  const mealsByName = new Map(existingMeals.map((m) => [searchKey(m.name), m]));
  const meals = new Map();
  for (const m of parsed.meals) {
    const items = [];
    for (const it of m.items) {
      const f = byName.get(searchKey(it.food));
      if (!f) { skipped.push(`${m.name}: no food named "${it.food}"`); continue; }
      if (!(it.servings > 0 && it.servings < 1000)) { skipped.push(`${m.name}: ${it.food} has no valid servings`); continue; }
      items.push({ name: f.name, source: "my", ref: f.id, amount: it.servings, unit: f.serving || "1 serving", base: { kcal: f.kcal, protein: f.protein, fat: f.fat ?? 0, carbs: f.carbs ?? 0, ...extrasOf(f) } });
    }
    if (!items.length) { skipped.push(`${m.name}: none of its foods were found`); continue; }
    const k = searchKey(m.name);
    const old = meals.get(k) ?? mealsByName.get(k);
    if (!meals.has(k)) old ? counts.updatedMeals++ : counts.newMeals++;
    meals.set(k, { ...(old ?? { id: ids(), uses: 0, lastUsed: "", createdAt: at }), name: m.name, meal: m.meal, items, importedAt: at });
  }
  return { foods: [...written.values()], meals: [...meals.values()], counts, skipped };
}
