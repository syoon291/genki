---
owns:
  - weight.js
  - weight-view.js
status: current
---

# Weight

Weigh-ins live on the Today tab, under the nutrition tiles: a weight card with the 7-day average, the change on last week, progress to the goal weight, and a chart. Daily weight swings by 0.5-1 kg, so everything the card shows is built on the 7-day average, not the day's number.

| File | Role |
|------|------|
| `weight.js` | 7-day average, weekly change, goal progress, chart axis, CSV parsing. Pure, unit-tested (`tests/weight.test.mjs`) |
| `weight-view.js` | The weight card and chart, the log, history and CSV import sheets |

## Weigh-ins

A weigh-in is one weight in kg for one local day (store `weighIns`, keyed by the day; shape in [data-flow.md](data-flow.md#store)). There is at most one per day: logging a day that has one replaces it. Weights must be 30-300 kg (the profile's bounds), rounded to 0.1 kg; days in the future are refused. lb is shown beside kg.

- **Log weight** (card and history): a day (today by default) and a weight, side by side with a wider gap between the fields. Opened on a day that has one, it edits it and offers Delete, which asks to confirm (naming the day and weight) first; moving it to another day replaces that day's.
- **History**: every weigh-in, newest first, with the 7-day average on that day. Tap one to edit or delete it.
- Saving or deleting a weigh-in tells screen readers the new 7-day average ([frontend.md](frontend.md#screen-reader-announcements)).

## The numbers

- **7-day average** for a day: the mean of the weigh-ins in the 7 calendar days ending on it (missing days are skipped, not filled). The card's headline is the average ending on the latest weigh-in.
- **Change vs last week**: that average minus the average ending 7 days before the latest weigh-in; shown once both weeks have weigh-ins. It is green when it moves toward the goal.
- **Progress**: from a start weight (the average over the first 7 days of weigh-ins) to the profile's goal weight, measured with the current average: kg lost, kg to go, and a bar (0-100 %). It works for a goal above the start too. Without a goal weight the card links to the profile instead.

## Chart

An inline SVG: solid grey dots for each weigh-in (`--muted`, so they hold 7:1 in every theme), a green line for the 7-day average, a dashed green line at the goal weight, and, with a target date, a dotted plan line from the start weight on the first weigh-in day to the goal on the target date. Ranges: 1M (30 days), 3M (91 days, the default) and All (the first weigh-in to the latest, extended to the target date when that is later). The y axis pads a narrow range to at least 2 kg and steps in round numbers; the goal is always kept in view. The SVG has a text label summarising it for screen readers.

## CSV import

From the empty card or the history sheet. One `date,weight_kg` row per line, for example `2026-01-05,80.4`; an optional header row (a first line not starting with a digit), dates as `YYYY-MM-DD` (or `YYYY/MM/DD`), commas, semicolons or tabs (a row split by semicolons or tabs may use a decimal comma, e.g. `2026-01-05;80,4`), quotes, a BOM and Windows line ends are all accepted; blank lines and `#` lines are ignored. Bad rows (not a real date, no weight, a weight outside 30-300 kg) are skipped with their line number; when a day appears twice the later row wins; future days are skipped. A confirm prompt says how many weigh-ins will be added, over which days, how many replace days already logged, and what was skipped. The import adds to the existing weigh-ins (it never clears them), in one transaction.

## MyFitnessPal weights

The MyFitnessPal import (Data & backup sheet) brings weights from the export's Measurement-Summary file: lb converted to kg, and only on days with no weigh-in, so it never replaces one. Details in [nutrition.md](nutrition.md#myfitnesspal-import). `syncProfileWeight` is exported from `weight-view.js` so that import can update the profile weight afterwards.

## Profile weight

Every weigh-in change (log, edit, delete, import) sets the profile's `weightKg` to the latest 7-day average, rounded to 0.1 kg, so the calorie, protein, carb and fat targets ([nutrition.md](nutrition.md#targets)) follow the trend. Editing the profile's weight by hand still works, until the next weigh-in change rewrites it. Without a saved profile nothing is written.
