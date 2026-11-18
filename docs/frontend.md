---
owns:
  - app.js
  - ui.js
  - contrast.js
status: current
---

# Frontend

`app.js` is the shell: it routes tabs and renders each into the one `<main id="view">` element of `index.html`, re-reading current state from IndexedDB each time (rendering is async; a newer render wins over a slower one). Feature views live in their own modules (`nutrition-view.js`, see [nutrition.md](nutrition.md); `weight-view.js`, see [weight.md](weight.md); `workouts-view.js`, see [workouts.md](workouts.md)); `app.js` forwards taps on any `[data-act]` element in the view to them (acts starting `lift-` go to the workouts view, `w-` to the weight view, `p-` to the progress view, `t-` to the day trackers view, `c-` to the coach cards, the rest to nutrition), and every input and change event in the view to the workouts view (set rows and its selects). `ui.js` holds shared helpers: `esc()`, number formats, ids, and the general bottom sheet. `contrast.js` holds the High contrast setting shown in the Data & backup sheet: it sets `data-contrast="more"` on `<html>` on start and whenever the choice or the system's `prefers-contrast` changes (tokens: [design-system.md](design-system.md)).

## Tabs

The bottom bar has four tabs. The current tab lives in the URL hash (`#today`, `#nutrition`, `#workouts`, `#progress`; anything else shows Today), so a reload or a link lands on the same tab. Changing tabs moves focus to the view, marks the tab button with `aria-current="page"` and sets the page title (for example "Nutrition · genki").

Focus survives a re-render: a view replaces its HTML on every change, so `render()` re-focuses the control that had focus (found by its `data-*` attributes, `focusKey()` in `ui.js`), and when a sheet closes after its opener was re-rendered away, focus goes to the same control in the new view (or the view itself). `html` has scroll padding for the sticky header and the tab bar, so a focused control is never hidden under them.

| Tab | What it shows now |
|-----|-------------------|
| Today | Greeting by time of day, the date, Calories and Protein tiles plus smaller Carbs and Fat tiles (left of today's targets, see [nutrition.md](nutrition.md#today-tab)), a "Log food" button, the two Coach cards (see [coach.md](coach.md)), the Fasting card and the Water and Exercise cards (see [trackers.md](trackers.md)), the weight card (7-day average, progress to goal, chart; see [weight.md](weight.md)), and a "Next workout" card (the next plan day with a Start button, or the session in progress with Continue; see [workouts.md](workouts.md)) |
| Nutrition | The day's food log against the targets, with the profile, add-food, my-foods and weekly history sheets. See [nutrition.md](nutrition.md) |
| Workouts | Train / Progress / Plan, ported from Liftlog: the plan builder, logging a session, records and charts. See [workouts.md](workouts.md) |
| Progress | One week at a time: Overview, Calories, Macros, Nutrients and Weight views, foods highest in a macro, and Export week (CSV). See [progress.md](progress.md) |

If IndexedDB cannot be opened (private browsing in some browsers, storage blocked), every tab shows a "Storage is unavailable" banner and nothing is saved.

## Screen-reader announcements

A view's re-render replaces its HTML, so a change in the view would go unspoken. `index.html` has one polite live region, `#announcer` (visually hidden, outside `#view` so no re-render replaces it), and `announce(text)` in `ui.js` fills it: it empties the region and sets the text 150 ms later, so the re-render and its focus restore settle first and the same message twice in a row is read again. The messages come from pure builders next to each feature's logic, unit-tested in `tests/announce.test.mjs`:

| When | What is read (builder) |
|------|------------------------|
| Food added (search, recently logged, quick add, a my meal, a coach meal idea, repeat the day before; "on 3 days" when several), an entry saved or removed | What happened, then the day's calories and protein against the targets (`dayTotalsMessage` in `nutrition.js`) |
| Weigh-in saved or deleted | What happened, then the 7-day average (`weighInMessage` in `weight.js`) |
| Water added or removed; a fast started, ended, changed or deleted; exercise saved or cleared | The glasses against the goal; the fast's length against its goal; the day's exercise and net calories (`waterMessage`, `fastMessage`, `exerciseMessage` in `trackers.js`) |
| Moved to another week on the Progress tab | The week and its average calories (`weekMessage` in `progress.js`) |
| A set ticked done or undone; a session finished | The exercise, set number, weight × reps and rest; or the session's sets and new PRs (`setMessage`, `sessionSavedMessage` in `workouts.js`) |

Saving a my meal says its name and how many foods it holds. Status lines inside sheets (`role="status"`) already speak their own messages (import results, form problems), so they are not repeated here.

## General sheet

`ui.js` drives a second `<dialog>` (`#panel-dialog`, same bottom-sheet look) that views fill with their own content: `openPanel(html, handlers)` shows it, `swapPanel()` replaces its content for the next step of a flow (with a back button), `closePanel()` hides it. Handlers get every tap on a `[data-act]` element, every form submit (default prevented) and every input change inside it; `data-act="close"` always closes. Closing returns focus to the control that opened the sheet. Forms use `novalidate` and show the first problem in a status line.

## Data & backup sheet

The header's download button opens a `<dialog>` (a bottom sheet on a phone, centered from 640px wide). It shows how many records are stored and when the last export and import happened, and has these actions:

- **Export backup (JSON)** records the export time, then downloads `genki-backup-<date>.json` with every store's records.
- **Import backup...** picks a file, validates it (see [data-flow.md](data-flow.md#backup-file)), shows the error in the sheet if it is not a valid backup, otherwise asks for confirmation and replaces the stored data with the backup's.
- **Import MyFitnessPal...** picks one or more CSV files from a MyFitnessPal export, asks for confirmation with what it will add, then adds the meals, my foods and weigh-ins, and fills in fiber, sugar and sodium on meals and my foods an earlier import added without them (see [nutrition.md](nutrition.md#myfitnesspal-import)). The result or the reason nothing changed shows in the sheet's status line.

Below them is the **Sync** section (`sync-view.js`, see [sync.md](sync.md)): a token field until a token is saved, then the last sync time, a line saying that a sync merges, and Sync now, Restore from genki-data... and Remove token, with its own status line. The sheet scrolls inside itself when it is taller than the screen.

Tapping the backdrop or the close button closes the sheet. Messages appear in a status line inside the sheet.

## Conventions

- Views are template strings; any stored or user-provided text goes through `esc()` before it reaches `innerHTML`.
- No URL routes beyond the tab hash; there is one HTML page.
