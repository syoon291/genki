---
owns:
  - nutrition.js
  - foods.js
  - nutrition-view.js
  - foods/**
status: current
---

# Nutrition

The Nutrition tab logs what was eaten each day against four daily targets: calories, protein, carbs and fat. Carbs and fat are set as a share of calories or in grams (owner decision, replacing the earlier calories-and-protein-only targets). Targets are general guidelines for healthy adults, not medical advice, and the app says so.

| File | Role |
|------|------|
| `nutrition.js` | Targets maths (calories, protein, carbs and fat), day keys and day totals. Pure functions, unit-tested (`tests/nutrition.test.mjs`) |
| `foods.js` | Food shapes, search ranking, serving units, building a log entry. Pure, unit-tested (`tests/foods.test.mjs`) |
| `nutrition-view.js` | The Nutrition tab, the Today tab's tiles, and every nutrition sheet (profile, add food, quick add, my foods, edit entry) |
| `foods/jp.json`, `foods/us.json` | The bundled food tables (see [Food tables](#food-tables)) |

## Targets

From the profile (sex, year of birth, height, weight, activity, optional goal weight and target date, deficit, protein per kg):

- **Resting energy**: Mifflin-St Jeor. Men `10 x kg + 6.25 x cm - 5 x age + 5`; women the same with `- 161`. Age is the current year minus the year of birth.
- **Maintenance**: resting energy x activity factor (sedentary 1.2, light 1.375, moderate 1.55, active 1.725, very active 1.9).
- **Calorie target**: maintenance minus the profile's daily deficit (default 500 kcal, about 0.45 kg a week; 0-1000 allowed), rounded to 10 kcal, never below a floor of 1200 kcal (women) or 1500 kcal (men). When the floor applies, the profile preview says so, and the real deficit (maintenance minus target) is what the projection uses.
- **Protein target**: weight x grams per kg (default 1.8, allowed 1.6-2.2).
- **Carbs and fat**: set in the profile sheet either as a percent of the calorie target or as grams a day (4 kcal per gram of carbs and protein, 9 per gram of fat). The sheet shows both columns side by side and fills the one not being typed in. Whichever side was edited last is what is saved (`macroMode` `"pct"` or `"g"`): as percents, the grams follow the calorie target whenever it changes (a new weight, deficit or activity level); as grams, the grams stay put and the percents shown follow. With no saved choice (`macroMode` null, also every profile saved before this existed), fat is 30 % of calories and carbs take what protein and fat leave, so the three add up to 100 %. Protein stays set in g per kg; its share of calories is shown alongside. When the three add up to more or less than the calorie target (beyond 2 %), the preview says so; carbs plus fat over 100 % will not save. Conversions are `gramsFromPct`, `pctFromGrams` and `macroTargets` in `nutrition.js`.
- **Projection**: with a goal weight below the current weight, days to goal = kg to lose x 7700 kcal / real deficit. The preview shows that date and whether it lands on or before the target date. The target date never changes the deficit (owner decision: a fixed, adjustable deficit).

`profileProblems()` validates a profile (adults 18-100, plausible height and weight ranges, the deficit and protein ranges); the sheet shows the first problem and will not save until there are none. Weight is entered in kg with lb shown under the field.

Once there are weigh-ins, the profile's weight follows their latest 7-day average (every weigh-in change rewrites it; see [weight.md](weight.md#profile-weight)), so the targets follow the trend. The sheet notes this under the weight field.

## Food log

Each log entry is one food eaten on one local day (`YYYY-MM-DD`) in one meal (breakfast, lunch, dinner, snacks). An entry stores its nutrients **per unit** (`base`) and the `amount` of units eaten, so editing the amount re-scales it, and later edits to a saved food never rewrite past days. Record shapes are in [data-flow.md](data-flow.md#store).

The tab shows one day at a time (arrows step back and forward, never past today; the day label returns to today). For each meal: its entries (tap one to change the amount or meal, or remove it) and an add button. When the day is empty and the day before has entries, a "Repeat" button copies them in.

## Adding food

The add sheet picks the meal (suggested by time of day) and searches, in order: my foods, then the Japan table, then USDA. Every word typed must start a word of the food's name, in any order; my foods rank first, then names that start with the first word, then names where the typed words come early, then shorter (more generic) names. Empty search shows recently used my foods. The tables are fetched the first time the sheet opens and kept in memory; if they fail to load, only my foods are searched and the sheet says why.

Picking a food asks for an amount and a unit: grams for table foods (plus USDA's household portions such as "1 large (50 g)"), the serving (and grams, when its weight is known) for my foods. A table food can be saved to my foods at the chosen amount.

**Quick add** takes a name, kcal and protein (carbs and fat optional) straight from a label, logged as one serving, and can save it to my foods.

**My foods** are the owner's own items with per-serving numbers (name, serving label, optional serving weight, kcal, protein, carbs, fat). The My foods sheet lists, creates, edits and deletes them; each use bumps a counter and a last-used time for the recent list.

## Weekly history

Weekly nutrition averages from another app (for example an old tracker's export) can be imported as read-only history: the Nutrition tab's **Weekly history** button opens a sheet that lists the weeks newest first (dates, kcal a day, protein, carbs, fat and fiber in grams, and the protein / carb / fat split when the file has it). They never count toward a day's targets or totals and cannot be edited in genki.

The CSV has the columns `week_start,week_end,net_kcal_per_day,protein_g,carbs_g,fat_g,fiber_g,carb_pct,fat_pct,protein_pct`. A header row names them (any order; other columns are ignored); without one they are read in that order. `week_start`, `week_end` (YYYY-MM-DD, the end on or after the start) and `net_kcal_per_day` are required, the rest may be blank; percents may end in `%`. Delimiters, quotes, a BOM, `#` lines and decimal commas work as in the weigh-in import ([weight.md](weight.md#csv-import)). Bad rows are skipped with their line number; when a week appears twice the later row wins. A confirm prompt says how many weeks will be added, over which dates, how many replace weeks already there, and what was skipped. Weeks are stored in `nutritionWeeks`, keyed by `week_start` (shape in [data-flow.md](data-flow.md#store)), so a re-import replaces matching weeks. **Remove all** (with a confirm) clears the imported weeks only. Parsing is `parseWeeklyCsv` in `nutrition.js` (`tests/weekly.test.mjs`).

## Food tables

Both tables are trimmed to energy, protein, fat and carbohydrate per 100 g, one row per food: `[id, name, kcal, protein, fat, carbs, portions?]`, ids prefixed `jp` / `us`. Each file's `meta` carries the source, URL and license, and the app's Nutrition tab credits both.

| File | Source | Kept | License |
|------|--------|------|---------|
| `foods-jp.json` | MEXT Standard Tables of Food Composition in Japan 2020 (8th revised edition), English names matched by food number from the 2015 English edition | 2,184 of 2,478 foods: those new in 2020 have no official English name and are left out (owner decision: English names only) | Public Data License of the Government of Japan (CC BY 4.0 compatible): credit the source |
| `foods-us.json` | USDA FoodData Central, SR Legacy (April 2018) | 6,152 generic foods with up to 3 household portions each; baby, fast-food, restaurant, branded, lab-reference and regional native categories and brand-named rows are left out | Public domain (CC0) |

MEXT values: estimates in parentheses are kept as numbers, "Tr" counts as 0, protein is the nitrogen-based value (amino-acid value when missing), fat is total lipid, carbs are total carbohydrate as on a label. USDA: energy 1008, protein 1003, fat 1004, carbohydrate by difference 1005.

`scripts/build-foods.mjs` rebuilds both files from the downloaded sources (the URLs are in its header; see [local-dev.md](local-dev.md#food-tables)). It is run by hand when a source updates, never in CI, and its output is committed. `scripts/check.mjs` fails if a table is missing from the service worker's cache list or has a malformed row.

## Today tab

The Today tab's Calories and Protein tiles, and smaller Carbs and Fat tiles under them, show what is left of today's targets (or how far over), with a bar; without a profile they show what was eaten and point to the profile. The Nutrition tab's summary card has a bar for each of the four. Below the tiles, Today shows the weight card ([weight.md](weight.md)).
