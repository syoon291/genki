---
owns:
  - progress.js
  - progress-view.js
status: current
---

# Progress

The Progress tab (the fourth tab, `#progress`) shows one week of the food log and the weigh-ins. It only reads: it adds no store and no record, so nothing new goes into backups or sync. The chosen view, week and "foods highest in" macro live in memory and reset on reload.

| File | Role |
|------|------|
| `progress.js` | Pure maths, unit-tested in `tests/progress.test.mjs`: the week's daily totals, averages, macro split, foods highest in a macro, the week CSV, the screen-reader message |
| `progress-view.js` | The tab: week navigation, the view switcher, the cards and charts, the CSV download |

## The week

Weeks run Monday to Sunday (`weekDays()` in `nutrition.js`). The title row has previous and next week buttons (next is off on the current week) and a label: "This week", "Last week" or the date range. Tapping the label goes back to this week. Moving weeks tells screen readers the week and its average calories (`weekMessage`).

Averages are over **logged days** only (days with at least one entry), so an unlogged day does not pull the average down. Today counts once anything is logged. Fiber, sugar and sodium are averaged over the days whose foods list them, and the screen says on how many days.

## Views

A five-button switcher (`aria-pressed`): Overview, Calories, Macros, Nutrients, Weight.

| View | What it shows |
|------|---------------|
| Overview | Calories: the daily average against the target, seven bars with the target as a dashed line (amber over target). Weight: start (first week's average), current (latest 7-day average) and change, from `summary()` in `weight.js`. Macros: the daily averages of carbs, fat and protein against their targets, each with its share of calories |
| Calories | The calorie card plus each day's kcal and how far over or under the target it was, and the week total |
| Macros | The daily split as stacked bars (carbs, fat, protein share of each day's calories, always adding up to 100 %), a table of the average split against the target split (`macroTargets()` percents), and **foods highest in** carbs, fat or protein: the top five foods by grams that week. Foods are grouped by the food they were logged from (`logKey()`); imported MyFitnessPal entries are one meal's total each, so each stays one item and shows its day |
| Nutrients | Daily averages of calories, protein, carbs and fat against the targets, then fiber, sugar and sodium where the week's foods list them (my foods, recipes and MyFitnessPal imports carry them when entered or in the export; the bundled tables carry none, so the screen says the real amounts may be higher) |
| Weight | The overall start, current and change, then the week's seven days with each weigh-in, this week's average and its change on the week before, and a Log weight button (the weight sheet from [weight.md](weight.md)) |

Without a profile the targets, target lines and over/under figures are left out and a hint points to the Nutrition tab's profile.

## Export (CSV)

**Export week (CSV)** at the bottom of every view downloads `genki-week-<monday>.csv`: a header `date,kcal,protein_g,carbs_g,fat_g,fiber_g` and one row a day, Monday first. kcal is whole, grams have one decimal. A day with nothing logged has empty cells, and fiber is empty when none of the day's foods list it. The button is off when the week has nothing logged. On the installed iPhone app the download opens the share sheet, so the file can go to Files or a message.
