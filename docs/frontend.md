---
owns:
  - app.js
  - ui.js
status: current
---

# Frontend

`app.js` is the shell: it routes tabs and renders each into the one `<main id="view">` element of `index.html`, re-reading current state from IndexedDB each time (rendering is async; a newer render wins over a slower one). Feature views live in their own modules (`nutrition-view.js`, see [nutrition.md](nutrition.md); `weight-view.js`, see [weight.md](weight.md); `workouts-view.js`, see [workouts.md](workouts.md)); `app.js` forwards taps on any `[data-act]` element in the view to them (acts starting `lift-` go to the workouts view, `w-` to the weight view, the rest to nutrition), and every input and change event in the view to the workouts view (set rows and its selects). `ui.js` holds shared helpers: `esc()`, number formats, ids, and the general bottom sheet.

## Tabs

The bottom bar has three tabs. The current tab lives in the URL hash (`#today`, `#nutrition`, `#workouts`; anything else shows Today), so a reload or a link lands on the same tab. Changing tabs moves focus to the view and marks the tab button with `aria-current="page"`.

| Tab | What it shows now |
|-----|-------------------|
| Today | Greeting by time of day, the date, Calories and Protein tiles plus smaller Carbs and Fat tiles (left of today's targets, see [nutrition.md](nutrition.md#today-tab)), a "Log food" button, the weight card (7-day average, progress to goal, chart; see [weight.md](weight.md)), and a "Next workout" card (the next plan day with a Start button, or the session in progress with Continue; see [workouts.md](workouts.md)) |
| Nutrition | The day's food log against the targets, with the profile, add-food and my-foods sheets. See [nutrition.md](nutrition.md) |
| Workouts | Train / Progress / Plan, ported from Liftlog: the plan builder, logging a session, records and charts. See [workouts.md](workouts.md) |

If IndexedDB cannot be opened (private browsing in some browsers, storage blocked), every tab shows a "Storage is unavailable" banner and nothing is saved.

## General sheet

`ui.js` drives a second `<dialog>` (`#panel-dialog`, same bottom-sheet look) that views fill with their own content: `openPanel(html, handlers)` shows it, `swapPanel()` replaces its content for the next step of a flow (with a back button), `closePanel()` hides it. Handlers get every tap on a `[data-act]` element, every form submit (default prevented) and every input change inside it; `data-act="close"` always closes. Forms use `novalidate` and show the first problem in a status line.

## Data & backup sheet

The header's download button opens a `<dialog>` (a bottom sheet on a phone, centered from 640px wide). It shows how many records are stored and when the last export and import happened, and has two actions:

- **Export backup (JSON)** records the export time, then downloads `genki-backup-<date>.json` with every store's records.
- **Import backup...** picks a file, validates it (see [data-flow.md](data-flow.md#backup-file)), shows the error in the sheet if it is not a valid backup, otherwise asks for confirmation and replaces the stored data with the backup's.

Below them is the **Sync** section (`sync-view.js`, see [sync.md](sync.md)): a token field until a token is saved, then the last sync time and Sync now, Restore from genki-data... and Remove token, with its own status line. The sheet scrolls inside itself when it is taller than the screen.

Tapping the backdrop or the close button closes the sheet. Messages appear in a status line inside the sheet.

## Conventions

- Views are template strings; any stored or user-provided text goes through `esc()` before it reaches `innerHTML`.
- No URL routes beyond the tab hash; there is one HTML page.
