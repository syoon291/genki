---
owns:
  - nutrition.js
  - foods.js
  - nutrition-view.js
  - mfp.js
  - barcode.js
  - openfoodfacts.js
  - scan-view.js
  - tests/barcode.test.mjs
  - tests/scan.test.mjs
  - foods/**
status: current
---

# Nutrition

The Nutrition tab logs what was eaten each day against four daily targets: calories, protein, carbs and fat. Carbs and fat are set as a share of calories or in grams (owner decision, replacing the earlier calories-and-protein-only targets). Targets are general guidelines for healthy adults, not medical advice, and the app says so.

| File | Role |
|------|------|
| `nutrition.js` | Targets maths (calories, protein, carbs and fat), day keys and day totals. Pure functions, unit-tested (`tests/nutrition.test.mjs`) |
| `foods.js` | Food shapes, search ranking, serving units and sizes, building a log entry, recently logged, frequently paired foods, my meals and recipe maths, the optional nutrients, the Import My foods file. Pure, unit-tested (`tests/foods.test.mjs`, `tests/logging.test.mjs`, `tests/myfoods-import.test.mjs`) |
| `nutrition-view.js` | The Nutrition tab, the Today tab's tiles, and every nutrition sheet (profile, add food, quick add, my foods and recipes, my meals, edit entry) |
| `mfp.js` | The MyFitnessPal import: reads the export's CSVs and plans what it adds. Pure, unit-tested (`tests/mfp.test.mjs`); the Data & backup sheet runs it (see [MyFitnessPal import](#myfitnesspal-import)) |
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

The tab shows one day at a time (arrows step back and forward, never past today; the day label returns to today). For each meal: its entries (each showing its calories large with a small "kcal" unit, protein below; tap one to change the amount or meal, or remove it), an add button and, once it has entries, **Save as meal** (see [My meals](#my-meals)). When the day is empty and the day before has entries, a "Repeat" button copies them in. A second tap on Repeat while it is still copying is ignored, so the day is not doubled; the water buttons are not guarded, as rapid repeats are legitimate. Adding, changing or removing food tells screen readers the day's calories and protein against the targets ([frontend.md](frontend.md#screen-reader-announcements)).

## Adding food

The add sheet picks the meal (suggested by time of day) and searches, in order: my foods, then the Japan table, then USDA. Every word typed must start a word of the food's name, in any order; my foods rank first, then names that start with the first word, then names where the typed words come early, then shorter (more generic) names. With a search typed, my meals whose names match show above the foods. The tables are fetched the first time the sheet opens and kept in memory; if they fail to load, only my foods are searched and the sheet says why.

Before anything is typed, the sheet shows **My meals** (most recently used first) and **Recently logged**: the newest entry of each distinct food in the log, from any source (table foods, my foods, quick adds, imported MyFitnessPal meals), up to 12, with the amount logged last time. Picking one opens the amount step at that amount. A my food that still exists comes back as that my food with its current numbers; anything else is logged again exactly as it was (same numbers per unit, same source and reference). `recentLogged` in `foods.js`.

**Amount step.** A **serving size** and a **number of servings**, as on a label: table foods offer 100 g, 1 g and their household portions (opening on 100 g); my foods their own serving, then 100 g and 1 g when the serving weight is known; a recent gram amount adds itself as a size ("150 g"). The entry still stores one unit and an amount (1.5 servings of 100 g is `150 g`), so the log looks as before. Then the meal, the days, **Often eaten with** (below), a preview and, for table foods, "Also save this amount to my foods".

**Often eaten with** (frequently paired foods): the amount step lists up to 5 foods logged in the same meal of the same day as this one at least twice, most often first, each with the amount from the latest meal they shared and how many times. Ticking one adds it too, to the same meal and days, and the preview counts it. `pairedFoods` in `foods.js` (foods are told apart as in Recently logged).

**Several days.** The amount step, quick add and a my meal show this week's days (Monday first) as toggles, the shown day pressed. Days after today cannot be picked (the day navigation never goes past today either). Adding with several days pressed adds one entry per day, and the button says how many ("Add to 3 days").

**Share of today's targets.** Every preview (amount step, quick add, my meal, edit entry) shows the calories, protein, carbs and fat, any fiber, sugar and sodium, and, with a profile, what share of each daily target that is ("23 % of today's calories"; "each day" when several days are pressed). `pctOfTargets` in `nutrition.js`.

**Quick add** takes a name, kcal and protein (carbs, fat, fiber, sugar and sodium optional) straight from a label, logged as one serving, and can save it to my foods.

**My foods** are the owner's own items with per-serving numbers (name, optional brand or place, serving label, optional serving weight, kcal, protein, carbs, fat, and optional fiber, sugar and sodium). The My foods sheet lists, creates, edits and deletes them; each use bumps a counter and a last-used time. The brand shows under the name and is searched with it ("qdoba bowl").

### Barcode scan

The barcode button beside the search box ("Scan a barcode"; **Scan barcode** in the My foods sheet) opens the scanner: the back camera's picture inside the sheet with a guide box, **Take a photo instead** (the phone's camera or photo library, for when the live camera will not start or focus), and a field for the digits under the bars. It reads EAN-13, UPC-A, EAN-8 and UPC-E codes.

- **Reading the bars** happens on the phone, in `barcode.js` (bundled, no remote script): about ten times a second it reads 11 rows across the guide box of a camera frame, turns each into runs of dark and light (edges placed between pixels, two thresholds: the row's midpoint and a local one for uneven light), matches the guard bars and digit patterns, and checks the check digit. A code is taken once two rows of one frame, or two frames in a row, agree. A photo is read across 31 rows and 31 columns at two sizes. Codes are stored in one form: UPC-A and UPC-E as their 13-digit EAN (a leading 0), EAN-8 as it is (`normalizeBarcode`).
- **A my food with that barcode** goes straight to the amount step, with no lookup.
- **Otherwise genki asks Open Food Facts** (`openfoodfacts.js`), the open database of food packages: one GET to `world.openfoodfacts.org/api/v2/product/<code>.json` for the fields it uses, with no cookies and no referrer, so only the barcode leaves the phone. Its numbers become a my food per the package's serving when it gives one in g or ml (else per 100 g or 100 ml), with kcal worked out from kJ and sodium from salt when only those are given (`foodFromProduct`). The **Save to my foods** step shows them in the usual my food fields, to check against the label and correct; saving stores the my food with its `barcode`, so the next scan finds it on the phone. From the add sheet it then opens the amount step; from My foods it returns to the list.
- **Not found** (or found without calories, or no connection): the same step opens empty (with the product's name if it had one) and says why; typing the label's numbers and saving makes the next scan find it.
- The camera stops when a code is read, on Back and when the sheet closes. If the camera is refused or missing (or has not started after 8 seconds), the scanner says so and the photo and the typed number still work. Open Food Facts data is under the Open Database License; a scanned food is a copy kept on the owner's phone, never in this repo.

### Voice search

When the browser has speech recognition (Safari on iPhone does), a mic button sits beside the search box. Tapping it listens once in the phone's language and puts what was said into the search as it is heard: leading "add / log / I had", amounts and units ("two cups of"), a trailing "for breakfast" and punctuation are dropped, and plurals lose their s, so "I had two boiled eggs for breakfast" searches "boiled egg" (`spokenQuery` in `foods.js`). The button reads "Stop listening" (pressed) while it listens. If the phone refuses (speech recognition can be off for an installed web app), a line under the search box says so and points to the keyboard's own mic, which works in any field. The words are recognised by the phone's own speech service (Apple's or Google's, which may process the audio on their servers); genki itself sends nothing. A tap on the mic after leaving and coming back to the search starts a fresh listen.

### Import My foods

**Import My foods...** in the My foods sheet reads a JSON file on the device (nothing is sent anywhere):

```json
{ "genkiMyFoods": 1,
  "foods": [{ "name": "Burrito bowl", "brand": "Sample Grill", "serving": "1 bowl", "grams": 450, "kcal": 820, "protein": 45, "carbs": 90, "fat": 28 }],
  "meals": [{ "name": "Grill lunch", "meal": "lunch", "items": [{ "food": "Burrito bowl", "servings": 1 }] }] }
```

Foods become my foods with numbers per serving (`brand`, `serving` (default "1 serving"), `grams`, `carbs`, `fat`, `fiber`, `sugar` and `sodium` are optional; `name`, `kcal` and `protein` are required). A food with the same name and brand as a my food (case and accents ignored) updates it, keeping its use count and any optional number the file leaves out (fiber added in genki survives), so importing the file again never adds it twice; a recipe is never overwritten. Meals become my meals; each item names a food in the file (with or without its brand) or an existing my food, and is that food's serving times `servings` (default 1). A meal with the same name as a my meal updates it. Its `meal` is the one its step preselects (see [My meals](#my-meals)). Foods with a missing or bad number, and meal items naming no known food, are left out and listed. A confirm prompt gives the counts (new and updated foods and meals, what is left out); cancelling changes nothing. `parseMyFoodsFile` and `planMyFoodsImport` in `foods.js` (`tests/myfoods-import.test.mjs`). The owner's own file stays on their device and is never committed here.

### Fiber, sugar and sodium

Optional on my foods, quick add, recipes and the entries made from them (fiber and sugar in g, sodium in mg); a field left empty means not known and is stored as nothing, never as 0. The bundled tables carry none of them; the MyFitnessPal import brings them in ([MyFitnessPal import](#myfitnesspal-import)). The day's summary card adds a line with their totals when any entry of the day has them (a total of the entries that carry them).

### My meals

A my meal is several foods saved as one item, such as a usual lunch. **Save as meal** under a meal of the shown day saves its foods (untick any to leave out) under a name, and remembers that meal (breakfast, lunch, ...). In the add sheet, a my meal's **+** button adds all its foods to the chosen meal on the shown day in one tap; tapping its name opens a step with its foods, a number of servings (every food times it), the meal (preselected to the one it was saved with, still changeable; a my meal saved before meals were remembered, or imported without one, takes the add sheet's meal), the days and a preview. The **+** button always uses the add sheet's meal, which its label names. Each food lands in the log as its own entry, so it can be changed or removed alone. The **My meals** button on the Nutrition tab lists them, renames them, takes foods out of them and deletes them. Stored in `myMeals` (shape in [data-flow.md](data-flow.md#store)); `mealEntries` and `itemsTotal` in `foods.js`.

### Recipes

**New recipe** in My foods: a name, how many servings it makes, what one serving is called, and ingredients, each picked from the same search (recently logged, my foods, both tables) with a serving size and a number of servings. The preview shows the numbers per serving: the ingredients' total divided by the servings. A recipe is saved as a my food with those per-serving numbers and its ingredients kept beside them (`recipe` in the record), so it is searched, listed as recent and logged like any my food, and editing it from My foods reopens the recipe. Changing a recipe never rewrites days already logged. `recipePerServing` in `foods.js`.

## Weekly history

Weekly nutrition averages from another app (for example an old tracker's export) can be imported as read-only history: the Nutrition tab's **Weekly history** button opens a sheet that lists the weeks newest first (dates, kcal a day, protein, carbs, fat and fiber in grams, and the protein / carb / fat split when the file has it). They never count toward a day's targets or totals and cannot be edited in genki.

The CSV has the columns `week_start,week_end,net_kcal_per_day,protein_g,carbs_g,fat_g,fiber_g,carb_pct,fat_pct,protein_pct`. A header row names them (any order; other columns are ignored); without one they are read in that order. `week_start`, `week_end` (YYYY-MM-DD, the end on or after the start) and `net_kcal_per_day` are required, the rest may be blank; percents may end in `%`. Delimiters, quotes, a BOM, `#` lines and decimal commas work as in the weigh-in import ([weight.md](weight.md#csv-import)). Bad rows are skipped with their line number; when a week appears twice the later row wins. A confirm prompt says how many weeks will be added, over which dates, how many replace weeks already there, and what was skipped. Weeks are stored in `nutritionWeeks`, keyed by `week_start` (shape in [data-flow.md](data-flow.md#store)), so a re-import replaces matching weeks. **Remove all** (with a confirm) clears the imported weeks only, leaving a tombstone per week so sync removes them from genki-data too. Parsing is `parseWeeklyCsv` in `nutrition.js` (`tests/weekly.test.mjs`).

## MyFitnessPal import

The Data & backup sheet's **Import MyFitnessPal...** button takes the CSV files of a MyFitnessPal data export (pick one or several at once; each is recognised by its header row, so the file names do not matter). Nothing goes to a server: the files are read in the browser and the result is stored on the device like anything typed in (owner decision: a one-time import file, no token, no repo).

- **Nutrition-Summary** (`Date,Meal,Calories,Fat (g),...,Carbohydrates (g),Fiber,Sugar,Protein (g),...`): one row per day per meal, the meal's totals only (MyFitnessPal's export has no food names). Each row becomes one food-log entry on that day and meal, named "MyFitnessPal lunch", logged as `1 meal` with its kcal, protein, carbs and fat, and its fiber (g), sugar (g) and sodium (mg) from the `Fiber`, `Sugar` and `Sodium (mg)` columns when filled in (a blank cell is left out, never stored as 0; see [Fiber, sugar and sodium](#fiber-sugar-and-sodium)); the other columns are left out. Custom meal names go to snacks. Two rows for one day and meal are added together.
- **My foods from repeats**: meal totals with the same kcal (to the calorie), protein, carbs and fat (to 0.1 g) on two or more rows become one my food each, named after the meal they were most often with the calories ("Lunch 1,163 kcal"; a taken name gets " (2)"), serving `1 meal`, its use count and last-used day taken from the rows, so they show first in the add sheet's recent list. Rename them in My foods. A new one also gets the fiber, sugar and sodium of its newest row that has them. A my food already holding those four numbers (also one renamed since) is never added again (owner decision: repeats of 2+ become my foods).
- **Re-importing fills in fiber, sugar and sodium**: a meal entry or my food an earlier import made (found by its fixed id) that lacks any of the three gets it from the file; nothing else about it changes (amount, meal, name, a rename), and one it already has is never overwritten. A my food of the owner's own with the same numbers is left alone. The confirm prompt says how many meals and my foods get them. `planMfpImport` returns them as `fillEntries` and `fillFoods`.
- **Measurement-Summary** (`Date,Weight`, only on days a weight was logged): read as lb unless the header says kg, converted to kg at 0.1 kg. Weights only fill days with no weigh-in; a day that has one keeps it. The profile weight then follows the 7-day average as after any weigh-in change ([weight.md](weight.md#profile-weight)).
- **Exercise-Summary** (exercise calories and steps): each day's rows are added up and fill that day's exercise in the `days` store, only on days with no exercise logged (the day's water is kept). See [trackers.md](trackers.md#exercise). Any other file is left out and named in the prompt.

Imported entries have `source: "mfp"` and the id `mfp-<date>-<meal>`, so importing the same files again adds nothing twice: an entry already stored is left as it is (an amount or meal changed in genki survives), and removing one then re-importing brings it back. Days after today are skipped, and so are rows with a bad date or number (with the count in the prompt). A confirm prompt says how many meals, my foods and weigh-ins will be added, over which dates, and what is already here or left out; cancelling changes nothing. Parsing and planning are `parseMfpNutrition`, `parseMfpWeights` and `planMfpImport` in `mfp.js`.

The GitHub sync ([sync.md](sync.md)) stays as it was: optional, and not needed for this import.

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
