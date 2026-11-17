// Food search and serving units. Pure functions (no DOM, no IndexedDB) so they
// run under `node --test`; app.js fetches the bundled tables in foods/ and
// passes them in.
//
// A food, whatever its source:
//   { id, name, source: "my" | "jp" | "us", kcal, protein, fat, carbs,
//     per: "100 g" | "serving", units: [{ label, grams? , factor }] }
// Nutrients are per `per`; a unit's `factor` multiplies them for one of that unit.

export const SOURCES = {
  my: "My food",
  jp: "Japan table",
  us: "USDA",
};

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
  return { id: f.id, name: f.name, source: "my", kcal: f.kcal, protein: f.protein, fat: f.fat ?? 0, carbs: f.carbs ?? 0, per: "serving", units, key: searchKey(f.name), uses: f.uses ?? 0, lastUsed: f.lastUsed ?? "" };
}

// Lower-case, accents and punctuation stripped, so "Café au lait" finds "cafe".
export function searchKey(s) {
  return String(s).normalize("NFKD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
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
  const r = (n) => Math.round(n * 1e6) / 1e6; // per-gram values are tiny: keep precision
  return {
    id, date, meal,
    name: food.name,
    source: food.source,
    ref: food.id,
    amount,
    unit: unit.label,
    base: { kcal: r(food.kcal * unit.factor), protein: r(food.protein * unit.factor), fat: r(food.fat * unit.factor), carbs: r(food.carbs * unit.factor) },
    createdAt: now.toISOString(),
  };
}

// Recently used my foods first, for the add sheet before anything is typed.
export function recentMyFoods(myFoods, limit = 12) {
  return [...myFoods].sort((a, b) => (b.lastUsed ?? "").localeCompare(a.lastUsed ?? "") || (b.uses ?? 0) - (a.uses ?? 0)).slice(0, limit);
}

// "1 large (50 g)", "g", "serving".
export function unitLabel(u) {
  return u.grams && u.label !== "g" ? `${u.label} (${u.grams} g)` : u.label;
}
