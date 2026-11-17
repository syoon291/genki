---
owns:
  - app.js
status: current
---

# Frontend

The whole UI is `app.js`, rendered into the one `<main id="view">` element of `index.html`. Each tab re-renders the view from current state.

## Tabs

The bottom bar has three tabs. The current tab lives in the URL hash (`#today`, `#nutrition`, `#workouts`; anything else shows Today), so a reload or a link lands on the same tab. Changing tabs moves focus to the view and marks the tab button with `aria-current="page"`.

| Tab | What it shows now |
|-----|-------------------|
| Today | Greeting by time of day, the date, "Calories left" and "Protein left" tiles (placeholders until the nutrition phase adds targets), and a "Next workout" card linking to Workouts |
| Nutrition | Placeholder card describing what is coming (profile and targets, food log, weigh-ins) |
| Workouts | Placeholder card describing what is coming (plans, set logging, records, volume) |

If IndexedDB cannot be opened (private browsing in some browsers, storage blocked), every tab shows a "Storage is unavailable" banner and nothing is saved.

## Data & backup sheet

The header's download button opens a `<dialog>` (a bottom sheet on a phone, centered from 640px wide). It shows how many records are stored and when the last export and import happened, and has two actions:

- **Export backup (JSON)** records the export time, then downloads `genki-backup-<date>.json` with every store's records.
- **Import backup...** picks a file, validates it (see [data-flow.md](data-flow.md#backup-file)), shows the error in the sheet if it is not a valid backup, otherwise asks for confirmation and replaces the stored data with the backup's.

Tapping the backdrop or the close button closes the sheet. Messages appear in a status line inside the sheet.

## Conventions

- Views are template strings; any stored or user-provided text goes through `esc()` before it reaches `innerHTML`.
- No URL routes beyond the tab hash; there is one HTML page.
