---
owns:
  - workouts.js
  - workouts-view.js
  - scripts/workout-history.mjs
status: current
---

# Workouts

The Workouts tab is a port of Liftlog, the workout planner on the owner's website (`syoon291.github.io/workout/`). Liftlog itself is unchanged and keeps working; genki can bring its data over (below). The tab has three parts, picked with a Train / Progress / Plan toggle (Train when a plan exists, Plan otherwise; the choice resets on reload).

| File | Role |
|------|------|
| `workouts.js` | Exercise library, plan generator, double progression, estimated 1RM, sets per muscle, weekly volume, records, the CSV, drafts, rep notation, the Liftlog migration, the workout history file. Pure, unit-tested (`tests/workouts.test.mjs`, `tests/notation.test.mjs`) |
| `scripts/workout-history.mjs` | Turns the owner's older workout log into a workout history file, on the owner's computer (below) |
| `workouts-view.js` | The tab's three views and charts, the rest timer, the Today tab's "Next workout" card, and their handlers (acts starting `lift-`) |

## Plan

Four toggles (goal: strength / muscle / general; 2-6 days a week; equipment: full gym / dumbbells / bodyweight; experience) generate a plan straight away; "Use this plan" saves it. Days per week set the split: 2-3 full body, 4 upper/lower, 5 push/pull/legs plus upper/lower, 6 push/pull/legs twice. Each day is a template of movement patterns; each pattern takes the best exercise the equipment allows, and a repeated day rotates to a variant. The goal sets sets, rep range, reps in reserve (RIR) and rest for main lifts and accessories; beginners get one set fewer, advanced lifters one more accessory set; bodyweight exercises use a higher rep range.

The **volume check** charts planned hard sets per muscle a week (1 per primary muscle, 0.5 per assisting one) against a shaded 10-20 band, and names muscles under or over it. Switching plans keeps logged sessions and drops a session in progress (after a confirm).

**Settings and data**: the weight unit (kg or lb; weights are stored in kg, lb only changes what is shown and typed; switching it converts the weights already typed in a session in progress, to 0.1 of the new unit so toggling back and forth never drifts), **Export CSV** (one row per set: date, session, exercise, pattern, set, weight, reps, rir, e1rm, primary muscles, notation: the set's reps written as in the table below; a session or exercise name that starts with =, +, - or @ gets a leading ' so a spreadsheet keeps it as text) and **Import Liftlog file**.

## Train

The plan's days, with the next one in the rotation marked. Starting a day creates a session in progress (the draft) with a card per exercise:

- **Last** shows the last session's sets of that exercise; **Try** gives the progression suggestion. Set rows are pre-filled with the suggested weight; the reps and RIR placeholders show the targets.
- Progression is double progression: stay at a weight until every set reaches the top of the rep range, then add the exercise's smallest jump (0.5-5 kg); most sets below the range drops about 10%; bodyweight work adds a rep. At the same weight the target is a whole rep more than the best set's whole reps, so after a fractional set (7.4) it suggests 8, not 8.4, never above the top of the range.
- A swap menu offers the other exercises of the same pattern that the plan's equipment allows (the suggestion follows the new exercise).
- The reps box takes the owner's rep notation (below), on a full keyboard; text that does not read as notation gets a red border and cannot be ticked done.
- The check button marks a set done; on an empty row it logs the placeholders. Marking a set done starts the rest timer: a bar above the tabs with +30 s and Skip, vibrating at zero where the phone allows. Screen readers hear the set logged (weight × reps and the rest), and on finish the session's sets and new PRs ([frontend.md](frontend.md#screen-reader-announcements)).
- Every keystroke is saved, so a reload or a closed app keeps the session.
- **Finish and save** keeps rows whose reps read as notation (blank RIR takes the target, or 0 on a hard set; a drop set on an exercise's first row is saved as a normal set), stores the session, moves the rotation on, and shows a summary with sets, load moved, minutes and new PRs. **Discard** drops it.

The Today tab shows the next day with a Start button, or "Workout in progress" with Continue.

## Progress

Sessions in the last 28 days and per week, load moved in the last 7 days against the 7 before, PRs in the last 28 days; then:

- **Strength trend**: the best estimated one-rep max per session for a chosen weighted exercise, with a least-squares trend line (from 3 sessions), the latest, the best and the slope a week with R².
- **Recent PRs**: a session whose best estimated 1RM beats every earlier session of that exercise.
- **Sets per muscle, last 7 days**, with the plan's weekly target as a tick.
- **Weekly volume**: weight × reps per Monday-start week, 12 weeks.
- **Consistency**: a 16-week day grid shaded by sets.
- **History**: the last 20 sessions, each deletable.

Estimated 1RM is Epley, weight × (1 + reps ÷ 30), counting RIR as reps you could have done, with reps plus RIR capped at 15 (a total of 1 or less is the weight itself). Reps may be fractional (7.4 counts as 7.4); extra reps count toward load moved but not toward the 1RM. Imported exercises with a weight show in the trend picker beside the library's weighted ones.

## Rep notation

How the owner writes a set, read by `parseReps` the same way in the reps box and in an imported log (`formatReps` writes it back; the Last line, the CSV's `notation` column and screen reader messages use it):

| Written | Means |
|---------|-------|
| `7.4` | 7 reps and 0.4 of the 8th; `12.55` is 12 and 0.55 of the 13th |
| `7.7H` | H: a hard set, stopped near failure (saved with 0 in reserve) |
| `7+1H` | +1: extra reps after the set (assisted, cheat or rest-pause) |
| `7R`, `7L`, `7RH` | One side only. RH and LH are right and left hand, so `7RH` is not hard; a hard right-hand set is `7HR` |
| `10R:7L` | Each side on its own (the set's reps are the lower side) |
| `d6` | A drop set: lighter weight straight after the set before (a drop on an exercise's first set is saved as a normal set) |
| `7 (slow)` | Text in brackets is a note, `(H)` is hard; a comma reads as a decimal point |

The reps box is strict: any other text is refused. An imported log is read leniently, keeping the extra words as the set's note. Reps must be above 0 and under 1000.

Weights are stored in kg to 3 decimals, so a pound weight shows back exactly (to 0.1 of the unit, not rounded to a plate step). Bodyweight sets (imported) show as `BW`. In-app sets have no bodyweight flag yet: a bodyweight library exercise's weight column is the added load, as before.

## Storage

Finished sessions are in the `workouts` store; the owner's own exercises (imported with a workout history, names only) are in the `exercises` store (database version 9, backup schema 9); the plan, rotation position, draft, unit, plan form and the chart's exercise are `meta` keys starting `lift` (shapes in [data-flow.md](data-flow.md#store)). All of it is in the JSON backup.

## Workout history import

The owner's older training log (written in the notation above) comes in as a file, so the data enters only on the owner's devices and travels by sync. Nothing of it is in this repo.

1. On the owner's computer, `node scripts/workout-history.mjs propose <dir>` reads `<dir>/workouts.json` (the log parsed into sessions, exercises and sets) and writes `aliases.proposed.json`: exercise names grouped by spelling, plural, word order and abbreviation ("dumbbell bicep curls" with "dumbbell curl"), never across equipment, with a genki library id where a group is one of the library's exercises, and names that read like notes flagged.
2. The owner checks it and saves it as `aliases.json`: `{ exercises: [{ name, exId?, keys: [names as in the log] }] }`.
3. `node scripts/workout-history.mjs convert <dir>` writes `genki-workout-history.json`. It reads each set's written reps again with `parseReps` (so "9.7" is 9.7 reps), takes weights as pounds unless the log says kg, keeps words around the reps as the set's note (falling back to the log's own parsed columns when the text does not read), marks bodyweight sets, keeps a set counted in plates as weight 0 with a note, drops sets without reps and sessions without sets, and prints the counts. A drop set on an exercise's first set is written as a normal set.
4. In the app, Plan > Settings and data > **Import workout history** picks that file. `fromHistoryFile` rebuilds every field (ids, dates, numbers, names checked; a drop set must follow a set of the same exercise), then the sessions genki does not have yet are added (by id, so a second import adds nothing) with `source: "history"`, a local-noon date and no minutes, and the exercises they use go to the `exercises` store (only when new or renamed). The message says how many sessions and sets were added and how many were already there. When the file is in pounds and the app still shows kg, it switches to pounds, as the log is written.

A group with a library id joins that exercise's history, so progression suggestions and PRs see it; the others are the owner's own exercises, named in the `exercises` store (no muscles, so they do not count in sets per muscle).

## Liftlog migration

Liftlog kept one JSON object in `localStorage` under `liftlog.v1`, and its backup file is the same object. genki on GitHub Pages shares the website's origin, so it can read that key directly: when it holds sessions genki does not have (or a plan while genki has none), the Workouts tab offers to bring them over. Sessions are added by id (never twice, never replacing genki's); the plan, rotation and unit are taken only when genki has no plan yet. "Not now" or an import hides the offer for good (deleting an imported session does not bring it back); the imported plan is rebuilt field by field (numbers clamped, goal, equipment and level checked against the allowed values), so a hand-edited file cannot inject markup; a Liftlog backup file can still be imported from Plan's settings. Imported sessions carry `source: "liftlog"`. genki never writes to Liftlog's key.
